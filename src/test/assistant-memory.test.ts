import { afterEach, describe, expect, it } from "vitest";
import { readAssistantMessages, useApp } from "../lib/store";

describe("assistant conversation memory", () => {
  afterEach(() => {
    useApp.getState().clearAIMessages();
  });

  it("restores conversation text across reloads without restoring executable buttons", () => {
    useApp.getState().pushMessage({
      id: "user-1",
      role: "user",
      text: "Find observations in Kenya.",
    });
    useApp.getState().pushMessage({
      id: "assistant-1",
      role: "system",
      text: "Three real records were returned.",
      actions: [{ label: "Open analysis", run: "navigate:/analyze" }],
    });

    useApp.setState({ aiMessages: [], aiActive: false });
    const restored = readAssistantMessages();
    useApp.getState().restoreAIMessages(restored);

    expect(useApp.getState().aiMessages).toEqual([
      { id: "user-1", role: "user", text: "Find observations in Kenya." },
      { id: "assistant-1", role: "system", text: "Three real records were returned." },
    ]);
    expect(useApp.getState().aiActive).toBe(true);
  });

  it("keeps a bounded conversation and clears the saved copy", () => {
    for (let index = 0; index < 45; index += 1) {
      useApp.getState().pushMessage({
        id: `message-${index}`,
        role: index % 2 ? "system" : "user",
        text: `Message ${index}`,
      });
    }

    expect(readAssistantMessages()).toHaveLength(40);
    expect(readAssistantMessages()[0]?.text).toBe("Message 5");

    useApp.getState().clearAIMessages();

    expect(readAssistantMessages()).toEqual([]);
    expect(useApp.getState().aiActive).toBe(false);
  });

  it("redacts credentials before saving conversation history", () => {
    const rawKey = "gsk_abcdefghijklmnopqrstuvwxyz0123456789";
    useApp.getState().pushMessage({
      id: "credential-message",
      role: "user",
      text: `GROQ_API_KEY=${rawKey}`,
    });

    expect(localStorage.getItem("third-eye-conversation-v1")).not.toContain(rawKey);
    expect(readAssistantMessages()[0]?.text).toContain("[redacted secret]");
  });
});
