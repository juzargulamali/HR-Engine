"use client";

import { CRM_TIME_ZONE_CHOICES, timeZoneCity } from "@enginious-hr/domain";
import { setFollowUpTimeZone } from "@/lib/actions/crm";
import { Select } from "@/components/ui/select";
import { ActionForm, Field } from "@/components/sales/action-form";

/**
 * The company's follow-up time zone. A named zone only (Asia/Dubai, Europe/Warsaw): the list is the common ones plus the one the company has. Saving changes how
 * this company's deadlines are typed and shown from then on; it moves no existing deadline (each stays the same moment). The database checks who may change it.
 */
export function FollowUpTimeZoneForm({ companyId, current }: { companyId: string; current: string }) {
  const zones = [...new Set([current, ...CRM_TIME_ZONE_CHOICES])];
  return (
    <ActionForm action={setFollowUpTimeZone} submitLabel="Save time zone" pendingLabel="Saving…">
      <input type="hidden" name="companyId" value={companyId} />
      <Field label="Time zone" htmlFor="fu-zone" hint={`Now: ${current} (${timeZoneCity(current)} time). Daylight-saving changes are followed automatically.`}>
        <Select id="fu-zone" name="timeZone" defaultValue={current}>
          {zones.map((z) => <option key={z} value={z}>{z} ({timeZoneCity(z)})</option>)}
        </Select>
      </Field>
      <p className="text-sm text-muted-foreground">Existing follow-ups keep their exact moment. They are then shown on the new clock, so a deadline saved as 11:00 Dubai reads 08:00 Warsaw in winter. Tell the team before you change it.</p>
    </ActionForm>
  );
}
