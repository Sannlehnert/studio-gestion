# Studio — Frontend Foundation

Vue SPA. Foundation implementada; las pantallas de negocio siguen pendientes de Fase 2 y posteriores. No hay datos simulados en el producto. Los fixtures sólo viven en tests.

## Inicio local

Node 24.15+ de la rama 24 y npm 10+. Desde la raíz del monorepo:

```sh
npm ci
npm run prisma:generate
```

Copiar `.env.example` de este directorio a `.env.local` sin sobrescribir una configuración existente. No contiene secretos. `VITE_API_BASE_URL` es el origin de API, **sin /api/v1**, porque los paths generados ya lo incluyen. Defaults locales: `http://localhost:3000` y `America/Argentina/Buenos_Aires`. La zona debe coincidir con BUSINESS_TIMEZONE del backend; los read models con timeZone deben prevalecer al presentar su contenido.

Backend local: FRONTEND_ORIGIN y FRONTEND_ORIGINS `http://localhost:5173`, API_ORIGIN `http://localhost:3000`, COOKIE_SECURE=false sólo en entorno local; usar siempre localhost en el navegador. Vite usa 5173 con strictPort, no cambia silenciosamente de origin. Dos puertos son distintos origins aunque pertenezcan al mismo sitio de cookies.

```sh
npm run dev:backend
```

En otra terminal:

```sh
npm run dev:frontend
```

El backend normal requiere su configuración y base disponibles; su arranque puede reconciliar Attendance. **Las verificaciones de esta fase no arrancaron ese servidor contra desarrollo.** Para probar sin tocar esa base, usar el runner aislado indicado abajo. No ejecutar migraciones/seed de desarrollo como parte de instalar frontend.

Login Admin: `/admin/login`. Student: `/activate#token=…` desde el enlace real emitido por backend; no hay contraseña Student. No incluir un token real en ejemplos, capturas, logs o tickets.

## Scripts desde la raíz

| Script | Propósito |
| --- | --- |
| dev:frontend | Vite en localhost:5173 |
| build:frontend | vue-tsc strict + build a apps/frontend/dist |
| lint:frontend | ESLint Vue/TypeScript, cero warnings |
| typecheck:frontend | vue-tsc --noEmit |
| test:frontend | Unit, componentes, HTTP, sesión y Router |
| api:generate:frontend | Exportar OpenAPI y tipos actuales sin DB/listen/init |
| api:check:frontend | Reexportar y detectar desincronización de ambos archivos |
| test:e2e:frontend | Chromium con respuestas HTTP controladas; test real se omite explícitamente |
| test:integration:frontend | api:check + backend real en base *_test + toda la suite Chromium |

Antes de Playwright, instalar su navegador:

```sh
npm exec --workspace apps/frontend -- playwright install chromium
```

La integración real requiere `apps/backend/.env.test` con TEST_DATABASE_URL apuntando a una base cuyo nombre termine en `_test` (local, puerto 55432). El contenedor se inicia con:

```sh
docker compose --env-file apps/backend/.env.test -f docker-compose.test.yml up -d --wait
npm run test:integration:frontend
```

No usar --remove-orphans. El runner crea un schema aleatorio propio, aplica migraciones existentes, crea un Admin de prueba con credenciales efímeras, sirve API en localhost:3100 y Vite en localhost:5173, y elimina sólo ese schema al finalizar. Nunca toma DATABASE_URL como fallback. Los puertos deben estar libres; no se reutilizan servidores desconocidos. El runner administra Vite directamente para cerrar correctamente sus recursos en Windows.

En entornos con carpetas restringidas pueden configurarse `npm_config_cache` y `PLAYWRIGHT_BROWSERS_PATH` hacia directorios permitidos; no cambia dependencias ni resultados. No es necesario cambiar la instalación global de Node.

## Build y despliegue

Configurar `VITE_API_BASE_URL` con el origin HTTPS real **antes** de compilar. Un build sin esa configuración compila, pero rechaza el default HTTP al arrancar en producción. No incorporar contraseñas ni credenciales a VITE_*. El hosting debe servir index.html como fallback de rutas SPA, mantener HTTPS, y establecer CSP/headers del frontend apropiados; el Helmet de API no protege el HTML servido por otro origin.

Cookies requieren same-site o despliegue bajo un mismo origen. CORS no permite eludir SameSite ni restricciones de terceros. No se cambió el contrato de cookies ni se implementó infraestructura de hosting en F1.

Arquitectura y decisiones: [foundation-architecture](../../docs/frontend/foundation-architecture.md). Componentes/tokens: [design-system](../../docs/frontend/design-system.md). Evidencia y límites: [phase-1-validation](../../docs/frontend/phase-1-validation.md).
