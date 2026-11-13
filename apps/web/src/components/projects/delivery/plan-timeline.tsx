"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { OsBadge } from "@/components/os/pills";
import { Button } from "@/components/ui/button";
import { Muted } from "@/components/projects/parts";
import { barPosition, dayIndex, formatSpan, timelineScale, todayScrollTarget, type TimelineMode, type TimelineModel, type TimelineRow, type TimelineScale, type Tone } from "@/lib/projects/delivery-plan/insights";
import { InfoHint } from "@/components/ui/info-hint";
import { cn } from "@/lib/utils";

const BAR: Record<Tone, string> = {
  quiet: "bg-muted-foreground/55", blue: "bg-[hsl(var(--os-info))]", amber: "bg-[hsl(var(--os-amber))]", green: "bg-[hsl(var(--os-green))]", red: "bg-[hsl(var(--os-red))]",
};
const OUTLINE: Record<Tone, string> = {
  quiet: "border-muted-foreground", blue: "border-[hsl(var(--os-info))]", amber: "border-[hsl(var(--os-amber))]", green: "border-[hsl(var(--os-green))]", red: "border-[hsl(var(--os-red))]",
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()]!;
const dayNum = (iso: string) => Number(iso.slice(8, 10));
const monthOf = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1]!;
const full = (iso: string) => `${dayNum(iso)} ${monthOf(iso)} ${iso.slice(0, 4)}`;
/** Exact dates, always with the year, for the tooltip: "4 Apr 2027 to 10 Apr 2027", "Due 28 Apr 2027". */
const exactDates = (start: string | null, due: string | null) =>
  start && due ? (start === due ? full(start) : `${full(start)} to ${full(due)}`) : due ? `Due ${full(due)}` : start ? `Starts ${full(start)}` : "No dates";

/** The scroll behaviour for a jump: smooth, unless the person asked their system for reduced motion (or the browser cannot say). */
const behaviour = (): ScrollBehavior =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
function scrollTo(el: HTMLElement, left: number) {
  const x = Math.max(0, left);
  if (typeof el.scrollTo === "function") el.scrollTo({ left: x, behavior: behaviour() });
  else el.scrollLeft = x;
}

/** A subtle gridline for each day (Day view) or each week (Week view, with alternate weeks lightly shaded), drawn as one background so every row lines up with the header. */
const gridStyle = (scale: TimelineScale): React.CSSProperties => {
  const n = scale.days.length;
  const lines = "linear-gradient(to right, hsl(var(--border) / 0.8) 1px, transparent 1px)";
  if (scale.mode === "day") return { backgroundImage: lines, backgroundSize: `${(1 / n) * 100}% 100%` };
  return {
    backgroundImage: `${lines}, linear-gradient(to right, transparent 50%, hsl(var(--muted) / 0.45) 50%)`,
    backgroundSize: `${(7 / n) * 100}% 100%, ${(14 / n) * 100}% 100%`,
  };
};

const TIP_HEIGHT = 170;
interface Tip { key: string; pinned: boolean; left: number; top: number; width: number; above: boolean }

function Bar({ row, scale, today, describedBy, onShow, onHide, onToggle }: {
  row: TimelineRow; scale: TimelineScale; today: string; describedBy: string | undefined;
  onShow: (key: string, el: HTMLElement) => void; onHide: (key: string) => void; onToggle: (key: string, el: HTMLElement) => void;
}) {
  const pos = barPosition(scale, row.start, row.due);
  if (!pos) return <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground" data-testid={`tl-nodates-${row.key}`}>No dates</span>;
  const marker = row.shape === "due" || row.shape === "start";                    // only one date recorded: an outlined one-day marker, not a range
  return (
    <button
      type="button" data-tl-bar data-testid={`tl-bar-${row.key}`} data-shape={row.shape} data-start={row.start ?? ""} data-due={row.due ?? ""} aria-describedby={describedBy}
      aria-label={`${row.label}: ${formatSpan(row.start, row.due, today)}, ${row.status}. Read only.`}
      onMouseEnter={(e) => onShow(row.key, e.currentTarget)} onMouseLeave={() => onHide(row.key)}
      onFocus={(e) => onShow(row.key, e.currentTarget)} onBlur={() => onHide(row.key)}
      onClick={(e) => onToggle(row.key, e.currentTarget)}
      className={cn(
        "absolute top-1/2 -translate-y-1/2 cursor-default rounded-sm outline-none transition-[filter,box-shadow] duration-150 hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        "before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']",         // a taller touch target than the drawn bar (not wider: that would push the last day past the edge)
        row.kind === "activation" ? "h-2.5 opacity-70" : "h-4", marker ? cn("border-2 bg-transparent", OUTLINE[row.tone]) : BAR[row.tone],
        row.blocked && "ring-2 ring-[hsl(var(--os-red))]",
      )}
      style={{ left: `calc(${pos.left}% + 1px)`, width: `calc(${pos.width}% - 2px)`, minWidth: "10px" }}
    />
  );
}

/**
 * The Work schedule (the tasks and requirements of the Project Plan): technologies / activations and their requirements on the left, dates across, drawn from the SAME plan records
 * as the Breakdown (a released line takes its dates and status from its task; a draft takes the plan's effective dates).
 *
 * Day view gives every day a readable width (7 days fit when there is room; 9 or 30 days scroll inside the chart, never the page); Week view groups the scale by week. The task names and the
 * date header stay in view while the chart scrolls, and every row still says its exact dates in words. Scrolling works with a trackpad, a touch swipe and the keyboard (focus the chart, then the
 * arrow keys, Home, End, Page Up and Page Down); "Today" jumps to today; a soft edge says when more dates are offscreen. Hovering or focusing a bar (or tapping it on a touch screen) shows its
 * task, owner, status and exact dates. Bars are read-only: dates change on the task or in the Breakdown, under the task's own approval rules. Work with no dates is listed under the chart.
 */
export function PlanTimeline({ projectId, model, today }: { projectId: string; model: TimelineModel; today: string }) {
  const [userMode, setUserMode] = useState<TimelineMode | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [tip, setTip] = useState<Tip | null>(null);
  const tipId = useId();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // The scrolling box: keeps the "more dates offscreen" cue current on scroll and resize, and drops a hover tooltip as soon as the chart moves under it.
  const attachScroller = useCallback((el: HTMLDivElement | null) => {
    scrollerRef.current = el;
    if (!el) return undefined;
    const measure = () => setEdges((prev) => {
      const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      return prev.left === left && prev.right === right ? prev : { left, right };
    });
    const onScroll = () => { measure(); setTip((t) => (t && !t.pinned ? null : t)); };
    measure();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", onScroll); ro?.disconnect(); scrollerRef.current = null; };
  }, []);

  // While a tooltip is open: Escape closes it, and so does a tap or click anywhere that is not a bar or the tooltip (a tapped tooltip stays until then).
  useEffect(() => {
    if (!tip) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTip(null); };
    const onDown = (e: Event) => {
      const t = e.target as Element | null;
      if (tip.pinned && !t?.closest?.("[data-tl-bar], [data-testid='tl-tooltip']")) setTip(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [tip]);

  if (model.rows.length === 0) return <Muted>Nothing to draw yet: add a technology or activation first.</Muted>;
  const scale: TimelineScale | null = userMode && model.range ? timelineScale(model.range, userMode) : model.scale;
  const todayIdx = scale ? dayIndex(scale, today) : -1;
  const n = scale?.days.length ?? 1;
  const cols = "grid-cols-[10rem_minmax(0,1fr)] sm:grid-cols-[12rem_minmax(0,1fr)]";
  const rowByKey = new Map(model.rows.map((r) => [r.key, r]));
  const active = tip ? rowByKey.get(tip.key) ?? null : null;

  const place = (key: string, target: HTMLElement, pinned: boolean) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.getBoundingClientRect(), a = target.getBoundingClientRect();
    const width = Math.min(320, Math.max(w.width - 8, 160));
    const centre = a.left + a.width / 2 - w.left;
    const left = Math.min(Math.max(centre - width / 2, 4), Math.max(w.width - width - 4, 4));      // never past either edge of the chart
    const above = a.top - w.top > TIP_HEIGHT;                                                         // flip below when there is no room above
    setTip({ key, pinned, left, width, above, top: above ? a.top - w.top - 8 : a.bottom - w.top + 8 });
  };
  const show = (key: string, el: HTMLElement) => { if (!tip?.pinned) place(key, el, false); };      // a tapped tooltip stays until it is dismissed
  const hide = (key: string) => setTip((t) => (t && !t.pinned && t.key === key ? null : t));
  const toggle = (key: string, el: HTMLElement) => {
    if (tip?.key === key && tip.pinned) setTip(null);
    else place(key, el, true);
  };

  const jumpToToday = () => {
    const el = scrollerRef.current;
    if (!el || !scale) return;
    const header = el.querySelector<HTMLElement>("[data-testid='tl-header']"), corner = el.querySelector<HTMLElement>("[data-testid='tl-corner']");
    const target = todayScrollTarget(scale, today, { chartW: header?.offsetWidth ?? 0, labelW: corner?.offsetWidth ?? 0, viewportW: el.clientWidth, scrollW: el.scrollWidth });
    if (target !== null) scrollTo(el, target);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && !t.hasAttribute("data-tl-bar")) return;                              // arrows inside links or fields keep their own meaning
    const el = e.currentTarget, page = Math.max(el.clientWidth * 0.8, 120);
    const to = (x: number) => { e.preventDefault(); scrollTo(el, x); };
    if (e.key === "ArrowRight") to(el.scrollLeft + 80);
    else if (e.key === "ArrowLeft") to(el.scrollLeft - 80);
    else if (e.key === "PageDown") to(el.scrollLeft + page);
    else if (e.key === "PageUp") to(el.scrollLeft - page);
    else if (e.key === "Home") to(0);
    else if (e.key === "End") to(el.scrollWidth);
  };

  const modeButton = (m: TimelineMode, label: string) => (
    <button type="button" aria-pressed={scale?.mode === m} data-testid={`tl-mode-${m}`} onClick={() => setUserMode(m)}
      className={cn("inline-flex h-7 min-w-14 items-center justify-center rounded px-3 text-[13px] font-medium transition-colors", scale?.mode === m ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>
  );

  return (
    <div className="min-w-0 max-w-full space-y-3" data-testid="plan-timeline" data-mode={scale?.mode ?? "none"} data-user-mode={userMode ?? "auto"}>
      {!scale ? <Muted>None of this work has a start or due date yet, so there is nothing to draw across. It is listed below.</Muted> : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <div role="group" aria-label="Schedule scale" className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5">{modeButton("day", "Day")}{modeButton("week", "Week")}</div>
            <InfoHint label="reading the Work schedule" testId="tl-help">
              <p>{scale.mode === "day" ? "Every day is a column; the shaded column marked Today is today. " : "Labels are weekly and alternate weeks are shaded; each row states its exact dates. The shaded column marked Today is today. "}A bar is a range, an outlined marker is a single recorded date (a due date or a start date).</p>
              <p className="mt-1.5">Dates come from the task once a requirement is released, and from the plan before; a requirement without a due date of its own shows its activation&apos;s.</p>
              <p className="mt-1.5">Bars are read-only: change a date on the task or in the Breakdown; it follows the task&apos;s own approval rules.</p>
            </InfoHint>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={jumpToToday} disabled={todayIdx < 0} data-testid="tl-today-jump"
            title={todayIdx < 0 ? "Today is outside this schedule" : "Scroll to today"}><CalendarCheck className="h-4 w-4" aria-hidden /> Today</Button>
        </div>
      )}
      <div ref={wrapRef} className="relative min-w-0 max-w-full">
        <div
          ref={attachScroller} data-testid="tl-scroll" role="region" aria-label="Work schedule chart. Scroll sideways with a swipe, the trackpad or the arrow keys." tabIndex={0} onKeyDown={onKeyDown}
          className="max-h-[75vh] max-w-full overflow-auto overscroll-x-contain rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="min-w-[calc(10rem+var(--tl-chart))] sm:min-w-[calc(12rem+var(--tl-chart))]" style={{ "--tl-chart": `${scale?.widthPx ?? 392}px` } as React.CSSProperties}>
            <div className={cn("sticky top-0 z-30 grid border-b border-border bg-muted text-[12px] font-semibold text-muted-foreground", cols)}>
              <div data-testid="tl-corner" className="sticky left-0 z-20 border-r border-border bg-muted px-3 py-2">Activation / requirement, with its dates</div>
              <div className="relative h-[4.5rem]" data-testid="tl-header">
                {scale && todayIdx >= 0 ? (
                  <span data-testid="tl-today-marker" title={`Today, ${full(today)}`} className="absolute top-0 z-10 -translate-x-1/2 rounded-b bg-[hsl(var(--os-red))] px-1.5 text-[10px] font-semibold leading-4 text-white"
                    style={{ left: `${((todayIdx + 0.5) / n) * 100}%` }}>Today</span>
                ) : null}
                <div className="absolute inset-x-0 bottom-0 top-4">
                  {scale?.labels.map((l) => {
                    const dayMode = scale.mode === "day";
                    const first = l.index === 0 || dayNum(l.date) === 1;
                    return (
                      <span key={l.date} data-testid={`tl-col-${l.date}`} title={full(l.date)}
                        className="absolute inset-y-0 flex flex-col items-center justify-center border-l border-border/80 text-center leading-tight"
                        style={{ left: `${(l.index / n) * 100}%`, width: dayMode ? `${100 / n}%` : "auto", minWidth: dayMode ? undefined : "4.5rem", paddingLeft: dayMode ? 0 : "0.25rem", alignItems: dayMode ? "center" : "flex-start" }}>
                        {dayMode ? (
                          <>
                            <span className="text-[11px] font-normal">{weekday(l.date)}</span>
                            <span className="text-[13px] text-foreground">{dayNum(l.date)}</span>
                            <span className="text-[11px] font-normal">{first ? monthOf(l.date) : " "}</span>
                          </>
                        ) : (
                          <span className="text-[12px] text-foreground">{dayNum(l.date)} {monthOf(l.date)}{l.index === 0 || (l.date.slice(5, 7) === "01" && dayNum(l.date) <= 7) ? ` ${l.date.slice(0, 4)}` : ""}</span>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
            <ul>
              {model.rows.map((r) => (
                <li key={r.key} className={cn("group grid border-b border-border/70 transition-colors last:border-b-0 hover:bg-muted/30 focus-within:bg-muted/30", cols, r.kind === "activation" && "bg-muted/40")} data-testid={`tl-row-${r.kind}`}>
                  <div className={cn("sticky left-0 z-10 min-w-0 border-r border-border px-3 py-2 transition-colors group-hover:bg-muted group-focus-within:bg-muted", r.kind === "activation" ? "bg-muted" : "bg-card", r.kind === "line" && "pl-5 sm:pl-7")}>
                    <Link href={`/projects/${projectId}/delivery?open=${r.itemKey}#${r.anchor}`} className={cn("block break-words text-sm underline-offset-2 hover:underline", r.kind === "activation" ? "font-semibold" : "")}>{r.label}</Link>
                    <p className="break-words text-[12px] text-muted-foreground">{r.sub}</p>
                    <p className="mt-0.5 break-words text-[13px] font-medium" data-testid={`tl-dates-${r.key}`}>
                      {formatSpan(r.start, r.due, today)}
                      {r.inherited ? <span className="font-normal text-muted-foreground"> (the activation&apos;s date)</span> : null}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      <OsBadge tone={r.tone === "quiet" ? "quiet" : r.tone} className="whitespace-normal! text-left">{r.status}</OsBadge>
                      {r.late ? <OsBadge tone="red" className="whitespace-normal! text-left">Late: {r.late}</OsBadge> : null}
                    </div>
                  </div>
                  <div className="relative min-h-[3.5rem]" style={scale ? gridStyle(scale) : undefined}>
                    {scale && todayIdx >= 0 ? <span className="absolute inset-y-0 border-l-2 border-[hsl(var(--os-red))] bg-[hsl(var(--os-red)/0.10)]" style={{ left: `${(todayIdx / n) * 100}%`, width: `${100 / n}%` }} aria-hidden /> : null}
                    {scale ? <Bar row={r} scale={scale} today={today} describedBy={tip?.key === r.key ? tipId : undefined} onShow={show} onHide={hide} onToggle={toggle} /> : <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">No dates</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {edges.left ? (
          <div data-testid="tl-more-left" aria-hidden className="pointer-events-none absolute inset-y-px left-[10rem] z-20 flex w-8 items-center bg-gradient-to-r from-foreground/15 to-transparent sm:left-[12rem]">
            <ChevronLeft className="h-4 w-4 text-muted-foreground" />
          </div>
        ) : null}
        {edges.right ? (
          <div data-testid="tl-more-right" aria-hidden className="pointer-events-none absolute inset-y-px right-px z-20 flex w-8 items-center justify-end rounded-r-md bg-gradient-to-l from-foreground/15 to-transparent">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        ) : null}
        {tip && active ? (
          <div id={tipId} role="tooltip" data-testid="tl-tooltip" data-placement={tip.above ? "above" : "below"}
            className={cn("absolute z-50 space-y-1 rounded-md border border-border bg-popover p-2.5 text-[13px] text-popover-foreground shadow-lg", tip.pinned ? "pointer-events-auto" : "pointer-events-none")}
            style={{ left: tip.left, top: tip.top, width: tip.width, transform: tip.above ? "translateY(-100%)" : undefined }}>
            <p className="break-words text-sm font-semibold">{active.label}</p>
            <p className="break-words text-[12px] text-muted-foreground">{active.sub}</p>
            <p><span className="text-muted-foreground">Owner: </span>{active.owner ?? "No owner yet"}</p>
            <p><span className="text-muted-foreground">Status: </span>{active.status}{active.late ? `. Late: ${active.late}` : ""}</p>
            <p className="break-words"><span className="text-muted-foreground">Dates: </span>{exactDates(active.start, active.due)}{active.inherited ? " (the activation's date)" : ""}</p>
            <p className="text-[12px] text-muted-foreground">Read only. Change a date on the task or in the Breakdown; it follows the task&apos;s own approval rules.</p>
            {tip.pinned ? <Link href={`/projects/${projectId}/delivery?open=${active.itemKey}#${active.anchor}`} className="inline-block text-[13px] font-medium text-accent underline-offset-4 hover:underline">Open this {active.kind === "activation" ? "technology" : "requirement"}</Link> : null}
          </div>
        ) : null}
      </div>
      {model.unscheduled.length > 0 ? (
        <section aria-label="Unscheduled work" data-testid="tl-unscheduled" className="rounded-md border border-dashed border-border p-3">
          <h3 className="text-sm font-semibold">Unscheduled ({model.unscheduled.length})</h3>
          <p className="text-[13px] text-muted-foreground">No start or due date. Give each a date in the Breakdown.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {model.unscheduled.map((r) => <li key={r.key}><Link href={`/projects/${projectId}/delivery?open=${r.itemKey}#${r.anchor}`} className="underline-offset-2 hover:underline">{r.label}</Link> <span className="text-muted-foreground">{r.sub}</span></li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
