#!/bin/bash
set -e
export PYTHONPATH=/app

MODEL_TYPE="${MODEL_TYPE:-flux}"
MODEL_VARIANT="${MODEL_VARIANT:-schnell}"
MODEL_SERVER_PORT="${MODEL_SERVER_PORT:-8188}"

echo "======================================================"
echo "  Geovera Worker — ${MODEL_TYPE}-${MODEL_VARIANT}"
echo "  Inference server port: ${MODEL_SERVER_PORT}"
echo "======================================================"

# 1. HuggingFace login (needed for flux-dev gated model)
if [ -n "$HF_TOKEN" ]; then
    echo "[startup] Logging in to HuggingFace..."
    huggingface-cli login --token "$HF_TOKEN" --add-to-git-credential 2>/dev/null || true
    export HUGGING_FACE_HUB_TOKEN="$HF_TOKEN"
fi

# 2. Start Flask inference server in background, logging to file
echo "[startup] Starting inference server on port ${MODEL_SERVER_PORT}..."
python /app/server.py \
    --port "${MODEL_SERVER_PORT}" \
    --model-type "${MODEL_TYPE}" \
    --model-variant "${MODEL_VARIANT}" \
    --lora-path "${LORA_PATH:-}" \
    2>&1 | tee /tmp/geovera-server.log &

# 3. Wait for inference server to be ready (max 10 min)
echo "[startup] Waiting for inference server to be ready..."
for i in $(seq 1 120); do
    if curl -sf "http://127.0.0.1:${MODEL_SERVER_PORT}/health" > /dev/null 2>&1; then
        echo "[startup] ✓ Inference server is ready!"
        break
    fi
    sleep 5
    echo "[startup] ... waiting ($i/120)"
done

# 4. Start PyWorker (vast.ai SDK - handles routing + autoscaling)
echo "[startup] Starting PyWorker..."
exec python /app/worker.py
