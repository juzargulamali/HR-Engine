import "server-only";
import { createClient } from "@/lib/supabase/server";

export type AccessModule = "sales" | "projects" | "inventory" | "budget";

/** Who can grant a module's access in the person's own company: names only (the database function returns an identifier and a display name and nothing else). A failed read is its own state, never "nobody". */
export type AccessManagers = { state: "ok"; names: string[] } | { state: "error" };

export async function loadAccessManagers(module: AccessModule): Promise<AccessManagers> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("module_access_managers", { p_module: module });
    if (error) return { state: "error" };
    const names = [...new Set((data ?? []).map((r) => r.display_name).filter((n): n is string => !!n))];
    return { state: "ok", names };
  } catch {
    return { state: "error" };
  }
}

/** "Sara and Sam", "Sara, Sam and Pia": a short list of names for a sentence; a long list is cut with a count so a denial stays one line. */
export function joinNames(names: readonly string[], max = 4): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  const list = extra > 0 ? [...shown, `${extra} more`] : shown;
  return list.length === 1 ? list[0]! : `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]}`;
}
