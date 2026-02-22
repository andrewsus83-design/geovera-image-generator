"use client";
/**
 * MultiAngleContext — global job state untuk Multi-Angle generation.
 *
 * Kenapa perlu context?
 * Next.js me-unmount page component saat navigasi. Tanpa context, fetch() yang
 * sedang berjalan tidak dibatalkan (fetch tetap jalan di browser) tapi state-nya
 * hilang — user tidak bisa lihat progress lagi.
 *
 * Solusi: simpan seluruh job state di context yang mount 1x di layout.tsx.
 * Page /multi-angle hanya baca & tulis ke context. Ketika user pindah halaman
 * lalu kembali, state masih ada dan hasil langsung muncul.
 *
 * Floating status bar di dashboard/layout.tsx membaca context ini untuk
 * menampilkan progress di halaman mana saja.
 */

import { createContext, useContext, useRef, useState, useCallback, ReactNode } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export type AngleResult = {
  angle_idx:  number;
  angle_name: string;
  angle_desc: string;
  image:      string;
  time:       number;
  seed:       number;
  strength?:  number;
  qc_passed?: boolean;   // Gemini QC result (undefined = QC disabled)
  qc_reason?: string;    // e.g. "pass", "wrong angle", "subject not visible"
};

export type JobStatus = "idle" | "running" | "done" | "error";

export interface MultiAngleJob {
  status:       JobStatus;
  message:      string;
  progress:     number;          // 0-100
  angles:       AngleResult[];   // results so far
  totalTime:    number | null;
  description:  string;          // shown in floating bar
  qualityLabel: string;          // e.g. "Better · Flux Schnell"
  gpuLabel:     string;          // e.g. "Fast · H100"
}

interface MultiAngleContextValue {
  job:        MultiAngleJob;
  setJob:     (update: Partial<MultiAngleJob> | ((prev: MultiAngleJob) => Partial<MultiAngleJob>)) => void;
  resetJob:   () => void;
}

// ── Default state ──────────────────────────────────────────────────────────

const DEFAULT_JOB: MultiAngleJob = {
  status:       "idle",
  message:      "",
  progress:     0,
  angles:       [],
  totalTime:    null,
  description:  "",
  qualityLabel: "",
  gpuLabel:     "",
};

// ── Context ────────────────────────────────────────────────────────────────

const MultiAngleContext = createContext<MultiAngleContextValue | null>(null);

export function MultiAngleProvider({ children }: { children: ReactNode }) {
  const [job, setJobState] = useState<MultiAngleJob>(DEFAULT_JOB);

  // Progress timer ref — lives in context so it survives page navigation
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const setJob = useCallback(
    (update: Partial<MultiAngleJob> | ((prev: MultiAngleJob) => Partial<MultiAngleJob>)) => {
      setJobState((prev) => {
        const patch = typeof update === "function" ? update(prev) : update;
        const next  = { ...prev, ...patch };

        // Auto-manage progress animation
        if (patch.status === "running" && prev.status !== "running") {
          // Start progress timer
          if (progressTimer.current) clearInterval(progressTimer.current);
          progressTimer.current = setInterval(() => {
            setJobState((s) => {
              const p = s.progress;
              let delta = 0;
              if (p < 20) delta = 2;
              else if (p < 50) delta = 1;
              else if (p < 75) delta = 0.4;
              else if (p < 85) delta = 0.1;
              if (delta === 0) return s;
              return { ...s, progress: Math.min(s.progress + delta, 85) };
            });
          }, 400);
        }

        if (patch.status && patch.status !== "running") {
          // Stop progress timer
          if (progressTimer.current) {
            clearInterval(progressTimer.current);
            progressTimer.current = null;
          }
        }

        return next;
      });
    },
    [],
  );

  const resetJob = useCallback(() => {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
    setJobState(DEFAULT_JOB);
  }, []);

  return (
    <MultiAngleContext.Provider value={{ job, setJob, resetJob }}>
      {children}
    </MultiAngleContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useMultiAngle(): MultiAngleContextValue {
  const ctx = useContext(MultiAngleContext);
  if (!ctx) throw new Error("useMultiAngle must be used inside MultiAngleProvider");
  return ctx;
}
