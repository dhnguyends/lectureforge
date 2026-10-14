import { FileImage, FileText, FileType, FileVideo, Music, Presentation, StickyNote, MonitorPlay, type LucideIcon } from "lucide-react";
import type { SourceKind } from "@/lib/contracts/source";

export const SOURCE_ICONS: Record<SourceKind, LucideIcon> = {
  VIDEO: FileVideo,
  AUDIO: Music,
  PDF: FileText,
  SLIDES: Presentation,
  DOCUMENT: FileType,
  IMAGE: FileImage,
  NOTE: StickyNote,
  YOUTUBE: MonitorPlay,
};

export const SOURCE_LABELS: Record<SourceKind, string> = {
  VIDEO: "Video",
  AUDIO: "Audio",
  PDF: "PDF",
  SLIDES: "Slides",
  DOCUMENT: "Document",
  IMAGE: "Image",
  NOTE: "Notes",
  YOUTUBE: "YouTube",
};

export function SourceIcon({ kind, className }: { kind: SourceKind; className?: string }) {
  const Icon = SOURCE_ICONS[kind];
  return <Icon aria-hidden className={className} />;
}
