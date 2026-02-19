"""Geovera — Flask Inference Server

Runs as a background process on the GPU instance.
PyWorker (worker.py) proxies requests to this server.

Routes:
    GET  /health            — Health check
    POST /generate/sync     — Text-to-image
    POST /variation/sync    — Image-to-image variation
    POST /tiktok-ads/sync   — TikTok batch generation
"""

import argparse
import base64
import io
import logging
import os
import sys
import time
from pathlib import Path

from flask import Flask, jsonify, request
from PIL import Image

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("geovera-server")

# ── Globals ───────────────────────────────────────────────────────
_generator   = None
_model_ready = False
_load_error  = None

app = Flask(__name__)


# ── Model loading ──────────────────────────────────────────────────

def load_model(model_type="flux", model_variant="schnell", lora_path=None):
    global _generator, _model_ready, _load_error
    try:
        log.info(f"Loading model: {model_type}-{model_variant} ...")
        hf_token = os.environ.get("HF_TOKEN")
        if hf_token:
            os.environ["HF_TOKEN"] = hf_token
            os.environ["HUGGING_FACE_HUB_TOKEN"] = hf_token

        if model_type == "flux":
            from src.inference.flux_generate import FluxGenerator
            _generator = FluxGenerator(
                model_variant=model_variant,
                lora_path=lora_path or None,
            )
            _generator.load_pipeline(enable_img2img=True)
        else:
            from src.inference.img2img import ImageVariationGenerator
            _generator = ImageVariationGenerator("configs/inference_config.yaml")
            _generator.load_pipeline()

        _model_ready = True
        log.info(f"✓ Model ready: {model_type}-{model_variant}")

    except Exception as e:
        _load_error = str(e)
        log.error(f"✗ Model load failed: {e}")


# ── Helpers ────────────────────────────────────────────────────────

def img_to_b64(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def b64_to_img(b64: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


def require_model():
    if not _model_ready:
        msg = _load_error or "Model is still loading, please retry"
        return jsonify({"error": msg}), 503
    return None


# ── Routes ─────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status":      "ok" if _model_ready else "loading",
        "model_ready": _model_ready,
        "error":       _load_error,
    }), 200


@app.route("/generate/sync", methods=["POST"])
def generate():
    err = require_model()
    if err:
        return err
    data = request.get_json(force=True) or {}
    if not data.get("prompt"):
        return jsonify({"error": "prompt is required"}), 400
    try:
        t0     = time.time()
        images = _generator.generate(
            prompt=data["prompt"],
            width=data.get("width", 768),
            height=data.get("height", 1344),
            num_images=data.get("num_images", 1),
            guidance_scale=data.get("guidance_scale", 3.5),
            num_inference_steps=data.get("num_steps"),
            seed=data.get("seed"),
        )
        if not isinstance(images, list):
            images = [images]
        return jsonify({"images": [img_to_b64(i) for i in images], "time": round(time.time() - t0, 2)})
    except Exception as e:
        log.error(f"/generate error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/variation/sync", methods=["POST"])
def variation():
    err = require_model()
    if err:
        return err
    data = request.get_json(force=True) or {}
    if not data.get("source_image"):
        return jsonify({"error": "source_image (base64) required"}), 400
    if not data.get("prompt"):
        return jsonify({"error": "prompt is required"}), 400
    try:
        t0     = time.time()
        source = b64_to_img(data["source_image"])
        images = _generator.generate_variation(
            source_image=source,
            prompt=data["prompt"],
            strength=data.get("strength", 0.55),
            width=data.get("width", 768),
            height=data.get("height", 1344),
            num_images=data.get("num_images", 1),
            seed=data.get("seed"),
        )
        if not isinstance(images, list):
            images = [images]
        return jsonify({"images": [img_to_b64(i) for i in images], "time": round(time.time() - t0, 2)})
    except Exception as e:
        log.error(f"/variation error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/tiktok-ads/sync", methods=["POST"])
def tiktok_batch():
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
        source        = b64_to_img(data["source_image"]) if data.get("source_image") else None
        theme_ids     = data.get("theme_ids") or list(range(1, len(TIKTOK_AD_THEMES) + 1))
        screen_ratio  = data.get("screen_ratio", "9:16")
        color         = data.get("color", "none")
        num_per_theme = int(data.get("num_images_per_theme", 1))
        strength      = float(data.get("strength", 0.55))
        seed          = data.get("seed", 42)
        continuity    = bool(data.get("continuity", False))
        arc           = data.get("continuity_arc", "journey")
        subject       = data["subject_description"]

        ratio          = SCREEN_RATIOS.get(screen_ratio, SCREEN_RATIOS["9:16"])
        width, height  = ratio["width"], ratio["height"]
        total          = len(theme_ids)
        results        = []
        previous_image = None

        for idx, theme_id in enumerate(theme_ids):
            theme_data  = get_prompt(theme_id, subject, color=color, screen_ratio=screen_ratio)
            prompt_text = theme_data["prompt"]
            if continuity:
                prompt_text += get_continuity_modifier(idx, total, arc=arc)

            current_source = previous_image if (continuity and previous_image) else source
            gen_strength   = strength * 0.85 if (continuity and previous_image) else strength
            t0             = time.time()

            if current_source:
                images = _generator.generate_variation(
                    source_image=current_source, prompt=prompt_text,
                    strength=gen_strength, width=width, height=height,
                    num_images=num_per_theme, seed=seed,
                )
            else:
                images = _generator.generate(
                    prompt=prompt_text, width=width, height=height,
                    num_images=num_per_theme, seed=seed,
                )

            if not isinstance(images, list):
                images = [images]
            if continuity and images:
                previous_image = images[0]

            results.append({
                "theme_id": theme_id,
                "theme":    theme_data["theme"],
                "images":   [img_to_b64(i) for i in images],
                "time":     round(time.time() - t0, 2),
            })
            log.info(f"  [{idx+1}/{total}] {theme_data['theme']} — {results[-1]['time']}s")

        return jsonify({"results": results, "total": sum(len(r["images"]) for r in results)})

    except Exception as e:
        log.error(f"/tiktok-ads error: {e}")
        return jsonify({"error": str(e)}), 500


# ── Entry point ────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port",          type=int,  default=8188)
    parser.add_argument("--model-type",    type=str,  default="flux")
    parser.add_argument("--model-variant", type=str,  default="schnell")
    parser.add_argument("--lora-path",     type=str,  default=None)
    args = parser.parse_args()

    load_model(args.model_type, args.model_variant, args.lora_path or None)
    app.run(host="0.0.0.0", port=args.port, threaded=False)
