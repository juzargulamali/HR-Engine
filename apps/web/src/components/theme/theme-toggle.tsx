"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Theme = "dark" | "light";

const STORAGE_KEY = "theme";
// Same-tab instances (header icon + user-menu row) don't share React state,
// so without this a toggle in one place would leave the other showing the
// stale icon/label until it happened to remount. The "storage" event alone
// only fires in OTHER tabs, never the tab that made the change.
const THEME_CHANGE_EVENT = "enginious:theme-change";

function readStoredTheme(): Theme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme) {
  if (theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

/**
 * Dark is the app-wide default (see globals.css) — this only ever adds
 * data-theme="light" when someone explicitly picks it, and remembers that
 * choice per browser via localStorage. The inline script in layout.tsx
 * applies the stored choice before paint so there's no dark-then-light
 * flash on load.
 */
export function ThemeToggle({ variant = "icon", className }: { variant?: "icon" | "menu-item"; className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let cancelled = false;
    function sync() {
      if (!cancelled) setTheme(readStoredTheme());
    }
    // Deferred a tick rather than calling setState synchronously in the
    // effect body — same reason the original version of this component did.
    Promise.resolve().then(sync);
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      cancelled = true;
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private browsing / storage blocked — the toggle still works for this page view, just won't persist.
    }
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  const isLight = theme === "light";
  const label = isLight ? "Switch to dark mode" : "Switch to light mode";

  if (variant === "menu-item") {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={toggle}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        <span className="flex items-center gap-2">
          {isLight ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
          Appearance
        </span>
        <span className="text-xs text-muted-foreground">{isLight ? "Light" : "Dark"}</span>
      </button>
    );
  }

  return (
    <Button type="button" variant="ghost" size="sm" onClick={toggle} aria-label={label} title={label} className={cn("h-9 w-9 px-0", className)}>
      {isLight ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </Button>
  );
}
