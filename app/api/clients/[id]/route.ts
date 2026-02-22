/**
 * app/api/clients/[id]/route.ts
 *
 * GET    /api/clients/:id — get client with jobs + recent tasks summary
 * PATCH  /api/clients/:id — update client (goals, context_data, status, assigned_agents)
 * DELETE /api/clients/:id — archive client (soft delete, sets status=archived)
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

  const [clientRes, jobsRes, tasksRes] = await Promise.all([
    sb.from("clients").select("*").eq("id", id).single(),
    sb.from("jobs").select("id,title,role,objective,schedule,status,last_run_at,run_count,character_id").eq("client_id", id).order("created_at"),
    sb.from("tasks").select("id,job_id,status,task_type,completed_at,cost_usd").eq("client_id", id).order("created_at", { ascending: false }).limit(20),
  ]);

  if (clientRes.error || !clientRes.data) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  return NextResponse.json({
    client: clientRes.data,
    jobs:   jobsRes.data ?? [],
    recent_tasks: tasksRes.data ?? [],
  });
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

  const allowed = ["name", "company", "industry", "goals", "context_data", "assigned_agents", "status"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const sb = getSb();
  const { data, error } = await sb.from("clients").update(updates).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ client: data });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    await validateApiKey(req.headers.get("authorization") ?? req.headers.get("x-api-key"));
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const { id } = await params;
  const sb = getSb();
  const { error } = await sb.from("clients").update({ status: "archived" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: "Client archived" });
}
