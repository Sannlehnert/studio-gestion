# Studio Gestión

Sistema web para que una profesora gestione sus clases y alumnas, con énfasis en seguridad, consistencia e historial.

## Estado

- Backend Foundation: COMPLETE
- Backend Auth/Security Foundation: COMPLETE
- Students: COMPLETE
- Plans + Subscriptions + Payments: COMPLETE
- Frontend: NOT STARTED

El cierre y sus límites están en [validación de Fase 0](docs/phase-0-validation.md). La existencia de modelos Prisma de negocio no implica que tengan endpoints implementados.

## Stack y estructura

Node.js 24 LTS (24.15 o superior de la rama 24), npm 10 o superior, NestJS 12, TypeScript strict, PostgreSQL 16, Prisma 6, Vitest y OpenAPI. Frontend previsto: Vue 3 con Vite y TypeScript, todavía no creado.

    apps/backend/       API NestJS, Prisma, tests y configuración
    apps/frontend/      Sin implementación
    docs/               Contexto, dominio, arquitectura, API y seguridad
    docker-compose.yml  PostgreSQL de desarrollo
    docker-compose.test.yml  PostgreSQL efímero de pruebas

## Instalación

Desde la raíz del monorepo:

    npm ci
    npm run prisma:generate

Node 24.14 no satisface los requisitos actuales de algunas herramientas transitivas de Nest. La validación de esta fase se realizó con Node 24.20.0 sin modificar la instalación global de la computadora.

Copiar apps/backend/.env.example a apps/backend/.env y ajustar los valores. En PowerShell:

    Copy-Item apps/backend/.env.example apps/backend/.env

No sobrescribir un .env que ya contenga configuración válida. DATABASE_URL debe apuntar a la instancia elegida; los valores de ejemplo sirven únicamente para el contenedor local de desarrollo.

## PostgreSQL y migraciones

Para levantar la base local de desarrollo:

    docker compose up -d --wait

Usa PostgreSQL 16 y publica el puerto 5432 solo en 127.0.0.1. Si otro PostgreSQL ocupa ese puerto, resolver la instancia/puerto antes de continuar; no cambiar contraseñas ni borrar volúmenes para forzar la conexión.

Con DATABASE_URL válida:

    npm run prisma:migrate

Ese comando ejecuta prisma migrate dev y es solo para desarrollo. Revisar cada migración generada antes de aplicarla. Para aplicar migraciones ya revisadas en un entorno de despliegue, ejecutar prisma migrate deploy con credenciales de migración de ese entorno. No usar migrate reset sobre datos reales.

## Admin inicial

Definir SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD en apps/backend/.env; contraseña de al menos 12 caracteres. No hay credenciales de seed por defecto.

    npm run prisma:seed

El seed carga ese .env, crea el Admin si no existe y no reemplaza su contraseña. Repetirlo es idempotente. No envía emails ni mensajes.

## Ejecutar el backend

    npm run dev:backend

- API: http://localhost:3000/api/v1
- Health: http://localhost:3000/api/v1/health
- Swagger: http://localhost:3000/api/docs
- OpenAPI JSON: http://localhost:3000/api/docs-json

El arranque verifica la conexión PostgreSQL. No se obtiene un backend operativo con una DATABASE_URL inválida aunque los tests unitarios pasen.

Para ejecutar el build:

    npm run build:backend
    npm run start:prod --workspace=apps/backend

start:prod ejecuta el artefacto compilado; NODE_ENV=production y los demás valores de despliegue deben configurarse explícitamente. Producción exige HTTPS en API_ORIGIN/FRONTEND_ORIGIN, COOKIE_SECURE=true y SWAGGER_ENABLED=false.

## Requests y seguridad

Sesiones por cookies HttpOnly, sin localStorage. Las operaciones mutables exigen Origin permitido o Referer válido. Para un cliente CLI de desarrollo, enviar Origin: http://localhost:5173 y Content-Type: application/json cuando exista body.

La API tiene CORS por allowlist, Helmet, rate limiting por categoría, JSON limitado, DTOs estrictos y errores sin internals. Los valores configurables están en .env.example y se explican en [seguridad](docs/security.md).

La activación Student entrega al Admin un enlace /activate#token=.... El futuro frontend deberá limpiar el fragmento y enviar el token en JSON; no hay frontend implementado todavía.

## Tests

Comprobaciones independientes:

    npm run lint:backend
    npm run typecheck:backend
    npm run test:backend
    npm run build:backend

Para E2E, copiar apps/backend/.env.test.example a apps/backend/.env.test y establecer una contraseña exclusiva de pruebas en ambos valores correspondientes. TEST_DATABASE_URL debe terminar en la base studio_gestion_test; jamás usar desarrollo/producción como fallback.

    docker compose --env-file apps/backend/.env.test -f docker-compose.test.yml up -d --wait
    npm run test:migration:students
    npm run test:migration:commercial
    npm run test:e2e:backend

El contenedor usa PostgreSQL 16, puerto local 55432 y datos efímeros. Los verificadores cubren la migración Students y el núcleo comercial desde cero, como upgrade y ante histórico incompleto. El runner E2E crea otro schema aleatorio, aplica todas las migraciones, corre Auth, Students y negocio, y elimina sólo ese schema.

Para detener únicamente la base de pruebas:

    docker compose --env-file apps/backend/.env.test -f docker-compose.test.yml stop db-test

No se necesita eliminar contenedores de desarrollo por un aviso de servicios ajenos al archivo de pruebas.

## Documentación

- [Contexto y roadmap](docs/PROJECT_CONTEXT.md)
- [Modelo de dominio](docs/domain-model.md)
- [Arquitectura](docs/backend-architecture.md)
- [Convenciones de API](docs/api-conventions.md)
- [Autenticación y sesiones](docs/authentication.md)
- [Gestión de alumnas](docs/students.md)
- [Validación de Etapa 1](docs/stage-1-validation.md)
- [Plans, Subscriptions y Payments](docs/plans-subscriptions-payments.md)
- [Validación de Etapa 2](docs/stage-2-validation.md)
- [Baseline de seguridad](docs/security.md)
- [Auditoría y validación de Fase 0](docs/phase-0-validation.md)

La próxima etapa prevista es Schedules + Enrollments + ClassSessions. No se inició en esta etapa.
