import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isNotInstalled } from "@/lib/projects/errors";
import { parseDisplayRows, type DisplayRow } from "./accounts";
import { opsTvRpc } from "./rpc";

export type DisplaysResult = { state: "ok"; rows: DisplayRow[] } | { state: "not_installed" } | { state: "denied" } | { state: "error" };

/**
 * The display accounts registered for one company, from the database function that refuses anyone who is not that company's Operations Manager (or a founder). The e-mail a display signs in with is not
 * in the registry, so a row that comes without one gets it from the Auth service (service role, read only) AFTER the check above succeeded; if that lookup fails the row is still shown, without the e-mail.
 */
export async function loadDisplays(companyId: string): Promise<DisplaysResult> {
  const { data, error } = await opsTvRpc("ops_tv_list_displays", { p_company_id: companyId });
  if (error) {
    if (isNotInstalled(error)) return { state: "not_installed" };
    if (error.code === "42501" || error.code === "P0002") return { state: "denied" };
    console.error("[operations-tv] listing displays failed", error.message);
    return { state: "error" };
  }
  const rows = parseDisplayRows(data);
  const missing = rows.filter((r) => !r.email);
  if (missing.length) {
    try {
      const admin = createAdminClient();
      await Promise.all(missing.map(async (r) => {
        const res = await admin.auth.admin.getUserById(r.userId);
        r.email = res.data?.user?.email ?? null;
      }));
    } catch { /* the list is still useful without the sign-in e-mails */ }
  }
  return { state: "ok", rows };
}
