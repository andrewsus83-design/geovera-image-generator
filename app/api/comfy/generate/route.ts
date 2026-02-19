import { NextRequest, NextResponse } from "next/server";

// ── ComfyUI Flux Schnell workflow (text-to-image, 9:16) ───────────
function buildFluxWorkflow(params: {
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  loraPath?: string;
}) {
  const { prompt, width, height, steps, seed, loraPath } = params;

  const workflow: Record<string, unknown> = {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "flux1-schnell.safetensors" },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: prompt,
        clip: ["1", 1],
      },
    },
    "3": {
      class_type: "EmptyLatentImage",
      inputs: { width, height, batch_size: 1 },
    },
    "4": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg: 1.0,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1.0,
        model: loraPath ? ["5", 0] : ["1", 0],
        positive: ["2", 0],
        negative: ["6", 0],
        latent_image: ["3", 0],
      },
    },
    "5": loraPath
      ? {
          class_type: "LoraLoader",
          inputs: {
            lora_name: loraPath,
            strength_model: 0.85,
            strength_clip: 0.85,
            model: ["1", 0],
            clip: ["1", 1],
          },
        }
      : null,
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: "", clip: ["1", 1] },
    },
    "7": {
      class_type: "VAEDecode",
      inputs: { samples: ["4", 0], vae: ["1", 2] },
    },
    "8": {
      class_type: "SaveImage",
      inputs: { images: ["7", 0], filename_prefix: "geovera" },
    },
  };

  // Remove null nodes
  if (!loraPath) delete workflow["5"];

  return workflow;
}

// ── ComfyUI img2img workflow ──────────────────────────────────────
function buildImg2ImgWorkflow(params: {
  prompt: string;
  width: number;
  height: number;
  steps: number;
  seed: number;
  strength: number;
  imageB64: string;
}) {
  const { prompt, width, height, steps, seed, strength, imageB64 } = params;

  return {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "flux1-schnell.safetensors" },
    },
    "2": {
      class_type: "ETN_LoadImageBase64",
      inputs: { image: imageB64 },
    },
    "3": {
      class_type: "ImageScale",
      inputs: { image: ["2", 0], width, height, upscale_method: "lanczos", crop: "disabled" },
    },
    "4": {
      class_type: "VAEEncode",
      inputs: { pixels: ["3", 0], vae: ["1", 2] },
    },
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { text: prompt, clip: ["1", 1] },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: { text: "", clip: ["1", 1] },
    },
    "7": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps,
        cfg: 1.0,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: strength,
        model: ["1", 0],
        positive: ["5", 0],
        negative: ["6", 0],
        latent_image: ["4", 0],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["7", 0], vae: ["1", 2] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { images: ["8", 0], filename_prefix: "geovera" },
    },
  };
}

// ── Poll ComfyUI for job result ───────────────────────────────────
async function pollResult(
  base: string,
  promptId: string,
  headers: Record<string, string>,
  maxWait = 120000
): Promise<string[]> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch(`${base}/history/${promptId}`, { headers });
    if (!res.ok) continue;
    const history = await res.json();
    const job = history[promptId];
    if (!job) continue;
    if (job.status?.completed) {
      // Extract image filenames
      const images: string[] = [];
      for (const nodeOut of Object.values(job.outputs as Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>)) {
        if (nodeOut.images) {
          for (const img of nodeOut.images) {
            images.push(
              `${base}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`
            );
          }
        }
      }
      return images;
    }
  }
  throw new Error("Timeout waiting for ComfyUI result");
}

// ── Main handler ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      endpoint,
      apiKey,
      prompt,
      width = 768,
      height = 1344,
      steps = 4,
      seed = Math.floor(Math.random() * 999999),
      strength = 0.75,
      sourceImage,   // base64 string (optional)
      loraPath,
    } = body;

    if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
    if (!prompt)   return NextResponse.json({ error: "prompt required" }, { status: 400 });

    const base = endpoint.replace(/\/$/, "");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };

    // Build workflow
    const workflow = sourceImage
      ? buildImg2ImgWorkflow({ prompt, width, height, steps, seed, strength, imageB64: sourceImage })
      : buildFluxWorkflow({ prompt, width, height, steps, seed, loraPath });

    // Submit to ComfyUI
    const submitRes = await fetch(`${base}/prompt`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text();
      return NextResponse.json({ error: `ComfyUI error ${submitRes.status}: ${errText}` }, { status: 502 });
    }

    const { prompt_id: promptId } = await submitRes.json();

    // Poll for result
    const imageUrls = await pollResult(base, promptId, headers);

    // Fetch images as base64
    const images: string[] = [];
    for (const url of imageUrls) {
      const imgRes = await fetch(url, { headers });
      if (imgRes.ok) {
        const buf = await imgRes.arrayBuffer();
        const b64 = Buffer.from(buf).toString("base64");
        images.push(`data:image/png;base64,${b64}`);
      }
    }

    return NextResponse.json({ ok: true, images, prompt_id: promptId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
