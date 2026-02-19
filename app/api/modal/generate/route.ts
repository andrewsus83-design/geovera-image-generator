import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

// ── Helper: run Modal function via CLI ────────────────────────────
function runModalFunction(
  args: string[],
  env: Record<string, string>,
  timeoutMs = 300000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const modal = spawn("modal", args, {
      env: { ...process.env, ...env },
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";
    modal.stdout.on("data", (d) => (stdout += d.toString()));
    modal.stderr.on("data", (d) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      modal.kill();
      reject(new Error("Modal function timed out"));
    }, timeoutMs);

    modal.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`Modal exited with code ${code}: ${stderr}`));
      }
    });
    modal.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
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
      sourceImage,   // base64 string (optional)
      strength = 0.75,
      modelVariant = "schnell",
      gpu = "T4",
    } = body;

    if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });

    // Modal credentials from Vercel/Supabase environment secrets
    const modalEnv: Record<string, string> = {};
    if (process.env.MODAL_TOKEN_ID)     modalEnv.MODAL_TOKEN_ID     = process.env.MODAL_TOKEN_ID;
    if (process.env.MODAL_TOKEN_SECRET) modalEnv.MODAL_TOKEN_SECRET  = process.env.MODAL_TOKEN_SECRET;

    // GPU map: UI key → Modal GPU string
    const gpuMap: Record<string, string> = {
      t4: "T4", a10g: "A10G", a100: "A100-40GB", h100: "H100",
      any: "T4",
    };
    const modalGpu = gpuMap[gpu] ?? "T4";

    let result: { stdout: string; stderr: string };

    if (sourceImage) {
      // img2img
      const payload = JSON.stringify({
        source_b64: sourceImage,
        prompt,
        strength,
        width,
        height,
        num_images: numImages,
        num_steps: steps,
        seed,
        model_variant: modelVariant,
      });

      result = await runModalFunction(
        [
          "run",
          path.join(process.cwd(), "modal_app.py") + "::generate_variation",
          "--json-input",
          payload,
          "--gpu",
          modalGpu,
        ],
        modalEnv
      );
    } else {
      // txt2img
      const payload = JSON.stringify({
        prompt,
        width,
        height,
        num_images: numImages,
        num_steps: steps,
        guidance_scale: modelVariant === "dev" ? 3.5 : 0.0,
        seed,
        model_variant: modelVariant,
      });

      result = await runModalFunction(
        [
          "run",
          path.join(process.cwd(), "modal_app.py") + "::generate",
          "--json-input",
          payload,
          "--gpu",
          modalGpu,
        ],
        modalEnv
      );
    }

    // Parse JSON output from Modal function
    // Modal prints the return value as JSON on stdout
    const lines = result.stdout.trim().split("\n");
    // Find the last line that is valid JSON
    let parsed: { images: string[]; time: number; model?: string } | null = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        parsed = JSON.parse(lines[i]);
        break;
      } catch {
        // not JSON, try previous line
      }
    }

    if (!parsed || !parsed.images) {
      return NextResponse.json(
        { error: "Modal returned unexpected output", raw: result.stdout.slice(-1000) },
        { status: 502 }
      );
    }

    // Add data URI prefix if not present
    const images = parsed.images.map((b64: string) =>
      b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`
    );

    return NextResponse.json({
      ok: true,
      images,
      time: parsed.time,
      model: parsed.model ?? `flux-${modelVariant}`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
