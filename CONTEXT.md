# Vendify

Vendify es un sistema de gestión comercial para comercios minoristas. Este glosario expresa el modelo objetivo aceptado para administrar cada Negocio y la operación cotidiana de sus Sucursales.

## Organización

**Negocio**:
La organización comercial que usa Vendify y agrupa sus sucursales, miembros, catálogo y configuración.
_Evitar_: Empresa, tenant

**Plan**:
La oferta comercial de Vendify que define capacidades y límites disponibles para un Negocio.
_Evitar_: Rol, Suscripción

**Suscripción**:
El vínculo vigente de un Negocio con un Plan. Sus límites pueden considerar Sucursales, Empleados y otras capacidades comerciales.
_Evitar_: Membresía, Plan

**Usuario**:
La persona identificada en Vendify. Puede participar en distintos Negocios y trabajar en varias Sucursales de cada uno.
_Evitar_: Cuenta, empleado

**Membresía**:
El vínculo de un Usuario con un Negocio que determina su rol y su estado dentro de ese Negocio. Un Usuario puede tener Membresías independientes en varios Negocios.
_Evitar_: Usuario, empleado

**Empleado**:
La Membresía laboral de un Usuario que participa en un Negocio sin ser su Propietario. Puede tener Rol Administrador, Encargado o Cajero.
_Evitar_: Usuario, Membresía

**Rol**:
El nivel general de responsabilidad que una Membresía tiene dentro de un Negocio y el límite máximo de sus permisos. Una Asignación de sucursal nunca puede elevar ese límite.
_Evitar_: Cargo, permiso de sucursal

**Propietario**:
El único Rol con responsabilidad final sobre el Negocio. Cada Negocio tiene un solo Propietario.
_Evitar_: Owner, dueño

**Administrador**:
El Rol que administra el Negocio por delegación del Propietario.
_Evitar_: Admin, Propietario

**Encargado**:
El Rol que supervisa la operación comercial sin administrar la propiedad del Negocio.
_Evitar_: Manager, supervisor

**Cajero**:
El Rol orientado a las operaciones de venta y caja que le hayan sido permitidas.
_Evitar_: Cashier, empleado

**Sucursal**:
La unidad operativa de un Negocio en la que se gestionan stock, cajas y ventas.
_Evitar_: Local, tienda

**Asignación de sucursal**:
El alcance que habilita a una Membresía para operar en una Sucursal y, cuando corresponde, restringe o habilita capacidades sin exceder su Rol.
_Evitar_: Membresía, Rol

**Contexto activo**:
La combinación de un Negocio y una Sucursal dentro de la que un Usuario realiza operaciones nuevas. Cambiarla no reasigna operaciones ya creadas.
_Evitar_: Membresía, Asignación de sucursal

## Catálogo e inventario

**Producto**:
El artículo ofrecido por un Negocio como parte de su catálogo compartido entre Sucursales.
_Evitar_: Stock, ítem de venta

**Unidad de venta**:
La forma en que se cuantifica un Producto al venderlo. Actualmente todos los Productos se venden en cantidades unitarias enteras.
_Evitar_: Cantidad, presentación

**Precio de venta**:
El importe unitario ofrecido para un Producto, definido por el Negocio y susceptible de una excepción explícita en una Sucursal.
_Evitar_: Producto, costo

**Stock**:
La existencia no negativa de un Producto en una Sucursal determinada.
_Evitar_: Inventario, Producto

**Stock esperado**:
La cantidad de un Producto comprometida en Compras pero aún no recibida físicamente. No forma parte del Stock disponible para vender.
_Evitar_: Stock, Disponibilidad offline

**Inventario**:
El control y registro de los cambios de Stock, incluidos ajustes, conteos físicos y transferencias entre Sucursales.
_Evitar_: Stock, catálogo

**Movimiento de inventario**:
El registro que explica una variación de Stock y conserva su cantidad, causa y autoría. Toda variación de Stock debe estar respaldada por un Movimiento de inventario.
_Evitar_: Stock, edición de stock

**Ajuste de stock**:
La corrección explícita que suma, resta o fija Stock por un motivo conocido.
_Evitar_: Conteo físico, Transferencia de stock

**Conteo físico**:
La declaración de la cantidad realmente observada de uno o más Productos en una Sucursal. La diferencia respecto del Stock registrado origina el Movimiento de inventario correspondiente.
_Evitar_: Ajuste de stock, Stock

**Transferencia de stock**:
El traslado indivisible de una cantidad de Stock entre dos Sucursales del mismo Negocio. Reduce el origen, aumenta el destino y registra ambos efectos como una sola operación.
_Evitar_: Ajuste de stock, transferencia bancaria

**Compra**:
El acuerdo de un Negocio para adquirir Productos de un proveedor. Sus cantidades permanecen como Stock esperado hasta su recepción física.
_Evitar_: Recepción de compra, Venta

**Recepción de compra**:
La confirmación total o parcial de los Productos de una Compra que llegaron físicamente a una Sucursal. Incrementa el Stock recibido y mantiene pendiente cualquier cantidad faltante.
_Evitar_: Compra, Stock esperado

## Caja

**Caja**:
La unidad operativa persistente de una Sucursal en la que se registran cobros y movimientos de efectivo.
_Evitar_: Sesión de caja, turno

**Sesión de caja**:
El período de operación comprendido entre la apertura y el cierre de una Caja, bajo la responsabilidad de un Usuario. Otros Usuarios autorizados pueden operar durante la sesión sin asumir su responsabilidad.
_Evitar_: Caja, turno de usuario

**Movimiento de caja**:
El ingreso o egreso de efectivo ajeno al cobro normal de una Venta, registrado con importe, motivo y autoría.
_Evitar_: Pago, diferencia de caja

**Diferencia de caja**:
La discrepancia registrada al cierre entre el efectivo esperado y el efectivo declarado de una Sesión de caja. Solo los Pagos en efectivo y los Movimientos de caja alteran el efectivo esperado.
_Evitar_: Movimiento de caja, corrección de saldo

## Ventas

**Venta**:
La operación comercial aceptada de forma autoritativa que registra productos, cantidades, pagos y el alcance de Sucursal y Caja correspondiente.
_Evitar_: Transacción, Venta pendiente offline

**Cliente**:
La persona u organización compradora que puede identificarse opcionalmente en una Venta. Actualmente Vendify no administra su cuenta corriente.
_Evitar_: Usuario, Negocio

**Ítem de venta**:
La captura histórica de un Producto dentro de una Venta, incluidos el nombre, la cantidad y el Precio de venta aplicados. Los cambios posteriores del catálogo no modifican esa captura.
_Evitar_: Producto, Stock

**Pago**:
La aplicación de un importe a una Venta mediante un Medio de pago. Una Venta puede combinar varios Pagos.
_Evitar_: Venta, Medio de pago

**Medio de pago**:
La forma en que se entrega valor para cubrir un Pago, como efectivo, transferencia, tarjeta o billetera.
_Evitar_: Proveedor de pago, Pago

**Proveedor de pago**:
El servicio externo que procesa o informa Pagos realizados mediante determinados Medios de pago, como Mercado Pago.
_Evitar_: Medio de pago, banco

**Pago mixto**:
La cobertura de una Venta mediante más de un Pago, sean o no del mismo Medio de pago.
_Evitar_: Medio de pago, pago parcial

**Descuento**:
La reducción autorizada del importe de una Venta, expresada como porcentaje o como monto.
_Evitar_: Reintegro, cambio de precio

**Código de descuento**:
La credencial controlada exclusivamente por el Propietario que delega la capacidad de aplicar un Descuento. Su uso identifica al Usuario que lo presentó y queda visible para la verificación posterior del Propietario; actualmente no es válida offline.
_Evitar_: Contraseña del Usuario, autorización presencial

**Pago acreditado**:
El Pago cuya recepción fue confirmada de manera verificable por su Proveedor de pago.
_Evitar_: Pago declarado, Pago pendiente

**Pago declarado**:
El Pago que un Cajero acepta bajo su responsabilidad tras verificar el importe recibido, sin acreditación integrada del Proveedor de pago.
_Evitar_: Pago acreditado, Pago pendiente

**Pago pendiente**:
El intento de Pago que aún no fue acreditado ni declarado y, por lo tanto, todavía no cubre una Venta.
_Evitar_: Pago acreditado, Pago declarado

**Política de pagos**:
La configuración de un Negocio que determina qué Medios de pago admite y cuáles pueden ser declarados por un Cajero sin acreditación integrada.
_Evitar_: Medio de pago, decisión del Cajero

**Moneda operativa**:
La moneda en la que un Negocio expresa todos sus importes. En Vendify es el peso argentino (ARS).
_Evitar_: Medio de pago, tipo de cambio

**Venta pendiente offline**:
Una intención de venta capturada durante una interrupción de conectividad y pendiente de aceptación autoritativa. Conserva el Negocio, la Sucursal, la Caja y el Usuario que la originaron; reserva disponibilidad offline, pero todavía no constituye una Venta.
_Evitar_: Venta confirmada, Venta sincronizada

**Autorización offline**:
El permiso temporal emitido para que una Caja de una Sucursal pueda crear Ventas pendientes offline dentro de Cupos offline explícitos. Tiene vencimiento y puede ser revocado sin borrar las ventas ya creadas.
_Evitar_: Sesión de usuario, copia de Stock

**Cupo offline**:
La cantidad máxima de un Producto que una Caja está autorizada a comprometer offline antes del vencimiento o la revocación de su Autorización offline.
_Evitar_: Stock, Reserva offline

**Anulación**:
La invalidación completa de una Venta por una corrección operativa, sin borrar su registro original.
_Evitar_: Devolución, eliminación de venta

**Devolución**:
La reversión total o parcial de una Venta consumada, con registro de los productos y el reintegro correspondientes. Solo repone Stock vendible cuando los productos devueltos son declarados aptos.
_Evitar_: Anulación, eliminación de venta

**Disponibilidad offline**:
La cantidad vendible de un Producto durante una interrupción de conectividad, limitada por el Cupo offline de la Caja y reducida por las Reservas offline conocidas del mismo Negocio y Sucursal. Sin una Autorización offline vigente no existe disponibilidad offline para nuevas ventas.
_Evitar_: Stock, disponibilidad garantizada

**Reserva offline**:
La cantidad de Stock apartada por una Venta pendiente offline hasta que esta sea aceptada o descartada explícitamente. Continúa vigente durante los reintentos y la revisión.
_Evitar_: Descuento de Stock, reserva del servidor

**Revisión offline**:
El estado de una Venta pendiente offline que no puede continuar sin una resolución explícita. No elimina la venta ni libera su Reserva offline por sí solo.
_Evitar_: Error descartado, reintento automático

**Descarte offline**:
La resolución autorizada que cancela una Venta pendiente offline y libera su Reserva offline. Requiere un Usuario con permiso específico y conserva el motivo y la autoría.
_Evitar_: Anulación, eliminación silenciosa

**Identificador de solicitud**:
La identidad estable de una intención de Venta durante todos sus reintentos. Repetirlo con el mismo contenido representa la misma operación; reutilizarlo con contenido diferente es un conflicto.
_Evitar_: Identificador de Venta, identificador de intento

**Cola offline**:
La secuencia ordenada de Ventas pendientes offline de un mismo Negocio, Sucursal, Caja y Usuario creador. Se procesa en orden de creación y una venta no resuelta bloquea las posteriores de esa Cola sin bloquear otras Colas.
_Evitar_: Historial de ventas, conjunto de ventas pendientes
