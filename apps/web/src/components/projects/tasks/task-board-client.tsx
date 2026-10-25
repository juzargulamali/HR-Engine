"use client";

import { Modal } from "@/components/ui/modal";
import { Board, type BoardItem, type MoveOutcome } from "@/components/workspace/board";
import { StatusMoveForm } from "./task-forms";
import { saveMove, type ControlRow } from "./task-controls";
import { BOARD_COLUMNS, boardTargets, moveFor } from "./task-logic";

export interface BoardCardData {
  row: ControlRow;
  card: React.ReactNode;
  /** The task panel address, so a click on the card opens the task like its title link does. */
  href?: string;
}

/**
 * The same tasks as the table, by status. A drop or a "Move to" choice is only a request: plain moves are saved at once; anything that
 * needs a reason or a review opens its small form; a refusal leaves the card where it was and says why. Blocked is a flag on the card,
 * never a column.
 */
export function TaskBoardClient({ cards }: { cards: BoardCardData[] }) {
  const byId = new Map(cards.map((c) => [c.row.id, c.row]));
  const items: BoardItem[] = cards.map(({ row, card, href }) => ({
    id: row.id,
    href,
    panel: true,
    columnId: row.status,
    title: row.title,
    card,
    moveTo: boardTargets(row),
    // Shown on the card only when there is nowhere it can be moved to; a refused drop elsewhere uses the board's own plain message.
    ...(boardTargets(row).length === 0 ? { lockedReason: row.moves.length === 0 ? "You can't change this task's status." : "Open the task to defer or cancel it." } : {}),
  }));
  const onMove = async (item: BoardItem, to: string): Promise<MoveOutcome> => {
    const row = byId.get(item.id);
    const move = row ? moveFor(row, to) : null;
    if (!row || !move) return { kind: "error", message: "You can't move this task there." };
    if (move.mode === "dialog") {
      return {
        kind: "dialog",
        render: (close) => (
          <Modal open onClose={close} title={move.label} description={row.title}>
            <StatusMoveForm projectId={row.projectId} taskId={row.id} version={row.version} move={move} onDone={close} />
          </Modal>
        ),
      };
    }
    const r = await saveMove(row, move.to);
    return r.error ? { kind: "error", message: r.error } : { kind: "done" };
  };
  return <Board columns={BOARD_COLUMNS} items={items} onMove={onMove} ariaLabel="Tasks by status" emptyColumnText="No tasks" />;
}
