"use client";

import { useEffect, useId, useRef, useState } from "react";
import { lookupEmployees, searchItems, type EmployeeOption, type ItemOption } from "@/lib/actions/inventoryPlanning";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/** Runs `fn` 250 ms after the text stops changing; an older answer never replaces a newer one. */
function useTypeAhead<T>(text: string, enabled: boolean, fn: (q: string) => Promise<{ error: string | null; list: T[] }>) {
  const [state, setState] = useState<{ list: T[]; error: string | null; loading: boolean; for: string }>({ list: [], error: null, loading: false, for: "" });
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });
  useEffect(() => {
    const q = text.trim();
    if (!enabled || q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, loading: true }));
      fnRef.current(q)
        .then((r) => { if (!cancelled) setState({ list: r.list, error: r.error, loading: false, for: q }); })
        .catch(() => { if (!cancelled) setState({ list: [], error: "Could not search. Try again.", loading: false, for: q }); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, enabled]);
  const q = text.trim();
  return q.length < 2 ? { list: [] as T[], error: null, loading: false, for: "" } : state;
}

/** Search the catalogue and choose one item. A native list, so the keyboard and a phone both work. Posts `name` (default itemId). */
export function ItemPicker({ companyId, name = "itemId", label = "Item", onPick, hint }: { companyId: string; name?: string; label?: string; onPick?: (item: ItemOption | null) => void; hint?: string }) {
  const id = useId();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<ItemOption | null>(null);
  const res = useTypeAhead<ItemOption>(text, !!companyId && picked === null, async (q) => {
    const r = await searchItems(companyId, q);
    return { error: r.error, list: r.items };
  });
  const choose = (item: ItemOption | null) => { setPicked(item); onPick?.(item); };
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${id}-q`} className="text-sm font-medium leading-none">{label}</label>
      <input type="hidden" name={name} value={picked?.id ?? ""} />
      {picked ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          <span className="min-w-0 break-words"><span className="font-medium">{picked.name}</span>{picked.model ? <span className="text-muted-foreground"> · {picked.model}</span> : null}</span>
          <button type="button" className="text-sm font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => { choose(null); setText(""); }}>Change</button>
        </div>
      ) : (
        <>
          <Input id={`${id}-q`} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type at least 2 letters of the name or model" autoComplete="off" />
          {res.loading ? <p className="text-sm text-muted-foreground" role="status">Searching…</p> : null}
          {res.error ? <p className="text-sm text-destructive" role="alert">{res.error}</p> : null}
          {!res.loading && !res.error && res.for === text.trim() && text.trim().length >= 2 && res.list.length === 0 ? <p className="text-sm text-muted-foreground" role="status">No catalogue item matches “{text.trim()}”.</p> : null}
          {res.list.length > 0 ? (
            <Select aria-label="Matching items" size={Math.min(res.list.length + 1, 6)} className="h-auto" onChange={(e) => { const it = res.list.find((x) => x.id === e.target.value); if (it) choose(it); }} value="">
              <option value="" disabled>Choose one of {res.list.length}</option>
              {res.list.map((i) => <option key={i.id} value={i.id}>{i.name}{i.model ? ` · ${i.model}` : ""}</option>)}
            </Select>
          ) : null}
        </>
      )}
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Search active employees (name or number only) and choose one. Posts employeeId and employeeName. */
export function EmployeePicker({ companyId, onPick }: { companyId: string; onPick?: (p: EmployeeOption | null) => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<EmployeeOption | null>(null);
  const res = useTypeAhead<EmployeeOption>(text, !!companyId && picked === null, async (q) => {
    const r = await lookupEmployees(companyId, q);
    return { error: r.error, list: r.people };
  });
  const choose = (p: EmployeeOption | null) => { setPicked(p); onPick?.(p); };
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${id}-q`} className="text-sm font-medium leading-none">Employee</label>
      <input type="hidden" name="employeeId" value={picked?.id ?? ""} />
      <input type="hidden" name="employeeName" value={picked?.name ?? ""} />
      {picked ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm">
          <span className="min-w-0 break-words"><span className="font-medium">{picked.name}</span><span className="text-muted-foreground"> · {picked.number}{picked.department ? ` · ${picked.department}` : ""}</span></span>
          <button type="button" className="text-sm font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => { choose(null); setText(""); }}>Change</button>
        </div>
      ) : (
        <>
          <Input id={`${id}-q`} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Name or employee number" autoComplete="off" />
          {res.loading ? <p className="text-sm text-muted-foreground" role="status">Searching…</p> : null}
          {res.error ? <p className="text-sm text-destructive" role="alert">{res.error}</p> : null}
          {!res.loading && !res.error && res.for === text.trim() && text.trim().length >= 2 && res.list.length === 0 ? <p className="text-sm text-muted-foreground" role="status">No active employee matches “{text.trim()}”.</p> : null}
          {res.list.length > 0 ? (
            <Select aria-label="Matching employees" size={Math.min(res.list.length + 1, 6)} className="h-auto" onChange={(e) => { const p = res.list.find((x) => x.id === e.target.value); if (p) choose(p); }} value="">
              <option value="" disabled>Choose one of {res.list.length}</option>
              {res.list.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.number}{p.department ? ` · ${p.department}` : ""}</option>)}
            </Select>
          ) : null}
        </>
      )}
    </div>
  );
}
