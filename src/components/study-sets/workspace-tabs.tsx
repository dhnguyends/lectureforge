"use client";

import {
  BarChart3,
  BookOpenCheck,
  FileText,
  Layers,
  LayoutGrid,
  ListChecks,
  MessagesSquare,
  Puzzle,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type Tab = { segment: string; label: string; icon: LucideIcon; ready: boolean };

const TABS: Tab[] = [
  { segment: "", label: "Overview", icon: LayoutGrid, ready: true },
  { segment: "sources", label: "Sources", icon: FileText, ready: true },
  { segment: "transcript", label: "Transcript", icon: ScrollText, ready: true },
  { segment: "guide", label: "Study Guide", icon: BookOpenCheck, ready: true },
  { segment: "flashcards", label: "Flashcards", icon: Layers, ready: true },
  { segment: "quiz", label: "Quiz", icon: ListChecks, ready: true },
  { segment: "exercises", label: "Exercises", icon: Puzzle, ready: true },
  { segment: "tutor", label: "Tutor", icon: MessagesSquare, ready: true },
  { segment: "analytics", label: "Analytics", icon: BarChart3, ready: false },
];

export function WorkspaceTabs({ studySetId }: { studySetId: string }) {
  const pathname = usePathname();
  const base = `/study-sets/${studySetId}`;
  return (
    <nav aria-label="Study set sections" className="-mx-4 mb-6 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {TABS.map(({ segment, label, icon: Icon, ready }) => {
          const href = segment ? `${base}/${segment}` : base;
          // Nested pages (e.g. a source viewer) keep their tab active.
          const active = segment ? pathname === href || pathname.startsWith(`${href}/`) : pathname === href;
          const cls = "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm";
          return (
            <li key={label}>
              {ready ? (
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(cls, active ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}
                >
                  <Icon className="size-4" aria-hidden /> {label}
                </Link>
              ) : (
                <span aria-disabled="true" title="Available in an upcoming build" className={cn(cls, "cursor-not-allowed border-transparent text-muted-foreground/60")}>
                  <Icon className="size-4" aria-hidden /> {label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
