import { checkAccess, keyFromHeader, MIN_KEY_LENGTH } from "@/lib/server/access";
import { handleGet, handlePut, MAX_BODY_BYTES, type ApiResult, type PlannerRepo } from "@/lib/server/plannerApi";
import { supabaseRepo } from "@/lib/server/supabaseRepo";

// Always run on the server at request time; never cache planner state.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function respond({ status, body }: ApiResult): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

/**
 * Every request needs the access key, checked before anything touches the
 * database. Fails closed: with no key configured on the server, nobody gets in.
 */
function authorize(request: Request): ApiResult | PlannerRepo {
  const access = checkAccess(keyFromHeader(request.headers.get("authorization")), process.env.PLANNER_ACCESS_KEY);
  if (access === "missing_server_key") {
    return { status: 503, body: { error: "not_configured", message: "PLANNER_ACCESS_KEY is not set on the server." } };
  }
  if (access === "weak_server_key") {
    return {
      status: 503,
      body: { error: "not_configured", message: `PLANNER_ACCESS_KEY must be at least ${MIN_KEY_LENGTH} characters.` },
    };
  }
  if (access === "unauthorized") {
    return { status: 401, body: { error: "unauthorized", message: "Missing or wrong access key." } };
  }
  const repo = supabaseRepo();
  if (!repo) {
    return {
      status: 503,
      body: { error: "not_configured", message: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set." },
    };
  }
  return repo;
}

function isResult(x: ApiResult | PlannerRepo): x is ApiResult {
  return "status" in x;
}

export async function GET(request: Request): Promise<Response> {
  const repo = authorize(request);
  if (isResult(repo)) return respond(repo);
  return respond(await handleGet(repo));
}

export async function PUT(request: Request): Promise<Response> {
  const repo = authorize(request);
  if (isResult(repo)) return respond(repo);

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
