import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export type LeaveApprover =
  | { kind: "person"; name: string }
  | { kind: "self_approved" }
  | { kind: "none"; why: string };

/**
 * Who a leave request goes to first, for the signed-in person, read through their own session with the same rule the request itself uses: the company's active
 * leave workflow, its first step, resolved by the database function. Reading never changes anything. THROWS when a read fails (the page then says it could not
 * load who approves, never "nobody").
 */
export async function loadLeaveApprover(supabase: Client, o: { companyId: string; employeeId: string; userId: string }): Promise<LeaveApprover> {
  const { data: workflows, error: wfError } = await supabase.from("approval_workflows").select("id").eq("company_id", o.companyId).eq("entity_type", "leave_request").eq("is_active", true).order("created_at", { ascending: true }).limit(1);
  if (wfError) throw new Error(wfError.message);
  const workflow = workflows?.[0];
  if (!workflow) return { kind: "none", why: "No approval workflow is set up for your company yet. HR can set it up." };
  const { data: step, error: stepError } = await supabase.from("approval_workflow_steps").select("approver_type").eq("workflow_id", workflow.id).eq("step_order", 1).maybeSingle();
  if (stepError) throw new Error(stepError.message);
  if (!step) return { kind: "none", why: "The leave workflow has no first step yet. HR can fix it." };
  const exec = await supabase.rpc("i_am_c_level", { p_company_id: o.companyId });
  if (exec.error) throw new Error(exec.error.message);
  if (exec.data === true) return { kind: "self_approved" };
  const { data: approverId, error: resolveError } = await supabase.rpc("resolve_approver", { p_approver_type: step.approver_type, p_employee_id: o.employeeId });
  if (resolveError) throw new Error(resolveError.message);
  if (!approverId) return { kind: "none", why: "Nobody can approve it yet (for example you have no manager recorded). HR can fix it." };
  if (approverId === o.userId) return { kind: "none", why: "The first approver resolves to you, so HR needs to assign someone else." };
  const { data: profile, error: profileError } = await supabase.from("profiles").select("full_name, email").eq("id", approverId).maybeSingle();
  if (profileError) throw new Error(profileError.message);
  return { kind: "person", name: profile?.full_name?.trim() || profile?.email?.split("@")[0] || "Your approver" };
}
