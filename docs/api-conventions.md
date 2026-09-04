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
| 409    | Intento de revocar un enlace ya consumido                            |
| 413    | Body excede el límite                                                |
| 415    | Tipo de body, compresión o charset no admitido                       |
| 429    | Límite de solicitudes; incluye Retry-After                           |
| 500    | Error interno genérico                                               |

## Repetición y concurrencia

Logout y revocación de un pendiente ya revocado son idempotentes. Una segunda activación responde 401 y no crea otra sesión. Crear un acceso o iniciar otro login puede crear otro registro: no se promete idempotencia de esas operaciones. No reintentar automáticamente la emisión de enlaces suponiendo que devuelve el mismo secreto.

Las fechas de revocación no se reemplazan al repetir el pedido. Los eventos AuditLog de éxito se escriben en la misma transacción que el cambio.

## Fechas, dinero y futuras listas

Fechas de API: ISO 8601 con zona; backend como autoridad temporal. BUSINESS_TIMEZONE se valida centralmente; las reglas de calendarios recurrentes todavía no están implementadas.

Dinero persistido como Decimal(10,2), nunca Float, y serializado como string con dos decimales. Requests monetarios también exigen strings para rechazar redondeos JSON implícitos. La moneda soportada en el MVP es ARS y Payment la deriva de Subscription.

El listado Students usa página/offset con `page` default 1 y máximo 100000, `limit` default 20 y máximo 100. Devuelve `{ items, meta: { page, limit, total, totalPages } }` y ordena por nombre e ID. El filtro `status` acepta `active`, `inactive` y `all`; `search` realiza coincidencia parcial sin distinguir mayúsculas. Ver [Students](students.md).

Plans, Subscriptions y Payments reutilizan la misma forma paginada. Plans filtra `active|inactive|all` y busca por nombre. Subscriptions filtra `active|expired|cancelled|all`. Payments filtra `confirmed|voided|all`. Fechas de entrada requieren ISO 8601 con zona; periodEnd es exclusivo.
