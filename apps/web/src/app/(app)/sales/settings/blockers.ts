/**
 * What a company's Sales settings stop people doing while they are not set. Only settings that BLOCK work are listed here (they go at the top of the page with a
 * jump link). A missing response target or working calendar blocks nothing: enquiries are still answered and only the "within target" share in Reports is not
 * worked out, so it is shown on its own section as "Not configured", not here.
 *
 * Each line is what the database does, not a guess:
 *  - no settings row: crm_create_opportunity refuses ("CRM settings (reference code and currency) are not configured for this company yet",
 *    supabase/migrations/20261115000200_crm_workflow_functions.sql) and an estimate cannot be numbered ("Sales settings are not set up for this company",
 *    20261220000100_crm_estimates_quotations.sql);
 *  - approval policy not decided: crm_request_approval and crm_decide_approval refuse ("Commercial approval rules are not configured for this company. Nothing can
 *    be approved yet.", 20261115000300_crm_proposals_files_reminders.sql);
 *  - no VAT choice in use: an estimate cannot be issued without a VAT treatment ("Choose the VAT treatment before issuing", 20261220000100), and the choices on an
 *    estimate are this company's list.
 */
export const SECTION = { response: "response-targets", approval: "commercial-approval", estimates: "estimates-vat", vat: "vat-choices" } as const;

export interface SettingsBlocker { id: "no_settings" | "approval_not_decided" | "no_vat_choice"; title: string; blocks: string; section: string; action: string }

export function settingsBlockers(input: {
  /** null = no Sales settings saved for the company yet. */
  settings: { approval_policy: string } | null;
  /** How many VAT choices are in use (not hidden); null = the list could not be read, so nothing is claimed about it. */
  activeVatChoices: number | null;
}): SettingsBlocker[] {
  const out: SettingsBlocker[] = [];
  if (!input.settings) {
    out.push({ id: "no_settings", title: "Reference code and default currency are not set", blocks: "Enquiries cannot be recorded and estimates cannot be numbered for this company until they are saved.", section: SECTION.estimates, action: "Set the reference code and currency" });
  }
  if ((input.settings?.approval_policy ?? "not_configured") === "not_configured") {
    out.push({ id: "approval_not_decided", title: "Commercial approval is not decided", blocks: "Nobody can request or give a commercial approval for this company until a policy is chosen.", section: SECTION.approval, action: "Choose the approval policy" });
  }
  if (input.activeVatChoices === 0) {
    out.push({ id: "no_vat_choice", title: "No VAT choice is in use", blocks: "An estimate cannot be issued without a VAT treatment, and there is none to choose.", section: SECTION.vat, action: "Add a VAT choice" });
  }
  return out;
}
