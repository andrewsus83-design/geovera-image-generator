"""GPU selection and cost estimation for vast.ai serverless.

Helps users pick the right GPU tier based on budget and speed needs.
"""

# All supported GPUs with specs
GPU_CATALOG = {
    # ── Budget tier ───────────────────────────────────────────
    "rtx3090": {
        "name": "RTX 3090",
        "vram_gb": 24,
        "price_hr": 0.13,
        "tier": "budget",
        "flux_dev_s": 25,       # seconds per image (Flux.1-dev)
        "flux_schnell_s": 5,    # seconds per image (Flux.1-schnell)
        "sdxl_s": 8,
        "min_vram_flux_dev": True,
        "min_vram_flux_schnell": True,
        "min_vram_sdxl": True,
    },
    "rtx3090ti": {
        "name": "RTX 3090 Ti",
        "vram_gb": 24,
        "price_hr": 0.18,
        "tier": "budget",
        "flux_dev_s": 22,
        "flux_schnell_s": 4,
        "sdxl_s": 7,
        "min_vram_flux_dev": True,
        "min_vram_flux_schnell": True,
        "min_vram_sdxl": True,
    },
    "rtx4080": {
        "name": "RTX 4080",
        "vram_gb": 16,
        "price_hr": 0.20,
        "tier": "mid",
        "flux_dev_s": 20,
        "flux_schnell_s": 4,
        "sdxl_s": 6,
        "min_vram_flux_dev": False,   # 16GB is borderline for Flux dev (needs offload)
        "min_vram_flux_schnell": True,
        "min_vram_sdxl": True,
    },
    "rtx4090": {
        "name": "RTX 4090",
        "vram_gb": 24,
        "price_hr": 0.29,
        "tier": "mid",
        "flux_dev_s": 15,
        "flux_schnell_s": 3,
        "sdxl_s": 5,
        "min_vram_flux_dev": True,
        "min_vram_flux_schnell": True,
        "min_vram_sdxl": True,
    },
    "rtx5090": {
        "name": "RTX 5090",
        "vram_gb": 32,
        "price_hr": 0.37,
        "tier": "mid",
        "flux_dev_s": 12,
        "flux_schnell_s": 2,
        "sdxl_s": 4,
        "min_vram_flux_dev": True,
        "min_vram_flux_schnell": True,
        "min_vram_sdxl": True,
    },
    "a100": {
        "name": "A100 80GB",
        "vram_gb": 80,
        "price_hr": 1.65,
        "tier": "high",
        "flux_dev_s": 10,
        "flux_schnell_s": 2,
        "sdxl_s": 3,
        "min_vram_flux_dev": True,
        "min_vram_flux_schnell": True,
        "min_vram_sdxl": True,
    },
    "h100": {
        "name": "H100 SXM",
        "vram_gb": 80,
        "price_hr": 1.65,
        "tier": "high",
        "flux_dev_s": 8,
        "flux_schnell_s": 1.5,
        "sdxl_s": 2.5,
        "min_vram_flux_dev": True,
        "min_vram_flux_schnell": True,
        "min_vram_sdxl": True,
    },
    "any": {
        "name": "Any Available (cheapest)",
        "vram_gb": None,
        "price_hr": None,
        "tier": "auto",
        "flux_dev_s": None,
        "flux_schnell_s": None,
        "sdxl_s": None,
        "min_vram_flux_dev": True,
        "min_vram_flux_schnell": True,
        "min_vram_sdxl": True,
    },
}

GPU_TIERS = {
    "budget": ["rtx3090", "rtx3090ti"],
    "mid": ["rtx4080", "rtx4090", "rtx5090"],
    "high": ["a100", "h100"],
    "auto": ["any"],
}


def get_gpu_info(gpu_key):
    """Get GPU spec dict by key."""
    return GPU_CATALOG.get(gpu_key.lower().replace(" ", "").replace("-", ""))


def estimate_cost(num_images, gpu_key="rtx4090", model="flux_dev"):
    """Estimate cost and time for generating images.

    Args:
        num_images: Total number of images to generate.
        gpu_key: GPU key from GPU_CATALOG.
        model: "flux_dev", "flux_schnell", or "sdxl".

    Returns:
        Dict with time_min, cost_usd, cost_per_image.
    """
    gpu = GPU_CATALOG.get(gpu_key)
    if not gpu or gpu_key == "any":
        return {"note": "Cost estimation not available for 'any' GPU tier"}

    time_key = f"{model}_s"
    secs_per_img = gpu.get(time_key, gpu["flux_dev_s"])
    if secs_per_img is None:
        return {"note": "Timing data not available"}

    total_secs = num_images * secs_per_img
    total_hrs = total_secs / 3600
    cost = total_hrs * gpu["price_hr"]

    return {
        "gpu": gpu["name"],
        "num_images": num_images,
        "model": model,
        "secs_per_image": secs_per_img,
        "total_minutes": round(total_secs / 60, 1),
        "price_per_hr": f"${gpu['price_hr']:.2f}",
        "estimated_cost": f"${cost:.4f}",
        "cost_per_image": f"${cost/num_images:.5f}",
    }


def print_gpu_table(model="flux_dev"):
    """Print a comparison table of all available GPUs."""
    model_key = f"{model}_s"
    print(f"\n{'='*72}")
    print(f"  GPU Options for vast.ai Serverless  (model: {model})")
    print(f"{'='*72}")
    print(f"  {'GPU':<16} {'VRAM':>6}  {'$/hr':>6}  {'s/img':>6}  {'$/img':>8}  Tier")
    print(f"  {'-'*16} {'-'*6}  {'-'*6}  {'-'*6}  {'-'*8}  ----")

    for key, gpu in GPU_CATALOG.items():
        if key == "any":
            print(f"  {'any':<16} {'?':>6}  {'?':>6}  {'?':>6}  {'?':>8}  auto (cheapest available)")
            continue
        secs = gpu.get(model_key)
        if secs:
            cost_per_img = (secs / 3600) * gpu["price_hr"]
            vram = f"{gpu['vram_gb']}GB"
            flag = " *" if not gpu.get(f"min_vram_{model.replace('_', '_')}", True) else ""
            print(
                f"  {gpu['name']:<16} {vram:>6}  ${gpu['price_hr']:>5.2f}  "
                f"{secs:>5.0f}s  ${cost_per_img:>7.5f}  {gpu['tier']}{flag}"
            )

    print(f"\n  * = 16GB VRAM is borderline for Flux.1-dev (uses CPU offload, slower)")
    print(f"\n  Recommendation for Flux.1-dev:")
    print(f"    Budget  : RTX 3090   ($0.13/hr) — cheapest with full 24GB VRAM")
    print(f"    Balanced: RTX 4090   ($0.29/hr) — best speed/cost ratio")
    print(f"    Fast    : RTX 5090   ($0.37/hr) — fastest consumer GPU")
    print(f"    Pro     : A100/H100  ($1.65/hr) — datacenter, fastest batch")
    print()
