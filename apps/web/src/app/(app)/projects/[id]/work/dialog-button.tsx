"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/sales/modal";

/** A button that opens a dialog. The content is a function so a form can close the dialog after a successful save. */
export function DialogButton({
  label, title, description, variant = "outline", size = "sm", children,
}: {
  label: string;
  title: string;
  description?: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  size?: "default" | "sm";
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>{label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description}>
        {children(() => setOpen(false))}
      </Modal>
    </>
  );
}
