import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUp, Check, Circle, Mic, MicOff, PanelLeftClose, PanelLeftOpen, Trash2, Volume2, X } from "lucide-react";
import { readAssistantMessages, useApp } from "@/lib/store";
import { applyAssistantAction, runCommand } from "@/lib/ai-agent";
import { ASSISTANT_CAPABILITIES, ASSISTANT_LIMITATIONS } from "@/lib/assistant-capabilities";
import { cn } from "@/lib/utils";
import {
  DEFAULT_VOICE_PREFERENCES,
  readVoicePreferences,
  VOICE_SETTINGS_EVENT,
  type VoicePreferences,
} from "@/lib/voice/voice-session";
import { useVoiceConversation } from "@/lib/voice/use-voice-conversation";

const EXAMPLES = ["Find recent global GCOV products", "Show source-reported wildfire context", "Find observations for the current area", "Open the latest NISAR acquisition"];

function renderMessage(text: string) {
  const inline = (value: string) => value.split(/(\*\*[^*]+\*\*)/g).map((part, partIndex) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={partIndex} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
      : part,
  );
  return text.split("\n").map((line, index) => {
    const source = line.match(/^(\s*USGS record:\s*)(https:\/\/\S+)$/);
    if (source) {
      try {
        const sourceUrl = source[2];
        if (!sourceUrl) return <span key={index}>{line}<br /></span>;
        const url = new URL(sourceUrl);
        if (url.protocol === "https:" && url.hostname === "earthquake.usgs.gov") {
          return <span key={index}>{source[1]}<a className="break-all text-primary underline" href={url.href} target="_blank" rel="noopener noreferrer">Open event ↗</a><br /></span>;
        }
      } catch {
        return <span key={index}>{line}<br /></span>;
      }
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) return <h3 key={index} className="mt-3 text-[13px] font-semibold leading-snug text-foreground">{inline(heading[1]!)}</h3>;
    const ordered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (ordered) {
      return (
        <div key={index} className="my-2 flex gap-2 text-[14px] leading-relaxed">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-primary/40 font-mono text-[10px] text-primary">{ordered[1]}</span>
          <span>{inline(ordered[2]!)}</span>
        </div>
      );
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) return <div key={index} className="my-2 flex gap-2 pl-1 text-[14px] leading-relaxed"><span className="text-primary">·</span><span>{inline(bullet[1]!)}</span></div>;
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return null;
    if (/^\s*\|.+\|\s*$/.test(line)) {
      const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
      return (
        <div key={index} className="my-1 grid gap-2 rounded border border-border/70 bg-background/35 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground" style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}>
          {cells.map((cell, cellIndex) => <span key={cellIndex} className="break-words">{inline(cell)}</span>)}
        </div>
      );
    }
    return line.trim()
      ? <p key={index} className="my-2 break-words text-[14px] leading-relaxed text-foreground">{inline(line)}</p>
      : <div key={index} className="h-1" />;
  });
}

export function AssistantMessage({ text }: { text: string }) {
  return <div className="break-words text-[13px] leading-relaxed">{renderMessage(text)}</div>;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select, [contenteditable='true']") !== null;
}

export function CommandBar() {
  const [v, setV] = useState("");
  const [showCapabilities, setShowCapabilities] = useState(false);
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
  const [voicePreferences, setVoicePreferences] = useState<VoicePreferences>(DEFAULT_VOICE_PREFERENCES);
  const navigate = useNavigate();
  const active = useApp((s) => s.aiActive);
  const setActive = useApp((s) => s.setAIActive);
  const restoreMessages = useApp((s) => s.restoreAIMessages);
  const clearMessages = useApp((s) => s.clearAIMessages);
  const messages = useApp((s) => s.aiMessages);
  const steps = useApp((s) => s.aiSteps);
  const title = useApp((s) => s.aiTitle);
  const feed = useRef<HTMLDivElement>(null);
  const captionsFeed = useRef<HTMLDivElement>(null);

  const navigateToRoute = useCallback((route: string) => {
    void navigate({ to: route as never });
  }, [navigate]);
  const runVoiceCommand = useCallback((transcript: string, signal: AbortSignal, onResponse: (text: string) => Promise<void>) =>
    runCommand(transcript, {
      voice: true,
      signal,
      onResponse,
      onNavigate: navigateToRoute,
    }), [navigateToRoute]);
  const voice = useVoiceConversation({
    preferences: voicePreferences,
    dependencies: { runCommand: runVoiceCommand },
  });
  const voiceStart = voice.start;
  const voiceCancel = voice.cancel;
  const voiceState = voice.state;

  useEffect(() => {
    feed.current?.scrollTo({ top: 99999, behavior: "smooth" });
  }, [messages, steps]);

  useEffect(() => {
    if (active) setCollapsed(false);
    else if (window.matchMedia("(max-width: 760px)").matches) setCollapsed(true);
  }, [active]);

  useEffect(() => {
    captionsFeed.current?.scrollTo({ top: captionsFeed.current.scrollHeight, behavior: "smooth" });
  }, [voice.captions]);

  useEffect(() => {
    const updatePreferences = () => setVoicePreferences(readVoicePreferences());
    updatePreferences();
    window.addEventListener(VOICE_SETTINGS_EVENT, updatePreferences);
    return () => window.removeEventListener(VOICE_SETTINGS_EVENT, updatePreferences);
  }, []);

  useEffect(() => {
    restoreMessages(readAssistantMessages());
  }, [restoreMessages]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.code !== "Space" || isEditableTarget(event.target)) return;
      if (!voicePreferences.inputEnabled) return;
      event.preventDefault();
      if (voiceState === "idle" || voiceState === "error" || voiceState === "speaking") voiceStart();
      else voiceCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [voiceCancel, voiceStart, voiceState, voicePreferences.inputEnabled]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && voiceState !== "idle" && voiceState !== "error") voiceCancel();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [voiceCancel, voiceState]);

  const submit = (text: string) => {
    if (!text.trim() || steps) return;
    if (voice.state !== "idle" && voice.state !== "error") voice.cancel();
    setV("");
    void runCommand(text, { onNavigate: navigateToRoute });
  };
  const runAction = (action: string) => {
    if (action.startsWith("navigate:")) {
      const destination = action.slice("navigate:".length) as "/" | "/analyze" | "/data" | "/observations" | "/events" | "/discover";
      void navigate({ to: destination as never });
      setActive(false);
      return;
    }
    if (applyAssistantAction(action)) return;
    submit(action);
  };

  const isMicActive = voice.state === "starting" || voice.state === "listening" || voice.state === "conversation";
  const isBusy = voice.state === "transcribing" || voice.state === "processing";
  const voiceStatusText = voice.state === "starting"
    ? "Starting microphone…"
    : voice.state === "listening"
      ? voice.secondsRemaining > 0
        ? `Listening for a follow-up · ${voice.secondsRemaining}s remaining`
        : "Listening — speak, then pause"
      : voice.state === "conversation"
        ? `Conversation open · listening for a follow-up · ${voice.secondsRemaining}s remaining`
        : voice.state === "transcribing"
          ? "Transcribing your voice…"
          : voice.state === "processing"
            ? "Working on your command…"
            : voice.state === "speaking"
              ? "Speaking · tap the microphone to interrupt"
              : voice.state === "error"
                ? voice.error
                : "";

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="earth-agent-collapsed glass flex items-center gap-2 px-3 py-2 font-mono text-[10px] tracking-[0.16em] text-primary shadow-xl"
        aria-label="Expand Third Eye assistant"
      >
        <PanelLeftOpen className="size-4" /> THIRD EYE
      </button>
    );
  }

  return (
    <div className="earth-agent-panel glass scroll-thin flex h-full w-full max-w-[480px] flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.2em] text-primary">
          <span className={cn("size-1.5 rounded-full bg-primary", (active || steps) && "animate-ai-pulse")} />THIRD EYE
        </span>
        <div className="flex items-center gap-2">
          {messages.length > 0 && <button onClick={clearMessages} aria-label="Clear conversation" title="Clear the saved conversation from this browser"><Trash2 className="size-3.5 text-subtle hover:text-foreground" /></button>}
          <button type="button" onClick={() => setCollapsed(true)} aria-label="Collapse assistant panel" title="Collapse assistant panel">
            <PanelLeftClose className="size-4 text-subtle hover:text-foreground" />
          </button>
        </div>
      </div>
      {active && (messages.length > 0 || steps) && (
        <div className="min-h-0 flex-1 animate-fade-up overflow-hidden">
          <div ref={feed} className="scroll-thin h-full max-h-[min(42dvh,420px)] space-y-3 overflow-y-auto px-4 py-3">
            {messages.map((message) => message.role === "user" ? (
              <div key={message.id} className="font-mono text-[11px] text-subtle">
                {message.voice && <span className="mr-2 text-[9px] tracking-wider text-primary">VOICE TRANSCRIPT</span>}
                › {message.text}
              </div>
            ) : (
              <div key={message.id} className="border-l border-primary/50 pl-3">
                {message.voice && <div className="mb-1 font-mono text-[9px] tracking-wider text-primary">THIRD EYE · SPOKEN REPLY</div>}
                <AssistantMessage text={message.text} />
                {message.actions && (
                  <div className="mt-2 flex gap-1.5">
                    {message.actions.filter((item) => item.run !== "noop").map((item) => (
                      <button key={item.label} onClick={() => runAction(item.run)} className="rounded-md border border-border px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase text-muted-foreground hover:border-primary hover:text-primary">{item.label}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {steps && (
              <div className="space-y-1">
                <div className="label-xs mb-1.5 text-primary">{title}</div>
                {steps.map((step) => (
                  <div key={step.label} className={cn("flex items-center gap-2 text-[12px]", step.status === "pending" ? "text-subtle" : "text-foreground")}>
                    {step.status === "done"
                      ? <Check className="size-3 text-ok" />
                      : step.status === "active"
                        ? <span className="size-2 rounded-full bg-primary animate-ai-pulse" />
                        : step.status === "error"
                          ? <X className="size-3 text-destructive" />
                          : <Circle className="size-2.5" />}
                    {step.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {!active && messages.length === 0 && (
        <>
          <div className="command-examples mb-3 flex flex-wrap justify-start gap-2">
            {EXAMPLES.map((example) => (
              <button key={example} onClick={() => submit(example)} className="command-example-chip glass px-3 py-2 text-[13px] text-muted-foreground hover:text-foreground">{example}</button>
            ))}
            <button
              type="button"
              aria-expanded={showCapabilities}
              aria-controls="assistant-capabilities"
              onClick={() => setShowCapabilities(open => !open)}
              className="command-guide-toggle glass px-3 py-2 font-mono text-[13px] tracking-wide text-primary hover:text-foreground"
            >
              {showCapabilities ? "CLOSE ASK GUIDE" : "WHAT CAN I ASK?"}
            </button>
          </div>
          {showCapabilities && (
            <section id="assistant-capabilities" aria-label="Third Eye capabilities" className="assistant-capabilities glass mb-3 max-h-[min(58vh,560px)] space-y-4 overflow-y-auto p-4">
              <div className="label-xs text-primary">THIRD EYE · WHAT YOU CAN DO</div>
              <div className="grid gap-4 sm:grid-cols-2">
                {ASSISTANT_CAPABILITIES.map(group => (
                  <section key={group.id} className="assistant-capability-group border-l border-border pl-3">
                    <h2 className="text-base font-semibold leading-snug">{group.title}</h2>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{group.description}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {group.examples.map(example => (
                        <button key={example} onClick={() => { setShowCapabilities(false); submit(example); }} className="assistant-example rounded-md border border-border px-3 py-2 text-left text-sm leading-snug text-foreground/90 hover:border-primary hover:text-foreground">
                          {example}
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <section className="border-t border-border pt-3">
                <h2 className="label-xs text-amber">WHAT IS NOT AVAILABLE</h2>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
                  {ASSISTANT_LIMITATIONS.map(limitation => <li key={limitation}>{limitation}</li>)}
                </ul>
              </section>
            </section>
          )}
        </>
      )}
      <form onSubmit={(event) => { event.preventDefault(); submit(v); }}
        className={cn("glass flex items-center gap-3 px-4 py-2.5 transition-shadow", active && "glow-cyan")}>
        <span className={cn("size-2 rounded-full bg-primary", (active || steps) && "animate-ai-pulse")} />
        <button
          type="button"
          onClick={() => {
            if (isMicActive) voice.cancel();
            else voice.start();
          }}
          disabled={!voicePreferences.inputEnabled || isBusy}
          aria-keyshortcuts="Control+Shift+Space Meta+Shift+Space"
          aria-label={isMicActive ? "Stop voice listening" : voice.state === "speaking" ? "Interrupt assistant and speak" : "Start voice command"}
          title={!voicePreferences.inputEnabled
            ? "Voice input is off in Settings."
            : voice.state === "speaking"
              ? "Click to stop speech and start a voice command."
              : isMicActive
                ? "Stop microphone listening."
                : "Start a voice command."}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-primary transition-colors hover:border-primary disabled:opacity-50",
            isMicActive && "animate-ai-pulse border-primary bg-primary/10",
          )}
        >
          {voice.state === "speaking" ? <Volume2 className="size-4" /> : isMicActive ? <MicOff className="size-4" /> : <Mic className="size-4" />}
        </button>
        {isMicActive && (
          <span className="flex h-4 items-center gap-0.5" aria-hidden="true">
            {[0, 1, 2].map(index => (
              <span
                key={index}
                className="w-0.5 rounded-full bg-primary transition-[height] duration-75"
                style={{ height: `${Math.max(3, 3 + voice.level * (10 + index * 3))}px` }}
              />
            ))}
          </span>
        )}
        <input value={v} onChange={(event) => setV(event.target.value)} onFocus={() => setActive(true)} placeholder="Ask Third Eye to explore NISAR or control the globe…" aria-label="Ask Third Eye" className="flex-1 bg-transparent text-[14px] placeholder:text-subtle focus:outline-none" />
        <button type="submit" disabled={!v.trim()} className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:bg-elevated disabled:text-subtle" aria-label="Send"><ArrowUp className="size-4" /></button>
      </form>
      {voiceStatusText && (
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-center" role="status" aria-live="polite">
          <p className={cn("text-[10px]", voice.state === "error" ? "text-destructive" : "font-mono text-muted-foreground")}>{voiceStatusText}</p>
          {(voice.state === "transcribing" || voice.state === "processing" || voice.state === "speaking" || voice.state === "conversation" || voice.state === "starting") && (
            <button type="button" onClick={voice.cancel} className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground">Cancel</button>
          )}
          {voice.state === "error" && (
            <>
              <button type="button" onClick={voice.retry} className="text-[10px] text-primary underline underline-offset-2">Retry</button>
              {voice.transcript && (
                <button
                  type="button"
                  onClick={() => {
                    setV(voice.transcript);
                    voice.cancel();
                  }}
                  className="text-[10px] text-primary underline underline-offset-2"
                >
                  Use transcript as text
                </button>
              )}
            </>
          )}
        </div>
      )}
      {voice.state === "idle" && (
        <p className="mt-1 text-center text-[9px] text-subtle">
          {voicePreferences.inputEnabled
            ? "Voice starts only when you choose it · Ctrl/Cmd+Shift+Space · no wake word"
            : "Voice input is off · type a command or enable it in Settings"}
        </p>
      )}
      {(voice.captions.length > 0 || (voice.state !== "idle" && voice.state !== "error")) && (
        <section className="glass mt-2 overflow-hidden" aria-label="Voice captions">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <div>
              <div className="label-xs text-primary">VOICE CAPTIONS</div>
              <p className="mt-0.5 text-[9px] text-subtle">Your words appear after transcription; reply captions match the spoken response.</p>
            </div>
            {voice.captions.length > 0 && (
              <button
                type="button"
                onClick={voice.clearCaptions}
                className="shrink-0 rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-elevated hover:text-foreground"
                aria-label="Clear voice captions"
              >
                Clear
              </button>
            )}
          </div>
          <div
            ref={captionsFeed}
            className="scroll-thin max-h-40 space-y-2 overflow-y-auto p-3"
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            aria-label="Voice conversation transcript"
          >
            {voice.captions.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Your recognized words and Third Eye’s spoken replies will appear here.</p>
            ) : voice.captions.map((caption, index) => {
              const isCurrentReply = caption.speaker === "third-eye" &&
                voice.state === "speaking" &&
                index === voice.captions.length - 1;
              return (
                <div
                  key={caption.id}
                  className={cn(
                    "max-w-[92%] border-l-2 px-2.5 py-1.5",
                    caption.speaker === "you"
                      ? "border-border text-muted-foreground"
                      : "border-primary/60 text-foreground",
                  )}
                >
                  <div className="mb-0.5 font-mono text-[9px] tracking-wider text-primary">
                    {caption.speaker === "you" ? "YOU SAID" : isCurrentReply ? "THIRD EYE · SPEAKING" : "THIRD EYE SAID"}
                  </div>
                  <p className="break-words text-[12px] leading-relaxed">{caption.text}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
