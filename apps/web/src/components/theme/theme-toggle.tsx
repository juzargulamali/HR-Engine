"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Theme = "dark" | "light";

function readStoredTheme(): Theme {
  try {
    return window.localStorage.getItem("theme") === "light" ? "light" : "dark";
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
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setTheme(readStoredTheme());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
    try {
      window.localStorage.setItem("theme", next);
    } catch {
      // Private browsing / storage blocked — the toggle still works for this page view, just won't persist.
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={toggle}>
      {theme === "light" ? "Dark mode" : "Light mode"}
    </Button>
  );
}
