# Contrato de integración frontend — Etapa 7.1

Implementación aditiva sobre Etapa 7. Estado de gates y limitaciones: [stage-7.1-validation.md](stage-7.1-validation.md). No inicia Frontend F1 ni cambia el schema o las reglas de consumo. No hay migración 7 → 7.1.

## Endpoints

Todas las rutas llevan `/api/v1`. Mantienen sesión cookie, guards por rol, validación estricta y `Cache-Control: no-store`.

| Método | Ruta | Auth | Propósito |
| --- | --- | --- | --- |
| GET | `/student/home-summary` | Student | Contrato contextual, consumo, próxima clase y recuperación aplicable. |
| GET | `/student/attendance-history` | Student | Attendance persistida propia, paginada y sin metadata interna. |
| GET | `/admin/students/:studentId/subscription-summary` | Admin | Contrato contextual y resumen financiero/consumo. |
| GET | `/admin/students/:studentId/class-sessions/upcoming` | Admin | Próximas por pertenencia habitual/Recovery, ventana y resultado efectivo. |
| GET | `/admin/students/:studentId/attendance-history` | Admin | Attendance persistida por alumna; detalle de correcciones en su endpoint existente. |
| GET | `/admin/attendances/:attendanceId/recovery-options` | Admin | Destinos válidos con ocupación real, sin reservar lugares. |
| GET | `/admin/class-sessions?today=true` | Admin | Listado existente filtrado por día del negocio en servidor. |

`auth/me` conserva `{ user }`: no recibe campos temporales ni financieros nuevos. Student no envía identidad o contrato para descubrir su situación. Los query params desconocidos se rechazan, incluso en Home y resumen Admin.

## Contrato contextual y Home

`context` representa selección, no estado persistido:

- `CURRENT`: Subscription administrativamente ACTIVE, `periodStart <= readAt < periodEnd`.
- `UPCOMING`: sin CURRENT, próxima ACTIVE por periodStart; desempate estable por id.
- `NONE`: ninguna vigente/futura; subscription es null. Un contrato vencido nunca sustituye al contextual.

El índice de exclusión existente impide solapamiento entre contratos ACTIVE. La consulta selecciona el primero ACTIVE cuyo periodEnd sea posterior al instante de lectura, ordenado por inicio; por esa invariante, un vigente precede a cualquier futuro.

`subscription` incluye subscriptionId, planName contractual, status persistido, período y classAllowance/usedClasses/remainingClasses/integrityStatus/overconsumedClasses. El estado operativo temporal se expresa con context, sin renombrar el status de dominio.

Consumo sigue contando Attendance con recoveryId null, PRESENT y ABSENT. Una corrección no altera consumo; Recovery no añade consumo. NONE no fabrica un allowance cero. Student no recibe agreedPrice, pagos ni resumen financiero. Admin agrega financialSummary del contrato seleccionado, o null si no hay contrato contextual.

Home agrega nextClass y nextRecovery. Próximas incluye clases SCHEDULED cuya ventana aún no cerró, con pertenencia histórica válida. Cada item trae classSession, participationKind, recoveryId nullable, Attendance efectiva si existe y window. No asume que todas las clases de la lista aún no empezaron.

nextRecovery se busca independientemente, sin limitarse a filtrar una página de próximas: autorización no cancelada, aplicable y sin resultado. Si coincide con nextClass se devuelve null para evitar duplicar el bloque. No incluye listas de pagos, inscripciones o históricos en Home.

Home, resumen Admin y próximas Admin incluyen `readAt`, `businessDate` y `timeZone` IANA. Las lecturas compuestas usan RepeatableRead y un mismo instante lógico. No adquieren locks de reserva ni generan AuditLog.

## Historial

Fuente: Attendance persistida, no expected actual, caché cliente o AuditLog. Se conserva visibilidad Admin después de desactivar Student; Student sigue requiriendo sesión/actividad según guard existente.

Item público compartido:

- attendanceId para navegación contextual;
- classSession: classSessionId, occurrenceDate civil, startAt/endAt y status;
- effectiveStatus: PRESENT/ABSENT;
- participationKind: REGULAR/RECOVERY; distinto de Attendance.source;
- corrected: existencia de al menos una AttendanceCorrection, incluso si status volvió al original;
- recovery: null o recoveryId y originalClass legible.

No incluye source, originalStatus, motivos, Admin, secuencias de Correction ni metadata AuditLog. Admin consulta el detalle inmutable por el endpoint específico de correcciones cuando lo necesita.

Filtros: page 1–100000, limit 1–100 (default 20), effectiveStatus opcional, dateFrom/dateTo civiles inclusivos sobre occurrenceDate. Fechas inválidas/invertidas se rechazan; con ambos extremos, máximo 366 días. Sin rango se puede recorrer todo el historial paginado. Orden startAt DESC e id DESC. `{ items, meta: { page, limit, total, totalPages } }`; count y página comparten snapshot.

## Recuperaciones y ocupación

Options exige ausencia normal efectiva, clase origen no cancelada, Student activa y contrato ACTIVE. Una autorización no cancelada de esa ausencia devuelve RECOVERY_ALREADY_AUTHORIZED; consultar su detalle o cancelarla explícitamente según reglas vigentes.

Destinos: otra clase SCHEDULED, no iniciada, posterior al origen, dentro del mismo contrato, actividad histórica aplicable, sin pertenencia habitual de la Student, sin Attendance previa, sin autorización incompatible y con capacidad real.

`ClassParticipationService.forSessions` deriva participación en lote. El cálculo de `reservations` usado por mutaciones delega al mismo mecanismo sin filtrar actividad histórica: desactivar Student no libera automáticamente reservas. Se conservan vigencias y cancelaciones contractuales aplicables, se unen habituales/Recoveries y se deduplica Student. No hay contador persistido.

Cada opción incluye classSessionId, occurrenceDate, startAt/endAt, status, dayOfWeek, capacity, occupied y available. `available = max(0, capacity - occupied)`. Las opciones con available cero se excluyen. No equivale a capacity menos expected.

Rango default: día del negocio y siguientes 89 días; si se envía dateFrom sin dateTo, termina 89 días después de dateFrom. Máximo 366 días; mismo page/limit que historial. El rango efectivo se devuelve con timeZone y availabilityAsOf. Orden startAt ASC/id ASC; total/paginación se calculan después de filtrar elegibilidad.

La lectura no reserva. POST recovery conserva locks, revalidaciones, transacción/audit y constraints existentes; última plaza ocupada responde `409 CLASS_SESSION_FULL`. Repetir una autorización válida conserva el replay existente.

Lecturas de opciones y nuevas próximas tienen límite defensivo de 1000 clases candidatas: si se supera, se devuelve 400 VALIDATION_FAILED en lugar de truncar silenciosamente. Options permite acotar rango. Nuevas próximas/Home no tienen paginación de candidatas: superar ese límite requiere revisar el volumen de clases generadas o ampliar el contrato en una etapa posterior. Próximas Admin permite limit 1–20, default 10. La API Student upcoming preexistente conserva su contrato.

## Errores

Se conserva statusCode/timestamp/path/error/message y se agrega `code`. message puede seguir siendo string o array; no es una clave para lógica frontend. path excluye query string. Código asignado explícitamente al decidir el conflicto; no se parsean mensajes ni se reflejan códigos Prisma. El filtro admite sólo valores del catálogo público. Errores inesperados conservan 500 y respuesta genérica.

| Familia | Códigos estables |
| --- | --- |
| Infra/API | VALIDATION_FAILED, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, RATE_LIMITED, CSRF_REJECTED, INTERNAL_ERROR, CONFLICT, PAYLOAD_TOO_LARGE, UNSUPPORTED_MEDIA_TYPE |
| Auth | INVALID_CREDENTIALS, SESSION_INVALID, STUDENT_ACCESS_INVALID |
| Attendance | ATTENDANCE_TOO_EARLY, ATTENDANCE_WINDOW_CLOSED, ATTENDANCE_ALREADY_RECORDED, ATTENDANCE_QR_INVALID, ALLOWANCE_EXHAUSTED, ATTENDANCE_INELIGIBLE, ATTENDANCE_CORRECTION_BLOCKED |
| Capacity | CLASS_SESSION_FULL, CAPACITY_CONFLICT |
| Recovery | RECOVERY_INVALID, RECOVERY_UNAVAILABLE, RECOVERY_ALREADY_AUTHORIZED, REGULAR_ENROLLMENT_COVERS_TARGET |
| Comercial | STUDENT_INACTIVE, PLAN_INACTIVE, SUBSCRIPTION_OVERLAP |
| Payments | PAYMENT_IDEMPOTENCY_CONFLICT, PAYMENT_OVERPAYMENT |

El fallback CONFLICT cubre conflictos históricos sin categoría MVP específica; no inventa una causa. VALIDATION_FAILED cubre ValidationPipe/inputs inválidos. Guards y rutas inexistentes usan el mismo formato. El rate limiter general usa errorResponse directamente; el de Attendance pasa por el filtro. CSRF usa CSRF_REJECTED. CORS rechazado puede impedir que el navegador lea el cuerpo y no requiere distinguirse mediante parseo.

Activación mantiene error genérico para token inválido/vencido/usado/revocado. QR inválido/vencido/revocado/cruzado comparte ATTENDANCE_QR_INVALID. No se agregan señales que permitan inspeccionar credenciales ajenas. PRESENT Student con challenge válido conserva respuesta idempotente; ATTENDANCE_ALREADY_RECORDED se usa donde ya existía conflicto, como alta manual sobre resultado existente.

Payment con misma clave, actor, contrato y payload conserva replay exitoso; cambiar payload produce PAYMENT_IDEMPOTENCY_CONFLICT. No se agregan bloqueos comerciales nuevos ni restricciones de estado contractual a pagos.

## Today, cookies y CORS

`today=true` deriva la fecha mediante BusinessTime/CLOCK; no usa reloj/fecha del navegador. No se combina con dateFrom/dateTo. Agrega readAt/businessDate/timeZone a esa respuesta. Sin today se conserva el listado anterior; today=false admite filtros normales. No hay endpoint Dashboard ni KPIs.

CORS permite explícitamente Content-Type e Idempotency-Key, origins exactos, credentials y métodos anteriores. No wildcard. El cliente envía credentials: include; las mutaciones mantienen Origin/Referer y JSON. No se agrega token CSRF ni se relaja verificación.

Desarrollo local: frontend http://localhost:5173 y API http://localhost:3000, origins configurados exactamente y cookie Secure=false sólo en configuración local permitida. Mantener el mismo hostname; no mezclar localhost con 127.0.0.1. Cookie HttpOnly, SameSite=Lax, path=/; producción conserva Secure/HTTPS. CORS cross-origin no garantiza cookies cross-site: el despliegue debe ser same-site o mediante proxy bajo el mismo origen, sin cambiar SameSite por conveniencia.

## OpenAPI y persistencia

Generación inspeccionada: 75 operaciones / 94 schemas. Números enteros de paginación/capacidad explícitos, nullable escalares como string nullable, dinero como string decimal, occurrenceDate como date y timestamps como date-time. Los errores específicos mantienen ApiErrorDto; code usa enum central. Los envelopes previos se conservan. No se genera cliente frontend ni se instalan dependencias.

Sin cambios de schema, índices ni migraciones. Read models usan índices actuales, selección explícita y lecturas por lote; no Redis, materialized views, repositorios ceremoniales ni nuevo cálculo de consumo. Evidencia HTTP/DB definitiva en [validación](stage-7.1-validation.md).
