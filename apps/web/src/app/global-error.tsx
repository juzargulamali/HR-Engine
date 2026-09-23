"use client";

import { useEffect } from "react";

/**
 * Catches an error thrown by the ROOT layout itself — the nested
 * (app)/error.tsx above can't see those, since a segment's error boundary
 * never covers its own parent layout. Deliberately has no imports beyond
 * React: if something is broken badly enough to reach this boundary,
 * pulling in more of the app's own module graph (components, Tailwind
 * tokens, etc.) is itself a risk, so this renders with inline styles and
 * its own bare <html>/<body> (required — this replaces the whole root
 * layout while active).
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[global-error]", { digest: error.digest });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", background: "#0a1414", color: "#eef5f4" }}>
        <div style={{ textAlign: "center", maxWidth: 360, padding: 24 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>Enginious HR Engine couldn&apos;t load</h1>
          <p style={{ fontSize: 14, color: "#9fb3b0", margin: "0 0 16px" }}>
            Something went wrong. Your data is safe — try again, and if it keeps happening, share the reference below with support.
          </p>
          {error.digest ? (
            <p style={{ fontFamily: "monospace", fontSize: 12, color: "#9fb3b0", border: "1px solid #294342", borderRadius: 6, padding: "6px 10px", display: "inline-block", marginBottom: 16 }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <div>
            <button
              type="button"
              onClick={reset}
              style={{ background: "#17b8ac", color: "#04211f", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
