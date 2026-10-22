"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { checkTransaction, type StatusOutcome } from "@/lib/actions/inventoryStock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/**
 * "Check a transaction": paste the key of an entry (shown in the entry's details, or kept by a form that lost its connection) and the
 * database says whether it was recorded. It only asks; it never records or changes anything.
 */
export function CheckTransaction({ companies }: { companies: { id: string; name: string }[] }) {
  const uid = useId();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<StatusOutcome | null>(null);
  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setRes(null);
    try {
      setRes(await checkTransaction(companyId, key.trim()));
    } catch {
      setRes({ error: "The check could not be done right now. Try again in a moment." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={ask} className="space-y-3 rounded-md border border-border p-3" aria-label="Check a transaction">
      <div className="flex flex-wrap items-end gap-3">
        {companies.length > 1 ? (
          <div className="min-w-[10rem]">
            <label htmlFor={`${uid}-co`} className="mb-1 block text-[13px] font-medium text-muted-foreground">Company</label>
            <Select id={`${uid}-co`} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </div>
        ) : null}
        <div className="min-w-[16rem] flex-1">
          <label htmlFor={`${uid}-key`} className="mb-1 block text-[13px] font-medium text-muted-foreground">Transaction key</label>
          <Input id={`${uid}-key`} value={key} onChange={(e) => setKey(e.target.value)} placeholder="For example issue-3f2a…" autoComplete="off" spellCheck={false} maxLength={120} />
        </div>
        <Button type="submit" variant="outline" disabled={busy || key.trim().length < 8}>{busy ? "Checking…" : "Check"}</Button>
      </div>
      <div role="status" aria-live="polite" className="text-sm">
        {res?.error ? <p className="text-destructive">{res.error}</p> : null}
        {res && !res.error ? <p>{res.text}{res.movementId ? <> <Link href={`/inventory/movements?open=${res.movementId}`} className="font-medium underline underline-offset-2">Open the entry</Link></> : null}</p> : null}
      </div>
    </form>
  );
}
