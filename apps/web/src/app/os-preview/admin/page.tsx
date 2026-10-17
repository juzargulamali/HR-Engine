"use client";

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { PEOPLE, type PersonId } from "../_lib/data";
import { usePreview } from "../_components/context";
import { Chip, PageHeader, Panel, PermissionDenied, Restriction, useNotice } from "../_components/ui";

const PEOPLE_ROWS: PersonId[] = ["juzar", "rafi", "amira", "daniel", "lena", "priya", "omar", "sofia", "karim", "tariq"];
const CAPS = [{ id: "sales", label: "Sales access" }, { id: "assign", label: "Assign owner" }, { id: "xco", label: "Cross-company overview" }, { id: "cfg", label: "Configure Sales" }] as const;
type CapId = (typeof CAPS)[number]["id"];

const INITIAL: Record<string, CapId[]> = {
  juzar: ["sales", "assign", "xco", "cfg"], rafi: ["sales", "assign", "xco", "cfg"], amira: ["sales"], daniel: ["sales"], lena: ["sales"],
};

export default function Admin() {
  const { roleDef } = usePreview();
  const [grants, setGrants] = useState<Record<string, CapId[]>>(INITIAL);
  const { notify, node } = useNotice();
  if (roleDef.id !== "founder") return <PermissionDenied what="Administration" who="Administration is limited to authorised founders in this preview." />;
  const toggle = (p: string, c: CapId) => {
    setGrants((g) => { const cur = g[p] ?? []; return { ...g, [p]: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] }; });
    notify("Grant change recorded in the audit log");
  };
  return (
    <>
      <PageHeader eyebrow="Administration" title="Module access" description="Who may open Sales & CRM, and who holds the few narrow powers inside it. These are separate from HR roles: HR, Finance and technical-admin roles grant none of them." />
      <div className="mb-5"><Restriction>Having Sales access never grants salary or any confidential HR data. Every grant and revoke is audited with who, when and why.</Restriction></div>
      <Panel flush>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table"><table className="w-full min-w-[40rem] text-sm"><caption className="sr-only">Module access and capability grants (sample)</caption>
          <thead className="border-b border-border bg-secondary/40 text-left text-xs text-muted-foreground"><tr><th scope="col" className="px-4 py-2.5 font-medium">Person</th>{CAPS.map((c) => <th key={c.id} scope="col" className="px-3 py-2.5 font-medium">{c.label}</th>)}</tr></thead>
          <tbody>
            {PEOPLE_ROWS.map((p) => (
              <tr key={p} className="border-b border-border/60 last:border-0">
                <th scope="row" className="px-4 py-2.5 text-left font-medium">{PEOPLE[p].name}<div className="text-xs font-normal text-muted-foreground">{PEOPLE[p].title}</div></th>
                {CAPS.map((c) => (
                  <td key={c.id} className="px-3 py-2.5">
                    <label className="flex items-center gap-2"><input type="checkbox" checked={(grants[p] ?? []).includes(c.id)} onChange={() => toggle(p, c.id)} aria-label={`${c.label} for ${PEOPLE[p].name}`} /><span className="text-xs text-muted-foreground">{(grants[p] ?? []).includes(c.id) ? "Granted" : "No"}</span></label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table></div>
      </Panel>
      <p className="mt-3 text-xs text-muted-foreground">Who may manage these grants (founders only, or also a technical admin) is an open decision. Shown here as founders only. Changes in this preview are not saved.</p>
      <Panel title="Existing administration" description="Unchanged and still in the HR app." className="mt-6">
        <ul className="space-y-2 text-sm">{["Users and roles", "Companies and countries", "Audit log"].map((x) => <li key={x} className="flex items-center gap-3"><span className="flex-1">{x}</span><Chip tone="good">Existing</Chip></li>)}</ul>
        <a href="https://hr-engine-web.vercel.app" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--os-link))] hover:underline">Open the live HR app<ArrowUpRight className="h-3.5 w-3.5" aria-hidden /><span className="sr-only"> (opens in a new tab)</span></a>
      </Panel>
      {node}
    </>
  );
}
