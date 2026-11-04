"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface Guard { setDirty: (dirty: boolean) => void }
const GuardContext = createContext<Guard | null>(null);

/** Called by the Module access panel whenever it holds unsaved edits. Does nothing outside a guard. */
export const useUnsavedAccessGuard = () => useContext(GuardContext);

interface Navigator { dirty: boolean; ask: (href: string) => void }
const NavContext = createContext<Navigator | null>(null);

/** Wraps People & Access. While the Module access editor has unsaved edits, choosing another person asks first; the other person is shown only after Discard. */
export function UnsavedAccessGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const dirtyRef = useRef(false);
  const [dirty, setDirtyState] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const setDirty = useCallback((d: boolean) => { dirtyRef.current = d; setDirtyState(d); }, []);
  const guard = useMemo(() => ({ setDirty }), [setDirty]);
  const nav = useMemo(() => ({ dirty, ask: (href: string) => setTarget(href) }), [dirty]);
  const go = () => { const href = target; setTarget(null); setDirty(false); if (href) router.push(href); };

  return (
    <GuardContext.Provider value={guard}>
      <NavContext.Provider value={nav}>
        {children}
        <Modal open={target !== null} onClose={() => setTarget(null)} title="Discard unsaved changes?" description="You have unsaved Module access changes for this person.">
          <div className="space-y-3">
            <p className="text-sm">Choosing another person discards them. Nothing has been saved.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setTarget(null)}>Keep editing</Button>
              <Button type="button" variant="destructive" onClick={go}>Discard and switch</Button>
            </div>
          </div>
        </Modal>
      </NavContext.Provider>
    </GuardContext.Provider>
  );
}

/** A person in the list. A plain link (works before script loads); with unsaved edits the click is held back until the user confirms. */
export function PersonLink({ href, ...rest }: React.ComponentProps<typeof Link>) {
  const nav = useContext(NavContext);
  return (
    <Link
      {...rest} href={href}
      onClick={(e) => {
        rest.onClick?.(e);
        if (!nav?.dirty || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        nav.ask(typeof href === "string" ? href : href.toString());
      }}
    />
  );
}
