"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startInventoryCount } from "@/lib/actions/inventorySetup";
import { COUNT_KIND_WORDS, type CountKind } from "@/lib/inventory/setup";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionForm, Field } from "@/components/sales/action-form";
import { formatDateTime } from "@/components/sales/format";
import { PanelLink } from "@/components/workspace/panel-link";
import { withParams } from "@/components/workspace/url-state";

export interface CountRow {
  id: string; code: string; kind: CountKind; status: "open" | "confirmed" | "cancelled"; locationName: string; lines: number;
  startedByName: string; startedAt: string; confirmedByName: string | null; confirmedAt: string | null;
}

const STATUS_WORDS = { open: "Open", confirmed: "Confirmed", cancelled: "Cancelled" } as const;

/** Opening and cycle counts of one company: the open ones first, then the history. A count opens in the side panel. */
export function CountsSection({ companyId, rows, startable, showAll, canSeeCounts }: { companyId: string; rows: readonly CountRow[]; startable: readonly { id: string; name: string }[]; showAll: boolean; canSeeCounts: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [starting, setStarting] = useState(false);
  const [kind, setKind] = useState<CountKind>("opening");
  const shown = showAll ? rows : rows.filter((r) => r.status === "open");
  const href = (id: string) => `${withParams(pathname, sp, { count: id })}#counts`;
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">Counting is how stock becomes real. An <strong>opening count</strong> brings units and quantities in for the first time; a <strong>cycle count</strong> re-checks a place later and records any difference as a correction with a reason. Nothing counts as stock until a person allowed to confirm stock confirms it, and their name and the time are kept.</p>
      {startable.length > 0 ? <Button type="button" size="sm" onClick={() => setStarting(true)}>Start a count</Button> : <p className="text-sm text-muted-foreground">Counts are started by a founder or a warehouse operator at that location.</p>}
      {!canSeeCounts ? <Alert role="status">You do not have stock access, so existing counts are not shown to you.</Alert> : shown.length === 0 ? (
        <EmptyState dense title={showAll ? "No counts yet." : "No open counts."} description={startable.length > 0 ? "Start a count for a location when you are ready to count its stock." : undefined} />
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Count</TableHead><TableHead>Place</TableHead><TableHead>Status</TableHead><TableHead>Lines</TableHead><TableHead>Started</TableHead><TableHead>Verified</TableHead></TableRow></TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.id}>
                <TableCell><PanelLink href={href(r.id)} className="font-medium underline-offset-2 hover:underline">{r.code}</PanelLink><span className="block text-sm text-muted-foreground">{COUNT_KIND_WORDS[r.kind].label}</span></TableCell>
                <TableCell>{r.locationName}</TableCell>
                <TableCell><Badge variant={r.status === "open" ? "warning" : r.status === "confirmed" ? "success" : "outline"}>{STATUS_WORDS[r.status]}</Badge></TableCell>
                <TableCell>{r.lines}</TableCell>
                <TableCell>{r.startedByName}<span className="block text-sm text-muted-foreground">{formatDateTime(r.startedAt)}</span></TableCell>
                <TableCell>{r.confirmedAt ? <>{r.confirmedByName ?? "A colleague"}<span className="block text-sm text-muted-foreground">{formatDateTime(r.confirmedAt)}</span></> : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {canSeeCounts && rows.length > 0 ? <Link href={`${withParams(pathname, sp, { counts: showAll ? null : "all" })}#counts`} scroll={false} className="text-sm font-medium underline underline-offset-2">{showAll ? "Show open counts only" : "Show confirmed and cancelled counts too"}</Link> : null}
      <Modal open={starting} onClose={() => setStarting(false)} title="Start a count" description="Choose the place. You add what you counted in the next step.">
        <ActionForm
          action={startInventoryCount} submitLabel="Start the count" pendingLabel="Starting…" secondary={<Button type="button" variant="ghost" onClick={() => setStarting(false)}>Cancel</Button>}
          onDone={(s) => { setStarting(false); if (s.id) router.push(`${withParams(pathname, sp, { count: s.id })}#counts`, { scroll: false }); }}
        >
          <input type="hidden" name="companyId" value={companyId} />
          <Field label="Location" htmlFor="inv-count-loc"><Select id="inv-count-loc" name="locationId" required defaultValue={startable.length === 1 ? startable[0]!.id : ""}><option value="" disabled>Choose a location…</option>{startable.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Kind of count</legend>
            {(Object.keys(COUNT_KIND_WORDS) as CountKind[]).map((k) => (
              <label key={k} className="flex items-start gap-2 text-sm"><input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="mt-0.5" /><span><span className="font-medium">{COUNT_KIND_WORDS[k].label}</span><span className="block text-muted-foreground">{COUNT_KIND_WORDS[k].help}</span></span></label>
            ))}
          </fieldset>
          <Field label="Note (optional)" htmlFor="inv-count-note"><Textarea id="inv-count-note" name="note" rows={2} maxLength={300} /></Field>
        </ActionForm>
      </Modal>
    </div>
  );
}
