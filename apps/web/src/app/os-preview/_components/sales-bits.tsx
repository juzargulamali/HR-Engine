"use client";

import { Lock } from "lucide-react";
import { type Opportunity, COMPANIES, money, orgById, personName } from "../_lib/data";
import { usePreview } from "./context";

export function useOppRights(o: Opportunity) {
  const { roleDef } = usePreview();
  const isOwner = roleDef.person === o.owner;
  const canChange = isOwner || roleDef.canAssignOwner;
  const reason = canChange
    ? null
    : `Only the owner (${personName(o.owner)}) or a founder can change the stage, value or close this opportunity. You can add activities and notes.`;
  return { canChange, canAssign: roleDef.canAssignOwner, isOwner, reason, roleDef };
}

export function ClientLine({ o }: { o: Opportunity }) {
  const agency = o.agencyId ? orgById(o.agencyId).name : null;
  const client = o.endClientId ? orgById(o.endClientId).name : null;
  if (agency && client) return <>{client} <span className="text-muted-foreground">via {agency}</span></>;
  return <>{client ?? agency ?? "No client recorded"}</>;
}

export function ValueText({ o }: { o: Opportunity }) {
  return <>{money(o.value, o.currency)}</>;
}

export function CompanyText({ o }: { o: Opportunity }) {
  return <>{COMPANIES[o.company].name.replace(" (sample entity)", "")}</>;
}

export function LockedNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Lock className="mt-0.5 h-3 w-3 flex-none" aria-hidden />{children}</p>
  );
}
