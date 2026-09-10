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

Auth, Students, núcleo comercial, scheduling, Attendance e historial temporal de actividad están implementados. Recoveries, QR y Frontend no están implementados.
