import Link from "next/link";
import { canManagePerformanceCycles } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GoalForm } from "./goal-form";
import { GoalRowControls } from "./goal-row-controls";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  in_progress: "secondary",
  achieved: "default",
  missed: "destructive",
  draft: "outline",
  submitted: "secondary",
  acknowledged: "default",
};

export default async function PerformancePage() {
  const session = await getCurrentSession();
  if (!session) return null;

  if (!session.employeeId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My Performance</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">
          No employee record is linked to your account yet — nothing to show here.
        </CardContent>
      </Card>
    );
  }

  const supabase = await createClient();
  const { data: employee } = await supabase.from("employees").select("company_id").eq("id", session.employeeId).single();

  const [{ data: cycles }, { data: goals }, { data: appraisals }] = await Promise.all([
    employee
      ? supabase
          .from("performance_cycles")
          .select("id, name, status")
          .eq("company_id", employee.company_id)
          .order("period_start", { ascending: false })
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("goals")
      .select("id, cycle_id, title, weight_percent, target_date, status, self_rating, manager_rating")
      .eq("employee_id", session.employeeId)
      .order("created_at", { ascending: false }),
    supabase
      .from("appraisals")
      .select("id, cycle_id, appraiser_id, overall_rating, status")
      .eq("employee_id", session.employeeId),
  ]);

  const cycleName = new Map((cycles ?? []).map((c) => [c.id, c.name]));
  const openCycles = (cycles ?? []).filter((c) => c.status === "open").map((c) => ({ id: c.id, name: c.name }));
  const canManageCycles = employee ? canManagePerformanceCycles(session.grants, employee.company_id) : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My Performance</h1>
          <p className="text-muted-foreground">Your goals, self-assessments, and appraisals.</p>
        </div>
        {canManageCycles ? (
          <Link href="/performance/cycles" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Manage cycles
          </Link>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Goals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cycle</TableHead>
                <TableHead>Goal</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Ratings</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(goals ?? []).map((g) => (
                <TableRow key={g.id}>
                  <TableCell>{cycleName.get(g.cycle_id) ?? "—"}</TableCell>
                  <TableCell>
                    <div className="font-medium">{g.title}</div>
                    <Badge variant={STATUS_VARIANT[g.status] ?? "outline"} className="mt-1">
                      {g.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>{g.weight_percent ? `${g.weight_percent}%` : "—"}</TableCell>
                  <TableCell>{g.target_date ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    Self: {g.self_rating ?? "—"} · Manager: {g.manager_rating ?? "—"}
                  </TableCell>
                  <TableCell>
                    <GoalRowControls goalId={g.id} status={g.status} selfRating={g.self_rating} />
                  </TableCell>
                </TableRow>
              ))}
              {(goals ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No goals yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <div className="border-t border-border pt-4">
            <GoalForm cycles={openCycles} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appraisals</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
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
                  <TableCell>{cycleName.get(a.cycle_id) ?? "—"}</TableCell>
                  <TableCell>{a.overall_rating ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[a.status] ?? "outline"}>{a.status.replace(/_/g, " ")}</Badge>
                  </TableCell>
                  <TableCell>
                    <Link href={`/performance/appraisals/${a.id}`} className="text-sm text-accent hover:underline">
                      {a.status === "submitted" ? "Review & acknowledge" : "View"}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {(appraisals ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No appraisals yet — draft ones aren&apos;t shown until your appraiser submits them.
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
