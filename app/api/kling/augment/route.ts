/**
 * POST /api/kling/augment
 *
 * "Consistent Augmentation" — dari 1 foto real, generate N video pendek
 * dengan motion prompt berbeda, lalu ambil 1 frame terbaik dari tiap video.
 *
 * Hasilnya: 1 foto original + N synthetic = N+1 gambar konsisten untuk LoRA.
 *
 * Body JSON:
 *   image_b64    string   — base64 source image (1 foto real)
 *   product_name string   — nama produk untuk caption
 *   mode         string   — "std" | "pro" (default "std")
 *   num_augments number   — berapa banyak augmentasi (1-9, default 9)
 *   frame_pick   string   — "first" | "mid" | "last" (default "mid")
 *
 * Returns (streaming NDJSON):
 *   { event: "progress", index: N, total: N, status: "submitting"|"polling"|"done" }
 *   { event: "frame",    index: N, image_b64: string, caption: string, prompt_used: string }
 *   { event: "done",     total_frames: N, elapsed: N }
 *   { event: "error",    message: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { sign } from "@/lib/kling-jwt";

const KLING_BASE = "https://api.klingai.com";

// 9 motion prompts yang berbeda — masing-masing menghasilkan sudut/tampilan berbeda
// tapi tetap konsisten karena semua dari image yang sama
const AUGMENT_PROMPTS: { prompt: string; caption_suffix: string }[] = [
  {
    prompt: "product gently rotating left, slow smooth motion, white studio background, professional lighting",
    caption_suffix: "slight left rotation view",
  },
  {
    prompt: "product gently rotating right, slow smooth motion, white studio background, professional lighting",
    caption_suffix: "slight right rotation view",
  },
  {
    prompt: "slow zoom in on product, white studio background, professional product photography",
    caption_suffix: "close-up detail view",
  },
  {
    prompt: "slow zoom out revealing full product, white studio background, professional lighting",
    caption_suffix: "full product reveal view",
  },
  {
    prompt: "product with soft golden hour lighting from left side, white background, gentle ambient light",
    caption_suffix: "warm side lighting view",
  },
  {
    prompt: "product with cool blue studio lighting from right side, white background, dramatic shadows",
    caption_suffix: "cool side lighting view",
  },
  {
    prompt: "product floating slightly upward, soft glow, white studio background, ethereal product shot",
    caption_suffix: "elevated floating view",
  },
  {
    prompt: "slow parallax motion, depth of field, white background, cinematic product photography",
    caption_suffix: "cinematic parallax view",
  },
  {
    prompt: "product with overhead top-down perspective shift, white studio background, flat lay style",
    caption_suffix: "top-down perspective view",
  },
];

async function submitKlingTask(
  image_b64: string,
  prompt: string,
  mode: string,
  accessKey: string,
  secretKey: string,
): Promise<string> {
  // Strip data URL prefix if present — Kling expects raw base64 only
  const rawB64 = image_b64.includes(",") ? image_b64.split(",")[1] : image_b64;

  const token = sign(accessKey, secretKey);
  const res = await fetch(`${KLING_BASE}/v1/videos/image2video`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      model_name:      mode === "pro" ? "kling-v1-5-pro" : "kling-v1-5",
      image:           rawB64,
      prompt,
      negative_prompt: "blurry, distorted, watermark, text, people, hands, background change, flickering",
      cfg_scale:       0.5,
      mode:            mode === "pro" ? "pro" : "std",
      duration:        "5",
      aspect_ratio:    "1:1",
    }),
  });

  const data = await res.json() as {
    code: number; message: string;
    data?: { task_id: string };
  };

  if (!res.ok || data.code !== 0) {
    throw new Error(`Kling submit error: ${data.message}`);
  }

  return data.data!.task_id;
}

async function pollKlingTask(
  task_id: string,
  accessKey: string,
  secretKey: string,
  maxWaitMs = 180_000,
): Promise<string> {
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));

    const token  = sign(accessKey, secretKey);
    const pollRes = await fetch(`${KLING_BASE}/v1/videos/image2video/${task_id}`, {
      headers: { "Authorization": `Bearer ${token}` },
    });

    const pollData = await pollRes.json() as {
      code: number; message: string;
      data?: {
        task_status: string;
        task_status_msg?: string;
        task_result?: { videos?: { url: string }[] };
      };
    };

    if (pollData.code !== 0) throw new Error(`Kling poll error: ${pollData.message}`);

    const d = pollData.data!;
    if (d.task_status === "succeed") {
      const url = d.task_result?.videos?.[0]?.url;
      if (!url) throw new Error("Kling returned succeed but no video URL");
      return url;
    }
    if (d.task_status === "failed") {
      throw new Error(`Kling failed: ${d.task_status_msg ?? "unknown"}`);
    }
  }

  throw new Error("Kling task timeout");
}

// Download video dan ambil 1 frame sebagai base64 PNG
// frame_pick: "first" = 5%, "mid" = 50%, "last" = 90%
async function downloadAndPickFrame(
  video_url: string,
  frame_pick: "first" | "mid" | "last",
): Promise<string | null> {
  try {
    const res = await fetch(video_url, { headers: { "User-Agent": "Geovera/1.0" } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Return video as base64 — client will pick the frame
    // We include frame_pick so client knows which timestamp to use
    return buf.toString("base64");
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  const accessKey = (process.env.KLING_ACCESS_KEY ?? "").trim();
  const secretKey = (process.env.KLING_SECRET_KEY ?? "").trim();

  if (!accessKey || !secretKey) {
    return NextResponse.json({ error: "Kling API keys not configured" }, { status: 500 });
  }

  const {
    image_b64,
    product_name  = "product",
    mode          = "std",
    num_augments  = 9,
    frame_pick    = "mid",
  } = body;

  if (!image_b64) {
    return NextResponse.json({ error: "image_b64 is required" }, { status: 400 });
  }

  const count = Math.min(Math.max(1, num_augments), 9);
  const prompts = AUGMENT_PROMPTS.slice(0, count);

  // ── Streaming response (NDJSON) ──────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      try {
        // Submit semua task ke Kling dulu (parallel) untuk hemat waktu
        send({ event: "progress", phase: "submitting", message: `Submitting ${count} tasks to Kling...`, total: count });

        const taskIds: string[] = [];
        for (let i = 0; i < prompts.length; i++) {
          try {
            const task_id = await submitKlingTask(
              image_b64,
              prompts[i].prompt,
              mode,
              accessKey,
              secretKey,
            );
            taskIds.push(task_id);
            send({ event: "submitted", index: i, task_id, total: count });
            // Small delay antara submit agar tidak rate-limit
            await new Promise((r) => setTimeout(r, 500));
          } catch (err) {
            send({ event: "submit_error", index: i, message: err instanceof Error ? err.message : "Submit failed" });
            taskIds.push(""); // placeholder
          }
        }

        send({ event: "progress", phase: "polling", message: `All tasks submitted. Polling for results...`, total: count });

        // Poll semua task secara sequential (Kling rate limit)
        let doneCount = 0;
        for (let i = 0; i < taskIds.length; i++) {
          const task_id = taskIds[i];
          if (!task_id) {
            doneCount++;
            continue;
          }

          try {
            send({ event: "polling", index: i, task_id, done: doneCount, total: count });

            const video_url = await pollKlingTask(task_id, accessKey, secretKey, 180_000);

            // Download video dan kirim sebagai base64
            send({ event: "downloading", index: i, done: doneCount, total: count });
            const video_b64 = await downloadAndPickFrame(video_url, frame_pick as "first" | "mid" | "last");

            const caption = `${product_name}, ${prompts[i].caption_suffix}, white background, studio lighting`;

            send({
              event:        "frame",
              index:        i,
              video_b64,           // client extract 1 frame
              video_url,
              video_mime:   "video/mp4",
              frame_pick,
              caption,
              prompt_used:  prompts[i].prompt,
              caption_suffix: prompts[i].caption_suffix,
            });

            doneCount++;
            send({ event: "progress", phase: "polling", done: doneCount, total: count, message: `${doneCount}/${count} done` });

          } catch (err) {
            send({ event: "frame_error", index: i, message: err instanceof Error ? err.message : "Unknown error" });
            doneCount++;
          }
        }

        send({ event: "done", total_frames: doneCount, message: "All augmentations complete" });

      } catch (err) {
        send({ event: "error", message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
