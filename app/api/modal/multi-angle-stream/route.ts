/**
 * SSE Proxy: /api/modal/multi-angle-stream
 *
 * Why proxy instead of direct browser→Modal?
 * Modal SSE endpoints need the Authorization header (CORS blocks credentials).
 * This proxy runs server-side, forwards the POST body, and pipes the SSE stream
 * back to the browser with proper headers.
 *
 * Flow:
 *   Browser (EventSource POST polyfill) → Next.js proxy → Modal SSE endpoint
 *                                      ← angle events ←
 */

import { NextRequest } from "next/server";

// IMPORTANT: Do NOT use "edge" runtime here.
// Edge runtime has a hard 25s CPU timeout — it cannot stream long SSE jobs.
// Node.js runtime supports up to 300s (Vercel Pro) and proper streaming.
export const runtime = "nodejs";

// 300s — Modal streams 16 angles (each ~8-15s GPU) = up to ~4 min worst case
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Route to H100 (fast) or H200 (turbo) based on gpu_speed field
  const gpuSpeed = (body.gpu_speed as string) ?? "fast";
  const modalUrl =
    gpuSpeed === "turbo"
      ? (process.env.NEXT_PUBLIC_MODAL_MULTI_ANGLE_STREAM_TURBO_URL ??
         "https://andrewsus83-design--multi-angle-stream-turbo-endpoint.modal.run")
      : (process.env.NEXT_PUBLIC_MODAL_MULTI_ANGLE_STREAM_URL ??
         "https://andrewsus83-design--multi-angle-stream-endpoint.modal.run");

  // Forward request to Modal
  const modalRes = await fetch(modalUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });

  if (!modalRes.ok || !modalRes.body) {
    const errText = await modalRes.text().catch(() => "unknown error");
    return new Response(
      `data: ${JSON.stringify({ event: "error", message: `Modal ${modalRes.status}: ${errText.slice(0, 200)}` })}\n\n`,
      {
        status: 200, // keep 200 so EventSource doesn't close
        headers: {
          "Content-Type":  "text/event-stream",
          "Cache-Control": "no-cache",
          Connection:      "keep-alive",
        },
      },
    );
  }

  // Pipe Modal's SSE stream directly to the browser
  return new Response(modalRes.body, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
