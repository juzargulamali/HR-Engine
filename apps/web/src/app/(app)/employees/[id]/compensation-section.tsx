import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { LoadError } from "@/components/workspace/states";
import { cn } from "@/lib/utils";

/**
 * Current pay, read only. Changing it is the ONE job-and-pay change form on the Employment tab: "Change salary" below opens that form with pay first, so there is no second
 * pay form to keep in step. The link is shown only to someone who may change this employee's pay (HR Admin or Finance of the company); the database decides again on save.
 */
export async function CompensationSection({
  employeeId,
  canEdit,
  isSelf,
  active = true,
}: {
  employeeId: string;
  canEdit: boolean;
  isSelf: boolean;
  /** False for someone who has left or was removed: their pay can no longer be changed. */
  active?: boolean;
}) {
  const supabase = await createClient();
  const { data: current, error } = await supabase
    .from("compensation_details")
    .select("id, effective_from, base_salary, allowances, currency, bank_iban")
    .eq("employee_id", employeeId)
    .eq("is_current", true)
    .maybeSingle();

  // A failed read is not "No compensation on record yet", and the change link (which replaces the current record) is withheld too.
  if (error) return <LoadError what="the compensation" retryHref={`/employees/${employeeId}?tab=compensation`} />;

  const otherAllowance = typeof current?.allowances?.other === "number" ? current.allowances.other : 0;
  const total = current ? Number(current.base_salary) + otherAllowance : 0;
  const showChange = canEdit && active;

  return (
    <div className="space-y-4">
      {current ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" data-testid="current-pay">
          <dt className="text-muted-foreground">Basic salary</dt>
          <dd>
            {current.base_salary} {current.currency}
          </dd>
          <dt className="text-muted-foreground">Others</dt>
          <dd>
            {otherAllowance} {current.currency}
          </dd>
          <dt className="text-muted-foreground">Total</dt>
          <dd className="font-medium">
            {total} {current.currency}
          </dd>
          <dt className="text-muted-foreground">Effective from</dt>
          <dd>{current.effective_from}</dd>
          {current.bank_iban ? (
            <>
              <dt className="text-muted-foreground">Bank IBAN</dt>
              <dd className="font-mono text-sm">{current.bank_iban}</dd>
            </>
          ) : null}
          {isSelf ? <dd className="col-span-2 text-sm text-muted-foreground">Read-only — HR or Finance updates this on your behalf.</dd> : null}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">No compensation on record yet.</p>
      )}

      {showChange ? (
        <Link
          href={`/employees/${employeeId}?tab=employment&${current ? "change=salary" : "step=pay"}#change-employment`}
          className={cn(buttonVariants({ size: "sm" }))}
          data-testid="change-salary-link"
        >
          {current ? "Change salary" : "Add salary"}
        </Link>
      ) : null}
    </div>
  );
}
