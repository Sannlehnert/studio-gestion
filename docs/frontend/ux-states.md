> Actualización Etapa 7.1: este documento conserva el diseño e inspección de F0. Para disponibilidad actual de endpoints y brechas, prevalecen [backend-contract-map](backend-contract-map.md) y el [contrato de integración](../frontend-integration-contract.md). No se inició Frontend F1.

# Estados y feedback — F0.31–F0.36, F0.43

Estado de la petición, estado de dominio y permisos se presentan por separado. La UI no interpreta un error de conexión como rechazo de negocio. [Mapa de contratos](backend-contract-map.md).

## Patrón de lectura y mutación

| Situación | Presentación | Acción / cuidado |
| --- | --- | --- |
| Primera carga | Skeleton con forma de fecha/fila/resumen cuando anticipa estructura. | Nombre accesible “Cargando”; no importes ni ceros falsos. |
| Refresco | Conservar datos anteriores y texto Actualizando. | Si falla, indicar desactualización. No saltar foco ni cerrar formulario. |
| Mutación pendiente | Botón ocupado, texto de operación, bloquear duplicado local. | Cancelar UI no implica cancelar request ya enviado; no crear otra intención silenciosamente. |
| Éxito confirmado | Resultado en contenido; toast complementario para pago/guardado. | No repetir POST si falla invalidación/GET posterior. |
| Validación | Mensaje junto al campo y resumen enfocable si hay varios. | Conservar entradas válidas; no depender de toast. |
| Conflicto | Explicación contextual junto a selección o panel. | Releer estado y permitir revisar; no sobrescribir automáticamente. |
| Forbidden | Vista o panel de permiso insuficiente. | Volver a área permitida; ocultar datos previos de otro rol. |
| Sin conexión en lectura | Aviso y Reintentar; indicar si hay última lectura en memoria. | No persistir datos privados para modo offline en esta fase. |
| Respuesta de mutación perdida | “No pudimos confirmar el resultado”. | Consultar recurso. Pago: retry misma clave/cuerpo; resto sin retry automático. |
| Error servidor | Mensaje genérico contextual y opción segura de recuperación. | No stack, SQL, payload ni token. |
| Sesión expirada | Ocultar información protegida, explicar y redirigir. | Admin login; Student pedir acceso. Evitar múltiples banners por cada query que recibió 401. |

Toasts no son única evidencia de asistencia ni conflicto. Modal para decisión sensible o edición concentrada; banner para sesión/conexión/estado global; inline para campos y restricciones locales. Los avisos no ocultan la acción principal ni el foco.

## Vacíos reales — F0.34

| Contexto | Texto | Próxima acción |
| --- | --- | --- |
| Alumnas, sin registros | Todavía no agregaste alumnas. | Agregar alumna. |
| Búsqueda sin coincidencia | No encontramos alumnas con esos filtros. | Limpiar búsqueda/filtro. |
| Hoy sin clases | No hay clases programadas para hoy. | Ver otra fecha; generación Admin secundaria. |
| Alumna sin contrato confirmado por lista | Todavía no tiene un contrato. | Crear contrato. |
| Contrato sin pagos | Todavía no registraste pagos para este contrato. | Registrar pago. |
| Roster sin esperadas | No hay alumnas esperadas para esta clase. | Revisar inscripciones; no inferir disponibilidad de cupo. |
| Student upcoming vacío | No aparecen próximas clases programadas. | Consultar con profesora; no deducir saldo cero. |
| Recuperaciones propias vacías | No tenés recuperaciones autorizadas. | Volver a Clases. |
| Auditoría filtrada vacía | No hay movimientos para estos filtros. | Cambiar fechas/quitar filtros. |
| Historial sin API | No representa un estado vacío implementable. | Bloqueo de integración API-03/04; no publicar “Sin historial”. |

## Mapping de errores real — F0.43

ApiErrorDto tiene statusCode/error/message; no un código de negocio estable. Mapear por HTTP y operación, con relectura autorizada cuando resuelva el contexto. No parsear strings mediante regex ni mostrar cualquier message como HTML. Los textos de negocio específicos siguientes sólo se usan si el dato es observable o un futuro contrato identifica la causa; en otro caso usar el fallback.

| Respuesta / contexto | Significado UX | Mensaje propuesto | Acción |
| --- | --- | --- | --- |
| 400, formulario | Input inválido. | Revisá los datos indicados. | Errores seguros junto a campos; mensaje general si no hay asociación inequívoca. |
| 401, login | Credenciales no válidas. | No pudimos ingresar con esos datos. | Revisar credenciales, sin confirmar email existente. |
| 401, activación | Acceso no utilizable; varias causas unificadas. | Este acceso no se puede usar. Pedile uno nuevo a tu profesora. | Nuevo enlace; no enumerar causa exacta. |
| 401, protegida | Sesión inexistente/no válida. | Tu sesión terminó. | Login Admin / acceso Student. |
| 403 | Permiso u origen no admitido. | No pudimos autorizar esta acción. | Volver al área propia; si es configuración de origen, soporte, no reingresar en bucle. |
| 404 | Recurso no encontrado o no visible. | No encontramos este registro. | Volver/listado; no revelar otra alumna. |
| 409, QR inválido/vencido/revocado/cruzado | Challenge no utilizable; causa unificada. | No pudimos validar ese QR. Escaneá el que muestra tu profesora para esta clase. | Volver a escanear; no reutilizar token viejo. |
| 409, Attendance con ventana CLOSED verificada | Se cerró el registro. | El registro de asistencia para esta clase ya cerró. | Ver resultado o consultar profesora. |
| 409, PRESENT existente verificado por GET | Resultado ya presente. | Ya tenés registrada tu asistencia. | Ver clase; no atribuir autor nuevo. |
| 409, allowance agotado confirmado y participación normal | Sin saldo de clases normales. | No quedan clases disponibles en este contrato. | Consultar profesora; Recovery no se bloquea sólo por cero. |
| 409, destino Recovery / cupo sin código identificable | Destino no aceptado; causa puede haber cambiado. | No pudimos autorizar esta clase. Revisá el destino y volvé a consultar. | Actualizar opciones; no afirmar “sin cupo” si no se conoce. |
| Capacidad insuficiente identificable con futuro contrato | Última plaza ocupada. | No quedan lugares en esta clase. | Elegir otro destino; no reservar localmente. |
| 409, corrección con Recovery no cancelada verificada | Dependencia que impide cambiar origen. | Esta ausencia tiene una recuperación asociada que debe revisarse primero. | Abrir Recovery; no cancelación automática. |
| 409, pago | Saldo/contrato/intención incompatible. | No pudimos registrar el pago con estos datos. Revisá el estado del contrato. | Releer; conservar clave si es la misma intención incierta. |
| 409, manual y Attendance existente verificada | El alta no puede sobrescribir. | Esta alumna ya tiene un resultado registrado. | Ver resultado; corrección explícita si corresponde. |
| 429 | Límite temporal. | Hubo demasiados intentos. Esperá un momento y volvé a intentar. | Respetar Retry-After si existe; no inventar segundos exactos si no viene. |
| Sin respuesta / timeout | Resultado no conocido. | No pudimos confirmar la operación. | Relectura segura; reglas específicas de retry. |
| 5xx | Problema del servidor. | No pudimos completar la consulta. Intentá nuevamente. | Retry lectura; si era mutación, aclarar primero resultado. |

## Confirmaciones sensibles — F0.33

| Operación | Información antes de confirmar |
| --- | --- |
| Desactivar alumna | Nombre, efecto sobre acceso/participación actual y conservación de historia. Reactivar no revive credenciales. |
| Cancelar contrato | Alumna/período; efectos operativos y posibles Recoveries no disponibles. No prometer reembolso ni eliminación de pagos. |
| Anular pago | Importe/fecha/contrato; deja de contar como pagado y permanece anulado en historial. |
| Cancelar clase | Fecha/hora; clase no disponible y efecto derivado en recuperaciones. Motivo según contrato. |
| Cancelar Recovery | Ausencia/destino; se conserva autorización histórica y no borra resultados. Sólo si backend lo admite. |
| Corrección | Nombre/clase, estado anterior → solicitado y motivo obligatorio; historial conservado. |
| Revocar acceso pendiente | Referencia conocida; impide activarlo y no cierra sesiones ya establecidas. No puede recuperarse el secreto anterior. |

Botones con verbo concreto, por ejemplo “Anular pago” y “Conservar pago”. No doble confirmación para guardar nombre o filtros. Los formularios de manual/corrección incorporan su revisión y motivo, sin alarmismo. Acciones irreversibles no ofrecen Undo ficticio.

## Concurrencia percibida

Deshabilitar doble clic reduce errores de interacción, no asegura integridad. Otra Admin puede cobrar, corregir o tomar cupo mientras esta pantalla está abierta. Todo 409 mantiene contexto y ofrece relectura. La UI no calcula una nueva autorización desde datos viejos. Después de un cambio confirmado, mostrar respuesta backend antes de refrescar dependencias. Si otra operación cambia nuevamente el estado, presentar la nueva lectura con aviso discreto, sin encadenar una corrección para restaurar el estado deseado automáticamente.
