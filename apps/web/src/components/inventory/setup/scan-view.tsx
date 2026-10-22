"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ListPlus, Trash2 } from "lucide-react";
import type { PendingScanLine } from "@enginious-hr/domain";
import { resolveInventoryCode } from "@/lib/actions/inventorySetup";
import { pendingActionHref, PENDING_ACTIONS, removeFromPending, scanIntoList, scanProblemMessage, UNAVAILABLE_CODE_MESSAGE } from "@/lib/inventory/scan-list";
import type { ScanResolution } from "@/lib/inventory/scan-lookup";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { QrScanner } from "@/components/inventory/qr-scanner";

export interface ScanNotice { raw: string; resolution: Exclude<ScanResolution, { status: "found" }> }
type Shown = { raw: string; resolution: ScanResolution };

function Notice({ resolution }: { resolution: Exclude<ScanResolution, { status: "found" }> }) {
  if (resolution.status === "unavailable") return <Alert variant="warning" role="status">{UNAVAILABLE_CODE_MESSAGE}</Alert>;
  if (resolution.status === "not_inventory") return <Alert variant="warning" role="status">{scanProblemMessage(resolution.problem)}</Alert>;
  return <Alert variant="destructive" role="alert">The code could not be looked up just now. Try again in a moment.</Alert>;
}

/**
 * The scan page. A scan only NAMES a record: it is looked up (read only, through what the person is allowed to see), shown, and can be
 * opened or put on a pending list. The list lives in this page only (never stored): leaving or reloading clears it. Nothing here changes stock;
 * Issue / Return / Transfer continue to their own forms with the codes in the address.
 */
export function ScanView({ initial }: { initial?: ScanNotice | null }) {
  const [shown, setShown] = useState<Shown | null>(initial ? { raw: initial.raw, resolution: initial.resolution } : null);
  const [list, setList] = useState<PendingScanLine[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [resolving, setResolving] = useState(false);
  const [listNote, setListNote] = useState<string | null>(null);
  const latest = useRef(0);

  const handleRead = useCallback(async (raw: string) => {
    const mine = ++latest.current;
    setListNote(null);
    setResolving(true);
    let resolution: ScanResolution;
    try { resolution = await resolveInventoryCode(raw); } catch { resolution = { status: "error" }; }
    if (mine !== latest.current) return;
    setResolving(false);
    setShown({ raw, resolution });
  }, []);

  function addToList(code: string, itemName: string) {
    const r = scanIntoList(list, code);
    setList(r.list);
    if (r.added) { setNames((n) => ({ ...n, [code]: itemName })); setListNote(`${code} added to the list.`); }
    else setListNote(`${code} is already on the list: it is listed once.`);
  }

  const found = shown?.resolution.status === "found" ? shown.resolution : null;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-4">
        <Card className="p-4"><QrScanner onRead={(raw) => void handleRead(raw)} /></Card>
        <div aria-live="polite" className="space-y-3">
          {resolving ? <p role="status" className="text-sm text-muted-foreground">Looking it up…</p> : null}
          {!resolving && shown && shown.resolution.status !== "found" ? <Notice resolution={shown.resolution} /> : null}
          {!resolving && found ? (
            <Card className="space-y-3 p-4" aria-label={`Scanned ${found.code}`}>
              <div className="min-w-0">
                <p className="break-words text-base font-semibold">{found.itemName}</p>
                <p className="font-mono text-sm">{found.code}</p>
                <p className="mt-1 flex flex-wrap gap-1.5">{found.facts.map((f) => <Badge key={f} variant="outline">{f}</Badge>)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={found.openHref} className={buttonVariants({ variant: "default" })}>Open</Link>
                <Button type="button" variant="outline" onClick={() => addToList(found.code, found.itemName)}><ListPlus className="h-4 w-4" aria-hidden /> Add to a list</Button>
              </div>
              <p className="text-sm text-muted-foreground">Scanning only finds the record. It never changes any stock.</p>
            </Card>
          ) : null}
        </div>
      </div>

      <aside aria-labelledby="scan-list-title" className="space-y-3">
        <Card className="space-y-3 p-4">
          <div className="flex items-baseline justify-between gap-2"><h2 id="scan-list-title" className="text-sm font-semibold">Your list ({list.length})</h2>{list.length > 0 ? <Button type="button" size="sm" variant="ghost" onClick={() => { setList([]); setListNote(null); }}>Clear</Button> : null}</div>
          <p className="text-sm text-muted-foreground">Scan or type several codes and add them here, then continue to one form for all of them. The list is kept on this page only: leaving or reloading clears it. One unit is listed once, however often it is scanned.</p>
          {listNote ? <p role="status" className="text-sm">{listNote}</p> : null}
          {list.length === 0 ? <p className="text-sm text-muted-foreground">Nothing on the list yet.</p> : (
            <ul className="divide-y divide-border rounded-md border border-border" aria-label="Scanned codes">
              {list.map((l) => (
                <li key={l.code} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0"><p className="font-mono text-sm">{l.code}</p><p className="truncate text-sm text-muted-foreground">{names[l.code] ?? ""}{l.kind === "stock" ? " (item in a bin)" : ""}</p></div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setList((x) => removeFromPending(x, l.code))}><Trash2 className="h-4 w-4" aria-hidden /><span className="sr-only">{`Remove ${l.code}`}</span></Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-col gap-2">
            {PENDING_ACTIONS.map((a) => (
              list.length === 0
                ? <span key={a.action} aria-disabled="true" className={cn(buttonVariants({ variant: "outline" }), "pointer-events-none opacity-50")}>{a.label}</span>
                : <Link key={a.action} href={pendingActionHref(a.action, list)} className={buttonVariants({ variant: a.action === "issue" ? "default" : "outline" })} title={a.help}>{a.label}</Link>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">Each button opens the matching form with these codes filled in. You check and confirm there: nothing is recorded from this page.</p>
        </Card>
      </aside>
    </div>
  );
}
