const REDACTED_SECRET = "[redacted secret]";

export function redactSensitiveText(text: string) {
  return text
    .replace(/\b(?:gsk|sk)[_-][A-Za-z0-9_-]{16,}\b/gi, REDACTED_SECRET)
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, REDACTED_SECRET)
    .replace(/(\b[A-Z][A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, `$1${REDACTED_SECRET}`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{16,}\b/gi, `Bearer ${REDACTED_SECRET}`);
}
