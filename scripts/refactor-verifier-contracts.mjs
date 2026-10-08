export function assertSourceMatch(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

export function assertExactlyOneSourceMatch(source, pattern, message) {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) throw new Error(`${message} (found ${matches.length})`);
}

export function assertNoModularLegacyRuntime(index, files, serviceWorker) {
  if (index.includes("app.js") || files.includes("app.js")) {
    throw new Error("modular artifact references or contains app.js");
  }
  if (
    serviceWorker.includes('"./app.js"')
    || serviceWorker.includes("'./app.js'")
  ) {
    throw new Error("modular Service Worker requires app.js");
  }
  if (
    files.some((file) => /^app-(?:refactor-v232|staging-v2312)-/u.test(file))
  ) {
    throw new Error("modular artifact contains a renamed compatibility application runtime");
  }
}
