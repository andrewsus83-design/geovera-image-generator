import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { endpoint, apiKey } = await req.json();

    if (!endpoint) {
      return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const base = endpoint.replace(/\/$/, "");
    const headers = {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };

    // Try ComfyUI /system_stats first, fallback to /health
    let res = await fetch(`${base}/system_stats`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    // If ComfyUI not found, try generic /health
    if (!res.ok) {
      res = await fetch(`${base}/health`, {
        method: "GET",
        headers,
      });
    }

    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json({ error: `Server returned ${res.status} — worker may still be loading` }, { status: 502 });
    }

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: true, status: "connected", backend: "comfyui", ...data });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      return NextResponse.json({ error: "Connection timed out (10s)" }, { status: 504 });
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
