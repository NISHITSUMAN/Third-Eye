import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "../lib/sensitive-text";

describe("assistant secret redaction", () => {
  it("removes common raw and environment-assignment credentials", () => {
    const rawKey = "gsk_abcdefghijklmnopqrstuvwxyz0123456789";
    const safeText = redactSensitiveText(`GROQ_API_KEY=${rawKey}\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789`);

    expect(safeText).not.toContain(rawKey);
    expect(safeText).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
    expect(safeText).toContain("[redacted secret]");
  });
});
