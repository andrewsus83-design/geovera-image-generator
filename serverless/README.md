# Vast.ai Serverless Deployment

## Quick Setup

### 1. On vast.ai Dashboard
- Go to https://cloud.vast.ai/serverless/
- Create an **Endpoint**
- Create a **Workergroup** (RTX 4090 recommended)
- Copy your **Endpoint URL** and **Serverless API Key**

### 2. Set Environment Variables
```bash
export VAST_ENDPOINT_URL=https://your-endpoint-url
export VAST_API_KEY=your_serverless_api_key
```

### 3. Run from Laptop (No GPU Needed!)
```bash
# TikTok ads via serverless
python scripts/run_pipeline.py tiktok-ads \
  --mode actor \
  --actor-source face.jpg \
  --gender female --ethnicity asian \
  --serverless

# With continuity
python scripts/run_pipeline.py tiktok-ads \
  --mode actor+prop \
  --actor-source face.jpg \
  --prop-source product.png --prop-desc "serum bottle" \
  --continuity --continuity-arc transformation \
  --serverless
```

## Cost Estimate (RTX 4090 @ $0.29/hr)

| Batch Size | Time | Cost |
|-----------|------|------|
| 30 themes x 1 img | ~7.5 min | ~$0.04 |
| 30 themes x 3 img | ~22.5 min | ~$0.11 |
| 10 themes x 1 img | ~2.5 min | ~$0.01 |

## Worker Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/health` | GET | Health check |
| `/generate/sync` | POST | Text-to-image |
| `/variation/sync` | POST | Image-to-image variation |
| `/tiktok-ads/sync` | POST | Full TikTok ad batch |
