// The planner API has no user accounts. Instead every request must carry a
// long random key that only the owner's devices know. The key lives in the
// PLANNER_ACCESS_KEY environment variable on the server; devices send it as
// "Authorization: Bearer <key>".

import { createHash, timingSafeEqual } from "node:crypto";

/** Shorter keys are refused, so a weak key cannot be configured by accident. */
export const MIN_KEY_LENGTH = 24;

export type AccessResult = "ok" | "missing_server_key" | "weak_server_key" | "unauthorized";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Read the key from an Authorization header ("Bearer <key>"). */
export function keyFromHeader(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/**
 * Compare the presented key with the configured one in constant time (both are
 * hashed first, so their lengths do not leak either).
 */
export function checkAccess(presented: string | null, configured: string | undefined): AccessResult {
  if (!configured) return "missing_server_key";
  if (configured.length < MIN_KEY_LENGTH) return "weak_server_key";
  if (!presented) return "unauthorized";
  return timingSafeEqual(digest(presented), digest(configured)) ? "ok" : "unauthorized";
}
