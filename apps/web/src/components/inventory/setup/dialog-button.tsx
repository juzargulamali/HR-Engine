"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/** A button that opens a dialog with a form in it. The form gets `close` so it can shut the dialog after a successful save. */
export function DialogButton({
  label, title, description, children, variant = "outline", size = "sm", icon = true, size2 = "default",
}: {
  label: string; title: string; description?: string; variant?: "default" | "outline" | "secondary" | "ghost"; size?: "default" | "sm";
  icon?: boolean; size2?: "default" | "wide"; children: (api: { close: () => void }) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(true)}>{icon ? <Plus className="h-4 w-4" aria-hidden /> : null} {label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description} size={size2}>{children({ close: () => setOpen(false) })}</Modal>
    </>
  );
}
