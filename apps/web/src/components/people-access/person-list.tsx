import Link from "next/link";
import { ACCESS_MODULE_LABELS, ROLE_LABELS } from "@enginious-hr/domain";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { PaCompany, PaPerson } from "@/lib/people-access/data";
import { paHref, type PaParams } from "./links";

/** The left column: search, a company filter, and everyone this viewer is entitled to see. A plain GET form, so it works before any script loads. */
export function PersonList({ people, total, companies, params, companyNames, showRoles }: {
  people: PaPerson[]; total: number; companies: PaCompany[]; params: PaParams; companyNames: Map<string, string>; showRoles: boolean;
}) {
  return (
    <div className="space-y-3">
      <form method="get" action="/people-access" className="space-y-2" role="search" aria-label="Find a person">
        <label htmlFor="pa-q" className="sr-only">Search by name{showRoles ? ", email" : ""} or job title</label>
        <Input id="pa-q" name="q" type="search" defaultValue={params.q ?? ""} placeholder={showRoles ? "Search name, email or job title" : "Search name or job title"} autoComplete="off" />
        {companies.length > 1 ? (
          <>
            <label htmlFor="pa-company" className="sr-only">Company</label>
            <Select id="pa-company" name="company" defaultValue={params.company ?? ""}>
              <option value="">All my companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <Button type="submit" size="sm" variant="outline">Search</Button>
          <p className="text-sm text-muted-foreground" role="status">{people.length === total ? `${total} ${total === 1 ? "person" : "people"}` : `${people.length} of ${total}`}</p>
        </div>
      </form>
      {people.length === 0 ? <p className="text-sm text-muted-foreground">No one matches. Try fewer words.</p> : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {people.map((p) => {
            const selected = params.person === p.key;
            const company = p.employeeCompanyId ? companyNames.get(p.employeeCompanyId) : null;
            return (
              <li key={p.key}>
                <Link href={paHref({ ...params, person: p.key, tab: undefined })} aria-current={selected ? "true" : undefined}
                  className={`block space-y-1 px-3 py-2.5 text-sm hover:bg-muted/50 ${selected ? "bg-muted/60" : ""}`}>
                  <span className="block break-words font-medium">{p.name}</span>
                  {p.email ? <span className="block break-all text-muted-foreground">{p.email}</span> : null}
                  {p.jobTitle || company ? <span className="block text-muted-foreground">{[p.jobTitle, company].filter(Boolean).join(" · ")}</span> : null}
                  <span className="flex flex-wrap gap-1">
                    {p.accountStatus && p.accountStatus !== "active" ? <Badge variant={p.accountStatus === "deactivated" ? "destructive" : "secondary"}>{p.accountStatus === "invited" ? "Invited" : "Deactivated"}</Badge> : null}
                    {p.userId === null ? <Badge variant="outline">No login yet</Badge> : null}
                    {showRoles ? [...new Set(p.roles.map((r) => r.role))].map((r) => <Badge key={r} variant="secondary">{ROLE_LABELS[r]}</Badge>) : null}
                    {[...new Set(p.grants.map((g) => g.module))].map((m) => <Badge key={m} variant="outline">{ACCESS_MODULE_LABELS[m]}</Badge>)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
