"use client";

import { moveStage } from "@/lib/actions/crm";
import { Board, type BoardColumn, type BoardItem, type MoveOutcome } from "@/components/workspace/board";
import { boardMoveKind } from "@/lib/crm/enquiry-list";
import { CloseDialog, HoldDialog, ResumeDialog } from "./[id]/stage-actions";

/** What a card's move needs to know that the card's own text does not carry. Plain data, decided on the server. */
export interface BoardMeta {
  stage: string;
  version: number;
  stageBeforeHold: string | null;
  valueText: string;
  hasValue: boolean;
  openFollowUps: number;
}

/**
 * The Enquiries board. A drop (or the card's "Move to" control) is only ever a request that goes through the existing rules:
 * a plain stage move calls the same moveStage action (the database refuses a move it does not allow, and the card stays where it
 * was with the reason); On hold, Won, Lost and Resume open their normal forms first. Won and Lost are only entered through their forms,
 * and reopening is not a drag at all.
 */
export function EnquiryBoard({ columns, items, meta }: { columns: BoardColumn[]; items: BoardItem[]; meta: Record<string, BoardMeta> }) {
  const onMove = async (item: BoardItem, to: string): Promise<MoveOutcome> => {
    const m = meta[item.id];
    if (!m) return { kind: "error", message: "This enquiry could not be found. Reload the page." };
    switch (boardMoveKind(m.stage, to)) {
      case "stage": {
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
  return <Board columns={columns} items={items} onMove={onMove} ariaLabel="Enquiries by stage" emptyColumnText="Nothing here" />;
}
