import * as React from "react";
import { cn } from "@/lib/utils";

/* Small shadcn-style primitives that need no Radix behaviour. */

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("rounded-xl border bg-card text-card-foreground shadow-xs", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 px-5 pt-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return <h3 className={cn("font-semibold leading-tight tracking-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2 border-t px-5 py-3", className)} {...props} />;
}

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium leading-none select-none", className)} {...props} />;
}

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-xs disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & { variant?: "default" | "outline" | "muted" | "grounded" | "inference" | "practice" | "destructive" }) {
  const styles = {
    default: "bg-secondary text-secondary-foreground border-transparent",
    outline: "border-border text-foreground",
    muted: "bg-muted text-muted-foreground border-transparent",
    grounded: "bg-grounded-bg text-grounded border-transparent",
    inference: "bg-inference-bg text-inference border-transparent",
    practice: "bg-practice-bg text-practice border-transparent",
    destructive: "bg-destructive/10 text-destructive border-transparent",
  }[variant];
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium [&_svg]:size-3", styles, className)}
      {...props}
    />
  );
}

export function Progress({ value, label, className }: { value: number; label: string; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-border", className)} />;
}

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return <kbd className={cn("rounded border bg-muted px-1.5 py-0.5 text-[0.7rem]", className)} {...props} />;
}
