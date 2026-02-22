"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  Sparkles, Camera, Film, Package, CheckCircle,
  AlertCircle, Loader2, Play, Download, ChevronRight, ChevronDown,
  User, RefreshCw, RefreshCcw, ArrowRight, Info, Zap,
} from "lucide-react";
import { setLoraHandoff } from "@/lib/loraHandoff";

// ── Types ──────────────────────────────────────────────────────────────────────

type StepStatus = "idle" | "running" | "done" | "error" | "skip";

interface StepState {
  status: StepStatus;
  msg: string;
  progress: number; // 0-100
}

interface Character {
  name: string;
  gender: "male" | "female";
  ethnicity: string;
  age: string;
  outfit: string;
  extra: string;
}

// ── IndexedDB cache for pipeline results ──────────────────────────────────────
// Stores pipeline results per character name so switching tabs doesn't lose work.
// Uses IndexedDB (no size limit) instead of sessionStorage (5MB limit).
const IDB_NAME    = "geovera-char-builder";
const IDB_VERSION = 1;
const IDB_STORE   = "pipeline-cache";

interface PipelineCache {
  characterName: string;
  step1Image:    string | null;
  step2Images:   { name: string; image: string; expression: string }[];
  step3Frames:   string[];
  step6Images:   { roleId: string; sceneId: string; label: string; image: string; caption: string }[];
  savedAt:       number;
}

function openCharBuilderDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE, { keyPath: "characterName" });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function saveCharBuilderCache(data: PipelineCache): Promise<void> {
  try {
    const db  = await openCharBuilderDb();
    const tx  = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(data);
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
  } catch (e) { console.warn("[CharBuilder] Cache save failed:", e); }
}

async function loadCharBuilderCache(characterName: string): Promise<PipelineCache | null> {
  try {
    const db  = await openCharBuilderDb();
    const tx  = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(characterName);
    const result = await new Promise<PipelineCache | null>((res, rej) => {
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = () => rej(req.error);
    });
    db.close();
    return result;
  } catch (e) { console.warn("[CharBuilder] Cache load failed:", e); return null; }
}

async function clearCharBuilderCache(characterName: string): Promise<void> {
  try {
    const db = await openCharBuilderDb();
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(characterName);
    db.close();
  } catch (e) { console.warn("[CharBuilder] Cache clear failed:", e); }
}

// ── ZIP builder (pure JS, no deps) ────────────────────────────────────────────
function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff; b[1] = (n >> 8) & 0xff; b[2] = (n >> 16) & 0xff; b[3] = (n >> 24) & 0xff;
  return b;
}
function u16le(n: number): Uint8Array { return new Uint8Array([n & 0xff, (n >> 8) & 0xff]); }

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function localFileHeader(name: Uint8Array, size: number, crc: number): Uint8Array {
  const h = new Uint8Array(30 + name.length);
  h.set([0x50, 0x4b, 0x03, 0x04], 0);
  h.set(u16le(20), 4); h.set(u16le(0), 6); h.set(u16le(0), 8);
  h.set(u16le(0), 10); h.set(u16le(0), 12);
  h.set(u32le(crc), 14); h.set(u32le(size), 18); h.set(u32le(size), 22);
  h.set(u16le(name.length), 26); h.set(u16le(0), 28); h.set(name, 30);
  return h;
}

function centralDirEntry(name: Uint8Array, offset: number, crc: number, size: number): Uint8Array {
  const e = new Uint8Array(46 + name.length);
  e.set([0x50, 0x4b, 0x01, 0x02], 0);
  e.set(u16le(20), 4); e.set(u16le(20), 6); e.set(u16le(0), 8);
  e.set(u16le(0), 10); e.set(u16le(0), 12); e.set(u16le(0), 14);
  e.set(u32le(crc), 16); e.set(u32le(size), 20); e.set(u32le(size), 24);
  e.set(u16le(name.length), 28); e.set(u16le(0), 30); e.set(u16le(0), 32);
  e.set(u16le(0), 34); e.set(u16le(0), 36); e.set(u32le(0), 38); e.set(u32le(offset), 42);
  e.set(name, 46);
  return e;
}

function endOfCentralDir(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const r = new Uint8Array(22);
  r.set([0x50, 0x4b, 0x05, 0x06], 0);
  r.set(u16le(0), 4); r.set(u16le(0), 6);
  r.set(u16le(count), 8); r.set(u16le(count), 10);
  r.set(u32le(cdSize), 12); r.set(u32le(cdOffset), 16); r.set(u16le(0), 20);
  return r;
}

function buildZip(files: { name: string; dataUrl: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const cd: { name: string; offset: number; crc: number; size: number }[] = [];

  for (const { name, dataUrl } of files) {
    const b64  = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const crc  = crc32(data);
    const off  = parts.reduce((s, p) => s + p.length, 0);
    const nm   = enc.encode(name);
    parts.push(localFileHeader(nm, data.length, crc), data);
    cd.push({ name, offset: off, crc, size: data.length });
  }

  const cdOff = parts.reduce((s, p) => s + p.length, 0);
  let cdSize  = 0;
  for (const { name, offset, crc, size } of cd) {
    const nm = enc.encode(name);
    const e  = centralDirEntry(nm, offset, crc, size);
    parts.push(e);
    cdSize += e.length;
  }
  parts.push(endOfCentralDir(cd.length, cdSize, cdOff));

  const total  = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { result.set(p, pos); pos += p.length; }
  return result;
}

// ── Frame extractor from video ─────────────────────────────────────────────────
async function extractFramesFromVideoB64(
  videoB64: string,
  mime: string,
  numFrames: number,
  onProgress?: (n: number, total: number) => void,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video  = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx    = canvas.getContext("2d")!;
    const frames: string[] = [];
    const SIZE = 768; // slightly smaller for LoRA efficiency
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

// ── Preset characters ──────────────────────────────────────────────────────────
// All characters are Indonesian — specific ethnicity markers make LoRA
// more consistent across expressions (angry, sad, happy, surprised).
// "extra" = highly detailed physical anchor descriptors per character.
const PRESET_CHARACTERS: Character[] = [
  {
    name: "Rio",
    gender: "male",
    ethnicity: "indonesian",
    age: "20s",
    outfit: "casual streetwear, white crew-neck t-shirt",
    extra: [
      "Indonesian male, Javanese features",
      "square strong jawline, prominent cheekbones",
      "dark brown monolid almond-shaped eyes, thick straight black eyebrows",
      "straight jet black hair swept back, medium length",
      "warm medium olive-tan Indonesian skin tone, light brown undertone",
      "broad flat nose bridge, rounded nose tip",
      "full lips, natural lip color",
      "athletic lean muscular build, broad shoulders",
      "smooth clear skin, youthful complexion",
      "neutral confident expression",
    ].join(", "),
  },
  {
    name: "Adit",
    gender: "male",
    ethnicity: "indonesian",
    age: "30s",
    outfit: "business casual, navy blue slim-fit shirt",
    extra: [
      "Indonesian male, Sundanese features",
      "oval face shape, slightly angular jaw",
      "deep-set dark brown eyes, single eyelid, steady gaze",
      "neatly groomed short black hair, slight side part, low fade",
      "warm golden-brown Indonesian complexion, medium tan skin",
      "prominent wide Indonesian nose, flat bridge, wide nostrils",
      "well-defined jaw, subtle short stubble",
      "calm composed neutral expression",
      "broad shoulders, solid professional build",
      "mature distinguished appearance, smooth skin with slight texture",
    ].join(", "),
  },
  {
    name: "Aira",
    gender: "female",
    ethnicity: "indonesian",
    age: "20s",
    outfit: "modern casual, soft peach pastel blouse",
    extra: [
      "Indonesian female, Javanese-Betawi features",
      "heart-shaped face, soft rounded forehead",
      "large bright almond eyes, natural single eyelid, long dark lashes",
      "thin naturally arched dark eyebrows",
      "long straight silky jet black hair past shoulders, center part",
      "fair warm ivory Indonesian skin tone, golden undertone",
      "delicate small button nose, straight slim bridge",
      "naturally full lips, light pink lip color",
      "high soft cheekbones, graceful neck",
      "youthful radiant glowing complexion, poreless smooth skin",
      "elegant refined feminine features, gentle neutral expression",
    ].join(", "),
  },
  {
    name: "Bella",
    gender: "female",
    ethnicity: "indonesian",
    age: "30s",
    outfit: "formal power blazer, crisp white blouse",
    extra: [
      "Indonesian female, Batak-Minahasa features",
      "oval symmetrical face, defined strong jaw",
      "expressive dark double-lidded eyes, sharp intelligent gaze",
      "thick well-defined arched eyebrows",
      "medium length layered straight black hair, slight blowout",
      "warm light caramel Indonesian skin tone, peachy undertone",
      "straight refined nose, narrow bridge, neat tip",
      "defined cupid's-bow lips, natural nude lip color",
      "sharp prominent high cheekbones",
      "poised authoritative confident expression",
      "sophisticated mature beauty, flawless skin, subtle natural makeup",
    ].join(", "),
  },
  {
    name: "Kevin",
    gender: "male",
    ethnicity: "indonesian",
    age: "20s",
    outfit: "smart casual, light grey slim-fit polo shirt",
    extra: [
      "Indonesian Chinese Tionghoa male",
      "oval face shape, soft defined jawline",
      "narrow almond-shaped dark brown eyes, prominent single eyelid, smooth epicanthal fold",
      "thin naturally arched dark eyebrows",
      "neatly groomed short black hair, slight side part, low fade",
      "fair warm ivory skin, light golden undertone",
      "small refined nose, straight slim bridge",
      "thin well-shaped lips, neutral tone",
      "slim slender build, medium height",
      "smooth porcelain skin, youthful complexion",
      "calm composed neutral expression",
    ].join(", "),
  },
  {
    name: "Nadia",
    gender: "female",
    ethnicity: "indonesian",
    age: "20s",
    outfit: "casual chic, white off-shoulder blouse",
    extra: [
      "Indonesian Eurasian Indo-Caucasian female",
      "heart-shaped face, soft high cheekbones, graceful neck",
      "deep-set light brown hazel eyes, natural double eyelid, expressive bright gaze",
      "thick well-defined arched dark eyebrows",
      "long wavy dark brown hair, natural volume, soft highlights",
      "warm honey skin, mixed golden-fair undertone",
      "slightly elevated nose bridge, refined straight nose",
      "full naturally pink lips, soft defined cupid's-bow",
      "slim elegant build",
      "radiant glowing complexion, smooth flawless skin",
      "warm friendly confident expression, mixed beauty",
    ].join(", "),
  },
];

// ── Prompt builder — highly detailed Indonesian anchor for strong LoRA ─────────
// Uses "Indonesian" ethnicity label + exhaustive physical descriptors.
// Critical: every trait listed separately → LoRA learns each feature independently
// → consistent identity across all expressions (angry, sad, happy, surprised).
function buildCharacterPrompt(c: Character): string {
  return [
    // Primary identity anchor — most important line for LoRA
    `ohwx portrait photo of Indonesian ${c.gender} in ${c.age}s`,
    // ALL physical anchor descriptors (exhaustive for face consistency)
    c.extra,
    // Outfit context
    `wearing ${c.outfit}`,
    // Neutral expression for training baseline
    "neutral relaxed expression, mouth gently closed, eyes open forward, direct eye contact with camera",
    // Studio technical requirements
    "pure white seamless studio background, professional softbox lighting, catch light in eyes",
    "sharp facial focus, natural bokeh background, 85mm f/1.8 portrait lens perspective",
    "ultra high resolution, 8K detail, photorealistic skin pore-level texture",
    "no makeup or minimal natural makeup, true-to-life color accuracy",
    "consistent facial identity, same person, professional commercial headshot quality",
  ].filter(Boolean).join(", ");
}

// ── Role Packs for Step 6 — "Living Character" contextual dataset ─────────────
// Each role adds 6–8 contextual scenes to the dataset.
// Captions anchor the character identity + role context + action.
// This teaches the LoRA how the character looks in professional/lifestyle settings.
interface RoleScene {
  id:      string;
  label:   string;  // short display name
  action:  string;  // caption fragment (what they're doing)
  setting: string;  // background / environment
  outfit:  string;  // outfit override (null = use character default)
}
interface RolePack {
  id:      string;
  label:   string;
  icon:    string;
  color:   string;  // tailwind bg color chip
  scenes:  RoleScene[];
}

const ROLE_PACKS: RolePack[] = [
  {
    id: "ceo", label: "CEO / Direktur", icon: "🏢", color: "bg-primary/10 border-primary/30",
    scenes: [
      { id: "ceo_desk",        label: "Executive Desk",    action: "sitting at executive desk, looking at camera with confident expression",                   setting: "modern executive office, large wooden desk, city view window",            outfit: "formal business suit, tie" },
      { id: "ceo_meeting",     label: "Boardroom",         action: "standing at head of conference table, presenting with open hand gesture",                  setting: "corporate boardroom, large screen behind, suited colleagues",             outfit: "formal business suit" },
      { id: "ceo_phone",       label: "Phone Call",        action: "holding smartphone to ear, serious focused expression, slight nod",                        setting: "glass-wall office, city skyline background",                              outfit: "business suit, no tie, collar open" },
      { id: "ceo_signing",     label: "Signing Document",  action: "leaning over desk signing document, pen in hand, slight smile",                            setting: "clean executive office desk, documents spread out",                       outfit: "formal business suit" },
      { id: "ceo_window",      label: "Office Window",     action: "standing by large window, arms crossed, confident posture, slight smile",                  setting: "high-rise office, floor-to-ceiling window, city panorama",               outfit: "formal suit jacket, no tie" },
      { id: "ceo_handshake",   label: "Handshake",         action: "firm professional handshake, confident smile, slight forward lean",                        setting: "bright modern office lobby, neutral background",                          outfit: "business suit" },
    ],
  },
  {
    id: "cmo", label: "CMO / Marketing", icon: "📊", color: "bg-warning/10 border-warning/30",
    scenes: [
      { id: "cmo_whiteboard",  label: "Whiteboard",        action: "presenting at whiteboard, marker in hand, enthusiastic expression",                        setting: "modern creative office, large whiteboard with diagrams",                  outfit: "smart casual blazer, no tie" },
      { id: "cmo_laptop",      label: "Laptop Analytics",  action: "pointing at laptop screen showing charts, engaging smile, explaining data",                 setting: "open-plan creative office, desk with laptop",                             outfit: "casual blazer, rolled sleeves" },
      { id: "cmo_brainstorm",  label: "Brainstorm",        action: "leaning on table, discussing ideas, animated expression, hands gesturing",                  setting: "creative meeting room, colorful sticky notes on wall",                    outfit: "smart casual shirt" },
      { id: "cmo_speaking",    label: "Stage Presentation","action": "speaking on stage with microphone, confident smile, one hand raised",                    setting: "conference stage, audience silhouette, screen with slides",               outfit: "blazer, smart casual" },
      { id: "cmo_outdoor",     label: "Outdoor Shoot",     action: "walking outdoors confidently, looking at camera, natural smile",                            setting: "modern city street, glass building background",                           outfit: "stylish casual, sunglasses" },
      { id: "cmo_podcast",     label: "Podcast / Interview","action": "seated across table, talking with engaged expression, hands on table",                  setting: "podcast studio, ring light, microphone, dark acoustic background",        outfit: "smart casual shirt, blazer" },
    ],
  },
  {
    id: "cto", label: "CTO / Tech Lead", icon: "💻", color: "bg-meta-3/10 border-meta-3/30",
    scenes: [
      { id: "cto_monitors",    label: "Dual Monitors",     action: "sitting at standing desk looking at dual monitors, focused expression, hand on keyboard",  setting: "tech workspace, multiple monitors showing code, dark ambient",            outfit: "hoodie or developer t-shirt" },
      { id: "cto_whiteboard",  label: "Architecture",      action: "drawing system architecture diagram on whiteboard, explaining to colleague",                setting: "tech office, whiteboard with technical diagrams",                         outfit: "casual t-shirt, glasses optional" },
      { id: "cto_laptop",      label: "Laptop Coding",     action: "typing on laptop, intense focused expression, slight lean forward",                        setting: "modern open office, coffee cup beside laptop",                            outfit: "developer hoodie, casual" },
      { id: "cto_review",      label: "Code Review",       action: "pointing at screen during code review, engaged explaining expression",                     setting: "tech office, large monitor with code visible",                            outfit: "smart casual shirt" },
      { id: "cto_rooftop",     label: "Tech Campus",       action: "standing outdoors holding coffee cup, relaxed smile, confident posture",                   setting: "modern tech campus rooftop, city view",                                   outfit: "casual blazer over t-shirt" },
      { id: "cto_demo",        label: "Live Demo",         action: "demonstrating on tablet, engaging confident expression, one hand gesturing",                setting: "minimalist demo stage, clean background",                                 outfit: "smart casual" },
    ],
  },
  {
    id: "sales", label: "Sales / BD", icon: "🤝", color: "bg-success/10 border-success/30",
    scenes: [
      { id: "sales_pitch",     label: "Client Pitch",      action: "leaning forward in chair, engaging smile, hands on table, eye contact",                   setting: "client meeting room, glass table, city background",                       outfit: "business casual, blazer" },
      { id: "sales_handshake", label: "Deal Closed",       action: "warm confident handshake, genuine smile, slight lean in",                                  setting: "bright modern office, neutral background",                                outfit: "business formal" },
      { id: "sales_phone",     label: "Sales Call",        action: "on phone with notepad, writing notes, engaged attentive expression",                       setting: "open office or private booth, clean desk",                                outfit: "smart casual" },
      { id: "sales_coffee",    label: "Coffee Meeting",    action: "sitting at cafe table with coffee cup, relaxed business conversation gesture",              setting: "upscale cafe, warm lighting, coffee on table",                            outfit: "smart casual, blazer" },
      { id: "sales_demo",      label: "Product Demo",      action: "demonstrating product on tablet/laptop to camera, enthusiastic smile",                     setting: "clean meeting room, tablet propped on table",                             outfit: "business casual" },
      { id: "sales_outdoor",   label: "Networking",        action: "standing at networking event, holding wine glass or coffee, confident friendly smile",     setting: "corporate event space, soft evening lighting",                            outfit: "formal business attire" },
    ],
  },
  {
    id: "creator", label: "Creator / Host", icon: "🎬", color: "bg-meta-6/10 border-meta-6/30",
    scenes: [
      { id: "creator_camera",  label: "Talking to Camera", action: "looking directly into camera, engaging smile, relaxed body language, hand gesture",        setting: "minimal home studio, ring light, clean background or bookshelf",         outfit: "trendy casual" },
      { id: "creator_desk",    label: "Creator Desk",      action: "sitting at creator desk, behind monitor, headphones around neck, casual smile",            setting: "aesthetic creator setup, RGB lighting, plants, monitor",                  outfit: "casual hoodie or t-shirt" },
      { id: "creator_outdoor", label: "Vlog Outdoor",      action: "walking and talking, holding smartphone as camera, natural smile, relaxed",                 setting: "outdoor urban environment, street or park, natural lighting",             outfit: "streetwear casual" },
      { id: "creator_podcast", label: "Podcast Host",      action: "seated with microphone, engaged conversation pose, open body language",                    setting: "podcast studio, microphone, ring light, dark acoustic panels",            outfit: "smart casual shirt" },
      { id: "creator_event",   label: "Event Stage",       action: "on stage with microphone, crowd energy, one arm raised, big smile",                        setting: "event stage, crowd lighting, spotlight",                                  outfit: "trendy fashion-forward outfit" },
      { id: "creator_review",  label: "Product Review",    action: "holding product toward camera, explaining, curious interested expression",                  setting: "clean minimal background or home studio",                                 outfit: "casual" },
    ],
  },
  {
    id: "designer", label: "Design / Creative", icon: "🎨", color: "bg-meta-8/10 border-meta-8/30",
    scenes: [
      { id: "design_tablet",   label: "Design Tablet",     action: "drawing on graphic tablet with stylus, focused creative expression",                       setting: "creative studio desk, monitors with design work visible",                 outfit: "creative casual, minimal" },
      { id: "design_laptop",   label: "Design Review",     action: "pointing at design on laptop screen, explaining, nodding with confident smile",             setting: "bright creative agency, wooden desk, design references on wall",          outfit: "creative casual" },
      { id: "design_moodboard","label": "Moodboard",       action: "standing in front of moodboard wall, arms crossed, studying with thoughtful expression",   setting: "creative studio, large wall covered with inspiration images",             outfit: "artsy casual" },
      { id: "design_collab",   label: "Collaboration",     action: "leaning over table discussing design with colleague, pointing at printouts",                setting: "open creative studio, large table with design printouts",                 outfit: "casual creative" },
      { id: "design_outdoor",  label: "Outdoor Creative",  action: "sitting outdoors with sketchbook, drawing, natural relaxed creative expression",            setting: "outdoor cafe or park, natural warm lighting",                             outfit: "casual, sunglasses" },
      { id: "design_present",  label: "Design Presenting", action: "presenting design work on large screen, confident hand gesture toward screen",              setting: "agency presentation room, large display screen",                          outfit: "smart creative" },
    ],
  },
  {
    id: "support", label: "Customer Support", icon: "🎧", color: "bg-meta-7/10 border-meta-7/30",
    scenes: [
      { id: "support_headset", label: "Headset Call",      action: "wearing headset, warm empathetic smile, leaning slightly forward, attentive",              setting: "modern support center desk, monitors, clean professional setup",          outfit: "professional casual, branded uniform optional" },
      { id: "support_helping", label: "Helping Customer",  action: "showing screen to camera, explaining helpfully, genuine friendly smile",                   setting: "clean support desk with computer monitor visible",                        outfit: "smart casual or company shirt" },
      { id: "support_team",    label: "Team Desk",         action: "at open-plan desk with teammates, collaborative friendly expression",                      setting: "bright modern office, open plan, multiple desks",                         outfit: "business casual" },
      { id: "support_coffee",  label: "Break / Friendly",  action: "holding coffee mug, relaxed friendly smile, approachable warm expression",                 setting: "office kitchen or break room, warm lighting",                             outfit: "casual branded shirt" },
      { id: "support_chat",    label: "Live Chat",         action: "typing on keyboard, looking at monitor, focused helpful expression",                       setting: "clean modern support setup, dual monitors",                               outfit: "professional casual" },
      { id: "support_training","label": "Training / Onboarding","action": "presenting to small group, friendly instructive smile, hand pointing at screen",   setting: "training room, projector screen with slides",                             outfit: "smart casual" },
    ],
  },
];

// ── Personality: Mindset / Skillset / Role Model ─────────────────────────────

interface PersonalityOption { id: string; label: string; icon: string; }
interface RoleModelPreset   { id: string; name: string; icon: string; description: string; }

const MINDSET_OPTIONS: PersonalityOption[] = [
  { id: "growth",          label: "Growth Mindset",    icon: "🌱" },
  { id: "stoic",           label: "Stoic",             icon: "🧘" },
  { id: "entrepreneurial", label: "Entrepreneurial",   icon: "🚀" },
  { id: "creative",        label: "Creative",          icon: "✨" },
  { id: "analytical",      label: "Analytical",        icon: "📊" },
  { id: "empathetic",      label: "Empathetic Leader", icon: "🤝" },
  { id: "resilient",       label: "Resilient",         icon: "💪" },
  { id: "visionary",       label: "Visionary",         icon: "🔭" },
];

const SKILLSET_OPTIONS: PersonalityOption[] = [
  { id: "public_speaking", label: "Public Speaking", icon: "🎤" },
  { id: "coding",          label: "Coding / Tech",   icon: "💻" },
  { id: "marketing",       label: "Marketing",       icon: "📣" },
  { id: "leadership",      label: "Leadership",      icon: "🏆" },
  { id: "sales",           label: "Sales",           icon: "💼" },
  { id: "writing",         label: "Writing / Copy",  icon: "✍️" },
  { id: "design",          label: "UI/UX Design",    icon: "🎨" },
  { id: "finance",         label: "Finance",         icon: "💰" },
  { id: "negotiation",     label: "Negotiation",     icon: "🤜" },
  { id: "storytelling",    label: "Storytelling",    icon: "📖" },
];

const ROLE_MODEL_PRESETS: RoleModelPreset[] = [
  { id: "steve_jobs",     name: "Steve Jobs",     icon: "🍎", description: "visionary product thinking, reality distortion field, obsessive simplicity, 'one more thing' storytelling" },
  { id: "elon_musk",      name: "Elon Musk",      icon: "🚀", description: "first-principles reasoning, extreme ownership, high-risk ambitious goals, physics-based problem solving" },
  { id: "oprah",          name: "Oprah Winfrey",  icon: "🌟", description: "empathetic storytelling, authentic vulnerability, uplifting every person she meets, generous acknowledgment" },
  { id: "warren_buffett", name: "Warren Buffett", icon: "📈", description: "patient long-term thinking, value-based decisions, plain-language clarity, frugal wisdom" },
  { id: "naval",          name: "Naval Ravikant", icon: "⚓", description: "leverage thinking, specific knowledge, rational optimism, aphoristic clarity, wealth without time trading" },
  { id: "brene_brown",    name: "Brené Brown",    icon: "💛", description: "vulnerability research, shame resilience, wholehearted leadership, courageous authenticity" },
  { id: "simon_sinek",    name: "Simon Sinek",    icon: "🔵", description: "start-with-why framework, infinite game thinking, inspiring through purpose, servant leadership" },
  { id: "custom",         name: "Custom...",      icon: "✏️", description: "" },
];

// Scene templates for personality-based Step 6 images (module-level, not inside component)
const MINDSET_SCENES: Record<string, { action: string; setting: string; outfit: string }> = {
  growth:          { action: "reading a book with pen in hand, taking notes, focused learner expression",        setting: "cozy home library or cafe corner, warm ambient light, bookshelf background",   outfit: "casual comfortable wear" },
  stoic:           { action: "seated in calm meditation posture, eyes gently closed, serene focused expression", setting: "minimalist modern room, soft natural morning light, clean white wall",          outfit: "simple minimal casual attire" },
  entrepreneurial: { action: "writing on whiteboard with marker, enthusiastic problem-solving expression",       setting: "startup office, whiteboards covered with ideas, open workspace",                outfit: "smart casual, rolled-up sleeves" },
  creative:        { action: "sketching ideas in notebook, curious inspired expression, pen in hand",            setting: "bright creative studio, art supplies on desk, inspiration board visible",       outfit: "casual artistic attire" },
  analytical:      { action: "studying data charts on laptop screen, focused analytical expression",             setting: "clean minimal desk setup, dual monitors, night coding ambiance",                outfit: "smart casual" },
  empathetic:      { action: "leaning forward in active listening posture, warm genuinely engaged expression",   setting: "comfortable meeting room, warm soft lighting, plants in background",            outfit: "warm-toned business casual" },
  resilient:       { action: "standing outdoors looking at horizon, determined confident expression",            setting: "rooftop or hilltop, wide open sky, sunrise or golden hour",                    outfit: "casual sporty outdoor wear" },
  visionary:       { action: "gazing upward with thoughtful inspired expression, slight distant smile",          setting: "floor-to-ceiling window with city or star view, dramatic ambient light",        outfit: "clean minimal formal wear" },
};

const SKILLSET_SCENES: Record<string, { action: string; setting: string; outfit: string }> = {
  public_speaking: { action: "on stage with microphone, commanding confident expression, one hand raised",    setting: "conference stage, spotlight, audience silhouette in background",    outfit: "sharp business formal" },
  coding:          { action: "typing on keyboard, lines of code on monitors, deep focused expression",        setting: "dark developer setup, multiple monitors showing code",              outfit: "developer hoodie or casual t-shirt" },
  marketing:       { action: "presenting campaign slides, enthusiastic storytelling expression",               setting: "bright agency meeting room, large display screen",                  outfit: "smart creative casual" },
  leadership:      { action: "standing at head of table with engaged team, confident guiding expression",     setting: "corporate team meeting room, natural window light",                 outfit: "professional business attire" },
  sales:           { action: "leaning forward in pitch, confident persuasive smile, open hands on table",    setting: "client meeting room, glass table, city view background",            outfit: "business casual blazer" },
  writing:         { action: "writing on laptop with focused creative expression, slight smile",              setting: "bright minimal writing desk, notebook and coffee beside laptop",    outfit: "comfortable casual" },
  design:          { action: "reviewing design work on large monitor, thoughtful evaluating expression",      setting: "creative design studio, large display with mockups",                outfit: "creative casual" },
  finance:         { action: "reviewing financial report, calm analytical expression, pen in hand",           setting: "executive office or boardroom, documents and laptop on clean desk",  outfit: "formal business attire" },
  negotiation:     { action: "firm professional handshake across table, confident composed expression",       setting: "high-end meeting room, polished table",                             outfit: "formal business suit" },
  storytelling:    { action: "speaking animatedly with natural hand gestures, warm captivating expression",   setting: "intimate podcast or stage setting, warm spotlight",                 outfit: "smart casual" },
};

// ── 4 Anchor expressions for Step 2 (natural, not exaggerated) ───────────────
// These expressions are designed to be subtle and realistic — LoRA learns
// the character's face across emotional states without over-distorting features.
const ANCHOR_EXPRESSIONS: { id: string; label: string; prompt: string }[] = [
  {
    id:     "happy",
    label:  "Happy",
    prompt: "warm natural smile, slightly raised cheeks, relaxed happy expression, mouth gently closed or slightly parted, soft friendly eyes",
  },
  {
    id:     "sad",
    label:  "Sad",
    prompt: "subtle sad expression, slightly downcast eyes, relaxed slightly dropped lip corners, soft melancholy look, natural and understated",
  },
  {
    id:     "angry",
    label:  "Angry",
    prompt: "mild serious stern expression, slight brow furrow, focused intense gaze, pressed lips, controlled subtle displeasure — not exaggerated",
  },
  {
    id:     "surprise",
    label:  "Surprise",
    prompt: "mild surprised look, slightly raised eyebrows, eyes opened a bit wider, subtle open mouth, natural and realistic — not dramatic",
  },
];

// ── Random character generator ─────────────────────────────────────────────────
// Pools of randomizable attributes for quick custom character generation.
// All are Indonesian — same ethnicity anchor for LoRA consistency.
const RANDOM_POOLS = {
  maleName:   ["Budi", "Dani", "Farhan", "Gilang", "Hendra", "Ivan", "Joko", "Kevin", "Lukman", "Mario", "Nanda", "Oscar", "Panji", "Reza", "Satria", "Tomy", "Umar", "Viko", "Wahyu", "Yoga", "Vincent", "Andy", "Felix", "Steven", "Raymond", "Adrian", "Ryan", "Jason"],
  femaleName: ["Anisa", "Bunga", "Citra", "Dina", "Echa", "Fitri", "Gita", "Hana", "Indah", "Jasmine", "Kirana", "Layla", "Maya", "Nisa", "Putri", "Rara", "Sari", "Tita", "Ulfa", "Winda", "Jessica", "Cindy", "Natasha", "Angelica", "Stephanie", "Nadia", "Clarissa", "Vanessa"],
  age:        ["early 20s", "mid 20s", "late 20s", "early 30s", "mid 30s", "late 30s"],
  ethnicity:  ["Javanese", "Sundanese", "Batak", "Minang", "Betawi", "Balinese", "Bugis", "Manado", "Tionghoa", "Indo-Caucasian"],
  faceShape:  ["oval face", "heart-shaped face", "round face", "square jaw face", "diamond face"],
  eyes:       [
    "large bright almond eyes, natural single eyelid, long dark lashes",
    "deep-set dark brown eyes, single eyelid, steady gaze",
    "expressive dark double-lidded eyes, sharp intelligent gaze",
    "wide monolid brown eyes, calm steady expression",
    "narrow almond-shaped eyes, sleepy lidded look, single eyelid",
  ],
  eyebrows:   ["thick straight black eyebrows", "thin naturally arched dark eyebrows", "thick well-defined arched eyebrows", "natural flat straight brows"],
  nose:       ["small button nose, straight slim bridge", "broad flat nose bridge, rounded tip", "straight refined nose, narrow bridge", "prominent wide nose, flat bridge, wide nostrils"],
  lips:       ["full naturally pink lips", "defined cupid's-bow lips, nude tone", "naturally full lips, light pink color", "thin well-shaped lips, neutral tone"],
  skin:       [
    "fair warm ivory skin, golden undertone",
    "warm medium olive-tan skin, light brown undertone",
    "warm golden-brown complexion, medium tan",
    "warm light caramel skin, peachy undertone",
    "rich warm brown skin, deep golden undertone",
    "fair porcelain skin, cool pink undertone",
    "light beige skin, neutral undertone",
    "warm honey skin, mixed undertone",
  ],
  hair: {
    female: [
      "long straight silky jet black hair past shoulders, center part",
      "medium length wavy dark brown hair, side swept",
      "short bob cut black hair, chin length",
      "long curly dark hair, natural volume",
      "shoulder length straight hair with subtle highlights",
    ],
    male: [
      "straight jet black hair swept back, medium length",
      "neatly groomed short black hair, slight side part, low fade",
      "short textured black hair, natural style",
      "short clean fade black hair, military cut",
      "medium length messy black hair, casual style",
    ],
  },
  maleOutfit: [
    "casual streetwear, white crew-neck t-shirt",
    "business casual, navy blue slim-fit shirt",
    "smart casual, light grey polo shirt",
    "casual, black graphic tee",
    "formal, crisp white dress shirt, top button open",
    "sporty, dark athletic jersey",
    "casual, beige linen shirt rolled sleeves",
  ],
  femaleOutfit: [
    "modern casual, soft peach pastel blouse",
    "formal power blazer, crisp white blouse",
    "casual chic, white off-shoulder blouse",
    "smart casual, light blue button-down shirt",
    "feminine, floral soft pink top",
    "professional, sage green fitted blouse",
    "casual elegant, cream colored wrap top",
  ],
  build: {
    male:   ["athletic lean muscular build, broad shoulders", "solid professional build, broad shoulders", "slim slender build", "stocky solid build, medium height", "tall lean build"],
    female: ["slim elegant build", "athletic toned build", "petite delicate frame", "graceful medium build", "slender tall build"],
  },
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomCharacter(): Character {
  const gender  = Math.random() > 0.5 ? "female" : "male";
  const ethnicity = pick(RANDOM_POOLS.ethnicity);

  // Ethnicity-specific name pools — Chinese and Caucasian-mix names feel authentic
  let namePool: string[];
  if (ethnicity === "Tionghoa") {
    namePool = gender === "female"
      ? ["Jessica", "Cindy", "Natasha", "Angelica", "Stephanie", "Clarissa", "Vanessa", "Felicia"]
      : ["Vincent", "Andy", "Felix", "Steven", "Raymond", "Kevin", "Jason", "Wilson"];
  } else if (ethnicity === "Indo-Caucasian") {
    namePool = gender === "female"
      ? ["Nadia", "Vanessa", "Natasha", "Clarissa", "Bianca", "Stella", "Ariel", "Zara"]
      : ["Adrian", "Ryan", "Evan", "Marco", "Dion", "Aldo", "Rafael", "Rafi"];
  } else {
    namePool = gender === "female" ? RANDOM_POOLS.femaleName : RANDOM_POOLS.maleName;
  }

  const name    = pick(namePool);
  const age     = pick(RANDOM_POOLS.age);
  const outfit  = pick(gender === "female" ? RANDOM_POOLS.femaleOutfit : RANDOM_POOLS.maleOutfit);

  // Ethnicity-specific physical overrides
  let ethnicityLabel: string;
  let skinOverride: string | null = null;
  let eyeOverride: string | null  = null;
  let noseOverride: string | null = null;

  if (ethnicity === "Tionghoa") {
    ethnicityLabel = "Indonesian Chinese Tionghoa";
    skinOverride   = pick(["fair porcelain skin, cool pink undertone", "fair warm ivory skin, light golden undertone", "light beige skin, neutral undertone"]);
    eyeOverride    = pick(["narrow almond-shaped dark eyes, prominent single eyelid, smooth epicanthal fold", "wide monolid dark brown eyes, calm steady expression", "almond-shaped eyes, subtle double eyelid, bright gaze"]);
    noseOverride   = pick(["small refined nose, straight slim bridge", "small button nose, straight slim bridge"]);
  } else if (ethnicity === "Indo-Caucasian") {
    ethnicityLabel = "Indonesian Eurasian Indo-Caucasian";
    skinOverride   = pick(["warm honey skin, mixed golden-fair undertone", "light warm beige skin, peachy-golden undertone", "fair warm ivory skin, soft golden undertone"]);
    eyeOverride    = pick(["deep-set light brown eyes, natural double eyelid, expressive gaze", "hazel almond-shaped eyes, mixed light-brown tone, bright expression", "warm brown eyes, natural double eyelid, relaxed gaze"]);
    noseOverride   = pick(["straight refined nose, medium bridge, neat tip", "slightly elevated nose bridge, refined straight nose"]);
  } else {
    ethnicityLabel = `Indonesian ${gender}, ${ethnicity} features`;
  }

  const extra = [
    ethnicityLabel,
    pick(RANDOM_POOLS.faceShape),
    eyeOverride  ?? pick(RANDOM_POOLS.eyes),
    pick(RANDOM_POOLS.eyebrows),
    pick(gender === "female" ? RANDOM_POOLS.hair.female : RANDOM_POOLS.hair.male),
    skinOverride ?? pick(RANDOM_POOLS.skin),
    noseOverride ?? pick(RANDOM_POOLS.nose),
    pick(RANDOM_POOLS.lips),
    pick(gender === "female" ? RANDOM_POOLS.build.female : RANDOM_POOLS.build.male),
    "smooth clear skin, youthful complexion",
    "neutral confident expression",
  ].join(", ");

  return { name, gender: gender as "male" | "female", ethnicity: "indonesian", age, outfit, extra };
}

// ── Angle/variation prompt — used in Step 2 (16 camera angles × 4 expressions) ─
// Passes ALL physical descriptors to keep identity consistent across all shots
function buildAnglePrompt(c: Character, extra: string): string {
  return [
    `ohwx portrait photo of Indonesian ${c.gender} in ${c.age}s`,
    c.extra,           // full physical anchor — same for every angle
    `wearing ${c.outfit}`,
    extra,
    "white seamless studio background, professional photography",
    "consistent facial identity, same person, ultra high resolution, photorealistic",
  ].filter(Boolean).join(", ");
}

// ── AI Agent System Prompt builder ────────────────────────────────────────────
interface AgentPersonality {
  characterName: string;
  gender:        "male" | "female";
  ethnicity:     string;
  age:           string;
  roles:         string[];
  mindsets:      string[];
  skillsets:     string[];
  roleModelId:   string;
  roleModelText: string;
}

function buildAgentSystemPrompt(p: AgentPersonality): string {
  const lines: string[] = [];
  lines.push(`# AI Agent System Prompt — ${p.characterName}`);
  lines.push(`Generated by Geovera Character Builder`);
  lines.push(``);
  lines.push(`## Identity`);
  lines.push(`You are ${p.characterName}, a ${p.age} ${p.ethnicity} ${p.gender}.`);
  lines.push(`Speak always as ${p.characterName}. Never break character.`);
  lines.push(`Keep responses grounded, authentic, and consistent with your identity.`);
  lines.push(``);
  if (p.roles.length > 0) {
    const roleLabels = p.roles.map((id) => ROLE_PACKS.find((r) => r.id === id)?.label ?? id).join(", ");
    lines.push(`## Professional Context`);
    lines.push(`You operate primarily in: ${roleLabels}.`);
    lines.push(`Adapt your communication style, vocabulary, and knowledge depth accordingly.`);
    lines.push(``);
  }
  if (p.mindsets.length > 0) {
    const labels = p.mindsets.map((id) => MINDSET_OPTIONS.find((m) => m.id === id)?.label ?? id).join(", ");
    lines.push(`## Core Mindset`);
    lines.push(`Your thinking is shaped by: ${labels}.`);
    lines.push(`Let these mindsets influence your framing and problem-solving approach.`);
    lines.push(``);
  }
  if (p.skillsets.length > 0) {
    const labels = p.skillsets.map((id) => SKILLSET_OPTIONS.find((s) => s.id === id)?.label ?? id).join(", ");
    lines.push(`## Key Expertise`);
    lines.push(`Your strongest skills are: ${labels}.`);
    lines.push(`Be specific, practical, and actionable. Avoid generic advice.`);
    lines.push(``);
  }
  const rmDesc = p.roleModelId === "custom"
    ? p.roleModelText.trim()
    : ROLE_MODEL_PRESETS.find((r) => r.id === p.roleModelId)?.description ?? "";
  const rmName = p.roleModelId === "custom"
    ? p.roleModelText.trim()
    : ROLE_MODEL_PRESETS.find((r) => r.id === p.roleModelId)?.name ?? "";
  if (rmDesc) {
    lines.push(`## Role Model Influence`);
    lines.push(`${p.characterName} draws inspiration from ${rmName}.`);
    lines.push(`Channel these qualities: ${rmDesc}.`);
    lines.push(`You are ${p.characterName}, not ${rmName}. Adopt the philosophy, not the persona.`);
    lines.push(``);
  }
  lines.push(`## Behavioral Rules`);
  lines.push(`- Always respond in the first person as ${p.characterName}`);
  lines.push(`- Be concise, direct, and high-value — no filler`);
  lines.push(`- When uncertain, say so clearly rather than guessing`);
  lines.push(`- Tailor depth of response to the complexity of the question`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`Compatible with: OpenAI (GPT-4o), Anthropic Claude, Google Gemini.`);
  lines.push(`Paste this block as the "system" message / system prompt.`);
  return lines.join("\n");
}

// ── Step indicator ─────────────────────────────────────────────────────────────
function StepBadge({ n, status, label, sub }: { n: number; status: StepStatus; label: string; sub?: string }) {
  const colors: Record<StepStatus, string> = {
    idle:    "bg-gray dark:bg-meta-4 text-body",
    running: "bg-primary text-white",
    done:    "bg-success text-white",
    error:   "bg-danger text-white",
    skip:    "bg-gray dark:bg-meta-4 text-body opacity-50",
  };
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-all
      ${status === "running" ? "border-primary/40 bg-primary/5" :
        status === "done"    ? "border-success/30 bg-success/5" :
        status === "error"   ? "border-danger/30 bg-danger/5" :
        "border-stroke dark:border-strokedark bg-white dark:bg-boxdark"}`}>
      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${colors[status]}`}>
        {status === "done"    ? <CheckCircle size={14} /> :
         status === "error"   ? <AlertCircle size={14} /> :
         status === "running" ? <Loader2 size={14} className="animate-spin" /> :
         n}
      </div>
      <div>
        <p className={`text-sm font-medium ${status === "done" ? "text-success" : status === "error" ? "text-danger" : "text-black dark:text-white"}`}>
          {label}
        </p>
        {sub && <p className="text-[10px] text-body">{sub}</p>}
      </div>
    </div>
  );
}

// ── Progress bar ───────────────────────────────────────────────────────────────
function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      {label && <p className="text-xs text-body mb-1">{label}</p>}
      <div className="h-2 rounded-full bg-stroke dark:bg-strokedark overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${value}%` }} />
      </div>
      <p className="text-[10px] text-body mt-0.5 text-right">{Math.round(value)}%</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function CharacterBuilderPage() {
  const [selectedChar,  setSelectedChar]  = useState<Character>(PRESET_CHARACTERS[2]); // Aira default
  const [customChar,    setCustomChar]    = useState<Character | null>(null); // random-generated custom char
  const [customName,    setCustomName]    = useState(""); // editable name override
  const [useCustom,     setUseCustom]     = useState(false);

  // Results from each step
  const [step1Image,   setStep1Image]   = useState<string | null>(null); // base64 data URL
  const [step2Images,  setStep2Images]  = useState<{ name: string; image: string; expression: string }[]>([]); // 64 angles (16 × 4 expr)
  const [step3Frames,  setStep3Frames]  = useState<string[]>([]);  // 60 extracted frames
  const [zipUrl,       setZipUrl]       = useState<string | null>(null);
  const [zipFilename,  setZipFilename]  = useState("");

  // Kling mode
  const [klingMode, setKlingMode] = useState<"std" | "pro">("std");
  const [numFrames,  setNumFrames]  = useState(60);

  // Step 1 confirmation — pause pipeline before running Step 2 (expensive)
  const [awaitingStep1Confirm, setAwaitingStep1Confirm] = useState(false);

  // Step 6 — Role scene generation state
  const [selectedRoles,  setSelectedRoles]  = useState<string[]>([]);   // role pack IDs checked by user
  const [step6Images,    setStep6Images]    = useState<{ roleId: string; sceneId: string; label: string; image: string; caption: string }[]>([]);

  // Personality — Mindset / Skillset / Role Model
  const [selectedMindsets,    setSelectedMindsets]    = useState<string[]>([]);
  const [selectedSkillsets,   setSelectedSkillsets]   = useState<string[]>([]);
  const [roleModelPreset,     setRoleModelPreset]     = useState<string>("");
  const [roleModelCustomText, setRoleModelCustomText] = useState<string>("");
  const [personalityOpen,     setPersonalityOpen]     = useState<boolean>(false);

  // Kling resume polling — stores task_id when video is still processing after initial submit
  const [pendingKlingTaskId, setPendingKlingTaskId] = useState<string | null>(null);

  // Auto-training state — fire-and-forget after Step 5
  const [trainingJobId,       setTrainingJobId]       = useState<string | null>(null);
  const [trainingPollElapsed, setTrainingPollElapsed]  = useState(0);
  const [trainingStatus,      setTrainingStatus]       = useState<"idle" | "running" | "done" | "error">("idle");
  const [trainingMsg,         setTrainingMsg]          = useState("");
  const [trainingLoraUrl,     setTrainingLoraUrl]      = useState<string | null>(null);
  const trainingPollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const trainingElapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step statuses
  const initSteps = (): Record<number, StepState> => ({
    1: { status: "idle", msg: "", progress: 0 },
    2: { status: "idle", msg: "", progress: 0 },
    3: { status: "idle", msg: "", progress: 0 },
    4: { status: "idle", msg: "", progress: 0 },
    5: { status: "idle", msg: "", progress: 0 },
    6: { status: "idle", msg: "", progress: 0 },
  });
  const [steps, setSteps] = useState<Record<number, StepState>>(initSteps);
  const [globalRunning, setGlobalRunning] = useState(false);
  const [cacheStatus,   setCacheStatus]   = useState<"none" | "loaded" | "saved">("none");
  const prevCharName = useRef<string>("");

  // Compute active char early so hooks below can reference it
  // Priority: if useCustom + customChar exists → use customChar (random-generated)
  // customName overrides the name of whichever char is active
  const baseChar      = useCustom && customChar ? customChar : selectedChar;
  const activeChar    = customName.trim() ? { ...baseChar, name: customName.trim() } : baseChar;
  const characterName = activeChar.name;

  // ── Auto-load cache when character changes ──────────────────────────────────
  useEffect(() => {
    if (globalRunning) return; // don't overwrite running pipeline
    const name = activeChar.name;
    if (name === prevCharName.current) return;
    prevCharName.current = name;

    loadCharBuilderCache(name).then((cached) => {
      if (!cached) { setCacheStatus("none"); return; }
      // Only restore if cached within last 24h
      if (Date.now() - cached.savedAt > 24 * 60 * 60 * 1000) { setCacheStatus("none"); return; }
      setStep1Image(cached.step1Image);
      setStep2Images(cached.step2Images);
      setStep3Frames(cached.step3Frames);
      setStep6Images(cached.step6Images ?? []);  // restore role scenes (may be empty for old caches)
      // Restore step statuses based on what was cached
      setSteps((prev) => ({
        ...prev,
        1: cached.step1Image   ? { status: "done", msg: `✓ Character "${name}" (restored from cache)`, progress: 100 } : prev[1],
        2: cached.step2Images.length > 0 ? { status: "done", msg: `✓ ${cached.step2Images.length} angles (restored from cache)`, progress: 100 } : prev[2],
        3: cached.step3Frames.length > 0 ? { status: "done", msg: `✓ ${cached.step3Frames.length} frames (restored from cache)`, progress: 100 } : prev[3],
        6: (cached.step6Images?.length ?? 0) > 0 ? { status: "done", msg: `✓ ${cached.step6Images.length} role scenes (restored from cache)`, progress: 100 } : prev[6],
      }));
      setCacheStatus("loaded");
    });
  }, [activeChar.name, globalRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup training polling intervals on unmount
  useEffect(() => {
    return () => {
      if (trainingPollRef.current)    clearInterval(trainingPollRef.current);
      if (trainingElapsedRef.current) clearInterval(trainingElapsedRef.current);
    };
  }, []);

  // ── Auto-save cache when any step completes ─────────────────────────────────
  const saveCache = useCallback(
    (s1: string | null, s2: typeof step2Images, s3: string[], s6: typeof step6Images = []) => {
      if (!s1 && s2.length === 0 && s3.length === 0) return;
      saveCharBuilderCache({
        characterName: activeChar.name,
        step1Image:    s1,
        step2Images:   s2,
        step3Frames:   s3,
        step6Images:   s6,
        savedAt:       Date.now(),
      }).then(() => setCacheStatus("saved"));
    },
    [activeChar.name],
  );

  const updateStep = useCallback((n: number, patch: Partial<StepState>) => {
    setSteps((prev) => ({ ...prev, [n]: { ...prev[n], ...patch } }));
  }, []);

  // ── STEP 1: Text-to-Image via Modal Flux (via Next.js proxy) ──────────────
  const runStep1 = async (): Promise<string> => {
    updateStep(1, { status: "running", msg: "Generating character from text prompt...", progress: 10 });

    const prompt = buildCharacterPrompt(activeChar);

    // Use Next.js proxy (/api/modal/generate) — avoids CORS, env var handled server-side
    const res = await fetch("/api/modal/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        _batchPayload: {
          subject_description: prompt,
          theme_ids: [5],          // Minimalist Premium White — clean white studio
          screen_ratio: "1:1",     // square for LoRA training
          num_images_per_theme: 1,
          seed: Math.floor(Math.random() * 999999),
          model_variant: "dev",
          num_steps: 20,
          color: "none",
          continuity: false,
          sequence_mode: false,
          camera_shot: "medium",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Step 1 failed: ${res.status} — ${errText.slice(0, 200)}`);
    }
    const data = await res.json() as { results: { images: string[] }[]; total: number; ok?: boolean };
    if (!data.results?.[0]?.images?.[0]) throw new Error("No image returned from Step 1");

    const img = data.results[0].images[0];
    const dataUrl = img.startsWith("data:") ? img : `data:image/png;base64,${img}`;

    updateStep(1, { status: "done", msg: `✓ Character "${characterName}" generated`, progress: 100 });
    return dataUrl;
  };

  // ── STEP 2: 16 Camera Angles × 4 Expressions = 64 images ─────────────────
  // Runs all 4 expression passes IN PARALLEL (Promise.all) → each gets its own
  // Modal H100 container simultaneously → ~4× faster than sequential.
  // Shared atomic counter tracks total images done across all 4 streams.
  const runStep2 = async (sourceDataUrl: string): Promise<{ name: string; image: string; expression: string }[]> => {
    updateStep(2, { status: "running", msg: "🚀 Launching 4 expressions in parallel...", progress: 2 });

    // Strip data: prefix for base64
    const b64 = sourceDataUrl.includes(",") ? sourceDataUrl.split(",")[1] : sourceDataUrl;

    const TOTAL_IMAGES = ANCHOR_EXPRESSIONS.length * 16; // 64

    // Shared atomic counter — closure-based, updated by each parallel stream
    let totalDone = 0;
    // Per-expression counters for display
    const exprCounts: Record<string, number> = {};
    const exprLatest: Record<string, string> = {};
    ANCHOR_EXPRESSIONS.forEach((e) => { exprCounts[e.id] = 0; exprLatest[e.id] = "starting..."; });

    // Run one expression pass — returns its 16 angle images
    const runOneExpression = async (
      expr: typeof ANCHOR_EXPRESSIONS[0],
    ): Promise<{ name: string; image: string; expression: string }[]> => {
      const anchorPrompt = buildAnglePrompt(
        activeChar,
        `${expr.prompt}, studio lighting, white background, consistent facial identity`,
      );

      const res = await fetch("/api/modal/multi-angle-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_b64:    b64,
          description:   anchorPrompt,
          subject_type:  "actor",
          seed:          Math.floor(Math.random() * 999999),
          model_variant: "dev",   // dev = highest quality (not schnell)
          num_steps:     20,      // full 20 steps — no quality compromise
          gpu_speed:     "fast",  // H100 (not turbo/H200) — same quality, lower cost
          use_caption:   true,
        }),
      });

      if (!res.ok) throw new Error(`Step 2 [${expr.label}] failed: ${res.status}`);
      if (!res.body) throw new Error(`No response body for [${expr.label}]`);

      const angles: { name: string; image: string; expression: string }[] = [];
      const reader = res.body.getReader();
      const dec    = new TextDecoder();
      let   buf    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.replace(/^data:\s*/, "").trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          try {
            const ev = JSON.parse(trimmed) as {
              event?: string; angle_name?: string; image?: string;
            };
            if (ev.event === "angle" && ev.image && ev.angle_name !== undefined) {
              angles.push({ name: ev.angle_name, image: ev.image, expression: expr.id });
              exprCounts[expr.id]++;
              exprLatest[expr.id] = ev.angle_name;
              totalDone++;

              const pct = Math.round((totalDone / TOTAL_IMAGES) * 100);
              // Show compact status: all 4 expressions progress side by side
              const summary = ANCHOR_EXPRESSIONS
                .map((e) => `${e.label[0]}:${exprCounts[e.id]}/16`)
                .join(" · ");
              updateStep(2, {
                msg:      `⚡ Parallel: ${summary} — Total ${totalDone}/${TOTAL_IMAGES}`,
                progress: pct,
              });
            }
          } catch { /* skip malformed */ }
        }
      }

      if (angles.length === 0) throw new Error(`No angles returned for [${expr.label}]`);
      return angles;
    };

    // 🚀 Fire all 4 in parallel — Modal spawns 4 separate H100 containers simultaneously
    const results = await Promise.all(
      ANCHOR_EXPRESSIONS.map((expr) => runOneExpression(expr))
    );

    // Merge results in order: happy[0..15], sad[16..31], angry[32..47], surprise[48..63]
    const allAngles = results.flat();

    updateStep(2, {
      status:   "done",
      msg:      `✓ ${allAngles.length} images — 4 ekspresi parallel selesai (happy, sad, angry, surprise)`,
      progress: 100,
    });
    return allAngles;
  };

  // ── KLING HELPERS ────────────────────────────────────────────────────────────

  /**
   * Poll /api/kling/video-status every 5s until Kling finishes the video.
   * Used as fallback when the initial extract-frames request times out (202 status).
   * Returns the CDN video URL when status === "succeed".
   */
  const pollKlingUntilReady = async (taskId: string): Promise<string> => {
    const deadline = Date.now() + 5 * 60_000; // 5 more minutes
    let attempt = 0;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      attempt++;
      updateStep(3, {
        msg:      `Waiting for Kling video... attempt ${attempt} (task …${taskId.slice(-8)})`,
        progress: 20 + Math.min(attempt * 3, 25),
      });

      try {
        const r = await fetch(`/api/kling/video-status?task_id=${encodeURIComponent(taskId)}`);
        if (!r.ok) continue; // transient error — keep polling
        const d = await r.json() as { status: string; video_url: string | null; error?: string };

        if (d.status === "succeed" && d.video_url) return d.video_url;
        if (d.status === "failed") throw new Error("Kling video generation failed.");
        // still processing → continue loop
      } catch (err) {
        if (err instanceof Error && err.message.includes("failed")) throw err; // propagate real failure
        // ignore transient network errors
      }
    }
    throw new Error(
      `Kling video timeout after 5 minutes (task: ${taskId}). Please retry Step 3.`
    );
  };

  /**
   * Download a Kling CDN video via the proxy route and convert to base64.
   * Direct browser fetch of Kling CDN URLs fails due to CORS.
   */
  const downloadVideoAsB64 = async (videoUrl: string): Promise<string> => {
    const proxyUrl = `/api/kling/proxy-video?url=${encodeURIComponent(videoUrl)}`;
    const r = await fetch(proxyUrl);
    if (!r.ok) {
      const errText = await r.text().catch(() => r.statusText);
      throw new Error(`Could not download Kling video: ${errText.slice(0, 100)}`);
    }
    const buf   = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary  = "";
    // Convert ArrayBuffer → base64 in chunks to avoid call stack overflow
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  };

  // ── STEP 3: Kling 360° video → extract frames ─────────────────────────────
  // Uses start frame (Step 1 source) + end frame (back-view from Step 2 angles)
  // so Kling generates a real 360° rotation instead of guessing.
  const runStep3 = async (
    sourceDataUrl: string,
    angles?: { name: string; image: string; expression: string }[],
  ): Promise<string[]> => {
    updateStep(3, { status: "running", msg: "Submitting 360° rotation to Kling AI...", progress: 5 });

    const b64 = sourceDataUrl.includes(",") ? sourceDataUrl.split(",")[1] : sourceDataUrl;

    // Find back-view image from Step 2 angles to use as end frame
    // Angle names from multi-angle-stream typically include: "back", "rear", "180"
    // Use the first "happy" expression back-view for consistency
    let backViewB64: string | null = null;
    if (angles && angles.length > 0) {
      const backAngle = angles.find((a) =>
        a.expression === "happy" && // use happy = most natural/relaxed expression for 360°
        (a.name.toLowerCase().includes("back") ||
         a.name.toLowerCase().includes("rear") ||
         a.name.toLowerCase().includes("180"))
      ) ?? angles.find((a) =>
        a.name.toLowerCase().includes("back") ||
        a.name.toLowerCase().includes("rear") ||
        a.name.toLowerCase().includes("180")
      );

      if (backAngle) {
        backViewB64 = backAngle.image.includes(",")
          ? backAngle.image.split(",")[1]
          : backAngle.image;
        updateStep(3, { msg: `Using "${backAngle.name}" as end frame...`, progress: 8 });
      }
    }

    // Kling 360° prompt for human character — needs person-specific wording
    const char360Prompt =
      `person slowly rotating 360 degrees on white studio background, ` +
      `smooth continuous full body rotation, consistent softbox studio lighting, ` +
      `person stays centered in frame, no camera movement, ` +
      `white seamless backdrop, professional character photography, ` +
      `same outfit and appearance throughout rotation`;

    const char360Negative =
      `camera shake, zoom, pan, tilt, cut, transition, multiple people, ` +
      `background change, flickering, inconsistent lighting, ` +
      `clothing change, hairstyle change, expression change, text, watermark`;

    // Submit video to Kling via extract-frames endpoint
    const res = await fetch("/api/kling/extract-frames", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_b64:       b64,
        image_tail_b64:  backViewB64,  // end frame = back view (null if not found → Kling guesses)
        num_frames:      numFrames,
        duration:        5,
        aspect_ratio:    "1:1",
        mode:            klingMode,
        prompt:          char360Prompt,
        negative_prompt: char360Negative,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Step 3 Kling error: ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as {
      video_b64?: string;
      video_mime?: string;
      num_frames?: number;
      video_url?: string;
      task_id?: string;
      status?: string;
      error?: string;
    };

    if (data.error) throw new Error(data.error);

    // ── Resolve video_b64 via 3 paths ──────────────────────────────────────
    // Path A: Server returned video_b64 directly (normal fast path)
    // Path B: Server timed out, video still processing → poll + proxy-download
    // Path C: Server got video_url but CDN download failed → proxy-download directly
    let resolvedVideoB64: string;
    let resolvedVideoMime: string = data.video_mime ?? "video/mp4";

    if (data.video_b64) {
      // Path A — normal
      resolvedVideoB64 = data.video_b64;

    } else if (data.status === "processing" && data.task_id) {
      // Path B — Vercel function timed out while Kling was still rendering
      // Auto-resume: poll video-status until the video is ready, then download
      setPendingKlingTaskId(data.task_id);
      updateStep(3, {
        msg:      `⏳ Kling masih rendering video... (task …${data.task_id.slice(-8)})`,
        progress: 18,
      });
      const videoUrl = await pollKlingUntilReady(data.task_id);
      setPendingKlingTaskId(null);

      updateStep(3, { msg: "Downloading video...", progress: 45 });
      resolvedVideoB64 = await downloadVideoAsB64(videoUrl);

    } else if (data.video_url) {
      // Path C — Server got video_url but CDN download failed server-side
      updateStep(3, { msg: "Downloading video...", progress: 45 });
      resolvedVideoB64 = await downloadVideoAsB64(data.video_url);

    } else {
      const detail = data.status ?? "no video_b64 in response";
      throw new Error(`Step 3 gagal: ${detail}. Coba ulangi Step 3.`);
    }

    updateStep(3, { msg: "Extracting frames from 360° video...", progress: 50 });

    const frames = await extractFramesFromVideoB64(
      resolvedVideoB64,
      resolvedVideoMime,
      numFrames,
      (n, total) => {
        updateStep(3, {
          msg: `Extracting frame ${n}/${total}...`,
          progress: 50 + Math.round((n / total) * 50),
        });
      },
    );

    updateStep(3, { status: "done", msg: `✓ ${frames.length} frames extracted from 360° video`, progress: 100 });
    return frames;
  };

  // ── STEP 6: Role Scene Generator — "Living Character" contextual dataset ─────
  // Generates 6 scenes per selected role using the same multi-angle-stream endpoint.
  // Each scene = 1 image (not 16 angles) — targeted contextual shot.
  // Total: 6 roles × 6 scenes = 36 images max (user picks subset).
  //
  // Caption format:
  //   ohwx Indonesian {gender}, {anchor_extra}, {action}, {setting}, professional lighting
  //
  // Strategy: run all roles in parallel (Promise.allSettled) — same H100 fleet.
  const runStep6 = async (
    sourceDataUrl: string,
    roles: string[],           // selected role IDs
  ): Promise<{ roleId: string; sceneId: string; label: string; image: string; caption: string }[]> => {
    if (roles.length === 0) {
      updateStep(6, { status: "skip", msg: "Skip — tidak ada role yang dipilih", progress: 100 });
      return [];
    }

    // ── Build personality pseudo-scenes (1 scene per mindset + 1 per skillset) ──
    const personalityPseudoPack: RolePack = {
      id: "personality", label: "Personality", icon: "🧠", color: "bg-primary/10 border-primary/30",
      scenes: [
        ...selectedMindsets.filter((id) => MINDSET_SCENES[id]).map((id) => ({
          id:      `mindset_${id}`,
          label:   MINDSET_OPTIONS.find((m) => m.id === id)?.label ?? id,
          action:  MINDSET_SCENES[id].action,
          setting: MINDSET_SCENES[id].setting,
          outfit:  MINDSET_SCENES[id].outfit,
        })),
        ...selectedSkillsets.filter((id) => SKILLSET_SCENES[id]).map((id) => ({
          id:      `skill_${id}`,
          label:   SKILLSET_OPTIONS.find((s) => s.id === id)?.label ?? id,
          action:  SKILLSET_SCENES[id].action,
          setting: SKILLSET_SCENES[id].setting,
          outfit:  SKILLSET_SCENES[id].outfit,
        })),
      ],
    };
    const activePacks = [
      ...ROLE_PACKS.filter((p) => roles.includes(p.id)),
      ...(personalityPseudoPack.scenes.length > 0 ? [personalityPseudoPack] : []),
    ];
    const totalScenes = activePacks.reduce((acc, p) => acc + p.scenes.length, 0);
    updateStep(6, {
      status:   "running",
      msg:      `🎭 Generating ${totalScenes} role scenes (${activePacks.length} roles)...`,
      progress: 2,
    });

    const b64 = sourceDataUrl.includes(",") ? sourceDataUrl.split(",")[1] : sourceDataUrl;
    let doneCount = 0;

    // Generate one scene → returns base64 image
    const generateScene = async (
      pack: RolePack,
      scene: RoleScene,
    ): Promise<{ roleId: string; sceneId: string; label: string; image: string; caption: string } | null> => {
      // Build caption — omit physical anchor (model learns identity from images).
      // Only caption variable context: outfit, action, setting.
      const caption = `ohwx, wearing ${scene.outfit}, ${scene.action}, ${scene.setting}, professional photography, natural lighting, photorealistic`;

      // Prompt for generation
      const genPrompt = [
        `ohwx portrait photo of Indonesian ${activeChar.gender} in ${activeChar.age}s`,
        activeChar.extra,
        `wearing ${scene.outfit}`,
        scene.action,
        scene.setting,
        "professional photography, soft natural lighting, photorealistic, 8K, sharp focus",
        "consistent facial identity, same person",
      ].filter(Boolean).join(", ");

      try {
        const res = await fetch("/api/modal/multi-angle-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source_b64:    b64,
            description:   genPrompt,
            subject_type:  "actor",
            seed:          Math.floor(Math.random() * 999999),
            model_variant: "dev",
            num_steps:     20,
            gpu_speed:     "fast",
            use_caption:   true,
            // angle_indices: generate only index 0 (Front View) — 1 contextual shot per scene.
            // Much cheaper than full 16-angle sweep (~16× cost reduction per scene).
            // Modal _run_multi_angle_core reads this and skips angles not in the list.
            angle_indices: [0],
          }),
        });

        if (!res.ok || !res.body) return null;

        const reader = res.body.getReader();
        const dec    = new TextDecoder();
        let   buf    = "";
        let   img: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.replace(/^data:\s*/, "").trim();
            if (!trimmed || trimmed === "[DONE]") continue;
            try {
              const ev = JSON.parse(trimmed) as { event?: string; image?: string };
              if (ev.event === "angle" && ev.image) { img = ev.image; break; }
            } catch { /* skip */ }
          }
          if (img) break;
        }

        if (!img) return null;

        doneCount++;
        const pct = Math.round((doneCount / totalScenes) * 100);
        updateStep(6, {
          msg:      `🎭 ${doneCount}/${totalScenes} — ${pack.label}: ${scene.label}`,
          progress: pct,
        });

        return { roleId: pack.id, sceneId: scene.id, label: `${pack.label} · ${scene.label}`, image: img, caption };
      } catch {
        doneCount++;
        return null;
      }
    };

    // Build all tasks flat across selected roles — run ALL in parallel
    const tasks = activePacks.flatMap((pack) =>
      pack.scenes.map((scene) => generateScene(pack, scene))
    );

    const results = await Promise.allSettled(tasks);
    const images  = results
      .filter((r): r is PromiseFulfilledResult<NonNullable<Awaited<ReturnType<typeof generateScene>>>> =>
        r.status === "fulfilled" && r.value !== null
      )
      .map((r) => r.value);

    updateStep(6, {
      status:   "done",
      msg:      `✓ ${images.length}/${totalScenes} role scenes (${activePacks.map((p) => p.label).join(", ")})`,
      progress: 100,
    });

    return images;
  };

  // ── STEP 4: Build ZIP ──────────────────────────────────────────────────────
  const runStep4 = async (
    frames: string[],
    angles: { name: string; image: string; expression: string }[],
    roleImages: { roleId: string; sceneId: string; label: string; image: string; caption: string }[] = [],
  ): Promise<{ url: string; filename: string }> => {
    updateStep(4, { status: "running", msg: "Building ZIP dataset...", progress: 10 });

    const files: { name: string; dataUrl: string }[] = [];
    const anchorDesc = activeChar.extra;

    // ── Layer 1: 64 multi-angle × 4 expression images ─────────────────────
    angles.forEach((a, i) => {
      const idx = String(i + 1).padStart(3, "0");
      const safeAngle = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      files.push({ name: `expr_${a.expression}_${idx}_${safeAngle}.png`, dataUrl: a.image });
    });
    updateStep(4, { msg: `Adding ${angles.length} angle images...`, progress: 25 });

    // ── Layer 2: 360° frames ───────────────────────────────────────────────
    frames.forEach((f, i) => {
      const idx = String(i + 1).padStart(3, "0");
      files.push({ name: `frame_360_${idx}.png`, dataUrl: f });
    });
    updateStep(4, { msg: "Adding 360° frames...", progress: 50 });

    // ── Layer 3: Role scene images (Step 6) ────────────────────────────────
    // Organized by role subfolder for clarity: role_ceo/ceo_desk_001.png etc.
    roleImages.forEach((r, i) => {
      const idx = String(i + 1).padStart(3, "0");
      files.push({ name: `role_${r.roleId}_${idx}_${r.sceneId}.png`, dataUrl: r.image });
    });
    if (roleImages.length > 0) {
      updateStep(4, { msg: `Adding ${roleImages.length} role scene images...`, progress: 65 });
    }

    // ── Captions txt (kohya_ss compatible) ────────────────────────────────
    // IMPORTANT: Physical anchor descriptors (anchorDesc / activeChar.extra) are intentionally
    // OMITTED from training captions. Civitai best practice: features omitted from captions
    // become "core identity" the model always generates. Features that ARE captioned become
    // "optional" — only generated when explicitly prompted. So we caption only context
    // (view, expression, setting) and let the model learn face/hair/skin from the images.
    const captionLines = [
      ...angles.map((a, i) => {
        const idx = String(i + 1).padStart(3, "0");
        const safeAngle = a.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
        const exprDef = ANCHOR_EXPRESSIONS.find((e) => e.id === a.expression);
        const exprDesc = exprDef ? exprDef.prompt : a.expression;
        return `expr_${a.expression}_${idx}_${safeAngle}.png|ohwx, ${a.name.toLowerCase()} view, ${exprDesc}, white studio background, professional lighting`;
      }),
      ...frames.map((_, i) => {
        const idx = String(i + 1).padStart(3, "0");
        return `frame_360_${idx}.png|ohwx, 360 degree rotation, white studio background, professional lighting`;
      }),
      // Role scene captions — already built in runStep6 (also uses corrected format)
      ...roleImages.map((r, i) => {
        const idx = String(i + 1).padStart(3, "0");
        return `role_${r.roleId}_${idx}_${r.sceneId}.png|${r.caption}`;
      }),
    ];

    const captionText    = captionLines.join("\n");
    const captionBytes   = new TextEncoder().encode(captionText);
    const captionB64     = btoa(Array.from(captionBytes, (b) => String.fromCharCode(b)).join(""));
    files.push({ name: "captions.txt", dataUrl: "data:text/plain;base64," + captionB64 });
    updateStep(4, { msg: "Writing captions.txt...", progress: 72 });

    // ── character_profile.json ────────────────────────────────────────────
    const rolesUsed = [...new Set(roleImages.map((r) => r.roleId))];
    const resolvedRoleModelName = roleModelPreset === "custom"
      ? roleModelCustomText.trim()
      : ROLE_MODEL_PRESETS.find((r) => r.id === roleModelPreset)?.name ?? "";
    const profile = {
      name:          characterName,
      gender:        activeChar.gender,
      ethnicity:     activeChar.ethnicity,
      age:           activeChar.age,
      outfit:        activeChar.outfit,
      anchor_extra:  activeChar.extra,
      base_prompt:   buildCharacterPrompt(activeChar),
      expressions:   ANCHOR_EXPRESSIONS.map((e) => ({ id: e.id, label: e.label, prompt: e.prompt })),
      roles:         rolesUsed,
      personality: {
        mindsets:   selectedMindsets,
        skillsets:  selectedSkillsets,
        role_model: resolvedRoleModelName || null,
        agent_system_prompt: buildAgentSystemPrompt({
          characterName,
          gender:        activeChar.gender,
          ethnicity:     activeChar.ethnicity,
          age:           activeChar.age,
          roles:         rolesUsed,
          mindsets:      selectedMindsets,
          skillsets:     selectedSkillsets,
          roleModelId:   roleModelPreset,
          roleModelText: roleModelCustomText,
        }),
      },
      dataset: {
        angle_images: angles.length,
        frame_images: frames.length,
        role_images:  roleImages.length,
        kling_mode:   klingMode,
        num_frames:   numFrames,
      },
      created_at: new Date().toISOString(),
      generator:  "Geovera Character Builder v2",
    };
    const profileJson  = JSON.stringify(profile, null, 2);
    const profileBytes = new TextEncoder().encode(profileJson);
    const profileB64   = btoa(Array.from(profileBytes, (b) => String.fromCharCode(b)).join(""));
    files.push({ name: "character_profile.json", dataUrl: "data:application/json;base64," + profileB64 });

    // ── README.md ─────────────────────────────────────────────────────────
    const hasRoles = roleImages.length > 0;
    const readmeText = [
      `# ${characterName} — LoRA Training Dataset`,
      `Generated by Geovera Character Builder v2 on ${new Date().toLocaleDateString("id-ID", { dateStyle: "long" })}`,
      ``,
      `---`,
      ``,
      `## Character Profile`,
      `- **Name:** ${characterName}`,
      `- **Gender:** ${activeChar.gender}`,
      `- **Ethnicity:** ${activeChar.ethnicity}`,
      `- **Age:** ${activeChar.age}`,
      `- **Outfit:** ${activeChar.outfit}`,
      `- **Anchor descriptor:** ${activeChar.extra}`,
      hasRoles ? `- **Roles trained:** ${rolesUsed.map((id) => ROLE_PACKS.find((p) => p.id === id)?.label ?? id).join(", ")}` : "",
      ``,
      `## Trigger Word`,
      `\`ohwx\` — gunakan kata ini di setiap prompt untuk mengaktifkan karakter.`,
      ``,
      `---`,
      ``,
      `## How to Use`,
      ``,
      `### 1. Training (Kohya-ss / Modal)`,
      `\`\`\``,
      `Caption format  : captions.txt  (pipe-delimited: filename|caption)`,
      `Trigger word    : ohwx`,
      `Steps           : ${2500 + (roleImages.length > 0 ? Math.round(roleImages.length * 5) : 0)}  ${roleImages.length > 0 ? `(+${Math.round(roleImages.length * 5)} for ${roleImages.length} role scenes)` : ""}`,
      `Learning rate   : 2e-5  (Flux best practice — was 5e-5)`,
      `LR Scheduler    : Cosine annealing (eta_min = lr × 0.1)`,
      `LoRA rank       : 32`,
      `Resolution      : 1024×1024  (was 512 — higher res = better facial detail)`,
      `Base model      : FLUX.1-dev`,
      `\`\`\``,
      ``,
      `### 2. Generate Image dengan LoRA`,
      `\`\`\``,
      `ohwx Indonesian ${activeChar.gender}, ${activeChar.extra},`,
      `wearing ${activeChar.outfit}, smiling, outdoor background,`,
      `professional photography, 8K`,
      `\`\`\``,
      hasRoles ? `\n### 3. Generate Role-Based Scene` : "",
      hasRoles ? `Karakter ini telah dilatih dengan konteks role. Contoh prompt:` : "",
      hasRoles ? `\`\`\`` : "",
      ...(hasRoles ? rolesUsed.map((id) => {
        const pack = ROLE_PACKS.find((p) => p.id === id);
        const scene = pack?.scenes[0];
        return scene ? `# ${pack?.label}\nohwx Indonesian ${activeChar.gender}, ${activeChar.extra}, wearing ${scene.outfit}, ${scene.action}, ${scene.setting}` : "";
      }) : []),
      hasRoles ? `\`\`\`` : "",
      ``,
      `### ${hasRoles ? 4 : 3}. Penggunaan di Geovera TikTok Ads`,
      `1. Buka halaman **TikTok Ads** di Geovera`,
      `2. Pilih **Actor Mode** → **LoRA Trained**`,
      `3. Upload file \`.safetensors\` hasil training`,
      `4. Masukkan trigger word: \`ohwx\``,
      `5. Isi prompt produk → Generate video`,
      ``,
      `---`,
      ``,
      `## Dataset Contents`,
      `| File | Jumlah | Deskripsi |`,
      `|------|--------|-----------|`,
      `| \`expr_*.png\` | ${angles.length} | Multi-angle images (4 expressions × 16 sudut) |`,
      `| \`frame_360_*.png\` | ${frames.length} | Frame dari Kling 360° video |`,
      hasRoles ? `| \`role_*.png\` | ${roleImages.length} | Role scene images (${rolesUsed.length} roles) |` : "",
      `| \`captions.txt\` | 1 | Kohya-ss captions (pipe-delimited) |`,
      `| \`character_profile.json\` | 1 | Descriptor lengkap untuk reproducibility |`,
      `| \`README.md\` | 1 | File ini |`,
      ``,
      `**Total images:** ${angles.length + frames.length + roleImages.length}`,
      `**Kling mode:** ${klingMode.toUpperCase()} | **Frames:** ${frames.length}`,
      hasRoles ? `**Roles:** ${rolesUsed.map((id) => ROLE_PACKS.find((p) => p.id === id)?.label ?? id).join(", ")}` : "",
      ``,
      `---`,
      ``,
      `## Training Recommendations`,
      `| Parameter | Value | Notes |`,
      `|-----------|-------|-------|`,
      `| Steps | ${2500 + (roleImages.length > 0 ? Math.round(roleImages.length * 5) : 0)} | Flux best practice (2500 base + 5×role scenes) |`,
      `| Learning rate | 2e-5 | Flux best practice — karakter LoRA (bukan style) |`,
      `| LoRA rank | 32 | Balance antara detail dan file size |`,
      `| Resolution | 1024×1024 | Full detail — skin, hair, eyes (was 512×512) |`,
      `| Batch size | 1–2 | Sesuaikan dengan VRAM |`,
      `| Base model | SD 1.5 atau SDXL | SD 1.5 untuk kompatibilitas lebih luas |`,
      ``,
      `---`,
      ``,
      `## Expressions Used`,
      ...ANCHOR_EXPRESSIONS.map((e) => `- **${e.label}:** ${e.prompt}`),
      hasRoles ? `\n## Role Scenes` : "",
      ...(hasRoles ? rolesUsed.map((id) => {
        const pack = ROLE_PACKS.find((p) => p.id === id);
        if (!pack) return "";
        return [`\n### ${pack.icon} ${pack.label}`, ...pack.scenes.map((s) => `- **${s.label}:** ${s.action}`)].join("\n");
      }) : []),
      ``,
      `---`,
      ``,
      `## Base Prompt`,
      `\`\`\``,
      buildCharacterPrompt(activeChar),
      `\`\`\``,
      ``,
      `---`,
      ``,
      `*Dibuat otomatis oleh Geovera Character Builder v2*`,
    ].filter((l) => l !== "").join("\n");
    const readmeBytes = new TextEncoder().encode(readmeText);
    const readmeB64   = btoa(Array.from(readmeBytes, (b) => String.fromCharCode(b)).join(""));
    files.push({ name: "README.md", dataUrl: "data:text/markdown;base64," + readmeB64 });

    updateStep(4, { msg: "Building ZIP file...", progress: 85 });

    const zipData  = buildZip(files);
    const blob     = new Blob([zipData.buffer as ArrayBuffer], { type: "application/zip" });
    const url      = URL.createObjectURL(blob);
    const imageCount = files.length - 3; // -3: captions.txt + profile.json + README.md
    const filename = `${characterName.toLowerCase().replace(/\s+/g, "_")}_lora_dataset_${imageCount}images.zip`;

    updateStep(4, {
      status: "done",
      msg:    `✓ ZIP ready: ${imageCount} images + captions + profile + README (${(zipData.length / 1024 / 1024).toFixed(1)} MB)`,
      progress: 100,
    });

    return { url, filename };
  };

  // ── STEP 5: Note for training page ────────────────────────────────────────
  const runStep5 = () => {
    updateStep(5, {
      status: "done",
      msg: `✓ Download ZIP → buka Training → tab "From LoRA Pack" → drop ZIP → Start Training`,
      progress: 100,
    });
  };

  // ── Helper: mark running steps as error ──────────────────────────────────
  const markRunningAsError = (msg: string) => {
    setSteps((prev) => {
      const updated = { ...prev };
      for (const k in updated) {
        if (updated[+k].status === "running") {
          updated[+k] = { ...updated[+k], status: "error", msg: `❌ ${msg}` };
        }
      }
      return updated;
    });
    console.error("[CharacterBuilder] Pipeline error:", msg);
  };

  // ── STEP 1 ONLY — pause and wait for user confirmation ────────────────────
  const runPipeline = async () => {
    setGlobalRunning(true);
    setAwaitingStep1Confirm(false);
    setSteps(initSteps());
    setStep1Image(null);
    setStep2Images([]);
    setStep3Frames([]);
    setStep6Images([]);
    setZipUrl(null);
    setTrainingStatus("idle");
    setTrainingJobId(null);
    setTrainingLoraUrl(null);

    try {
      const s1 = await runStep1();
      setStep1Image(s1);
      saveCache(s1, [], []);
      // PAUSE — show preview, wait for user to confirm before running Step 2
      setAwaitingStep1Confirm(true);
    } catch (err) {
      markRunningAsError(err instanceof Error ? err.message : String(err));
    } finally {
      setGlobalRunning(false);
    }
  };

  // ── REGENERATE STEP 1 — re-run step 1, keep confirm flow ─────────────────
  const regenerateStep1 = async () => {
    setAwaitingStep1Confirm(false);
    setStep1Image(null);
    setGlobalRunning(true);
    setSteps((prev) => ({
      ...prev,
      1: { status: "idle", msg: "", progress: 0 },
    }));
    try {
      const s1 = await runStep1();
      setStep1Image(s1);
      saveCache(s1, [], []);
      setAwaitingStep1Confirm(true);
    } catch (err) {
      markRunningAsError(err instanceof Error ? err.message : String(err));
    } finally {
      setGlobalRunning(false);
    }
  };

  // ── POLL TRAINING STATUS ───────────────────────────────────────────────────
  const pollTrainingStatus = async (jobId: string) => {
    try {
      const res  = await fetch(`/api/train/status?job_id=${encodeURIComponent(jobId)}`);
      if (!res.ok) return; // transient — keep polling
      const data = await res.json() as {
        ok: boolean;
        status: "running" | "done" | "error" | "unknown";
        results?: { ok: boolean; cloudinary_url?: string; lora_name?: string; error?: string }[];
        message: string;
      };
      if (!data.ok) return;
      setTrainingMsg(data.message);
      if (data.status === "done" || data.status === "error") {
        if (trainingPollRef.current)    clearInterval(trainingPollRef.current);
        if (trainingElapsedRef.current) clearInterval(trainingElapsedRef.current);
        trainingPollRef.current    = null;
        trainingElapsedRef.current = null;
        setTrainingStatus(data.status);
        const r = data.results?.[0];
        if (r?.cloudinary_url) setTrainingLoraUrl(r.cloudinary_url);
      }
    } catch { /* ignore transient poll errors */ }
  };

  // ── START AUTO-TRAINING (fire-and-forget) ─────────────────────────────────
  const startAutoTraining = async (frames: string[], captions: string[]) => {
    setTrainingStatus("running");
    setTrainingMsg("⏳ Mengirim dataset ke Modal GPU...");
    setTrainingJobId(null);
    setTrainingPollElapsed(0);
    if (trainingPollRef.current)    clearInterval(trainingPollRef.current);
    if (trainingElapsedRef.current) clearInterval(trainingElapsedRef.current);

    try {
      const res = await fetch("/api/train", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          type:        "actor",
          frames,
          captions,
          productName: characterName,
        }),
      });
      const d = await res.json() as { ok?: boolean; job_id?: string; message?: string; error?: string };
      if (!d.ok || !d.job_id) {
        setTrainingStatus("error");
        setTrainingMsg(`❌ Gagal mulai training: ${d.error ?? "unknown error"}`);
        return;
      }

      setTrainingJobId(d.job_id);
      setTrainingMsg(`⏳ Training berjalan di Modal A100-80GB... (job: ${d.job_id.slice(0, 16)})`);

      // Poll every 15s; first poll after 25s (give Modal time to spin up)
      trainingPollRef.current    = setInterval(() => pollTrainingStatus(d.job_id!), 15000);
      trainingElapsedRef.current = setInterval(() => setTrainingPollElapsed((p) => p + 1), 1000);
      setTimeout(() => pollTrainingStatus(d.job_id!), 25000);
    } catch (e) {
      setTrainingStatus("error");
      setTrainingMsg(`❌ Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // ── CONTINUE FROM STEP 2 (user confirmed Step 1 result) ───────────────────
  const continueFromStep2 = async (s1: string) => {
    setAwaitingStep1Confirm(false);
    setGlobalRunning(true);
    setStep2Images([]);
    setStep3Frames([]);
    setStep6Images([]);
    setZipUrl(null);
    updateStep(2, { status: "running", msg: "Starting...",                     progress: 0 });
    updateStep(3, { status: "idle",    msg: "Waiting for Step 2 back-view...", progress: 0 });
    updateStep(4, { status: "idle",    msg: "",                                progress: 0 });
    updateStep(5, { status: "idle",    msg: "",                                progress: 0 });
    const hasStep6WorkLocal = selectedRoles.length > 0 || selectedMindsets.length > 0 || selectedSkillsets.length > 0;
    updateStep(6, { status: hasStep6WorkLocal ? "idle" : "skip",
                    msg: hasStep6WorkLocal ? "Waiting..." : "No roles or personality scenes selected",
                    progress: 0 });

    try {
      const s2 = await runStep2(s1);
      setStep2Images(s2);

      updateStep(3, { status: "running", msg: "Queued...", progress: 0 });
      const s3 = await runStep3(s1, s2);
      setStep3Frames(s3);

      // ── Step 6: Role scenes (parallel with nothing — runs after step 3) ──
      const s6 = await runStep6(s1, selectedRoles);
      setStep6Images(s6);
      saveCache(s1, s2, s3, s6);  // save after s6 so role scenes are included in cache

      const { url, filename } = await runStep4(s3, s2, s6);
      setZipUrl(url);
      setZipFilename(filename);

      runStep5();

      // ── Auto-start LoRA training with full dataset (face + 360 + roles) ──
      const trainFrames   = s2.map((a) => a.image).concat(s3).concat(s6.map((r) => r.image));
      // Caption strategy: omit physical anchor descriptors — model learns identity from images.
      // Only caption variable context (view, expression, setting). See runStep4 captions comment.
      const trainCaptions = [
        ...s2.map((a) => {
          const exprDef  = ANCHOR_EXPRESSIONS.find((e) => e.id === a.expression);
          const exprDesc = exprDef ? exprDef.prompt : a.expression;
          return `ohwx, ${a.name.toLowerCase()} view, ${exprDesc}, white studio background, professional lighting`;
        }),
        ...s3.map(() =>
          `ohwx, 360 degree rotation, white studio background, professional lighting`
        ),
        ...s6.map((r) => r.caption),  // role captions (corrected format from runStep6)
      ];
      await startAutoTraining(trainFrames, trainCaptions);

    } catch (err) {
      markRunningAsError(err instanceof Error ? err.message : String(err));
    } finally {
      setGlobalRunning(false);
    }
  };

  // ── RETRY STEP 3 — re-run Kling 360° without re-running Steps 1 & 2 ──────
  // Available when Step 3 errors out (e.g. Kling timeout) and Steps 1+2 are cached.
  const retryStep3 = async () => {
    if (!step1Image) return;
    setGlobalRunning(true);
    setPendingKlingTaskId(null);
    updateStep(3, { status: "running", msg: "Retrying Kling 360°...", progress: 0 });
    updateStep(4, { status: "idle",    msg: "",                        progress: 0 });
    updateStep(5, { status: "idle",    msg: "",                        progress: 0 });

    try {
      const s3 = await runStep3(step1Image, step2Images);
      setStep3Frames(s3);
      saveCache(step1Image, step2Images, s3, step6Images);

      const { url, filename } = await runStep4(s3, step2Images, step6Images);
      setZipUrl(url);
      setZipFilename(filename);
      runStep5();

      // Re-start auto training with new frames
      const trainFrames = step2Images.map((a) => a.image)
        .concat(s3)
        .concat(step6Images.map((r) => r.image));
      const trainCaptions = [
        ...step2Images.map((a) => {
          const exprDef  = ANCHOR_EXPRESSIONS.find((e) => e.id === a.expression);
          const exprDesc = exprDef ? exprDef.prompt : a.expression;
          return `ohwx, ${a.name.toLowerCase()} view, ${exprDesc}, white studio background, professional lighting`;
        }),
        ...s3.map(() => `ohwx, 360 degree rotation, white studio background, professional lighting`),
        ...step6Images.map((r) => r.caption),
      ];
      await startAutoTraining(trainFrames, trainCaptions);

    } catch (err) {
      markRunningAsError(err instanceof Error ? err.message : String(err));
    } finally {
      setGlobalRunning(false);
    }
  };

  const downloadZip = () => {
    if (!zipUrl) return;
    const a = document.createElement("a");
    a.href = zipUrl;
    a.download = zipFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const goToTraining = () => {
    // Use in-memory handoff store instead of sessionStorage.
    // sessionStorage has a 5MB limit — 64 angles + 60 frames × ~100KB base64 = ~12MB → overflow.
    // Module-level variable survives same-tab navigation (window.location.href).
    const frames   = step2Images.map((a) => a.image)
      .concat(step3Frames)
      .concat(step6Images.map((r) => r.image));  // include role scenes
    // Caption strategy: omit physical anchor — model learns identity from images, not text.
    const captions = [
      ...step2Images.map((a) => {
        const exprDef = ANCHOR_EXPRESSIONS.find((e) => e.id === a.expression);
        const exprDesc = exprDef ? exprDef.prompt : a.expression;
        return `ohwx, ${a.name.toLowerCase()} view, ${exprDesc}, white studio background, professional lighting`;
      }),
      ...step3Frames.map(() =>
        `ohwx, 360 degree rotation, white studio background, professional lighting`
      ),
      ...step6Images.map((r) => r.caption),
    ];
    setLoraHandoff({
      frames,
      captions,
      productName: characterName,
      source:      "actor_gen",  // signals Training page to use actor LoRA config (2500 steps, rank 32)
      frameCount:  frames.length,
    });
    window.location.href = "/training?from=character-builder";
  };

  const allDone = steps[5].status === "done";

  // ── Personality derived values ─────────────────────────────────────────────
  const personalityCount =
    selectedMindsets.length +
    selectedSkillsets.length +
    (roleModelPreset && roleModelPreset !== "custom" ? 1 : 0) +
    (roleModelPreset === "custom" && roleModelCustomText.trim() ? 1 : 0);

  const hasStep6Work =
    selectedRoles.length > 0 ||
    selectedMindsets.length > 0 ||
    selectedSkillsets.length > 0;

  // ── Cost estimate ──────────────────────────────────────────────────────────
  const klingCost = klingMode === "pro" ? "$0.42" : "$0.14";
  const modalEst  = "~$0.20-0.40"; // 4 expression passes × 16 angles each

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-black dark:text-white flex items-center gap-2">
          <User size={24} className="text-primary" /> Character Builder
        </h1>
        <p className="text-sm text-body mt-1">
          5-step automated pipeline: Text Prompt → 64 Angles (4 expr × 16) → 360° Video → Dataset ZIP → LoRA Training
        </p>
        {cacheStatus === "loaded" && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[11px] text-success flex items-center gap-1">
              <CheckCircle size={12} /> Hasil pipeline di-restore dari cache (IndexedDB)
            </span>
            <button
              onClick={() => {
                clearCharBuilderCache(activeChar.name);
                setStep1Image(null); setStep2Images([]); setStep3Frames([]); setStep6Images([]);
                setZipUrl(null); setSteps(initSteps()); setCacheStatus("none");
              }}
              className="text-[10px] text-danger hover:underline"
            >
              Clear cache
            </button>
          </div>
        )}
        {cacheStatus === "saved" && (
          <p className="text-[11px] text-body mt-1 flex items-center gap-1">
            <CheckCircle size={11} className="text-success" /> Auto-saved ke cache — aman pindah tab
          </p>
        )}
      </div>

      {/* Character selection */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-black dark:text-white text-sm flex items-center gap-2">
          <Sparkles size={15} className="text-primary" /> 1. Pilih Karakter
        </h2>

        {/* Preset chips */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {PRESET_CHARACTERS.map((c) => (
            <button
              key={c.name}
              onClick={() => { setSelectedChar(c); setUseCustom(false); setCustomName(""); }}
              className={`rounded-lg border p-3 text-left transition-all
                ${!useCustom && selectedChar.name === c.name
                  ? "border-primary bg-primary/5"
                  : "border-stroke dark:border-strokedark hover:border-primary/50"
                }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-sm">{c.gender === "female" ? "👩" : "👨"}</span>
                <span className="font-semibold text-sm text-black dark:text-white">{c.name}</span>
              </div>
              <p className="text-[10px] text-body">{c.ethnicity.replace("_", " ")}, {c.age}</p>
              <p className="text-[10px] text-body truncate">{c.outfit}</p>
            </button>
          ))}
        </div>

        {/* Random generate button */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const r = generateRandomCharacter();
              setCustomChar(r);
              setCustomName(r.name);
              setUseCustom(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-dashed border-primary/50 bg-primary/5 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/10 hover:border-primary transition-colors"
          >
            <Sparkles size={14} /> Generate Random Character
          </button>
          {useCustom && customChar && (
            <span className="text-xs text-body">
              {customChar.gender === "female" ? "👩" : "👨"} {customChar.ethnicity}, {customChar.age} · {customChar.outfit}
            </span>
          )}
        </div>

        {/* Character name editor — always visible, allows renaming any char */}
        <div>
          <label className="form-label text-[11px]">Nama Karakter</label>
          <div className="flex gap-2">
            <input
              className="form-input flex-1 text-sm"
              value={customName || (useCustom && customChar ? customChar.name : selectedChar.name)}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Nama karakter untuk LoRA..."
            />
            <button
              onClick={() => setCustomName("")}
              title="Reset ke nama default"
              className="flex-shrink-0 rounded border border-stroke dark:border-strokedark px-2.5 py-1.5 text-xs text-body hover:border-primary hover:text-primary transition-colors"
            >
              <RefreshCw size={13} />
            </button>
          </div>
          <p className="text-[10px] text-body mt-1">Nama ini dipakai untuk file LoRA dan dataset ZIP.</p>
        </div>

        {/* Active char prompt preview */}
        <div className="rounded border border-primary/20 bg-primary/5 p-3">
          <p className="text-[10px] font-semibold text-primary uppercase tracking-wide mb-1">
            Prompt for: <strong>{activeChar.name}</strong>
            {useCustom && customChar && (
              <span className="ml-2 text-[9px] font-normal text-primary/60 normal-case">
                ({customChar.ethnicity}, {customChar.age})
              </span>
            )}
          </p>
          <p className="text-[11px] text-body font-mono leading-relaxed">{buildCharacterPrompt(activeChar)}</p>
        </div>

        {/* Kling settings */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label text-[11px]">Kling Mode (Step 3)</label>
            <div className="flex rounded border border-stroke dark:border-strokedark overflow-hidden">
              {(["std", "pro"] as const).map((m) => (
                <button key={m} onClick={() => setKlingMode(m)}
                  className={`flex-1 py-1.5 text-xs font-medium transition-colors
                    ${klingMode === m ? "bg-primary text-white" : "bg-white dark:bg-boxdark text-body hover:bg-gray"}`}>
                  {m === "std" ? `Std (${klingCost})` : `Pro (${klingCost})`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="form-label text-[11px]">Frames dari 360° video</label>
            <select className="form-select text-sm" value={numFrames} onChange={(e) => setNumFrames(+e.target.value)}>
              <option value={32}>32 frames</option>
              <option value={48}>48 frames</option>
              <option value={60}>60 frames (recommended)</option>
              <option value={80}>80 frames</option>
            </select>
          </div>
        </div>

        {/* Cost summary */}
        <div className="flex items-center gap-2 rounded border border-stroke dark:border-strokedark bg-gray/50 dark:bg-meta-4/50 px-3 py-2">
          <Info size={12} className="text-body flex-shrink-0" />
          <p className="text-[10px] text-body">
            Estimated cost: Modal {modalEst} (4 expr parallel) + Kling {klingCost}
            {selectedRoles.length > 0 && ` + ~$${(selectedRoles.length * 0.03).toFixed(2)} (${selectedRoles.length} roles × 6 scenes)`}
            &nbsp;≈ <strong className="text-black dark:text-white">~${(parseFloat(klingCost.replace("$","")) + 0.30 + selectedRoles.length * 0.03).toFixed(2)} total</strong>
            &nbsp;· ⚡ ~{8 + selectedRoles.length * 2}–{12 + selectedRoles.length * 2} min
          </p>
        </div>

        {/* ── Step 6: Role Packs (Living Character) ── */}
        <div className="pt-1">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-xs font-semibold text-black dark:text-white flex items-center gap-1.5">
                <Zap size={12} className="text-primary" />
                Step 6 — Role Scenes <span className="text-body font-normal">(opsional)</span>
              </p>
              <p className="text-[10px] text-body mt-0.5">
                Tambah konteks role agar karakter &ldquo;hidup&rdquo; sebagai AI Agent (CEO, CMO, dll). ~6 scene per role.
              </p>
            </div>
            {selectedRoles.length > 0 && (
              <button onClick={() => setSelectedRoles([])}
                className="text-[10px] text-danger hover:underline flex-shrink-0">
                Clear all
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {ROLE_PACKS.map((pack) => {
              const active = selectedRoles.includes(pack.id);
              return (
                <button
                  key={pack.id}
                  onClick={() => setSelectedRoles((prev) =>
                    prev.includes(pack.id) ? prev.filter((id) => id !== pack.id) : [...prev, pack.id]
                  )}
                  disabled={globalRunning}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed
                    ${active
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-stroke dark:border-strokedark text-body hover:border-primary/40"
                    }`}
                >
                  <span className="text-base leading-none">{pack.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold truncate">{pack.label}</p>
                    <p className="text-[9px] text-body/70">{pack.scenes.length} scenes</p>
                  </div>
                  {active && <CheckCircle size={13} className="flex-shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>

          {selectedRoles.length > 0 && (
            <p className="text-[10px] text-primary mt-2 flex items-center gap-1">
              <CheckCircle size={11} />
              {selectedRoles.length} role dipilih · {selectedRoles.reduce((acc, id) => {
                const pack = ROLE_PACKS.find((p) => p.id === id);
                return acc + (pack?.scenes.length ?? 0);
              }, 0)} scenes akan di-generate di Step 6
            </p>
          )}
        </div>

        {/* ── Character Personality (optional) ── */}
        <div className="pt-1 border-t border-stroke dark:border-strokedark">
          {/* Collapsible header */}
          <button
            onClick={() => setPersonalityOpen((v) => !v)}
            disabled={globalRunning}
            className="flex w-full items-center justify-between py-2 text-left disabled:opacity-40"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-black dark:text-white">
                🧠 Character Personality
              </span>
              <span className="text-body font-normal text-[10px]">(opsional)</span>
              {personalityCount > 0 && (
                <span className="ml-1 rounded-full bg-primary text-white text-[9px] font-bold px-1.5 py-0.5 leading-none">
                  {personalityCount}
                </span>
              )}
            </div>
            {personalityOpen
              ? <ChevronDown size={14} className="text-body flex-shrink-0" />
              : <ChevronRight size={14} className="text-body flex-shrink-0" />
            }
          </button>

          {personalityOpen && (
            <div className="space-y-4 pt-1 pb-2">
              <p className="text-[10px] text-body">
                Personality di-embed ke <code>character_profile.json</code> dan menghasilkan AI Agent system prompt
                (OpenAI / Claude / Gemini). Mindset + Skillset juga generate scene training tambahan di Step 6.
              </p>

              {/* ── Mindset chips ────────────────────────────────────────── */}
              <div>
                <p className="text-[11px] font-semibold text-black dark:text-white mb-1.5">Mindset</p>
                <div className="flex flex-wrap gap-1.5">
                  {MINDSET_OPTIONS.map((m) => {
                    const active = selectedMindsets.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        onClick={() => setSelectedMindsets((prev) =>
                          prev.includes(m.id) ? prev.filter((id) => id !== m.id) : [...prev, m.id]
                        )}
                        disabled={globalRunning}
                        className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed
                          ${active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-stroke dark:border-strokedark text-body hover:border-primary/40"
                          }`}
                      >
                        <span className="leading-none">{m.icon}</span>
                        {m.label}
                        {active && <CheckCircle size={11} className="ml-0.5 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
                {selectedMindsets.length > 0 && (
                  <p className="text-[9px] text-body mt-1">
                    {selectedMindsets.length} mindset · +{selectedMindsets.length} scene di Step 6
                  </p>
                )}
              </div>

              {/* ── Skillset chips ───────────────────────────────────────── */}
              <div>
                <p className="text-[11px] font-semibold text-black dark:text-white mb-1.5">Skillset</p>
                <div className="flex flex-wrap gap-1.5">
                  {SKILLSET_OPTIONS.map((s) => {
                    const active = selectedSkillsets.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedSkillsets((prev) =>
                          prev.includes(s.id) ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                        )}
                        disabled={globalRunning}
                        className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed
                          ${active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-stroke dark:border-strokedark text-body hover:border-primary/40"
                          }`}
                      >
                        <span className="leading-none">{s.icon}</span>
                        {s.label}
                        {active && <CheckCircle size={11} className="ml-0.5 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
                {selectedSkillsets.length > 0 && (
                  <p className="text-[9px] text-body mt-1">
                    {selectedSkillsets.length} skill · +{selectedSkillsets.length} scene di Step 6
                  </p>
                )}
              </div>

              {/* ── Role Model ───────────────────────────────────────────── */}
              <div>
                <p className="text-[11px] font-semibold text-black dark:text-white mb-1.5">
                  Role Model <span className="font-normal text-body">(pengaruhi system prompt saja, tidak generate gambar)</span>
                </p>
                <div className="grid grid-cols-2 gap-1.5 mb-2">
                  {ROLE_MODEL_PRESETS.map((r) => {
                    const active = roleModelPreset === r.id;
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          setRoleModelPreset(active ? "" : r.id);
                          if (r.id !== "custom") setRoleModelCustomText("");
                        }}
                        disabled={globalRunning}
                        className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[11px] transition-all disabled:opacity-40 disabled:cursor-not-allowed
                          ${active
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-stroke dark:border-strokedark text-body hover:border-primary/40"
                          }`}
                      >
                        <span className="text-base leading-none flex-shrink-0">{r.icon}</span>
                        <span className="font-medium truncate">{r.name}</span>
                        {active && <CheckCircle size={11} className="ml-auto flex-shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
                {roleModelPreset === "custom" && (
                  <input
                    className="form-input w-full text-sm"
                    value={roleModelCustomText}
                    onChange={(e) => setRoleModelCustomText(e.target.value)}
                    placeholder="e.g. Nadiem Makarim, Gary Vee, atau deskripsikan kualitasnya..."
                    disabled={globalRunning}
                  />
                )}
              </div>

              {/* Copy system prompt — shown when any personality set */}
              {personalityCount > 0 && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
                  <p className="text-[10px] font-semibold text-primary">🤖 AI Agent System Prompt Ready</p>
                  <p className="text-[9px] text-body">
                    Compatible dengan OpenAI, Claude, dan Gemini. Juga di-embed di character_profile.json.
                  </p>
                  <button
                    onClick={() => {
                      const prompt = buildAgentSystemPrompt({
                        characterName,
                        gender:        activeChar.gender,
                        ethnicity:     activeChar.ethnicity,
                        age:           activeChar.age,
                        roles:         selectedRoles,
                        mindsets:      selectedMindsets,
                        skillsets:     selectedSkillsets,
                        roleModelId:   roleModelPreset,
                        roleModelText: roleModelCustomText,
                      });
                      navigator.clipboard.writeText(prompt).catch(() => {/* fail silently */});
                    }}
                    className="flex items-center gap-1.5 rounded border border-primary/40 bg-white dark:bg-boxdark px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/5 transition-colors"
                  >
                    📋 Copy System Prompt to Clipboard
                  </button>
                </div>
              )}

            </div>
          )}
        </div>
      </div>

      {/* Pipeline steps */}
      <div className="card p-5 space-y-3">
        <h2 className="font-semibold text-black dark:text-white text-sm mb-4 flex items-center gap-2">
          <Film size={15} className="text-primary" /> Pipeline Progress
        </h2>

        <StepBadge n={1} status={steps[1].status} label="Text → Image"
          sub={steps[1].msg || `Flux Dev · 1:1 · white studio · ${activeChar.name}`} />

        {steps[1].status === "running" && (
          <ProgressBar value={steps[1].progress} label={steps[1].msg} />
        )}

        {/* ── Step 1 confirmation panel — pause sebelum lanjut ke Step 2 ── */}
        {awaitingStep1Confirm && step1Image && (
          <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-4 space-y-3">
            <p className="text-sm font-semibold text-black dark:text-white flex items-center gap-2">
              <CheckCircle size={15} className="text-success" />
              Step 1 selesai — cek gambar karakter sebelum lanjut ke Step 2
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={step1Image} alt="Step 1 preview"
              className="w-56 h-56 object-cover rounded-lg border-2 border-primary/30 mx-auto block shadow-sm" />
            <p className="text-xs text-body text-center">Apakah gambar karakter sudah sesuai?</p>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={regenerateStep1} disabled={globalRunning}
                className="flex items-center justify-center gap-2 rounded border border-stroke dark:border-strokedark px-4 py-2.5 text-sm font-medium text-body hover:border-warning hover:text-warning disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                <RefreshCcw size={14} /> Generate Ulang
              </button>
              <button onClick={() => continueFromStep2(step1Image)} disabled={globalRunning}
                className="btn-primary flex items-center justify-center gap-2 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed">
                <Play size={14} /> Lanjut ke Step 2 →
              </button>
            </div>
            <p className="text-[10px] text-body/60 text-center">
              ⚠ Step 2–5 + training membutuhkan ~8–12 menit dan biaya ~$0.35. Pastikan gambar sudah benar.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <StepBadge n={2} status={steps[2].status} label="64 Angles (4 expr × 16 parallel)"
              sub={steps[2].msg || "⚡ 4 Modal containers parallel → ~4× lebih cepat"} />
          </div>
          <span className="text-body text-xs">→</span>
          <div className="flex-1">
            <StepBadge n={3} status={steps[3].status} label={`Kling 360° → ${numFrames} frames`}
              sub={steps[3].msg || `Kling ${klingMode.toUpperCase()} · start+end frame guided`} />
          </div>
        </div>

        {(steps[2].status === "running") && (
          <ProgressBar value={steps[2].progress} label={steps[2].msg} />
        )}
        {(steps[3].status === "running") && (
          <ProgressBar value={steps[3].progress} label={steps[3].msg} />
        )}
        {/* Pending task ID pill — shown while auto-polling Kling */}
        {pendingKlingTaskId && steps[3].status === "running" && (
          <p className="text-[10px] text-body/60 text-center font-mono">
            Kling task: {pendingKlingTaskId}
          </p>
        )}
        {/* Retry Step 3 button — shown when Step 3 errors out but Steps 1+2 are cached */}
        {steps[3].status === "error" && step1Image && (
          <button
            onClick={retryStep3}
            disabled={globalRunning}
            className="w-full text-sm px-4 py-2 rounded-lg bg-warning/10 border border-warning/30
                       text-warning hover:bg-warning/20 disabled:opacity-40 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2 transition-colors"
          >
            <span>🔄</span> Retry Step 3 (Kling 360°) — tanpa re-run Step 1 &amp; 2
          </button>
        )}

        {/* Step 6 — shown if roles or personality scenes selected */}
        {hasStep6Work && (
          <>
            <StepBadge n={6} status={steps[6].status}
              label={`Role + Personality Scenes (${selectedRoles.length} roles · ${selectedMindsets.length + selectedSkillsets.length} personality)`}
              sub={steps[6].msg || `🎭 ${selectedRoles.map((id) => ROLE_PACKS.find((p) => p.id === id)?.icon ?? "").join(" ")} ${selectedRoles.map((id) => ROLE_PACKS.find((p) => p.id === id)?.label ?? id).join(", ")}`} />
            {steps[6].status === "running" && (
              <ProgressBar value={steps[6].progress} label={steps[6].msg} />
            )}
          </>
        )}

        <StepBadge n={4} status={steps[4].status}
          label={`Build ZIP (64 angles + ${numFrames} frames${selectedRoles.length > 0 ? ` + ${selectedRoles.reduce((a, id) => a + (ROLE_PACKS.find((p) => p.id === id)?.scenes.length ?? 0), 0)} role scenes` : ""})`}
          sub={steps[4].msg || `${64 + numFrames + (selectedRoles.length > 0 ? selectedRoles.reduce((a, id) => a + (ROLE_PACKS.find((p) => p.id === id)?.scenes.length ?? 0), 0) : 0)} total images + captions.txt`} />

        {steps[4].status === "running" && (
          <ProgressBar value={steps[4].progress} label={steps[4].msg} />
        )}

        <StepBadge n={5} status={steps[5].status} label="LoRA Training Ready"
          sub={steps[5].msg || "Download ZIP → Training page → From LoRA Pack"} />

        {/* Run button — hidden when awaitingStep1Confirm (confirmation panel shown instead) */}
        {!globalRunning && !awaitingStep1Confirm ? (
          <button
            onClick={runPipeline}
            className="btn-primary w-full py-3 mt-2 flex items-center justify-center gap-2"
          >
            <Play size={16} />
            Run Pipeline untuk {activeChar.name}
          </button>
        ) : globalRunning ? (
          <button disabled className="btn-primary w-full py-3 mt-2 flex items-center justify-center gap-2 opacity-60 cursor-not-allowed">
            <Loader2 size={16} className="animate-spin" />
            Pipeline berjalan... jangan tutup tab ini
          </button>
        ) : null /* awaitingStep1Confirm — tombol ada di confirmation panel di atas */}
      </div>

      {/* Results */}
      {(step1Image || step2Images.length > 0 || step3Frames.length > 0 || step6Images.length > 0) && (
        <div className="card p-5 space-y-5">
          <h2 className="font-semibold text-black dark:text-white text-sm flex items-center gap-2">
            <CheckCircle size={15} className="text-success" /> Hasil Pipeline
          </h2>

          {/* Step 1 result */}
          {step1Image && (
            <div>
              <p className="text-xs font-semibold text-body mb-2">Step 1 · Base Image</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={step1Image} alt={`${characterName} base`}
                className="w-32 h-32 object-cover rounded border border-stroke dark:border-strokedark" />
            </div>
          )}

          {/* Step 2 results — grouped by expression */}
          {step2Images.length > 0 && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-body">
                Step 2 · {step2Images.length} Angle Images ({ANCHOR_EXPRESSIONS.length} ekspresi × 16 angle)
              </p>
              {ANCHOR_EXPRESSIONS.map((expr) => {
                const exprImages = step2Images.filter((a) => a.expression === expr.id);
                if (exprImages.length === 0) return null;
                return (
                  <div key={expr.id}>
                    <p className="text-[10px] font-semibold text-primary mb-1 capitalize">
                      {expr.label} — {exprImages.length} angles
                    </p>
                    <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
                      {exprImages.map((a, i) => (
                        <div key={i} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={a.image} alt={a.name} title={`${expr.label}: ${a.name}`}
                            className="w-full aspect-square object-cover rounded border border-stroke dark:border-strokedark" />
                          <p className="text-[7px] text-body text-center truncate mt-0.5">{a.name}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Step 3 results */}
          {step3Frames.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-body mb-2">Step 3 · {step3Frames.length} frames dari 360° video</p>
              <div className="grid grid-cols-6 sm:grid-cols-10 gap-1">
                {step3Frames.slice(0, 20).map((f, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={f} alt={`frame ${i+1}`}
                    className="w-full aspect-square object-cover rounded border border-stroke/50" />
                ))}
                {step3Frames.length > 20 && (
                  <div className="w-full aspect-square rounded border border-stroke/50 flex items-center justify-center text-[10px] text-body bg-gray dark:bg-meta-4">
                    +{step3Frames.length - 20}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 6 results — role scene images grouped by role */}
          {step6Images.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-body mb-2">
                Step 6 · {step6Images.length} Role Scenes
              </p>
              {/* Group by role */}
              {[...new Set(step6Images.map((r) => r.roleId))].map((roleId) => {
                const pack     = ROLE_PACKS.find((p) => p.id === roleId);
                const roleImgs = step6Images.filter((r) => r.roleId === roleId);
                return (
                  <div key={roleId} className="mb-3">
                    <p className="text-[10px] text-body/70 mb-1">
                      {pack?.icon} {pack?.label} ({roleImgs.length} scenes)
                    </p>
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                      {roleImgs.map((r, i) => (
                        <div key={i} className="group relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.image} alt={r.label}
                            className="w-full aspect-square object-cover rounded border border-stroke/50" />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded flex items-end p-1">
                            <p className="text-[8px] text-white leading-tight">{r.sceneId.replace(/_/g, " ")}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ZIP Download + Go to Training */}
      {allDone && zipUrl && (
        <div className="card p-5 space-y-4 border-success/30 bg-success/5">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-success/15 p-2">
              <CheckCircle size={20} className="text-success" />
            </div>
            <div>
              <p className="font-semibold text-black dark:text-white">Dataset {characterName} siap!</p>
              <p className="text-xs text-body">
                {64 + numFrames + step6Images.length} images
                (64 angles + {numFrames} frames{step6Images.length > 0 ? ` + ${step6Images.length} role scenes` : ""})
                · {zipFilename}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button onClick={downloadZip}
              className="flex items-center justify-center gap-2 rounded border border-success/40 bg-success/10 px-4 py-3 text-sm font-medium text-success hover:bg-success/15 transition-colors">
              <Download size={16} /> Download ZIP
            </button>
            <button onClick={goToTraining}
              className="flex items-center justify-center gap-2 rounded border border-primary/40 bg-primary/10 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/15 transition-colors">
              <ArrowRight size={16} /> Lihat di Training Page
            </button>
          </div>
        </div>
      )}

      {/* ── Auto LoRA Training Panel ─────────────────────────────────────── */}
      {trainingStatus !== "idle" && (
        <div className={`card p-5 space-y-4 ${
          trainingStatus === "done"  ? "border-success/30 bg-success/5" :
          trainingStatus === "error" ? "border-danger/30 bg-danger/5"   :
          "border-primary/20"
        }`}>
          <h2 className="font-semibold text-black dark:text-white text-sm flex items-center gap-2">
            <Zap size={15} className="text-primary" /> LoRA Training — {characterName}
          </h2>

          {/* Running */}
          {trainingStatus === "running" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-primary" />
                <span className="text-sm text-body">{trainingMsg}</span>
              </div>
              {trainingJobId && (
                <div className="space-y-1.5 text-xs text-body">
                  <div className="flex justify-between">
                    <span>Job ID:</span>
                    <code className="font-mono text-primary text-[10px]">{trainingJobId}</code>
                  </div>
                  <div className="flex justify-between">
                    <span>Elapsed:</span>
                    <span className="font-mono">{Math.floor(trainingPollElapsed / 60)}m {trainingPollElapsed % 60}s</span>
                  </div>
                </div>
              )}
              {/* Progress bar — estimate 20 min = 1200s for actor */}
              <div className="w-full bg-gray dark:bg-meta-4 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-1000"
                  style={{ width: `${Math.min(95, (trainingPollElapsed / 1200) * 100)}%` }}
                />
              </div>
              <div className="flex gap-2">
                <p className="text-[10px] text-body/60 flex-1">
                  ℹ Training ~15–25 menit di Modal A100-80GB. Anda bisa navigasi ke halaman lain — training tetap berjalan.
                </p>
                <button onClick={goToTraining}
                  className="flex-shrink-0 flex items-center gap-1 text-[10px] text-primary hover:underline">
                  <ArrowRight size={11} /> Monitor di Training Page
                </button>
              </div>
            </div>
          )}

          {/* Done */}
          {trainingStatus === "done" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-success">
                <CheckCircle size={16} />
                <span className="text-sm font-medium">{trainingMsg}</span>
              </div>
              {trainingLoraUrl && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-semibold text-success/80 uppercase tracking-wide">LoRA URL (Cloudinary):</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-[10px] bg-black/10 dark:bg-white/10 rounded px-2 py-1 truncate font-mono text-success">
                      {trainingLoraUrl}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(trainingLoraUrl)}
                      className="flex-shrink-0 rounded border border-success/40 px-2 py-1 text-[10px] font-semibold hover:bg-success/10 transition-colors text-success">
                      Copy
                    </button>
                  </div>
                  <p className="text-[10px] text-success/70">
                    Paste URL ini di TikTok Ads → Actor Mode → &quot;LoRA Trained&quot; → upload
                  </p>
                </div>
              )}
              {/* Download dataset ZIP — includes images + captions + character_profile.json + README.md */}
              {zipUrl && (
                <div className="pt-1">
                  <button
                    onClick={downloadZip}
                    className="w-full flex items-center justify-center gap-2 rounded border border-success/50 bg-success/10 px-4 py-2.5 text-sm font-semibold text-success hover:bg-success/20 transition-colors">
                    <Download size={15} /> Download Dataset ZIP
                  </button>
                  <p className="text-[10px] text-body/50 text-center mt-1">
                    Berisi: images · captions.txt · character_profile.json · README.md
                  </p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-body/60">Elapsed: {Math.floor(trainingPollElapsed / 60)}m {trainingPollElapsed % 60}s</span>
              </div>
            </div>
          )}

          {/* Error */}
          {trainingStatus === "error" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-danger">
                <AlertCircle size={16} />
                <span className="text-sm">{trainingMsg}</span>
              </div>
              <button onClick={goToTraining}
                className="flex items-center gap-2 text-xs text-primary hover:underline">
                <ArrowRight size={12} /> Coba manual di Training Page
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

