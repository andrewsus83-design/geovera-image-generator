"""Geovera — vast.ai Serverless Worker (Flask HTTP Server)

Endpoints:
    GET  /health               — Health check + model status
    POST /generate/sync        — Text-to-image
    POST /variation/sync       — Image-to-image variation
    POST /tiktok-ads/sync      — Full TikTok ad batch

Environment variables:
    MODEL_TYPE     flux | sdxl          (default: flux)
    MODEL_VARIANT  dev  | schnell       (default: schnell)
    LORA_PATH      path to LoRA weights (optional)
    PORT           HTTP port            (default: 8080)
    HF_TOKEN       HuggingFace token    (required for flux-dev)
"""

import base64
import io
import json
import logging
import os
import sys
import time
from pathlib import Path

from flask import Flask, jsonify, request
from PIL import Image

# ── Logging ──────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("geovera-worker")

# ── Config from environment ───────────────────────────────────────
MODEL_TYPE    = os.environ.get("MODEL_TYPE", "flux")
MODEL_VARIANT = os.environ.get("MODEL_VARIANT", "schnell")
LORA_PATH     = os.environ.get("LORA_PATH", None)
PORT          = int(os.environ.get("PORT", 8080))
HF_TOKEN      = os.environ.get("HF_TOKEN", None)

# ── Global pipeline (loaded once at startup) ──────────────────────
_generator   = None
_model_ready = False
_load_error  = None

app = Flask(__name__)


# ── Model loading ─────────────────────────────────────────────────

def load_model():
    """Load model pipeline at startup. Called once before serving."""
    global _generator, _model_ready, _load_error

    try:
        log.info(f"Loading model: {MODEL_TYPE}-{MODEL_VARIANT} ...")

        if HF_TOKEN:
            # Set token for gated models (flux-dev requires HF token)
            os.environ["HF_TOKEN"] = HF_TOKEN
            os.environ["HUGGING_FACE_HUB_TOKEN"] = HF_TOKEN

        if MODEL_TYPE == "flux":
            from src.inference.flux_generate import FluxGenerator
            _generator = FluxGenerator(
                model_variant=MODEL_VARIANT,
                lora_path=LORA_PATH,
            )
            _generator.load_pipeline(enable_img2img=True)
        else:
            from src.inference.img2img import ImageVariationGenerator
            _generator = ImageVariationGenerator("configs/inference_config.yaml")
            _generator.load_pipeline()

        _model_ready = True
        log.info(f"✓ Model ready: {MODEL_TYPE}-{MODEL_VARIANT}")

    except Exception as e:
        _load_error = str(e)
        log.error(f"✗ Model load failed: {e}")


# ── Helpers ───────────────────────────────────────────────────────

def img_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def b64_to_img(b64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


def require_model():
    """Return error response if model not ready, else None."""
    if not _model_ready:
        msg = _load_error or "Model is still loading, please retry in a moment"
        return jsonify({"error": msg}), 503
    return None


# ── Routes ────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok" if _model_ready else "loading",
        "model": f"{MODEL_TYPE}-{MODEL_VARIANT}",
        "model_ready": _model_ready,
        "error": _load_error,
    }), 200


@app.route("/generate/sync", methods=["POST"])
def generate():
    """Text-to-image generation.

    Body JSON:
        prompt         str   required
        width          int   default 768
        height         int   default 1344
        num_images     int   default 1
        guidance_scale float default 3.5
        num_steps      int   default None (auto)
        seed           int   default None
    """
    err = require_model()
    if err:
        return err

    data = request.get_json(force=True) or {}
    if not data.get("prompt"):
        return jsonify({"error": "prompt is required"}), 400

    try:
        t0 = time.time()

        if MODEL_TYPE == "flux":
            images = _generator.generate(
                prompt=data["prompt"],
                width=data.get("width", 768),
                height=data.get("height", 1344),
                num_images=data.get("num_images", 1),
                guidance_scale=data.get("guidance_scale", 3.5),
                num_inference_steps=data.get("num_steps"),
                seed=data.get("seed"),
            )
        else:
            from src.inference.generate import ImageGenerator
            gen2 = ImageGenerator("configs/inference_config.yaml")
            gen2.load_pipeline()
            images = gen2.generate(
                prompt=data["prompt"],
                num_images=data.get("num_images", 1),
                seed=data.get("seed"),
            )

        if not isinstance(images, list):
            images = [images]

        return jsonify({
            "images": [img_to_b64(img) for img in images],
            "time":   round(time.time() - t0, 2),
            "model":  f"{MODEL_TYPE}-{MODEL_VARIANT}",
        })

    except Exception as e:
        log.error(f"/generate error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/variation/sync", methods=["POST"])
def variation():
    """Image-to-image variation.

    Body JSON:
        source_image   str   base64 PNG/JPG  required
        prompt         str   required
        strength       float default 0.55
        width          int   default 768
        height         int   default 1344
        num_images     int   default 1
        seed           int   default None
    """
    err = require_model()
    if err:
        return err

    data = request.get_json(force=True) or {}
    if not data.get("source_image"):
        return jsonify({"error": "source_image (base64) is required"}), 400
    if not data.get("prompt"):
        return jsonify({"error": "prompt is required"}), 400

    try:
        t0     = time.time()
        source = b64_to_img(data["source_image"])

        if MODEL_TYPE == "flux":
            images = _generator.generate_variation(
                source_image=source,
                prompt=data["prompt"],
                strength=data.get("strength", 0.55),
                width=data.get("width", 768),
                height=data.get("height", 1344),
                num_images=data.get("num_images", 1),
                seed=data.get("seed"),
            )
        else:
            images = _generator.generate_variations(
                source_image=source,
                prompt=data["prompt"],
                strength=data.get("strength", 0.55),
                num_variations=data.get("num_images", 1),
                seed=data.get("seed"),
            )

        if not isinstance(images, list):
            images = [images]

        return jsonify({
            "images": [img_to_b64(img) for img in images],
            "time":   round(time.time() - t0, 2),
            "model":  f"{MODEL_TYPE}-{MODEL_VARIANT}",
        })

    except Exception as e:
        log.error(f"/variation error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/tiktok-ads/sync", methods=["POST"])
def tiktok_batch():
    """Full TikTok ad batch generation across multiple themes.

    Body JSON:
        subject_description    str        required
        source_image           str|null   base64, optional
        theme_ids              list[int]  default: all 30
        screen_ratio           str        default "9:16"
        color                  str        default "none"
        num_images_per_theme   int        default 1
        strength               float      default 0.55
        seed                   int        default 42
        continuity             bool       default false
        continuity_arc         str        default "journey"
    """
    err = require_model()
    if err:
        return err

    data = request.get_json(force=True) or {}
    if not data.get("subject_description"):
        return jsonify({"error": "subject_description is required"}), 400

    try:
        from src.utils.tiktok_prompts import (
            get_prompt, get_continuity_modifier,
            SCREEN_RATIOS, TIKTOK_AD_THEMES,
        )

        source = b64_to_img(data["source_image"]) if data.get("source_image") else None

        theme_ids     = data.get("theme_ids") or list(range(1, len(TIKTOK_AD_THEMES) + 1))
        screen_ratio  = data.get("screen_ratio", "9:16")
        color         = data.get("color", "none")
        num_per_theme = int(data.get("num_images_per_theme", 1))
        strength      = float(data.get("strength", 0.55))
        seed          = data.get("seed", 42)
        continuity    = bool(data.get("continuity", False))
        arc           = data.get("continuity_arc", "journey")
        subject       = data["subject_description"]

        ratio   = SCREEN_RATIOS.get(screen_ratio, SCREEN_RATIOS["9:16"])
        width   = ratio["width"]
        height  = ratio["height"]
        total   = len(theme_ids)

        results        = []
        previous_image = None

        for idx, theme_id in enumerate(theme_ids):
            theme_data  = get_prompt(theme_id, subject, color=color, screen_ratio=screen_ratio)
            prompt_text = theme_data["prompt"]

            if continuity:
                prompt_text += get_continuity_modifier(idx, total, arc=arc)

            current_source = previous_image if (continuity and previous_image) else source
            gen_strength   = strength * 0.85 if (continuity and previous_image) else strength

            t0 = time.time()

            if current_source and MODEL_TYPE == "flux":
                images = _generator.generate_variation(
                    source_image=current_source,
                    prompt=prompt_text,
                    strength=gen_strength,
                    width=width, height=height,
                    num_images=num_per_theme,
                    seed=seed,
                )
            elif current_source:
                images = _generator.generate_variations(
                    source_image=current_source,
                    prompt=prompt_text,
                    strength=gen_strength,
                    num_variations=num_per_theme,
                    seed=seed,
                )
            else:
                images = _generator.generate(
                    prompt=prompt_text,
                    width=width, height=height,
                    num_images=num_per_theme,
                    seed=seed,
                )

            if not isinstance(images, list):
                images = [images]

            if continuity and images:
                previous_image = images[0]

            results.append({
                "theme_id": theme_id,
                "theme":    theme_data["theme"],
                "images":   [img_to_b64(img) for img in images],
                "time":     round(time.time() - t0, 2),
            })

            log.info(f"  [{idx+1}/{total}] {theme_data['theme']} — {results[-1]['time']}s")

        return jsonify({
            "results": results,
            "total":   sum(len(r["images"]) for r in results),
            "model":   f"{MODEL_TYPE}-{MODEL_VARIANT}",
        })

    except Exception as e:
        log.error(f"/tiktok-ads error: {e}")
        return jsonify({"error": str(e)}), 500


# ── Startup ───────────────────────────────────────────────────────

if __name__ == "__main__":
    log.info(f"Geovera Worker starting — {MODEL_TYPE}-{MODEL_VARIANT} on port {PORT}")

    # Load model BEFORE accepting requests
    load_model()

    if not _model_ready:
        log.warning("Model failed to load — server will return 503 until model is ready")

    app.run(host="0.0.0.0", port=PORT, threaded=False)
