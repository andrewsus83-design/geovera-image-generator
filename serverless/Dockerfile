# ── Geovera Image Generator — vast.ai Serverless Docker Image ──
# Base: PyTorch 2.1 + CUDA 12.1 (works on RTX 3090/4090/A100/H100)
FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

WORKDIR /app

# ── System dependencies ─────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    wget \
    curl \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

# ── Python dependencies ─────────────────────────────────────────
RUN pip install --no-cache-dir \
    diffusers>=0.27.0 \
    transformers>=4.38.0 \
    accelerate>=0.27.0 \
    safetensors>=0.4.2 \
    sentencepiece>=0.1.99 \
    Pillow>=10.0.0 \
    torch>=2.1.0 \
    torchvision>=0.16.0 \
    flask>=3.0.0 \
    requests>=2.31.0 \
    numpy>=1.24.0 \
    opencv-python-headless>=4.8.0 \
    huggingface_hub>=0.20.0 \
    vastai-sdk>=0.1.0

# ── Copy project source ─────────────────────────────────────────
COPY src/ ./src/
COPY configs/ ./configs/
COPY serverless/worker.py ./worker.py
COPY serverless/server.py ./server.py
COPY serverless/start.sh ./start.sh

RUN chmod +x start.sh

# ── Environment defaults ────────────────────────────────────────
ENV MODEL_TYPE=flux
ENV MODEL_VARIANT=schnell
ENV MODEL_SERVER_PORT=8188
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Pre-create HuggingFace cache dir
RUN mkdir -p /root/.cache/huggingface

EXPOSE 8188

# ── Startup: starts inference server + PyWorker ─────────────────
CMD ["./start.sh"]
