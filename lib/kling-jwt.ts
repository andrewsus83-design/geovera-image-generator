/**
 * Kling AI JWT token generator.
 *
 * Kling API uses a custom JWT format:
 *   Header: { alg: "HS256", typ: "JWT" }
 *   Payload: { iss: accessKey, exp: now + 1800, nbf: now - 5 }
 *   Signature: HMAC-SHA256(base64url(header) + "." + base64url(payload), secretKey)
 *
 * Docs: https://platform.klingai.com/docs#api-authentication
 */

import crypto from "crypto";

function base64urlEncode(obj: object): string {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function sign(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000);

  const header  = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: accessKey,
    exp: now + 1800,   // valid for 30 minutes
    nbf: now - 5,      // valid from 5 seconds ago (clock skew tolerance)
  };

  const data = `${base64urlEncode(header)}.${base64urlEncode(payload)}`;

  const sig = crypto
    .createHmac("sha256", secretKey)
    .update(data)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return `${data}.${sig}`;
}
