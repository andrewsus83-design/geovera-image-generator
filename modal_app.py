"""Geovera Image Generator — Modal.com Serverless Deployment

Deploy:
    modal deploy modal_app.py

Run (test locally):
    modal run modal_app.py::generate --prompt "test" --width 768 --height 1344

Environment variables (set via Modal dashboard or CLI):
    HF_TOKEN  — HuggingFace token (optional, only needed for Flux.1-dev)
"""

import base64
import io
import json
import os
import sys
import time

import modal

# ── Modal App ─────────────────────────────────────────────────────
app = modal.App("geovera-flux")

# ── Container image ───────────────────────────────────────────────
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.1.0",
        "torchvision==0.16.0",
        "diffusers>=0.27.0",
        "transformers>=4.38.0",
        "accelerate>=0.27.0",
        "safetensors>=0.4.2",
        "sentencepiece>=0.1.99",
        "Pillow>=10.0.0",
        "numpy>=1.24.0",
        "huggingface_hub>=0.20.0",
    )
    .env({"PYTHONUNBUFFERED": "1"})
)

# ── Model cache volume ────────────────────────────────────────────
model_volume = modal.Volume.from_name("geovera-models", create_if_missing=True)

# ── Helpers ───────────────────────────────────────────────────────

def _img_to_b64(img) -> str:
    """Convert PIL Image to base64 PNG string."""
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _b64_to_img(b64: str):
    """Convert base64 string to PIL Image."""
    from PIL import Image
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


def _load_flux(variant: str = "schnell"):
    """Load Flux pipeline on GPU (cached in volume)."""
    import torch
    from diffusers import FluxPipeline

    model_id = (
        "black-forest-labs/FLUX.1-schnell"
        if variant == "schnell"
        else "black-forest-labs/FLUX.1-dev"
    )
    hf_token = os.environ.get("HF_TOKEN")
    cache_dir = "/model-cache"

    print(f"Loading {model_id} ...")
    pipe = FluxPipeline.from_pretrained(
        model_id,
        torch_dtype=torch.bfloat16,
        token=hf_token,
        cache_dir=cache_dir,
    )
    pipe.to("cuda")
    print(f"✓ {model_id} loaded")
    return pipe


def _load_flux_img2img(variant: str = "schnell"):
    """Load Flux img2img pipeline."""
    import torch
    from diffusers import FluxImg2ImgPipeline

    model_id = (
        "black-forest-labs/FLUX.1-schnell"
        if variant == "schnell"
        else "black-forest-labs/FLUX.1-dev"
    )
    hf_token = os.environ.get("HF_TOKEN")
    cache_dir = "/model-cache"

    print(f"Loading img2img {model_id} ...")
    pipe = FluxImg2ImgPipeline.from_pretrained(
        model_id,
        torch_dtype=torch.bfloat16,
        token=hf_token,
        cache_dir=cache_dir,
    )
    pipe.to("cuda")
    print(f"✓ img2img {model_id} loaded")
    return pipe


# ── Functions ─────────────────────────────────────────────────────

@app.function(
    gpu="T4",
    image=image,
    volumes={"/model-cache": model_volume},
    timeout=300,
    memory=16384,
)
def generate(
    prompt: str,
    width: int = 768,
    height: int = 1344,
    num_images: int = 1,
    num_steps: int = 4,
    guidance_scale: float = 0.0,
    seed: int = 42,
    model_variant: str = "schnell",
) -> dict:
    """Text-to-image generation with Flux Schnell.

    Returns:
        {"images": [base64_png, ...], "time": float, "model": str}
    """
    import torch

    t0   = time.time()
    pipe = _load_flux(model_variant)

    generator = torch.Generator("cuda").manual_seed(seed)

    result = pipe(
        prompt=prompt,
        width=width,
        height=height,
        num_images_per_prompt=num_images,
        num_inference_steps=num_steps,
        guidance_scale=guidance_scale if model_variant == "dev" else 0.0,
        generator=generator,
    )

    images_b64 = [_img_to_b64(img) for img in result.images]
    elapsed    = round(time.time() - t0, 2)
    print(f"✓ Generated {len(images_b64)} image(s) in {elapsed}s")

    return {
        "images": images_b64,
        "time":   elapsed,
        "model":  f"flux-{model_variant}",
    }


@app.function(
    gpu="T4",
    image=image,
    volumes={"/model-cache": model_volume},
    timeout=300,
    memory=16384,
)
def generate_variation(
    source_b64: str,
    prompt: str,
    strength: float = 0.75,
    width: int = 768,
    height: int = 1344,
    num_images: int = 1,
    num_steps: int = 4,
    seed: int = 42,
    model_variant: str = "schnell",
) -> dict:
    """Image-to-image variation with Flux.

    Returns:
        {"images": [base64_png, ...], "time": float}
    """
    import torch

    t0     = time.time()
    source = _b64_to_img(source_b64).resize((width, height))
    pipe   = _load_flux_img2img(model_variant)

    generator = torch.Generator("cuda").manual_seed(seed)

    result = pipe(
        prompt=prompt,
        image=source,
        strength=strength,
        width=width,
        height=height,
        num_images_per_prompt=num_images,
        num_inference_steps=max(int(num_steps / strength), num_steps),
        guidance_scale=0.0,
        generator=generator,
    )

    images_b64 = [_img_to_b64(img) for img in result.images]
    elapsed    = round(time.time() - t0, 2)

    return {"images": images_b64, "time": elapsed}


@app.function(
    gpu="T4",
    image=image,
    volumes={"/model-cache": model_volume},
    timeout=600,
    memory=16384,
)
def tiktok_batch(
    subject_description: str,
    source_b64: str | None = None,
    theme_ids: list[int] | None = None,
    screen_ratio: str = "9:16",
    color: str = "none",
    num_images_per_theme: int = 1,
    strength: float = 0.75,
    seed: int = 42,
    continuity: bool = False,
    continuity_arc: str = "journey",
    model_variant: str = "schnell",
    num_steps: int = 4,
) -> dict:
    """Batch TikTok ad generation across multiple themes.

    Returns:
        {"results": [...], "total": int, "time": float}
    """
    import sys
    import torch

    # Add project src to path
    sys.path.insert(0, "/app")

    # Inline SCREEN_RATIOS and theme data (avoid importing full project)
    SCREEN_RATIOS = {
        "9:16":  {"width": 768,  "height": 1344},
        "4:3":   {"width": 1024, "height": 768},
        "1:1":   {"width": 1024, "height": 1024},
        "16:9":  {"width": 1344, "height": 768},
        "3:4":   {"width": 768,  "height": 1024},
    }

    ratio  = SCREEN_RATIOS.get(screen_ratio, SCREEN_RATIOS["9:16"])
    width  = ratio["width"]
    height = ratio["height"]

    if theme_ids is None:
        theme_ids = list(range(1, 31))

    t_start        = time.time()
    source         = _b64_to_img(source_b64).resize((width, height)) if source_b64 else None
    pipe_txt2img   = _load_flux(model_variant)
    pipe_img2img   = _load_flux_img2img(model_variant) if source else None

    results        = []
    previous_image = None
    total          = len(theme_ids)

    for idx, theme_id in enumerate(theme_ids):
        # Build prompt (simplified — full prompt engine in server.py)
        prompt = (
            f"commercial TikTok advertisement photo, theme {theme_id}, "
            f"{subject_description}, "
            f"ultra high resolution, professional commercial photography, "
            f"cinematic lighting, photorealistic, ad-ready aesthetic"
        )
        if color and color != "none":
            prompt += f", {color} color palette"

        current_source = previous_image if (continuity and previous_image) else source
        gen_strength   = strength * 0.85  if (continuity and previous_image) else strength

        t0        = time.time()
        generator = torch.Generator("cuda").manual_seed(seed + idx)

        if current_source and pipe_img2img:
            result = pipe_img2img(
                prompt=prompt,
                image=current_source,
                strength=gen_strength,
                width=width,
                height=height,
                num_images_per_prompt=num_images_per_theme,
                num_inference_steps=num_steps,
                guidance_scale=0.0,
                generator=generator,
            )
        else:
            result = pipe_txt2img(
                prompt=prompt,
                width=width,
                height=height,
                num_images_per_prompt=num_images_per_theme,
                num_inference_steps=num_steps,
                guidance_scale=0.0,
                generator=generator,
            )

        images = result.images
        if continuity and images:
            previous_image = images[0]

        elapsed = round(time.time() - t0, 2)
        results.append({
            "theme_id": theme_id,
            "theme":    f"Theme {theme_id}",
            "images":   [_img_to_b64(img) for img in images],
            "time":     elapsed,
        })
        print(f"  [{idx+1}/{total}] theme {theme_id} — {elapsed}s")

    return {
        "results": results,
        "total":   sum(len(r["images"]) for r in results),
        "time":    round(time.time() - t_start, 2),
    }


# ── CLI entry point (for modal run modal_app.py) ──────────────────

@app.local_entrypoint()
def main():
    """Quick test: generate 1 image."""
    print("Testing Geovera Modal deployment...")
    result = generate.remote(
        prompt="product photo of a coffee cup on a wooden table, professional studio lighting",
        width=768,
        height=1344,
        num_steps=4,
        seed=42,
    )
    print(f"✓ Generated {len(result['images'])} image(s) in {result['time']}s")
    print("Deployment test successful!")
