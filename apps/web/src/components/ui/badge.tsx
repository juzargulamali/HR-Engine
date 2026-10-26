import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The one small status/label word of the application. Every variant is drawn with the shared ENGINIOUS OS badge (a soft tint of one status
 * colour, never a solid block), so the same meaning looks the same in every module and in both themes; the words always carry the meaning.
 * A caller's className can still tint it (for example the shared status tokens), which wins over the variant.
 */
type Variant = "default" | "brand" | "secondary" | "accent" | "outline" | "destructive" | "success" | "warning";
const TONE: Record<Variant, string> = {
  default: "cyan", brand: "cyan", accent: "cyan", secondary: "neutral", outline: "neutral", destructive: "red", success: "green", warning: "amber",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> { variant?: Variant | null }

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn("os-badge border border-transparent", variant === "outline" && "border-border bg-transparent", className)} data-tone={TONE[variant ?? "default"]} {...props} />;
}
