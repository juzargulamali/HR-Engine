import Link from "next/link";
import { Inbox } from "lucide-react";
import { hasProjCapability } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HandoverBrief } from "@/components/projects/handover-brief";
import { HandoverProcess } from "@/components/projects/handover-process";
import { HandoverStatusBadge } from "@/components/projects/badges";
import { PageHeader, Muted, Panel } from "@/components/projects/parts";
import { PageTitle } from "@/components/projects/page-title";
import { LoadError } from "@/components/workspace/states";
import { formatDateTime } from "@/components/sales/format";
import { getProjectsContext } from "@/lib/projects/context";
import { handoverNext } from "@/lib/projects/handover-next";
import { createClient } from "@/lib/supabase/server";
import type { ProjHandoverRow } from "@/types/projects";
import { firstParam, parseRecordId, withParams } from "@/components/workspace/url-state";
import { closedHandovers, CLOSED_HANDOVER_STATUSES, HANDOVER_HISTORY_PAGE, HANDOVER_PARAM, OPEN_HANDOVER_STATUSES, parseHistoryPage, splitOpenHandovers } from "@/lib/projects/handover-list";
import { AssignPmForm, HandoverDecision } from "./handover-actions";

export const metadata = { title: "Handovers" };

type SearchParams = Record<string, string | string[] | undefined>;
const BASE = "/projects/handovers";

/**
 * Handovers. THREE reads, so that what needs someone is never pushed out by history: (1) every OPEN handover the person may see (submitted, PM assigned, clarification asked),
 * oldest first; (2) one page of finished ones (accepted, withdrawn), newest first, paged with `?page=`; (3) the one brief named in the address (`?handover=<id>`, the link My Day
 * uses), read by its id, so a permitted direct link opens the right brief whatever page the list is on. Row-level security decides what each read returns.
 */
export default async function HandoversPage({ searchParams }: { searchParams?: Promise<SearchParams> } = {}) {
  const sp = (await searchParams) ?? {};
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const supabase = await createClient();
  const page = parseHistoryPage(firstParam(sp, "page") || undefined);
  const askedId = parseRecordId(firstParam(sp, HANDOVER_PARAM));
  const from = (page - 1) * HANDOVER_HISTORY_PAGE;
  const [openRes, closedRes, askedRes] = await Promise.all([
    supabase.from("proj_handovers").select("*").in("status", [...OPEN_HANDOVER_STATUSES]).order("submitted_at", { ascending: true, nullsFirst: false }).limit(500),
    supabase.from("proj_handovers").select("*", { count: "exact" }).in("status", [...CLOSED_HANDOVER_STATUSES]).order("updated_at", { ascending: false }).range(from, from + HANDOVER_HISTORY_PAGE - 1),
    askedId ? supabase.from("proj_handovers").select("*").eq("id", askedId).neq("status", "draft").limit(1) : Promise.resolve({ data: [] as ProjHandoverRow[], error: null }),
  ]);
  // A failed read is not "No handovers to show": a handover may be waiting.
  if (openRes.error) {
    console.error("[projects] handovers load failed", openRes.error);
    return (
      <div className="space-y-6">
        <PageHeader title="Handovers" />
        <LoadError what="the handovers" retryHref={BASE} />
      </div>
    );
  }
  const open = (openRes.data ?? []) as ProjHandoverRow[];
  const closed = closedHandovers((closedRes.data ?? []) as ProjHandoverRow[]);
  const closedTotal = closedRes.error ? null : (closedRes.count ?? closed.length);
  const canAssign = (companyId: string) => hasProjCapability(ctx.grants, companyId, "assign_pm");
  const { mine, toAssign, otherOpen } = splitOpenHandovers(open, ctx.userId, canAssign);
  // The brief named in the address, when the person may read it. It is shown first, in full, wherever it would otherwise be listed.
  const asked = askedId ? (((askedRes.data ?? []) as ProjHandoverRow[]).find((h) => h.id === askedId) ?? null) : null;
  const askedMissing = !!askedId && !asked;

  // Names of people who may not hold Projects access (Sales owners): the directory is readable only by those who assign PMs.
  const names = new Map<string, string>();
  let staffFailed = false;
  if (ctx.grants.some((g) => hasProjCapability([g], g.companyId, "assign_pm") || hasProjCapability([g], g.companyId, "manage_access"))) {
    const { data: staff, error: staffError } = await supabase.rpc("proj_staff_directory");
    staffFailed = !!staffError;
    for (const s of staff ?? []) names.set(s.user_id, s.full_name?.trim() || s.email?.split("@")[0] || "Unnamed");
  }
  // Sales people usually hold no Projects grant, so only people who assign PMs can read their names; everyone else sees a plain label.
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? ctx.people.find((p) => p.id === id)?.name ?? (id === ctx.userId ? "you" : staffFailed ? "name could not load" : "a Sales colleague")) : "Not chosen yet");

  const anyAssigner = ctx.grants.some((g) => hasProjCapability([g], g.companyId, "assign_pm"));
  const salesHref = (h: ProjHandoverRow) => (h.crm_opportunity_id ? `/sales/opportunities/${h.crm_opportunity_id}/handover` : null);
  const clarificationOf = (h: ProjHandoverRow) => (h.clarification_note ? { note: h.clarification_note, at: h.clarification_requested_at, answered: h.status !== "clarification_requested" } : null);
  const isMine = (h: ProjHandoverRow) => h.pm_user_id === ctx.userId && (h.status === "pm_assigned" || h.status === "clarification_requested");

  /** Who a handover is with and the next step, in one line (the viewer's own name reads "you"). */
  const ownerNext = (h: ProjHandoverRow) => handoverNext(h, { pm: nameOf(h.pm_user_id), sales: nameOf(h.prepared_by), viewerId: ctx.userId });
  /** One handover in full: who and where it stands, the decision for the assigned Project Manager first, then the brief. */
  const full = (h: ProjHandoverRow, opened = false) => {
    const people = ctx.people.filter((p) => p.companyIds.includes(h.company_id)).map((p) => ({ id: p.id, name: p.name }));
    const canChoose = canAssign(h.company_id) && (OPEN_HANDOVER_STATUSES as readonly string[]).includes(h.status);
    return (
      <div key={h.id} id={`handover-${h.id}`} className="scroll-mt-24" data-testid={opened ? "handover-opened" : undefined}>
        <Panel title={h.title} description={`${ctx.companyName(h.company_id)} · Sales ${h.crm_reference} · prepared by ${nameOf(h.prepared_by)}${h.submitted_at ? ` · submitted ${formatDateTime(h.submitted_at)}` : ""}`} actions={<HandoverStatusBadge status={h.status} />}>
          <div className="space-y-5">
            <p className="text-sm" data-testid="handover-owner-next"><span className="font-medium">{ownerNext(h).line}</span></p>
            {isMine(h) && h.status === "pm_assigned" ? <HandoverDecision handoverId={h.id} /> : null}
            {isMine(h) && h.status === "clarification_requested" ? <Alert variant="warning" role="status">You asked Sales a question (below). Sales has not resubmitted yet; you will be told when they do, and can then accept.</Alert> : null}
            {h.status === "accepted" && h.project_id ? <><Link href={`/projects/${h.project_id}/delivery?from=handover`} className={buttonVariants({ size: "sm" })} data-testid="handover-start-plan">Start the project plan</Link><Link href={`/projects/${h.project_id}/work`} className={buttonVariants({ variant: "outline", size: "sm" })}>Open the project</Link></> : null}
            <HandoverProcess status={h.status} />
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Project Manager</dt><dd className="mt-0.5">{nameOf(h.pm_user_id)}{h.pm_assigned_at ? ` (named ${formatDateTime(h.pm_assigned_at)})` : ""}</dd></div>
              <div><dt className="text-muted-foreground">Revision</dt><dd className="mt-0.5">{h.revision}</dd></div>
              {h.accepted_at ? <div><dt className="text-muted-foreground">Accepted</dt><dd className="mt-0.5">{formatDateTime(h.accepted_at)}</dd></div> : null}
            </dl>
            {canChoose ? <AssignPmForm handoverId={h.id} people={people} current={h.pm_user_id} /> : h.status === "submitted" ? <Muted>Only a founder, or someone they gave PM assignment to, can name the Project Manager.</Muted> : null}
            <HandoverBrief h={h} clarification={clarificationOf(h)} salesHref={salesHref(h)} />
          </div>
        </Panel>
      </div>
    );
  };
  /** A compact row for a handover that is not the viewer's step: its facts, with the brief one click away (the same page, opened by id). */
  const row = (h: ProjHandoverRow) => (
    <li key={h.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0">
        <p className="break-words font-medium">{h.title}</p>
        <p className="text-sm" data-testid="handover-owner-next">{ownerNext(h).line}</p>
        <p className="text-sm text-muted-foreground">
          {ctx.companyName(h.company_id)} · Sales {h.crm_reference} · Project Manager: {nameOf(h.pm_user_id)}
          {h.status === "accepted" && h.accepted_at ? ` · accepted ${formatDateTime(h.accepted_at)}` : h.submitted_at ? ` · submitted ${formatDateTime(h.submitted_at)}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <HandoverStatusBadge status={h.status} />
        {h.status === "accepted" && h.project_id ? <><Link href={`/projects/${h.project_id}/delivery?from=handover`} className={buttonVariants({ size: "sm" })} data-testid="handover-start-plan">Start the project plan</Link><Link href={`/projects/${h.project_id}/work`} className={buttonVariants({ variant: "outline", size: "sm" })}>Open the project</Link></> : null}
        <Link href={withParams(BASE, sp, { [HANDOVER_PARAM]: h.id })} scroll={false} className={buttonVariants({ variant: "ghost", size: "sm" })}>Open brief</Link>
      </div>
    </li>
  );
  const notAsked = <T extends { id: string }>(xs: readonly T[]) => xs.filter((h) => h.id !== asked?.id);
  const pages = closedTotal === null ? 1 : Math.max(1, Math.ceil(closedTotal / HANDOVER_HISTORY_PAGE));
  const nothing = open.length === 0 && closed.length === 0 && closedTotal === 0 && !asked;

  return (
    <div className="space-y-6">
      <PageTitle title="Handovers" hint={<>
        <p>Sales hands a won opportunity to delivery here, in one process: prepare brief, submit, assign PM, PM accepts, project created.</p>
        <p className="mt-1.5">A founder names the Project Manager, who accepts it (which creates the project) or asks Sales a question.</p>
        <p className="mt-1.5">The brief carries no prices, budgets or purchase-order details.</p>
      </>} />

      {staffFailed ? <LoadError what="the staff names" retryHref={BASE} note="Where a name reads “name could not load” the person is not unknown: the directory could not be read." /> : null}

      {askedMissing ? (
        askedRes.error
          ? <LoadError what="the handover you opened" retryHref={withParams(BASE, sp)} />
          : <Alert role="status" data-testid="handover-not-available">That handover is not available to you: it may have been withdrawn, or it is not one you can see. The handovers you can see are below.</Alert>
      ) : null}
      {asked ? (
        <section className="space-y-3" aria-labelledby="opened">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="opened" className="text-lg font-semibold">The handover you opened</h2>
            <Link href={withParams(BASE, sp, { [HANDOVER_PARAM]: null })} scroll={false} className="text-sm font-medium underline underline-offset-2">Close and show the list</Link>
          </div>
          {full(asked, true)}
        </section>
      ) : null}

      {notAsked(mine).length > 0 ? (
        <section className="space-y-4" aria-labelledby="mine">
          <h2 id="mine" className="text-lg font-semibold">Waiting on you as Project Manager ({mine.length})</h2>
          {notAsked(mine).map((h) => full(h))}
        </section>
      ) : null}

      {notAsked(toAssign).length > 0 ? (
        <section className="space-y-4" aria-labelledby="assign">
          <h2 id="assign" className="text-lg font-semibold">Waiting for a Project Manager to be named ({toAssign.length})</h2>
          {notAsked(toAssign).map((h) => full(h))}
        </section>
      ) : null}

      {nothing ? (
        <EmptyState
          icon={Inbox}
          title="No handovers to show"
          description={anyAssigner ? "When Sales submits a handover for a won opportunity it appears here, ready for you to name a Project Manager." : "Handovers appear here when you are named Project Manager or when you can assign one."}
        />
      ) : null}

      {notAsked(otherOpen).length > 0 ? (
        <Panel title={`Open, waiting on someone else (${otherOpen.length})`} description="Nothing for you to do." hint="These are with the named Project Manager or back with Sales. Open a brief to read it.">
          <ul className="divide-y divide-border">{notAsked(otherOpen).map(row)}</ul>
        </Panel>
      ) : null}

      {closedRes.error ? <LoadError what="the finished handovers" retryHref={withParams(BASE, sp)} note="Open handovers above are complete; only the accepted and withdrawn ones could not be read." /> : closedTotal && closedTotal > 0 ? (
        <Panel title={`Accepted and withdrawn (${closedTotal})`} hint="History, newest first. Open handovers are never listed here, so paging through history cannot hide one that is waiting.">
          {closed.length === 0 ? <Muted>No handover on this page.</Muted> : <ul className="divide-y divide-border">{closed.map(row)}</ul>}
          {pages > 1 ? (
            <nav aria-label="History pages" className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              {page > 1 ? <Link href={withParams(BASE, sp, { page: page - 1 === 1 ? null : String(page - 1) })} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Newer</Link> : null}
              <span className="text-muted-foreground">Page {Math.min(page, pages)} of {pages}</span>
              {page < pages ? <Link href={withParams(BASE, sp, { page: String(page + 1) })} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Older</Link> : null}
            </nav>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}
