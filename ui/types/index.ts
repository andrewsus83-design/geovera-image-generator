// ── Generation Types ────────────────────────────────────────────

export type GenerationMode = "actor" | "prop" | "actor+prop";
export type ActorMode = "source" | "trained" | "random";
export type PropMode = "upload" | "trained";
export type ScreenRatio = "9:16" | "4:3" | "1:1" | "16:9" | "3:4";
export type FluxVariant = "dev" | "schnell";
export type ContinuityArc = "journey" | "transformation" | "adventure" | "emotion";
export type GpuType = "any" | "rtx3090" | "rtx3090ti" | "rtx4080" | "rtx4090" | "rtx5090" | "a100" | "h100";
export type JobStatus = "idle" | "queued" | "running" | "done" | "error";

export interface GenerationParams {
  // Mode
  mode: GenerationMode;

  // Actor
  actorMode: ActorMode;
  actorSourceFile?: File | null;
  actorLoraPath?: string;
  gender: "female" | "male" | "non_binary";
  ethnicity: string;
  age: string;
  features: string[];
  subject?: string;

  // Prop
  propMode: PropMode;
  propSourceFile?: File | null;
  propLoraPath?: string;
  propDesc?: string;
  propPosition: string;
  propScale: number;

  // Generation
  themes: number[] | "all";
  screen: ScreenRatio;
  numImages: number;
  color: string;
  strength: number;
  seed: number;
  useFlux: boolean;
  fluxVariant: FluxVariant;

  // Continuity
  continuity: boolean;
  continuityArc: ContinuityArc;

  // Serverless
  serverless: boolean;
  vastEndpoint?: string;
  vastKey?: string;
  gpu: GpuType;

  // Upload
  uploadToSupabase: boolean;
}

// ── Theme Types ─────────────────────────────────────────────────

export interface TikTokTheme {
  id: number;
  name: string;
  description: string;
  mood: string;
  lighting: string;
  color_palette: string;
}

export interface ScreenRatioInfo {
  width: number;
  height: number;
  label: string;
}

export interface ColorPalette {
  label: string;
  hex: string | null;
}

export interface ContinuityArcInfo {
  label: string;
  description: string;
  beats: string[];
}

// ── GPU Types ───────────────────────────────────────────────────

export interface GpuInfo {
  name: string;
  vram_gb: number | null;
  price_hr: number | null;
  tier: "budget" | "mid" | "high" | "auto";
  flux_dev_s?: number;
  flux_schnell_s?: number;
  sdxl_s?: number;
}

export interface CostEstimate {
  gpu: string;
  num_images: number;
  model: string;
  seconds_per_image: number;
  total_seconds: number;
  total_minutes: string;
  estimated_cost: string;
  price_per_hr: string;
}

// ── Job / Result Types ──────────────────────────────────────────

export interface GenerationJob {
  id: string;
  status: JobStatus;
  progress: number;
  total: number;
  message: string;
  createdAt: string;
  params: Partial<GenerationParams>;
  results?: GeneratedImage[];
  error?: string;
}

export interface GeneratedImage {
  id: string;
  jobId: string;
  themeId: number;
  themeName: string;
  filename: string;
  url: string;
  width: number;
  height: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

// ── Dashboard Stats ─────────────────────────────────────────────

export interface DashboardStats {
  totalGenerated: number;
  totalJobs: number;
  successRate: number;
  avgTime: number;
  recentJobs: GenerationJob[];
}
