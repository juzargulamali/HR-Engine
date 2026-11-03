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
export const loadProjectBudgetAccess = cache(async (projectId: string): Promise<PbxProjectAccess & { loadFailed?: boolean }> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("pbx_project_access", { p_project_id: projectId });
    if (error && isBudgetNotInstalled(error)) return { can_open: false };
    // Any other failure is not "no access": the project page says it could not check, in place of the missing tab.
    if (error || !data) return { can_open: false, loadFailed: true };
    return data as unknown as PbxProjectAccess;
  } catch {
    return { can_open: false, loadFailed: true };
  }
});

/**
 * Does the signed-in person hold budget access (Finance, CEO / CTO approver or view) in any company? Drives the "Finance" menu entry. This reads only the person's own
 * grants, so it costs one tiny query on every page; the inbox itself is loaded only when the page is opened. Quiet like the tab: a database that
 * does not have the module yet, or any failure, simply means no menu entry.
 */
export const loadBudgetNavAccess = cache(async (userId: string): Promise<{ any: boolean; finance: boolean; manageAccess: boolean; canDecide: boolean; loadFailed?: boolean }> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("pbx_company_grants").select("capabilities").eq("user_id", userId).is("revoked_at", null);
    // "Not installed" stays quiet; any other failure is reported so the layout can say the menu could not be fully loaded.
    if (error || !data) return { any: false, finance: false, manageAccess: false, canDecide: false, ...(error && !isBudgetNotInstalled(error) ? { loadFailed: true } : {}) };
    const caps = data.flatMap((g) => g.capabilities as string[]);
    return {
      any: caps.includes("finance") || caps.includes("view") || caps.includes("executive_approver"), finance: caps.includes("finance"), manageAccess: caps.includes("manage_access"),
      // Only people who can decide something get the waiting count (a view-only grantee has nothing to decide).
      canDecide: caps.includes("finance") || caps.includes("executive_approver"),
    };
  } catch {
    return { any: false, finance: false, manageAccess: false, canDecide: false, loadFailed: true };
  }
});

export type WaitingCountLoad = { state: "ok"; count: number } | { state: "none" } | { state: "error" };

/**
 * How many budgets and final-expense sets wait for THIS person's decision, for the Finance menu entry: one small database function (pbx_decisions_waiting_count), NOT pbx_inbox, so
 * it is cheap enough for every page. Asked only of people who can decide. "none": the module is not installed here yet. "error": the read failed, so the menu shows no number
 * (never 0) and the layout says part of the menu could not be loaded.
 */
export const loadBudgetWaitingCount = cache(async (): Promise<WaitingCountLoad> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("pbx_decisions_waiting_count");
    if (error) return isBudgetNotInstalled(error) ? { state: "none" } : { state: "error" };
    return typeof data === "number" && Number.isFinite(data) && data >= 0 ? { state: "ok", count: data } : { state: "error" };
  } catch {
    return { state: "error" };
  }
});
