"use client";

import { useState } from "react";
import { ActionForm } from "@/components/sales/action-form";
import { Modal } from "@/components/sales/modal";
import { Button } from "@/components/ui/button";
import type { ProjectActionState } from "@/lib/projects/action-utils";

type Action = (prev: ProjectActionState, formData: FormData) => Promise<ProjectActionState>;

/** A button that opens a dialog holding one server-action form. The dialog closes after a successful save. */
export function DialogForm({
  triggerLabel, title, description, action, submitLabel, children, triggerVariant = "outline", submitVariant = "default", size = "sm", resetOnSuccess,
}: {
  triggerLabel: string;
  title: string;
  description?: string;
  action: Action;
  submitLabel: string;
  children: React.ReactNode;
  triggerVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  submitVariant?: "default" | "destructive" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
  resetOnSuccess?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={triggerVariant} size={size} onClick={() => setOpen(true)}>{triggerLabel}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <ActionForm
          action={action}
          submitLabel={submitLabel}
          variant={submitVariant}
          resetOnSuccess={resetOnSuccess}
          onDone={() => setOpen(false)}
          secondary={<Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}
        >
          {children}
        </ActionForm>
      </Modal>
    </>
  );
}
