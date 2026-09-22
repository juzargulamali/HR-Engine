import type { Metadata } from "next";
import { Manrope, Sora } from "next/font/google";
import { cn } from "@/lib/utils";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora" });

export const metadata: Metadata = {
  title: "Enginious HR Engine",
  description: "HR management for Enginious LLC FZ — driven by innovation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={cn(manrope.variable, sora.variable, "min-h-screen font-sans antialiased")}>{children}</body>
    </html>
  );
}
