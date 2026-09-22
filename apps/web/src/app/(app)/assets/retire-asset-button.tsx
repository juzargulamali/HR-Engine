"use client";

import { useState, useTransition } from "react";
import { retireAsset } from "@/lib/actions/assets";
import { Button } from "@/components/ui/button";

export function RetireAssetButton({ assetId }: { assetId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Retire this asset? It will no longer be assignable.")) return;
          startTransition(async () => setError((await retireAsset(assetId)).error));
        }}
      >
        {pending ? "Retiring…" : "Retire"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
