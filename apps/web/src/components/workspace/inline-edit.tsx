"use client";

import { useId, useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export type InlineResult = { error: string | null };

/**
 * A value that can be changed in place, for the fields where that is safe and obvious (a status, an assignee, a date). It saves
 * as soon as a new value is chosen, shows "Saving…" while it waits, and puts the old value back with the reason if the save is
 * refused: it never shows a new value as saved before the server has said so. Use it only where the person already has the right to
 * make that change; for anything that needs a reason or a second person, open a small form instead.
 */
export function InlineSelect({ value, options, label, onSave, disabled, className }: { value: string; options: readonly { value: string; label: string; disabled?: boolean }[]; label: string; onSave: (next: string) => Promise<InlineResult>; disabled?: boolean; className?: string }) {
  const id = useId();
  const [shown, setShown] = useState(value);
  const [seen, setSeen] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (value !== seen) {
    setSeen(value);
    setShown(value);
  }
  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <Select
        id={id}
        value={shown}
        disabled={disabled || pending}
        aria-busy={pending}
        aria-invalid={error ? true : undefined}
        className="h-8 min-w-[7.5rem] py-0 text-[13px]"
        onChange={(e) => {
          const next = e.target.value;
          setShown(next);
          setError(null);
          start(async () => {
            let r: InlineResult;
            try { r = await onSave(next); } catch { r = { error: "The change could not be saved. Check your connection and try again." }; }
            if (r.error) { setShown(value); setError(r.error); }
          });
        }}
      >
        {options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
      </Select>
      {pending ? <p className="mt-0.5 text-[13px] text-muted-foreground" role="status">Saving…</p> : null}
      {error ? <p role="alert" className="mt-0.5 text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}

/** A date that is saved when the field is left (or Enter is pressed) with a new, complete date. Escape puts the old date back. */
export function InlineDate({ value, label, onSave, disabled, min, className }: { value: string | null; label: string; onSave: (next: string | null) => Promise<InlineResult>; disabled?: boolean; min?: string; className?: string }) {
  const id = useId();
  const [shown, setShown] = useState(value ?? "");
  const [seen, setSeen] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if ((value ?? "") !== seen) {
    setSeen(value ?? "");
    setShown(value ?? "");
  }
  const commit = () => {
    const next = shown === "" ? null : shown;
    if ((next ?? "") === (value ?? "")) return;
    setError(null);
    start(async () => {
      let r: InlineResult;
      try { r = await onSave(next); } catch { r = { error: "The date could not be saved. Check your connection and try again." }; }
      if (r.error) { setShown(value ?? ""); setError(r.error); }
    });
  };
  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <Input
        id={id}
        type="date"
        value={shown}
        min={min}
        disabled={disabled || pending}
        aria-invalid={error ? true : undefined}
        className="h-8 w-[9.5rem] px-2 text-[13px]"
        onChange={(e) => setShown(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { setShown(value ?? ""); setError(null); }
        }}
      />
      {pending ? <p className="mt-0.5 text-[13px] text-muted-foreground" role="status">Saving…</p> : null}
      {error ? <p role="alert" className="mt-0.5 text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}
