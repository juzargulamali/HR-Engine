import { Suspense } from "react";
import "./concept.css";
import { ConceptProvider } from "./_lib/store";
import { Frame } from "./_components/frame";

/** The concept's own frame and sample store. The parent os-preview layout has already refused to render this in Production. */
export default function ConceptLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="cx-root" aria-busy="true" />}>
      <ConceptProvider>
        <Frame>{children}</Frame>
      </ConceptProvider>
    </Suspense>
  );
}
