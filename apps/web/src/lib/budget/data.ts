import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { PbxBudgetView, PbxInbox, PbxProjectAccess } from "@/types/budget";
import { friendlyBudgetError, isBudgetNotInstalled } from "./errors";

/** What a budget page can be: the module is not installed here, the person may not open it, it failed to load, or the data. */
export type BudgetLoad =
  | { state: "ok"; view: PbxBudgetView }
  | { state: "not_installed" }
  | { state: "denied" }
  | { state: "error"; message: string };

export type InboxLoad =
  | { state: "ok"; inbox: PbxInbox }
  | { state: "not_installed" }
  | { state: "error"; message: string };

/**
 * Everything one project's Budget & Expenses page shows, in one database call. The function applies the access rules (Finance or view grantee of the
 * owning company, the current Project Manager, or - own versions only - someone who submitted one); the page only shapes what it receives.
 */
export const loadBudgetView = cache(async (projectId: string): Promise<BudgetLoad> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pbx_budget_view", { p_project_id: projectId });
  if (error) {
    if (isBudgetNotInstalled(error)) return { state: "not_installed" };
    if (error.code === "P0002" || /Budget not found/i.test(error.message)) return { state: "denied" };
    return { state: "error", message: friendlyBudgetError(error.message, error.code) };
  }
  return { state: "ok", view: data as unknown as PbxBudgetView };
});

/** The Finance inbox across every company the person can read. */
export const loadBudgetInbox = cache(async (): Promise<InboxLoad> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pbx_inbox");
  if (error) {
    if (isBudgetNotInstalled(error)) return { state: "not_installed" };
    return { state: "error", message: friendlyBudgetError(error.message, error.code) };
  }
  return { state: "ok", inbox: data as unknown as PbxInbox };
});

/**
 * Does the signed-in person have a Budget & Expenses entry on this project? Drives the project tab. Quiet by design: a database that does not
 * have the module yet, or any failure, simply means no tab (the project page itself must never break because of it).
 */
export const loadProjectBudgetAccess = cache(async (projectId: string): Promise<PbxProjectAccess> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("pbx_project_access", { p_project_id: projectId });
    if (error || !data) return { can_open: false };
    return data as unknown as PbxProjectAccess;
  } catch {
    return { can_open: false };
  }
});

/**
 * Does the signed-in person hold budget access (Finance or view) in any company? Drives the "Finance" menu entry. This reads only the person's own
 * grants, so it costs one tiny query on every page; the inbox itself is loaded only when the page is opened. Quiet like the tab: a database that
 * does not have the module yet, or any failure, simply means no menu entry.
 */
export const loadBudgetNavAccess = cache(async (userId: string): Promise<{ any: boolean; finance: boolean }> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("pbx_company_grants").select("capabilities").eq("user_id", userId).is("revoked_at", null);
    if (error || !data) return { any: false, finance: false };
    const caps = data.flatMap((g) => g.capabilities as string[]);
    return { any: caps.includes("finance") || caps.includes("view"), finance: caps.includes("finance") };
  } catch {
    return { any: false, finance: false };
  }
});
