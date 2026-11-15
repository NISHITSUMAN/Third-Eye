import { splitSpokenResponse, synthesizeVoiceAudio } from "../assistant-voice";

function playAudio(blob: Blob, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const url = URL.createObjectURL(blob);
    let player: HTMLAudioElement;
    try {
      player = new Audio(url);
    } catch (error) {
      URL.revokeObjectURL(url);
      reject(error instanceof Error ? error : new Error("The generated voice audio could not be played by this browser."));
      return;
    }
    player.playbackRate = 1.18;
    player.preservesPitch = true;
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      player.onended = null;
      player.onerror = null;
      signal.removeEventListener("abort", onAbort);
      URL.revokeObjectURL(url);
    };
    const onAbort = () => {
      player.pause();
      cleanup();
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    player.onended = () => {
      cleanup();
      resolve();
    };
    player.onerror = () => {
      cleanup();
      reject(new Error("The generated voice audio could not be played by this browser."));
    };
    const handlePlayError = (error: unknown) => {
      cleanup();
      reject(error instanceof Error
        ? new Error(`The generated voice audio could not start: ${error.message}`)
        : new Error("The generated voice audio could not start."));
    };
    try {
      player.play().catch(handlePlayError);
    } catch (error) {
      handlePlayError(error);
    }
  });
}

export async function playVoiceResponse(text: string, signal: AbortSignal) {
  const chunks = splitSpokenResponse(text);
  const synthesisController = new AbortController();
  const abortSynthesis = () => synthesisController.abort();
  signal.addEventListener("abort", abortSynthesis, { once: true });
  if (signal.aborted) synthesisController.abort();
  let audioParts: Blob[];
  try {
    audioParts = await Promise.all(chunks.map(chunk => synthesizeVoiceAudio(chunk, synthesisController.signal)));
  } catch (error) {
    synthesisController.abort();
    throw error;
  } finally {
    signal.removeEventListener("abort", abortSynthesis);
  }
  if (signal.aborted) return;
  for (const audio of audioParts) {
    await playAudio(audio, signal);
    if (signal.aborted) return;
  }
}
