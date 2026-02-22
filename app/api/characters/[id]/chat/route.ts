/**
 * app/api/characters/[id]/chat/route.ts
 * POST /api/characters/:id/chat — send a message to a character
 *
 * Body:
 *   message        string   (required)
 *   conversation_id string  (optional — continues existing conversation)
 *   llm            object   (optional — provider config)
 *   save_to_db     boolean  (default true)
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiKeyAuth";
import { modalEndpoints, callModal } from "@/lib/characterApiClient";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rawKey =
    req.headers.get("authorization") ?? req.headers.get("x-api-key") ?? "";

  try {
    await validateApiKey(rawKey);
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.message || typeof body.message !== "string") {
    return NextResponse.json({ error: "message (string) is required" }, { status: 400 });
  }

  const payload = {
    character_id:    id,
    message:         body.message,
    conversation_id: body.conversation_id ?? null,
    llm:             body.llm ?? {},
    save_to_db:      body.save_to_db !== false,
  };

  try {
    const result = await callModal(modalEndpoints.chat(), payload, rawKey.replace("Bearer ", ""));
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
