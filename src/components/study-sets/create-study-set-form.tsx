"use client";

import { BookOpenCheck, ChevronDown, Layers, ListChecks, Loader2, MessagesSquare, Puzzle, ShieldCheck, Volume2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { SourcePicker } from "@/components/upload/source-picker";
import { useSourceStaging } from "@/components/upload/use-source-staging";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect } from "@/components/ui/primitives";
import { Checkbox, Switch } from "@/components/ui/switch";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import {
  CreateStudySetInputSchema,
  type CreateStudySetInput,
  type CreateStudySetResponse,
  type OutputType,
} from "@/lib/contracts/study-set";
import { cn } from "@/lib/utils";

const OUTPUTS: { type: OutputType; label: string; hint: string; icon: typeof Layers }[] = [
  { type: "STUDY_GUIDE", label: "Study guide", hint: "Hierarchical notes with citations", icon: BookOpenCheck },
  { type: "FLASHCARDS", label: "Flashcards", hint: "Spaced-repetition deck", icon: Layers },
  { type: "QUIZ", label: "Quiz", hint: "Adaptive practice questions", icon: ListChecks },
  { type: "EXERCISES", label: "Exercises", hint: "Derivations, proofs, code problems", icon: Puzzle },
  { type: "AUDIO_RECAP", label: "Audio recap", hint: "Short spoken summary", icon: Volume2 },
  { type: "TUTOR", label: "Tutor", hint: "Socratic, grounded in your sources", icon: MessagesSquare },
];

const LEVELS = [
  ["UNDERGRADUATE", "Undergraduate"],
  ["ADVANCED_UNDERGRADUATE", "Advanced undergraduate"],
  ["GRADUATE", "Graduate"],
  ["RESEARCH", "Research"],
] as const;

type FormState = Required<Omit<CreateStudySetInput, "advanced" | "examDate" | "course" | "subject" | "description">> & {
  course: string;
  subject: string;
  examDate: string;
  advanced: Required<NonNullable<CreateStudySetInput["advanced"]>>;
};

const INITIAL: FormState = {
  title: "",
  course: "",
  subject: "",
  learnerLevel: "ADVANCED_UNDERGRADUATE",
  examDate: "",
  language: "en",
  outputTypes: ["STUDY_GUIDE", "FLASHCARDS", "QUIZ"],
  advanced: {
    transcriptLanguage: null,
    speakerDiarization: true,
    preserveEquationsCode: true,
    detailLevel: "STANDARD",
    citationStrictness: "STRICT",
    sourcesOnly: true,
    allowExternalKnowledge: false,
  },
};

/** Subjects this user may choose, from their profile (see src/server/services/profiles.ts). */
export type SubjectOptions = { profile: string | null; anyDiscipline: boolean; disciplines: string[] };

export function CreateStudySetForm({ youtubeEnabled, subjects }: { youtubeEnabled: boolean; subjects: SubjectOptions }) {
  const router = useRouter();
  const staging = useSourceStaging();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [rights, setRights] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const ids = { title: useId(), course: useId(), subject: useId(), level: useId(), exam: useId(), lang: useId(), rights: useId() };

  // Warn before closing the tab mid-upload.
  useEffect(() => {
    if (!staging.busy) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [staging.busy]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setAdv = <K extends keyof FormState["advanced"]>(key: K, value: FormState["advanced"][K]) =>
    setForm((f) => ({ ...f, advanced: { ...f.advanced, [key]: value } }));

  const toggleOutput = (type: OutputType, on: boolean) =>
    set("outputTypes", on ? [...form.outputTypes, type] : form.outputTypes.filter((t) => t !== type));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const input: CreateStudySetInput = {
      ...form,
      course: form.course || undefined,
      subject: form.subject || undefined,
      examDate: form.examDate || undefined,
    };
    const parsed = CreateStudySetInputSchema.safeParse(input);
    const fieldErrors: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    if (staging.validCount > 0 && !rights) fieldErrors.rights = "Please confirm you have the right to use these materials.";
    if (!subjects.anyDiscipline && !form.subject) fieldErrors.subject = "Choose a discipline.";
    setErrors(fieldErrors);
    if (Object.keys(fieldErrors).length) {
      document.getElementById(fieldErrors.title ? ids.title : ids.rights)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      // Re-use the set if a previous attempt created it but some uploads failed.
      const studySetId =
        createdId ?? (await apiFetch<CreateStudySetResponse>("/api/study-sets", { method: "POST", json: input })).id;
      setCreatedId(studySetId);
      if (staging.validCount > 0) {
        const { failed } = await staging.uploadAll(studySetId, true);
        if (failed > 0) {
          setSubmitError(`${failed} source(s) failed to upload. Retry, remove them, or continue to the study set.`);
          return;
        }
      }
      router.push(`/study-sets/${studySetId}`);
    } catch (err) {
      setSubmitError(err instanceof ApiClientError ? err.message : "Could not create the study set. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || staging.busy;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Used to label your materials and to calibrate the depth of generated content.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2" id={ids.title} label="Title" required error={errors.title}>
            <Input
              id={ids.title}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Lecture 7 — Backpropagation and computational graphs"
              aria-invalid={Boolean(errors.title)}
              required
            />
          </Field>
          <Field id={ids.course} label="Course">
            <Input id={ids.course} value={form.course} onChange={(e) => set("course", e.target.value)} placeholder="e.g. Deep Learning (CS 7643)" />
          </Field>
          {subjects.anyDiscipline ? (
            <Field id={ids.subject} label="Discipline" hint={subjects.profile ? `${subjects.profile} profile: any discipline` : undefined}>
              <Input id={ids.subject} list={`${ids.subject}-list`} value={form.subject} onChange={(e) => set("subject", e.target.value)} placeholder="e.g. Machine learning" maxLength={120} />
              <datalist id={`${ids.subject}-list`}>
                {subjects.disciplines.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </Field>
          ) : (
            <Field id={ids.subject} label="Discipline" required hint={`Disciplines of your ${subjects.profile} profile`} error={errors.subject}>
              <NativeSelect id={ids.subject} value={form.subject} onChange={(e) => set("subject", e.target.value)} required aria-invalid={Boolean(errors.subject)}>
                <option value="">Choose a discipline…</option>
                {subjects.disciplines.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field id={ids.level} label="Learner level">
            <NativeSelect id={ids.level} value={form.learnerLevel} onChange={(e) => set("learnerLevel", e.target.value as FormState["learnerLevel"])}>
              {LEVELS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id={ids.exam} label="Target exam date" error={errors.examDate}>
            <Input id={ids.exam} type="date" value={form.examDate} onChange={(e) => set("examDate", e.target.value)} />
          </Field>
          <Field id={ids.lang} label="Study language" error={errors.language} hint="Language for generated materials (e.g. en, de, pt-BR).">
            <Input id={ids.lang} value={form.language} onChange={(e) => set("language", e.target.value.trim())} className="max-w-32" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sources</CardTitle>
          <CardDescription>Everything you add stays private to you. You can add more sources later.</CardDescription>
        </CardHeader>
        <CardContent>
          <SourcePicker staging={staging} youtubeEnabled={youtubeEnabled} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What should we prepare?</CardTitle>
          <CardDescription>Generated after processing finishes. Everything stays editable and can be regenerated.</CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset>
            <legend className="sr-only">Learning materials to generate</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {OUTPUTS.map(({ type, label, hint, icon: Icon }) => {
                const checked = form.outputTypes.includes(type);
                return (
                  <label
                    key={type}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                      checked ? "border-primary/60 bg-accent" : "hover:bg-muted/60",
                    )}
                  >
                    <Checkbox checked={checked} onCheckedChange={(v) => toggleOutput(type, v === true)} className="mt-0.5" />
                    <span className="space-y-0.5">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        <Icon className="size-4 text-muted-foreground" aria-hidden />
                        {label}
                      </span>
                      <span className="block text-xs text-muted-foreground">{hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <AdvancedSettings form={form} setAdv={setAdv} errors={errors} />

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex items-start gap-3">
            <Checkbox
              id={ids.rights}
              checked={rights}
              onCheckedChange={(v) => setRights(v === true)}
              aria-invalid={Boolean(errors.rights)}
              aria-describedby={`${ids.rights}-desc`}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor={ids.rights}>I own these materials or have permission to upload and process them for my private study.</Label>
              <p id={`${ids.rights}-desc`} className="text-xs text-muted-foreground">
                This includes lecture recordings of other speakers. Your files are processed only for your private workspace, are never
                shared, and are never used to train models unless you separately opt in.
              </p>
              {errors.rights && <p className="text-sm text-destructive">{errors.rights}</p>}
            </div>
          </div>

          {submitError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {submitError}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-4" aria-hidden /> Private by default · delete any source permanently at any time
            </p>
            <div className="flex gap-2">
              {createdId && !busy && (
                <Button type="button" variant="outline" onClick={() => router.push(`/study-sets/${createdId}`)}>
                  Continue to study set
                </Button>
              )}
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" aria-hidden />}
                {staging.busy ? "Uploading…" : createdId ? "Retry failed uploads" : "Create study set"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

function AdvancedSettings({
  form,
  setAdv,
  errors,
}: {
  form: FormState;
  setAdv: <K extends keyof FormState["advanced"]>(key: K, value: FormState["advanced"][K]) => void;
  errors: Record<string, string>;
}) {
  const a = form.advanced;
  const tl = useId();
  return (
    <details className="group rounded-xl border bg-card shadow-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-semibold [&::-webkit-details-marker]:hidden">
        Advanced settings
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="grid gap-5 border-t px-5 py-5 sm:grid-cols-2">
        <Field id={tl} label="Transcript language" hint="Leave empty to detect automatically." error={errors["advanced.transcriptLanguage"]}>
          <Input
            id={tl}
            value={a.transcriptLanguage ?? ""}
            placeholder="auto"
            className="max-w-32"
            onChange={(e) => setAdv("transcriptLanguage", e.target.value.trim() || null)}
          />
        </Field>
        <SelectField
          label="Detail level"
          value={a.detailLevel}
          onChange={(v) => setAdv("detailLevel", v as typeof a.detailLevel)}
          options={[
            ["CONCISE", "Concise"],
            ["STANDARD", "Standard"],
            ["EXHAUSTIVE", "Exhaustive"],
          ]}
        />
        <SelectField
          label="Citation strictness"
          hint="Strict drops any claim that cannot be tied to a source passage."
          value={a.citationStrictness}
          onChange={(v) => setAdv("citationStrictness", v as typeof a.citationStrictness)}
          options={[
            ["STRICT", "Strict — every claim cited"],
            ["BALANCED", "Balanced — uncited claims flagged"],
            ["LENIENT", "Lenient — labelled inference allowed"],
          ]}
        />
        <ToggleField
          label="Speaker diarization"
          hint="Label who is speaking (where the transcription provider supports it)."
          checked={a.speakerDiarization}
          onChange={(v) => setAdv("speakerDiarization", v)}
        />
        <ToggleField
          label="Preserve equations and code"
          hint="Keep notation, units and code blocks verbatim."
          checked={a.preserveEquationsCode}
          onChange={(v) => setAdv("preserveEquationsCode", v)}
        />
        <ToggleField
          label="Generate only from sources"
          hint="Nothing that is not in your materials, except clearly labelled practice."
          checked={a.sourcesOnly}
          onChange={(v) => {
            setAdv("sourcesOnly", v);
            if (v) setAdv("allowExternalKnowledge", false);
          }}
        />
        <ToggleField
          label="Include external knowledge"
          hint="Allow background explanations beyond your sources, always labelled as external."
          checked={a.allowExternalKnowledge}
          onChange={(v) => {
            setAdv("allowExternalKnowledge", v);
            if (v) setAdv("sourcesOnly", false);
          }}
        />
      </div>
    </details>
  );
}

function Field({
  id,
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span aria-hidden className="text-muted-foreground"> *</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function SelectField({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  options: (readonly [string, string])[];
}) {
  const id = useId();
  return (
    <Field id={id} label={label} hint={hint}>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function ToggleField({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-hint`} />
    </div>
  );
}
