import { handleGet, handlePut, MAX_BODY_BYTES, type ApiResult } from "@/lib/server/plannerApi";
import { supabaseRepo } from "@/lib/server/supabaseRepo";

// Always run on the server at request time; never cache planner state.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function respond({ status, body }: ApiResult): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

const NOT_CONFIGURED: ApiResult = {
  status: 503,
  body: { error: "not_configured", message: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set." },
};

export async function GET(): Promise<Response> {
  const repo = supabaseRepo();
  if (!repo) return respond(NOT_CONFIGURED);
  return respond(await handleGet(repo));
}

export async function PUT(request: Request): Promise<Response> {
  const repo = supabaseRepo();
  if (!repo) return respond(NOT_CONFIGURED);

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return respond({ status: 413, body: { error: "too_large" } });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return respond({ status: 400, body: { error: "invalid_json" } });
  }
  return respond(await handlePut(repo, body));
}
