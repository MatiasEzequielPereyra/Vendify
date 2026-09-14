(function() {
  "use strict";
  function offlineSaleToLegacyTicketShape(sale) {
    return {
      request_id: sale.requestId,
      created_at: sale.createdAt,
      items: sale.items.map((item) => ({
        producto_id: item.productId,
        producto_nombre: item.productName,
        cantidad: item.quantity,
        precio_unitario: item.unitPrice
      })),
      pagos: sale.payments.map((payment) => ({
        medio_pago: payment.method,
        monto: payment.amount
      })),
      totales: {
        subtotal: sale.subtotal,
        total: sale.total
      },
      observacion: sale.observation ?? null
    };
  }
  const VENDIFY_PRODUCTION_SUPABASE_REF = "puhkmblnptntorwptvld";
  const ALLOW_PRODUCTION_OFFLINE_SYNC_QUERY = "allowProdOfflineSync";
  function resolveOfflineSyncSafety(supabaseUrl, queryString) {
    const productionBackend = supabaseUrl.includes(VENDIFY_PRODUCTION_SUPABASE_REF);
    const params = new URLSearchParams(queryString);
    const explicitProductionOverride = params.get(ALLOW_PRODUCTION_OFFLINE_SYNC_QUERY) === "1";
    return {
      productionBackend,
      explicitProductionOverride,
      allowed: !productionBackend || explicitProductionOverride
    };
  }
  const EMPTY_SYNC_SUMMARY = {
    attempted: 0,
    synced: 0,
    retryable: 0,
    review: 0,
    recovered: 0
  };
  function requiredScopeId(value, label) {
    const normalized = (value == null ? void 0 : value.trim()) ?? "";
    if (!normalized) throw new Error(`No se pudo determinar ${label} para la venta offline.`);
    return normalized;
  }
  function runtimeEnabled() {
    var _a;
    return ((_a = window.VendifyOfflineV2312) == null ? void 0 : _a.enabled) === true;
  }
  function currentSyncSafety() {
    const fallbackProductionUrl = `https://${VENDIFY_PRODUCTION_SUPABASE_REF}.supabase.co`;
    return resolveOfflineSyncSafety(
      supabaseClient.supabaseUrl ?? fallbackProductionUrl,
      window.location.search
    );
  }
  function currentOfflineScope() {
    var _a, _b, _c;
    const context = window.appContext;
    return {
      businessId: requiredScopeId((_a = context == null ? void 0 : context.business) == null ? void 0 : _a.id, "el negocio"),
      branchId: requiredScopeId((_b = context == null ? void 0 : context.branch) == null ? void 0 : _b.id, "la sucursal"),
      userId: requiredScopeId((_c = sesionActual == null ? void 0 : sesionActual.user) == null ? void 0 : _c.id, "el usuario")
    };
  }
  async function listarVentasOfflineIndexedDbV2312() {
    const runtime = window.VendifyOfflineV2312;
    if (!(runtime == null ? void 0 : runtime.enabled)) return [];
    await runtime.ready;
    return runtime.listSales(currentOfflineScope());
  }
  async function registrarVentaOfflineIndexedDbV2312(items, pagos, totales, observacion) {
    var _a, _b, _c, _d;
    const runtime = window.VendifyOfflineV2312;
    if (!(runtime == null ? void 0 : runtime.enabled)) {
      throw new Error("El motor offline v2.31.2 no está activo.");
    }
    await runtime.ready;
    if ((totales.tipo ?? "").trim() || Number(totales.valor ?? 0) !== 0) {
      throw new Error("Los descuentos requieren conexión para validar la autorización.");
    }
    validarPagosOfflineV2311(pagos);
    validarStockLocalVentaV2311(items);
    const context = window.appContext;
    const requestId = asegurarVentaRequestIdV23011();
    const sale = await runtime.enqueueLegacySale({
      requestId,
      businessId: requiredScopeId((_a = context == null ? void 0 : context.business) == null ? void 0 : _a.id, "el negocio"),
      branchId: requiredScopeId((_b = context == null ? void 0 : context.branch) == null ? void 0 : _b.id, "la sucursal"),
      cashRegisterId: requiredScopeId((_c = context == null ? void 0 : context.cashRegister) == null ? void 0 : _c.id, "la caja"),
      userId: requiredScopeId((_d = sesionActual == null ? void 0 : sesionActual.user) == null ? void 0 : _d.id, "el usuario"),
      items,
      payments: pagos,
      subtotal: totales.subtotal,
      total: totales.total,
      observation: observacion
    });
    try {
      aplicarVentaAlStockLocalV2311(items);
      aplicarVentaCajaLocalV2311(pagos, totales.total);
    } catch (error) {
      console.error("[Vendify v2.31.2] local POS mirror update failed", error);
    }
    try {
      actualizarUIVentasOfflineV2311();
    } catch {
    }
    window.dispatchEvent(
      new CustomEvent("vendify:offline-v2312-changed", {
        detail: { requestId: sale.requestId, status: sale.status }
      })
    );
    return construirTicketOfflineV2311(offlineSaleToLegacyTicketShape(sale));
  }
  let syncInFlight = null;
  async function runIndexedDbSync(options = {}) {
    const runtime = window.VendifyOfflineV2312;
    if (!(runtime == null ? void 0 : runtime.enabled) || !navigator.onLine) {
      return EMPTY_SYNC_SUMMARY;
    }
    const safety = currentSyncSafety();
    if (!safety.allowed) {
      if (options.mostrarResumen) {
        mostrarToast(
          "Staging seguro: la sincronización offline hacia producción está bloqueada.",
          "warning"
        );
      }
      console.warn(
        "[Vendify v2.31.2] offline sync blocked because staging is using the production Supabase backend"
      );
      return EMPTY_SYNC_SUMMARY;
    }
    if (syncInFlight) return syncInFlight;
    let scope;
    try {
      scope = currentOfflineScope();
    } catch (error) {
      console.warn("[Vendify v2.31.2] offline sync blocked without an active scope", error);
      return EMPTY_SYNC_SUMMARY;
    }
    const run = runtime.syncNow(supabaseClient, scope, {
      includeReview: options.incluirRevision === true,
      recoverInterrupted: true,
      limit: 50
    }).then(async (summary) => {
      if (summary.synced > 0) {
        try {
          await cargarProductos();
        } catch (error) {
          console.warn("[Vendify v2.31.2] product reconciliation deferred", error);
        }
      }
      if (options.mostrarResumen) {
        if (summary.review > 0) {
          mostrarToast("Hay una venta offline que requiere revisión.", "warning");
        } else if (summary.retryable > 0) {
          mostrarToast("La sincronización se reintentará automáticamente.", "warning");
        } else if (summary.synced > 0) {
          const syncedCount = String(summary.synced);
          mostrarToast(
            `${syncedCount} venta${summary.synced === 1 ? "" : "s"} offline sincronizada${summary.synced === 1 ? "" : "s"}.`,
            "success"
          );
        }
      }
      window.dispatchEvent(
        new CustomEvent("vendify:offline-v2312-changed", { detail: summary })
      );
      return summary;
    });
    syncInFlight = run.finally(() => {
      syncInFlight = null;
    });
    return syncInFlight;
  }
  window.registrarVentaOfflineIndexedDbV2312 = registrarVentaOfflineIndexedDbV2312;
  window.sincronizarVentasOfflineIndexedDbV2312 = runIndexedDbSync;
  window.listarVentasOfflineIndexedDbV2312 = listarVentasOfflineIndexedDbV2312;
  function scheduleSync(showSummary) {
    if (!runtimeEnabled() || !navigator.onLine) return;
    void runIndexedDbSync({ mostrarResumen: showSummary }).catch((error) => {
      console.error("[Vendify v2.31.2] automatic sync failed", error);
    });
  }
  window.addEventListener("online", () => {
    scheduleSync(true);
  });
  window.addEventListener("focus", () => {
    scheduleSync(false);
  });
  window.setTimeout(() => {
    scheduleSync(false);
  }, 800);
  const startupSafety = currentSyncSafety();
  console.info(
    `[Vendify v2.31.2] legacy POS bridge ${runtimeEnabled() ? "active" : "standby"}; sync ${startupSafety.allowed ? "enabled" : "blocked for production backend"}`
  );
})();
