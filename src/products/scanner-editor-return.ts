export type ScannerOrigin = "producto" | "venta";

export interface ScannerEditorReturn {
  readonly remember: (origin: ScannerOrigin) => void;
  readonly consume: () => ScannerOrigin | null;
  readonly clear: () => void;
}

export function createScannerEditorReturn(): ScannerEditorReturn {
  let origin: ScannerOrigin | null = null;
  return Object.freeze({
    remember(next: ScannerOrigin) { origin = next; },
    consume() {
      const previous = origin;
      origin = null;
      return previous;
    },
    clear() { origin = null; }
  });
}
