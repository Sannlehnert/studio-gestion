# Backend

API NestJS de Studio Gestión. La instalación, Docker, variables de entorno, Prisma, seed, ejecución y pruebas se documentan en el [README raíz](../../README.md).

## Entradas de implementación

- src/main.ts: arranque del artefacto.
- src/common/http/configure-app.ts: configuración HTTP compartida con las pruebas.
- src/config/env.validation.ts: configuración validada.
- src/auth/: login, activación, sesiones, cookies y guards.
- src/admin/controllers/admin-students.controller.ts: emisión y revocación de accesos, sin CRUD de alumnas.
- src/students/: gestión administrativa, períodos activos, proyección actual, paginación, auditoría y tests unitarios.
- src/schedules/: recurrencias semanales y capacidad habitual.
- src/enrollments/: pertenencia temporal de una alumna a un horario y su contrato.
- src/class-sessions/: materialización idempotente, excepciones y cancelaciones.
- src/time/: frontera testeable entre fechas locales del negocio e instantes UTC.
- prisma/schema.prisma y prisma/migrations/: persistencia.
- test/run-e2e.mjs: pruebas aisladas contra PostgreSQL.

Contratos y decisiones: [API](../../docs/api-conventions.md), [Auth](../../docs/authentication.md), [Students](../../docs/students.md), [scheduling](../../docs/scheduling.md), [Attendance](../../docs/attendance.md) y [seguridad](../../docs/security.md).

Auth, Students, núcleo comercial, scheduling, Attendance, historial temporal, QR, Recoveries, correcciones administrativas y auditoría operativa están implementados. Frontend no está iniciado.

## Etapa 7

- src/attendance/attendance-corrections.service.ts: correcciones transaccionales e historial.
- src/attendance/attendance.service.ts: PRESENT Student/Admin, elegibilidad y consumo.
- src/audit/: consulta Admin y metadata pública por evento.
- test/admin-corrections*.e2e-spec.ts: integración, carreras y HTTP.
- test/verify-admin-corrections-migration.mjs: fresh, upgrade 6→7 y guardias históricas.

[Correcciones](../../docs/admin-corrections.md), [auditoría](../../docs/operational-audit.md), [resultados finales](../../docs/stage-7-validation.md).
