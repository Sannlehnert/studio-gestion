# Frontend F1 — Arquitectura implementada

## Alcance y dependencias

SPA Vue 3 con Composition API/script setup, Vite 8, Vue Router 4 y TanStack Vue Query 5. Frontend usa TypeScript 5.9 con strict y noUncheckedIndexedAccess porque openapi-typescript 7 declara peer TypeScript 5; el backend conserva su TypeScript 6. Vue-tsc comprueba SFCs y tests. Versiones resueltas en package-lock.json, instalación desde la raíz con npm ci.

Tailwind 4 vía plugin Vite. ESLint/typescript-eslint/eslint-plugin-vue cubren código, templates y scripts; los outputs generados/compilados quedan excluidos. Vitest/Vue Test Utils/jsdom para pruebas unitarias; Playwright/Chromium y axe-core para comprobaciones reales de interfaz. Iconos @lucide/vue; se reemplazó el paquete deprecado lucide-vue-next durante instalación. Sin Pinia, framework UI, SSR, librería de animación ni stores de entidades.

## Límites

`src/app`: composición, Router, QueryClient, layouts y vistas estructurales. `features/auth`: sesión, login y activación mínima. `shared/api`: documento/tipos generados, transporte y errores. `shared/ui`: primitivas utilizadas. `shared/lib`: configuración y formato. `shared/styles`: tokens globales. No se crean carpetas vacías de negocio.

Admin: Hoy, Alumnas, Clases, Gestión. Student: Inicio, Clases, Historial. Login/activación/acceso requerido son públicos; existen 404 y acceso no autorizado. Shell comparte estructura visual con navegación según rol confirmado, no deducido de URL. Vistas de negocio son avisos estructurales explícitos; no ejecutan CRUD ni representan datos ficticios como reales.

## OpenAPI reproducible

`scripts/openapi.mjs` compila fuentes backend actuales a `.openapi-build` ignorado dentro del frontend; no modifica su dist/cache rastreado. Crea Nest con NODE_ENV=test y URL de DB deliberadamente no conectable. Sólo construye metadata Swagger; **no llama init, listen o configureApp**, por lo que no conecta Prisma ni inicia reconciliación. Cierra la aplicación tras exportar.

Versiona `src/shared/api/openapi.json` y `schema.d.ts`. api:check repite exportación/generación y compara los dos contenidos; falla si cambian. No editar outputs a mano. La configuración DocumentBuilder replica la del backend: si ésta cambia deberá actualizarse el exportador. Los controllers/DTOs se extraen del código real, no de DTOs manuales.

Normalización explícita: Nest emite `idempotency-key` y `Idempotency-Key` para Payment. HTTP no distingue capitalización; el script conserva una sola definición canónica `Idempotency-Key`. No cambia el contrato de ejecución, no parchea backend ni crea headers adicionales. Es una imprecisión pendiente del documento original; la normalización queda localizada para retirarla cuando se corrija upstream.

Tipos preservan enums, nullables, dinero string y envelopes. `date` y `date-time` siguen strings en el tipo generado: OpenAPI TypeScript no los convierte automáticamente en Date ni garantiza su validación runtime. `civilDate` valida calendario al formatear y las utilidades separan instantes con zona de fechas civiles. El transporte valida JSON y la sesión comprueba identidad/rol básicos; no se añadió otro generador de validadores de todos los DTOs.

## HTTP y errores

openapi-fetch resuelve paths, params, body y respuesta tipada. Una función fetch compartida agrega credentials=include, AbortSignal, timeout de 15 s, normalización de fallos y cancelación por ciclo de sesión. Lee el body antes de liberar el control de cancelación, para no aceptar un stream tardío de una identidad anterior. Maneja 204 sin intentar parsear JSON.

ApiFailure distingue http/network/timeout/cancelled/invalid-response, status, code, resultado incierto y Retry-After cuando está disponible. Los textos UX se asignan por code/status, nunca por buscar fragmentos de message. SQL/HTML de proxy/stacks no se muestran. No toast global ni retry oculto. Una mutación sin respuesta confirmada, con JSON inválido o error 5xx se presenta como incierta.

Origin lo aporta el navegador; no se inventa un header CSRF. Sólo se envían headers del contrato. `paymentIntent` crea UUIDv4 + copia inmutable del payload de Payment; F2 puede reutilizar ambos sin generar otra clave por reintento. Sólo memoria, no localStorage; tras recarga y pérdida de clave hay que revisar registros antes de otra intención. No hay UI de Payments ni retry automático.

## Sesión y carreras

`/auth/me` es fuente de identidad. Estados: checking, anonymous, authenticated con ADMIN/STUDENT, expired, offline y logout-unconfirmed. Guardas son UX; autorización real permanece en backend.

Bootstrap se comparte entre navegaciones. Navegación durante login/activación espera la transición y no dispara una consulta anónima que pueda cancelar el login. Antes de cambiar identidad se incrementa generación, se aborta transporte, se cancelan queries y se vacían las cachés. Claves incluyen generación, rol, identidad, recurso y filtros. Respuestas anteriores no se aceptan aunque el fetch ignore AbortSignal.

Logout durante bootstrap gana frente a respuestas tardías. Logout solicitado durante login espera que termine Set-Cookie y luego revoca: abortar un login en el navegador no revierte lo que ya hizo el servidor. Logout confirmado limpia y navega; fallo de red oculta datos pero no afirma que una cookie HttpOnly esté revocada. Permite reintentar el cierre. Se descartan contraseñas tras cada intento.

401 protegido elimina estado y termina sesión conocida; login/activación tienen errores públicos independientes. 403 no produce logout. Error de red al verificar acceso tiene estado propio. No refresh token, renovación silenciosa, almacenamiento de cookies ni sesiones falsas. Expiración se descubre mediante respuesta del servidor, no temporizador inventado.

Return-to vive en memoria, admite sólo los destinos estructurales conocidos y se consume sólo para el mismo rol. Rechaza URLs externas, query params y fragmentos. La raíz espera identidad antes de elegir inicio. F2 ampliará esa allowlist al agregar rutas reales.

La limpieza/ciclo se garantiza dentro de esta instancia de la SPA; no hay sincronización proactiva entre pestañas mediante BroadcastChannel. Una sesión revocada se detecta en la siguiente solicitud protegida o recarga; no se promete revocación visual instantánea entre pestañas.

## Activación

main captura y quita fragmento/query de /activate antes de importar la aplicación/Router. El token queda en un closure de un solo consumo y luego en una variable local del flujo, nunca en QueryClient, stores persistentes, logs o telemetría. Confirmar usa ese token una vez; salir lo descarta. La pantalla avisa si ya hay identidad abierta.

Ante respuesta incierta se consulta me. Una identidad igual a la que ya estaba abierta no prueba que se haya consumido el nuevo enlace; se conserva el error incierto. El token se descarta después del intento: si no se confirma acceso, volver al enlace o pedir uno nuevo. No pantalla de contraseña Student.

## QueryClient

staleTime 30 s, gcTime 5 min, sin refetch global por foco; un único retry de lectura ante fallo de red conocido. Mutaciones retry=false y gcTime=0. Auth no usa mutation cache para no guardar contraseñas/token en variables de TanStack. Operaciones de dinero/Attendance/Recovery/Correction deberán confirmar servidor e invalidar claves pertinentes, nunca optimistic success. No stores que dupliquen server state.

Utilidades de formato usan es-AR, horas de negocio con IANA y Decimal string/BigInt para evitar redondeos de dinero. No calculan saldos, cupos, allowance ni elegibilidad.

## Entornos y tests

[README frontend](../../apps/frontend/README.md) contiene comandos y variables. El runner real exige TEST_DATABASE_URL terminada en _test, schema aleatorio, Admin efímero y limpieza del schema en finally. Sólo allí configureApp/listen inicializan Prisma/reconciliación, sobre datos de prueba. Trace/video están deshabilitados para no capturar credenciales o enlaces; capturas visuales usan fixtures explícitos sin secretos reales.
