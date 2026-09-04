# Validación de Etapa 2

Fecha: 2026-09-04. Entorno: Node.js 24.20.0 y PostgreSQL 16.15 de pruebas en schema aleatorio.

## Resultado

Plans, Subscriptions y Payments quedaron implementados y validados sin aplicar la migración a la base de desarrollo. El runner sólo usó `studio_gestion_test` y eliminó sus schemas aislados.

| Comprobación | Resultado |
| --- | --- |
| Prisma generate | PASS, Prisma Client 6.19.3 |
| Lint | PASS, sin warnings de oxlint |
| Typecheck | PASS |
| Unit | PASS, 130 tests en 14 archivos |
| Integration PostgreSQL | PASS, 9 tests |
| E2E HTTP | PASS, 32 tests |
| Runner PostgreSQL total | PASS, 41 tests en 6 archivos |
| Build | PASS |
| Migración Students | PASS |
| Migración comercial incremental | PASS, Plan previo preservado |
| Migración comercial desde cero | PASS |
| Guard de histórico incompleto | PASS, aborta sin modificar la fila |
| npm audit offline | PASS, 0 vulnerabilidades en 422 dependencias |
| npm audit online | NO CONCLUYENTE: timeout del endpoint oficial |

La auditoría online se intentó con acceso de red y luego con timeout explícito de 15 segundos. `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk` no respondió. La auditoría offline del lockfile actual, usando el caché existente, reportó 0 vulnerabilidades: 0 info, low, moderate, high y critical. No se declara un resultado online inventado.

## Cobertura de negocio

- Catálogo Plan con edición, filtros, activación idempotente y sin DELETE.
- Snapshot contractual, precio personalizado explícito, período semiabierto y cancelación.
- Plan o Student inactivos bloquean nuevas Subscription.
- Exclusión PostgreSQL y carrera real para solapamientos.
- Pagos parciales/múltiples, sobrepago rechazado y Decimal serializado como string.
- Replay idéntico por Idempotency-Key y conflicto ante reutilización.
- Anulación idempotente, motivo/autor/fecha y saldo recalculado.
- AdminGuard, Student rechazado, CSRF, UUID, mass assignment y payloads monetarios inválidos.
- OpenAPI de rutas, filtros, estados, strings decimales e Idempotency-Key.

## Avisos observados

Vitest/Vite avisa que sus archivos de configuración CommonJS usan sintaxis ESM y que `vite-tsconfig-paths` será redundante cuando cambie el loader por defecto. No afecta la ejecución actual; debe resolverse al actualizar la configuración de Vite.

La migración requiere que el rol de migraciones pueda instalar o usar `btree_gist`. En producción debe validarse ese privilegio antes del deploy. Si existieran Subscription o Payment del schema anterior, se necesita una migración de datos específica antes de reintentar.
