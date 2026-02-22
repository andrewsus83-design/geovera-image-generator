"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  Zap, Play, AlertCircle, CheckCircle, Sparkles,
  ImageIcon, X, Plus, Archive, RefreshCcw, Loader2, Wand2, Trash2,
} from "lucide-react";
import { Suspense } from "react";
import ImageUpload from "@/components/TikTokAds/ImageUpload";
import { ETHNICITIES, AGE_RANGES, FEATURES } from "@/lib/constants";
import { popLoraHandoff } from "@/lib/loraHandoff";
import { dbSaveCharacter } from "@/lib/charactersDb";

// ── Optimal LoRA configs ───────────────────────────────────────────
const LORA_CONFIGS = {
  actor: {
    steps: 2500, lr: "2e-5", rank: 32,
    reason: "Higher rank (32) preserves facial identity. Lower LR (2e-5) + cosine scheduler = Flux best practice for character LoRA.",
    estTime: "~2-3hr on RTX 4090",
    minImages: 6,
    strengthDefault: 0.65,
  },
  prop: {
    steps: 800, lr: "1e-4", rank: 16,
    reason: "Standard rank (16) is sufficient for product texture & shape. Balanced LR for clean results.",
    estTime: "~45min-1hr on RTX 4090",
    minImages: 6,
    strengthDefault: 0.70,
  },
} as const;

// ── Prop generation presets (lighting × background) ───────────────
const PROP_LIGHTINGS = [
  { value: "studio",    label: "Studio",       prompt: "studio lighting, white background, clean" },
  { value: "natural",   label: "Natural",      prompt: "natural light, soft diffused lighting" },
  { value: "dramatic",  label: "Dramatic",     prompt: "dramatic lighting, shadows, high contrast" },
  { value: "ring",      label: "Ring Light",   prompt: "ring light, even lighting, product photography" },
  { value: "sunset",    label: "Warm/Sunset",  prompt: "warm golden hour lighting, lifestyle feel" },
] as const;

const PROP_BACKGROUNDS = [
  { value: "white",     label: "White",        prompt: "white background, clean backdrop" },
  { value: "dark",      label: "Dark/Black",   prompt: "dark background, black backdrop, premium" },
  { value: "lifestyle", label: "Lifestyle",    prompt: "lifestyle setting, wooden surface, natural props" },
  { value: "gradient",  label: "Gradient",     prompt: "gradient background, soft color" },
  { value: "outdoor",   label: "Outdoor",      prompt: "outdoor setting, natural environment" },
] as const;

const PROP_ANGLES = [
  { value: "front",   label: "Front",    prompt: "front view, facing camera" },
  { value: "3q",      label: "3/4 View", prompt: "three-quarter angle view" },
  { value: "side",    label: "Side",     prompt: "side profile view" },
  { value: "top",     label: "Top Down", prompt: "overhead top-down view, flat lay" },
  { value: "detail",  label: "Detail",   prompt: "close-up detail shot, macro, sharp focus" },
] as const;

// ── Outfit / style presets for actor ─────────────────────────────
const ACTOR_OUTFITS = [
  { value: "casual",      label: "Casual",       prompt: "casual outfit, jeans and t-shirt" },
  { value: "business",    label: "Business",     prompt: "business casual attire, smart outfit" },
  { value: "formal",      label: "Formal",       prompt: "formal dress, elegant attire" },
  { value: "sportswear",  label: "Sportswear",   prompt: "sportswear, athletic outfit" },
  { value: "streetwear",  label: "Streetwear",   prompt: "streetwear, trendy urban fashion" },
  { value: "hijab",       label: "Hijab",        prompt: "wearing hijab, modest fashion, headscarf" },
  { value: "traditional", label: "Traditional",  prompt: "traditional cultural outfit, ethnic wear" },
] as const;

// ── Auto-build actor prompt from selections ───────────────────────
function buildActorPrompt(
  gender: string, ethnicity: string, age: string,
  features: string[], outfit: string, extra: string,
): string {
  const parts: string[] = [];
  const genderMap: Record<string, string> = { female: "woman", male: "man", non_binary: "person" };
  const ethnicityLabels: Record<string, string> = {
    southeast_asian: "Southeast Asian", east_asian: "East Asian", south_asian: "South Asian",
    asian: "Asian", caucasian: "Caucasian", african: "African", african_american: "African American",
    latino: "Latino/Latina", middle_eastern: "Middle Eastern", mixed: "mixed ethnicity",
  };
  const ageLabels: Record<string, string> = {
    teen: "teenager", "20s": "early 20s", late_20s: "late 20s",
    "30s": "early 30s", late_30s: "late 30s", "40s": "40s", "50s": "50s", "60s": "60s",
  };
  const featureLabels: Record<string, string> = {
    long_hair: "long hair", short_hair: "short hair", curly_hair: "curly hair",
    straight_hair: "straight hair", bald: "bald head", beard: "beard",
    glasses: "wearing glasses", freckles: "freckles", tattoos: "visible tattoos",
  };
  const outfitPrompts: Record<string, string> = {
    casual: "casual outfit", business: "business casual attire",
    formal: "formal elegant attire", sportswear: "sportswear",
    streetwear: "streetwear urban fashion",
    hijab: "wearing hijab, modest fashion, headscarf",
    traditional: "traditional cultural outfit",
  };

  const eth = ethnicity !== "any" ? `${ethnicityLabels[ethnicity] ?? ethnicity} ` : "";
  const ag  = age !== "any" ? `${ageLabels[age] ?? age} ` : "";
  parts.push(`portrait photo of a ${eth}${ag}${genderMap[gender] ?? "person"}`);

  const fts = features.map((f) => featureLabels[f] ?? f).filter(Boolean);
  if (fts.length) parts.push(fts.join(", "));
  if (outfit && outfit !== "none") parts.push(outfitPrompts[outfit] ?? outfit);
  if (extra.trim()) parts.push(extra.trim());
  parts.push("studio lighting, sharp focus, professional photo, high quality, 8k");
  return parts.join(", ");
}

// ── Auto-build prop prompt from selections ────────────────────────
function buildPropPrompt(
  lighting: string, background: string, angle: string,
  productDesc: string,
): string {
  const lightingMap: Record<string, string> = {
    studio: "studio lighting, white background, clean", natural: "natural light, soft diffused",
    dramatic: "dramatic lighting, high contrast shadows", ring: "ring light, even lighting",
    sunset: "warm golden hour lighting",
  };
  const bgMap: Record<string, string> = {
    white: "white background", dark: "dark background, black backdrop",
    lifestyle: "lifestyle setting, wooden surface", gradient: "gradient background",
    outdoor: "outdoor natural environment",
  };
  const angleMap: Record<string, string> = {
    front: "front view", "3q": "three-quarter angle", side: "side profile",
    top: "overhead flat lay view", detail: "close-up macro detail",
  };

  const parts: string[] = [];
  if (productDesc.trim()) parts.push(`product photo of ${productDesc.trim()}`);
  else parts.push("product photo");
  parts.push(angleMap[angle] ?? angle);
  parts.push(lightingMap[lighting] ?? lighting);
  parts.push(bgMap[background] ?? background);
  parts.push("commercial photography, sharp focus, high quality");
  return parts.join(", ");
}


interface LoadedLoraData {
  frames: string[];
  productName: string;
  captions: string[];
  source: "lora360" | "augment" | "zip" | "images" | "actor_gen" | "prop_gen";
  frameCount: number;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ── ZIP reader — extract PNG/JPG/WEBP images + optional captions.txt ────────
// Supports ZIPs built by Character Builder (captions.txt) and legacy ZIPs.
// Format of captions.txt (pipe-separated, one per line):
//   filename.png|ohwx female, oval face, ..., studio lighting
async function readZipContents(file: File): Promise<{
  images: { name: string; dataUrl: string }[];
  captions: Map<string, string>; // filename → caption text
}> {
  const buf   = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const images: { name: string; dataUrl: string }[] = [];
  const captions = new Map<string, string>();

  const u32 = (off: number) =>
    (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
  const u16 = (off: number) => bytes[off] | (bytes[off + 1] << 8);

  let pos = 0;
  while (pos + 30 < bytes.length) {
    if (u32(pos) !== 0x04034b50) break;
    const compMethod = u16(pos + 8);
    const compSize   = u32(pos + 18);
    const nameLen    = u16(pos + 26);
    const extraLen   = u16(pos + 28);
    const dataStart  = pos + 30 + nameLen + extraLen;
    const fullName   = new TextDecoder().decode(bytes.slice(pos + 30, pos + 30 + nameLen));
    const baseName   = fullName.split("/").pop() || fullName;
    const isImg      = /\.(png|jpg|jpeg|webp)$/i.test(baseName) && !fullName.includes("__MACOSX");
    const isCaptions = baseName === "captions.txt" && !fullName.includes("__MACOSX");

    if (compMethod === 0 && dataStart + compSize <= bytes.length) {
      const data = bytes.slice(dataStart, dataStart + compSize);

      if (isImg) {
        const ext  = baseName.split(".").pop()!.toLowerCase();
        const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
        const b64  = btoa(Array.from(data, (b) => String.fromCharCode(b)).join(""));
        images.push({ name: baseName, dataUrl: `data:${mime};base64,${b64}` });
      } else if (isCaptions) {
        // Parse pipe-separated captions: "filename.png|caption text"
        const text = new TextDecoder().decode(data);
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const pipeIdx = trimmed.indexOf("|");
          if (pipeIdx > 0) {
            const fname   = trimmed.slice(0, pipeIdx).trim();
            const caption = trimmed.slice(pipeIdx + 1).trim();
            captions.set(fname, caption);
          }
        }
      }
    }
    pos = dataStart + compSize;
  }
  return { images, captions };
}

// Legacy wrapper — kept for back-compat with existing call sites
async function readZipImages(file: File): Promise<{ name: string; dataUrl: string }[]> {
  const { images } = await readZipContents(file);
  return images;
}

// ────────────────────────────────────────────────────────────────────
function TrainingInner() {
  const searchParams = useSearchParams();

  const [tab, setTab]       = useState<"actor" | "prop" | "lorapack" | "all4">("actor");
  const [running, setRunning] = useState(false);
  const [result, setResult]   = useState<null | {
    ok: boolean; msg: string;
    loraUrl?: string; loraName?: string; cloudinaryUrl?: string;
  }>(null);

  // ── Actor / Prop: generate-then-train state ───────────────────────
  const [apSourceFile, setApSourceFile]   = useState<File | null>(null);
  const [apNumImages, setApNumImages]     = useState(9);
  const [apStrength, setApStrength]       = useState(0.65);
  const [apGenerating, setApGenerating]   = useState(false);
  const [apGenMsg, setApGenMsg]           = useState("");
  const [apGenImages, setApGenImages]     = useState<string[]>([]);
  const [apOriginalImg, setApOriginalImg] = useState<string | null>(null);
  const [apOutputDir, setApOutputDir]     = useState("output/lora");

  // ── Actor selectors ───────────────────────────────────────────────
  const [actGender,   setActGender]   = useState("female");
  const [actEthnicity,setActEthnicity]= useState("southeast_asian");
  const [actAge,      setActAge]      = useState("30s");
  const [actFeatures, setActFeatures] = useState<string[]>(["long_hair"]);
  const [actOutfit,   setActOutfit]   = useState("casual");
  // actExtra & propProductDesc use refs to avoid re-render on every keystroke
  const actExtraRef       = useRef("");
  const propProductDescRef = useRef("");
  // Committed values (updated onBlur) — drive the prompt preview
  const [actExtraCommit,       setActExtraCommit]       = useState("");
  const [propProductDescCommit, setPropProductDescCommit] = useState("");

  // ── Prop selectors ────────────────────────────────────────────────
  const [propLighting,    setPropLighting]    = useState("studio");
  const [propBackground,  setPropBackground]  = useState("white");
  const [propAngle,       setPropAngle]       = useState("3q");

  // ── Auto-build prompt refs (kept fresh for handleGenerate) ──────
  const actorPromptRef  = useRef("");
  const propPromptRef   = useRef("");

  // Compute auto prompts fresh on every render
  const autoActorPrompt = buildActorPrompt(actGender, actEthnicity, actAge, actFeatures, actOutfit, actExtraCommit);
  const autoPropPrompt  = buildPropPrompt(propLighting, propBackground, propAngle, propProductDescCommit);
  // Keep refs always current (used inside handleGenerate / startTraining)
  actorPromptRef.current = buildActorPrompt(actGender, actEthnicity, actAge, actFeatures, actOutfit, actExtraRef.current);
  propPromptRef.current  = buildPropPrompt(propLighting, propBackground, propAngle, propProductDescRef.current);
  const autoPrompt = tab === "actor" ? autoActorPrompt : autoPropPrompt;

  // ── LoRA Pack state ───────────────────────────────────────────────
  const [loraPackData, setLoraPackData]   = useState<LoadedLoraData | null>(null);
  const [loraOutputDir, setLoraOutputDir] = useState("output/lora");
  const [isDraggingLP, setIsDraggingLP]   = useState(false);
  const [lpLoading, setLpLoading]         = useState(false);
  const [lpError, setLpError]             = useState("");
  const zipInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);


  // ── Single character training: fire-and-forget + polling ─────────
  const [singleJobId,       setSingleJobId]       = useState<string | null>(null);
  const [singlePollElapsed, setSinglePollElapsed] = useState(0);
  const [singlePollMsg,     setSinglePollMsg]     = useState("");
  const singlePollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const singleElapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopSinglePolling = useCallback(() => {
    if (singlePollRef.current)    { clearInterval(singlePollRef.current);    singlePollRef.current    = null; }
    if (singleElapsedRef.current) { clearInterval(singleElapsedRef.current); singleElapsedRef.current = null; }
  }, []);

  const pollSingleStatus = useCallback(async (jobId: string, productName: string, trainType: string, bodyFrames: string[]) => {
    try {
      const res = await fetch(`/api/train/status?job_id=${encodeURIComponent(jobId)}`);
      if (!res.ok) return; // transient — keep polling

      const data = await res.json() as {
        ok: boolean;
        status: "running" | "done" | "error" | "unknown";
        results: {
          name: string; gpu: string; ok: boolean;
          lora_name?: string; cloudinary_url?: string; lora_path?: string;
          steps?: number; time?: number; cost_usd?: number; error?: string; message?: string;
        }[];
        total_time?: number;
        total_cost_usd?: number;
        message: string;
      };

      if (!data.ok) return; // job not found yet — keep polling

      setSinglePollMsg(data.message);

      if (data.status === "done" || data.status === "error") {
        stopSinglePolling();
        setRunning(false);

        const r = data.results?.[0];
        setResult({
          ok:            data.status === "done" && (r?.ok ?? false),
          msg:           data.message,
          loraUrl:       r?.cloudinary_url,
          loraName:      r?.lora_name,
          cloudinaryUrl: r?.cloudinary_url,
        });

        // Auto-save to Characters page after successful training
        if (data.status === "done" && r?.ok && r?.lora_name) {
          try {
            const previewImages = bodyFrames
              .slice(0, 6)
              .map((f) => f.startsWith("data:") ? f : `data:image/png;base64,${f}`);
            await dbSaveCharacter({
              id:           `lora_${Date.now()}`,
              name:         productName,
              type:         trainType as "actor" | "prop",
              loraName:     r.lora_name,
              loraUrl:      r.cloudinary_url ?? null,
              previewImages,
              steps:        r.steps ?? 0,
              trainingTime: r.time ?? 0,
              createdAt:    new Date().toISOString(),
            });
            console.log("[Training] Character saved to Characters page:", productName);
          } catch (saveErr) {
            console.warn("[Training] Failed to save character record:", saveErr);
          }
        }
      }
    } catch { /* ignore poll errors */ }
  }, [stopSinglePolling]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup single polling on unmount
  useEffect(() => {
    return () => { stopSinglePolling(); };
  }, [stopSinglePolling]);

  // ── Train All 4 Characters state ─────────────────────────────────
  // GPU assignment: char 0,1 → H100 | char 2,3 → H200
  // Modal pricing 2026: H100 $0.001097/sec, H200 $0.001261/sec
  const CHAR_NAMES    = ["Rio", "Adit", "Aira", "Bella"];
  const CHAR_GPU      = ["H100", "H100", "H200", "H200"] as const;
  const GPU_COST_SEC  = { H100: 0.001097, H200: 0.001261 };
  const TRAIN_EST_SEC = 1200; // ~20 min per character at 1500 steps on H100/H200

  const [all4Slots, setAll4Slots] = useState<(LoadedLoraData | null)[]>([null, null, null, null]);
  const [all4Running, setAll4Running] = useState(false);
  const [all4JobId, setAll4JobId] = useState<string | null>(null);
  const [all4PollElapsed, setAll4PollElapsed] = useState(0);
  const all4PollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const all4ElapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [all4Results, setAll4Results] = useState<{
    name: string; gpu: string; ok: boolean;
    lora_name?: string; cloudinary_url?: string; steps?: number; time?: number; cost_usd?: number; error?: string;
  }[] | null>(null);
  const [all4Msg, setAll4Msg] = useState("");
  const all4ZipRefs = [
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
    useRef<HTMLInputElement>(null),
  ];

  // Stop polling helper
  const stopAll4Polling = useCallback(() => {
    if (all4PollRef.current)    { clearInterval(all4PollRef.current);    all4PollRef.current    = null; }
    if (all4ElapsedRef.current) { clearInterval(all4ElapsedRef.current); all4ElapsedRef.current = null; }
  }, []);

  const loadAll4Slot = useCallback(async (slotIdx: number, file: File) => {
    if (!file.name.endsWith(".zip")) return;
    try {
      const { images: imgs, captions: captionMap } = await readZipContents(file);
      if (imgs.length === 0) return;
      const hasCaptions = captionMap.size > 0;
      const frameCaptions = imgs.map((img) => captionMap.get(img.name) ?? "");
      setAll4Slots((prev) => {
        const next = [...prev];
        next[slotIdx] = {
          frames:     imgs.map((i) => i.dataUrl),
          productName: CHAR_NAMES[slotIdx],
          captions:   frameCaptions,
          source:     hasCaptions ? "actor_gen" : "zip",
          frameCount: imgs.length,
        };
        return next;
      });
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll job status from /api/train/all/status
  const pollAll4Status = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`/api/train/all/status?job_id=${encodeURIComponent(jobId)}`);
      if (!res.ok) return; // Ignore transient errors, keep polling

      const data = await res.json() as {
        ok: boolean;
        status: "running" | "done" | "error" | "unknown";
        results: { name: string; gpu: string; ok: boolean; lora_name?: string; cloudinary_url?: string; steps?: number; time?: number; cost_usd?: number; error?: string }[];
        total_time?: number;
        total_cost_usd?: number;
        parallel_speedup?: number;
        message: string;
      };

      if (!data.ok) return; // Job not found yet, keep polling

      // Update partial results as they come in
      if (data.results && data.results.length > 0) {
        setAll4Results(data.results);
        setAll4Msg(data.message);
      }

      // Training complete
      if (data.status === "done" || data.status === "error") {
        stopAll4Polling();
        setAll4Running(false);
        setAll4Results(data.results ?? []);
        setAll4Msg(data.message ?? (data.status === "done" ? "✅ Training selesai!" : "❌ Training gagal"));

        // Auto-save completed characters to Characters DB
        if (data.results) {
          for (const r of data.results) {
            if (r.ok && r.lora_name) {
              try {
                const slotIdx = CHAR_NAMES.indexOf(r.name);
                const slot = slotIdx >= 0 ? all4Slots[slotIdx] : null;
                const previewImages = slot
                  ? slot.frames.slice(0, 6).map((f) => f.startsWith("data:") ? f : `data:image/png;base64,${f}`)
                  : [];
                await dbSaveCharacter({
                  id:           `lora_${r.name.toLowerCase()}_${Date.now()}`,
                  name:         r.name,
                  type:         "actor",
                  loraName:     r.lora_name,
                  loraUrl:      r.cloudinary_url ?? null,
                  previewImages,
                  steps:        r.steps ?? 0,
                  trainingTime: r.time ?? 0,
                  createdAt:    new Date().toISOString(),
                });
              } catch { /* non-fatal */ }
            }
          }
        }
      }
    } catch { /* ignore poll errors */ }
  }, [all4Slots, stopAll4Polling]); // eslint-disable-line react-hooks/exhaustive-deps

  const startAll4Training = async () => {
    const loaded = all4Slots.map((s, i) => s ? { ...s, slotIdx: i } : null).filter(Boolean) as (LoadedLoraData & { slotIdx: number })[];
    if (loaded.length === 0) { setAll4Msg("⚠ Upload minimal 1 karakter ZIP dulu"); return; }

    stopAll4Polling();
    setAll4Running(true);
    setAll4Results(null);
    setAll4JobId(null);
    setAll4PollElapsed(0);
    setAll4Msg(`⏳ Mengirim ${loaded.length} karakter ke Modal GPU...`);

    try {
      const characters = loaded.map((slot) => ({
        name:     CHAR_NAMES[slot.slotIdx],
        type:     "actor" as const,
        frames:   slot.frames,
        captions: slot.captions,
        steps:    LORA_CONFIGS.actor.steps,
        lr:       parseFloat(LORA_CONFIGS.actor.lr),
        rank:     LORA_CONFIGS.actor.rank,
      }));

      // Fire-and-forget: Modal returns jobId immediately (< 1s)
      const res = await fetch("/api/train/all", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ characters }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Error ${res.status}: ${txt.slice(0, 200)}`);
      }

      const data = await res.json() as {
        ok: boolean;
        job_id: string;
        message: string;
        error?: string;
      };

      if (!data.ok || !data.job_id) {
        throw new Error(data.error ?? "Modal tidak mengembalikan job_id");
      }

      const jobId = data.job_id;
      setAll4JobId(jobId);
      setAll4Msg(`⏳ Training berjalan di Modal GPU... (Job: ${jobId.slice(0, 16)})`);

      // Start polling every 12 seconds
      all4PollRef.current = setInterval(() => pollAll4Status(jobId), 12000);

      // Elapsed counter — updates every second
      all4ElapsedRef.current = setInterval(() => {
        setAll4PollElapsed((prev) => prev + 1);
      }, 1000);

      // First poll after 15s (give Modal time to start training)
      setTimeout(() => pollAll4Status(jobId), 15000);

    } catch (e) {
      setAll4Msg(`❌ ${e instanceof Error ? e.message : String(e)}`);
      setAll4Running(false);
      stopAll4Polling();
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { stopAll4Polling(); };
  }, [stopAll4Polling]);

  // ── Load LoRA data on mount ───────────────────────────────────────
  // Priority: 1) in-memory handoff (Character Builder → large image arrays)
  //           2) sessionStorage (Image-to-Video page → smaller video frames)
  // Handoff is in-memory to avoid sessionStorage 5MB limit (76 images ≈ 7.6MB).
  useEffect(() => {
    const from = searchParams.get("from");

    // 1. Try in-memory handoff first (Character Builder)
    const handoff = popLoraHandoff();
    if (handoff) {
      setLoraPackData(handoff);
      setLoraOutputDir(`output/lora/${handoff.productName || "character"}`);
      if (from === "character-builder") setTab("lorapack");
      return;
    }

    // 2. Fallback: sessionStorage (video page or manual flow)
    const raw = sessionStorage.getItem("loraTrainingData");
    if (raw) {
      try {
        const data = JSON.parse(raw) as LoadedLoraData;
        setLoraPackData(data);
        setLoraOutputDir(`output/lora/${data.productName || "product"}`);
        if (from === "video" || from === "character-builder") setTab("lorapack");
      } catch { /* ignore */ }
    }
  }, [searchParams]);

  // When tab changes, reset strength default
  useEffect(() => {
    if (tab === "actor") setApStrength(LORA_CONFIGS.actor.strengthDefault);
    if (tab === "prop")  setApStrength(LORA_CONFIGS.prop.strengthDefault);
  }, [tab]);

  // ── Generate images via Modal Flux img2img ────────────────────────
  const handleGenerate = async () => {
    if (!apSourceFile) { setApGenMsg("⚠ Upload source image first"); return; }

    setApGenerating(true);
    setApGenMsg(`Generating ${apNumImages} images via Flux...`);
    setApGenImages([]);

    try {
      const origDataUrl = await readFileAsDataUrl(apSourceFile);
      setApOriginalImg(origDataUrl);

      const currentPrompt = tab === "actor" ? actorPromptRef.current : propPromptRef.current;
      const res = await fetch("/api/modal/generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:       currentPrompt,
          sourceImage:  origDataUrl,
          strength:     apStrength,
          numImages:    apNumImages,
          width:        1024,
          height:       1024,
          steps:        20,
          modelVariant: "dev",
        }),
      });

      const data = await res.json() as { ok?: boolean; images?: string[]; error?: string; detail?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? data.detail ?? `HTTP ${res.status}`);

      setApGenImages(data.images ?? []);
      setApGenMsg(`✓ ${data.images?.length ?? 0} images generated`);
    } catch (err) {
      setApGenMsg(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    }
    setApGenerating(false);
  };

  // Remove a generated image
  const removeGenImage = (idx: number) =>
    setApGenImages((prev) => prev.filter((_, i) => i !== idx));

  // Reset entire actor/prop state
  const resetAP = () => {
    setApSourceFile(null);
    actExtraRef.current = "";
    setActExtraCommit("");
    propProductDescRef.current = "";
    setPropProductDescCommit("");
    setApGenImages([]);
    setApOriginalImg(null);
    setApGenMsg("");
    setResult(null);
  };

  // ── LoRA Pack: load from ZIP ──────────────────────────────────────
  // Supports Character Builder ZIPs (with captions.txt) and legacy ZIPs.
  const handleZipFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".zip")) { setLpError("Please select a .zip file"); return; }
    setLpLoading(true); setLpError("");
    try {
      const { images: imgs, captions: captionMap } = await readZipContents(file);
      if (imgs.length === 0) {
        setLpError("No images found in ZIP. The ZIP must use 'Stored' (no compression). Try uploading images individually.");
        setLpLoading(false); return;
      }

      // Extract character/product name from ZIP filename
      // e.g. "aira_lora_dataset_76images.zip" → "aira"
      // e.g. "lora_augmented_10images.zip"    → "product"
      const productName = file.name
        .replace(/\.zip$/i, "")
        .replace(/_lora_dataset_\d+images?$/i, "")   // character builder format
        .replace(/lora_dataset_|lora_augmented_/g, "")
        .replace(/_\d+frames?$/i, "")
        .replace(/_/g, " ")
        .trim() || "character";

      // Map captions from captions.txt to each image in order
      // If captions.txt exists (Character Builder ZIP), use those captions.
      // Otherwise fall back to empty captions (legacy ZIPs).
      const hasCaptions = captionMap.size > 0;
      const frameCaptions = imgs.map((img) => captionMap.get(img.name) ?? "");

      setLoraPackData({
        frames:      imgs.map((i) => i.dataUrl),
        productName,
        captions:    frameCaptions,
        source:      hasCaptions ? "actor_gen" : "zip",  // actor_gen = has anchor captions
        frameCount:  imgs.length,
      });
      setLoraOutputDir(`output/lora/${productName.replace(/\s+/g, "_")}`);

      if (hasCaptions) {
        console.log(`[Training] Loaded ${imgs.length} images + ${captionMap.size} captions from ${file.name}`);
      }
    } catch (e) {
      setLpError(`Failed to read ZIP: ${e instanceof Error ? e.message : "unknown"}`);
    }
    setLpLoading(false);
  }, []);

  // ── LoRA Pack: load from individual images ────────────────────────
  const handleLPImages = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!arr.length) return;
    setLpLoading(true); setLpError("");
    try {
      const imgs = await Promise.all(arr.map(async (f) => ({ name: f.name, dataUrl: await readFileAsDataUrl(f) })));
      const existing = loraPackData;
      const allFrames = [...(existing?.frames ?? []), ...imgs.map((i) => i.dataUrl)];
      setLoraPackData({ frames: allFrames, productName: existing?.productName ?? "product", captions: Array(allFrames.length).fill(""), source: "images", frameCount: allFrames.length });
    } catch (e) {
      setLpError(`Failed to read images: ${e instanceof Error ? e.message : "unknown"}`);
    }
    setLpLoading(false);
  }, [loraPackData]);

  const handleLPDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDraggingLP(false);
    const files    = Array.from(e.dataTransfer.files);
    const zipFile  = files.find((f) => f.name.endsWith(".zip"));
    const imgFiles = files.filter((f) => f.type.startsWith("image/"));
    if (zipFile) handleZipFile(zipFile);
    else if (imgFiles.length) handleLPImages(imgFiles);
  }, [handleZipFile, handleLPImages]);

  const removeLPFrame = (idx: number) => {
    if (!loraPackData) return;
    const frames   = loraPackData.frames.filter((_, i) => i !== idx);
    const captions = loraPackData.captions.filter((_, i) => i !== idx);
    if (!frames.length) { setLoraPackData(null); return; }
    setLoraPackData({ ...loraPackData, frames, captions, frameCount: frames.length });
  };

  // ── Start LoRA training ───────────────────────────────────────────
  // Fire-and-forget: POST /api/train → get job_id immediately
  // Then poll /api/train/status?job_id=... every 12s
  const startTraining = async () => {
    setRunning(true); setResult(null);
    stopSinglePolling();
    setSingleJobId(null);
    setSinglePollElapsed(0);
    setSinglePollMsg("⏳ Mengirim dataset ke Modal GPU...");

    try {
      let body: Record<string, unknown>;
      let trainType: string;
      let trainName: string;
      let bodyFrames: string[];

      if (tab === "lorapack" && loraPackData) {
        const isActorDataset = loraPackData.source === "actor_gen";
        const lpCfg = isActorDataset ? LORA_CONFIGS.actor : LORA_CONFIGS.prop;
        trainType = isActorDataset ? "actor" : "prop";
        trainName = loraPackData.productName;
        bodyFrames = loraPackData.frames;
        body = {
          type: trainType,
          outputDir: loraOutputDir || `output/lora/${loraPackData.productName}`,
          steps: lpCfg.steps, lr: lpCfg.lr, rank: lpCfg.rank,
          frames: loraPackData.frames, captions: loraPackData.captions,
          productName: loraPackData.productName, source: loraPackData.source,
        };
      } else {
        const frames: string[] = [];
        const captions: string[] = [];
        if (apOriginalImg) { frames.push(apOriginalImg); captions.push(`${tab}, original reference photo`); }
        apGenImages.forEach((img, i) => { frames.push(img); captions.push(`${autoPrompt}, variation ${i + 1}`); });

        trainType  = tab === "actor" ? "actor" : "prop";
        trainName  = trainType;
        bodyFrames = frames;
        const tcfg = trainType === "actor" ? LORA_CONFIGS.actor : LORA_CONFIGS.prop;
        body = {
          type: trainType, outputDir: apOutputDir,
          steps: tcfg.steps, lr: tcfg.lr, rank: tcfg.rank,
          frames, captions, productName: trainType,
        };
      }

      // POST /api/train → returns job_id immediately (< 1s)
      const res = await fetch("/api/train", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const d = await res.json() as {
        ok?: boolean; job_id?: string; message?: string; error?: string; detail?: string;
      };

      if (!res.ok || !d.ok || !d.job_id) {
        setResult({ ok: false, msg: d.error ?? d.detail ?? `Server error ${res.status}` });
        setRunning(false);
        setSinglePollMsg("");
        return;
      }

      // Got job_id — training is running on Modal
      sessionStorage.removeItem("loraTrainingData");
      const jobId = d.job_id;
      setSingleJobId(jobId);
      setSinglePollMsg(`⏳ Training berjalan di Modal A100-80GB... (Job: ${jobId.slice(0, 16)})`);

      // Start polling every 12s
      singlePollRef.current = setInterval(
        () => pollSingleStatus(jobId, trainName, trainType, bodyFrames), 12000
      );

      // Elapsed counter — update every second
      singleElapsedRef.current = setInterval(() => {
        setSinglePollElapsed((prev) => prev + 1);
      }, 1000);

      // First poll after 20s (give Modal time to start)
      setTimeout(() => pollSingleStatus(jobId, trainName, trainType, bodyFrames), 20000);

    } catch (e) {
      setResult({ ok: false, msg: `Error: ${e instanceof Error ? e.message : String(e)}` });
      setRunning(false);
      stopSinglePolling();
      setSinglePollMsg("");
    }
  };

  const apTotalImages = (apOriginalImg ? 1 : 0) + apGenImages.length;

  // ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-title-md font-bold text-black dark:text-white flex items-center gap-2">
          <Zap size={22} className="text-warning" /> Training / LoRA
        </h1>
        <p className="text-sm text-body mt-1">Fine-tune LoRA adapters for actor identity or product consistency</p>
      </div>

      {/* Tabs */}
      <div className="flex rounded border border-stroke dark:border-strokedark overflow-hidden w-fit flex-wrap">
        {([
          { key: "actor",  label: "Character / Actor" },
          { key: "prop",   label: "Prop / Product" },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => { setTab(key); setResult(null); }}
            className={`px-5 py-2.5 text-sm font-medium transition-colors
              ${tab === key ? "bg-primary text-white" : "bg-white dark:bg-boxdark text-body hover:bg-gray dark:hover:bg-meta-4"}`}>
            {label}
          </button>
        ))}
        <button onClick={() => { setTab("lorapack"); setResult(null); }}
          className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition-colors
            ${tab === "lorapack" ? "bg-primary text-white" : "bg-white dark:bg-boxdark text-body hover:bg-gray dark:hover:bg-meta-4"}`}>
          <ImageIcon size={13} /> From LoRA Pack
          {loraPackData && (
            <span className={`rounded-full text-[9px] font-bold px-1.5 py-0.5 ml-0.5
              ${tab === "lorapack" ? "bg-white/30 text-white" : "bg-success text-white"}`}>
              {loraPackData.frameCount}
            </span>
          )}
        </button>
        <button onClick={() => { setTab("all4"); setResult(null); }}
          className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition-colors border-l border-stroke dark:border-strokedark
            ${tab === "all4" ? "bg-warning text-white" : "bg-white dark:bg-boxdark text-body hover:bg-gray dark:hover:bg-meta-4"}`}>
          <Zap size={13} /> Train All 4
          <span className={`rounded-full text-[9px] font-bold px-1.5 py-0.5
            ${tab === "all4" ? "bg-white/30 text-white" : "bg-warning/20 text-warning"}`}>
            2×H100 + 2×H200
          </span>
        </button>
      </div>

      {/* ══════════ TAB: ACTOR / PROP ══════════ */}
      {(tab === "actor" || tab === "prop") && (
        <div className="space-y-5">

          {/* ── Step 1: Upload source photo ── */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-black dark:text-white text-sm flex items-center gap-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold">1</span>
                  Upload {tab === "actor" ? "Character Photo" : "Product Photo"}
                </h2>
                <p className="text-xs text-body mt-1 ml-7">
                  {tab === "actor"
                    ? "Upload 1 foto wajah/tubuh aktor. AI akan generate variasi dari foto ini."
                    : "Upload 1 foto produk. AI akan generate variasi lighting, angle, dan background."}
                </p>
              </div>
              {(apOriginalImg || apGenImages.length > 0) && (
                <button onClick={resetAP} className="flex items-center gap-1 text-xs text-body hover:text-danger transition-colors">
                  <Trash2 size={11} /> Reset
                </button>
              )}
            </div>

            <ImageUpload
              label={tab === "actor" ? "Character Photo" : "Product Photo"}
              hint={tab === "actor" ? "JPG / PNG · Clear face, good lighting" : "JPG / PNG · White/clean background = best results"}
              value={apSourceFile}
              onChange={(f) => { setApSourceFile(f); setApGenImages([]); setApOriginalImg(null); setApGenMsg(""); }}
            />
          </div>

          {/* ── Step 2: Selectors → auto-prompt ── */}
          <div className="card p-5 space-y-4">
            <h2 className="font-semibold text-black dark:text-white text-sm flex items-center gap-2">
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold">2</span>
              {tab === "actor" ? "Character Description" : "Shot Style"}
            </h2>

            {/* ─── ACTOR SELECTORS ─── */}
            {tab === "actor" && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {/* Gender */}
                  <div>
                    <label className="form-label text-[10px]">Gender</label>
                    <select className="form-input text-xs py-1.5" value={actGender} onChange={(e) => setActGender(e.target.value)}>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="non_binary">Non-binary</option>
                    </select>
                  </div>
                  {/* Ethnicity */}
                  <div>
                    <label className="form-label text-[10px]">Ethnicity</label>
                    <select className="form-input text-xs py-1.5" value={actEthnicity} onChange={(e) => setActEthnicity(e.target.value)}>
                      {ETHNICITIES.map((e) => <option key={e.value} value={e.value}>{e.label}</option>)}
                    </select>
                  </div>
                  {/* Age */}
                  <div>
                    <label className="form-label text-[10px]">Age</label>
                    <select className="form-input text-xs py-1.5" value={actAge} onChange={(e) => setActAge(e.target.value)}>
                      {AGE_RANGES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                    </select>
                  </div>
                </div>

                {/* Hair & features */}
                <div>
                  <label className="form-label text-[10px]">Hair &amp; Features</label>
                  <div className="flex flex-wrap gap-1.5">
                    {FEATURES.map((f) => (
                      <button key={f.value}
                        onClick={() => setActFeatures((prev) => prev.includes(f.value) ? prev.filter((x) => x !== f.value) : [...prev, f.value])}
                        className={`rounded border px-2.5 py-1 text-[10px] font-medium transition-colors
                          ${actFeatures.includes(f.value)
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-stroke dark:border-strokedark text-body hover:border-primary/50"}`}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Outfit */}
                <div>
                  <label className="form-label text-[10px]">Outfit / Style</label>
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                    {ACTOR_OUTFITS.map((o) => (
                      <button key={o.value} onClick={() => setActOutfit(o.value)}
                        className={`rounded border py-1.5 text-[10px] font-medium text-center transition-colors
                          ${actOutfit === o.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-stroke dark:border-strokedark text-body hover:border-primary/50"}`}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Extra description — uncontrolled to prevent re-render on each keystroke */}
                <div>
                  <label className="form-label text-[10px]">Extra Description <span className="text-body font-normal">(optional)</span></label>
                  <input className="form-input text-xs py-1.5"
                    defaultValue={actExtraRef.current}
                    onChange={(e) => { actExtraRef.current = e.target.value; }}
                    onBlur={(e)   => setActExtraCommit(e.target.value)}
                    placeholder="e.g. holding product, smiling, outdoor background..." />
                </div>
              </div>
            )}

            {/* ─── PROP SELECTORS ─── */}
            {tab === "prop" && (
              <div className="space-y-3">
                {/* Product description — uncontrolled to prevent re-render on each keystroke */}
                <div>
                  <label className="form-label text-[10px]">Product Description <span className="text-body font-normal">(optional)</span></label>
                  <input className="form-input text-xs py-1.5"
                    defaultValue={propProductDescRef.current}
                    onChange={(e) => { propProductDescRef.current = e.target.value; }}
                    onBlur={(e)   => setPropProductDescCommit(e.target.value)}
                    placeholder="e.g. skincare serum bottle, sneaker, coffee cup..." />
                </div>

                {/* Lighting */}
                <div>
                  <label className="form-label text-[10px]">Lighting</label>
                  <div className="flex flex-wrap gap-1.5">
                    {PROP_LIGHTINGS.map((l) => (
                      <button key={l.value} onClick={() => setPropLighting(l.value)}
                        className={`rounded border px-2.5 py-1 text-[10px] font-medium transition-colors
                          ${propLighting === l.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-stroke dark:border-strokedark text-body hover:border-primary/50"}`}>
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Background */}
                <div>
                  <label className="form-label text-[10px]">Background</label>
                  <div className="flex flex-wrap gap-1.5">
                    {PROP_BACKGROUNDS.map((b) => (
                      <button key={b.value} onClick={() => setPropBackground(b.value)}
                        className={`rounded border px-2.5 py-1 text-[10px] font-medium transition-colors
                          ${propBackground === b.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-stroke dark:border-strokedark text-body hover:border-primary/50"}`}>
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Camera angle */}
                <div>
                  <label className="form-label text-[10px]">Camera Angle</label>
                  <div className="flex flex-wrap gap-1.5">
                    {PROP_ANGLES.map((a) => (
                      <button key={a.value} onClick={() => setPropAngle(a.value)}
                        className={`rounded border px-2.5 py-1 text-[10px] font-medium transition-colors
                          ${propAngle === a.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-stroke dark:border-strokedark text-body hover:border-primary/50"}`}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ─── Auto-generated prompt preview ─── */}
            <div className="rounded border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Sparkles size={11} className="text-primary" />
                <span className="text-[10px] font-semibold text-primary uppercase tracking-wide">Auto-Generated Prompt</span>
              </div>
              <p className="text-[11px] text-body font-mono leading-relaxed">{autoPrompt}</p>
            </div>

            {/* Number of images + strength */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label flex items-center justify-between text-[10px]">
                  <span>Synthetic Images</span>
                  <span className="font-mono text-primary">{apNumImages}</span>
                </label>
                <input type="range" min={3} max={15} step={1} value={apNumImages}
                  onChange={(e) => setApNumImages(Number(e.target.value))} className="w-full accent-primary" />
                <p className="text-[9px] text-body mt-0.5">1 original + {apNumImages} = {apNumImages + 1} total</p>
              </div>
              <div>
                <label className="form-label flex items-center justify-between text-[10px]">
                  <span>Image Influence</span>
                  <span className="font-mono text-primary">{apStrength.toFixed(2)}</span>
                </label>
                <input type="range" min={0.3} max={0.95} step={0.05} value={apStrength}
                  onChange={(e) => setApStrength(Number(e.target.value))} className="w-full accent-primary" />
                <p className="text-[9px] text-body mt-0.5">Low = more creative · High = closer to original</p>
              </div>
            </div>

            {/* Generate button */}
            <button onClick={handleGenerate} disabled={apGenerating || !apSourceFile}
              className="btn-primary w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed">
              {apGenerating
                ? <><Loader2 size={16} className="animate-spin" />Generating {apNumImages} images via Flux...</>
                : !apSourceFile
                ? <><Wand2 size={16} />Upload photo first (Step 1)</>
                : <><Wand2 size={16} />Generate {apNumImages} Synthetic Images via Flux</>}
            </button>

            {apGenMsg && (
              <p className={`text-xs flex items-center gap-1.5
                ${apGenMsg.startsWith("✓") ? "text-success" : apGenMsg.startsWith("Error") ? "text-danger" : "text-warning"}`}>
                {apGenMsg.startsWith("✓") ? <CheckCircle size={12} /> : apGenMsg.startsWith("Error") ? <AlertCircle size={12} /> : <Loader2 size={12} className="animate-spin" />}
                {apGenMsg}
              </p>
            )}
          </div>

          {/* ── Step 3: Preview & Train ── */}
          {(apOriginalImg || apGenImages.length > 0) && (
            <div className="card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-black dark:text-white text-sm flex items-center gap-2">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-success text-white text-[10px] font-bold">3</span>
                  Dataset Preview — {apTotalImages} images
                </h2>
              </div>

              {/* Image grid */}
              <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
                {/* Original */}
                {apOriginalImg && (
                  <div className="relative rounded overflow-hidden border-2 border-primary" style={{ aspectRatio: "1/1" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={apOriginalImg} alt="Original" className="w-full h-full object-cover" />
                    <div className="absolute top-0 left-0 right-0 bg-primary/80 py-0.5 text-center">
                      <span className="text-[7px] font-bold text-white">ORIGINAL</span>
                    </div>
                  </div>
                )}
                {/* Synthetic */}
                {apGenImages.map((img, idx) => (
                  <div key={idx} className="relative group rounded overflow-hidden border border-stroke dark:border-strokedark" style={{ aspectRatio: "1/1" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img} alt={`Synthetic ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
                    <button onClick={() => removeGenImage(idx)}
                      className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-danger/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <X size={8} className="text-white" />
                    </button>
                    <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-black/60 flex items-center justify-center">
                      <span className="text-[7px] font-bold text-white">{idx + 1}</span>
                    </div>
                  </div>
                ))}
                {/* Generate more placeholder */}
                {apGenImages.length > 0 && (
                  <button onClick={handleGenerate} disabled={apGenerating}
                    className="rounded border-2 border-dashed border-stroke dark:border-strokedark hover:border-primary/50 flex flex-col items-center justify-center gap-1 transition-colors disabled:opacity-40"
                    style={{ aspectRatio: "1/1" }}>
                    {apGenerating ? <Loader2 size={14} className="animate-spin text-body" /> : <Plus size={14} className="text-body" />}
                    <span className="text-[8px] text-body">More</span>
                  </button>
                )}
              </div>

              {/* Training config */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={14} className="text-primary" />
                  <span className="text-xs font-semibold text-primary uppercase tracking-wide">AI-Optimized Config ({tab === "actor" ? "Character" : "Product"} LoRA)</span>
                </div>
                <div className="grid grid-cols-4 gap-2 mb-3">
                  {[
                    { label: "Steps",   value: (tab === "actor" ? LORA_CONFIGS.actor : LORA_CONFIGS.prop).steps.toLocaleString() },
                    { label: "LR",      value: (tab === "actor" ? LORA_CONFIGS.actor : LORA_CONFIGS.prop).lr },
                    { label: "Rank",    value: String((tab === "actor" ? LORA_CONFIGS.actor : LORA_CONFIGS.prop).rank) },
                    { label: "Images",  value: String(apTotalImages) },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded bg-white/50 dark:bg-black/20 px-2 py-2 text-center">
                      <p className="text-[9px] text-body uppercase tracking-wide mb-0.5">{label}</p>
                      <p className="text-xs font-bold text-black dark:text-white">{value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-body">{(tab === "actor" ? LORA_CONFIGS.actor : LORA_CONFIGS.prop).reason}</p>
              </div>

              {/* Output path */}
              <div>
                <label className="form-label">Output LoRA Path</label>
                <input className="form-input" value={apOutputDir} onChange={(e) => setApOutputDir(e.target.value)}
                  placeholder={`output/lora/${tab}`} />
              </div>

              <div className="rounded border border-warning/20 bg-warning/5 p-3 flex items-start gap-2">
                <AlertCircle size={13} className="text-warning flex-shrink-0 mt-0.5" />
                <p className="text-xs text-body"><strong className="text-black dark:text-white">Requires:</strong> CUDA GPU 16GB+ · Python backend running locally · {(tab === "actor" ? LORA_CONFIGS.actor : LORA_CONFIGS.prop).estTime}</p>
              </div>

              {(() => {
                const curCfg = tab === "actor" ? LORA_CONFIGS.actor : LORA_CONFIGS.prop;
                return (
                  <button onClick={startTraining} disabled={running || apTotalImages < curCfg.minImages}
                    className="btn-primary w-full py-3 disabled:opacity-40 disabled:cursor-not-allowed">
                    {running
                      ? <><div className="loader" style={{ width: 16, height: 16, borderWidth: 2 }} />Training dimulai...</>
                      : apTotalImages < curCfg.minImages
                      ? <><AlertCircle size={16} />Need {curCfg.minImages - apTotalImages} more images (min {curCfg.minImages})</>
                      : <><Play size={16} />Start {tab === "actor" ? "Character" : "Product"} LoRA Training ({apTotalImages} images)</>}
                  </button>
                );
              })()}

              {/* ── Single training polling panel ── */}
              {running && singleJobId && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Loader2 size={15} className="animate-spin text-primary" />
                    <span className="text-sm font-semibold text-black dark:text-white">Training berjalan di Modal A100-80GB</span>
                  </div>
                  <div className="space-y-1.5 text-xs text-body">
                    <div className="flex justify-between">
                      <span>Job ID:</span>
                      <code className="font-mono text-primary text-[10px]">{singleJobId}</code>
                    </div>
                    <div className="flex justify-between">
                      <span>Elapsed:</span>
                      <span className="font-mono">{Math.floor(singlePollElapsed / 60)}m {singlePollElapsed % 60}s</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Status:</span>
                      <span className="text-warning font-medium">⏳ Polling setiap 12 detik...</span>
                    </div>
                  </div>
                  <div className="w-full bg-gray dark:bg-meta-4 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-1000"
                      style={{ width: `${Math.min(100, (singlePollElapsed / (tab === "actor" ? 1200 : 720)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-body/60">
                    ℹ Training ~15-25 menit. Anda bisa tutup halaman — training tetap berjalan di Modal.
                  </p>
                </div>
              )}

              {result && (
                <div className={`rounded border px-4 py-3 text-sm space-y-2
                  ${result.ok ? "border-success/30 bg-success/5 text-success" : "border-danger/30 bg-danger/5 text-danger"}`}>
                  <div className="flex items-center gap-2">
                    {result.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    <span>{result.msg}</span>
                  </div>
                  {result.ok && result.cloudinaryUrl && (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-[11px] font-semibold text-success/80 uppercase tracking-wide">LoRA URL (Cloudinary):</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-[10px] bg-black/10 rounded px-2 py-1 truncate font-mono text-success">
                          {result.cloudinaryUrl}
                        </code>
                        <button
                          onClick={() => navigator.clipboard.writeText(result.cloudinaryUrl!)}
                          className="flex-shrink-0 rounded border border-success/40 px-2 py-1 text-[10px] font-semibold hover:bg-success/10 transition-colors">
                          Copy
                        </button>
                      </div>
                      <p className="text-[10px] text-success/70">
                        Paste URL ini di TikTok Ads → Actor / Prop Mode → &quot;LoRA Trained&quot;
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ══════════ TAB: FROM LORA PACK ══════════ */}
      {tab === "lorapack" && (
        <div className="space-y-5">

          {/* Upload area (always shown) */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-black dark:text-white text-sm flex items-center gap-2">
                <Archive size={15} className="text-primary" /> Load Training Dataset
              </h2>
              {loraPackData && (
                <button onClick={() => { setLoraPackData(null); setResult(null); sessionStorage.removeItem("loraTrainingData"); }}
                  className="flex items-center gap-1 text-xs text-body hover:text-danger transition-colors">
                  <RefreshCcw size={11} /> Reset
                </button>
              )}
            </div>

            {/* Drop zone with 2 options */}
            <div onDragOver={(e) => { e.preventDefault(); setIsDraggingLP(true); }}
              onDragLeave={() => setIsDraggingLP(false)} onDrop={handleLPDrop}
              className={`rounded-lg border-2 border-dashed transition-colors
                ${isDraggingLP ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark"}`}>
              <div className="grid grid-cols-2 divide-x divide-stroke dark:divide-strokedark">
                <button onClick={() => zipInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 py-6 px-4 hover:bg-gray/30 dark:hover:bg-meta-4/30 transition-colors rounded-l-lg">
                  <input ref={zipInputRef} type="file" accept=".zip" className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleZipFile(e.target.files[0])} />
                  <Archive size={24} className="text-primary opacity-70" />
                  <div className="text-center">
                    <p className="text-sm font-semibold text-black dark:text-white">Upload ZIP</p>
                    <p className="text-xs text-body mt-0.5">Dataset ZIP dari halaman /video</p>
                    <p className="text-[10px] text-body/70 mt-1">lora_dataset_*.zip</p>
                  </div>
                </button>
                <button onClick={() => imgInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 py-6 px-4 hover:bg-gray/30 dark:hover:bg-meta-4/30 transition-colors rounded-r-lg">
                  <input ref={imgInputRef} type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => e.target.files && handleLPImages(e.target.files)} />
                  <ImageIcon size={24} className="text-success opacity-70" />
                  <div className="text-center">
                    <p className="text-sm font-semibold text-black dark:text-white">Upload Images</p>
                    <p className="text-xs text-body mt-0.5">Pilih 6-60 gambar individual</p>
                    <p className="text-[10px] text-body/70 mt-1">PNG · JPG · WEBP</p>
                  </div>
                </button>
              </div>
              {isDraggingLP && (
                <div className="text-center py-3 border-t border-stroke dark:border-strokedark">
                  <p className="text-sm font-medium text-primary">Drop ZIP or images here</p>
                </div>
              )}
            </div>

            {lpLoading && (
              <div className="flex items-center gap-2 text-sm text-body">
                <Loader2 size={14} className="animate-spin" /> Reading files...
              </div>
            )}
            {lpError && (
              <div className="flex items-start gap-2 rounded border border-danger/30 bg-danger/5 px-3 py-2.5 text-xs text-danger">
                <AlertCircle size={13} className="flex-shrink-0 mt-0.5" /> {lpError}
              </div>
            )}

            {!loraPackData && !lpLoading && (
              <div className="rounded border border-primary/20 bg-primary/5 p-4">
                <p className="text-xs font-semibold text-primary mb-2">Cara menggunakan:</p>
                <ol className="text-xs text-body space-y-1.5 list-decimal list-inside">
                  <li>Di <a href="/video" className="text-primary underline">Image to Video</a>, generate 360° LoRA Pack atau Consistent Augment</li>
                  <li>Klik <strong className="text-success">Train LoRA →</strong> — frames langsung masuk ke sini</li>
                  <li><strong>Atau</strong> download ZIP lalu upload di kotak kiri atas</li>
                  <li><strong>Atau</strong> upload gambar individual (6-60 gambar) di kotak kanan atas</li>
                </ol>
              </div>
            )}
          </div>

          {/* Data loaded */}
          {loraPackData && tab === "lorapack" && (
            <>
              <div className="rounded border border-success/30 bg-success/5 px-5 py-3 flex items-center gap-3">
                <CheckCircle size={18} className="text-success flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-black dark:text-white">
                    {loraPackData.frameCount} images loaded ·{" "}
                    {loraPackData.source === "lora360" ? "360° LoRA Pack"
                      : loraPackData.source === "augment" ? "Consistent Augment"
                      : loraPackData.source === "zip"     ? "ZIP upload"
                      : "Image upload"}
                  </p>
                  <p className="text-xs text-body">Product: <strong>{loraPackData.productName}</strong></p>
                </div>
                <button onClick={() => imgInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded border border-stroke dark:border-strokedark px-3 py-1.5 text-xs font-medium text-body hover:border-primary hover:text-primary transition-colors flex-shrink-0">
                  <Plus size={11} /> Add
                </button>
              </div>

              {/* Frame grid */}
              <div className="card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-black dark:text-white uppercase tracking-wide">
                    <ImageIcon size={12} className="inline mr-1" /> Images ({loraPackData.frameCount})
                  </p>
                  <p className="text-[10px] text-body">Hover → ✕ untuk hapus</p>
                </div>
                <div className="grid grid-cols-6 gap-1.5 max-h-64 overflow-y-auto">
                  {loraPackData.frames.map((frame, idx) => (
                    <div key={idx} className="relative group rounded overflow-hidden border border-stroke dark:border-strokedark"
                      style={{ aspectRatio: "1/1" }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={frame} alt={`Frame ${idx + 1}`} className="w-full h-full object-cover" loading="lazy" />
                      <button onClick={() => removeLPFrame(idx)}
                        className="absolute top-0.5 right-0.5 h-4 w-4 rounded-full bg-danger/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <X size={8} className="text-white" />
                      </button>
                      <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-black/60 flex items-center justify-center">
                        <span className="text-[7px] font-bold text-white">{idx + 1}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Training config */}
              <div className="card p-6 space-y-4">
                {(() => {
                  // Use actor config if ZIP came from Character Builder (has ohwx face captions)
                  const isActor = loraPackData.source === "actor_gen";
                  const lpCfg = isActor ? LORA_CONFIGS.actor : LORA_CONFIGS.prop;
                  const lpLabel = isActor ? "Character LoRA" : "Product LoRA";
                  return (
                    <>
                      <h2 className="font-semibold text-black dark:text-white text-sm">Training Configuration</h2>
                      <div>
                        <label className="form-label">Output LoRA Path</label>
                        <input className="form-input" value={loraOutputDir} onChange={(e) => setLoraOutputDir(e.target.value)}
                          placeholder={`output/lora/${loraPackData.productName}`} />
                      </div>
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Sparkles size={14} className="text-primary" />
                          <span className="text-xs font-semibold text-primary uppercase tracking-wide">AI-Optimized ({lpLabel})</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 mb-3">
                          {[
                            { label: "Steps",  value: lpCfg.steps.toLocaleString() },
                            { label: "LR",     value: lpCfg.lr },
                            { label: "Rank",   value: String(lpCfg.rank) },
                            { label: "Images", value: String(loraPackData.frameCount) },
                          ].map(({ label, value }) => (
                            <div key={label} className="rounded bg-white/50 dark:bg-black/20 px-2 py-2 text-center">
                              <p className="text-[9px] text-body uppercase tracking-wide mb-0.5">{label}</p>
                              <p className="text-xs font-bold text-black dark:text-white">{value}</p>
                            </div>
                          ))}
                        </div>
                        <p className="text-[11px] text-body">{lpCfg.reason}</p>
                      </div>

                      <div className="rounded border border-stroke dark:border-strokedark p-3 space-y-1">
                        {[
                          { label: "Total images", value: `${loraPackData.frameCount} PNG` },
                          { label: "Source",       value: loraPackData.source === "lora360" ? "360° LoRA Pack" : loraPackData.source === "augment" ? "Consistent Augment" : loraPackData.source === "actor_gen" ? "Character Builder ZIP" : loraPackData.source === "zip" ? "ZIP upload" : "Image upload" },
                          { label: "Est. time",    value: lpCfg.estTime },
                          { label: "GPU",          value: "Modal A100-80GB (cloud)" },
                        ].map(({ label, value }) => (
                          <div key={label} className="flex items-center justify-between text-xs">
                            <span className="text-body">{label}</span>
                            <span className="font-medium text-black dark:text-white">{value}</span>
                          </div>
                        ))}
                      </div>

                      <div className="rounded border border-primary/20 bg-primary/5 p-3 flex items-start gap-2">
                        <Sparkles size={13} className="text-primary flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-body"><strong className="text-black dark:text-white">Cloud GPU:</strong> Training runs on Modal A100-80GB — no local GPU needed.</p>
                      </div>

                      <button onClick={startTraining} disabled={running}
                        className="btn-primary w-full py-3">
                        {running
                          ? <><div className="loader" style={{ width: 16, height: 16, borderWidth: 2 }} />Training dimulai...</>
                          : <><Zap size={16} />Start LoRA Training ({loraPackData.frameCount} images, {lpLabel})</>}
                      </button>

                      {/* ── Single training polling panel (LoRA Pack tab) ── */}
                      {running && singleJobId && (
                        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <Loader2 size={15} className="animate-spin text-primary" />
                            <span className="text-sm font-semibold text-black dark:text-white">Training berjalan di Modal A100-80GB</span>
                          </div>
                          <div className="space-y-1.5 text-xs text-body">
                            <div className="flex justify-between">
                              <span>Job ID:</span>
                              <code className="font-mono text-primary text-[10px]">{singleJobId}</code>
                            </div>
                            <div className="flex justify-between">
                              <span>Elapsed:</span>
                              <span className="font-mono">{Math.floor(singlePollElapsed / 60)}m {singlePollElapsed % 60}s</span>
                            </div>
                          </div>
                          <div className="w-full bg-gray dark:bg-meta-4 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-1000"
                              style={{ width: `${Math.min(100, (singlePollElapsed / (isActor ? 1200 : 720)) * 100)}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-body/60">
                            ℹ Training ~15-25 menit. Anda bisa tutup halaman — training tetap berjalan di Modal.
                          </p>
                        </div>
                      )}

                      {result && (
                        <div className={`rounded border px-4 py-3 text-sm space-y-2
                          ${result.ok ? "border-success/30 bg-success/5 text-success" : "border-danger/30 bg-danger/5 text-danger"}`}>
                          <div className="flex items-center gap-2">
                            {result.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                            <span>{result.msg}</span>
                          </div>
                          {result.ok && result.cloudinaryUrl && (
                            <div className="mt-2 space-y-1.5">
                              <p className="text-[11px] font-semibold text-success/80 uppercase tracking-wide">LoRA URL (Cloudinary):</p>
                              <div className="flex items-center gap-2">
                                <code className="flex-1 text-[10px] bg-black/10 rounded px-2 py-1 truncate font-mono text-success">
                                  {result.cloudinaryUrl}
                                </code>
                                <button
                                  onClick={() => navigator.clipboard.writeText(result.cloudinaryUrl!)}
                                  className="flex-shrink-0 rounded border border-success/40 px-2 py-1 text-[10px] font-semibold hover:bg-success/10 transition-colors">
                                  Copy
                                </button>
                              </div>
                              <p className="text-[10px] text-success/70">
                                Paste URL ini di TikTok Ads → Actor / Prop Mode → &quot;LoRA Trained&quot;
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      )}

      {/* ══════════ TAB: TRAIN ALL 4 CHARACTERS ══════════ */}
      {tab === "all4" && (
        <div className="space-y-5">

          {/* Cost & GPU breakdown */}
          <div className="card p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-black dark:text-white text-sm flex items-center gap-2">
                <Zap size={15} className="text-warning" /> Parallel Training — 4 Characters Simultaneously
              </h2>
              <p className="text-xs text-body mt-1">
                Semua 4 karakter ditraining secara paralel → total waktu ≈ waktu 1 karakter saja
              </p>
            </div>

            {/* GPU assignment + cost per GPU */}
            <div className="grid grid-cols-2 gap-3">
              {CHAR_NAMES.map((name, i) => {
                const gpu   = CHAR_GPU[i];
                const cost  = GPU_COST_SEC[gpu] * TRAIN_EST_SEC;
                const slot  = all4Slots[i];
                return (
                  <div key={name} className={`rounded-lg border p-3 space-y-2
                    ${slot ? "border-success/40 bg-success/5" : "border-stroke dark:border-strokedark"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{i < 2 ? "👨" : "👩"}</span>
                        <span className="font-semibold text-sm text-black dark:text-white">{name}</span>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full
                        ${gpu === "H200" ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                          : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"}`}>
                        {gpu}
                      </span>
                    </div>

                    {/* Cost breakdown */}
                    <div className="text-[10px] text-body space-y-0.5">
                      <div className="flex justify-between">
                        <span>Rate:</span>
                        <span className="font-mono">${GPU_COST_SEC[gpu].toFixed(6)}/sec</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Est. time:</span>
                        <span className="font-mono">~{Math.round(TRAIN_EST_SEC / 60)} min</span>
                      </div>
                      <div className="flex justify-between font-semibold text-black dark:text-white">
                        <span>Cost:</span>
                        <span className="font-mono text-warning">~${cost.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* ZIP slot */}
                    <div>
                      {slot ? (
                        <div className="flex items-center justify-between bg-success/10 rounded px-2 py-1">
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold text-success truncate">{slot.frameCount} images loaded ✓</p>
                            <p className="text-[9px] text-success/70 truncate">{slot.productName} · {slot.source}</p>
                          </div>
                          <button onClick={() => setAll4Slots((p) => { const n=[...p]; n[i]=null; return n; })}
                            className="text-body hover:text-danger ml-1 flex-shrink-0">
                            <X size={10} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => all4ZipRefs[i].current?.click()}
                          className="w-full rounded border border-dashed border-stroke dark:border-strokedark py-1.5 text-[10px] text-body hover:border-primary hover:text-primary transition-colors">
                          + Upload ZIP ({name})
                        </button>
                      )}
                      <input
                        ref={all4ZipRefs[i]}
                        type="file" accept=".zip" className="hidden"
                        onChange={(e) => { if (e.target.files?.[0]) loadAll4Slot(i, e.target.files[0]); }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total cost summary */}
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                {[
                  { label: "Wall-clock",  value: `~${Math.round(TRAIN_EST_SEC / 60)} min` },
                  { label: "Sequential",  value: `~${Math.round(TRAIN_EST_SEC * 4 / 60)} min` },
                  { label: "Speedup",     value: "~4×" },
                  { label: "Total cost",  value: `~$${(CHAR_NAMES.map((_,i) => GPU_COST_SEC[CHAR_GPU[i]] * TRAIN_EST_SEC).reduce((a,b)=>a+b,0)).toFixed(2)}` },
                ].map(({ label, value }) => (
                  <div key={label} className="text-center">
                    <p className="text-[9px] text-body uppercase tracking-wide mb-0.5">{label}</p>
                    <p className="text-sm font-bold text-black dark:text-white">{value}</p>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-body space-y-0.5 border-t border-warning/20 pt-2 mt-2">
                <p><strong className="text-black dark:text-white">GPU Price Reference (Modal 2026):</strong></p>
                <p>H100 80GB: $0.001097/sec ≈ $3.95/hr &nbsp;|&nbsp; H200 SXM: $0.001261/sec ≈ $4.54/hr &nbsp;|&nbsp; A100-80GB: $0.000694/sec ≈ $2.50/hr</p>
              </div>
            </div>
          </div>

          {/* Training config display */}
          <div className="card p-5 space-y-3">
            <h2 className="font-semibold text-black dark:text-white text-sm flex items-center gap-2">
              <Sparkles size={14} className="text-primary" /> Training Config (Actor LoRA — same for all 4)
            </h2>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Steps",  value: LORA_CONFIGS.actor.steps.toLocaleString() },
                { label: "LR",     value: LORA_CONFIGS.actor.lr },
                { label: "Rank",   value: String(LORA_CONFIGS.actor.rank) },
              ].map(({ label, value }) => (
                <div key={label} className="rounded bg-gray dark:bg-meta-4 px-3 py-2 text-center">
                  <p className="text-[9px] text-body uppercase tracking-wide mb-0.5">{label}</p>
                  <p className="text-sm font-bold text-black dark:text-white">{value}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-body">{LORA_CONFIGS.actor.reason}</p>
          </div>

          {/* Start button */}
          <button
            onClick={startAll4Training}
            disabled={all4Running || all4Slots.every((s) => !s)}
            className="btn-primary w-full py-3.5 text-base disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {all4Running
              ? <><div className="loader" style={{ width: 18, height: 18, borderWidth: 2 }} /> Training {all4Slots.filter(Boolean).length} karakter... ({Math.floor(all4PollElapsed / 60)}m {all4PollElapsed % 60}s)</>
              : <><Zap size={18} /> Start Parallel Training ({all4Slots.filter(Boolean).length} karakter loaded)</>}
          </button>

          {/* Polling status panel */}
          {all4Running && all4JobId && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 size={15} className="animate-spin text-primary" />
                <span className="text-sm font-semibold text-black dark:text-white">Training sedang berjalan di Modal GPU</span>
              </div>
              <div className="space-y-1.5 text-xs text-body">
                <div className="flex justify-between">
                  <span>Job ID:</span>
                  <code className="font-mono text-primary text-[10px]">{all4JobId}</code>
                </div>
                <div className="flex justify-between">
                  <span>Elapsed:</span>
                  <span className="font-mono">{Math.floor(all4PollElapsed / 60)}m {all4PollElapsed % 60}s</span>
                </div>
                <div className="flex justify-between">
                  <span>Est. remaining:</span>
                  <span className="font-mono">~{Math.max(0, Math.ceil((TRAIN_EST_SEC - all4PollElapsed) / 60))} min</span>
                </div>
                <div className="flex justify-between">
                  <span>Status:</span>
                  <span className="text-warning font-medium">⏳ Polling setiap 12 detik...</span>
                </div>
              </div>
              {/* Progress bar */}
              <div className="w-full bg-gray dark:bg-meta-4 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min(100, (all4PollElapsed / TRAIN_EST_SEC) * 100)}%` }}
                />
              </div>
              {/* Partial results */}
              {all4Results && all4Results.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-body uppercase tracking-wide">Completed so far:</p>
                  {all4Results.map((r) => (
                    <div key={r.name} className={`flex items-center gap-2 text-xs rounded px-2 py-1
                      ${r.ok ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                      {r.ok ? <CheckCircle size={11} /> : <AlertCircle size={11} />}
                      <span className="font-medium">{r.name}</span>
                      <span className="text-[10px] opacity-70">({r.gpu} · {r.time ? `${Math.round(r.time)}s` : "–"})</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-body/60">
                ℹ Training ~20 menit. Anda bisa tutup halaman ini — training tetap berjalan di Modal.
                Kembali ke sini dengan Job ID yang sama untuk cek status.
              </p>
            </div>
          )}

          {/* Error / non-running status message */}
          {all4Msg && !all4Running && !all4Results && (
            <div className={`flex items-start gap-2 rounded border px-4 py-3 text-sm
              ${all4Msg.startsWith("❌") ? "border-danger/30 bg-danger/5 text-danger" : "border-warning/30 bg-warning/5 text-body"}`}>
              {all4Msg.startsWith("❌") ? <AlertCircle size={15} className="flex-shrink-0 mt-0.5 text-danger" /> : <AlertCircle size={15} className="flex-shrink-0 mt-0.5 text-warning" />}
              <p>{all4Msg}</p>
            </div>
          )}

          {/* Results */}
          {all4Results && !all4Running && (
            <div className="card p-5 space-y-4">
              <h2 className="font-semibold text-black dark:text-white text-sm flex items-center gap-2">
                <CheckCircle size={15} className="text-success" /> Training Results
              </h2>
              <div className="space-y-2">
                {all4Results.map((r) => (
                  <div key={r.name}
                    className={`flex items-center justify-between rounded border px-4 py-3
                      ${r.ok ? "border-success/30 bg-success/5" : "border-danger/30 bg-danger/5"}`}>
                    <div className="flex items-center gap-3">
                      {r.ok ? <CheckCircle size={14} className="text-success" /> : <AlertCircle size={14} className="text-danger" />}
                      <div>
                        <p className="text-sm font-semibold text-black dark:text-white">{r.name}</p>
                        <p className="text-[10px] text-body">
                          {r.gpu} · {r.steps?.toLocaleString()} steps · {r.time ? `${Math.round(r.time)}s` : "–"} · cost ~${r.cost_usd?.toFixed(2)}
                        </p>
                        {r.lora_name && <p className="text-[10px] text-success font-mono truncate">{r.lora_name}</p>}
                        {r.cloudinary_url && (
                          <a href={r.cloudinary_url} target="_blank" rel="noreferrer"
                            className="text-[10px] text-primary underline truncate block max-w-[240px]">
                            ↗ Download LoRA (.safetensors)
                          </a>
                        )}
                        {r.error && <p className="text-[10px] text-danger">{r.error}</p>}
                      </div>
                    </div>
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full
                      ${r.gpu === "H200" ? "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                        : "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300"}`}>
                      {r.gpu}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
                <CheckCircle size={14} className="inline mr-2" />
                {all4Msg}
              </div>
              <a href="/characters"
                className="flex items-center justify-center gap-2 rounded border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary hover:bg-primary/20 transition-colors">
                <Sparkles size={14} /> Lihat di Characters Page
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TrainingPage() {
  return (
    <Suspense fallback={<div className="p-8 text-body text-sm">Loading...</div>}>
      <TrainingInner />
    </Suspense>
  );
}
