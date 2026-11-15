export type VoiceState =
  | "idle"
  | "starting"
  | "listening"
  | "transcribing"
  | "processing"
  | "speaking"
  | "conversation"
  | "error";

export type VoiceEvent =
  | "activate"
  | "ready"
  | "monitor"
  | "speech"
  | "captured"
  | "process"
  | "speak"
  | "continue"
  | "finish"
  | "followup"
  | "retry"
  | "fail"
  | "cancel"
  | "timeout";

export interface VoicePreferences {
  inputEnabled: boolean;
  responsesEnabled: boolean;
  conversationModeEnabled: boolean;
  inactivityTimeoutSeconds: number;
}

export const VOICE_SETTINGS_KEY = "te-voice-settings";
export const VOICE_SETTINGS_EVENT = "te-voice-settings-changed";
export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  inputEnabled: true,
  responsesEnabled: true,
  conversationModeEnabled: false,
  inactivityTimeoutSeconds: 15,
};

const transitions: Record<VoiceState, Partial<Record<VoiceEvent, VoiceState>>> = {
  idle: { activate: "starting" },
  starting: { ready: "listening", monitor: "conversation", fail: "error", cancel: "idle", timeout: "idle" },
  listening: { captured: "transcribing", retry: "conversation", fail: "error", cancel: "idle", timeout: "idle" },
  transcribing: { process: "processing", retry: "conversation", fail: "error", cancel: "idle" },
  processing: { speak: "speaking", continue: "conversation", finish: "idle", fail: "error", cancel: "idle" },
  speaking: { continue: "conversation", finish: "idle", fail: "error", cancel: "idle" },
  conversation: { followup: "starting", speech: "listening", process: "processing", finish: "idle", timeout: "idle", fail: "error", cancel: "idle" },
  error: { activate: "starting", retry: "processing", cancel: "idle" },
};

export function transitionVoiceState(state: VoiceState, event: VoiceEvent): VoiceState {
  return transitions[state][event] ?? state;
}

export function normalizeVoicePreferences(value: unknown): VoicePreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_VOICE_PREFERENCES };
  }
  const candidate = value as Partial<VoicePreferences>;
  const timeout = Number(candidate.inactivityTimeoutSeconds);
  return {
    inputEnabled: typeof candidate.inputEnabled === "boolean" ? candidate.inputEnabled : DEFAULT_VOICE_PREFERENCES.inputEnabled,
    responsesEnabled: typeof candidate.responsesEnabled === "boolean" ? candidate.responsesEnabled : DEFAULT_VOICE_PREFERENCES.responsesEnabled,
    conversationModeEnabled: typeof candidate.conversationModeEnabled === "boolean"
      ? candidate.conversationModeEnabled
      : DEFAULT_VOICE_PREFERENCES.conversationModeEnabled,
    inactivityTimeoutSeconds: Number.isFinite(timeout)
      ? Math.max(5, Math.min(60, Math.round(timeout)))
      : DEFAULT_VOICE_PREFERENCES.inactivityTimeoutSeconds,
  };
}

export function readVoicePreferences(): VoicePreferences {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_VOICE_PREFERENCES };
    const stored = localStorage.getItem(VOICE_SETTINGS_KEY);
    return stored ? normalizeVoicePreferences(JSON.parse(stored) as unknown) : { ...DEFAULT_VOICE_PREFERENCES };
  } catch {
    return { ...DEFAULT_VOICE_PREFERENCES };
  }
}

export function writeVoicePreferences(preferences: VoicePreferences) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(preferences));
  } catch {
    return false;
  }
  return true;
}

export function normalizeTranscript(text: string) {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

const SHORT_VALID_COMMANDS = new Set([
  "1", "2", "3", "2d", "3d", "go", "help", "no", "ok", "on", "off", "up", "down", "stop", "yes",
]);
const FILLER_ONLY = /^(?:uh+|um+|hmm+|hm+|ah+|er+|mm+)(?:\s+(?:uh+|um+|hmm+|hm+|ah+|er+|mm+))*$/i;

export function isMeaningfulTranscript(text: string) {
  const trimmed = text.trim();
  if (!trimmed || FILLER_ONLY.test(trimmed)) return false;
  const normalized = normalizeTranscript(trimmed);
  if (!normalized) return false;
  const meaningfulCharacters = normalized.replace(/\s/g, "");
  return meaningfulCharacters.length >= 3 || SHORT_VALID_COMMANDS.has(normalized);
}

export class RecentTranscriptCache {
  private readonly entries: Array<{ value: string; at: number }> = [];

  constructor(private readonly duplicateWindowMs = 6_000, private readonly capacity = 8) {}

  accept(text: string, now = Date.now()) {
    if (!isMeaningfulTranscript(text)) return false;
    const value = normalizeTranscript(text);
    while (this.entries.length && now - this.entries[0]!.at > this.duplicateWindowMs) this.entries.shift();
    if (this.entries.some(entry => entry.value === value)) return false;
    this.entries.push({ value, at: now });
    while (this.entries.length > this.capacity) this.entries.shift();
    return true;
  }
}

export function secondsUntil(deadline: number, now = Date.now()) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
