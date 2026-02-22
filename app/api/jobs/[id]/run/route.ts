/**
 * app/api/jobs/[id]/run/route.ts
 *
 * POST /api/jobs/:id/run — execute the job now (creates a task + calls Modal agent)
 *
 * Body (optional):
 *   task_type    string  — "daily_work"|"analysis"|"research"|"outreach" (default: daily_work)
 *   prompt       string  — override prompt (default: auto-generated from job objective)
 *   context      object  — extra context to inject (e.g. today's data from client)
 *   save_to_db   boolean — default true
 *
 * Flow:
 *   1. Load job + character + client
 *   2. Build prompt from objective + instructions + context
 *   3. Create task record (status=running)
 *   4. Call Modal /chat endpoint with character + prompt
 *   5. Save output to task (status=done)
 *   6. Update job.last_run_at + next_run_at + run_count
 *   7. Return task result
 */

import { NextRequest, NextResponse } from "next/server";
import { validateApiKey } from "@/lib/apiKeyAuth";
import { createClient } from "@supabase/supabase-js";

export const runtime  = "nodejs";
export const maxDuration = 120;

function getSb() {
  return createClient(
    process.env.SUPABASE_CHAR_URL!,
    process.env.SUPABASE_CHAR_SERVICE_KEY!,
  );
}

function buildPrompt(job: Record<string, unknown>, context?: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`## Your Objective`);
  lines.push(String(job.objective));
  if (job.instructions) {
    lines.push(`\n## Instructions`);
    lines.push(String(job.instructions));
  }
  if (context && Object.keys(context).length > 0) {
    lines.push(`\n## Today's Context`);
    lines.push(JSON.stringify(context, null, 2));
  }
  lines.push(`\n## Task`);
  lines.push(`Based on the above, provide your best output for today. Be specific, actionable, and concise.`);
  return lines.join("\n");
}

function nextRunAt(schedule: string): string {
  const now = new Date();
  switch (schedule) {
    case "hourly": now.setHours(now.getHours() + 1); break;
    case "daily":  now.setDate(now.getDate() + 1); now.setHours(9, 0, 0, 0); break;
    case "weekly": now.setDate(now.getDate() + 7); now.setHours(9, 0, 0, 0); break;
    default:       return new Date(8640000000000000).toISOString();
  }
  return now.toISOString();
}

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const rawKey = req.headers.get("authorization") ?? req.headers.get("x-api-key") ?? "";
  try {
    await validateApiKey(rawKey);
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }

  const { id: jobId } = await params;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const sb = getSb();

  // 1. Load job + character + client
  const { data: job, error: jobErr } = await sb
    .from("jobs")
    .select("*, characters(id,name,gender,ethnicity,personality,knowledge_notes), clients(id,name,industry,goals,context_data)")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.status === "cancelled" || job.status === "paused") {
    return NextResponse.json({ error: `Job is ${job.status}` }, { status: 409 });
  }

  const task_type = (body.task_type as string) ?? "daily_work";
  const contextExtra = (body.context as Record<string, unknown>) ?? {};
  const clientContext = { ...((job.clients as Record<string, unknown>)?.context_data ?? {}), ...contextExtra };
  const prompt = (body.prompt as string) ?? buildPrompt(job, clientContext);

  // 2. Create task record (pending → running)
  const { data: task, error: taskErr } = await sb
    .from("tasks")
    .insert({
      job_id:       jobId,
      client_id:    (job.clients as Record<string, unknown>).id,
      character_id: (job.characters as Record<string, unknown>).id,
      task_type,
      prompt,
      status:       "running",
      started_at:   new Date().toISOString(),
    })
    .select("id")
    .single();

  if (taskErr || !task) return NextResponse.json({ error: "Failed to create task" }, { status: 500 });

  // 3. Call Modal character agent
  const modalBase = process.env.MODAL_CHAR_AGENT_BASE_URL ?? "";
  const apiKey    = rawKey.replace("Bearer ", "");

  let output    = "";
  let llm_used  = "";
  let taskStatus: "done" | "failed" = "done";
  let errorMsg  = "";

  try {
    const res = await fetch(`${modalBase}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        character_id: (job.characters as Record<string, unknown>).id,
        message:      prompt,
        save_to_db:   body.save_to_db !== false,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Modal ${res.status}: ${txt}`);
    }

    const result = await res.json() as { reply?: string; llm_used?: string };
    output   = result.reply ?? "";
    llm_used = result.llm_used ?? "";
  } catch (e) {
    taskStatus = "failed";
    errorMsg   = e instanceof Error ? e.message : String(e);
  }

  // 4. Update task with output
  await sb.from("tasks").update({
    output,
    status:       taskStatus,
    llm_used,
    error_msg:    errorMsg || null,
    completed_at: new Date().toISOString(),
  }).eq("id", task.id);

  // 5. Update job run metadata
  await sb.from("jobs").update({
    last_run_at: new Date().toISOString(),
    next_run_at: nextRunAt(job.schedule),
    run_count:   (job.run_count ?? 0) + 1,
  }).eq("id", jobId);

  return NextResponse.json({
    task_id:    task.id,
    job_id:     jobId,
    status:     taskStatus,
    output,
    llm_used,
    error:      errorMsg || undefined,
  }, { status: taskStatus === "done" ? 200 : 502 });
}
