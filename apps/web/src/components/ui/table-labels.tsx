"use client";

import { useEffect, useRef } from "react";

/**
 * Gives every cell of a stacked table (a table that becomes one small card per row on a phone) the heading of its column as `data-label`,
 * read from the table's own header row, so a list does not need a label written on every cell. The first cell is the card's title and gets
 * none. A row with a spanning cell (an empty-state message) is left alone. It keeps labelling when the rows change after a refresh.
 */
export function TableLabels() {
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const table = anchor.current?.parentElement?.querySelector("table");
    if (!table) return;
    const label = () => {
      const heads = Array.from(table.querySelectorAll("thead th")).map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim());
      if (heads.length === 0) return;
      for (const row of Array.from(table.querySelectorAll("tbody > tr"))) {
        const cells = Array.from(row.children) as HTMLElement[];
        if (cells.some((c) => (c as HTMLTableCellElement).colSpan > 1)) continue;
        cells.forEach((c, i) => {
          if (i === 0 || c.hasAttribute("data-label") && c.dataset.labelAuto !== "1") return;
          const text = heads[i];
          if (text) { c.setAttribute("data-label", text); c.dataset.labelAuto = "1"; }
        });
      }
    };
    label();
    const body = table.querySelector("tbody");
    if (!body) return;
    const observer = new MutationObserver(label);
    observer.observe(body, { childList: true });
    return () => observer.disconnect();
  }, []);
  return <span ref={anchor} hidden />;
}
