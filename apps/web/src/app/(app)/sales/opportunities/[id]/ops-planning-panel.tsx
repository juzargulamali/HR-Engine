import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/components/sales/format";
import { loadOpsPlanning } from "@/lib/crm/ops-planning-data";
import { OPS_NOT_FLAGGED, OPS_PROVISIONAL_NOTE, OPS_READ_FAILED, OPS_RISK_LABELS, opsDatesText, opsTeamLabel, type OpsPlanningRead } from "@/lib/crm/ops-planning";
import type { CrmOpportunityRow } from "@/types/crm";
import { OpsAnswerForm, OpsPlanningButton, RemoveOpsPlanningButton, type OpsPlanningValues } from "./ops-planning-forms";
import { Fact, Muted, Panel, SubHeading } from "./parts";
import type { OppView } from "./view";

const NOT_SET = <span className="text-muted-foreground">Not recorded</span>;
const RISK_BADGE = { unknown: "outline", low: "secondary", medium: "warning", high: "destructive" } as const;

type OpsOpp = Pick<CrmOpportunityRow, "id" | "version" | "stage" | "ops_flagged_at" | "ops_decision_date" | "ops_dates_tentative" | "ops_dismantle_date" | "ops_teams" | "ops_to_confirm" | "ops_note">;

/**
 * "Operations planning" on an enquiry: what Sales tells Operations, and what Operations recorded back. Operations sees the enquiry only while it is flagged, and
 * only through the allowlisted read (ops_upcoming_work: no value, quote, brief or note). `canEdit` is the enquiry's owner or a Sales founder, the people
 * crm_set_ops_planning accepts; everyone else with Sales access sees the same state without a button. `read` is Operations' half: null while the enquiry is not
 * flagged (nothing was asked for), otherwise loaded or failed, and a failed read is said as that, never shown as "nothing from Operations".
 */
export function OpsPlanningPanel({ opp, canEdit, read }: { opp: OpsOpp; canEdit: boolean; read: OpsPlanningRead | null }) {
  const flagged = !!opp.ops_flagged_at;
  const won = opp.stage === "won";
  const lost = opp.stage === "lost";
  const values: OpsPlanningValues = {
    decisionDate: opp.ops_decision_date ?? null, datesTentative: opp.ops_dates_tentative !== false, dismantleDate: opp.ops_dismantle_date ?? null,
    teams: opp.ops_teams ?? [], toConfirm: opp.ops_to_confirm ?? null, note: opp.ops_note ?? null,
  };
  const target = { opportunityId: opp.id, version: opp.version };

  if (!flagged) {
    return (
      <Panel title="Operations planning" actions={canEdit && !lost ? <OpsPlanningButton mode="flag" {...target} values={values} won={won} /> : undefined}>
        <p className="text-sm">{OPS_NOT_FLAGGED}</p>
        {lost ? <Muted className="mt-2">A lost enquiry cannot be flagged for Operations planning.</Muted> : !canEdit ? <Muted className="mt-2">Only the owner of this enquiry or a Sales founder can flag it.</Muted> : null}
      </Panel>
    );
  }

  const teams = values.teams;
  const planning = read?.kind === "ok" ? read.planning : null;
  return (
    <Panel
      title="Operations planning"
      description="Operations can see this enquiry in Upcoming Work. Prices, quotes and notes are never shown to Operations."
      actions={canEdit ? <>{lost ? null : <OpsPlanningButton mode="edit" {...target} values={values} won={won} />}<RemoveOpsPlanningButton {...target} /></> : undefined}
    >
      {lost ? <Muted className="mb-4">This enquiry was lost, so its planning details can no longer be changed. It can still be removed from Operations planning.</Muted> : null}
      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Fact label="Flagged on">{formatDate(opp.ops_flagged_at)}</Fact>
        <Fact label="Expected decision date">{values.decisionDate ? formatDate(values.decisionDate) : NOT_SET}</Fact>
        <Fact label="Dates"><span className="font-medium">{opsDatesText(opp.stage, opp.ops_dates_tentative)}</span></Fact>
        <Fact label="Dismantling date">{values.dismantleDate ? formatDate(values.dismantleDate) : NOT_SET}</Fact>
        <Fact label="Expected teams" className="sm:col-span-2">{teams.length > 0 ? teams.map(opsTeamLabel).join(", ") : NOT_SET}</Fact>
        <Fact label="Still to confirm" className="sm:col-span-2">{values.toConfirm ? <span className="whitespace-pre-wrap">{values.toConfirm}</span> : <span className="text-muted-foreground">Nothing recorded</span>}</Fact>
        <Fact label="Note for Operations" className="sm:col-span-2">{values.note ? <span className="whitespace-pre-wrap">{values.note}</span> : <span className="text-muted-foreground">No note</span>}</Fact>
      </dl>

      <div className="mt-5 border-t border-border pt-4">
        <SubHeading>From Operations</SubHeading>
        {read === null || read.kind === "failed" ? (
          // No answer box either: without the read it is not known whether there is a question to answer.
          <p role="alert" className="mt-2 text-sm text-destructive">{OPS_READ_FAILED}</p>
        ) : planning === null ? (
          <Muted className="mt-2">Operations has not recorded anything for this enquiry yet.</Muted>
        ) : (
          <div className="mt-2 space-y-4">
            <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
              <Fact label="Provisional Project Manager" className="sm:col-span-2">
                {planning.provisionalPm ? <span className="font-medium">{planning.provisionalPm}</span> : <span className="text-muted-foreground">Nobody named yet</span>}
                <span className="mt-0.5 block text-sm text-muted-foreground">{OPS_PROVISIONAL_NOTE}</span>
              </Fact>
              <Fact label="Risk">
                <Badge variant={RISK_BADGE[planning.risk]}>{OPS_RISK_LABELS[planning.risk]}</Badge>
                {planning.riskNote ? <span className="mt-1 block whitespace-pre-wrap">{planning.riskNote}</span> : null}
              </Fact>
              <Fact label="Capacity conflict">
                {planning.capacityConflict ? <Badge variant="warning">Capacity conflict</Badge> : <span>None flagged</span>}
                {planning.capacityNote ? <span className="mt-1 block whitespace-pre-wrap">{planning.capacityNote}</span> : null}
              </Fact>
            </dl>
            <div>
              <p className="text-sm text-muted-foreground">Question from Operations</p>
              {planning.question ? (
                <div className="mt-1 space-y-3">
                  <div className="rounded-md border border-border px-3 py-2 text-sm">
                    <p className="whitespace-pre-wrap break-words">{planning.question}</p>
                    <p className="mt-1 text-sm text-muted-foreground">Asked{planning.questionBy ? ` by ${planning.questionBy}` : ""}{planning.questionAt ? ` on ${formatDateTime(planning.questionAt)}` : ""}</p>
                  </div>
                  {planning.answer ? (
                    <div className="rounded-md border border-border px-3 py-2 text-sm">
                      <p className="text-sm text-muted-foreground">Answer from Sales{planning.answeredAt ? `, ${formatDateTime(planning.answeredAt)}` : ""}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words">{planning.answer}</p>
                    </div>
                  ) : <p className="text-sm font-medium text-[hsl(var(--os-amber))]">Not answered yet.</p>}
                  {canEdit && !lost ? <OpsAnswerForm {...target} current={planning.answer} /> : null}
                </div>
              ) : <Muted className="mt-1">Operations has not asked anything.</Muted>}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/** The panel with Operations' half read for it. Nothing is read for an enquiry that is not flagged: there is nothing Operations could have recorded against it. */
export async function OpsPlanningSection({ view }: { view: Pick<OppView, "opp" | "canEdit"> }) {
  const { opp, canEdit } = view;
  const read = opp.ops_flagged_at ? await loadOpsPlanning(opp.id) : null;
  return <OpsPlanningPanel opp={opp} canEdit={canEdit} read={read} />;
}
