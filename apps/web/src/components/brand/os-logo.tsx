import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * The ENGINIOUS OS product identity for places with room for it (sign-in, About): the lockup for the active theme, and, with
 * `endorsement`, the line "A product of ENGINIOUS". The lockup artwork is built from the original Enginious logo
 * (scripts/brand/build-os-lockups.mjs). The endorsement is live text in the app's heading font: the original artwork has no such line.
 */
export function OsLogo({ height = 44, endorsement = false, className }: { height?: number; endorsement?: boolean; className?: string }) {
  const size = { width: 772, height: 124 };
  return (
    <div className={cn("flex flex-col items-center", className)}>
      <Image src="/brand/enginious-os-lockup-dark.png" alt="ENGINIOUS OS" {...size} priority style={{ height, width: "auto" }} className="hidden dark:block" />
      <Image src="/brand/enginious-os-lockup-light.png" alt="ENGINIOUS OS" {...size} priority style={{ height, width: "auto" }} className="dark:hidden" />
      {endorsement ? <p className="mt-2.5 font-heading text-[11px] font-semibold uppercase tracking-[0.32em] text-accent">A product of ENGINIOUS</p> : null}
    </div>
  );
}
