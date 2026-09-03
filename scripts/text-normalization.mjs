export function normalizeLineEndings(value) {
  return String(value).replace(/\r\n?/g, "\n");
}
