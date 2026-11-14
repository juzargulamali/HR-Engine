"use client";

import { useState } from "react";
import Link from "next/link";
import { crmStageLabel } from "@enginious-hr/domain";
import { moveStage } from "@/lib/actions/crm";
import { Board, type BoardColumn, type BoardItem, type MoveOutcome } from "@/components/workspace/board";
import { boardMoveCheck, boardMoveKind, type BoardRefusal, type StageEvidence } from "@/lib/crm/enquiry-list";
import { CloseDialog, HoldDialog, ResumeDialog } from "./[id]/stage-actions";

/** What a card's move needs to know that the card's own text does not carry. Plain data, decided on the server. */
export interface BoardMeta {
  stage: string;
  version: number;
  stageBeforeHold: string | null;
  valueText: string;
  hasValue: boolean;
  openFollowUps: number;
  /** The recorded facts some stages need (a sent proposal, a sent estimate, the Zoho quote reference). Null = they could not be read: the database alone decides. */
  evidence: StageEvidence | null;
}

/**
 * The Enquiries board. A drop (or the card's "Move to" control) is only ever a request that goes through the existing rules:
 * a plain stage move is first checked against the same evidence rules as the Move stage dialog on the enquiry's own page (so a move the database
 * would refuse says at once what is missing and where to record it), then calls the same moveStage action (the database still decides, and a
 * refusal leaves the card where it was with the reason); On hold, Won, Lost and Resume open their normal forms first. Won and Lost are only
 * entered through their forms, and reopening is not a drag at all. Nothing here allows a move the database does not.
 */
export function EnquiryBoard({ columns, items, meta }: { columns: BoardColumn[]; items: BoardItem[]; meta: Record<string, BoardMeta> }) {
  // The last move of each card that was stopped for missing evidence: the card stays in its lane and gains a link to where the evidence is recorded.
  const [refused, setRefused] = useState<Record<string, BoardRefusal & { to: string }>>({});
  const forget = (id: string) => setRefused((r) => { if (!(id in r)) return r; const { [id]: _gone, ...rest } = r; return rest; });

  const onMove = async (item: BoardItem, to: string): Promise<MoveOutcome> => {
    forget(item.id);
    const m = meta[item.id];
    if (!m) return { kind: "error", message: "This enquiry could not be found. Reload the page." };
    switch (boardMoveKind(m.stage, to)) {
      case "stage": {
        const missing = boardMoveCheck(to, m.evidence);
        if (missing) {
          setRefused((r) => ({ ...r, [item.id]: { ...missing, to } }));
          return { kind: "error", message: missing.message };
        }
        const r = await moveStage(item.id, to, m.version);
        return r.error ? { kind: "error", message: r.error } : { kind: "done" };
      }
      case "hold":
        return { kind: "dialog", render: (close) => <HoldDialog open onClose={close} opportunityId={item.id} version={m.version} /> };
      case "resume":
        return { kind: "dialog", render: (close) => <ResumeDialog open onClose={close} opportunityId={item.id} version={m.version} returnsTo={m.stageBeforeHold} /> };
      case "won":
      case "lost":
        return {
          kind: "dialog",
          render: (close) => (
            <CloseDialog open onClose={close} opportunityId={item.id} version={m.version} initialOutcome={to === "won" ? "won" : "lost"} onHold={m.stage === "on_hold"} valueText={m.valueText} hasValue={m.hasValue} openFollowUps={m.openFollowUps} />
          ),
        };
    }
  };

  const shown = items.map((i) => {
    const r = refused[i.id];
    // A refusal belongs to the stage the card was in when it was refused: once the card has moved on, it no longer applies.
    if (!r || meta[i.id]?.stage !== i.columnId) return i;
    return {
      ...i,
      card: (
        <>
          {i.card}
          <p className="mt-2 text-sm" data-testid="board-refusal">
            <span className="font-medium text-[hsl(var(--os-amber))]">Not moved to {crmStageLabel(r.to)}.</span>{" "}
            <Link href={`/sales/opportunities/${i.id}?tab=${r.tab}`} className="font-medium underline underline-offset-2">{r.linkLabel}</Link>
          </p>
        </>
      ),
    };
  });
  return <Board columns={columns} items={shown} onMove={onMove} ariaLabel="Enquiries by stage" emptyColumnText="Nothing here" />;
}
