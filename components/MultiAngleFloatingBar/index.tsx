"use client";
/**
 * MultiAngleFloatingBar — floating job status bar yang muncul di semua halaman
 * saat ada Multi-Angle generation yang sedang berjalan atau baru selesai.
 *
 * - Running: progress bar kuning + "Generating 16 angles..."
 * - Done:    hijau + "✓ 16 angles ready" + tombol "Lihat Hasil"
 * - Error:   merah + pesan error + tombol "Retry"
 * - Dismiss: user bisa tutup manual (hanya saat done/error)
 */

import Link from "next/link";
import { CheckCircle, AlertCircle, X, Layers } from "lucide-react";
import { useMultiAngle } from "@/context/MultiAngleContext";

export default function MultiAngleFloatingBar() {
  const { job, resetJob } = useMultiAngle();

  // Tidak tampil saat idle
  if (job.status === "idle") return null;

  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-[9990]
        w-[min(480px,calc(100vw-2rem))] rounded-xl shadow-2xl border overflow-hidden
        transition-all duration-300
        ${job.status === "running" ? "border-warning/40 bg-boxdark"    : ""}
        ${job.status === "done"    ? "border-success/40 bg-boxdark"    : ""}
        ${job.status === "error"   ? "border-danger/40  bg-boxdark"    : ""}
      `}
    >
      {/* Progress bar — top edge */}
      {job.status === "running" && (
        <div className="h-0.5 bg-warning/20">
          <div
            className="h-full bg-warning transition-all duration-400 ease-out"
            style={{ width: `${job.progress}%` }}
          />
        </div>
      )}
      {job.status === "done"  && <div className="h-0.5 bg-success" />}
      {job.status === "error" && <div className="h-0.5 bg-danger"  />}

      <div className="flex items-center gap-3 px-4 py-3">
        {/* Icon */}
        <div className="flex-shrink-0">
          {job.status === "running" && (
            <div className="loader" style={{ width: 16, height: 16, borderWidth: 2, borderTopColor: "rgb(var(--color-warning))" }} />
          )}
          {job.status === "done"  && <CheckCircle size={16} className="text-success" />}
          {job.status === "error" && <AlertCircle size={16} className="text-danger"  />}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Layers size={11} className="text-bodydark flex-shrink-0" />
            <p className="text-[10px] text-bodydark uppercase tracking-wide font-medium truncate">
              Multi-Angle {job.qualityLabel && `· ${job.qualityLabel}`}
            </p>
          </div>
          <p className={`text-xs font-medium truncate
            ${job.status === "running" ? "text-warning" : ""}
            ${job.status === "done"    ? "text-success" : ""}
            ${job.status === "error"   ? "text-danger"  : ""}
          `}>
            {job.message}
          </p>
        </div>

        {/* Progress % — running only */}
        {job.status === "running" && (
          <span className="flex-shrink-0 text-xs font-mono text-warning">{Math.round(job.progress)}%</span>
        )}

        {/* Actions — done */}
        {job.status === "done" && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href="/multi-angle"
              className="rounded-lg bg-success/10 border border-success/30 px-3 py-1.5 text-xs font-semibold text-success hover:bg-success/20 transition-colors"
            >
              Lihat Hasil →
            </Link>
            <button
              onClick={resetJob}
              className="rounded-full p-1 text-bodydark hover:text-white transition-colors"
              title="Tutup"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Actions — error */}
        {job.status === "error" && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href="/multi-angle"
              className="rounded-lg bg-danger/10 border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger hover:bg-danger/20 transition-colors"
            >
              Retry →
            </Link>
            <button
              onClick={resetJob}
              className="rounded-full p-1 text-bodydark hover:text-white transition-colors"
              title="Tutup"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
