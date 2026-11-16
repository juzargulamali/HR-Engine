import Link from "next/link";
import { canViewHrAlerts, getBusinessDateString, resolveCountryTimeZone } from "@enginious-hr/domain";
import { getCurrentSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoHint } from "@/components/ui/info-hint";
import { AccessNotice } from "@/components/os/access-notice";
import { LoadError } from "@/components/workspace/states";
import { RememberList } from "@/components/workspace/list-memory";
import { ListToolbar, type ToolbarFilter } from "@/components/workspace/list-toolbar";
import { withParams } from "@/components/workspace/url-state";
import { loadHrQueue } from "@/lib/hr/queue-data";
import { CONTRACT_LOOKAHEAD_DAYS, DOCUMENT_LOOKAHEAD_DAYS, QUEUE_GROUPS, countByState, STATE_LABEL, type QueueItem, type QueueState } from "@/lib/hr/queue";
import { cn } from "@/lib/utils";
import { QueueList } from "./queue-list";

export const metadata = { title: "Alerts" };

const BASE = "/alerts";
const VIEWS = ["all", "needs_action", "due_soon", "acknowledged"] as const;
type View = (typeof VIEWS)[number];

const GROUPS = QUEUE_GROUPS;

type SearchParams = { company?: string; view?: string; type?: string; q?: string };

export default async function AlertsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const sp = (await searchParams) ?? {};
  const session = await getCurrentSession();
  if (!session) return null;

  if (!canViewHrAlerts(session.grants)) {
    return <AccessNotice title="Alerts">Alerts are restricted to HR Admin, CEO, and CTO.</AccessNotice>;
  }

  const today = getBusinessDateString(resolveCountryTimeZone(null));
  const data = await loadHrQueue({ grants: session.grants, today });

  // The filters live in the address, so Back and the record's "back to Alerts" link return to the same company, type and view.
  const company = data.companies.some((c) => c.id === sp.company) ? sp.company! : "";
  const group = GROUPS.find((g) => g.value === sp.type) ?? GROUPS[0]!;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "all";
  const q = (sp.q ?? "").trim().slice(0, 100).toLowerCase();

  const scoped = data.items.filter((i) =>
    (!company || i.companyId === company)
    && (group.kinds.length === 0 || group.kinds.includes(i.kind))
    && (!q || (i.employeeName ?? "").toLowerCase().includes(q)),
  );
  const counts = countByState(scoped);
  const by = (s: QueueState): QueueItem[] => scoped.filter((i) => i.state === s);
  const show = (s: QueueState) => view === "all" || view === s;
  const read = data.failed.length === 0;

  const here = (patch: Record<string, string | null>) => withParams(BASE, sp as Record<string, string>, patch);
  const filtersInUse = !!(company || group.value || q);
  const retryHref = withParams(BASE, sp as Record<string, string>, {});
  const toolbarFilters: ToolbarFilter[] = [
    ...(data.companies.length > 1 ? [{ name: "company", label: "Company", value: company, options: [{ value: "", label: "All companies" }, ...data.companies.map((c) => ({ value: c.id, label: c.name }))] }] : []),
    { name: "type", label: "Type", value: group.value, options: GROUPS.map((g) => ({ value: g.value, label: g.label })) },
  ];

  // The processor's health is one line here (an alert may arrive late); its detail and the database fingerprint are in Administration.
  const supabase = await createClient();
  const { data: status } = await supabase.rpc("recovery_scheduler_status");
  const processorLate = !!status && (status.stale || status.open_failures > 0 || (status.windows_policy_active && !status.scheduler_ready.ready));

  const nothing = scoped.length === 0;

  return (
    <div className="space-y-6">
      <RememberList section="alerts" />
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Alerts</h1>
          <InfoHint label="How the Alerts queue works" testId="info-hint-alerts">
            <p><strong>Needs action</strong>: overdue, expired, or waiting for a person. <strong>Due soon</strong>: contracts and probation within {CONTRACT_LOOKAHEAD_DAYS} days, documents within {DOCUMENT_LOOKAHEAD_DAYS} days. <strong>Acknowledged</strong>: someone marked it as seen.</p>
            <p className="mt-2"><strong>Mark as seen</strong> records that you looked at it and nothing else. The item stays listed until the record itself is fixed: renew the document, record the contract change, correct the day. Fixing the record removes it here and on the employee&apos;s profile the next time the page loads.</p>
            <p className="mt-2">Dates are calendar days. Attendance and Recovery Leave items open the register on that employee and date.</p>
          </InfoHint>
        </div>
        <p className="text-muted-foreground">Everything HR needs to act on, in one list. As of {today}.</p>
      </div>

      {!read ? <LoadError what={`part of the alerts (${data.failed.join(", ")})`} retryHref={retryHref} /> : null}
      {processorLate ? (
        <Alert variant="warning" data-testid="processor-late">
          Recovery Leave background processing is not running on time, so Recovery Leave alerts and windows may appear late. A System Administrator can check Administration, Background processing.
        </Alert>
      ) : null}

      <ListToolbar search={{ value: sp.q ?? "", placeholder: "Search employee name", label: "Search the queue by employee name" }} filters={toolbarFilters} clearHref={filtersInUse ? here({ company: null, type: null, q: null }) : undefined} />

      <nav aria-label="View" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => {
          const n = v === "all" ? scoped.length : counts[v];
          return (
            <Link key={v} href={here({ view: v === "all" ? null : v })} aria-current={view === v ? "page" : undefined}
              className={cn("inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium", view === v ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}>
              {v === "all" ? "All" : STATE_LABEL[v]} <span className="text-[13px]">{read ? n : "—"}</span>
            </Link>
          );
        })}
      </nav>

      {nothing && read ? (
        <EmptyState dense title="Nothing needs attention right now." description={filtersInUse ? "No items match these filters." : "No contract, probation, document, attendance or recovery items are due."} />
      ) : (
        <div className="space-y-8">
          {show("needs_action") ? <QueueList title="Needs action" tone="needs_action" items={by("needs_action")} from="alerts" empty={read ? "Nothing needs action." : null} /> : null}
          {show("due_soon") ? <QueueList title="Due soon" tone="due_soon" items={by("due_soon")} from="alerts" empty={read ? "Nothing is coming up." : null} /> : null}
          {show("acknowledged") ? <QueueList title="Acknowledged" tone="acknowledged" items={by("acknowledged")} from="alerts" empty={read ? "Nothing has been acknowledged." : null} /> : null}
        </div>
      )}
    </div>
  );
}
