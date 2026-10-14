import Link from "next/link";
import { cn } from "@/lib/utils";

/** Wordmark: an anvil-like stacked mark — original, deliberately simple. */
export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 24 24" className="size-6 text-primary" aria-hidden>
        <rect x="3" y="4" width="18" height="4" rx="1.2" fill="currentColor" />
        <rect x="6" y="10" width="12" height="4" rx="1.2" fill="currentColor" opacity="0.7" />
        <rect x="9" y="16" width="6" height="4" rx="1.2" fill="currentColor" opacity="0.45" />
      </svg>
      <span>LectureForge</span>
    </Link>
  );
}
