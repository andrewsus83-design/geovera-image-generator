/**
 * lib/loraHandoff.ts
 *
 * In-memory handoff store for passing large LoRA dataset (base64 images)
 * from Character Builder → Training page without hitting sessionStorage 5MB limit.
 *
 * Works because both pages run in the same browser tab (window.location.href
 * navigation keeps the JS module cache alive). Data is cleared after Training
 * page consumes it, or on hard refresh.
 *
 * Usage:
 *   // Character Builder (producer):
 *   import { setLoraHandoff } from "@/lib/loraHandoff";
 *   setLoraHandoff({ frames, captions, productName, source, frameCount });
 *   window.location.href = "/training?from=character-builder";
 *
 *   // Training page (consumer):
 *   import { popLoraHandoff } from "@/lib/loraHandoff";
 *   const data = popLoraHandoff();  // returns + clears data
 *   if (data) setLoraPackData(data);
 */

export interface LoraHandoffData {
  frames:      string[];   // base64 PNG data URLs
  captions:    string[];   // one per frame (ohwx format)
  productName: string;
  source:      "actor_gen" | "zip" | "images" | "lora360" | "augment";
  frameCount:  number;
}

// Module-level singleton — survives same-tab navigation
let _handoff: LoraHandoffData | null = null;

/** Producer: store data before navigating */
export function setLoraHandoff(data: LoraHandoffData): void {
  _handoff = data;
}

/** Consumer: retrieve + clear data (call once on mount) */
export function popLoraHandoff(): LoraHandoffData | null {
  const data = _handoff;
  _handoff   = null;
  return data;
}

/** Peek without clearing (for debugging) */
export function peekLoraHandoff(): LoraHandoffData | null {
  return _handoff;
}
