"use client";

import { useState } from "react";
import Link from "next/link";
import { saveInventoryCategory } from "@/lib/actions/inventorySetup";
import { categoryRows, descendantIds, type CategoryNode } from "@/lib/inventory/setup";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ActionForm, Field } from "@/components/sales/action-form";

interface Draft { id: string | null; parentId: string; name: string; sortOrder: number; isActive: boolean }

function CategoryForm({ companyId, draft, categories, onDone }: { companyId: string; draft: Draft; categories: readonly CategoryNode[]; onDone: () => void }) {
  const blocked = draft.id ? new Set([draft.id, ...descendantIds(categories, draft.id)]) : new Set<string>();
  const rows = categoryRows(categories).filter((c) => !blocked.has(c.id));
  return (
    <ActionForm action={saveInventoryCategory} submitLabel={draft.id ? "Save category" : "Add category"} onDone={onDone} secondary={<Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>}>
      <input type="hidden" name="companyId" value={companyId} />
      {draft.id ? <input type="hidden" name="categoryId" value={draft.id} /> : null}
      <Field label="Name" htmlFor="inv-cat-name"><Input id="inv-cat-name" name="name" required maxLength={80} defaultValue={draft.name} autoComplete="off" /></Field>
      <Field label="Sits under" htmlFor="inv-cat-parent" hint="Leave as top level, or place it under another category.">
        <Select id="inv-cat-parent" name="parentId" defaultValue={draft.parentId}>
          <option value="">Top level</option>
          {rows.map((c) => <option key={c.id} value={c.id}>{`${"— ".repeat(c.depth)}${c.name}`}</option>)}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Order" htmlFor="inv-cat-order" hint="Smaller numbers come first."><Input id="inv-cat-order" name="sortOrder" type="number" inputMode="numeric" step={1} defaultValue={draft.sortOrder} /></Field>
        {draft.id ? (
          <Field label="Status" htmlFor="inv-cat-active"><Select id="inv-cat-active" name="isActive" defaultValue={String(draft.isActive)}><option value="true">In use</option><option value="false">Switched off</option></Select></Field>
        ) : null}
      </div>
    </ActionForm>
  );
}

/** The company's own category tree. Nothing is pre-filled: it holds exactly what a person with catalogue rights has added. */
export function CategoriesSection({ companyId, categories, itemCounts, canEdit }: { companyId: string; categories: readonly CategoryNode[]; itemCounts: Readonly<Record<string, number>>; canEdit: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const rows = categoryRows(categories);
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">Categories group the catalogue. Nothing is built in: add the groups you really use, and nest them as deep as you need. Items, their models and exact specifications are added and edited in the <Link href="/inventory" className="underline underline-offset-2">catalogue</Link>.</p>
      {canEdit ? <Button type="button" size="sm" onClick={() => setDraft({ id: null, parentId: "", name: "", sortOrder: 0, isActive: true })}>Add a category</Button> : <p className="text-sm text-muted-foreground">Catalogue rights are needed to change categories.</p>}
      {rows.length === 0 ? <EmptyState dense title="No categories yet." description={canEdit ? "Add the first category, for example Computers, Cables or Motors." : "Someone with catalogue rights needs to add them."} /> : (
        <ul className="divide-y divide-border rounded-md border border-border" aria-label="Categories">
          {rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" style={{ paddingLeft: `${0.75 + c.depth * 1.25}rem` }}>
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{c.name}{!c.isActive ? <Badge variant="warning" className="ml-2">Switched off</Badge> : null}</p>
                <p className="text-sm text-muted-foreground">{itemCounts[c.id] ?? 0} {(itemCounts[c.id] ?? 0) === 1 ? "item" : "items"}</p>
              </div>
              {canEdit ? (
                <div className="flex flex-wrap gap-1">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ id: null, parentId: c.id, name: "", sortOrder: 0, isActive: true })}>Add under<span className="sr-only">{` ${c.name}`}</span></Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({ id: c.id, parentId: c.parentId ?? "", name: c.name, sortOrder: c.sortOrder, isActive: c.isActive })}>Edit<span className="sr-only">{` ${c.name}`}</span></Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {draft ? (
        <Modal open onClose={() => setDraft(null)} title={draft.id ? "Edit category" : draft.parentId ? "Add a sub-category" : "Add a category"}>
          <CategoryForm companyId={companyId} draft={draft} categories={categories} onDone={() => setDraft(null)} />
        </Modal>
      ) : null}
    </div>
  );
}
