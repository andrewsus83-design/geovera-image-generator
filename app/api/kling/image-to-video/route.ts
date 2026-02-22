/**
 * POST /api/kling/image-to-video
 *
 * Converts a base64 image to a video using Kling AI v1.5 API.
 *
 * Body JSON:
 *   image_b64      string  — base64 image (PNG/JPEG)
 *   prompt         string  — motion description (optional)
 *   negative_prompt string — what to avoid (optional)
 *   duration       number  — 5 | 10  (seconds, default 5)
 *   aspect_ratio   string  — "9:16" | "16:9" | "1:1" (default "9:16")
 *   mode           string  — "std" | "pro" (default "std")
 *   cfg_scale      number  — 0.5 (default) — creativity vs prompt adherence
 *
 * Returns:
 *   { task_id, status, video_url?, cover_url?, message }
 *
 * Kling workflow:
 *   1. POST /v1/images/generations  → returns task_id
 *   2. Poll GET /v1/images/generations/{task_id} until status = "succeed"
 *   3. Return video URL from works[0].resource.video.resource
 */

import { NextRequest, NextResponse } from "next/server";
import { sign } from "@/lib/kling-jwt";

const KLING_BASE = "https://api.klingai.com";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const accessKey     = (process.env.KLING_ACCESS_KEY ?? "").trim();
  const secretKey     = (process.env.KLING_SECRET_KEY ?? "").trim();

  if (!accessKey || !secretKey) {
    return NextResponse.json(
      { error: "Kling API keys not configured. Set KLING_ACCESS_KEY and KLING_SECRET_KEY in .env.local" },
      { status: 500 },
    );
  }

  const {
    image_b64,
    prompt         = "",
    negative_prompt = "blurry, distorted, watermark, text",
    duration        = 5,
    aspect_ratio    = "9:16",
    mode            = "std",
    cfg_scale       = 0.5,
  } = body;

  if (!image_b64) {
    return NextResponse.json({ error: "image_b64 is required" }, { status: 400 });
  }

  try {
    // Strip data URL prefix if present — Kling expects raw base64 only
    const rawB64 = image_b64.includes(",") ? image_b64.split(",")[1] : image_b64;

    const token = sign(accessKey, secretKey);

    // ── Step 1: Submit image-to-video task ──────────────────────────────
    const submitRes = await fetch(`${KLING_BASE}/v1/videos/image2video`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        model_name:     mode === "pro" ? "kling-v1-5-pro" : "kling-v1-5",
        image:          rawB64,
        prompt,
        negative_prompt,
        cfg_scale,
        mode:           mode === "pro" ? "pro" : "std",
        duration: String(duration),
        aspect_ratio,
      }),
    });

    const submitData = await submitRes.json() as {
      code: number;
      message: string;
      request_id: string;
      data?: { task_id: string; task_status: string };
    };

    if (!submitRes.ok || submitData.code !== 0) {
      console.error("Kling submit error:", submitData);
      return NextResponse.json(
        { error: `Kling API error: ${submitData.message ?? submitRes.statusText}` },
        { status: submitRes.status },
      );
    }

    const task_id = submitData.data!.task_id;

    // ── Step 2: Poll until done (max 180s, poll every 3s) ───────────────
    const maxWait   = 180_000;  // 3 minutes
    const pollEvery = 3_000;    // 3 seconds
    const deadline  = Date.now() + maxWait;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollEvery));

      const pollToken = sign(accessKey, secretKey);  // token renew each poll
      const pollRes   = await fetch(`${KLING_BASE}/v1/videos/image2video/${task_id}`, {
        headers: { "Authorization": `Bearer ${pollToken}` },
      });

      const pollData = await pollRes.json() as {
        code:    number;
        message: string;
        data?: {
          task_id:     string;
          task_status: string;        // "submitted" | "processing" | "succeed" | "failed"
          task_status_msg?: string;
          created_at:  number;
          updated_at:  number;
          task_result?: {
            videos?: {
              id:          string;
              url:         string;
              duration:    string;
            }[];
          };
        };
      };

      if (pollData.code !== 0) {
        return NextResponse.json(
          { error: `Kling poll error: ${pollData.message}` },
          { status: 500 },
        );
      }

      const d = pollData.data!;

      if (d.task_status === "succeed") {
        const video = d.task_result?.videos?.[0];
        return NextResponse.json({
          task_id,
          status:    "succeed",
          video_url: video?.url ?? null,
          duration:  video?.duration ?? null,
          message:   "Video generated successfully",
        });
      }

      if (d.task_status === "failed") {
        return NextResponse.json(
          { task_id, status: "failed", error: d.task_status_msg ?? "Generation failed" },
          { status: 500 },
        );
      }

      // Still processing — continue polling
      console.log(`Kling task ${task_id}: ${d.task_status}`);
    }

    // Timeout — return task_id so client can poll manually
    return NextResponse.json(
      { task_id, status: "processing", message: "Still processing — use /api/kling/video-status to poll" },
      { status: 202 },
    );

  } catch (err) {
    console.error("Kling error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
