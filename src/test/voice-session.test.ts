import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_PREFERENCES,
  normalizeVoicePreferences,
  RecentTranscriptCache,
  secondsUntil,
  transitionVoiceState,
} from "../lib/voice/voice-session";

afterEach(() => localStorage.clear());

describe("voice session policy", () => {
  it("uses safe defaults and clamps saved inactivity windows", () => {
    expect(normalizeVoicePreferences(null)).toEqual(DEFAULT_VOICE_PREFERENCES);
    expect(normalizeVoicePreferences({
      inputEnabled: false,
      responsesEnabled: true,
      conversationModeEnabled: false,
      inactivityTimeoutSeconds: 100,
    })).toEqual({
      inputEnabled: false,
      responsesEnabled: true,
      conversationModeEnabled: false,
      inactivityTimeoutSeconds: 60,
    });
  });

  it("allows only valid voice lifecycle transitions", () => {
    expect(transitionVoiceState("idle", "activate")).toBe("starting");
    expect(transitionVoiceState("starting", "ready")).toBe("listening");
    expect(transitionVoiceState("listening", "captured")).toBe("transcribing");
    expect(transitionVoiceState("idle", "speech")).toBe("idle");
    expect(transitionVoiceState("error", "retry")).toBe("processing");
    expect(transitionVoiceState("conversation", "timeout")).toBe("idle");
  });

  it("rejects filler and duplicate transcripts but allows short real commands", () => {
    const cache = new RecentTranscriptCache(2_000);
    expect(cache.accept("uh um", 10_000)).toBe(false);
    expect(cache.accept("no", 10_000)).toBe(true);
    expect(cache.accept("NO!", 10_500)).toBe(false);
    expect(cache.accept("no", 12_001)).toBe(true);
  });

  it("computes a nonnegative follow-up countdown", () => {
    expect(secondsUntil(16_000, 10_001)).toBe(6);
    expect(secondsUntil(10_000, 10_001)).toBe(0);
  });
});
