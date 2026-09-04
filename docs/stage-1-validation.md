# Etapa 1: auditoría y validación

Fecha: 2026-09-03. Proyecto: ProgramaGestion/studio-gestion. Base: commit `8c6adda`, Fase 0 cerrada y árbol limpio.

## Estado inicial y diseño

Student solo tenía `id`, `fullName` y timestamps. Sus relaciones con StudentAccess, Subscription, Enrollment, Attendance y Recovery usan claves foráneas; varias conservan `ON DELETE CASCADE`. Session y AuditLog se vinculan mediante IDs polimórficos sin FK. No existía CRUD administrativo ni estado lógico.

La API no incorpora DELETE. `isActive` representa disponibilidad operativa; no modifica ni borra relaciones históricas. Desactivar revoca sesiones Student y accesos pendientes en la misma transacción. Reactivar no restaura credenciales. Esta decisión evita que una sesión o enlace anterior vuelva a funcionar al cambiar el booleano a true.

StudentAccess permaneció en Admin/Auth y conserva sus rutas. StudentsModule concentra el ciclo de vida de la entidad. La búsqueda es parcial case-insensitive, sin full-text. La paginación por página/offset responde a la escala y navegación esperadas; un orden por nombre e ID la hace estable.

## Migración

Antes de editar el schema se ejecutó `prisma migrate diff`. El SQL propuesto fue únicamente:

```sql
ALTER TABLE "Student" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
```

La migración `20260903120000_add_student_active_status` contiene esa operación y ningún DROP, DELETE o TRUNCATE. No se agregó índice: `isActive` tiene baja selectividad y un B-tree de nombre no resuelve `contains` (`%texto%`).

Se validaron dos recorridos sobre PostgreSQL 16.15:

1. Se aplicaron las dos migraciones de Fase 0, se insertó una Student sin `isActive`, se aplicó la nueva migración y se comprobó que nombre e ID se preservaron y `isActive=true`.
2. Se aplicaron las tres migraciones desde cero en el schema aleatorio de E2E.

Ambos recorridos finalizaron correctamente. Cada script eliminó solo su schema generado dentro de la base `*_test`. No se aplicó la migración a desarrollo porque su conexión continúa inválida.

## Implementación verificada

- Alta con normalización de whitespace, campos explícitos y AuditLog transaccional.
- Listado con filtros `active`, `inactive`, `all`; búsqueda, límites y metadata.
- Detalle acotado y edición exclusiva de `fullName`.
- Desactivación/reactivación explícitas e idempotentes.
- Bloqueos de fila para serializar estado, actualización, emisión y activación.
- Rechazo de emisión/activación para Student inactiva.
- SessionGuard exige Student activa y las sesiones previas permanecen revocadas al reactivar.
- DTOs estrictos y OpenAPI sin DELETE ni campos internos.
- Auditoría `STUDENT_CREATED`, `STUDENT_UPDATED`, `STUDENT_DEACTIVATED` y `STUDENT_REACTIVATED`.

## Resultados finales

Validación con Node 24.20.0 y PostgreSQL 16.15:

| Verificación               | Resultado real                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| prisma:generate            | Correcto, Prisma Client 6.19.3                                                                   |
| lint:backend               | Correcto, 0 warnings                                                                             |
| typecheck:backend          | Correcto, strict e incluye tests/seed                                                            |
| test:backend               | 114 correctos, 12 archivos, 0 fallos                                                             |
| Integration/E2E completo   | 32 correctos, 4 archivos, 0 fallos                                                               |
| Migración Fase 0 → Etapa 1 | Correcta, fila previa preservada activa                                                          |
| Migraciones desde cero     | Correctas, 3/3                                                                                   |
| build:backend              | Correcto                                                                                         |
| npm audit offline          | 0 vulnerabilidades en cache: 183 prod, 240 dev, 47 optional                                      |
| npm audit online           | Sin informe: el endpoint de advisories agotó el tiempo en tres intentos; `npm ping` sí respondió |

La suite cubre Admin login, alta, listado, búsqueda case-insensitive, paginación, detalle, edición, emisión de acceso, sesión Student, desactivación, reactivación, credenciales antiguas, permisos, CSRF, mass assignment, IDs, queries inválidas, OpenAPI, auditoría, defaults de PostgreSQL, idempotencia y carreras activación/desactivación.

La primera ejecución de las nuevas suites detectó que los POST semánticos usaban el default 201 y una expectativa de orden no era homogénea en capitalización. Se fijó el contrato explícito 200, se corrigió el fixture y las ejecuciones posteriores quedaron verdes. No se eliminaron tests ni se relajó seguridad.

## Límites reales

- La conexión del `.env` de desarrollo sigue sin funcionar; el código y la migración se validaron en la base aislada de pruebas.
- El informe online de npm audit no estuvo disponible por timeout del endpoint. El lockfile no cambió dependencias respecto del audit online verde de Fase 0, pero eso no sustituye una consulta nueva; repetirla cuando el endpoint responda.
- La búsqueda `%texto%` es apropiada para el volumen esperado. Medir antes de incorporar `pg_trgm` u otro índice.
- El nombre no tiene CHECK de DB para no arriesgar filas históricas desconocidas sin auditar desarrollo. Hoy todas las escrituras soportadas pasan por DTO/servicio; revisar si se agrega otra vía.
- Las cascadas físicas siguen en el schema, aunque la API Students no expone DELETE.
- Continúan las deudas operativas documentadas en Fase 0: rate limit compartido, retención, observabilidad, privilegios de producción, TLS y backups.

El backend está preparado a nivel de código y pruebas para diseñar Etapa 2. Su migración debe partir del dominio real de planes, suscripciones y pagos; no fue iniciada aquí.
