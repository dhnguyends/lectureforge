"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { MediaView } from "@/lib/contracts/viewer";

export type PlayerHandle = {
  seek(ms: number, play?: boolean): void;
  togglePlay(): void;
  skip(deltaMs: number): void;
};

type YTPlayer = {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
};
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer; PlayerState: { PLAYING: number } };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function loadYouTubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  return new Promise((resolve) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    }
  });
}

/**
 * Plays a recording from a short-lived signed URL, with generated captions,
 * or embeds YouTube's own player for YouTube sources. Reports the current time
 * so the transcript can follow along, and exposes seek/play to the page.
 */
export const MediaPlayer = forwardRef<PlayerHandle, { media: MediaView; captionsUrl: string; onTime: (ms: number) => void; onExpired: () => void }>(
  function MediaPlayer({ media, captionsUrl, onTime, onExpired }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const ytHost = useRef<HTMLDivElement>(null);
    const yt = useRef<YTPlayer | null>(null);
    const pendingSeek = useRef<number | null>(null);
    const [useFallback, setUseFallback] = useState(false);
    const src = useFallback ? media.audioFallbackUrl : media.url;
    const isVideo = !useFallback && (media.mimeType?.startsWith("video/") ?? false);

    useImperativeHandle(ref, () => ({
      seek(ms, play = true) {
        if (yt.current) {
          yt.current.seekTo(ms / 1000, true);
          if (play) yt.current.playVideo();
          return;
        }
        const el = videoRef.current;
        if (!el) return;
        if (el.readyState < 1) pendingSeek.current = ms;
        else el.currentTime = ms / 1000;
        if (play) void el.play().catch(() => undefined);
      },
      togglePlay() {
        if (yt.current) {
          if (yt.current.getPlayerState() === window.YT?.PlayerState.PLAYING) yt.current.pauseVideo();
          else yt.current.playVideo();
          return;
        }
        const el = videoRef.current;
        if (el) (el.paused ? el.play() : Promise.resolve(el.pause())).catch(() => undefined);
      },
      skip(deltaMs) {
        if (yt.current) yt.current.seekTo(Math.max(0, yt.current.getCurrentTime() + deltaMs / 1000), true);
        else if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + deltaMs / 1000);
      },
    }));

    // YouTube: official embedded player, polled for the current time.
    useEffect(() => {
      if (!media.youtubeId || !ytHost.current) return;
      let timer: ReturnType<typeof setInterval> | undefined;
      let cancelled = false;
      void loadYouTubeApi().then(() => {
        if (cancelled || !ytHost.current || !window.YT) return;
        yt.current = new window.YT.Player(ytHost.current, {
          videoId: media.youtubeId,
          playerVars: { rel: 0, modestbranding: 1, cc_load_policy: 0 },
          events: {
            onReady: () => {
              if (pendingSeek.current !== null) yt.current?.seekTo(pendingSeek.current / 1000, true);
              timer = setInterval(() => yt.current && onTime(yt.current.getCurrentTime() * 1000), 250);
            },
          },
        });
      });
      return () => {
        cancelled = true;
        if (timer) clearInterval(timer);
        yt.current?.destroy();
        yt.current = null;
      };
    }, [media.youtubeId, onTime]);

    if (media.youtubeId) {
      return (
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
          <div ref={ytHost} className="h-full w-full" title={`YouTube player: ${media.title}`} />
        </div>
      );
    }

    if (!src) {
      return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">The recording file is not available for playback.</p>;
    }

    const common = {
      ref: videoRef,
      src,
      controls: true,
      preload: "metadata" as const,
      onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => onTime(e.currentTarget.currentTime * 1000),
      onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => {
        if (pendingSeek.current !== null) {
          e.currentTarget.currentTime = pendingSeek.current / 1000;
          pendingSeek.current = null;
        }
      },
      onError: () => {
        // Expired signature or an unplayable container: try the extracted audio, then refresh the URL.
        if (!useFallback && media.audioFallbackUrl) setUseFallback(true);
        else onExpired();
      },
    };

    return isVideo ? (
      <video {...common} className="aspect-video w-full rounded-xl bg-black" aria-label={`Recording: ${media.title}`}>
        <track kind="captions" src={captionsUrl} srcLang="en" label="Transcript" default />
      </video>
    ) : (
      <div className="rounded-xl border bg-card p-4">
        <audio {...common} className="w-full" aria-label={`Recording: ${media.title}`}>
          <track kind="captions" src={captionsUrl} srcLang="en" label="Transcript" />
        </audio>
      </div>
    );
  },
);
