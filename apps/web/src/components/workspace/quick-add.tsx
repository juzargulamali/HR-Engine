"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { withParams } from "./url-state";

/**
 * The one prominent Add action of a workspace: a button that opens a short form. It also opens when the address carries
 * `?add=1`, so an empty state or another page can link straight to it. The form is passed in (it keeps its own server action);
 * `close` is handed to it so it can shut the dialog after a successful save.
 */
export function QuickAdd({ label, title, description, children, size = "default" }: { label: string; title: string; description?: string; children: React.ReactNode | ((api: { close: () => void }) => React.ReactNode); size?: "default" | "wide" }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = useState(sp.get("add") === "1");
  const close = () => {
    setOpen(false);
    if (sp.get("add")) router.replace(withParams(pathname, sp, { add: null }), { scroll: false });
  };
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> {label}
      </Button>
      <Modal open={open} onClose={close} title={title} description={description} size={size}>
        {typeof children === "function" ? children({ close }) : children}
      </Modal>
    </>
  );
}

/** "Add more details": the optional fields of a Quick Add form, closed by default so the short form stays short. */
export function MoreDetails({ children, label = "Add more details" }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="group rounded-md border border-border">
      <summary className="cursor-pointer select-none rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</summary>
      <div className="space-y-4 border-t border-border p-3">{children}</div>
    </details>
  );
}
