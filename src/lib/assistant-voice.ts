const SPEECH_CHUNK_LIMIT = 200;

export function prepareSpokenResponse(text: string) {
  const spoken = text
    .replace(/USGS record:\s*https:\/\/\S+/gi, "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[`*_#>]/g, "")
    .replace(/[·•]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
  if (spoken.length <= 320) return spoken;
  const cutoff = spoken.lastIndexOf(" ", 317);
  return `${spoken.slice(0, cutoff > 0 ? cutoff : 317).trimEnd()}...`;
}

export function splitSpokenResponse(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let chunk = "";

  for (const word of words) {
    if (word.length > SPEECH_CHUNK_LIMIT) {
      if (chunk) chunks.push(chunk);
      for (let offset = 0; offset < word.length; offset += SPEECH_CHUNK_LIMIT) {
        chunks.push(word.slice(offset, offset + SPEECH_CHUNK_LIMIT));
      }
      chunk = "";
      continue;
    }

    const candidate = chunk ? `${chunk} ${word}` : word;
    if (candidate.length > SPEECH_CHUNK_LIMIT) {
      chunks.push(chunk);
      chunk = word;
    } else {
      chunk = candidate;
    }
  }

  if (chunk) chunks.push(chunk);
  return chunks;
}

export function shouldStopVoiceRecording(speechDetected: boolean, startedAt: number, lastSoundAt: number, now: number) {
  return (speechDetected && now - lastSoundAt >= 1_400) ||
    (!speechDetected && now - startedAt >= 8_000) ||
    now - startedAt >= 20_000;
}

export async function synthesizeVoiceAudio(text: string, signal?: AbortSignal) {
  if (!text.trim() || text.length > SPEECH_CHUNK_LIMIT) {
    throw new Error(`Natural voice speech must contain 1-${SPEECH_CHUNK_LIMIT} characters.`);
  }
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/wav, application/json" },
    body: JSON.stringify({ operation: "speak", text }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    let message = `Natural voice generation failed (HTTP ${response.status}).`;
    try {
      const payload: unknown = await response.json();
      if (typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string") {
        message = payload.error;
      }
    } catch {
      // Keep the status-based error when the endpoint does not return JSON.
    }
    throw new Error(message);
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("audio/wav")) {
    throw new Error("Natural voice generation returned an unsupported audio format.");
  }
  const audio = await response.blob();
  if (!audio.size) throw new Error("Natural voice generation returned empty audio.");
  return audio;
}

export async function transcribeVoiceAudio(audio: Blob, signal?: AbortSignal) {
  const formData = new FormData();
  const mediaType = audio.type.split("/")[1]?.split(";")[0] || "webm";
  const extension = mediaType === "x-m4a" ? "m4a" : mediaType;
  formData.append("audio", audio, `voice-command.${extension}`);
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: formData,
    ...(signal ? { signal } : {}),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Voice transcription returned an invalid response.");
  }
  if (!response.ok) {
    const error = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Voice transcription failed (HTTP ${response.status}).`;
    throw new Error(error);
  }
  if (typeof payload !== "object" || payload === null || !("transcript" in payload) || typeof payload.transcript !== "string") {
    throw new Error("Voice transcription returned no transcript.");
  }
  const transcript = payload.transcript.trim();
  if (!transcript) throw new Error("No speech was recognized. Try again and speak clearly.");
  return transcript;
}
