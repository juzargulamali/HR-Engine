"use client";

import { useEffect, useRef } from "react";

/** Brings the card a change notice linked to into view (and focuses nothing: it only scrolls). Renders no visible element of its own. */
export function ScrollIntoViewOnMount() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const card = ref.current?.closest("li");
    if (card && typeof card.scrollIntoView === "function") card.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  return <span ref={ref} hidden aria-hidden />;
}
