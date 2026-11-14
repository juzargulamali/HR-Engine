import { NextResponse, type NextRequest } from "next/server";
import { loadTvBoard } from "@/lib/operations-tv/load";

/**
 * The office board's refresh: one bounded read, always answered with `Cache-Control: no-store, private` so no shared cache can hold a display response.
 * 200 board · 401 signed out · 403 denied or revoked · 503 not installed · 502 transient failure.
 */
export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store, private, max-age=0", "Pragma": "no-cache", "Vary": "Cookie" } as const;
const reply = (status: number, body: unknown) => NextResponse.json(body, { status, headers: HEADERS });

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get("company");
  const safe = company && /^[0-9a-f-]{36}$/i.test(company) ? company : null;
  let r;
  try { r = await loadTvBoard(safe); } catch { return reply(502, { state: "error" }); }
  switch (r.state) {
    case "ok": return reply(200, { state: "ok", board: r.board });
    case "signed_out": return reply(401, { state: "signed_out" });
    case "revoked": return reply(403, { state: "revoked" });
    case "denied": return reply(403, { state: "denied" });
    case "not_installed": return reply(503, { state: "not_installed" });
    default: return reply(502, { state: "error" });
  }
}
