/**
 * lib/apiKeyAuth.ts
 * API key generation, hashing, and validation for Character AI Agent system.
 * Key format: sk_char_<32 hex chars>  (total 40 chars)
 */

import { createHash, randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";

const CHAR_SUPABASE_URL = process.env.SUPABASE_CHAR_URL!;
const CHAR_SUPABASE_KEY = process.env.SUPABASE_CHAR_SERVICE_KEY!;

function getCharSupabase() {
  return createClient(CHAR_SUPABASE_URL, CHAR_SUPABASE_KEY);
}

/** Generate a new API key (plaintext — only returned once). */
export function generateApiKey(): string {
  const hex = randomBytes(16).toString("hex"); // 32 hex chars
  return `sk_char_${hex}`;
}

/** SHA-256 hash of a raw API key (stored in DB). */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/** Create and persist a new API key. Returns the plaintext key (once only). */
export async function createApiKey(label?: string): Promise<{
  key: string;
  keyPrefix: string;
  id: string;
}> {
  const rawKey = generateApiKey();
  const hashed = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 16); // "sk_char_XXXXXXXX"

  const sb = getCharSupabase();
  const { data, error } = await sb
    .from("api_keys")
    .insert({ key_prefix: keyPrefix, hashed_key: hashed, user_label: label ?? null })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create API key: ${error.message}`);

  return { key: rawKey, keyPrefix, id: data.id };
}

/** Validate an API key from a request header. Returns true or throws 401. */
export async function validateApiKey(authHeader?: string | null): Promise<boolean> {
  if (!authHeader) {
    throw { status: 401, message: "API key required" };
  }

  let rawKey = authHeader;
  if (authHeader.startsWith("Bearer ")) {
    rawKey = authHeader.slice(7);
  }

  if (!rawKey.startsWith("sk_char_")) {
    throw { status: 401, message: "Invalid API key format" };
  }

  const hashed = hashApiKey(rawKey);
  const sb = getCharSupabase();

  const { data } = await sb
    .from("api_keys")
    .select("id, is_active")
    .eq("hashed_key", hashed)
    .single();

  if (!data || !data.is_active) {
    throw { status: 401, message: "Invalid or revoked API key" };
  }

  // Update last_used_at (non-blocking, fire and forget)
  void sb
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  return true;
}

/** Revoke (deactivate) an API key by its ID. */
export async function revokeApiKey(keyId: string): Promise<void> {
  const sb = getCharSupabase();
  const { error } = await sb
    .from("api_keys")
    .update({ is_active: false })
    .eq("id", keyId);

  if (error) throw new Error(`Failed to revoke key: ${error.message}`);
}

/** List all API keys (without hashes — only prefix + metadata). */
export async function listApiKeys() {
  const sb = getCharSupabase();
  const { data, error } = await sb
    .from("api_keys")
    .select("id, key_prefix, user_label, is_active, created_at, last_used_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}
