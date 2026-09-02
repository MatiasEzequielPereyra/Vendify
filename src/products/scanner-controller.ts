import { queryOne } from "../core/dom.js";
import type { Product } from "./product-model.js";
import {
  confirmScannedStock,
  type ProductsRpcClientPort
} from "./products-service.js";

type ScannerMode = "producto" | "venta";
type ScannerEngine = string;

interface CartItem {
  readonly id: string;
  readonly cantidad?: number;
}

interface ScannerResult {
  getText(): string;
  getBarcodeFormat?(): { toString?(): string } | null;
}

interface ScannerControls {
  stop?(): void;
}

interface ScannerReader {
  decodeFromConstraints?(
    constraints: MediaStreamConstraints,
    video: HTMLVideoElement,
    callback: (result: ScannerResult | null) => void
  ): Promise<ScannerControls>;
  decodeFromVideoDevice?(
    deviceId: string | undefined,
    video: HTMLVideoElement,
    callback: (result: ScannerResult | null) => void
  ): Promise<ScannerControls>;
  decodeFromCanvas?(canvas: HTMLCanvasElement): Promise<ScannerResult | null>;
}

type ScannerReaderConstructor = new() => ScannerReader;

interface VideoInputDevice {
  readonly deviceId: string;
  readonly label: string;
}

interface ZXingApi {
  readonly BrowserMultiFormatReader?: ScannerReaderConstructor;
  readonly BrowserCodeReader?: {
    listVideoInputDevices(): Promise<VideoInputDevice[]>;
  };
}

interface DetectedBarcode {
  readonly rawValue?: string;
  readonly format?: string;
}

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement | HTMLCanvasElement): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new(options: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?(): Promise<string[]>;
}

interface ScannerProfile {
  successes: number;
  preferredZoom: number;
  avgReadMs: number | null;
  engines: Record<string, number>;
  formats: Record<string, number>;
}

interface ZoomCapabilities {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

interface ExtendedTrackCapabilities {
  readonly focusMode?: string[];
  readonly torch?: boolean;
  readonly zoom?: Partial<ZoomCapabilities>;
}

interface ExtendedTrackSettings extends MediaTrackSettings {
  readonly zoom?: number;
}

export interface ScannerControllerDependencies {
  readonly client: ProductsRpcClientPort;
  readonly getProducts: () => Product[];
  readonly getCart: () => CartItem[];
  readonly getBranchId: () => string | null;
  readonly getEditingProductId: () => string | null;
  readonly showToast: (message: string, type?: "error" | "info" | "success") => void;
  readonly emitStockChange: (reason: string) => void;
  readonly renderProducts: () => void;
  readonly renderSaleProducts: () => void;
  readonly addToCart: (productId: string) => void;
  readonly openProductEditor: (product?: Product | null) => void;
  readonly activateProductOverSale: () => void;
  readonly lookupBarcode: (code: string) => Promise<unknown>;
}

export interface ScannerController {
  readonly setup: () => void;
  readonly open: (mode: ScannerMode) => Promise<void>;
  readonly close: () => void;
  readonly processCode: (code: string, engine?: ScannerEngine, format?: string) => Promise<void>;
  readonly shouldReturnCreatedProductToSale: () => boolean;
  readonly clearPendingProduct: () => void;
}

const PROFILE_KEY = "vendify_scanner_profile_v2";

function number(value: unknown, fallback = 0): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function scannerVideo(): HTMLVideoElement | null {
  const video = queryOne("#scanner-video-v29");
  return video instanceof HTMLVideoElement ? video : null;
}

function zxingApi(): ZXingApi | null {
  const candidate = (window as Window & { ZXingBrowser?: ZXingApi }).ZXingBrowser;
  return candidate ?? null;
}

function detectorConstructor(): BarcodeDetectorConstructor | null {
  const candidate = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  return candidate ?? null;
}

function advancedConstraint(value: Record<string, unknown>): MediaTrackConstraints {
  return { advanced: [value] };
}

export function createScannerController(
  dependencies: ScannerControllerDependencies
): ScannerController {
  let mode: ScannerMode | null = null;
  let controls: ScannerControls | null = null;
  let reader: ScannerReader | null = null;
  let lastCode = "";
  let lastCodeAt = 0;
  let track: MediaStreamTrack | null = null;
  let detector: BarcodeDetectorInstance | null = null;
  let detectorFrame: number | null = null;
  let detectorBusy = false;
  let assistTimer: ReturnType<typeof setInterval> | null = null;
  let autoZoomTimer: ReturnType<typeof setInterval> | null = null;
  let openedAt = 0;
  let lastSuccessAt = 0;
  let currentZoom = 1;
  let zoomCapabilities: ZoomCapabilities | null = null;
  let torchOn = false;
  let torchSupported = false;
  let profile: ScannerProfile | null = null;
  let pendingCode: string | null = null;
  let returnToSale = false;
  let addAfterCreate = false;
  let usbBuffer = "";
  let usbStartedAt = 0;
  let usbLastAt = 0;
  let setupComplete = false;

  function loadProfile(): ScannerProfile {
    if (profile) return profile;
    try {
      const parsed = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null") as unknown;
      if (typeof parsed === "object" && parsed !== null) profile = parsed as ScannerProfile;
    } catch {
      profile = null;
    }
    profile ??= {
      successes: 0,
      preferredZoom: 1,
      avgReadMs: null,
      engines: {},
      formats: {}
    };
    return profile;
  }

  function saveProfile(): void {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(loadProfile())); } catch { /* storage optional */ }
  }

  function updateAdaptiveText(): void {
    const element = queryOne("#scanner-adaptive-text-vpro");
    if (!element) return;
    const current = loadProfile();
    if (!current.successes) {
      element.textContent = "Optimizando para este dispositivo";
      return;
    }
    const average = current.avgReadMs ? `${(current.avgReadMs / 1000).toFixed(1)} s` : "—";
    element.textContent = `Perfil adaptativo · ${String(current.successes)} lecturas · promedio ${average}`;
  }

  function registerSuccess(engine: ScannerEngine, format: string): void {
    const current = loadProfile();
    const elapsed = Math.max(0, Date.now() - openedAt);
    current.successes = number(current.successes) + 1;
    current.engines[engine] = number(current.engines[engine]) + 1;
    if (format) current.formats[format] = number(current.formats[format]) + 1;
    if (elapsed > 0 && elapsed < 30000) {
      current.avgReadMs = current.avgReadMs == null
        ? elapsed
        : Math.round(current.avgReadMs * 0.8 + elapsed * 0.2);
    }
    current.preferredZoom = Number((number(current.preferredZoom, 1) * 0.72 + currentZoom * 0.28).toFixed(2));
    lastSuccessAt = Date.now();
    saveProfile();
    updateAdaptiveText();
  }

  function setEngine(label: string): void {
    const element = queryOne("#scanner-engine-vpro");
    if (element) element.textContent = label ? label : "Auto";
  }

  function showHint(message = "", type = "info"): void {
    const element = queryOne("#scanner-hint-vpro");
    if (!(element instanceof HTMLElement)) return;
    if (!message) {
      element.classList.add("hidden");
      element.textContent = "";
      element.dataset.type = "";
      return;
    }
    element.textContent = message;
    element.dataset.type = type;
    element.classList.remove("hidden");
  }

  function setAnimating(active: boolean): void {
    queryOne(".scanner-video-wrap-v29")?.classList.toggle("is-scanning", active);
    queryOne("#modal-scanner-v29")?.classList.toggle("scanner-reading-active", active);
  }

  function updateZoomUi(): void {
    const element = queryOne("#scanner-zoom-value-vpro");
    if (element) element.textContent = `${currentZoom.toFixed(1)}×`;
  }

  async function applyZoom(value: number, silent = false): Promise<void> {
    if (!track || !zoomCapabilities) return;
    const zoom = Math.max(zoomCapabilities.min, Math.min(Math.min(zoomCapabilities.max, 3), value));
    try {
      await track.applyConstraints(advancedConstraint({ zoom }));
      currentZoom = zoom;
      updateZoomUi();
      if (!silent) {
        showHint(`Zoom ${zoom.toFixed(1)}×`);
        setTimeout(() => {
          if (queryOne("#scanner-hint-vpro")?.textContent?.startsWith("Zoom")) showHint();
        }, 900);
      }
    } catch (error) {
      console.debug("[Scanner Pro] zoom no aplicable:", error);
    }
  }

  async function changeZoom(delta: number): Promise<void> {
    if (!zoomCapabilities) return;
    await applyZoom(currentZoom + delta * Math.max(0.1, zoomCapabilities.step) * 2);
  }

  async function toggleTorch(): Promise<void> {
    if (!track || !torchSupported) return;
    torchOn = !torchOn;
    try {
      await track.applyConstraints(advancedConstraint({ torch: torchOn }));
      const button = queryOne("#btn-scanner-torch-vpro");
      button?.classList.toggle("active", torchOn);
      const label = button?.querySelector("small");
      if (label) label.textContent = torchOn ? "Apagar" : "Linterna";
    } catch (error) {
      torchOn = false;
      console.debug("[Scanner Pro] torch no aplicable:", error);
    }
  }

  async function configureTrack(): Promise<void> {
    const source = scannerVideo()?.srcObject;
    track = source instanceof MediaStream
      ? source.getVideoTracks()[0] ?? null
      : null;
    if (!track) return;
    let capabilities: ExtendedTrackCapabilities = {};
    try { capabilities = track.getCapabilities() as ExtendedTrackCapabilities; } catch { /* optional */ }
    let settings: ExtendedTrackSettings = {};
    try { settings = track.getSettings(); } catch { /* optional */ }
    const width = number(settings.width);
    const resolution = queryOne("#scanner-resolution-badge-vpro");
    if (resolution) resolution.textContent = width >= 1800 ? "FHD" : width >= 1200 ? "HD+" : width >= 700 ? "HD" : "CAM";
    const continuousFocus = capabilities.focusMode?.includes("continuous") === true;
    const focusBadge = queryOne("#scanner-focus-badge-vpro");
    if (focusBadge) focusBadge.textContent = continuousFocus ? "AF continuo" : "AF";
    if (continuousFocus) {
      try { await track.applyConstraints(advancedConstraint({ focusMode: "continuous" })); }
      catch (error) { console.debug("[Scanner Pro] focusMode no aplicable:", error); }
    }
    torchSupported = Boolean(capabilities.torch);
    queryOne("#btn-scanner-torch-vpro")?.classList.toggle("hidden", !torchSupported);
    const zoom = capabilities.zoom;
    if (zoom?.min != null && zoom.max != null) {
      zoomCapabilities = {
        min: number(zoom.min, 1),
        max: number(zoom.max, 1),
        step: number(zoom.step, 0.1)
      };
      queryOne("#scanner-zoom-wrap-vpro")?.classList.remove("hidden");
      const preferred = Math.max(
        zoomCapabilities.min,
        Math.min(Math.min(zoomCapabilities.max, 2.2), number(loadProfile().preferredZoom, number(settings.zoom, 1)))
      );
      await applyZoom(preferred, true);
    } else {
      zoomCapabilities = null;
      queryOne("#scanner-zoom-wrap-vpro")?.classList.add("hidden");
      currentZoom = 1;
      updateZoomUi();
    }
  }

  async function startNativeDetector(): Promise<boolean> {
    const Detector = detectorConstructor();
    if (!Detector) return false;
    try {
      const wanted = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "codabar"];
      const browserFormats = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : wanted;
      const supported = wanted.filter((format) => browserFormats.includes(format));
      if (!supported.length) return false;
      detector = new Detector({ formats: supported });
      setEngine("Nativo + ZXing");
      const loop = (): void => {
        detectorFrame = requestAnimationFrame(() => { void detectFrame(loop); });
      };
      loop();
      return true;
    } catch (error) {
      console.debug("[Scanner Pro] BarcodeDetector no disponible:", error);
      detector = null;
      return false;
    }
  }

  async function detectFrame(next: () => void): Promise<void> {
    const video = scannerVideo();
    if (!detector || detectorBusy || queryOne("#modal-scanner-v29")?.classList.contains("hidden")) {
      next();
      return;
    }
    if (video && video.readyState >= 2 && video.videoWidth > 0) {
      detectorBusy = true;
      try {
        const codes = await detector.detect(video);
        const hit = codes.find((code) => Boolean(code.rawValue));
        if (hit?.rawValue) await processCode(hit.rawValue, "native", hit.format ?? "");
      } catch {
        // Frames can fail while autofocus changes.
      } finally {
        detectorBusy = false;
      }
    }
    next();
  }

  function stopNativeDetector(): void {
    if (detectorFrame != null) cancelAnimationFrame(detectorFrame);
    detectorFrame = null;
    detector = null;
    detectorBusy = false;
  }

  function startAssistance(): void {
    stopAssistance();
    assistTimer = setInterval(() => {
      const video = scannerVideo();
      if (!video || video.readyState < 2 || video.videoWidth < 2) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 48;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let luminance = 0;
        for (let index = 0; index < pixels.length; index += 16) {
          luminance += 0.2126 * number(pixels[index]) +
            0.7152 * number(pixels[index + 1]) + 0.0722 * number(pixels[index + 2]);
        }
        const average = pixels.length ? luminance / (pixels.length / 16) : 120;
        if (average < 52 && torchSupported && !torchOn) {
          showHint("Hay poca luz · probá encender la linterna", "warning");
        } else if (queryOne("#scanner-hint-vpro")?.textContent?.includes("poca luz")) showHint();
      } catch { /* assistance is optional */ }
    }, 1300);
    autoZoomTimer = setInterval(() => {
      if (!zoomCapabilities || lastSuccessAt >= openedAt ||
        queryOne("#modal-scanner-v29")?.classList.contains("hidden") || Date.now() - openedAt < 2600) return;
      const maximum = Math.min(zoomCapabilities.max, 1.8);
      if (currentZoom < maximum - 0.05) {
        void applyZoom(Math.min(maximum, currentZoom + 0.2), true).then(() => {
          const status = queryOne("#scanner-status-v29");
          if (status) status.textContent = `Buscando · autozoom ${currentZoom.toFixed(1)}×`;
        });
      }
    }, 2200);
  }

  function stopAssistance(): void {
    if (assistTimer != null) clearInterval(assistTimer);
    if (autoZoomTimer != null) clearInterval(autoZoomTimer);
    assistTimer = null;
    autoZoomTimer = null;
  }

  function createFrame(options: { contrast: number; threshold: number | null; crop: number }): HTMLCanvasElement | null {
    const video = scannerVideo();
    if (!video?.videoWidth || !video.videoHeight) return null;
    const sourceX = Math.round(video.videoWidth * options.crop);
    const sourceY = Math.round(video.videoHeight * options.crop);
    const sourceWidth = Math.round(video.videoWidth * (1 - options.crop * 2));
    const sourceHeight = Math.round(video.videoHeight * (1 - options.crop * 2));
    const scale = Math.min(1, 1600 / sourceWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    if (options.contrast !== 1 || options.threshold != null) {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < image.data.length; index += 4) {
        let gray = 0.299 * number(image.data[index]) + 0.587 * number(image.data[index + 1]) +
          0.114 * number(image.data[index + 2]);
        gray = Math.max(0, Math.min(255, (gray - 128) * options.contrast + 128));
        if (options.threshold != null) gray = gray >= options.threshold ? 255 : 0;
        image.data[index] = gray;
        image.data[index + 1] = gray;
        image.data[index + 2] = gray;
      }
      context.putImageData(image, 0, 0);
    }
    return canvas;
  }

  async function tryCanvas(canvas: HTMLCanvasElement): Promise<boolean> {
    const Detector = detectorConstructor();
    if (Detector) {
      try {
        const currentDetector = detector ?? new Detector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"]
        });
        const hit = (await currentDetector.detect(canvas)).find((code) => Boolean(code.rawValue));
        if (hit?.rawValue) {
          await processCode(hit.rawValue, "capture", hit.format ?? "");
          return true;
        }
      } catch { /* use ZXing fallback */ }
    }
    const Reader = zxingApi()?.BrowserMultiFormatReader;
    if (!Reader) return false;
    try {
      const result = await new Reader().decodeFromCanvas?.(canvas);
      if (result?.getText()) {
        await processCode(result.getText(), "capture", result.getBarcodeFormat?.()?.toString?.() ?? "");
        return true;
      }
    } catch { /* unreadable capture */ }
    return false;
  }

  async function captureAndAnalyze(): Promise<void> {
    const button = queryOne("#btn-scanner-capture-vpro");
    const status = queryOne("#scanner-status-v29");
    if (!scannerVideo()?.videoWidth) {
      showHint("La cámara todavía no está lista", "warning");
      return;
    }
    if (button instanceof HTMLButtonElement) button.disabled = true;
    setAnimating(false);
    if (status) status.textContent = "Analizando captura con varios filtros…";
    try {
      const variants = [
        { contrast: 1, threshold: null, crop: 0.02 },
        { contrast: 1.45, threshold: null, crop: 0.04 },
        { contrast: 1.8, threshold: null, crop: 0.07 },
        { contrast: 1.25, threshold: 125, crop: 0.04 },
        { contrast: 1.25, threshold: 155, crop: 0.04 }
      ];
      for (const options of variants) {
        const canvas = createFrame(options);
        if (canvas && await tryCanvas(canvas)) return;
      }
      if (status) status.textContent = "No pude leer esa captura";
      showHint("Probá estirar el envase, cambiar el ángulo o usar un poco de zoom", "warning");
      if (typeof navigator.vibrate === "function") navigator.vibrate([35, 45, 35]);
      setAnimating(true);
    } finally {
      if (button instanceof HTMLButtonElement) button.disabled = false;
    }
  }

  function showMissingCode(code: string): void {
    setAnimating(false);
    pendingCode = code.trim();
    const status = queryOne("#scanner-status-v29");
    if (status) status.textContent = `Código ${pendingCode} no registrado`;
    const description = queryOne("#scanner-not-found-text-v214");
    if (description) {
      description.textContent = `El código ${pendingCode} no existe en tu catálogo. Podés registrarlo ahora y volver automáticamente a esta venta.`;
    }
    queryOne("#scanner-not-found-actions-v214")?.classList.remove("hidden");
  }

  function hideMissingCode(): void {
    queryOne("#scanner-not-found-actions-v214")?.classList.add("hidden");
    const description = queryOne("#scanner-not-found-text-v214");
    if (description) description.textContent = "";
  }

  async function registerMissingProduct(): Promise<void> {
    if (!pendingCode) return;
    const code = pendingCode;
    const fromSale = mode === "venta";
    returnToSale = fromSale;
    addAfterCreate = fromSale;
    close();
    dependencies.openProductEditor();
    if (fromSale) dependencies.activateProductOverSale();
    const barcode = queryOne("#codigo-barras");
    if (barcode instanceof HTMLInputElement) barcode.value = code;
    const stock = queryOne("#stock");
    if (stock instanceof HTMLInputElement && number(stock.value) <= 0) stock.value = "1";
    try { await dependencies.lookupBarcode(code); }
    catch (error) { console.warn("[V2.14] Búsqueda externa:", error); }
    dependencies.showToast("Completá los datos y guardá el producto", "info");
  }

  function cancelMissingProduct(): void {
    pendingCode = null;
    setAnimating(true);
    hideMissingCode();
    const status = queryOne("#scanner-status-v29");
    if (status) status.textContent = "Cámara activa · mantené el código dentro del marco";
    openedAt = Date.now();
    lastSuccessAt = 0;
  }

  async function ensurePhysicalUnit(product: Product): Promise<boolean> {
    const branchId = dependencies.getBranchId();
    if (!branchId) return true;
    const required = number(dependencies.getCart().find((item) => item.id === product.id)?.cantidad) + 1;
    if (number(product.stock) >= required) return true;
    try {
      const data = await confirmScannedStock(dependencies.client, product.id, branchId, required);
      product.stock = number(data.stock, required);
      dependencies.emitStockChange("scanner_stock_fisico");
      dependencies.renderProducts();
      return true;
    } catch (error) {
      console.error("[Scanner stock]", error);
      dependencies.showToast(errorMessage(error, "No se pudo confirmar la unidad escaneada"), "error");
      return false;
    }
  }

  async function processCode(code: string, engine: ScannerEngine = "manual", format = ""): Promise<void> {
    const normalized = code.replace(/\D/g, "").trim();
    if (!normalized) return;
    const now = Date.now();
    if (normalized === lastCode && now - lastCodeAt < 900) return;
    lastCode = normalized;
    lastCodeAt = now;
    setAnimating(false);
    if (engine !== "manual" && engine !== "usb") registerSuccess(engine, format);
    if (mode === "venta") {
      const product = dependencies.getProducts().find((candidate) => candidate.codigoBarras === normalized);
      if (!product) {
        showMissingCode(normalized);
        return;
      }
      if (!await ensurePhysicalUnit(product)) {
        setAnimating(true);
        return;
      }
      dependencies.addToCart(product.id);
      dependencies.renderSaleProducts();
      const status = queryOne("#scanner-status-v29");
      if (status) {
        const suffix = engine === "native" ? " · detector nativo" :
          engine === "capture" ? " · captura mejorada" : engine === "zxing" ? " · ZXing" : "";
        status.textContent = `✓ ${product.nombre} agregado${suffix}`;
      }
      if (typeof navigator.vibrate === "function") navigator.vibrate(70);
      setTimeout(close, 260);
      return;
    }
    if (mode === "producto") {
      const existing = dependencies.getProducts().find(
        (candidate) => candidate.codigoBarras === normalized && candidate.id !== dependencies.getEditingProductId()
      );
      close();
      if (existing) {
        dependencies.showToast(`El código ya corresponde a ${existing.nombre}`, "info");
        dependencies.openProductEditor(existing);
        return;
      }
      const barcode = queryOne("#codigo-barras");
      if (barcode instanceof HTMLInputElement) barcode.value = normalized;
      const stock = queryOne("#stock");
      if (!dependencies.getEditingProductId() && stock instanceof HTMLInputElement && number(stock.value) <= 0) {
        stock.value = "1";
      }
      await dependencies.lookupBarcode(normalized);
    }
  }

  async function open(requestedMode: ScannerMode): Promise<void> {
    mode = requestedMode;
    lastCode = "";
    lastCodeAt = 0;
    pendingCode = null;
    openedAt = Date.now();
    lastSuccessAt = 0;
    torchOn = false;
    currentZoom = 1;
    hideMissingCode();
    showHint();
    updateAdaptiveText();
    setEngine("Preparando");
    document.body.classList.add("scanner-v29-open");
    const scannerModal = queryOne("#modal-scanner-v29");
    const saleModal = queryOne("#modal-venta");
    if (scannerModal instanceof HTMLElement) {
      scannerModal.style.zIndex = "12000";
      scannerModal.classList.remove("hidden");
    }
    if (requestedMode === "venta" && saleModal) {
      saleModal.classList.add("modal-behind-scanner");
      saleModal.setAttribute("aria-hidden", "true");
    }
    const modeLabel = queryOne("#scanner-mode-label-v29");
    if (modeLabel) {
      modeLabel.textContent = requestedMode === "venta"
        ? "Escaneá productos: se agregan directamente al carrito."
        : "Apuntá la cámara al código del producto.";
    }
    const status = queryOne("#scanner-status-v29");
    if (status) status.textContent = "Abriendo cámara trasera en alta resolución…";
    setAnimating(false);
    try {
      const api = zxingApi();
      const Reader = api?.BrowserMultiFormatReader;
      const video = scannerVideo();
      if (!Reader || !video) throw new Error("El lector de códigos no cargó");
      reader = new Reader();
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920, min: 720 },
          height: { ideal: 1080, min: 480 },
          frameRate: { ideal: 30, min: 15 }
        }
      };
      const callback = (result: ScannerResult | null): void => {
        if (result) {
          void processCode(result.getText(), "zxing", result.getBarcodeFormat?.()?.toString?.() ?? "");
        }
      };
      if (reader.decodeFromConstraints) {
        controls = await reader.decodeFromConstraints(constraints, video, callback);
      } else if (reader.decodeFromVideoDevice) {
        let selectedDeviceId: string | undefined;
        try {
          const devices = await api.BrowserCodeReader?.listVideoInputDevices() ?? [];
          const back = devices.find((device) => /back|rear|environment|trasera/i.test(device.label)) ?? devices.at(-1);
          selectedDeviceId = back?.deviceId;
        } catch { /* default camera */ }
        controls = await reader.decodeFromVideoDevice(selectedDeviceId, video, callback);
      } else throw new Error("El lector de códigos no es compatible");
      await new Promise((resolve) => setTimeout(resolve, 120));
      await configureTrack();
      if (!await startNativeDetector()) setEngine("ZXing");
      startAssistance();
      if (status) status.textContent = "Cámara activa · mantené el código dentro del marco";
      setAnimating(true);
    } catch (error) {
      setAnimating(false);
      stopNativeDetector();
      stopAssistance();
      console.error("[Scanner Pro]", error);
      if (status) status.textContent = "No se pudo abrir la cámara. Revisá permisos o ingresá el código manualmente.";
      showHint("Si el teléfono tiene varias cámaras, probá cerrar y volver a abrir el scanner.", "warning");
    }
  }

  function close(): void {
    setAnimating(false);
    stopNativeDetector();
    stopAssistance();
    try { controls?.stop?.(); } catch { /* already closed */ }
    controls = null;
    reader = null;
    mode = null;
    detector = null;
    track = null;
    zoomCapabilities = null;
    torchOn = false;
    torchSupported = false;
    const video = scannerVideo();
    if (video?.srcObject instanceof MediaStream) {
      video.srcObject.getTracks().forEach((mediaTrack) => { mediaTrack.stop(); });
      video.srcObject = null;
    }
    const scannerModal = queryOne("#modal-scanner-v29");
    const saleModal = queryOne("#modal-venta");
    scannerModal?.classList.add("hidden");
    if (scannerModal instanceof HTMLElement) scannerModal.style.zIndex = "";
    document.body.classList.remove("scanner-v29-open");
    saleModal?.classList.remove("modal-behind-scanner");
    saleModal?.removeAttribute("aria-hidden");
    showHint();
    queryOne("#btn-scanner-torch-vpro")?.classList.remove("active");
    queryOne("#scanner-zoom-wrap-vpro")?.classList.add("hidden");
  }

  function shouldReturnCreatedProductToSale(): boolean {
    return returnToSale && addAfterCreate;
  }

  function clearPendingProduct(): void {
    pendingCode = null;
    returnToSale = false;
    addAfterCreate = false;
  }

  function setup(): void {
    if (setupComplete) return;
    setupComplete = true;
    queryOne("#btn-scan-producto")?.addEventListener("click", () => { void open("producto"); });
    queryOne("#btn-scan-venta")?.addEventListener("click", () => { void open("venta"); });
    queryOne("#btn-close-scanner-v29")?.addEventListener("click", close);
    queryOne("#modal-scanner-v29 .modal-backdrop")?.addEventListener("click", close);
    queryOne("#btn-use-manual-code-v29")?.addEventListener("click", () => {
      const input = queryOne("#scanner-manual-code-v29");
      void processCode(input instanceof HTMLInputElement ? input.value : "", "manual");
    });
    queryOne("#btn-scanner-torch-vpro")?.addEventListener("click", () => { void toggleTorch(); });
    queryOne("#btn-scanner-zoom-out-vpro")?.addEventListener("click", () => { void changeZoom(-1); });
    queryOne("#btn-scanner-zoom-in-vpro")?.addEventListener("click", () => { void changeZoom(1); });
    queryOne("#btn-scanner-capture-vpro")?.addEventListener("click", () => { void captureAndAnalyze(); });
    queryOne("#btn-register-scanned-v214")?.addEventListener("click", () => { void registerMissingProduct(); });
    queryOne("#btn-cancel-register-scanned-v214")?.addEventListener("click", cancelMissingProduct);
    queryOne("#scanner-manual-code-v29")?.addEventListener("keydown", (event) => {
      if (event instanceof KeyboardEvent && event.key === "Enter") {
        event.preventDefault();
        const target = event.target;
        void processCode(target instanceof HTMLInputElement ? target.value : "", "manual");
      }
    });
    document.addEventListener("keydown", (event) => {
      const saleOpen = queryOne("#modal-venta")?.classList.contains("hidden") === false;
      const productOpen = queryOne("#modal")?.classList.contains("hidden") === false;
      if (!saleOpen && !productOpen) return;
      const now = performance.now();
      if (event.key === "Enter") {
        if (usbBuffer.length >= 6 && now - usbStartedAt < 2500) {
          event.preventDefault();
          const code = usbBuffer;
          usbBuffer = "";
          mode = saleOpen ? "venta" : "producto";
          void processCode(code, "usb").finally(() => {
            if (productOpen) mode = null;
          });
        } else usbBuffer = "";
        return;
      }
      if (/^\d$/.test(event.key)) {
        if (now - usbLastAt > 180) {
          usbBuffer = "";
          usbStartedAt = now;
        }
        if (!usbBuffer) usbStartedAt = now;
        usbBuffer += event.key;
        usbLastAt = now;
      }
    }, true);
  }

  return Object.freeze({
    setup,
    open,
    close,
    processCode,
    shouldReturnCreatedProductToSale,
    clearPendingProduct
  });
}
