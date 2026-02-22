/**
 * app/api/characters/[id]/reflect/route.ts
 * POST /api/characters/:id/reflect — trigger LangGraph skill evolution
 *
 * Body:
 *   conversation_id  string   (optional — analyze specific conversation)
 *   last_n_messages  number   (default 20, range 5-100)
 *   llm              object   (optional — provider config)
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiKeyAuth";
import { modalEndpoints, callModal } from "@/lib/characterApiClient";

export const runtime = "nodejs";
export const maxDuration = 120;

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

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // empty body is OK
  }

  const payload = {
    character_id:      id,
    conversation_id:   body.conversation_id ?? null,
    last_n_messages:   body.last_n_messages ?? 20,
    llm:               body.llm ?? {},
  };

  try {
    const result = await callModal(modalEndpoints.reflect(), payload, rawKey.replace("Bearer ", ""));
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
