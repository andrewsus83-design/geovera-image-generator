/**
 * GET /api/kling/video-status?task_id=xxx
 *
 * Poll Kling video generation task status.
 * Returns current status + video URL when complete.
 */

import { NextRequest, NextResponse } from "next/server";
import { sign } from "@/lib/kling-jwt";

const KLING_BASE = "https://api.klingai.com";

export async function GET(req: NextRequest) {
  const task_id   = req.nextUrl.searchParams.get("task_id");
  const accessKey = (process.env.KLING_ACCESS_KEY ?? "").trim();
  const secretKey = (process.env.KLING_SECRET_KEY ?? "").trim();

  if (!task_id)   return NextResponse.json({ error: "task_id required" }, { status: 400 });
  if (!accessKey) return NextResponse.json({ error: "Kling keys not configured" }, { status: 500 });

  try {
    const token   = sign(accessKey, secretKey);
    const pollRes = await fetch(`${KLING_BASE}/v1/videos/image2video/${task_id}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    const pollData = await pollRes.json() as {
      code:    number;
      message: string;
      data?: {
        task_id:     string;
        task_status: string;
        task_status_msg?: string;
        task_result?: {
          videos?: { id: string; url: string; duration: string }[];
        };
      };
    };

    if (pollData.code !== 0) {
      return NextResponse.json({ error: pollData.message }, { status: 500 });
    }

    const d     = pollData.data!;
    const video = d.task_result?.videos?.[0];

    return NextResponse.json({
      task_id:   d.task_id,
      status:    d.task_status,
      video_url: video?.url    ?? null,
      duration:  video?.duration ?? null,
      message:   d.task_status_msg ?? "",
    });

  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
