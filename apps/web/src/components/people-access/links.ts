import type { PaTab } from "@/lib/people-access/data";

export interface PaParams { q?: string; company?: string; person?: string; tab?: PaTab; view?: "company" }

/** One place that writes the screen's addresses, so a search or filter survives choosing a person and back. */
export function paHref(p: PaParams): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.company) sp.set("company", p.company);
  if (p.person) sp.set("person", p.person);
  if (p.tab) sp.set("tab", p.tab);
  if (p.view) sp.set("view", p.view);
  const qs = sp.toString();
  return qs ? `/people-access?${qs}` : "/people-access";
}
