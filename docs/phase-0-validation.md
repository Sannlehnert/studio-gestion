# Fase 0: auditoría y validación

Fecha: 2026-09-02. Proyecto: ProgramaGestion/studio-gestion.

## 0.1 — Estado inicial comprobado

Git main, commit base 17a63e5. Ya existían cambios sin confirmar, incluidos Auth, guards, Session, seed y E2E. Se trabajó sobre ese estado sin reset, limpieza de archivos ni creación de un commit.

Coincidencias con el contexto: tests SessionService fallaban por findFirst frente a mocks findUnique; import PrismaClient sin uso; faltaban CORS, Helmet, rate limiting, CSRF y límites explícitos. StudentAccess.revokedAt no tenía gestión administrativa completa. docs estaba vacío. README declaraba Auth completa y enlazaba documentación inexistente.

Diferencias/riesgos adicionales comprobados:

- Activación en operaciones separadas permitía dobles sesiones y éxito parcial.
- E2E Student incluía deleteMany sin filtros para sesiones, accesos y alumnas; no se ejecutó en ese estado.
- E2E Admin importaba globals de Jest aunque el runner era Vitest.
- Typecheck solo cubría src; tests y seed quedaban fuera.
- Conversión implícita de booleanos y lectura de cookies/TTL dispersa.
- Errores podían incluir stacks y query strings; el seed tenía contraseña por defecto.
- La conexión PostgreSQL original del .env rechazó sus credenciales.
- El entorno de esta tarea no tuvo acceso al canal Docker. El usuario levantó el contenedor de pruebas con el Compose preparado.
- Node global 24.14 no cumplía requisitos transitivos. Se verificó con Node 24.20.0 portable, descargado desde nodejs.org y con SHA-256 comprobado.

Baseline: 17 tests unitarios, 14 correctos y 3 fallidos; lint con un warning; typecheck src correcto. E2E no ejecutados por el riesgo de borrado.

## 0.2–0.9 — Implementación y decisiones

- Session lookup por UNIQUE(tokenHash), expiración inclusiva, actualización condicional de vigencia y revocación idempotente.
- CORS configurable, Helmet, rate limits por categoría, JSON de 16 KiB, CSRF con Origin/Referer estricto y normalización de errores.
- Cookies centralizadas, Secure exigido en producción y expiración consistente con Session.
- Activación transaccional, pruebas de carrera y rollback. Emisión/revocación de accesos con auditoría, comprobación de pertenencia e IDs UUID.
- Revocación individual de enlaces pendientes; repetir conserva timestamp y un único evento. Un enlace activado responde 409 al revocarlo.
- Sesiones absolutas: Admin 24 horas, Student 30 días por defecto, sin sliding ni refresh/renewal.
- Seed sin credenciales por defecto, explícito e idempotente.
- Retiro de herramientas no utilizadas y override acotado de deepmerge-ts, con justificación en security.md.

## API

Nuevo: POST /api/v1/admin/students/:studentId/access/:accessId/revoke.

Modificados: emisión devuelve accessId y URL con fragmento; logout ahora es idempotente; login/activación/cookies y todos los métodos mutables aplican la nueva baseline. OpenAPI documenta respuestas y cookies. Las rutas y DTOs completos están en api-conventions.md.

## DB

No se modificó schema.prisma en esta fase y no se crearon migraciones. Las diferencias de schema respecto de Git ya existían al empezar. Se reutilizaron init y add_session, aplicadas en PostgreSQL 16.15 a schemas exclusivos de pruebas. No se aplicaron cambios a la base de desarrollo ni se borraron sus registros.

## Documentación creada

PROJECT_CONTEXT.md, domain-model.md, backend-architecture.md, api-conventions.md, security.md, authentication.md y este registro. README raíz y backend actualizados.

## Validación final

Ejecución final del 2026-09-02, con Node 24.20.0 y PostgreSQL 16.15 de pruebas. Todos los comandos terminaron con código 0.

| Verificación       | Resultado real                                                               |
| ------------------ | ---------------------------------------------------------------------------- |
| prisma:generate    | Cliente Prisma 6.19.3 generado correctamente                                 |
| lint:backend       | Correcto, warnings prohibidos                                                |
| typecheck:backend  | Correcto, incluye src, tests, seed y configuración Vitest; strict conservado |
| test:backend       | 90 tests correctos, 10 archivos, 0 fallos                                    |
| test:e2e:backend   | 22 tests correctos, 2 archivos Admin/Student, 0 fallos                       |
| build:backend      | Correcto                                                                     |
| npm audit          | 0 vulnerabilidades reportadas, incluidas dependencias de desarrollo          |
| Arranque del build | Correcto con conexión PostgreSQL real en schema exclusivo de pruebas         |
| Seed real          | Dos ejecuciones: crea Admin y luego conserva el mismo registro y contraseña  |

El proceso compilado se verificó por HTTP: health, Swagger HTML/JSON, login, emisión/activación, separación de roles, logout y rechazo de enlace revocado. Se cerró ese proceso y se eliminó únicamente su schema de pruebas.

Las suites verifican CORS, CSRF, headers, cookies, límites por categoría, payload, errores sin secretos, campos manipulados, permisos Admin/Student, replay, revocación idempotente, constraints UNIQUE, activaciones concurrentes, carrera entre activación y revocación y rollback si falla la creación de sesión. También cubren expiración durante una espera a la base de datos y contratos OpenAPI.

La conexión configurada en el .env original de desarrollo sigue fallando. Se comprobó también la misma configuración con 127.0.0.1, sin modificar credenciales ni datos. El arranque exitoso informado corresponde a la base aislada de pruebas, no a esa configuración de desarrollo.

## Deuda y límites reales

- Un proceso de backend: rate limiting en memoria; contadores se reinician al reiniciar. Store compartido pendiente antes de múltiples instancias.
- Retención/purga de sesiones, ip/userAgent y auditoría, así como telemetría de seguridad, todavía no implementadas.
- Privilegios DB de producción, TLS y backups no fueron provisionados ni verificados.
- Override deepmerge-ts debe retirarse cuando Prisma adopte una dependencia corregida compatible.
- Configuración local original de desarrollo no corregida por adivinación: rechazaba sus credenciales. Las validaciones de DB se hicieron contra la base aislada de pruebas.
- Student.isActive, revisión de cascadas e invariantes de negocio corresponden a sus etapas. La URL debe ser limpiada por el frontend futuro.
- La configuración Vitest actual funciona pero emite avisos de transición futura del loader; no se cambiaron modos de módulos de toda la aplicación por ese aviso.

La próxima etapa es BACKEND — ETAPA 1: STUDENTS. No se comenzó StudentsModule.
