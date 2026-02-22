/**
 * GET /api/train/status?job_id=<id>
 *
 * Proxy to Modal train-single-endpoint ASGI app, GET /status route.
 * Returns current training job status from Modal Dict (geovera-train-jobs).
 *
 * This is the single-character equivalent of /api/train/all/status.
 * Both share the same Modal Dict, so one polling endpoint handles both.
 *
 * Response JSON:
 *   { ok, job_id, status, results, total_time, total_cost_usd, message,
 *     current_step, total_steps, loss, eta_min, elapsed_min }
 *
 *   status: "running" | "done" | "error" | "unknown"
 *   results: [{
 *     name, gpu, ok, lora_name, cloudinary_url, steps, time, cost_usd, error
 *   }]
 *   current_step, total_steps: live training step progress (available during "running")
 *   loss, eta_min, elapsed_min: live training metrics from Modal Dict
 */

import { NextRequest, NextResponse } from "next/server";

// Short timeout — just a quick poll
export const maxDuration = 30;

// Reuses train-all-characters-endpoint's /status route (same Modal Dict store)
function getModalTrainSingleBaseUrl(): string {
  return (
    process.env.MODAL_TRAIN_ALL_URL ??
    "https://andrewsus83-design--train-all-characters-endpoint.modal.run"
  );
}

export async function GET(req: NextRequest) {
  try {
    // Use nextUrl (always absolute) instead of new URL(req.url) which throws
    // "The string did not match the expected pattern" when req.url is relative
    const { searchParams } = req.nextUrl;
    const jobId = searchParams.get("job_id");

    if (!jobId) {
      return NextResponse.json(
        { error: "job_id query param is required" },
        { status: 400 },
      );
    }

    // Poll Modal Dict via ASGI endpoint GET /status
    const baseUrl   = getModalTrainSingleBaseUrl();
    const statusUrl = `${baseUrl}/status?job_id=${encodeURIComponent(jobId)}`;

    const modalRes = await fetch(statusUrl, {
      method:  "GET",
      headers: { "Accept": "application/json" },
    });

    if (!modalRes.ok) {
      const errText = await modalRes.text();
      console.error(`[train/status] Modal returned ${modalRes.status}:`, errText.slice(0, 300));
      return NextResponse.json(
        { error: `Modal status error: ${modalRes.status}`, detail: errText.slice(0, 200) },
        { status: 502 },
      );
    }

    const result = await modalRes.json() as {
      ok?:             boolean;
      job_id?:         string;
      status?:         "running" | "done" | "error" | "unknown";
      results?:        {
        name: string; gpu: string; ok: boolean;
        lora_name?: string; lora_path?: string; cloudinary_url?: string;
        steps?: number; time?: number; cost_usd?: number;
        message?: string; error?: string;
      }[];
      total_time?:     number;
      total_cost_usd?: number;
      started_at?:     number;
      message?:        string;
      error?:          string;
      // Live training step progress — updated every log_every steps in modal_app.py
      current_step?:   number;
      total_steps?:    number;
      loss?:           number;
      eta_min?:        number;
      elapsed_min?:    number;
    };

    return NextResponse.json({
      ok:              result.ok ?? false,
      job_id:          result.job_id ?? jobId,
      status:          result.status ?? "unknown",
      results:         result.results ?? [],
      total_time:      result.total_time ?? null,
      total_cost_usd:  result.total_cost_usd ?? null,
      started_at:      result.started_at ?? null,
      message:         result.message ?? result.error ?? "",
      // Live training progress (null when not yet available)
      current_step:    result.current_step  ?? null,
      total_steps:     result.total_steps   ?? null,
      loss:            result.loss          ?? null,
      eta_min:         result.eta_min       ?? null,
      elapsed_min:     result.elapsed_min   ?? null,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[train/status] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
