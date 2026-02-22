/**
 * GET /api/download?url=<encoded-url>&filename=<name>
 *
 * Server-side proxy for downloading images from Cloudinary (or any CDN).
 * Solves browser CORS restriction: <a download> is ignored for cross-origin URLs.
 *
 * Flow:
 *   1. Browser calls /api/download?url=https://res.cloudinary.com/...&filename=img.jpg
 *   2. This route fetches the image server-side (no CORS)
 *   3. Streams back with Content-Disposition: attachment → browser saves file
 *
 * Security:
 *   - Only allows Cloudinary URLs (res.cloudinary.com) + data: URIs
 *   - Blocks arbitrary URL fetching to prevent SSRF
 *   - Max 50MB image size
 */

import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = [
  "res.cloudinary.com",
  "cloudinary.com",
];

const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

function isAllowedUrl(url: string): boolean {
  try {
    // data: URIs are fine (already on-device, no fetch needed)
    if (url.startsWith("data:")) return true;
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      ALLOWED_ORIGINS.some((origin) => parsed.hostname.endsWith(origin))
    );
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawUrl   = searchParams.get("url");
    const filename = searchParams.get("filename") ?? "geovera-image.jpg";

    if (!rawUrl) {
      return NextResponse.json({ error: "url param required" }, { status: 400 });
    }

    // Handle data: URIs — decode and stream directly
    if (rawUrl.startsWith("data:")) {
      const [header, b64] = rawUrl.split(",");
      const mime   = header.replace("data:", "").replace(";base64", "") || "image/jpeg";
      const buffer = Buffer.from(b64, "base64");

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type":        mime,
          "Content-Length":      String(buffer.byteLength),
          "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
          "Cache-Control":       "no-store",
        },
      });
    }

    // Validate URL is from an allowed origin (security: prevent SSRF)
    if (!isAllowedUrl(rawUrl)) {
      return NextResponse.json(
        { error: "URL not allowed. Only Cloudinary URLs are supported." },
        { status: 403 },
      );
    }

    // Fetch image from Cloudinary server-side (bypasses browser CORS)
    const imgRes = await fetch(rawUrl, {
      headers: {
        "User-Agent": "Geovera-ImageGenerator/1.0",
        "Accept":     "image/*",
      },
    });

    if (!imgRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch image: ${imgRes.status} ${imgRes.statusText}` },
        { status: 502 },
      );
    }

    // Content-Type from Cloudinary response
    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    const contentLength = imgRes.headers.get("content-length");

    // Guard against huge files
    if (contentLength && parseInt(contentLength) > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `Image too large (max ${MAX_SIZE_BYTES / 1024 / 1024}MB)` },
        { status: 413 },
      );
    }

    // Read into buffer (Next.js streaming works too, but buffer is simpler)
    const arrayBuffer = await imgRes.arrayBuffer();

    if (arrayBuffer.byteLength > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: "Image too large" },
        { status: 413 },
      );
    }

    // Infer safe file extension from content-type if filename has none
    let safeFilename = filename;
    if (!safeFilename.match(/\.(jpg|jpeg|png|webp|gif|avif)$/i)) {
      const extMap: Record<string, string> = {
        "image/jpeg": ".jpg",
        "image/png":  ".png",
        "image/webp": ".webp",
        "image/gif":  ".gif",
        "image/avif": ".avif",
      };
      safeFilename += extMap[contentType.split(";")[0].trim()] ?? ".jpg";
    }

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type":        contentType,
        "Content-Length":      String(arrayBuffer.byteLength),
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safeFilename)}"`,
        "Cache-Control":       "public, max-age=86400", // cache 1 day
      },
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[download] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
