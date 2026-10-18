"use client";

import { useState } from "react";
import { Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddContactDialog, AddOrganisationDialog } from "./entity-dialogs";

/** "Add organisation" and "Add contact" for the top of the Clients page. The page refreshes itself after a save. */
export function ClientsToolbarActions({ organisations }: { organisations: { id: string; name: string }[] }) {
  const [orgOpen, setOrgOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setOrgOpen(true)}><Plus className="h-4 w-4" aria-hidden /> Add organisation</Button>
        <Button type="button" variant="outline" onClick={() => setContactOpen(true)}><UserPlus className="h-4 w-4" aria-hidden /> Add contact</Button>
      </div>
      <AddOrganisationDialog open={orgOpen} onClose={() => setOrgOpen(false)} />
      <AddContactDialog open={contactOpen} onClose={() => setContactOpen(false)} organisations={organisations} />
    </>
  );
}

/** Adds a contact to one specific organisation (the button on its card). */
export function AddContactButton({ organisation }: { organisation: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4" aria-hidden /> Add contact<span className="sr-only"> to {organisation.name}</span>
      </Button>
      <AddContactDialog open={open} onClose={() => setOpen(false)} organisations={[organisation]} defaultOrganisationId={organisation.id} allowNoOrganisation={false} />
    </>
  );
}
