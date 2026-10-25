"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { MoreMenu, type MoreItem } from "@/components/workspace/more-menu";
import type { FormContext } from "@/lib/inventory/stock-candidates";
import type { MovementKind } from "@/lib/inventory/stock-movements";
import type { MovementInitial } from "./movement-form";
import { MovementDialog } from "./movement-panel";

export type ActionSpec = { key: string; label: string; hint?: string; separatorBefore?: boolean; danger?: boolean; disabled?: boolean } & (
  | { href: string }
  | { movement: { kind: MovementKind; initial?: MovementInitial; title: string; description?: string } }
  | { dialog: { title: string; description?: string } }
);

/**
 * The infrequent actions of an item or a unit, under one "More actions" menu. Each opens a small form in a dialog: movements use the same
 * form, review step, key and result check as the main ones; the others (add a unit, replace, checklist…) are the page's own forms,
 * passed in by key. Nothing here changes data until a form's own button is pressed.
 */
export function ActionMenu({ specs, context, dialogs, label = "More actions" }: { specs: readonly ActionSpec[]; context: FormContext; dialogs?: Record<string, React.ReactNode>; label?: string }) {
  // The chosen action is kept as it was when it was chosen: recording it changes the page behind (the unit is now somewhere else, so the
  // menu offers other things), and the form that shows "Recorded" must not vanish with the old menu entry.
  const [chosen, setChosen] = useState<ActionSpec | null>(null);
  const items: MoreItem[] = specs.map((s) => ({
    key: s.key, label: s.label, hint: s.hint, separatorBefore: s.separatorBefore, danger: s.danger, disabled: s.disabled,
    ...("href" in s ? { href: s.href } : { onSelect: (k: string) => setChosen(specs.find((x) => x.key === k) ?? null) }),
  }));
  const spec = chosen;
  const close = () => setChosen(null);
  return (
    <>
      {/* These menus sit at the left of a side panel: opening towards the right keeps the list inside the panel (it was clipped when it opened to the left). */}
      <MoreMenu items={items} label={label} align="start" />
      {spec && "movement" in spec ? (
        <MovementDialog open onClose={close} kind={spec.movement.kind} context={context} initial={spec.movement.initial} title={spec.movement.title} description={spec.movement.description} />
      ) : null}
      {spec && "dialog" in spec ? (
        <Modal open onClose={close} title={spec.dialog.title} description={spec.dialog.description} size="wide">{dialogs?.[spec.key]}</Modal>
      ) : null}
    </>
  );
}
