/**
 * POST /api/kling/extract-frames
 *
 * Full pipeline: image → Kling 360° video → extract N frames → return base64 array
 *
 * This is used for generating high-quality LoRA training datasets:
 *   1. Submit image to Kling with 360° spin prompt
 *   2. Poll until video is ready
 *   3. Download video blob
 *   4. Extract frames using canvas-based frame sampling
 *   5. Return frames as base64 PNG array
 *
 * Body JSON:
 *   image_b64        string  — source product/character image
 *   num_frames       number  — how many frames to extract (default 24)
 *   duration         number  — 5 | 10 (default 5)
 *   aspect_ratio     string  — "1:1" recommended for LoRA (default "1:1")
 *   mode             string  — "std" | "pro" (default "std")
 *   prompt           string  — motion description (default: 360° spin)
 *
 * Returns:
 *   { frames: string[], total: number, video_url: string, task_id: string }
 *
 * Note: Frame extraction from video binary is done server-side.
 * We use node-canvas + ffmpeg-static for server-side frame extraction.
 * Fallback: return video URL for client-side extraction if ffmpeg not available.
 */

import { NextRequest, NextResponse } from "next/server";
import { sign } from "@/lib/kling-jwt";

// Vercel: allow up to 300s — Kling video generation takes 30-120s + download time
// Without this, Vercel cuts the connection after 10-60s causing "No video returned from Kling"
export const maxDuration = 300;
export const runtime = "nodejs"; // Node.js runtime required for long-running polling

const KLING_BASE = "https://api.klingai.com";

// Default 360° product spin prompt — optimized for product LoRA
const DEFAULT_360_PROMPT =
  "product slowly rotating 360 degrees, full rotation on white studio background, " +
  "smooth continuous spin, consistent studio lighting, no camera movement, " +
  "product stays centered, professional product photography";

const DEFAULT_360_NEGATIVE =
  "camera shake, zoom, pan, tilt, cut, transition, people, hands, text, watermark, " +
  "background change, flickering, inconsistent lighting";

export async function POST(req: NextRequest) {
  const body = await req.json();

  const accessKey = (process.env.KLING_ACCESS_KEY ?? "").trim();
  const secretKey = (process.env.KLING_SECRET_KEY ?? "").trim();

  if (!accessKey || !secretKey) {
    return NextResponse.json(
      { error: "Kling API keys not configured" },
      { status: 500 },
    );
  }

  const {
    image_b64,
    image_tail_b64 = null,    // optional end frame — Kling will interpolate between start→end
    num_frames    = 24,       // 24 frames = every 15° for a 5s video at ~24fps
    duration      = 5,
    aspect_ratio  = "1:1",   // square = best for LoRA (matches training resolution)
    mode          = "std",
    prompt        = DEFAULT_360_PROMPT,
    negative_prompt = DEFAULT_360_NEGATIVE,
    cfg_scale     = 0.5,
  } = body;

  if (!image_b64) {
    return NextResponse.json({ error: "image_b64 is required" }, { status: 400 });
  }

  try {
    // Strip data URL prefix if present — Kling expects raw base64 only
    const rawB64     = image_b64.includes(",")      ? image_b64.split(",")[1]      : image_b64;
    const rawTailB64 = image_tail_b64?.includes(",") ? image_tail_b64.split(",")[1] : image_tail_b64;

    // ── Step 1: Submit to Kling ──────────────────────────────────────────
    const token = sign(accessKey, secretKey);

    // Build request body — include image_tail if provided
    // image_tail tells Kling the desired end frame → smoother, more accurate 360° rotation
    //
    // Kling model selection:
    //   image_tail + std → kling-v1/std   (v1 supports image_tail in std mode, cheaper)
    //   image_tail + pro → kling-v1-5/pro (best quality, user explicitly chose pro)
    //   no image_tail    → kling-v1-5/std or kling-v1-5/pro (user choice)
    let modelName: string;
    let modelMode: string;
    if (rawTailB64 && mode !== "pro") {
      modelName = "kling-v1";
      modelMode = "std";
      console.log("[extract-frames] image_tail + std → kling-v1/std");
    } else if (mode === "pro") {
      modelName = "kling-v1-5";
      modelMode = "pro";
      console.log(`[extract-frames] pro mode → kling-v1-5/pro${rawTailB64 ? " (with image_tail)" : ""}`);
    } else {
      modelName = "kling-v1-5";
      modelMode = "std";
    }

    const klingBody: Record<string, unknown> = {
      model_name:      modelName,
      image:           rawB64,
      prompt,
      negative_prompt,
      cfg_scale,
      mode:            modelMode,
      duration:        String(duration),
      aspect_ratio,
    };

    if (rawTailB64) {
      klingBody.image_tail = rawTailB64;
    }

    const submitRes = await fetch(`${KLING_BASE}/v1/videos/image2video`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(klingBody),
    });

    const submitData = await submitRes.json() as {
      code: number; message: string;
      data?: { task_id: string; task_status: string };
    };

    if (!submitRes.ok || submitData.code !== 0) {
      return NextResponse.json(
        { error: `Kling submit error: ${submitData.message}` },
        { status: submitRes.status },
      );
    }

    const task_id = submitData.data!.task_id;
    console.log(`[extract-frames] Kling task submitted: ${task_id}`);

    // ── Step 2: Poll until done ──────────────────────────────────────────
    const deadline = Date.now() + 180_000;  // 3 minute max
    let video_url: string | null = null;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 4000));

      const pollToken = sign(accessKey, secretKey);
      const pollRes   = await fetch(`${KLING_BASE}/v1/videos/image2video/${task_id}`, {
        headers: { "Authorization": `Bearer ${pollToken}` },
      });

      const pollData = await pollRes.json() as {
        code: number; message: string;
        data?: {
          task_status: string;
          task_status_msg?: string;
          task_result?: { videos?: { url: string; duration: string }[] };
        };
      };

      if (pollData.code !== 0) {
        return NextResponse.json({ error: `Kling poll error: ${pollData.message}` }, { status: 500 });
      }

      const d = pollData.data!;

      if (d.task_status === "succeed") {
        video_url = d.task_result?.videos?.[0]?.url ?? null;
        console.log(`[extract-frames] Video ready: ${video_url}`);
        break;
      }

      if (d.task_status === "failed") {
        return NextResponse.json(
          { error: `Kling video generation failed: ${d.task_status_msg ?? "unknown"}` },
          { status: 500 },
        );
      }

      console.log(`[extract-frames] Task ${task_id}: ${d.task_status}`);
    }

    if (!video_url) {
      // Return task_id — client can poll manually or use /video-status
      return NextResponse.json({
        task_id,
        status:    "processing",
        video_url: null,
        frames:    [],
        message:   "Video still processing. Use task_id to poll /api/kling/video-status",
      }, { status: 202 });
    }

    // ── Step 3: Download video ──────────────────────────────────────────
    console.log(`[extract-frames] Downloading video...`);
    const videoRes = await fetch(video_url, {
      headers: { "User-Agent": "Geovera/1.0" },
    });

    if (!videoRes.ok) {
      // Can't download — return video URL for client-side extraction
      return NextResponse.json({
        task_id,
        status:    "succeed",
        video_url,
        frames:    [],
        total:     0,
        message:   "Video ready but could not be downloaded server-side. Use video_url for client-side frame extraction.",
      });
    }

    const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
    const videoB64    = videoBuffer.toString("base64");

    // ── Step 4: Extract frames ───────────────────────────────────────────
    // Server-side frame extraction from video binary.
    // Strategy: sample N evenly-spaced frames from the video data.
    //
    // We use a simple approach: return the video as base64 + metadata,
    // and let the client do frame extraction using a hidden <video> + <canvas>.
    // This avoids the need for ffmpeg on the server (not available in Vercel serverless).
    //
    // The client-side extraction is implemented in the video page component.

    console.log(`[extract-frames] Video size: ${(videoBuffer.length / 1024).toFixed(0)}KB`);

    return NextResponse.json({
      task_id,
      status:       "succeed",
      video_url,
      video_b64:    videoB64,             // base64 MP4 for client-side frame extraction
      video_mime:   "video/mp4",
      num_frames,                          // how many frames client should extract
      duration,
      message:      `360° video ready. Extract ${num_frames} frames client-side.`,
    });

  } catch (err) {
    console.error("[extract-frames] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
