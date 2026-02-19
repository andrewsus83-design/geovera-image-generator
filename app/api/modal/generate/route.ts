import { NextRequest, NextResponse } from "next/server";

// ── Modal web endpoint URL ─────────────────────────────────────────
// Set MODAL_GENERATE_URL in Vercel env vars after: modal deploy modal_app.py
// Format: https://<workspace>--geovera-flux-generate-endpoint.modal.run
function getModalUrl(type: "generate" | "tiktok-batch"): string | null {
  if (type === "generate")     return process.env.MODAL_GENERATE_URL     ?? null;
  if (type === "tiktok-batch") return process.env.MODAL_TIKTOK_BATCH_URL ?? null;
  return null;
}

// ── Main handler ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      prompt,
      width = 768,
      height = 1344,
      steps = 4,
      seed = Math.floor(Math.random() * 999999),
      numImages = 1,
      sourceImage,     // base64 string (optional — enables img2img)
      strength = 0.75,
      modelVariant = "schnell",
    } = body;

    if (!prompt) {
      return NextResponse.json({ error: "prompt required" }, { status: 400 });
    }

    const modalUrl = getModalUrl("generate");
    if (!modalUrl) {
      return NextResponse.json(
        {
          error: "MODAL_GENERATE_URL not set. Add it to Vercel env vars after deploying modal_app.py",
          hint: "modal deploy modal_app.py → copy the generate-endpoint URL",
        },
        { status: 503 }
      );
    }

    // Build request payload for Modal web endpoint
    const payload: Record<string, unknown> = {
      prompt,
      width,
      height,
      num_images:     numImages,
      num_steps:      steps,
      guidance_scale: modelVariant === "dev" ? 3.5 : 0.0,
      seed,
      model_variant:  modelVariant,
    };

    if (sourceImage) {
      payload.source_b64 = sourceImage;
      payload.strength   = strength;
    }

    // Call Modal web endpoint directly via fetch (works in Vercel serverless)
    const modalRes = await fetch(modalUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
      // Modal web endpoints have a max timeout — Vercel max is 300s on Pro
    });

    if (!modalRes.ok) {
      const errText = await modalRes.text();
      return NextResponse.json(
        { error: `Modal returned ${modalRes.status}`, detail: errText.slice(0, 500) },
        { status: 502 }
      );
    }

    const data = await modalRes.json() as { images: string[]; time: number; model?: string };

    if (!data.images) {
      return NextResponse.json(
        { error: "Modal returned unexpected output", raw: JSON.stringify(data).slice(0, 500) },
        { status: 502 }
      );
    }

    // Add data URI prefix if not present
    const images = data.images.map((b64: string) =>
      b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`
    );

    return NextResponse.json({
      ok:    true,
      images,
      time:  data.time,
      model: data.model ?? `flux-${modelVariant}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
