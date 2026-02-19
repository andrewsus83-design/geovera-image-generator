"""Geovera — vast.ai Serverless Worker

Uses the official vastai SDK (Worker + WorkerConfig + HandlerConfig).
The PyWorker proxies requests to the local Flask inference server
running on MODEL_SERVER_PORT.

Environment variables:
    MODEL_TYPE       flux | sdxl           (default: flux)
    MODEL_VARIANT    dev  | schnell        (default: schnell)
    LORA_PATH        path to LoRA weights  (optional)
    MODEL_SERVER_PORT  port of local inference server (default: 8188)
    HF_TOKEN         HuggingFace token     (required for flux-dev)
"""

import os
from vastai_sdk import Worker, WorkerConfig, HandlerConfig, BenchmarkConfig, LogActionConfig

# ── Config ────────────────────────────────────────────────────────
MODEL_SERVER_PORT = int(os.environ.get("MODEL_SERVER_PORT", 8188))
MODEL_TYPE        = os.environ.get("MODEL_TYPE", "flux")
MODEL_VARIANT     = os.environ.get("MODEL_VARIANT", "schnell")

# ── Workload calculator ───────────────────────────────────────────
def calc_workload(payload: dict) -> float:
    """Estimate compute cost from request payload."""
    num_images  = int(payload.get("num_images", 1))
    num_themes  = len(payload.get("theme_ids", [1]))
    num_steps   = int(payload.get("num_steps", 20))
    return float(num_images * max(num_themes, 1) * num_steps)


def calc_workload_tiktok(payload: dict) -> float:
    theme_ids  = payload.get("theme_ids") or list(range(1, 31))
    num_per    = int(payload.get("num_images_per_theme", 1))
    num_steps  = int(payload.get("num_steps", 20))
    return float(len(theme_ids) * num_per * num_steps)


# ── Log action config — detect when model server is ready ─────────
log_config = LogActionConfig(
    on_load=["Model ready", "✓ Model ready", "* Running on"],
    on_error=["Model load failed", "✗ Model load failed", "CUDA out of memory"],
    on_info=["Loading model", "Downloading"],
)

# ── Benchmark config ──────────────────────────────────────────────
benchmark_cfg = BenchmarkConfig(
    generator=lambda: [
        {
            "prompt": "product photo of a coffee cup on a wooden table, bright studio lighting",
            "width": 768,
            "height": 1344,
            "num_images": 1,
            "num_steps": 4,
        }
    ],
    runs=1,
    concurrency=1,
)

# ── Handler configs ───────────────────────────────────────────────
generate_handler = HandlerConfig(
    route="/generate/sync",
    allow_parallel_requests=False,
    max_queue_time=120,
    workload_calculator=calc_workload,
    benchmark_config=benchmark_cfg,
)

variation_handler = HandlerConfig(
    route="/variation/sync",
    allow_parallel_requests=False,
    max_queue_time=120,
    workload_calculator=calc_workload,
)

tiktok_handler = HandlerConfig(
    route="/tiktok-ads/sync",
    allow_parallel_requests=False,
    max_queue_time=600,
    workload_calculator=calc_workload_tiktok,
)

# ── Worker config ─────────────────────────────────────────────────
worker_config = WorkerConfig(
    model_server_url="http://127.0.0.1",
    model_server_port=MODEL_SERVER_PORT,
    model_log_file="/tmp/geovera-server.log",
    handlers=[generate_handler, variation_handler, tiktok_handler],
    log_action_config=log_config,
)

# ── Start worker ──────────────────────────────────────────────────
if __name__ == "__main__":
    Worker(worker_config).run()
