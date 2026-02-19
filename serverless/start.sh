#!/bin/bash
# ── Geovera Worker Startup Script ──────────────────────────────
# Runs on vast.ai GPU instance.
# 1. Authenticates HuggingFace (if HF_TOKEN set)
# 2. Pre-downloads model to cache
# 3. Starts Flask HTTP server on $PORT
# ───────────────────────────────────────────────────────────────

set -e

MODEL_TYPE="${MODEL_TYPE:-flux}"
MODEL_VARIANT="${MODEL_VARIANT:-schnell}"
PORT="${PORT:-8080}"

echo "======================================================"
echo "  Geovera Worker — ${MODEL_TYPE}-${MODEL_VARIANT}"
echo "  Port: ${PORT}"
echo "======================================================"

# ── 1. HuggingFace login (needed for flux-dev gated model) ──────
if [ -n "$HF_TOKEN" ]; then
    echo "[startup] Logging in to HuggingFace..."
    huggingface-cli login --token "$HF_TOKEN" --add-to-git-credential 2>/dev/null || true
    export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"
fi

# ── 2. Pre-download model weights ──────────────────────────────
echo "[startup] Pre-downloading model weights..."
python - <<'PYEOF'
import os, sys

model_type    = os.environ.get("MODEL_TYPE", "flux")
model_variant = os.environ.get("MODEL_VARIANT", "schnell")
hf_token      = os.environ.get("HF_TOKEN")

try:
    if model_type == "flux":
        from diffusers import FluxPipeline
        model_id = (
            "black-forest-labs/FLUX.1-schnell"
            if model_variant == "schnell"
            else "black-forest-labs/FLUX.1-dev"
        )
        print(f"[startup] Downloading {model_id} ...")
        FluxPipeline.from_pretrained(
            model_id,
            torch_dtype=__import__("torch").bfloat16,
            token=hf_token,
        )
        print(f"[startup] ✓ Model cached: {model_id}")
    else:
        from diffusers import StableDiffusionXLImg2ImgPipeline
        model_id = "stabilityai/stable-diffusion-xl-base-1.0"
        print(f"[startup] Downloading {model_id} ...")
        StableDiffusionXLImg2ImgPipeline.from_pretrained(
            model_id,
            torch_dtype=__import__("torch").float16,
        )
        print(f"[startup] ✓ Model cached: {model_id}")
except Exception as e:
    print(f"[startup] WARNING: Model pre-download failed: {e}", file=sys.stderr)
    print("[startup] Worker will attempt to download on first request.", file=sys.stderr)
PYEOF

# ── 3. Start Flask server ───────────────────────────────────────
echo "[startup] Starting Flask server on port ${PORT}..."
exec python worker.py
