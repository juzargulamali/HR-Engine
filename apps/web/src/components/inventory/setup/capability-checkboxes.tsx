"use client";

import { useState } from "react";
import { INV_CAPABILITIES, INV_CAPABILITY_LABELS, type InvCapability } from "@enginious-hr/domain";
import { capabilityDisabledReason, isCapabilityDisabled } from "@/lib/inventory/setup";

/**
 * The Inventory capabilities as plain checkboxes with their descriptions. Founder, "manage access" and "see purchase costs" can only be
 * given by a founder: for everyone else those boxes are disabled and the reason is written under them (the database refuses them too).
 * Ticked boxes are submitted as `capabilities`. A founder box that is locked on (the company's only founder) stays ticked.
 */
export function CapabilityCheckboxes({
  idPrefix, viewerIsFounder, defaultSelected = [], lockFounder = false, onChange,
}: {
  idPrefix: string;
  viewerIsFounder: boolean;
  defaultSelected?: readonly InvCapability[];
  /** This person is the company's only founder: their founder right cannot be taken away. */
  lockFounder?: boolean;
  onChange?: (selected: ReadonlySet<InvCapability>) => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<InvCapability>>(new Set(defaultSelected));
  const toggle = (cap: InvCapability, on: boolean) => {
    // Disabled boxes cannot change, whatever sends the event.
    if (isCapabilityDisabled(cap, viewerIsFounder) || (lockFounder && cap === "founder")) return;
    const next = new Set(selected);
    if (on) next.add(cap); else next.delete(cap);
    setSelected(next);
    onChange?.(next);
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">What they can do</legend>
      <p className="text-sm text-muted-foreground">With none of these ticked a person can still see the catalogue summary: names, categories and what is usable. Nothing below gives access to HR, Sales or Projects.</p>
      <ul className="space-y-2.5">
        {INV_CAPABILITIES.map((cap) => {
          const disabled = isCapabilityDisabled(cap, viewerIsFounder) || (lockFounder && cap === "founder");
          const reason = isCapabilityDisabled(cap, viewerIsFounder) ? capabilityDisabledReason(cap) : lockFounder && cap === "founder" ? "This is the company's only founder, so founder rights cannot be removed." : null;
          const id = `${idPrefix}-${cap}`;
          return (
            <li key={cap}>
              <label htmlFor={id} className={`flex items-start gap-2 text-sm ${disabled ? "opacity-70" : ""}`}>
                <input
                  id={id} type="checkbox" name="capabilities" value={cap} className="mt-0.5 h-4 w-4" checked={selected.has(cap)} disabled={disabled}
                  aria-describedby={reason ? `${id}-why` : undefined} onChange={(e) => toggle(cap, e.target.checked)}
                />
                <span className="min-w-0">
                  <span className="font-medium">{INV_CAPABILITY_LABELS[cap].label}</span>
                  <span className="block text-muted-foreground">{INV_CAPABILITY_LABELS[cap].description}</span>
                  {reason ? <span id={`${id}-why`} className="block text-muted-foreground">{reason}</span> : null}
                </span>
              </label>
              {/* A disabled box is never submitted, so a locked-on founder right is sent explicitly. */}
              {lockFounder && cap === "founder" && selected.has(cap) ? <input type="hidden" name="capabilities" value="founder" /> : null}
            </li>
          );
        })}
      </ul>
      {!viewerIsFounder ? <p className="text-sm text-muted-foreground">Founder, access-management and cost rights can only be given by a founder.</p> : null}
    </fieldset>
  );
}
