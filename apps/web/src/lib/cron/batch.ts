import "server-only";

/**
 * Splits rows into fixed-size chunks so a bulk cron insert doesn't post
 * everything in a single statement. Postgres rejects a whole INSERT if any
 * one row in it violates a constraint (a stale FK, a NaN that slipped past
 * validation) — without chunking, one bad row anywhere in a run's rows
 * takes down every other employee's otherwise-valid posting along with it.
 * Chunking bounds that blast radius to the rows in the same chunk as the
 * bad one; every other chunk still commits.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
