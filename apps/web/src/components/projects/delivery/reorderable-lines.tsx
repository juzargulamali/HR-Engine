"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { reorderPlanLines } from "@/lib/actions/projectsDeliveryPlan";
import { moveAnnouncement, moveId, reorderIds } from "@/lib/projects/delivery-plan/ordering";

export interface ReorderRow { id: string; /** The line's key (L0003), for the buttons' names. */ label: string; node: React.ReactNode }

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; text: string } | { kind: "error"; text: string };

/**
 * The requirements of one section of a technology, in the order the Project Manager (or the person the section is delegated to) wants them. Three ways to move a row, all saving
 * the same way: drag the grip with a mouse or pen, press the up / down buttons (the keyboard and touch way: Tab to the button, Enter), or use the arrow keys on the grip. The
 * whole new order of the rows shown is sent to the database after every move; sending the same order again changes nothing, and the saved order is what everyone reads.
 * When `enabled` is false (read-only project, a section the person cannot edit, or a single row) the rows are drawn as they are, with no controls.
 */
export function ReorderableLines({ projectId, itemId, rows, enabled, sectionLabel }: { projectId: string; itemId: string; rows: ReorderRow[]; enabled: boolean; sectionLabel: string }) {
  const serverOrder = rows.map((r) => r.id);
  const serverKey = serverOrder.join(",");
  const [order, setOrder] = useState(serverOrder);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [announce, setAnnounce] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pendingSaves = useRef(0);
  const focusTarget = useRef<{ id: string; ctl: "up" | "down" | "grip" } | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());

  // What the server sends is the truth: when it changes (after a save, or another person's change), draw that.
  useEffect(() => { if (pendingSaves.current === 0) setOrder(serverKey ? serverKey.split(",") : []); }, [serverKey]);

  // A move re-orders the DOM; give focus back to the control that was used (or its neighbour when it is now at an end).
  useLayoutEffect(() => {
    const t = focusTarget.current;
    if (!t) return;
    focusTarget.current = null;
    const idx = order.indexOf(t.id);
    const want = t.ctl === "up" && idx === 0 ? "down" : t.ctl === "down" && idx === order.length - 1 ? "up" : t.ctl;
    (refs.current.get(`${t.id}:${want}`) ?? refs.current.get(`${t.id}:grip`))?.focus();
  });

  const byId = new Map(rows.map((r) => [r.id, r]));
  const shown = order.filter((id) => byId.has(id)).concat(serverOrder.filter((id) => !order.includes(id)));

  const save = (next: string[]) => {
    pendingSaves.current += 1;
    setStatus({ kind: "saving" });
    queue.current = queue.current.then(async () => {
      const fd = new FormData();
      fd.set("projectId", projectId); fd.set("itemId", itemId);
      for (const id of next) fd.append("lineId", id);
      let result: { error: string | null; notice?: string | null };
      try { result = await reorderPlanLines({ error: null }, fd); } catch { result = { error: "The order could not be saved. Reload the page to see what is saved." }; }
      pendingSaves.current -= 1;
      if (result.error) { setStatus({ kind: "error", text: result.error }); setOrder(serverOrder); }
      else if (pendingSaves.current === 0) setStatus({ kind: "saved", text: result.notice ?? "Order saved." });
    });
  };

  const commit = (next: string[], movedId: string) => {
    if (next.join(",") === shown.join(",")) { focusTarget.current = null; return; }
    setOrder(next);
    setAnnounce(moveAnnouncement(byId.get(movedId)?.label ?? "Row", next.indexOf(movedId) + 1, next.length));
    save(next);
  };

  if (!enabled || rows.length < 2) return <ul className="divide-y divide-border/70">{rows.map((r) => <li key={r.id}>{r.node}</li>)}</ul>;

  return (
    <div>
      <ul className="divide-y divide-border/70" data-testid="reorder-list" aria-label={`${sectionLabel}: requirements in order`}>
        {shown.map((id, n) => {
          const r = byId.get(id)!;
          return (
            <li key={id} data-testid={`reorder-row-${r.label}`} data-position={n + 1}
              onDragOver={(e) => { if (dragId && dragId !== id) { e.preventDefault(); setOverId(id); } }}
              onDrop={(e) => { e.preventDefault(); if (dragId && dragId !== id) commit(reorderIds(shown, shown.indexOf(dragId), n), dragId); setDragId(null); setOverId(null); }}
              className={`flex items-stretch gap-1 ${overId === id && dragId ? "border-t-2 border-t-primary" : ""} ${dragId === id ? "opacity-50" : ""}`}>
              <div className="flex w-[3.75rem] shrink-0 items-start gap-0.5 pt-2" role="group" aria-label={`Move ${r.label}`}>
                <span ref={(el) => { if (el) refs.current.set(`${id}:grip`, el); }} role="button" tabIndex={0} draggable data-testid={`grip-${r.label}`}
                  aria-label={`Reorder ${r.label}. Drag it, or press the up or down arrow key.`} title="Drag to reorder"
                  onDragStart={(e) => { setDragId(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", r.label); const li = (e.currentTarget as HTMLElement).closest("li"); if (li) e.dataTransfer.setDragImage(li, 8, 8); }}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); focusTarget.current = { id, ctl: "grip" }; commit(moveId(shown, id, e.key === "ArrowUp" ? -1 : 1), id); }
                  }}
                  className="inline-flex h-6 w-5 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-secondary active:cursor-grabbing"><GripVertical className="h-4 w-4" aria-hidden /></span>
                <div className="flex flex-col">
                  <button type="button" ref={(el) => { if (el) refs.current.set(`${id}:up`, el); }} disabled={n === 0} aria-label={`Move ${r.label} up`} data-testid={`up-${r.label}`}
                    onClick={() => { focusTarget.current = { id, ctl: "up" }; commit(moveId(shown, id, -1), id); }}
                    className="inline-flex h-[1.125rem] w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary disabled:opacity-30"><ChevronUp className="h-4 w-4" aria-hidden /></button>
                  <button type="button" ref={(el) => { if (el) refs.current.set(`${id}:down`, el); }} disabled={n === shown.length - 1} aria-label={`Move ${r.label} down`} data-testid={`down-${r.label}`}
                    onClick={() => { focusTarget.current = { id, ctl: "down" }; commit(moveId(shown, id, 1), id); }}
                    className="inline-flex h-[1.125rem] w-6 items-center justify-center rounded text-muted-foreground hover:bg-secondary disabled:opacity-30"><ChevronDown className="h-4 w-4" aria-hidden /></button>
                </div>
              </div>
              <div className="min-w-0 flex-1">{r.node}</div>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" aria-live="polite" data-testid="reorder-announce">{announce}</p>
      <p className={`mt-1 text-[12px] ${status.kind === "error" ? "font-medium text-[hsl(var(--os-red))]" : "text-muted-foreground"}`} role={status.kind === "error" ? "alert" : "status"} data-testid="reorder-status">
        {status.kind === "saving" ? "Saving the order…" : status.kind === "saved" ? status.text : status.kind === "error" ? status.text : "Drag the grip, or use the arrows, to change the order. It is saved as you go."}
      </p>
    </div>
  );
}
