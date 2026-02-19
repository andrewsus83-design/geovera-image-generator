# Geovera Image Generator

Consistent image generation pipeline using **Stable Diffusion XL + LoRA + ControlNet + IP-Adapter**, with **Gemini Vision** for smart image indexing and auto-captioning.

## Architecture

```
Raw Images → [Gemini Indexing & Captioning] → [Preprocessing] → [LoRA Training] → [Generation]
                                                                                      ↑
                                                                    ControlNet (structure) +
                                                                    IP-Adapter (face identity)
```

## Features

- **LoRA Fine-tuning** — Train on custom images for consistent style
- **ControlNet** — Maintain structural consistency with reference images
- **IP-Adapter** — Face identity preservation across generations
- **Gemini Integration** — Auto-caption, index, and quality-assess training images

## Setup

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Set API keys
export GEMINI_API_KEY="your_key_here"
```

## Usage

### 1. Prepare Training Data

Place images in `data/raw/`. Optionally add `.txt` caption files with the same name.

### 2. Auto-Caption with Gemini

```bash
python scripts/run_pipeline.py caption --image-dir data/raw --style detailed
```

### 3. Index Images

```bash
python scripts/run_pipeline.py index --image-dir data/raw
```

### 4. Preprocess

```bash
python scripts/run_pipeline.py preprocess --raw-dir data/raw --processed-dir data/processed
```

### 5. Train LoRA

```bash
python scripts/run_pipeline.py train --config configs/train_config.yaml
```

### 6. Generate Images

```bash
# Product generation (consistent with reference)
python scripts/run_pipeline.py generate \
  --prompt "a professional product photo of a sneaker" \
  --reference data/raw/sneaker.jpg \
  --conditioning-scale 0.6

# Face generation (identity-preserving)
python scripts/run_pipeline.py generate \
  --prompt "a professional headshot portrait" \
  --reference data/raw/pose.jpg \
  --face data/raw/face_ref.jpg
```

### Full Pipeline

```bash
python scripts/run_pipeline.py full --image-dir data/raw
```

## Project Structure

```
geovera-image-generator/
├── configs/
│   ├── train_config.yaml        # LoRA training config
│   └── inference_config.yaml    # Generation config
├── data/
│   ├── raw/                     # Raw training images
│   ├── processed/               # Preprocessed images
│   └── output/                  # Generated images
├── scripts/
│   └── run_pipeline.py          # Main CLI pipeline
├── src/
│   ├── training/
│   │   └── train_lora.py        # LoRA fine-tuning
│   ├── inference/
│   │   └── generate.py          # Image generation
│   └── utils/
│       ├── data_utils.py        # Dataset & preprocessing
│       ├── image_utils.py       # Image utilities
│       └── gemini_indexer.py    # Gemini integration
└── requirements.txt
```

## Configuration

### ControlNet Conditioning Scale

- `0.3-0.5` — Loose reference (more creative freedom)
- `0.5-0.7` — Balanced (recommended for products)
- `0.7-1.0` — Strict reference (very close to original structure)

### IP-Adapter Scale (Face)

- `0.4-0.6` — Soft resemblance
- `0.6-0.8` — Strong identity match
- `0.8-1.0` — Very strict face preservation

## Requirements

- Python 3.10+
- CUDA GPU with 12GB+ VRAM (for training) or Apple Silicon MPS
- Gemini API key (for indexing/captioning)
