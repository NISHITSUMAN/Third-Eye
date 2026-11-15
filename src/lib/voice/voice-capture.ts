import { shouldStopVoiceRecording } from "../assistant-voice";

export type VoiceCaptureMode = "manual" | "followup";

export interface VoiceCaptureCallbacks {
  onReady?: () => void;
  onSpeech?: () => void;
  onLevel?: (level: number) => void;
}

const MIN_RECORDING_SIZE = 100;
const MANUAL_SILENCE_THRESHOLD = 0.008;
const FOLLOWUP_SPEECH_THRESHOLD = 0.018;
const FOLLOWUP_SPEECH_FRAMES = 5;

export async function captureVoiceTurn(
  mode: VoiceCaptureMode,
  signal: AbortSignal,
  callbacks: VoiceCaptureCallbacks = {},
): Promise<Blob | null> {
  if (signal.aborted) return null;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined" || typeof AudioContext === "undefined") {
    throw new Error("Voice input needs microphone recording and audio-level detection. Try a current Chrome or Edge browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  let context: AudioContext | null = null;
  let frame: number | null = null;

  try {
    if (signal.aborted) return null;
    context = new AudioContext();
    await context.resume();
    if (signal.aborted) return null;
    if (context.state !== "running") throw new Error("Microphone audio-level detection is unavailable.");

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const mimeType = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]
      .find(type => MediaRecorder.isTypeSupported?.(type));

    return await new Promise<Blob | null>((resolve, reject) => {
      let settled = false;
      let recorder: MediaRecorder | null = null;
      let speechDetected = false;
      let consecutiveSpeechFrames = 0;
      let lastSoundAt = Date.now();
      const startedAt = Date.now();
      const chunks: Blob[] = [];

      const finish = (recording: Blob | null) => {
        if (settled) return;
        settled = true;
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
        signal.removeEventListener("abort", onAbort);
        resolve(recording && recording.size >= MIN_RECORDING_SIZE ? recording : null);
      };
      const stopRecorder = () => {
        if (recorder?.state === "recording") recorder.stop();
        else finish(null);
      };
      const onAbort = () => stopRecorder();
      const startRecorder = () => {
        if (recorder || signal.aborted) return;
        try {
          recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          recorder.ondataavailable = event => {
            if (event.data.size) chunks.push(event.data);
          };
          recorder.onerror = () => {
            if (!settled) {
              settled = true;
              if (frame !== null) cancelAnimationFrame(frame);
              frame = null;
              signal.removeEventListener("abort", onAbort);
              reject(new Error("Microphone recording failed. Check browser permissions and try again."));
            }
          };
          recorder.onstop = () => {
            const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
            finish(blob);
          };
          recorder.start(250);
        } catch (error) {
          if (!settled) {
            settled = true;
            signal.removeEventListener("abort", onAbort);
            reject(error instanceof Error ? error : new Error("Microphone recording could not start."));
          }
        }
      };

      signal.addEventListener("abort", onAbort, { once: true });
      callbacks.onReady?.();
      if (mode === "manual") startRecorder();

      const detectSpeech = () => {
        if (settled || signal.aborted) return;
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
        const now = Date.now();
        callbacks.onLevel?.(Math.min(1, rms * 8));

        if (mode === "followup") {
          consecutiveSpeechFrames = rms >= FOLLOWUP_SPEECH_THRESHOLD ? consecutiveSpeechFrames + 1 : 0;
          if (!speechDetected && consecutiveSpeechFrames >= FOLLOWUP_SPEECH_FRAMES) {
            speechDetected = true;
            lastSoundAt = now;
            callbacks.onSpeech?.();
            startRecorder();
          } else if (speechDetected && rms >= FOLLOWUP_SPEECH_THRESHOLD) {
            lastSoundAt = now;
          }
        } else if (rms >= MANUAL_SILENCE_THRESHOLD) {
          speechDetected = true;
          lastSoundAt = now;
        }

        if (mode === "manual" && shouldStopVoiceRecording(speechDetected, startedAt, lastSoundAt, now)) {
          stopRecorder();
          return;
        }
        if (mode === "followup" && recorder && speechDetected && now - lastSoundAt >= 1_400) {
          stopRecorder();
          return;
        }
        if (recorder && now - startedAt >= 20_000) {
          stopRecorder();
          return;
        }
        frame = requestAnimationFrame(detectSpeech);
      };
      frame = requestAnimationFrame(detectSpeech);
    });
  } finally {
    if (frame !== null) cancelAnimationFrame(frame);
    stream.getTracks().forEach(track => track.stop());
    if (context && context.state !== "closed") await context.close();
  }
}
