"""Vast.ai Serverless client for remote image generation.

Sends generation requests to vast.ai serverless endpoints instead
of running inference locally. Useful when running from a laptop or
machine without a GPU.

Usage:
    client = VastServerlessClient()
    images = client.generate("portrait of a woman", width=768, height=1344)
    images = client.variation(source_img, "luxury theme", strength=0.55)
    results = client.tiktok_batch(source_img, "a young Asian woman", theme_ids=[1,2,3])
"""

import base64
import io
import os
import time
from pathlib import Path

import requests
from PIL import Image


class VastServerlessClient:
    """Client for vast.ai serverless image generation endpoints."""

    def __init__(self, endpoint_url=None, api_key=None, timeout=300):
        """Initialize the serverless client.

        Args:
            endpoint_url: Vast.ai serverless endpoint URL.
                          Or set VAST_ENDPOINT_URL env var.
            api_key: Vast.ai serverless API key.
                     Or set VAST_API_KEY env var.
            timeout: Request timeout in seconds (default 5 min).
        """
        self.endpoint_url = (
            endpoint_url
            or os.environ.get("VAST_ENDPOINT_URL")
        )
        self.api_key = api_key or os.environ.get("VAST_API_KEY")

        if not self.endpoint_url:
            raise ValueError(
                "Vast.ai endpoint URL required.\n"
                "Set VAST_ENDPOINT_URL env variable or pass endpoint_url parameter.\n"
                "Find your endpoint URL in the vast.ai Serverless dashboard."
            )
        if not self.api_key:
            raise ValueError(
                "Vast.ai API key required.\n"
                "Set VAST_API_KEY env variable or pass api_key parameter.\n"
                "Find your Serverless API key in the vast.ai dashboard."
            )

        self.endpoint_url = self.endpoint_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        })

    def _post(self, route, payload):
        """Send POST request to serverless endpoint."""
        url = f"{self.endpoint_url}{route}"
        try:
            resp = self.session.post(url, json=payload, timeout=self.timeout)
            resp.raise_for_status()
            return resp.json()
        except requests.exceptions.Timeout:
            raise RuntimeError(
                f"Request timed out after {self.timeout}s. "
                "The endpoint may be cold-starting. Try again in 30s."
            )
        except requests.exceptions.ConnectionError:
            raise RuntimeError(
                f"Cannot connect to {url}. "
                "Check that your vast.ai serverless endpoint is running "
                "and the URL is correct."
            )
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 401:
                raise RuntimeError("Authentication failed. Check your VAST_API_KEY.")
            elif e.response.status_code == 503:
                raise RuntimeError(
                    "Endpoint is scaling up (no active workers). "
                    "Wait 30-60s for workers to start and try again."
                )
            raise RuntimeError(f"HTTP {e.response.status_code}: {e.response.text}")

    @staticmethod
    def _image_to_base64(image):
        """Convert PIL Image or file path to base64 string."""
        if isinstance(image, (str, Path)):
            image = Image.open(image).convert("RGB")
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")

    @staticmethod
    def _base64_to_image(b64_string):
        """Convert base64 string to PIL Image."""
        data = base64.b64decode(b64_string)
        return Image.open(io.BytesIO(data)).convert("RGB")

    def health(self):
        """Check endpoint health."""
        url = f"{self.endpoint_url}/health"
        resp = self.session.get(url, timeout=10)
        return resp.json()

    def generate(
        self,
        prompt,
        width=768,
        height=1344,
        num_images=1,
        guidance_scale=3.5,
        num_inference_steps=None,
        seed=None,
    ):
        """Generate images from text prompt via serverless.

        Args:
            prompt: Text description.
            width: Image width.
            height: Image height.
            num_images: Number of images.
            guidance_scale: Guidance scale.
            num_inference_steps: Inference steps (None = model default).
            seed: Random seed.

        Returns:
            List of PIL Images.
        """
        payload = {
            "prompt": prompt,
            "width": width,
            "height": height,
            "num_images": num_images,
            "guidance_scale": guidance_scale,
            "seed": seed,
        }
        if num_inference_steps is not None:
            payload["num_inference_steps"] = num_inference_steps

        result = self._post("/generate/sync", payload)
        return [self._base64_to_image(b64) for b64 in result["images"]]

    def generate_variation(
        self,
        source_image,
        prompt,
        strength=0.55,
        width=768,
        height=1344,
        num_images=1,
        seed=None,
    ):
        """Generate image-to-image variation via serverless.

        Args:
            source_image: PIL Image or file path.
            prompt: Text prompt.
            strength: Variation strength (0.0-1.0).
            width: Output width.
            height: Output height.
            num_images: Number of variations.
            seed: Random seed.

        Returns:
            List of PIL Images.
        """
        payload = {
            "source_image": self._image_to_base64(source_image),
            "prompt": prompt,
            "strength": strength,
            "width": width,
            "height": height,
            "num_images": num_images,
            "seed": seed,
        }

        result = self._post("/variation/sync", payload)
        return [self._base64_to_image(b64) for b64 in result["images"]]

    def tiktok_batch(
        self,
        subject_description,
        source_image=None,
        theme_ids=None,
        screen_ratio="9:16",
        color="none",
        num_images_per_theme=1,
        strength=0.55,
        seed=42,
        continuity=False,
        continuity_arc="journey",
    ):
        """Generate full TikTok ad batch via serverless.

        Args:
            subject_description: Subject description string.
            source_image: PIL Image, file path, or None for text-to-image.
            theme_ids: List of theme IDs (1-30) or None for all.
            screen_ratio: Screen ratio key.
            color: Color palette key.
            num_images_per_theme: Images per theme.
            strength: Variation strength.
            seed: Random seed.
            continuity: Enable narrative continuity.
            continuity_arc: Narrative arc type.

        Returns:
            List of result dicts with 'theme_id', 'theme', 'images' (PIL), 'time'.
        """
        payload = {
            "subject_description": subject_description,
            "theme_ids": theme_ids,
            "screen_ratio": screen_ratio,
            "color": color,
            "num_images_per_theme": num_images_per_theme,
            "strength": strength,
            "seed": seed,
            "continuity": continuity,
            "continuity_arc": continuity_arc,
        }

        if source_image is not None:
            payload["source_image"] = self._image_to_base64(source_image)

        result = self._post("/tiktok-ads/sync", payload)

        # Convert base64 images back to PIL
        for r in result["results"]:
            r["images"] = [self._base64_to_image(b64) for b64 in r["images"]]

        return result["results"]
