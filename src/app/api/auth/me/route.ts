import { notConfigured, respond } from "@/lib/server/routeUtil";
import { currentSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Who is signed in on this browser: { name, key }, or 401. */
export async function GET(): Promise<Response> {
  const nc = notConfigured();
  if (nc) return respond(nc);
  const session = await currentSession();
  if (!session) return respond({ status: 401, body: { error: "signed_out" } });
  return respond({ status: 200, body: { name: session.name, key: session.key } });
}
