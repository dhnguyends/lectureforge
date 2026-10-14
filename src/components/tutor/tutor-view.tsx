"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookMarked,
  ImagePlus,
  Lightbulb,
  Loader2,
  MessageSquarePlus,
  Mic,
  RefreshCcw,
  SearchX,
  Send,
  Square,
  Swords,
  Trash2,
  Unlock,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import type { ConversationSummary, ConversationView, TutorAnchorView, TutorMessageView, TutorStreamEventWire } from "@/lib/contracts/tutor";
import { cn } from "@/lib/utils";
import { TutorMarkdown, where } from "./tutor-markdown";
import { useVoiceInput } from "./use-voice-input";

type Action = "hint" | "explain_differently" | "show_source" | "challenge" | "reveal_solution";
const ACTIONS: { action: Action; label: string; icon: LucideIcon }[] = [
  { action: "hint", label: "Hint", icon: Lightbulb },
  { action: "explain_differently", label: "Explain differently", icon: RefreshCcw },
  { action: "show_source", label: "Show source", icon: BookMarked },
  { action: "challenge", label: "Challenge me", icon: Swords },
  { action: "reveal_solution", label: "Reveal solution", icon: Unlock },
];

type Pending = { user: TutorMessageView | null; text: string; anchors: TutorAnchorView[]; noSourceMatch: boolean; fromImageOnly: boolean };

export function TutorView({ studySetId, initialConversations, model }: { studySetId: string; initialConversations: ConversationSummary[]; model: string }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["tutor-conversations", studySetId],
    queryFn: () => apiFetch<{ conversations: ConversationSummary[] }>(`/api/study-sets/${studySetId}/tutor/conversations`),
    initialData: { conversations: initialConversations },
  });
  const [activeId, setActiveId] = useState<string | null>(initialConversations[0]?.id ?? null);
  const convo = useQuery({
    queryKey: ["tutor-conversation", activeId],
    queryFn: () => apiFetch<ConversationView>(`/api/study-sets/${studySetId}/tutor/conversations/${activeId}`),
    enabled: Boolean(activeId),
  });

  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const voice = useVoiceInput(useCallback((t: string) => setText((prev) => (prev ? `${prev} ${t}` : t)), []));

  const messages = convo.data?.messages ?? [];
  // Braces matter: scrollIntoView returns a Promise in current browsers, and an
  // effect must return nothing or a cleanup function.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending?.text]);

  const newConversation = async () => {
    const { id } = await apiFetch<{ id: string }>(`/api/study-sets/${studySetId}/tutor/conversations`, { method: "POST", json: {} });
    await qc.invalidateQueries({ queryKey: ["tutor-conversations", studySetId] });
    setActiveId(id);
    return id;
  };

  const remove = async (id: string) => {
    await apiFetch(`/api/study-sets/${studySetId}/tutor/conversations/${id}`, { method: "DELETE" });
    if (id === activeId) setActiveId(null);
    await qc.invalidateQueries({ queryKey: ["tutor-conversations", studySetId] });
  };

  const send = async (action?: Action) => {
    if (pending) return;
    const body = text.trim();
    if (!body && !action) return;
    setError(null);
    const id = activeId ?? (await newConversation());
    const form = new FormData();
    form.set("text", body);
    if (action) form.set("action", action);
    if (image) form.set("image", image);
    setText("");
    setImage(null);
    setPending({ user: null, text: "", anchors: [], noSourceMatch: false, fromImageOnly: false });
    abort.current = new AbortController();

    try {
      const res = await fetch(`/api/study-sets/${studySetId}/tutor/conversations/${id}/messages`, { method: "POST", body: form, signal: abort.current.signal });
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new ApiClientError(res.status, "tutor", err?.error?.message ?? "The tutor could not answer.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) >= 0) {
          const line = buffer.slice(0, sep).replace(/^data: /, "");
          buffer = buffer.slice(sep + 2);
          const event = JSON.parse(line) as TutorStreamEventWire;
          if (event.type === "user") setPending((p) => p && { ...p, user: event.message });
          else if (event.type === "sources") setPending((p) => p && { ...p, anchors: event.anchors, noSourceMatch: event.noSourceMatch, fromImageOnly: event.fromImageOnly });
          else if (event.type === "delta") setPending((p) => p && { ...p, text: p.text + event.text });
          else if (event.type === "error") setError(event.message);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError(err instanceof ApiClientError ? err.message : "Can't reach the tutor right now.");
    } finally {
      abort.current = null;
      await qc.invalidateQueries({ queryKey: ["tutor-conversation", id] });
      await qc.invalidateQueries({ queryKey: ["tutor-conversations", studySetId] });
      setPending(null);
    }
  };

  const conversations = list.data?.conversations ?? [];
  const busy = Boolean(pending);

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-2" aria-label="Conversations">
        <Button variant="outline" className="w-full" onClick={() => void newConversation()} disabled={busy}>
          <MessageSquarePlus aria-hidden /> New conversation
        </Button>
        <ul className="space-y-1">
          {conversations.map((c) => (
            <li key={c.id} className="group flex items-center">
              <button
                type="button"
                onClick={() => setActiveId(c.id)}
                aria-current={c.id === activeId ? "true" : undefined}
                className={cn("min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", c.id === activeId && "bg-accent font-medium")}
              >
                {c.title}
              </button>
              <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => void remove(c.id)} aria-label={`Delete conversation ${c.title}`}>
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-h-[32rem] flex-col rounded-xl border bg-card lg:h-[calc(100dvh-13rem)]" aria-label="Tutor conversation">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
          {messages.length === 0 && !pending && (
            <div className="mx-auto max-w-md py-10 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Ask about anything in your sources.</p>
              <p className="mt-1">
                The tutor answers from your lectures, slides and notes, cites where each point comes from, and helps you reason — hints first, full solutions only when you ask.
              </p>
            </div>
          )}
          {messages.map((m) => (
            <Bubble key={m.id} message={m} studySetId={studySetId} />
          ))}
          {pending && (
            <>
              {pending.user && <Bubble message={pending.user} studySetId={studySetId} />}
              <div className="max-w-[46rem] space-y-2">
                {pending.noSourceMatch && <NoMatchBadge />}
                {pending.fromImageOnly && <ImageOnlyBadge />}
                {pending.text ? (
                  <TutorMarkdown content={pending.text} anchors={pending.anchors} studySetId={studySetId} />
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    {pending.anchors.length ? `Reading ${pending.anchors.length} passage${pending.anchors.length === 1 ? "" : "s"} from your sources…` : "Thinking…"}
                  </p>
                )}
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div ref={bottom} />
        </div>

        <div className="space-y-2 border-t p-3">
          {messages.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tutor actions">
              {ACTIONS.map(({ action, label, icon: Icon }) => (
                <Button key={action} variant="outline" size="sm" className="h-7 text-xs" onClick={() => void send(action)} disabled={busy}>
                  <Icon aria-hidden /> {label}
                </Button>
              ))}
            </div>
          )}
          {image && (
            <div className="flex items-center gap-2 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a file the user picked */}
              <img src={URL.createObjectURL(image)} alt="Attached" className="size-12 rounded border object-cover" />
              <span className="truncate">{image.name}</span>
              <Button variant="ghost" size="icon" className="size-6" onClick={() => setImage(null)} aria-label="Remove image">
                <X className="size-3" />
              </Button>
            </div>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                setImage(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <Button type="button" variant="ghost" size="icon" onClick={() => fileInput.current?.click()} aria-label="Attach a diagram or photo" disabled={busy}>
              <ImagePlus />
            </Button>
            {voice.supported && (
              <Button
                type="button"
                variant={voice.state === "recording" ? "destructive" : "ghost"}
                size="icon"
                onClick={() => (voice.state === "recording" ? voice.stop() : void voice.start())}
                aria-label={voice.state === "recording" ? "Stop recording" : "Speak your question"}
                aria-pressed={voice.state === "recording"}
                disabled={busy || voice.state === "transcribing"}
              >
                {voice.state === "transcribing" ? <Loader2 className="animate-spin" /> : <Mic />}
              </Button>
            )}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={Math.min(6, Math.max(1, text.split("\n").length))}
              placeholder={voice.state === "recording" ? "Listening… press the microphone again to stop" : "Ask about your lecture (Shift+Enter for a new line)"}
              aria-label="Message to the tutor"
              className="min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
              disabled={busy}
            />
            {busy ? (
              <Button type="button" variant="outline" size="icon" onClick={() => abort.current?.abort()} aria-label="Stop the reply">
                <Square />
              </Button>
            ) : (
              <Button type="submit" size="icon" aria-label="Send" disabled={!text.trim()}>
                <Send />
              </Button>
            )}
          </form>
          <p className="flex flex-wrap justify-between gap-2 text-[0.7rem] text-muted-foreground">
            <span>{voice.error ?? `Runs locally with ${model} via Ollama. Answers can be wrong — check the cited passages.`}</span>
          </p>
        </div>
      </section>
    </div>
  );
}

function ImageOnlyBadge() {
  return (
    <Badge variant="inference">
      <ImagePlus aria-hidden /> From your attached image — not in your sources
    </Badge>
  );
}

function NoMatchBadge() {
  return (
    <Badge variant="inference">
      <SearchX aria-hidden /> Not found in your sources
    </Badge>
  );
}

function Bubble({ message: m, studySetId }: { message: TutorMessageView; studySetId: string }) {
  if (m.role === "USER") {
    return (
      <div className="ml-auto w-fit max-w-[85%] space-y-2 rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
        {m.images.map((img) => (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          <img key={img.url} src={img.url} alt="Attached by you" className="max-h-48 rounded-lg" />
        ))}
        <p className="whitespace-pre-wrap">{m.content}</p>
      </div>
    );
  }
  return (
    <div className="max-w-[46rem] space-y-2">
      {m.noSourceMatch && <NoMatchBadge />}
      {m.fromImageOnly && <ImageOnlyBadge />}
      <TutorMarkdown content={m.content} anchors={m.anchors} studySetId={studySetId} />
      {m.anchors.length > 0 && (
        <p className="text-xs text-muted-foreground">
          From your sources: {m.anchors.map((a) => `${a.sourceTitle} (${where(a)})`).join(" · ")}
        </p>
      )}
    </div>
  );
}
