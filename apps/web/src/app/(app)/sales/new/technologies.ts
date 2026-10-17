import type { CrmTechnology } from "@/types/crm";

/** One editable row of the "technologies requested" list. Both fields are text because that is what an input holds. */
export interface TechnologyRow {
  key: number;
  name: string;
  qty: string;
}

export interface TechnologyParse {
  /** Rows that have a name, in the shape the createOpportunity action expects. */
  items: CrmTechnology[];
  /** A plain-words problem with the rows, or null when they are fine to save. */
  error: string | null;
}

/**
 * Turns the rows into the `technologies` JSON the action reads. A row with no name and a blank or default (1) quantity
 * is ignored (the untouched row at the bottom of the list); a row with another quantity but no name is an error; a blank quantity on a
 * named row means 1. A quantity that is not a whole number of at least 1 is kept as 0 so the server refuses it too.
 */
export function parseTechnologyRows(rows: readonly { name: string; qty: string }[]): TechnologyParse {
  const items: CrmTechnology[] = [];
  let error: string | null = null;
  for (const row of rows) {
    const name = row.name.trim();
    const qtyText = row.qty.trim();
    if (name === "" && (qtyText === "" || qtyText === "1")) continue; // the untouched row: quantity 1 is its default
    if (name === "") {
      error ??= "Give each technology a name, or clear its quantity.";
      continue;
    }
    if (qtyText === "") {
      items.push({ name, qty: 1 });
      continue;
    }
    const qty = Number(qtyText);
    if (!Number.isInteger(qty) || qty < 1) {
      error ??= `Quantity for "${name}" must be a whole number, 1 or more.`;
      items.push({ name, qty: 0 });
      continue;
    }
    items.push({ name, qty });
  }
  return { items, error };
}

export const serialiseTechnologies = (rows: readonly { name: string; qty: string }[]): string => JSON.stringify(parseTechnologyRows(rows).items);
