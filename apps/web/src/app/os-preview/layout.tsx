import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isOsPreviewEnabled } from "./_lib/gate";
import { PreviewShell } from "./_components/shell";
import "./os-preview.css";

export const metadata: Metadata = {
  title: "ENGINIOUS OS design preview",
  description: "Design preview with fictional sample data. Not a live system.",
  robots: { index: false, follow: false, nocache: true },
};

export default function OsPreviewLayout({ children }: { children: React.ReactNode }) {
  // Fail closed: hidden in Production (and in any production build that has not opted in).
  if (!isOsPreviewEnabled(process.env)) notFound();
  return <PreviewShell>{children}</PreviewShell>;
}
