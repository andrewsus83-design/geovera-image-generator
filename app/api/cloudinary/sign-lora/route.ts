/**
 * POST /api/cloudinary/sign-lora
 *
 * Generates a Cloudinary signed upload signature so the browser can upload
 * large .safetensors files (100–400 MB) DIRECTLY to Cloudinary, bypassing
 * Vercel's 4.5 MB body limit.
 *
 * Flow:
 *   1. Browser calls this endpoint → gets { signature, timestamp, api_key, cloud_name }
 *   2. Browser POSTs file directly to Cloudinary raw upload API with those params
 *   3. Browser receives { secure_url } → stores URL, passes to Modal at generation time
 *   4. Modal downloads .safetensors from URL at runtime (cached in /tmp/ by URL hash)
 *
 * Body: { folder?: string; public_id?: string }
 * Response: { signature: string; timestamp: number; api_key: string; cloud_name: string; folder: string; public_id: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key:    process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

const LORA_FOLDER = "geovera-loras";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { folder?: string; public_id?: string };

    const folder    = body.folder    ?? LORA_FOLDER;
    const public_id = body.public_id ?? `lora_${Date.now()}`;
    const timestamp = Math.round(Date.now() / 1000);

    // Sign the upload params — api_secret stays server-side only
    const paramsToSign = { folder, public_id, timestamp };
    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET!
    );

    return NextResponse.json({
      signature,
      timestamp,
      api_key:    process.env.CLOUDINARY_API_KEY!,
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
      folder,
      public_id,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sign-lora]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
