"""Inference pipeline for consistent image generation.

Uses LoRA (trained style) + ControlNet (structural consistency) + IP-Adapter (face consistency)
to generate images that closely match the original reference while maintaining quality.
"""

import os
from pathlib import Path

import cv2
import numpy as np
import torch
from controlnet_aux import CannyDetector
from diffusers import (
    AutoencoderKL,
    ControlNetModel,
    StableDiffusionXLControlNetPipeline,
)
from omegaconf import OmegaConf
from PIL import Image


class ImageGenerator:
    """Consistent image generator using LoRA + ControlNet + IP-Adapter."""

    def __init__(self, config_path="configs/inference_config.yaml"):
        self.config = OmegaConf.load(config_path)
        self.device = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
        self.dtype = torch.float16 if self.device.type in ("cuda", "mps") else torch.float32
        self.pipe = None
        self.canny_detector = CannyDetector()

    def load_pipeline(self):
        """Load the full generation pipeline."""
        try:
            print("Loading ControlNet...")
            controlnet = ControlNetModel.from_pretrained(
                self.config.controlnet.model,
                torch_dtype=self.dtype,
            )
        except Exception as e:
            raise RuntimeError(
                f"Failed to load ControlNet model '{self.config.controlnet.model}': {e}\n"
                "Check your internet connection and HF_TOKEN if the model is gated."
            ) from e

        try:
            print("Loading VAE...")
            vae = AutoencoderKL.from_pretrained(
                self.config.model.vae_model,
                torch_dtype=self.dtype,
            )
        except Exception as e:
            raise RuntimeError(
                f"Failed to load VAE model '{self.config.model.vae_model}': {e}\n"
                "Check your internet connection and available disk space."
            ) from e

        try:
            print("Loading SDXL pipeline with ControlNet...")
            self.pipe = StableDiffusionXLControlNetPipeline.from_pretrained(
                self.config.model.pretrained_model,
                controlnet=controlnet,
                vae=vae,
                torch_dtype=self.dtype,
            )
        except Exception as e:
            raise RuntimeError(
                f"Failed to load SDXL model '{self.config.model.pretrained_model}': {e}\n"
                "This model requires ~7GB download and ~12GB disk space.\n"
                "Check internet connection, disk space, and HF_TOKEN."
            ) from e

        # Load LoRA weights if available
        lora_path = Path(self.config.model.lora_weights)
        if lora_path.exists():
            print(f"Loading LoRA weights from {lora_path}...")
            self.pipe.load_lora_weights(str(lora_path))
            self.pipe.fuse_lora(lora_scale=self.config.model.lora_scale)
        else:
            print(f"  [info] No LoRA weights at {lora_path} — using base model")

        # Load IP-Adapter for face consistency
        if self.config.get("ip_adapter"):
            try:
                print("Loading IP-Adapter for face consistency...")
                self.pipe.load_ip_adapter(
                    self.config.ip_adapter.model,
                    subfolder=self.config.ip_adapter.subfolder,
                    weight_name=self.config.ip_adapter.weight_name,
                )
                self.pipe.set_ip_adapter_scale(self.config.ip_adapter.scale)
            except Exception as e:
                print(f"  [warning] Failed to load IP-Adapter: {e}")
                print("  Continuing without face consistency — images will generate without identity matching.")

        self.pipe.to(self.device)

        # Enable memory optimizations
        if self.device.type == "cuda":
            try:
                self.pipe.enable_xformers_memory_efficient_attention()
            except Exception:
                print("  [info] xformers not available, using default attention")
        self.pipe.enable_model_cpu_offload()

        print("Pipeline loaded successfully!")
        return self

    def extract_canny_edges(self, image, low_threshold=100, high_threshold=200):
        """Extract Canny edge map from reference image for structural consistency."""
        if isinstance(image, Image.Image):
            image = np.array(image)
        edges = cv2.Canny(image, low_threshold, high_threshold)
        edges = Image.fromarray(edges).convert("RGB")
        return edges

    def generate(
        self,
        prompt,
        reference_image=None,
        face_image=None,
        negative_prompt=None,
        num_images=None,
        seed=None,
        controlnet_conditioning_scale=None,
        **kwargs,
    ):
        """Generate images with consistency controls.

        Args:
            prompt: Text description of the desired image.
            reference_image: Reference image for structural consistency (ControlNet).
            face_image: Face reference for identity consistency (IP-Adapter).
            negative_prompt: What to avoid in generation.
            num_images: Number of images to generate.
            seed: Random seed for reproducibility.
            controlnet_conditioning_scale: How closely to follow the reference structure.
        """
        if self.pipe is None:
            self.load_pipeline()

        config = self.config.generation
        negative_prompt = negative_prompt or config.negative_prompt
        num_images = num_images or config.num_images
        seed = seed if seed is not None else config.seed

        generator = None
        if seed is not None:
            generator = torch.Generator(device=self.device).manual_seed(seed)

        # Prepare ControlNet conditioning from reference image
        control_image = None
        if reference_image is not None:
            if isinstance(reference_image, (str, Path)):
                reference_image = Image.open(reference_image).convert("RGB")
            reference_image = reference_image.resize((config.width, config.height))
            control_image = self.extract_canny_edges(reference_image)

        # Prepare IP-Adapter face image
        ip_adapter_image = None
        if face_image is not None:
            if isinstance(face_image, (str, Path)):
                face_image = Image.open(face_image).convert("RGB")
            ip_adapter_image = face_image

        # Build generation kwargs
        gen_kwargs = {
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "num_inference_steps": config.num_inference_steps,
            "guidance_scale": config.guidance_scale,
            "width": config.width,
            "height": config.height,
            "num_images_per_prompt": num_images,
            "generator": generator,
        }

        if control_image is not None:
            gen_kwargs["image"] = control_image
            gen_kwargs["controlnet_conditioning_scale"] = (
                controlnet_conditioning_scale or self.config.controlnet.conditioning_scale
            )
            gen_kwargs["control_guidance_start"] = self.config.controlnet.guidance_start
            gen_kwargs["control_guidance_end"] = self.config.controlnet.guidance_end

        if ip_adapter_image is not None:
            gen_kwargs["ip_adapter_image"] = ip_adapter_image

        gen_kwargs.update(kwargs)

        # Generate
        print(f"Generating {num_images} image(s)...")
        result = self.pipe(**gen_kwargs)

        return result.images

    def generate_product(self, prompt, reference_image, seed=None, conditioning_scale=0.6):
        """Generate product images consistent with reference.

        Higher conditioning_scale = closer to original structure.
        """
        return self.generate(
            prompt=prompt,
            reference_image=reference_image,
            controlnet_conditioning_scale=conditioning_scale,
            seed=seed,
        )

    def generate_face(self, prompt, reference_image, face_image, seed=None):
        """Generate face/portrait images with identity consistency.

        Uses both ControlNet (pose) and IP-Adapter (face identity).
        """
        return self.generate(
            prompt=prompt,
            reference_image=reference_image,
            face_image=face_image,
            seed=seed,
        )

    def batch_generate(self, prompts, reference_images, output_dir=None, **kwargs):
        """Generate multiple images in batch."""
        output_dir = Path(output_dir or self.config.output.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        all_images = []
        for i, (prompt, ref_img) in enumerate(zip(prompts, reference_images)):
            images = self.generate(prompt=prompt, reference_image=ref_img, **kwargs)
            for j, img in enumerate(images):
                save_path = output_dir / f"generated_{i:04d}_{j:02d}.{self.config.output.save_format}"
                img.save(save_path)
                print(f"Saved: {save_path}")
            all_images.extend(images)

        return all_images


def generate_from_cli():
    """CLI entry point for image generation."""
    import argparse

    parser = argparse.ArgumentParser(description="Generate images with consistency controls")
    parser.add_argument("--config", type=str, default="configs/inference_config.yaml")
    parser.add_argument("--prompt", type=str, required=True)
    parser.add_argument("--reference", type=str, help="Path to reference image")
    parser.add_argument("--face", type=str, help="Path to face reference image")
    parser.add_argument("--output", type=str, default="data/output")
    parser.add_argument("--num-images", type=int, default=1)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--conditioning-scale", type=float, default=0.5)
    args = parser.parse_args()

    generator = ImageGenerator(args.config)
    generator.load_pipeline()

    images = generator.generate(
        prompt=args.prompt,
        reference_image=args.reference,
        face_image=args.face,
        num_images=args.num_images,
        seed=args.seed,
        controlnet_conditioning_scale=args.conditioning_scale,
    )

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    for i, img in enumerate(images):
        path = output_dir / f"output_{i:04d}.png"
        img.save(path)
        print(f"Saved: {path}")


if __name__ == "__main__":
    generate_from_cli()
