import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isNotInstalled } from "@/lib/projects/errors";
import { getOperationsContext, pickCompany } from "@/lib/operations/data";
import type { TvBoard, TvLoad, TvMyDisplay } from "./types";

/**
 * The one server-side read of the board, shared by the page (first paint) and the refresh route. The database decides: ops_tv_board checks, on every call, that the caller is an
 * un-revoked display of the company, or an Operations Manager / founder of it. This function only maps what it says. Nothing is cached.
 */
const map = (e: { code?: string; message?: string }): TvLoad => {
  if (e.code === "42501" || e.code === "P0002") return { state: "denied" };
  if (isNotInstalled(e)) return { state: "not_installed" };
  return { state: "error" };
};

export type TvLoaded = TvLoad & { display?: TvMyDisplay | null };

export async function loadTvBoard(companyId: string | null): Promise<TvLoaded> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { state: "signed_out" };

  // A display identity names its own company; an Operations Manager passes ?company= (or is asked to choose).
  const me = await supabase.rpc("ops_tv_my_display");
  if (me.error) { const m = map(me.error); if (m.state !== "denied") return m; }
  const display = (me.data ?? null) as TvMyDisplay | null;
  if (display && (display.revoked || display.revoked_at)) return { state: "revoked", display };
  let company = display?.company_id ?? companyId;
  // An Operations Manager who did not name a company gets the one they manage (their last used, else their first); the database still checks it.
  if (!company && !display) {
    const ctx = await getOperationsContext().catch(() => null);
    const picked = ctx && ctx.companies.length ? await pickCompany(ctx, undefined) : null;
    company = picked?.id ?? null;
  }
  if (!company) return { state: "denied", display };

  const res = await supabase.rpc("ops_tv_board", { p_company_id: company });
  if (res.error) {
    const m = map(res.error);
    // A display whose registration was revoked is refused by the same check: say so, not just "denied".
    return display && m.state === "denied" ? { state: "revoked", display } : { ...m, display };
  }
  if (!res.data || typeof res.data !== "object") return { state: "error", display };
  return { state: "ok", board: res.data as TvBoard, display };
}
