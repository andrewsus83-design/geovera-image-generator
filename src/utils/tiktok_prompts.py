"""Commercial ad prompt templates optimized for Flux model (vast.ai).

Generates 30 distinct synthetic image concepts from a single source image.
Preserves subject identity while varying environment, styling, lighting, and mood.
Prompts optimized for Flux (dev/schnell) model on vast.ai GPU instances.
"""

# Flux-optimized quality tags (Flux responds best to natural language descriptions
# rather than comma-separated tags, but we keep key quality anchors)
GLOBAL_QUALITY = (
    "ultra high resolution RAW photograph, shot on Hasselblad X2D 100C, "
    "professional commercial photography, cinematic lighting, "
    "depth of field, realistic skin texture and pores, "
    "commercial fashion editorial quality, strong foreground background separation, "
    "natural color science, subtle film grain, high dynamic range, "
    "clean composition, ad-ready aesthetic, photorealistic"
)

# ── User-Selectable Options ──────────────────────────────────

SCREEN_RATIOS = {
    "9:16": {"width": 768, "height": 1344, "label": "Vertical (TikTok/Reels/Stories)"},
    "4:3": {"width": 1024, "height": 768, "label": "Landscape (Classic)"},
    "1:1": {"width": 1024, "height": 1024, "label": "Square (Instagram Feed)"},
    "16:9": {"width": 1344, "height": 768, "label": "Widescreen (YouTube/Banner)"},
    "3:4": {"width": 768, "height": 1024, "label": "Portrait (Pinterest)"},
}

COLOR_PALETTES = {
    "olive_green": {
        "label": "Olive Green",
        "prompt_modifier": "olive green color palette, earthy green tones, muted sage and moss colors",
        "hex": "#708238",
    },
    "navy_blue": {
        "label": "Navy Blue",
        "prompt_modifier": "deep navy blue color palette, rich indigo and midnight blue tones",
        "hex": "#001f3f",
    },
    "coral": {
        "label": "Coral",
        "prompt_modifier": "warm coral color palette, soft salmon and peach tones, warm pinkish-orange",
        "hex": "#FF6F61",
    },
    "burgundy": {
        "label": "Burgundy",
        "prompt_modifier": "rich burgundy color palette, deep wine red and maroon tones",
        "hex": "#800020",
    },
    "gold": {
        "label": "Gold",
        "prompt_modifier": "luxurious gold color palette, warm golden and champagne tones",
        "hex": "#FFD700",
    },
    "teal": {
        "label": "Teal",
        "prompt_modifier": "teal color palette, blue-green ocean tones, sophisticated aqua",
        "hex": "#008080",
    },
    "blush_pink": {
        "label": "Blush Pink",
        "prompt_modifier": "soft blush pink color palette, delicate rose and powder pink tones",
        "hex": "#DE5D83",
    },
    "charcoal": {
        "label": "Charcoal",
        "prompt_modifier": "charcoal and dark gray color palette, sophisticated monochrome dark tones",
        "hex": "#36454F",
    },
    "lavender": {
        "label": "Lavender",
        "prompt_modifier": "soft lavender color palette, gentle purple and lilac tones",
        "hex": "#E6E6FA",
    },
    "burnt_orange": {
        "label": "Burnt Orange",
        "prompt_modifier": "warm burnt orange color palette, amber and rust tones, autumn warmth",
        "hex": "#CC5500",
    },
    "emerald": {
        "label": "Emerald",
        "prompt_modifier": "rich emerald green color palette, vibrant jewel-tone green",
        "hex": "#50C878",
    },
    "ivory": {
        "label": "Ivory / Cream",
        "prompt_modifier": "soft ivory and cream color palette, warm white and beige tones, minimalist",
        "hex": "#FFFFF0",
    },
    "electric_blue": {
        "label": "Electric Blue",
        "prompt_modifier": "vibrant electric blue color palette, bold neon blue and cyan tones",
        "hex": "#7DF9FF",
    },
    "earth_tones": {
        "label": "Earth Tones",
        "prompt_modifier": "natural earth tone color palette, warm browns, tans, terracotta, and sage",
        "hex": "#8B7355",
    },
    "monochrome": {
        "label": "Monochrome",
        "prompt_modifier": "monochromatic color palette, single color in varying shades and tones",
        "hex": "#808080",
    },
    "none": {
        "label": "Default (Theme Colors)",
        "prompt_modifier": "",
        "hex": None,
    },
}

# ── Actor Demographics ────────────────────────────────────────

ACTOR_GENDERS = {
    "female": "woman",
    "male": "man",
    "non_binary": "person",
}

ACTOR_ETHNICITIES = {
    "asian": "Asian",
    "southeast_asian": "Southeast Asian",
    "east_asian": "East Asian",
    "south_asian": "South Asian",
    "caucasian": "Caucasian",
    "african": "African",
    "african_american": "African American",
    "latino": "Latino",
    "middle_eastern": "Middle Eastern",
    "mixed": "mixed ethnicity",
    "any": "",  # No ethnicity specified
}

ACTOR_AGE_RANGES = {
    "teen": "teenage, approximately 16-19 years old, youthful",
    "20s": "in their early to mid twenties, young adult",
    "late_20s": "in their late twenties, young professional",
    "30s": "in their early to mid thirties, mature young adult",
    "late_30s": "in their late thirties",
    "40s": "in their forties, mature and distinguished",
    "50s": "in their fifties, elegant and experienced",
    "60s": "in their sixties, graceful and refined",
    "any": "",  # No age specified
}

ACTOR_FEATURES = {
    "long_hair": "with long flowing hair",
    "short_hair": "with short cropped hair",
    "curly_hair": "with curly textured hair",
    "straight_hair": "with straight sleek hair",
    "bald": "with a bald head",
    "beard": "with a well-groomed beard",
    "glasses": "wearing stylish glasses",
    "freckles": "with natural freckles",
    "tattoos": "with visible tattoos",
    "none": "",
}


def build_subject_description(
    gender="female",
    ethnicity="any",
    age="20s",
    features=None,
    custom_description=None,
):
    """Build a subject description string from demographic parameters.

    Args:
        gender: Key from ACTOR_GENDERS.
        ethnicity: Key from ACTOR_ETHNICITIES.
        age: Key from ACTOR_AGE_RANGES.
        features: List of keys from ACTOR_FEATURES, or None.
        custom_description: Custom override (if set, ignores other params).

    Returns:
        Formatted subject description string.

    Examples:
        >>> build_subject_description("female", "asian", "20s")
        "a young Asian woman in their early to mid twenties, young adult"

        >>> build_subject_description("male", "caucasian", "30s", ["beard", "short_hair"])
        "a Caucasian man in their early to mid thirties, mature young adult, with a well-groomed beard, with short cropped hair"
    """
    if custom_description:
        return custom_description

    gender_word = ACTOR_GENDERS.get(gender, "person")
    ethnicity_word = ACTOR_ETHNICITIES.get(ethnicity, "")
    age_desc = ACTOR_AGE_RANGES.get(age, "")

    # Build base description
    parts = ["a"]
    if ethnicity_word:
        parts.append(ethnicity_word)
    parts.append(gender_word)

    description = " ".join(parts)

    if age_desc:
        description += f" {age_desc}"

    # Add features
    if features:
        for feat in features:
            feat_desc = ACTOR_FEATURES.get(feat, "")
            if feat_desc:
                description += f", {feat_desc}"

    return description

GLOBAL_NEGATIVE = (
    "low quality, blurry, distorted, deformed, ugly, bad anatomy, extra fingers, "
    "weird hands, AI artifacts, oversaturated, cartoon, anime, painting, sketch, "
    "low resolution, compression artifacts, watermark, text overlay, sloppy, inconsistent"
)

TIKTOK_AD_THEMES = [
    {
        "id": 1,
        "theme": "Luxury Lifestyle",
        "creative_direction": "Premium penthouse setting with marble and gold accents. Subject exudes effortless wealth and sophistication.",
        "prompt": (
            "portrait of {subject} in a luxury penthouse interior, floor-to-ceiling windows with city skyline view, "
            "marble surfaces, gold accents, wearing premium designer clothing, confident relaxed pose, "
            "warm ambient lighting with soft window light, shallow depth of field, "
            "editorial luxury magazine aesthetic, rich warm tones, " + GLOBAL_QUALITY
        ),
        "lighting": "Warm ambient window light with soft golden fill, accent lights on architectural details",
        "camera_lens": "Sony A7IV, 85mm f/1.4, shallow DOF, slightly low angle",
        "mood_color_grade": "Warm golden tones, rich shadows, creamy highlights, luxury warmth",
        "tiktok_hook": "Aspirational lifestyle triggers desire. Gold + city views = instant scroll-stop for luxury audiences.",
    },
    {
        "id": 2,
        "theme": "Night Neon Cyberpunk",
        "creative_direction": "Rain-slicked streets with vibrant neon reflections. Subject framed by electric blue and magenta city lights.",
        "prompt": (
            "portrait of {subject} standing in a neon-lit cyberpunk alley at night, rain-slicked streets with neon reflections, "
            "electric blue and magenta neon signs, volumetric fog, wet pavement reflections, "
            "wearing sleek dark urban outfit, confident stance, dramatic rim lighting from neon, "
            "cinematic color grading, Blade Runner aesthetic, " + GLOBAL_QUALITY
        ),
        "lighting": "Neon rim lighting in cyan and magenta, volumetric fog, wet surface reflections",
        "camera_lens": "35mm f/1.8 wide angle, low angle shot, anamorphic lens flares",
        "mood_color_grade": "Teal and magenta split toning, high contrast, deep blacks with neon pops",
        "tiktok_hook": "Neon cyberpunk visuals are irresistible scroll-stoppers. High contrast + rain = cinematic dopamine hit.",
    },
    {
        "id": 3,
        "theme": "Golden Hour Outdoor",
        "creative_direction": "Warm sunset backlight in an open field. Subject glowing with natural golden rim light, dreamy atmosphere.",
        "prompt": (
            "portrait of {subject} during golden hour in an open meadow, warm sunset backlighting, "
            "golden rim light on hair and shoulders, soft bokeh of wildflowers in foreground, "
            "wearing casual premium clothing, natural relaxed expression, lens flare, "
            "warm honey tones, dreamy atmospheric haze, " + GLOBAL_QUALITY
        ),
        "lighting": "Natural golden hour backlight, warm rim light, soft fill from sky",
        "camera_lens": "Canon R5, 135mm f/2, extreme shallow DOF, backlit with lens flare",
        "mood_color_grade": "Warm honey golden tones, soft desaturated shadows, dreamy warmth",
        "tiktok_hook": "Golden hour is universally appealing. Warm backlight + dreamy bokeh = emotional engagement.",
    },
    {
        "id": 4,
        "theme": "High-Fashion Studio Editorial",
        "creative_direction": "Clean studio setup with dramatic directional lighting. Subject in high-fashion pose with editorial attitude.",
        "prompt": (
            "high-fashion editorial portrait of {subject} in a professional studio, "
            "dramatic side lighting with sharp shadows, clean seamless background, "
            "wearing high-fashion editorial outfit, strong confident pose, "
            "Vogue magazine cover quality, precise lighting, beauty retouching, "
            "crisp details, fashion photography masterpiece, " + GLOBAL_QUALITY
        ),
        "lighting": "Hard directional key light from 45 degrees, minimal fill, dramatic shadows",
        "camera_lens": "Phase One 150MP, 110mm f/2.8, tethered studio shot, perfect sharpness",
        "mood_color_grade": "Neutral clean tones, precise skin tones, subtle contrast, magazine-ready",
        "tiktok_hook": "Editorial fashion imagery commands authority and aspiration. Clean perfection stands out in messy feeds.",
    },
    {
        "id": 5,
        "theme": "Minimalist Premium White",
        "creative_direction": "Ultra-clean white environment. Subject stands out as the sole focal point. Apple-inspired minimalism.",
        "prompt": (
            "portrait of {subject} in a minimalist all-white environment, clean white walls and floor, "
            "soft diffused lighting, wearing premium minimalist clothing in neutral tones, "
            "calm composed expression, Apple-inspired aesthetic, negative space composition, "
            "soft shadows, pure clean aesthetic, " + GLOBAL_QUALITY
        ),
        "lighting": "Soft diffused overhead light, minimal shadows, even illumination, clean",
        "camera_lens": "85mm f/2, centered composition, lots of negative space, clean framing",
        "mood_color_grade": "Clean whites, subtle warm skin tones, minimal color palette, crisp",
        "tiktok_hook": "Minimalism cuts through visual noise. Clean white space = premium perception, perfect for product launches.",
    },
    {
        "id": 6,
        "theme": "Moody Dark Dramatic",
        "creative_direction": "Low-key dramatic lighting against dark background. Subject emerging from shadows with intense presence.",
        "prompt": (
            "dramatic low-key portrait of {subject} against dark background, "
            "single harsh light source creating deep shadows, chiaroscuro lighting, "
            "wearing dark clothing, intense powerful expression, Rembrandt lighting pattern, "
            "rich deep blacks, selective illumination on face, "
            "fine art portrait quality, dramatic and brooding, " + GLOBAL_QUALITY
        ),
        "lighting": "Single hard key light, Rembrandt pattern, deep shadows, minimal fill",
        "camera_lens": "105mm f/1.4, tight framing, extreme shallow DOF, dark vignette",
        "mood_color_grade": "Deep rich blacks, warm highlights on skin, desaturated, cinematic darkness",
        "tiktok_hook": "Dark dramatic portraits create mystery and intrigue. Chiaroscuro = art gallery energy on TikTok.",
    },
    {
        "id": 7,
        "theme": "Street Urban Aesthetic",
        "creative_direction": "Gritty urban backdrop with concrete and graffiti. Subject owns the space with confident street style.",
        "prompt": (
            "portrait of {subject} in an urban street setting, concrete walls with artistic graffiti, "
            "wearing trendy streetwear outfit, confident casual pose leaning against wall, "
            "overcast natural light, urban texture and grit, shallow depth of field, "
            "street photography style, authentic urban energy, " + GLOBAL_QUALITY
        ),
        "lighting": "Overcast diffused natural light, soft shadows, even urban illumination",
        "camera_lens": "50mm f/1.4, street photography style, environmental portrait, candid feel",
        "mood_color_grade": "Slightly desaturated, cool undertones, urban matte finish, authentic",
        "tiktok_hook": "Street style is TikTok's native language. Authentic urban visuals = relatable and aspirational at once.",
    },
    {
        "id": 8,
        "theme": "Coffee Shop Cozy Vibe",
        "creative_direction": "Warm intimate coffee shop interior. Subject in a cozy moment with warm beverages and soft window light.",
        "prompt": (
            "portrait of {subject} in a cozy artisan coffee shop, sitting by the window, "
            "warm natural window light, steam rising from coffee cup, exposed brick walls, "
            "wearing comfortable premium casual outfit, relaxed genuine smile, "
            "warm wood tones, bokeh of cafe lights in background, intimate atmosphere, " + GLOBAL_QUALITY
        ),
        "lighting": "Soft warm window sidelight, warm interior ambient, golden tones",
        "camera_lens": "85mm f/1.8, shallow DOF, warm toned, intimate close framing",
        "mood_color_grade": "Warm caramel tones, soft highlights, cozy warmth, slightly vintage",
        "tiktok_hook": "Coffee shop vibes are universally loved on TikTok. Warmth + coziness = comfort content that keeps people watching.",
    },
    {
        "id": 9,
        "theme": "Executive Business Power",
        "creative_direction": "Corporate power setting with glass and steel. Subject radiates authority and professional excellence.",
        "prompt": (
            "portrait of {subject} in a modern executive office, glass walls and city view, "
            "wearing impeccable tailored business attire, powerful confident stance, "
            "arms crossed or hands on desk, clean modern furniture, "
            "professional corporate lighting, sharp and polished, "
            "CEO magazine cover quality, authority and competence, " + GLOBAL_QUALITY
        ),
        "lighting": "Clean professional lighting, soft key with subtle fill, window rim light",
        "camera_lens": "70mm f/2.8, medium shot, clean professional framing, slightly low angle for power",
        "mood_color_grade": "Cool professional tones, clean whites, subtle blue undertones, sharp",
        "tiktok_hook": "Power imagery triggers authority bias. Professional excellence + city views = trust and aspiration for business audiences.",
    },
    {
        "id": 10,
        "theme": "Sporty Energetic",
        "creative_direction": "Dynamic athletic setting with motion energy. Subject in peak performance with sweat and determination.",
        "prompt": (
            "dynamic portrait of {subject} in an athletic setting, modern gym or outdoor track, "
            "wearing premium athletic wear, powerful athletic pose mid-movement, "
            "dramatic directional lighting highlighting muscle definition, "
            "sweat glistening on skin, dynamic energy, motion blur in background, "
            "Nike campaign quality, peak performance energy, " + GLOBAL_QUALITY
        ),
        "lighting": "Dramatic side light, hard edge light for definition, dynamic shadows",
        "camera_lens": "24-70mm f/2.8, dynamic angle, slight motion blur, high shutter frozen moment",
        "mood_color_grade": "High contrast, desaturated with selective warm tones on skin, energetic",
        "tiktok_hook": "Athletic energy is magnetic on TikTok. Dynamic movement + dramatic light = adrenaline-inducing scroll-stop.",
    },
    {
        "id": 11,
        "theme": "Rain Cinematic Slow-Motion",
        "creative_direction": "Heavy rain with dramatic backlighting. Subject standing resolute as rain falls around them, cinematic moment.",
        "prompt": (
            "cinematic portrait of {subject} standing in heavy rain at night, "
            "dramatic backlight illuminating rain droplets, wet hair and clothing, "
            "streetlights creating rim light through rain, puddle reflections, "
            "resolute powerful expression, movie poster quality, "
            "slow-motion frozen rain drops, intense emotional moment, " + GLOBAL_QUALITY
        ),
        "lighting": "Strong backlight through rain, streetlight rim lighting, wet surface reflections",
        "camera_lens": "50mm f/1.2, shallow DOF, frozen rain droplets, cinematic framing",
        "mood_color_grade": "Cool blue tones, high contrast, desaturated with warm skin, cinematic",
        "tiktok_hook": "Rain scenes are cinematic gold. Frozen droplets + dramatic light = movie-quality content that stops every scroll.",
    },
    {
        "id": 12,
        "theme": "Rooftop Sunset Vibe",
        "creative_direction": "Urban rooftop during magic hour. Subject silhouetted against colorful sunset skyline, lifestyle perfection.",
        "prompt": (
            "portrait of {subject} on a rooftop terrace at sunset, vibrant orange and purple sky, "
            "city skyline in background, wearing stylish evening outfit, "
            "relaxed pose leaning on railing, cocktail in hand, string lights overhead, "
            "golden sunset rim light, lifestyle magazine quality, "
            "warm euphoric atmosphere, " + GLOBAL_QUALITY
        ),
        "lighting": "Sunset backlight with warm rim, ambient string lights, golden fill",
        "camera_lens": "35mm f/1.4, environmental portrait, cityscape background, warm flare",
        "mood_color_grade": "Warm sunset oranges and purples, golden skin tones, euphoric warmth",
        "tiktok_hook": "Rooftop sunsets are peak lifestyle content. Skyline + golden light = aspirational living that drives engagement.",
    },
    {
        "id": 13,
        "theme": "Soft Romantic Pastel",
        "creative_direction": "Dreamy pastel environment with soft focus. Subject in ethereal romantic setting, gentle and beautiful.",
        "prompt": (
            "soft romantic portrait of {subject} in a pastel dream-like setting, "
            "surrounded by soft pink and lavender flowers, gentle diffused lighting, "
            "wearing elegant flowing pastel outfit, soft gentle expression, "
            "ethereal atmosphere, soft focus background, "
            "delicate beauty, dreamy romantic editorial, " + GLOBAL_QUALITY
        ),
        "lighting": "Ultra-soft diffused light, no hard shadows, gentle wraparound illumination",
        "camera_lens": "100mm f/2, extreme shallow DOF, soft dreamy bokeh, slight soft filter",
        "mood_color_grade": "Soft pastels, pink and lavender tones, lifted shadows, dreamy and ethereal",
        "tiktok_hook": "Pastel romantic aesthetics trigger emotional softness. Dreamy visuals = saved and shared for beauty aspirations.",
    },
    {
        "id": 14,
        "theme": "Futuristic Tech Environment",
        "creative_direction": "Sci-fi tech environment with holographic displays. Subject as a future visionary surrounded by technology.",
        "prompt": (
            "portrait of {subject} in a futuristic tech environment, holographic displays and data streams, "
            "clean white and blue tech interior, wearing modern minimalist tech outfit, "
            "cool blue ambient lighting, interactive holographic UI elements floating nearby, "
            "sharp precise aesthetic, tech visionary energy, "
            "sci-fi movie production design quality, " + GLOBAL_QUALITY
        ),
        "lighting": "Cool blue tech ambient, holographic screen glow on face, clean edge light",
        "camera_lens": "35mm f/2, wide enough for environment, tech elements in foreground bokeh",
        "mood_color_grade": "Cool blue-white tones, clean precise, slight cyan tint, futuristic",
        "tiktok_hook": "Futuristic tech visuals scream innovation. Holographic elements + clean design = attention from tech-savvy audiences.",
    },
    {
        "id": 15,
        "theme": "Black & White Classic",
        "creative_direction": "Timeless black and white portrait. Subject in classic elegant styling with dramatic contrast and film grain.",
        "prompt": (
            "classic black and white portrait of {subject}, timeless elegant styling, "
            "dramatic contrast with rich blacks and bright highlights, "
            "wearing classic elegant outfit, strong composed expression, "
            "Helmut Newton inspired aesthetic, fine art film grain, "
            "silver gelatin print quality, timeless sophistication, " + GLOBAL_QUALITY
        ),
        "lighting": "Classic Paramount lighting, butterfly pattern, dramatic contrast, silver tones",
        "camera_lens": "90mm f/2, classic portrait framing, high contrast B&W, fine grain",
        "mood_color_grade": "Pure black and white, rich tonal range, deep blacks, luminous highlights, film grain",
        "tiktok_hook": "B&W stands out in a colorful feed. Timeless elegance = perceived sophistication that earns trust.",
    },
    {
        "id": 16,
        "theme": "Vibrant Colorful Gen-Z",
        "creative_direction": "Explosive color with bold graphic elements. Subject surrounded by vibrant pops of color, youthful energy.",
        "prompt": (
            "vibrant colorful portrait of {subject} surrounded by bold color splashes, "
            "bright primary colors, geometric shapes, confetti or paint splatter effects, "
            "wearing bold colorful trendy outfit, energetic joyful expression, "
            "pop art influenced, high energy, Gen-Z aesthetic, "
            "bright saturated colors, playful creative, " + GLOBAL_QUALITY
        ),
        "lighting": "Bright even lighting, colorful gels, multiple colored light sources",
        "camera_lens": "50mm f/2, sharp and vibrant, bold framing, color everywhere",
        "mood_color_grade": "Hyper-saturated primaries, bright whites, punchy contrast, youthful energy",
        "tiktok_hook": "Bold colors are algorithm fuel. High saturation + Gen-Z aesthetic = native TikTok energy that boosts engagement.",
    },
    {
        "id": 17,
        "theme": "Nature Adventure Aesthetic",
        "creative_direction": "Epic natural landscape backdrop. Subject as an explorer in breathtaking wilderness, adventure calling.",
        "prompt": (
            "adventure portrait of {subject} in a breathtaking mountain landscape, "
            "dramatic cliff edge or mountain peak, vast valley below, "
            "wearing outdoor adventure gear, looking toward the horizon, "
            "epic natural lighting, dramatic clouds, golden light on peaks, "
            "National Geographic quality, wanderlust energy, " + GLOBAL_QUALITY
        ),
        "lighting": "Dramatic natural landscape light, rim light from sky, cloud-filtered sun",
        "camera_lens": "24mm f/2.8, wide environmental portrait, epic landscape framing, deep DOF",
        "mood_color_grade": "Natural earth tones, dramatic sky, warm highlights on subject, epic scale",
        "tiktok_hook": "Epic landscapes trigger wanderlust. Adventure + dramatic scale = saved and shared by travel and lifestyle audiences.",
    },
    {
        "id": 18,
        "theme": "Home Comfort Lifestyle",
        "creative_direction": "Warm home interior with soft natural light. Subject in comfortable elegant leisure, authentic relaxation.",
        "prompt": (
            "lifestyle portrait of {subject} at home in a beautifully designed living room, "
            "soft morning window light, wearing comfortable premium loungewear, "
            "curled up on designer sofa with book or device, "
            "warm neutral interior, plants and natural textures, "
            "lifestyle brand campaign quality, authentic comfort, " + GLOBAL_QUALITY
        ),
        "lighting": "Soft warm morning window light, gentle fill, natural home ambiance",
        "camera_lens": "50mm f/1.8, lifestyle documentary style, natural candid feel, warm tones",
        "mood_color_grade": "Warm neutral tones, soft contrast, creamy highlights, homey warmth",
        "tiktok_hook": "Home comfort content is relatable and aspirational. Cozy living + premium styling = lifestyle brand energy.",
    },
    {
        "id": 19,
        "theme": "Party Nightlife Vibe",
        "creative_direction": "VIP club atmosphere with dynamic lighting. Subject in the center of nightlife energy, glamorous and magnetic.",
        "prompt": (
            "portrait of {subject} in a VIP nightclub setting, dynamic colored lighting, "
            "LED strips and laser effects in background, wearing glamorous party outfit, "
            "confident charismatic expression, champagne or cocktail, "
            "club atmosphere with bokeh of lights and silhouettes, "
            "music video quality, magnetic nightlife energy, " + GLOBAL_QUALITY
        ),
        "lighting": "Dynamic colored club lights, purple and gold accents, strobing edge light",
        "camera_lens": "35mm f/1.4, slightly wide, dynamic angle, club light bokeh, motion feel",
        "mood_color_grade": "Deep purples and golds, high contrast, selective warmth on skin, nightlife",
        "tiktok_hook": "Nightlife visuals trigger FOMO. Club energy + glamour = irresistible for entertainment and lifestyle audiences.",
    },
    {
        "id": 20,
        "theme": "Ultra Luxury Dramatic Spotlight",
        "creative_direction": "Single dramatic spotlight in total darkness. Subject as the sole focus with theatrical presence, haute couture energy.",
        "prompt": (
            "dramatic portrait of {subject} illuminated by a single overhead spotlight in complete darkness, "
            "pool of light on subject, everything else in deep black, "
            "wearing haute couture or statement luxury piece, "
            "powerful statuesque pose, theatrical presence, "
            "dust particles visible in light beam, museum exhibition quality, "
            "ultimate luxury dramatic, " + GLOBAL_QUALITY
        ),
        "lighting": "Single overhead spotlight, complete darkness around, dust particles in beam",
        "camera_lens": "85mm f/1.2, tight dramatic framing, extreme contrast, theatrical",
        "mood_color_grade": "Pure black background, warm spotlight on subject, extreme contrast, theatrical drama",
        "tiktok_hook": "Spotlight in darkness is the ultimate attention command. Theatrical drama = luxury brand energy that demands attention.",
    },
    {
        "id": 21,
        "theme": "Vintage Film Nostalgia",
        "creative_direction": "70s/80s retro film aesthetic with warm grain and faded tones. Subject in vintage styling with analog camera feel.",
        "prompt": (
            "vintage film portrait of {subject} with 1970s analog film aesthetic, "
            "warm faded color tones, heavy film grain, Kodak Portra 400 color rendition, "
            "wearing retro vintage outfit, relaxed nostalgic pose, "
            "soft warm light leaks, slightly overexposed highlights, "
            "analog photography aesthetic, nostalgic and timeless, " + GLOBAL_QUALITY
        ),
        "lighting": "Warm natural light, soft overexposed highlights, light leaks, golden fill",
        "camera_lens": "50mm vintage lens, soft edges, heavy film grain, warm color cast",
        "mood_color_grade": "Faded warm tones, lifted blacks, Kodak Portra look, nostalgic warmth",
        "tiktok_hook": "Vintage film aesthetic triggers nostalgia. Analog warmth + retro styling = emotionally resonant content.",
    },
    {
        "id": 22,
        "theme": "Desert Editorial",
        "creative_direction": "Vast desert landscape with golden sand dunes. Subject as a striking figure against endless desert horizon.",
        "prompt": (
            "editorial portrait of {subject} in a vast desert landscape, golden sand dunes, "
            "harsh directional sunlight creating long shadows, wearing flowing desert-appropriate fashion, "
            "wind-blown fabric and hair, powerful presence against vast emptiness, "
            "Lawrence of Arabia cinematic quality, epic scale, " + GLOBAL_QUALITY
        ),
        "lighting": "Harsh directional desert sun, long dramatic shadows, warm golden light",
        "camera_lens": "35mm f/2, wide to show scale, subject against vast landscape, epic",
        "mood_color_grade": "Warm golden desert tones, high contrast, sandy warm highlights, epic scale",
        "tiktok_hook": "Desert emptiness creates visual drama. Epic scale + fashion = high-impact editorial energy.",
    },
    {
        "id": 23,
        "theme": "Underwater Fantasy",
        "creative_direction": "Ethereal underwater or aquatic setting with flowing fabrics and light rays. Subject in a dream-like aquatic world.",
        "prompt": (
            "ethereal portrait of {subject} in an underwater fantasy setting, "
            "flowing fabric and hair suspended in water, sunlight rays piercing through blue water, "
            "bubbles and light caustics, wearing flowing aquatic-themed outfit, "
            "serene weightless expression, dream-like atmosphere, "
            "underwater fashion photography masterpiece, " + GLOBAL_QUALITY
        ),
        "lighting": "Sunlight rays through water, blue-green caustic patterns, ethereal glow",
        "camera_lens": "Wide underwater housing, 24mm f/2.8, light rays and bubbles, dream-like",
        "mood_color_grade": "Deep aqua blues and teals, luminous highlights, ethereal dream quality",
        "tiktok_hook": "Underwater imagery is rare and mesmerizing. Ethereal quality = save-worthy content that stands apart.",
    },
    {
        "id": 24,
        "theme": "Cherry Blossom Japanese",
        "creative_direction": "Japanese cherry blossom garden in full bloom. Subject framed by cascading pink petals, serene beauty.",
        "prompt": (
            "portrait of {subject} in a Japanese cherry blossom garden in full bloom, "
            "cascading pink sakura petals falling, traditional garden with wooden bridge, "
            "wearing elegant outfit, serene graceful expression, "
            "soft diffused spring light, pink petal bokeh, "
            "Japanese aesthetic beauty, zen tranquility, " + GLOBAL_QUALITY
        ),
        "lighting": "Soft diffused overcast spring light, gentle pink fill from blossoms, delicate",
        "camera_lens": "85mm f/1.4, cherry blossom petal bokeh, soft and dreamy, spring colors",
        "mood_color_grade": "Soft pinks and whites, delicate pastel tones, gentle spring warmth",
        "tiktok_hook": "Cherry blossom content goes viral every spring. Pink petals + serene beauty = universally loved aesthetic.",
    },
    {
        "id": 25,
        "theme": "Cinematic Film Noir",
        "creative_direction": "1940s film noir detective aesthetic. Subject in dramatic shadows with Venetian blind patterns, mystery and intrigue.",
        "prompt": (
            "film noir portrait of {subject} in a 1940s detective office, "
            "Venetian blind shadow patterns across face, dramatic hard lighting, "
            "wearing classic noir outfit, mysterious intense expression, "
            "cigarette smoke wisps, desk lamp harsh light, "
            "classic Hollywood film noir, mystery and intrigue, " + GLOBAL_QUALITY
        ),
        "lighting": "Hard key light through Venetian blinds, dramatic shadow patterns, noir contrast",
        "camera_lens": "50mm f/2, classic noir framing, dramatic shadow play, high contrast",
        "mood_color_grade": "High contrast, deep shadows, warm tungsten highlights, noir atmosphere",
        "tiktok_hook": "Film noir style is visually striking. Shadow patterns + mystery = sophisticated content that earns engagement.",
    },
    {
        "id": 26,
        "theme": "Tropical Paradise",
        "creative_direction": "Lush tropical beach setting with crystal clear water. Subject in paradise with vibrant island colors.",
        "prompt": (
            "portrait of {subject} on a tropical paradise beach, crystal clear turquoise water, "
            "white sand, palm trees and lush tropical foliage, "
            "wearing stylish resort wear, relaxed confident pose, "
            "golden tropical sunlight, ocean sparkle, "
            "luxury travel magazine quality, paradise vibes, " + GLOBAL_QUALITY
        ),
        "lighting": "Golden tropical sun, ocean light reflections, warm paradise glow",
        "camera_lens": "35mm f/2, environmental portrait, turquoise water background, tropical warmth",
        "mood_color_grade": "Vibrant tropical colors, turquoise and gold, warm saturated, paradise glow",
        "tiktok_hook": "Tropical paradise triggers instant escapism. Beach + luxury = aspirational travel content that drives shares.",
    },
    {
        "id": 27,
        "theme": "Industrial Warehouse",
        "creative_direction": "Raw industrial warehouse with exposed concrete and metal. Subject contrasts raw environment with polished styling.",
        "prompt": (
            "portrait of {subject} in a raw industrial warehouse, exposed concrete walls, "
            "rusty metal beams, large industrial windows with dusty light shafts, "
            "wearing polished high-fashion outfit contrasting raw space, "
            "dramatic shaft of light, dust particles floating, "
            "fashion meets industrial, editorial contrast, " + GLOBAL_QUALITY
        ),
        "lighting": "Dramatic shaft of light through industrial windows, dust particles visible, hard contrast",
        "camera_lens": "50mm f/1.8, medium framing, industrial texture, fashion contrast",
        "mood_color_grade": "Desaturated industrial tones, warm light shaft, gritty with polished subject",
        "tiktok_hook": "Fashion in industrial spaces creates visual tension. Contrast = interest, and interest = engagement.",
    },
    {
        "id": 28,
        "theme": "Neon Tokyo Streets",
        "creative_direction": "Vibrant Tokyo street at night with dense neon signage. Subject immersed in electric Asian urban energy.",
        "prompt": (
            "portrait of {subject} on a vibrant Tokyo street at night, "
            "dense colorful neon signs in Japanese kanji, wet pavement reflections, "
            "busy urban energy with bokeh of city lights, "
            "wearing trendy Tokyo street fashion, confident urban pose, "
            "neon-lit portrait, Lost in Translation atmosphere, " + GLOBAL_QUALITY
        ),
        "lighting": "Dense multi-colored neon signs, warm and cool neon mix, wet reflections",
        "camera_lens": "35mm f/1.4, street photography style, dense neon bokeh, urban energy",
        "mood_color_grade": "Multi-colored neon tones, warm-cool contrast, urban night vibrancy",
        "tiktok_hook": "Tokyo neon streets are visual candy. Dense color + urban energy = irresistible scroll-stopping content.",
    },
    {
        "id": 29,
        "theme": "Ethereal Cloud Dream",
        "creative_direction": "Floating among clouds in a surreal dreamscape. Subject in an otherworldly celestial setting, pure fantasy.",
        "prompt": (
            "surreal portrait of {subject} floating among soft white clouds, "
            "heavenly golden light from above, ethereal atmosphere, "
            "wearing flowing white or celestial outfit, serene floating pose, "
            "volumetric god rays through clouds, celestial dream quality, "
            "fantasy editorial masterpiece, otherworldly beauty, " + GLOBAL_QUALITY
        ),
        "lighting": "Heavenly golden god rays through clouds, soft volumetric light, celestial glow",
        "camera_lens": "85mm f/1.2, dreamy soft focus, cloud textures, ethereal quality",
        "mood_color_grade": "Soft whites and golds, heavenly glow, lifted shadows, celestial warmth",
        "tiktok_hook": "Surreal cloud imagery triggers wonder. Celestial beauty = save-worthy fantasy content that gets shared.",
    },
    {
        "id": 30,
        "theme": "Grunge Rebel Aesthetic",
        "creative_direction": "Raw grunge aesthetic with distressed textures and rebellious energy. Subject with attitude in a destroyed set.",
        "prompt": (
            "grunge portrait of {subject} in a distressed abandoned room, "
            "peeling paint walls, broken furniture, gritty texture, "
            "wearing edgy alternative fashion, rebellious attitude, "
            "harsh mixed lighting, dramatic shadows, "
            "raw punk energy, authentic rebellion, " + GLOBAL_QUALITY
        ),
        "lighting": "Harsh mixed sources, practical lighting, gritty shadows, raw and unflattering",
        "camera_lens": "28mm f/2, wide gritty framing, distressed texture, raw energy",
        "mood_color_grade": "Desaturated muted tones, green-yellow cast, gritty contrast, raw punk",
        "tiktok_hook": "Grunge rebellion cuts through polished feeds. Raw authenticity = connection with alternative and Gen-Z audiences.",
    },
]


def get_prompt(theme_id, subject_description, color="none", screen_ratio="9:16"):
    """Get a fully formatted prompt for a specific theme with user options.

    Args:
        theme_id: Theme number (1-30).
        subject_description: Description of the subject to maintain identity.
            Example: "a young woman with long brown hair and brown eyes"
        color: Color palette key from COLOR_PALETTES.
        screen_ratio: Screen ratio key from SCREEN_RATIOS.

    Returns:
        Dict with theme info, formatted prompt, and resolution settings.
    """
    theme = TIKTOK_AD_THEMES[theme_id - 1]
    formatted = dict(theme)

    # Format the base prompt with subject
    prompt = theme["prompt"].format(subject=subject_description)

    # Add color palette modifier
    color_data = COLOR_PALETTES.get(color, COLOR_PALETTES["none"])
    if color_data["prompt_modifier"]:
        prompt += f", {color_data['prompt_modifier']}"

    # Add ratio info to prompt
    ratio_data = SCREEN_RATIOS.get(screen_ratio, SCREEN_RATIOS["9:16"])
    formatted["prompt"] = prompt
    formatted["negative_prompt"] = GLOBAL_NEGATIVE
    formatted["width"] = ratio_data["width"]
    formatted["height"] = ratio_data["height"]
    formatted["screen_ratio"] = screen_ratio
    formatted["color_palette"] = color_data["label"]

    return formatted


def get_all_prompts(subject_description, color="none", screen_ratio="9:16"):
    """Get all 30 themed prompts formatted with user options.

    Args:
        subject_description: Description of the subject.
        color: Color palette key.
        screen_ratio: Screen ratio key.

    Returns:
        List of 30 formatted theme dicts.
    """
    return [
        get_prompt(i + 1, subject_description, color, screen_ratio)
        for i in range(len(TIKTOK_AD_THEMES))
    ]


def get_generation_config(screen_ratio="9:16", num_images=1):
    """Get resolution config for a specific screen ratio.

    Args:
        screen_ratio: One of '9:16', '4:3', '1:1', '16:9', '3:4'.
        num_images: Number of images to generate per theme.

    Returns:
        Dict with width, height, num_images.
    """
    ratio_data = SCREEN_RATIOS.get(screen_ratio, SCREEN_RATIOS["9:16"])
    return {
        "width": ratio_data["width"],
        "height": ratio_data["height"],
        "label": ratio_data["label"],
        "num_images": num_images,
    }


def print_theme_catalog():
    """Print a formatted catalog of all 20 themes."""
    for theme in TIKTOK_AD_THEMES:
        print(f"\n{'='*70}")
        print(f"#{theme['id']:02d} | {theme['theme']}")
        print(f"{'='*70}")
        print(f"Creative Direction: {theme['creative_direction']}")
        print(f"Lighting: {theme['lighting']}")
        print(f"Camera: {theme['camera_lens']}")
        print(f"Mood: {theme['mood_color_grade']}")
        print(f"TikTok Hook: {theme['tiktok_hook']}")
        print(f"Prompt: {theme['prompt'][:150]}...")


def print_available_options():
    """Print all user-selectable options."""
    print("\n--- Screen Ratios ---")
    for key, data in SCREEN_RATIOS.items():
        print(f"  {key:6s}  {data['width']}x{data['height']}  {data['label']}")

    print("\n--- Color Palettes ---")
    for key, data in COLOR_PALETTES.items():
        hex_str = f" ({data['hex']})" if data['hex'] else ""
        print(f"  {key:16s}  {data['label']}{hex_str}")

    print("\n--- Actor: Gender ---")
    for key, val in ACTOR_GENDERS.items():
        print(f"  {key:14s}  {val}")

    print("\n--- Actor: Ethnicity ---")
    for key, val in ACTOR_ETHNICITIES.items():
        print(f"  {key:18s}  {val or '(any)'}")

    print("\n--- Actor: Age Range ---")
    for key, val in ACTOR_AGE_RANGES.items():
        print(f"  {key:10s}  {val or '(any)'}")

    print("\n--- Actor: Features ---")
    for key, val in ACTOR_FEATURES.items():
        print(f"  {key:14s}  {val or '(none)'}")

    print("\n--- Themes (30) ---")
    for theme in TIKTOK_AD_THEMES:
        print(f"  {theme['id']:2d}. {theme['theme']}")


# ── Continuity / Storytelling System ──────────────────────────

CONTINUITY_ARCS = {
    "journey": {
        "label": "Personal Journey",
        "description": "A day-in-the-life narrative from morning to night",
        "beats": [
            "early morning awakening, start of the day, fresh energy",
            "morning routine, getting ready, purposeful preparation",
            "stepping out, beginning the journey, confident departure",
            "midday activity, peak engagement, fully immersed",
            "afternoon momentum, building success, gaining stride",
            "golden hour reflection, rewarding moment, accomplishment",
            "evening transition, winding down, sophisticated leisure",
            "night arrival, final destination, elegant completion",
        ],
    },
    "transformation": {
        "label": "Transformation Arc",
        "description": "A visual transformation from ordinary to extraordinary",
        "beats": [
            "humble beginning, understated presence, quiet potential",
            "first spark, subtle change, awakening interest",
            "building confidence, emerging style, growing presence",
            "breakthrough moment, bold transformation, striking change",
            "full bloom, peak transformation, commanding attention",
            "owning the moment, complete confidence, powerful presence",
            "elevated status, aspirational peak, ultimate expression",
            "iconic moment, legendary status, unforgettable impression",
        ],
    },
    "adventure": {
        "label": "Adventure Narrative",
        "description": "An exploration journey from familiar to extraordinary",
        "beats": [
            "familiar setting, comfort zone, contemplating departure",
            "first step out, crossing the threshold, curious anticipation",
            "discovering new terrain, widening horizons, excited exploration",
            "facing a challenge, dramatic tension, determined resolve",
            "overcoming obstacles, triumphant moment, growing stronger",
            "reaching the summit, breathtaking vista, peak achievement",
            "celebrating victory, euphoric joy, sharing the moment",
            "returning transformed, wiser and bolder, carrying the experience",
        ],
    },
    "emotion": {
        "label": "Emotional Arc",
        "description": "A range of emotions from subtle to intense",
        "beats": [
            "quiet contemplation, introspective calm, subtle emotion",
            "gentle curiosity, soft interest, opening up",
            "growing warmth, emerging smile, genuine connection",
            "passionate intensity, strong emotion, captivating energy",
            "joyful exuberance, radiant happiness, infectious energy",
            "powerful confidence, commanding presence, bold expression",
            "tender vulnerability, authentic moment, raw beauty",
            "serene resolution, peaceful strength, complete harmony",
        ],
    },
}


def get_continuity_modifier(theme_index, total_themes, arc="journey"):
    """Get a continuity narrative modifier for a specific position in the sequence.

    Args:
        theme_index: Current position in the sequence (0-based).
        total_themes: Total number of themes being generated.
        arc: Narrative arc key from CONTINUITY_ARCS.

    Returns:
        String modifier to append to the prompt for narrative continuity.
    """
    arc_data = CONTINUITY_ARCS.get(arc, CONTINUITY_ARCS["journey"])
    beats = arc_data["beats"]

    # Map the theme index to a beat position
    if total_themes <= len(beats):
        beat_idx = int(theme_index * len(beats) / total_themes)
    else:
        beat_idx = theme_index % len(beats)
    beat_idx = min(beat_idx, len(beats) - 1)

    beat = beats[beat_idx]
    position_pct = theme_index / max(total_themes - 1, 1)

    # Add sequence position context
    if position_pct < 0.15:
        sequence_note = "opening scene of a visual narrative"
    elif position_pct < 0.35:
        sequence_note = "early chapter, building momentum in the story"
    elif position_pct < 0.65:
        sequence_note = "middle of the story, peak intensity"
    elif position_pct < 0.85:
        sequence_note = "approaching the climax of the narrative"
    else:
        sequence_note = "final scene, powerful conclusion to the story"

    return (
        f", {beat}, {sequence_note}, "
        f"image {theme_index + 1} of {total_themes} in a cohesive visual story, "
        f"consistent character appearance and styling throughout the series, "
        f"same person same outfit evolving through scenes"
    )


if __name__ == "__main__":
    print_theme_catalog()
