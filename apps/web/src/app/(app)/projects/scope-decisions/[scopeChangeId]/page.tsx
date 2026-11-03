import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Fact, Muted, PageHeader, Panel } from "@/components/projects/parts";
import { LoadError } from "@/components/workspace/states";
import { DecideScopeChangeForm } from "@/app/(app)/projects/[id]/changes/feedback-forms";
import { getProjectsContext } from "@/lib/projects/context";
import { formatDateTime } from "@/lib/projects/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Scope change decision" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, string> = { proposed: "Waiting for a decision", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" };

/**
 * The decision page for ONE scope-change proposal, for the people the database authorises to decide it (a Projects founder or a holder of approve_scope), whether or not they belong to
 * the project. It reads only proj_scope_decision_context(): the project reference and name, the proposal title, the proposed scope, the stated effect on dates, who proposed it and
 * when. It shows nothing else about the project (no current scope, members, tasks, budget or cost effect) and creates no project access. A person who can already open the project's
 * own Feedback & changes page (a founder or a member) is sent there, exactly as before.
 */
export default async function ScopeDecisionPage({ params }: { params: Promise<{ scopeChangeId: string }> }) {
  const { scopeChangeId } = await params;
  const ctx = await getProjectsContext();
  if (!ctx) return null;
  const here = `/projects/scope-decisions/${scopeChangeId}`;
  const notAvailable = (
    <div className="space-y-6">
      <PageHeader title="Scope change decision" />
      <Alert role="status">This scope change is not available to you. It may have been withdrawn, or you may not be someone who decides scope changes for that company.</Alert>
      <Link href="/projects" className={buttonVariants({ variant: "outline", size: "sm" })}>Back to Projects</Link>
    </div>
  );
  if (!UUID.test(scopeChangeId)) return notAvailable;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("proj_scope_decision_context", { p_scope_change_id: scopeChangeId });
  // A failed read is not "not available": a decision may be waiting.
  if (error) {
    console.error("[projects] scope decision context failed", error);
    return (
      <div className="space-y-6">
        <PageHeader title="Scope change decision" />
        <LoadError what="this scope change" retryHref={here} />
      </div>
    );
  }
  const c = data?.[0];
  if (!c) return notAvailable;

  // Anyone who can read the proposal itself (a founder or a member) uses the project's own page, which shows more.
  const readable = await supabase.from("proj_scope_changes").select("id").eq("id", scopeChangeId).maybeSingle();
  if (readable.data) redirect(`/projects/${c.project_id}/changes`);

  return (
    <div className="space-y-6">
      <PageHeader title="Scope change decision" description={`${c.project_reference} · ${c.project_name}`} />
      <Panel
        title={c.title}
        description="Approving replaces the project's current scope with the proposed one. The original agreed scope and this decision stay on record. No date or price moves."
        actions={c.can_decide ? <DecideScopeChangeForm projectId={c.project_id} scopeChangeId={c.scope_change_id} /> : null}
      >
        <div className="mb-3"><Badge variant="outline">{STATUS[c.status] ?? c.status}</Badge></div>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Fact label="Proposed scope" className="sm:col-span-2"><span className="whitespace-pre-wrap break-words">{c.proposed_scope}</span></Fact>
          <Fact label="Effect on dates">{c.effect_on_dates ?? "Not stated"}</Fact>
          <Fact label="Proposed">{c.proposed_by_name}, {formatDateTime(c.proposed_at)}</Fact>
        </dl>
        {!c.can_decide ? <Muted className="mt-3">{c.status === "proposed" ? "The project is finished, so this can no longer be decided." : "This proposal has already been decided or withdrawn."}</Muted> : null}
      </Panel>
      <Muted>You are shown this proposal because you can decide scope changes for this company. It does not give you access to the project itself.</Muted>
    </div>
  );
}
