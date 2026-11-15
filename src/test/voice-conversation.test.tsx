import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVoiceConversation, type VoiceConversationDependencies } from "../lib/voice/use-voice-conversation";
import { DEFAULT_VOICE_PREFERENCES } from "../lib/voice/voice-session";

afterEach(() => vi.useRealTimers());

describe("voice conversation lifecycle", () => {
  it("does not capture until requested and aborts a pending assistant command on cancel", async () => {
    let assistantSignal: AbortSignal | undefined;
    const capture: NonNullable<VoiceConversationDependencies["capture"]> = vi.fn((_mode, _signal, callbacks) => {
      callbacks.onReady?.();
      return Promise.resolve(new Blob(["recorded voice"], { type: "audio/webm" }));
    });
    const runCommand: VoiceConversationDependencies["runCommand"] = vi.fn((_transcript, signal) => {
      assistantSignal = signal;
      return new Promise<boolean>(resolve => {
        signal.addEventListener("abort", () => resolve(false), { once: true });
      });
    });
    const dependencies: VoiceConversationDependencies = {
      capture,
      transcribe: vi.fn().mockResolvedValue("Show recent observations"),
      runCommand,
    };
    const preferences = { ...DEFAULT_VOICE_PREFERENCES, conversationModeEnabled: false };
    const { result, unmount } = renderHook(() => useVoiceConversation({ preferences, dependencies }));

    expect(capture).not.toHaveBeenCalled();
    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("processing"));
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(assistantSignal?.aborted).toBe(false);

    act(() => result.current.cancel());
    expect(assistantSignal?.aborted).toBe(true);
    expect(result.current.state).toBe("idle");
    unmount();
  });

  it("re-arms only for the configured conversation window and then closes", async () => {
    vi.useFakeTimers();
    const capture: NonNullable<VoiceConversationDependencies["capture"]> = vi.fn((mode, signal, callbacks) => {
      callbacks.onReady?.();
      if (mode === "manual") return Promise.resolve(new Blob(["recorded voice"], { type: "audio/webm" }));
      return new Promise<Blob | null>(resolve => {
        signal.addEventListener("abort", () => resolve(null), { once: true });
      });
    });
    const dependencies: VoiceConversationDependencies = {
      capture,
      transcribe: vi.fn().mockResolvedValue("Show recent observations"),
      speak: vi.fn().mockResolvedValue(undefined),
      runCommand: vi.fn(async (_transcript, _signal, onResponse) => {
        await onResponse("Here are the real observations.");
        return true;
      }),
    };
    const preferences = { ...DEFAULT_VOICE_PREFERENCES, conversationModeEnabled: true, inactivityTimeoutSeconds: 5 };
    const { result, unmount } = renderHook(() => useVoiceConversation({ preferences, dependencies }));

    await act(async () => {
      result.current.start();
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    expect(result.current.state).toBe("conversation");
    expect(result.current.secondsRemaining).toBe(5);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(result.current.captions.map(caption => [caption.speaker, caption.text])).toEqual([
      ["you", "Show recent observations"],
      ["third-eye", "Here are the real observations."],
    ]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(result.current.state).toBe("idle");
    expect(result.current.secondsRemaining).toBe(0);
    unmount();
  });

  it("stops a pending spoken response when the user cancels", async () => {
    let speechSignal: AbortSignal | undefined;
    const dependencies: VoiceConversationDependencies = {
      capture: vi.fn(async (_mode, _signal, callbacks) => {
        callbacks.onReady?.();
        return new Blob(["recorded voice"], { type: "audio/webm" });
      }),
      transcribe: vi.fn().mockResolvedValue("Show recent observations"),
      speak: vi.fn((_text, signal) => {
        speechSignal = signal;
        return new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      }),
      runCommand: vi.fn(async (_transcript, _signal, onResponse) => {
        await onResponse("Here are the real observations.");
        return true;
      }),
    };
    const preferences = { ...DEFAULT_VOICE_PREFERENCES, conversationModeEnabled: false };
    const { result, unmount } = renderHook(() => useVoiceConversation({ preferences, dependencies }));

    act(() => result.current.start());
    await waitFor(() => expect(result.current.state).toBe("speaking"));
    act(() => result.current.cancel());

    expect(speechSignal?.aborted).toBe(true);
    expect(result.current.state).toBe("idle");
    unmount();
  });
});
