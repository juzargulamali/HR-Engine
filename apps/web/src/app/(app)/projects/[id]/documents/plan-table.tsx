import { planTableRows, type IssuedPlanPayload } from "@enginious-hr/domain";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { groupPlanRows } from "@/lib/pdf/plan-layout";

/** The readable table form of a client timeline payload: the same rows the PDF shows. */
export function PlanTable({ payload }: { payload: IssuedPlanPayload }) {
  const sections = groupPlanRows(planTableRows(payload));
  if (sections.length === 0) return <p className="text-sm text-muted-foreground">Nothing is marked client-facing yet.</p>;
  return (
    <div className="space-y-4">
      {sections.map((s) => (
        <div key={s.title}>
          <h4 className="mb-1 text-sm font-semibold">{s.title}</h4>
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>When</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
            <TableBody>
              {s.rows.map((r, i) => (
                <TableRow key={`${r.title}-${i}`}>
                  <TableCell className="py-2 font-medium">{r.title}</TableCell>
                  <TableCell className="py-2">{r.when}</TableCell>
                  <TableCell className="py-2 text-muted-foreground">{r.detail || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
}
