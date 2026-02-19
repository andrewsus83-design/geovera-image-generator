FROM pytorch/pytorch:2.1.0-cuda12.1-cudnn8-runtime

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y \
    git \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install flask vastai-sdk

# Copy project
COPY . .

# Environment defaults
ENV MODEL_TYPE=flux
ENV MODEL_VARIANT=dev
ENV PORT=8000

EXPOSE 8000

CMD ["python", "serverless/worker.py"]
