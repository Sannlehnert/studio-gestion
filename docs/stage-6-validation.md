# Validación de Etapa 6 — Recoveries

Fecha: 2026-09-14. Node.js 24.20.0, Prisma 6.19.3, Vitest 4.1.11, PostgreSQL 16.15.

## Resultado real

Etapa 6 implementada y validada. No se avanzó a Etapa 7. No se aplicaron migraciones a desarrollo. Todos los ensayos de persistencia usaron `studio_gestion_test`, schemas aleatorios propios y limpieza limitada a esos schemas.

| Comprobación | Resultado |
| --- | --- |
| Prisma generate | PASS, Client 6.19.3 |
| Prisma validate | PASS |
| Lint | PASS, oxlint sin warnings |
| Typecheck | PASS |
| Unit | PASS, 166 tests en 20 archivos |
| Integration PostgreSQL | PASS, 58 tests en 7 archivos |
| E2E HTTP PostgreSQL | PASS, 53 tests en 9 archivos |
| Runner PostgreSQL completo | PASS, 111 tests en 16 archivos, 61.60 s |
| Nuevos Recoveries PostgreSQL | PASS, 18 integration + 5 HTTP |
| Build | PASS |
| Migración fresh | PASS, nueve migraciones y catálogos PostgreSQL |
| Upgrade 5 → 6 | PASS, snapshot histórico preservado |
| Guard de Recovery provisional | PASS, aborta antes del DDL y conserva datos |
| Regresión del verificador QR | PASS, fresh y upgrade 4.1 → 5 |
| npm audit online | PASS, cero vulnerabilidades sobre 422 dependencias reportadas |

No se deshabilitaron ni eliminaron pruebas anteriores. Los cambios de formato quedaron limitados a archivos modificados. No se agregaron dependencias ni cambios de lockfile en esta etapa.

## Evidencias de dominio y concurrencia

| Regla / carrera | Evidencia real |
| --- | --- |
| Consumo normal vs Recovery | Unit y PostgreSQL: ABSENT original permanece; PRESENT o ABSENT de destino no incrementa usedClasses |
| Cero allowance restante | Integration: Recovery PRESENT con 1 usada/0 restantes y replay concurrente |
| Plan 8 | HTTP completo: resultado en destino mantiene 1 usada/7 restantes |
| Clase habitual | Integration rechaza Recovery; también rechaza Enrollment posterior y cambio de Schedule que se superponen |
| Resultado | PRESENT con QR normal; ABSENT por reconciliación repetida; MISSED no origina otra Recovery |
| Último cupo | Dos Recoveries y Recovery/Enrollment simultáneos: un único éxito |
| Capacidad reducida | Rechazo debajo de reservas y carrera reducción/autorización con unión dentro de capacidad |
| Doble autorización | Cuatro solicitudes simultáneas retornan mismo ID; otro destino exige cancelación |
| Doble cancelación | Mismo timestamp y un evento; otra autorización utiliza el cupo liberado |
| ClassSession cancelada | Estado UNAVAILABLE derivado, sin cancelación manual ficticia ni ABSENT; carrera contra autorización |
| Subscription cancelada | Impide PRESENT/ABSENT futuros, conserva autorización; carrera contra autorización |
| Histórico Student | Inactividad anterior excluye; desactivación posterior conserva ABSENT histórico de Recovery |
| Cambio horario | Conserva Recovery/identidad, QR obedece nueva ventana; rechaza mover antes de autorización o fuera del contrato |
| Ciclo de locks anterior | Gate real en ClassSession; observación de espera mediante pg_blocking_pids; Recovery y Enrollment compiten por la misma Student/Schedule, terminan sin deadlock |
| PRESENT vs reconciliación | Gate real en Student, avance de CLOCK durante espera hasta cierre: PRESENT revierte, queda exactamente un ABSENT de Recovery sin consumo |
| FKs / histórico | Intentos reales de vínculos cruzados, duplicado, mutación de autorización/origen y borrado rechazados por PostgreSQL |
| QR y replay | Mismo sistema QR; replay válido idempotente, expirado rechazado; autorización cancelada no habilita aunque QR sea válido |

Las carreras usan servicios y PostgreSQL reales, sin mocks de transacciones o constraints. CLOCK controla únicamente tiempo. Los gates comprueban esperas efectivas antes de liberar bloqueos; no dependen sólo de lanzar dos Promises y asumir concurrencia.

## HTTP y seguridad

Los fixtures del flujo completo crean Student, Plan 8, Subscription, Schedule habitual y adicional, Enrollment y ClassSessions por API; ejecutan el reconciliador real, emiten acceso y activan Student. Admin autoriza desde ABSENT, Student ve el destino en upcoming sin Enrollment artificial, obtiene QR y registra PRESENT. El segundo flujo deja vencer la clase y comprueba MISSED y consumo original intacto.

Negativos HTTP: sin sesión, rol Student intentando mutar, CSRF, UUID inválido, mass assignment de Student/Subscription/autor/estado/consumo, motivo inválido, paginación excesiva, filtrado de identidad ajena, BOLA con 404, destino fuera de período, sin cupo, clase cancelada y Recovery cancelada. Se verifican no-store global, DTOs/OpenAPI y ausencia de secretos en la auditoría de Recovery. Las 88 pruebas previas, incluidas QR compartido, IDOR, rotación, límites por identidad y errores sin secretos, pasan en el mismo runner final.

## Migración e histórico

`test/verify-recoveries-migration.mjs` implementa tres escenarios. Fresh despliega las nueve migraciones y verifica seis FKs RESTRICT de Recovery, dos índices únicos parciales y dos guards de histórico. Upgrade despliega primero las ocho migraciones de Etapa 5, crea Student/período activo/Plan/Subscription/ClassSession/Attendance/AuditLog, despliega sólo Etapa 6 y compara datos anteriores. Las Attendances siguen normales con recoveryId nulo. Guard inserta una Recovery provisional y verifica fallo de upgrade, columnas originales intactas y fila preservada.

El verificador QR usa ahora proyecciones de Attendance explícitas de su versión histórica; así puede seguir probando Etapa 4.1 → 5 con el Client generado de Etapa 6. Se ejecutó y pasó.

La primera prueba detectó un identificador de variable conflictivo en el trigger SQL nuevo y se corrigió antes del resultado final. Un fixture HTTP creaba la segunda Student después del inicio histórico de su clase; se corrigió el reloj del fixture, manteniendo la regla histórica. No se presenta ninguno de esos intentos fallidos como éxito ni se relajaron reglas para hacer pasar las pruebas.

## Archivos relevantes

- `src/recoveries/`: módulo, controllers, DTOs, servicio transaccional y reglas puras.
- `src/class-sessions/class-participation.service.ts`: composición compartida de expected y reservas.
- `src/attendance/attendance.service.ts`: origen estructurado, upcoming, consumo normal y reconciliación.
- `src/class-sessions/class-sessions.service.ts`: cupo, hora y expected con Recovery.
- `src/enrollments/enrollments.service.ts`: prevención de superposición/cupo y adquisición acotada de locks.
- `src/subscriptions/subscriptions.service.ts`: CLOCK en cancelación contractual.
- `prisma/schema.prisma` y `prisma/migrations/20260912180000_recoveries/migration.sql`.
- `test/recoveries.integration.e2e-spec.ts`, `test/recoveries.e2e-spec.ts`, `src/recoveries/recovery-domain.spec.ts` y verificadores de migración.

Se actualizaron PROJECT_CONTEXT, domain-model, backend-architecture, api-conventions, security, scheduling, attendance y attendance-qr. Se crearon recoveries.md y este informe. Las decisiones y el análisis de locks están en [Recoveries](recoveries.md).

## Reproducción

Desde la raíz del proyecto, con Node disponible y la base de pruebas configurada en `apps/backend/.env.test`:

- `npm run prisma:generate -w backend`
- `npm run lint -w backend`
- `npm run typecheck -w backend`
- `npm run test -w backend`
- `npm run test:e2e -w backend`
- `npm run build -w backend`
- `npm run test:migration:recoveries -w backend`
- `npm run test:migration:qr -w backend`
- `npm audit`

Prisma validate se ejecutó con schema explícito y un DATABASE_URL sintáctico de `_test`; valida el modelo sin conectar a desarrollo. Los scripts de migración/DB exigen TEST_DATABASE_URL terminado en `_test` y no toman DATABASE_URL como fallback.

## Deuda real y próxima etapa

Persisten los avisos de Vite sobre configuración CommonJS y resolución de paths. El rate limiting usa memoria de una instancia; múltiples instancias requieren almacenamiento compartido. TLS, backup/restore, observabilidad y política de retención de producción siguen pendientes del despliegue. Los overrides existentes de Multer/deepmerge deben retirarse cuando sus dependencias padre integren las correcciones.

Los invariantes de cupo que cruzan tablas requieren respetar el protocolo transaccional también en scripts externos; no están representados por un CHECK agregado. Datos Recovery provisionales necesitan un mapeo explícito antes de aplicar esta migración en una instalación que los tenga. Son restricciones documentadas, no una migración silenciosa pendiente.

El backend tiene las bases para Etapa 7: Admin Corrections + Operational Audit, con identidad autorizada, AuditLog atómico, relaciones de origen/resultado y constraints probados. Las correcciones deberán definir operaciones administrativas explícitas que conserven histórico y consumo: los guards actuales impiden convertir silenciosamente un ABSENT ya usado como origen en PRESENT o alterar una autorización. No basta agregar un PATCH genérico. No se inició Etapa 7; se espera el próximo prompt.
