export interface ModalReturnTarget {
  readonly isOpen: () => boolean;
  readonly close: () => void;
}

/** Targets are ordered from the deepest dialog to its parent. */
export function closeTopOpenModal(targets: readonly ModalReturnTarget[]): boolean {
  const top = targets.find((target) => target.isOpen());
  if (!top) return false;
  top.close();
  return true;
}
