# Frontend Fase 1 — Validación final

Cierre: 23 de septiembre de 2026. FRONTEND FOUNDATION = COMPLETE para el alcance aprobado. No incluye Admin Core ni pantallas operativas de negocio. Backend y base de desarrollo permanecieron sin modificaciones.

## Entorno y resultados reales

Node 24.20.0, npm 11.19.0, Windows, Chromium de Playwright 1.63.0. Dependencias fijadas en package-lock.json. Los resultados corresponden a la implementación final; después de la última ejecución de navegador sólo se agregaron utilidades de formato/etiquetas sin consumidores visuales y documentación. Lint, tipos, unit/component y build se repitieron después de esas utilidades.

| Gate | Resultado |
| --- | --- |
| npm ci | PASS, instalación reproducible desde lockfile |
| Prisma generate | PASS, generación de cliente sin conexión a DB |
| OpenAPI generate + check | PASS: 75 operaciones, 94 schemas; JSON y tipos sincronizados |
| Frontend lint | PASS, cero warnings ESLint |
| Frontend typecheck | PASS, TypeScript strict y vue-tsc |
| Frontend unit/component/HTTP/session/router | PASS: 36 tests, 4 archivos |
| Playwright completo con backend real | PASS: 12 tests; 11 con respuestas controladas y 1 flujo integrado real |
| Frontend producción | PASS: Vite build; bootstrap 151,76 kB / gzip 54,74 kB; CSS 12,31 kB / gzip 3,60 kB |
| Backend lint y typecheck | PASS tras cambios de dependencias |
| Backend unit | PASS: 193 tests, 23 archivos |
| Backend PostgreSQL/HTTP | PASS: 151 tests, 19 archivos, incluyendo protecciones de concurrencia existentes |
| Migraciones en schemas de prueba nuevos | PASS: 10 migraciones existentes; también aplicadas en runner de navegador |
| npm audit completo online | PASS: 0 vulnerabilidades, 653 dependencias en metadata de audit |
| Revisión visual y accesibilidad básica | PASS dentro del alcance detallado abajo; no certificación WCAG completa |

No se ejecutó un nuevo build Nest mediante su script habitual; la exportación OpenAPI sí compiló el backend actual de manera aislada. No se hicieron migraciones, seeds ni reconciliación contra desarrollo. No se repitió upgrade 6→7: esta fase no cambia persistencia. El audit online funcionó; no se necesitó fallback offline.

## Cobertura

HTTP: cookies, 204, headers, códigos de error, red/timeout/cancelación, descarte de respuesta de otra sesión e intención de pago inmutable con la misma clave. Sesión/Router: bootstrap compartido, roles, 401/403 diferenciados, offline, logout, navegación durante login, logout durante login, limpieza de caché y activación incierta. Componentes: estados, labels/errores, botones ocupados y confirmación.

Chromium real: login Admin, recarga con cookie HttpOnly/SameSite=Lax/Secure=false local, Origin ajeno rechazado por CSRF con 403, preflight con credentials e Idempotency-Key, activación Student con limpieza de fragmento, separación de roles, almacenamiento persistente vacío y logout seguido de me=401. Credenciales y registros creados sólo en schema aleatorio de TEST_DATABASE_URL; cleanup en finally. El puerto 55432 estuvo inicialmente inaccesible; el usuario inició el contenedor de pruebas y las ejecuciones posteriores terminaron correctamente. No se trató ese bloqueo como defecto del código.

## Responsive, teclado y revisión visual

Capturas y comprobación de ausencia de desborde horizontal en 320, 390, 768 y 1440 px, layouts Admin/Student y diálogo. Inspección visual de Admin 320/1440, Student 390/768, diálogo 320, diálogo largo 390, error de login, offline 320 y texto largo ampliado 320. Capturas en apps/frontend/test-results, artefactos locales ignorados por Git.

Se verificaron navegación, foco inicial y retorno de diálogo, Tab/Shift+Tab, Escape, confirmación/cancelación, contenido largo, reduced motion y labels. Axe no detectó violaciones en login y las superficies Admin/diálogo evaluadas. Se corrigieron la salida de foco con Shift+Tab en diálogo nativo y el encogimiento del logo al ampliar texto.

Texto al 200% mediante tamaño raíz y reflow a 320 px equivalente al ancho de una ventana desktop ampliada: comprobados. No se afirma haber probado zoom nativo de navegador al 400%. La captura full-page con barra fija muestra ésta en la posición del viewport: el documento continúa desplazándose con espacio final reservado. Navegación permanece visible sin menú hamburguesa.

No se realizó evaluación manual con lector de pantalla, Safari/Firefox ni dispositivos físicos. Axe y teclado no certifican toda WCAG 2.2 AA. HTTPS/cookies Secure y headers del hosting deberán verificarse en el despliegue real; no se desactivaron CORS ni CSRF para pasar tests locales.

## Advertencias y límites concretos

- npm informa tsconfck existente sin mantenimiento y seis paquetes con scripts de instalación no cubiertos por allowScripts (Prisma/client/engines, prisma, argon2, vue-demi y @scarf/scarf). Instalación y gates terminaron con exit 0; no se relajó la política.
- Tooling backend conserva advertencias de Vite CommonJS y vite-tsconfig-paths. Playwright emitió aviso NO_COLOR/FORCE_COLOR sin fallo.
- OpenAPI original duplica el header de idempotencia por casing. El exportador normaliza exclusivamente esa duplicación conocida; no se modificó backend. Mantener alineado DocumentBuilder si cambia configuración Swagger.
- No hay sincronización visual proactiva entre pestañas: revocación se descubre en la siguiente solicitud protegida/recarga.
- Las pruebas usan respuestas controladas sólo como fixtures. El producto muestra estados estructurales honestos sin métricas o registros inventados.

## Documentación y siguiente fase

[Arquitectura](foundation-architecture.md), [design system](design-system.md) y [ejecución frontend](../../apps/frontend/README.md) describen el comportamiento implementado. Índice frontend, README raíz y PROJECT_CONTEXT reflejan F1. Foundation queda preparada para Fase 2: Admin Core, que requiere un nuevo prompt y no se inició.
