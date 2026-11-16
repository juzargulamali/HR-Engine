import { canEditCompensation, canViewCompensation, getBusinessDateString, resolveContractAsOf, resolveCountryTimeZone } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { splitTimeline, type CareerEventRow } from "@/lib/hr/changes";
import type { ProfileFocus } from "@/lib/hr/focus";
import { LoadError } from "@/components/workspace/states";
import { InfoHint } from "@/components/ui/info-hint";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContractHistory } from "./contract-history";
import { ScheduledChanges, ChangeHistory } from "./career-history-section";
import { ChangeEmploymentForm } from "./change-employment-form";

const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * The Employment tab: current terms, changes scheduled for a later date, the ONE form that changes job title and/or pay, the contract history and the applied history.
 * Every read is scoped by the viewer's own permission (and, below that, by row level security): a part the viewer may not see is not drawn, and a failed read says it could not load
 * instead of showing an empty list. The Compensation tab's "Change salary" link opens this same form.
 */
export async function EmploymentSection({
  employeeId,
  canSeeContracts,
  canEditContracts,
  canSeeCareerEvents,
  canRecordCareer,
  focus,
  companyName,
  countryCode,
}: {
  employeeId: string;
  canSeeContracts: boolean;
  canEditContracts: boolean;
  canSeeCareerEvents: boolean;
  canRecordCareer: boolean;
  focus?: ProfileFocus;
  companyName?: string;
  countryCode?: string;
}) {
  const session = await getCurrentSession();
  const supabase = await createClient();
  const here = `/employees/${employeeId}?tab=employment`;

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("id, first_name, last_name, job_title, hire_date, country_code, company_id, employment_status, deleted_at")
    .eq("id", employeeId)
    .maybeSingle();
  if (employeeError) return <LoadError what="the employment details" retryHref={here} />;
  if (!employee) return <LoadError what="the employment details" retryHref={here} note="This employee record could not be found or is not visible to you." />;

  const isSelf = session?.employeeId === employee.id;
  const grants = session?.grants ?? [];
  const canSeePay = canViewCompensation(grants, employee.company_id, isSelf);
  const canChangePay = !isSelf && canEditCompensation(grants, employee.company_id);
  const canChangeTitle = !isSelf && canRecordCareer;
  const active = !employee.deleted_at && employee.employment_status !== "terminated";
  const country = countryCode ?? employee.country_code;
  const today = getBusinessDateString(resolveCountryTimeZone(country));
  const employeeName = `${employee.first_name} ${employee.last_name}`;

  let company = companyName;
  if (!company) {
    const { data } = await supabase.from("companies").select("legal_name").eq("id", employee.company_id).maybeSingle();
    company = data?.legal_name ?? "";
  }

  const [contractsRes, compRes, eventsRes] = await Promise.all([
    canSeeContracts
      ? supabase.from("employment_contracts").select("id, contract_type, start_date, end_date, notice_period_days, is_current, version_no").eq("employee_id", employeeId).order("version_no", { ascending: false })
      : Promise.resolve({ data: null, error: null }),
    canSeePay
      ? supabase.from("compensation_details").select("id, effective_from, base_salary, allowances, currency").eq("employee_id", employeeId).eq("is_current", true).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    canSeeCareerEvents
      ? supabase.from("employee_career_events").select("id, event_type, effective_date, previous_job_title, new_job_title, previous_base_salary, new_base_salary, currency, note, applied_at").eq("employee_id", employeeId).order("effective_date", { ascending: false })
      : Promise.resolve({ data: null, error: null }),
  ]);
  const contracts = contractsRes.data;
  const comp = compRes.data;
  const timeline = splitTimeline(((eventsRes.data ?? []) as unknown as (Omit<CareerEventRow, "previous_base_salary" | "new_base_salary"> & { previous_base_salary: string | number | null; new_base_salary: string | number | null })[]).map((e) => ({ ...e, previous_base_salary: e.previous_base_salary == null ? null : Number(e.previous_base_salary), new_base_salary: e.new_base_salary == null ? null : Number(e.new_base_salary) })));

  const currentContract = resolveContractAsOf(
    (contracts ?? []).map((c) => ({ startDate: c.start_date, endDate: c.end_date, versionNo: c.version_no, ...c })),
    today,
  );
  const otherNow = typeof comp?.allowances?.other === "number" ? comp.allowances.other : 0;
  const formVisible = active && (canChangeTitle || canChangePay);
  const firstSalary = canSeePay && !compRes.error && !comp;
  const leadWith: "pay" | "job" = focus?.change === "salary" || focus?.step === "pay" || (!canChangeTitle && canChangePay) ? "pay" : "job";
  const formReady = !compRes.error;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Current terms</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" data-testid="current-terms">
            <dt className="text-muted-foreground">Job title</dt>
            <dd>{employee.job_title ?? "No job title set"}</dd>
            {canSeeContracts ? (
              <>
                <dt className="text-muted-foreground">Contract</dt>
                <dd>
                  {contractsRes.error ? <span className="text-destructive">Could not be loaded</span>
                    : currentContract ? <>{currentContract.contract_type.replace("_", " ")} · from {longDate(currentContract.start_date)} · {currentContract.notice_period_days}-day notice · version {currentContract.versionNo}</>
                    : "No contract on record yet"}
                </dd>
              </>
            ) : null}
            {canSeePay ? (
              <>
                <dt className="text-muted-foreground">Pay</dt>
                <dd>
                  {compRes.error ? <span className="text-destructive">Could not be loaded</span>
                    : comp ? <>{Number(comp.base_salary) + otherNow} {comp.currency} (basic {comp.base_salary}, others {otherNow}) · effective from {longDate(comp.effective_from)}</>
                    : "No salary on record yet"}
                </dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {canSeeCareerEvents ? (
        <Card>
          <CardHeader><CardTitle>Scheduled changes</CardTitle></CardHeader>
          <CardContent>
            {eventsRes.error ? <LoadError what="the scheduled changes" retryHref={here} /> : <ScheduledChanges events={timeline.scheduled} />}
          </CardContent>
        </Card>
      ) : null}

      {formVisible ? (
        <Card id="change-employment">
          <CardHeader>
            <div className="flex items-center gap-1.5">
              <CardTitle>{firstSalary && leadWith === "pay" ? "Add salary" : "Change job or pay"}</CardTitle>
              <InfoHint label="Change job or pay">
                <p>One form for a promotion, a title change or a pay change, with the date it takes effect. Job title and pay save together or not at all.</p>
                <p className="mt-1.5">Leave blank anything that is not changing. The Compensation tab&apos;s Change salary opens this same form.</p>
              </InfoHint>
            </div>
          </CardHeader>
          <CardContent>
            {!formReady ? (
              <LoadError what="the current pay" retryHref={here} note="Changing job or pay is unavailable until it loads, so a blank is never mistaken for no salary." />
            ) : (
              <ChangeEmploymentForm
                employeeId={employee.id}
                employeeName={employeeName}
                companyName={company ?? ""}
                today={today}
                hireDate={employee.hire_date}
                currentJobTitle={employee.job_title}
                currentBasic={comp ? Number(comp.base_salary) : null}
                currentOther={otherNow}
                currency={comp?.currency ?? ""}
                canChangeTitle={canChangeTitle}
                canSchedule={canChangeTitle}
                leadWith={leadWith}
                firstSalary={firstSalary}
                startOpen={focus?.change !== undefined || focus?.step === "pay"}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {canSeeContracts ? (
        <Card>
          <CardHeader><CardTitle>Contract history</CardTitle></CardHeader>
          <CardContent>
            {/* A failed read is not "No contract on record", and the add-version form (which numbers the next version from this list) is withheld too. */}
            {contractsRes.error ? (
              <LoadError what="the contract history" retryHref={here} />
            ) : (
              <ContractHistory
                employeeId={employeeId}
                contracts={contracts ?? []}
                currentAsOfTodayVersionNo={currentContract?.versionNo ?? null}
                canEdit={canEditContracts}
                startOpen={focus?.step === "contract"}
                employeeName={employeeName}
                companyName={company ?? ""}
                hireDate={employee.hire_date}
              />
            )}
          </CardContent>
        </Card>
      ) : null}

      {canSeeCareerEvents ? (
        <Card>
          <CardHeader><CardTitle>History</CardTitle></CardHeader>
          <CardContent>
            {eventsRes.error ? <LoadError what="the promotions and salary history" retryHref={here} /> : <ChangeHistory events={timeline.history} />}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
