/**
 * POST /api/cloudinary/upload
 *
 * Receives base64 images from the client and uploads them to Cloudinary.
 * Returns Cloudinary secure URLs — client stores URLs (not base64) in IndexedDB.
 *
 * Body: {
 *   images:   { b64: string; filename: string; public_id?: string }[];
 *   lossless?: boolean;  // true = no resize/format conversion (for LoRA training images)
 *   folder?:  string;    // override default folder
 * }
 * Response: { urls: { url: string; filename: string }[] }
 *
 * lossless mode: upload PNG as-is, no transformation, no WebP conversion.
 * Used for LoRA training dataset images — any lossy compression or resize
 * would degrade face/product detail and hurt training quality.
 */

import { NextRequest, NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key:    process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

const FOLDER_DEFAULT  = "geovera-tiktok";
const FOLDER_TRAINING = "geovera-training";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      images:    { b64: string; filename: string; public_id?: string }[];
      lossless?: boolean;  // true → no resize, no WebP, upload as original PNG
      folder?:   string;
    };

    if (!body.images || body.images.length === 0) {
      return NextResponse.json({ error: "No images provided" }, { status: 400 });
    }

    const lossless = body.lossless ?? false;
    const folder   = body.folder ?? (lossless ? FOLDER_TRAINING : FOLDER_DEFAULT);

    // Upload all images in parallel to Cloudinary
    const results = await Promise.all(
      body.images.map(async ({ b64, filename, public_id }) => {
        const dataUri = b64.startsWith("data:")
          ? b64
          : `data:image/png;base64,${b64}`;

        const uploadResult = await cloudinary.uploader.upload(dataUri,
          lossless
            // LoRA training images — preserve original PNG exactly:
            // No format conversion, no resize/crop, no quality reduction.
            ? {
                folder,
                public_id:     public_id ?? filename.replace(/\.[^.]+$/, ""),
                overwrite:     false,
                resource_type: "image",
                format:        "png",  // keep as PNG — no lossy conversion
                // No transformation → stored at original resolution
              }
            // TikTok Ads display images — optimize for web delivery:
            : {
                folder,
                public_id:      public_id ?? filename.replace(/\.[^.]+$/, ""),
                overwrite:      false,
                resource_type:  "image",
                format:         "webp",
                quality:        "auto:good",
                transformation: [
                  { width: 768, crop: "limit" },  // cap at source width, never upscale
                ],
              }
        );

        return {
          url:      uploadResult.secure_url,
          filename,
          publicId: uploadResult.public_id,
          width:    uploadResult.width,
          height:   uploadResult.height,
          bytes:    uploadResult.bytes,
        };
      })
    );

    return NextResponse.json({ urls: results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Cloudinary Upload]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
