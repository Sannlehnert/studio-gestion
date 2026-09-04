# Autenticación y política de sesiones

## Admin

POST /api/v1/auth/admin/login verifica email y contraseña Argon2id. Emails inexistentes pasan por una verificación dummy para reducir diferencias de costo. Los mensajes externos son iguales para usuario inexistente y contraseña incorrecta.

El login crea Session y AuditLog dentro de una transacción. La respuesta solo contiene identidad y expiración; el secreto de sesión se entrega por Set-Cookie. Un nuevo login crea otra sesión independiente.

## Activación Student

1. Admin emite un acceso para una alumna existente.
2. El backend devuelve accessId, activationUrl con #token= y expiresAt. Guarda únicamente el hash SHA-256.
3. El futuro frontend deberá leer el fragmento, limpiarlo inmediatamente con history.replaceState y enviar el token en JSON por POST a /auth/student/activate.
4. El backend comprueba estado, expiración y revocación; consume condicionalmente el token y crea sesión y auditoría en una única transacción.
5. La respuesta establece una cookie con un secreto distinto. El token de activación no sirve como sesión ni puede usarse nuevamente.

IMPLEMENTED: backend y enlace con fragmento. PLANNED: limpieza del fragmento y UX de activación, porque el frontend todavía no existe.

Si dos activaciones llegan juntas solo una puede ganar. Si la creación de sesión falla, la transacción revierte el consumo. Una revocación concurrente o bien impide la activación o responde 409 si la activación ya ganó.

## Revocación administrativa

El caso mínimo elegido es revocar un StudentAccess individual identificado por accessId y studentId. Se conserva el historial y no se invalida otro enlace por emitir uno nuevo.

Alternativas evaluadas: revocar todos los pendientes o regenerar invalidando los anteriores simplifica ciertos flujos futuros, pero añade una regla de exclusividad que el producto aún no requiere. No se incorporó esa regla implícitamente.

Repetir una revocación devuelve 204, preserva revokedAt y no duplica auditoría. Un acceso vencido todavía PENDING también puede revocarse. Revocar uno ya ACTIVATED devuelve 409: no se presenta esa acción como cierre de su sesión.

## Duración y vencimiento

| Sesión  | Default  | Configuración          |
| ------- | -------- | ---------------------- |
| Admin   | 24 horas | ADMIN_SESSION_TTL_MS   |
| Student | 30 días  | STUDENT_SESSION_TTL_MS |

Expiración absoluta desde la creación, inclusiva en el límite: expiresAt menor o igual a ahora invalida la sesión. lastSeenAt registra actividad y no renueva expiresAt. La cookie usa la misma expiración persistida.

No hay sliding expiration, refresh token ni endpoint de renovación. Para el MVP no son necesarios: se consulta PostgreSQL en cada autenticación, y el vencimiento termina el acceso. Admin vuelve a iniciar sesión. Student necesita otro enlace emitido por la profesora. La UX futura deberá mostrar este estado sin inventar una renovación silenciosa.

Esta decisión evita introducir un segundo secreto y reglas adicionales de rotación/replay antes de tener una necesidad de producto. Si cambia la duración o la necesidad de continuidad, revisar explícitamente esta política.

## Cookies y logout

Cookie host-only, Path=/, HttpOnly, SameSite=Lax. Secure obligatorio en producción y prefijo __Host- recomendado. Sin Domain, sin localStorage. Todos los valores salen de AppSettings.

POST /auth/logout requiere Origin/Referer permitido, revoca la sesión si existe y borra la cookie con el mismo ámbito. Es idempotente y devuelve 204 aunque la cookie falte, sea inválida o la sesión ya esté revocada.

Una revocación impide validaciones posteriores; no cancela trabajo que ya había superado autorización. Las operaciones de negocio críticas deberán definir su propia frontera transaccional. No existe aún una pantalla para revocar otras sesiones, limpieza automática de sesiones antiguas ni política de retención de ip/userAgent; son tareas pendientes de operación.

## Auditoría

Acciones implementadas: ADMIN_LOGIN, STUDENT_ACCESS_CREATED, STUDENT_ACCESS_ACTIVATED, STUDENT_ACCESS_REVOKED y SESSION_REVOKED.

No se guardan tokens planos, hashes de credenciales ni URLs de activación en metadata. Los eventos contienen IDs, rol o expiración según corresponda. No existe todavía endpoint de consulta de auditoría ni monitor de intentos de login fallidos.
