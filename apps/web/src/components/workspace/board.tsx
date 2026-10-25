"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/select";
import { shouldOpenRow } from "./row-click";
import { confirmDiscard } from "./unsaved";

export interface BoardColumn {
  id: string;
  label: string;
  /** Small extra line under the heading (for example per-currency totals). Rendered by the server. */
  hint?: React.ReactNode;
}

export interface BoardItem {
  id: string;
  columnId: string;
  /** Plain-text name, used in the accessible labels of the move control. */
  title: string;
  /** The card body, rendered by the server (so nothing the person may not see is ever sent to the browser). */
  card: React.ReactNode;
  /** Columns this record may be moved to. Default: every other column. Empty: it cannot be moved (and says why in `lockedReason`). */
  moveTo?: readonly string[];
  lockedReason?: string;
  /** Where the card leads. When set, a click on the empty part of the card opens it (its own title link stays a real link). */
  href?: string;
  /** The address opens a side panel: ask before discarding unsaved edits in the panel that is open. */
  panel?: boolean;
}

/** What a move request turned into. `dialog` means more information is needed first (a reason, evidence…): the card does not move yet. */
export type MoveOutcome =
  | { kind: "done" }
  | { kind: "error"; message: string }
  | { kind: "dialog"; render: (close: () => void) => React.ReactNode };

/**
 * The same records as the table, laid out by status. A move is only ever a *request*: the card stays where it is, shows that it
 * is saving, and changes column only when the server has accepted the change and the page has refreshed with it. A refused
 * move leaves the card in its original column and says why. Dragging is a convenience; every card also has a "Move to" control
 * that works with a keyboard and on a phone.
 */
export function Board({ columns, items, onMove, ariaLabel, emptyColumnText = "Nothing here" }: { columns: readonly BoardColumn[]; items: readonly BoardItem[]; onMove: (item: BoardItem, to: string) => Promise<MoveOutcome>; ariaLabel: string; emptyColumnText?: string }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<React.ReactNode>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [, start] = useTransition();
  const liveId = useId();
  const [announce, setAnnounce] = useState("");

  const request = (item: BoardItem, to: string) => {
    if (to === item.columnId || pendingId) return;
    if (item.moveTo && !item.moveTo.includes(to)) {
      setErrors((e) => ({ ...e, [item.id]: item.lockedReason ?? "That move is not available from here." }));
      return;
    }
    setErrors((e) => { const { [item.id]: _drop, ...rest } = e; return rest; });
    setPendingId(item.id);
    start(async () => {
      try {
        const outcome = await onMove(item, to);
        if (outcome.kind === "error") {
          setErrors((e) => ({ ...e, [item.id]: outcome.message }));
          setAnnounce(`${item.title} was not moved. ${outcome.message}`);
        } else if (outcome.kind === "dialog") {
          setDialog(outcome.render(() => setDialog(null)));
        } else {
          setAnnounce(`${item.title} moved to ${columns.find((c) => c.id === to)?.label ?? to}.`);
        }
      } catch {
        setErrors((e) => ({ ...e, [item.id]: "The move could not be saved. Check your connection and try again." }));
      } finally {
        setPendingId(null);
      }
    });
  };

  return (
    <>
      <p id={liveId} role="status" aria-live="polite" className="sr-only">{announce}</p>
      {/* `relative`: the visually hidden labels inside are absolutely positioned; without a positioned scroller they escape its clipping and widen the whole page. */}
      <div className="relative -mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0" tabIndex={0} role="region" aria-label={`${ariaLabel}. Scroll sideways for more columns.`}>
        <div className="flex gap-3 lg:min-w-max">
          {columns.map((col) => {
            const cards = items.filter((i) => i.columnId === col.id);
            return (
              <section
                key={col.id}
                aria-labelledby={`${liveId}-${col.id}`}
                onDragOver={(e) => { if (pendingId === null) { e.preventDefault(); setOverColumn(col.id); } }}
                onDragLeave={() => setOverColumn((c) => (c === col.id ? null : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverColumn(null);
                  const id = e.dataTransfer.getData("text/plain");
                  const item = items.find((i) => i.id === id);
                  if (item) request(item, col.id);
                }}
                className={cn("w-72 flex-none rounded-lg border bg-secondary/30 p-2.5 transition-colors", overColumn === col.id ? "border-primary bg-secondary/60" : "border-border")}
              >
                <header className="mb-2 px-1">
                  <h3 id={`${liveId}-${col.id}`} className="flex items-center justify-between gap-2 text-sm font-semibold">
                    {col.label}
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums" aria-label={`${cards.length} in ${col.label}`}>{cards.length}</span>
                  </h3>
                  {col.hint ? <div className="mt-0.5 min-h-4 text-sm text-muted-foreground">{col.hint}</div> : null}
                </header>
                {cards.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">{emptyColumnText}</p>
                ) : (
                  <ul className="space-y-2.5">
                    {cards.map((item) => {
                      const targets = columns.filter((c) => c.id !== item.columnId && (!item.moveTo || item.moveTo.includes(c.id)));
                      const busy = pendingId === item.id;
                      return (
                        <li
                          key={item.id}
                          draggable={!busy && targets.length > 0}
                          onDragStart={(e) => { e.dataTransfer.setData("text/plain", item.id); e.dataTransfer.effectAllowed = "move"; }}
                          aria-busy={busy}
                          data-clickable={item.href ? "true" : undefined}
                          onClick={item.href ? (e) => {
                            if (!shouldOpenRow(e.target as Element | null, e.currentTarget, { defaultPrevented: e.defaultPrevented, button: e.button }, window.getSelection()?.toString() ?? "")) return;
                            if (e.metaKey || e.ctrlKey) { window.open(item.href, "_blank", "noopener"); return; }
                            if (item.panel && !confirmDiscard()) return;
                            router.push(item.href as string, { scroll: false });
                          } : undefined}
                          className={cn("os-board-card rounded-lg border border-border bg-card p-3 shadow-sm", item.href && "cursor-pointer", busy && "opacity-60")}
                        >
                          {item.card}
                          <div className="mt-2.5 border-t border-border pt-2">
                            {targets.length > 0 ? (
                              <>
                                <label htmlFor={`${liveId}-mv-${item.id}`} className="sr-only">Move {item.title} to</label>
                                <Select id={`${liveId}-mv-${item.id}`} value={item.columnId} disabled={busy || pendingId !== null} onChange={(e) => request(item, e.target.value)} className="h-8 text-[13px]">
                                  <option value={item.columnId}>{busy ? "Saving…" : `Move to… (now ${col.label})`}</option>
                                  {targets.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                                </Select>
                              </>
                            ) : item.lockedReason ? (
                              <p className="text-[13px] text-muted-foreground">{item.lockedReason}</p>
                            ) : null}
                            {errors[item.id] ? <p role="alert" className="mt-1.5 text-sm text-destructive">{errors[item.id]}</p> : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
      {dialog}
    </>
  );
}
