# Backend

API NestJS de Studio Gestión. La instalación, Docker, variables de entorno, Prisma, seed, ejecución y pruebas se documentan en el [README raíz](../../README.md).

## Entradas de implementación

- src/main.ts: arranque del artefacto.
- src/common/http/configure-app.ts: configuración HTTP compartida con las pruebas.
- src/config/env.validation.ts: configuración validada.
- src/auth/: login, activación, sesiones, cookies y guards.
- src/admin/controllers/admin-students.controller.ts: emisión y revocación de accesos, sin CRUD de alumnas.
- prisma/schema.prisma y prisma/migrations/: persistencia.
- test/run-e2e.mjs: pruebas aisladas contra PostgreSQL.

Contratos y decisiones: [API](../../docs/api-conventions.md), [Auth](../../docs/authentication.md) y [seguridad](../../docs/security.md).

StudentsModule y frontend no están implementados.
