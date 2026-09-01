export function queryOne<E extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document
): E | null {
  return root.querySelector<E>(selector);
}

export function queryAll<E extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document
): NodeListOf<E> {
  return root.querySelectorAll<E>(selector);
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
