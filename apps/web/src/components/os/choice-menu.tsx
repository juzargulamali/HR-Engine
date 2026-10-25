"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { dotTone, OsAvatar, type OsTone } from "./pills";

export interface OsChoice { value: string; label: string; tone?: OsTone; avatar?: string; short?: string; disabled?: boolean; hint?: string }

/**
 * A value that is changed by clicking it: the current value is a pill (or a person), a click lists the choices (a tick on the current one
 * and the reason beside any that cannot be chosen), and the choice is saved at once through `onSave`. While it saves the pill says
 * "Saving…"; if the save is refused or fails the old value stays and the reason is written under it. Enter opens, arrows move, Escape closes.
 * `onSave` does the real work (a server action); this component never decides anything itself.
 */
export function OsChoiceMenu({ label, value, choices, onSave, align = "start", pill = true, disabled }: {
  label: string; value: string; choices: readonly OsChoice[]; onSave: (next: string) => Promise<{ error: string | null }>; align?: "start" | "end"; pill?: boolean; disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = choices.find((c) => c.value === value) ?? choices[0]!;
  return (
    <div className="min-w-0">
      <DropdownMenu
        align={align}
        keyboardNav
        trigger={({ open, toggle }) => (
          <button
            type="button" aria-haspopup="menu" aria-expanded={open} aria-busy={pending} disabled={pending || disabled} onClick={toggle}
            aria-label={`${label}: ${current.label}. Change`}
            className={`${pill ? "os-pill" : "inline-flex max-w-full items-center gap-2 rounded-full border border-transparent py-0.5 pr-2 hover:border-input"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            data-tone={current.tone ?? "neutral"}
          >
            {pending ? <span className="text-muted-foreground">Saving…</span> : (
              <>
                {current.avatar ? <OsAvatar name={current.avatar} size="sm" /> : <span className="os-dot" data-tone={dotTone(current.tone ?? "neutral")} aria-hidden />}
                <span className="truncate" title={current.label}>{current.short ?? current.label}</span>
                <ChevronDown className="h-3.5 w-3.5 flex-none text-muted-foreground" aria-hidden />
              </>
            )}
          </button>
        )}
      >
        {({ close }) => (
          <ul role="none" className="min-w-[12rem]">
            <li role="none" className="px-2.5 pb-1 pt-0.5 text-[13px] font-semibold text-muted-foreground">{label}</li>
            {choices.map((c) => (
              <li role="none" key={c.value}>
                <button
                  type="button" role="menuitem" disabled={c.disabled} aria-current={c.value === value ? "true" : undefined}
                  onClick={async () => {
                    close();
                    if (c.value === value) return;
                    setPending(true); setError(null);
                    const r = await onSave(c.value);
                    setPending(false);
                    if (r.error) setError(r.error);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-secondary/70 focus-visible:bg-secondary/70 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {c.avatar ? <OsAvatar name={c.avatar} size="sm" /> : <span className="os-dot" data-tone={dotTone(c.tone ?? "neutral")} aria-hidden />}
                  <span className="min-w-0 flex-1"><span className="block truncate">{c.label}</span>{c.hint ? <span className="block whitespace-normal text-[13px] leading-snug text-muted-foreground">{c.hint}</span> : null}</span>
                  {c.value === value ? <Check className="h-4 w-4 flex-none text-accent" aria-hidden /> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenu>
      {error ? <p role="alert" className="mt-1 whitespace-normal text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}
