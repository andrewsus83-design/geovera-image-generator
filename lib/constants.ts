import type {
  TikTokTheme, ScreenRatioInfo, ColorPalette, ContinuityArcInfo, GpuInfo,
} from "@/types";

// ── 30 TikTok Ad Themes ─────────────────────────────────────────
export const TIKTOK_AD_THEMES: TikTokTheme[] = [
  { id: 1, name: "Luxury Lifestyle", description: "Penthouse setting with marble/gold accents", mood: "luxurious, aspirational", lighting: "soft diffused", color_palette: "gold, black, white" },
  { id: 2, name: "Night Neon Cyberpunk", description: "Rain-slicked streets with electric neon", mood: "edgy, futuristic", lighting: "neon backlit", color_palette: "electric blue, hot pink, purple" },
  { id: 3, name: "Golden Hour Outdoor", description: "Sunset backlight in golden meadow", mood: "warm, dreamy, natural", lighting: "golden hour", color_palette: "warm gold, amber, orange" },
  { id: 4, name: "High-Fashion Studio Editorial", description: "Dramatic studio lighting, editorial look", mood: "fierce, editorial", lighting: "dramatic studio", color_palette: "stark white, deep shadow" },
  { id: 5, name: "Minimalist Premium White", description: "Ultra-clean white environment", mood: "clean, premium", lighting: "soft white", color_palette: "pure white, ivory" },
  { id: 6, name: "Moody Dark Dramatic", description: "Low-key chiaroscuro lighting", mood: "mysterious, intense", lighting: "chiaroscuro", color_palette: "deep shadow, moody" },
  { id: 7, name: "Street Urban Aesthetic", description: "Gritty urban backdrop with graffiti", mood: "authentic, urban", lighting: "natural street light", color_palette: "urban grey, vivid pop" },
  { id: 8, name: "Coffee Shop Cozy Vibe", description: "Warm intimate coffee shop interior", mood: "cozy, inviting", lighting: "warm ambient", color_palette: "warm brown, caramel" },
  { id: 9, name: "Executive Business Power", description: "Modern corporate office setting", mood: "powerful, confident", lighting: "clean office light", color_palette: "slate, navy, white" },
  { id: 10, name: "Sporty Energetic", description: "Athletic setting with dynamic movement", mood: "energetic, motivated", lighting: "bright dramatic", color_palette: "vivid sport colors" },
  { id: 11, name: "Rain Cinematic Slow-Motion", description: "Heavy rain with dramatic backlighting", mood: "cinematic, intense", lighting: "rain backlit", color_palette: "blue-grey, silver" },
  { id: 12, name: "Rooftop Sunset Vibe", description: "Urban rooftop during magic hour", mood: "aspirational, free", lighting: "golden sunset", color_palette: "warm gradient, city glow" },
  { id: 13, name: "Soft Romantic Pastel", description: "Dreamy pastel environment", mood: "romantic, soft", lighting: "diffused pastel", color_palette: "blush, lavender, mint" },
  { id: 14, name: "Futuristic Tech Environment", description: "Sci-fi with holographic displays", mood: "innovative, futuristic", lighting: "holographic blue", color_palette: "electric blue, white, silver" },
  { id: 15, name: "Black & White Classic", description: "Timeless B&W portrait, Helmut Newton style", mood: "classic, timeless", lighting: "dramatic B&W", color_palette: "pure black and white" },
  { id: 16, name: "Vibrant Colorful Gen-Z", description: "Explosive color with bold graphics", mood: "fun, youthful, bold", lighting: "bright colorful", color_palette: "rainbow vivid" },
  { id: 17, name: "Nature Adventure", description: "Epic natural landscape backdrop", mood: "adventurous, free", lighting: "natural daylight", color_palette: "forest green, mountain blue" },
  { id: 18, name: "Home Comfort Lifestyle", description: "Warm home interior with soft light", mood: "comfortable, relatable", lighting: "warm home light", color_palette: "warm neutral" },
  { id: 19, name: "Party Nightlife Vibe", description: "VIP nightclub with dynamic lighting", mood: "exciting, energetic", lighting: "club dynamic", color_palette: "gold, red, purple" },
  { id: 20, name: "Ultra Luxury Spotlight", description: "Single spotlight in total darkness", mood: "ultra premium, exclusive", lighting: "single spotlight", color_palette: "black, gold accent" },
  { id: 21, name: "Vintage Film Nostalgia", description: "70s/80s retro film aesthetic", mood: "nostalgic, warm", lighting: "retro film grain", color_palette: "faded warm tones" },
  { id: 22, name: "Desert Editorial", description: "Vast desert landscape, golden sand", mood: "epic, raw, bold", lighting: "harsh sun", color_palette: "sand gold, rust, terracotta" },
  { id: 23, name: "Underwater Fantasy", description: "Ethereal underwater setting", mood: "magical, ethereal", lighting: "underwater caustic", color_palette: "deep blue, turquoise, silver" },
  { id: 24, name: "Cherry Blossom Japanese", description: "Japanese garden in full bloom", mood: "serene, elegant", lighting: "soft spring light", color_palette: "sakura pink, white, green" },
  { id: 25, name: "Cinematic Film Noir", description: "1940s detective office aesthetic", mood: "mysterious, dark", lighting: "noir shadows", color_palette: "high contrast B&W" },
  { id: 26, name: "Tropical Paradise", description: "Lush tropical beach setting", mood: "vibrant, joyful", lighting: "tropical sunlight", color_palette: "turquoise, sand, lime" },
  { id: 27, name: "Industrial Warehouse", description: "Raw industrial with exposed concrete", mood: "raw, authentic, edgy", lighting: "industrial overhead", color_palette: "concrete grey, rust" },
  { id: 28, name: "Neon Tokyo Streets", description: "Vibrant Tokyo street at night", mood: "electric, exotic", lighting: "neon kanji signs", color_palette: "Japanese neon vivid" },
  { id: 29, name: "Ethereal Cloud Dream", description: "Floating among clouds in dreamscape", mood: "ethereal, peaceful", lighting: "celestial soft", color_palette: "white, soft blue, gold" },
  { id: 30, name: "Grunge Rebel Aesthetic", description: "Raw grunge with distressed textures", mood: "rebellious, raw", lighting: "harsh dramatic", color_palette: "dark, distressed muted" },
];

// ── Theme Categories (for pool filter UI) ───────────────────────
export const THEME_CATEGORIES: { label: string; ids: number[] }[] = [
  { label: "✨ Luxury",     ids: [1, 20, 4, 5, 15] },
  { label: "🌆 Urban",      ids: [7, 2, 28, 27, 12] },
  { label: "🌿 Outdoor",    ids: [3, 17, 22, 26, 24] },
  { label: "🎭 Cinematic",  ids: [6, 11, 25, 21, 15] },
  { label: "🔮 Futuristic", ids: [14, 2, 23, 29] },
  { label: "🎉 Lifestyle",  ids: [8, 18, 10, 19, 13] },
  { label: "🌈 Colorful",   ids: [16, 13, 26, 24, 19] },
  { label: "💼 Business",   ids: [9, 4, 5, 20] },
];

// ── Screen Ratios ───────────────────────────────────────────────
export const SCREEN_RATIOS: Record<string, ScreenRatioInfo> = {
  "9:16": { width: 768, height: 1344, label: "Vertical — TikTok / Reels / Stories" },
  "4:3":  { width: 1024, height: 768, label: "Landscape — Classic" },
  "1:1":  { width: 1024, height: 1024, label: "Square — Instagram Feed" },
  "16:9": { width: 1344, height: 768, label: "Widescreen — YouTube / Banner" },
  "3:4":  { width: 768, height: 1024, label: "Portrait — Pinterest" },
};

// ── Color Palettes ──────────────────────────────────────────────
export const COLOR_PALETTES: Record<string, ColorPalette> = {
  none:           { label: "Default (Theme Colors)", hex: null },
  olive_green:    { label: "Olive Green", hex: "#708238" },
  navy_blue:      { label: "Navy Blue", hex: "#001f3f" },
  coral:          { label: "Coral", hex: "#FF6F61" },
  burgundy:       { label: "Burgundy", hex: "#800020" },
  gold:           { label: "Gold", hex: "#FFD700" },
  teal:           { label: "Teal", hex: "#008080" },
  blush_pink:     { label: "Blush Pink", hex: "#DE5D83" },
  charcoal:       { label: "Charcoal", hex: "#36454F" },
  lavender:       { label: "Lavender", hex: "#E6E6FA" },
  burnt_orange:   { label: "Burnt Orange", hex: "#CC5500" },
  emerald:        { label: "Emerald", hex: "#50C878" },
  ivory:          { label: "Ivory / Cream", hex: "#FFFFF0" },
  electric_blue:  { label: "Electric Blue", hex: "#7DF9FF" },
  earth_tones:    { label: "Earth Tones", hex: "#8B7355" },
  monochrome:     { label: "Monochrome", hex: "#808080" },
};

// ── Continuity Arcs ─────────────────────────────────────────────
export const CONTINUITY_ARCS: Record<string, ContinuityArcInfo> = {
  journey: {
    label: "Personal Journey",
    description: "A day-in-the-life narrative from morning to night",
    beats: ["Morning awakening", "Preparation", "Departure", "Peak engagement", "Momentum", "Golden hour", "Evening wind-down", "Final destination"],
  },
  transformation: {
    label: "Transformation Arc",
    description: "From ordinary to extraordinary",
    beats: ["Humble beginning", "First spark", "Building confidence", "Breakthrough moment", "Full bloom", "Owning the moment", "Elevated status", "Iconic moment"],
  },
  adventure: {
    label: "Adventure Narrative",
    description: "Exploration from familiar to extraordinary",
    beats: ["Comfort zone", "First step out", "Discovering new terrain", "Facing a challenge", "Overcoming obstacles", "Summit reached", "Victory celebration", "Returning transformed"],
  },
  emotion: {
    label: "Emotional Arc",
    description: "A range of emotions from subtle to intense",
    beats: ["Quiet contemplation", "Gentle curiosity", "Growing warmth", "Passionate intensity", "Joyful exuberance", "Powerful confidence", "Tender vulnerability", "Serene resolution"],
  },
};

// ── GPU Catalog (Modal.com pricing) ─────────────────────────────
export const GPU_CATALOG: Record<string, GpuInfo> = {
  any:  { name: "T4 (default)", vram_gb: 16, price_hr: 0.59, tier: "budget", flux_dev_s: 22, flux_schnell_s: 4, sdxl_s: 8 },
  t4:   { name: "T4 16GB",      vram_gb: 16, price_hr: 0.59, tier: "budget", flux_dev_s: 22, flux_schnell_s: 4, sdxl_s: 8 },
  a10g: { name: "A10G 24GB",    vram_gb: 24, price_hr: 1.10, tier: "mid",    flux_dev_s: 14, flux_schnell_s: 3, sdxl_s: 5 },
  a100: { name: "A100 40GB",    vram_gb: 40, price_hr: 3.04, tier: "high",   flux_dev_s: 8,  flux_schnell_s: 2, sdxl_s: 3 },
  h100: { name: "H100",         vram_gb: 80, price_hr: 4.68, tier: "high",   flux_dev_s: 5,  flux_schnell_s: 1, sdxl_s: 2 },
};

// ── Actor Options ───────────────────────────────────────────────
export const ETHNICITIES = [
  { value: "any", label: "Any Ethnicity" },
  { value: "asian", label: "Asian" },
  { value: "southeast_asian", label: "Southeast Asian" },
  { value: "east_asian", label: "East Asian" },
  { value: "south_asian", label: "South Asian" },
  { value: "caucasian", label: "Caucasian" },
  { value: "african", label: "African" },
  { value: "african_american", label: "African American" },
  { value: "latino", label: "Latino / Latina" },
  { value: "middle_eastern", label: "Middle Eastern" },
  { value: "mixed", label: "Mixed" },
];

export const AGE_RANGES = [
  { value: "teen", label: "Teenager (13-19)" },
  { value: "20s", label: "Early 20s" },
  { value: "late_20s", label: "Late 20s" },
  { value: "30s", label: "Early 30s" },
  { value: "late_30s", label: "Late 30s" },
  { value: "40s", label: "40s" },
  { value: "50s", label: "50s" },
  { value: "60s", label: "60s+" },
  { value: "any", label: "Any Age" },
];

export const FEATURES = [
  { value: "long_hair", label: "Long Hair" },
  { value: "short_hair", label: "Short Hair" },
  { value: "curly_hair", label: "Curly Hair" },
  { value: "straight_hair", label: "Straight Hair" },
  { value: "bald", label: "Bald" },
  { value: "beard", label: "Beard" },
  { value: "glasses", label: "Glasses" },
  { value: "freckles", label: "Freckles" },
  { value: "tattoos", label: "Tattoos" },
];

export const PROP_POSITIONS = [
  { value: "center-bottom", label: "Center Bottom" },
  { value: "center", label: "Center" },
  { value: "center-top", label: "Center Top" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "bottom-left", label: "Bottom Left" },
  { value: "bottom-right", label: "Bottom Right" },
];

// ── Camera Shots ────────────────────────────────────────────────
export const CAMERA_SHOTS = [
  { value: "none",        label: "Normal (Auto)",    prompt: "" },
  { value: "mix",         label: "Mix (Auto-vary)",  prompt: "__mix__" },
  { value: "extreme_close", label: "Extreme Close-up", prompt: "extreme close-up shot, macro detail" },
  { value: "close",       label: "Close-up",         prompt: "close-up shot, face and product detail" },
  { value: "medium_close",label: "Medium Close",     prompt: "medium close-up shot, waist up" },
  { value: "medium",      label: "Medium Shot",      prompt: "medium shot, half body" },
  { value: "medium_wide", label: "Medium Wide",      prompt: "medium wide shot, full body" },
  { value: "wide",        label: "Wide Shot",        prompt: "wide shot, full environment visible" },
  { value: "extreme_wide",label: "Extreme Wide",     prompt: "extreme wide shot, aerial or panoramic view" },
  { value: "overhead",    label: "Overhead / Top",   prompt: "overhead top-down shot, bird's eye view" },
  { value: "low_angle",   label: "Low Angle",        prompt: "low angle shot, looking up, dramatic perspective" },
  { value: "high_angle",  label: "High Angle",       prompt: "high angle shot, looking down" },
];
