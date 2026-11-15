import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareSpokenResponse,
  shouldStopVoiceRecording,
  splitSpokenResponse,
  synthesizeVoiceAudio,
  transcribeVoiceAudio,
} from "../lib/assistant-voice";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("spoken assistant responses", () => {
  it("omits source URLs and keeps a readable spoken response", () => {
    expect(prepareSpokenResponse("M5 earthquake. USGS record: https://earthquake.usgs.gov/event/1\nDepth 10 km."))
      .toBe("M5 earthquake. Depth 10 km.");
  });

  it("limits speech output for long answers", () => {
    expect(prepareSpokenResponse("a".repeat(900))).toHaveLength(320);
  });

  it("splits natural speech into Groq's 200-character request limit", () => {
    const chunks = splitSpokenResponse(`${"clear speech ".repeat(30)}end`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.length > 0 && chunk.length <= 200)).toBe(true);
    expect(chunks.join(" ")).toBe(`${"clear speech ".repeat(30)}end`.trim());
  });

  it("ends capture after a speech pause, a silent timeout, or the hard limit", () => {
    expect(shouldStopVoiceRecording(true, 0, 1_000, 2_400)).toBe(true);
    expect(shouldStopVoiceRecording(false, 0, 0, 8_000)).toBe(true);
    expect(shouldStopVoiceRecording(true, 0, 19_000, 20_000)).toBe(true);
    expect(shouldStopVoiceRecording(true, 0, 1_000, 2_000)).toBe(false);
  });

  it("uploads recorded audio and returns Groq's transcript", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ transcript: "Switch to the 2D map" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const signal = new AbortController().signal;
    const transcript = await transcribeVoiceAudio(new Blob(["recorded audio"], { type: "audio/webm" }), signal);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = options.body as FormData;

    expect(transcript).toBe("Switch to the 2D map");
    expect(url).toBe("/api/assistant");
    expect(body.get("audio")).toBeTruthy();
    expect(options.headers).toEqual({ Accept: "application/json" });
    expect(options.signal).toBe(signal);
  });

  it("requests expressive WAV speech from the server endpoint", async () => {
    const audio = new Response(new Uint8Array([82, 73, 70, 70]), {
      status: 200,
      headers: { "content-type": "audio/wav" },
    });
    const fetchMock = vi.fn().mockResolvedValue(audio);
    vi.stubGlobal("fetch", fetchMock);

    const result = await synthesizeVoiceAudio("Hello there.");
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe("/api/assistant");
    expect(options.method).toBe("POST");
    expect(JSON.parse(String(options.body))).toEqual({ operation: "speak", text: "Hello there." });
    expect(result.type).toBe("audio/wav");
  });
});
