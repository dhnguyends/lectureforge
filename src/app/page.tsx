import { BookOpenCheck, Clock, Layers, ListChecks, Lock, MessagesSquare, Puzzle, Quote } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: BookOpenCheck,
    title: "From a 90-minute lecture to structured notes",
    body: "Objectives, definitions, equations with a symbol glossary, assumptions and worked examples — organised the way the lecture was taught.",
  },
  {
    icon: Quote,
    title: "Every claim points to its source",
    body: "Click a citation to jump to 00:41:07 in the recording or to the highlighted region on slide 23. Anything not in your materials is labelled as such.",
  },
  {
    icon: ListChecks,
    title: "Quizzes that adapt to what you miss",
    body: "Numerical, derivation-step, code-tracing and conceptual questions, with explanations and why each wrong option is wrong.",
  },
  {
    icon: Puzzle,
    title: "Graduate-level problem sets",
    body: "Derivations, proofs and algorithm design problems with stated assumptions. Hints arrive one at a time; full solutions only when you ask.",
  },
  {
    icon: Layers,
    title: "Spaced repetition that respects your time",
    body: "Cloze, equation and code-completion cards scheduled by a modern memory model, each with the excerpt it came from.",
  },
  {
    icon: MessagesSquare,
    title: "A tutor that reads your materials, not the internet",
    body: "It asks before it tells, guides one step at a time, and says so plainly when something is not in your sources.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Brand />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Button asChild variant="ghost">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto max-w-4xl px-4 pt-16 pb-20 text-center sm:px-6 sm:pt-24">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden /> Built for physics, mathematics, CS and engineering coursework
          </p>
          <h1 className="font-serif text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">
            Study your lectures, not your notes about them.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
            Upload recordings, slides and papers. Get a searchable transcript and study materials that keep your equations intact and cite
            the exact timestamp or page behind every statement.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="#principles">How we handle your content</Link>
            </Button>
          </div>
        </section>

        <section aria-labelledby="features-heading" className="border-y bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="features-heading" className="sr-only">
              Features
            </h2>
            <ul className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }) => (
                <li key={title}>
                  <Icon className="size-5 text-primary" aria-hidden />
                  <h3 className="mt-3 font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="principles" aria-labelledby="principles-heading" className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
          <h2 id="principles-heading" className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Lock className="size-5" aria-hidden /> Your content, your learning
          </h2>
          <div className="mt-6 grid gap-8 sm:grid-cols-2">
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <h3 className="font-semibold text-foreground">Privacy</h3>
              <p>
                Study sets are private by default. We process what you upload only to build your study resources, and we never train models
                on it unless you opt in separately. Delete any source — or your whole account — permanently, and export what you have made.
              </p>
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
              <h3 className="font-semibold text-foreground">Academic integrity</h3>
              <p>
                LectureForge is built for learning. The tutor gives hints before answers, generated exercises and solutions are always
                labelled as AI-generated, and full solutions appear only when you explicitly ask. Follow your course&apos;s rules on AI
                assistance.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-6">
          <span>© {new Date().getFullYear()} LectureForge</span>
          <span>Only upload material you own or have permission to use.</span>
        </div>
      </footer>
    </div>
  );
}
