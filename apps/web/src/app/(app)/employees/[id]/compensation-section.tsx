import { createClient } from "@/lib/supabase/server";
import { AddCompensationForm } from "./add-compensation-form";

export async function CompensationSection({
  employeeId,
  canEdit,
  isSelf,
}: {
  employeeId: string;
  canEdit: boolean;
  isSelf: boolean;
}) {
  const supabase = await createClient();
  const { data: current } = await supabase
    .from("compensation_details")
    .select("id, effective_from, base_salary, currency, bank_iban")
    .eq("employee_id", employeeId)
    .eq("is_current", true)
    .maybeSingle();

  return (
    <div className="space-y-4">
      {current ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Base salary</dt>
          <dd>
            {current.base_salary} {current.currency}
          </dd>
          <dt className="text-muted-foreground">Effective from</dt>
          <dd>{current.effective_from}</dd>
          {current.bank_iban ? (
            <>
              <dt className="text-muted-foreground">Bank IBAN</dt>
              <dd className="font-mono text-xs">{current.bank_iban}</dd>
            </>
          ) : null}
          {isSelf ? <dd className="col-span-2 text-xs text-muted-foreground">Read-only — HR or Finance updates this on your behalf.</dd> : null}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">No compensation on record yet.</p>
      )}

      {canEdit ? (
        <AddCompensationForm employeeId={employeeId} currentCompensationId={current?.id ?? null} />
      ) : null}
    </div>
  );
}
