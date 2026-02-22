/**
 * POST /api/train/all
 *
 * Proxy to Modal train-all-characters-endpoint (ASGI app, POST to /).
 * Fire-and-forget: Modal returns { ok, job_id } immediately (<1s).
 * Browser then polls /api/train/all/status?job_id=... every 12s.
 *
 * Body JSON:
 *   characters  array  — [{ name, type, frames, captions, steps, lr, rank }]
 *
 * Returns immediately:
 *   { ok, job_id, message, characters }
 */

import { NextRequest, NextResponse } from "next/server";

// Short timeout — endpoint returns job_id immediately (fire-and-forget)
export const maxDuration = 30;

function getModalTrainAllUrl(): string {
  return (
    process.env.MODAL_TRAIN_ALL_URL ??
    "https://andrewsus83-design--train-all-characters-endpoint.modal.run"
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      characters?: {
        name: string;
        type: "actor" | "prop";
        frames: string[];
        captions: string[];
        steps: number;
        lr: number;
        rank: number;
      }[];
    };

    const { characters = [] } = body;

    if (!characters || characters.length === 0) {
      return NextResponse.json(
        { error: "No characters provided. Upload at least 1 ZIP before training." },
        { status: 400 },
      );
    }

    // ASGI app: POST to root path "/"
    const trainAllUrl = getModalTrainAllUrl();

    console.log(`[train/all] Fire-and-forget: ${characters.length} characters → Modal`);
    characters.forEach((c) => {
      console.log(`  • ${c.name}: ${c.frames.length} images, ${c.steps} steps`);
    });

    const modalRes = await fetch(trainAllUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ characters }),
    });

    if (!modalRes.ok) {
      const errText = await modalRes.text();
      console.error(`[train/all] Modal returned ${modalRes.status}:`, errText.slice(0, 500));
      return NextResponse.json(
        { error: `Modal error: ${modalRes.status}`, detail: errText.slice(0, 300) },
        { status: 502 },
      );
    }

    const result = await modalRes.json() as {
      ok?: boolean;
      job_id?: string;
      message?: string;
      characters?: string[];
      error?: string;
    };

    if (!result.ok || !result.job_id) {
      return NextResponse.json(
        { error: result.error ?? "Modal tidak mengembalikan job_id" },
        { status: 500 },
      );
    }

    console.log(`[train/all] Job started: ${result.job_id}`);

    return NextResponse.json({
      ok:         true,
      job_id:     result.job_id,
      message:    result.message ?? `⏳ Training dimulai. Poll status dengan job_id.`,
      characters: result.characters ?? [],
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[train/all] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
