import Link from "next/link";
import { hasInvCapability } from "@enginious-hr/domain";
import { cn } from "@/lib/utils";
import { listTable } from "@/components/workspace/list-table";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListToolbar, type ToolbarFilter } from "@/components/workspace/list-toolbar";
import { LoadError } from "@/components/workspace/states";
import { firstParam, parseRecordId, withParams } from "@/components/workspace/url-state";
import { formatDate } from "@/components/sales/format";
import { getInventoryContext } from "@/lib/inventory/context";
import { filterHoldings, groupOutstanding, leftLabel, type OutstandingLike } from "@/lib/inventory/planning";
import { BALANCE_CONDITION_WORDS, CONDITION_WORDS } from "@/lib/inventory/words";
import { createClient } from "@/lib/supabase/server";
import type { InvBalanceCondition, InvCondition } from "@/types/inventory";

export const metadata = { title: "Equipment held by employees" };

const BASE = "/inventory/employees";
type Params = Record<string, string | string[] | undefined>;
const conditionText = (c: string) => CONDITION_WORDS[c as InvCondition] ?? BALANCE_CONDITION_WORDS[c as InvBalanceCondition] ?? c;

/**
 * Which company equipment each employee holds, for onboarding and exit. For people with employee-custody access, founders and
 * warehouse operators. People who have left keep their outstanding equipment visible with a clear flag. It names the person and the
 * employee number and nothing else about them: no pay, leave or personal data. Nothing is deducted from anyone's pay or settlement.
 */
export default async function EmployeeEquipmentPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const ctx = await getInventoryContext();
  if (!ctx) return null;
  const heading = (
    <div>
      <h1 className="text-2xl font-semibold">Equipment held by employees</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Company equipment that is still with each person. People who have left stay on this list until their equipment is returned. Nothing here is deducted from anyone&apos;s pay or final settlement: it only shows what the company expects back.</p>
    </div>
  );

  const eligible = ctx.companies.filter((c) => hasInvCapability(ctx.grants, c.id, "view_employee_custody") || hasInvCapability(ctx.grants, c.id, "warehouse"));
  if (eligible.length === 0) {
    return (
      <div className="space-y-4">
        {heading}
        <Alert role="status">This list is for founders, warehouse operators and people given employee-custody access. If you need it, ask an Inventory founder.</Alert>
      </div>
    );
  }

  const q = firstParam(sp, "q").slice(0, 100);
  const show = ["left", "overdue"].includes(firstParam(sp, "show")) ? firstParam(sp, "show") : "";
  const company = eligible.some((c) => c.id === firstParam(sp, "company")) ? firstParam(sp, "company") : "";
  const employee = parseRecordId(firstParam(sp, "employee"));
  const here = (patch: Record<string, string | null> = {}) => withParams(BASE, sp, patch);

  const db = await createClient();
  const companies = company ? eligible.filter((c) => c.id === company) : eligible;
  const results = await Promise.all(companies.map(async (c) => ({ c, res: await db.rpc("inv_employee_outstanding", { p_company_id: c.id, p_employee_id: employee, p_include_inactive: true }) })));
  const failed = results.filter((r) => r.res.error && (r.res.error as { code?: string }).code !== "42501");
  const allowed = results.filter((r) => !r.res.error);
  if (failed.length > 0 || allowed.length === 0) {
    if (failed.length > 0) console.error("[inventory] employee outstanding load failed", failed[0]?.res.error?.message);
    return (
      <div className="space-y-4">
        {heading}
        {failed.length > 0 ? <LoadError what="the equipment held by employees" retryHref={here()} /> : <Alert role="status">You may not see what employees hold in {companies.length === 1 ? companies[0]?.name : "these companies"}. The warehouse operators assigned to a location, founders and people given employee-custody access can.</Alert>}
      </div>
    );
  }

  const companyOf = new Map<string, string>();
  const rows: OutstandingLike[] = [];
  for (const { c, res } of allowed) for (const r of res.data ?? []) { rows.push(r); companyOf.set(r.employee_id, c.id); }
  const groups = groupOutstanding(rows);
  const shown = filterHoldings(groups, { q, onlyLeft: show === "left", overdueOnly: show === "overdue" });
  const leftCount = groups.filter((g) => g.left).length;

  const filters: ToolbarFilter[] = [
    { name: "show", label: "Show", value: show, options: [{ value: "", label: "Everyone holding equipment" }, { value: "left", label: "Only people who have left" }, { value: "overdue", label: "Only people with overdue items" }] },
    ...(eligible.length > 1 ? [{ name: "company", label: "Company", value: company, options: [{ value: "", label: "All companies" }, ...eligible.map((c) => ({ value: c.id, label: c.name }))] }] : []),
  ];
  const clearHref = here({ q: null, show: null, company: null });

  return (
    <div className="space-y-4">
      {heading}
      {employee ? (
        <Alert role="status">Showing one employee. <Link href={here({ employee: null })} className="font-medium underline underline-offset-2">Show everyone</Link></Alert>
      ) : null}
      <ListToolbar search={{ value: q, placeholder: "Search name, employee number, item or ID" }} filters={filters} clearHref={clearHref} />
      {groups.length === 0 ? (
        <EmptyState title={employee ? "This employee holds no company equipment" : "No employee holds company equipment"} description="Equipment appears here when the warehouse issues it to a person, and leaves when it is returned." />
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing matches" description="Clear a filter or search for something else." action={<Link href={clearHref} scroll={false} className={buttonVariants({ variant: "outline", size: "sm" })}>Clear filters</Link>} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            {shown.length} of {groups.length} {groups.length === 1 ? "person" : "people"}{shown.length !== groups.length ? " match" : ""}{leftCount > 0 ? `. ${leftCount} ${leftCount === 1 ? "has" : "have"} left and still ${leftCount === 1 ? "holds" : "hold"} equipment` : ""}
          </p>
          <Table className={cn("min-w-[44rem]", listTable)}>
            <caption className="sr-only">Equipment held by employees, one row per person</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Employee</TableHead>
                <TableHead scope="col">Items</TableHead>
                <TableHead scope="col">Since</TableHead>
                <TableHead scope="col">Expected back</TableHead>
                <TableHead scope="col">Overdue</TableHead>
                <TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((g) => (
                <TableRow key={g.employeeId} className="align-top">
                  <TableCell className="min-w-[11rem]">
                    <div className="break-words font-medium">{g.name}</div>
                    <div className="text-sm text-muted-foreground">{g.number}</div>
                    {g.left ? <Badge variant="outline" className="mt-1 whitespace-nowrap border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">{leftLabel(g)}: equipment still out</Badge> : null}
                  </TableCell>
                  <TableCell data-label="Items" className="min-w-[14rem]">
                    <details>
                      <summary className="cursor-pointer select-none font-medium">{g.items.length} {g.items.length === 1 ? "item" : "items"}</summary>
                      <ul className="mt-1.5 space-y-1.5 text-left text-sm">
                        {g.items.map((i, n) => (
                          <li key={`${i.code ?? i.itemName}-${n}`} className="break-words">
                            <span className="font-medium">{i.itemName}</span>{i.kind === "quantity" && i.qty ? <span> × {i.qty}</span> : null}
                            {i.code ? <span className="font-mono text-muted-foreground"> · {i.code}</span> : null}
                            {i.serial ? <span className="text-muted-foreground"> · serial {i.serial}</span> : null}
                            <span className="block text-muted-foreground">
                              {conditionText(i.condition)} · since {formatDate(i.issuedAt)}{i.expectedReturnAt ? ` · back by ${formatDate(i.expectedReturnAt)}` : ""}
                              {i.overdue ? <span className="font-medium text-amber-800 dark:text-amber-300"> · overdue</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </TableCell>
                  <TableCell data-label="Since" className="whitespace-nowrap">{formatDate(g.since)}</TableCell>
                  <TableCell data-label="Expected back" className="whitespace-nowrap">{g.nextReturn ? formatDate(g.nextReturn) : <span className="text-muted-foreground">No date set</span>}</TableCell>
                  <TableCell data-label="Overdue" className="whitespace-nowrap">{g.overdueCount > 0 ? <span className="font-medium text-amber-800 dark:text-amber-300">{g.overdueCount} overdue</span> : <span className="text-muted-foreground">No</span>}</TableCell>
                  <TableCell className="whitespace-nowrap max-md:text-left">
                    {hasInvCapability(ctx.grants, companyOf.get(g.employeeId) ?? "", "warehouse") ? (
                      <Link href={`/inventory?action=return&employee=${g.employeeId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Return equipment</Link>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
