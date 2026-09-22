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

// Runs before paint, straight from the server-rendered <head> — the only
// way to apply a stored light-mode choice without a dark-then-light flash
// on load. Dark needs no script: it's already globals.css's default.
const THEME_INIT_SCRIPT = `
try {
  if (window.localStorage.getItem("theme") === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  }
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={cn(manrope.variable, sora.variable, "min-h-screen font-sans antialiased")}>{children}</body>
    </html>
  );
}
