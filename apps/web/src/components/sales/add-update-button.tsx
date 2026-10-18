"use client";

import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { AddActivityForm } from "@/app/(app)/sales/opportunities/[id]/add-activity-form";

/**
 * "Add update": records what happened (note, call, email, meeting, or a client response) on the enquiry's timeline. A call is a
 * call: it never marks the client as having replied, and nothing is ever sent to anyone. Proposal and quote references have their own
 * forms (Proposals & files, Commercial) because they are different records, not a kind of note.
 */
export function AddUpdateButton({ opportunityId, size = "sm" }: { opportunityId: string; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size={size} variant="outline" onClick={() => setOpen(true)}>
        <MessageSquarePlus className="h-4 w-4" aria-hidden /> Add update
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add update" description="Record what happened. Choose Client response only when the client actually replied.">
        <AddActivityForm opportunityId={opportunityId} onDone={() => setOpen(false)} />
        <p className="mt-3 text-sm text-muted-foreground">To record a proposal, use Proposals &amp; files. To record a quote reference, use Commercial.</p>
      </Modal>
    </>
  );
}
