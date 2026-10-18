import Link from "next/link";
import { Inbox } from "lucide-react";
import { HANDOVER_STATUS_LABELS, hasProjCapability } from "@enginious-hr/domain";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { HandoverBrief } from "@/components/projects/handover-brief";
import { HandoverStatusBadge } from "@/components/projects/badges";
import { Muted, PageHeader, Panel } from "@/components/projects/parts";
import { formatDateTime } from "@/components/sales/format";
import { getProjectsContext } from "@/lib/projects/context";
import { createClient } from "@/lib/supabase/server";
import type { ProjHandoverRow } from "@/types/projects";
import { AcceptHandoverForm, AssignPmForm, ClarifyHandoverForm } from "./handover-actions";

export const metadata = { title: "Handovers" };

/** Who acts next, in words, for each state. */
const NEXT: Record<string, string> = {
  draft: "Sales is still preparing it. Nothing is needed from you yet.",
  submitted: "Waiting for a Project Manager. A founder, or someone they gave PM assignment to, names one.",
  pm_assigned: "Waiting for the Project Manager to accept it, or to ask Sales to clarify.",
  clarification_requested: "The Project Manager asked Sales a question. Sales answers and resubmits; the same Project Manager then decides.",
  accepted: "Accepted. The project exists and this brief is kept as the agreed snapshot.",
  withdrawn: "Sales withdrew it before acceptance.",
};
const ORDER = ["submitted", "pm_assigned", "clarification_requested", "accepted", "withdrawn"];

export default async function HandoversPage() {
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("proj_handovers").select("*").neq("status", "draft").order("updated_at", { ascending: false }).limit(200);
  const handovers = (data ?? []) as ProjHandoverRow[];
  const canAssign = (companyId: string) => hasProjCapability(ctx.grants, companyId, "assign_pm");

  // Names of people who may not hold Projects access (Sales owners): the directory is readable only by those who assign PMs.
  const names = new Map<string, string>();
  if (ctx.grants.some((g) => hasProjCapability([g], g.companyId, "assign_pm") || hasProjCapability([g], g.companyId, "manage_access"))) {
    const { data: staff } = await supabase.rpc("proj_staff_directory");
    for (const s of staff ?? []) names.set(s.user_id, s.full_name?.trim() || s.email?.split("@")[0] || "Unnamed");
  }
  // Sales people usually hold no Projects grant, so only people who assign PMs can read their names; everyone else sees a plain label.
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? ctx.people.find((p) => p.id === id)?.name ?? (id === ctx.userId ? "you" : "a Sales colleague")) : "Not chosen yet");

  const mine = handovers.filter((h) => h.pm_user_id === ctx.userId && (h.status === "pm_assigned" || h.status === "clarification_requested"));
  const rest = handovers.filter((h) => !mine.includes(h));
  const sorted = [...rest].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const anyAssigner = ctx.grants.some((g) => hasProjCapability([g], g.companyId, "assign_pm"));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Handovers"
        description="Sales hands a won opportunity to delivery here. A founder names the Project Manager, who accepts it (which creates the project) or asks Sales to clarify. The brief carries no prices, budgets or purchase-order details."
      />

      {mine.length > 0 ? (
        <section className="space-y-4" aria-labelledby="mine">
          <h2 id="mine" className="text-lg font-semibold">Waiting on you as Project Manager</h2>
          {mine.map((h) => (
            <Panel key={h.id} title={`${h.title}`} description={`${ctx.companyName(h.company_id)} · Sales ${h.crm_reference} · submitted ${formatDateTime(h.submitted_at)} by ${nameOf(h.prepared_by)}`} actions={<HandoverStatusBadge status={h.status} />}>
              <div className="space-y-5">
                {h.status === "clarification_requested" ? (
                  <Alert variant="warning" role="status">
                    You asked Sales: “{h.clarification_note}”. Sales has not resubmitted yet; you will be told when they do.
                  </Alert>
                ) : (
                  <>
                    <HandoverBrief h={h} />
                    <div className="space-y-3 border-t border-border pt-4">
                      <AcceptHandoverForm handoverId={h.id} />
                      <ClarifyHandoverForm handoverId={h.id} />
                    </div>
                  </>
                )}
              </div>
            </Panel>
          ))}
        </section>
      ) : null}

      {sorted.length === 0 && mine.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No handovers to show"
          description={anyAssigner ? "When Sales submits a handover for a won opportunity it appears here, ready for you to name a Project Manager." : "Handovers appear here when you are named Project Manager or when you can assign one."}
        />
      ) : null}

      {sorted.length > 0 ? (
        <section className="space-y-4" aria-labelledby="all">
          <h2 id="all" className="text-lg font-semibold">{anyAssigner ? "Handovers in your companies" : "Handovers you can see"}</h2>
          {sorted.map((h) => {
            const people = ctx.people.filter((p) => p.companyIds.includes(h.company_id)).map((p) => ({ id: p.id, name: p.name }));
            const canChoose = canAssign(h.company_id) && ["submitted", "pm_assigned", "clarification_requested"].includes(h.status);
            return (
              <Panel
                key={h.id}
                title={h.title}
                description={`${ctx.companyName(h.company_id)} · Sales ${h.crm_reference} · prepared by ${nameOf(h.prepared_by)}${h.submitted_at ? ` · submitted ${formatDateTime(h.submitted_at)}` : ""}`}
                actions={<HandoverStatusBadge status={h.status} />}
              >
                <div className="space-y-5">
                  <p className="text-sm">{NEXT[h.status] ?? HANDOVER_STATUS_LABELS[h.status]}</p>
                  <dl className="grid gap-3 text-sm sm:grid-cols-3">
                    <div><dt className="text-muted-foreground">Project Manager</dt><dd className="mt-0.5">{nameOf(h.pm_user_id)}{h.pm_assigned_at ? ` (named ${formatDateTime(h.pm_assigned_at)})` : ""}</dd></div>
                    <div><dt className="text-muted-foreground">Revision</dt><dd className="mt-0.5">{h.revision}</dd></div>
                    {h.accepted_at ? <div><dt className="text-muted-foreground">Accepted</dt><dd className="mt-0.5">{formatDateTime(h.accepted_at)}</dd></div> : null}
                  </dl>
                  {h.clarification_note ? <Alert role="status">Clarification asked: “{h.clarification_note}”{h.clarification_requested_at ? ` (${formatDateTime(h.clarification_requested_at)})` : ""}</Alert> : null}
                  {h.project_id ? <Link href={`/projects/${h.project_id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Open the project</Link> : null}
                  {canChoose ? <AssignPmForm handoverId={h.id} people={people} current={h.pm_user_id} /> : h.status === "submitted" ? <Muted>Only a founder, or someone they gave PM assignment to, can name the Project Manager.</Muted> : null}
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">Delivery brief</summary>
                    <div className="mt-3"><HandoverBrief h={h} /></div>
                  </details>
                </div>
              </Panel>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
