# Etapa 7 — Validación final

Estado: COMPLETE para el alcance funcional aprobado. Fecha de cierre: 2026-09-15.

Se continuó el working tree existente sin reiniciar implementación ni revertir cambios de etapas anteriores. En el cierre sólo se modificó documentación y se retiró el cambio generado por el build en tsconfig.build.tsbuildinfo, restaurando ese cache a HEAD. No se migró la DB de desarrollo, no hubo deploy y no se inició frontend.

## Evidencia y vigencia

Node 24.20.0, Prisma 6.19.3, Vitest 4.1.11 y PostgreSQL 16.15. Los resultados provienen de ejecuciones reales de esta tarea.

| Gate | Resultado | Evidencia aplicable |
|---|---|---|
| Prisma generate | PASS | Ejecutado después del formato final de schema; cliente 6.19.3 generado. Schema no cambió después |
| Prisma validate | PASS | Ejecutado desde apps/backend en el cierre; schema válido |
| lint | PASS | oxlint --deny-warnings; ejecución final anterior vigente, sin cambios posteriores de TypeScript |
| typecheck | PASS | tsc --project tsconfig.check.json; incluye fuentes y tests |
| unit | PASS | 173 tests / 22 archivos en la ejecución final anterior, vigente para el código actual |
| PostgreSQL integration | PASS | Suite combinada final: 132 tests / 18 archivos; incluye constraints y servicios reales |
| HTTP/E2E | PASS | Incluido en los 132; flujos, autorización, CSRF, DTOs y OpenAPI |
| concurrency | PASS | Incluido en los 132; seis familias nuevas de carreras y regresiones previas |
| build | PASS | nest build sobre la implementación actual |
| Fresh migrations | PASS | Diez migraciones aplicadas; verificador Stage 7 fresh y nuevamente runner final |
| Upgrade 6 → 7 | PASS | Histórico preservado, originalStatus y actorType verificados |
| Guardias de upgrade | PASS | Acción desconocida, sesión sin rol y Admin sin actor abortan antes de DDL |
| npm audit completo online | PASS | 0 vulnerabilidades, 422 dependencias reportadas; sin --omit=dev |
| Coherencia del diff | PASS | git diff --check; avisos de normalización LF/CRLF sin errores de whitespace |

La suite PostgreSQL se repitió en el cierre porque la ejecución anterior precedía al último guard de inserción y a la simplificación final de la comprobación Recovery. Resultado final: 132/132, 18/18 archivos, 42.21 segundos. No se repitieron unit/lint/typecheck/build después de cambios exclusivamente documentales.

Además pasaron los verificadores históricos de Recovery (fresh, upgrade y guardia) y QR (fresh y upgrade 4.1 → 5). Sus fixtures usan proyecciones de las versiones históricas; no se relajaron constraints actuales para adaptar esos verificadores.

## Cobertura específica Etapa 7

Se agregaron 7 pruebas unitarias de motivo y metadata pública, 16 pruebas de integración/concurrencia y 5 HTTP/E2E.

- Normal ABSENT → PRESENT y PRESENT → ABSENT: usedClasses permanece 1.
- Recovery ABSENT → PRESENT y PRESENT → ABSENT: consumo adicional 0; MISSED/COMPLETED se deriva correctamente.
- PRESENT manual normal conserva Admin, motivo, fecha y source ADMIN; registro repetido responde conflicto.
- PRESENT manual Recovery funciona con cero restante y conserva recoveryId.
- No-op: sin Correction ni AuditLog adicionales; secuencias múltiples deterministas.
- Actor inválido revierte el caso de corrección sin estado/historia/audit parcial.
- PostgreSQL rechaza alteración de origen, histórico de Correction, secuencia duplicada, motivo vacío y actorType/actorId incoherentes.
- Fuera de ventana, clase cancelada y clase cerrada sin registro: rechazo coherente y evidencia preservada.
- Recuperación pendiente bloquea corregir el origen hasta cancelación explícita; resultado PRESENT/ABSENT bloquea el origen. Historial cancelado no bloquea.
- Concurrencia: dos correcciones, Admin/Student PRESENT, Admin/reconciliador atravesando cierre, Correction/reconciliador, Correction/autorización y Correction/cancelación. Sin duplicados ni deadlocks en las pruebas.
- HTTP: Admin exclusivo, Student/no autenticado rechazados, CSRF, IDs inválidos/inexistentes, mass assignment, límites/filtros y paginación.
- Auditoría: actor real, evento único, metadata anidada allowlisted, eventos desconocidos sin metadata arbitraria, orden estable y GET sin audit nuevo.
- OpenAPI: rutas, DTOs y source ADMIN.

## Migración y preservación

20260915180000_admin_corrections: originalStatus=status para filas previas, source ADMIN, atribución de creación manual, AttendanceCorrection y actorType explícito. Checks, FKs RESTRICT, secuencia única e índices de consulta. No se reconstruye estado desde AuditLog.

El upgrade compara Attendance, Recovery, Payment, AuditLog, Student y StudentActivePeriod antes/después excluyendo sólo las nuevas columnas correspondientes. Comprueba backfill y que no se inventan correcciones. Las tres guardias de actor verifican que no se agregó siquiera el valor ADMIN al enum cuando el histórico resulta ambiguo.

Los runners usan TEST_DATABASE_URL terminado en *_test, crean schemas aleatorios y eliminan únicamente su propio schema. La aplicación del enum se confirma separadamente antes de los constraints por requisito de PostgreSQL; el procedimiento de recuperación ante fallo parcial se documenta en admin-corrections.md.

## Incidencias resueltas

La primera invocación de Prisma validate desde la raíz carecía de DATABASE_URL; se corrigió el directorio de ejecución, sin cambios de código ni de base. El bloqueo externo Selected model is at capacity impidió temporalmente documentar y leer archivos; no fue un fallo del proyecto. El cierre actual sí completó esas operaciones.

npm audit online completo terminó correctamente; no fue necesaria una alternativa offline. El audit previo con --omit=dev no se usa como sustituto del resultado completo.

## Deuda real y límites

- Los límites de frecuencia en memoria corresponden a una instancia; varias réplicas requerirán almacenamiento compartido.
- Persisten avisos de Vite sobre configuración CommonJS y el plugin de paths; no impidieron ejecutar tests.
- Backups, TLS y observabilidad de producción todavía no están provisionados; no forman parte del cierre funcional de esta etapa.
- Una auditoría histórica no atribuible requiere revisión explícita antes de migrar. No se inventan actores ni se borran filas para pasar la guardia.

## Documentación y continuidad

Creados: admin-corrections.md, operational-audit.md y este documento. Actualizados: PROJECT_CONTEXT.md, domain-model.md, backend-architecture.md, api-conventions.md, security.md, attendance.md, recoveries.md, attendance-qr.md y los README raíz/backend.

BACKEND FUNCTIONAL CORE = COMPLETE para el alcance acordado hasta Etapa 7. Está preparado para definir FRONTEND — FASE 0: PRODUCT UX + INFORMATION ARCHITECTURE sobre contratos y conflictos existentes. Esa etapa no se inicia aquí; requiere el siguiente prompt del usuario.
