# Plans, Subscriptions y Payments

## Alcance

Etapa 2 implementa el catálogo comercial y los acuerdos concretos de cada alumna. Todas las rutas son Admin, usan `/api/v1`, DTOs estrictos, UUIDs y auditoría transaccional. No existen DELETE comerciales ni edición libre de contratos o pagos.

## Plan

Plan es una oferta reusable. Conserva nombre, descripción opcional, cantidad de clases, precio referencial actual, ARS y estado activo. Puede editarse y activarse/desactivarse. Un Plan inactivo no admite nuevas Subscription y no modifica contratos existentes.

El precio puede ser cero; classCount debe ser positivo. El catálogo no impone unicidad de nombres porque el mismo nombre puede corresponder a ofertas distintas, aunque la interfaz debería evitar ambigüedad.

## Subscription y snapshot

Subscription es el acuerdo histórico. Conserva:

- `planId` como procedencia;
- `planName`;
- `classAllowance`;
- `agreedPrice`;
- `currency`;
- `periodStart` y `periodEnd`.

Editar Plan no reescribe esos campos. Admin puede enviar `agreedPrice` explícito para un descuento; si lo omite se copia el precio referencial. El evento de auditoría guarda ambos importes y si hubo precio personalizado.

Los períodos son intervalos `[periodStart, periodEnd)`: inicio incluido y fin excluido. Fechas adyacentes no se superponen. Una Student sólo puede tener una Subscription ACTIVE que cubra un instante. Las canceladas conservan historia y dejan de bloquear un contrato de reemplazo.

Subscription persiste `ACTIVE|CANCELLED`. `EXPIRED` se deriva comparando periodEnd con el reloj. El estado financiero no pertenece al estado operativo.

## Payments y finanzas

Payment representa dinero recibido y soporta varios pagos parciales por Subscription. Guarda importe Decimal(10,2), moneda derivada, paidAt, método opcional, nota, Admin creador y timestamps.

El MVP rechaza sobrepagos. Antes de insertar, el servicio bloquea la Subscription, suma Payments CONFIRMED y compara el nuevo importe con el saldo. El request no puede elegir currency, status, total pagado ni saldo.

Registrar requiere `Idempotency-Key` UUID v4. Repetir exactamente subscription, actor, importe, paidAt, método y nota devuelve el mismo Payment sin otra auditoría. Reutilizar la clave con datos diferentes responde 409.

Payment no se edita ni borra. Una corrección cambia CONFIRMED a VOIDED y exige motivo, Admin y timestamp; luego puede registrarse un nuevo Payment correcto. Repetir la anulación devuelve el mismo registro y no duplica AuditLog.

El resumen se deriva con Decimal:

- PENDING: pagado cero;
- PARTIAL: mayor que cero y menor que acordado;
- PAID: igual al acordado;
- OVERPAID: defensa de lectura ante datos externos o legados, aunque la API impide crearlo.

Los importes JSON siempre son strings con dos decimales.

## PostgreSQL y concurrencia

CHECKs protegen nombres, classCount, importes, ARS, períodos y coherencia de cancelación/anulación. FKs comerciales usan RESTRICT. `Payment.idempotencyKey` es UNIQUE.

`btree_gist` permite la exclusión `Subscription_no_active_overlap` sobre Student e intervalo `tsrange`, sólo para estado ACTIVE. El servicio bloquea primero Student y luego Plan para mensajes previsibles y para coordinar activación/desactivación. PostgreSQL queda como defensa frente a otros procesos.

Registrar y anular pagos toma lock de la Subscription. Anular también bloquea Payment. Ese orden serializa el saldo y evita dos sobrepagos o dos auditorías de anulación.

## Migración

`20260904090000_commercial_core` es transaccional. Plan existentes reciben ARS y se preservan. El schema anterior no podía conocer el precio histórico de Subscription ni el Admin de Payment; si encuentra alguna fila de esos modelos, aborta antes de alterar tablas y exige un mapeo manual. No inventa historia ni borra filas.

## Límites

La moneda única es ARS. No hay reembolsos, créditos a favor, pasarela online ni modificación contractual posterior. Una cancelación no anula pagos. El consumo de classAllowance se implementará junto con clases e inscripciones, no como contador mutable en esta etapa.
