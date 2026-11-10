"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ComboOption {
  id: string;
  /** The name that is searched and shown in the field once chosen. */
  label: string;
  /** Extra words shown under the name (country, website, dates) that help tell similar names apart; they are searched too. */
  detail?: string;
}

/** Pure matching, shared with the tests: every word typed must appear in the name or the detail (any order, any case). Empty text matches everything. */
export function matchOptions<T extends ComboOption>(options: readonly T[], query: string, selectedId = "", limit = 8): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hay = (o: T) => `${o.label} ${o.detail ?? ""}`.toLowerCase();
  const hits = options.filter((o) => words.every((w) => hay(o).includes(w)));
  // A name that STARTS with what was typed comes first, then the rest A to Z (the order given).
  const first = words[0] ?? "";
  const ranked = first ? [...hits.filter((o) => o.label.toLowerCase().startsWith(first)), ...hits.filter((o) => !o.label.toLowerCase().startsWith(first))] : hits;
  const top = ranked.slice(0, limit);
  const chosen = selectedId ? options.find((o) => o.id === selectedId) : undefined;
  return chosen && !top.includes(chosen) && words.length === 0 ? [chosen, ...top.slice(0, limit - 1)] : top;
}

/**
 * One search-as-you-type field: type, see the matches directly below, choose by mouse, touch or keyboard (arrow keys, Enter, Escape). The chosen id is posted in a hidden
 * input named `name`. TYPING ALONE NEVER SELECTS OR CREATES ANYTHING: editing the text after a choice clears the choice until a match is chosen again, and Enter picks only
 * a highlighted match. Built to the ARIA combobox pattern (input role=combobox + listbox of options, focus stays in the input).
 */
export function SearchCombobox({
  id, name, label, hint, options, value, onChange, placeholder = "Type to search", emptyText, disabled = false, required = false, footer, optionBadge, onQueryChange,
}: {
  id: string;
  /** The hidden input that posts the chosen id. Leave it out (undefined) and nothing is posted: used for a field that is posted only when it changed. */
  name?: string | undefined;
  label: string;
  hint?: string;
  options: readonly ComboOption[];
  /** The chosen id, or "" for none. */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  /** Shown when nothing matches. */
  emptyText?: (query: string) => React.ReactNode;
  disabled?: boolean;
  required?: boolean;
  /** Anything under the list (for example "Add organisation"). */
  footer?: React.ReactNode;
  /** A short extra on the right of each option (for example a priority). */
  optionBadge?: (o: ComboOption) => React.ReactNode;
  /** Called with the text as it is typed, for a list that is searched on the server instead of held in `options`. */
  onQueryChange?: (text: string) => void;
}) {
  const listId = useId();
  const chosen = options.find((o) => o.id === value) ?? null;
  const [text, setText] = useState(chosen?.label ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // The field follows a change of the chosen id made from outside (a prefill, Clear), but never fights what is being typed.
  const lastValue = useRef(value);
  useEffect(() => {
    if (lastValue.current !== value) { lastValue.current = value; setText(options.find((o) => o.id === value)?.label ?? ""); }
  }, [value, options]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  // On a phone the matches can open below the visible part of a dialog or page: bring them into view so they can be tapped without scrolling first.
  const shown = open && !disabled;
  useEffect(() => { if (shown) list.current?.scrollIntoView?.({ block: "nearest" }); }, [shown, text]);

  const query = chosen && text === chosen.label ? "" : text;
  const matches = useMemo(() => matchOptions(options, query, value), [options, query, value]);
  const optionId = (i: number) => `${listId}-o${i}`;
  // A change this field makes itself is recorded first, so the effect above only follows changes made from OUTSIDE (a prefill, a reset) and never overwrites typing.
  const pick = (o: ComboOption) => { lastValue.current = o.id; onChange(o.id); setText(o.label); setOpen(false); };
  const clear = () => { lastValue.current = ""; onChange(""); setText(""); setOpen(false); };

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(a + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Home" && open) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && open) { e.preventDefault(); setActive(matches.length - 1); }
    else if (e.key === "Enter") { if (open && matches[active]) { e.preventDefault(); pick(matches[active]!); } else e.preventDefault(); }   // never submits the form from this field
    else if (e.key === "Escape") { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={box} className="relative min-w-0 space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium leading-none">{label}{required ? <span aria-hidden> *</span> : null}</label>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div className="relative">
        <Input
          id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={open && matches[active] ? optionId(active) : undefined}
          autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="search" placeholder={placeholder} disabled={disabled} value={text} className={cn("min-h-11", chosen && "pr-10")}
          onFocus={() => { setActive(0); setOpen(true); }}
          onChange={(e) => { setText(e.target.value); setActive(0); setOpen(true); onQueryChange?.(e.target.value); if (value) { lastValue.current = ""; onChange(""); } }}
          onKeyDown={onKey}
        />
        {chosen && !disabled ? (
          <button type="button" onClick={clear} aria-label={`Clear ${label}`} className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {open && !disabled ? (
        <ul ref={list} id={listId} role="listbox" aria-label={`${label} matches`} className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-raised p-1 text-foreground shadow-[var(--shadow-pop)]">
          {matches.length === 0 ? (
            <li role="presentation" className="px-2 py-2 text-sm text-muted-foreground">{emptyText ? emptyText(text.trim()) : `Nothing matches “${text.trim()}”.`}</li>
          ) : matches.map((o, i) => (
            <li
              key={o.id} id={optionId(i)} role="option" aria-selected={o.id === value}
              // mouse down keeps the focus in the field; the choice is made on click / tap
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)} onMouseEnter={() => setActive(i)}
              className={cn("flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-sm", i === active && "bg-secondary", o.id === value && "font-medium")}>
              <span className="min-w-0"><span className="block break-words">{o.label}</span>{o.detail ? <span className="block break-words text-xs text-muted-foreground">{o.detail}</span> : null}</span>
              {optionBadge ? <span className="shrink-0">{optionBadge(o)}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      {text.trim() !== "" && !value ? <p className="text-sm text-muted-foreground" role="status">Choose one of the matches to select it. Typing alone selects nothing.</p> : null}
      {footer}
    </div>
  );
}
