"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Video, Upload, Play, Download, AlertCircle,
  CheckCircle, Loader2, Zap, Clock, Clapperboard,
  RotateCcw, Archive, Sparkles, ImageIcon, X,
} from "lucide-react";
import ImageUpload from "@/components/TikTokAds/ImageUpload";

// ── Types ────────────────────────────────────────────────────────────────────
type VideoStatus  = "idle" | "generating" | "done" | "error";
type LoraStatus   = "idle" | "generating_video" | "extracting" | "zipping" | "done" | "error";
type AugStatus    = "idle" | "running" | "done" | "error";
type Duration     = 5 | 10;
type AspectRatio  = "9:16" | "16:9" | "1:1";
type Mode         = "std" | "pro";
type TabMode      = "i2v" | "lora360" | "augment";
type FramePick    = "first" | "mid" | "last";

interface AugFrame {
  index:          number;
  image:          string;   // data URL PNG dari frame
  caption:        string;
  caption_suffix: string;
  prompt_used:    string;
  video_url?:     string;
}

interface AugStreamEvent {
  event:          string;
  index?:         number;
  done?:          number;
  total?:         number;
  message?:       string;
  phase?:         string;
  video_b64?:     string;
  video_url?:     string;
  video_mime?:    string;
  frame_pick?:    string;
  caption?:       string;
  caption_suffix?: string;
  prompt_used?:   string;
  task_id?:       string;
  total_frames?:  number;
}

const ASPECT_RATIOS: { value: AspectRatio; label: string; desc: string }[] = [
  { value: "9:16", label: "9:16",  desc: "TikTok / Reels" },
  { value: "16:9", label: "16:9",  desc: "YouTube / Landscape" },
  { value: "1:1",  label: "1:1",   desc: "Square / Instagram" },
];

const MODES: { value: Mode; label: string; desc: string; cost: string }[] = [
  { value: "std", label: "Standard", desc: "Kling v1.5 · Fast",           cost: "~$0.14/video" },
  { value: "pro", label: "Pro",      desc: "Kling v1.5-Pro · Highest QA", cost: "~$0.42/video" },
];

// ── Client-side frame extractor using hidden <video> + <canvas> ──────────────
async function extractFramesFromVideoB64(
  videoB64:   string,
  mime:        string,
  numFrames:   number,
  onProgress?: (n: number, total: number) => void,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video  = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx    = canvas.getContext("2d")!;
    const frames: string[] = [];
    const SIZE   = 1024;
    canvas.width = SIZE; canvas.height = SIZE;

    const bytes = atob(videoB64);
    const arr   = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const url  = URL.createObjectURL(blob);

    video.preload = "auto"; video.muted = true; video.src = url; video.crossOrigin = "anonymous";

    video.addEventListener("loadedmetadata", () => {
      const dur   = video.duration;
      const start = dur * 0.03;
      const end   = dur * 0.97;
      const step  = (end - start) / Math.max(numFrames - 1, 1);
      let frameIdx = 0;

      const captureNext = () => {
        if (frameIdx >= numFrames) { URL.revokeObjectURL(url); resolve(frames); return; }
        video.currentTime = start + frameIdx * step;
      };

      video.addEventListener("seeked", () => {
        const vw = video.videoWidth, vh = video.videoHeight;
        const sz = Math.min(vw, vh);
        ctx.clearRect(0, 0, SIZE, SIZE);
        ctx.drawImage(video, (vw - sz) / 2, (vh - sz) / 2, sz, sz, 0, 0, SIZE, SIZE);
        frames.push(canvas.toDataURL("image/png"));
        onProgress?.(frameIdx + 1, numFrames);
        frameIdx++;
        captureNext();
      });

      video.addEventListener("error", () => { URL.revokeObjectURL(url); reject(new Error("Video error")); });
      captureNext();
    });

    video.addEventListener("error", () => { URL.revokeObjectURL(url); reject(new Error("Failed to load video")); });
    video.load();
  });
}

// ── JSZip-less ZIP builder (pure JS) ─────────────────────────────────────────
// Creates a valid ZIP file from an array of { name, dataUrl } without any npm dep.
function buildZip(files: { name: string; dataUrl: string }[]): Uint8Array {
  // Minimal ZIP implementation — local file headers + central directory + end
  const enc  = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralDir: { name: string; offset: number; crc: number; size: number }[] = [];

  for (const { name, dataUrl } of files) {
    const b64  = dataUrl.split(",")[1] ?? dataUrl;
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const crc  = crc32(data);
    const offset = parts.reduce((s, p) => s + p.length, 0);

    const nameBytes = enc.encode(name);
    const lfh = localFileHeader(nameBytes, data.length, crc);
    parts.push(lfh, data);
    centralDir.push({ name, offset, crc, size: data.length });
  }

  const cdOffset = parts.reduce((s, p) => s + p.length, 0);
  let cdSize = 0;
  for (const { name, offset, crc, size } of centralDir) {
    const nameBytes = enc.encode(name);
    const cd = centralDirEntry(nameBytes, offset, crc, size);
    parts.push(cd);
    cdSize += cd.length;
  }

  const eocd = endOfCentralDir(centralDir.length, cdSize, cdOffset);
  parts.push(eocd);

  const total  = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  return result;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff; b[1] = (n >> 8) & 0xff; b[2] = (n >> 16) & 0xff; b[3] = (n >> 24) & 0xff;
  return b;
}
function u16le(n: number): Uint8Array { return new Uint8Array([n & 0xff, (n >> 8) & 0xff]); }

function localFileHeader(name: Uint8Array, size: number, crc: number): Uint8Array {
  const header = new Uint8Array(30 + name.length);
  // Local file header signature
  header.set([0x50, 0x4b, 0x03, 0x04], 0);
  header.set(u16le(20), 4);   // version needed: 2.0
  header.set(u16le(0),  6);   // flags
  header.set(u16le(0),  8);   // compression: stored
  header.set(u16le(0),  10);  // mod time
  header.set(u16le(0),  12);  // mod date
  header.set(u32le(crc), 14);
  header.set(u32le(size), 18);
  header.set(u32le(size), 22);
  header.set(u16le(name.length), 26);
  header.set(u16le(0), 28);   // extra field length
  header.set(name, 30);
  return header;
}

function centralDirEntry(name: Uint8Array, offset: number, crc: number, size: number): Uint8Array {
  const entry = new Uint8Array(46 + name.length);
  entry.set([0x50, 0x4b, 0x01, 0x02], 0);
  entry.set(u16le(20), 4);   // version made by
  entry.set(u16le(20), 6);   // version needed
  entry.set(u16le(0),  8);   // flags
  entry.set(u16le(0),  10);  // compression: stored
  entry.set(u16le(0),  12);  // mod time
  entry.set(u16le(0),  14);  // mod date
  entry.set(u32le(crc), 16);
  entry.set(u32le(size), 20);
  entry.set(u32le(size), 24);
  entry.set(u16le(name.length), 28);
  entry.set(u16le(0),  30);  // extra field length
  entry.set(u16le(0),  32);  // file comment length
  entry.set(u16le(0),  34);  // disk number start
  entry.set(u16le(0),  36);  // int file attrs
  entry.set(u32le(0),  38);  // ext file attrs
  entry.set(u32le(offset), 42);
  entry.set(name, 46);
  return entry;
}

function endOfCentralDir(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const rec = new Uint8Array(22);
  rec.set([0x50, 0x4b, 0x05, 0x06], 0);
  rec.set(u16le(0), 4);             // disk number
  rec.set(u16le(0), 6);             // disk with start of CD
  rec.set(u16le(count), 8);         // entries on this disk
  rec.set(u16le(count), 10);        // total entries
  rec.set(u32le(cdSize), 12);       // CD size
  rec.set(u32le(cdOffset), 16);     // CD offset
  rec.set(u16le(0), 20);            // comment length
  return rec;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Cost calculators ──────────────────────────────────────────────────────────
function calcLoraCost(mode: Mode, numFrames: number): { video: string; total: string; details: string } {
  const videoBase  = mode === "pro" ? 0.42 : 0.14;
  const geminiQC   = 0.001 * numFrames;
  const storage    = 0.002;
  const total      = videoBase + geminiQC + storage;
  return {
    video:   `$${videoBase.toFixed(2)}`,
    total:   `$${total.toFixed(3)}`,
    details: `Kling ${mode === "pro" ? "Pro" : "Std"} $${videoBase.toFixed(2)} + Gemini QC $${geminiQC.toFixed(3)} ≈ $${total.toFixed(3)} total`,
  };
}

function calcAugCost(mode: Mode, numAugments: number): { per_video: string; total: string; details: string } {
  const perVideo = mode === "pro" ? 0.42 : 0.14;
  const total    = perVideo * numAugments;
  return {
    per_video: `$${perVideo.toFixed(2)}`,
    total:     `$${total.toFixed(2)}`,
    details:   `${numAugments} × Kling ${mode === "pro" ? "Pro" : "Std"} $${perVideo.toFixed(2)} = $${total.toFixed(2)}`,
  };
}

// Extract 1 frame dari video base64 pada posisi tertentu
async function extractSingleFrame(
  videoB64: string,
  mime: string,
  pick: FramePick,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const video  = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx    = canvas.getContext("2d")!;
    const SIZE   = 1024;
    canvas.width = SIZE; canvas.height = SIZE;

    const bytes = atob(videoB64);
    const arr   = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: mime });
    const url  = URL.createObjectURL(blob);

    video.preload = "auto"; video.muted = true; video.src = url;

    video.addEventListener("loadedmetadata", () => {
      const dur = video.duration;
      const t   = pick === "first" ? dur * 0.05
                : pick === "last"  ? dur * 0.92
                : dur * 0.50;      // mid
      video.currentTime = t;
    });

    video.addEventListener("seeked", () => {
      const vw = video.videoWidth, vh = video.videoHeight;
      const sz = Math.min(vw, vh);
      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(video, (vw - sz) / 2, (vh - sz) / 2, sz, sz, 0, 0, SIZE, SIZE);
      const dataUrl = canvas.toDataURL("image/png");
      URL.revokeObjectURL(url);
      resolve(dataUrl);
    });

    video.addEventListener("error", () => { URL.revokeObjectURL(url); reject(new Error("Video error")); });
    video.load();
  });
}

// ── Main Component ───────────────────────────────────────────────────────────
export default function VideoPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabMode>("i2v");

  // I2V state
  const [sourceFile, setSourceFile]     = useState<File | null>(null);
  const [prompt, setPrompt]             = useState("");
  const [negativePrompt, setNegPrompt]  = useState("blurry, distorted, watermark, text overlay, ugly");
  const [duration, setDuration]         = useState<Duration>(5);
  const [aspectRatio, setAspectRatio]   = useState<AspectRatio>("9:16");
  const [mode, setMode]                 = useState<Mode>("std");
  const [cfgScale, setCfgScale]         = useState(0.5);
  const [status, setStatus]             = useState<VideoStatus>("idle");
  const [message, setMessage]           = useState("");
  const [videoUrl, setVideoUrl]         = useState<string | null>(null);
  const [elapsed, setElapsed]           = useState<number | null>(null);

  // LoRA 360° state
  const [loraSourceFile, setLoraSourceFile] = useState<File | null>(null);
  const [loraMode, setLoraMode]             = useState<Mode>("std");
  const [loraNumFrames, setLoraNumFrames]   = useState(32);
  const [loraStatus, setLoraStatus]         = useState<LoraStatus>("idle");
  const [loraMessage, setLoraMessage]       = useState("");
  const [loraFrames, setLoraFrames]         = useState<string[]>([]);
  const [loraVideoUrl, setLoraVideoUrl]     = useState<string | null>(null);
  const [loraElapsed, setLoraElapsed]       = useState<number | null>(null);
  const [loraProgress, setLoraProgress]     = useState(0);

  const loraCost = calcLoraCost(loraMode, loraNumFrames);

  // Consistent Augmentation state
  const [augSourceFile, setAugSourceFile]   = useState<File | null>(null);
  const [augProductName, setAugProductName] = useState("");
  const [augMode, setAugMode]               = useState<Mode>("std");
  const [augNumAugments, setAugNumAugments] = useState(9);
  const [augFramePick, setAugFramePick]     = useState<FramePick>("mid");
  const [augStatus, setAugStatus]           = useState<AugStatus>("idle");
  const [augMessage, setAugMessage]         = useState("");
  const [augFrames, setAugFrames]           = useState<AugFrame[]>([]);
  const [augProgress, setAugProgress]       = useState<{ done: number; total: number; phase: string }>({ done: 0, total: 0, phase: "" });
  const [augElapsed, setAugElapsed]         = useState<number | null>(null);
  const [augOriginalImg, setAugOriginalImg] = useState<string | null>(null);
  const [augPreview, setAugPreview]         = useState<string | null>(null);
  const augAbortRef = useRef<boolean>(false);

  const augCost = calcAugCost(augMode, augNumAugments);

  // ── Navigate to training page with frames ─────────────────────────────────
  const goToTraining = (
    frames: string[],
    productName: string,
    captions: string[],
    source: "lora360" | "augment",
  ) => {
    sessionStorage.setItem("loraTrainingData", JSON.stringify({
      frames,
      productName,
      captions,
      source,
      frameCount: frames.length,
      timestamp: Date.now(),
    }));
    router.push("/training?from=video");
  };

  const fileToB64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });

  // ── I2V generate ──────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!sourceFile) { setMessage("⚠ Please upload a source image"); return; }
    setStatus("generating"); setMessage("Submitting to Kling AI..."); setVideoUrl(null); setElapsed(null);
    const t0 = Date.now();
    try {
      const imageB64 = await fileToB64(sourceFile);
      const res = await fetch("/api/kling/image-to-video", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: imageB64, prompt: prompt.trim() || undefined,
          negative_prompt: negativePrompt.trim() || undefined, duration, aspect_ratio: aspectRatio, mode, cfg_scale: cfgScale }),
      });
      const data = await res.json() as { task_id?: string; status?: string; video_url?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.status === "succeed" && data.video_url) {
        setStatus("done"); setVideoUrl(data.video_url);
        setElapsed(Math.round((Date.now() - t0) / 1000));
        setMessage(`✓ Video ready · ${duration}s · ${aspectRatio}`);
        return;
      }
      if (data.task_id) { setMessage(`Processing… (${data.task_id.slice(0,8)}...)`); await pollVideo(data.task_id, t0); }
    } catch (err) { setStatus("error"); setMessage(`Error: ${err instanceof Error ? err.message : "Unknown"}`); }
  };

  const pollVideo = async (tid: string, t0: number, attempt = 0): Promise<void> => {
    if (attempt >= 60) { setStatus("error"); setMessage("Timeout. Task: " + tid); return; }
    await new Promise((r) => setTimeout(r, 3000));
    setMessage(`Processing… ${Math.round((Date.now() - t0) / 1000)}s`);
    try {
      const data = await fetch(`/api/kling/video-status?task_id=${tid}`).then((r) => r.json()) as
        { status: string; video_url?: string; error?: string };
      if (data.status === "succeed" && data.video_url) {
        setStatus("done"); setVideoUrl(data.video_url);
        setElapsed(Math.round((Date.now() - t0) / 1000));
        setMessage(`✓ Video ready · ${duration}s · ${aspectRatio}`);
        return;
      }
      if (data.status === "failed") { setStatus("error"); setMessage(`Failed: ${data.error ?? "unknown"}`); return; }
      return pollVideo(tid, t0, attempt + 1);
    } catch { return pollVideo(tid, t0, attempt + 1); }
  };

  // ── 360° LoRA pack ────────────────────────────────────────────────────────
  const handleLoraPack = async () => {
    if (!loraSourceFile) { setLoraMessage("⚠ Upload product image first"); return; }
    setLoraStatus("generating_video"); setLoraFrames([]); setLoraVideoUrl(null);
    setLoraElapsed(null); setLoraProgress(0);
    setLoraMessage("Generating 360° spin video with Kling AI (~60s)...");
    const t0 = Date.now();

    try {
      const imageB64 = await fileToB64(loraSourceFile);
      const res  = await fetch("/api/kling/extract-frames", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_b64: imageB64, num_frames: loraNumFrames, duration: 5, aspect_ratio: "1:1", mode: loraMode }),
      });
      const data = await res.json() as {
        task_id?: string; status?: string; video_url?: string;
        video_b64?: string; video_mime?: string; error?: string;
      };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      if (data.status === "processing") {
        setLoraStatus("error"); setLoraMessage("Video still processing — try again in a minute"); return;
      }
      setLoraVideoUrl(data.video_url ?? null);
      if (!data.video_b64) { setLoraStatus("error"); setLoraMessage("No video data returned"); return; }

      // Extract frames client-side
      setLoraStatus("extracting");
      setLoraMessage(`Extracting ${loraNumFrames} frames from video...`);
      const frames = await extractFramesFromVideoB64(
        data.video_b64, data.video_mime ?? "video/mp4", loraNumFrames,
        (n, total) => { setLoraProgress(Math.round((n / total) * 100)); setLoraMessage(`Extracting frames: ${n}/${total}`); },
      );

      setLoraFrames(frames);
      setLoraStatus("done");
      setLoraElapsed(Math.round((Date.now() - t0) / 1000));
      setLoraMessage(`✓ ${frames.length} frames ready · Download as ZIP below`);
      setLoraProgress(100);

    } catch (err) {
      setLoraStatus("error");
      setLoraMessage(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  // ── Consistent Augmentation handler ──────────────────────────────────────
  const handleAugment = async () => {
    if (!augSourceFile) { setAugMessage("⚠ Upload product image first"); return; }
    augAbortRef.current = false;
    setAugStatus("running");
    setAugFrames([]);
    setAugOriginalImg(null);
    setAugMessage("Starting consistent augmentation...");
    setAugProgress({ done: 0, total: augNumAugments, phase: "submitting" });
    const t0 = Date.now();

    try {
      // Read original image
      const origDataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result as string);
        r.onerror = () => rej(new Error("Read failed"));
        r.readAsDataURL(augSourceFile);
      });
      setAugOriginalImg(origDataUrl);

      const imageB64 = origDataUrl; // include data: prefix

      const res = await fetch("/api/kling/augment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_b64:    imageB64,
          product_name: augProductName.trim() || "product",
          mode:         augMode,
          num_augments: augNumAugments,
          frame_pick:   augFramePick,
        }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";

      while (true) {
        if (augAbortRef.current) break;
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line) as AugStreamEvent;

            if (ev.event === "progress" || ev.event === "submitted" || ev.event === "polling" || ev.event === "downloading") {
              setAugProgress({ done: ev.done ?? 0, total: ev.total ?? augNumAugments, phase: ev.phase ?? ev.event });
              setAugMessage(ev.message ?? `${ev.event}...`);
            }

            if (ev.event === "frame" && ev.video_b64 && ev.index !== undefined) {
              // Extract single frame from video client-side
              setAugMessage(`Extracting frame ${ev.index + 1}...`);
              try {
                const frameDataUrl = await extractSingleFrame(
                  ev.video_b64,
                  ev.video_mime ?? "video/mp4",
                  (ev.frame_pick as FramePick) ?? "mid",
                );
                const augFrame: AugFrame = {
                  index:          ev.index,
                  image:          frameDataUrl,
                  caption:        ev.caption ?? "",
                  caption_suffix: ev.caption_suffix ?? "",
                  prompt_used:    ev.prompt_used ?? "",
                  video_url:      ev.video_url,
                };
                setAugFrames((prev) => [...prev, augFrame].sort((a, b) => a.index - b.index));
                setAugProgress((p) => ({ ...p, done: p.done + 1 }));
              } catch {
                setAugMessage(`Frame ${ev.index + 1} extraction failed, skipping...`);
              }
            }

            if (ev.event === "frame_error") {
              setAugMessage(`Error on augment ${(ev.index ?? 0) + 1}: ${ev.message}`);
            }

            if (ev.event === "done") {
              setAugStatus("done");
              setAugElapsed(Math.round((Date.now() - t0) / 1000));
              setAugMessage(`✓ ${ev.total_frames} augmentations + 1 original = ${(ev.total_frames ?? 0) + 1} total images`);
            }

            if (ev.event === "error") {
              throw new Error(ev.message ?? "Unknown error");
            }
          } catch (parseErr) {
            // Skip malformed JSON lines
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      if (augStatus !== "done") {
        setAugStatus("done");
        setAugElapsed(Math.round((Date.now() - t0) / 1000));
      }

    } catch (err) {
      setAugStatus("error");
      setAugMessage(`Error: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  };

  // ── Download augmentation ZIP ──────────────────────────────────────────────
  const downloadAugZip = async () => {
    const allImages: { name: string; dataUrl: string }[] = [];

    // Include original image
    if (augOriginalImg) {
      allImages.push({ name: "000_original.png", dataUrl: augOriginalImg });
    }

    // Include all synthetic frames
    augFrames.forEach((f) => {
      allImages.push({
        name:    `${String(f.index + 1).padStart(3, "0")}_${f.caption_suffix.replace(/\s+/g, "_").replace(/[^a-z0-9_]/gi, "")}.png`,
        dataUrl: f.image,
      });
    });

    // Build captions file
    const captionLines: string[] = [];
    if (augOriginalImg) captionLines.push(`000_original.png|${augProductName || "product"}, original photo, white background, studio lighting`);
    augFrames.forEach((f) => {
      const fname = `${String(f.index + 1).padStart(3, "0")}_${f.caption_suffix.replace(/\s+/g, "_").replace(/[^a-z0-9_]/gi, "")}.png`;
      captionLines.push(`${fname}|${f.caption}`);
    });

    // Add captions.txt (as plain text, not PNG)
    const captionText = captionLines.join("\n");
    const captionBytes = new TextEncoder().encode(captionText);
    const captionDataUrl = `data:text/plain;base64,${btoa(captionText)}`;
    void captionBytes;
    allImages.push({ name: "captions.txt", dataUrl: captionDataUrl });

    const zipBytes = buildZip(allImages);
    const blob     = new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/zip" });
    const url      = URL.createObjectURL(blob);
    const a        = document.createElement("a");
    a.href         = url;
    a.download     = `lora_augmented_${augNumAugments + 1}images.zip`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // ── Download all frames as single ZIP ─────────────────────────────────────
  const downloadLoraZip = async () => {
    if (loraFrames.length === 0) return;
    setLoraStatus("zipping");
    setLoraMessage(`Building ZIP (${loraFrames.length} PNG files)...`);

    try {
      const files = loraFrames.map((dataUrl, idx) => ({
        name:    `lora_360_${String(idx + 1).padStart(3, "0")}.png`,
        dataUrl,
      }));

      const zipBytes = buildZip(files);
      const blob     = new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/zip" });
      const url      = URL.createObjectURL(blob);
      const a        = document.createElement("a");
      a.href     = url;
      a.download = `lora_dataset_360deg_${loraNumFrames}frames.zip`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setLoraStatus("done");
      setLoraMessage(`✓ ${loraFrames.length} frames ready · ZIP downloaded`);
    } catch (err) {
      setLoraStatus("done");   // non-fatal — still show frames
      setLoraMessage(`ZIP build failed: ${err instanceof Error ? err.message : "unknown"} — try downloading individually`);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-title-md font-bold text-black dark:text-white flex items-center gap-2">
          <Clapperboard size={22} className="text-primary" />
          Image to Video
        </h1>
        <p className="text-sm text-body mt-1">Kling AI v1.5 · Animate images + 360° LoRA dataset generator</p>
      </div>

      {/* Tabs */}
      <div className="flex rounded border border-stroke dark:border-strokedark overflow-hidden w-fit">
        {([
          { v: "i2v",     icon: <Video size={14} />,       label: "Image to Video" },
          { v: "lora360", icon: <RotateCcw size={14} />,   label: "360° LoRA Pack" },
          { v: "augment", icon: <Sparkles size={14} />,    label: "Consistent Augment" },
        ] as { v: TabMode; icon: React.ReactNode; label: string }[]).map((t) => (
          <button key={t.v} onClick={() => setTab(t.v)}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium transition-colors
              ${tab === t.v ? "bg-primary text-white" : "bg-white dark:bg-boxdark text-body hover:bg-gray dark:hover:bg-meta-4"}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════ TAB: IMAGE TO VIDEO ══════════════════════ */}
      {tab === "i2v" && (
        <>
          {status !== "idle" && (
            <div className={`rounded border overflow-hidden
              ${status === "generating" ? "border-warning/30 bg-warning/5" : ""}
              ${status === "done" ? "border-success/30 bg-success/5" : ""}
              ${status === "error" ? "border-danger/30 bg-danger/5" : ""}`}>
              <div className="flex items-center gap-3 px-4 py-3">
                {status === "generating" && <Loader2 size={18} className="text-warning animate-spin flex-shrink-0" />}
                {status === "done"       && <CheckCircle size={18} className="text-success flex-shrink-0" />}
                {status === "error"      && <AlertCircle size={18} className="text-danger flex-shrink-0" />}
                <span className={`text-sm font-medium flex-1 ${status === "generating" ? "text-warning" : status === "done" ? "text-success" : "text-danger"}`}>{message}</span>
                {elapsed && <span className="text-xs text-body flex items-center gap-1"><Clock size={11} />{elapsed}s</span>}
              </div>
              {status === "generating" && <div className="h-1 bg-warning animate-pulse" />}
              {status === "done"       && <div className="h-1 bg-success" />}
            </div>
          )}

          {status === "done" && videoUrl && (
            <div className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-black dark:text-white text-sm flex items-center gap-2">
                  <CheckCircle size={16} className="text-success" /> Video Generated
                </h2>
                <a href={videoUrl} download={`kling_${Date.now()}.mp4`} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 rounded border border-stroke px-3 py-1.5 text-xs font-medium text-body hover:border-primary hover:text-primary transition-colors">
                  <Download size={12} /> Download MP4
                </a>
              </div>
              <div className="flex justify-center bg-black rounded overflow-hidden">
                <video src={videoUrl} controls autoPlay loop playsInline className="max-h-[70vh] max-w-full"
                  style={{ aspectRatio: aspectRatio === "9:16" ? "9/16" : aspectRatio === "16:9" ? "16/9" : "1/1", maxWidth: aspectRatio === "9:16" ? "360px" : "100%" }} />
              </div>
              <button onClick={() => { setStatus("idle"); setVideoUrl(null); setMessage(""); }}
                className="w-full rounded border border-stroke py-2.5 text-sm font-medium text-body hover:border-primary hover:text-primary transition-colors">
                New Video
              </button>
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-3">
            <div className="xl:col-span-2 space-y-4">
              <div className="card px-5 py-4">
                <p className="text-sm font-semibold text-black dark:text-white mb-1">Source Image</p>
                <p className="text-xs text-body mb-3">Upload any image — Kling animates it with natural motion.</p>
                <ImageUpload label="Source Image" hint="JPG / PNG · Best: clear subject, sharp image" value={sourceFile} onChange={setSourceFile} />
              </div>
              <div className="card px-5 py-4 space-y-3">
                <p className="text-sm font-semibold text-black dark:text-white">Motion Prompt</p>
                <div>
                  <label className="form-label">Motion Description <span className="text-body font-normal">(optional)</span></label>
                  <textarea className="form-input resize-none" rows={3}
                    placeholder='"slow zoom in, gentle wind" or leave empty for auto-motion'
                    value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                </div>
                <div>
                  <label className="form-label">Negative Prompt</label>
                  <input className="form-input" value={negativePrompt} onChange={(e) => setNegPrompt(e.target.value)} />
                </div>
              </div>
              <div className="card px-5 py-4 space-y-4">
                <p className="text-sm font-semibold text-black dark:text-white">Settings</p>
                <div>
                  <label className="form-label">Mode</label>
                  <div className="grid grid-cols-2 gap-3">
                    {MODES.map((m) => (
                      <button key={m.value} onClick={() => setMode(m.value)}
                        className={`flex flex-col items-center gap-1 rounded border-2 py-3 text-center transition-all
                          ${mode === m.value ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}>
                        <span className={`text-sm font-bold ${mode === m.value ? "text-primary" : "text-black dark:text-white"}`}>{m.label}</span>
                        <span className="text-[9px] text-body">{m.desc}</span>
                        <span className={`text-[9px] font-medium ${mode === m.value ? "text-primary" : "text-body"}`}>{m.cost}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="form-label">Duration</label>
                  <div className="grid grid-cols-2 gap-3">
                    {([5, 10] as Duration[]).map((d) => (
                      <button key={d} onClick={() => setDuration(d)}
                        className={`flex flex-col items-center gap-1 rounded border-2 py-3 text-center transition-all
                          ${duration === d ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}>
                        <span className={`text-xl font-bold ${duration === d ? "text-primary" : "text-black dark:text-white"}`}>{d}s</span>
                        <span className="text-[9px] text-body">{d === 5 ? "Short · cheaper" : "Long · 2× cost"}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="form-label">Aspect Ratio</label>
                  <div className="grid grid-cols-3 gap-2">
                    {ASPECT_RATIOS.map((ar) => (
                      <button key={ar.value} onClick={() => setAspectRatio(ar.value)}
                        className={`flex flex-col items-center gap-1 rounded border-2 py-3 text-center transition-all
                          ${aspectRatio === ar.value ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}>
                        <span className={`text-sm font-bold ${aspectRatio === ar.value ? "text-primary" : "text-black dark:text-white"}`}>{ar.label}</span>
                        <span className="text-[9px] text-body">{ar.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="form-label flex items-center justify-between">
                    <span>CFG Scale</span>
                    <span className="font-mono text-primary">{cfgScale.toFixed(1)}</span>
                  </label>
                  <input type="range" min={0} max={1} step={0.1} value={cfgScale}
                    onChange={(e) => setCfgScale(Number(e.target.value))} className="w-full accent-primary" />
                  <div className="flex justify-between text-[9px] text-body mt-1">
                    <span>0 · Max creativity</span><span>0.5 · Balanced</span><span>1 · Strict prompt</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="card p-5 space-y-3">
                <h3 className="font-semibold text-black dark:text-white text-sm">Summary</h3>
                <div className="rounded bg-primary/5 border border-primary/20 px-4 py-3 flex items-center gap-4">
                  <div className="text-center flex-shrink-0">
                    <div className="text-4xl font-bold text-primary leading-none">{duration}s</div>
                    <div className="text-[10px] text-primary/70 mt-0.5">video</div>
                  </div>
                  <div className="text-body text-sm">·</div>
                  <div className="text-xs text-body border-l border-stroke dark:border-strokedark pl-4">
                    <p className="font-semibold text-black dark:text-white">{aspectRatio} · {mode === "pro" ? "Pro" : "Standard"}</p>
                    <p className="text-[10px] mt-0.5">Kling AI v1.5 · MP4</p>
                  </div>
                </div>
                <div className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 ${sourceFile ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                  <Upload size={11} />
                  {sourceFile ? `✓ ${sourceFile.name} (${(sourceFile.size / 1024).toFixed(0)}KB)` : "No image selected"}
                </div>
                <button onClick={handleGenerate} disabled={status === "generating" || !sourceFile}
                  className="btn-primary w-full mt-2 py-3 disabled:opacity-50 disabled:cursor-not-allowed">
                  {status === "generating" ? <><Loader2 size={16} className="animate-spin" />Generating...</> : <><Play size={16} />Generate Video</>}
                </button>
              </div>
              <div className="card px-4 py-3">
                <p className="text-xs font-semibold text-black dark:text-white mb-2">Prompt Examples</p>
                <div className="space-y-1.5">
                  {["slow zoom in, soft product rotation","gentle parallax, depth of field","floating upward, ethereal atmosphere","product spinning 360 degrees","cinematic push-in, dramatic reveal"].map((ex) => (
                    <button key={ex} onClick={() => setPrompt(ex)}
                      className="block w-full text-left text-xs text-body hover:text-primary px-2 py-1.5 rounded hover:bg-primary/5 transition-colors border border-transparent hover:border-primary/20">
                      &ldquo;{ex}&rdquo;
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════ TAB: CONSISTENT AUGMENT ══════════════════════ */}
      {tab === "augment" && (
        <>
          {/* Explanation */}
          <div className="rounded border border-primary/20 bg-primary/5 px-5 py-4">
            <div className="flex items-start gap-3">
              <Sparkles size={20} className="text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-black dark:text-white">Consistent Augmentation</p>
                <p className="text-xs text-body mt-1 leading-relaxed">
                  Upload <strong>1 foto produk</strong> → generate <strong>N video pendek</strong> dengan motion berbeda via Kling →
                  ambil 1 frame terbaik dari setiap video. Hasilnya: <strong>1 original + N synthetic</strong> yang konsisten
                  identity/style. ZIP sudah include <code className="bg-white dark:bg-boxdark px-1 rounded">captions.txt</code> untuk LoRA training.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {[
                    ["Input", "1 foto real"],
                    ["Output", `${augNumAugments + 1} images`],
                    ["Konsistensi", "Tinggi"],
                    ["Caption", "Auto-generated"],
                    ["Format", "ZIP + TXT"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded bg-white dark:bg-boxdark border border-stroke dark:border-strokedark px-3 py-1.5 text-center">
                      <p className="text-[9px] text-body uppercase tracking-wide">{label}</p>
                      <p className="text-xs font-bold text-black dark:text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Status bar */}
          {augStatus !== "idle" && (
            <div className={`rounded border overflow-hidden
              ${augStatus === "running" ? "border-warning/30 bg-warning/5" : ""}
              ${augStatus === "done"    ? "border-success/30 bg-success/5" : ""}
              ${augStatus === "error"   ? "border-danger/30 bg-danger/5"   : ""}`}>
              <div className="flex items-center gap-3 px-4 py-3">
                {augStatus === "running" && <Loader2 size={18} className="text-warning animate-spin flex-shrink-0" />}
                {augStatus === "done"    && <CheckCircle size={18} className="text-success flex-shrink-0" />}
                {augStatus === "error"   && <AlertCircle size={18} className="text-danger flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <span className={`text-sm font-medium block truncate
                    ${augStatus === "done" ? "text-success" : augStatus === "error" ? "text-danger" : "text-warning"}`}>
                    {augMessage}
                  </span>
                  {augStatus === "running" && augProgress.total > 0 && (
                    <span className="text-[10px] text-body">{augProgress.done}/{augProgress.total} complete · phase: {augProgress.phase}</span>
                  )}
                </div>
                {augElapsed && <span className="text-xs text-body flex items-center gap-1 flex-shrink-0"><Clock size={11} />{augElapsed}s</span>}
              </div>
              {augStatus === "running" && (
                <div className="h-1 bg-warning/10">
                  <div className="h-full bg-warning transition-all duration-500"
                    style={{ width: augProgress.total > 0 ? `${(augProgress.done / augProgress.total) * 100}%` : "10%" }} />
                </div>
              )}
              {augStatus === "done" && <div className="h-1 bg-success" />}
            </div>
          )}

          {/* Results grid */}
          {(augOriginalImg || augFrames.length > 0) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-base font-semibold text-black dark:text-white flex items-center gap-2">
                  <CheckCircle size={17} className="text-success" />
                  {(augOriginalImg ? 1 : 0) + augFrames.length} Images Ready
                </h2>
                {augStatus === "done" && (
                  <button onClick={downloadAugZip}
                    className="flex items-center gap-1.5 btn-primary px-4 py-2 text-xs">
                    <Archive size={12} /> Download ZIP ({(augOriginalImg ? 1 : 0) + augFrames.length} PNG + captions.txt)
                  </button>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                {/* Original image */}
                {augOriginalImg && (
                  <div className="relative rounded overflow-hidden border-2 border-primary bg-gray dark:bg-meta-4 group cursor-pointer"
                    onClick={() => setAugPreview(augOriginalImg)}
                    title="Original photo (real)">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={augOriginalImg} alt="Original" className="w-full object-cover" style={{ aspectRatio: "1/1" }} />
                    <div className="absolute top-1 left-1 rounded bg-primary px-1.5 py-0.5">
                      <span className="text-[8px] font-bold text-white">ORIGINAL</span>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 py-0.5 text-center">
                      <span className="text-[7px] text-white/80">real photo</span>
                    </div>
                  </div>
                )}

                {/* Synthetic frames */}
                {augFrames.map((f) => (
                  <div key={f.index}
                    className="relative rounded overflow-hidden border border-stroke dark:border-strokedark bg-gray dark:bg-meta-4 group cursor-pointer"
                    onClick={() => setAugPreview(f.image)}
                    title={`Augment ${f.index + 1}: ${f.caption_suffix}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.image} alt={`Augment ${f.index + 1}`} className="w-full object-cover" style={{ aspectRatio: "1/1" }} loading="lazy" />
                    <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-black/60 flex items-center justify-center">
                      <span className="text-[7px] font-bold text-white">{f.index + 1}</span>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 py-0.5 text-center">
                      <span className="text-[7px] text-white/80">{f.caption_suffix}</span>
                    </div>
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all" />
                  </div>
                ))}

                {/* Placeholder untuk yang belum selesai */}
                {augStatus === "running" && Array.from({ length: Math.max(0, augNumAugments - augFrames.length) }).map((_, i) => (
                  <div key={`ph-${i}`} className="relative rounded border border-dashed border-stroke dark:border-strokedark bg-gray/50 dark:bg-meta-4/50 flex items-center justify-center"
                    style={{ aspectRatio: "1/1" }}>
                    <Loader2 size={16} className="text-body animate-spin" />
                  </div>
                ))}
              </div>

              {/* Caption preview */}
              {augFrames.length > 0 && (
                <div className="rounded border border-stroke dark:border-strokedark p-3 space-y-1">
                  <p className="text-[10px] font-semibold text-black dark:text-white uppercase tracking-wide flex items-center gap-1.5">
                    <ImageIcon size={10} /> Auto-generated Captions (included in ZIP)
                  </p>
                  <div className="space-y-0.5 max-h-32 overflow-y-auto">
                    {augOriginalImg && (
                      <p className="text-[9px] font-mono text-body"><span className="text-primary">000_original.png</span> | {augProductName || "product"}, original photo, white background, studio lighting</p>
                    )}
                    {augFrames.map((f) => (
                      <p key={f.index} className="text-[9px] font-mono text-body">
                        <span className="text-primary">{String(f.index + 1).padStart(3, "0")}_{f.caption_suffix.replace(/\s+/g, "_").substring(0, 20)}.png</span> | {f.caption}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Preview modal */}
          {augPreview && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
              onClick={() => setAugPreview(null)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={augPreview} alt="Preview" className="max-h-[90vh] max-w-[90vw] rounded object-contain" onClick={(e) => e.stopPropagation()} />
              <button onClick={() => setAugPreview(null)} className="absolute top-4 right-4 rounded-full bg-white/20 p-2 hover:bg-white/40">
                <X size={18} className="text-white" />
              </button>
            </div>
          )}

          {/* Form */}
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="xl:col-span-2 space-y-4">
              <div className="card px-5 py-4">
                <p className="text-sm font-semibold text-black dark:text-white mb-1">Product Image</p>
                <p className="text-xs text-body mb-3">Upload 1 foto produk. Ini akan jadi "anchor" — semua synthetic image akan konsisten dengan foto ini.</p>
                <ImageUpload label="Source Photo" hint="JPG / PNG · White background = hasil terbaik" value={augSourceFile} onChange={setAugSourceFile} />
              </div>

              <div className="card px-5 py-4 space-y-4">
                <p className="text-sm font-semibold text-black dark:text-white">Augmentation Settings</p>

                <div>
                  <label className="form-label">Nama Produk <span className="text-body font-normal">(untuk caption)</span></label>
                  <input className="form-input" placeholder="e.g. Serum Vitamin C, Nike Air Max 90, ..."
                    value={augProductName} onChange={(e) => setAugProductName(e.target.value)} />
                  <p className="text-[10px] text-body mt-1">Digunakan untuk auto-generate caption di setiap gambar</p>
                </div>

                <div>
                  <label className="form-label flex items-center justify-between">
                    <span>Jumlah Augmentasi</span>
                    <span className="font-mono text-primary">{augNumAugments} video → {augNumAugments} synthetic</span>
                  </label>
                  <input type="range" min={1} max={9} step={1} value={augNumAugments}
                    onChange={(e) => setAugNumAugments(Number(e.target.value))} className="w-full accent-primary" />
                  <div className="flex justify-between text-[9px] text-body mt-1">
                    <span>1 · Min</span><span>5 · Balanced</span><span>9 · Max dataset</span>
                  </div>
                  <p className="text-[10px] text-body mt-1">Total dataset: 1 original + {augNumAugments} synthetic = <strong>{augNumAugments + 1} images</strong></p>
                </div>

                <div>
                  <label className="form-label">Frame Selection</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { v: "first", label: "First",  desc: "Awal video (5%)" },
                      { v: "mid",   label: "Middle", desc: "Tengah video (50%)" },
                      { v: "last",  label: "Last",   desc: "Akhir video (92%)" },
                    ] as { v: FramePick; label: string; desc: string }[]).map((fp) => (
                      <button key={fp.v} onClick={() => setAugFramePick(fp.v)}
                        className={`flex flex-col items-center gap-1 rounded border-2 py-2.5 text-center transition-all
                          ${augFramePick === fp.v ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}>
                        <span className={`text-sm font-bold ${augFramePick === fp.v ? "text-primary" : "text-black dark:text-white"}`}>{fp.label}</span>
                        <span className="text-[9px] text-body">{fp.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="form-label">Kling Mode</label>
                  <div className="grid grid-cols-2 gap-3">
                    {MODES.map((m) => (
                      <button key={m.value} onClick={() => setAugMode(m.value)}
                        className={`flex flex-col items-center gap-1 rounded border-2 py-3 text-center transition-all
                          ${augMode === m.value ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}>
                        <span className={`text-sm font-bold ${augMode === m.value ? "text-primary" : "text-black dark:text-white"}`}>{m.label}</span>
                        <span className="text-[9px] text-body">{m.desc}</span>
                        <span className={`text-[9px] font-medium ${augMode === m.value ? "text-primary" : "text-body"}`}>{m.cost}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="card p-5 space-y-3">
                <h3 className="font-semibold text-black dark:text-white text-sm">Augment Summary</h3>
                <div className="rounded bg-primary/5 border border-primary/20 px-4 py-3 flex items-center gap-4">
                  <div className="text-center flex-shrink-0">
                    <div className="text-4xl font-bold text-primary leading-none">{augNumAugments + 1}</div>
                    <div className="text-[10px] text-primary/70 mt-0.5">images</div>
                  </div>
                  <div className="text-body text-sm">·</div>
                  <div className="text-xs text-body border-l border-stroke dark:border-strokedark pl-4">
                    <p className="font-semibold text-black dark:text-white">1 real + {augNumAugments} synthetic</p>
                    <p className="text-[10px] mt-0.5">1024×1024 · ZIP + captions</p>
                  </div>
                </div>

                {/* Cost breakdown */}
                <div className="rounded border border-stroke dark:border-strokedark p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-black dark:text-white uppercase tracking-wide">Cost Breakdown</p>
                  {[
                    { label: `${augNumAugments}× Kling video (5s)`, value: augCost.total },
                    { label: "Frame extraction",                     value: "Free (client)" },
                    { label: "Per video",                            value: augCost.per_video },
                    { label: "Total est. cost",                      value: augCost.total },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between text-xs">
                      <span className="text-body">{label}</span>
                      <span className={`font-medium ${label.startsWith("Total") ? "text-primary" : "text-black dark:text-white"}`}>{value}</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5 text-xs">
                  {[
                    { label: "Est. waktu",      value: `~${augNumAugments * 90}s (${Math.ceil(augNumAugments * 90 / 60)} min)` },
                    { label: "Output",          value: `ZIP (${augNumAugments + 1} PNG + captions.txt)` },
                    { label: "Frame pick",      value: augFramePick === "mid" ? "Middle (50%)" : augFramePick === "first" ? "First (5%)" : "Last (92%)" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-start justify-between gap-2">
                      <span className="text-body flex-shrink-0">{label}</span>
                      <span className="font-medium text-right text-black dark:text-white">{value}</span>
                    </div>
                  ))}
                </div>

                <div className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 ${augSourceFile ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                  <Upload size={11} />
                  {augSourceFile ? `✓ ${augSourceFile.name} (${(augSourceFile.size / 1024).toFixed(0)}KB)` : "No image selected"}
                </div>

                <button onClick={handleAugment}
                  disabled={augStatus === "running" || !augSourceFile}
                  className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed">
                  {augStatus === "running"
                    ? <><Loader2 size={16} className="animate-spin" />Augmenting... ({augProgress.done}/{augProgress.total})</>
                    : <><Sparkles size={16} />Generate {augNumAugments + 1} Consistent Images</>}
                </button>

                {augStatus === "done" && augFrames.length > 0 && (
                  <button onClick={downloadAugZip}
                    className="w-full flex items-center justify-center gap-2 rounded border border-primary py-2.5 text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors">
                    <Archive size={15} /> Download ZIP ({(augOriginalImg ? 1 : 0) + augFrames.length} images)
                  </button>
                )}

                {augStatus === "done" && augFrames.length > 0 && (
                  <button
                    onClick={() => {
                      const allFrames: string[] = [];
                      const allCaptions: string[] = [];
                      if (augOriginalImg) {
                        allFrames.push(augOriginalImg);
                        allCaptions.push(`${augProductName || "product"}, original photo, white background, studio lighting`);
                      }
                      augFrames.forEach((f) => {
                        allFrames.push(f.image);
                        allCaptions.push(f.caption);
                      });
                      goToTraining(allFrames, augProductName || "product", allCaptions, "augment");
                    }}
                    className="w-full flex items-center justify-center gap-2 rounded border border-success py-2.5 text-sm font-medium text-success hover:bg-success hover:text-white transition-colors"
                  >
                    <Zap size={15} /> Train LoRA dengan {(augOriginalImg ? 1 : 0) + augFrames.length} images →
                  </button>
                )}
              </div>

              <div className="rounded border border-primary/20 bg-primary/5 px-4 py-3 space-y-1.5">
                <p className="text-xs font-semibold text-primary flex items-center gap-1.5"><Zap size={12} /> Tips konsistensi</p>
                <ul className="text-xs text-body space-y-1 list-disc list-inside">
                  <li>White background = hasil paling konsisten</li>
                  <li>&quot;Mid&quot; frame biasanya paling stabil</li>
                  <li>Pro mode = identity produk lebih terjaga</li>
                  <li>5-9 augments = sweet spot untuk LoRA</li>
                  <li>Captions.txt auto-included di ZIP</li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════ TAB: 360° LORA PACK ══════════════════════ */}
      {tab === "lora360" && (
        <>
          {/* Explanation */}
          <div className="rounded border border-primary/20 bg-primary/5 px-5 py-4">
            <div className="flex items-start gap-3">
              <RotateCcw size={20} className="text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-black dark:text-white">360° LoRA Dataset Generator</p>
                <p className="text-xs text-body mt-1 leading-relaxed">
                  Generates a full 360° rotation video of your product via Kling AI, then extracts evenly-spaced
                  frames as a geometrically consistent LoRA training dataset. Download as a single <strong>ZIP file</strong>.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {[
                    ["Coverage", "Full 360°"],
                    ["Consistency", "Geometric"],
                    ["Frames", `${loraNumFrames} PNG`],
                    ["Resolution", "1024×1024"],
                    ["Angle/frame", `${(360/loraNumFrames).toFixed(1)}°`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded bg-white dark:bg-boxdark border border-stroke dark:border-strokedark px-3 py-1.5 text-center">
                      <p className="text-[9px] text-body uppercase tracking-wide">{label}</p>
                      <p className="text-xs font-bold text-black dark:text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Status bar */}
          {loraStatus !== "idle" && (
            <div className={`rounded border overflow-hidden
              ${loraStatus === "generating_video" || loraStatus === "extracting" || loraStatus === "zipping" ? "border-warning/30 bg-warning/5" : ""}
              ${loraStatus === "done"  ? "border-success/30 bg-success/5" : ""}
              ${loraStatus === "error" ? "border-danger/30 bg-danger/5"   : ""}`}>
              <div className="flex items-center gap-3 px-4 py-3">
                {(loraStatus === "generating_video" || loraStatus === "extracting" || loraStatus === "zipping") &&
                  <Loader2 size={18} className="text-warning animate-spin flex-shrink-0" />}
                {loraStatus === "done"  && <CheckCircle size={18} className="text-success flex-shrink-0" />}
                {loraStatus === "error" && <AlertCircle size={18} className="text-danger flex-shrink-0" />}
                <span className={`text-sm font-medium flex-1 ${loraStatus === "done" ? "text-success" : loraStatus === "error" ? "text-danger" : "text-warning"}`}>
                  {loraMessage}
                </span>
                {loraElapsed && <span className="text-xs text-body flex items-center gap-1"><Clock size={11} />{loraElapsed}s</span>}
                {loraStatus === "extracting" && <span className="text-xs font-mono text-warning">{loraProgress}%</span>}
              </div>
              {(loraStatus === "generating_video" || loraStatus === "extracting" || loraStatus === "zipping") && (
                <div className="h-1 bg-warning/10">
                  <div className="h-full bg-warning transition-all duration-300"
                    style={{ width: loraStatus === "generating_video" ? "35%" : loraStatus === "zipping" ? "90%" : `${loraProgress}%` }} />
                </div>
              )}
              {loraStatus === "done" && <div className="h-1 bg-success" />}
            </div>
          )}

          {/* Frames result */}
          {loraFrames.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-base font-semibold text-black dark:text-white flex items-center gap-2">
                  <CheckCircle size={17} className="text-success" />
                  {loraFrames.length} Frames Ready
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  {loraVideoUrl && (
                    <a href={loraVideoUrl} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 rounded border border-stroke px-3 py-1.5 text-xs font-medium text-body hover:border-primary hover:text-primary transition-colors">
                      <Video size={12} /> View Video
                    </a>
                  )}
                  <button onClick={downloadLoraZip} disabled={loraStatus === "zipping"}
                    className="flex items-center gap-1.5 btn-primary px-4 py-2 text-xs disabled:opacity-50">
                    {loraStatus === "zipping"
                      ? <><Loader2 size={12} className="animate-spin" />Building ZIP...</>
                      : <><Archive size={12} />Download ZIP ({loraFrames.length} PNG)</>}
                  </button>
                  {loraStatus === "done" && (
                    <button
                      onClick={() => goToTraining(
                        loraFrames,
                        loraSourceFile?.name?.replace(/\.[^.]+$/, "") ?? "product",
                        loraFrames.map((_, i) => `product, 360° rotation frame ${i + 1} of ${loraFrames.length}, white background, studio lighting`),
                        "lora360",
                      )}
                      className="flex items-center gap-1.5 rounded border border-success px-3 py-1.5 text-xs font-medium text-success hover:bg-success hover:text-white transition-colors"
                    >
                      <Zap size={12} /> Train LoRA →
                    </button>
                  )}
                </div>
              </div>

              {/* Preview grid */}
              <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-8">
                {loraFrames.map((frame, idx) => (
                  <div key={idx} className="relative rounded overflow-hidden border border-stroke dark:border-strokedark bg-gray dark:bg-meta-4 group"
                    title={`Frame ${idx+1} · ${(idx * 360 / loraFrames.length).toFixed(0)}°`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={frame} alt={`Frame ${idx+1}`} className="w-full object-cover" style={{ aspectRatio: "1/1" }} loading="lazy" />
                    <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-black/60 flex items-center justify-center">
                      <span className="text-[7px] font-bold text-white">{idx+1}</span>
                    </div>
                    {/* Rotation degree badge */}
                    <div className="absolute bottom-0 left-0 right-0 bg-black/50 py-0.5 text-center">
                      <span className="text-[7px] text-white/80">{(idx * 360 / loraFrames.length).toFixed(0)}°</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded border border-success/20 bg-success/5 px-4 py-3 text-xs text-body">
                <p className="font-semibold text-success mb-1">✓ LoRA Dataset Ready</p>
                <p>{loraFrames.length} frames × 1024×1024 PNG · Full 360° coverage · Every {(360/loraFrames.length).toFixed(1)}°</p>
                <p className="mt-1">💡 Combine with <a href="/multi-angle" className="text-primary underline">Multi-Angle</a> 16 shots for ~{loraFrames.length + 16} total training images</p>
              </div>
            </div>
          )}

          {/* Form */}
          <div className="grid gap-5 xl:grid-cols-3">
            <div className="xl:col-span-2 space-y-4">
              <div className="card px-5 py-4">
                <p className="text-sm font-semibold text-black dark:text-white mb-1">Product Image</p>
                <p className="text-xs text-body mb-3">Upload product photo. White/neutral background recommended. Kling will rotate it 360°.</p>
                <ImageUpload label="Product Photo" hint="JPG / PNG · Clean background = best results" value={loraSourceFile} onChange={setLoraSourceFile} />
              </div>
              <div className="card px-5 py-4 space-y-4">
                <p className="text-sm font-semibold text-black dark:text-white">360° Settings</p>
                <div>
                  <label className="form-label flex items-center justify-between">
                    <span>Frames to Extract</span>
                    <span className="font-mono text-primary">{loraNumFrames} frames</span>
                  </label>
                  <input type="range" min={8} max={60} step={4} value={loraNumFrames}
                    onChange={(e) => setLoraNumFrames(Number(e.target.value))} className="w-full accent-primary" />
                  <div className="flex justify-between text-[9px] text-body mt-1">
                    <span>8 · Min</span><span>32 · Optimal</span><span>60 · Max detail</span>
                  </div>
                  <p className="text-[10px] text-body mt-1">Every {(360/loraNumFrames).toFixed(1)}° · Recommended: 24-32 frames</p>
                </div>
                <div>
                  <label className="form-label">Kling Mode</label>
                  <div className="grid grid-cols-2 gap-3">
                    {MODES.map((m) => (
                      <button key={m.value} onClick={() => setLoraMode(m.value)}
                        className={`flex flex-col items-center gap-1 rounded border-2 py-3 text-center transition-all
                          ${loraMode === m.value ? "border-primary bg-primary/5" : "border-stroke dark:border-strokedark hover:border-primary/40"}`}>
                        <span className={`text-sm font-bold ${loraMode === m.value ? "text-primary" : "text-black dark:text-white"}`}>{m.label}</span>
                        <span className="text-[9px] text-body">{m.desc}</span>
                        <span className={`text-[9px] font-medium ${loraMode === m.value ? "text-primary" : "text-body"}`}>{m.cost}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="card p-5 space-y-3">
                <h3 className="font-semibold text-black dark:text-white text-sm">LoRA Pack Summary</h3>
                <div className="rounded bg-primary/5 border border-primary/20 px-4 py-3 flex items-center gap-4">
                  <div className="text-center flex-shrink-0">
                    <div className="text-4xl font-bold text-primary leading-none">{loraNumFrames}</div>
                    <div className="text-[10px] text-primary/70 mt-0.5">frames</div>
                  </div>
                  <div className="text-body text-sm">·</div>
                  <div className="text-xs text-body border-l border-stroke dark:border-strokedark pl-4">
                    <p className="font-semibold text-black dark:text-white">1024×1024 PNG</p>
                    <p className="text-[10px] mt-0.5">Full 360° · ZIP download</p>
                  </div>
                </div>

                {/* Cost breakdown */}
                <div className="rounded border border-stroke dark:border-strokedark p-3 space-y-1.5">
                  <p className="text-[10px] font-semibold text-black dark:text-white uppercase tracking-wide">Cost Breakdown</p>
                  {[
                    { label: "Kling video (5s)",  value: loraCost.video },
                    { label: `Frame extraction`,  value: "Free (client)" },
                    { label: "Storage",           value: "~$0.00" },
                    { label: "Total est. cost",   value: loraCost.video },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between text-xs">
                      <span className="text-body">{label}</span>
                      <span className={`font-medium ${label.startsWith("Total") ? "text-primary" : "text-black dark:text-white"}`}>{value}</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5 text-xs">
                  {[
                    { label: "Output format",    value: "Single ZIP file" },
                    { label: "Images",           value: `${loraNumFrames} × PNG 1024px` },
                    { label: "Angle coverage",   value: `Every ${(360/loraNumFrames).toFixed(1)}°` },
                    { label: "Est. time",        value: "~60-90 seconds" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-start justify-between gap-2">
                      <span className="text-body flex-shrink-0">{label}</span>
                      <span className="font-medium text-right text-black dark:text-white">{value}</span>
                    </div>
                  ))}
                </div>

                <div className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 ${loraSourceFile ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                  <Upload size={11} />
                  {loraSourceFile ? `✓ ${loraSourceFile.name} (${(loraSourceFile.size/1024).toFixed(0)}KB)` : "No image selected"}
                </div>

                <button onClick={handleLoraPack}
                  disabled={loraStatus === "generating_video" || loraStatus === "extracting" || loraStatus === "zipping" || !loraSourceFile}
                  className="btn-primary w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed">
                  {loraStatus === "generating_video" ? <><Loader2 size={16} className="animate-spin" />Generating 360° video...</>
                   : loraStatus === "extracting"     ? <><Loader2 size={16} className="animate-spin" />Extracting frames...</>
                   : loraStatus === "zipping"        ? <><Loader2 size={16} className="animate-spin" />Building ZIP...</>
                   : <><RotateCcw size={16} />Generate 360° LoRA Pack</>}
                </button>

                {loraFrames.length > 0 && (
                  <button onClick={downloadLoraZip} disabled={loraStatus === "zipping"}
                    className="w-full flex items-center justify-center gap-2 rounded border border-primary py-2.5 text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors disabled:opacity-50">
                    <Archive size={15} /> Download ZIP ({loraFrames.length} PNG)
                  </button>
                )}
              </div>

              <div className="rounded border border-primary/20 bg-primary/5 px-4 py-3 space-y-1.5">
                <p className="text-xs font-semibold text-primary flex items-center gap-1.5"><Zap size={12} /> LoRA tips</p>
                <ul className="text-xs text-body space-y-1 list-disc list-inside">
                  <li>24-32 frames = optimal dataset size</li>
                  <li>Combine with Multi-Angle 16 shots</li>
                  <li>White background = cleaner training</li>
                  <li>Pro mode = smoother rotation</li>
                  <li>Total: ~{loraNumFrames + 16} images combined</li>
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
