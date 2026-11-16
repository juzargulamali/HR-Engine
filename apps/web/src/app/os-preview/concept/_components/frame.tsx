"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, Boxes, Briefcase, Building2, Check, ChevronDown, FolderKanban, Home, Info, Users, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { PEOPLE, PERSONAS, projectById } from "../_lib/sample";
import { useConcept } from "../_lib/store";
import { Avatar } from "./bits";

const CHIP = "Design concept: sample data";
const NAV = [
  { label: "My Day", href: "/os-preview/my-day", Icon: Home },
  { label: "Sales & CRM", href: "/os-preview/sales", Icon: Briefcase },
  { label: "Projects", href: "/os-preview/concept", Icon: FolderKanban },
  { label: "Inventory", href: "/os-preview/inventory", Icon: Boxes },
  { label: "People & HR", href: "/os-preview/people", Icon: Users },
] as const;

/**
 * The concept's own frame, after the approved renders: a dark sidebar with the logo, the module list and the workspace, and a top bar
 * with where you are. Only Projects is part of the concept; the other items open the existing design-preview pages of those modules.
 * The sidebar and top bar stay dark in the light theme too.
 */
export function Frame({ children }: { children: React.ReactNode }) {
  const { href, persona, listQuery } = useConcept();
  const pathname = usePathname();
  const listHref = `/os-preview/concept${listQuery ? `?${listQuery}` : persona.id !== "pm" ? `?as=${persona.id}` : ""}`;
  const projectId = /\/concept\/([^/?]+)/.exec(pathname)?.[1];
  const project = projectId ? projectById(projectId) : null;
  const company = persona.companies.length > 1 ? "Enginious · UAE and KSA" : "Enginious · UAE";
  const me = personaName(persona);
  return (
    <div className="cx-root">
      <a href="#cx-main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-raised focus:px-3 focus:py-2 focus:text-sm">Skip to content</a>
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="cx-chrome cx-sidebar sticky top-0 hidden h-screen flex-col lg:flex" aria-label="Modules">
          <div className="px-4 pb-4 pt-5">
            {/* The logo exactly as supplied (464 × 289), unchanged, on a light plate so its dark-teal lettering stays legible on the dark sidebar. */}
            <Link href={href("/os-preview/concept")} aria-label="ENGINIOUS, home of this concept" className="flex justify-center rounded-xl bg-[#f3f8f9] px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Image src="/brand/enginious-logo.png" alt="Enginious: Driven by Innovation" width={464} height={289} priority style={{ height: 58, width: "auto" }} />
            </Link>
          </div>
          <nav className="flex flex-1 flex-col gap-2 px-3 pt-3">
            {NAV.map(({ label, href: to, Icon }) => {
              const active = label === "Projects";
              return (
                <Link key={label} href={active ? href(to) : to} className="cx-nav-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-current={active ? "page" : undefined}>
                  <Icon className="h-[1.15rem] w-[1.15rem] flex-none" aria-hidden /> {label}
                </Link>
              );
            })}
          </nav>
          <div className="space-y-3 px-3 pb-4">
            <div>
              <p className="px-1 pb-1 text-[13px] text-muted-foreground">Workspace</p>
              <p className="flex items-center gap-2 rounded-lg border border-border bg-field px-3 py-2.5 text-sm"><Building2 className="h-4 w-4 flex-none text-muted-foreground" aria-hidden />{company}</p>
            </div>
            <div className="flex items-center gap-2.5 border-t border-border pt-3">
              <Avatar name={me} size="lg" />
              <div className="min-w-0 leading-tight"><p className="truncate text-sm font-semibold">{me}</p><p className="truncate text-[13px] text-muted-foreground">{personaRole(persona)}</p></div>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="cx-chrome cx-topbar sticky top-0 z-40 flex h-12 items-center gap-3 px-4 sm:px-6 lg:z-50 lg:h-16">
            <Link href={href("/os-preview/concept")} className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden">
              {/* The mark from the logo files, unchanged: only its height is set. */}
              <Image src="/brand/enginious-icon.png" alt="" width={147} height={105} priority style={{ height: 30, width: "auto" }} className="flex-none" />
              <span className="truncate font-heading text-sm font-bold tracking-tight">ENGINIOUS OS</span>
            </Link>
            <span className="hidden font-heading text-[13px] font-semibold tracking-[0.2em] text-muted-foreground lg:inline">ENGINIOUS OS</span>
            <span aria-hidden className="hidden h-5 w-px bg-border lg:block" />
            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-2 text-sm lg:flex">
              <Link href={listHref} className="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Projects</Link>
              {project ? <><span aria-hidden className="text-muted-foreground">/</span><span aria-current="page" className="truncate font-medium">{project.name.split(":")[0]}</span></> : null}
            </nav>
            <span className="cx-badge ml-2 hidden xl:inline-flex" data-tone="blue">{CHIP}</span>
            <div className="ml-auto"><PreviewOptions name={me} /></div>
          </header>
          <aside aria-label="Concept notice" className="border-b border-border/60 bg-background/80 px-4 py-1 text-xs font-semibold text-foreground sm:px-6 xl:hidden">
            {CHIP}
          </aside>
          <main id="cx-main" tabIndex={-1} className="outline-none">{children}</main>
        </div>
      </div>
      <ToastRegion />
    </div>
  );
}

const ROLE: Record<string, string> = { pm: "Project Manager", founder: "Founder", head: "Head of Programming", member: "Programmer", directory: "Directory only" };
const personaRole = (p: { kind: string }) => ROLE[p.kind] ?? "";
const personaName = (p: { personId: string | null; kind: string }) => (p.personId ? PEOPLE.find((x) => x.id === p.personId)?.name : null) ?? "Colleague";

function PreviewOptions({ name }: { name: string }) {
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
        <Avatar name={name} size="sm" /> <span className="hidden sm:inline">Preview options</span><span className="sm:hidden sr-only">Preview options</span> <ChevronDown className="h-3.5 w-3.5" aria-hidden />
      </Button>
      {open ? (
        <div id={panelId} role="group" aria-label="Preview options" className="absolute right-0 top-full z-[60] mt-2 w-[min(22rem,calc(100vw-2rem))] space-y-4 rounded-xl border border-border bg-raised p-4 text-sm shadow-[var(--shadow-pop)]">
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
