import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/projects/parts";
import { LoadError } from "@/components/workspace/states";
import { AccessNotice } from "@/components/os/access-notice";
import { OsScope } from "@/components/os/scope";
import { getOperationsContext } from "@/lib/operations/data";

/**
 * Operations shell. Access is the Operations Manager capability of a Projects grant, per company (a founder holds it too). It is not an HR role, not a Sales grant and
 * not project membership: someone without it sees this message and no operational data, and the database refuses them as well. Operations reads Sales, Projects and
 * Inventory through its own allowlisted reads and links to the screens where the people who own that work act; it changes none of it itself.
 */
export default async function OperationsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getOperationsContext();
  if (!ctx) return null;
  if (!ctx.installed) {
    return <OsScope className="space-y-4"><PageHeader title="Operations" /><Alert role="status">Operations is not installed in this environment yet. The database changes it needs have not been applied here, so nothing is shown.</Alert></OsScope>;
  }
  if (ctx.loadFailed) return <OsScope className="space-y-4"><PageHeader title="Operations" /><LoadError what="Operations" /></OsScope>;
  if (ctx.companies.length === 0) {
    return (
      <OsScope>
        <AccessNotice title="Operations">You are not an Operations Manager. It is given per company in People &amp; Access by a founder or someone who manages Projects access. Your projects and tasks are in Projects &amp; Tasks as before.</AccessNotice>
      </OsScope>
    );
  }
  return <OsScope className="space-y-5">{children}</OsScope>;
}
