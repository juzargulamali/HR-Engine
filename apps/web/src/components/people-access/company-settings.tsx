import { ReferenceCodeForm } from "@/components/projects/reference-code-form";
import { SharingSection } from "@/components/inventory/setup/sharing-section";
import { Muted, Panel } from "@/components/projects/parts";
import type { PaCompanySettings } from "@/lib/people-access/data";

/**
 * Company-level settings that used to sit on the Projects and Inventory Access screens. They are not access for a person, so they stayed company-level
 * and moved here, with the same viewers: access managers read them, founders change them.
 */
export function CompanySettingsView({ settings }: { settings: PaCompanySettings }) {
  if (settings.projects.length === 0 && settings.inventory.length === 0) {
    return <Muted>There are no company settings for you to see. They appear for Projects and Inventory access managers.</Muted>;
  }
  return (
    <div className="space-y-6">
      {settings.projects.map((c) => (
        <Panel key={`p-${c.company.id}`} title={`Projects · ${c.company.name}`} description={c.referenceCode ? `Projects are numbered ${c.referenceCode}-P-2026-0001 and so on.` : "The project reference code is not set. No project can be created for this company until a founder sets it."}>
          {c.isFounder ? <div className="max-w-sm"><ReferenceCodeForm companyId={c.company.id} current={c.referenceCode} /></div> : <Muted>A Projects founder sets the reference code{c.referenceCode ? ` (now ${c.referenceCode})` : ""}.</Muted>}
        </Panel>
      ))}
      {settings.inventory.map((c) => (
        <Panel key={`i-${c.company.id}`} title={`Inventory · equipment sharing · ${c.company.name}`} description="Cross-company use is always explicit.">
          <SharingSection companyId={c.company.id} companyName={c.company.name} canEdit={c.isFounder} allows={c.allows} uses={c.uses} others={c.others} />
        </Panel>
      ))}
    </div>
  );
}
