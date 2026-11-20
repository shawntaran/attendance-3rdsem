import { plannerRepo } from "@/lib/server/backend";
import { handleGet, handlePut, MAX_BODY_BYTES, type PlannerRepo } from "@/lib/server/plannerApi";
import { isResult, notConfigured, readJson, respond } from "@/lib/server/routeUtil";
import { currentSession } from "@/lib/server/session";

// Always run on the server at request time; never cache planner state.
export const dynamic = "force-dynamic";

/** The signed-in person's own planner, or an error result. */
async function repoForRequest(): Promise<PlannerRepo | Response> {
  const nc = notConfigured();
  if (nc) return respond(nc);
  const session = await currentSession();
  if (!session) return respond({ status: 401, body: { error: "unauthorized", message: "Sign in first." } });
  return plannerRepo(session.key)!;
}

export async function GET(): Promise<Response> {
  const repo = await repoForRequest();
  if (repo instanceof Response) return repo;
  return respond(await handleGet(repo));
}

export async function PUT(request: Request): Promise<Response> {
  const repo = await repoForRequest();
  if (repo instanceof Response) return repo;
  const body = await readJson(request, MAX_BODY_BYTES);
  if (isResult(body)) return respond(body);
  return respond(await handlePut(repo, body));
}
