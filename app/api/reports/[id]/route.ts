/**
 * app/api/reports/[id]/route.ts
 *
 * GET   /api/reports/:id — get full report with all sections
 * PATCH /api/reports/:id — update status (draft→published→delivered) or deliver
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiKeyAuth";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSb() {
  return createClient(
    process.env.SUPABASE_CHAR_URL!,
    process.env.SUPABASE_CHAR_SERVICE_KEY!,
  );
}

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await validateApiKey(req.headers.get("authorization") ?? req.headers.get("x-api-key"));
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const { id } = await params;
  const sb = getSb();
  const { data, error } = await sb
    .from("reports")
    .select("*, clients(name,company)")
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json({ report: data });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await validateApiKey(req.headers.get("authorization") ?? req.headers.get("x-api-key"));
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const { id } = await params;
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const updates: Record<string, unknown> = {};
  if (body.status)  updates.status = body.status;
  if (body.summary) updates.summary = body.summary;
  if (body.status === "delivered") updates.delivered_at = new Date().toISOString();

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const sb = getSb();
  const { data, error } = await sb.from("reports").update(updates).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ report: data });
}
