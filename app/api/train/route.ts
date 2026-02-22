/**
 * POST /api/train
 *
 * Fire-and-forget proxy to Modal train-single-endpoint.
 * Returns { ok, job_id } immediately (< 1s).
 * Browser then polls /api/train/status?job_id=... every 12s.
 *
 * Why fire-and-forget?
 *   LoRA training takes 15-40 min on A100-80GB.
 *   Vercel has a 300s max — we'd timeout waiting for result.
 *   The new Modal ASGI endpoint returns job_id immediately,
 *   training runs in a Modal background thread, and the browser polls.
 *
 * Body JSON:
 *   type          string   — "actor" | "prop"
 *   frames        string[] — base64 PNG images
 *   captions      string[] — one caption per image
 *   productName   string   — used for output filename
 *   steps         number   — training steps (actor: 2500, prop: 800)
 *   lr            string   — learning rate (actor: "2e-5", prop: "1e-4")
 *   rank          number   — LoRA rank (actor: 32, prop: 16)
 *
 * Returns immediately:
 *   { ok, job_id, message }
 */

import { NextRequest, NextResponse } from "next/server";

// Short timeout — endpoint returns job_id immediately (fire-and-forget)
export const maxDuration = 30;

// Uses /single sub-route of train-all-characters-endpoint ASGI app
// (avoids the 8-endpoint free-plan limit — no separate endpoint needed)
function getModalTrainSingleUrl(): string {
  const base = process.env.MODAL_TRAIN_ALL_URL ??
    "https://andrewsus83-design--train-all-characters-endpoint.modal.run";
  return `${base}/single`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      type?: string;
      frames?: string[];
      captions?: string[];
      productName?: string;
      steps?: number;
      lr?: string | number;
      rank?: number;
      outputDir?: string;
      source?: string;
    };

    const {
      type        = "actor",
      frames      = [],
      captions    = [],
      productName = "character",
      steps,
      lr,
      rank,
    } = body;

    if (!frames || frames.length === 0) {
      return NextResponse.json(
        { error: "No frames provided. Upload images before starting training." },
        { status: 400 },
      );
    }

    const trainSingleUrl = getModalTrainSingleUrl();

    // Defaults per type if not overridden — aligned with modal_app.py Flux best practices
    const defaultSteps = type === "actor" ? 2500 : 800;
    const defaultLr    = type === "actor" ? 2e-5  : 1e-4;
    const defaultRank  = type === "actor" ? 32    : 16;

    const payload = {
      type,
      frames,
      captions,
      product_name: productName,
      steps:        steps ?? defaultSteps,
      lr:           lr ? parseFloat(String(lr)) : defaultLr,
      rank:         rank ?? defaultRank,
    };

    console.log(`[train] Fire-and-forget: ${frames.length} images → Modal train-single-endpoint (${type}, ${payload.steps} steps)`);

    // POST to Modal ASGI endpoint — returns job_id immediately (< 1s)
    const modalRes = await fetch(trainSingleUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });

    if (!modalRes.ok) {
      const errText = await modalRes.text();
      console.error(`[train] Modal returned ${modalRes.status}:`, errText.slice(0, 500));
      return NextResponse.json(
        { error: `Modal error: ${modalRes.status}`, detail: errText.slice(0, 300) },
        { status: 502 },
      );
    }

    const result = await modalRes.json() as {
      ok?:     boolean;
      job_id?: string;
      message?: string;
      error?:  string;
    };

    if (!result.ok || !result.job_id) {
      return NextResponse.json(
        { error: result.error ?? "Modal did not return job_id" },
        { status: 500 },
      );
    }

    console.log(`[train] Job started: ${result.job_id}`);

    return NextResponse.json({
      ok:      true,
      job_id:  result.job_id,
      message: result.message ?? `⏳ Training dimulai. Poll status dengan job_id.`,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[train] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
