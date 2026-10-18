import Link from "next/link";
import { canManageApprovalRules, canManageCrmAccess, canManageCrmSettings, isCrmFounder, parseWorkingCalendar } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/components/sales/format";
import { getCrmContext, type CrmCompanyInfo, type CrmContext } from "@/lib/crm/context";
import { createClient } from "@/lib/supabase/server";
import { APPROVAL_POLICY_EXPLANATION, APPROVAL_POLICY_LABEL, SettingsForm, type SettingsInitial } from "./settings-form";

export const metadata = { title: "Sales settings" };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function initialFor(company: CrmCompanyInfo, fallbackCurrency: string): SettingsInitial {
  const s = company.settings;
  const cal = s ? parseWorkingCalendar(s.working_calendar) : null;
  return {
    referenceCode: s?.reference_code ?? "",
    currency: s?.default_quote_currency ?? fallbackCurrency,
    responseTargetHours: s?.response_target_hours ?? null,
    workdays: cal?.workdays ?? [],
    workStart: cal?.start ?? "",
    workEnd: cal?.end ?? "",
    holidays: cal?.holidays.join(", ") ?? "",
    duplicateWindowDays: s?.duplicate_window_days ?? 180,
    ownerEmailEnabled: s?.owner_email_enabled ?? false,
    approvalPolicy: s?.approval_policy ?? "not_configured",
    approvalNote: s?.approval_note ?? "",
  };
}

function ReadOnlySettings({ company, ctx }: { company: CrmCompanyInfo; ctx: CrmContext }) {
  const s = company.settings;
  if (!s) return <p className="text-sm">These settings have not been set up yet. A founder, or someone allowed to manage Sales settings, needs to do that before enquiries can be recorded for this company.</p>;
  const cal = parseWorkingCalendar(s.working_calendar);
  const rows: [string, React.ReactNode][] = [
    ["Reference code", s.reference_code],
    ["Default quote currency", s.default_quote_currency],
    ["First-response target", s.response_target_hours ? `${s.response_target_hours} working hours` : "Not configured"],
    ["Working calendar", cal
      ? `${DAY_ORDER.filter((d) => cal.workdays.includes(d)).map((d) => DAY_NAMES[d]).join(", ")}, ${cal.start} to ${cal.end} Dubai time${cal.holidays.length ? `, ${cal.holidays.length} ${cal.holidays.length === 1 ? "holiday" : "holidays"}` : ""}`
      : "Not configured"],
    ["Duplicate window", `${s.duplicate_window_days} days`],
    ["Email reminders to owners", s.owner_email_enabled ? "On" : "Off"],
    ["Commercial approval policy", (
      <span key="p">
        {APPROVAL_POLICY_LABEL[s.approval_policy]}
        <span className="block text-sm text-muted-foreground">{APPROVAL_POLICY_EXPLANATION[s.approval_policy]}</span>
        {s.approval_note ? <span className="block break-words text-sm text-muted-foreground">Note: {s.approval_note}</span> : null}
      </span>
    )],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[14rem_minmax(0,1fr)]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
      <div className="contents">
        <dt className="text-muted-foreground">Last changed</dt>
        <dd>{formatDate(s.updated_at)} by {ctx.personName(s.updated_by)}</dd>
      </div>
    </dl>
  );
}

export default async function SalesSettingsPage() {
  const ctx = await getCrmContext();
  if (!ctx) return null;

  const supabase = await createClient();
  const { data: companyRows } = ctx.companies.length > 0 ? await supabase.from("companies").select("id, default_currency").in("id", ctx.companies.map((c) => c.id)) : { data: [] };
  const legalCurrency = new Map((companyRows ?? []).map((c) => [c.id, c.default_currency]));

  const editable = (id: string) => isCrmFounder(ctx.grants, id) || canManageCrmSettings(ctx.grants, id);
  const missing = ctx.companies.filter((c) => !c.settings);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Sales settings</h1>
        <p className="text-muted-foreground">Per company: how enquiries are numbered, the default currency, response targets, the working calendar, duplicate warnings, reminders and the commercial approval policy. Anything left blank is shown as “Not configured”; nothing is guessed.</p>
      </div>

      {ctx.companies.length === 0 ? <Alert>You do not have Sales access to any company.</Alert> : null}

      {missing.length > 0 ? (
        <Alert variant="warning">
          <p className="font-medium">{missing.length === 1 ? "One company has" : `${missing.length} companies have`} no Sales settings yet: {missing.map((c) => c.name).join(", ")}.</p>
          <p className="mt-1">Enquiries cannot be recorded for a company until its reference code and default currency are set.</p>
        </Alert>
      ) : null}

      {ctx.companies.map((c) => {
        const canEdit = editable(c.id);
        return (
          <Card key={c.id} id={`company-${c.id}`}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="break-words">{c.name}</CardTitle>
                {c.settings ? <Badge variant="outline">Settings saved</Badge> : <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">Not set up yet</Badge>}
              </div>
              <CardDescription>
                {canEdit ? "You can change these settings." : "You can read these settings but not change them. Ask a founder, or someone allowed to manage Sales settings, to change them."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canEdit ? (
                <SettingsForm
                  companyId={c.id}
                  companyName={c.name}
                  exists={c.settings !== null}
                  initial={initialFor(c, legalCurrency.get(c.id) ?? "")}
                  canEditApproval={canManageApprovalRules(ctx.grants, c.id)}
                />
              ) : (
                <ReadOnlySettings company={c} ctx={ctx} />
              )}
            </CardContent>
          </Card>
        );
      })}

      {ctx.companies.some((c) => canManageCrmAccess(ctx.grants, c.id)) ? (
        <p className="text-sm text-muted-foreground">Who can use Sales is managed under <Link href="/sales/access" className="underline underline-offset-2">Access</Link>.</p>
      ) : null}
    </div>
  );
}
