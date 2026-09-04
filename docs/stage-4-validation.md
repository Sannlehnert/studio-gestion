# Validación de Etapa 4

Fecha: 2026-09-04. Entorno: Node.js 24.20.0 y PostgreSQL 16.15 de pruebas en schemas aleatorios.

## Resultado

Attendance Engine, PRESENT, ABSENT, consumo derivado y reconciliación quedaron implementados sin aplicar la migración a la base de desarrollo. Los runners sólo usaron `studio_gestion_test` y eliminaron sus propios schemas aislados.

| Comprobación | Resultado |
| --- | --- |
| Prisma generate | PASS, Prisma Client 6.19.3 |
| Prisma validate | PASS |
| Lint | PASS, sin warnings de oxlint |
| Typecheck | PASS |
| Unit | PASS, 145 tests en 17 archivos |
| Integration PostgreSQL | PASS, 22 tests totales; 8 nuevos de Attendance |
| E2E HTTP | PASS, 39 tests totales; 4 nuevos de Attendance |
| Runner PostgreSQL total | PASS, 61 tests en 10 archivos |
| Concurrencia Attendance | PASS, 4 carreras reales sin mocks |
| Build | PASS |
| Migraciones Students/comercial/scheduling | PASS |
| Migración Attendance | PASS, fresh + upgrade Etapa 3 + guard |
| npm audit offline | PASS, 0 vulnerabilidades |

La auditoría se ejecutó con el árbol local porque esta etapa no cambió dependencias ni lockfile. No se aplicó ninguna migración a la base de desarrollo.

## Cobertura de dominio

- Ventana `[apertura, cierre)` configurable y límites exactos con reloj controlado.
- PRESENT propio con identidad de sesión, Subscription derivada y replay idempotente.
- ABSENT automático después del cierre; CANCELLED nunca crea Attendance.
- Consumo y saldo derivados; agotamiento rechazado y sobreconsumo visible.
- ClassSession cerrada mediante COMPLETED más `attendanceClosedAt`.
- Reconciliación al iniciar y periódica, recuperable después de downtime.
- Student inactiva omitida del futuro sin alterar Attendance histórica.
- Subscription cancelada/expirada excluida según su estado en la fecha de clase.

## Cobertura de concurrencia y persistencia

- Dos PRESENT concurrentes crean una fila y un evento.
- PRESENT contra ABSENT produce un único estado coherente.
- Dos reconciliadores cierran y auditan una sola vez.
- Dos clases compitiendo por el último allowance consumen una sola.
- UNIQUE, CHECK de source/status, FK compuesta Student/Subscription, cierre coherente y FK RESTRICT probados en PostgreSQL.
- Migración validada fresh, desde Etapa 3 con datos preservados y con rechazo seguro de histórico ambiguo.

## Cobertura HTTP y seguridad

- Flujo real Admin → Student → Plan 8 → Subscription → Schedule → Enrollment → ClassSession → acceso → PRESENT → lectura Admin → resumen 1/7.
- Segundo flujo de ausencia por reconciliación con resumen derivado.
- StudentGuard/AdminGuard, CSRF, UUIDs, query bounds, payload extra, ownership, Student ajena y Subscription cruzada.
- Casos antes/después de ventana, cancelación, Student inactiva, Subscription cancelada/expirada, duplicado y allowance agotado.
- Rate limit específico configurable, SQL parametrizado, proyecciones acotadas y errores sin internals.

## Avisos observados

Vitest/Vite mantiene el aviso previo sobre configuración CommonJS con sintaxis ESM. No afecta la ejecución actual.

El modelo Student sólo conserva `isActive` actual. La reconciliación omite una Student que está inactiva al procesar; no puede reconstruir si se desactivó antes o después del cierre cuando no existe Attendance. Resolver esa distinción exige historial temporal de estado, no una inferencia.
