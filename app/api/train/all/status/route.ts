/**
 * GET /api/train/all/status?job_id=<id>
 *
 * Proxy to Modal train-all-characters-endpoint ASGI app, GET /status route.
 * Returns current training job status from Modal Dict.
 *
 * Response JSON:
 *   { ok, job_id, status, results, total_time, total_cost_usd, message }
 */

import { NextRequest, NextResponse } from "next/server";

function getModalTrainAllBaseUrl(): string {
  return (
    process.env.MODAL_TRAIN_ALL_URL ??
    "https://andrewsus83-design--train-all-characters-endpoint.modal.run"
  );
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("job_id");

    if (!jobId) {
      return NextResponse.json(
        { error: "job_id query param is required" },
        { status: 400 },
      );
    }

    // ASGI app: GET /status?job_id=<id>
    const baseUrl  = getModalTrainAllBaseUrl();
    const statusUrl = `${baseUrl}/status?job_id=${encodeURIComponent(jobId)}`;

    const modalRes = await fetch(statusUrl, {
      method:  "GET",
      headers: { "Accept": "application/json" },
    });

    if (!modalRes.ok) {
      const errText = await modalRes.text();
      console.error(`[train/all/status] Modal returned ${modalRes.status}:`, errText.slice(0, 300));
      return NextResponse.json(
        { error: `Modal status error: ${modalRes.status}`, detail: errText.slice(0, 200) },
        { status: 502 },
      );
    }

    const result = await modalRes.json() as {
      ok?:              boolean;
      job_id?:          string;
      status?:          "running" | "done" | "error";
      results?:         {
        name: string; gpu: string; ok: boolean;
        lora_name?: string; cloudinary_url?: string;
        steps?: number; time?: number; cost_usd?: number; error?: string;
      }[];
      characters?:      { name: string; gpu: string }[];
      total_time?:      number;
      total_cost_usd?:  number;
      parallel_speedup?: number;
      started_at?:      number;
      message?:         string;
      error?:           string;
    };

    return NextResponse.json({
      ok:              result.ok ?? false,
      job_id:          result.job_id ?? jobId,
      status:          result.status ?? "unknown",
      results:         result.results ?? [],
      characters:      result.characters ?? [],
      total_time:      result.total_time ?? null,
      total_cost_usd:  result.total_cost_usd ?? null,
      parallel_speedup: result.parallel_speedup ?? null,
      started_at:      result.started_at ?? null,
      message:         result.message ?? result.error ?? "",
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[train/all/status] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
