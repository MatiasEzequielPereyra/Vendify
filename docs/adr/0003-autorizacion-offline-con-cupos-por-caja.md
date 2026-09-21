# ADR 0003 — Autorización offline con cupos por Caja

## Estado
Aceptada.

## Decisión
La operación offline requiere una Autorización offline emitida por el backend, acotada a un Negocio, una Sucursal y una Caja, con Cupos offline explícitos por Producto y vencimiento. El cupo pertenece a la Caja, mientras que cada Venta pendiente offline conserva su Usuario creador; una revocación impide nuevas ventas offline pero nunca elimina silenciosamente las ya persistidas.

## Motivo
Las copias de Stock y las Reservas offline locales no pueden impedir que dos Cajas desconectadas prometan las mismas unidades. Distribuir cupos limitados antes de la desconexión mantiene una operación offline útil sin tratar una copia desactualizada como autoridad ilimitada.

## Consecuencia
El backend conserva la autoridad para emitir, limitar y revocar la capacidad offline. Una autorización vencida o revocada bloquea nuevas Ventas pendientes offline, mientras que las existentes continúan hacia la sincronización o la Revisión offline explícita.

Al recuperar conexión, el terminal reconcilia el lease con el backend antes de reutilizarlo. El consumo local nunca se reduce con un contador remoto que todavía no incluye ventas pendientes. Un lease agotado puede reemplazarse únicamente cuando el dispositivo no conserva ventas sin sincronizar para ese lease.

La hora declarada por un navegador completamente desconectado no constituye evidencia criptográfica. Por eso una venta recibida después de una revocación conserva su fecha local, pero todavía debe superar token, alcance, cupos, stock, caja e idempotencia en el backend; los casos incompatibles quedan en Revisión offline. Eliminar esa confianza residual requeriría una cadena de comprobantes emitidos previamente o hardware confiable y queda fuera de este contrato.
