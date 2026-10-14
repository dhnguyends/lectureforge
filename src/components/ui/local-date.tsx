"use client";

import { useEffect, useState } from "react";

/**
 * A date in the viewer's locale. The server does not know that locale, so it
 * renders the ISO date and the browser swaps in the localized text after
 * hydration (rendering toLocaleDateString() directly makes server and client
 * text differ, which breaks hydration).
 */
export function LocalDate({ iso, withTime = false, className }: { iso: string; withTime?: boolean; className?: string }) {
  const [text, setText] = useState(() => (withTime ? iso.slice(0, 16).replace("T", " ") : iso.slice(0, 10)));
  useEffect(() => {
    const d = new Date(iso);
    setText(withTime ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : d.toLocaleDateString());
  }, [iso, withTime]);
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
