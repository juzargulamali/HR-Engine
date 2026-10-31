"use client";

import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Lock, MapPin, ScanLine, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { LOCATIONS, SCAN_CODES, locName, type LocId } from "../_lib/inventory-concept";
import { PLink, usePreview } from "./context";
import { Chip, PageHeader, Sheet, useNotice } from "./ui";

/** Which warehouse the operator is working in. Lives in the address (?loc=) in the concept; the real screen would remember it for the person. */
export function useLoc() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const loc: LocId = sp.get("loc") === "auh" ? "auh" : "dxb";
  const single = sp.get("single") === "1";
  const setLoc = (l: LocId) => {
    const q = new URLSearchParams(sp.toString());
    q.set("loc", l);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };
  return { loc, single, setLoc };
}

const NoticeCtx = createContext<(m: string) => void>(() => {});
export const useConceptNotice = () => useContext(NoticeCtx);

/** A tag for an interaction the existing backend cannot do yet. Interactions that work today carry no tag. */
export function NeedsBackend({ children = "Needs a backend change" }: { children?: React.ReactNode }) {
  return <Chip tone="warn">{children}</Chip>;
}

/** What the person is working in, and where to switch. One location is a plain label; several are a switcher. */
function WarehouseBar({ onScan }: { onScan: () => void }) {
  const { loc, single, setLoc } = useLoc();
  return (
    <div className="mb-3 flex flex-col gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 sm:mb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <MapPin className="h-4 w-4 flex-none text-[hsl(var(--os-link))]" aria-hidden />
        <span className="text-sm text-muted-foreground">You are working in</span>
        {single ? (
          <strong className="text-sm" data-testid="warehouse-label">{locName(loc)}</strong>
        ) : (
          <>
            <label htmlFor="warehouse-switch" className="sr-only">Warehouse</label>
            <Select id="warehouse-switch" value={loc} onChange={(e) => setLoc(e.target.value as LocId)} className="h-10 w-full min-w-[14rem] font-semibold sm:h-9 sm:w-auto">
              {LOCATIONS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <span className="hidden text-xs text-muted-foreground sm:inline">You are set up at both warehouses</span>
          </>
        )}
      </div>
      <Button type="button" onClick={onScan} className="h-11 w-full text-base sm:h-9 sm:w-auto sm:text-sm"><ScanLine className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden />Scan a label</Button>
    </div>
  );
}

const SECTIONS = [
  { id: "today", label: "Today", href: "/os-preview/inventory" },
  { id: "stock", label: "Stock", href: "/os-preview/inventory/stock" },
  { id: "history", label: "History", href: "/os-preview/inventory/history" },
] as const;
export type Section = "today" | "stock" | "history" | "manage" | "project";

/** The three warehouse sections, with Manage kept apart. Every page of the inventory concept sits inside this frame. */
export function InventoryFrame({ section, title, description, actions, children }: { section: Section; title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const { href } = usePreview();
  const { loc } = useLoc();
  const sp = useSearchParams();
  const extra: Record<string, string> = { loc };
  if (sp.get("single") === "1") extra.single = "1";
  const { notify, node } = useNotice();
  const [scan, setScan] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  // These pages are drawn for the warehouse operator: open them as that preview persona unless a role was chosen.
  useEffect(() => {
    if (sp.get("role")) return;
    const q = new URLSearchParams(sp.toString());
    q.set("role", "warehouse");
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }, [sp, router, pathname]);
  return (
    <NoticeCtx.Provider value={notify}>
      <div role="note" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm sm:mb-4 sm:py-2">
        <strong>Concept</strong><span className="text-muted-foreground">fictional data · nothing is saved or sent</span>
        <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"><NeedsBackend>Needs a backend change</NeedsBackend> marks anything the existing backend cannot do yet</span>
      </div>
      <WarehouseBar onScan={() => setScan(true)} />
      <nav aria-label="Inventory sections" className="mb-5 flex flex-wrap items-center gap-1 border-b border-border lg:hidden">
        {SECTIONS.map((s) => (
          <Link
            key={s.id} href={href(s.href, extra)} aria-current={section === s.id ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", section === s.id ? "border-accent font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground")}
          >{s.label}</Link>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <Link
          href={href("/os-preview/inventory/manage", extra)} aria-current={section === "manage" ? "page" : undefined}
          className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", section === "manage" ? "border-accent font-semibold text-foreground" : "border-transparent font-medium text-muted-foreground hover:text-foreground")}
        ><Settings2 className="h-3.5 w-3.5" aria-hidden />Manage</Link>
      </nav>
      <PageHeader eyebrow="Inventory" title={title} description={description} actions={actions} />
      {children}
      <ScanSheet open={scan} onClose={() => setScan(false)} />
      {node}
    </NoticeCtx.Provider>
  );
}

/** Scan or type a code. Looking something up never changes stock: actions only appear for what the item's state allows. */
function ScanSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const notify = useConceptNotice();
  const [code, setCode] = useState("");
  const [looked, setLooked] = useState<string | null>(null);
  const hit = looked ? SCAN_CODES[looked.trim().toUpperCase()] : undefined;
  const close = () => { setCode(""); setLooked(null); onClose(); };
  return (
    <Sheet open={open} onClose={close} title="Scan a label">
      <form onSubmit={(e) => { e.preventDefault(); setLooked(code); }} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="scan-code" className="sr-only">Equipment code</label>
          <Input id="scan-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Point the camera, or type a code such as WM-0015" className="h-11 text-base sm:h-9 sm:text-sm" autoComplete="off" />
          <Button type="submit" disabled={!code.trim()} className="h-11 sm:h-9">Find</Button>
        </div>
        <p className="text-xs text-muted-foreground">Scanning only finds the record. Nothing changes until you confirm an action.</p>
      </form>
      {looked !== null ? (
        <div className="mt-4 rounded-lg border border-border p-4" aria-live="polite">
          {hit ? (
            <>
              <p className="font-semibold">{hit.name}</p>
              <p className="text-xs text-muted-foreground">{looked.trim().toUpperCase()}</p>
              <p className="mt-1 text-sm">{hit.where}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {hit.state === "shelf" ? (<>
                  <Button size="sm" onClick={() => { notify("Would open Send out with this unit added"); close(); }}>Send out</Button>
                  <Button size="sm" variant="outline" onClick={() => { notify("Would open the equipment record"); close(); }}>Open</Button>
                </>) : null}
                {hit.state === "project" ? (<>
                  <Button size="sm" onClick={() => { notify("Would open Receive back for this project"); close(); }}>Receive back</Button>
                  <Button size="sm" variant="outline" onClick={() => { notify("Would open the equipment record"); close(); }}>Open</Button>
                </>) : null}
                {hit.state === "repair" ? <Button size="sm" variant="outline" onClick={() => { notify("Would open the equipment record"); close(); }}>Open</Button> : null}
              </div>
              {hit.state === "repair" ? <p className="mt-2 text-xs text-muted-foreground">It cannot be sent while it is in repair, so no send action is offered.</p> : null}
            </>
          ) : (
            <p className="text-sm">This code is not available to you or does not exist. <span className="text-muted-foreground">Try again or type the code under the label.</span></p>
          )}
        </div>
      ) : null}
    </Sheet>
  );
}

/** Reads "Needs a permission" text for the Manage area. */
export function PermissionNote({ children }: { children: React.ReactNode }) {
  return <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3 w-3 flex-none" aria-hidden />{children}</p>;
}

export { PLink };
