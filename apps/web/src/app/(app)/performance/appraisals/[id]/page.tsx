import Link from "next/link";
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
    .select(
      "id, employee_id, cycle_id, appraiser_id, overall_rating, quality_of_work_rating, productivity_rating, initiative_rating, teamwork_rating, punctuality_rating, strengths, areas_for_improvement, status, submitted_at, acknowledged_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (!appraisal) notFound();

  const [{ data: employee }, { data: cycle }, { data: appraiser }, { data: careerSummary }] = await Promise.all([
    supabase.from("employees").select("first_name, last_name, company_id").eq("id", appraisal.employee_id).single(),
    supabase.from("performance_cycles").select("name").eq("id", appraisal.cycle_id).single(),
    supabase.from("profiles").select("full_name, email").eq("id", appraisal.appraiser_id).maybeSingle(),
    supabase.rpc("get_career_summary_for_appraisal", { p_employee_id: appraisal.employee_id }).maybeSingle(),
  ]);

  const isSelf = session.employeeId === appraisal.employee_id;
  const isAppraiser = session.userId === appraisal.appraiser_id;
  const canManageAny = employee ? canManageAnyAppraisal(session.grants, employee.company_id) : false;
  const canEditContent = (isAppraiser && appraisal.status === "draft") || canManageAny;
  const canSubmit = isAppraiser && appraisal.status === "draft";
  const canAcknowledge = isSelf && appraisal.status === "submitted";
  const canDelete = appraisal.status === "draft" && (isAppraiser || canManageAny);

  return (
    <div className="space-y-6">
      <Link href="/performance" className="text-sm text-muted-foreground hover:underline">
        ← Back to performance
      </Link>
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
              qualityOfWorkRating={appraisal.quality_of_work_rating}
              productivityRating={appraisal.productivity_rating}
              initiativeRating={appraisal.initiative_rating}
              teamworkRating={appraisal.teamwork_rating}
              punctualityRating={appraisal.punctuality_rating}
              strengths={appraisal.strengths}
              areasForImprovement={appraisal.areas_for_improvement}
            />
          ) : (
            <div className="space-y-4 text-sm">
              <div>
                <div className="font-medium text-muted-foreground">Overall rating</div>
                <div>{appraisal.overall_rating ?? "Not set"}</div>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                  <div className="flex justify-between gap-2">
                    <dt>Quality of work</dt>
                    <dd className="font-medium text-foreground">{appraisal.quality_of_work_rating ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Productivity</dt>
                    <dd className="font-medium text-foreground">{appraisal.productivity_rating ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Initiative & ownership</dt>
                    <dd className="font-medium text-foreground">{appraisal.initiative_rating ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Teamwork & collaboration</dt>
                    <dd className="font-medium text-foreground">{appraisal.teamwork_rating ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Punctuality/attendance</dt>
                    <dd className="font-medium text-foreground">{appraisal.punctuality_rating ?? "—"}</dd>
                  </div>
                </dl>
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

      <Card>
        <CardHeader>
          <CardTitle>Career history (for context)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Dates only, no amounts — for comparing this appraisal against when the employee was last promoted or given a raise, without
            showing compensation figures.
          </p>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="font-medium text-muted-foreground">Last promotion</dt>
              <dd>{careerSummary?.last_promotion_date ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Last title change</dt>
              <dd>{careerSummary?.last_title_change_date ?? "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">Last salary change</dt>
              <dd>{careerSummary?.last_salary_change_date ?? "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {canSubmit || canAcknowledge || canDelete ? (
        <AppraisalActions appraisalId={appraisal.id} canSubmit={canSubmit} canAcknowledge={canAcknowledge} canDelete={canDelete} />
      ) : null}
    </div>
  );
}
