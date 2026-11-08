import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canManageApprovalRules, canManageCrmAccess, canManageCrmSettings, isCrmFounder, parseWorkingCalendar } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/components/sales/format";
import { LoadError } from "@/components/workspace/states";
import { getCrmContext, type CrmCompanyInfo, type CrmContext } from "@/lib/crm/context";
import { createClient } from "@/lib/supabase/server";
import { TermsTemplateForm, VatChoices, type TermsView, type VatChoiceView } from "./quotation-defaults";
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

  const raw = supabase as unknown as SupabaseClient; // the quotation tables are not in the generated types
  // Quotation defaults (VAT choices, standard terms). A failed read says so; it never shows an empty list.
  const [vatRes, termsRes] = ctx.companies.length > 0
    ? await Promise.all([
        raw.from("crm_quote_vat_choices").select("id, company_id, label, kind, rate, active").in("company_id", ctx.companies.map((c) => c.id)).order("position"),
        raw.from("crm_quote_terms_templates").select("company_id, label, clauses").in("company_id", ctx.companies.map((c) => c.id)).order("company_id"),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const defaultsFailed = !!vatRes.error || !!termsRes.error;
  const vatBy = new Map<string, VatChoiceView[]>();
  for (const v of (vatRes.data ?? []) as (VatChoiceView & { company_id: string })[]) vatBy.set(v.company_id, [...(vatBy.get(v.company_id) ?? []), { ...v, rate: v.rate == null ? null : String(v.rate) }]);
  const termsBy = new Map(((termsRes.data ?? []) as (TermsView & { company_id: string })[]).map((t) => [t.company_id, t]));
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
                {c.settings ? <Badge variant="outline">Settings saved</Badge> : <Badge variant="outline" className="border-[hsl(var(--os-amber)/0.4)] bg-[hsl(var(--os-amber)/0.1)] text-[hsl(var(--os-amber))]">Not set up yet</Badge>}
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

      {ctx.companies.map((c) => (
        <Card key={`q-${c.id}`} id={`quotations-${c.id}`}>
          <CardHeader>
            <CardTitle className="break-words">{c.name}: Estimates &amp; Quotations</CardTitle>
            <CardDescription>The VAT choices Sales can pick from, and the standard terms copied into each new estimate. Changing the terms never changes an estimate that was already created or issued.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {defaultsFailed ? <LoadError what="the quotation defaults" retryHref="/sales/settings" /> : (
              <>
                <section aria-label="VAT choices" className="space-y-2"><h3 className="text-sm font-semibold">VAT choices</h3><VatChoices companyId={c.id} choices={vatBy.get(c.id) ?? []} canEdit={editable(c.id)} /></section>
                <section aria-label="Standard terms" className="space-y-2"><h3 className="text-sm font-semibold">Standard terms</h3>
                  {termsBy.get(c.id) ? (editable(c.id) ? <TermsTemplateForm companyId={c.id} terms={termsBy.get(c.id)!} /> : (
                    <div className="text-sm"><p className="font-medium">{termsBy.get(c.id)!.label}</p><ol className="mt-1 list-decimal space-y-1 pl-5">{termsBy.get(c.id)!.clauses.map((t) => <li key={t.title}><strong>{t.title}.</strong> {t.body}</li>)}</ol></div>
                  )) : <p className="text-sm text-muted-foreground">No standard terms recorded for this company yet.</p>}
                </section>
              </>
            )}
          </CardContent>
        </Card>
      ))}

      {ctx.companies.some((c) => canManageCrmAccess(ctx.grants, c.id)) ? (
        <p className="text-sm text-muted-foreground">Who can use Sales is managed under <Link href="/people-access" className="underline underline-offset-2">People & Access</Link>.</p>
      ) : null}
    </div>
  );
}
