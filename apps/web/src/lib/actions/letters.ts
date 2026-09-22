"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { resolveInitialApprover } from "./approvals";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

function renderTemplate(body: string, fields: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => fields[key] ?? match);
}

const issueLetterSchema = z.object({
  employeeId: z.string().uuid(),
  templateId: z.string().uuid(),
});

const createTemplateSchema = z.object({
  companyId: z.string().uuid(),
  templateType: z.string().min(1),
  name: z.string().min(1),
  bodyTemplate: z.string().min(1),
  requiresApproval: z.enum(["true", "false"]).optional(),
});

export async function createLetterTemplate(_prevState: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const parsed = createTemplateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("letter_templates").insert({
    company_id: d.companyId,
    template_type: d.templateType,
    name: d.name,
    body_template: d.bodyTemplate,
    requires_approval: d.requiresApproval !== "false",
  });
  if (error) return { error: error.message };

  revalidatePath("/letters");
  return { error: null };
}

async function currentUserId(supabase: SupabaseClient) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function issueLetter(_prevState: { error: string | null }, formData: FormData): Promise<{ error: string | null }> {
  const parsed = issueLetterSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const { employeeId, templateId } = parsed.data;

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { error: "Not signed in." };

  const [{ data: template }, { data: employee }] = await Promise.all([
    supabase.from("letter_templates").select("id, company_id, template_type, name, body_template, requires_approval").eq("id", templateId).single(),
    supabase.from("employees").select("id, company_id, first_name, last_name, job_title, hire_date, employee_number").eq("id", employeeId).single(),
  ]);
  if (!template) return { error: "Template not found." };
  if (!employee) return { error: "Employee not found." };

  const { data: company } = await supabase.from("companies").select("legal_name").eq("id", employee.company_id).single();

  const rendered = renderTemplate(template.body_template, {
    "employee.full_name": `${employee.first_name} ${employee.last_name}`,
    "employee.first_name": employee.first_name,
    "employee.last_name": employee.last_name,
    "employee.job_title": employee.job_title ?? "",
    "employee.hire_date": employee.hire_date,
    "employee.employee_number": employee.employee_number,
    "company.legal_name": company?.legal_name ?? "",
    "date.today": new Date().toISOString().slice(0, 10),
  });

  const filePath = `${employee.company_id}/${employee.id}/letters/${Date.now()}-${template.template_type}.html`;
  const { error: uploadError } = await supabase.storage
    .from("letters")
    .upload(filePath, new Blob([rendered], { type: "text/html" }));
  if (uploadError) return { error: `Could not store the letter: ${uploadError.message}` };

  const initialStatus = template.requires_approval ? "pending_approval" : "issued";
  const { data: letter, error: insertError } = await supabase
    .from("generated_letters")
    .insert({ employee_id: employeeId, template_id: templateId, generated_by: userId, file_path: filePath, status: initialStatus })
    .select("id")
    .single();
  if (insertError || !letter) return { error: insertError?.message ?? "Could not create the letter." };

  if (template.requires_approval) {
    const resolved = await resolveInitialApprover(supabase, "generated_letter", employee.company_id, employeeId);
    if ("error" in resolved) return resolved;

    const { error: approvalError } = await supabase.from("approvals").insert({
      entity_type: "generated_letter",
      entity_id: letter.id,
      workflow_id: resolved.workflowId,
      step_order: 1,
      approver_id: resolved.approverId,
    });
    if (approvalError) return { error: approvalError.message };
  }

  revalidatePath("/letters");
  revalidatePath("/approvals");
  return { error: null };
}

/**
 * Storage removal is best-effort — if it fails, the row still goes (and
 * with it, the only visible/downloadable path to the file: the storage
 * object itself becomes unreachable through the UI either way, since
 * every signed URL is generated from this row's file_path).
 */
export async function deleteLetter(letterId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: letter } = await supabase.from("generated_letters").select("file_path").eq("id", letterId).maybeSingle();
  if (letter?.file_path) {
    await supabase.storage.from("letters").remove([letter.file_path]);
  }

  const { error } = await supabase.from("generated_letters").delete().eq("id", letterId);
  revalidatePath("/letters");
  return { error: error?.message ?? null };
}
