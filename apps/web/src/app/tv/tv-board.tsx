"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { signOut } from "@/lib/actions/auth";
import {
  ALL_RUNS, buildProjectRows, buildRail, clampPage, clockInZone, handoverRows, lastUpdatedText, nextPage, paginate, ROTATE_MS, REFRESH_MS, rowsPerPage, zoneLabel,
  type TvProjectRow, type TvRailItem, type TvRun,
} from "@/lib/operations-tv/model";
import { canStart, initialRefresh, isCleared, refreshReducer, type TvResult, type TvStatus } from "@/lib/operations-tv/refresh";
import type { TvBoard } from "@/lib/operations-tv/types";
import "./tv.css";

const WIDE = "(min-width: 1536px)";
const subscribeWide = (cb: () => void) => { const m = window.matchMedia(WIDE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
const RAIL_LIMIT_WIDE = 4;
const RAIL_LIMIT_SMALL = 14;

async function fetchBoard(companyId: string | null, signal: AbortSignal): Promise<TvResult> {
  try {
    const res = await fetch(`/api/tv/board${companyId ? `?company=${encodeURIComponent(companyId)}` : ""}`, { cache: "no-store", credentials: "same-origin", signal, headers: { accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as { state?: string; board?: TvBoard } | null;
    if (res.status === 200 && body?.state === "ok" && body.board) return { kind: "ok", board: body.board };
    if (res.status === 401 || res.redirected) return { kind: "signed_out" };
    if (res.status === 403) return { kind: body?.state === "revoked" ? "revoked" : "denied" };
    if (res.status === 503 && body?.state === "not_installed") return { kind: "not_installed" };
    return { kind: "transient" };
  } catch { return { kind: "transient" }; }
}

export function TvBoardClient({ initial, companyId, startPage, rotate, displayLabel }: { initial: TvResult; companyId: string | null; startPage: number; rotate: boolean; displayLabel: string | null }) {
  const [state, dispatch] = useReducer(refreshReducer, initialRefresh, (s) => refreshReducer(s, { type: "result", result: initial, at: Date.now() }));
  const stateRef = useRef(state);
  const inFlight = useRef(false);
  useEffect(() => { stateRef.current = state; }, [state]);
  const wide = useWide();
  const [now, setNow] = useState<number | null>(null);
  const [pageIdx, setPageIdx] = useState(startPage);
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(async () => {
    if (inFlight.current || !canStart(stateRef.current)) return; // one request at a time; none once access is gone
    inFlight.current = true;
    dispatch({ type: "start" });
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20_000);
    const result = await fetchBoard(stateRef.current.board?.company.id ?? companyId, ctl.signal);
    clearTimeout(timer);
    inFlight.current = false;
    dispatch({ type: "result", result, at: Date.now() });
  }, [companyId]);

  // Refresh about every 60 s while the tab is visible, independent of rotation. A tab that was hidden refreshes as soon as it is shown again if its board is old.
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const t = setInterval(() => { setNow(Date.now()); dispatch({ type: "tick", now: Date.now() }); if (document.visibilityState === "visible") void refresh(); }, REFRESH_MS);
    const clock = setInterval(() => { setNow(Date.now()); dispatch({ type: "tick", now: Date.now() }); }, 15_000);
    const vis = () => { if (document.visibilityState === "visible") { const s = stateRef.current; if (s.lastOkAt === null || Date.now() - s.lastOkAt > REFRESH_MS) void refresh(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { clearTimeout(first); clearInterval(t); clearInterval(clock); document.removeEventListener("visibilitychange", vis); };
  }, [refresh]);

  const board = state.board;
  const view = useMemo(() => {
    if (!board) return null;
    const rail = buildRail(board, wide ? RAIL_LIMIT_WIDE : RAIL_LIMIT_SMALL);
    const rows = wide ? buildProjectRows(board) : buildProjectRows(board, ALL_RUNS);
    const pages = wide ? paginate(rows, rowsPerPage(1920)) : [rows];
    return { rail, rows, pages, handovers: handoverRows(board) };
  }, [board, wide]);

  const pageCount = view?.pages.length ?? 1;
  const rotating = wide && rotate && pageCount > 1 && !paused && !isCleared(state.status);
  useEffect(() => {
    if (!rotating) return;
    const t = setInterval(() => setPageIdx((p) => nextPage(clampPage(p, pageCount), pageCount)), ROTATE_MS);
    return () => clearInterval(t);
  }, [rotating, pageCount]);
  const page = clampPage(pageIdx, pageCount);

  const tz = board?.office_tz ?? "Asia/Dubai";
  const stale = state.status === "stale" && board;
  return (
    <div className="tv-root" data-testid="tv-board" data-status={state.status}>
      <header className="tv-header" data-testid="tv-header">
        <div className="tv-brand">
          <Image src="/brand/enginious-os-lockup-dark.png" alt="ENGINIOUS OS" width={772} height={124} priority className="tv-logo" />
          <span className="tv-title">Operations board</span>
        </div>
        <div className="tv-company" data-testid="tv-company">{board?.company.name ?? (displayLabel ? `Display: ${displayLabel}` : "Enginious")}</div>
        <div className="tv-meta">
          {board && now !== null ? <span className="tv-clock" suppressHydrationWarning>{clockInZone(new Date(now).toISOString(), tz)} <small>{zoneLabel(tz, new Date(now).toISOString())}</small></span> : null}
          {board ? <span className="tv-updated" data-testid="tv-updated">Last updated <b>{lastUpdatedText(board.generated_at, tz, now ?? Date.parse(board.generated_at))}</b></span> : null}
          <form action={signOut}><button type="submit" className="tv-signout">Sign out</button></form>
        </div>
      </header>

      {stale ? (
        <div className="tv-stale" role="status" data-testid="tv-stale"><b>Stale</b> The board could not be refreshed. This is the last good board, as of {lastUpdatedText(board.generated_at, tz, now ?? Date.parse(board.generated_at))}. Trying again every minute.</div>
      ) : null}

      {!board || !view ? <StateScreen status={state.status} /> : (
        <main className="tv-main">
          <section className="tv-rail" aria-label="Next on site" data-testid="tv-rail">
            <h2 className="tv-h">Next on site</h2>
            {view.rail.items.length === 0 ? <p className="tv-empty" data-testid="tv-state-empty">No scheduled site work</p> : (
              <ol className="tv-rail-list">{view.rail.items.map((it) => <RailItem key={it.id} it={it} />)}</ol>
            )}
            {view.rail.hidden > 0 ? <p className="tv-more">+{view.rail.hidden} more later</p> : null}
          </section>

          <section className="tv-projects" aria-label="Active projects" onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
            <div className="tv-projects-head">
              <h2 className="tv-h tv-h-light">Active projects</h2>
              {pageCount > 1 ? (
                <div className="tv-pages" data-testid="tv-page-indicator" aria-label={`Page ${page + 1} of ${pageCount}`}>
                  <span>Page {page + 1} of {pageCount}</span>
                  <span className="tv-dots" aria-hidden>{view.pages.map((_, i) => <i key={i} className={i === page ? "on" : ""} />)}</span>
                </div>
              ) : null}
            </div>
            {view.rows.length === 0 ? <p className="tv-empty tv-empty-light" data-testid="tv-state-no-projects">No active projects</p> : (
              <div className="tv-page" key={page}>
                <div className="tv-colhead" aria-hidden><span>Project</span><div className="tv-colhead-runs"><span>What and when</span><span>Where and who</span><span>What could hold it up</span></div></div>
                {(view.pages[page] ?? []).map((row) => <ProjectBlock key={row.project.id} row={row} />)}
              </div>
            )}
            {view.handovers.length ? (
              <aside className="tv-handovers" data-testid="tv-handovers" aria-label="Handovers awaiting acceptance">
                <h3>Handovers awaiting acceptance</h3>
                <ul>{view.handovers.map((h) => (
                  <li key={h.id}><b>{h.title}</b> <span className="tv-ref">{h.reference}</span><span>{h.status} · {h.pm}{h.install ? ` · install ${h.install}` : ""}{h.location ? ` · ${h.location}` : ""}</span></li>
                ))}</ul>
              </aside>
            ) : null}
            {board.truncated.activities || board.truncated.projects || board.truncated.shipments ? <p className="tv-trunc">The board shows the first rows only; some projects or activities are not shown.</p> : null}
          </section>
        </main>
      )}
    </div>
  );
}

function RailItem({ it }: { it: TvRailItem }) {
  return (
    <li className={`tv-rail-item ${it.badge}`} data-testid={`tv-rail-item-${it.kind === "activity" ? it.activityId : it.id}`}>
      <div className="tv-when">
        <span className="tv-day">{it.when.day}</span>
        <span className="tv-time">{it.when.time ?? "time not set"}{it.when.zone ? <small> {it.when.zone}</small> : null}</span>
        {it.badge === "next" ? <em className="tv-chip teal">Next</em> : null}
        {it.badge === "attention" ? <em className="tv-chip amber">Needs attention</em> : null}
      </div>
      <div className="tv-what"><b>{it.title}</b><span className="tv-proj" title={it.projectName}>{it.projectName}</span></div>
      {it.phase ? <div className={`tv-phase ${it.phase.tone}`}>{it.phase.label}</div> : null}
      {it.kind === "activity" ? (
        <div className="tv-where">
          <span>{it.where ?? <i>Venue not set</i>}{it.where && it.whereNote ? <small> ({it.whereNote})</small> : null}</span>
          <span className={it.who.startsWith("Crew not") || it.who.includes("crew not") ? "tv-miss" : ""}>{it.who}</span>
        </div>
      ) : it.whereNote ? <div className="tv-where"><span>{it.whereNote}</span></div> : null}
      {it.blocker ? <div className={`tv-blocker ${it.blocker.attention ? "amber" : "quiet"}`} data-testid={`tv-rail-blocker-${it.activityId ?? it.id}`}><b>{it.blocker.label}</b><span>{it.blocker.detail}</span><i>{it.blocker.action}</i></div> : null}
    </li>
  );
}

function RunRow({ run }: { run: TvRun }) {
  return (
    <div className="tv-run">
      <div className="tv-run-when">
        <span className="tv-day">{run.when.day}</span>
        <span className="tv-time">{run.when.time ?? "time not set"}{run.when.zone ? <small> {run.when.zone}</small> : null}</span>
        <b>{run.name}</b>
        <span className={`tv-phase ${run.phase.tone}`}>{run.phase.label}</span>
      </div>
      <div className="tv-run-where">
        <span>{run.where ?? <i>Venue not set</i>}{run.where && run.whereNote ? <small> ({run.whereNote})</small> : null}</span>
        <span className={run.who.includes("not assigned") ? "tv-miss" : ""}>{run.who}</span>
      </div>
      <div className="tv-run-block">
        {run.blocker ? <div className={`tv-blocker ${run.blocker.attention ? "amber" : "quiet"}`} data-testid={`tv-blocker-${run.id}`}><b>{run.blocker.label}</b><span>{run.blocker.detail}</span><i>{run.blocker.action}</i></div> : <span className="tv-ok">Nothing holding this up</span>}
      </div>
    </div>
  );
}

function ProjectBlock({ row }: { row: TvProjectRow }) {
  const p = row.project;
  return (
    <article className="tv-project" data-testid={`tv-project-${p.id}`}>
      <div className="tv-project-id">
        <h3 title={p.name}>{p.name}</h3>
        <span className="tv-ref">{p.ref}{p.pm_name ? ` · PM ${p.pm_name}` : " · PM not named yet"}</span>
        {row.activations.length ? <span className="tv-act">Activations: {row.activations.join(" · ")}</span> : null}
        <span className="tv-ready">{row.readinessText}</span>
        {row.equipmentText ? <span className="tv-ready">Equipment: {row.equipmentText}</span> : null}
      </div>
      <div className="tv-runs">
        {row.noSiteWork ? <div className="tv-nosite" data-testid={`tv-blocker-${p.id}`}>{row.statement}</div> : row.runs.map((r) => <RunRow key={r.id} run={r} />)}
        {row.moreRuns > 0 ? <div className="tv-more">+{row.moreRuns} more run{row.moreRuns === 1 ? "" : "s"} later</div> : null}
      </div>
    </article>
  );
}

const STATE_TEXT: Partial<Record<TvStatus, { title: string; body: string; sign?: boolean }>> = {
  loading: { title: "Loading the board", body: "One moment." },
  error: { title: "The board could not be loaded", body: "Trying again every minute. If this stays, check the network connection of this screen." },
  denied: { title: "This screen has no access to the board", body: "Ask an Operations Manager to check the display account for this company.", sign: true },
  revoked: { title: "This display has been switched off", body: "Its access was revoked. An Operations Manager can set up a new display account.", sign: true },
  signed_out: { title: "Signed out", body: "The session has ended. Sign in again to show the board.", sign: true },
  not_installed: { title: "The office board is not installed here yet", body: "The database update for the office board has not been applied to this environment." },
};
function StateScreen({ status }: { status: TvStatus }) {
  const t = STATE_TEXT[status] ?? STATE_TEXT.error!;
  return (
    <main className="tv-state" data-testid={`tv-state-${status}`} role="status">
      <h2>{t.title}</h2><p>{t.body}</p>
      {t.sign ? <Link href="/login?next=/tv" className="tv-signin">Go to sign-in</Link> : null}
    </main>
  );
}
