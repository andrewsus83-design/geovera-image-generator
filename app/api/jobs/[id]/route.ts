/**
 * app/api/jobs/[id]/route.ts
 *
 * GET    /api/jobs/:id — get job details + task history
 * PATCH  /api/jobs/:id — update job (objective, instructions, schedule, status)
 * DELETE /api/jobs/:id — cancel job (soft delete, status=cancelled)
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

  const [jobRes, tasksRes, evalRes] = await Promise.all([
    sb.from("jobs")
      .select("*, clients(name,company,industry), characters(name,gender,ethnicity,personality)")
      .eq("id", id).single(),
    sb.from("tasks")
      .select("id,task_type,status,output,llm_used,cost_usd,scheduled_for,completed_at,error_msg")
      .eq("job_id", id).order("created_at", { ascending: false }).limit(10),
    sb.from("agent_evaluations")
      .select("performance_score,strengths,weaknesses,strategy_updates,created_at")
      .eq("job_id", id).order("created_at", { ascending: false }).limit(3),
  ]);

  if (jobRes.error || !jobRes.data) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({
    job:         jobRes.data,
    tasks:       tasksRes.data ?? [],
    evaluations: evalRes.data ?? [],
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

  const allowed = ["title", "objective", "instructions", "schedule", "status", "metadata"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const sb = getSb();
  const { data, error } = await sb.from("jobs").update(updates).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ job: data });
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
  const { error } = await sb.from("jobs").update({ status: "cancelled" }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: "Job cancelled" });
}
