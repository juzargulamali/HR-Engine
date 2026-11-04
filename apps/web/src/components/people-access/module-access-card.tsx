"use client";

import { ACCESS_MODULE_LABELS, accessLabel, capabilityInfo, recogniseAccess, targetLockedForViewer, type AccessModule } from "@enginious-hr/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadError } from "@/components/workspace/states";
import { formatDate } from "@/components/sales/format";

export interface ModuleAccessCardProps {
  module: AccessModule;
  companyName: string;
  /** The viewer may manage this module for the company. Without it nothing was read, so nothing is claimed about the person's access. */
  manageable: boolean;
  /** The read of this access failed: "could not load", never "no access". */
  readFailed: boolean;
  retryHref: string;
  viewerCapabilities: string[];
  person: { name: string; isSelf: boolean };
  /** What the person holds now. null is "no access" and is only meaningful after a successful read. */
  grant: { capabilities: string[]; grantedAt: string; grantedByName: string | null; note: string | null } | null;
  locations: { id: string; name: string }[];
  assignedLocationIds: string[];
  onEdit: () => void;
}

/** Where a warehouse operator works, in words. */
export function worksAtWords(capabilities: readonly string[], assigned: readonly string[], locations: readonly { id: string; name: string }[]): string {
  if (capabilities.includes("founder")) return "All locations (founder)";
  if (capabilities.includes("cross_location")) return "All locations";
  if (!capabilities.includes("warehouse")) return "—";
  const names = assigned.map((id) => locations.find((l) => l.id === id)?.name).filter(Boolean) as string[];
  return names.length > 0 ? names.join(", ") : "No warehouse chosen yet (cannot operate stock)";
}

/** One compact overview card per module. */
export function ModuleAccessCard(props: ModuleAccessCardProps) {
  const { module, companyName, manageable, readFailed, retryHref, viewerCapabilities, person, grant, locations, assignedLocationIds, onEdit } = props;
  const name = ACCESS_MODULE_LABELS[module];
  const rec = grant ? recogniseAccess(module, grant.capabilities) : null;
  const locked = grant !== null && manageable && targetLockedForViewer(module, viewerCapabilities, grant.capabilities, person.isSelf);
  return (
    <section aria-label={`${name} access`} data-module={module} className="flex flex-col gap-2 rounded-md border border-border p-4">
      <h4 className="text-sm font-semibold">{name}</h4>
      {!manageable ? (
        <p className="text-sm text-muted-foreground">You can&apos;t manage this module for {companyName}.</p>
      ) : readFailed ? (
        <LoadError what={`${name} access`} retryHref={retryHref} />
      ) : grant === null || rec === null ? (
        <p className="text-sm text-muted-foreground">No access to {name} in {companyName}.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={rec.custom ? "outline" : "default"} className="whitespace-nowrap" title={rec.profile?.description}>{accessLabel(rec)}</Badge>
            {rec.extras.map((c) => <Badge key={c} variant="outline" className="whitespace-nowrap" title={capabilityInfo(module, c).description}>{rec.profile ? "+ " : ""}{capabilityInfo(module, c).label}</Badge>)}
          </div>
          {rec.profile ? <p className="text-sm text-muted-foreground">{rec.profile.description}</p> : null}
          {module === "inventory" && (grant.capabilities.includes("warehouse") || grant.capabilities.includes("founder")) ? (
            <p className="text-sm text-muted-foreground">Works at: {worksAtWords(grant.capabilities, assignedLocationIds, locations)}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">Given {formatDate(grant.grantedAt)}{grant.grantedByName ? ` by ${grant.grantedByName}` : ""}{grant.note ? ` · ${grant.note}` : ""}</p>
        </>
      )}
      {locked ? <p className="text-sm text-muted-foreground">Only a founder can change this person&apos;s access, because they hold a founder, access-management{module === "inventory" ? " or cost" : ""} right.</p> : null}
      {manageable && !readFailed && !locked ? (
        <div className="mt-auto pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onEdit}>{grant ? "Edit access" : "Give access"}<span className="sr-only"> to {name} for {person.name}</span></Button>
        </div>
      ) : null}
    </section>
  );
}
