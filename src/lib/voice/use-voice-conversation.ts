import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeVoiceAudio } from "../assistant-voice";
import {
  isMeaningfulTranscript,
  normalizeVoicePreferences,
  RecentTranscriptCache,
  secondsUntil,
  transitionVoiceState,
  type VoicePreferences,
  type VoiceState,
} from "./voice-session";
import { captureVoiceTurn, type VoiceCaptureMode } from "./voice-capture";
import { playVoiceResponse } from "./voice-playback";

export type VoiceCommandRunner = (
  transcript: string,
  signal: AbortSignal,
  onResponse: (text: string) => Promise<void>,
) => Promise<boolean>;

export interface VoiceCaption {
  id: number;
  speaker: "you" | "third-eye";
  text: string;
}

export interface VoiceConversationDependencies {
  runCommand: VoiceCommandRunner;
  capture?: typeof captureVoiceTurn;
  transcribe?: typeof transcribeVoiceAudio;
  speak?: typeof playVoiceResponse;
}

interface UseVoiceConversationOptions {
  preferences: VoicePreferences;
  dependencies: VoiceConversationDependencies;
}

const MAX_TRANSCRIPT_RETRIES = 2;
const MAX_CONVERSATION_ROUNDS = 6;

export function useVoiceConversation({ preferences, dependencies }: UseVoiceConversationOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setErrorState] = useState("");
  const [transcript, setTranscript] = useState("");
  const [level, setLevel] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [captions, setCaptions] = useState<VoiceCaption[]>([]);
  const levelRef = useRef(0);
  const captionIdRef = useRef(0);
  const stateRef = useRef<VoiceState>("idle");
  const preferencesRef = useRef(normalizeVoicePreferences(preferences));
  const dependenciesRef = useRef(dependencies);
  const controllerRef = useRef<AbortController | null>(null);
  const deadlineRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retriesRef = useRef(0);
  const roundsRef = useRef(0);
  const captureModeRef = useRef<VoiceCaptureMode>("manual");
  const transcriptCacheRef = useRef(new RecentTranscriptCache());
  const lastTranscriptRef = useRef("");
  const mountedRef = useRef(true);
  const beginCaptureRef = useRef<(mode: VoiceCaptureMode) => void>(() => {});
  const finishConversationRef = useRef<() => void>(() => {});

  useEffect(() => {
    dependenciesRef.current = dependencies;
  }, [dependencies]);

  const transition = useCallback((event: Parameters<typeof transitionVoiceState>[1]) => {
    const next = transitionVoiceState(stateRef.current, event);
    stateRef.current = next;
    if (mountedRef.current) setState(next);
  }, []);

  useEffect(() => {
    preferencesRef.current = normalizeVoicePreferences(preferences);
    const current = stateRef.current;
    const voiceActive = current !== "idle" && current !== "error";
    const followupActive = captureModeRef.current === "followup" &&
      (current === "starting" || current === "listening" || current === "conversation");
    if ((!preferencesRef.current.inputEnabled && voiceActive) ||
        (!preferencesRef.current.conversationModeEnabled && followupActive)) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (countdownRef.current !== null) clearInterval(countdownRef.current);
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
      timerRef.current = null;
      countdownRef.current = null;
      retryTimerRef.current = null;
      deadlineRef.current = 0;
      transition("cancel");
      if (mountedRef.current) setSecondsRemaining(0);
    }
  }, [preferences, transition]);

  const setError = useCallback((message: string) => {
    if (mountedRef.current) setErrorState(message);
  }, []);

  const appendCaption = useCallback((speaker: VoiceCaption["speaker"], text: string) => {
    const caption = { id: ++captionIdRef.current, speaker, text };
    if (mountedRef.current) setCaptions(current => [...current, caption].slice(-12));
  }, []);

  const clearCaptions = useCallback(() => {
    setCaptions([]);
  }, []);

  const clearConversationTimers = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (countdownRef.current !== null) clearInterval(countdownRef.current);
    if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    timerRef.current = null;
    countdownRef.current = null;
    retryTimerRef.current = null;
    deadlineRef.current = 0;
    if (mountedRef.current) setSecondsRemaining(0);
  }, []);

  const pauseConversationClock = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (countdownRef.current !== null) clearInterval(countdownRef.current);
    timerRef.current = null;
    countdownRef.current = null;
  }, []);

  const finishConversation = useCallback(() => {
    clearConversationTimers();
    controllerRef.current?.abort();
    controllerRef.current = null;
    transition("timeout");
  }, [clearConversationTimers, transition]);
  finishConversationRef.current = finishConversation;

  const armConversationClock = useCallback(() => {
    pauseConversationClock();
    const remaining = secondsUntil(deadlineRef.current);
    if (remaining <= 0) {
      finishConversationRef.current();
      return;
    }
    if (mountedRef.current) setSecondsRemaining(remaining);
    timerRef.current = setTimeout(() => finishConversationRef.current(), deadlineRef.current - Date.now());
    countdownRef.current = setInterval(() => {
      const next = secondsUntil(deadlineRef.current);
      if (mountedRef.current) setSecondsRemaining(next);
      if (next <= 0) finishConversationRef.current();
    }, 1_000);
  }, [pauseConversationClock]);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearConversationTimers();
    retriesRef.current = 0;
    roundsRef.current = 0;
    setError("");
    transition("cancel");
  }, [clearConversationTimers, setError, transition]);

  const runTranscript = useCallback(async (value: string, controller: AbortController, retrying = false) => {
    const clean = value.trim();
    if (!clean || controller.signal.aborted) return;
    setTranscript(clean);
    lastTranscriptRef.current = clean;
    if (!retrying) {
      const meaningful = isMeaningfulTranscript(clean);
      const unique = transcriptCacheRef.current.accept(clean) || captureModeRef.current === "manual";
      if (!meaningful || !unique) {
        if (controllerRef.current === controller) controllerRef.current = null;
        controller.abort();
        const followup = stateRef.current === "transcribing" && deadlineRef.current > Date.now();
        if (followup && retriesRef.current < MAX_TRANSCRIPT_RETRIES) {
          retriesRef.current += 1;
          setError(meaningful ? "I heard that already. Try a different phrase." : "I didn't catch a clear command. Try again.");
          transition("retry");
          armConversationClock();
          retryTimerRef.current = setTimeout(() => {
            if (stateRef.current === "conversation") beginCaptureRef.current("followup");
          }, 450);
        } else {
          clearConversationTimers();
          setError(meaningful ? "That sounded like a repeat. Try again or send the transcript as text." : "No clear speech was recognized. Try again or send the transcript as text.");
          transition("fail");
        }
        return;
      }
      appendCaption("you", clean);
    }

    if (stateRef.current === "transcribing") transition("process");
    else if (stateRef.current === "error") transition("retry");
    setError("");
    let speechFailed = false;
    let succeeded = false;
    try {
      succeeded = await dependenciesRef.current.runCommand(clean, controller.signal, async response => {
        if (!response.trim() || controller.signal.aborted || !preferencesRef.current.responsesEnabled) return;
        appendCaption("third-eye", response.trim());
        transition("speak");
        try {
          await (dependenciesRef.current.speak ?? playVoiceResponse)(response, controller.signal);
        } catch (reason) {
          if (controller.signal.aborted) return;
          speechFailed = true;
          setError(reason instanceof Error ? reason.message : "The assistant response could not be played.");
        }
      });
    } catch (reason) {
      if (controller.signal.aborted) return;
      clearConversationTimers();
      setError(reason instanceof Error ? reason.message : "The assistant could not complete that command.");
      controllerRef.current = null;
      transition("fail");
      return;
    }
    if (controller.signal.aborted || !mountedRef.current) return;
    controllerRef.current = null;
    if (!succeeded) {
      clearConversationTimers();
      setError("The assistant could not complete that command. Retry or send the transcript as text.");
      transition("fail");
      return;
    }
    if (speechFailed) {
      clearConversationTimers();
      transition("fail");
      return;
    }

    const nextPreferences = preferencesRef.current;
    if (!nextPreferences.conversationModeEnabled || roundsRef.current >= MAX_CONVERSATION_ROUNDS) {
      clearConversationTimers();
      transition("finish");
      return;
    }
    if (stateRef.current === "processing" || stateRef.current === "speaking") transition("continue");
    if (captureModeRef.current === "followup") roundsRef.current += 1;
    retriesRef.current = 0;
    captureModeRef.current = "followup";
    deadlineRef.current = Date.now() + nextPreferences.inactivityTimeoutSeconds * 1_000;
    armConversationClock();
    beginCaptureRef.current("followup");
  }, [appendCaption, armConversationClock, clearConversationTimers, setError, transition]);

  const beginCapture = useCallback((mode: VoiceCaptureMode) => {
    if (!preferencesRef.current.inputEnabled) {
      setError("Voice input is off. Turn it on in Settings or type your command.");
      transition("fail");
      return;
    }
    if (mode === "manual") {
      clearConversationTimers();
      retriesRef.current = 0;
      roundsRef.current = 0;
      lastTranscriptRef.current = "";
      setTranscript("");
      transition("activate");
    }
    else transition("followup");
    captureModeRef.current = mode;
    setError("");
    levelRef.current = 0;
    setLevel(0);
    const controller = new AbortController();
    controllerRef.current = controller;
    void (async () => {
      try {
        const audio = await (dependenciesRef.current.capture ?? captureVoiceTurn)(mode, controller.signal, {
          onReady: () => {
            if (controller.signal.aborted) return;
            transition(mode === "manual" ? "ready" : "monitor");
          },
          onSpeech: () => {
            if (controller.signal.aborted) return;
            pauseConversationClock();
            transition("speech");
          },
          onLevel: next => {
            if (mountedRef.current && Math.abs(next - levelRef.current) > 0.06) {
              levelRef.current = next;
              setLevel(next);
            }
          },
        });
        if (controller.signal.aborted || !mountedRef.current) return;
        if (!audio) {
          controllerRef.current = null;
          if (mode === "followup") {
            if (deadlineRef.current > Date.now() && retriesRef.current < MAX_TRANSCRIPT_RETRIES) {
              retriesRef.current += 1;
              transition("retry");
              armConversationClock();
              retryTimerRef.current = setTimeout(() => {
                if (stateRef.current === "conversation") beginCaptureRef.current("followup");
              }, 450);
            } else {
              clearConversationTimers();
              setError("I didn't catch a clear follow-up. You can try voice again or type your command.");
              transition("fail");
            }
          } else {
            setError("No speech was captured. Try again or type your command.");
            transition("fail");
          }
          return;
        }
        transition("captured");
        const turnController = controller;
        void (async () => {
          try {
            const value = await (dependenciesRef.current.transcribe ?? transcribeVoiceAudio)(audio, turnController.signal);
            if (!turnController.signal.aborted && mountedRef.current) await runTranscript(value, turnController);
          } catch (reason) {
            if (turnController.signal.aborted || !mountedRef.current) return;
            controllerRef.current = null;
            clearConversationTimers();
            setError(reason instanceof Error ? reason.message : "Voice transcription failed. Try again.");
            transition("fail");
          }
        })();
      } catch (reason) {
        if (controller.signal.aborted || !mountedRef.current) return;
        controllerRef.current = null;
        clearConversationTimers();
        const errorMessage = reason instanceof Error && reason.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access and try again."
          : reason instanceof Error ? reason.message : "The microphone could not be started.";
        setError(errorMessage);
        transition("fail");
      }
    })();
  }, [armConversationClock, clearConversationTimers, pauseConversationClock, runTranscript, setError, transition]);
  beginCaptureRef.current = beginCapture;

  const start = useCallback(() => {
    const current = stateRef.current;
    if (current === "listening" || current === "starting" || current === "conversation") {
      cancel();
      return;
    }
    if (current === "transcribing" || current === "processing") return;
    if (current === "speaking") cancel();
    beginCaptureRef.current("manual");
  }, [cancel]);

  const retry = useCallback(() => {
    const current = stateRef.current;
    if (current !== "error") return;
    if (!lastTranscriptRef.current) {
      beginCaptureRef.current("manual");
      return;
    }
    clearConversationTimers();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError("");
    void runTranscript(lastTranscriptRef.current, controller, true);
  }, [clearConversationTimers, runTranscript, setError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (countdownRef.current !== null) clearInterval(countdownRef.current);
      if (retryTimerRef.current !== null) clearTimeout(retryTimerRef.current);
    };
  }, []);

  return {
    state,
    error,
    transcript,
    captions,
    level,
    secondsRemaining,
    clearCaptions,
    start,
    cancel,
    retry,
  };
}
