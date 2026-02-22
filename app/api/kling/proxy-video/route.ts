/**
 * GET /api/kling/proxy-video?url=<encoded_kling_cdn_url>
 *
 * Proxy for downloading Kling CDN videos client-side.
 * Kling CDN URLs have CORS restrictions that prevent direct browser fetch.
 * This route fetches the video server-side and streams it back to the client.
 *
 * Security: Only allows URLs from Kling/KlingAI CDN domains.
 */

import { NextRequest, NextResponse } from "next/server";

// Allowed CDN domains for Kling videos
const ALLOWED_DOMAINS = [
  "klingai.com",
  "cdn.klingai.com",
  "p16-klingai.byteimg.com",
  "p19-klingai.byteimg.com",
  "p3-klingai.byteimg.com",
  "kling-video.kuaishou.com",
];

export const maxDuration = 60;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json({ error: "url parameter required" }, { status: 400 });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  // Security: only allow known Kling CDN domains
  const hostname = parsedUrl.hostname.toLowerCase();
  const isAllowed = ALLOWED_DOMAINS.some(
    (d) => hostname === d || hostname.endsWith(`.${d}`)
  );

  if (!isAllowed) {
    console.warn(`[proxy-video] Blocked domain: ${hostname}`);
    return NextResponse.json({ error: "domain not allowed" }, { status: 403 });
  }

  try {
    const videoRes = await fetch(rawUrl, {
      headers: {
        "User-Agent":  "Geovera/1.0",
        "Referer":     "https://klingai.com/",
        "Accept":      "video/mp4,video/*,*/*",
      },
    });

    if (!videoRes.ok) {
      console.error(`[proxy-video] Failed to fetch video: ${videoRes.status} ${videoRes.statusText}`);
      return NextResponse.json(
        { error: `Video download failed: ${videoRes.status}` },
        { status: 502 },
      );
    }

    const contentType = videoRes.headers.get("content-type") ?? "video/mp4";
    const buf = await videoRes.arrayBuffer();

    console.log(`[proxy-video] Proxied ${(buf.byteLength / 1024).toFixed(0)}KB from ${hostname}`);

    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type":        contentType,
        "Content-Length":      String(buf.byteLength),
        "Cache-Control":       "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });

  } catch (err) {
    console.error("[proxy-video] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "proxy error" },
      { status: 500 },
    );
  }
}
