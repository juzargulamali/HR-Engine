/**
 * Suggested timelines. They are starting points the PM can edit freely, never mandatory and never applied automatically.
 * Offsets are days after a base date the PM chooses (the first day of work for delivery, the first site day for site work).
 * Applied by proj_apply_plan_template; nothing here is client-visible until the PM marks an item client-facing.
 */
export interface PlanTemplateItem {
  template_key: string;
  title: string;
  offset_days: number;
  duration_days: number;
  client_facing?: boolean;
}

export const DELIVERY_TIMELINE_TEMPLATE: PlanTemplateItem[] = [
  { template_key: "moodboard", title: "Moodboard", offset_days: 0, duration_days: 2 },
  { template_key: "storyboard", title: "Storyboard", offset_days: 3, duration_days: 3 },
  { template_key: "first_draft", title: "First draft", offset_days: 7, duration_days: 5 },
  { template_key: "final_render", title: "Final render", offset_days: 13, duration_days: 5 },
  { template_key: "application_demo", title: "Application demo", offset_days: 19, duration_days: 3 },
  { template_key: "hardware_demo", title: "Hardware demo", offset_days: 23, duration_days: 3 },
  { template_key: "full_test", title: "Full test", offset_days: 27, duration_days: 3 },
];

export const SITE_TIMELINE_TEMPLATE: PlanTemplateItem[] = [
  { template_key: "site_access", title: "Site / stand access", offset_days: 0, duration_days: 0 },
  { template_key: "equipment_arrival", title: "Equipment arrival", offset_days: 0, duration_days: 0 },
  { template_key: "installation", title: "Installation", offset_days: 1, duration_days: 2 },
  { template_key: "integration", title: "Integration", offset_days: 3, duration_days: 1 },
  { template_key: "testing", title: "Testing", offset_days: 4, duration_days: 1 },
  { template_key: "client_handover", title: "Client handover", offset_days: 5, duration_days: 0 },
  { template_key: "show_support", title: "Show support", offset_days: 6, duration_days: 3 },
  { template_key: "dismantling", title: "Dismantling", offset_days: 9, duration_days: 1 },
];

export const PLAN_LABELS = { delivery: "Delivery timeline", site: "Site production timeline" } as const;
export const planTemplate = (plan: "delivery" | "site") => (plan === "delivery" ? DELIVERY_TIMELINE_TEMPLATE : SITE_TIMELINE_TEMPLATE);
