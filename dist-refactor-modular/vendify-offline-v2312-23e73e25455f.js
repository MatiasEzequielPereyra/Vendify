var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
(function() {
  "use strict";
  const TRANSITIONS = {
    pending: /* @__PURE__ */ new Set(["syncing"]),
    syncing: /* @__PURE__ */ new Set(["synced", "failed_retryable", "review"]),
    failed_retryable: /* @__PURE__ */ new Set(["syncing", "review"]),
    review: /* @__PURE__ */ new Set(["syncing"]),
    synced: /* @__PURE__ */ new Set()
  };
  function canTransitionOfflineSale(from, to) {
    return TRANSITIONS[from].has(to);
  }
  function assertOfflineSaleTransition(from, to) {
    if (!canTransitionOfflineSale(from, to)) {
      throw new Error(`Invalid offline sale transition: ${from} -> ${to}`);
    }
  }
  const RESERVING_STATUSES = /* @__PURE__ */ new Set([
    "pending",
    "syncing",
    "failed_retryable",
    "review"
  ]);
  function reservedQuantityForProduct(productId, sales) {
    return sales.reduce((reserved, sale) => {
      if (!RESERVING_STATUSES.has(sale.status)) return reserved;
      const fromSale = sale.items.reduce(
        (sum, item) => sum + (item.productId === productId ? item.quantity : 0),
        0
      );
      return reserved + fromSale;
    }, 0);
  }
  const MONEY_EPSILON = 0.01;
  class OfflineStockConflictError extends Error {
    constructor(conflicts) {
      super("Offline sale cannot reserve the requested stock");
      __publicField(this, "conflicts");
      this.name = "OfflineStockConflictError";
      this.conflicts = conflicts;
    }
  }
  class OfflineSaleValidationError extends Error {
    constructor(message) {
      super(message);
      this.name = "OfflineSaleValidationError";
    }
  }
  class OfflineIdempotencyConflictError extends Error {
    constructor(requestId) {
      super(`Offline requestId already exists with a different payload: ${requestId}`);
      this.name = "OfflineIdempotencyConflictError";
    }
  }
  function assertFiniteMoney(value, label) {
    if (!Number.isFinite(value) || value < 0) {
      throw new OfflineSaleValidationError(`${label} must be a finite non-negative number`);
    }
  }
  function assertValidItem(item) {
    if (!item.productId || !item.productName.trim()) {
      throw new OfflineSaleValidationError("Every offline sale item needs productId and productName");
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new OfflineSaleValidationError(
        `Offline quantity must be a positive integer for product ${item.productId}`
      );
    }
    assertFiniteMoney(item.unitPrice, `unitPrice:${item.productId}`);
  }
  function printableUnknown(value) {
    if (typeof value === "string") return value;
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string") return serialized;
    return "unknown";
  }
  function assertOfflinePaymentMethod(method) {
    if (method !== "Efectivo" && method !== "Transferencia") {
      throw new OfflineSaleValidationError(
        `Unsupported offline payment method: ${printableUnknown(method)}`
      );
    }
  }
  function validateOfflineSale(sale) {
    if (!sale.requestId) {
      throw new OfflineSaleValidationError("Offline sale requires requestId");
    }
    if (!sale.businessId || !sale.branchId || !sale.cashRegisterId || !sale.userId) {
      throw new OfflineSaleValidationError("Offline sale scope is incomplete");
    }
    if (!Number.isFinite(Date.parse(sale.createdAt))) {
      throw new OfflineSaleValidationError("Offline sale createdAt is invalid");
    }
    if (sale.items.length === 0) {
      throw new OfflineSaleValidationError("Offline sale requires at least one item");
    }
    sale.items.forEach(assertValidItem);
    sale.payments.forEach((payment) => {
      const method = payment.method;
      assertOfflinePaymentMethod(method);
      assertFiniteMoney(payment.amount, `payment:${method}`);
    });
    if (sale.observation !== void 0 && sale.observation.length > 500) {
      throw new OfflineSaleValidationError("Offline sale observation is too long");
    }
    assertFiniteMoney(sale.subtotal, "subtotal");
    assertFiniteMoney(sale.total, "total");
    const calculatedSubtotal = sale.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    );
    if (Math.abs(calculatedSubtotal - sale.subtotal) > MONEY_EPSILON) {
      throw new OfflineSaleValidationError("Offline sale subtotal does not match its items");
    }
    const paymentTotal = sale.payments.reduce((sum, payment) => sum + payment.amount, 0);
    if (Math.abs(paymentTotal - sale.total) > MONEY_EPSILON) {
      throw new OfflineSaleValidationError("Offline payment total does not match sale total");
    }
    if (Math.abs(sale.subtotal - sale.total) > MONEY_EPSILON) {
      throw new OfflineSaleValidationError(
        "Offline discounts are not supported; subtotal and total must match"
      );
    }
  }
  function normalizedItems(sale) {
    return [...sale.items].map((item) => [String(item.productId), item.quantity, item.unitPrice]).sort((a, b) => a[0].localeCompare(b[0]));
  }
  function normalizedPayments(sale) {
    return [...sale.payments].map((payment) => [payment.method, payment.amount]).sort((a, b) => a[0].localeCompare(b[0]));
  }
  function offlineSalePayloadFingerprint(sale) {
    return JSON.stringify({
      requestId: sale.requestId,
      businessId: sale.businessId,
      branchId: sale.branchId,
      cashRegisterId: sale.cashRegisterId,
      userId: sale.userId,
      createdAt: sale.createdAt,
      items: normalizedItems(sale),
      payments: normalizedPayments(sale),
      subtotal: sale.subtotal,
      total: sale.total,
      observation: sale.observation ?? null
    });
  }
  function assertSameOfflineRequest(existing, incoming) {
    if (offlineSalePayloadFingerprint(existing) !== offlineSalePayloadFingerprint(incoming)) {
      throw new OfflineIdempotencyConflictError(String(incoming.requestId));
    }
  }
  function quantityRequested(productId, sale) {
    return sale.items.reduce(
      (sum, item) => sum + (item.productId === productId ? item.quantity : 0),
      0
    );
  }
  function assertSaleCanReserveStock(sale, snapshots, queuedSales) {
    validateOfflineSale(sale);
    const sameScopeSales = queuedSales.filter(
      (queued) => queued.requestId !== sale.requestId && queued.businessId === sale.businessId && queued.branchId === sale.branchId
    );
    const snapshotByProduct = new Map(
      snapshots.map((snapshot) => [snapshot.productId, snapshot])
    );
    const uniqueProducts = /* @__PURE__ */ new Map();
    for (const item of sale.items) {
      uniqueProducts.set(item.productId, item.productName);
    }
    const conflicts = [];
    for (const [productId, productName] of uniqueProducts) {
      const requested = quantityRequested(productId, sale);
      const reservedBefore = reservedQuantityForProduct(productId, sameScopeSales);
      const snapshot = snapshotByProduct.get(productId);
      if (!snapshot) {
        conflicts.push({
          productId,
          productName,
          reason: "missing_snapshot",
          requested,
          reservedBefore,
          availableBefore: 0
        });
        continue;
      }
      const availableBefore = Math.max(0, snapshot.serverStock - reservedBefore);
      if (requested > availableBefore) {
        conflicts.push({
          productId,
          productName,
          reason: "insufficient_stock",
          requested,
          reservedBefore,
          availableBefore
        });
      }
    }
    if (conflicts.length > 0) {
      throw new OfflineStockConflictError(conflicts);
    }
  }
  const DB_NAME = "vendify-offline-v2312";
  const DB_VERSION = 1;
  const SALES_STORE = "offline_sales";
  const STOCK_STORE = "stock_snapshots";
  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("IndexedDB request failed"));
      };
    });
  }
  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onabort = () => {
        reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      };
    });
  }
  function snapshotKey(businessId, branchId, productId) {
    return `${businessId}:${branchId}:${productId}`;
  }
  function clearSaleLastError(sale) {
    const clone = { ...sale };
    delete clone.lastError;
    return clone;
  }
  class VendifyOfflineDb {
    constructor(db2) {
      __publicField(this, "db");
      this.db = db2;
    }
    static async open(indexedDBFactory = indexedDB) {
      const request = indexedDBFactory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db22 = request.result;
        if (!db22.objectStoreNames.contains(SALES_STORE)) {
          const sales = db22.createObjectStore(SALES_STORE, { keyPath: "requestId" });
          sales.createIndex("status", "status", { unique: false });
          sales.createIndex("branch", ["businessId", "branchId"], { unique: false });
          sales.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!db22.objectStoreNames.contains(STOCK_STORE)) {
          const stock = db22.createObjectStore(STOCK_STORE, { keyPath: "key" });
          stock.createIndex("branch", ["businessId", "branchId"], { unique: false });
        }
      };
      const db2 = await requestToPromise(request);
      return new VendifyOfflineDb(db2);
    }
    close() {
      this.db.close();
    }
    async replaceStockSnapshot(businessId, branchId, snapshots, updatedAt = (/* @__PURE__ */ new Date()).toISOString()) {
      const transaction = this.db.transaction(STOCK_STORE, "readwrite");
      const store = transaction.objectStore(STOCK_STORE);
      const branchIndex = store.index("branch");
      const existingKeys = await requestToPromise(branchIndex.getAllKeys([businessId, branchId]));
      for (const key of existingKeys) {
        store.delete(key);
      }
      for (const snapshot of snapshots) {
        const record = {
          ...snapshot,
          businessId,
          branchId,
          updatedAt,
          key: snapshotKey(businessId, branchId, snapshot.productId)
        };
        store.put(record);
      }
      await transactionDone(transaction);
    }
    async listSales() {
      const transaction = this.db.transaction(SALES_STORE, "readonly");
      const sales = await requestToPromise(transaction.objectStore(SALES_STORE).getAll());
      await transactionDone(transaction);
      return sales;
    }
    async listBranchSales(businessId, branchId) {
      const transaction = this.db.transaction(SALES_STORE, "readonly");
      const sales = await requestToPromise(
        transaction.objectStore(SALES_STORE).index("branch").getAll([businessId, branchId])
      );
      await transactionDone(transaction);
      return sales;
    }
    async listBranchSnapshots(businessId, branchId) {
      const transaction = this.db.transaction(STOCK_STORE, "readonly");
      const records = await requestToPromise(
        transaction.objectStore(STOCK_STORE).index("branch").getAll([businessId, branchId])
      );
      await transactionDone(transaction);
      return records.map(({ productId, serverStock }) => ({
        productId,
        serverStock
      }));
    }
    async enqueueSale(sale) {
      validateOfflineSale(sale);
      if (sale.status !== "pending" || sale.attempts !== 0) {
        throw new Error("New offline sales must start as pending with attempts=0");
      }
      const transaction = this.db.transaction([SALES_STORE, STOCK_STORE], "readwrite");
      const salesStore = transaction.objectStore(SALES_STORE);
      const stockStore = transaction.objectStore(STOCK_STORE);
      try {
        const existing = await requestToPromise(
          salesStore.get(sale.requestId)
        );
        if (existing) {
          assertSameOfflineRequest(existing, sale);
          await transactionDone(transaction);
          return existing;
        }
        const queued = await requestToPromise(
          salesStore.index("branch").getAll([sale.businessId, sale.branchId])
        );
        const stockRecords = await requestToPromise(
          stockStore.index("branch").getAll([sale.businessId, sale.branchId])
        );
        const snapshots = stockRecords.map(({ productId, serverStock }) => ({
          productId,
          serverStock
        }));
        assertSaleCanReserveStock(sale, snapshots, queued);
        salesStore.add(sale);
        await transactionDone(transaction);
        return sale;
      } catch (error) {
        try {
          transaction.abort();
        } catch {
        }
        throw error;
      }
    }
    async transitionSale(requestId, nextStatus, options = {}) {
      const transaction = this.db.transaction(SALES_STORE, "readwrite");
      const store = transaction.objectStore(SALES_STORE);
      const existing = await requestToPromise(store.get(requestId));
      if (!existing) {
        try {
          transaction.abort();
        } catch {
        }
        throw new Error(`Offline sale not found: ${requestId}`);
      }
      assertOfflineSaleTransition(existing.status, nextStatus);
      const base = options.clearLastError ? clearSaleLastError(existing) : existing;
      const next = {
        ...base,
        status: nextStatus,
        attempts: existing.attempts + (options.incrementAttempts ? 1 : 0),
        ...options.lastError === void 0 ? {} : { lastError: options.lastError }
      };
      store.put(next);
      await transactionDone(transaction);
      return next;
    }
    async getSale(requestId) {
      const transaction = this.db.transaction(SALES_STORE, "readonly");
      const sale = await requestToPromise(
        transaction.objectStore(SALES_STORE).get(requestId)
      );
      await transactionDone(transaction);
      return sale ?? null;
    }
  }
  const OFFLINE_ENGINE_STORAGE_KEY = "vendify_offline_engine_v2312";
  const OFFLINE_ENGINE_QUERY_KEY = "offlineEngine";
  const OFFLINE_ENGINE_V2312 = "v2312";
  function resolveOfflineEngineMode(search, storedValue) {
    var _a;
    const params = new URLSearchParams(search);
    const queryValue = (_a = params.get(OFFLINE_ENGINE_QUERY_KEY)) == null ? void 0 : _a.trim().toLowerCase();
    if (queryValue === OFFLINE_ENGINE_V2312) return "v2312";
    if (queryValue === "legacy") return "legacy";
    return (storedValue == null ? void 0 : storedValue.trim().toLowerCase()) === OFFLINE_ENGINE_V2312 ? "v2312" : "legacy";
  }
  function requiredId(value, label) {
    const normalized = value.trim();
    if (!normalized) throw new Error(`${label} is required`);
    return normalized;
  }
  function paymentMethod(value) {
    if (value === "Efectivo" || value === "Transferencia") return value;
    throw new Error(`Unsupported offline payment method: ${value}`);
  }
  function normalizeObservation(value) {
    const normalized = (value == null ? void 0 : value.trim()) ?? "";
    return normalized ? normalized : void 0;
  }
  function mapItem(item) {
    return {
      productId: requiredId(item.id, "productId"),
      productName: item.nombre.trim(),
      quantity: item.cantidad,
      unitPrice: item.precioVenta
    };
  }
  function legacyPosSaleToOfflineSale(input) {
    const observation = normalizeObservation(input.observation);
    const sale = {
      requestId: requiredId(input.requestId, "requestId"),
      businessId: requiredId(input.businessId, "businessId"),
      branchId: requiredId(input.branchId, "branchId"),
      cashRegisterId: requiredId(input.cashRegisterId, "cashRegisterId"),
      userId: requiredId(input.userId, "userId"),
      createdAt: input.createdAt ?? (/* @__PURE__ */ new Date()).toISOString(),
      items: input.items.map(mapItem),
      payments: input.payments.map((payment) => ({
        method: paymentMethod(payment.medio_pago),
        amount: payment.monto
      })),
      subtotal: input.subtotal,
      total: input.total,
      ...observation === void 0 ? {} : { observation },
      status: "pending",
      attempts: 0
    };
    validateOfflineSale(sale);
    return sale;
  }
  function buildRegistrarVentaV4Args(sale) {
    return {
      p_items: sale.items.map((item) => ({
        producto_id: item.productId,
        cantidad: item.quantity
      })),
      p_pagos: sale.payments.map((payment) => ({
        medio_pago: payment.method,
        monto: payment.amount
      })),
      p_descuento_tipo: null,
      p_descuento_valor: 0,
      p_observacion: sale.observation ?? null,
      p_sucursal_id: sale.branchId,
      p_caja_id: sale.cashRegisterId,
      p_request_id: sale.requestId
    };
  }
  function createRegistrarVentaV4Transport(client) {
    return {
      async send(sale) {
        const response = await client.rpc(
          "registrar_venta_v4",
          buildRegistrarVentaV4Args(sale)
        );
        if (response.error) {
          return { ok: false, error: response.error };
        }
        return { ok: true };
      }
    };
  }
  const RETRYABLE_SQL_CODES = /* @__PURE__ */ new Set([
    "40001",
    // serialization_failure
    "40P01",
    // deadlock_detected
    "PGRST000",
    "PGRST001",
    "PGRST002"
  ]);
  const NETWORK_PHRASES = [
    "failed to fetch",
    "network",
    "load failed",
    "internet",
    "connection reset",
    "connection refused",
    "connection closed",
    "timeout",
    "timed out",
    "fetch failed",
    "socket"
  ];
  function asErrorLike(error) {
    if (typeof error === "object" && error !== null) {
      return error;
    }
    return {};
  }
  function readMessage(error) {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    const record = asErrorLike(error);
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
    return "La venta offline necesita revisión.";
  }
  function readCode(error) {
    const code = asErrorLike(error).code;
    if (typeof code === "string" && code.trim()) return code.trim();
    if (typeof code === "number" && Number.isFinite(code)) return String(code);
    return void 0;
  }
  function readStatus(error) {
    const record = asErrorLike(error);
    const candidate = record.status ?? record.statusCode;
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
    return void 0;
  }
  function isRetryableHttpStatus(status) {
    if (status === void 0) return false;
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  function isNetworkLike(error, message) {
    const record = asErrorLike(error);
    const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
    if (name === "aborterror" || name === "timeouterror") return true;
    const normalized = message.toLowerCase();
    return NETWORK_PHRASES.some((phrase) => normalized.includes(phrase));
  }
  function classifyOfflineSyncError(error) {
    const message = readMessage(error);
    const code = readCode(error);
    const status = readStatus(error);
    const retryable = isNetworkLike(error, message) || isRetryableHttpStatus(status) || code !== void 0 && RETRYABLE_SQL_CODES.has(code.toUpperCase());
    return {
      kind: retryable ? "retryable" : "review",
      message,
      ...code === void 0 ? {} : { code },
      ...status === void 0 ? {} : { status }
    };
  }
  function saleMatchesScope(sale, scope) {
    return sale.businessId === scope.businessId && sale.branchId === scope.branchId && sale.userId === scope.userId;
  }
  function createScopedOfflineQueueStore(store, scope) {
    return {
      async listSales() {
        return (await store.listSales()).filter((sale) => saleMatchesScope(sale, scope));
      },
      async getSale(requestId) {
        const sale = await store.getSale(requestId);
        return sale !== null && saleMatchesScope(sale, scope) ? sale : null;
      },
      async transitionSale(requestId, nextStatus, options) {
        const sale = await store.getSale(requestId);
        if (sale === null || !saleMatchesScope(sale, scope)) {
          throw new Error(`Offline sale is outside the active scope: ${requestId}`);
        }
        return store.transitionSale(requestId, nextStatus, options);
      }
    };
  }
  function compareSalesFifo(a, b) {
    const byCreatedAt = a.createdAt.localeCompare(b.createdAt);
    if (byCreatedAt !== 0) return byCreatedAt;
    return String(a.requestId).localeCompare(String(b.requestId));
  }
  function isSyncCandidate(sale, includeReview) {
    return sale.status === "pending" || sale.status === "failed_retryable" || includeReview && sale.status === "review";
  }
  async function recoverInterruptedOfflineSales(store) {
    const sales = [...await store.listSales()].filter((sale) => sale.status === "syncing").sort(compareSalesFifo);
    for (const sale of sales) {
      await store.transitionSale(sale.requestId, "failed_retryable", {
        lastError: "La sincronización anterior se interrumpió. Se reintentará de forma segura usando el mismo request_id."
      });
    }
    return sales.length;
  }
  async function syncOfflineQueue(store, transport, options = {}) {
    const includeReview = options.includeReview === true;
    const recoverInterrupted = options.recoverInterrupted !== false;
    const limit = Math.max(1, Math.floor(options.limit ?? 50));
    const recovered = recoverInterrupted ? await recoverInterruptedOfflineSales(store) : 0;
    const candidates = [...await store.listSales()].filter((sale) => isSyncCandidate(sale, includeReview)).sort(compareSalesFifo).slice(0, limit);
    let attempted = 0;
    let synced = 0;
    let retryable = 0;
    let review = 0;
    let blockedRequestId;
    for (const candidate of candidates) {
      const syncing = await store.transitionSale(candidate.requestId, "syncing", {
        incrementAttempts: true,
        clearLastError: true
      });
      attempted += 1;
      let result;
      try {
        result = await transport.send(syncing);
      } catch (error) {
        result = { ok: false, error };
      }
      if (result.ok) {
        await store.transitionSale(syncing.requestId, "synced", {
          clearLastError: true
        });
        synced += 1;
        continue;
      }
      const classification = classifyOfflineSyncError(result.error);
      blockedRequestId = syncing.requestId;
      if (classification.kind === "retryable") {
        await store.transitionSale(syncing.requestId, "failed_retryable", {
          lastError: classification.message
        });
        retryable += 1;
      } else {
        await store.transitionSale(syncing.requestId, "review", {
          lastError: classification.message
        });
        review += 1;
      }
      break;
    }
    return {
      attempted,
      synced,
      retryable,
      review,
      recovered,
      ...blockedRequestId === void 0 ? {} : { blockedRequestId }
    };
  }
  class OfflineQueueSynchronizer {
    constructor(store, transport) {
      __publicField(this, "inFlight", null);
      this.store = store;
      this.transport = transport;
    }
    run(options = {}) {
      if (this.inFlight) return this.inFlight;
      const runPromise = syncOfflineQueue(this.store, this.transport, options);
      this.inFlight = runPromise.finally(() => {
        this.inFlight = null;
      });
      return this.inFlight;
    }
  }
  const mode = resolveOfflineEngineMode(
    window.location.search,
    window.localStorage.getItem(OFFLINE_ENGINE_STORAGE_KEY)
  );
  let db = null;
  let initializationError = null;
  let synchronizer = null;
  let synchronizerClient = null;
  let synchronizerScopeKey = null;
  const ready = (async () => {
    if (mode !== "v2312") return;
    try {
      db = await VendifyOfflineDb.open();
    } catch (error) {
      initializationError = error instanceof Error ? error.message : String(error);
      console.error("[Vendify v2.31.2] IndexedDB initialization failed", error);
    }
  })();
  function requireDb() {
    if (mode !== "v2312") {
      throw new Error("Vendify offline v2.31.2 is not enabled");
    }
    if (!db) {
      throw new Error(initializationError ?? "Vendify IndexedDB is not ready");
    }
    return db;
  }
  function emptyStatusCounts() {
    return {
      pending: 0,
      syncing: 0,
      failed_retryable: 0,
      review: 0,
      synced: 0
    };
  }
  function scopeKey(scope) {
    return `${scope.businessId}:${scope.branchId}:${scope.userId}`;
  }
  async function diagnostics(scope) {
    await ready;
    const sales = emptyStatusCounts();
    if (db) {
      const storedSales = await createScopedOfflineQueueStore(db, scope).listSales();
      for (const sale of storedSales) sales[sale.status] += 1;
    }
    return {
      version: "2.31.2",
      mode,
      enabled: mode === "v2312",
      indexedDbReady: db !== null,
      initializationError,
      sales
    };
  }
  async function listSales(scope) {
    await ready;
    return createScopedOfflineQueueStore(requireDb(), scope).listSales();
  }
  async function captureStockSnapshot(input) {
    await ready;
    const activeDb = requireDb();
    const businessId = input.businessId.trim();
    const branchId = input.branchId.trim();
    if (!businessId || !branchId) {
      throw new Error("Business and branch are required for offline stock snapshot");
    }
    const snapshots = input.products.map((product) => ({
      productId: product.productId.trim(),
      serverStock: product.serverStock
    }));
    for (const snapshot of snapshots) {
      if (!snapshot.productId || !Number.isFinite(snapshot.serverStock) || snapshot.serverStock < 0) {
        throw new Error("Invalid product stock received for offline snapshot");
      }
    }
    await activeDb.replaceStockSnapshot(businessId, branchId, snapshots);
  }
  async function enqueueLegacySale(input) {
    await ready;
    const sale = legacyPosSaleToOfflineSale(input);
    return requireDb().enqueueSale(sale);
  }
  async function syncNow(client, scope, options = {}) {
    await ready;
    const activeDb = requireDb();
    const nextScopeKey = scopeKey(scope);
    if (synchronizer === null || synchronizerClient !== client || synchronizerScopeKey !== nextScopeKey) {
      synchronizerClient = client;
      synchronizerScopeKey = nextScopeKey;
      synchronizer = new OfflineQueueSynchronizer(
        createScopedOfflineQueueStore(activeDb, scope),
        createRegistrarVentaV4Transport(client)
      );
    }
    return synchronizer.run(options);
  }
  function enableForThisBrowser() {
    window.localStorage.setItem(OFFLINE_ENGINE_STORAGE_KEY, OFFLINE_ENGINE_V2312);
  }
  function disableForThisBrowser() {
    window.localStorage.removeItem(OFFLINE_ENGINE_STORAGE_KEY);
  }
  window.VendifyOfflineV2312 = {
    version: "2.31.2",
    mode,
    enabled: mode === "v2312",
    ready,
    diagnostics,
    listSales,
    captureStockSnapshot,
    enqueueLegacySale,
    syncNow,
    enableForThisBrowser,
    disableForThisBrowser
  };
  console.info(
    `[Vendify v2.31.2] offline runtime loaded in ${mode === "v2312" ? "IndexedDB" : "legacy"} mode`
  );
})();
