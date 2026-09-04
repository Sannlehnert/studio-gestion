# Arquitectura del backend

## Límites

Monolito modular NestJS. El controller documenta HTTP, valida DTOs/params, llama al servicio y transporta resultados o cookies. El servicio coordina reglas y transacciones. Prisma persiste. No hay Repository Pattern adicional, CQRS ni eventos distribuidos.

## Módulos existentes

`StudentsModule` contiene el controller administrativo, DTOs y StudentsService. Prisma permanece como acceso directo a persistencia; el servicio coordina bloqueos, transacciones, estado y AuditLog. Los endpoints de StudentAccess permanecen en Admin/Auth para conservar sus contratos y su responsabilidad de credenciales.

- AppModule: composición y configuración validada.
- PrismaModule global: PrismaService, conexión al iniciar y desconexión al cerrar.
- AuthModule: tokens, contraseñas, sesiones, cookies, login/activación/logout y guards.
- AdminModule: comprobación de permisos y administración de StudentAccess.
- StudentModule: únicamente comprobación de permisos de alumna; no es StudentsModule de negocio.
- StudentsModule: gestión administrativa de Student, estado, paginación y auditoría.
- HealthController: liveness con timestamp. El inicio de AppModule requiere conexión PostgreSQL, pero health no ejecuta una consulta nueva por request.

La carpeta common contiene configuración HTTP compartida, DTO de error y filtro de excepciones. No es un contenedor de reglas de negocio.

## Inicialización HTTP

main.ts crea NestExpressApplication con bodyParser desactivado y llama a configureApp. Esa misma función inicializa las aplicaciones de prueba.

Orden: trust proxy explícito, Helmet, no-store, rate limiting, CORS, validación CSRF, admisión de JSON, parser limitado, normalización de errores de parsing, cookie-parser, prefijo/DTOs/filtro y OpenAPI en desarrollo. Después de inicializar Nest se registra el fallback JSON de rutas fuera del prefijo, porque Nest 12 limita su 404 al prefijo.

ConfigModule expone AppSettings validados. Servicios y controllers no interpretan por separado variables de cookies, orígenes o TTL. En tests se ignora el .env de desarrollo.

## Auth y persistencia

TokenService genera 32 bytes CSPRNG codificados base64url y persiste hashes SHA-256. PasswordService usa Argon2id y realiza verificación equivalente para emails inexistentes. SessionCookieService reúne lectura, emisión y borrado de cookie.

SessionGuard consulta SessionService y luego la identidad del rol. AdminGuard y StudentGuard exigen su rol. CurrentUser/CurrentSession leen solo los datos que dejó el guard.

SessionService usa findUnique porque tokenHash tiene UNIQUE; lastSeenAt se actualiza con un predicado de vigencia. No hay sliding expiration. Las transacciones de activación, emisión, revocación y login/logout incluyen sus eventos AuditLog; si una operación crítica falla, no queda un éxito parcial.

La actualización condicional de StudentAccess serializa consumo y revocación sobre la misma fila bajo READ COMMITTED. No hace falta un lock distribuido. Las operaciones futuras de cupos requieren un diseño propio.

## Contratos y errores

Prefijo /api/v1. Separación /admin y /student; Auth compartido solo para identidad y logout. Swagger documenta DTOs, cookies y respuestas, disponible en /api/docs y /api/docs-json fuera de producción.

DTOs con whitelist y forbidNonWhitelisted. IDs de accesos/alumnas recibidos por Admin se validan como UUID. Los errores conservan un formato común, sin stack, SQL ni query string. Ver [convenciones](api-conventions.md).

## Pruebas y herramientas

Vitest para unitarios y pruebas HTTP; Supertest para flujos reales. El chequeo TypeScript incluye src, tests, seed y configuración de tests. Lint carga explícitamente oxlint.json, prohíbe any explícito y falla ante warnings.

Los E2E exigen TEST_DATABASE_URL hacia una base *_test. El runner crea un schema e2e_ aleatorio, aplica migraciones, ejecuta las suites y elimina solo ese schema. No hay limpiezas globales de tablas de desarrollo. Tests de concurrencia, migración y unicidad usan PostgreSQL real.

El script de seed exige credenciales explícitas, no tiene contraseña por defecto, no cambia un Admin existente y tolera dos ejecuciones concurrentes del alta inicial.

## Límites operativos actuales

Una instancia backend con rate limiting en memoria. Antes de múltiples instancias se necesita un store compartido y una topología de proxy definida. La configuración de DB de producción, TLS, backup/restore y observabilidad pertenecen al despliegue y no están provisionados aquí.
