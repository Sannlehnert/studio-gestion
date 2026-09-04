# Baseline de seguridad

Esta baseline describe el código existente. COMPLETE para Auth/Foundation no significa que todas las tareas de operación y despliegue estén implementadas.

## Estado

| Control               | Estado                       | Alcance real                                                                                                                         |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Argon2id              | IMPLEMENTED                  | 64 MiB, 3 iteraciones, paralelismo 4; verificación dummy para usuario inexistente.                                                   |
| Tokens y sesiones     | IMPLEMENTED                  | 256 bits CSPRNG, hashes SHA-256 únicos, expiración, revocación y guards.                                                             |
| Activación de un uso  | IMPLEMENTED                  | Consumo condicional, sesión y auditoría en una transacción; pruebas concurrentes PostgreSQL.                                         |
| StudentAccess Admin   | IMPLEMENTED                  | Emisión y revocación individual, pertenencia comprobada, historial conservado.                                                       |
| Cookies               | IMPLEMENTED                  | HttpOnly, host-only, SameSite=Lax, Secure exigido en producción.                                                                     |
| CSRF                  | IMPLEMENTED                  | Validación estricta de Origin/Referer en métodos mutables, incluidos login y activación.                                             |
| CORS                  | IMPLEMENTED                  | Allowlist exacta configurable, credentials; sin wildcard.                                                                            |
| Helmet                | IMPLEMENTED                  | CSP, nosniff, anti-framing, no-referrer y demás headers; HSTS solo en producción.                                                    |
| Rate limiting         | IMPLEMENTED                  | Categorías por IP, límites configurables, Retry-After, almacén en memoria.                                                           |
| Payload               | IMPLEMENTED                  | JSON 16 KiB por defecto, sin compresión ni URL encoded.                                                                              |
| IDOR/BOLA             | IMPLEMENTED                  | Identidad por sesión; Students y núcleo comercial sólo Admin, UUIDs validados y recursos anidados comprobados.                        |
| SQL injection         | IMPLEMENTED en Auth          | Prisma parametrizado. El único identificador SQL dinámico del runner de tests se genera internamente y se acota a un schema aislado. |
| Mass assignment       | IMPLEMENTED                  | DTOs estrictos y persistencia explícita.                                                                                             |
| Errores/logs          | IMPLEMENTED / PARTIAL        | Sin stacks, tokens ni bodies en respuestas o logs de error; falta telemetría operativa de seguridad.                                 |
| URL de activación     | PARTIAL de extremo a extremo | Fragmento implementado; limpieza inmediata por frontend PLANNED.                                                                     |
| Privilegios DB        | PARTIAL                      | Tests aislados; separación de roles de aplicación/migración de producción no provisionada.                                           |
| TLS, backups, alertas | PLANNED de despliegue        | La configuración exige HTTPS en producción; no se desplegó infraestructura.                                                          |
| QR                    | PLANNED                      | Challenge temporal y validaciones de dominio, sin GPS.                                                                               |

## Decisión CSRF

Se asume una aplicación propia con backend y frontend en el mismo sitio, por ejemplo subdominios bajo el mismo dominio registrable, y orígenes confiables configurados explícitamente. No confiar en Host o X-Forwarded-Host para construir la allowlist.

| Alternativa               | Seguridad y costo                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| SameSite + Origin/Referer | Validación exacta y rechazo si ambos faltan; también cubre login. Sin otro secreto o almacenamiento.                                 |
| Synchronizer Token        | Token ligado a sesión y header adicional; robusto, pero necesita bootstrap y estado/rotación del token.                              |
| Double Submit Cookie      | Con firma y vínculo a sesión evita depender de un registro adicional; requiere otra cookie, secreto de firma y reglas de validación. |

Se eligió la primera alternativa con validación estricta, JSON y cookies Lax como defensa adicional. SameSite=Lax por sí solo no se considera protección completa. Origin tiene prioridad; un Origin inválido no puede rescatarse con Referer. Se rechazan null, valores ambiguos, orígenes extraños y requests mutables sin evidencia de origen.

El frontend solo necesita credentials: include; el navegador aporta Origin. Clientes no navegador deben enviarlo explícitamente. La estrategia no agrega estado distribuido. Una aplicación XSS dentro de un origin permitido ya está dentro de la frontera de confianza; esto requiere proteger el frontend, como también ocurre con las otras alternativas.

Un frontend en otro sitio registrable necesitará revisar cookies, restricciones de terceros y esta decisión antes del despliegue. No cambiar SameSite a None sin esa revisión. Referencia: [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## CORS, CSP y futura cámara

FRONTEND_ORIGIN define el destino del enlace; FRONTEND_ORIGINS permite origins adicionales exactos. API_ORIGIN permite requests del Swagger local. Producción exige HTTPS y deshabilita Swagger público.

CSP de API restringida; únicamente el Swagger de desarrollo permite estilos inline, porque su HTML los usa. Scripts continúan limitados al propio origin. HSTS no incluye subdominios que este backend no administra. No se impone una política global que deniegue la cámara: el futuro frontend definirá CSP y permisos de cámara en su propio origen HTTPS. Referencia técnica: [Helmet](https://helmet.js.org/).

## Límites HTTP

| Categoría          | Default por IP    | Motivo                                                                            |
| ------------------ | ----------------- | --------------------------------------------------------------------------------- |
| General            | 300 por minuto    | Espacio para consultas de un grupo bajo la misma conexión, con límite de ráfagas. |
| Admin login        | 10 por 15 minutos | Pocos accesos legítimos de la profesora y costo de Argon2.                        |
| Activación Student | 60 por 15 minutos | Permitir activación de un grupo desde una misma red; tokens de alta entropía.     |
| Emisión de accesos | 30 por 15 minutos | Cubre la emisión de un grupo habitual, restringiendo abuso.                       |

Las variables RATE_* permiten ajustar con evidencia de uso. El límite general y el sensible se acumulan. Contadores en memoria por proceso; reiniciar los reinicia. Una instancia es el supuesto actual. Antes de escalar horizontalmente usar un store compartido y protección en el proxy.

TRUST_PROXY=false por defecto. Solo admitir IPs/CIDRs específicos de proxies reales; se rechazan true, conteos de saltos y redes /0. No confiar en X-Forwarded-For desde clientes directos. El almacenamiento de límites y tratamiento de IPv6 provienen de [express-rate-limit](https://express-rate-limit.mintlify.app/reference/configuration).

## Dependencias

Se removió @nestjs/mau, herramienta de despliegue no usada que arrastraba avisos de seguridad. Argon2 aporta sus tipos, por lo que no necesita @types/argon2.

Hay un override acotado de deepmerge-ts a 8.0.0 dentro de @prisma/config. Corrige [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx). Se revisó el uso de deepmerge en Prisma y las [notas de la versión](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0): los cambios de Map, deepmergeInto y tipos de customización no corresponden a los objetos de configuración usados aquí. Validar generación y migraciones con este override; retirarlo cuando Prisma declare una versión corregida compatible. No se aplicó audit fix --force ni se migró de versión mayor de Prisma.

Ver el resultado real de auditoría y pruebas en [validación](phase-0-validation.md).

## Datos e historial

No hay borrado físico de Student ni del núcleo comercial por API. `isActive=false` revoca accesos pendientes y sesiones Student; reactivar no revive credenciales. Plan inactivo sólo bloquea nuevas ventas. Subscription conserva condiciones contratadas y Payment sólo puede anularse con autor, fecha y motivo.

Los DTOs no aceptan IDs, estados, moneda ni totales calculados fuera de cada caso de uso. Los servicios derivan snapshots, currency y saldos. Los precios/importes llegan como strings decimales acotados. PostgreSQL repite invariantes críticas con CHECK, FK, UNIQUE y exclusión temporal.

Subscription concurrentes se serializan por Student y terminan protegidas por `Subscription_no_active_overlap`. Payment concurrentes se serializan por Subscription antes de calcular saldo; el sobrepago se rechaza. `Idempotency-Key` UUID v4 hace seguro el replay de un registro idéntico y rechaza reutilización con otro payload. AuditLog no guarda esa clave.

Auth, Students y operaciones comerciales escriben auditoría en la misma transacción sin secretos. La retención y purga de sesiones, metadatos de red y AuditLog requiere una política explícita y aún no está implementada. Modelos de etapas futuras conservan algunas cascadas que deben revisarse antes de exponer borrado operativo.
