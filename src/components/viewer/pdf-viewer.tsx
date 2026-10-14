"use client";

import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PdfDoc = import("pdfjs-dist").PDFDocumentProxy;
export type PageRegion = { page: number; bbox: [number, number, number, number]; label?: string; tone?: "cited" | "note" };

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
function pdfjs() {
  pdfjsPromise ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    return lib;
  });
  return pdfjsPromise;
}

/**
 * Renders a PDF (or slides converted to PDF) page by page as the reader
 * scrolls, with a selectable text layer and highlight boxes for cited regions
 * and the student's page notes. Regions are normalised [x0,y0,x1,y1], top-left origin.
 */
export function PdfViewer({
  url,
  initialPage,
  regions,
  focus,
  onPageChange,
}: {
  url: string;
  initialPage: number | null;
  regions: PageRegion[];
  /** Region to scroll to (e.g. the opened citation). */
  focus: PageRegion | null;
  onPageChange?: (page: number) => void;
}) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1.25);
  const [page, setPage] = useState(initialPage ?? 1);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDoc | null = null;
    setDoc(null);
    setError(null);
    void pdfjs()
      .then((lib) => lib.getDocument({ url, isEvalSupported: false }).promise)
      .then((d) => {
        loaded = d;
        if (!cancelled) setDoc(d);
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : "Could not open this document."));
    return () => {
      cancelled = true;
      void loaded?.destroy();
    };
  }, [url]);

  const goTo = useCallback((n: number, behavior: ScrollBehavior = "smooth") => {
    const el = container.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    el?.scrollIntoView({ block: "start", behavior });
  }, []);

  // Jump to the requested page/region once pages exist.
  useEffect(() => {
    if (!doc) return;
    const target = focus?.page ?? initialPage;
    if (target) requestAnimationFrame(() => goTo(target, "auto"));
  }, [doc, focus, initialPage, goTo]);

  // Track the page in view for the toolbar.
  useEffect(() => {
    if (!doc || !container.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const n = Number((visible.target as HTMLElement).dataset.page);
          setPage(n);
          onPageChange?.(n);
        }
      },
      { root: container.current, threshold: [0.25, 0.6] },
    );
    container.current.querySelectorAll("[data-page]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [doc, onPageChange]);

  if (error) return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-destructive">{error}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border bg-muted/40">
      <div className="flex items-center gap-1 border-b bg-card px-2 py-1.5">
        <Button variant="ghost" size="icon" className="size-8" onClick={() => goTo(Math.max(1, page - 1))} aria-label="Previous page" disabled={page <= 1}>
          <ChevronLeft />
        </Button>
        <span className="min-w-20 text-center text-sm tabular-nums" aria-live="polite">
          {doc ? `${page} / ${doc.numPages}` : "…"}
        </span>
        <Button variant="ghost" size="icon" className="size-8" onClick={() => goTo(Math.min(doc?.numPages ?? 1, page + 1))} aria-label="Next page" disabled={!doc || page >= doc.numPages}>
          <ChevronRight />
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setScale((s) => Math.max(0.6, s - 0.15))} aria-label="Zoom out">
            <ZoomOut />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setScale((s) => Math.min(3, s + 0.15))} aria-label="Zoom in">
            <ZoomIn />
          </Button>
        </div>
      </div>
      <div ref={container} className="min-h-0 flex-1 overflow-auto p-3" tabIndex={0} aria-label="Document pages">
        {!doc ? (
          <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Opening document…
          </p>
        ) : (
          <div className="mx-auto flex w-fit flex-col gap-3">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i + 1} doc={doc} number={i + 1} scale={scale} regions={regions.filter((r) => r.page === i + 1)} focused={focus?.page === i + 1 ? focus : null} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PdfPage({ doc, number, scale, regions, focused }: { doc: PdfDoc; number: number; scale: number; regions: PageRegion[]; focused: PageRegion | null }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [visible, setVisible] = useState(false);

  // Size placeholder immediately so scrolling to a page works before it renders.
  useEffect(() => {
    let cancelled = false;
    void doc.getPage(number).then((p) => {
      const vp = p.getViewport({ scale });
      if (!cancelled) setSize({ w: vp.width, h: vp.height });
    });
    return () => {
      cancelled = true;
    };
  }, [doc, number, scale]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && setVisible(true), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !size) return;
    let cancelled = false;
    let task: { cancel(): void } | null = null;
    void (async () => {
      const lib = await pdfjs();
      const p = await doc.getPage(number);
      const vp = p.getViewport({ scale });
      const c = canvas.current;
      if (!c || cancelled) return;
      const ratio = window.devicePixelRatio || 1;
      c.width = Math.floor(vp.width * ratio);
      c.height = Math.floor(vp.height * ratio);
      c.style.width = `${vp.width}px`;
      c.style.height = `${vp.height}px`;
      const ctx = c.getContext("2d")!;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const render = p.render({ canvasContext: ctx, viewport: vp });
      task = render;
      await render.promise.catch(() => undefined);
      if (cancelled || !textLayer.current) return;
      textLayer.current.replaceChildren();
      const tl = new lib.TextLayer({ textContentSource: await p.getTextContent(), container: textLayer.current, viewport: vp });
      await tl.render().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, size, doc, number, scale]);

  return (
    <div
      ref={host}
      data-page={number}
      className="relative scroll-mt-3 bg-white shadow-sm"
      style={size ? { width: size.w, height: size.h } : { width: 600, height: 800 }}
      aria-label={`Page ${number}`}
      role="region"
    >
      <canvas ref={canvas} className="absolute inset-0" aria-hidden />
      <div
        ref={textLayer}
        className="pdf-text-layer absolute inset-0 overflow-hidden leading-none [&>span]:absolute [&>span]:origin-top-left [&>span]:cursor-text [&>span]:whitespace-pre [&>span]:text-transparent"
        style={{ "--scale-factor": scale } as React.CSSProperties}
      />
      {regions.map((r, i) => {
        const isFocus = focused !== null && r.bbox.join() === focused.bbox.join();
        return (
          <div
            key={i}
            className={cn(
              "pointer-events-none absolute rounded-sm",
              r.tone === "note" ? "bg-yellow-300/30 ring-1 ring-yellow-500/60" : "bg-grounded/15 ring-2 ring-grounded/70",
              isFocus && "animate-pulse ring-4",
            )}
            style={{
              left: `${r.bbox[0] * 100}%`,
              top: `${r.bbox[1] * 100}%`,
              width: `${(r.bbox[2] - r.bbox[0]) * 100}%`,
              height: `${(r.bbox[3] - r.bbox[1]) * 100}%`,
            }}
            title={r.label}
          />
        );
      })}
      {focused && !regions.length && <div className="pointer-events-none absolute inset-0 ring-4 ring-grounded/60" />}
    </div>
  );
}
