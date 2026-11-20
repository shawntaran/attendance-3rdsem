import { respond } from "@/lib/server/routeUtil";
import { clearSessionCookie } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  await clearSessionCookie();
  return respond({ status: 200, body: { ok: true } });
}
