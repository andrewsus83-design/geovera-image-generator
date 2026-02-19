# Geovera — vast.ai Serverless Deployment Guide

## Cara Deploy ke vast.ai (Step-by-Step)

---

### STEP 1 — Buat akun Docker Hub

Daftar gratis di https://hub.docker.com
Username kamu akan dipakai sebagai nama image, misal: `andrewsus83`

---

### STEP 2 — Build & Push Docker Image

Dari terminal di folder root project:

```bash
# Masuk ke folder root project
cd /path/to/image-generator

# Login ke Docker Hub
docker login

# Build image (jalankan dari ROOT project, bukan dari folder serverless/)
docker build -f serverless/Dockerfile -t geoverastaging/geovera-flux:latest .

# Push ke Docker Hub
docker push geoverastaging/geovera-flux:latest
```

> **Penting:** Ganti `andrewsus83` dengan username Docker Hub kamu

---

### STEP 3 — Buat Workergroup baru di vast.ai

1. Buka: https://console.vast.ai/console/workers/
2. Klik **"New Workergroup"** (atau edit yang sudah ada: Workergroup-17326)
3. Isi form:

| Field | Value |
|-------|-------|
| **Docker Image** | `geoverastaging/geovera-flux:latest` |
| **Launch Mode** | `ssh` |

4. Klik **"Environment Variables"** → tambahkan:

| Key | Value | Keterangan |
|-----|-------|------------|
| `MODEL_TYPE` | `flux` | Pakai Flux model |
| `MODEL_VARIANT` | `schnell` | `schnell` cepat, `dev` kualitas terbaik |
| `PORT` | `8080` | Port HTTP server |
| `HF_TOKEN` | `hf_xxxx...` | HuggingFace token (wajib untuk flux-dev) |

5. Klik **"Ports"** → expose port `8080`

6. Klik **"Save"**

---

### STEP 4 — Scale Up / Aktifkan Worker

1. Di halaman Workergroup → klik **"Scale"** atau **"Add Worker"**
2. Pilih GPU:
   - Budget: RTX 3090 (~$0.13/hr)
   - Recommended: RTX 4090 (~$0.29/hr)
   - Premium: A100 80GB (~$1.65/hr)
3. Tunggu status: `0/1 Active` → `1/1 Active`
4. Proses startup ~5-10 menit (download model weights ~14GB)

---

### STEP 5 — Dapat Endpoint URL

Setelah worker **Active**:

1. Klik Workergroup kamu
2. Klik tab **"Instances"** atau **"Endpoints"**
3. Copy URL yang formatnya:
   ```
   https://XXXXXXXX.proxy.vast.ai:PORT
   ```
4. Masukkan ke UI: **Settings → vast.ai Endpoint URL**

---

### STEP 6 — Test Connection

```bash
curl https://XXXXXXXX.proxy.vast.ai:PORT/health
# Response: {"model":"flux-schnell","model_ready":true,"status":"ok"}
```

Atau pakai UI: **GPU & Serverless → Test Connection**

---

## Perbandingan GPU

| GPU | VRAM | $/hr | flux-schnell | flux-dev |
|-----|------|------|-------------|----------|
| RTX 3090 | 24GB | $0.13 | ~5s/img | ~25s/img |
| RTX 4090 | 24GB | $0.29 | ~3s/img | ~15s/img |
| A100 80GB | 80GB | $1.65 | ~2s/img | ~10s/img |
| H100 SXM | 80GB | $1.65 | ~1.5s/img | ~8s/img |

---

## HuggingFace Token (untuk Flux-dev)

Flux.1-dev adalah **gated model** — perlu accept license:

1. Buka: https://huggingface.co/black-forest-labs/FLUX.1-dev
2. Klik **"Access repository"** → accept license
3. Buka: https://huggingface.co/settings/tokens → **New token (Read)**
4. Copy token → set sebagai env var `HF_TOKEN` di vast.ai

> Flux.1-schnell **TIDAK perlu token** — mulai dari sini untuk testing

---

## Endpoints Worker

| Method | Path | Deskripsi |
|--------|------|-----------|
| `GET`  | `/health` | Status model |
| `POST` | `/generate/sync` | Text-to-image |
| `POST` | `/variation/sync` | Image-to-image |
| `POST` | `/tiktok-ads/sync` | Batch 30 theme ads |

---

## CLI (tanpa GPU lokal)

```bash
# Generate TikTok ads via serverless
python scripts/run_pipeline.py tiktok-ads \
  --mode actor+prop \
  --actor-source face.jpg \
  --prop-source product.png --prop-desc "serum bottle" \
  --serverless \
  --vast-endpoint https://XXXXX.proxy.vast.ai:PORT \
  --gpu rtx4090

# Lihat pilihan GPU
python scripts/run_pipeline.py vast-gpus
```

---

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| Worker tidak aktif | Pastikan Docker image sudah di-push ke Docker Hub |
| 503 saat dipanggil | Normal — model masih loading (~5-10 menit pertama) |
| 401 Gated model | Set `HF_TOKEN` dan accept license di HuggingFace |
| Out of memory | Ganti GPU VRAM lebih besar, atau pakai `MODEL_VARIANT=schnell` |
