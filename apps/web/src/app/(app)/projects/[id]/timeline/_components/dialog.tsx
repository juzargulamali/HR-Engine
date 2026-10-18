"use client";

import { createContext, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/sales/modal";
import { ActionForm } from "@/components/sales/action-form";
import type { ProjectActionState } from "@/lib/projects/action-utils";

const CloseContext = createContext<() => void>(() => {});

/** A button that opens a dialog. Forms inside use DialogActionForm so a successful save closes it. */
export function DialogButton({ label, title, description, variant = "outline", size = "sm", children }: {
  label: string; title: string; description?: string; variant?: "default" | "outline" | "secondary" | "ghost" | "destructive"; size?: "default" | "sm"; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <CloseContext.Provider value={() => setOpen(false)}>{children}</CloseContext.Provider>
      </Modal>
    </>
  );
}

type Action = (prev: ProjectActionState, formData: FormData) => Promise<ProjectActionState>;

export function DialogActionForm({ action, submitLabel, variant, children }: { action: Action; submitLabel: string; variant?: "default" | "destructive" | "outline" | "secondary"; children: React.ReactNode }) {
  const close = useContext(CloseContext);
  return (
    <ActionForm action={action} submitLabel={submitLabel} variant={variant} onDone={close}>
      {children}
    </ActionForm>
  );
}
