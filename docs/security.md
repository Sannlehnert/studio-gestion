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
| Rate limiting         | IMPLEMENTED                  | IP general y categorías Auth; Student para PRESENT y Admin+ClassSession para QR, configurables, Retry-After, memoria.                                                           |
| Payload               | IMPLEMENTED                  | JSON 16 KiB por defecto, sin compresión ni URL encoded.                                                                              |
| IDOR/BOLA             | IMPLEMENTED                  | Identidad por sesión; Students, núcleo comercial y scheduling sólo Admin, UUIDs validados y relaciones cruzadas comprobadas.          |
| Attendance            | IMPLEMENTED                  | Student actúa para sí con challenge obligatorio, reloj del backend, ownership, locks y UNIQUE; Admin emite QR y consulta.       |
| SQL injection         | IMPLEMENTED en Auth          | Prisma parametrizado. El único identificador SQL dinámico del runner de tests se genera internamente y se acota a un schema aislado. |
| Mass assignment       | IMPLEMENTED                  | DTOs estrictos y persistencia explícita.                                                                                             |
| Errores/logs          | IMPLEMENTED / PARTIAL        | Sin stacks, tokens ni bodies en respuestas o logs de error; falta telemetría operativa de seguridad.                                 |
| URL de activación     | PARTIAL de extremo a extremo | Fragmento implementado; limpieza inmediata por frontend PLANNED.                                                                     |
| Privilegios DB        | PARTIAL                      | Tests aislados; separación de roles de aplicación/migración de producción no provisionada.                                           |
| TLS, backups, alertas | PLANNED de despliegue        | La configuración exige HTTPS en producción; no se desplegó infraestructura.                                                          |
| QR                    | IMPLEMENTED                  | Challenge temporal hasheado, rotación acotada y validaciones de dominio; sin prueba de proximidad.                                                                               |

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

| Categoría          | Default y dimensión | Motivo                                                                            |
| ------------------ | ----------------- | --------------------------------------------------------------------------------- |
| General            | 300 por minuto    | Espacio para consultas de un grupo bajo la misma conexión, con límite de ráfagas. |
| Admin login        | 10 por 15 minutos | Pocos accesos legítimos de la profesora y costo de Argon2.                        |
| Activación Student | 60 por 15 minutos | Permitir activación de un grupo desde una misma red; tokens de alta entropía.     |
| Emisión de accesos | 30 por 15 minutos | Cubre la emisión de un grupo habitual, restringiendo abuso.                       |
| Marcar Attendance | 20/min por Student | Tolera reintentos sin bloquear alumnas bajo la misma IP. |
| Emitir QR | 20/min por Admin + ClassSession | Permite recargas y rotaciones; limita abuso. |

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

Scheduling no acepta IDs internos, estado, capacidad ni timestamps fuera del DTO específico de cada caso de uso. La FK compuesta impide asignar a una Student una Subscription ajena incluso fuera del servicio. Los cupos se serializan por Schedule; PostgreSQL rechaza Enrollment solapados y clases duplicadas. La generación sólo usa Schedules activos y la cancelación exige Admin, motivo y auditoría. Las horas recurrentes nunca dependen del reloj o timezone del navegador.

Attendance no acepta `studentId`, `subscriptionId`, estado, origen, timestamp ni contadores. StudentGuard fija la identidad y vuelve a comprobar `Student.isActive`; la elegibilidad contractual se deriva con StudentActivePeriod en `ClassSession.startAt`. Una consulta Student exige una Attendance propia o pertenencia temporal. El servicio parametriza también su consulta SQL de próximas clases. CSRF cubre el POST y un límite configurable de 20 por minuto por Student reduce abuso sin sustituir UNIQUE, FKs, CHECKs ni locks.

Las relaciones históricas de Attendance y las relaciones Student/Subscription de Recovery usan `ON DELETE RESTRICT`. El AuditLog de PRESENT identifica a la Student; el cierre automático usa actor nulo y metadata agregada, sin inventar un Admin ni guardar cookies o tokens.

Auth, Students, operaciones comerciales, scheduling y Attendance escriben auditoría en la misma transacción sin secretos. La retención y purga de sesiones, metadatos de red y AuditLog requiere una política explícita y aún no está implementada.

## QR: secretos efímeros y límites reales

Token opaco CSPRNG de 256 bits, hash SHA-256, TTL default 60s (30–120), asociación exacta a ClassSession y ventana actual. Valida también replays. No se usa como autenticación ni prueba física. Capturas o envío por WhatsApp en tiempo real siguen siendo útiles durante la vigencia si quien recibe tiene sesión Student y elegibilidad. Una sesión robada más un QR vigente tampoco se neutraliza con este mecanismo. Ver el [threat model completo](attendance-qr.md).

El secreto se transporta sólo en body JSON y en la respuesta de emisión, nunca en URL, AuditLog, logs o ejemplos Swagger. El filtro ya evita reflejar cuerpos y errores Prisma; no hay body/access logging ni tracing de payloads configurado. El despliegue debe excluir estos cuerpos también en proxies, APM y cachés: el código de la API no controla infraestructura externa. HTTPS y no-store siguen siendo necesarios.

El límite general de 300/min por IP es secundario y configurable: un grupo grande con múltiples peticiones puede agotarlo; hay que dimensionarlo con tráfico real. El límite específico de PRESENT ya no agrupa a todas las alumnas de la sala. Antes de varias instancias, ambos contadores autenticados necesitan un store compartido; la integridad ya depende de transacciones PostgreSQL, no de esos contadores.

Durante la validación online de Etapa 5 npm audit detectó cuatro avisos de Multer 2.2.0 propagados como cinco dependencias vulnerables. Se agregó un override acotado a @nestjs/platform-express → multer 2.3.0, dentro del mismo major. La [versión oficial](https://github.com/expressjs/multer/releases/tag/v2.3.0) corrige GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf, GHSA-qvfw-j98x-7q72 y GHSA-535w-7cp7-47q4. No se usan interceptores de archivos y JSON-only mantiene uploads rechazados. Sólo ese paquete cambió en el lockfile; suite completa, build y audit online posteriores pasaron. Retirar el override cuando Nest declare la dependencia corregida.

## Recuperaciones

AdminGuard restringe autorización/cancelación y StudentGuard deriva propiedad para lecturas/PRESENT. Sólo targetClassSessionId o reason ingresan al caso de uso; no se aceptan Student, Subscription, autor, estado o consumo externos. DTOs limitan UUIDs, motivo y paginación; CSRF/no-store/error sanitization se reutilizan.

Los FKs compuestos impiden vínculos cruzados; los índices parciales protegen doble autorización y destino; locks PostgreSQL mantienen cupo y exclusión entre cancelación/PRESENT/reconciliación. Recovery nunca vuelve gratuita una clase habitual, ni habilita cadenas desde una ausencia de Recovery. Auditoría atómica con actor real; cancelación de clase/contrato deriva indisponibilidad y no inventa otro Admin. Los detalles y casos de seguridad están en [Recoveries](recoveries.md).

## Correcciones y auditoría (Etapa 7)

Los cuatro endpoints nuevos requieren Admin autenticado. POST conserva defensa CSRF/Origin, límites generales y DTOs estrictos. El cliente no elige autor, timestamp, source, contrato, recoveryId o consumo. El servidor resuelve y bloquea identidades. Historial inmutable y constraints cubren carreras; rate limiting no sostiene integridad. La consulta de auditoría proyecta metadata por acción, sin secretos. Student no accede al historial administrativo ni puede omitir QR. [Reglas](admin-corrections.md), [auditoría](operational-audit.md).

## Integración frontend — Etapa 7.1

Las nuevas lecturas Student derivan identidad exclusivamente de sesión; Admin requiere su guard. Home no expone finanzas y el historial público no expone motivos, actor ni metadata de correcciones/auditoría. DTOs rechazan filtros desconocidos. Paginación/rangos/candidatas están acotados. CORS conserva allowlist/credentials y mutaciones mantienen CSRF. Errores públicos no reflejan SQL, Prisma ni stacks.

Contrato completo y límites: [frontend-integration-contract.md](frontend-integration-contract.md). Evidencia: [stage-7.1-validation.md](stage-7.1-validation.md).
