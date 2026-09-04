# Validación de Etapa 3

Fecha: 2026-09-04. Entorno: Node.js 24.20.0 y PostgreSQL 16.15 de pruebas en schemas aleatorios.

## Resultado

Schedules, Enrollments y ClassSessions quedaron implementados y validados sin aplicar la migración a la base de desarrollo. Los runners sólo usaron `studio_gestion_test` y eliminaron sus propios schemas aislados.

| Comprobación | Resultado |
| --- | --- |
| Prisma generate | PASS, Prisma Client 6.19.3 |
| Lint | PASS, sin warnings de oxlint |
| Typecheck | PASS |
| Unit | PASS, 138 tests en 16 archivos |
| Integration PostgreSQL | PASS, 14 tests totales; 5 nuevos de scheduling |
| E2E HTTP | PASS, 35 tests totales; 3 nuevos de scheduling |
| Runner PostgreSQL total | PASS, 49 tests en 8 archivos |
| Build | PASS |
| Migración Students | PASS |
| Migración comercial | PASS, fresh + upgrade + guard |
| Migración scheduling incremental | PASS, contrato comercial de Etapa 2 preservado |
| Migraciones desde cero | PASS, las 5 migraciones |
| Guard de histórico scheduling | PASS, aborta y preserva la fila provisional |
| npm audit offline | PASS, 0 vulnerabilidades |

La auditoría online de Etapa 2 no pudo concluir porque el endpoint oficial agotó su timeout. Esta etapa no cambió dependencias ni lockfile; se volvió a validar el árbol disponible con el caché local sin inventar un resultado online.

## Cobertura de dominio

- Recurrencia semanal con día ISO, horas locales, capacidad y estado.
- BUSINESS_TIMEZONE configurable, conversión UTC y rechazo de horas locales ambiguas/inexistentes.
- Generación por rango, replay y dos generadores concurrentes sin duplicados.
- Snapshot de ClassSession independiente de ediciones posteriores de Schedule.
- Enrollment temporal dentro del contrato, Student propia y activa, Schedule activo y no solapamiento.
- Cambio de horario transaccional, replay idempotente e histórico anterior preservado.
- Capacidad habitual y efectiva, rechazo de reducción bajo la expectativa real.
- Dos altas concurrentes sobre el último cupo: una sola persiste.
- Cancelación trazable e idempotente, sin DELETE.
- Consulta reutilizable de alumnas esperadas; cancelada no requiere Attendance.
- CHECK, UNIQUE, FK compuesta, FK RESTRICT y exclusión GiST probados en PostgreSQL.

## Cobertura HTTP y seguridad

- Flujo Admin completo desde Student/Plan/Subscription hasta generación, excepción, cancelación y cambio de horario.
- AdminGuard en todas las rutas nuevas; anónimo recibe 401 y Student recibe 403.
- CSRF para mutaciones, UUIDs, DTO whitelist, campos manipulados, fechas inválidas y relaciones cruzadas.
- Proyecciones sin minutos internos ni identificador del Admin que canceló.
- OpenAPI actualizado para DTOs, fechas, filtros, paginación, estados y errores.

## Avisos observados

Vitest/Vite mantiene el aviso previo sobre configuración CommonJS con sintaxis ESM y la futura redundancia de `vite-tsconfig-paths`. No afecta la ejecución actual.

La migración scheduling no adivina el significado de datos del schema provisional: si existen filas Schedule, ClassSession o Enrollment, requiere un mapeo manual antes del deploy. Attendance y Recovery todavía no están implementados; sus cascadas heredadas deben revisarse en la etapa que exponga esos casos de uso.
