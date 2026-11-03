import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface LeadOption {
  id: string;
  name: string;
}

/**
 * The people an employee may name as project lead on the attendance clock: the active people of their own company, as an id and a display name only
 * (the database function checks this; the employee still cannot read other employee rows). A failed read is reported as `failed`, never as an empty list,
 * so the clock can say it could not load the list instead of offering a picker with nobody in it.
 */
export async function loadLeadCandidates(supabase: Supabase): Promise<{ leads: LeadOption[]; failed: boolean }> {
  const { data, error } = await supabase.rpc("attendance_lead_candidates");
  if (error) return { leads: [], failed: true };
  return { leads: (data ?? []).map((r) => ({ id: r.employee_id, name: r.display_name })), failed: false };
}
