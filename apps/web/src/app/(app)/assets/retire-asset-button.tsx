"use client";

import { useTransition } from "react";
import { retireAsset } from "@/lib/actions/assets";
import { Button } from "@/components/ui/button";

export function RetireAssetButton({ assetId }: { assetId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        if (confirm("Retire this asset? It will no longer be assignable.")) {
          startTransition(() => retireAsset(assetId));
        }
      }}
    >
      {pending ? "Retiring…" : "Retire"}
    </Button>
  );
}
