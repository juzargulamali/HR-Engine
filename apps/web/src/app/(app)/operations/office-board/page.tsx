import { EmptyState } from "@/components/ui/empty-state";
import { Alert } from "@/components/ui/alert";
import { Muted, Panel } from "@/components/projects/parts";
import { CompanyTabs, OpsHeader, ReadState } from "@/components/operations/parts";
import { AddDisplayDialog, RevokeDisplayButton } from "@/components/operations/office-board-forms";
import { getOperationsContext, pickCompany } from "@/lib/operations/data";
import { loadDisplays } from "@/lib/operations-tv/display-data";
import { displayState } from "@/lib/operations-tv/accounts";
import { formatDateTime } from "@/lib/projects/format";

export const metadata = { title: "Office board" };

/**
 * Office board: the displays that may show one company's read-only office board (the TV at /tv). Each display is its own sign-in, registered for ONE company, revocable on its own, and able to open the board and nothing else.
 * Operations Managers of the company (and founders) set displays up and revoke them here; the database refuses anyone else on every read and write, whatever this page showed.
 */
export default async function OfficeBoardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getOperationsContext();
  if (!ctx) return null;
  const company = await pickCompany(ctx, typeof sp.company === "string" ? sp.company : undefined);
  if (!company) return null;
  const base = "/operations/office-board";
  const header = <OpsHeader title="Office board" help={<p>The office board is a read-only screen for the office TV at <code>/tv</code>. Each display signs in with its own account for one company, can open the board and nothing else, and can be revoked on its own. Revoking clears the board on the next refresh.</p>} />;
  const res = await loadDisplays(company.id);
  const self = `${base}?company=${company.id}`;
  if (res.state !== "ok") {
    return <div className="space-y-5" data-testid="ops-board-page">{header}<CompanyTabs companies={ctx.companies} current={company.id} base={base} /><ReadState result={res} what="the office board displays" retryHref={self} /></div>;
  }
  const active = res.rows.filter((r) => displayState(r) === "active");
  return (
    <div className="space-y-5" data-testid="ops-board-page">
      {header}
      <CompanyTabs companies={ctx.companies} current={company.id} base={base} />
      <Panel title="Displays" description={`${active.length} active for ${company.name}.`} actions={<AddDisplayDialog companyId={company.id} companyName={company.name} />}>
        {res.rows.length === 0 ? (
          <EmptyState dense title="No display is set up yet" description="Add a display to get a sign-in for the office TV. The board itself opens at /tv once the display has signed in." />
        ) : (
          <ul className="divide-y divide-border" data-testid="ops-board-list">
            {res.rows.map((r) => {
              const revoked = displayState(r) === "revoked";
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" data-testid={`ops-board-row-${r.id}`} data-state={displayState(r)}>
                  <div className="min-w-0 space-y-0.5">
                    <p className="break-words font-medium">{r.label} <span className={revoked ? "ml-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground" : "ml-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs"}>{revoked ? "Revoked" : "Active"}</span></p>
                    <Muted className="break-all">Signs in as {r.email ?? "(e-mail not available)"} · office time zone {r.officeTz}</Muted>
                    <Muted>{revoked && r.revokedAt ? `Revoked ${formatDateTime(r.revokedAt)}` : r.lastSeenAt ? `Last seen ${formatDateTime(r.lastSeenAt)}` : "Not seen yet"}{r.createdAt ? ` · set up ${formatDateTime(r.createdAt)}` : ""}</Muted>
                  </div>
                  <RevokeDisplayButton displayId={r.id} userId={r.userId} label={r.label} retry={revoked} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Alert role="note">Setting up a TV: add a display here, open <code>/login</code> on the TV’s browser and sign in with the e-mail and password shown once after creation. Signing in lands on the board. To remove a TV from service, revoke it here.</Alert>
    </div>
  );
}
