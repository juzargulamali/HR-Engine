import { Chip } from "./ui";
import type { Health } from "../_lib/delivery";

export function HealthChip({ h }: { h: Health }) {
  if (h === "on_track") return <Chip tone="good">On track</Chip>;
  if (h === "at_risk") return <Chip tone="warn">At risk</Chip>;
  return <Chip tone="bad">Blocked</Chip>;
}
