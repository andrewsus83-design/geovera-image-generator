"""Flux model inference pipeline optimized for vast.ai GPU instances.

Flux (by Black Forest Labs) is optimized for photorealistic image generation.
This pipeline runs on vast.ai rented GPU instances for cost-effective generation.

Supports:
- Flux.1 Dev (high quality, slower)
- Flux.1 Schnell (fast, good quality)
- IP-Adapter for face/subject consistency
- LoRA adapters for style consistency
"""

import os
import time
from pathlib import Path

import torch
from diffusers import FluxPipeline, FluxImg2ImgPipeline
from PIL import Image


class FluxGenerator:
    """Image generator using Flux model, optimized for vast.ai."""

    def __init__(self, model_variant="dev", lora_path=None):
        """Initialize Flux generator.

        Args:
            model_variant: 'dev' (higher quality) or 'schnell' (faster).
            lora_path: Path to LoRA weights (optional).
        """
        self.model_variant = model_variant
        self.lora_path = lora_path
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        self.pipe = None
        self.img2img_pipe = None

        self.model_ids = {
            "dev": "black-forest-labs/FLUX.1-dev",
            "schnell": "black-forest-labs/FLUX.1-schnell",
        }

    def load_pipeline(self, enable_img2img=False):
        """Load Flux pipeline.

        Args:
            enable_img2img: Also load img2img pipeline for variations.
        """
        model_id = self.model_ids[self.model_variant]
        print(f"Loading Flux.1 {self.model_variant}...")

        # Text-to-image pipeline
        try:
            self.pipe = FluxPipeline.from_pretrained(
                model_id,
                torch_dtype=self.dtype,
            )
        except Exception as e:
            is_gated = "gated" in str(e).lower() or "401" in str(e) or "403" in str(e)
            hint = (
                "Flux.1-dev is a gated model. You need:\n"
                "  1. Accept the license at https://huggingface.co/black-forest-labs/FLUX.1-dev\n"
                "  2. Set HF_TOKEN environment variable with your HuggingFace token\n"
                "  Try: export HF_TOKEN=hf_your_token_here"
            ) if is_gated else (
                "Check your internet connection and available disk space.\n"
                f"Flux models require ~12GB download."
            )
            raise RuntimeError(f"Failed to load Flux model '{model_id}': {e}\n{hint}") from e

        # Load LoRA if provided
        if self.lora_path and Path(self.lora_path).exists():
            print(f"Loading LoRA weights from {self.lora_path}...")
            self.pipe.load_lora_weights(self.lora_path)
        elif self.lora_path:
            print(f"  [info] No LoRA weights at {self.lora_path} — using base model")

        # Optimizations for vast.ai GPU instances
        self.pipe.to(self.device)
        if self.device.type == "cuda":
            self.pipe.enable_model_cpu_offload()

        # Load img2img pipeline if needed
        if enable_img2img:
            try:
                print("Loading Flux img2img pipeline...")
                self.img2img_pipe = FluxImg2ImgPipeline.from_pretrained(
                    model_id,
                    torch_dtype=self.dtype,
                )
                if self.lora_path and Path(self.lora_path).exists():
                    self.img2img_pipe.load_lora_weights(self.lora_path)
                self.img2img_pipe.to(self.device)
                if self.device.type == "cuda":
                    self.img2img_pipe.enable_model_cpu_offload()
            except Exception as e:
                raise RuntimeError(f"Failed to load Flux img2img pipeline: {e}") from e

        print("Flux pipeline loaded!")
        return self

    def generate(
        self,
        prompt,
        width=768,
        height=1344,
        num_inference_steps=None,
        guidance_scale=3.5,
        num_images=1,
        seed=None,
    ):
        """Generate images from text prompt using Flux.

        Args:
            prompt: Detailed text prompt (Flux prefers natural language).
            width: Image width.
            height: Image height.
            num_inference_steps: Steps (default: 50 for dev, 4 for schnell).
            guidance_scale: Guidance scale (Flux uses lower values, 3-4 recommended).
            num_images: Number of images to generate.
            seed: Random seed.

        Returns:
            List of PIL Images.
        """
        if self.pipe is None:
            self.load_pipeline()

        if num_inference_steps is None:
            num_inference_steps = 50 if self.model_variant == "dev" else 4

        generator = None
        if seed is not None:
            generator = torch.Generator(device=self.device).manual_seed(seed)

        images = self.pipe(
            prompt=prompt,
            width=width,
            height=height,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            num_images_per_prompt=num_images,
            generator=generator,
        ).images

        return images

    def generate_variation(
        self,
        source_image,
        prompt,
        strength=0.55,
        width=768,
        height=1344,
        num_inference_steps=None,
        guidance_scale=3.5,
        num_images=1,
        seed=None,
    ):
        """Generate image-to-image variation using Flux.

        Args:
            source_image: PIL Image or file path.
            prompt: Text prompt for the variation.
            strength: How much to deviate from source (0.0-1.0).
            width: Output width.
            height: Output height.
            num_inference_steps: Denoising steps.
            guidance_scale: Prompt guidance strength.
            num_images: Number of variations.
            seed: Random seed.

        Returns:
            List of PIL Images.
        """
        if self.img2img_pipe is None:
            self.load_pipeline(enable_img2img=True)

        if isinstance(source_image, (str, Path)):
            source_image = Image.open(source_image).convert("RGB")
        source_image = source_image.resize((width, height), Image.LANCZOS)

        if num_inference_steps is None:
            num_inference_steps = 50 if self.model_variant == "dev" else 4

        generator = None
        if seed is not None:
            generator = torch.Generator(device=self.device).manual_seed(seed)

        images = self.img2img_pipe(
            prompt=prompt,
            image=source_image,
            strength=strength,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            num_images_per_prompt=num_images,
            generator=generator,
        ).images

        return images

    def generate_tiktok_ads(
        self,
        source_image,
        subject_description,
        theme_ids=None,
        screen_ratio="9:16",
        color="none",
        num_images_per_theme=1,
        strength=0.55,
        output_dir="data/output/tiktok",
        seed=42,
        continuity=False,
        continuity_arc="journey",
    ):
        """Generate TikTok ad variations using Flux model.

        Args:
            source_image: Path to source image.
            subject_description: Description of the subject.
            theme_ids: List of theme IDs (1-30) or None for all.
            screen_ratio: Screen ratio key.
            color: Color palette key.
            num_images_per_theme: Images per theme.
            strength: Variation strength.
            output_dir: Output directory.
            seed: Random seed.
            continuity: If True, images form a narrative sequence.
            continuity_arc: Narrative arc type (journey/transformation/adventure/emotion).

        Returns:
            List of result dicts.
        """
        from src.utils.tiktok_prompts import get_prompt, get_continuity_modifier, SCREEN_RATIOS, TIKTOK_AD_THEMES

        if theme_ids is None:
            theme_ids = list(range(1, len(TIKTOK_AD_THEMES) + 1))

        ratio_data = SCREEN_RATIOS.get(screen_ratio, SCREEN_RATIOS["9:16"])
        width, height = ratio_data["width"], ratio_data["height"]

        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        results = []
        total = len(theme_ids)
        previous_image = None

        for idx, theme_id in enumerate(theme_ids):
            theme_data = get_prompt(theme_id, subject_description, color=color, screen_ratio=screen_ratio)
            theme_name = theme_data["theme"].lower().replace(" ", "_").replace("-", "_").replace("&", "and")

            prompt_text = theme_data["prompt"]
            if continuity:
                prompt_text += get_continuity_modifier(idx, total, arc=continuity_arc)

            cont_label = f" [story {idx+1}/{total}]" if continuity else ""
            print(f"[{idx+1}/{total}] {theme_data['theme']}{cont_label}...")
            start = time.time()

            # Determine source: chain from previous output when continuity is on
            current_source = previous_image if (continuity and previous_image is not None) else source_image
            gen_strength = strength * 0.85 if (continuity and previous_image is not None) else strength

            images = self.generate_variation(
                source_image=current_source,
                prompt=prompt_text,
                strength=gen_strength,
                width=width,
                height=height,
                num_images=num_images_per_theme,
                seed=seed,
            )

            # Store for continuity chaining
            if continuity and images:
                previous_image = images[0] if isinstance(images, list) else images

            elapsed = time.time() - start
            saved = []
            for j, img in enumerate(images):
                suffix = f"_{j:02d}" if num_images_per_theme > 1 else ""
                path = output_path / f"{theme_id:02d}_{theme_name}{suffix}.png"
                img.save(path)
                saved.append(str(path))
                print(f"  Saved: {path} ({elapsed:.1f}s)")

            results.append({
                "theme_id": theme_id,
                "theme": theme_data["theme"],
                "paths": saved,
                "time": elapsed,
            })

        total_time = sum(r["time"] for r in results)
        total_imgs = sum(len(r["paths"]) for r in results)
        print(f"\nDone! {total_imgs} images in {total_time:.0f}s ({total_time/total_imgs:.1f}s/image)")

        return results


def estimate_vast_cost(num_images, model_variant="dev", gpu_type="RTX 4090"):
    """Estimate vast.ai cost for generating images.

    Args:
        num_images: Number of images to generate.
        model_variant: 'dev' or 'schnell'.
        gpu_type: GPU type on vast.ai.

    Returns:
        Dict with cost estimate.
    """
    # Approximate times per image (seconds)
    times = {
        "dev": {"RTX 4090": 15, "RTX 3090": 25, "A100": 10},
        "schnell": {"RTX 4090": 3, "RTX 3090": 5, "A100": 2},
    }
    # Approximate vast.ai rates ($/hr)
    rates = {"RTX 4090": 0.40, "RTX 3090": 0.25, "A100": 0.80}

    time_per_image = times[model_variant].get(gpu_type, 15)
    rate_per_hour = rates.get(gpu_type, 0.40)

    total_seconds = num_images * time_per_image
    total_hours = total_seconds / 3600
    total_cost = total_hours * rate_per_hour

    return {
        "num_images": num_images,
        "model": f"Flux.1 {model_variant}",
        "gpu": gpu_type,
        "time_per_image": f"{time_per_image}s",
        "total_time": f"{total_seconds/60:.1f} min",
        "rate": f"${rate_per_hour:.2f}/hr",
        "estimated_cost": f"${total_cost:.2f}",
    }
