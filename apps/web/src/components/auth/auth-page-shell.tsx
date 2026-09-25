import Image from "next/image";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The brand-grid/logo/heading shell shared by every public, signed-out auth
 * page (login, set-password, forgot-password, reset-password) — previously
 * duplicated per-page; extracted here so a new one (this file's reason for
 * existing) doesn't have to copy it a fourth time.
 */
export function AuthPageShell({ title, subtitle, children }: { title: ReactNode; subtitle: string; children: ReactNode }) {
  return (
    <div className="brand-grid relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(700px circle at 50% 0%, hsl(var(--brand-glow) / 0.14), transparent 65%)" }}
        aria-hidden
      />
      <div className="relative w-full max-w-sm space-y-6">
        <div className="space-y-3 text-center">
          <Image src="/brand/enginious-icon.png" alt="" width={52} height={52} className="mx-auto" priority />
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Card>
          <CardContent className="pt-6">{children}</CardContent>
        </Card>
      </div>
    </div>
  );
}
