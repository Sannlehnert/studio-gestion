# Auditoría operativa — Etapa 7

AuditLog registra quién ejecutó una acción relevante y cuándo. AttendanceCorrection es la fuente de verdad del historial de correcciones; AuditLog no calcula estado efectivo ni reconstruye originalStatus.

## Actores y backfill

actorType es obligatorio: ADMIN, STUDENT o SYSTEM. Cada escritor declara el actor explícitamente; SESSION_REVOKED usa el rol persistido de esa sesión. SYSTEM requiere actorId null; ADMIN/STUDENT requieren actorId no nulo. actorId es polimórfico y no tiene FK a una única tabla.

La migración atribuye acciones administrativas conocidas a ADMIN, activación/PRESENT Student a STUDENT, reconciliación a SYSTEM y revocación de sesión según metadata.role. Exige la forma de actor correspondiente. Acciones desconocidas, rol ausente o actor incompatible detienen la migración antes del DDL. No convierte todo actor no nulo en Admin.

## Eventos y atomicidad

Se mantienen eventos de autenticación/accesos, alumnas, catálogo, contratos, pagos, horarios, inscripciones, clases, reconciliación, QR y Recoveries. Se agregan ATTENDANCE_MANUAL_PRESENT_RECORDED y ATTENDANCE_CORRECTED. Mutación y evento comparten transacción. Correcciones sin cambio no generan eventos nuevos.

ATTENDANCE_CORRECTED conserva correctionId, sequence, previousStatus, targetStatus y reason; el Admin proviene de la sesión y createdAt coincide con correctedAt. El alta manual registra clase, contrato, Student y motivo; la Attendance conserva autor, motivo y fecha originales. source no se reescribe para representar al último corrector.

## API de consulta

GET /api/v1/admin/audit-logs requiere Admin y admite:

- page: 1–100000, default 1; limit: 1–100, default 20.
- actorType; actorId UUID.
- entityType: 1–80 caracteres; entityId UUID.
- action: 1–100 caracteres.
- dateFrom inclusivo y dateTo exclusivo, ISO con zona horaria; dateTo debe ser posterior.

Orden createdAt DESC, id DESC. Respuesta `{items, meta: {page, limit, total, totalPages}}`, con lectura consistente RepeatableRead. entityType público corresponde al campo entity persistido. Prisma parametriza las consultas; no se interpola input HTTP en SQL.

Los índices cubren fecha/id, actorType/actorId/fecha/id y action/fecha/id, además de entidad/id. Se mantienen límites generales de API y no-store.

## Metadata pública

La salida usa una lista explícita de claves y tipos por evento, incluyendo before/after anidados. Se descartan campos desconocidos, estructuras incorrectas y strings mayores de 500 caracteres. Un evento desconocido devuelve metadata vacía. No se expone arbitrariamente el JSON almacenado.

Los contratos excluyen tokens, hashes, credenciales y cuerpos completos de requests. La API administrativa requiere autorización aunque la metadata esté filtrada. Los motivos deben contener únicamente información pertinente al caso.

## Límites

No hay API UPDATE/DELETE de AuditLog ni auditoría de GETs. No se agregan triggers de inmutabilidad a AuditLog; AttendanceCorrection sí tiene protección independiente del historial. No hay megaendpoint Student/history, búsqueda libre de metadata, exportación masiva ni política automática de borrado/retención.

El frontend futuro puede componer APIs específicas. Los límites en memoria existentes corresponden a una instancia; la integridad depende de transacciones y constraints, no de rate limiting.
