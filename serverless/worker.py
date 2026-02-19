"""Vast.ai Serverless PyWorker for Flux/SDXL image generation.

This worker runs on vast.ai GPU instances and handles incoming
image generation requests via HTTP endpoints.

Endpoints:
    POST /generate/sync     — Text-to-image generation
    POST /variation/sync    — Image-to-image variation
    POST /tiktok-ads/sync   — Full TikTok ad batch generation
    GET  /health            — Health check
"""

import base64
import io
import json
import os
import time
from pathlib import Path

import torch
from PIL import Image

# Determine which model to load from environment
MODEL_VARIANT = os.environ.get("MODEL_VARIANT", "dev")  # dev or schnell
MODEL_TYPE = os.environ.get("MODEL_TYPE", "flux")  # flux or sdxl
LORA_PATH = os.environ.get("LORA_PATH", None)

# Global pipeline (loaded once at startup)
_generator = None


def get_generator():
    """Lazy-load the generator pipeline."""
    global _generator
    if _generator is not None:
        return _generator

    if MODEL_TYPE == "flux":
        from src.inference.flux_generate import FluxGenerator
        _generator = FluxGenerator(model_variant=MODEL_VARIANT, lora_path=LORA_PATH)
        _generator.load_pipeline(enable_img2img=True)
    else:
        from src.inference.img2img import ImageVariationGenerator
        _generator = ImageVariationGenerator("configs/inference_config.yaml")
        _generator.load_pipeline()

    return _generator


def image_to_base64(img):
    """Convert PIL Image to base64 string."""
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def base64_to_image(b64_string):
    """Convert base64 string to PIL Image."""
    data = base64.b64decode(b64_string)
    return Image.open(io.BytesIO(data)).convert("RGB")


def handle_generate(payload):
    """Handle text-to-image generation request.

    Payload:
        prompt: str
        width: int (default 768)
        height: int (default 1344)
        num_images: int (default 1)
        guidance_scale: float (default 3.5)
        num_inference_steps: int (default None = auto)
        seed: int (default None)

    Returns:
        {"images": [base64_string, ...], "time": float}
    """
    gen = get_generator()
    start = time.time()

    if MODEL_TYPE == "flux":
        images = gen.generate(
            prompt=payload["prompt"],
            width=payload.get("width", 768),
            height=payload.get("height", 1344),
            num_images=payload.get("num_images", 1),
            guidance_scale=payload.get("guidance_scale", 3.5),
            num_inference_steps=payload.get("num_inference_steps"),
            seed=payload.get("seed"),
        )
    else:
        from src.inference.generate import ImageGenerator
        txt2img = ImageGenerator("configs/inference_config.yaml")
        txt2img.load_pipeline()
        images = txt2img.generate(
            prompt=payload["prompt"],
            num_images=payload.get("num_images", 1),
            seed=payload.get("seed"),
        )

    elapsed = time.time() - start
    return {
        "images": [image_to_base64(img) for img in images],
        "time": round(elapsed, 2),
        "model": f"{MODEL_TYPE}-{MODEL_VARIANT}",
    }


def handle_variation(payload):
    """Handle image-to-image variation request.

    Payload:
        source_image: base64 string
        prompt: str
        strength: float (default 0.55)
        width: int (default 768)
        height: int (default 1344)
        num_images: int (default 1)
        seed: int (default None)

    Returns:
        {"images": [base64_string, ...], "time": float}
    """
    gen = get_generator()
    start = time.time()

    source = base64_to_image(payload["source_image"])

    if MODEL_TYPE == "flux":
        images = gen.generate_variation(
            source_image=source,
            prompt=payload["prompt"],
            strength=payload.get("strength", 0.55),
            width=payload.get("width", 768),
            height=payload.get("height", 1344),
            num_images=payload.get("num_images", 1),
            seed=payload.get("seed"),
        )
    else:
        images = gen.generate_variations(
            source_image=source,
            prompt=payload["prompt"],
            strength=payload.get("strength", 0.55),
            num_variations=payload.get("num_images", 1),
            seed=payload.get("seed"),
        )

    if not isinstance(images, list):
        images = [images]

    elapsed = time.time() - start
    return {
        "images": [image_to_base64(img) for img in images],
        "time": round(elapsed, 2),
        "model": f"{MODEL_TYPE}-{MODEL_VARIANT}",
    }


def handle_tiktok_batch(payload):
    """Handle batch TikTok ad generation.

    Payload:
        source_image: base64 string (optional, None for text-to-image)
        subject_description: str
        theme_ids: list[int] (default all 30)
        screen_ratio: str (default "9:16")
        color: str (default "none")
        num_images_per_theme: int (default 1)
        strength: float (default 0.55)
        seed: int (default 42)
        continuity: bool (default false)
        continuity_arc: str (default "journey")

    Returns:
        {"results": [{"theme_id": int, "theme": str, "images": [base64], "time": float}, ...]}
    """
    from src.utils.tiktok_prompts import get_prompt, get_continuity_modifier, SCREEN_RATIOS, TIKTOK_AD_THEMES

    gen = get_generator()

    source = None
    if payload.get("source_image"):
        source = base64_to_image(payload["source_image"])

    theme_ids = payload.get("theme_ids") or list(range(1, len(TIKTOK_AD_THEMES) + 1))
    screen_ratio = payload.get("screen_ratio", "9:16")
    color = payload.get("color", "none")
    num_per_theme = payload.get("num_images_per_theme", 1)
    strength = payload.get("strength", 0.55)
    seed = payload.get("seed", 42)
    continuity = payload.get("continuity", False)
    continuity_arc = payload.get("continuity_arc", "journey")
    subject = payload["subject_description"]

    ratio_data = SCREEN_RATIOS.get(screen_ratio, SCREEN_RATIOS["9:16"])
    width, height = ratio_data["width"], ratio_data["height"]

    results = []
    total = len(theme_ids)
    previous_image = None

    for idx, theme_id in enumerate(theme_ids):
        theme_data = get_prompt(theme_id, subject, color=color, screen_ratio=screen_ratio)
        prompt_text = theme_data["prompt"]

        if continuity:
            prompt_text += get_continuity_modifier(idx, total, arc=continuity_arc)

        start = time.time()

        current_source = previous_image if (continuity and previous_image is not None) else source
        gen_strength = strength * 0.85 if (continuity and previous_image is not None) else strength

        if current_source and MODEL_TYPE == "flux":
            images = gen.generate_variation(
                source_image=current_source,
                prompt=prompt_text,
                strength=gen_strength,
                width=width,
                height=height,
                num_images=num_per_theme,
                seed=seed,
            )
        elif current_source:
            images = gen.generate_variations(
                source_image=current_source,
                prompt=prompt_text,
                strength=gen_strength,
                num_variations=num_per_theme,
                seed=seed,
            )
        else:
            images = gen.generate(
                prompt=prompt_text,
                width=width,
                height=height,
                num_images=num_per_theme,
                seed=seed,
            )

        if not isinstance(images, list):
            images = [images]

        if continuity and images:
            previous_image = images[0]

        elapsed = time.time() - start
        results.append({
            "theme_id": theme_id,
            "theme": theme_data["theme"],
            "images": [image_to_base64(img) for img in images],
            "time": round(elapsed, 2),
        })

    return {"results": results, "model": f"{MODEL_TYPE}-{MODEL_VARIANT}"}


# ── Vast.ai PyWorker Setup ────────────────────────────────────

def create_worker():
    """Create and configure the vast.ai PyWorker."""
    try:
        from vastai import Worker, WorkerConfig, HandlerConfig, BenchmarkConfig
    except ImportError:
        # Fallback: run as simple Flask server for testing
        return create_flask_fallback()

    def calc_generate_workload(payload):
        """Estimate workload units for autoscaling."""
        steps = payload.get("num_inference_steps", 50)
        n_images = payload.get("num_images", 1)
        return steps * n_images

    def calc_variation_workload(payload):
        steps = payload.get("num_inference_steps", 50)
        n_images = payload.get("num_images", 1)
        return steps * n_images

    def calc_batch_workload(payload):
        n_themes = len(payload.get("theme_ids", list(range(1, 31))))
        n_per = payload.get("num_images_per_theme", 1)
        return n_themes * n_per * 50

    worker_config = WorkerConfig(
        model_server_url="http://127.0.0.1",
        model_server_port=18000,
        handlers=[
            HandlerConfig(
                route="/generate/sync",
                allow_parallel_requests=False,
                workload_calculator=calc_generate_workload,
            ),
            HandlerConfig(
                route="/variation/sync",
                allow_parallel_requests=False,
                workload_calculator=calc_variation_workload,
            ),
            HandlerConfig(
                route="/tiktok-ads/sync",
                allow_parallel_requests=False,
                workload_calculator=calc_batch_workload,
            ),
        ],
    )

    return Worker(worker_config)


def create_flask_fallback():
    """Simple Flask server for local testing without vast.ai SDK."""
    from flask import Flask, request, jsonify

    app = Flask(__name__)

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok", "model": f"{MODEL_TYPE}-{MODEL_VARIANT}"})

    @app.route("/generate/sync", methods=["POST"])
    def generate():
        return jsonify(handle_generate(request.json))

    @app.route("/variation/sync", methods=["POST"])
    def variation():
        return jsonify(handle_variation(request.json))

    @app.route("/tiktok-ads/sync", methods=["POST"])
    def tiktok_batch():
        return jsonify(handle_tiktok_batch(request.json))

    return app


if __name__ == "__main__":
    worker = create_worker()

    if hasattr(worker, "run"):
        # Vast.ai PyWorker
        worker.run()
    else:
        # Flask fallback for local testing
        port = int(os.environ.get("PORT", 8000))
        print(f"Starting Flask server on port {port}...")
        worker.run(host="0.0.0.0", port=port)
