import { BALANCE_CONDITION_WORDS, CONDITION_WORDS } from "./words";

/**
 * "Set the condition for all ticked lines" on a return. The helper only ever writes a condition a person chose, only onto lines that are already ticked
 * (or already on the list), and only where that condition exists for the kind of line: individual units have five conditions, counted stock three.
 * Lines it cannot apply to keep what they had, and the answer says how many. It never ticks anything and never starts with a condition selected.
 */
export interface ReturnLineRef { key: string; individual: boolean }

export const validConditionFor = (individual: boolean, value: string): boolean => Object.keys(individual ? CONDITION_WORDS : BALANCE_CONDITION_WORDS).includes(value);

export function applyConditionToLines(current: Record<string, string>, lines: readonly ReturnLineRef[], value: string): { next: Record<string, string>; applied: number; skipped: number } {
  const next = { ...current };
  let applied = 0;
  let skipped = 0;
  if (value === "") return { next, applied, skipped: lines.length };
  for (const l of lines) {
    if (validConditionFor(l.individual, value)) { next[l.key] = value; applied += 1; } else skipped += 1;
  }
  return { next, applied, skipped };
}

/** The sentence shown after the helper was used. */
export function appliedMessage(value: string, applied: number, skipped: number): string {
  const word = (CONDITION_WORDS as Record<string, string>)[value] ?? value;
  const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;
  return `${word} set on ${lines(applied)}.${skipped > 0 ? ` ${lines(skipped)} ${skipped === 1 ? "was" : "were"} left as ${skipped === 1 ? "it was" : "they were"}: counted stock has no “${word}”.` : ""} Check each line before you review.`;
}
