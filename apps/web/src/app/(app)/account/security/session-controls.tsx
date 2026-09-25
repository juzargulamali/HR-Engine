"use client";

import { useState } from "react";
import { signOut, signOutEverywhere } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";

export function SessionControls() {
  const [confirmingEverywhere, setConfirmingEverywhere] = useState(false);

  return (
    <div className="flex flex-wrap gap-2">
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
      {confirmingEverywhere ? (
        <form action={signOutEverywhere} className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">Sign out every device, including this one?</p>
          <Button type="submit" variant="destructive" size="sm">
            Confirm
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingEverywhere(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button type="button" variant="outline" onClick={() => setConfirmingEverywhere(true)}>
          Sign out of all devices
        </Button>
      )}
    </div>
  );
}
