"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, Check, Info, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PERSONAS } from "../_lib/sample";
import { useConcept } from "../_lib/store";

const CHIP = "Design concept: sample data";

/**
 * The concept's own, simpler frame: the logo, the product name, where you are, and one "Preview options" control. The real navigation
 * of the app is not drawn here, so there is nothing to click that goes nowhere. The circuit drawing lives behind this bar only.
 */
export function Frame({ children }: { children: React.ReactNode }) {
  const { href } = useConcept();
  return (
    <div className="cx-root">
      <a href="#cx-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-sm">Skip to content</a>
      <header className="cx-topbar sticky top-0 z-40 flex lg:z-50 h-[53px] items-center gap-3 border-b border-border px-4 sm:px-6">
        <Link href={href("/os-preview/concept")} className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {/* The logo mark exactly as supplied (147 × 105): only its height is set, so it is never stretched or recoloured. */}
          <Image src="/brand/enginious-icon.png" alt="" width={147} height={105} priority style={{ height: 30, width: "auto" }} className="flex-none" />
          <span className="truncate font-heading text-sm font-bold tracking-tight">ENGINIOUS OS</span>
        </Link>
        <span aria-hidden className="hidden h-5 w-px bg-border sm:block" />
        <span className="hidden text-sm text-muted-foreground sm:inline">Projects &amp; Tasks</span>
        <span className="cx-badge ml-1 hidden lg:inline-flex" data-tone="blue">{CHIP}</span>
        <div className="ml-auto"><PreviewOptions /></div>
      </header>
      <aside aria-label="Concept notice" className="border-b border-border/60 bg-background/80 px-4 py-1.5 text-[13px] text-muted-foreground sm:px-6 lg:hidden">
        <span className="font-semibold text-foreground">{CHIP}.</span> Nothing is saved or sent.
      </aside>
      <main id="cx-main" tabIndex={-1} className="outline-none">{children}</main>
      <ToastRegion />
    </div>
  );
}

function PreviewOptions() {
  const { persona, setPersona, failNext, setFailNext, forced, setForced, resetSample, notify } = useConcept();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const boxRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Capture phase: this runs before the side panel's own Escape handler, so Escape closes this popover first and only that.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey, true); document.removeEventListener("mousedown", onDown); };
  }, [open]);

  const chooseTheme = (t: "dark" | "light") => {
    setTheme(t);
    if (t === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
  };

  return (
    <div ref={boxRef} className="relative">
      <Button ref={btnRef} type="button" variant="outline" size="sm" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => { setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"); setOpen((o) => !o); }}>
        <SlidersHorizontal className="h-4 w-4" aria-hidden /> <span>Preview options</span>
      </Button>
      {open ? (
        <div id={panelId} role="group" aria-label="Preview options" className="absolute right-0 top-full z-[60] mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-4 rounded-lg border border-border bg-raised p-4 text-sm shadow-[var(--shadow-pop)]">
          <div>
            <label htmlFor={`${panelId}-as`} className="mb-1 block font-semibold">Preview as</label>
            <Select id={`${panelId}-as`} value={persona.id} onChange={(e) => setPersona(e.target.value)}>
              {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
            <p className="mt-1.5 text-[13px] text-muted-foreground">Changes only what the sample offers. No real access is involved.</p>
          </div>
          <div>
            <p className="mb-1 font-semibold" id={`${panelId}-theme`}>Theme <span className="font-normal text-muted-foreground">(this visit only)</span></p>
            <div role="group" aria-labelledby={`${panelId}-theme`} className="inline-flex gap-0.5 rounded-md border border-border bg-secondary/50 p-0.5">
              {(["dark", "light"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={theme === t} onClick={() => chooseTheme(t)} className={`h-8 rounded-[5px] px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${theme === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                  {t === "dark" ? "Dark" : "Light"}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={failNext} onChange={(e) => setFailNext(e.target.checked)} className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" />
            <span><span className="font-semibold">Make the next save fail</span><span className="block text-[13px] text-muted-foreground">To see what a failed save looks like, once.</span></span>
          </label>
          <div>
            <label htmlFor={`${panelId}-state`} className="mb-1 block font-semibold">Show a state</label>
            <Select id={`${panelId}-state`} value={forced} onChange={(e) => setForced(e.target.value as "none" | "loading" | "error")}>
              <option value="none">Normal</option>
              <option value="loading">Loading</option>
              <option value="error">Could not load</option>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-[13px] text-muted-foreground">Changes stay in this tab and reset on reload.</p>
            <Button type="button" size="sm" variant="secondary" onClick={() => { resetSample(); notify("info", "Sample data reset."); }}>Reset sample</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToastRegion() {
  const { toast, dismissToast } = useConcept();
  const Icon = toast?.tone === "saved" ? Check : toast?.tone === "error" ? AlertTriangle : Info;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] sm:inset-x-6 sm:bottom-5 sm:right-auto sm:max-w-md">
      {toast ? (
        <div className="cx-toast pointer-events-auto flex items-start gap-3 rounded-lg border border-border bg-raised px-3.5 py-3 text-sm shadow-[var(--shadow-pop)]" data-tone={toast.tone}>
          {toast.tone === "saving" ? (
            <span aria-hidden className="cx-saving-dot mt-1.5 h-2.5 w-2.5 flex-none rounded-full bg-primary" />
          ) : (
            <Icon aria-hidden className={`mt-0.5 h-4 w-4 flex-none ${toast.tone === "error" ? "text-destructive" : toast.tone === "saved" ? "text-accent" : "text-[hsl(var(--cx-info))]"}`} />
          )}
          <p className="min-w-0 flex-1 break-words">{toast.text}</p>
          {toast.tone === "error" && toast.retry ? <Button type="button" size="sm" variant="outline" onClick={toast.retry}>Try again</Button> : null}
          {toast.tone !== "saving" ? (
            <button type="button" onClick={dismissToast} aria-label="Dismiss message" className="rounded-md p-1 text-muted-foreground hover:bg-secondary/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <X className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
