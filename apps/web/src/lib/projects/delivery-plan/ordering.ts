/**
 * Pure rules for the Project Plan's Quick add and row order. No database, no React.
 *  - `parseQuickRows` turns pasted text (a list typed or copied from Excel) into rows: one row per line, "Name<TAB>Qty", "Name x Qty", "Qty x Name" or just "Name".
 *  - `moveId` / `reorderIds` change an order of ids; the screen sends the whole new order of a section and the database keeps it.
 */
export interface QuickRow { name: string; qty: string }
export const QUICK_ADD_MAX = 50;

const QTY = String.raw`\d{1,6}(?:[.,]\d{1,3})?`;
const SUFFIX = new RegExp(String.raw`^(.*\S)\s*[x×*]\s*(${QTY})$`, "i");          // "Batak unit x 4", "Batak unit ×4"
const PREFIX = new RegExp(String.raw`^(${QTY})\s*[x×*]\s+(\S.*)$`, "i");          // "4 x Batak unit" (a space after the x, so "2x4 timber" is left alone)
const quantity = (s: string) => s.replace(",", ".");

/** Lines of text to rows. Blank lines are skipped, each name is trimmed, a quantity that is not a positive number is left in the name (nothing is guessed). */
export function parseQuickRows(text: string): { rows: QuickRow[]; skipped: number; truncated: boolean } {
  const rows: QuickRow[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = raw.split("\t").map((c) => c.trim());
    let name = line, qty = "";
    if (cells.length >= 2 && cells[0] && new RegExp(`^${QTY}$`).test(cells[1] ?? "")) { name = cells[0]; qty = quantity(cells[1]!); }
    else if (cells.length >= 2 && cells[0]) { name = cells[0]; }
    else {
      const s = SUFFIX.exec(line), p = PREFIX.exec(line);
      if (s) { name = s[1]!.trim(); qty = quantity(s[2]!); } else if (p) { name = p[2]!.trim(); qty = quantity(p[1]!); }
    }
    if (!name) { skipped += 1; continue; }
    rows.push({ name: name.slice(0, 300), qty: Number(qty) > 0 ? qty : "" });
  }
  return { rows: rows.slice(0, QUICK_ADD_MAX), skipped, truncated: rows.length > QUICK_ADD_MAX };
}

/** The ids with the one at `from` moved to `to` (both clamped). Returns the same array when nothing moves. */
export function reorderIds<T>(ids: readonly T[], from: number, to: number): T[] {
  const n = ids.length;
  if (from < 0 || from >= n) return [...ids];
  const t = Math.max(0, Math.min(n - 1, to));
  if (t === from) return [...ids];
  const out = [...ids];
  const [x] = out.splice(from, 1);
  out.splice(t, 0, x!);
  return out;
}

/** One step up (-1) or down (+1) from the keyboard or a button. */
export const moveId = <T>(ids: readonly T[], id: T, delta: -1 | 1): T[] => reorderIds(ids, ids.indexOf(id), ids.indexOf(id) + delta);

/** What a screen reader hears after a move. */
export const moveAnnouncement = (label: string, position: number, total: number) => `${label} moved to position ${position} of ${total}.`;
