export type Theme = "dark" | "light";

export interface ThemeElement {
  textContent: string | null;
}

export interface ThemeDocument {
  documentElement: { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void };
  querySelector(selector: string): ThemeElement | null;
}

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeEnvironment {
  readonly document: ThemeDocument;
  readonly storage: ThemeStorage;
}

function normalizeTheme(value: string | null): Theme {
  return value === "light" ? "light" : "dark";
}

function renderTheme(theme: Theme, documentRef: ThemeDocument): void {
  documentRef.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "");
  const icon = documentRef.querySelector("#theme-icon");
  if (icon) icon.textContent = theme === "light" ? "🌙" : "☀️";
}

export function loadTheme(
  key: string,
  environment: ThemeEnvironment = { document, storage: localStorage }
): Theme {
  const theme = normalizeTheme(environment.storage.getItem(key));
  renderTheme(theme, environment.document);
  return theme;
}

export function toggleTheme(
  key: string,
  environment: ThemeEnvironment = { document, storage: localStorage }
): Theme {
  const current = environment.document.documentElement.getAttribute("data-theme");
  const theme: Theme = current === "light" ? "dark" : "light";
  environment.storage.setItem(key, theme);
  renderTheme(theme, environment.document);
  return theme;
}
