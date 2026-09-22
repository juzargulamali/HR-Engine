import { notFound } from "next/navigation";
import { canManageAnyAppraisal } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AppraisalForm } from "./appraisal-form";
import { AppraisalActions } from "./appraisal-actions";

export default async function AppraisalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getCurrentSession();
  if (!session) return null;

  const supabase = await createClient();
  const { data: appraisal } = await supabase
    .from("appraisals")
    .select("id, employee_id, cycle_id, appraiser_id, overall_rating, strengths, areas_for_improvement, status, submitted_at, acknowledged_at")
    .eq("id", id)
    .maybeSingle();
  if (!appraisal) notFound();

  const [{ data: employee }, { data: cycle }, { data: appraiser }] = await Promise.all([
    supabase.from("employees").select("first_name, last_name, company_id").eq("id", appraisal.employee_id).single(),
    supabase.from("performance_cycles").select("name").eq("id", appraisal.cycle_id).single(),
    supabase.from("profiles").select("full_name, email").eq("id", appraisal.appraiser_id).maybeSingle(),
  ]);

  const isSelf = session.employeeId === appraisal.employee_id;
  const isAppraiser = session.userId === appraisal.appraiser_id;
  const canManageAny = employee ? canManageAnyAppraisal(session.grants, employee.company_id) : false;
  const canEditContent = (isAppraiser && appraisal.status === "draft") || canManageAny;
  const canSubmit = isAppraiser && appraisal.status === "draft";
  const canAcknowledge = isSelf && appraisal.status === "submitted";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {employee?.first_name} {employee?.last_name} — {cycle?.name}
          </h1>
          <p className="text-muted-foreground">Appraised by {appraiser?.full_name ?? appraiser?.email ?? "—"}</p>
        </div>
        <Badge>{appraisal.status.replace(/_/g, " ")}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Appraisal</CardTitle>
        </CardHeader>
        <CardContent>
          {canEditContent ? (
            <AppraisalForm
              appraisalId={appraisal.id}
              overallRating={appraisal.overall_rating}
              strengths={appraisal.strengths}
              areasForImprovement={appraisal.areas_for_improvement}
            />
          ) : (
            <div className="space-y-4 text-sm">
              <div>
                <div className="font-medium text-muted-foreground">Overall rating</div>
                <div>{appraisal.overall_rating ?? "Not set"}</div>
              </div>
              <div>
                <div className="font-medium text-muted-foreground">Strengths</div>
                <div className="whitespace-pre-wrap">{appraisal.strengths ?? "—"}</div>
              </div>
              <div>
                <div className="font-medium text-muted-foreground">Areas for improvement</div>
                <div className="whitespace-pre-wrap">{appraisal.areas_for_improvement ?? "—"}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {canSubmit || canAcknowledge ? (
        <AppraisalActions appraisalId={appraisal.id} canSubmit={canSubmit} canAcknowledge={canAcknowledge} />
      ) : null}
    </div>
  );
}
