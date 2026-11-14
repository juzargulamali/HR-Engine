import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canManageApprovalRules, canManageCrmAccess, canManageCrmSettings, isCrmFounder, parseWorkingCalendar } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { InfoHint } from "@/components/ui/info-hint";
import { Panel } from "@/components/projects/parts";
import { ChooseCompanyNotice, CompanySwitch } from "@/components/sales/company-switch";
import { formatDate } from "@/components/sales/format";
import { LoadError } from "@/components/workspace/states";
import { pickSalesCompany } from "@/lib/crm/active-company-server";
import { getCrmContext, type CrmCompanyInfo, type CrmContext } from "@/lib/crm/context";
import { createClient } from "@/lib/supabase/server";
import { SECTION, settingsBlockers } from "./blockers";
import { VatChoices, type VatChoiceView } from "./quotation-defaults";
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

export default async function SalesSettingsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCrmContext();
  if (!ctx) return null;
  const sp = (await searchParams) ?? {};
  // ONE company's settings at a time: the company in the address (a link from Reports or an enquiry form names it), else the active Sales company. With several
  // companies and none to assume, the person chooses; nothing is shown for a company they did not pick.
  const active = await pickSalesCompany(ctx, sp.company);
  const c = active.company;
  const editable = (id: string) => isCrmFounder(ctx.grants, id) || canManageCrmSettings(ctx.grants, id);
  const others = ctx.companies.filter((x) => !x.settings && x.id !== c?.id);

  const header = (
    <div>
      <h1 className="text-2xl font-semibold">Sales settings
        <InfoHint label="Sales settings" className="ml-1.5">Per company: response targets and the working calendar, the commercial approval policy, and how enquiries and estimates are numbered, the default currency, duplicate warnings and the VAT choices. Anything left blank is shown as “Not configured”; nothing is guessed.</InfoHint>
      </h1>
      <p className="text-sm text-muted-foreground">One company at a time. Anything left blank is shown as “Not configured”; nothing is guessed.</p>
    </div>
  );
  const switcher = ctx.companies.length > 0 ? <CompanySwitch companies={ctx.companies} current={c?.id ?? null} from={active.from} hrefFor={(id) => `/sales/settings?company=${id}`} /> : null;
  // Other companies that cannot take enquiries yet are named with the way to them (the page shows one company, so they would otherwise go unnoticed).
  const otherCompanies = others.length > 0 ? (
    <Alert variant="warning" data-testid="settings-other-companies">
      <p><strong>{others.length === 1 ? "One other company has" : `${others.length} other companies have`} no Sales settings yet</strong>, so enquiries cannot be recorded for {others.length === 1 ? "it" : "them"}:{" "}
        {others.map((x, i) => <span key={x.id}>{i ? ", " : ""}<Link href={`/sales/settings?company=${x.id}#${SECTION.estimates}`} className="font-medium underline underline-offset-2">{x.name}</Link></span>)}.</p>
    </Alert>
  ) : null;

  if (!c) {
    return (
      <div className="space-y-5">
        {header}
        {ctx.companies.length === 0 ? <Alert>You do not have Sales access to any company.</Alert> : <>{switcher}<ChooseCompanyNotice what="its Sales settings" />{otherCompanies}</>}
      </div>
    );
  }

  const supabase = await createClient();
  const { data: companyRows } = await supabase.from("companies").select("id, default_currency").in("id", [c.id]);
  const legalCurrency = (companyRows ?? []).find((r) => r.id === c.id)?.default_currency ?? "";

  const raw = supabase as unknown as SupabaseClient; // the quotation tables are not in the generated types
  // Estimate defaults (the VAT choices). A failed read says so; it never shows an empty list. The old standard terms are kept in the database but no longer used.
  const vatRes = await raw.from("crm_quote_vat_choices").select("id, company_id, label, kind, rate, active").eq("company_id", c.id).order("position");
  const defaultsFailed = !!vatRes.error;
  const vat: VatChoiceView[] = ((vatRes.data ?? []) as (VatChoiceView & { company_id: string })[]).map((v) => ({ ...v, rate: v.rate == null ? null : String(v.rate) }));
  const canEdit = editable(c.id);
  const blockers = settingsBlockers({ settings: c.settings, activeVatChoices: defaultsFailed ? null : vat.filter((v) => v.active).length });

  return (
    <div className="space-y-5">
      {header}
      {switcher}

      {blockers.length > 0 ? (
        <section aria-labelledby="settings-blockers" className="os-card space-y-2 p-4" data-testid="settings-blockers" style={{ borderColor: "hsl(var(--os-amber) / 0.5)" }}>
          <h2 id="settings-blockers" className="text-sm font-semibold text-[hsl(var(--os-amber))]">Not set for {c.name}, and blocking work</h2>
          <ul className="space-y-2 text-sm">
            {blockers.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1" data-blocker={b.id}>
                <span className="min-w-0"><strong className="font-medium">{b.title}.</strong> {b.blocks}</span>
                <a href={`#${b.section}`} className="shrink-0 font-medium underline underline-offset-2">{canEdit ? b.action : "See the setting"}</a>
              </li>
            ))}
          </ul>
          {canEdit ? null : <p className="text-sm text-muted-foreground">Ask a founder, or someone allowed to manage Sales settings, to set these.</p>}
        </section>
      ) : null}
      {otherCompanies}

      <p className="text-sm text-muted-foreground" data-testid="settings-access">
        {canEdit ? <>You can change the settings of <strong className="font-medium text-foreground">{c.name}</strong>.</> : "You can read these settings but not change them. Ask a founder, or someone allowed to manage Sales settings, to change them."}
      </p>

      {canEdit ? (
        <SettingsForm key={c.id} companyId={c.id} companyName={c.name} exists={c.settings !== null} initial={initialFor(c, legalCurrency)} canEditApproval={canManageApprovalRules(ctx.grants, c.id)} />
      ) : (
        <Panel id="settings-read-only" title={c.name} actions={c.settings ? null : <span className="os-badge" data-tone="amber">Not set up yet</span>}>
          {/* The read-only view is one list; the section addresses other pages link to (for example Reports) still land here. */}
          {[SECTION.response, SECTION.approval, SECTION.estimates].map((anchor) => <span key={anchor} id={anchor} />)}
          <ReadOnlySettings company={c} ctx={ctx} />
        </Panel>
      )}

      <Panel id={SECTION.vat} title={`VAT choices for ${c.name}`} description="Part of Estimates & VAT. Each choice is saved as it is added."
        hint="The VAT choices Sales can pick from on an estimate. “0%” and “Out of scope” are separate explicit choices; nothing is chosen for the client. Estimates do not print standard terms.">
        {defaultsFailed ? <LoadError what="the VAT choices" retryHref={`/sales/settings?company=${c.id}`} /> : (
          <section aria-label="VAT choices"><VatChoices companyId={c.id} companyName={c.name} choices={vat} canEdit={canEdit} /></section>
        )}
      </Panel>

      {canManageCrmAccess(ctx.grants, c.id) ? (
        <p className="text-sm text-muted-foreground">Who can use Sales is managed under <Link href="/people-access" className="underline underline-offset-2">People & Access</Link>.</p>
      ) : null}
    </div>
  );
}
