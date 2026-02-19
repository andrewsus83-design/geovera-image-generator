"""Gemini-powered image indexing and auto-captioning.

Uses Google's Gemini Vision API to:
1. Auto-generate detailed captions for training images
2. Index and categorize images by content
3. Assess image quality for training suitability
4. Extract structured metadata (tags, colors, objects, faces)
"""

import base64
import json
import os
import time
from pathlib import Path

import google.generativeai as genai
from PIL import Image

from src.utils.env_check import check_gemini_env, retry


class GeminiIndexer:
    """Image indexer and captioner powered by Gemini Vision."""

    def __init__(self, api_key=None, model_name="gemini-2.0-flash"):
        api_key = api_key or os.environ.get("GEMINI_API_KEY")
        if not api_key:
            check_gemini_env()  # Will raise with helpful message
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel(model_name)

    def _load_image(self, image_path):
        """Load image for Gemini API."""
        return Image.open(image_path).convert("RGB")

    @retry(max_retries=3, base_delay=2.0, exceptions=(Exception,))
    def generate_caption(self, image_path, style="detailed"):
        """Generate a training-optimized caption for an image.

        Args:
            image_path: Path to the image file.
            style: Caption style - "detailed", "concise", or "tags".

        Returns:
            Generated caption string.
        """
        image = self._load_image(image_path)

        prompts = {
            "detailed": (
                "Describe this image in detail for AI image generation training. "
                "Include: subject, pose/position, lighting, colors, background, style, "
                "quality, and any notable details. Use natural, descriptive language. "
                "Do not start with 'This image shows' or similar phrases. "
                "Write as a single paragraph, 2-4 sentences."
            ),
            "concise": (
                "Write a concise image caption for AI training. "
                "Focus on: main subject, key visual attributes, and style. "
                "One sentence, under 30 words."
            ),
            "tags": (
                "List descriptive tags for this image, separated by commas. "
                "Include: subject type, colors, lighting, mood, style, quality descriptors. "
                "Example format: professional photo, woman, brown hair, studio lighting, "
                "neutral background, high quality"
            ),
        }

        response = self.model.generate_content([prompts[style], image])
        return response.text.strip()

    @retry(max_retries=3, base_delay=2.0, exceptions=(Exception,))
    def analyze_image(self, image_path):
        """Get comprehensive analysis of an image for indexing.

        Returns structured metadata including category, quality score,
        detected objects, colors, and training suitability.
        """
        image = self._load_image(image_path)

        prompt = """Analyze this image and return a JSON object with exactly these fields:
{
    "category": "product" or "face" or "landscape" or "other",
    "subcategory": "specific type like electronics, fashion, portrait, etc.",
    "quality_score": 1-10 (10 = highest quality),
    "resolution_adequate": true/false (is it sharp enough for AI training?),
    "main_subject": "brief description of the main subject",
    "colors": ["list", "of", "dominant", "colors"],
    "lighting": "natural/studio/ambient/dramatic/etc",
    "background": "plain/complex/blurred/outdoor/etc",
    "has_face": true/false,
    "face_count": 0,
    "composition": "centered/rule-of-thirds/close-up/full-body/etc",
    "style": "photo/illustration/3d-render/etc",
    "training_suitable": true/false,
    "training_notes": "any concerns about using this for training"
}

Return ONLY the JSON object, no other text."""

        response = self.model.generate_content([prompt, image])
        text = response.text.strip()

        # Clean up markdown code blocks if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            text = text.rsplit("```", 1)[0]

        return json.loads(text)

    @retry(max_retries=3, base_delay=2.0, exceptions=(Exception,))
    def assess_quality(self, image_path):
        """Quick quality assessment for training suitability.

        Returns:
            dict with 'score' (1-10), 'suitable' (bool), 'reason' (str).
        """
        image = self._load_image(image_path)

        prompt = """Rate this image's quality for AI model training on a scale of 1-10.
Consider: sharpness, lighting, composition, resolution, artifacts.

Return JSON only:
{"score": N, "suitable": true/false, "reason": "brief explanation"}"""

        response = self.model.generate_content([prompt, image])
        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]
            text = text.rsplit("```", 1)[0]

        return json.loads(text)

    def batch_caption(self, image_dir, output_dir=None, style="detailed", delay=1.0):
        """Generate captions for all images in a directory.

        Creates .txt caption files alongside each image.

        Args:
            image_dir: Directory containing images.
            output_dir: Where to save captions (default: same as image_dir).
            style: Caption style.
            delay: Delay between API calls to avoid rate limiting.
        """
        image_dir = Path(image_dir)
        output_dir = Path(output_dir or image_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        image_extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
        images = [p for p in image_dir.iterdir() if p.suffix.lower() in image_extensions]

        print(f"Captioning {len(images)} images with Gemini ({style} style)...")
        results = {}

        for i, img_path in enumerate(images):
            try:
                caption = self.generate_caption(img_path, style=style)
                caption_path = output_dir / f"{img_path.stem}.txt"
                caption_path.write_text(caption)
                results[img_path.name] = caption
                print(f"  [{i+1}/{len(images)}] {img_path.name}: {caption[:80]}...")

                if delay > 0 and i < len(images) - 1:
                    time.sleep(delay)
            except Exception as e:
                print(f"  [{i+1}/{len(images)}] ERROR {img_path.name}: {e}")
                results[img_path.name] = f"ERROR: {e}"

        print(f"Captioning complete. {len(results)} images processed.")
        return results

    def batch_index(self, image_dir, output_path=None, delay=1.0):
        """Index all images in a directory with structured metadata.

        Creates a JSON index file with metadata for each image.

        Args:
            image_dir: Directory containing images.
            output_path: Path for the index JSON file.
            delay: Delay between API calls.
        """
        image_dir = Path(image_dir)
        output_path = Path(output_path or image_dir / "index.json")

        image_extensions = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
        images = [p for p in image_dir.iterdir() if p.suffix.lower() in image_extensions]

        print(f"Indexing {len(images)} images with Gemini...")
        index = {}

        for i, img_path in enumerate(images):
            try:
                metadata = self.analyze_image(img_path)
                metadata["filename"] = img_path.name
                metadata["path"] = str(img_path)
                index[img_path.name] = metadata
                print(f"  [{i+1}/{len(images)}] {img_path.name}: {metadata.get('category', '?')} "
                      f"(quality: {metadata.get('quality_score', '?')}/10)")

                if delay > 0 and i < len(images) - 1:
                    time.sleep(delay)
            except Exception as e:
                print(f"  [{i+1}/{len(images)}] ERROR {img_path.name}: {e}")
                index[img_path.name] = {"error": str(e), "filename": img_path.name}

        # Save index
        output_path.write_text(json.dumps(index, indent=2))
        print(f"Index saved to {output_path}")

        # Print summary
        categories = {}
        quality_scores = []
        for data in index.values():
            if "error" not in data:
                cat = data.get("category", "unknown")
                categories[cat] = categories.get(cat, 0) + 1
                if "quality_score" in data:
                    quality_scores.append(data["quality_score"])

        print(f"\nSummary:")
        print(f"  Total images: {len(index)}")
        for cat, count in sorted(categories.items()):
            print(f"  {cat}: {count}")
        if quality_scores:
            print(f"  Avg quality: {sum(quality_scores)/len(quality_scores):.1f}/10")

        return index

    def filter_training_images(self, image_dir, min_quality=6):
        """Filter images suitable for training based on Gemini analysis.

        Returns list of image paths that meet quality threshold.
        """
        index_path = Path(image_dir) / "index.json"

        if index_path.exists():
            index = json.loads(index_path.read_text())
        else:
            index = self.batch_index(image_dir)

        suitable = []
        for name, data in index.items():
            if "error" in data:
                continue
            if data.get("training_suitable", False) and data.get("quality_score", 0) >= min_quality:
                suitable.append(Path(image_dir) / name)

        print(f"Found {len(suitable)}/{len(index)} images suitable for training (quality >= {min_quality})")
        return suitable


def caption_images_cli():
    """CLI for batch captioning images with Gemini."""
    import argparse

    parser = argparse.ArgumentParser(description="Auto-caption images using Gemini")
    parser.add_argument("image_dir", type=str, help="Directory containing images")
    parser.add_argument("--output-dir", type=str, default=None, help="Output directory for captions")
    parser.add_argument("--style", choices=["detailed", "concise", "tags"], default="detailed")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between API calls (seconds)")
    parser.add_argument("--api-key", type=str, default=None, help="Gemini API key")
    args = parser.parse_args()

    indexer = GeminiIndexer(api_key=args.api_key)
    indexer.batch_caption(args.image_dir, args.output_dir, args.style, args.delay)


def index_images_cli():
    """CLI for indexing images with Gemini."""
    import argparse

    parser = argparse.ArgumentParser(description="Index images using Gemini")
    parser.add_argument("image_dir", type=str, help="Directory containing images")
    parser.add_argument("--output", type=str, default=None, help="Output JSON path")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between API calls (seconds)")
    parser.add_argument("--api-key", type=str, default=None, help="Gemini API key")
    args = parser.parse_args()

    indexer = GeminiIndexer(api_key=args.api_key)
    indexer.batch_index(args.image_dir, args.output, args.delay)


if __name__ == "__main__":
    caption_images_cli()
