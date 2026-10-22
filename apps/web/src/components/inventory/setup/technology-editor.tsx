"use client";

import { startTransition, useActionState, useId, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { saveInventoryTechnology, setInventoryTechnologyStatus } from "@/lib/actions/inventorySetup";
import type { InvActionState } from "@/lib/inventory/action-utils";
import { parseCountedQty } from "@/lib/inventory/setup";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm, Field } from "@/components/sales/action-form";
import { SidePanel } from "@/components/workspace/side-panel";
import { useUnsavedChanges } from "@/components/workspace/unsaved";
import { withParams } from "@/components/workspace/url-state";
import { TECH_STATUS_WORDS } from "./technologies-section";

export interface TechItemOption { id: string; label: string; scale: number }
export interface ComponentDraft { itemId: string; qty: string; altGroup: string; isOptional: boolean; note: string }
export interface TechnologyData { id: string | null; name: string; description: string; status: "draft" | "complete" | "retired"; version: number | null }

const blank = (): ComponentDraft => ({ itemId: "", qty: "1", altGroup: "", isOptional: false, note: "" });

export function TechnologyEditorBody({ companyId, technology, components, items, canEdit, onCreated }: {
  companyId: string; technology: TechnologyData; components: readonly ComponentDraft[]; items: readonly TechItemOption[]; canEdit: boolean; onCreated?: (id: string) => void;
}) {
  const formId = useId();
  const [name, setName] = useState(technology.name);
  const [description, setDescription] = useState(technology.description);
  const [rows, setRows] = useState<ComponentDraft[]>(components.length > 0 ? [...components] : technology.id ? [] : [blank()]);
  const [filter, setFilter] = useState("");
  const [dirty, setDirty] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useUnsavedChanges(formId, dirty);
  const readOnly = !canEdit || technology.status === "retired";

  const [state, formAction, pending] = useActionState(async (prev: InvActionState, fd: FormData): Promise<InvActionState> => {
    const result = await saveInventoryTechnology(prev, fd);
    if (result.error === null) { setDirty(false); setSaved(true); if (!technology.id && result.id) onCreated?.(result.id); }
    return result;
  }, { error: null } as InvActionState);

  const visibleItems = useMemo(() => {
    const t = filter.trim().toLowerCase();
    return t ? items.filter((i) => i.label.toLowerCase().includes(t)) : items;
  }, [items, filter]);
  const edit = (fn: () => void) => { fn(); setDirty(true); setSaved(false); setClientError(null); };
  const patch = (i: number, p: Partial<ComponentDraft>) => edit(() => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x))));

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setClientError(null);
    if (name.trim() === "") return setClientError("Give the technology a name.");
    const payload: { item_id: string; qty: number; alt_group?: string; is_optional?: boolean; note?: string }[] = [];
    const seen = new Set<string>();
    for (const [n, r] of rows.entries()) {
      const item = items.find((i) => i.id === r.itemId);
      if (!item) return setClientError(`Component ${n + 1}: choose the item.`);
      if (seen.has(item.id)) return setClientError("An item appears twice. List an item once, and use an alternative group for look-alikes.");
      seen.add(item.id);
      const q = parseCountedQty(r.qty, item.scale, "cycle");
      if (!q.ok || q.value <= 0) return setClientError(`Component ${n + 1}: type a quantity above zero${q.ok ? "" : `. ${q.error}`}`);
      payload.push({ item_id: item.id, qty: q.value, ...(r.altGroup.trim() ? { alt_group: r.altGroup.trim() } : {}), ...(r.isOptional ? { is_optional: true } : {}), ...(r.note.trim() ? { note: r.note.trim() } : {}) });
    }
    const fd = new FormData();
    fd.set("companyId", companyId);
    if (technology.id) fd.set("technologyId", technology.id);
    if (technology.version !== null) fd.set("expectedVersion", String(technology.version));
    fd.set("name", name.trim());
    fd.set("description", description.trim());
    fd.set("components", JSON.stringify(payload));
    startTransition(() => formAction(fd));
  }
  const error = clientError ?? state.error;

  return (
    <div className="space-y-6">
      {technology.id ? (
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-sm"><Badge variant={technology.status === "complete" ? "success" : technology.status === "draft" ? "warning" : "outline"}>{TECH_STATUS_WORDS[technology.status].label}</Badge><span className="text-muted-foreground">{TECH_STATUS_WORDS[technology.status].help}</span></p>
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">A template is a checklist, not stock: it never changes what is on the shelf. Only <strong>complete</strong> templates are used for availability checks.</p>

      <form onSubmit={onSubmit} className="space-y-4" aria-label="Technology template">
        <fieldset disabled={readOnly} className="space-y-4">
          <Field label="Name" htmlFor="tech-name"><Input id="tech-name" value={name} maxLength={160} onChange={(e) => edit(() => setName(e.target.value))} autoComplete="off" /></Field>
          <Field label="Description (optional)" htmlFor="tech-desc"><Textarea id="tech-desc" rows={2} value={description} onChange={(e) => edit(() => setDescription(e.target.value))} /></Field>

          <section className="space-y-3" aria-labelledby="tech-components">
            <h3 id="tech-components" className="text-sm font-semibold">Items this needs</h3>
            <p className="text-sm text-muted-foreground">Give look-alike items the same <strong>alternative group</strong> name when any one of them will do: the first one listed is the standard choice, and the others are offered as substitutes. Tick <strong>Optional</strong> for items that are nice to have. Only alternatives you write here are ever offered: different models are never assumed interchangeable.</p>
            {items.length > 12 ? <Field label="Filter the item lists" htmlFor="tech-filter"><Input id="tech-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Start typing an item name" autoComplete="off" /></Field> : null}
            {rows.length === 0 ? <p className="text-sm text-muted-foreground">No items yet.</p> : (
              <ul className="space-y-3">
                {rows.map((r, i) => (
                  <li key={i} className="space-y-3 rounded-md border border-border p-3">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                      <Field label={`Item ${i + 1}`} htmlFor={`tech-item-${i}`}>
                        <Select id={`tech-item-${i}`} value={r.itemId} onChange={(e) => patch(i, { itemId: e.target.value })}>
                          <option value="">Choose an item…</option>
                          {items.filter((it) => it.id === r.itemId || visibleItems.includes(it)).map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
                        </Select>
                      </Field>
                      <Field label="Quantity" htmlFor={`tech-qty-${i}`}><Input id={`tech-qty-${i}`} inputMode="decimal" value={r.qty} onChange={(e) => patch(i, { qty: e.target.value })} autoComplete="off" /></Field>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Alternative group (optional)" htmlFor={`tech-alt-${i}`}><Input id={`tech-alt-${i}`} value={r.altGroup} maxLength={60} onChange={(e) => patch(i, { altGroup: e.target.value })} placeholder="e.g. Controller" autoComplete="off" /></Field>
                      <Field label="Note (optional)" htmlFor={`tech-note-${i}`}><Input id={`tech-note-${i}`} value={r.note} maxLength={300} onChange={(e) => patch(i, { note: e.target.value })} autoComplete="off" /></Field>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={r.isOptional} onChange={(e) => patch(i, { isOptional: e.target.checked })} /> Optional</label>
                      <Button type="button" size="sm" variant="ghost" onClick={() => edit(() => setRows((x) => x.filter((_, j) => j !== i)))}>Remove<span className="sr-only">{` item ${i + 1}`}</span></Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => edit(() => setRows((x) => [...x, blank()]))}>Add an item</Button>
            {rows.some((r) => r.altGroup.trim()) ? <p className="text-sm text-muted-foreground">All items in one alternative group must be required, or all optional.</p> : null}
          </section>
        </fieldset>

        {error ? <Alert variant="destructive" role="alert">{error}{state.error && !clientError ? " Your entries are kept." : ""}</Alert> : null}
        {saved && !error ? <Alert variant="success" role="status">Saved.</Alert> : null}
        {!readOnly ? <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? "Saving…" : technology.id ? "Save template" : "Create template"}</Button></div> : technology.status === "retired" ? <p className="text-sm text-muted-foreground">A retired template cannot be edited. Set it back to draft below to change it.</p> : null}
      </form>

      {technology.id && canEdit ? (
        <section className="space-y-2 border-t border-border pt-4" aria-labelledby="tech-status">
          <h3 id="tech-status" className="text-sm font-semibold">Status</h3>
          {dirty ? <p className="text-sm text-muted-foreground">Save your changes before changing the status.</p> : null}
          <ActionForm action={setInventoryTechnologyStatus} submitLabel="Set status" pendingLabel="Saving…" className="space-y-3">
            <input type="hidden" name="technologyId" value={technology.id} />
            {technology.version !== null ? <input type="hidden" name="expectedVersion" value={technology.version} /> : null}
            <Field label="Status" htmlFor="tech-status-select" hint="A complete template needs at least one required item, and none of its items may be retired.">
              <Select id="tech-status-select" name="status" defaultValue={technology.status} disabled={dirty}>
                {(Object.keys(TECH_STATUS_WORDS) as (keyof typeof TECH_STATUS_WORDS)[]).map((k) => <option key={k} value={k}>{TECH_STATUS_WORDS[k].label}: {TECH_STATUS_WORDS[k].help}</option>)}
              </Select>
            </Field>
          </ActionForm>
        </section>
      ) : null}
    </div>
  );
}

/** The template editor in the side panel (`?tech=ID`, or `new`). */
export function TechnologyEditor({ closeHref, ...body }: React.ComponentProps<typeof TechnologyEditorBody> & { closeHref: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <SidePanel title={body.technology.id ? body.technology.name : "New technology template"} subtitle="Technology template" closeHref={closeHref}>
      <TechnologyEditorBody {...body} onCreated={(id) => router.replace(`${withParams(pathname, sp, { tech: id })}#technologies`, { scroll: false })} />
    </SidePanel>
  );
}
