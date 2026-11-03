import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { RateGoalForm } from "./rate-goal-form";
import { StartAppraisalForm } from "./start-appraisal-form";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadError } from "@/components/workspace/states";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  in_progress: "secondary",
  achieved: "default",
  missed: "destructive",
  draft: "outline",
  submitted: "secondary",
  acknowledged: "default",
};

export async function PerformanceSection({
  employeeId,
  companyId,
  canManage,
}: {
  employeeId: string;
  companyId: string;
  canManage: boolean;
}) {
  const supabase = await createClient();
  const [{ data: goals, error: goalsError }, { data: cycles, error: cyclesError }, { data: appraisals, error: appraisalsError }] = await Promise.all([
    supabase
      .from("goals")
      .select("id, cycle_id, title, weight_percent, target_date, status, self_rating, manager_rating")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false }),
    supabase.from("performance_cycles").select("id, name, status").eq("company_id", companyId).order("period_start", { ascending: false }),
    supabase.from("appraisals").select("id, cycle_id, status, overall_rating").eq("employee_id", employeeId),
  ]);

  const cycleName = new Map((cycles ?? []).map((c) => [c.id, c.name]));
  const appraisedCycleIds = new Set((appraisals ?? []).map((a) => a.cycle_id));
  const availableCyclesForAppraisal = (cycles ?? [])
    .filter((c) => c.status === "open" && !appraisedCycleIds.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }));

  const here = `/employees/${employeeId}?tab=performance`;
  return (
    <div className="space-y-6">
      {cyclesError && !goalsError && !appraisalsError ? <LoadError what="the cycle names" retryHref={here} note="Goals and appraisals are shown, but their cycle column could not be read." /> : null}
      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Goals</h3>
        {goalsError ? <LoadError what="the goals" retryHref={here} /> : (
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Cycle</TableHead>
              <TableHead>Goal</TableHead>
              <TableHead>Ratings</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(goals ?? []).map((g) => (
              <TableRow key={g.id}>
                <TableCell>{cycleName.get(g.cycle_id) ?? (cyclesError ? "Could not load" : "—")}</TableCell>
                <TableCell>
                  <div className="font-medium">{g.title}</div>
                  <Badge variant={STATUS_VARIANT[g.status] ?? "outline"} className="mt-1">
                    {g.status.replace(/_/g, " ")}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  Self: {g.self_rating ?? "—"} · Manager: {g.manager_rating ?? "—"}
                </TableCell>
                <TableCell>{canManage ? <RateGoalForm goalId={g.id} managerRating={g.manager_rating} /> : null}</TableCell>
              </TableRow>
            ))}
            {(goals ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <EmptyState dense title="No goals yet." />
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-muted-foreground">Appraisals</h3>
        {appraisalsError ? <LoadError what="the appraisals" retryHref={here} /> : (
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Cycle</TableHead>
              <TableHead>Overall rating</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(appraisals ?? []).map((a) => (
              <TableRow key={a.id}>
                <TableCell>{cycleName.get(a.cycle_id) ?? (cyclesError ? "Could not load" : "—")}</TableCell>
                <TableCell>{a.overall_rating ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[a.status] ?? "outline"}>{a.status.replace(/_/g, " ")}</Badge>
                </TableCell>
                <TableCell>
                  <Link href={`/performance/appraisals/${a.id}`} className="text-sm text-accent hover:underline">
                    View
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {(appraisals ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <EmptyState dense title="No appraisals yet." />
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        )}

        {/* The start-appraisal choice needs both the cycles and the existing appraisals: with either unreadable it is withheld, not offered from partial data. */}
        {canManage && !cyclesError && !appraisalsError && availableCyclesForAppraisal.length > 0 ? (
          <div className="mt-4 border-t border-border pt-4">
            <StartAppraisalForm employeeId={employeeId} cycles={availableCyclesForAppraisal} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
