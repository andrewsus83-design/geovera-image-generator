"""Geovera Image Generator — Modal.com Serverless Deployment

Deploy:
    modal deploy modal_app.py

Run (test locally):
    modal run modal_app.py

Web Endpoints (after deploy):
    POST https://<workspace>--geovera-flux-generate-endpoint.modal.run
    POST https://<workspace>--geovera-flux-generate-variation-endpoint.modal.run
    POST https://<workspace>--geovera-flux-tiktok-batch-endpoint.modal.run
    GET  https://<workspace>--geovera-flux-health-endpoint.modal.run

Secrets (set via Modal dashboard → Secrets):
    huggingface-secret  — contains HF_TOKEN (required for Flux.1-dev)
    Create at: https://modal.com/secrets → New Secret → Hugging Face
"""

import base64
import io
import os
import time

import modal

# ── Modal App ─────────────────────────────────────────────────────
app = modal.App("geovera-flux")

# ── Secrets ───────────────────────────────────────────────────────
# HuggingFace token — required for Flux.1-dev (Schnell is fully open)
# Secret name in Modal dashboard: "huggingface-secret" with key HF_TOKEN
_hf_secret = modal.Secret.from_name("huggingface-secret")

# Gemini API key — used for QC (quality control) after each angle generation
# Secret name in Modal dashboard: "gemini-secret" with key GEMINI_API_KEY
# Create at: https://modal.com/secrets → New Secret → name: gemini-secret
try:
    _gemini_secret = modal.Secret.from_name("gemini-secret")
    _secrets = [_hf_secret, _gemini_secret]
except Exception:
    # Graceful fallback if secret not yet created — QC will be disabled
    _gemini_secret = None
    _secrets = [_hf_secret]

# ── Container image ───────────────────────────────────────────────
# Install numpy<2 FIRST, then torch — prevents pip from upgrading numpy
image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "numpy==1.26.4",        # must install FIRST — numpy<2 required by torch
    )
    .pip_install(
        "torch==2.4.1",
        "torchvision==0.19.1",
        extra_index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "diffusers==0.32.2",      # 0.32+ has FluxImg2ImgPipeline.from_pipe() support
        "transformers==4.44.2",
        "accelerate==0.34.2",
        "safetensors==0.4.5",
        "sentencepiece==0.2.1",  # bump to force image rebuild with new diffusers
        "Pillow>=10.0.0",
        "huggingface_hub>=0.20.0",
        "fastapi[standard]>=0.111.0",
        "google-generativeai>=0.7.0",  # Gemini Vision QC
        "requests>=2.31.0",            # LoRA download from Cloudinary URL
    )
    .env({"PYTHONUNBUFFERED": "1"})
)

# ── Model cache volume ────────────────────────────────────────────
model_volume = modal.Volume.from_name("geovera-models", create_if_missing=True)

# ── Helpers ───────────────────────────────────────────────────────

def _img_to_b64(img) -> str:
    """Convert PIL Image to base64 PNG string."""
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def _b64_to_img(b64: str):
    """Convert base64 string to PIL Image."""
    from PIL import Image
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")


def _resize_fit(img, target_w: int, target_h: int, bg_color=(0, 0, 0)):
    """Resize PIL image to target dimensions while preserving aspect ratio.

    The image is scaled to fit inside the target box (no cropping),
    then centered on a solid background — avoids stretch/distortion.
    For product photos this keeps the product shape intact.
    """
    from PIL import Image

    src_w, src_h = img.size
    # Scale to fit inside target box
    scale = min(target_w / src_w, target_h / src_h)
    new_w = max(1, round(src_w * scale))
    new_h = max(1, round(src_h * scale))
    resized = img.resize((new_w, new_h), Image.LANCZOS)

    # Create canvas and paste centered
    canvas = Image.new("RGB", (target_w, target_h), bg_color)
    offset_x = (target_w - new_w) // 2
    offset_y = (target_h - new_h) // 2
    canvas.paste(resized, (offset_x, offset_y))
    return canvas


def _download_lora(url: str, lora_type: str = "lora") -> str:
    """Download a LoRA .safetensors file from a URL to /tmp/, cached by URL hash.

    Returns the local path to the downloaded file.
    Modal containers are warm and reused — caching avoids re-downloading on
    every request when the same LoRA URL is used multiple times.
    """
    import hashlib
    import requests
    import os

    url_hash  = hashlib.md5(url.encode()).hexdigest()[:12]
    local_path = f"/tmp/lora_{lora_type}_{url_hash}.safetensors"

    if os.path.exists(local_path):
        print(f"  [LoRA] cache hit: {local_path}")
        return local_path

    print(f"  [LoRA] downloading {lora_type} from {url[:80]}...")
    resp = requests.get(url, stream=True, timeout=120)
    resp.raise_for_status()

    total  = int(resp.headers.get("Content-Length", 0))
    loaded = 0
    with open(local_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8 * 1024 * 1024):  # 8 MB chunks
            if chunk:
                f.write(chunk)
                loaded += len(chunk)
                if total:
                    pct = loaded / total * 100
                    if pct % 10 < (8 * 1024 * 1024 / total * 100):  # log ~every 10%
                        print(f"    {pct:.0f}% ({loaded // 1024 // 1024} MB / {total // 1024 // 1024} MB)")

    print(f"  [LoRA] downloaded: {local_path} ({loaded // 1024 // 1024} MB)")
    return local_path


def _apply_loras(
    pipe,
    actor_lora_path: str | None = None,
    actor_lora_scale: float = 0.85,
    prop_lora_path:  str | None = None,
    prop_lora_scale: float = 0.90,
) -> None:
    """Load and activate one or two LoRA adapters into the Flux pipeline.

    Uses diffusers named adapters so both actor + prop LoRAs can be combined:
      pipe.load_lora_weights(path, adapter_name="actor")
      pipe.load_lora_weights(path, adapter_name="prop")
      pipe.set_adapters(["actor", "prop"], [scale_actor, scale_prop])

    Must be called AFTER _load_flux() / _load_flux_img2img() so the pipe is ready.
    Must call _unload_loras(pipe) after generation to restore base weights.
    """
    adapters = []
    scales   = []

    if actor_lora_path:
        print(f"  [LoRA] loading actor adapter (scale={actor_lora_scale})...")
        pipe.load_lora_weights(actor_lora_path, adapter_name="actor")
        adapters.append("actor")
        scales.append(actor_lora_scale)

    if prop_lora_path:
        print(f"  [LoRA] loading prop adapter (scale={prop_lora_scale})...")
        pipe.load_lora_weights(prop_lora_path, adapter_name="prop")
        adapters.append("prop")
        scales.append(prop_lora_scale)

    if adapters:
        pipe.set_adapters(adapters, scales)
        print(f"  [LoRA] active adapters: {adapters} with scales {scales}")


def _unload_loras(pipe) -> None:
    """Remove all LoRA adapters and restore base model weights.

    Must be called after generation when LoRAs were applied, so the pipe
    is clean for the next request (Modal containers are warm and reused).
    """
    try:
        pipe.unload_lora_weights()
        print("  [LoRA] adapters unloaded — pipe restored to base weights")
    except Exception as e:
        print(f"  [LoRA] unload warning (non-fatal): {e}")


def _load_flux(variant: str = "schnell"):
    """Load Flux pipeline on GPU (cached in volume)."""
    import torch
    from diffusers import FluxPipeline

    model_id = (
        "black-forest-labs/FLUX.1-schnell"
        if variant == "schnell"
        else "black-forest-labs/FLUX.1-dev"
    )
    hf_token = os.environ.get("HF_TOKEN")
    cache_dir = "/model-cache"

    print(f"Loading {model_id} (token={'set' if hf_token else 'NOT SET'}) ...")
    try:
        pipe = FluxPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.bfloat16,
            token=hf_token,
            cache_dir=cache_dir,
        )
    except Exception as e:
        if "403" in str(e) or "GatedRepo" in type(e).__name__:
            raise RuntimeError(
                f"HuggingFace 403 Forbidden for {model_id}. "
                "Please accept the license at: "
                f"https://huggingface.co/{model_id} "
                "using the same account as your HF_TOKEN."
            ) from e
        raise
    pipe.to("cuda")
    print(f"✓ {model_id} loaded on H100 CUDA")
    return pipe


def _caption_image_blip2(img) -> str:
    """Generate a super-detailed product/character description using BLIP-2 VQA.

    Runs a series of 15+ targeted visual questions to extract every attribute:
    - Product category, brand, name
    - Primary and secondary colors
    - Material, fabric, texture, finish
    - Shape, dimensions, silhouette
    - Hardware: zippers, clasps, buckles, rings, chains, feet
    - Branding: logos, monograms, engravings, labels, stitching
    - Straps: type, length, attachment style
    - Condition: new, worn, distressed
    - Special features: pockets, closures, panels, patterns
    - Style: casual, luxury, sporty, vintage, minimalist

    Returns a rich comma-separated description string for prompt injection.
    """
    import torch
    from transformers import Blip2Processor, Blip2ForConditionalGeneration

    model_id  = "Salesforce/blip2-opt-2.7b"
    cache_dir = "/model-cache"

    print(f"  Loading BLIP-2 ({model_id})...")
    processor = Blip2Processor.from_pretrained(model_id, cache_dir=cache_dir)
    model     = Blip2ForConditionalGeneration.from_pretrained(
        model_id,
        torch_dtype=torch.float16,
        cache_dir=cache_dir,
    )
    model.to("cuda")
    print("  ✓ BLIP-2 loaded")

    # Comprehensive VQA questions — covers all attributes relevant to LoRA datasets
    # Grouped by category for organized prompt building
    QUESTIONS = [
        # ── Identity ─────────────────────────────────────────────────────
        ("identity",    "Question: What type of product or object is this? Give the specific category name. Answer:"),
        ("brand",       "Question: Is there a visible brand name, logo, or monogram? What does it say? Answer:"),
        ("style",       "Question: What is the style or design aesthetic? (luxury, minimalist, sporty, vintage, etc.) Answer:"),

        # ── Color ────────────────────────────────────────────────────────
        ("color_main",  "Question: What is the main primary color of this product? Be specific (e.g. warm camel, midnight navy, blush rose). Answer:"),
        ("color_sec",   "Question: Are there any secondary colors, contrast stitching, or color accents? Describe them. Answer:"),
        ("finish",      "Question: What is the surface finish? (matte, glossy, satin, brushed, patent, distressed) Answer:"),

        # ── Material & Texture ───────────────────────────────────────────
        ("material",    "Question: What material or fabric is the product made of? (leather, canvas, suede, nylon, metal, etc.) Answer:"),
        ("texture",     "Question: Describe the texture in detail. (smooth, pebbled, woven, quilted, embossed, perforated) Answer:"),

        # ── Shape & Structure ────────────────────────────────────────────
        ("shape",       "Question: What is the overall shape and silhouette? (rectangular, trapezoid, round, cylindrical, boxy, slouchy) Answer:"),
        ("size_ratio",  "Question: How would you describe the proportions? (compact, tall, wide, elongated, square) Answer:"),
        ("structure",   "Question: Is it structured or unstructured? Does it hold its shape or is it soft and flexible? Answer:"),

        # ── Hardware & Metal Details ─────────────────────────────────────
        ("hardware",    "Question: What metal hardware is visible? (zippers, clasps, buckles, rings, chains, studs, grommets) Describe color and style. Answer:"),
        ("closure",     "Question: How does it close or open? (zipper, magnetic snap, drawstring, flap, button, turnlock) Answer:"),

        # ── Handles, Straps & Attachments ───────────────────────────────
        ("handles",     "Question: Describe the handles or straps. (double handles, single strap, crossbody, backpack straps, chain, none) Answer:"),

        # ── Branding & Details ───────────────────────────────────────────
        ("logo_detail", "Question: Describe any logo placement, monogram pattern, or branding details precisely. Answer:"),
        ("pattern",     "Question: Is there any pattern, print, or decorative motif? (solid, plaid, floral, logo pattern, geometric) Answer:"),
        ("stitching",   "Question: Describe any visible stitching, seams, or panel details. Answer:"),

        # ── Functional Details ───────────────────────────────────────────
        ("pockets",     "Question: Are there any exterior pockets, compartments, or functional features? Describe them. Answer:"),
        ("feet",        "Question: Are there any base feet, bottom studs, or protective elements on the bottom? Answer:"),

        # ── Overall Impression ───────────────────────────────────────────
        ("impression",  "Question: In 10 words, what makes this product visually distinctive and recognizable? Answer:"),
    ]

    answers = {}
    for key, question in QUESTIONS:
        try:
            inputs = processor(img, text=question, return_tensors="pt").to("cuda", torch.float16)
            out    = model.generate(**inputs, max_new_tokens=50, num_beams=3)
            answer = processor.decode(out[0], skip_special_tokens=True).strip()
            # Clean up: remove the question echo if model repeats it
            if "Answer:" in answer:
                answer = answer.split("Answer:")[-1].strip()
            # Filter out unhelpful answers
            if answer and answer.lower() not in (
                "unknown", "none", "n/a", "i don't know", "not visible",
                "no", "yes", "", "it", "the product",
            ) and len(answer) > 3:
                answers[key] = answer
                print(f"    [{key}] {answer[:60]}")
        except Exception as e:
            print(f"    [{key}] skipped: {e}")

    # Free BLIP-2 memory before loading Flux (important — H100 has 80GB but we want clean slate)
    del model, processor
    import gc
    gc.collect()
    import torch as _torch
    _torch.cuda.empty_cache()
    print("  ✓ BLIP-2 unloaded, GPU memory freed")

    # ── Build structured caption from answers ─────────────────────────────
    # Order matters for prompt quality — most important attributes first
    ordered_keys = [
        "identity", "brand", "style",
        "color_main", "color_sec", "finish",
        "material", "texture",
        "shape", "size_ratio", "structure",
        "hardware", "closure",
        "handles",
        "logo_detail", "pattern", "stitching",
        "pockets", "feet",
        "impression",
    ]

    parts = []
    for key in ordered_keys:
        if key in answers:
            parts.append(answers[key])

    caption = ", ".join(parts)
    return caption


def _caption_image(img, detail_level: str = "long") -> str:
    """Wrapper for reverse prompting — calls super-detailed BLIP-2 VQA."""
    return _caption_image_blip2(img)


def _qc_angle_gemini(
    img_b64: str,
    angle_name: str,
    angle_desc: str,
    product_identity: str,
) -> tuple[bool, str]:
    """Use Gemini Vision to QC a generated angle image.

    Checks:
    1. Camera angle / viewpoint matches expected angle_name (e.g. "Back View", "Overhead")
    2. Subject / product is still present and identifiable (not replaced by background)

    Returns:
        (passed: bool, reason: str)

    If GEMINI_API_KEY is not set, always returns (True, "qc_skipped") so the
    pipeline continues gracefully even if the secret is missing.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return True, "qc_skipped"

    try:
        import google.generativeai as genai
        from PIL import Image as PILImage

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")   # fast + cheap, vision-capable

        # Decode base64 → PIL image for Gemini upload
        img_bytes = base64.b64decode(img_b64)
        pil_img   = PILImage.open(io.BytesIO(img_bytes)).convert("RGB")

        # Keep image small for QC — reduce token cost, Gemini handles 512px fine
        max_dim = 512
        w, h = pil_img.size
        if max(w, h) > max_dim:
            scale = max_dim / max(w, h)
            pil_img = pil_img.resize((int(w * scale), int(h * scale)), PILImage.LANCZOS)

        prompt = f"""You are a quality control checker for product photography.

Expected camera angle: {angle_name}
Angle description: {angle_desc}
Expected subject: {product_identity[:200]}

Please evaluate this generated image and answer TWO questions with YES or NO only:

1. ANGLE_OK: Does the image show the subject from approximately the correct viewpoint described above?
   - "Front View" should show the front face of the subject
   - "Back View" should show the rear of the subject
   - "Left Side" / "Right Side" should be a ~90-degree side profile
   - "Overhead" / "Flat-Lay" should be looking straight down
   - "Bottom View" should be looking straight up
   - "Detail *" / "Macro" should be a close-up crop, not full product
   - "3/4 Front-Left" etc should show a diagonal ~45-degree angle
   - "Glamour Hero" can be any elevated angle with dramatic lighting

2. SUBJECT_OK: Is the main subject (product/person) still clearly visible and identifiable in the image?
   - Answer NO only if the image is entirely abstract, shows only background, or the subject has completely disappeared

Reply in EXACTLY this format (two lines only):
ANGLE_OK: YES
SUBJECT_OK: YES"""

        response = model.generate_content([prompt, pil_img])
        text = response.text.strip().upper()

        angle_ok   = "ANGLE_OK: YES"   in text
        subject_ok = "SUBJECT_OK: YES" in text

        passed = angle_ok and subject_ok

        if not passed:
            reason_parts = []
            if not angle_ok:
                reason_parts.append(f"wrong angle (expected {angle_name})")
            if not subject_ok:
                reason_parts.append("subject not visible")
            reason = "; ".join(reason_parts)
        else:
            reason = "pass"

        print(f"    QC [{angle_name}]: angle_ok={angle_ok}, subject_ok={subject_ok} → {'✓' if passed else '✗'}")
        return passed, reason

    except Exception as e:
        # Non-fatal: if Gemini call fails, skip QC and accept the image
        print(f"    QC [{angle_name}]: Gemini call failed ({e}), accepting image")
        return True, f"qc_error: {str(e)[:80]}"


def _load_flux_img2img(variant: str = "schnell", txt2img_pipe=None):
    """Create Flux img2img pipeline by reusing txt2img pipeline via from_pipe().

    from_pipe() is the recommended diffusers way to share all model weights
    without re-downloading or duplicating memory.
    """
    import torch
    from diffusers import FluxImg2ImgPipeline

    if txt2img_pipe is not None:
        print("Converting txt2img → img2img via from_pipe() (shared weights)...")
        # from_pipe reuses all loaded components — zero extra VRAM, no re-download
        pipe = FluxImg2ImgPipeline.from_pipe(txt2img_pipe)
        print("✓ img2img pipeline ready (from_pipe, shared weights)")
        return pipe

    # Fallback: load from cache (only used if no txt2img_pipe provided)
    model_id  = "black-forest-labs/FLUX.1-schnell" if variant == "schnell" else "black-forest-labs/FLUX.1-dev"
    hf_token  = os.environ.get("HF_TOKEN")
    cache_dir = "/model-cache"

    print(f"Loading img2img {model_id} from cache (fallback)...")
    pipe = FluxImg2ImgPipeline.from_pretrained(
        model_id,
        torch_dtype=torch.bfloat16,
        token=hf_token,
        cache_dir=cache_dir,
    )
    pipe.to("cuda")
    print(f"✓ img2img {model_id} loaded")
    return pipe


# ── Web Endpoint: text-to-image & img2img ─────────────────────────

@app.function(
    gpu="H100",  # 80GB VRAM — fastest for FLUX.1, full GPU load no offload needed
    image=image,
    volumes={"/model-cache": model_volume},
    secrets=_secrets,
    timeout=300,
    memory=16384,
)
@modal.fastapi_endpoint(method="POST", label="generate-endpoint")
def generate_endpoint(item: dict) -> dict:
    """Text-to-image generation via HTTP POST.

    Body JSON:
        prompt, width, height, num_images, num_steps,
        guidance_scale, seed, model_variant,
        source_b64 (optional — enables img2img), strength
    """
    import torch

    prompt        = item.get("prompt", "")
    width         = int(item.get("width", 768))
    height        = int(item.get("height", 1344))
    num_images    = int(item.get("num_images", 1))
    num_steps     = int(item.get("num_steps", 4))
    guidance_scale= float(item.get("guidance_scale", 0.0))
    seed          = int(item.get("seed", 42))
    model_variant = item.get("model_variant", "schnell")
    source_b64    = item.get("source_b64")
    strength      = float(item.get("strength", 0.75))

    t0 = time.time()

    if source_b64:
        # img2img — load txt2img first, then convert (shares weights, no re-download)
        # Use white bg so padding blends with generated content instead of leaving black bars
        source        = _resize_fit(_b64_to_img(source_b64), width, height, bg_color=(255, 255, 255))
        txt2img_base  = _load_flux(model_variant)
        pipe          = _load_flux_img2img(model_variant, txt2img_pipe=txt2img_base)
        # Generate each image in a separate call with a unique seed → visually distinct results
        all_images = []
        for i in range(num_images):
            generator = torch.Generator("cuda").manual_seed(seed + i * 137)
            result = pipe(
                prompt=prompt,
                image=source,
                strength=strength,
                width=width,
                height=height,
                num_images_per_prompt=1,
                num_inference_steps=max(int(num_steps / strength), num_steps),
                guidance_scale=0.0,
                generator=generator,
            )
            all_images.extend(result.images)
    else:
        # txt2img — also loop per image for unique seeds
        pipe = _load_flux(model_variant)
        all_images = []
        for i in range(num_images):
            generator = torch.Generator("cuda").manual_seed(seed + i * 137)
            result = pipe(
                prompt=prompt,
                width=width,
                height=height,
                num_images_per_prompt=1,
                num_inference_steps=num_steps,
                guidance_scale=guidance_scale if model_variant == "dev" else 0.0,
                generator=generator,
            )
            all_images.extend(result.images)

    images_b64 = [_img_to_b64(img) for img in all_images]
    elapsed    = round(time.time() - t0, 2)
    print(f"✓ Generated {len(images_b64)} image(s) in {elapsed}s")

    return {
        "images": images_b64,
        "time":   elapsed,
        "model":  f"flux-{model_variant}",
    }


# ── Web Endpoint: TikTok batch ────────────────────────────────────

@app.function(
    gpu="H100",  # 80GB VRAM — fastest for FLUX.1, full GPU load no offload needed
    image=image,
    volumes={"/model-cache": model_volume},
    secrets=_secrets,
    timeout=600,
    memory=16384,
)
@modal.fastapi_endpoint(method="POST", label="tiktok-batch-endpoint")
def tiktok_batch_endpoint(item: dict) -> dict:
    """Batch TikTok ad generation via HTTP POST.

    Body JSON:
        subject_description, source_b64 (optional), theme_ids (optional),
        screen_ratio, color, num_images_per_theme, strength, seed,
        continuity, continuity_arc, model_variant, num_steps,
        sequence_mode (bool) — if True, num_images_per_theme frames form a story sequence per theme
    """
    import torch

    # ── Theme name lookup ─────────────────────────────────────────
    THEME_NAMES = {
        1: "Luxury Lifestyle", 2: "Night Neon Cyberpunk", 3: "Golden Hour Outdoor",
        4: "High-Fashion Studio Editorial", 5: "Minimalist Premium White",
        6: "Moody Dark Dramatic", 7: "Street Urban Aesthetic", 8: "Coffee Shop Cozy Vibe",
        9: "Executive Business Power", 10: "Sporty Energetic",
        11: "Rain Cinematic Slow-Motion", 12: "Rooftop Sunset Vibe",
        13: "Soft Romantic Pastel", 14: "Futuristic Tech Environment",
        15: "Black & White Classic", 16: "Vibrant Colorful Gen-Z",
        17: "Nature Adventure", 18: "Home Comfort Lifestyle",
        19: "Party Nightlife Vibe", 20: "Ultra Luxury Spotlight",
        21: "Vintage Film Nostalgia", 22: "Desert Editorial",
        23: "Underwater Fantasy", 24: "Cherry Blossom Japanese",
        25: "Cinematic Film Noir", 26: "Tropical Paradise",
        27: "Industrial Warehouse", 28: "Neon Tokyo Streets",
        29: "Ethereal Cloud Dream", 30: "Grunge Rebel Aesthetic",
    }

    # ── Theme visual keywords (injected into prompt per theme) ────
    THEME_PROMPTS = {
        1:  "penthouse interior, marble floors, gold accents, floor-to-ceiling windows",
        2:  "rain-slicked neon streets, electric blue and pink neon reflections, cyberpunk city",
        3:  "golden meadow, sunset backlight, warm golden hour, lens flare",
        4:  "dramatic studio, harsh editorial lighting, stark shadows, fashion editorial",
        5:  "pure white minimalist studio, clean premium backdrop, soft diffused light",
        6:  "dark dramatic chiaroscuro, deep shadows, single light source, moody atmosphere",
        7:  "urban street art graffiti wall, authentic city backdrop, raw energy",
        8:  "warm cozy coffee shop interior, exposed brick, warm amber light, intimate",
        9:  "modern glass office, city skyline view, clean corporate power, slate and navy",
        10: "athletic training ground, dynamic movement, bright dramatic lighting, sport energy",
        11: "heavy cinematic rain, dramatic backlight through rain, slow motion atmosphere",
        12: "urban rooftop at magic hour, city skyline, warm sunset gradient",
        13: "dreamy pastel environment, blush pink and lavender, soft romantic diffused light",
        14: "futuristic sci-fi lab, holographic displays, electric blue glow, technology",
        15: "timeless black and white, dramatic contrast, Helmut Newton classic portrait",
        16: "explosive vivid colors, bold graphic elements, Gen-Z energy, rainbow vivid",
        17: "epic natural mountain landscape, lush forest, adventure, natural daylight",
        18: "warm comfortable home interior, natural light, cozy relatable lifestyle",
        19: "VIP nightclub, dynamic club lighting, gold and red and purple, energy",
        20: "single dramatic spotlight in total darkness, ultra premium exclusive atmosphere",
        21: "70s retro film grain aesthetic, warm faded nostalgic tones, vintage mood",
        22: "vast desert landscape, golden sand dunes, harsh sunlight, editorial raw",
        23: "ethereal underwater fantasy, blue turquoise caustic light, magical deep sea",
        24: "Japanese cherry blossom garden, sakura petals, soft spring light, elegant",
        25: "1940s film noir detective office, venetian blind shadows, cigarette smoke",
        26: "lush tropical beach paradise, turquoise water, bright tropical sunlight",
        27: "raw industrial warehouse, exposed concrete, overhead industrial light, edgy",
        28: "vibrant Tokyo street at night, neon kanji signs, electric exotic atmosphere",
        29: "floating among clouds, ethereal dreamscape, celestial soft golden light",
        30: "grunge rebel aesthetic, distressed textures, dark dramatic, rebellious energy",
    }

    # ── Story beat prompts per arc ────────────────────────────────
    CONTINUITY_BEATS = {
        "journey": [
            "morning awakening, fresh start",
            "preparation and getting ready",
            "departing with purpose",
            "peak moment of engagement",
            "building momentum and energy",
            "golden hour glow",
            "evening wind-down, reflection",
            "final destination reached",
        ],
        "transformation": [
            "humble beginning, ordinary moment",
            "first spark of inspiration",
            "building confidence and momentum",
            "breakthrough moment of change",
            "full bloom, transformation complete",
            "owning the moment with confidence",
            "elevated status and presence",
            "iconic unforgettable moment",
        ],
        "adventure": [
            "comfort zone, familiar setting",
            "first step into the unknown",
            "discovering new terrain",
            "facing a challenge head-on",
            "overcoming obstacles with strength",
            "summit reached, victory in sight",
            "victory celebration",
            "returning transformed",
        ],
        "emotion": [
            "quiet contemplation, stillness",
            "gentle curiosity awakening",
            "growing warmth and connection",
            "passionate intensity",
            "joyful exuberance, peak happiness",
            "powerful confidence radiating",
            "tender vulnerability, authentic moment",
            "serene resolution, peace",
        ],
    }

    subject_description  = item.get("subject_description", "person")
    source_b64           = item.get("source_b64")   # legacy: single source (prop-only / actor-only)
    actor_b64            = item.get("actor_b64")    # actor face/body (actor+prop mode)
    prop_b64             = item.get("prop_b64")     # product image  (actor+prop / prop-only)
    # LoRA — Cloudinary URLs of uploaded .safetensors files
    actor_lora_url       = item.get("actor_lora_url")    # e.g. https://res.cloudinary.com/...
    actor_lora_scale     = float(item.get("actor_lora_scale", 0.85))
    prop_lora_url        = item.get("prop_lora_url")
    prop_lora_scale      = float(item.get("prop_lora_scale", 0.90))
    theme_ids            = item.get("theme_ids") or list(range(1, 31))
    screen_ratio         = item.get("screen_ratio", "9:16")
    color                = item.get("color", "none")
    num_images_per_theme = int(item.get("num_images_per_theme", 1))
    strength             = float(item.get("strength", 0.75))
    seed                 = int(item.get("seed", 42))
    continuity           = bool(item.get("continuity", False))
    continuity_arc       = item.get("continuity_arc", "journey")
    sequence_mode        = bool(item.get("sequence_mode", False))
    camera_shot          = item.get("camera_shot", "none")  # "mix" = auto-vary per theme
    model_variant        = item.get("model_variant", "schnell")
    num_steps            = int(item.get("num_steps", 4))

    # ── Camera shot prompts (for mix mode) ─────────────────────────
    CAMERA_SHOT_PROMPTS = [
        "close-up shot, face and product detail",
        "medium close-up shot, waist up",
        "medium shot, half body",
        "medium wide shot, full body",
        "wide shot, full environment visible",
        "low angle shot, looking up, dramatic perspective",
        "high angle shot, looking down",
        "overhead top-down shot, bird's eye view",
    ]
    # Fixed camera prompt (used when not mix)
    CAMERA_SHOT_MAP = {
        "none":          "",
        "mix":           None,  # handled per-theme below
        "extreme_close": "extreme close-up shot, macro detail",
        "close":         "close-up shot, face and product detail",
        "medium_close":  "medium close-up shot, waist up",
        "medium":        "medium shot, half body",
        "medium_wide":   "medium wide shot, full body",
        "wide":          "wide shot, full environment visible",
        "extreme_wide":  "extreme wide shot, aerial or panoramic view",
        "overhead":      "overhead top-down shot, bird's eye view",
        "low_angle":     "low angle shot, looking up, dramatic perspective",
        "high_angle":    "high angle shot, looking down",
    }
    fixed_cam_prompt = CAMERA_SHOT_MAP.get(camera_shot, "") if camera_shot != "mix" else None

    # sequence_mode: multi-image per theme forms a story sequence
    # continuity (legacy): last image of prev theme seeds next theme
    use_sequence = sequence_mode and num_images_per_theme > 1

    SCREEN_RATIOS = {
        "9:16":  {"width": 768,  "height": 1344},
        "4:3":   {"width": 1024, "height": 768},
        "1:1":   {"width": 1024, "height": 1024},
        "16:9":  {"width": 1344, "height": 768},
        "3:4":   {"width": 768,  "height": 1024},
    }

    ratio  = SCREEN_RATIOS.get(screen_ratio, SCREEN_RATIOS["9:16"])
    width  = ratio["width"]
    height = ratio["height"]

    t_start      = time.time()
    pipe_txt2img = _load_flux(model_variant)

    # ── Download + apply LoRA adapters (if provided) ─────────────
    # LoRAs are loaded BEFORE img2img pipeline creation so from_pipe() inherits them.
    # Files are downloaded from Cloudinary URL to /tmp/ and cached by URL hash.
    actor_lora_path = None
    prop_lora_path  = None
    loras_applied   = False

    if actor_lora_url or prop_lora_url:
        try:
            if actor_lora_url:
                actor_lora_path = _download_lora(actor_lora_url, lora_type="actor")
            if prop_lora_url:
                prop_lora_path  = _download_lora(prop_lora_url,  lora_type="prop")

            _apply_loras(
                pipe_txt2img,
                actor_lora_path=actor_lora_path,
                actor_lora_scale=actor_lora_scale,
                prop_lora_path=prop_lora_path,
                prop_lora_scale=prop_lora_scale,
            )
            loras_applied = True
        except Exception as e:
            print(f"  [LoRA] WARNING: failed to load LoRA(s): {e} — continuing without LoRA")
            loras_applied = False

    # ── Resolve source image + hardcode strength per mode ────────
    # Strength is NO LONGER taken from client payload — hardcoded here
    # to ensure product consistency across all themes/variations.
    #
    #   actor+prop : 0.55  — prop is visual anchor; low = product barely changes
    #   prop-only  : 0.50  — maximum product fidelity, scene mostly from prompt
    #   actor-only : 0.72  — actor face/body with more creative scene freedom
    #   legacy     : 0.60  — safe middle ground
    #   txt2img    : 1.0   — no source, not used

    if prop_b64 and actor_b64:
        # Actor + Prop: prop as visual anchor, actor injected via prompt
        # strength 0.55 — product shape/color preserved, scene built around it via prompt
        source   = _resize_fit(_b64_to_img(prop_b64), width, height, bg_color=(255, 255, 255))
        strength = 0.55
        print(f"  actor+prop mode: prop as img2img source (s={strength}), actor via prompt")
    elif prop_b64:
        # Prop only: product stays clearly visible, scene varies via prompt
        source   = _resize_fit(_b64_to_img(prop_b64), width, height, bg_color=(255, 255, 255))
        strength = 0.60
        print(f"  prop-only mode: prop as img2img source (s={strength})")
    elif actor_b64:
        # Actor only: more creative scene freedom
        source   = _resize_fit(_b64_to_img(actor_b64), width, height, bg_color=(255, 255, 255))
        strength = 0.80
        print(f"  actor-only mode: actor as img2img source (s={strength})")
    elif source_b64:
        # Legacy fallback (old clients sending single source_b64)
        source   = _resize_fit(_b64_to_img(source_b64), width, height, bg_color=(255, 255, 255))
        strength = 0.75
        print(f"  legacy source_b64 mode (s={strength})")
    else:
        source   = None
        strength = 1.0  # txt2img: strength not used but set for reference
        print(f"  txt2img mode (no source image)")

    pipe_img2img = _load_flux_img2img(model_variant, txt2img_pipe=pipe_txt2img) if source else None

    results        = []
    cross_theme_prev = None  # for legacy continuity across themes
    total            = len(theme_ids)

    beats = CONTINUITY_BEATS.get(continuity_arc, CONTINUITY_BEATS["journey"])

    import random as _random

    for idx, theme_id in enumerate(theme_ids):
        # Pick camera shot — random per theme in mix mode
        if camera_shot == "mix":
            # Use seeded random so results are reproducible with same seed
            _rng = _random.Random(seed + idx * 7)
            cam_prompt = _rng.choice(CAMERA_SHOT_PROMPTS)
        else:
            cam_prompt = fixed_cam_prompt or ""

        theme_visual = THEME_PROMPTS.get(theme_id, "")
        base_prompt_parts = [
            "commercial TikTok advertisement photo",
            subject_description,
            theme_visual,
        ]
        if cam_prompt:
            base_prompt_parts.append(cam_prompt)
        base_prompt_parts += [
            "ultra high resolution, professional commercial photography",
            "cinematic lighting, photorealistic, ad-ready aesthetic",
        ]
        base_prompt = ", ".join(p for p in base_prompt_parts if p)

        if color and color != "none":
            base_prompt += (
                f", {color} color palette for background and environment lighting, "
                f"product maintains its exact original colors and appearance, "
                f"consistent product color, no color shift on product"
            )

        t0          = time.time()
        theme_imgs  = []

        if use_sequence:
            # ── Sequence mode: N frames per theme, each is a story beat ──
            #
            # WITH product/source image:
            #   Every frame uses img2img with the ORIGINAL source image.
            #   This keeps the product visible and consistent across all frames.
            #   Strength increases slightly per frame so later scenes show more
            #   variation in background/lighting while product stays recognizable.
            #     frame 0: strength=0.50 (product very prominent)
            #     frame 1: strength=0.60
            #     frame 2: strength=0.68
            #     frame 3: strength=0.74 (most creative, product still visible)
            #
            # WITHOUT source image:
            #   Each frame uses txt2img with a unique seed + beat prompt.
            #   Scene varies freely across the story arc.

            # Ensure img2img pipeline is loaded if we have source
            if source and pipe_img2img is None:
                print("  Loading img2img pipeline for product sequence...")
                pipe_img2img = _load_flux_img2img(model_variant, txt2img_pipe=pipe_txt2img)

            # Strength ramp: keeps product visible in all frames
            # Lower = more faithful to source, higher = more creative scene
            base_strength = min(strength, 0.72)  # cap at 0.72 so product stays
            strength_ramp = [
                max(0.45, base_strength - 0.20),   # frame 0 — product most prominent
                max(0.50, base_strength - 0.12),   # frame 1
                max(0.55, base_strength - 0.05),   # frame 2
                min(0.75, base_strength + 0.02),   # frame 3 — most scene variation
            ]

            for frame_idx in range(num_images_per_theme):
                beat         = beats[frame_idx % len(beats)]
                frame_prompt = (
                    f"{base_prompt}, "
                    f"{beat}, "
                    f"scene {frame_idx + 1} of {num_images_per_theme} visual story"
                )
                generator = torch.Generator("cuda").manual_seed(seed + idx * 100 + frame_idx)

                if source and pipe_img2img:
                    # Product sequence — all frames reference original product image
                    frame_strength = strength_ramp[min(frame_idx, len(strength_ramp) - 1)]
                    result = pipe_img2img(
                        prompt=frame_prompt,
                        image=source,           # always the ORIGINAL product image
                        strength=frame_strength,
                        width=width,
                        height=height,
                        num_images_per_prompt=1,
                        num_inference_steps=num_steps,
                        guidance_scale=0.0,
                        generator=generator,
                    )
                    print(f"    frame {frame_idx+1}/{num_images_per_theme} [img2img s={frame_strength:.2f}] — {beat[:40]}")
                else:
                    # No product — pure txt2img with beat prompt
                    result = pipe_txt2img(
                        prompt=frame_prompt,
                        width=width,
                        height=height,
                        num_images_per_prompt=1,
                        num_inference_steps=num_steps,
                        guidance_scale=0.0,
                        generator=generator,
                    )
                    print(f"    frame {frame_idx+1}/{num_images_per_theme} [txt2img] — {beat[:40]}")

                theme_imgs.append(result.images[0])

        else:
            # ── Normal mode: N variations of this theme, each with unique seed ──
            # Generate 1 image per iteration so each gets a unique seed → visually distinct
            current_source = cross_theme_prev if (continuity and cross_theme_prev) else source
            # strength already hardcoded per mode above; reduce slightly for cross-theme continuity
            gen_strength   = max(0.45, strength * 0.85) if (continuity and cross_theme_prev) else strength
            prompt         = f"{base_prompt}, variation"

            for img_idx in range(num_images_per_theme):
                # Each image uses a unique seed: base seed + theme offset + image index
                img_seed  = seed + idx * 100 + img_idx
                generator = torch.Generator("cuda").manual_seed(img_seed)

                if current_source and pipe_img2img:
                    result = pipe_img2img(
                        prompt=prompt,
                        image=current_source,
                        strength=gen_strength,
                        width=width,
                        height=height,
                        num_images_per_prompt=1,
                        num_inference_steps=num_steps,
                        guidance_scale=0.0,
                        generator=generator,
                    )
                else:
                    result = pipe_txt2img(
                        prompt=prompt,
                        width=width,
                        height=height,
                        num_images_per_prompt=1,
                        num_inference_steps=num_steps,
                        guidance_scale=0.0,
                        generator=generator,
                    )
                theme_imgs.append(result.images[0])
                print(f"    img {img_idx+1}/{num_images_per_theme} [seed={img_seed}]")

        # Cross-theme continuity: last frame of this theme → first frame of next
        if continuity and theme_imgs:
            cross_theme_prev = theme_imgs[-1]

        elapsed = round(time.time() - t0, 2)
        theme_name = THEME_NAMES.get(theme_id, f"Theme {theme_id}")
        results.append({
            "theme_id": theme_id,
            "theme":    theme_name,
            "images":   [_img_to_b64(img) for img in theme_imgs],
            "time":     elapsed,
            "sequence": use_sequence,
        })
        print(f"  [{idx+1}/{total}] theme {theme_id} ({theme_name}) — {len(theme_imgs)} frames, {elapsed}s")

    # ── Unload LoRA adapters — restore base weights for next request ──
    # Modal containers are warm/reused; unloading ensures a clean pipe
    # for subsequent requests that don't use a LoRA.
    if loras_applied:
        _unload_loras(pipe_txt2img)
        if pipe_img2img is not None:
            _unload_loras(pipe_img2img)

    return {
        "results": results,
        "total":   sum(len(r["images"]) for r in results),
        "time":    round(time.time() - t_start, 2),
    }


# ── Web Endpoint: Multi-Angle Synthetic ──────────────────────────

# 16 fixed camera angle descriptions + per-angle strength
# Each tuple: (angle_name, angle_prompt, strength_prop, strength_actor)
#
# Strength guide:
#   0.50-0.60 → close-up/detail/flat-lay — keep product texture, just zoom in
#   0.72-0.78 → full rotation shots — need enough denoising to actually rotate the subject
#   0.82      → overhead / bottom — most extreme angle, needs highest strength
#
# Why higher strength? img2img strength controls how much noise is added back
# before denoising. Low strength (0.42) barely changes the image — only ~42% of
# denoising steps run, so the model cannot physically rotate the subject.
# We need 0.72+ for actual viewpoint changes while preserving product identity
# via the detailed text prompt.
MULTI_ANGLE_SHOTS = [
    # (name, angle_prompt, strength_prop, strength_actor)
    ("Front View",      "front view, straight-on shot, eye-level camera, subject facing forward, full product visible",                    0.72, 0.72),
    ("Back View",       "back view, 180-degree rear shot, looking at the back of the subject, rear details visible",                       0.78, 0.75),
    ("Left Side",       "pure left side profile view, 90 degrees left, subject rotated 90 degrees, left profile facing camera",            0.78, 0.75),
    ("Right Side",      "pure right side profile view, 90 degrees right, subject rotated 90 degrees, right profile facing camera",         0.78, 0.75),
    ("3/4 Front-Left",  "three-quarter angle view from front-left, 45-degree rotation, diagonal front-left perspective",                   0.75, 0.72),
    ("3/4 Front-Right", "three-quarter angle view from front-right, 45-degree rotation, diagonal front-right perspective",                 0.75, 0.72),
    ("3/4 Back-Left",   "three-quarter angle view from back-left, 135-degree rotation, diagonal rear-left perspective",                   0.78, 0.75),
    ("3/4 Back-Right",  "three-quarter angle view from back-right, 135-degree rotation, diagonal rear-right perspective",                  0.78, 0.75),
    ("Overhead",        "directly overhead top-down view, bird's eye view, camera pointing straight down 90 degrees, top surface visible", 0.82, 0.80),
    ("Bottom View",     "directly underneath view, worm's eye view, camera pointing straight up, bottom surface visible",                  0.82, 0.80),
    ("Detail Left",     "extreme close-up of left side detail, macro shot, left side texture and hardware",                                0.58, 0.58),
    ("Detail Right",    "extreme close-up of right side detail, macro shot, right side texture and hardware",                              0.58, 0.58),
    ("Detail Front",    "extreme close-up front center detail, macro shot, front face logo branding and center detail",                    0.55, 0.55),
    ("Macro Texture",   "extreme macro close-up, material surface texture, fabric or leather grain detail, ultra close",                   0.50, 0.50),
    ("Flat-Lay",        "flat-lay composition, subject lying flat on white surface, overhead straight-down camera, clean flat-lay",        0.80, 0.78),
    ("Glamour Hero",    "dramatic glamour hero shot, 45-degree elevated angle, dramatic three-point studio lighting, hero product shot",   0.72, 0.70),
]

MULTI_ANGLE_SIZE = 1024  # always 1:1 square for LoRA training


@app.function(
    gpu="H100",
    image=image,
    volumes={"/model-cache": model_volume},
    secrets=_secrets,
    timeout=900,
    memory=16384,
)
def multi_angle_endpoint(item: dict) -> dict:  # internal — called by stream endpoint, no web endpoint needed
    """Generate 16 shots of a product or character from 16 different camera angles.

    Pipeline:
    1. BLIP-2 captions the source image → extracts color, material, shape, logo details
    2. Caption is injected into every angle prompt → locks product identity
    3. Flux img2img generates each angle with per-angle strength
       (higher strength for rotations, lower for close-ups)

    Designed for:
    - LoRA training datasets (consistent subject, varied angles)
    - E-commerce multi-angle product listings

    Body JSON:
        source_b64:    base64 image of product or character (required)
        description:   str — e.g. "premium leather handbag" or "male model in suit"
        subject_type:  "prop" | "actor"  (default "prop")
        seed:          int (default 42) — same seed = same 16 images
        model_variant: "schnell" | "dev" (default "schnell")
        num_steps:     int (default 4)
        use_caption:   bool (default true) — run BLIP-2 reverse prompt before generation
    """
    import torch

    source_b64    = item.get("source_b64")
    description   = item.get("description", "subject")
    subject_type  = item.get("subject_type", "prop")   # "prop" | "actor"
    base_seed     = int(item.get("seed", 42))
    model_variant = item.get("model_variant", "schnell")
    num_steps     = int(item.get("num_steps", 4))
    use_caption   = bool(item.get("use_caption", True))  # BLIP-2 reverse prompting

    if not source_b64:
        raise ValueError("source_b64 is required for multi-angle generation")

    t_start = time.time()

    source_pil = _b64_to_img(source_b64)

    # ── Step 1: Reverse Prompting via BLIP-2 ──────────────────────────────
    # Caption the source image to extract specific visual attributes.
    # This "product lock" description is injected into every angle prompt
    # so the model knows exactly what the product looks like even when it
    # needs to reimagine it from a different camera angle.
    #
    # Example output:
    #   "brown leather tote bag, gold metal hardware, structured rectangular
    #    shape, double top handles, front zip pocket, smooth calfskin texture"
    #
    # Why this works: at high img2img strength (0.72-0.82), the model has
    # enough freedom to rotate the subject but may drift from the original.
    # The detailed caption acts as a "visual anchor" in text space,
    # complementing the image anchor from img2img.

    product_caption = ""
    if use_caption:
        try:
            t_cap = time.time()
            print("── Step 1/3: BLIP-2 reverse prompting...")
            product_caption = _caption_image(source_pil, detail_level="long")
            print(f"  Caption ({round(time.time()-t_cap, 1)}s): {product_caption[:100]}")
        except Exception as e:
            # Non-fatal: if captioning fails, fall back to user description only
            print(f"  ⚠ BLIP-2 captioning failed ({e}), falling back to user description only")
            product_caption = ""

    # Build the product identity string: BLIP-2 caption + user description
    # User description takes priority (placed last = stronger in CLIP attention)
    if product_caption and description and description.strip() != "subject":
        # Combine: BLIP-2 visual details first, user label last
        product_identity = f"{product_caption}, {description}"
    elif product_caption:
        product_identity = product_caption
    else:
        product_identity = description or "subject"

    print(f"  Product identity lock: {product_identity[:120]}")

    # ── Step 2: Resize source for studio output ───────────────────────────
    # White background padding — matches studio photography look
    source = _resize_fit(
        source_pil,
        MULTI_ANGLE_SIZE,
        MULTI_ANGLE_SIZE,
        bg_color=(255, 255, 255),
    )

    # ── Step 3: Load Flux pipelines ───────────────────────────────────────
    print("── Step 2/3: Loading Flux pipelines...")
    pipe_txt2img = _load_flux(model_variant)
    pipe_img2img = _load_flux_img2img(model_variant, txt2img_pipe=pipe_txt2img)

    # Studio context suffix — clean consistent background for all 16 shots
    if subject_type == "prop":
        studio_ctx = (
            "pure white studio background, professional product photography, "
            "soft diffused studio lighting, no shadows on background, "
            "no props, no people, no text, product isolated on white, "
            "photorealistic, ultra high resolution, commercial photography"
        )
    else:
        studio_ctx = (
            "clean neutral studio background, professional portrait photography, "
            "soft studio lighting, no distracting props, no text, "
            "photorealistic, ultra high resolution, commercial character photography"
        )

    # strength_field index in MULTI_ANGLE_SHOTS tuple: [2]=prop, [3]=actor
    strength_field_idx = 2 if subject_type == "prop" else 3

    print(f"── Step 3/3: Generating 16 angles (caption={'yes' if product_caption else 'no'})...")
    results = []

    for angle_idx, angle_entry in enumerate(MULTI_ANGLE_SHOTS):
        angle_name  = angle_entry[0]
        angle_desc  = angle_entry[1]
        # Per-angle strength:
        #   rotation shots (back/side/overhead) → 0.72-0.82 (model rotates subject)
        #   close-up/detail shots               → 0.50-0.58 (model zooms in, keeps texture)
        strength    = angle_entry[strength_field_idx]

        # Unique reproducible seed per angle (prime step avoids seed collisions)
        angle_seed = base_seed + angle_idx * 37
        generator  = torch.Generator("cuda").manual_seed(angle_seed)

        # Prompt structure:
        #   [product_identity (BLIP-2 + user)] + [angle_desc] + [studio_ctx]
        #
        # product_identity is placed FIRST → highest CLIP attention weight
        # → model "knows" what it's generating before reading angle instruction
        if subject_type == "prop":
            prompt = (
                f"professional product photography of {product_identity}, "
                f"{angle_desc}, "
                f"{studio_ctx}"
            )
        else:
            prompt = (
                f"professional studio portrait of {product_identity}, "
                f"{angle_desc}, "
                f"{studio_ctx}"
            )

        t0 = time.time()
        # Adjust steps proportionally to strength so effective denoising is consistent
        # e.g. strength=0.78, steps=4 → adjusted=max(6, 4)=6 effective steps
        adjusted_steps = max(round(num_steps / strength), num_steps)
        result = pipe_img2img(
            prompt=prompt,
            image=source,
            strength=strength,
            width=MULTI_ANGLE_SIZE,
            height=MULTI_ANGLE_SIZE,
            num_images_per_prompt=1,
            num_inference_steps=adjusted_steps,
            guidance_scale=0.0,
            generator=generator,
        )
        elapsed = round(time.time() - t0, 2)

        results.append({
            "angle_idx":  angle_idx,
            "angle_name": angle_name,
            "angle_desc": angle_desc,
            "image":      _img_to_b64(result.images[0]),
            "time":       elapsed,
            "seed":       angle_seed,
            "strength":   strength,
        })
        print(f"  [{angle_idx+1}/16] {angle_name} — s={strength:.2f}, seed={angle_seed}, {elapsed}s")

    total_time = round(time.time() - t_start, 2)
    print(f"✓ Multi-angle complete: 16 images in {total_time}s")

    return {
        "angles":          results,
        "total":           16,
        "time":            total_time,
        "seed":            base_seed,
        "model":           f"flux-{model_variant}",
        "product_caption": product_caption,   # returned (logged only, not displayed in UI)
    }


# ── Web Endpoint: Multi-Angle Streaming (SSE) ────────────────────
# Streams each angle result immediately as it completes — like OpenArt.
# UI receives angles one-by-one and renders them in the grid in real-time.
# If generation fails at angle N, user already has angles 0..N-1 saved.
#
# Protocol: Server-Sent Events (text/event-stream)
#   - Each event: "data: <json>\n\n"
#   - Event types (field "event" in JSON):
#       "init"     — caption done, Flux loaded, ready to generate
#       "angle"    — one angle done (includes base64 image)
#       "done"     — all 16 angles complete
#       "error"    — fatal error


def _run_multi_angle_core(item: dict):
    """Shared logic for both streaming and batch multi-angle endpoints.

    Yields dicts describing events:
        {"event": "init",  "product_caption": str, "model": str}
        {"event": "angle", "angle_idx": int, "angle_name": str,
         "angle_desc": str, "image": str, "time": float, "seed": int, "strength": float}
        {"event": "done",  "total": int, "time": float, "seed": int, "model": str}
    """
    import torch

    source_b64    = item.get("source_b64")
    description   = item.get("description", "subject")
    subject_type  = item.get("subject_type", "prop")
    base_seed     = int(item.get("seed", 42))
    model_variant = item.get("model_variant", "schnell")
    num_steps     = int(item.get("num_steps", 4))
    use_caption   = bool(item.get("use_caption", True))

    if not source_b64:
        yield {"event": "error", "message": "source_b64 is required"}
        return

    t_start    = time.time()
    source_pil = _b64_to_img(source_b64)

    # ── Step 1: BLIP-2 reverse prompting ──────────────────────────
    product_caption = ""
    if use_caption:
        try:
            print("── Step 1/3: BLIP-2 reverse prompting...")
            t_cap = time.time()
            product_caption = _caption_image(source_pil, detail_level="long")
            print(f"  Caption ({round(time.time()-t_cap, 1)}s): {product_caption[:100]}")
        except Exception as e:
            print(f"  ⚠ BLIP-2 failed ({e}), using user description only")

    if product_caption and description and description.strip() != "subject":
        product_identity = f"{product_caption}, {description}"
    elif product_caption:
        product_identity = product_caption
    else:
        product_identity = description or "subject"

    print(f"  Product identity lock: {product_identity[:120]}")

    # ── Step 2: Resize source ──────────────────────────────────────
    source = _resize_fit(source_pil, MULTI_ANGLE_SIZE, MULTI_ANGLE_SIZE, bg_color=(255, 255, 255))

    # ── Step 3: Load Flux ──────────────────────────────────────────
    print("── Step 2/3: Loading Flux pipelines...")
    pipe_txt2img = _load_flux(model_variant)
    pipe_img2img = _load_flux_img2img(model_variant, txt2img_pipe=pipe_txt2img)

    if subject_type == "prop":
        studio_ctx = (
            "pure white studio background, professional product photography, "
            "soft diffused studio lighting, no shadows on background, "
            "no props, no people, no text, product isolated on white, "
            "photorealistic, ultra high resolution, commercial photography"
        )
    else:
        studio_ctx = (
            "clean neutral studio background, professional portrait photography, "
            "soft studio lighting, no distracting props, no text, "
            "photorealistic, ultra high resolution, commercial character photography"
        )

    # Signal: ready to generate
    yield {
        "event":           "init",
        "product_caption": product_caption,
        "model":           f"flux-{model_variant}",
    }

    strength_field_idx = 2 if subject_type == "prop" else 3
    # QC enabled only when Gemini API key is present
    qc_enabled = bool(os.environ.get("GEMINI_API_KEY"))
    if qc_enabled:
        print("── Gemini QC: enabled (will check angle + subject after each generation)")
    else:
        print("── Gemini QC: disabled (set GEMINI_API_KEY secret to enable)")

    # Optional: caller can pass angle_indices to generate a subset of the 16 angles.
    # Used by Step 6 (role scenes) to generate 1 front-facing shot per scene
    # instead of all 16 — saves cost + time (~16× cheaper per call).
    # angle_indices: list[int] — 0-based indices into MULTI_ANGLE_SHOTS
    # Default: None → generate all 16
    angle_indices_param = item.get("angle_indices")   # e.g. [0] for front-only
    if angle_indices_param is not None:
        angle_subset = [(i, MULTI_ANGLE_SHOTS[i]) for i in angle_indices_param
                        if 0 <= i < len(MULTI_ANGLE_SHOTS)]
    else:
        angle_subset = list(enumerate(MULTI_ANGLE_SHOTS))

    print(f"── Step 3/3: Streaming {len(angle_subset)} angle(s)...")
    total_generated = 0  # may be less than requested if QC eliminates some after retry

    for angle_idx, angle_entry in angle_subset:
        angle_name = angle_entry[0]
        angle_desc = angle_entry[1]
        strength   = angle_entry[strength_field_idx]

        if subject_type == "prop":
            prompt = (
                f"professional product photography of {product_identity}, "
                f"{angle_desc}, {studio_ctx}"
            )
        else:
            prompt = (
                f"professional studio portrait of {product_identity}, "
                f"{angle_desc}, {studio_ctx}"
            )

        adjusted_steps = max(round(num_steps / strength), num_steps)

        # ── Generate + optional Gemini QC with one retry ──────────────
        # Attempt 1: use the deterministic angle seed
        # If QC fails → Attempt 2: shift seed by 1000 + slightly raise strength
        qc_passed  = True
        qc_reason  = "qc_disabled"
        best_img   = None
        best_seed  = base_seed + angle_idx * 37
        total_time_angle = 0.0

        for attempt in range(2):  # max 2 attempts
            angle_seed = best_seed + (attempt * 1000)
            generator  = torch.Generator("cuda").manual_seed(angle_seed)
            # On retry: slightly higher strength gives the model more freedom to
            # correct the viewpoint (adds more noise, more denoising budget)
            attempt_strength = min(strength + (attempt * 0.05), 0.88)
            attempt_steps    = max(round(num_steps / attempt_strength), num_steps)

            t0 = time.time()
            result = pipe_img2img(
                prompt=prompt,
                image=source,
                strength=attempt_strength,
                width=MULTI_ANGLE_SIZE,
                height=MULTI_ANGLE_SIZE,
                num_images_per_prompt=1,
                num_inference_steps=attempt_steps,
                guidance_scale=0.0,
                generator=generator,
            )
            elapsed = round(time.time() - t0, 2)
            total_time_angle += elapsed
            img_b64 = _img_to_b64(result.images[0])

            if not qc_enabled:
                # No QC — accept immediately on first attempt
                best_img  = img_b64
                best_seed = angle_seed
                qc_passed = True
                qc_reason = "qc_disabled"
                print(f"  [{angle_idx+1}/16] {angle_name} — s={attempt_strength:.2f}, seed={angle_seed}, {elapsed}s")
                break

            # Run Gemini QC
            passed, reason = _qc_angle_gemini(img_b64, angle_name, angle_desc, product_identity)
            if passed:
                best_img  = img_b64
                best_seed = angle_seed
                qc_passed = True
                qc_reason = reason
                print(f"  [{angle_idx+1}/16] {angle_name} — s={attempt_strength:.2f}, seed={angle_seed}, {elapsed}s ✓ QC pass")
                break
            else:
                if attempt == 0:
                    # First attempt failed — log and retry
                    print(f"  [{angle_idx+1}/16] {angle_name} — QC FAIL ({reason}), retrying with seed+1000...")
                    best_img  = img_b64   # keep as fallback in case retry also fails
                    best_seed = angle_seed
                    qc_passed = False
                    qc_reason = reason
                else:
                    # Second attempt also failed — keep best_img from attempt 1 or 2
                    # We still yield the image so user sees something rather than a gap
                    print(f"  [{angle_idx+1}/16] {angle_name} — QC FAIL again ({reason}), yielding anyway (best effort)")
                    # Use attempt 2 image if we don't have a better one
                    if best_img is None:
                        best_img  = img_b64
                        best_seed = angle_seed
                    qc_passed = False
                    qc_reason = reason

        total_generated += 1

        # Yield this angle immediately — UI can render it now
        yield {
            "event":      "angle",
            "angle_idx":  angle_idx,
            "angle_name": angle_name,
            "angle_desc": angle_desc,
            "image":      best_img,
            "time":       round(total_time_angle, 2),
            "seed":       best_seed,
            "strength":   strength,
            "qc_passed":  qc_passed,
            "qc_reason":  qc_reason,
        }

    total_time = round(time.time() - t_start, 2)
    print(f"✓ Multi-angle streaming complete: {total_generated} images in {total_time}s")

    yield {
        "event":       "done",
        "total":       total_generated,
        "time":        total_time,
        "seed":        base_seed,
        "model":       f"flux-{model_variant}",
        "qc_enabled":  qc_enabled,
    }


@app.function(
    gpu="H100",
    image=image,
    volumes={"/model-cache": model_volume},
    secrets=_secrets,
    timeout=900,
    memory=16384,
)
@modal.fastapi_endpoint(method="POST", label="multi-angle-stream-endpoint")
def multi_angle_stream_endpoint(item: dict):
    """Multi-angle generation with Server-Sent Events streaming.

    Each angle streams to the browser as soon as it completes.
    UI renders angles in real-time — no waiting for all 16 to finish.

    Response: text/event-stream (SSE)
    Each event: "data: <json>\\n\\n"
    """
    import json
    from fastapi.responses import StreamingResponse

    def generate_sse():
        try:
            for event_data in _run_multi_angle_core(item):
                yield f"data: {json.dumps(event_data)}\n\n"
        except Exception as e:
            error_payload = json.dumps({"event": "error", "message": str(e)})
            yield f"data: {error_payload}\n\n"

    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",   # disable nginx buffering
        },
    )


@app.function(
    gpu="H200",
    image=image,
    volumes={"/model-cache": model_volume},
    secrets=_secrets,
    timeout=900,
    memory=16384,
)
@modal.fastapi_endpoint(method="POST", label="multi-angle-stream-turbo-endpoint")
def multi_angle_stream_turbo_endpoint(item: dict):
    """Multi-angle SSE streaming on H200 SXM (Turbo speed mode)."""
    import json
    from fastapi.responses import StreamingResponse

    def generate_sse():
        try:
            for event_data in _run_multi_angle_core(item):
                yield f"data: {json.dumps(event_data)}\n\n"
        except Exception as e:
            error_payload = json.dumps({"event": "error", "message": str(e)})
            yield f"data: {error_payload}\n\n"

    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── LoRA Training Image ──────────────────────────────────────────────────────
# Separate image from inference — training needs peft, bitsandbytes + 80GB A100
training_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("numpy==1.26.4")
    .pip_install(
        "torch==2.4.1",
        "torchvision==0.19.1",
        extra_index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "diffusers==0.32.2",
        "transformers==4.44.2",
        "accelerate==0.34.2",
        "safetensors==0.4.5",
        "peft==0.12.0",            # LoRA adapter training
        "sentencepiece==0.2.1",
        "Pillow>=10.0.0",
        "huggingface_hub>=0.20.0",
        "bitsandbytes>=0.43.0",    # 8-bit Adam optimizer (halves memory)
        "prodigyopt>=1.0",         # Prodigy optimizer (optional)
        "fastapi[standard]>=0.111.0",
        "cloudinary>=1.40.0",      # Upload .safetensors to Cloudinary after training
        "requests>=2.32.0",        # HTTP client for train_all parallel calls
    )
    .env({"PYTHONUNBUFFERED": "1"})
)

# Shared volume for training outputs (LoRA .safetensors)
training_volume = modal.Volume.from_name("geovera-lora-outputs", create_if_missing=True)

# ── Web Endpoint: LoRA Training ───────────────────────────────────────────────
# Trains a Flux LoRA on uploaded images — actor face or product appearance.
# Uses A100 80GB (enough for Flux-dev training at rank 32).
# Training time: ~25-40 min for actor (2500 steps), ~8-12 min for prop (800 steps).

@app.function(
    gpu="A100-80GB",
    image=training_image,
    volumes={
        "/model-cache":   model_volume,
        "/lora-outputs":  training_volume,
    },
    secrets=_secrets,
    timeout=3600,      # 1 hour max — LoRA training can take 15-40 min
    memory=32768,      # 32GB RAM
)
@modal.fastapi_endpoint(method="POST", label="train-lora-endpoint")
def train_lora_endpoint(item: dict) -> dict:
    """Fine-tune a Flux LoRA on character or product images.

    Body JSON:
        type          string  — "actor" | "prop"
        frames        list    — base64 PNG image list (already uploaded by client)
        captions      list    — caption per image (kohya_ss format, "ohwx ..." for actor)
        product_name  string  — used for output filename
        steps         int     — training steps (default: actor=1500, prop=800)
        lr            float   — learning rate (default: actor=5e-5, prop=1e-4)
        rank          int     — LoRA rank (default: actor=32, prop=16)

    Returns:
        { ok: bool, lora_url: str, lora_path: str, time: float, steps: int }

    Notes:
        - Model cached in /model-cache (shared volume with inference)
        - Output saved to /lora-outputs/{product_name}_{type}_{timestamp}.safetensors
        - Uploaded to Cloudinary and URL returned (ready for inference)
    """
    import gc
    import hashlib
    import tempfile
    import os

    from PIL import Image as PILImage

    t0 = time.time()

    lora_type    = item.get("type",         "actor")
    frames       = item.get("frames",       [])
    captions     = item.get("captions",     [])
    product_name = item.get("product_name", "character")
    steps        = int(item.get("steps",    2500 if lora_type == "actor" else 800))   # Flux best practice: 2500 (was 1500)
    lr           = float(item.get("lr",     2e-5 if lora_type == "actor" else 1e-4))  # Flux best practice: 2e-5 (was 5e-5)
    rank         = int(item.get("rank",     32   if lora_type == "actor" else 16))

    if not frames:
        return {"ok": False, "error": "No frames provided"}

    print(f"[train-lora] type={lora_type}, images={len(frames)}, steps={steps}, rank={rank}, lr={lr}")

    # ── Step 1: Save images + captions to temp dir ─────────────────────────
    with tempfile.TemporaryDirectory() as tmpdir:
        img_dir = os.path.join(tmpdir, "images")
        os.makedirs(img_dir, exist_ok=True)

        for i, (frame_b64, caption) in enumerate(zip(frames, captions)):
            # Decode and save image
            raw = frame_b64.split(",")[1] if "," in frame_b64 else frame_b64
            img_bytes = base64.b64decode(raw)
            img = PILImage.open(io.BytesIO(img_bytes)).convert("RGB")

            # Resize to 1024×1024 — Flux character LoRA needs high-res for facial detail
            # (512×512 loses 75% of skin pore, eye, hair texture detail — causes identity drift)
            img = img.resize((1024, 1024), PILImage.LANCZOS)

            fname = f"img_{i:03d}.png"
            img.save(os.path.join(img_dir, fname))

            # Save kohya_ss sidecar .txt caption
            if caption:
                with open(os.path.join(img_dir, f"img_{i:03d}.txt"), "w") as f:
                    f.write(caption)

        print(f"[train-lora] Saved {len(frames)} images to {img_dir}")

        # ── Step 2: Load Flux model for training ──────────────────────────────
        import torch
        from diffusers import FluxPipeline
        from peft import LoraConfig, get_peft_model
        from transformers import CLIPTextModel, T5EncoderModel

        model_id = "black-forest-labs/FLUX.1-dev"
        cache_dir = "/model-cache"

        print("[train-lora] Loading Flux pipeline for training...")
        pipe = FluxPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.bfloat16,
            cache_dir=cache_dir,
            local_files_only=False,
        )
        pipe.to("cuda")
        print("[train-lora] Flux pipeline loaded")

        # ── Step 3: Configure LoRA ────────────────────────────────────────────
        # Target transformer attention layers — same as SimpleTuner/kohya approach
        lora_config = LoraConfig(
            r=rank,
            lora_alpha=rank,            # alpha = rank → scale factor = 1.0
            init_lora_weights="gaussian",
            target_modules=[
                "to_k", "to_q", "to_v", "to_out.0",       # self-attention
                "ff.net.0.proj", "ff.net.2",                # feed-forward
            ],
        )

        # Apply LoRA to transformer
        transformer = pipe.transformer
        transformer = get_peft_model(transformer, lora_config)
        transformer.print_trainable_parameters()
        pipe.transformer = transformer

        # ── Step 4: Prepare dataset ───────────────────────────────────────────
        from torch.utils.data import Dataset, DataLoader
        import torchvision.transforms as T

        class LoraDataset(Dataset):
            def __init__(self, img_dir):
                self.paths = sorted([
                    os.path.join(img_dir, f)
                    for f in os.listdir(img_dir)
                    if f.endswith(".png") or f.endswith(".jpg")
                ])
                self.captions = []
                for p in self.paths:
                    txt = p.replace(".png", ".txt").replace(".jpg", ".txt")
                    if os.path.exists(txt):
                        with open(txt) as f:
                            self.captions.append(f.read().strip())
                    else:
                        self.captions.append("ohwx person, studio lighting")

                self.transform = T.Compose([
                    T.ToTensor(),
                    T.Normalize([0.5], [0.5]),
                ])

            def __len__(self):
                return len(self.paths)

            def __getitem__(self, idx):
                img = PILImage.open(self.paths[idx]).convert("RGB")
                return self.transform(img), self.captions[idx]

        dataset    = LoraDataset(img_dir)
        dataloader = DataLoader(dataset, batch_size=1, shuffle=True)
        print(f"[train-lora] Dataset: {len(dataset)} images")

        # ── Step 5: Train ─────────────────────────────────────────────────────
        import bitsandbytes as bnb

        optimizer = bnb.optim.AdamW8bit(
            transformer.parameters(),
            lr=lr,
            betas=(0.9, 0.999),
            weight_decay=1e-2,
        )

        # Cosine annealing scheduler — smoothly decays LR from `lr` → `lr×0.1` over training
        # Prevents late-stage overshoot that constant LR causes at end of training
        from torch.optim.lr_scheduler import CosineAnnealingLR
        scheduler = CosineAnnealingLR(optimizer, T_max=steps, eta_min=lr * 0.1)

        pipe.transformer.train()

        # Freeze everything except transformer LoRA layers
        pipe.vae.requires_grad_(False)
        pipe.text_encoder.requires_grad_(False)
        pipe.text_encoder_2.requires_grad_(False)

        global_step = 0
        log_every   = max(steps // 20, 10)   # log ~20 times during training

        print(f"[train-lora] Starting training: {steps} steps, lr={lr}, rank={rank}, scheduler=cosine")

        while global_step < steps:
            for pixel_values, texts in dataloader:
                if global_step >= steps:
                    break

                pixel_values = pixel_values.to("cuda", dtype=torch.bfloat16)

                # Encode images → latents
                with torch.no_grad():
                    latents = pipe.vae.encode(pixel_values).latent_dist.sample()
                    latents = latents * pipe.vae.config.scaling_factor

                    # Encode text
                    prompt_embeds, pooled_embeds, _ = pipe.encode_prompt(
                        prompt=list(texts),
                        prompt_2=list(texts),
                        device="cuda",
                    )

                # Add noise
                noise    = torch.randn_like(latents)
                timestep = torch.randint(0, 1000, (latents.shape[0],), device="cuda")
                noisy    = latents + noise * timestep.float().view(-1, 1, 1, 1) / 1000

                # Forward
                noise_pred = pipe.transformer(
                    hidden_states=noisy,
                    timestep=timestep / 1000,
                    encoder_hidden_states=prompt_embeds,
                    pooled_projections=pooled_embeds,
                    return_dict=False,
                )[0]

                loss = torch.nn.functional.mse_loss(noise_pred, noise)
                loss.backward()
                optimizer.step()
                optimizer.zero_grad()
                scheduler.step()  # cosine annealing: decay LR smoothly each step

                global_step += 1

                if global_step % log_every == 0 or global_step == 1:
                    elapsed_m   = (time.time() - t0) / 60
                    eta_m       = (elapsed_m / global_step) * (steps - global_step)
                    current_lr  = scheduler.get_last_lr()[0]
                    print(f"  step {global_step}/{steps} | loss={loss.item():.4f} | lr={current_lr:.2e} | {elapsed_m:.1f}min elapsed | ~{eta_m:.1f}min left")

        print(f"[train-lora] Training done in {(time.time()-t0)/60:.1f} min")

        # ── Step 6: Save LoRA weights ────────────────────────────────────────
        safe_name = product_name.lower().replace(" ", "_").replace("/", "_")[:32]
        ts        = int(time.time())
        out_name  = f"{safe_name}_{lora_type}_{ts}.safetensors"
        out_path  = f"/lora-outputs/{out_name}"

        transformer.save_pretrained(out_path, safe_serialization=True)
        # Commit the volume so files are immediately accessible
        training_volume.commit()
        print(f"[train-lora] Saved LoRA to {out_path}")

        # ── Step 7: Upload LoRA to Cloudinary ────────────────────────────────
        # Upload .safetensors as a raw file so it can be downloaded by URL.
        # This avoids needing to download from Modal volume manually.
        cloudinary_url = None
        try:
            import cloudinary
            import cloudinary.uploader

            cloud_name = os.environ.get("CLOUDINARY_CLOUD_NAME", "")
            api_key    = os.environ.get("CLOUDINARY_API_KEY", "")
            api_secret = os.environ.get("CLOUDINARY_API_SECRET", "")

            if cloud_name and api_key and api_secret:
                cloudinary.config(
                    cloud_name=cloud_name,
                    api_key=api_key,
                    api_secret=api_secret,
                )
                public_id = f"geovera-loras/{safe_name}_{lora_type}_{ts}"
                upload_result = cloudinary.uploader.upload(
                    out_path,
                    resource_type="raw",          # .safetensors is a binary file, not image
                    public_id=public_id,
                    overwrite=True,
                    use_filename=False,
                )
                cloudinary_url = upload_result.get("secure_url")
                print(f"[train-lora] Uploaded to Cloudinary: {cloudinary_url}")
            else:
                print("[train-lora] Cloudinary env vars not set — skipping upload")
        except Exception as e:
            print(f"[train-lora] Cloudinary upload failed (non-fatal): {e}")

        # ── Step 8: Return result ─────────────────────────────────────────────
        elapsed_total = round(time.time() - t0, 1)
        lora_url = cloudinary_url or f"modal-volume://{out_path}"
        return {
            "ok":            True,
            "lora_path":     out_path,
            "lora_name":     out_name,
            "lora_url":      lora_url,          # Cloudinary URL (ready to use in TikTok Ads)
            "cloudinary_url": cloudinary_url,   # explicit field for UI
            "steps":         global_step,
            "time":          elapsed_total,
            "type":          lora_type,
            "images_used":   len(frames),
            "message":       (
                f"✅ LoRA trained in {elapsed_total:.0f}s ({global_step} steps). "
                + (f"Cloudinary URL: {cloudinary_url}" if cloudinary_url
                   else f"Saved to Modal volume: {out_path}")
            ),
        }


# ── LoRA Training on H100 (Modal Function — not a web endpoint) ──────────────
# H100 80GB — ~35% faster than A100-80GB for transformer training.
# $0.001097/sec ≈ $3.95/hr · 2500 steps ≈ 28-35 min ≈ ~$1.95/run
# Note: removed @fastapi_endpoint to free up web endpoint slot for character-agent.
# Call via train_lora_endpoint with gpu param, or train-all-characters uses .remote()

@app.function(
    gpu="H100",
    image=training_image,
    volumes={
        "/model-cache":  model_volume,
        "/lora-outputs": training_volume,
    },
    secrets=_secrets,
    timeout=3600,
    memory=32768,
)
def train_lora_h100_endpoint(item: dict) -> dict:
    """Train LoRA on H100 80GB. Same logic as train_lora_endpoint, faster GPU."""
    return train_lora_endpoint(item)


# ── LoRA Training on H200 (Modal Function — not a web endpoint) ──────────────
# H200 SXM 141GB — ~45% faster than A100-80GB, larger VRAM → bigger batch.
# $0.001261/sec ≈ $4.54/hr · 2500 steps ≈ 22-28 min ≈ ~$1.90/run
# Note: removed @fastapi_endpoint to free up web endpoint slot for character-agent.

@app.function(
    gpu="H200",
    image=training_image,
    volumes={
        "/model-cache":  model_volume,
        "/lora-outputs": training_volume,
    },
    secrets=_secrets,
    timeout=3600,
    memory=32768,
)
def train_lora_h200_endpoint(item: dict) -> dict:
    """Train LoRA on H200 SXM 141GB. ~45% faster than A100, larger VRAM."""
    return train_lora_endpoint(item)


# ── Shared Job Store (Modal Dict) ────────────────────────────────────────────
# Modal Dict persists across invocations — used as a job status store.
# Key  : job_id  (str)
# Value: { "status": "pending"|"running"|"done"|"error",
#          "characters": [...],      # original request
#          "results": [...],         # filled in as each char completes
#          "started_at": float,
#          "total_time": float|None,
#          "total_cost_usd": float|None,
#          "message": str }

_jobs_dict = modal.Dict.from_name("geovera-train-jobs", create_if_missing=True)


# ── Web Endpoint: Batch Train 4 Characters in Parallel ───────────────────────
# Fire-and-forget: returns jobId immediately, training runs in background thread.
# Browser polls /train-all-status-endpoint?job_id=... to track progress.
#
# GPU allocation (user request: 2x H100 + 2x H200):
#   char 0 → H100  · Actor/Prop LoRA · 2500 steps · ~$1.95
#   char 1 → H100  · Actor/Prop LoRA · 2500 steps · ~$1.95
#   char 2 → H200  · Actor/Prop LoRA · 2500 steps · ~$1.90
#   char 3 → H200  · Actor/Prop LoRA · 2500 steps · ~$1.90
#   Total parallel cost: ~$7.70  (vs ~$7.70 sequential but 4x faster wall-clock)
#
# Cost reference (Modal pricing 2026):
#   H100: $0.001097/sec  H200: $0.001261/sec  A100-80GB: $0.000694/sec

@app.function(
    image=training_image,    # CPU-only orchestrator, no GPU needed
    secrets=_secrets,
    timeout=7200,            # 2 hour ceiling — actual work is on sub-functions
    memory=2048,
)
@modal.asgi_app(label="train-all-characters-endpoint")
def train_all_characters_endpoint():
    """FastAPI ASGI app — handles both POST (start) and GET (status poll).

    POST  /train-all-characters-endpoint        → start training, returns { ok, job_id }
    GET   /train-all-characters-endpoint/status → poll status by ?job_id=<id>

    Combined into one endpoint to stay within Modal free-plan 8-endpoint limit.
    """
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse

    _app = FastAPI()

    @_app.post("/")
    async def _start(request: Request):
        item = await request.json()
        result = _train_all_start(item)
        return JSONResponse(result)

    @_app.post("/single")
    async def _start_single(request: Request):
        """Train a single character — wraps _train_single_start → fire-and-forget."""
        item = await request.json()
        result = _train_single_start(item)
        return JSONResponse(result)

    @_app.get("/status")
    async def _status(job_id: str = ""):
        result = _train_all_poll(job_id)
        return JSONResponse(result)

    return _app


def _train_all_start(item: dict) -> dict:
    """Train LoRA for up to 4 characters in parallel — FIRE AND FORGET.

    Returns { ok, job_id } immediately (within 1s).
    Training runs in a background thread on this Modal container.
    Poll /train-all-status-endpoint?job_id=<id> to track progress.

    Body JSON:
        characters   list  — up to 4 items, each:
            {
              "name":        string,   — character name (e.g. "Rio")
              "type":        string,   — "actor" | "prop"
              "frames":      list,     — base64 PNG images
              "captions":    list,     — captions per image
              "steps":       int,      — optional (default actor=2500, prop=800)
              "lr":          float,    — optional (default actor=2e-5, prop=1e-4)
              "rank":        int,      — optional (default actor=32, prop=16)
            }
    """
    import concurrent.futures
    import threading
    import uuid

    # GPU-cost constants (Modal 2026 pricing, per second)
    GPU_COST_PER_SEC = {"H100": 0.001097, "H200": 0.001261, "A100-80GB": 0.000694}

    characters = item.get("characters", [])
    if not characters:
        return {"ok": False, "error": "No characters provided"}
    if len(characters) > 4:
        characters = characters[:4]   # cap at 4

    # Generate unique job ID
    job_id = f"job_{uuid.uuid4().hex[:12]}"

    # Assign GPUs: first 2 on H100, last 2 on H200
    gpu_assignment = ["H100", "H100", "H200", "H200"]

    # Map GPU label → endpoint URL
    gpu_urls = {
        "H100": "https://andrewsus83-design--train-lora-h100-endpoint.modal.run",
        "H200": "https://andrewsus83-design--train-lora-h200-endpoint.modal.run",
    }

    # Initialize job state in Modal Dict
    _jobs_dict[job_id] = {
        "status":        "running",
        "characters":    [{"name": c.get("name", f"char{i}"), "gpu": gpu_assignment[min(i, 3)]} for i, c in enumerate(characters)],
        "results":       [],
        "started_at":    time.time(),
        "total_time":    None,
        "total_cost_usd": None,
        "message":       f"⏳ Training {len(characters)} characters in parallel...",
    }

    print(f"[train-all] Job {job_id} | {len(characters)} characters | returning immediately")

    import requests as req_lib   # available in training_image

    def train_one(idx: int, char: dict) -> dict:
        gpu   = gpu_assignment[min(idx, len(gpu_assignment) - 1)]
        url   = gpu_urls[gpu]
        name  = char.get("name", f"char{idx}")
        t0    = time.time()

        lora_type_local = char.get("type", "actor")
        default_steps   = 2500 if lora_type_local == "actor" else 800
        default_lr      = 2e-5 if lora_type_local == "actor" else 1e-4
        default_rank    = 32   if lora_type_local == "actor" else 16
        print(f"  [{name}] → {gpu} | {len(char.get('frames', []))} images | {char.get('steps', default_steps)} steps")

        payload = {
            "type":         lora_type_local,
            "frames":       char.get("frames",        []),
            "captions":     char.get("captions",      []),
            "product_name": name,
            "steps":        char.get("steps",         default_steps),
            "lr":           char.get("lr",            default_lr),
            "rank":         char.get("rank",          default_rank),
        }

        try:
            resp    = req_lib.post(url, json=payload, timeout=3600)
            result  = resp.json()
            elapsed = round(time.time() - t0, 1)
            cost    = round(elapsed * GPU_COST_PER_SEC.get(gpu, 0.001097), 4)

            print(f"  [{name}] ✓ done in {elapsed:.0f}s on {gpu} | cost ~${cost:.2f}")

            return {
                "name":              name,
                "gpu":               gpu,
                "ok":                result.get("ok", False),
                "lora_name":         result.get("lora_name"),
                "lora_path":         result.get("lora_path"),
                "cloudinary_url":    result.get("cloudinary_url"),
                "steps":             result.get("steps"),
                "time":              elapsed,
                "cost_usd":          cost,
                "message":           result.get("message", ""),
                "error":             result.get("error"),
            }
        except Exception as e:
            elapsed = round(time.time() - t0, 1)
            print(f"  [{name}] ✗ error: {e}")
            return {
                "name":     name,
                "gpu":      gpu,
                "ok":       False,
                "time":     elapsed,
                "cost_usd": round(elapsed * GPU_COST_PER_SEC.get(gpu, 0.001097), 4),
                "error":    str(e),
            }

    def run_training_background():
        """Run in background thread — updates Modal Dict as results come in."""
        t_start = time.time()

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = {
                executor.submit(train_one, i, char): i
                for i, char in enumerate(characters)
            }
            for future in concurrent.futures.as_completed(futures):
                char_result = future.result()

                # Update Dict with each completed character (partial results)
                try:
                    current = _jobs_dict[job_id]
                    current_results = current.get("results", [])
                    current_results.append(char_result)
                    done_count = len(current_results)
                    total_count = len(characters)
                    _jobs_dict[job_id] = {
                        **current,
                        "results": current_results,
                        "status":  "running",
                        "message": f"⏳ {done_count}/{total_count} characters done...",
                    }
                except Exception as dict_err:
                    print(f"  [dict update error] {dict_err}")

        # All done — compute final stats
        wall_clock   = round(time.time() - t_start, 1)
        final        = _jobs_dict[job_id]
        results      = final.get("results", [])
        total_cost   = round(sum(r.get("cost_usd", 0) for r in results), 4)
        seq_est      = round(sum(r.get("time", 0) for r in results), 1)
        speedup      = round(seq_est / max(wall_clock, 1), 2)
        ok_count     = len([r for r in results if r.get("ok")])

        # Sort results by original character order
        name_order = [c.get("name", f"char{i}") for i, c in enumerate(characters)]
        results.sort(key=lambda r: name_order.index(r["name"]) if r["name"] in name_order else 99)

        _jobs_dict[job_id] = {
            **final,
            "status":          "done",
            "results":         results,
            "total_time":      wall_clock,
            "total_cost_usd":  total_cost,
            "parallel_speedup": speedup,
            "message": (
                f"✅ {ok_count}/{len(results)} LoRAs trained "
                f"in {wall_clock:.0f}s (parallel ~{speedup}x speedup). "
                f"Total GPU cost ~${total_cost:.2f}"
            ),
        }
        print(f"[train-all] Job {job_id} DONE! wall={wall_clock:.0f}s cost=${total_cost:.2f}")

    # Kick off background thread — do NOT join (fire and forget)
    bg_thread = threading.Thread(target=run_training_background, daemon=True)
    bg_thread.start()

    return {
        "ok":     True,
        "job_id": job_id,
        "message": f"⏳ Training dimulai untuk {len(characters)} karakter. Poll status dengan job_id.",
        "characters": [c.get("name", f"char{i}") for i, c in enumerate(characters)],
    }


def _train_all_poll(job_id: str) -> dict:
    """Poll job status from Modal Dict. Used by GET /status route."""
    if not job_id:
        return {"ok": False, "error": "job_id is required"}

    try:
        job = _jobs_dict[job_id]
    except KeyError:
        return {"ok": False, "error": f"Job '{job_id}' not found"}

    return {
        "ok":              True,
        "job_id":          job_id,
        "status":          job.get("status", "unknown"),
        "results":         job.get("results", []),
        "characters":      job.get("characters", []),
        "total_time":      job.get("total_time"),
        "total_cost_usd":  job.get("total_cost_usd"),
        "parallel_speedup": job.get("parallel_speedup"),
        "started_at":      job.get("started_at"),
        "message":         job.get("message", ""),
    }


def _train_single_start(item: dict) -> dict:
    """Fire-and-forget: kick off single character LoRA training in background thread.

    Returns { ok, job_id } immediately (< 1s).
    Training runs on train-lora-endpoint (A100-80GB) in background thread.
    Poll /status?job_id=<id> to track progress.

    Body JSON: same as train_lora_endpoint
        type, frames, captions, product_name, steps, lr, rank
    """
    import threading
    import uuid
    import requests as req_lib

    GPU_COST_PER_SEC = {"A100-80GB": 0.000694}
    TRAIN_URL = "https://andrewsus83-design--train-lora-endpoint.modal.run"

    lora_type    = item.get("type", "actor")
    product_name = item.get("product_name", item.get("productName", "character"))
    frames       = item.get("frames", [])

    if not frames:
        return {"ok": False, "error": "No frames provided"}

    job_id = f"single_{uuid.uuid4().hex[:12]}"

    # Initialize job in Modal Dict
    _jobs_dict[job_id] = {
        "status":        "running",
        "characters":    [{"name": product_name, "gpu": "A100-80GB"}],
        "results":       [],
        "started_at":    time.time(),
        "total_time":    None,
        "total_cost_usd": None,
        "message":       f"⏳ Training {product_name} ({lora_type}) — {len(frames)} images...",
    }

    print(f"[train-single] Job {job_id} | {product_name} | {len(frames)} images | returning immediately")

    def run_training():
        t0 = time.time()
        try:
            payload = {
                "type":         lora_type,
                "frames":       frames,
                "captions":     item.get("captions", []),
                "product_name": product_name,
                "steps":        int(item.get("steps", 2500 if lora_type == "actor" else 800)),
                "lr":           float(item.get("lr", 2e-5 if lora_type == "actor" else 1e-4)),
                "rank":         int(item.get("rank", 32 if lora_type == "actor" else 16)),
            }

            resp    = req_lib.post(TRAIN_URL, json=payload, timeout=3600)
            result  = resp.json()
            elapsed = round(time.time() - t0, 1)
            cost    = round(elapsed * GPU_COST_PER_SEC["A100-80GB"], 4)
            ok      = result.get("ok", False)

            char_result = {
                "name":           product_name,
                "gpu":            "A100-80GB",
                "ok":             ok,
                "lora_name":      result.get("lora_name"),
                "lora_path":      result.get("lora_path"),
                "cloudinary_url": result.get("cloudinary_url"),
                "steps":          result.get("steps"),
                "time":           elapsed,
                "cost_usd":       cost,
                "message":        result.get("message", ""),
                "error":          result.get("error"),
            }

            _jobs_dict[job_id] = {
                "status":        "done" if ok else "error",
                "characters":    [{"name": product_name, "gpu": "A100-80GB"}],
                "results":       [char_result],
                "started_at":    _jobs_dict[job_id].get("started_at", t0),
                "total_time":    elapsed,
                "total_cost_usd": cost,
                "message": (
                    f"✅ LoRA training selesai! {result.get('steps', 0):,} steps in {elapsed:.0f}s. Cost ~${cost:.2f}"
                    if ok else
                    f"❌ Training gagal: {result.get('error', 'unknown error')}"
                ),
            }
            print(f"[train-single] Job {job_id} DONE | ok={ok} | {elapsed:.0f}s | ${cost:.2f}")

        except Exception as e:
            elapsed = round(time.time() - t0, 1)
            cost    = round(elapsed * GPU_COST_PER_SEC["A100-80GB"], 4)
            _jobs_dict[job_id] = {
                "status":        "error",
                "characters":    [{"name": product_name, "gpu": "A100-80GB"}],
                "results":       [{
                    "name": product_name, "gpu": "A100-80GB",
                    "ok": False, "time": elapsed, "cost_usd": cost, "error": str(e),
                }],
                "started_at":    _jobs_dict[job_id].get("started_at", t0),
                "total_time":    elapsed,
                "total_cost_usd": cost,
                "message":       f"❌ Training error: {e}",
            }
            print(f"[train-single] Job {job_id} ERROR: {e}")

    bg = threading.Thread(target=run_training, daemon=True)
    bg.start()

    return {
        "ok":     True,
        "job_id": job_id,
        "message": f"⏳ Training dimulai untuk {product_name}. Poll status dengan job_id.",
    }


# ── Legacy functions (for modal run / local testing) ──────────────

@app.function(
    gpu="H100",  # 80GB VRAM — fastest for FLUX.1, full GPU load no offload needed
    image=image,
    volumes={"/model-cache": model_volume},
    secrets=_secrets,
    timeout=300,
    memory=16384,
)
def generate(
    prompt: str,
    width: int = 768,
    height: int = 1344,
    num_images: int = 1,
    num_steps: int = 4,
    guidance_scale: float = 0.0,
    seed: int = 42,
    model_variant: str = "schnell",
) -> dict:
    """Text-to-image (used by modal run for local testing)."""
    import torch

    t0   = time.time()
    pipe = _load_flux(model_variant)
    generator = torch.Generator("cuda").manual_seed(seed)
    result = pipe(
        prompt=prompt,
        width=width,
        height=height,
        num_images_per_prompt=num_images,
        num_inference_steps=num_steps,
        guidance_scale=guidance_scale if model_variant == "dev" else 0.0,
        generator=generator,
    )
    images_b64 = [_img_to_b64(img) for img in result.images]
    elapsed    = round(time.time() - t0, 2)
    print(f"✓ Generated {len(images_b64)} image(s) in {elapsed}s")
    return {"images": images_b64, "time": elapsed, "model": f"flux-{model_variant}"}


# ── Character AI Agent ───────────────────────────────────────────────────────
# LangGraph multi-agent + skill evolution. Single ASGI endpoint (counts as 1
# web endpoint) exposing /health, /chat, /conversation, /reflect.
# H100/H200 train endpoints removed as web endpoints (still callable as Modal
# Functions) to free 2 slots; this agent uses 1 → net 7 web endpoints total.

_char_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi[standard]",
        "uvicorn",
        "pydantic>=2.0",
        "supabase",
        "langgraph>=0.2",
        "langchain-core>=0.2",
        "langchain-openai>=0.1",
        "langchain-anthropic>=0.1",
        "langchain-groq>=0.1",
        "httpx",
        "google-search-results",  # SerpAPI Python client
        "apify-client",           # Apify web scraping for CMO deep research
    )
)

_char_secret = modal.Secret.from_name("supabase-character-secret")


@app.function(
    image=_char_image,
    secrets=[_char_secret],
    timeout=300,
    min_containers=1,
)
@modal.asgi_app(label="character-agent-endpoint")
def character_agent_endpoint():
    """Character AI Agent — LangGraph + Multi-LLM

    GET  /health         — health check
    POST /chat           — single character chat
    POST /conversation   — N-character LangGraph discussion
    POST /reflect        — skill evolution (analyze history -> update profile)
    """
    import hashlib
    import json
    import operator
    import os
    import re
    from typing import Annotated, Any, Literal, Optional, TypedDict

    from fastapi import FastAPI, Header, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel, Field

    _web = FastAPI(title="Character AI Agent", version="1.0.0")
    _web.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"],
    )

    class LLMProviderConfig(BaseModel):
        provider: Literal["openai", "anthropic", "groq", "ollama", "perplexity"] = "openai"
        model: str = "gpt-4o-mini"
        api_key: Optional[str] = None
        endpoint: Optional[str] = None
        temperature: float = 0.75
        max_tokens: int = 1024

    class ChatRequest(BaseModel):
        character_id: str
        message: str
        conversation_id: Optional[str] = None
        llm: Optional[LLMProviderConfig] = None   # None = auto-select by role
        save_to_db: bool = True

    class ChatResponse(BaseModel):
        character_id: str
        character_name: str
        reply: str
        conversation_id: str
        tokens_used: Optional[int] = None
        llm_used: Optional[str] = None            # which provider/model was used

    class ConversationRequest(BaseModel):
        character_ids: list[str]
        topic: str
        user_message: Optional[str] = None
        max_rounds: int = Field(default=3, ge=1, le=10)
        llm: Optional[LLMProviderConfig] = None   # None = each char uses own role config
        save_to_db: bool = True

    class ConversationResponse(BaseModel):
        conversation_id: str
        messages: list[dict]
        rounds_completed: int

    class ReflectRequest(BaseModel):
        character_id: str
        conversation_id: Optional[str] = None
        last_n_messages: int = Field(default=20, ge=5, le=100)
        llm: Optional[LLMProviderConfig] = None

    class ReflectResponse(BaseModel):
        character_id: str
        character_name: str
        skills_before: dict
        skills_after: dict
        diff_summary: dict
        messages_analyzed: int

    # ── Role → LLM defaults ───────────────────────────────────────────────────
    # Maps role id → (primary_provider, primary_model, secondary_provider, secondary_model)
    # secondary=None means single LLM. When secondary exists, we use ensemble:
    #   primary generates → secondary refines/validates → return merged reply.
    #
    # CEO        : OpenAI (strategic framing) + Claude (nuance / stakeholder insight)
    # CMO        : Perplexity (live web search) — research-first role
    # CTO        : Claude only (best code & architecture reasoning)
    # developer  : Claude only
    # engineer   : Claude only
    # sales      : OpenAI (persuasion) + Claude (emotional intelligence)
    # creator    : OpenAI (engaging tone) + Claude (narrative depth)
    # analyst    : OpenAI (structured data) + Claude (interpretive reasoning)
    # host       : OpenAI (conversational flow) + Claude (warmth / empathy)
    # designer   : OpenAI (creative briefs) + Claude (aesthetic rationale)
    # support    : OpenAI (friendly tone) + Claude (resolution quality)
    # default    : OpenAI gpt-4o-mini (fallback)

    ROLE_LLM_MAP: dict[str, dict] = {
        "ceo":       {"primary": ("openai",     "gpt-4o"),        "secondary": ("anthropic", "claude-opus-4-5")},
        "cmo":       {"primary": ("perplexity",  "sonar-pro"),     "secondary": None},
        "cto":       {"primary": ("anthropic",   "claude-opus-4-5"), "secondary": None},
        "developer": {"primary": ("anthropic",   "claude-sonnet-4-5"), "secondary": None},
        "engineer":  {"primary": ("anthropic",   "claude-sonnet-4-5"), "secondary": None},
        "sales":     {"primary": ("openai",      "gpt-4o"),        "secondary": ("anthropic", "claude-sonnet-4-5")},
        "creator":   {"primary": ("openai",      "gpt-4o-mini"),   "secondary": ("anthropic", "claude-sonnet-4-5")},
        "analyst":   {"primary": ("openai",      "gpt-4o"),        "secondary": ("anthropic", "claude-sonnet-4-5")},
        "host":      {"primary": ("openai",      "gpt-4o-mini"),   "secondary": ("anthropic", "claude-sonnet-4-5")},
        "designer":  {"primary": ("openai",      "gpt-4o-mini"),   "secondary": ("anthropic", "claude-sonnet-4-5")},
        "support":   {"primary": ("openai",      "gpt-4o-mini"),   "secondary": ("anthropic", "claude-sonnet-4-5")},
    }
    DEFAULT_LLM = LLMProviderConfig(provider="openai", model="gpt-4o-mini")

    # ── API cost estimates (USD per call, rough) ──────────────────────────────
    COST_PER_CALL: dict[str, float] = {
        "openai_gpt4o":        0.010,
        "openai_gpt4o_mini":   0.001,
        "anthropic_opus":      0.020,
        "anthropic_sonnet":    0.004,
        "anthropic_haiku":     0.001,
        "perplexity_sonar_pro":0.005,
        "groq_llama":          0.000,
        "serpapi":             0.002,
        "firecrawl":           0.002,
        "apify":               0.005,
    }

    # Fallback chain: if budget exhausted, use next cheaper option
    FALLBACK_LLM: dict[str, LLMProviderConfig] = {
        "openai_gpt4o":        LLMProviderConfig(provider="openai",     model="gpt-4o-mini"),
        "anthropic_opus":      LLMProviderConfig(provider="anthropic",  model="claude-haiku-4-5"),
        "anthropic_sonnet":    LLMProviderConfig(provider="anthropic",  model="claude-haiku-4-5"),
        "perplexity_sonar_pro":LLMProviderConfig(provider="openai",     model="gpt-4o-mini"),
    }

    def _api_key_name(cfg: LLMProviderConfig) -> str:
        """Map LLMProviderConfig to api_budget row name."""
        m = cfg.model.lower()
        if cfg.provider == "openai":
            if "gpt-4o-mini" in m: return "openai_gpt4o_mini"
            if "gpt-4o" in m:      return "openai_gpt4o"
        elif cfg.provider == "anthropic":
            if "opus" in m:        return "anthropic_opus"
            if "haiku" in m:       return "anthropic_haiku"
            return                        "anthropic_sonnet"
        elif cfg.provider == "perplexity":
            return "perplexity_sonar_pro"
        elif cfg.provider == "groq":
            return "groq_llama"
        return "openai_gpt4o_mini"

    def _budget_consume(sb, api_name: str) -> bool:
        """Check budget and consume. Returns True=ok, False=skip (budget done)."""
        from datetime import date
        today = date.today().isoformat()
        cost  = COST_PER_CALL.get(api_name, 0.001)

        try:
            row = sb.table("api_budget") \
                .select("id, daily_limit, calls_today, cost_usd") \
                .eq("api_name", api_name) \
                .eq("budget_date", today) \
                .maybe_single().execute()

            if not row.data:
                # First call today — seed row
                prev = sb.table("api_budget") \
                    .select("daily_limit") \
                    .eq("api_name", api_name) \
                    .order("budget_date", desc=True) \
                    .limit(1).execute()
                limit = prev.data[0]["daily_limit"] if prev.data else 50
                sb.table("api_budget").insert({
                    "api_name": api_name, "budget_date": today,
                    "daily_limit": limit, "calls_today": 1,
                    "cost_usd": cost,
                }).execute()
                return True

            calls_today = row.data["calls_today"]
            daily_limit = row.data["daily_limit"]

            if calls_today >= daily_limit:
                return False  # budget exhausted

            sb.table("api_budget").update({
                "calls_today": calls_today + 1,
                "cost_usd": float(row.data["cost_usd"]) + cost,
            }).eq("api_name", api_name).eq("budget_date", today).execute()
            return True

        except Exception:
            return True  # fail open — don't block on budget error

    def resolve_role_llm_with_budget(char: dict, sb) -> dict:
        """
        Like resolve_role_llm but checks budget and falls back to cheaper model
        if the preferred tier is exhausted for today.
        Returns {primary, secondary, role, fallback_used: bool}
        """
        base = resolve_role_llm(char)
        primary_cfg: LLMProviderConfig = base["primary"]
        primary_key = _api_key_name(primary_cfg)

        allowed = _budget_consume(sb, primary_key)
        if allowed:
            return {**base, "fallback_used": False}

        # Budget exhausted — try fallback
        fallback_cfg = FALLBACK_LLM.get(primary_key)
        if fallback_cfg:
            fb_key = _api_key_name(fallback_cfg)
            _budget_consume(sb, fb_key)  # consume fallback budget (best effort)
            return {"primary": fallback_cfg, "secondary": None, "role": base["role"], "fallback_used": True}

        # No fallback available (gpt-4o-mini, haiku, groq) — allow anyway
        return {**base, "fallback_used": False}

    def resolve_role_llm(char: dict) -> dict:
        """Return {primary: LLMProviderConfig, secondary: LLMProviderConfig|None} for a character."""
        roles: list[str] = char.get("personality", {}).get("roles", [])
        # use first recognized role
        for r in roles:
            if r in ROLE_LLM_MAP:
                cfg = ROLE_LLM_MAP[r]
                p_prov, p_model = cfg["primary"]
                primary = LLMProviderConfig(provider=p_prov, model=p_model)
                secondary = None
                if cfg["secondary"]:
                    s_prov, s_model = cfg["secondary"]
                    secondary = LLMProviderConfig(provider=s_prov, model=s_model)
                return {"primary": primary, "secondary": secondary, "role": r}
        return {"primary": DEFAULT_LLM, "secondary": None, "role": "default"}

    def build_llm(cfg: LLMProviderConfig):
        """Build a LangChain chat model. API keys resolved from env if not in cfg."""
        if cfg.provider == "openai":
            from langchain_openai import ChatOpenAI
            kw: dict[str, Any] = {"model": cfg.model, "temperature": cfg.temperature, "max_tokens": cfg.max_tokens}
            key = cfg.api_key or os.environ.get("OPENAI_API_KEY")
            if key: kw["api_key"] = key
            if cfg.endpoint: kw["base_url"] = cfg.endpoint
            return ChatOpenAI(**kw)
        elif cfg.provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            kw = {"model": cfg.model, "temperature": cfg.temperature, "max_tokens": cfg.max_tokens}
            key = cfg.api_key or os.environ.get("ANTHROPIC_API_KEY")
            if key: kw["api_key"] = key
            return ChatAnthropic(**kw)
        elif cfg.provider == "groq":
            from langchain_groq import ChatGroq
            kw = {"model": cfg.model, "temperature": cfg.temperature, "max_tokens": cfg.max_tokens}
            key = cfg.api_key or os.environ.get("GROQ_API_KEY")
            if key: kw["groq_api_key"] = key
            return ChatGroq(**kw)
        elif cfg.provider == "perplexity":
            # Perplexity exposes an OpenAI-compatible API at api.perplexity.ai
            from langchain_openai import ChatOpenAI
            key = cfg.api_key or os.environ.get("PERPLEXITY_API_KEY", "")
            return ChatOpenAI(
                model=cfg.model,
                temperature=cfg.temperature,
                max_tokens=cfg.max_tokens,
                base_url="https://api.perplexity.ai",
                api_key=key,
            )
        elif cfg.provider == "ollama":
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(model=cfg.model, temperature=cfg.temperature, max_tokens=cfg.max_tokens,
                              base_url=cfg.endpoint or "http://localhost:11434/v1", api_key="ollama")
        raise ValueError(f"Unknown provider: {cfg.provider}")

    def invoke_with_role(char: dict, lc_messages: list, caller_llm: Optional[LLMProviderConfig], sb=None) -> tuple[str, str]:
        """Invoke LLM respecting role config + daily budget limits.
        Returns (reply, llm_label).

        Priority: highest-impact model first → fallback to cheaper if budget exhausted.
        - caller_llm override: bypass budget (explicit client choice)
        - auto mode: check budget, fallback chain if exhausted
        """
        from langchain_core.messages import HumanMessage, SystemMessage

        if caller_llm is not None:
            # Caller override — respect it, no ensemble, no budget check
            llm = build_llm(caller_llm)
            reply = llm.invoke(lc_messages).content.strip()
            return reply, f"{caller_llm.provider}/{caller_llm.model}"

        # Budget-aware role resolution (sb=None → skip budget, use base resolve)
        if sb is not None:
            role_cfg = resolve_role_llm_with_budget(char, sb)
        else:
            role_cfg = resolve_role_llm(char)
            role_cfg["fallback_used"] = False

        primary_cfg: LLMProviderConfig = role_cfg["primary"]
        secondary_cfg: Optional[LLMProviderConfig] = role_cfg["secondary"]
        role_label: str = role_cfg["role"]
        fallback_used: bool = role_cfg.get("fallback_used", False)

        # CMO: inject web search context before LLM call
        # Pass sb for search tool budget checks
        if role_label == "cmo":
            enriched = _cmo_enrich(lc_messages, sb=sb)
            reply = build_llm(primary_cfg).invoke(enriched).content.strip()
            label = f"perplexity/{primary_cfg.model}+search"
            if fallback_used:
                label = f"{primary_cfg.provider}/{primary_cfg.model}+search[fallback]"
            return reply, label

        primary_llm = build_llm(primary_cfg)

        # If fallback was used or secondary budget unavailable → single LLM
        if secondary_cfg is None or fallback_used:
            reply = primary_llm.invoke(lc_messages).content.strip()
            suffix = "[fallback]" if fallback_used else ""
            return reply, f"{primary_cfg.provider}/{primary_cfg.model}{suffix}"

        # Ensemble: check secondary budget before calling it
        secondary_key = _api_key_name(secondary_cfg)
        secondary_allowed = _budget_consume(sb, secondary_key) if sb else True

        draft = primary_llm.invoke(lc_messages).content.strip()

        if not secondary_allowed:
            # Secondary budget exhausted — return primary draft directly
            return draft, f"{primary_cfg.provider}/{primary_cfg.model}[secondary-skipped]"

        # Build refine prompt for secondary
        sys_content = lc_messages[0].content if lc_messages else ""
        user_content = lc_messages[-1].content if lc_messages else ""
        refine_messages = [
            SystemMessage(content=(
                f"{sys_content}\n\n"
                "You are reviewing and enhancing a draft response. "
                "Keep the character's voice. Improve clarity, depth, and authenticity. "
                "Return ONLY the final polished response, no commentary."
            )),
            HumanMessage(content=f"Original question: {user_content}\n\nDraft response:\n{draft}"),
        ]
        secondary_llm = build_llm(secondary_cfg)
        final_reply = secondary_llm.invoke(refine_messages).content.strip()
        llm_label = f"{primary_cfg.provider}/{primary_cfg.model}+{secondary_cfg.provider}/{secondary_cfg.model}"
        return final_reply, llm_label

    def _cmo_enrich(lc_messages: list, sb=None) -> list:
        """For CMO role: prepend web search results to the conversation context.
        Checks daily budget for each search tool (serpapi, firecrawl, apify).
        Priority: SerpAPI (cheapest, broadest) → Firecrawl (content) → Apify (deep scrape).
        Tools are skipped if budget is exhausted for the day.
        """
        import httpx
        from langchain_core.messages import HumanMessage, SystemMessage

        # Extract user query from last human message
        user_query = ""
        for m in reversed(lc_messages):
            if isinstance(m, HumanMessage):
                user_query = m.content
                break

        search_context = ""

        # 1. SerpAPI (Google search results) — highest priority: cheapest, most reliable
        serp_allowed = _budget_consume(sb, "serpapi") if sb else True
        serp_key = os.environ.get("SERPAPI_API_KEY", "")
        if serp_key and user_query and serp_allowed:
            try:
                r = httpx.get(
                    "https://serpapi.com/search",
                    params={"q": user_query, "api_key": serp_key, "num": 5},
                    timeout=10,
                )
                data = r.json()
                results = data.get("organic_results", [])[:5]
                if results:
                    search_context += "## Google Search Results\n"
                    for res in results:
                        search_context += f"- [{res.get('title','')}]({res.get('link','')}): {res.get('snippet','')}\n"
            except Exception:
                pass

        # 2. Firecrawl — only if serpapi didn't fill context OR budget available
        firecrawl_allowed = _budget_consume(sb, "firecrawl") if sb else True
        firecrawl_key = os.environ.get("FIRECRAWL_API_KEY", "")
        if firecrawl_key and user_query and firecrawl_allowed:
            try:
                r = httpx.post(
                    "https://api.firecrawl.dev/v1/search",
                    headers={"Authorization": f"Bearer {firecrawl_key}", "Content-Type": "application/json"},
                    json={"query": user_query, "limit": 3, "scrapeOptions": {"formats": ["markdown"]}},
                    timeout=15,
                )
                data = r.json()
                pages = data.get("data", [])[:3]
                if pages:
                    search_context += "\n## Web Content (Firecrawl)\n"
                    for page in pages:
                        md = (page.get("markdown") or "")[:800]
                        search_context += f"### {page.get('metadata',{}).get('title','')}\n{md}\n\n"
            except Exception:
                pass

        # 3. Apify — lowest priority (most expensive), only if budget available
        apify_allowed = _budget_consume(sb, "apify") if sb else True
        apify_key = os.environ.get("APIFY_API_KEY", "")
        if apify_key and user_query and apify_allowed:
            try:
                from apify_client import ApifyClient
                client = ApifyClient(apify_key)
                # Use Apify's Google Search Scraper actor for structured results
                run_input = {
                    "queries": user_query,
                    "maxPagesPerQuery": 1,
                    "resultsPerPage": 5,
                    "mobileResults": False,
                    "languageCode": "",
                    "maxConcurrency": 1,
                    "customDataFunction": "async ({ input, $, request, response, html }) => { return { pageTitle: $('title').text() }; }",
                }
                run = client.actor("apify/google-search-scraper").call(run_input=run_input, timeout_secs=30)
                items = list(client.dataset(run["defaultDatasetId"]).iterate_items())
                organic = []
                for item in items:
                    organic.extend(item.get("organicResults", []))
                organic = organic[:5]
                if organic:
                    search_context += "\n## Deep Research (Apify)\n"
                    for r in organic:
                        title = r.get("title", "")
                        url   = r.get("url", "")
                        desc  = r.get("description", "")
                        search_context += f"- [{title}]({url}): {desc}\n"
            except Exception:
                pass

        if not search_context:
            return lc_messages

        # Inject search context into system message
        enriched = list(lc_messages)
        if enriched and isinstance(enriched[0], SystemMessage):
            enriched[0] = SystemMessage(
                content=enriched[0].content + f"\n\n## Live Research Context (auto-retrieved)\n{search_context}\n"
                "Use this research to ground your response in current facts and data."
            )
        else:
            enriched.insert(0, SystemMessage(
                content=f"## Live Research Context\n{search_context}\nUse this to ground your response."
            ))
        return enriched

    def get_sb():
        from supabase import create_client
        return create_client(os.environ["SUPABASE_CHAR_URL"], os.environ["SUPABASE_CHAR_SERVICE_KEY"])

    def fetch_char(sb, cid: str) -> dict:
        r = sb.table("characters").select("*").eq("id", cid).single().execute()
        if not r.data: raise HTTPException(404, f"Character {cid} not found")
        return r.data

    def save_msg(sb, conv_id, char_id, role, content, rnd, seq):
        sb.table("messages").insert({"conversation_id": conv_id, "character_id": char_id,
            "role": role, "content": content, "round_number": rnd, "sequence_number": seq}).execute()

    def ensure_conv(sb, char_ids, mode, llm_cfg, max_rounds, topic=None, existing_id=None) -> str:
        if existing_id: return existing_id
        r = sb.table("conversations").insert({"character_ids": char_ids, "mode": mode,
            "llm_config": llm_cfg, "max_rounds": max_rounds, "topic": topic}).execute()
        return r.data[0]["id"]

    def sys_prompt(char: dict, others: Optional[list] = None) -> str:
        p = char.get("personality", {})
        base = p.get("agent_system_prompt") or (
            f"You are {char['name']}, a {char.get('age','')} {char.get('ethnicity','')} {char.get('gender','person')}.\n"
            f"Speak always as {char['name']}. Never break character.\n"
        )
        notes = char.get("knowledge_notes", [])
        if notes:
            base += "\n\n## Accumulated Knowledge\n" + "\n".join(f"- {n}" for n in notes[-10:])
        if others:
            base += (f"\n\n## Conversation Context\nYou are in a discussion with: {', '.join(c['name'] for c in others)}.\n"
                     "Engage directly. Be concise (2-4 sentences). Stay in character. Do NOT narrate actions.")
        return base

    class MultiState(TypedDict):
        messages: Annotated[list[dict], operator.add]
        current_speaker_idx: int
        rounds_completed: int
        max_rounds: int
        characters: list[dict]
        llm_cfg: Optional[LLMProviderConfig]   # None = each char uses own role config

    def make_char_node(idx: int, sb=None):
        def node(state: MultiState) -> dict:
            from langchain_core.messages import HumanMessage, SystemMessage
            chars = state["characters"]
            char = chars[idx]
            lc = [SystemMessage(content=sys_prompt(char, [c for i, c in enumerate(chars) if i != idx]))]
            for m in state["messages"]:
                if m["role"] == "user":
                    lc.append(HumanMessage(content=m["content"]))
                elif m["role"] == "assistant":
                    lc.append(HumanMessage(content=f"[{m.get('speaker','')}]: {m['content']}"))
            # Each character uses its own role-based LLM with budget check
            reply, _llm_label = invoke_with_role(char, lc, state["llm_cfg"], sb=sb)
            next_idx = (idx + 1) % len(chars)
            completed = state["rounds_completed"] + (1 if next_idx == 0 else 0)
            return {"messages": [{"role": "assistant", "speaker": char["name"],
                "character_id": char["id"], "content": reply, "round": state["rounds_completed"]}],
                "current_speaker_idx": next_idx, "rounds_completed": completed}
        node.__name__ = f"character_{idx}"
        return node

    def router_fn(state: MultiState) -> str:
        return "end" if state["rounds_completed"] >= state["max_rounds"] else f"character_{state['current_speaker_idx']}"

    def build_multi_graph(n: int, sb=None):
        from langgraph.graph import StateGraph, END
        b = StateGraph(MultiState)
        for i in range(n): b.add_node(f"character_{i}", make_char_node(i, sb=sb))
        b.add_node("router", lambda s: s)
        b.set_entry_point("router")
        em = {f"character_{i}": f"character_{i}" for i in range(n)}
        em["end"] = END
        b.add_conditional_edges("router", router_fn, em)
        for i in range(n): b.add_edge(f"character_{i}", "router")
        return b.compile()

    class ReflectState(TypedDict):
        character: dict
        messages_text: str
        skills_before: dict
        skills_after: dict
        diff_summary: dict
        llm_cfg: Optional[LLMProviderConfig]
        messages_analyzed: int

    def reflect_load(state: ReflectState) -> dict: return {}

    def reflect_extract(state: ReflectState) -> dict:
        from langchain_core.messages import HumanMessage, SystemMessage
        char = state["character"]
        # For reflect: use caller cfg if given, else use Claude (best for analysis)
        reflect_cfg = state["llm_cfg"] or LLMProviderConfig(provider="anthropic", model="claude-sonnet-4-5")
        llm = build_llm(reflect_cfg)
        p = char.get("personality", {})
        prompt = (
            f'Analyze this conversation transcript for character "{char["name"]}":\n\n---\n'
            f'{state["messages_text"]}\n---\n\n'
            f'Current skillsets: {p.get("skillsets", [])}\nCurrent mindsets: {p.get("mindsets", [])}\n\n'
            'Return ONLY valid JSON:\n'
            '{"new_skills_demonstrated":[],"strengthened_skills":[],"new_mindsets_demonstrated":[],'
            '"key_insights":[],"updated_knowledge_notes":[],"confidence":0.0}'
        )
        raw = llm.invoke([
            SystemMessage(content="Extract skill evolution from conversation. Respond ONLY with valid JSON."),
            HumanMessage(content=prompt),
        ]).content.strip()
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m: raw = m.group(0)
        try: diff = json.loads(raw)
        except Exception:
            diff = {"new_skills_demonstrated": [], "strengthened_skills": [], "new_mindsets_demonstrated": [],
                    "key_insights": [], "updated_knowledge_notes": [], "confidence": 0.0}
        return {"diff_summary": diff}

    def reflect_update(state: ReflectState) -> dict:
        char = state["character"]
        p = dict(char.get("personality", {}))
        diff = state["diff_summary"]
        before = {"skillsets": list(p.get("skillsets", [])), "mindsets": list(p.get("mindsets", [])),
                  "knowledge_notes": list(char.get("knowledge_notes", []))}
        sk = set(p.get("skillsets", []))
        ms = set(p.get("mindsets", []))
        for s in diff.get("new_skills_demonstrated", []) + diff.get("strengthened_skills", []): sk.add(s)
        for m2 in diff.get("new_mindsets_demonstrated", []): ms.add(m2)
        p["skillsets"] = sorted(sk)
        p["mindsets"] = sorted(ms)
        nn = diff.get("updated_knowledge_notes", [])
        en = char.get("knowledge_notes", [])
        merged = (en + [x for x in nn if x not in en])[-15:] if nn else en
        after = {"skillsets": p["skillsets"], "mindsets": p["mindsets"], "knowledge_notes": merged}
        return {"skills_before": before, "skills_after": after,
                "character": {**char, "personality": p, "knowledge_notes": merged}}

    def reflect_save(state: ReflectState) -> dict:
        sb = get_sb()
        char = state["character"]
        sb.table("characters").update({"personality": char["personality"],
            "knowledge_notes": char.get("knowledge_notes", [])}).eq("id", char["id"]).execute()
        sb.table("skill_evolution_log").insert({"character_id": char["id"],
            "skills_before": state["skills_before"], "skills_after": state["skills_after"],
            "diff_summary": state["diff_summary"], "messages_analyzed": state["messages_analyzed"],
            "triggered_by": "manual"}).execute()
        return {}

    def build_reflect_graph():
        from langgraph.graph import StateGraph, END
        b = StateGraph(ReflectState)
        b.add_node("load", reflect_load)
        b.add_node("extract", reflect_extract)
        b.add_node("update", reflect_update)
        b.add_node("save", reflect_save)
        b.set_entry_point("load")
        b.add_edge("load", "extract")
        b.add_edge("extract", "update")
        b.add_edge("update", "save")
        b.add_edge("save", END)
        return b.compile()

    def verify_key(x_api_key=None, authorization=None):
        raw = x_api_key or (authorization[7:] if authorization and authorization.startswith("Bearer ") else None)
        if not raw: raise HTTPException(401, "API key required")
        if not raw.startswith("sk_char_"): raise HTTPException(401, "Invalid API key format")
        hashed = hashlib.sha256(raw.encode()).hexdigest()
        sb = get_sb()
        r = sb.table("api_keys").select("id, is_active").eq("hashed_key", hashed).execute()
        if not r.data or not r.data[0]["is_active"]: raise HTTPException(401, "Invalid or revoked API key")
        try: sb.table("api_keys").update({"last_used_at": "now()"}).eq("hashed_key", hashed).execute()
        except Exception: pass

    @_web.get("/health")
    async def health(): return {"status": "ok", "service": "character-agent"}

    @_web.get("/budget")
    async def get_budget(x_api_key: Optional[str] = Header(default=None),
                         authorization: Optional[str] = Header(default=None)):
        """Return today's API usage vs limits for all tracked APIs.
        Total daily budget cap: $0.20 per agent/day.
        """
        verify_key(x_api_key, authorization)
        from datetime import date
        sb = get_sb()
        today = date.today().isoformat()

        rows = sb.table("api_budget") \
            .select("api_name, daily_limit, calls_today, cost_usd, budget_date") \
            .eq("budget_date", today) \
            .order("api_name").execute().data or []

        total_cost = sum(float(r["cost_usd"]) for r in rows)
        daily_budget_cap = 0.20

        return {
            "date": today,
            "daily_budget_cap_usd": daily_budget_cap,
            "total_cost_today_usd": round(total_cost, 6),
            "remaining_usd": round(max(0.0, daily_budget_cap - total_cost), 6),
            "utilization_pct": round(min(100.0, (total_cost / daily_budget_cap) * 100), 1),
            "apis": [
                {
                    "api_name": r["api_name"],
                    "calls_today": r["calls_today"],
                    "daily_limit": r["daily_limit"],
                    "calls_remaining": max(0, r["daily_limit"] - r["calls_today"]),
                    "cost_usd": round(float(r["cost_usd"]), 6),
                    "exhausted": r["calls_today"] >= r["daily_limit"],
                }
                for r in rows
            ],
        }

    @_web.post("/chat", response_model=ChatResponse)
    async def chat(req: ChatRequest,
                   x_api_key: Optional[str] = Header(default=None),
                   authorization: Optional[str] = Header(default=None)):
        verify_key(x_api_key, authorization)
        from langchain_core.messages import HumanMessage, SystemMessage
        sb = get_sb()
        char = fetch_char(sb, req.character_id)
        history, conv_id = [], req.conversation_id
        if conv_id:
            history = (sb.table("messages").select("role,content,character_id")
                       .eq("conversation_id", conv_id).order("sequence_number").limit(50).execute().data or [])
        lc = [SystemMessage(content=sys_prompt(char))]
        for h in history: lc.append(HumanMessage(content=h["content"]))
        lc.append(HumanMessage(content=req.message))
        # invoke_with_role: None caller_llm = auto-select by role + budget check
        reply, llm_used = invoke_with_role(char, lc, req.llm, sb=sb)
        if req.save_to_db:
            llm_cfg_dict = req.llm.model_dump() if req.llm else {"provider": "role-auto", "model": llm_used}
            if not conv_id: conv_id = ensure_conv(sb, [req.character_id], "single", llm_cfg_dict, 100)
            base = len(history)
            save_msg(sb, conv_id, None, "user", req.message, 0, base)
            save_msg(sb, conv_id, req.character_id, "assistant", reply, 0, base + 1)
        return ChatResponse(character_id=req.character_id, character_name=char["name"],
                            reply=reply, conversation_id=conv_id or "unsaved", llm_used=llm_used)

    @_web.post("/conversation", response_model=ConversationResponse)
    async def conversation(req: ConversationRequest,
                           x_api_key: Optional[str] = Header(default=None),
                           authorization: Optional[str] = Header(default=None)):
        verify_key(x_api_key, authorization)
        if len(req.character_ids) < 2: raise HTTPException(400, "Need at least 2 characters")
        if len(req.character_ids) > 8: raise HTTPException(400, "Max 8 characters")
        sb = get_sb()
        chars = [fetch_char(sb, cid) for cid in req.character_ids]
        graph = build_multi_graph(len(chars), sb=sb)
        seeds = []
        if req.topic: seeds.append({"role": "user", "speaker": "Host", "character_id": None,
                                     "content": f"Topic: {req.topic}", "round": 0})
        if req.user_message: seeds.append({"role": "user", "speaker": "User", "character_id": None,
                                            "content": req.user_message, "round": 0})
        final = graph.invoke({"messages": seeds, "current_speaker_idx": 0, "rounds_completed": 0,
                               "max_rounds": req.max_rounds, "characters": chars, "llm_cfg": req.llm})
        msgs = final["messages"]
        conv_id = "unsaved"
        if req.save_to_db:
            llm_cfg_dict = req.llm.model_dump() if req.llm else {"provider": "role-auto"}
            conv_id = ensure_conv(sb, req.character_ids, "multi", llm_cfg_dict, req.max_rounds, req.topic)
            for seq, msg in enumerate(msgs):
                save_msg(sb, conv_id, msg.get("character_id"), msg["role"], msg["content"],
                         msg.get("round", 0), seq)
            sb.table("conversations").update({"status": "completed",
                "current_round": final["rounds_completed"]}).eq("id", conv_id).execute()
        return ConversationResponse(conversation_id=conv_id, messages=msgs,
                                    rounds_completed=final["rounds_completed"])

    @_web.post("/reflect", response_model=ReflectResponse)
    async def reflect(req: ReflectRequest,
                      x_api_key: Optional[str] = Header(default=None),
                      authorization: Optional[str] = Header(default=None)):
        verify_key(x_api_key, authorization)
        sb = get_sb()
        char = fetch_char(sb, req.character_id)
        q = sb.table("messages").select("role,content,character_id").order("created_at", desc=True).limit(req.last_n_messages)
        q = q.eq("conversation_id", req.conversation_id) if req.conversation_id else q.eq("character_id", req.character_id)
        msgs = list(reversed(q.execute().data or []))
        if not msgs: raise HTTPException(404, "No messages found for reflection")
        char_name = char["name"]
        text = "\n".join(
            (f"User: {m['content']}" if m["role"] == "user" else f"[{char_name}]: {m['content']}")
            for m in msgs
        )
        g = build_reflect_graph()
        final = g.invoke({"character": char, "messages_text": text, "skills_before": {}, "skills_after": {},
                           "diff_summary": {}, "llm_cfg": req.llm, "messages_analyzed": len(msgs)})
        return ReflectResponse(character_id=req.character_id, character_name=char["name"],
                               skills_before=final["skills_before"], skills_after=final["skills_after"],
                               diff_summary=final["diff_summary"], messages_analyzed=final["messages_analyzed"])

    # ── Step 6: Agent Evaluate ────────────────────────────────────────────────
    # POST /evaluate
    # Called by client after a batch of tasks to make agent learn + update strategy.
    #
    # Body:
    #   character_id  str         required
    #   job_id        str         required
    #   client_id     str         required
    #   task_outputs  list[dict]  required — [{task_type, prompt, output, status}]
    #   period_start  str         ISO datetime
    #   period_end    str         ISO datetime
    #   llm           dict|None   optional — override LLM

    class EvaluateRequest(BaseModel):
        character_id:  str
        job_id:        str
        client_id:     str
        task_outputs:  list[dict]   = []
        period_start:  Optional[str] = None
        period_end:    Optional[str] = None
        llm:           Optional[LLMProviderConfig] = None

    class EvaluateResponse(BaseModel):
        character_id:     str
        job_id:           str
        performance_score: float
        strengths:        list[str]
        weaknesses:       list[str]
        strategy_updates: dict
        raw_analysis:     str
        evaluation_id:    Optional[str] = None

    @_web.post("/evaluate", response_model=EvaluateResponse)
    async def evaluate(req: EvaluateRequest,
                       x_api_key: Optional[str] = Header(default=None),
                       authorization: Optional[str] = Header(default=None)):
        """
        Step 6: Agent self-evaluates completed tasks, identifies strengths/weaknesses,
        and updates strategy for future work. Saves result to agent_evaluations table.
        """
        verify_key(x_api_key, authorization)
        sb = get_sb()
        char = fetch_char(sb, req.character_id)

        if not req.task_outputs:
            raise HTTPException(400, "task_outputs must be a non-empty list")

        # Build analysis prompt
        done   = [t for t in req.task_outputs if t.get("status") == "done"]
        failed = [t for t in req.task_outputs if t.get("status") == "failed"]

        prompt_lines = [
            f"You are {char['name']}. Review your own recent work output and evaluate your performance.",
            f"",
            f"## Completed Tasks ({len(done)})",
        ]
        for t in done[:10]:
            prompt_lines.append(f"### Task: {t.get('task_type','work')}")
            prompt_lines.append(f"Objective: {t.get('prompt','')[:300]}")
            prompt_lines.append(f"Output: {t.get('output','')[:500]}")
            prompt_lines.append("")

        if failed:
            prompt_lines.append(f"## Failed Tasks ({len(failed)})")
            for t in failed[:5]:
                prompt_lines.append(f"- {t.get('task_type','work')}: {t.get('error_msg','unknown error')}")
            prompt_lines.append("")

        prompt_lines += [
            "## Your Self-Evaluation",
            "Respond in this exact JSON format:",
            '{',
            '  "performance_score": <0.0-10.0>,',
            '  "strengths": ["strength 1", "strength 2", ...],',
            '  "weaknesses": ["weakness 1", ...],',
            '  "strategy_updates": {',
            '    "focus_areas": [...],',
            '    "avoid": [...],',
            '    "improve": [...]',
            '  },',
            '  "raw_analysis": "2-3 sentence honest self-assessment"',
            '}',
            "Return ONLY the JSON, no other text.",
        ]

        analysis_prompt = "\n".join(prompt_lines)

        # Use claude-sonnet for evaluation (best for self-reflection), or caller override
        eval_cfg = req.llm or LLMProviderConfig(provider="anthropic", model="claude-sonnet-4-5")
        # Check budget
        eval_budget_ok = _budget_consume(sb, "anthropic_sonnet")
        if not eval_budget_ok:
            eval_cfg = LLMProviderConfig(provider="openai", model="gpt-4o-mini")

        from langchain_core.messages import HumanMessage, SystemMessage
        lc = [
            SystemMessage(content=f"You are {char['name']}, an AI agent doing honest self-evaluation."),
            HumanMessage(content=analysis_prompt),
        ]
        llm_obj = build_llm(eval_cfg)
        raw = llm_obj.invoke(lc).content.strip()

        # Parse JSON response
        import json as _json
        performance_score = 5.0
        strengths:   list[str] = []
        weaknesses:  list[str] = []
        strategy_updates: dict = {}
        raw_analysis = raw

        try:
            # Strip markdown code fences if present
            clean = raw
            if "```" in clean:
                clean = clean.split("```")[1]
                if clean.startswith("json"): clean = clean[4:]
            parsed = _json.loads(clean.strip())
            performance_score = float(parsed.get("performance_score", 5.0))
            strengths         = parsed.get("strengths", [])
            weaknesses        = parsed.get("weaknesses", [])
            strategy_updates  = parsed.get("strategy_updates", {})
            raw_analysis      = parsed.get("raw_analysis", raw)
        except Exception:
            pass  # keep defaults on parse failure

        # Save to agent_evaluations
        from datetime import datetime as _dt, timezone as _tz
        now_iso = _dt.now(_tz.utc).isoformat()
        eval_row = {
            "job_id":           req.job_id,
            "character_id":     req.character_id,
            "client_id":        req.client_id,
            "period_start":     req.period_start or now_iso,
            "period_end":       req.period_end or now_iso,
            "tasks_reviewed":   len(req.task_outputs),
            "performance_score":performance_score,
            "strengths":        strengths,
            "weaknesses":       weaknesses,
            "strategy_updates": strategy_updates,
            "raw_analysis":     raw_analysis,
        }
        eval_res = sb.table("agent_evaluations").insert(eval_row).select("id").single().execute()
        eval_id  = eval_res.data["id"] if eval_res.data else None

        # Update character knowledge_notes with strategy updates (non-blocking)
        if strategy_updates:
            note = f"[Self-Eval {now_iso[:10]}] Focus: {', '.join(strategy_updates.get('focus_areas',[])[:2])}. Improve: {', '.join(strategy_updates.get('improve',[])[:2])}"
            current_notes = list(char.get("knowledge_notes") or [])
            current_notes.append(note)
            sb.table("characters").update({"knowledge_notes": current_notes[-20:]}).eq("id", req.character_id).execute()

        return EvaluateResponse(
            character_id=req.character_id,
            job_id=req.job_id,
            performance_score=performance_score,
            strengths=strengths,
            weaknesses=weaknesses,
            strategy_updates=strategy_updates,
            raw_analysis=raw_analysis,
            evaluation_id=eval_id,
        )

    return _web


# ── CLI entry point (for modal run modal_app.py) ──────────────────

@app.local_entrypoint()
def main():
    """Quick test: generate 1 image."""
    print("Testing Geovera Modal deployment...")
    result = generate.remote(
        prompt="product photo of a coffee cup on a wooden table, professional studio lighting",
        width=768,
        height=1344,
        num_steps=4,
        seed=42,
    )
    print(f"✓ Generated {len(result['images'])} image(s) in {result['time']}s")
    print("Deployment test successful!")
