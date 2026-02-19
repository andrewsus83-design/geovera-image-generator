"""Main pipeline script - end-to-end from raw images to generation.

Usage:
    # Step 1: Index & caption images with Gemini
    python scripts/run_pipeline.py caption --image-dir data/raw --style detailed

    # Step 2: Preprocess images for training
    python scripts/run_pipeline.py preprocess --raw-dir data/raw --processed-dir data/processed

    # Step 3: Train LoRA
    python scripts/run_pipeline.py train --config configs/train_config.yaml

    # Step 4: Generate images
    python scripts/run_pipeline.py generate --prompt "a product photo" --reference data/raw/example.jpg

    # Full pipeline
    python scripts/run_pipeline.py full --image-dir data/raw
"""

import sys
from pathlib import Path

import click
from PIL import Image

# Add project root to path
sys.path.insert(0, str(Path(__file__).parent.parent))


@click.group()
def cli():
    """Geovera Image Generator - Consistent image generation pipeline."""
    pass


@cli.command()
@click.option("--image-dir", required=True, help="Directory containing images")
@click.option("--output-dir", default=None, help="Output directory for captions")
@click.option("--style", type=click.Choice(["detailed", "concise", "tags"]), default="detailed")
@click.option("--delay", default=1.0, help="Delay between Gemini API calls")
@click.option("--api-key", default=None, help="Gemini API key (or set GEMINI_API_KEY)")
def caption(image_dir, output_dir, style, delay, api_key):
    """Auto-caption images using Gemini Vision."""
    from src.utils.gemini_indexer import GeminiIndexer

    indexer = GeminiIndexer(api_key=api_key)
    indexer.batch_caption(image_dir, output_dir, style, delay)


@cli.command()
@click.option("--image-dir", required=True, help="Directory containing images")
@click.option("--output", default=None, help="Output JSON index path")
@click.option("--delay", default=1.0, help="Delay between Gemini API calls")
@click.option("--api-key", default=None, help="Gemini API key (or set GEMINI_API_KEY)")
def index(image_dir, output, delay, api_key):
    """Index and analyze images using Gemini Vision."""
    from src.utils.gemini_indexer import GeminiIndexer

    indexer = GeminiIndexer(api_key=api_key)
    indexer.batch_index(image_dir, output, delay)


@cli.command()
@click.option("--raw-dir", default="data/raw", help="Raw images directory")
@click.option("--processed-dir", default="data/processed", help="Processed output directory")
@click.option("--resolution", default=1024, help="Target resolution")
def preprocess(raw_dir, processed_dir, resolution):
    """Preprocess raw images for training."""
    from src.utils.data_utils import prepare_dataset

    prepare_dataset(raw_dir, processed_dir, resolution)


@cli.command()
@click.option("--config", default="configs/train_config.yaml", help="Training config path")
def train(config):
    """Train LoRA adapter on processed images."""
    from src.training.train_lora import train as run_training

    run_training(config)


@cli.command()
@click.option("--config", default="configs/inference_config.yaml", help="Inference config path")
@click.option("--prompt", required=True, help="Generation prompt")
@click.option("--reference", default=None, help="Reference image path")
@click.option("--face", default=None, help="Face reference image path")
@click.option("--output", default="data/output", help="Output directory")
@click.option("--num-images", default=1, help="Number of images to generate")
@click.option("--seed", default=None, type=int, help="Random seed")
@click.option("--conditioning-scale", default=0.5, help="ControlNet conditioning scale")
def generate(config, prompt, reference, face, output, num_images, seed, conditioning_scale):
    """Generate images with consistency controls."""
    from src.inference.generate import ImageGenerator

    gen = ImageGenerator(config)
    gen.load_pipeline()

    images = gen.generate(
        prompt=prompt,
        reference_image=reference,
        face_image=face,
        num_images=num_images,
        seed=seed,
        controlnet_conditioning_scale=conditioning_scale,
    )

    output_dir = Path(output)
    output_dir.mkdir(parents=True, exist_ok=True)
    for i, img in enumerate(images):
        path = output_dir / f"output_{i:04d}.png"
        img.save(path)
        click.echo(f"Saved: {path}")


@cli.command()
@click.option("--image-dir", default="data/raw", help="Raw images directory")
@click.option("--config", default="configs/train_config.yaml", help="Training config")
@click.option("--caption-style", default="detailed", help="Gemini caption style")
@click.option("--resolution", default=1024, help="Target resolution")
@click.option("--api-key", default=None, help="Gemini API key")
def full(image_dir, config, caption_style, resolution, api_key):
    """Run the full pipeline: caption -> preprocess -> train."""
    from src.utils.data_utils import prepare_dataset
    from src.utils.gemini_indexer import GeminiIndexer

    click.echo("=" * 60)
    click.echo("STEP 1: Indexing & captioning images with Gemini")
    click.echo("=" * 60)
    indexer = GeminiIndexer(api_key=api_key)
    indexer.batch_index(image_dir)
    indexer.batch_caption(image_dir, style=caption_style)

    click.echo("\n" + "=" * 60)
    click.echo("STEP 2: Preprocessing images")
    click.echo("=" * 60)
    prepare_dataset(image_dir, "data/processed", resolution)

    click.echo("\n" + "=" * 60)
    click.echo("STEP 3: Training LoRA")
    click.echo("=" * 60)
    from src.training.train_lora import train as run_training
    run_training(config)

    click.echo("\n" + "=" * 60)
    click.echo("Pipeline complete!")
    click.echo("=" * 60)


@cli.command()
@click.option("--config", default="configs/inference_config.yaml", help="Inference config path")
@click.option("--source", required=True, help="Source image path")
@click.option("--prompt", required=True, help="Prompt describing the desired variation")
@click.option("--num-variations", default=4, help="Number of variations to generate")
@click.option("--strength", default=0.5, help="Variation strength (0.0=identical, 1.0=new)")
@click.option("--output", default="data/output", help="Output directory")
@click.option("--seed", default=None, type=int, help="Random seed")
@click.option("--upload", is_flag=True, help="Upload results to Supabase")
def variations(config, source, prompt, num_variations, strength, output, seed, upload):
    """Generate image-to-image variations of a source image."""
    from src.inference.img2img import ImageVariationGenerator

    gen = ImageVariationGenerator(config)
    gen.load_pipeline()

    images = gen.generate_variations(
        source_image=source,
        prompt=prompt,
        num_variations=num_variations,
        strength=strength,
        seed=seed,
    )

    output_dir = Path(output)
    output_dir.mkdir(parents=True, exist_ok=True)
    source_stem = Path(source).stem

    saved_paths = []
    for i, img in enumerate(images):
        path = output_dir / f"{source_stem}_var{i:02d}.png"
        img.save(path)
        saved_paths.append(path)
        click.echo(f"Saved: {path}")

    if upload:
        _upload_to_supabase(images, saved_paths, "variation", prompt, strength)


@cli.command()
@click.option("--config", default="configs/inference_config.yaml", help="Inference config path")
@click.option("--source", required=True, help="Source image path")
@click.option("--prompt", required=True, help="Prompt describing the desired variation")
@click.option("--output", default="data/output", help="Output directory")
@click.option("--seed", default=42, type=int, help="Fixed seed for fair comparison")
def sweep(config, source, prompt, output, seed):
    """Generate variations at different strength levels to find the sweet spot."""
    from src.inference.img2img import ImageVariationGenerator

    gen = ImageVariationGenerator(config)
    gen.load_pipeline()

    results = gen.generate_strength_sweep(
        source_image=source,
        prompt=prompt,
        seed=seed,
    )

    output_dir = Path(output)
    output_dir.mkdir(parents=True, exist_ok=True)
    source_stem = Path(source).stem

    for strength, img in results.items():
        path = output_dir / f"{source_stem}_strength{strength:.2f}.png"
        img.save(path)
        click.echo(f"Saved: {path} (strength={strength})")


@cli.command()
@click.option("--directory", required=True, help="Directory of images to upload")
@click.option("--image-type", default="original", type=click.Choice(["original", "processed", "generated"]))
@click.option("--category", default=None, type=click.Choice(["product", "face", "landscape", "other"]))
def upload(directory, image_type, category):
    """Upload images to Supabase Storage."""
    from src.utils.supabase_storage import SupabaseStorage

    storage = SupabaseStorage()
    results = storage.upload_directory(directory, image_type=image_type, category=category)
    click.echo(f"\nUploaded {len(results)} images to Supabase.")


@cli.command(name="list-images")
@click.option("--type", "image_type", default=None, help="Filter by image type")
@click.option("--category", default=None, help="Filter by category")
@click.option("--limit", default=20, help="Max results")
def list_images(image_type, category, limit):
    """List images stored in Supabase."""
    from src.utils.supabase_storage import SupabaseStorage

    storage = SupabaseStorage()
    images = storage.list_images(image_type=image_type, category=category, limit=limit)

    for img in images:
        click.echo(
            f"  {img['id'][:8]}  {img['image_type']:10s}  {img['category'] or '-':10s}  "
            f"{img['filename']:30s}  {img.get('caption', '')[:50]}"
        )
    click.echo(f"\nTotal: {len(images)} images")


@cli.command(name="tiktok-ads")
@click.option("--config", default="configs/inference_config.yaml", help="Inference config path")
# ── Generation Mode ───
@click.option("--mode", required=True, type=click.Choice(["actor", "prop", "actor+prop"]),
              help="Generation mode: 'actor' (person only), 'prop' (product only), 'actor+prop' (person with product)")
# ── Actor Options (for mode=actor or actor+prop) ───
@click.option("--actor-source", default=None, help="Path to actor face/body image (for source/upload mode)")
@click.option("--actor-mode", default="source", type=click.Choice(["source", "trained", "random"]),
              help="'source' = upload face image, 'trained' = LoRA-trained, 'random' = generate from description")
@click.option("--actor-lora", default=None, help="Path to actor LoRA weights (for --actor-mode trained)")
@click.option("--gender", default="female", type=click.Choice(["female", "male", "non_binary"]), help="Actor gender")
@click.option("--ethnicity", default="any", help="Actor ethnicity (asian, caucasian, latino, etc.)")
@click.option("--age", default="20s", help="Actor age range (teen, 20s, 30s, 40s, etc.)")
@click.option("--features", default=None, help="Comma-separated features (long_hair, beard, glasses, etc.)")
@click.option("--subject", default=None, help="Custom subject description (overrides gender/ethnicity/age)")
# ── Prop Options (for mode=prop or actor+prop) ───
@click.option("--prop-source", default=None, help="Path to prop image (for upload mode)")
@click.option("--prop-mode", default="upload", type=click.Choice(["upload", "trained"]),
              help="'upload' = composite uploaded image, 'trained' = LoRA-trained prop")
@click.option("--prop-lora", default=None, help="Path to prop LoRA weights (for --prop-mode trained)")
@click.option("--prop-desc", default=None, help="Description of the prop (e.g. 'premium leather handbag')")
@click.option("--prop-position", default="center-bottom",
              help="Prop position: center, center-bottom, center-top, left, right, bottom-left, bottom-right")
@click.option("--prop-scale", default=0.35, help="Prop size relative to image (0.0-1.0)")
# ── Generation Settings ───
@click.option("--themes", default="all", help="Comma-separated theme IDs (1-30), or 'all'")
@click.option("--screen", default="9:16", type=click.Choice(["9:16", "4:3", "1:1", "16:9", "3:4"]), help="Screen ratio")
@click.option("--num-images", default=1, help="Number of images per theme")
@click.option("--color", default="none", help="Color palette (olive_green, navy_blue, coral, etc.)")
@click.option("--strength", default=0.55, help="Variation strength")
@click.option("--output", default="data/output/tiktok", help="Output directory")
@click.option("--seed", default=42, type=int, help="Random seed for reproducibility")
@click.option("--upload", is_flag=True, help="Upload results to Supabase")
@click.option("--flux", is_flag=True, help="Use Flux model instead of SDXL")
@click.option("--flux-variant", default="dev", type=click.Choice(["dev", "schnell"]), help="Flux model variant")
# ── Continuity ───
@click.option("--continuity", is_flag=True, help="Enable visual storytelling continuity between images (default: off = random/independent)")
@click.option("--continuity-arc", default="journey", type=click.Choice(["journey", "transformation", "adventure", "emotion"]),
              help="Narrative arc for continuity mode")
# ── Serverless ───
@click.option("--serverless", is_flag=True, help="Use vast.ai serverless (no local GPU needed)")
@click.option("--vast-endpoint", default=None, help="Vast.ai serverless endpoint URL (or set VAST_ENDPOINT_URL)")
@click.option("--vast-key", default=None, help="Vast.ai serverless API key (or set VAST_API_KEY)")
@click.option("--gpu", default="any",
              type=click.Choice(["any", "rtx3090", "rtx3090ti", "rtx4080", "rtx4090", "rtx5090", "a100", "h100"]),
              help="GPU type hint for vast.ai workergroup selection (default: any = cheapest available)")
def tiktok_ads(config, mode, actor_source, actor_mode, actor_lora, gender, ethnicity, age,
               features, subject, prop_source, prop_mode, prop_lora, prop_desc, prop_position,
               prop_scale, themes, screen, num_images, color, strength, output, seed, upload,
               flux, flux_variant, continuity, continuity_arc, serverless, vast_endpoint, vast_key, gpu):
    """Generate commercial ad variations with three modes.

    MODES:\n
      actor      - Person only (model in themed scenes)\n
      prop       - Product only (product in themed scenes)\n
      actor+prop - Person holding/with product in themed scenes\n

    ACTOR OPTIONS (source/trained/random):\n
      source  - Upload a face image to keep identity consistent\n
      trained - Use a LoRA-trained model (provide --actor-lora)\n
      random  - Generate from description (gender/ethnicity/age)\n

    PROP OPTIONS (upload/trained):\n
      upload  - Upload product image, composited onto results\n
      trained - Use LoRA-trained product (provide --prop-lora)\n

    EXAMPLES:\n
      # Actor only: Female Asian model, olive green\n
      python scripts/run_pipeline.py tiktok-ads --mode actor --actor-source face.jpg --gender female --ethnicity asian --color olive_green\n
      # Prop only: Product shots across themes\n
      python scripts/run_pipeline.py tiktok-ads --mode prop --prop-source product.png --prop-desc "premium skincare bottle"\n
      # Actor + Prop: Model holding product\n
      python scripts/run_pipeline.py tiktok-ads --mode actor+prop --actor-source face.jpg --prop-source bottle.png --prop-desc "serum bottle" --gender female\n
      # Trained actor + trained prop\n
      python scripts/run_pipeline.py tiktok-ads --mode actor+prop --actor-mode trained --actor-lora ./lora/actor --prop-mode trained --prop-lora ./lora/product --prop-desc "sneaker"
    """
    from src.utils.tiktok_prompts import (
        get_prompt, build_subject_description, get_continuity_modifier,
        SCREEN_RATIOS, COLOR_PALETTES, TIKTOK_AD_THEMES, CONTINUITY_ARCS,
    )

    has_actor = mode in ("actor", "actor+prop")
    has_prop = mode in ("prop", "actor+prop")

    # ── Validate inputs ───────────────────────────────────────
    if has_actor and actor_mode == "source" and not actor_source:
        raise click.BadParameter("--actor-source is required when using --actor-mode source with actor mode")
    if has_actor and actor_mode == "trained" and not actor_lora:
        click.echo("Warning: --actor-mode trained without --actor-lora; using default LoRA path from config")
    if has_prop and prop_mode == "upload" and not prop_source:
        raise click.BadParameter("--prop-source is required when using --prop-mode upload with prop mode")
    if has_prop and not prop_desc:
        raise click.BadParameter("--prop-desc is required when using prop mode")
    if has_prop and prop_mode == "trained" and not prop_lora:
        click.echo("Warning: --prop-mode trained without --prop-lora; using default LoRA path from config")

    # ── Build subject description ─────────────────────────────
    feat_list = [f.strip() for f in features.split(",")] if features else None

    if has_actor:
        if subject:
            actor_desc = subject
        elif actor_mode == "trained":
            base = build_subject_description(gender=gender, ethnicity=ethnicity, age=age, features=feat_list)
            actor_desc = f"ohwx {base}"
        else:
            actor_desc = build_subject_description(gender=gender, ethnicity=ethnicity, age=age, features=feat_list)
    else:
        actor_desc = None

    # Build the prompt subject based on mode
    if mode == "actor":
        prompt_subject = actor_desc
    elif mode == "prop":
        prompt_subject = prop_desc
    else:  # actor+prop
        prompt_subject = f"{actor_desc} holding {prop_desc}"

    # Determine source image for img2img
    if has_actor and actor_source:
        source_img = actor_source
    elif has_prop and prop_source and prop_mode == "upload":
        source_img = prop_source
    elif has_actor and actor_mode == "random":
        source_img = None  # text-to-image only
    else:
        source_img = actor_source or prop_source

    # ── Parse themes & options ────────────────────────────────
    total_themes = len(TIKTOK_AD_THEMES)
    if themes == "all":
        theme_ids = list(range(1, total_themes + 1))
    else:
        theme_ids = [int(t.strip()) for t in themes.split(",")]

    if color not in COLOR_PALETTES:
        available = ", ".join(COLOR_PALETTES.keys())
        raise click.BadParameter(f"Unknown color '{color}'. Available: {available}")

    ratio_data = SCREEN_RATIOS[screen]
    total_images = len(theme_ids) * num_images

    # Get themed prompts
    all_themes = {t: get_prompt(t, prompt_subject, color=color, screen_ratio=screen) for t in theme_ids}

    # ── Load prop compositor ──────────────────────────────────
    compositor = None
    if has_prop and prop_mode == "upload" and prop_source:
        from src.utils.prop_compositor import PropCompositor
        compositor = PropCompositor()
        compositor.load_prop(prop_source, description=prop_desc)
    elif has_prop and prop_mode == "trained":
        # Trained prop: add trigger word to all prompts
        for t_id in all_themes:
            all_themes[t_id]["prompt"] += f", sks {prop_desc}, {prop_desc} clearly visible and consistent"

    # If mode is actor+prop with upload prop, add prop mention to prompts
    if mode == "actor+prop" and compositor:
        for t_id in all_themes:
            all_themes[t_id]["prompt"] = compositor.add_prop_to_prompt(all_themes[t_id]["prompt"])

    # ── Print summary ─────────────────────────────────────────
    click.echo(f"{'='*60}")
    click.echo(f"  Geovera Ad Generator {'(Flux)' if flux else '(SDXL)'}")
    click.echo(f"{'='*60}")
    click.echo(f"  Mode:       {mode.upper()}")
    if has_actor:
        click.echo(f"  Actor:      {actor_desc}")
        click.echo(f"  Actor mode: {actor_mode}" + (f" (LoRA: {actor_lora})" if actor_lora else ""))
        if actor_source:
            click.echo(f"  Actor img:  {actor_source}")
    if has_prop:
        click.echo(f"  Prop:       {prop_desc}")
        click.echo(f"  Prop mode:  {prop_mode}" + (f" (LoRA: {prop_lora})" if prop_lora else ""))
        if prop_source and prop_mode == "upload":
            click.echo(f"  Prop img:   {prop_source} ({prop_position}, {prop_scale:.0%})")
    click.echo(f"  Screen:     {screen} ({ratio_data['width']}x{ratio_data['height']})")
    click.echo(f"  Color:      {COLOR_PALETTES[color]['label']}")
    click.echo(f"  Themes:     {len(theme_ids)}")
    click.echo(f"  Per theme:  {num_images} image(s)")
    click.echo(f"  Total:      {total_images} images")
    click.echo(f"  Strength:   {strength}")
    click.echo(f"  Continuity: {'YES (' + CONTINUITY_ARCS[continuity_arc]['label'] + ')' if continuity else 'No (random/independent)'}")
    if serverless:
        from src.utils.gpu_selector import estimate_cost, GPU_CATALOG
        gpu_info = GPU_CATALOG.get(gpu, {})
        gpu_name = gpu_info.get("name", gpu.upper()) if gpu != "any" else "Any (cheapest available)"
        model_key = f"flux_{flux_variant}" if flux else "sdxl"
        cost = estimate_cost(total_images, gpu, model_key) if gpu != "any" else {}
        click.echo(f"  Backend:    vast.ai SERVERLESS")
        click.echo(f"  GPU:        {gpu_name}")
        if cost and "estimated_cost" in cost:
            click.echo(f"  Est. time:  ~{cost['total_minutes']} min")
            click.echo(f"  Est. cost:  {cost['estimated_cost']} ({cost['price_per_hr']})")
    elif flux:
        click.echo(f"  Model:      Flux.1 {flux_variant} (local GPU)")
    else:
        click.echo(f"  Model:      SDXL (local GPU)")
    click.echo(f"{'='*60}\n")

    # ── Serverless: offload to vast.ai ────────────────────────
    if serverless:
        from src.inference.serverless_client import VastServerlessClient
        client = VastServerlessClient(endpoint_url=vast_endpoint, api_key=vast_key)

        gpu_display = GPU_CATALOG.get(gpu, {}).get("name", gpu) if gpu != "any" else "cheapest available"
        click.echo(f"Sending batch to vast.ai serverless ({gpu_display})...")
        batch_results = client.tiktok_batch(
            subject_description=prompt_subject,
            source_image=source_img,
            theme_ids=theme_ids,
            screen_ratio=screen,
            color=color,
            num_images_per_theme=num_images,
            strength=strength,
            seed=seed,
            continuity=continuity,
            continuity_arc=continuity_arc,
        )

        output_dir = Path(output)
        output_dir.mkdir(parents=True, exist_ok=True)

        results = []
        for r in batch_results:
            theme_name = r["theme"].lower().replace(" ", "_").replace("-", "_").replace("&", "and")
            saved_paths = []
            for j, img in enumerate(r["images"]):
                # Composite uploaded prop if needed
                if compositor and mode in ("actor+prop", "prop"):
                    img = compositor.composite_prop(img, position=prop_position, scale=prop_scale)

                suffix = f"_{j:02d}" if num_images > 1 else ""
                path = output_dir / f"{r['theme_id']:02d}_{theme_name}{suffix}.png"
                img.save(path)
                saved_paths.append(path)
                click.echo(f"  [{r['theme_id']:02d}] {r['theme']} -> {path} ({r['time']:.1f}s)")

            if upload:
                _upload_to_supabase(r["images"], saved_paths, "generated", prompt_subject, strength)

            results.append({"theme": r["theme"], "paths": [str(p) for p in saved_paths]})

        click.echo(f"\nDone! {total_images} ad visuals generated via vast.ai serverless -> {output_dir}")
        return

    # ── Load local generator ──────────────────────────────────
    if flux:
        from src.inference.flux_generate import FluxGenerator
        gen = FluxGenerator(model_variant=flux_variant)
        gen.load_pipeline(enable_img2img=source_img is not None)
    else:
        from src.inference.img2img import ImageVariationGenerator
        gen = ImageVariationGenerator(config)
        gen.load_pipeline()

    output_dir = Path(output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # ── Generate ──────────────────────────────────────────────
    results = []
    previous_image = None  # For continuity chaining
    total_themes_count = len(all_themes)

    for idx, (theme_id, theme_data) in enumerate(all_themes.items()):
        theme_name = theme_data["theme"].lower().replace(" ", "_").replace("-", "_").replace("&", "and")

        # Apply continuity modifier to prompt if enabled
        prompt_text = theme_data["prompt"]
        if continuity:
            continuity_mod = get_continuity_modifier(idx, total_themes_count, arc=continuity_arc)
            prompt_text += continuity_mod

        cont_label = f" [story {idx+1}/{total_themes_count}]" if continuity else ""
        click.echo(f"[{idx+1}/{total_themes_count}] {theme_data['theme']} ({theme_data['color_palette']}){cont_label}...")

        # Determine source for this iteration:
        # - Continuity ON + previous image exists: use previous output for chaining
        # - Continuity OFF or first image: use original source_img
        if continuity and previous_image is not None:
            current_source = previous_image
        else:
            current_source = source_img

        if current_source:
            # Image-to-image: use source for consistency
            # When continuity is on, use lower strength for smoother transitions
            gen_strength = strength * 0.85 if (continuity and previous_image is not None) else strength

            if flux:
                images = gen.generate_variation(
                    source_image=current_source,
                    prompt=prompt_text,
                    strength=gen_strength,
                    width=theme_data["width"],
                    height=theme_data["height"],
                    num_images=num_images,
                    seed=seed,
                )
                if not isinstance(images, list):
                    images = [images]
            else:
                images = gen.generate_variations(
                    source_image=current_source,
                    prompt=prompt_text,
                    num_variations=num_images,
                    strength=gen_strength,
                    negative_prompt=theme_data.get("negative_prompt", None),
                    seed=seed,
                )
        else:
            # Text-to-image: random actor mode (no source image)
            if flux:
                images = gen.generate(
                    prompt=prompt_text,
                    width=theme_data["width"],
                    height=theme_data["height"],
                    num_images=num_images,
                    seed=seed,
                )
            else:
                from src.inference.generate import ImageGenerator
                txt2img = ImageGenerator(config)
                txt2img.load_pipeline()
                images = txt2img.generate(
                    prompt=prompt_text,
                    num_images=num_images,
                    seed=seed,
                )

        # Store first image for continuity chaining
        if continuity and images:
            previous_image = images[0]

        saved_paths = []
        for j, img in enumerate(images):
            img = img.resize((theme_data["width"], theme_data["height"]), Image.LANCZOS)

            # Composite uploaded prop onto generated image (actor+prop upload mode, or prop-only upload)
            if compositor and mode in ("actor+prop", "prop"):
                img = compositor.composite_prop(img, position=prop_position, scale=prop_scale)

            suffix = f"_{j:02d}" if num_images > 1 else ""
            path = output_dir / f"{theme_id:02d}_{theme_name}{suffix}.png"
            img.save(path)
            saved_paths.append(path)
            click.echo(f"  Saved: {path}")

        if upload:
            _upload_to_supabase(images, saved_paths, "generated", prompt_text, strength)

        results.append({"theme": theme_data["theme"], "paths": [str(p) for p in saved_paths]})

    click.echo(f"\nDone! {total_images} ad visuals generated in {output_dir}")


@cli.command(name="tiktok-themes")
def tiktok_themes():
    """List all available themes, screen ratios, and color palettes."""
    from src.utils.tiktok_prompts import print_available_options
    print_available_options()


@cli.command(name="vast-gpus")
@click.option("--model", default="flux_dev",
              type=click.Choice(["flux_dev", "flux_schnell", "sdxl"]),
              help="Model to show speed/cost estimates for")
def vast_gpus(model):
    """Show available GPU options for vast.ai serverless with cost estimates."""
    from src.utils.gpu_selector import print_gpu_table
    print_gpu_table(model=model)


def _upload_to_supabase(images, paths, image_type, prompt, strength=None):
    """Helper to upload generated images to Supabase."""
    try:
        from src.utils.supabase_storage import SupabaseStorage
        storage = SupabaseStorage()
        for img, path in zip(images, paths):
            result = storage.upload_image(
                image=img,
                filename=Path(path).name,
                image_type=image_type,
                generation_params={"prompt": prompt, "strength": strength},
            )
            click.echo(f"  Uploaded to Supabase: {result['id'][:8]}")
    except Exception as e:
        click.echo(f"  Supabase upload failed: {e}")


if __name__ == "__main__":
    cli()
