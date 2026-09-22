import { canManageLetters } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { IssueLetterForm } from "./issue-letter-form";
import { NewTemplateForm } from "./new-template-form";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "outline",
  pending_approval: "secondary",
  issued: "default",
  void: "destructive",
};

export default async function LettersPage() {
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: employee } = session.employeeId
    ? await supabase.from("employees").select("company_id").eq("id", session.employeeId).single()
    : { data: null };

  const canManage = employee ? canManageLetters(session.grants, employee.company_id) : false;

  const { data: templates } = employee
    ? await supabase
        .from("letter_templates")
        .select("id, name, template_type, requires_approval")
        .eq("company_id", employee.company_id)
        .is("deleted_at", null)
        .order("name")
    : { data: [] as never[] };

  const lettersQuery = canManage
    ? supabase
        .from("generated_letters")
        .select("id, employee_id, template_id, status, generated_at")
        .order("generated_at", { ascending: false })
    : session.employeeId
      ? supabase
          .from("generated_letters")
          .select("id, employee_id, template_id, status, generated_at")
          .eq("employee_id", session.employeeId)
          .order("generated_at", { ascending: false })
      : null;
  const { data: letters } = lettersQuery ? await lettersQuery : { data: [] as never[] };

  const employeeIds = [...new Set((letters ?? []).map((l) => l.employee_id))];
  const { data: employees } =
    employeeIds.length > 0 ? await supabase.from("employees").select("id, first_name, last_name").in("id", employeeIds) : { data: [] as never[] };
  const employeeName = new Map((employees ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));

  const allTemplateIds = [...new Set((letters ?? []).map((l) => l.template_id))];
  const { data: allTemplates } =
    allTemplateIds.length > 0 ? await supabase.from("letter_templates").select("id, name").in("id", allTemplateIds) : { data: [] as never[] };
  const templateNameById = new Map((allTemplates ?? []).map((t) => [t.id, t.name]));

  const employeesForIssue = canManage
    ? (await supabase.from("employees").select("id, first_name, last_name").is("deleted_at", null).eq("company_id", employee!.company_id).order("first_name")).data ?? []
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Letters</h1>
        <p className="text-muted-foreground">
          {canManage
            ? "Issue employment letters from templates; some require CEO sign-off before they're issued."
            : "Letters HR has issued for you."}
        </p>
      </div>

      {canManage ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Issue a letter</CardTitle>
            </CardHeader>
            <CardContent>
              {templates && templates.length > 0 ? (
                <IssueLetterForm employees={employeesForIssue} templates={templates} />
              ) : (
                <p className="text-sm text-muted-foreground">Create a template first.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>New template</CardTitle>
            </CardHeader>
            <CardContent>
              <NewTemplateForm companyId={employee!.company_id} />
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{canManage ? "Issued letters" : "My letters"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                {canManage ? <TableHead>Employee</TableHead> : null}
                <TableHead>Template</TableHead>
                <TableHead>Generated</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(letters ?? []).map((l) => (
                <TableRow key={l.id}>
                  {canManage ? <TableCell>{employeeName.get(l.employee_id) ?? "—"}</TableCell> : null}
                  <TableCell>{templateNameById.get(l.template_id) ?? "—"}</TableCell>
                  <TableCell>{new Date(l.generated_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[l.status] ?? "outline"}>{l.status.replace(/_/g, " ")}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(letters ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={canManage ? 4 : 3} className="text-center text-muted-foreground">
                    No letters yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
