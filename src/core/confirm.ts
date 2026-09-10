export interface ConfirmElement {
  textContent: string | null;
  className: string;
  classList: { add(name: string): void; remove(name: string): void };
  onclick: (() => void) | null;
}
export interface ConfirmDocument { querySelector(selector: string): ConfirmElement | null; }
export interface ConfirmOptions { readonly okText?: string | null; readonly cancelText?: string; readonly danger?: boolean | null; }
const destructiveTerms = /eliminar|borrar|anular|desactivar|cerrar sesión|salir de vendify/i;
let dismissActiveConfirmation: (() => void) | null = null;
function requiredElement(documentRef: ConfirmDocument, selector: string): ConfirmElement {
  const element = documentRef.querySelector(selector);
  if (!element) throw new Error(`Falta el elemento de confirmación ${selector}`);
  return element;
}
export function isDestructiveConfirmation(title: string, message: string, danger: boolean | null | undefined): boolean {
  return typeof danger === "boolean" ? danger : destructiveTerms.test(`${title} ${message}`);
}
export function showConfirmation(title: string, message: string, { okText = null, cancelText = "Cancelar", danger = null }: ConfirmOptions = {}, documentRef: ConfirmDocument = document): Promise<boolean> {
  const destructive = isDestructiveConfirmation(title, message, danger);
  const modal = requiredElement(documentRef, "#modal-confirm");
  const okButton = requiredElement(documentRef, "#btn-confirm-ok");
  const cancelButton = requiredElement(documentRef, "#btn-confirm-cancel");
  const closeButton = requiredElement(documentRef, "#btn-cerrar-confirm");
  requiredElement(documentRef, "#confirm-titulo").textContent = title;
  requiredElement(documentRef, "#confirm-mensaje").textContent = message;
  okButton.textContent = okText ?? (destructive ? "Confirmar" : "Aceptar");
  okButton.className = `btn ${destructive ? "btn-danger" : "btn-primary"}`;
  cancelButton.textContent = cancelText;
  modal.classList.remove("hidden");
  return new Promise((resolve) => {
    const close = (accepted: boolean) => {
      modal.classList.add("hidden");
      okButton.onclick = null;
      cancelButton.onclick = null;
      closeButton.onclick = null;
      dismissActiveConfirmation = null;
      resolve(accepted);
    };
    dismissActiveConfirmation?.();
    dismissActiveConfirmation = () => { close(false); };
    okButton.onclick = () => { close(true); };
    cancelButton.onclick = () => { close(false); };
    closeButton.onclick = () => { close(false); };
  });
}
export function dismissConfirmation(): void { dismissActiveConfirmation?.(); }
