# Contracts

`rpc-contract.json` es el inventario de RPC llamadas por el frontend baseline.

`baseline-sha256.json` permite comprobar que la Fase 0 no modificó accidentalmente archivos funcionales congelados.

`commercial-readiness.json` es el contrato versionado del gate de piloto. Declara qué controles pasaron, cuáles necesitan evidencia live o manual, qué pendientes bloquean el piloto y el orden exacto de las migraciones revisadas. Se verifica con `npm run qa:commercial` y forma parte de CI.

En próximas fases se generarán tipos Supabase y contratos de parámetros/respuestas.
