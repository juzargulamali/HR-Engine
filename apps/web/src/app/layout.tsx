import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Enginious HR",
  description: "HR management for Enginious LLC FZ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
