"use client";
import { useState, useEffect, useRef } from "react";
import {
  Layers, Upload, Play, Download, ZoomIn, X,
  CheckCircle, AlertCircle, User, Package,
} from "lucide-react";
import ImageUpload from "@/components/TikTokAds/ImageUpload";
import { saveImagesToGallery } from "@/app/(dashboard)/gallery/page";
import type { GalleryImage } from "@/app/(dashboard)/gallery/page";
import { useMultiAngle } from "@/context/MultiAngleContext";
import type { AngleResult } from "@/context/MultiAngleContext";

// ── 16 angle definitions (must match modal_app.py MULTI_ANGLE_SHOTS) ──
const ANGLES = [
  { idx: 0,  name: "Front View",      emoji: "⬜", row: 0 },
  { idx: 1,  name: "Back View",       emoji: "⬛", row: 0 },
  { idx: 2,  name: "Left Side",       emoji: "◀",  row: 0 },
  { idx: 3,  name: "Right Side",      emoji: "▶",  row: 0 },
  { idx: 4,  name: "3/4 Front-Left",  emoji: "↖",  row: 1 },
  { idx: 5,  name: "3/4 Front-Right", emoji: "↗",  row: 1 },
  { idx: 6,  name: "3/4 Back-Left",   emoji: "↙",  row: 1 },
  { idx: 7,  name: "3/4 Back-Right",  emoji: "↘",  row: 1 },
  { idx: 8,  name: "Overhead",        emoji: "⬆",  row: 2 },
  { idx: 9,  name: "Bottom View",     emoji: "⬇",  row: 2 },
  { idx: 10, name: "Detail Left",     emoji: "🔍", row: 2 },
  { idx: 11, name: "Detail Right",    emoji: "🔎", row: 2 },
  { idx: 12, name: "Detail Front",    emoji: "🏷",  row: 3 },
  { idx: 13, name: "Macro Texture",   emoji: "🔬", row: 3 },
  { idx: 14, name: "Flat-Lay",        emoji: "📐", row: 3 },
  { idx: 15, name: "Glamour Hero",    emoji: "✨", row: 3 },
];

type SubjectType  = "prop" | "actor";
type QualityLevel = "best" | "better" | "good";
type GpuSpeed     = "fast" | "turbo";

// Kualitas — model & steps
const QUALITY_LEVELS: Record<QualityLevel, { label: string; desc: string; variant: "schnell" | "dev" | "sdxl"; steps: number }> = {
  best:   { label: "Best",   desc: "Flux Dev · Highest Quality",   variant: "dev",     steps: 20 },
  better: { label: "Better", desc: "Flux Schnell · Fast & Sharp",  variant: "schnell", steps: 4  },
  good:   { label: "Good",   desc: "SDXL · Faster · Budget",       variant: "sdxl",    steps: 30 },
};

// Kecepatan GPU — Modal.com H100 vs H200
const GPU_SPEEDS: Record<GpuSpeed, { label: string; desc: string; gpu_modal: string }> = {
  fast:  { label: "Fast",  desc: "H100 SXM · 80GB",  gpu_modal: "H100" },
  turbo: { label: "Turbo", desc: "H200 SXM · 141GB", gpu_modal: "H200" },
};

// Cost/time estimates per combination [quality][speed] for 16 angles
const ESTIMATES: Record<QualityLevel, Record<GpuSpeed, { mins: string; cost: string }>> = {
  best:   { fast: { mins: "8-10", cost: "0.18" }, turbo: { mins: "5-7", cost: "0.28" } },
  better: { fast: { mins: "2-3",  cost: "0.04" }, turbo: { mins: "1-2", cost: "0.06" } },
  good:   { fast: { mins: "4-6",  cost: "0.08" }, turbo: { mins: "3-4", cost: "0.12" } },
};

export default function MultiAnglePage() {
  // ── Global job state (survives navigation) ─────────────────────────────
  const { job, setJob, resetJob } = useMultiAngle();

  // ── Local UI state (reset saat page mount — tidak perlu persist) ───────
  const [sourceFile, setSourceFile]     = useState<File | null>(null);
  const [description, setDescription]   = useState("");
  const [subjectType, setSubjectType]   = useState<SubjectType>("prop");
  const [qualityLevel, setQualityLevel] = useState<QualityLevel>("better");
  const [gpuSpeed, setGpuSpeed]         = useState<GpuSpeed>("fast");
  const [previewImg, setPreviewImg]     = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState("");

  // Seed: 42 adalah seed "golden" untuk Flux — distribusi noise paling stabil.
  // User tidak perlu tahu atau mengubah ini.
  const seed = 42;

  const resultsRef = useRef<HTMLDivElement>(null);

  // Auto-scroll ke hasil saat baru selesai
  useEffect(() => {
    if (job.angles.length > 0 && resultsRef.current) {
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  }, [job.angles.length]);

  // Cost/time dari lookup table
  const currentEst = ESTIMATES[qualityLevel][gpuSpeed];
  const estMins    = currentEst.mins;
  const estCost    = currentEst.cost;

  const fileToB64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const b64 = (reader.result as string).split(",")[1];
        if (!b64) { reject(new Error("Base64 kosong")); return; }
        resolve(b64);
      };
      reader.onerror = () => reject(new Error("Gagal baca file"));
      reader.readAsDataURL(file);
    });

  const handleGenerate = async () => {
    if (!sourceFile) {
      setJob({ message: "⚠ Upload gambar terlebih dahulu" });
      return;
    }
    if (!description.trim()) {
      setJob({ message: "⚠ Isi deskripsi subjek terlebih dahulu" });
      return;
    }

    // Set global running state — terlihat di semua halaman via floating bar
    setJob({
      status:       "running",
      progress:     0,
      angles:       [],
      totalTime:    null,
      message:      "Memproses gambar...",
      description,
      qualityLabel: `${QUALITY_LEVELS[qualityLevel].label} · ${GPU_SPEEDS[gpuSpeed].label}`,
      gpuLabel:     GPU_SPEEDS[gpuSpeed].desc,
    });

    const ts = Date.now(); // timestamp untuk filenames & gallery IDs

    try {
      const sourceB64 = await fileToB64(sourceFile);
      setJob({ message: `AI scanning produk · cold start ~30s...` });

      // ── SSE stream via Next.js proxy ──────────────────────────────────
      // Browser → /api/modal/multi-angle-stream → Modal SSE endpoint
      // Setiap angle dikirim langsung saat selesai — tidak tunggu 16 selesai
      const res = await fetch("/api/modal/multi-angle-stream", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_b64:    sourceB64,
          description,
          subject_type:  subjectType,
          seed,
          model_variant: QUALITY_LEVELS[qualityLevel].variant,
          num_steps:     QUALITY_LEVELS[qualityLevel].steps,
          gpu_speed:     gpuSpeed,
          use_caption:   true,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Stream failed: ${res.status}`);
      }

      // ── Parse SSE stream chunk by chunk ──────────────────────────────
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";
      let modelName = `flux-${QUALITY_LEVELS[qualityLevel].variant}`;
      const collectedAngles: AngleResult[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events separated by double newline "\n\n"
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? ""; // keep incomplete last chunk

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data: ")) continue;

          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line.slice(6)); }
          catch { continue; }

          const eventType = evt.event as string;

          if (eventType === "init") {
            // BLIP-2 done, Flux loaded → generation starting
            modelName = (evt.model as string) ?? modelName;
            setJob({ message: `Generating angle 1/16...` });
          }

          else if (eventType === "angle") {
            // ✅ One angle arrived — show in grid immediately!
            const a = evt as unknown as AngleResult & { event: string };
            const angle: AngleResult = {
              angle_idx:  a.angle_idx,
              angle_name: a.angle_name,
              angle_desc: a.angle_desc,
              image:      a.image.startsWith("data:") ? a.image : `data:image/png;base64,${a.image}`,
              time:       a.time,
              seed:       a.seed,
              strength:   a.strength,
              qc_passed:  a.qc_passed,
              qc_reason:  a.qc_reason,
            };
            collectedAngles.push(angle);

            const doneCount = collectedAngles.length;
            const pct = Math.round((doneCount / 16) * 100);

            setJob((prev) => ({
              angles:   [...prev.angles, angle],
              progress: pct,
              message:  doneCount < 16
                ? `Generating angle ${doneCount + 1}/16...`
                : `✓ 16 angles selesai · Uploading...`,
            }));
          }

          else if (eventType === "done") {
            const totalSecs = (evt.time as number) ?? 0;
            setJob({
              status:    "done",
              progress:  100,
              totalTime: totalSecs,
              message:   `✓ ${collectedAngles.length} angles in ${totalSecs.toFixed(1)}s · Uploading ke Cloudinary...`,
            });
          }

          else if (eventType === "error") {
            throw new Error((evt.message as string) ?? "Streaming error");
          }
        }
      }

      if (collectedAngles.length === 0) {
        throw new Error("Tidak ada angle yang diterima dari stream");
      }

      // ── Background: upload ke Cloudinary ──────────────────────────────
      const allImages = collectedAngles.map((a, idx) => ({
        b64:       a.image,
        filename:  `multi_angle_${ts}_${String(idx).padStart(2, "0")}_${a.angle_name.replace(/\s+/g, "-").toLowerCase()}.png`,
        public_id: `geovera-multi-angle/angle_${ts}_${String(idx).padStart(2, "0")}`,
      }));

      let finalUrls: { url: string; filename: string; width?: number; height?: number }[] =
        allImages.map((img) => ({ url: img.b64, filename: img.filename }));

      try {
        const uploadRes = await fetch("/api/cloudinary/upload", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ images: allImages }),
        });

        if (uploadRes.ok) {
          const uploadData = await uploadRes.json() as {
            urls: { url: string; filename: string; width?: number; height?: number }[];
          };
          finalUrls = uploadData.urls;

          // Swap base64 → Cloudinary CDN URLs in context
          const cloudAngles = collectedAngles.map((a, idx) => ({
            ...a,
            image: finalUrls[idx]?.url ?? a.image,
          }));
          setJob({
            angles:  cloudAngles,
            message: `✓ ${collectedAngles.length}/16 angles · Saved to Cloudinary ☁️`,
          });
        } else {
          setJob({ message: `✓ ${collectedAngles.length}/16 angles · Saved locally` });
        }
      } catch {
        setJob({ message: `✓ ${collectedAngles.length}/16 angles · Saved locally` });
      }

      // ── Save ke IndexedDB gallery ────────────────────────────────────
      const galleryImages: GalleryImage[] = collectedAngles.map((a, idx) => ({
        id:             `ma_${ts}_${idx}`,
        themeId:        idx + 1,
        themeName:      `${a.angle_name} · ${description}`,
        filename:       finalUrls[idx]?.filename ?? allImages[idx].filename,
        url:            finalUrls[idx]?.url ?? allImages[idx].b64,
        width:          finalUrls[idx]?.width  ?? 1024,
        height:         finalUrls[idx]?.height ?? 1024,
        createdAt:      new Date().toISOString(),
        model:          modelName,
        generationTime: a.time,
      }));
      await saveImagesToGallery(galleryImages);

    } catch (err) {
      setJob({
        status:  "error",
        message: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
      });
    }
  };

  const downloadAll = () => {
    job.angles.forEach((a, i) => {
      setTimeout(() => {
        const el = document.createElement("a");
        el.href = a.image;
        el.download = `angle_${String(a.angle_idx + 1).padStart(2, "0")}_${a.angle_name.replace(/\s+/g, "-").toLowerCase()}.png`;
        document.body.appendChild(el);
        el.click();
        document.body.removeChild(el);
      }, i * 120);
    });
  };

  // ── Shorthand ──────────────────────────────────────────────────────────
  const jobStatus  = job.status;
  const jobMsg     = job.message;
  const progress   = job.progress;
  const resultAngles = job.angles;
  const totalTime  = job.totalTime;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-title-md font-bold text-black dark:text-white flex items-center gap-2">
            <Layers size={22} className="text-primary" />
            Multi-Angle Synthetic
          </h1>
          <p className="text-sm text-body mt-1">
            Generate 16 angle shots dari 1 gambar · LoRA dataset · E-commerce
          </p>
        </div>
        <div className="rounded border border-stroke dark:border-strokedark bg-white dark:bg-boxdark px-4 py-3 text-right">
          <p className="text-xs text-body">Estimasi ({QUALITY_LEVELS[qualityLevel].label} · {GPU_SPEEDS[gpuSpeed].label})</p>
          <p className="text-base font-bold text-black dark:text-white">${estCost}</p>
          <p className="text-xs text-body">~{estMins} menit · 16 angles</p>
        </div>
      </div>

      {/* Job status bar (inline — only shown on this page) */}
      {jobStatus !== "idle" && (
        <div className={`rounded border overflow-hidden
          ${jobStatus === "running" ? "border-warning/30 bg-warning/5" : ""}
          ${jobStatus === "done"    ? "border-success/30 bg-success/5" : ""}
          ${jobStatus === "error"   ? "border-danger/30 bg-danger/5"   : ""}
        `}>
          <div className="flex items-center gap-3 px-4 py-3">
            {jobStatus === "running" && <div className="loader flex-shrink-0" />}
            {jobStatus === "done"    && <CheckCircle size={18} className="flex-shrink-0 text-success" />}
            {jobStatus === "error"   && <AlertCircle size={18} className="flex-shrink-0 text-danger" />}
            <span className={`text-sm font-medium flex-1 min-w-0 truncate
              ${jobStatus === "running" ? "text-warning" : ""}
              ${jobStatus === "done"    ? "text-success" : ""}
              ${jobStatus === "error"   ? "text-danger"  : ""}
            `}>{jobMsg}</span>
            {jobStatus === "running" && (
              <span className="flex-shrink-0 text-xs font-mono text-warning">{Math.round(progress)}%</span>
            )}
          </div>
          {jobStatus === "running" && (
            <div className="h-1 bg-warning/10">
              <div className="h-full bg-warning transition-all duration-400 ease-out" style={{ width: `${progress}%` }} />
            </div>
          )}
          {jobStatus === "done" && <div className="h-1 bg-success" />}
        </div>
      )}

      {/* Results */}
      {resultAngles.length > 0 && (
        <div className="space-y-3" ref={resultsRef}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-base font-semibold text-black dark:text-white flex items-center gap-2">
              <CheckCircle size={17} className="text-success" />
              16 Angles Generated
              <span className="text-sm font-normal text-body">
                ({totalTime !== null ? `${totalTime.toFixed(1)}s total` : ""})
              </span>
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={downloadAll}
                className="flex items-center gap-1.5 rounded border border-stroke dark:border-strokedark px-3 py-1.5 text-xs font-medium text-body hover:border-primary hover:text-primary transition-colors"
              >
                <Download size={12} /> Download All (16)
              </button>
              <a href="/gallery" className="text-xs text-primary underline font-medium">Gallery →</a>
              <button
                onClick={resetJob}
                className="text-xs text-body hover:text-danger transition-colors flex items-center gap-1"
              >
                <X size={12} /> Clear
              </button>
            </div>
          </div>

          {/* 4×4 angle grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {resultAngles.map((a) => (
              <div
                key={a.angle_idx}
                className="group relative cursor-pointer rounded overflow-hidden border border-stroke dark:border-strokedark bg-gray dark:bg-meta-4"
                onClick={() => { setPreviewImg(a.image); setPreviewLabel(a.angle_name); }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.image}
                  alt={a.angle_name}
                  className="w-full object-cover"
                  style={{ aspectRatio: "1/1" }}
                  loading="lazy"
                />
                {/* Angle number badge */}
                <div className="absolute top-1.5 left-1.5 h-5 w-5 rounded-full bg-black/70 flex items-center justify-center">
                  <span className="text-[9px] font-bold text-white">{a.angle_idx + 1}</span>
                </div>
                {/* Gemini QC badge — shown only when QC was run */}
                {a.qc_passed !== undefined && a.qc_reason !== "qc_disabled" && a.qc_reason !== "qc_skipped" && (
                  <div
                    title={a.qc_passed ? "QC Pass" : `QC: ${a.qc_reason}`}
                    className={`absolute top-1.5 right-1.5 h-5 w-5 rounded-full flex items-center justify-center text-white shadow
                      ${a.qc_passed ? "bg-success" : "bg-danger"}`}
                  >
                    {a.qc_passed
                      ? <CheckCircle size={11} />
                      : <AlertCircle size={11} />}
                  </div>
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all" />
                <div className="absolute inset-0 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => { e.stopPropagation(); setPreviewImg(a.image); setPreviewLabel(a.angle_name); }}
                    className="rounded-full bg-white/90 p-2 hover:bg-white"
                  >
                    <ZoomIn size={13} className="text-black" />
                  </button>
                  <a
                    href={a.image}
                    download={`angle_${String(a.angle_idx + 1).padStart(2, "0")}_${a.angle_name.replace(/\s+/g, "-").toLowerCase()}.png`}
                    className="rounded-full bg-white/90 p-2 hover:bg-white"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download size={13} className="text-black" />
                  </a>
                </div>
                {/* Angle name — always visible */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 pt-4 pb-1.5">
                  <p className="text-[10px] font-semibold text-white truncate">{a.angle_name}</p>
                  <p className="text-[9px] text-white/50">{a.time.toFixed(1)}s</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fullscreen lightbox */}
      {previewImg && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/90"
          onClick={() => setPreviewImg(null)}
        >
          <button
            onClick={() => setPreviewImg(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X size={20} />
          </button>
          <a
            href={previewImg}
            download={`${previewLabel.replace(/\s+/g, "-").toLowerCase()}.png`}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-16 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <Download size={20} />
          </a>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewImg}
            alt={previewLabel}
            className="max-h-[90vh] max-w-[90vw] rounded object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm font-semibold text-white/80 bg-black/50 px-3 py-1 rounded-full">
            {previewLabel}
          </p>
        </div>
      )}

      {/* Main form */}
      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-4">

          {/* Subject Type */}
          <div className="card px-5 py-4">
            <p className="text-sm font-semibold text-black dark:text-white mb-3">Subject Type</p>
            <div className="grid grid-cols-2 gap-3">
              {([
                { v: "prop",  label: "Product / Prop",    desc: "Tas, botol, sepatu, dll",      icon: <Package size={20} /> },
                { v: "actor", label: "Actor / Character",  desc: "Model, karakter, tokoh, dll",  icon: <User size={20} />    },
              ] as { v: SubjectType; label: string; desc: string; icon: React.ReactNode }[]).map((s) => (
                <button
                  key={s.v}
                  onClick={() => setSubjectType(s.v)}
                  className={`flex flex-col items-center gap-2 rounded border-2 p-4 text-center transition-all
                    ${subjectType === s.v ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                >
                  <span className={subjectType === s.v ? "text-primary" : "text-body"}>{s.icon}</span>
                  <span className={`text-sm font-semibold ${subjectType === s.v ? "text-primary" : "text-black dark:text-white"}`}>{s.label}</span>
                  <span className="text-xs text-body">{s.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Image Upload */}
          <div className="card px-5 py-4">
            <p className="text-sm font-semibold text-black dark:text-white mb-1">
              Upload {subjectType === "prop" ? "Product Image" : "Character / Actor Image"}
            </p>
            <p className="text-xs text-body mb-3">
              {subjectType === "prop"
                ? "Upload 1 foto produk — sistem generate 16 sudut pandang berbeda dengan produk yang konsisten"
                : "Upload 1 foto karakter — sistem generate 16 sudut pandang berbeda dengan karakter yang konsisten"}
            </p>
            <ImageUpload
              label={subjectType === "prop" ? "Product Photo" : "Character Photo"}
              hint={subjectType === "prop"
                ? "Best: white/neutral background, clear product shot"
                : "Best: clear face/body, neutral background"}
              value={sourceFile}
              onChange={setSourceFile}
            />
          </div>

          {/* Description */}
          <div className="card px-5 py-4">
            <label className="form-label">
              {subjectType === "prop" ? "Product Description" : "Character Description"}
              <span className="text-danger ml-1">*</span>
            </label>
            <input
              className="form-input"
              placeholder={subjectType === "prop"
                ? 'e.g. "premium leather luxury handbag, gold hardware"'
                : 'e.g. "southeast asian female model, early 30s, elegant style"'}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="text-[10px] text-body mt-1">
              Deskripsi ini diinjeksikan ke setiap prompt angle — semakin spesifik semakin konsisten hasilnya.
            </p>
          </div>

          {/* Settings */}
          <div className="card px-5 py-4 space-y-4">
            <p className="text-sm font-semibold text-black dark:text-white">Settings</p>

            {/* Kualitas */}
            <div>
              <label className="form-label">Kualitas</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.entries(QUALITY_LEVELS) as [QualityLevel, typeof QUALITY_LEVELS[QualityLevel]][]).map(([key, q]) => (
                  <button
                    key={key}
                    onClick={() => setQualityLevel(key)}
                    className={`flex flex-col items-center gap-1 rounded border-2 py-3 px-2 text-center transition-all
                      ${qualityLevel === key ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                  >
                    <span className={`text-sm font-bold ${qualityLevel === key ? "text-primary" : "text-black dark:text-white"}`}>{q.label}</span>
                    <span className="text-[9px] text-body leading-tight">{q.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Kecepatan GPU */}
            <div>
              <label className="form-label">Kecepatan GPU</label>
              <div className="grid grid-cols-2 gap-3">
                {(Object.entries(GPU_SPEEDS) as [GpuSpeed, typeof GPU_SPEEDS[GpuSpeed]][]).map(([key, g]) => (
                  <button
                    key={key}
                    onClick={() => setGpuSpeed(key)}
                    className={`flex flex-col items-center gap-1 rounded border-2 py-3 px-2 text-center transition-all
                      ${gpuSpeed === key ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}
                  >
                    <span className={`text-sm font-bold ${gpuSpeed === key ? "text-primary" : "text-black dark:text-white"}`}>{g.label}</span>
                    <span className="text-[9px] text-body leading-tight">{g.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Angle Preview Map */}
          <div className="card px-5 py-4">
            <p className="text-sm font-semibold text-black dark:text-white mb-3">16 Angle Map</p>
            <div className="grid grid-cols-4 gap-1.5">
              {ANGLES.map((a) => (
                <div
                  key={a.idx}
                  className="rounded border border-stroke dark:border-strokedark bg-gray dark:bg-meta-4 px-2 py-2 text-center"
                >
                  <p className="text-base leading-none">{a.emoji}</p>
                  <p className="text-[9px] font-medium text-black dark:text-white mt-1 leading-tight">{a.name}</p>
                  <p className="text-[8px] text-body">#{a.idx + 1}</p>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-body mt-2">
              Semua 16 angle di-generate secara otomatis · Output: 1024×1024 (1:1) · Ideal untuk LoRA training
            </p>
          </div>

        </div>

        {/* Right column */}
        <div className="space-y-4">

          {/* Summary + Generate */}
          <div className="card p-5 space-y-3">
            <h3 className="font-semibold text-black dark:text-white text-sm">Generation Summary</h3>

            {/* Big 16 badge */}
            <div className="rounded bg-primary/5 border border-primary/20 px-4 py-3 flex items-center gap-4">
              <div className="text-center flex-shrink-0">
                <div className="text-4xl font-bold text-primary leading-none">16</div>
                <div className="text-[10px] text-primary/70 mt-0.5">angles</div>
              </div>
              <div className="text-body text-sm font-light">×</div>
              <div className="text-xs text-body border-l border-stroke dark:border-strokedark pl-4 min-w-0">
                <p className="font-semibold text-black dark:text-white truncate">1024×1024 (1:1)</p>
                <p className="text-[10px] mt-0.5">Studio · LoRA-ready</p>
              </div>
            </div>

            <div className="space-y-1.5 text-xs">
              {[
                { label: "Subject",      value: subjectType === "prop" ? "Product / Prop" : "Actor / Character" },
                { label: "Kualitas",     value: `${QUALITY_LEVELS[qualityLevel].label} · ${QUALITY_LEVELS[qualityLevel].desc}` },
                { label: "GPU",          value: `${GPU_SPEEDS[gpuSpeed].label} · ${GPU_SPEEDS[gpuSpeed].desc}` },
                { label: "Output",       value: "1024×1024 · 1:1 square" },
                { label: "Konsistensi",  value: "AI Auto-Lock ✓" },
                { label: "Est. Time",    value: `~${estMins} menit` },
                { label: "Est. Cost",    value: `$${estCost}` },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between gap-2">
                  <span className="text-body flex-shrink-0">{label}</span>
                  <span className={`font-medium text-right truncate max-w-[60%]
                    ${label === "Konsistensi" ? "text-success" : "text-black dark:text-white"}`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>

            {/* Upload status */}
            <div className={`flex items-center gap-1.5 text-xs rounded px-2 py-1
              ${sourceFile ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
              <Upload size={11} />
              {sourceFile
                ? `✓ ${sourceFile.name} (${(sourceFile.size / 1024).toFixed(0)}KB)`
                : "Belum upload gambar"}
            </div>

            <button
              onClick={handleGenerate}
              disabled={jobStatus === "running" || !sourceFile || !description.trim()}
              className="btn-primary w-full mt-2 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {jobStatus === "running" ? (
                <>
                  <div className="loader" style={{ width: 16, height: 16, borderWidth: 2 }} />
                  Generating 16 angles...
                </>
              ) : (
                <>
                  <Play size={16} />
                  Generate 16 Angles
                </>
              )}
            </button>

            {jobStatus === "done" && (
              <div className="flex gap-2">
                <button
                  onClick={resetJob}
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

          {/* Info box */}
          <div className="rounded border border-primary/20 bg-primary/5 px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold text-primary">Untuk LoRA Training</p>
            <ul className="text-xs text-body space-y-1 list-disc list-inside">
              <li>16 sudut = dataset multi-angle yang ideal</li>
              <li>Output 1:1 square = format standar LoRA</li>
              <li>AI Auto-Lock = konsistensi produk terjaga</li>
              <li>Generate ulang untuk variasi sudut berbeda</li>
            </ul>
          </div>

        </div>
      </div>
    </div>
  );
}
