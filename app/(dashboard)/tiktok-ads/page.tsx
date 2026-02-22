"use client";
import { useState, useEffect, useRef } from "react";
import {
  Film, User, Package, Users, Cpu, Shuffle, Play, ChevronDown, ChevronRight,
  Info, CheckCircle, AlertCircle, Download, X, ZoomIn, Wand2, Sparkles,
} from "lucide-react";
import type { GenerationMode, ActorMode, PropMode, ScreenRatio, ContinuityArc, GpuType } from "@/types";
import {
  SCREEN_RATIOS, ETHNICITIES, AGE_RANGES, FEATURES,
  CAMERA_SHOTS, CONTINUITY_ARCS, GPU_CATALOG, TIKTOK_AD_THEMES,
} from "@/lib/constants";
import { saveImagesToGallery } from "@/app/(dashboard)/gallery/page";
import type { GalleryImage } from "@/app/(dashboard)/gallery/page";
import ThemeSelector from "@/components/TikTokAds/ThemeSelector";
import ColorPicker from "@/components/TikTokAds/ColorPicker";
import ImageUpload from "@/components/TikTokAds/ImageUpload";
import LoraUpload from "@/components/TikTokAds/LoraUpload";

type Section = "mode" | "actor" | "prop" | "themes" | "settings" | "continuity" | "serverless";

// ── Text to Image preset prompts ──────────────────────────────────────────────
const TXT2IMG_PRESETS = [
  { label: "✨ Product Studio",    prompt: "a luxury perfume bottle on a marble pedestal, soft studio lighting, white background, ultra detailed, product photography" },
  { label: "🌆 Cinematic City",    prompt: "cinematic street scene in Tokyo at night, neon signs, rain reflections, bokeh, 35mm film photography" },
  { label: "🌿 Nature Portrait",   prompt: "close-up portrait of a young woman in a forest, golden hour sunlight, soft bokeh, photorealistic" },
  { label: "🔮 Sci-Fi Concept",    prompt: "futuristic cyberpunk city skyline at dusk, flying vehicles, neon holographic billboards, hyperdetailed, 8K" },
  { label: "🌸 Fashion Editorial", prompt: "high fashion editorial photo, model in flowing red dress on white beach, golden hour, Vogue style" },
];

export default function TikTokAdsPage() {
  // Page-level tab: img-gen vs text-to-image
  const [pageTab, setPageTab] = useState<"img-gen" | "txt2img">("img-gen");

  // Text to Image state
  const [t2iPrompt,    setT2iPrompt]    = useState("");
  const [t2iNumImages, setT2iNumImages] = useState(4);
  const [t2iModel,     setT2iModel]     = useState<"schnell" | "dev">("schnell");
  const [t2iStatus,    setT2iStatus]    = useState<"idle" | "loading" | "done" | "error">("idle");
  const [t2iMsg,       setT2iMsg]       = useState("");
  const [t2iImages,    setT2iImages]    = useState<string[]>([]);
  const [t2iTime,      setT2iTime]      = useState<number | null>(null);

  const handleT2iGenerate = async () => {
    if (!t2iPrompt.trim()) return;
    setT2iStatus("loading");
    setT2iMsg("Connecting to Modal GPU...");
    setT2iImages([]);
    setT2iTime(null);
    try {
      const ratioMap: Record<string, { width: number; height: number }> = {
        "9:16": { width: 768, height: 1344 },
        "1:1":  { width: 768, height: 768 },
        "16:9": { width: 1344, height: 768 },
      };
      const { width, height } = ratioMap[screen] ?? ratioMap["9:16"];
      setT2iMsg(`Generating ${t2iNumImages} images · ${t2iModel === "dev" ? "high quality" : "fast"} mode...`);
      const res = await fetch("/api/modal/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:       t2iPrompt.trim(),
          width, height,
          steps:        t2iModel === "dev" ? 20 : 4,
          seed:         Math.floor(Math.random() * 999999),
          numImages:    t2iNumImages,
          modelVariant: t2iModel,
        }),
      });
      const data = await res.json() as { ok?: boolean; images?: string[]; time?: number; error?: string };
      if (!res.ok || !data.images) throw new Error(data.error ?? `Error ${res.status}`);
      setT2iImages(data.images);
      setT2iTime(data.time ?? null);
      setT2iStatus("done");
      setT2iMsg(`✓ ${data.images.length} images in ${data.time?.toFixed(1)}s`);
    } catch (err) {
      setT2iStatus("error");
      setT2iMsg(`❌ ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Mode
  const [mode, setMode] = useState<GenerationMode>("actor+prop");

  // Actor
  const [actorMode, setActorMode] = useState<ActorMode>("source");
  const [actorFile, setActorFile] = useState<File | null>(null);
  const [gender, setGender] = useState("female");
  const [ethnicity, setEthnicity] = useState("any");
  const [age, setAge] = useState("20s");
  const [features, setFeatures] = useState<string[]>([]);
  const [subject, setSubject] = useState("");

  // Prop
  const [propMode, setPropMode] = useState<PropMode>("upload");
  const [propFile, setPropFile] = useState<File | null>(null);
  const [propDesc, setPropDesc] = useState("");

  // LoRA — URLs are Cloudinary secure_url of uploaded .safetensors
  const [actorLoraUrl,   setActorLoraUrl]   = useState<string | null>(null);
  const [actorLoraScale, setActorLoraScale] = useState(0.85);   // 0.0–1.0
  const [propLoraUrl,    setPropLoraUrl]    = useState<string | null>(null);
  const [propLoraScale,  setPropLoraScale]  = useState(0.90);   // 0.0–1.0

  // Camera shot
  const [cameraShot, setCameraShot] = useState("none");

  // Generation
  const [selectedTheme, setSelectedTheme] = useState<number>(1); // single theme
  const [screen, setScreen] = useState<ScreenRatio>("9:16");
  const [numImages, setNumImages] = useState(1);
  const [color, setColor] = useState("none");
  // strength is hardcoded per mode in modal_app.py — not exposed to user
  const strength = 0.55; // kept for payload compat but overridden server-side
  // seed is always randomized per generate — not exposed to user
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 999999));
  const [useFlux, setUseFlux] = useState(true);
  const [fluxVariant, setFluxVariant] = useState<"dev" | "schnell">("dev");

  // Continuity
  const [continuity, setContinuity] = useState(false);
  const [continuityArc, setContinuityArc] = useState<ContinuityArc>("journey");
  const [sequenceMode, setSequenceMode] = useState(false); // multi-frame story per theme

  // Serverless (Modal.com) — credentials stored in Modal Secrets, not in UI
  const [serverless, setServerless] = useState(true);
  const [gpu, setGpu] = useState<GpuType>(() =>
    (typeof window !== "undefined" ? (localStorage.getItem("modal_gpu") as GpuType) : null) ?? "t4"
  );

  // UI state
  const [open, setOpen] = useState<Record<Section, boolean>>({
    mode: true, actor: true, prop: true, themes: false,
    settings: true, continuity: false, serverless: true,
  });
  const [jobStatus, setJobStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [jobMsg, setJobMsg] = useState("");
  const [progress, setProgress] = useState(0);
  const [resultImages, setResultImages] = useState<{ themeId: number; themeName: string; images: string[]; time: number; sequence: boolean }[]>([]);
  const [resultTotalTime, setResultTotalTime] = useState<number | null>(null);
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  // Auto-scroll to results when they arrive
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (resultImages.length > 0 && resultsRef.current) {
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  }, [resultImages]);

  // ── LoRA handoff from Characters page ─────────────────────────────
  // Characters page writes to localStorage → we read + clear on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("geovera_lora_handoff");
      if (!raw) return;
      localStorage.removeItem("geovera_lora_handoff"); // consume once
      const handoff = JSON.parse(raw) as {
        type: "actor" | "prop"; loraUrl: string; loraName: string; charName: string;
      };
      if (handoff.type === "actor") {
        setMode("actor+prop");
        setActorMode("trained");
        setActorLoraUrl(handoff.loraUrl);
      } else {
        setMode("prop");
        setPropMode("trained");
        setPropLoraUrl(handoff.loraUrl);
      }
    } catch { /* ignore parse errors */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Animated progress bar — ramps from 0→85% during generation, jumps to 100% on done
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (jobStatus === "running") {
      setProgress(0);
      // Accelerate fast at first (cold start phase), then slow near 85%
      progressTimer.current = setInterval(() => {
        setProgress((p) => {
          if (p < 30) return p + 3;      // fast: 0→30% (cold start)
          if (p < 60) return p + 1.5;    // medium: 30→60%
          if (p < 80) return p + 0.5;    // slow: 60→80%
          if (p < 85) return p + 0.1;    // crawl: 80→85%
          return p;                       // hold at 85% until done
        });
      }, 400);
    } else {
      if (progressTimer.current) clearInterval(progressTimer.current);
      if (jobStatus === "done") setProgress(100);
    }
    return () => { if (progressTimer.current) clearInterval(progressTimer.current); };
  }, [jobStatus]);

  const toggleSection = (s: Section) => setOpen((p) => ({ ...p, [s]: !p[s] }));
  const toggleFeature = (f: string) =>
    setFeatures((p) => p.includes(f) ? p.filter((x) => x !== f) : [...p, f]);

  // Download all result images sequentially using temporary <a> tags
  const downloadAll = () => {
    const allImages = resultImages.flatMap((r) =>
      r.images.map((imgUrl, frameIdx) => ({
        url: imgUrl,
        filename: `theme_${r.themeId}_${r.themeName.replace(/\s+/g, "-")}_f${frameIdx + 1}.png`,
      }))
    );
    allImages.forEach(({ url, filename }, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, i * 120); // stagger 120ms each to avoid browser blocking
    });
  };

  const hasActor = mode === "actor" || mode === "actor+prop";
  const hasProp = mode === "prop" || mode === "actor+prop";
  const selectedThemeName = TIKTOK_AD_THEMES.find((t) => t.id === selectedTheme)?.name ?? `Theme ${selectedTheme}`;
  // numImages = images per selected theme
  const totalImages = numImages;

  const gpuInfo = GPU_CATALOG[gpu];
  const modelKey = useFlux ? (fluxVariant === "dev" ? "flux_dev_s" : "flux_schnell_s") : "sdxl_s";
  const secPerImg = gpu !== "any" && gpuInfo[modelKey as keyof typeof gpuInfo]
    ? (gpuInfo[modelKey as keyof typeof gpuInfo] as number)
    : null;
  const estSecs = secPerImg ? totalImages * secPerImg : null;
  const estCost = secPerImg && gpuInfo.price_hr
    ? ((totalImages * secPerImg / 3600) * gpuInfo.price_hr).toFixed(4)
    : null;

  const handleGenerate = async () => {
    // Always use a fresh random seed so every generate produces different results
    setSeed(Math.floor(Math.random() * 999999));
    setJobStatus("running");
    setProgress(0);
    setResultTotalTime(null);
    setJobMsg("Starting generation...");

    try {
      if (serverless) {
        // ── Modal.com serverless path ──────────────────────────────
        // Build subject description from actor + prop settings
        const actorBase = hasActor
          ? [
              gender,
              ethnicity !== "any" ? ethnicity : "",
              age,
              "person",
              features.length ? features.join(", ") : "",
              subject || "",
            ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
          : "";

        const colorNote = color && color !== "none" ? ", exact original product colors preserved" : "";

        // For "mix" camera mode, Modal varies shot per theme — don't embed in prompt
        const camEntry = CAMERA_SHOTS.find((s) => s.value === cameraShot);
        const camPrompt = camEntry && camEntry.prompt !== "__mix__" ? camEntry.prompt : "";

        // LoRA trigger token — "ohwx" must appear in prompt when using trained LoRA
        // It activates the LoRA's fine-tuned concept (actor face or prop appearance)
        const actorTrigger = (actorMode === "trained" && actorLoraUrl) ? "ohwx" : "";
        const propTrigger  = (propMode  === "trained" && propLoraUrl)  ? "ohwx" : "";

        let subjectDescription: string;
        if (mode === "prop") {
          // Prop only — product as hero, no actor
          const propToken = propTrigger ? `${propTrigger} ` : "";
          const propHero  = propDesc
            ? `${propToken}${propDesc} product${colorNote}, product hero shot, no person, no human`
            : `${propToken}product${colorNote}, product hero shot, no person, no human`;
          subjectDescription = [propHero, camPrompt].filter(Boolean).join(", ");
        } else if (mode === "actor") {
          // Actor only — no product
          const actorToken = actorTrigger ? `${actorTrigger} ` : "";
          subjectDescription = [`${actorToken}${actorBase || "person"}`, camPrompt].filter(Boolean).join(", ");
        } else {
          // Actor + Prop — prop image is used as img2img source, actor description in prompt
          // Keep prompt focused: describe actor + reinforce product presence
          const actorToken = actorTrigger ? `${actorTrigger} ` : "";
          const propToken  = propTrigger  ? `${propTrigger} ` : "";
          const actorPart  = `${actorToken}${actorBase || "woman"}`;
          const propPart   = propDesc ? `${propToken}${propDesc}${colorNote}` : `${propToken}product`;
          subjectDescription = [
            `${actorPart} holding ${propPart} in hand`,
            `${propPart} clearly visible and prominent`,
            `person using ${propPart}`,
            camPrompt,
          ].filter(Boolean).join(", ");
        }

        // Convert source images to base64
        // actor+prop mode sends BOTH actor_b64 and prop_b64 separately
        // actor-only sends actor_b64 (used as source)
        // prop-only sends prop_b64 (used as source)
        const propSrc  = hasProp  && propMode  === "upload" ? propFile  : null;
        const actorSrc = hasActor && actorMode === "source" ? actorFile : null;

        const fileToB64 = async (file: File, label: string): Promise<string> => {
          setJobMsg(`Memproses gambar ${label} (${(file.size / 1024).toFixed(0)} KB)...`);
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const b64 = (reader.result as string).split(",")[1];
              if (!b64) { reject(new Error("Base64 kosong — file mungkin rusak")); return; }
              resolve(b64);
            };
            reader.onerror = () => reject(new Error("Gagal baca file"));
            reader.readAsDataURL(file);
          });
        };

        let sourceB64: string | undefined;    // legacy single source (prop-only or actor-only)
        let actorB64:  string | undefined;    // actor face/body (for actor+prop)
        let propB64:   string | undefined;    // product image  (for actor+prop)

        try {
          if (mode === "actor+prop") {
            // Send both images separately so Modal can composite them
            if (propSrc)  propB64  = await fileToB64(propSrc,  "prop/product");
            if (actorSrc) actorB64 = await fileToB64(actorSrc, "actor");
            const parts = [propB64 && "prop", actorB64 && "actor"].filter(Boolean).join(" + ");
            setJobMsg(`✓ ${parts || "No"} image(s) siap`);
          } else if (propSrc) {
            propB64 = sourceB64 = await fileToB64(propSrc, "prop/product");
            setJobMsg(`✓ Gambar prop siap (${(sourceB64.length / 1024).toFixed(0)} KB base64)`);
          } else if (actorSrc) {
            actorB64 = sourceB64 = await fileToB64(actorSrc, "actor");
            setJobMsg(`✓ Gambar actor siap (${(sourceB64.length / 1024).toFixed(0)} KB base64)`);
          }
          if (propB64 || actorB64 || sourceB64) {
            await new Promise(r => setTimeout(r, 300)); // brief pause so user sees msg
          }
        } catch (uploadErr) {
          const errMsg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
          setJobStatus("error");
          setJobMsg(`❌ Gagal proses gambar: ${errMsg}`);
          return;
        }

        setJobMsg(`Generating ${numImages} image(s) · Theme #${selectedTheme} ${selectedThemeName}... cold start ~10s`);

        // ── Direct browser→Modal fetch (bypass Vercel 4.5MB body limit) ──
        // NEXT_PUBLIC_ vars are available client-side at build time
        const modalBatchUrl =
          process.env.NEXT_PUBLIC_MODAL_TIKTOK_BATCH_URL ||
          "https://andrewsus83-design--tiktok-batch-endpoint.modal.run";

        const batchPayload = {
          subject_description: subjectDescription,
          source_b64: sourceB64,   // legacy: prop-only or actor-only single source
          actor_b64:  actorB64,    // actor face/body (actor+prop mode)
          prop_b64:   propB64,     // product image  (actor+prop or prop-only)
          // LoRA weights — Cloudinary URLs; Modal downloads + applies at runtime
          actor_lora_url:   (actorMode === "trained" && actorLoraUrl)  ? actorLoraUrl   : undefined,
          actor_lora_scale: (actorMode === "trained" && actorLoraUrl)  ? actorLoraScale : undefined,
          prop_lora_url:    (propMode  === "trained" && propLoraUrl)   ? propLoraUrl    : undefined,
          prop_lora_scale:  (propMode  === "trained" && propLoraUrl)   ? propLoraScale  : undefined,
          theme_ids: [selectedTheme], // single theme
          screen_ratio: screen,
          color,
          num_images_per_theme: numImages, // N variations from this 1 theme
          strength,
          seed,
          continuity,
          continuity_arc: continuityArc,
          sequence_mode: sequenceMode,
          camera_shot: cameraShot,
          model_variant: useFlux ? fluxVariant : "schnell",
          num_steps: useFlux && fluxVariant === "dev" ? 20 : 4,
        };

        const res = await fetch(modalBatchUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batchPayload),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Modal returned ${res.status}: ${errText.slice(0, 200)}`);
        }

        const data = await res.json() as {
          results: { theme_id: number; theme: string; images: string[]; time: number; sequence?: boolean }[];
          total: number;
          time: number;
        };

        if (data.results && data.results.length > 0) {
          const modelLabel = `flux-${useFlux ? fluxVariant : "schnell"}`;
          const ts = Date.now();
          const screenW = SCREEN_RATIOS[screen]?.width ?? 768;
          const screenH = SCREEN_RATIOS[screen]?.height ?? 1344;

          // ── Step 1: Show results immediately (base64) while uploading ────
          const base64Results = data.results.map((r) => ({
            themeId: r.theme_id,
            themeName: TIKTOK_AD_THEMES.find((t) => t.id === r.theme_id)?.name ?? `Theme ${r.theme_id}`,
            images: r.images.map((img) => img.startsWith("data:") ? img : `data:image/png;base64,${img}`),
            time: r.time,
            sequence: r.sequence ?? false,
          }));
          setResultImages(base64Results);
          setResultTotalTime(data.time);
          setJobStatus("done");
          setProgress(100);
          setJobMsg(`✓ Done! ${data.total} image(s) in ${data.time.toFixed(1)}s · Uploading to Cloudinary...`);

          // ── Step 2: Upload to Cloudinary in background ───────────────────
          try {
            const allImages = data.results.flatMap((r) =>
              r.images.map((img, idx) => ({
                b64:       img.startsWith("data:") ? img : `data:image/png;base64,${img}`,
                filename:  `theme_${r.theme_id}_${ts}_${idx}.png`,
                public_id: `geovera-tiktok/theme_${r.theme_id}_${ts}_${idx}`,
              }))
            );

            const uploadRes = await fetch("/api/cloudinary/upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ images: allImages }),
            });

            let finalUrls: { url: string; filename: string; width?: number; height?: number }[] = allImages.map(
              (img) => ({ url: img.b64, filename: img.filename })
            );

            if (uploadRes.ok) {
              const uploadData = await uploadRes.json() as {
                urls: { url: string; filename: string; width?: number; height?: number }[];
              };
              finalUrls = uploadData.urls;
              setJobMsg(`✓ Done! ${data.total} image(s) in ${data.time.toFixed(1)}s · Saved to Cloudinary ☁️`);

              // Update result preview with Cloudinary URLs (for correct img display)
              let urlIdx = 0;
              setResultImages(data.results.map((r) => ({
                themeId: r.theme_id,
                themeName: TIKTOK_AD_THEMES.find((t) => t.id === r.theme_id)?.name ?? `Theme ${r.theme_id}`,
                images: r.images.map(() => finalUrls[urlIdx++]?.url ?? ""),
                time: r.time,
                sequence: r.sequence ?? false,
              })));
            } else {
              // Cloudinary failed — keep base64 in IndexedDB
              console.warn("[Cloudinary] Upload failed, falling back to base64 in IndexedDB");
              setJobMsg(`✓ Done! ${data.total} image(s) in ${data.time.toFixed(1)}s · Saved locally (Cloudinary offline)`);
            }

            // ── Step 3: Save to IndexedDB gallery with final URLs ────────
            let galleryUrlIdx = 0;
            const galleryImages: GalleryImage[] = data.results.flatMap((r) =>
              r.images.map((_raw, idx) => {
                const finalUrl = finalUrls[galleryUrlIdx++]?.url ??
                  (r.images[idx].startsWith("data:") ? r.images[idx] : `data:image/png;base64,${r.images[idx]}`);
                const theme = TIKTOK_AD_THEMES.find((t) => t.id === r.theme_id);
                return {
                  id:             `${ts}_${r.theme_id}_${idx}`,
                  themeId:        r.theme_id,
                  themeName:      theme?.name ?? `Theme ${r.theme_id}`,
                  filename:       `theme_${r.theme_id}_${ts}_${idx}.webp`,
                  url:            finalUrl,
                  width:          finalUrls[galleryUrlIdx - 1]?.width ?? screenW,
                  height:         finalUrls[galleryUrlIdx - 1]?.height ?? screenH,
                  createdAt:      new Date().toISOString(),
                  model:          modelLabel,
                  generationTime: r.time,
                };
              })
            );
            await saveImagesToGallery(galleryImages);
          } catch (uploadErr) {
            // Cloudinary error — save base64 to IndexedDB as fallback
            console.warn("[Cloudinary] Upload error:", uploadErr);
            const fallbackImages: GalleryImage[] = data.results.flatMap((r) =>
              r.images.map((img, idx) => ({
                id:             `${ts}_${r.theme_id}_${idx}`,
                themeId:        r.theme_id,
                themeName:      TIKTOK_AD_THEMES.find((t) => t.id === r.theme_id)?.name ?? `Theme ${r.theme_id}`,
                filename:       `theme_${r.theme_id}_${ts}_${idx}.png`,
                url:            img.startsWith("data:") ? img : `data:image/png;base64,${img}`,
                width:          screenW,
                height:         screenH,
                createdAt:      new Date().toISOString(),
                model:          modelLabel,
                generationTime: r.time,
              }))
            );
            await saveImagesToGallery(fallbackImages);
            setJobMsg(`✓ Done! ${data.total} image(s) in ${data.time.toFixed(1)}s · Saved locally`);
          }
        } else {
          throw new Error("No images returned from Modal");
        }
      } else {
        // ── Local Python pipeline path (non-serverless) ────────────
        const formData = new FormData();
        formData.append("mode", mode);
        formData.append("actorMode", actorMode);
        if (actorFile) formData.append("actorSource", actorFile);
        formData.append("gender", gender);
        formData.append("ethnicity", ethnicity);
        formData.append("age", age);
        formData.append("features", features.join(","));
        if (subject) formData.append("subject", subject);
        if (propFile) formData.append("propSource", propFile);
        formData.append("propMode", propMode);
        formData.append("propDesc", propDesc);
        formData.append("themes", String(selectedTheme));
        formData.append("screen", screen);
        formData.append("numImages", String(numImages));
        formData.append("color", color);
        formData.append("strength", String(strength));
        formData.append("seed", String(seed));
        formData.append("useFlux", String(useFlux));
        formData.append("fluxVariant", fluxVariant);
        formData.append("continuity", String(continuity));
        formData.append("continuityArc", continuityArc);

        const res = await fetch("/api/generate", { method: "POST", body: formData });
        const data = await res.json();
        if (res.ok) {
          setJobStatus("done");
          setProgress(100);
          setJobMsg(`✓ Done! ${data.total ?? totalImages} images generated.`);
        } else {
          throw new Error(data.error || "Generation failed");
        }
      }
    } catch (err: unknown) {
      setJobStatus("error");
      setJobMsg(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const Section = ({ id, title, icon, children }: { id: Section; title: string; icon: React.ReactNode; children: React.ReactNode }) => (
    <div className="card overflow-hidden">
      <button
        onClick={() => toggleSection(id)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-primary">{icon}</span>
          <span className="font-semibold text-black dark:text-white">{title}</span>
        </div>
        {open[id] ? <ChevronDown size={16} className="text-body" /> : <ChevronRight size={16} className="text-body" />}
      </button>
      {open[id] && (
        <div className="border-t border-stroke dark:border-strokedark px-5 py-5">
          {children}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-title-md font-bold text-black dark:text-white flex items-center gap-2">
            <Film size={22} className="text-primary" />
            Image Generator
          </h1>
          <p className="text-sm text-body mt-1">
            {pageTab === "img-gen"
              ? "Generate commercial ads · Actor · Prop · Actor+Prop · 1–10 images"
              : "Generate images from text prompt · Flux on Modal GPU"
            }
          </p>
        </div>

        {/* Cost estimate */}
        {serverless && (
          <div className="rounded border border-stroke dark:border-strokedark bg-white dark:bg-boxdark px-4 py-3 text-right">
            <p className="text-xs text-body">Estimated</p>
            <p className="text-base font-bold text-black dark:text-white">
              {estCost ? `$${estCost}` : "—"}
            </p>
            <p className="text-xs text-body">
              {estSecs ? `~${Math.ceil(estSecs / 60)}m · ${numImages} img` : `${numImages} image${numImages > 1 ? "s" : ""}`}
            </p>
          </div>
        )}
      </div>

      {/* ── Tab switcher ── */}
      <div className="flex rounded-lg border border-stroke dark:border-strokedark overflow-hidden w-fit">
        <button
          onClick={() => setPageTab("img-gen")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            pageTab === "img-gen"
              ? "bg-primary text-white"
              : "bg-white dark:bg-boxdark text-body hover:bg-gray dark:hover:bg-meta-4"
          }`}
        >
          <Film size={14} />
          Image Generator
        </button>
        <button
          onClick={() => setPageTab("txt2img")}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-l border-stroke dark:border-strokedark ${
            pageTab === "txt2img"
              ? "bg-primary text-white"
              : "bg-white dark:bg-boxdark text-body hover:bg-gray dark:hover:bg-meta-4"
          }`}
        >
          <Wand2 size={14} />
          Text to Image
        </button>
      </div>

      {/* ── Text to Image UI ── */}
      {pageTab === "txt2img" && (
        <div className="space-y-5 max-w-2xl">
          {/* Preset chips */}
          <div className="rounded-xl border border-stroke dark:border-strokedark bg-white dark:bg-boxdark p-5 space-y-4">
            <div>
              <p className="text-xs text-body mb-2 font-medium">Quick presets:</p>
              <div className="flex flex-wrap gap-2">
                {TXT2IMG_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => setT2iPrompt(p.prompt)}
                    className="rounded-full border border-stroke dark:border-strokedark px-3 py-1 text-xs text-body hover:border-primary hover:text-primary transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-black dark:text-white">Prompt</label>
              <textarea
                value={t2iPrompt}
                onChange={(e) => setT2iPrompt(e.target.value)}
                placeholder="Describe the image you want... e.g. 'a beautiful sunset over mountains, photorealistic, 8K'"
                rows={4}
                className="w-full rounded-lg border border-stroke dark:border-strokedark bg-transparent px-3 py-2.5 text-sm text-black dark:text-white placeholder:text-body resize-none focus:outline-none focus:border-primary"
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleT2iGenerate(); }}
              />
              <p className="text-[10px] text-body">Tip: Ctrl/Cmd+Enter untuk generate</p>
            </div>

            {/* Settings row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Ratio — reuse current screen state from img-gen tab */}
              <div className="flex items-center gap-1 rounded-lg border border-stroke dark:border-strokedark p-1">
                {(["9:16", "1:1", "16:9"] as const).map((r) => (
                  <button key={r} onClick={() => setScreen(r)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      screen === r ? "bg-primary text-white" : "text-body hover:text-black dark:hover:text-white"
                    }`}>{r}</button>
                ))}
              </div>
              {/* Num images */}
              <div className="flex items-center gap-1 rounded-lg border border-stroke dark:border-strokedark p-1">
                {[1, 2, 4].map((n) => (
                  <button key={n} onClick={() => setT2iNumImages(n)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      t2iNumImages === n ? "bg-primary text-white" : "text-body hover:text-black dark:hover:text-white"
                    }`}>{n} img{n > 1 ? "s" : ""}</button>
                ))}
              </div>
              {/* Model */}
              <div className="flex items-center gap-1 rounded-lg border border-stroke dark:border-strokedark p-1">
                {[
                  { v: "schnell", l: "Schnell (fast)" },
                  { v: "dev",     l: "Dev (quality)" },
                ].map(({ v, l }) => (
                  <button key={v} onClick={() => setT2iModel(v as "schnell" | "dev")}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      t2iModel === v ? "bg-primary text-white" : "text-body hover:text-black dark:hover:text-white"
                    }`}>{l}</button>
                ))}
              </div>
            </div>

            {/* Generate button */}
            <button
              onClick={handleT2iGenerate}
              disabled={!t2iPrompt.trim() || t2iStatus === "loading"}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-bold text-white hover:bg-opacity-90 transition-colors disabled:opacity-50"
            >
              {t2iStatus === "loading"
                ? <><Sparkles size={16} className="animate-spin" /> Generating...</>
                : <><Sparkles size={16} /> Generate {t2iNumImages} Image{t2iNumImages > 1 ? "s" : ""}</>
              }
            </button>
          </div>

          {/* Status */}
          {t2iMsg && (
            <div className={`rounded-lg px-4 py-2.5 text-sm font-medium ${
              t2iStatus === "error"   ? "bg-danger/10 text-danger border border-danger/20"
              : t2iStatus === "done" ? "bg-success/10 text-success border border-success/20"
              : "bg-primary/10 text-primary border border-primary/20"
            }`}>
              {t2iMsg}
            </div>
          )}

          {/* Results */}
          {t2iImages.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-black dark:text-white flex items-center gap-2">
                <CheckCircle size={15} className="text-success" />
                Results
                {t2iTime && <span className="text-xs font-normal text-body">({t2iTime.toFixed(1)}s)</span>}
              </h2>
              <div className={`grid gap-3 ${
                t2iNumImages === 1 ? "grid-cols-1 max-w-xs"
                : t2iNumImages === 2 ? "grid-cols-2"
                : "grid-cols-2 sm:grid-cols-4"
              }`}>
                {t2iImages.map((img, idx) => (
                  <div key={idx}
                    className="group relative rounded-xl overflow-hidden border border-stroke dark:border-strokedark cursor-pointer bg-gray dark:bg-meta-4"
                    style={{ aspectRatio: screen === "1:1" ? "1/1" : screen === "16:9" ? "16/9" : "9/16" }}
                    onClick={() => setPreviewImg(img)}
                  >
                    <img src={img} alt={`T2I ${idx + 1}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all" />
                    <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={(e) => { e.stopPropagation(); setPreviewImg(img); }}
                        className="rounded-full bg-white/90 p-2 hover:bg-white">
                        <ZoomIn size={14} />
                      </button>
                      <button onClick={(e) => {
                        e.stopPropagation();
                        const a = document.createElement("a"); a.href = img;
                        a.download = `txt2img_${Date.now()}_${idx + 1}.png`; a.click();
                      }} className="rounded-full bg-white/90 p-2 hover:bg-white">
                        <Download size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Job status bar — only for img-gen tab */}
      {pageTab === "img-gen" && jobStatus !== "idle" && (
        <div className={`rounded border overflow-hidden
          ${jobStatus === "running" ? "border-warning/30 bg-warning/5" : ""}
          ${jobStatus === "done" ? "border-success/30 bg-success/5" : ""}
          ${jobStatus === "error" ? "border-danger/30 bg-danger/5" : ""}
        `}>
          <div className="flex items-center gap-3 px-4 py-3">
            {jobStatus === "running" && <div className="loader flex-shrink-0" />}
            {jobStatus === "done" && <CheckCircle size={18} className="flex-shrink-0 text-success" />}
            {jobStatus === "error" && <AlertCircle size={18} className="flex-shrink-0 text-danger" />}
            <span className={`text-sm font-medium flex-1 min-w-0 truncate
              ${jobStatus === "running" ? "text-warning" : ""}
              ${jobStatus === "done" ? "text-success" : ""}
              ${jobStatus === "error" ? "text-danger" : ""}
            `}>{jobMsg}</span>
            {jobStatus === "running" && (
              <span className="flex-shrink-0 text-xs font-mono text-warning">{Math.round(progress)}%</span>
            )}
          </div>
          {/* Progress bar */}
          {jobStatus === "running" && (
            <div className="h-1 bg-warning/10">
              <div
                className="h-full bg-warning transition-all duration-400 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          {jobStatus === "done" && (
            <div className="h-1 bg-success" />
          )}
        </div>
      )}

      {/* ── In-page Result Preview (img-gen tab only) ── */}
      {pageTab === "img-gen" && resultImages.length > 0 && (
        <div className="space-y-3" ref={resultsRef}>
          {/* Header bar */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-base font-semibold text-black dark:text-white flex items-center gap-2 flex-wrap">
              <CheckCircle size={17} className="text-success" />
              Generated Results
              <span className="text-sm font-normal text-body">
                ({resultImages.reduce((s, r) => s + r.images.length, 0)} images · {resultImages.length} themes
                {resultTotalTime !== null ? ` · ${resultTotalTime.toFixed(1)}s` : ""})
              </span>
            </h2>
            <div className="flex items-center gap-2">
              {/* Download All */}
              <button
                onClick={downloadAll}
                className="flex items-center gap-1.5 rounded border border-stroke dark:border-strokedark px-3 py-1.5 text-xs font-medium text-body hover:border-primary hover:text-primary transition-colors"
                title="Download all images"
              >
                <Download size={12} />
                Download All ({resultImages.reduce((s, r) => s + r.images.length, 0)})
              </button>
              <a href="/gallery" className="text-xs text-primary underline font-medium">Gallery →</a>
              <button
                onClick={() => { setResultImages([]); setResultTotalTime(null); }}
                className="text-xs text-body hover:text-danger transition-colors flex items-center gap-1"
              >
                <X size={12} /> Clear
              </button>
            </div>
          </div>

          {/* Responsive image grid — all images in one flat grid */}
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {resultImages.flatMap((r) =>
              r.images.map((imgUrl, frameIdx) => (
                <div
                  key={`${r.themeId}-${frameIdx}`}
                  className="group relative rounded overflow-hidden border border-stroke dark:border-strokedark bg-gray dark:bg-meta-4 cursor-pointer"
                  onClick={() => setPreviewImg(imgUrl)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={imgUrl}
                    alt={`${r.themeName}`}
                    className="w-full object-cover"
                    style={{ aspectRatio: screen === "1:1" ? "1/1" : screen === "16:9" ? "16/9" : "9/16" }}
                  />

                  {/* Sequence frame badge */}
                  {r.sequence && r.images.length > 1 && (
                    <div className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white font-semibold">
                      {frameIdx + 1}/{r.images.length}
                    </div>
                  )}

                  {/* Hover overlay */}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all" />
                  <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); setPreviewImg(imgUrl); }}
                      className="rounded-full bg-white/90 p-2 hover:bg-white transition-colors"
                      title="Fullscreen"
                    >
                      <ZoomIn size={13} className="text-black" />
                    </button>
                    <a
                      href={imgUrl}
                      download={`theme_${r.themeId}_f${frameIdx + 1}.png`}
                      className="rounded-full bg-white/90 p-2 hover:bg-white transition-colors"
                      title="Download"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download size={13} className="text-black" />
                    </a>
                  </div>

                  {/* Bottom label — always visible */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-2 pt-6 pb-2">
                    <p className="text-[11px] font-semibold text-white truncate leading-tight">#{r.themeId} {r.themeName}</p>
                    <p className="text-[10px] text-white/60">{r.time.toFixed(1)}s</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Fullscreen Lightbox ─────────────────────────────────── */}
      {previewImg && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90"
          onClick={() => setPreviewImg(null)}
        >
          <button
            onClick={() => setPreviewImg(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
          >
            <X size={20} />
          </button>
          <a
            href={previewImg}
            download="generated.png"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-16 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition-colors"
            title="Download"
          >
            <Download size={20} />
          </a>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewImg}
            alt="preview"
            className="max-h-[90vh] max-w-[90vw] rounded object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── Main content — img-gen tab only ─────────────────────── */}
      {pageTab === "img-gen" && <><div className="card px-5 py-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-shrink-0">
            <p className="text-sm font-semibold text-black dark:text-white">Jumlah Image</p>
            <p className="text-xs text-body mt-0.5">
              Variasi dari theme{" "}
              <span className="font-semibold text-primary">#{selectedTheme} {selectedThemeName}</span>
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <button
                key={n}
                onClick={() => setNumImages(n)}
                title={`Generate ${n} variasi dari theme yang dipilih`}
                className={`w-10 h-10 rounded border text-sm font-bold transition-all
                  ${numImages === n
                    ? "border-primary bg-primary text-white shadow"
                    : "border-stroke dark:border-strokedark text-body hover:border-primary hover:text-primary"
                  }`}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="ml-auto flex-shrink-0 text-center">
            <div className="text-2xl font-bold text-primary leading-none">{numImages}</div>
            <div className="text-[10px] text-body mt-0.5">image{numImages > 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* Left column */}
        <div className="xl:col-span-2 space-y-4">

          {/* 1. Generation Mode */}
          <Section id="mode" title="Generation Mode" icon={<Shuffle size={18} />}>
            <div className="grid grid-cols-3 gap-3">
              {([
                { v: "actor", label: "Actor Only", desc: "Person in themed scenes", icon: <User size={20} /> },
                { v: "prop", label: "Prop Only", desc: "Product in themed scenes", icon: <Package size={20} /> },
                { v: "actor+prop", label: "Actor + Prop", desc: "Person with product", icon: <Users size={20} /> },
              ] as { v: GenerationMode; label: string; desc: string; icon: React.ReactNode }[]).map((m) => (
                <button
                  key={m.v}
                  onClick={() => setMode(m.v)}
                  className={`flex flex-col items-center gap-2 rounded border-2 p-4 text-center transition-all
                    ${mode === m.v ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                >
                  <span className={mode === m.v ? "text-primary" : "text-body"}>{m.icon}</span>
                  <span className={`text-sm font-semibold ${mode === m.v ? "text-primary" : "text-black dark:text-white"}`}>{m.label}</span>
                  <span className="text-xs text-body">{m.desc}</span>
                </button>
              ))}
            </div>
          </Section>

          {/* 2. Actor Config */}
          {hasActor && (
            <Section id="actor" title="Actor Configuration" icon={<User size={18} />}>
              {/* Actor Mode tabs */}
              <div className="flex rounded border border-stroke dark:border-strokedark overflow-hidden mb-5">
                {([
                  { v: "source",  label: "Upload Face" },
                  { v: "trained", label: "LoRA Trained" },
                  { v: "random",  label: "Random" },
                ] as { v: ActorMode; label: string }[]).map((m) => (
                  <button
                    key={m.v}
                    onClick={() => setActorMode(m.v)}
                    className={`flex-1 py-2 text-sm font-medium transition-colors
                      ${actorMode === m.v ? "bg-primary text-white" : "bg-white dark:bg-boxdark text-body hover:bg-gray dark:hover:bg-meta-4"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {actorMode === "source" && (
                <ImageUpload
                  label="Actor Face / Body Image"
                  hint="Upload a reference image to maintain face/body identity across all themes"
                  value={actorFile}
                  onChange={setActorFile}
                />
              )}
              {actorMode === "trained" && (
                <div className="space-y-4">
                  <LoraUpload
                    label="Actor LoRA Weights (.safetensors)"
                    hint="Upload file .safetensors hasil training aktor. File dikirim langsung ke Cloudinary — tidak ada batas ukuran Vercel."
                    onUrl={setActorLoraUrl}
                  />
                  <div>
                    <label className="form-label flex items-center justify-between">
                      <span>LoRA Strength</span>
                      <span className="font-mono text-primary">{actorLoraScale.toFixed(2)}</span>
                    </label>
                    <input
                      type="range" min="0.4" max="1.0" step="0.05"
                      value={actorLoraScale}
                      onChange={(e) => setActorLoraScale(parseFloat(e.target.value))}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-[10px] text-body mt-0.5">
                      <span>0.4 · subtle</span>
                      <span>0.85 · recommended</span>
                      <span>1.0 · strong</span>
                    </div>
                  </div>
                  {!actorLoraUrl && (
                    <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/5 px-3 py-2">
                      <span className="text-warning text-xs mt-0.5">⚠</span>
                      <p className="text-xs text-warning">Upload LoRA file untuk mengaktifkan mode ini</p>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 grid grid-cols-3 gap-4">
                <div>
                  <label className="form-label">Gender</label>
                  <select className="form-select" value={gender} onChange={(e) => setGender(e.target.value)}>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="non_binary">Non-binary</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Ethnicity</label>
                  <select className="form-select" value={ethnicity} onChange={(e) => setEthnicity(e.target.value)}>
                    {ETHNICITIES.map((e) => (
                      <option key={e.value} value={e.value}>{e.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Age Range</label>
                  <select className="form-select" value={age} onChange={(e) => setAge(e.target.value)}>
                    {AGE_RANGES.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Features */}
              <div className="mt-4">
                <label className="form-label">Features (optional)</label>
                <div className="flex flex-wrap gap-2">
                  {FEATURES.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => toggleFeature(f.value)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-all
                        ${features.includes(f.value)
                          ? "border-primary bg-primary text-white"
                          : "border-stroke dark:border-strokedark text-body hover:border-primary"
                        }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom subject */}
              <div className="mt-4">
                <label className="form-label">Custom Subject Description <span className="text-body font-normal">(overrides above)</span></label>
                <input
                  className="form-input"
                  placeholder="e.g. elegant Asian woman in her 30s with straight hair"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              {/* Camera Shot — shown in actor section if no prop */}
              {!hasProp && (
                <div className="mt-4">
                  <label className="form-label">Camera Shot</label>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {CAMERA_SHOTS.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => setCameraShot(s.value)}
                        className={`rounded border px-2 py-2 text-xs text-center transition-all
                          ${cameraShot === s.value
                            ? "border-primary bg-primary/5 text-primary font-semibold"
                            : "border-stroke dark:border-strokedark text-body hover:border-primary/50"
                          }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* 3. Prop Config */}
          {hasProp && (
            <Section id="prop" title="Prop Configuration" icon={<Package size={18} />}>
              <div className="flex rounded border border-stroke dark:border-strokedark overflow-hidden mb-5">
                {([
                  { v: "upload", label: "Upload Product" },
                  { v: "trained", label: "LoRA Trained" },
                ] as { v: PropMode; label: string }[]).map((m) => (
                  <button
                    key={m.v}
                    onClick={() => setPropMode(m.v)}
                    className={`flex-1 py-2 text-sm font-medium transition-colors
                      ${propMode === m.v ? "bg-primary text-white" : "bg-white dark:bg-boxdark text-body hover:bg-gray dark:hover:bg-meta-4"}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {propMode === "upload" && (
                <ImageUpload
                  label="Product Image"
                  hint="The product will be composited into the generated scene"
                  value={propFile}
                  onChange={setPropFile}
                />
              )}

              {propMode === "trained" && (
                <div className="space-y-4">
                  <LoraUpload
                    label="Prop LoRA Weights (.safetensors)"
                    hint="Upload file .safetensors hasil training produk/prop."
                    onUrl={setPropLoraUrl}
                  />
                  <div>
                    <label className="form-label flex items-center justify-between">
                      <span>LoRA Strength</span>
                      <span className="font-mono text-primary">{propLoraScale.toFixed(2)}</span>
                    </label>
                    <input
                      type="range" min="0.4" max="1.0" step="0.05"
                      value={propLoraScale}
                      onChange={(e) => setPropLoraScale(parseFloat(e.target.value))}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-[10px] text-body mt-0.5">
                      <span>0.4 · subtle</span>
                      <span>0.90 · recommended</span>
                      <span>1.0 · strong</span>
                    </div>
                  </div>
                  {!propLoraUrl && (
                    <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/5 px-3 py-2">
                      <span className="text-warning text-xs mt-0.5">⚠</span>
                      <p className="text-xs text-warning">Upload LoRA file untuk mengaktifkan mode ini</p>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4">
                <label className="form-label">Product Description <span className="text-danger">*</span></label>
                <input
                  className="form-input"
                  placeholder='e.g. "premium skincare serum bottle" or "luxury handbag"'
                  value={propDesc}
                  onChange={(e) => setPropDesc(e.target.value)}
                />
              </div>

              {/* Camera Shot — moved from settings to prop/actor config */}
              <div className="mt-4">
                <label className="form-label">Camera Shot</label>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {CAMERA_SHOTS.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setCameraShot(s.value)}
                      className={`rounded border px-2 py-2 text-xs text-center transition-all
                        ${cameraShot === s.value
                          ? "border-primary bg-primary/5 text-primary font-semibold"
                          : "border-stroke dark:border-strokedark text-body hover:border-primary/50"
                        }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </Section>
          )}

          {/* 4. Themes */}
          <Section id="themes" title="Select Theme" icon={<Film size={18} />}>
            <p className="text-xs text-body mb-3">
              Pilih 1 theme. Sistem akan generate <strong>{numImages} variasi</strong> berbeda dari theme tersebut.
            </p>
            <ThemeSelector selected={selectedTheme} onChange={setSelectedTheme} />
          </Section>

          {/* 5. Generation Settings */}
          <Section id="settings" title="Generation Settings" icon={<Info size={18} />}>
            {/* Screen ratio */}
            <div className="mb-5">
              <label className="form-label">Screen Ratio</label>
              <div className="grid grid-cols-5 gap-2">
                {Object.entries(SCREEN_RATIOS).map(([key, r]) => (
                  <button
                    key={key}
                    onClick={() => setScreen(key as ScreenRatio)}
                    className={`rounded border p-2 text-center text-xs transition-all
                      ${screen === key ? "border-primary bg-primary/5 text-primary font-semibold" : "border-stroke dark:border-strokedark text-body hover:border-primary/50"}`}
                  >
                    <div className="font-bold">{key}</div>
                    <div className="mt-0.5 text-[10px] leading-tight">{r.width}×{r.height}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Color palette */}
            <div className="mb-5">
              <ColorPicker value={color} onChange={setColor} />
            </div>

            {/* Sequence Mode */}
            <div className="mb-4 flex items-center justify-between rounded border border-stroke dark:border-strokedark px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-black dark:text-white">Sequence Mode</p>
                <p className="text-xs text-body mt-0.5">
                  {numImages > 1
                    ? `${numImages} theme × 1 frame masing-masing (independent)`
                    : "Aktifkan untuk multi-frame story dalam 1 theme"}
                </p>
              </div>
              <button
                onClick={() => setSequenceMode(!sequenceMode)}
                className={`relative h-6 w-11 rounded-full transition-colors flex-shrink-0 ${sequenceMode ? "bg-primary" : "bg-stroke dark:bg-strokedark"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${sequenceMode ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>


            {/* Variation Strength — hardcoded per mode, not exposed to user */}

            {/* Model selection */}
            <div>
              <label className="form-label">Model</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setUseFlux(true)}
                  className={`rounded border p-3 text-sm text-left transition-all
                    ${useFlux ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                >
                  <p className={`font-semibold ${useFlux ? "text-primary" : "text-black dark:text-white"}`}>Flux.1</p>
                  <p className="text-xs text-body mt-1">Best quality · 24GB VRAM</p>
                  {useFlux && (
                    <div className="mt-2 flex gap-2">
                      {(["dev", "schnell"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={(e) => { e.stopPropagation(); setFluxVariant(v); }}
                          className={`rounded px-2 py-0.5 text-xs font-medium transition-all
                            ${fluxVariant === v ? "bg-primary text-white" : "bg-gray dark:bg-meta-4 text-body"}`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  )}
                </button>
                <button
                  onClick={() => setUseFlux(false)}
                  className={`rounded border p-3 text-sm text-left transition-all
                    ${!useFlux ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                >
                  <p className={`font-semibold ${!useFlux ? "text-primary" : "text-black dark:text-white"}`}>SDXL</p>
                  <p className="text-xs text-body mt-1">Faster · 8GB+ VRAM</p>
                </button>
              </div>
            </div>
          </Section>

          {/* 6. Continuity */}
          <Section id="continuity" title="Continuity / Storytelling" icon={<Film size={18} />}>

            {/* Arc selector — used by both Sequence Mode and Cross-theme Continuity */}
            <div className="mb-4">
              <label className="form-label">Story Arc</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(CONTINUITY_ARCS) as [ContinuityArc, typeof CONTINUITY_ARCS[string]][]).map(([key, arc]) => (
                  <button
                    key={key}
                    onClick={() => setContinuityArc(key)}
                    className={`rounded border p-2.5 text-left transition-all
                      ${continuityArc === key ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                  >
                    <p className={`text-xs font-semibold ${continuityArc === key ? "text-primary" : "text-black dark:text-white"}`}>{arc.label}</p>
                    <p className="text-[10px] text-body mt-0.5 leading-tight">{arc.description}</p>
                  </button>
                ))}
              </div>
              <p className="text-xs text-body mt-1.5">Arc ini digunakan oleh Sequence Mode (per-theme) dan Cross-theme Continuity (antar-theme).</p>
            </div>

            {/* Cross-theme Continuity toggle */}
            <div className="flex items-center justify-between rounded border border-stroke dark:border-strokedark px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-black dark:text-white">Cross-theme Continuity</p>
                <p className="text-xs text-body mt-0.5">Frame terakhir theme N menjadi referensi theme N+1</p>
              </div>
              <button
                onClick={() => setContinuity(!continuity)}
                className={`relative h-6 w-11 rounded-full transition-colors flex-shrink-0 ${continuity ? "bg-primary" : "bg-stroke dark:bg-strokedark"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${continuity ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>

            {continuity && (
              <div className="mt-2 rounded border border-warning/20 bg-warning/5 px-3 py-2">
                <p className="text-xs text-warning">
                  ⚠ Cross-theme continuity menggunakan img2img antar theme — proses lebih lambat. Pastikan sudah pilih arc di atas.
                </p>
              </div>
            )}

            {/* Hidden: old arc list replaced by top selector — kept for compatibility */}
            {false && (
              <div className="grid grid-cols-2 gap-3">
                {(Object.entries(CONTINUITY_ARCS) as [ContinuityArc, typeof CONTINUITY_ARCS[string]][]).map(([key, arc]) => (
                  <button key={key} onClick={() => setContinuityArc(key)}
                    className={`rounded border p-3 text-left ${continuityArc === key ? "border-primary" : "border-stroke dark:border-strokedark"}`}>
                    <p className="text-sm font-semibold">{arc.label}</p>
                  </button>
                ))}
              </div>
            )}
          </Section>

        </div>

        {/* Right column — Serverless + Generate */}
        <div className="space-y-4">

          {/* Serverless config — Modal.com */}
          <Section id="serverless" title="Modal.com Serverless" icon={<Cpu size={18} />}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-medium text-black dark:text-white">Use Serverless GPU</p>
                <p className="text-xs text-body mt-0.5">Modal.com · pay per second · no idle cost</p>
              </div>
              <button
                onClick={() => setServerless(!serverless)}
                className={`relative h-6 w-11 rounded-full transition-colors ${serverless ? "bg-primary" : "bg-stroke dark:bg-strokedark"}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${serverless ? "translate-x-5" : "translate-x-0.5"}`} />
              </button>
            </div>

            {serverless && (
              <>
                <p className="text-xs text-body mb-3">
                  Credentials loaded from environment secrets.{" "}
                  <a href="/serverless" className="text-primary underline">GPU Settings →</a>
                </p>

                {/* GPU selector */}
                <div>
                  <label className="form-label">GPU Type</label>
                  <div className="space-y-1.5">
                    {Object.entries(GPU_CATALOG).filter(([k]) => k !== "any").map(([key, g]) => {
                      const spi = g[modelKey as keyof typeof g] as number | undefined;
                      const costPer = spi && g.price_hr ? ((spi / 3600) * g.price_hr).toFixed(5) : null;
                      return (
                        <button
                          key={key}
                          onClick={() => setGpu(key as GpuType)}
                          className={`w-full rounded border p-2.5 text-left transition-all
                            ${gpu === key ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-sm font-medium ${gpu === key ? "text-primary" : "text-black dark:text-white"}`}>{g.name}</span>
                            <div className="text-right">
                              {g.price_hr && <span className="text-xs text-body">${g.price_hr}/hr</span>}
                            </div>
                          </div>
                          {g.vram_gb && (
                            <div className="flex items-center justify-between mt-0.5">
                              <span className="text-xs text-body">{g.vram_gb}GB VRAM · {g.tier}</span>
                              {spi && <span className="text-xs text-body">{spi}s/img{costPer && ` · $${costPer}`}</span>}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </Section>

          {/* Generate summary card */}
          <div className="card p-5 space-y-3">
            <h3 className="font-semibold text-black dark:text-white text-sm">Generation Summary</h3>

            {/* Summary number */}
            <div className="rounded bg-primary/5 border border-primary/20 px-4 py-3 flex items-center gap-4">
              <div className="text-center flex-shrink-0">
                <div className="text-4xl font-bold text-primary leading-none">{numImages}</div>
                <div className="text-[10px] text-primary/70 mt-0.5">image{numImages > 1 ? "s" : ""}</div>
              </div>
              <div className="text-body text-sm font-light">×</div>
              <div className="text-xs text-body border-l border-stroke dark:border-strokedark pl-4 min-w-0">
                <p className="font-semibold text-black dark:text-white truncate">#{selectedTheme} {selectedThemeName}</p>
                <p className="text-[10px] mt-0.5">{numImages} variasi dari 1 theme</p>
              </div>
            </div>

            <div className="space-y-1.5 text-xs">
              {[
                { label: "Theme", value: `#${selectedTheme} ${selectedThemeName}` },
                { label: "Mode", value: mode.toUpperCase() },
                { label: "Model", value: useFlux ? `Flux.1 ${fluxVariant}` : "SDXL" },
                { label: "Screen", value: `${screen} (${SCREEN_RATIOS[screen].width}×${SCREEN_RATIOS[screen].height})` },
                { label: "Camera", value: cameraShot === "mix" ? "Mix (auto-vary)" : CAMERA_SHOTS.find(s => s.value === cameraShot)?.label ?? "Auto" },
                { label: "Backend", value: serverless ? "Modal.com Serverless" : "Local GPU" },
                ...(serverless && gpu !== "any" ? [
                  { label: "GPU", value: GPU_CATALOG[gpu].name },
                  ...(estSecs ? [{ label: "Est. Time", value: `~${Math.ceil(estSecs / 60)}m` }] : []),
                  ...(estCost ? [{ label: "Est. Cost", value: `$${estCost}` }] : []),
                ] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between gap-2">
                  <span className="text-body flex-shrink-0">{label}</span>
                  <span className="font-medium text-black dark:text-white text-right truncate max-w-[60%]">{value}</span>
                </div>
              ))}
            </div>

            {/* Upload status indicators */}
            {(hasActor || hasProp) && (
              <div className="space-y-1 pt-1 border-t border-stroke dark:border-strokedark">
                {hasActor && actorMode === "source" && (
                  <div className={`flex items-center gap-1.5 text-xs rounded px-2 py-1
                    ${actorFile ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                    <span>{actorFile ? "✓" : "⚠"}</span>
                    <span>Actor: {actorFile ? `${actorFile.name} (${(actorFile.size/1024).toFixed(0)}KB)` : "Belum upload gambar actor"}</span>
                  </div>
                )}
                {hasProp && propMode === "upload" && (
                  <div className={`flex items-center gap-1.5 text-xs rounded px-2 py-1
                    ${propFile ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                    <span>{propFile ? "✓" : "⚠"}</span>
                    <span>Prop: {propFile ? `${propFile.name} (${(propFile.size/1024).toFixed(0)}KB)` : "Belum upload gambar produk"}</span>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={jobStatus === "running"}
              className="btn-primary w-full mt-2 py-3"
            >
              {jobStatus === "running" ? (
                <>
                  <div className="loader" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  Generating...
                </>
              ) : (
                <>
                  <Play size={16} />
                  Generate {numImages} Image{numImages > 1 ? "s" : ""}
                </>
              )}
            </button>

            {jobStatus === "done" && (
              <div className="flex gap-2">
                <button
                  onClick={() => { setJobStatus("idle"); setResultImages([]); setResultTotalTime(null); }}
                  className="flex-1 rounded border border-stroke dark:border-strokedark py-2.5 text-sm font-medium text-body hover:border-primary hover:text-primary transition-colors text-center"
                >
                  New Generation
                </button>
                <a href="/gallery" className="flex-1 btn-success text-center block py-2.5 rounded text-sm font-medium">
                  Gallery →
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
      </>}
    </div>
  );
}
