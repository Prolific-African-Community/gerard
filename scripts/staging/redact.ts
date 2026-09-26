// Removes database URLs and Neon hosts from any text before it reaches a terminal or a build log.
export function redact(text: string) {
  return text
    .replace(/postgres(ql)?:\/\/[^\s"'`]+/gi, '[database-url]')
    .replace(/\bep-[a-z0-9-]+(\.[a-z0-9-]+)*\.neon\.tech(:\d+)?/gi, '[database-host]')
    .replace(/\bep-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+(-pooler)?\b/gi, '[database-endpoint]')
}
