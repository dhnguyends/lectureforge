"use client";

import { Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import type { CreateStudySetResponse } from "@/lib/contracts/study-set";

/** Minimal create: title + course, then straight to the set to add sources. */
export function QuickCreateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [course, setCourse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const titleId = useId();
  const courseId = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Give the study set a title.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { id } = await apiFetch<CreateStudySetResponse>("/api/study-sets", {
        method: "POST",
        json: { title, course: course || undefined },
      });
      router.push(`/study-sets/${id}`);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not create the study set.");
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus aria-hidden /> Quick create
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Quick create</DialogTitle>
            <DialogDescription>
              Start with a name and add sources next. Need output and grounding options?{" "}
              <Link href="/study-sets/new" className="text-primary underline-offset-4 hover:underline">
                Use the full form
              </Link>
              .
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={titleId}>Title</Label>
            <Input id={titleId} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus aria-invalid={Boolean(error)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={courseId}>Course (optional)</Label>
            <Input id={courseId} value={course} onChange={(e) => setCourse(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Create and add sources
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
