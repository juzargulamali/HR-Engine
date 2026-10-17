"use client";

import { useState, useTransition } from "react";
import { getCrmFileUrl } from "@/lib/actions/crmFiles";

/** Opens a stored proposal file through a short-lived private link, issued only to people who can see the file. */
export function OpenFileButton({ fileId, name }: { fileId: string; name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function open() {
    setError(null);
    startTransition(async () => {
      const result = await getCrmFileUrl(fileId);
      if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
      else setError(result.error ?? "The file could not be opened.");
    });
  }
  return (
    <span className="inline-flex min-w-0 flex-col items-start gap-0.5">
      <button type="button" onClick={open} disabled={pending} className="max-w-full break-words text-left text-sm underline underline-offset-2 hover:no-underline disabled:opacity-60">
        {pending ? "Opening…" : name}
      </button>
      {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
    </span>
  );
}
