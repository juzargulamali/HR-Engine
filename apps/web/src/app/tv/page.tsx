import type { Metadata } from "next";
import { loadTvBoard } from "@/lib/operations-tv/load";
import type { TvResult } from "@/lib/operations-tv/refresh";
import { TvBoardClient } from "./tv-board";

/**
 * The office board (Phase 3): one dedicated, read-only page for the office TV. It sits outside the application shell (no navigation, no chat, nothing to click) and answers
 * what is happening on site next, who is going, and what could hold it up. The database decides who may read it on this load and on every refresh. Never cached.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Office board", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TvPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const asked = first(sp.company);
  const company = asked && UUID.test(asked) ? asked : null;
  const page = Math.max(1, Number.parseInt(first(sp.page) ?? "1", 10) || 1);
  const rotate = first(sp.rotate) !== "0";
  let initial: TvResult;
  let companyId = company;
  let label: string | null = null;
  try {
    const r = await loadTvBoard(company);
    label = r.display?.label ?? null;
    if (r.state === "ok") { initial = { kind: "ok", board: r.board }; companyId = r.board.company.id; }
    else initial = { kind: r.state === "error" ? "transient" : r.state };
    if (r.display?.company_id) companyId = r.display.company_id;
  } catch { initial = { kind: "transient" }; }
  return <TvBoardClient initial={initial} companyId={companyId} startPage={page - 1} rotate={rotate} displayLabel={label} />;
}
