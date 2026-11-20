import { createSession, signUp } from "@/lib/server/auth";
import { userRepo } from "@/lib/server/backend";
import { isResult, MAX_AUTH_BODY_BYTES, notConfigured, readJson, respond } from "@/lib/server/routeUtil";
import { sessionSecret, setSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const nc = notConfigured();
  if (nc) return respond(nc);
  const body = await readJson(request, MAX_AUTH_BODY_BYTES);
  if (isResult(body)) return respond(body);
  try {
    const result = await signUp(userRepo()!, body);
    if (result.user) await setSessionCookie(createSession(result.user, sessionSecret()!, Date.now()));
    return respond(result);
  } catch (err) {
    console.error("sign-up failed", err);
    return respond({ status: 502, body: { error: "database_error" } });
  }
}
