import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

/**
 * Whether this employee has at least one direct report, read through their own session (employees_select already limits a manager
 * to their reports). It only decides whether the "People & HR" menu entry is offered; the Employees page and the database decide what
 * is readable. `loadFailed` means the answer is unknown: the menu then keeps the entry rather than hiding it.
 */
export async function loadDirectReportsNav(supabase: Client, employeeId: string | null): Promise<{ hasDirectReports: boolean; loadFailed?: boolean }> {
  if (!employeeId) return { hasDirectReports: false };
  try {
    const { count, error } = await supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("manager_id", employeeId)
      .is("deleted_at", null);
    if (error) return { hasDirectReports: true, loadFailed: true };
    return { hasDirectReports: (count ?? 0) > 0 };
  } catch {
    return { hasDirectReports: true, loadFailed: true };
  }
}
