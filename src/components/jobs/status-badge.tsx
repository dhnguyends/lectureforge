import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import type { JobStatus, SourceStatus } from "@/lib/contracts/source";

type Status = SourceStatus | JobStatus;

/** Status is conveyed by icon + text, never colour alone. */
const MAP: Record<Status, { label: string; icon: typeof Clock; variant: "muted" | "default" | "grounded" | "destructive"; spin?: boolean }> = {
  PENDING_UPLOAD: { label: "Awaiting upload", icon: CircleDashed, variant: "muted" },
  UPLOADED: { label: "Queued", icon: Clock, variant: "muted" },
  QUEUED: { label: "Queued", icon: Clock, variant: "muted" },
  PROCESSING: { label: "Processing", icon: Loader2, variant: "default", spin: true },
  RUNNING: { label: "Running", icon: Loader2, variant: "default", spin: true },
  READY: { label: "Ready", icon: CheckCircle2, variant: "grounded" },
  SUCCEEDED: { label: "Done", icon: CheckCircle2, variant: "grounded" },
  FAILED: { label: "Failed", icon: AlertTriangle, variant: "destructive" },
  CANCELLED: { label: "Cancelled", icon: CircleDashed, variant: "muted" },
};

export function StatusBadge({ status }: { status: Status }) {
  const { label, icon: Icon, variant, spin } = MAP[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden className={spin ? "animate-spin" : undefined} />
      {label}
    </Badge>
  );
}
