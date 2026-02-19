import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

export async function POST(req: NextRequest) {
  try {
    const { type, imagesDir, outputDir, steps, lr, rank } = await req.json();

    const projectRoot = path.join(process.cwd(), "..");
    const scriptPath = path.join(projectRoot, "scripts", "run_pipeline.py");

    const args = ["full",
      "--image-dir", imagesDir || "data/raw",
    ];

    // If a config path is needed:
    // args.push("--config", "configs/train_config.yaml");

    const jobId = `train_${type}_${Date.now()}`;

    const proc = spawn("python", [scriptPath, ...args], {
      cwd: projectRoot,
      env: { ...process.env },
      detached: true,
      stdio: "ignore",
    });
    proc.unref();

    return NextResponse.json({ ok: true, jobId, message: `Training started for ${type} LoRA` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
