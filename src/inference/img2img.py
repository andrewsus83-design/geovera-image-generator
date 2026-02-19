"""Image-to-image variations pipeline.

Generates controlled variations of an existing image while maintaining
consistency with the original. Supports strength control to balance
between fidelity to the original and creative variation.
"""

from pathlib import Path

import torch
from diffusers import AutoencoderKL, StableDiffusionXLImg2ImgPipeline
from omegaconf import OmegaConf
from PIL import Image


class ImageVariationGenerator:
    """Generate variations of existing images with controlled strength."""

    def __init__(self, config_path="configs/inference_config.yaml"):
        self.config = OmegaConf.load(config_path)
        self.device = torch.device(
            "cuda" if torch.cuda.is_available()
            else "mps" if torch.backends.mps.is_available()
            else "cpu"
        )
        self.dtype = torch.float16 if self.device.type in ("cuda", "mps") else torch.float32
        self.pipe = None

    def load_pipeline(self):
        """Load the img2img pipeline."""
        print("Loading VAE...")
        vae = AutoencoderKL.from_pretrained(
            self.config.model.vae_model,
            torch_dtype=self.dtype,
        )

        print("Loading SDXL img2img pipeline...")
        self.pipe = StableDiffusionXLImg2ImgPipeline.from_pretrained(
            self.config.model.pretrained_model,
            vae=vae,
            torch_dtype=self.dtype,
        )

        # Load LoRA weights if available
        lora_path = Path(self.config.model.lora_weights)
        if lora_path.exists():
            print(f"Loading LoRA weights from {lora_path}...")
            self.pipe.load_lora_weights(str(lora_path))
            self.pipe.fuse_lora(lora_scale=self.config.model.lora_scale)

        self.pipe.to(self.device)
        self.pipe.enable_model_cpu_offload()

        print("Img2Img pipeline loaded!")
        return self

    def generate_variations(
        self,
        source_image,
        prompt,
        num_variations=4,
        strength=0.5,
        guidance_scale=7.5,
        negative_prompt=None,
        seed=None,
    ):
        """Generate variations of a source image.

        Args:
            source_image: Path or PIL Image of the source.
            prompt: Text prompt describing desired output.
            num_variations: Number of variations to generate.
            strength: How much to change from original (0.0 = identical, 1.0 = completely new).
                - 0.1-0.3: Subtle variations (color shifts, minor details)
                - 0.3-0.5: Moderate variations (recommended for products)
                - 0.5-0.7: Significant variations (new elements, different angles)
                - 0.7-1.0: Major changes (loosely based on original)
            guidance_scale: How closely to follow the text prompt.
            negative_prompt: What to avoid.
            seed: Base seed (each variation uses seed + i for reproducibility).

        Returns:
            List of PIL Images.
        """
        if self.pipe is None:
            self.load_pipeline()

        if isinstance(source_image, (str, Path)):
            source_image = Image.open(source_image).convert("RGB")

        # Resize to target dimensions
        width = self.config.generation.width
        height = self.config.generation.height
        source_image = source_image.resize((width, height), Image.LANCZOS)

        negative_prompt = negative_prompt or self.config.generation.negative_prompt

        variations = []
        for i in range(num_variations):
            generator = None
            if seed is not None:
                generator = torch.Generator(device=self.device).manual_seed(seed + i)

            result = self.pipe(
                prompt=prompt,
                image=source_image,
                strength=strength,
                guidance_scale=guidance_scale,
                negative_prompt=negative_prompt,
                num_inference_steps=self.config.generation.num_inference_steps,
                generator=generator,
            )
            variations.append(result.images[0])
            print(f"  Variation {i+1}/{num_variations} complete")

        return variations

    def generate_strength_sweep(
        self,
        source_image,
        prompt,
        strengths=None,
        guidance_scale=7.5,
        negative_prompt=None,
        seed=42,
    ):
        """Generate variations at different strength levels.

        Useful for finding the optimal strength for a given image.

        Args:
            source_image: Source image.
            prompt: Text prompt.
            strengths: List of strength values to try.
            seed: Fixed seed for fair comparison.

        Returns:
            Dict mapping strength -> PIL Image.
        """
        if strengths is None:
            strengths = [0.2, 0.35, 0.5, 0.65, 0.8]

        results = {}
        for strength in strengths:
            print(f"Generating at strength={strength}...")
            images = self.generate_variations(
                source_image=source_image,
                prompt=prompt,
                num_variations=1,
                strength=strength,
                guidance_scale=guidance_scale,
                negative_prompt=negative_prompt,
                seed=seed,
            )
            results[strength] = images[0]

        return results

    def batch_variations(
        self,
        source_images,
        prompts,
        output_dir=None,
        num_variations=4,
        strength=0.5,
        **kwargs,
    ):
        """Generate variations for multiple source images.

        Args:
            source_images: List of image paths.
            prompts: List of prompts (one per source image).
            output_dir: Directory to save results.
            num_variations: Variations per source image.
            strength: Variation strength.

        Returns:
            Dict mapping source filename -> list of variation PIL Images.
        """
        output_dir = Path(output_dir or self.config.output.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        all_results = {}
        for src_path, prompt in zip(source_images, prompts):
            src_path = Path(src_path)
            print(f"\nGenerating variations for {src_path.name}...")

            variations = self.generate_variations(
                source_image=src_path,
                prompt=prompt,
                num_variations=num_variations,
                strength=strength,
                **kwargs,
            )

            for j, img in enumerate(variations):
                save_path = output_dir / f"{src_path.stem}_var{j:02d}.png"
                img.save(save_path)
                print(f"  Saved: {save_path}")

            all_results[src_path.name] = variations

        return all_results
