import "server-only";

import type { ApiResult } from "./plannerApi";
import { backend } from "./backend";
import { sessionSecret } from "./session";

const NO_STORE = { "Cache-Control": "no-store" };

export function respond({ status, body }: ApiResult): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/** Why the server cannot serve accounts yet, or null when it can. */
export function notConfigured(): ApiResult | null {
  const missing: string[] = [];
  if (!backend()) missing.push("a database (SUPABASE_URL + SUPABASE_SECRET_KEY, or APPWRITE_ENDPOINT + APPWRITE_PROJECT_ID + APPWRITE_API_KEY)");
  if (!sessionSecret()) missing.push("SESSION_SECRET (at least 32 characters)");
  if (missing.length === 0) return null;
  return { status: 503, body: { error: "not_configured", message: `Not set on the server: ${missing.join("; ")}.` } };
}

export const MAX_AUTH_BODY_BYTES = 2_000;

/** Parse a small JSON body, or an error result. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown | ApiResult> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return { status: 413, body: { error: "too_large" } };
  try {
    return JSON.parse(text);
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
}

export function isResult(x: unknown): x is ApiResult {
  return typeof x === "object" && x !== null && "status" in x && "body" in x && typeof (x as ApiResult).status === "number";
}
