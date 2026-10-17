"use client";

import { useState } from "react";
import { ArrowRightLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  OPPORTUNITIES, PIPELINE_STAGES, isOpen, money, nextActionOf, personName, stageLabel, type Currency, type Opportunity, type StageId, fmtDate,
} from "../../_lib/data";
import { PLink, usePreview } from "../../_components/context";
import { AvailabilityChip, Chip, DueChip, PageHeader, StateGate, useNotice } from "../../_components/ui";
import { ClientLine, useOppRights } from "../../_components/sales-bits";
import { MoveDialog, type MoveResult } from "../../_components/move-dialog";

type Local = Record<string, MoveResult>;

function Card({ o, stage, local, onMove }: { o: Opportunity; stage: StageId; local?: MoveResult; onMove: () => void }) {
  const { canChange } = useOppRights(o);
  const next = local?.nextAction ? { title: local.nextAction, due: local.nextDate! } : nextActionOf(o.id);
  return (
    <li className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <PLink href={`/os-preview/sales/opportunities/${o.ref}`} className="text-sm font-medium leading-snug hover:underline">{o.title}</PLink>
      <p className="mt-0.5 text-xs text-muted-foreground"><ClientLine o={o} /></p>
      <p className="mt-2 text-sm font-medium tabular-nums">{money(o.value, o.currency)}</p>
      <p className="text-xs text-muted-foreground">{o.ref} · {personName(o.owner)}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {next ? <DueChip due={next.due} /> : null}
        {stage === "on_hold" && (local?.holdReview ?? o.holdReview) ? <Chip tone="warn">Review {fmtDate(local?.holdReview ?? o.holdReview)}</Chip> : null}
        {o.waiting === "client" && stage !== "on_hold" ? <Chip>Waiting for client</Chip> : null}
        {o.availability.state !== "confirmed" && stage !== "new" && stage !== "on_hold" ? <AvailabilityChip a={o.availability} /> : null}
      </div>
      {next ? <p className="mt-1.5 text-xs text-muted-foreground">Next: {next.title}</p> : null}
      <div className="mt-2.5 border-t border-border/70 pt-2">
        {canChange ? (
          <Button variant="outline" size="sm" className="h-7 w-full text-xs" onClick={onMove}><ArrowRightLeft className="h-3 w-3" aria-hidden />Change stage</Button>
        ) : (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Lock className="h-3 w-3 flex-none" aria-hidden />Only {personName(o.owner).split(" ")[0]} or a founder can move this</p>
        )}
      </div>
    </li>
  );
}

export default function PipelineBoard() {
  const { state } = usePreview();
  const [local, setLocal] = useState<Local>({});
  const [moving, setMoving] = useState<Opportunity | null>(null);
  const { notify, node } = useNotice();
  const stageOf = (o: Opportunity): StageId => local[o.id]?.stage ?? o.stage;
  const open = OPPORTUNITIES.filter(isOpen);
  const columns: StageId[] = [...PIPELINE_STAGES, "on_hold"];

  return (
    <>
      <PageHeader eyebrow="Sales & CRM" title="Pipeline" description="Stages are columns. Moves are controlled: only the owner or a founder can move a card, and winning or losing needs evidence or a reason." />
      <StateGate what="the pipeline" emptyTitle="The pipeline is empty" emptyText="Cards appear here as enquiries are recorded and move through stages.">
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0" tabIndex={0} aria-label="Pipeline board, scroll sideways for more stages">
          <div className="flex snap-x snap-mandatory gap-3 lg:min-w-max">
            {columns.map((s) => {
              const cards = open.filter((o) => stageOf(o) === s);
              const byCur = (["AED", "SAR", "EUR"] as Currency[]).map((c) => ({ c, n: cards.filter((o) => o.currency === c).reduce((x, o) => x + (o.value ?? 0), 0) })).filter((x) => x.n > 0);
              return (
                <section key={s} aria-labelledby={`col-${s}`} className="w-[17.5rem] flex-none snap-start rounded-lg border border-border bg-secondary/30 p-2.5">
                  <header className="mb-2 px-1">
                    <h2 id={`col-${s}`} className="flex items-center justify-between font-heading text-sm font-semibold">{stageLabel(s)}<span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums">{cards.length}</span></h2>
                    <p className="mt-0.5 min-h-4 text-[11px] text-muted-foreground">{byCur.length ? byCur.map((x) => `${x.c} ${x.n.toLocaleString("en-US")}`).join(" · ") : "No value yet"}</p>
                  </header>
                  {cards.length === 0 ? <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">Nothing in this stage</p> : (
                    <ul className="space-y-2.5">
                      {cards.map((o) => <Card key={o.id} o={o} stage={s} local={local[o.id]} onMove={() => setMoving(o)} />)}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Won and lost opportunities leave the board; find them in Opportunities.</p>
      </StateGate>
      {moving ? (
        <MoveDialog
          key={moving.id} opp={moving} stage={stageOf(moving)} open onClose={() => setMoving(null)}
          onMoved={(r) => { setLocal((l) => ({ ...l, [moving.id]: r })); notify(`${moving.ref} moved to ${stageLabel(r.stage)}`); }}
        />
      ) : null}
      {node}
    </>
  );
}
