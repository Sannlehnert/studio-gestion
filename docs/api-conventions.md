# Convenciones de API

## Contrato y rutas actuales

Prefijo /api/v1. Los endpoints usan DTOs estrictos y OpenAPI del backend; no duplicar contratos en frontend sin necesidad.

| Método y ruta                                                  | Acceso                              | Resultado                                              |
| -------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------ |
| GET /api/v1/health                                             | Público                             | 200, status y timestamp                                |
| POST /api/v1/auth/admin/login                                  | Público, Origin/Referer obligatorio | 200, identidad Admin y expiresAt; Set-Cookie           |
| POST /api/v1/auth/student/activate                             | Público, Origin/Referer obligatorio | 200, identidad Student y expiresAt; Set-Cookie         |
| GET /api/v1/auth/me                                            | Sesión vigente                      | 200, user derivado de sesión                           |
| POST /api/v1/auth/logout                                       | Origin/Referer obligatorio          | 204 incluso si no hay sesión; limpia cookie            |
| GET /api/v1/admin/check                                        | ADMIN                               | 200, comprobación de permisos                          |
| GET /api/v1/student/check                                      | STUDENT                             | 200, comprobación de permisos                          |
| POST /api/v1/admin/students/:studentId/access                  | ADMIN                               | 201, accessId, activationUrl con fragmento y expiresAt |
| POST /api/v1/admin/students/:studentId/access/:accessId/revoke | ADMIN                               | 204; 409 si ya fue activado                            |
| POST /api/v1/admin/students                                    | ADMIN                               | 201, crea una alumna activa                            |
| GET /api/v1/admin/students                                     | ADMIN                               | 200, listado/búsqueda paginada                         |
| GET /api/v1/admin/students/:id                                 | ADMIN                               | 200, detalle acotado de Student                        |
| PATCH /api/v1/admin/students/:id                               | ADMIN                               | 200, modifica fullName                                 |
| POST /api/v1/admin/students/:id/deactivate                     | ADMIN                               | 200, desactiva de forma idempotente                    |
| POST /api/v1/admin/students/:id/reactivate                     | ADMIN                               | 200, reactiva de forma idempotente                     |
| POST /api/v1/admin/plans                                       | ADMIN                               | 201, crea una oferta activa                            |
| GET /api/v1/admin/plans                                        | ADMIN                               | 200, lista/busca planes paginados                      |
| GET /api/v1/admin/plans/:id                                    | ADMIN                               | 200, detalle del plan                                  |
| PATCH /api/v1/admin/plans/:id                                  | ADMIN                               | 200, edita catálogo para futuras ventas                |
| POST /api/v1/admin/plans/:id/activate                          | ADMIN                               | 200, activa de forma idempotente                       |
| POST /api/v1/admin/plans/:id/deactivate                        | ADMIN                               | 200, desactiva de forma idempotente                    |
| POST /api/v1/admin/subscriptions                               | ADMIN                               | 201, crea contrato y snapshot                          |
| GET /api/v1/admin/subscriptions                                | ADMIN                               | 200, lista por estado operativo                        |
| GET /api/v1/admin/subscriptions/:id                            | ADMIN                               | 200, contrato y finanzas derivadas                     |
| POST /api/v1/admin/subscriptions/:id/cancel                    | ADMIN                               | 200, cancela de forma idempotente                      |
| GET /api/v1/admin/subscriptions/:id/financial-summary          | ADMIN                               | 200, acordado, pagado, saldo y estado                  |
| GET /api/v1/admin/students/:studentId/subscriptions            | ADMIN                               | 200, contratos de una alumna                           |
| POST /api/v1/admin/subscriptions/:subscriptionId/payments      | ADMIN + Idempotency-Key UUID v4     | 201, registra dinero recibido                          |
| GET /api/v1/admin/subscriptions/:subscriptionId/payments       | ADMIN                               | 200, pagos de una suscripción                          |
| GET /api/v1/admin/payments                                     | ADMIN                               | 200, lista pagos y anulaciones                         |
| GET /api/v1/admin/payments/:id                                 | ADMIN                               | 200, detalle trazable                                  |
| POST /api/v1/admin/payments/:id/void                           | ADMIN                               | 200, anula con motivo e idempotencia                   |
| POST /api/v1/admin/schedules                                   | ADMIN                               | 201, crea recurrencia activa                           |
| GET /api/v1/admin/schedules                                    | ADMIN                               | 200, lista por estado/día                              |
| GET /api/v1/admin/schedules/:id                                | ADMIN                               | 200, detalle                                           |
| PATCH /api/v1/admin/schedules/:id                              | ADMIN                               | 200, edita futuras generaciones                        |
| POST /api/v1/admin/schedules/:id/activate                      | ADMIN                               | 200, activa idempotentemente                           |
| POST /api/v1/admin/schedules/:id/deactivate                    | ADMIN                               | 200, desactiva idempotentemente                        |
| POST /api/v1/admin/enrollments                                 | ADMIN                               | 201, crea pertenencia temporal                         |
| GET /api/v1/admin/enrollments/:id                              | ADMIN                               | 200, detalle histórico                                 |
| POST /api/v1/admin/enrollments/:id/end                         | ADMIN                               | 200, acorta la vigencia                                |
| POST /api/v1/admin/enrollments/:id/change-schedule             | ADMIN                               | 200, cierra el anterior y crea el nuevo                |
| GET /api/v1/admin/students/:studentId/enrollments              | ADMIN                               | 200, inscripciones de la alumna                        |
| GET /api/v1/admin/subscriptions/:subscriptionId/enrollments    | ADMIN                               | 200, inscripciones del contrato                        |
| GET /api/v1/admin/schedules/:scheduleId/enrollments            | ADMIN                               | 200, inscripciones del horario                         |
| POST /api/v1/admin/class-sessions/generate                     | ADMIN                               | 200, genera un rango idempotentemente                  |
| GET /api/v1/admin/class-sessions                               | ADMIN                               | 200, clases paginadas y filtradas                      |
| GET /api/v1/admin/class-sessions/:id                           | ADMIN                               | 200, snapshot de la clase                              |
| PATCH /api/v1/admin/class-sessions/:id/capacity                | ADMIN                               | 200, excepción de capacidad                            |
| PATCH /api/v1/admin/class-sessions/:id/time                    | ADMIN                               | 200, excepción horaria                                 |
| POST /api/v1/admin/class-sessions/:id/cancel                   | ADMIN                               | 200, cancela idempotentemente con motivo               |
| GET /api/v1/admin/class-sessions/:id/expected-students         | ADMIN                               | 200, roster derivado para Attendance                   |
| GET /api/v1/admin/class-sessions/:id/attendance                | ADMIN                               | 200, expected/present/absent/pending y ventana         |
| GET /api/v1/admin/subscriptions/:id/class-summary              | ADMIN                               | 200, allowance y consumo derivado                      |
| GET /api/v1/student/class-sessions/upcoming                    | STUDENT                             | 200, próximas clases propias y ventana                 |
| POST /api/v1/student/class-sessions/:id/attendance             | STUDENT                             | 200, crea o devuelve PRESENT propio con challenge vigente |
| POST /api/v1/admin/class-sessions/:id/qr-challenge | ADMIN | 201, emite challenge opaco y expiresAt |
| GET /api/v1/student/class-sessions/:id/attendance              | STUDENT                             | 200, estado propio sin exponer otras alumnas           |
| GET /api/v1/student/subscriptions/:id/class-summary            | STUDENT propietaria                 | 200, allowance y consumo propio                        |

Swagger de desarrollo: /api/docs; JSON: /api/docs-json. Deshabilitados en producción.

## Requests

- application/json, máximo BODY_LIMIT_BYTES (16384 por defecto). No se admiten uploads, cuerpos comprimidos ni URL encoded.
- Los DTOs rechazan campos desconocidos. La identidad Student y el rol vienen de la sesión, nunca del body.
- Admin login: email válido hasta 254 caracteres; contraseña entre 8 y 1024. El seed exige al menos 12.
- Student activation: token base64url de 43 caracteres; no recibe studentId.
- Emisión de acceso: expiresInDays opcional, entero 1–30, default 7. Cada emisión crea un enlace independiente.
- Los IDs en params se validan como UUID. Un ID no confiere autorización; la revocación comprueba acceso y alumna juntos.
- Revocación y logout reciben un body vacío, si se envía body. No hay método GET con operaciones administrativas.
- Los clientes de navegador usan credentials: include. Las operaciones mutables deben tener un Origin permitido; se admite Referer válido solo si falta Origin. Clientes CLI deben enviar Origin explícitamente.
- Schedule recibe día ISO 1–7, horas `HH:mm` y capacidad 1–1000. No recibe minutos internos, IDs, estado ni timestamps.
- Enrollment recibe IDs de Student/Subscription/Schedule y fechas locales `YYYY-MM-DD`; `validUntil` es exclusivo. No existe PATCH genérico.
- La generación admite un rango local inclusivo de hasta 366 días. Las excepciones horarias reciben ISO 8601 con offset o `Z`; cancelar exige motivo.
- Marcar Attendance recibe únicamente `{ challenge }`, obligatorio, string opaco de 47 caracteres. Student, Subscription, estado, origen, timestamp y totales se derivan de sesión, dominio, base y reloj del backend. `upcoming.limit` admite 1–20.

## Respuestas y errores

Las identidades son proyecciones explícitas. No se devuelven passwordHash, tokenHash ni secretos de sesión en JSON. El enlace de activación solo se devuelve al Admin que lo emite y lleva Cache-Control: no-store.

Formato de error:

    {
      "statusCode": 403,
      "timestamp": "2026-09-02T12:00:00.000Z",
      "path": "/api/v1/auth/logout",
      "error": "Forbidden",
      "message": "Origen de la operación no permitido"
    }

message puede ser una cadena o una lista de errores de validación. Nunca incluye stack ni query string. El filtro normaliza parsing y errores inesperados.

| Código | Uso                                                                  |
| ------ | -------------------------------------------------------------------- |
| 400    | DTO, UUID o JSON inválido                                            |
| 401    | Sesión, credenciales o token de acceso inválidos                     |
| 403    | Rol insuficiente, Origin no permitido o CSRF                         |
| 404    | Recurso inexistente o acceso que no corresponde a la alumna indicada |
| 409    | Conflicto de estado, período, relación, solapamiento o cupo           |
| 413    | Body excede el límite                                                |
| 415    | Tipo de body, compresión o charset no admitido                       |
| 429    | Límite de solicitudes; incluye Retry-After                           |
| 500    | Error interno genérico                                               |

## Repetición y concurrencia

Logout y revocación de un pendiente ya revocado son idempotentes. También lo son activar/desactivar Schedule, cancelar ClassSession, finalizar con el mismo extremo, repetir el mismo cambio de horario y generar el mismo rango. Una segunda activación de acceso responde 401 y no crea otra sesión. Crear un acceso o iniciar otro login puede crear otro registro: no se promete idempotencia de esas operaciones. No reintentar automáticamente la emisión de enlaces suponiendo que devuelve el mismo secreto.

Las fechas de revocación no se reemplazan al repetir el pedido. Los eventos AuditLog de éxito se escriben en la misma transacción que el cambio.

Repetir un PRESENT ya persistido con challenge vigente y condiciones de acceso válidas devuelve 200 con el mismo Attendance y no crea otro evento. Un challenge vencido/revocado/de otra clase responde 409 incluso en reintentos; falta de challenge o formato inválido responde 400. El cierre repetido no duplica ABSENT ni auditoría. ClassSession, Student y Subscription se bloquean para serializar PRESENT, reconciliación y el último allowance; UNIQUE(studentId, classSessionId) resuelve la carrera final.

## Fechas, dinero y futuras listas

Los instantes contractuales y excepciones usan ISO 8601 con zona; el backend es la autoridad temporal. Las recurrencias usan fecha local `YYYY-MM-DD` y hora local `HH:mm`, interpretadas sólo con BUSINESS_TIMEZONE. ClassSession devuelve instantes UTC y conserva `occurrenceDate` como identidad civil. Las horas locales inexistentes o repetidas por cambios de offset se rechazan. Attendance usa una ventana semiabierta: apertura inclusiva y cierre exclusivo. Ningún timestamp del cliente interviene.

Dinero persistido como Decimal(10,2), nunca Float, y serializado como string con dos decimales. Requests monetarios también exigen strings para rechazar redondeos JSON implícitos. La moneda soportada en el MVP es ARS y Payment la deriva de Subscription.

El listado Students usa página/offset con `page` default 1 y máximo 100000, `limit` default 20 y máximo 100. Devuelve `{ items, meta: { page, limit, total, totalPages } }` y ordena por nombre e ID. El filtro `status` acepta `active`, `inactive` y `all`; `search` realiza coincidencia parcial sin distinguir mayúsculas. Ver [Students](students.md).

Plans, Subscriptions, Payments y scheduling reutilizan la misma forma paginada. Plans filtra `active|inactive|all`; Subscriptions `active|expired|cancelled|all`; Payments `confirmed|voided|all`; Schedules `active|inactive|all`; Enrollment `upcoming|active|expired|all`; ClassSession `scheduled|cancelled|completed|all`. Ver [scheduling](scheduling.md).

## Emisión QR y límites autenticados

POST /api/v1/admin/class-sessions/:id/qr-challenge recibe body vacío, requiere Admin y Origin permitido, y responde 201 con challenge, classSessionId y expiresAt. No admite TTL, estado ni autor externos. Sólo se emite para una clase SCHEDULED con ventana abierta. Cada llamada exitosa emite un secreto nuevo: no es idempotente y no recupera un secreto anterior. No hay cooldown de medio TTL. El anterior se tolera hasta su expiry original o hasta ser desplazado por dos emisiones posteriores.

No hay endpoint de estado ni imagen QR. El secreto se devuelve una única vez y todas las respuestas llevan Cache-Control: no-store. El cliente debe mostrar la última respuesta recibida y evitar peticiones de rotación superpuestas; si pierde la respuesta puede solicitar otra, respetando rate limiting. El QR contiene sólo el token; la ClassSession se obtiene del contexto de las clases propias, no de una URL que transporte el secreto.

RATE_ATTENDANCE_LIMIT/WINDOW_MS aplica por Student autenticada (20/min), no por IP. RATE_QR_CHALLENGE_LIMIT/WINDOW_MS aplica por Admin y ClassSession (20/min). Ambos acumulan el límite general por IP. Un 429 incluye Retry-After. Reiniciar sesión no cambia la identidad del contador. Ver [attendance-qr.md](attendance-qr.md).

## Contrato de Recoveries

POST Admin `/attendances/:attendanceId/recovery` acepta sólo targetClassSessionId y responde 200 tanto al crear como al repetir el mismo destino. Otro destino exige cancelación previa y responde 409. POST `/recoveries/:id/cancel` acepta reason y conserva la primera cancelación. GET Admin/Student `/recoveries` y `/recoveries/:id` usan propiedad en la consulta, UUIDs y listas acotadas; Student ajena obtiene 404.

`cancellation=all|not_cancelled|cancelled` es un filtro administrativo; Admin agrega studentId/originalAttendanceId. Las respuestas derivan state/unavailableReason. Expected/Attendance agregan origin y recoveryId nullable; enrollmentId también es nullable para participación adicional. Attendance devuelve consumesAllowance derivado. Las rutas completas y la semántica están en [Recoveries](recoveries.md).

## Etapa 7: Admin Corrections y Audit

Todas las rutas requieren sesión Admin. POST exige Origin/Referer permitido y JSON estricto.

| Método | Ruta bajo /api/v1 | Body / respuesta |
|---|---|---|
| POST | /admin/class-sessions/:classSessionId/students/:studentId/attendance | {reason}; 201, vista Attendance. Existente: 409 |
| POST | /admin/attendances/:attendanceId/corrections | {targetStatus,reason}; 200 {attendance,correction}; no-op correction=null |
| GET | /admin/attendances/:attendanceId/corrections | page/limit; items y meta; sequence ASC |
| GET | /admin/audit-logs | filtros actor/entidad/acción/fechas; items y meta; fecha DESC, id DESC |

Motivo trim 3–500. No se aceptan campos de identidad, fuente, consumo o tiempo por body. Attendance incluye originalStatus; source incluye ADMIN y representa origen, no el autor de la última corrección. [Semántica](admin-corrections.md), [filtros y metadata](operational-audit.md).

## Integración frontend — Etapa 7.1

ApiError agrega code estable y conserva message/error/statusCode/timestamp/path. CORS admite Content-Type e Idempotency-Key explícitos. Nuevos históricos/opciones usan page/limit e items/meta; today=true usa BusinessTime y no admite dateFrom/dateTo. OpenAPI tipa enteros, enums, fechas civiles, instantes, nullables y dinero string.

Contrato completo y límites: [frontend-integration-contract.md](frontend-integration-contract.md). Evidencia: [stage-7.1-validation.md](stage-7.1-validation.md).
