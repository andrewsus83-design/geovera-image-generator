/**
 * app/api/characters/conversation/route.ts
 * POST /api/characters/conversation — run a multi-agent LangGraph conversation
 *
 * Body:
 *   character_ids  string[]  (2–8 character UUIDs)
 *   topic          string    (required)
 *   user_message   string    (optional seed message)
 *   max_rounds     number    (default 3, max 10)
 *   llm            object    (optional — provider config)
 *   save_to_db     boolean   (default true)
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiKeyAuth";
import { modalEndpoints, callModal } from "@/lib/characterApiClient";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const rawKey =
    req.headers.get("authorization") ?? req.headers.get("x-api-key") ?? "";

  try {
    await validateApiKey(rawKey);
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.character_ids) || body.character_ids.length < 2) {
    return NextResponse.json(
      { error: "character_ids must be an array of at least 2 UUIDs" },
      { status: 400 },
    );
  }

  if (!body.topic || typeof body.topic !== "string") {
    return NextResponse.json({ error: "topic (string) is required" }, { status: 400 });
  }

  const payload = {
    character_ids: body.character_ids,
    topic:         body.topic,
    user_message:  body.user_message ?? null,
    max_rounds:    body.max_rounds ?? 3,
    llm:           body.llm ?? {},
    save_to_db:    body.save_to_db !== false,
  };

  try {
    const result = await callModal(modalEndpoints.conversation(), payload, rawKey.replace("Bearer ", ""));
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
