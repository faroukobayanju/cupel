/** Shared by campaign and verify routes: a thrown SDK exception's message can
 *  carry request/response fragments -- an API key, a bearer token, an
 *  Authorization header value, or (once a provider URL grows a path-embedded
 *  key, e.g. Alchemy/Infura) the RPC URL itself. Redact anything that looks
 *  like one and cap length before any thrown message leaves a route in its
 *  public JSON response. */
const MAX_MESSAGE_LEN = 200;
const SECRET_PATTERNS = [
  /bearer\s+[a-z0-9._-]+/gi,
  /\b(sk|pk|api[_-]?key|apikey)[-_a-z0-9]*[=:\s]+[a-z0-9._-]{8,}/gi,
  /\bAuthorization\s*[:=]\s*\S+/gi,
  // Alchemy/Infura-style RPC URLs carry the API key as a path segment, not a
  // query param -- redact the whole URL rather than trying to isolate the key.
  /https?:\/\/\S+/gi,
];

export function redactSecrets(message: string): string {
  let out = message;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[redacted]');
  return out;
}

/** Truncate then redact, so the client never sees more than MAX_MESSAGE_LEN
 *  raw characters of an upstream error before redaction even runs. */
export function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const truncated = raw.length > MAX_MESSAGE_LEN ? `${raw.slice(0, MAX_MESSAGE_LEN)}...` : raw;
  return redactSecrets(truncated);
}
