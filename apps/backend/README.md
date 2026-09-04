# Backend

API NestJS de Studio Gestión. La instalación, Docker, variables de entorno, Prisma, seed, ejecución y pruebas se documentan en el [README raíz](../../README.md).

## Entradas de implementación

- src/main.ts: arranque del artefacto.
- src/common/http/configure-app.ts: configuración HTTP compartida con las pruebas.
- src/config/env.validation.ts: configuración validada.
- src/auth/: login, activación, sesiones, cookies y guards.
- src/admin/controllers/admin-students.controller.ts: emisión y revocación de accesos, sin CRUD de alumnas.
- src/students/: gestión administrativa, estado, paginación, auditoría y tests unitarios.
- prisma/schema.prisma y prisma/migrations/: persistencia.
- test/run-e2e.mjs: pruebas aisladas contra PostgreSQL.

Contratos y decisiones: [API](../../docs/api-conventions.md), [Auth](../../docs/authentication.md), [Students](../../docs/students.md), [validación de Etapa 1](../../docs/stage-1-validation.md) y [seguridad](../../docs/security.md).

StudentsModule está implementado. Frontend y los demás módulos de negocio no están implementados.
