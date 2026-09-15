# Dynamic QR Attendance Challenge

## Alcance y fuente de verdad

El QR prueba únicamente posesión de un challenge temporal de una ClassSession. No autentica, no identifica a la Student y no demuestra presencia física. La sesión determina identidad; Student/StudentActivePeriod, Enrollment, Subscription y ClassSession determinan elegibilidad; Attendance determina consumo. El reloj del backend decide vigencia.

Se reutiliza AttendanceModule, TokenService, CLOCK, Prisma y los guards existentes. No hay PNG, endpoint alternativo de PRESENT, GPS, mecanismo de proximidad, scheduler QR ni endpoint de estado sin necesidad de producto. Etapa 6 reutiliza este mecanismo para Recoveries adicionales autorizadas.

## Alternativas evaluadas

| Decisión | Alternativa | Elección y razón |
| --- | --- | --- |
| Persistencia | Token firmado/stateless | Secreto aleatorio con hash: revocable y auditable, sin otra clave de firma; Attendance igualmente consulta PostgreSQL. |
| Rotación | Invalidar inmediatamente el anterior | Conservar el predecesor para tolerar un escaneo que cruza una rotación. |
| Frecuencia | Cooldown obligatorio de medio TTL | Sin cooldown de dominio: recargas y reintentos pueden emitir inmediatamente, sujetos sólo a rate limiting. |
| Generación | Scheduler continuo | On demand: sólo se generan secretos cuando un Admin los solicita. |
| Limpieza | Barrido global y scheduler | Limpieza transaccional local en cada emisión, con almacenamiento acotado por clase. |

## Lifecycle y rotación

El secreto contiene `sgq_` seguido por 32 bytes CSPRNG base64url: 256 bits y 47 caracteres totales. Se guarda sólo el SHA-256 hexadecimal de todo el token. No se usan UUID, timestamps ni generation como secreto.

`QR_CHALLENGE_TTL_SECONDS` vale 60 por defecto y admite 30–120. Sesenta segundos da margen de escaneo/red y limita el uso de capturas viejas. El backend calcula `expiresAt = min(createdAt + TTL, closesAt)` y sólo emite en estado SCHEDULED dentro de `[opensAt, closesAt)`. El vencimiento original nunca se extiende ni se reescribe.

Dentro de una transacción, tomando primero `FOR UPDATE` sobre ClassSession:

1. Comprueba estado y ventana actuales con CLOCK.
2. Elimina challenges vencidos o revocados de esa clase; conserva AuditLog.
3. Ordena los restantes por generation descendente y conserva sólo el predecesor no revocado. Revoca los más antiguos.
4. Vuelve a leer el reloj tras las esperas, genera un secreto nuevo y persiste su hash, autor y timestamps.
5. Audita la emisión/rotación sin secreto ni hash y comprueba nuevamente que no haya expirado antes de terminar.

Quedan como máximo dos challenges no revocados y tres filas físicas por clase: actual, predecesor y, si hubo, el desplazado recién revocado. La emisión siguiente elimina este último. Después del cierre pueden quedar hasta tres hashes inútiles; se conserva ese pequeño remanente sin un job adicional. El almacenamiento crece con la cantidad de clases, no con todas las rotaciones históricas. AuditLog conserva cada emisión efectiva con ID, clase, autor, expiry y cantidad revocada.

La superposición tiene un límite explícito: un challenge sobrevive una rotación, no una sucesión ilimitada de recargas. Una tercera emisión revoca el primero aunque su expiry aún sea futuro. No se garantiza una gracia mínima en segundos. El frontend debe tener una sola solicitud de rotación en vuelo, reemplazar el QR con la respuesta de emisión y permitir reescanear ante rechazo. Pedir otro QR tras perder una respuesta es válido; la emisión no promete idempotencia ni recuperación del secreto anterior.

generation es un BIGINT de secuencia PostgreSQL, interno. Resuelve el orden real de emisiones que comparten el mismo milisegundo y evita usar un UUID aleatorio como desempate cronológico. No incorpora datos personales ni se expone por API.

## Operaciones y análisis de dominio

| Operación | Permiso / input externo | Regla, validación e invariantes | Transacción, repetición y auditoría |
| --- | --- | --- | --- |
| Emitir/rotar | Admin autenticado; UUID de ClassSession, body vacío | Clase existente, SCHEDULED, ventana abierta; TTL, autor y secreto derivados en backend | Lock ClassSession; cleanup, revocación, alta y AuditLog atómicos. Cada éxito crea otro secreto. |
| PRESENT | Student autenticada; UUID de clase y challenge | Formato acotado, hash encontrado, clase exacta, no revocado, no vencido; actividad actual/histórica, contrato, inscripción, ventana y allowance | Locks ClassSession → Student → Subscription; relectura de elegibilidad y reloj. UNIQUE Student/ClassSession. Attendance y auditoría atómicos. |
| Repetir PRESENT | Misma autorización y body | Challenge y ventana siguen siendo obligatorios; no exige una clase disponible adicional | Devuelve la misma Attendance, sin consumo ni evento nuevo. |
| Cancelar clase | Admin; contrato existente de cancelación | Rechaza COMPLETED o Attendance existente; conserva motivo y timestamps originales en replay | Schedule → ClassSession; revoca challenges junto con cancelación y su AuditLog existente. |
| Limpiar challenges | Interno al emitir, sin endpoint ni input de retención | Sólo secretos efímeros vencidos/revocados de la clase bloqueada | No borra Attendance, Student ni AuditLog; no requiere una FK desde la asistencia al challenge. |

DTOs rechazan identidad, rol, estado, origen, timestamps, TTL y totales manipulados. La Subscription se deriva del dominio; `StudentActivePeriod` se evalúa en `ClassSession.startAt`. Las finanzas no agregan una condición de pago inexistente. La validación histórica existente de cancelación contractual se conserva.

PostgreSQL protege tokenHash UNIQUE, formato del hash, límites de fechas, FKs RESTRICT y unicidad histórica de Attendance. La cota de challenges se mantiene mediante el bloqueo de fila y el protocolo transaccional; un rate limit no es una garantía de integridad. No se permite escritura externa que omita ese protocolo.

## PRESENT, replay y tiempo

El token es compartido: no se consume globalmente. Dos Students elegibles pueden usarlo; dos pedidos de la misma Student producen una sola Attendance y un único consumo. Un PRESENT previo no permite omitir el challenge: si expiró, fue revocado o corresponde a otra clase, el replay se rechaza. El endpoint Student no transforma ABSENT en PRESENT; la corrección Admin es un caso auditado separado.

El servicio consulta y verifica el hash mientras mantiene el lock ClassSession, antes de continuar con las reglas existentes. Revalida el tiempo después de los locks y del cálculo de consumo, inmediatamente antes del alta o del retorno idempotente. Para una nueva asistencia vuelve a verificar al finalizar las escrituras y la consulta de respuesta: si observa vencimiento, revierte también AuditLog.

La semántica se decide dentro de la transacción, no por la hora de llegada al controller ni por timestamps del cliente. La entrega de la respuesta puede demorarse en la red. No se promete que un QR recibido siga vigente al llegar al dispositivo: ante vencimiento se solicita otro.

Siempre se consulta el estado y la ventana actuales. Una cancelación inutiliza todos los challenges y también los revoca explícitamente. Un cambio horario puede cerrar la ventana antes del expiry almacenado; en ese caso PRESENT igualmente se rechaza. El QR nunca prolonga la ventana de Attendance. ABSENT y reconciliación no requieren QR.

## API

| Método | Ruta | Autorización | Resultado |
| --- | --- | --- | --- |
| POST | `/api/v1/admin/class-sessions/:classSessionId/qr-challenge` | ADMIN + Origin/Referer permitido | 201: challenge, classSessionId, expiresAt. Body vacío. |
| POST | `/api/v1/student/class-sessions/:classSessionId/attendance` | STUDENT + Origin/Referer permitido | 200: Attendance propia y resumen. Body obligatorio `{ challenge }`. |

Las rutas GET de Attendance y resúmenes mantienen su contrato. No devuelven hashes ni challenges. No hay endpoint para obtener el secreto anterior.

400: formato/body/UUID inválido. 401: sesión ausente/inválida o Student no disponible. 403: rol u origen inválido. 404: clase inexistente/no disponible para la Student. 409: challenge inválido, vencido, revocado, cruzado, estado o ventana no habilitados, o conflicto de dominio. La respuesta genérica de challenge no distingue inexistente, revocado ni otra clase. 413: body excesivo. 429: rate limit con Retry-After.

OpenAPI define el challenge como string sensible y opaco, obligatorio y writeOnly en el request, sin ejemplos reales ni detalles de hash. La respuesta de emisión es la única que entrega el secreto. No existe representación visual en backend.

## Rate limiting y Wi-Fi compartido

| Configuración | Default | Dimensión |
| --- | --- | --- |
| RATE_ATTENDANCE_LIMIT / RATE_ATTENDANCE_WINDOW_MS | 20 / 60000 | Student.id autenticada, compartido entre sus sesiones y clases |
| RATE_QR_CHALLENGE_LIMIT / RATE_QR_CHALLENGE_WINDOW_MS | 20 / 60000 | Admin.id autenticado + ClassSession de la ruta |
| RATE_API_LIMIT / RATE_API_WINDOW_MS | 300 / 60000 | IP, defensa general secundaria previa a autenticar |

AttendanceRateGuard corre después de StudentGuard/AdminGuard y reutiliza express-rate-limit con MemoryStore. No usa secretos de cookies como clave, ni identidad del body o headers. Se evita el doble límite específico de Attendance por IP. Cambiar de sesión no reinicia el contador de la identidad. Se liberan los stores al cerrar el módulo.

El límite general por IP puede alcanzar a redes compartidas con tráfico elevado y debe dimensionarse con datos operativos. TRUST_PROXY continúa explícito y restringido a proxies conocidos. Para múltiples instancias será necesario un store compartido; hoy el supuesto es una instancia. Los locks y constraints ya funcionan entre procesos independientes de los contadores.

## Threat model

| Amenaza | Defensa y límite real |
| --- | --- |
| Captura de pantalla, foto por WhatsApp, screenshot histórica | TTL breve, rotación y ventana reducen su duración útil. No impiden el envío en tiempo real. |
| Relay de QR actual a Student remota | Sigue siendo posible si tiene sesión y elegibilidad válidas. No se afirma presencia física. |
| Replay y double submit | UNIQUE, locks e idempotencia Student/ClassSession; token compartido entre Students, no single-use global. |
| Challenge robado | No autentica por sí solo; exige sesión y todas las reglas. Expira y puede revocarse. |
| Sesión Student robada | Sesión robada junto con QR vigente puede funcionar; este mecanismo no agrega un factor de proximidad. |
| Challenge vencido/revocado | Rechazo también en replay, límites exclusivos y relectura temporal dentro de la transacción. |
| Challenge de otra ClassSession | Coincidencia exacta entre clase persistida y ruta; el token no elige autoridad. |
| Uso fuera de ventana o clase cancelada | Validación independiente del estado y ventana actuales, aunque expiry sea futuro. |
| Student ajena/inactiva o contrato inválido | StudentGuard y elegibilidad actual/histórica existentes, sin confiar en frontend. |
| Brute force/enumeration | 256 bits CSPRNG, formato acotado, hash único, respuesta genérica y rate limits secundarios. |
| Payload manipulado | DTOs estrictos, UUIDs y mapeo explícito; no recibe studentId/status/TTL/timestamps. |
| Requests simultáneos / dos Admin emitiendo | Lock ClassSession; ambas emisiones serializadas, máximo dos válidos. |
| Rotación contra PRESENT | Un predecesor sigue utilizable; rotaciones sucesivas pueden desplazarlo. |
| Cancelación contra PRESENT | Sólo una de las operaciones incompatibles puede ganar bajo los mismos locks. |
| Logs, errores, AuditLog, traces | No se registra secreto/hash en auditoría ni cuerpos de requests; errores sanitizados, sin stack/SQL. Proxies/APM externos requieren exclusión de payloads. |
| URLs, referers e historial | Token sólo en JSON y contenido QR opaco, nunca en la URL del contrato. No se crea un enlace con secreto. |
| Proxies, caching y transporte | no-store, HTTPS configurado en producción y trust proxy explícito. Una infraestructura externa mal configurada no queda protegida sólo por el código. |

Sin GPS, Bluetooth, NFC ni device attestation, no se puede demostrar que una Student está físicamente dentro de la sala. El producto no debe presentar este QR como antifraude perfecto.

## Migración y verificación

`20260910120000_attendance_challenge` agrega únicamente la tabla, secuencia, constraints e índices. No transforma Attendance existente. `test:migration:qr` ejecuta fresh y upgrade 4.1 → 5 con datos históricos y compara snapshots antes/después. Usa exclusivamente TEST_DATABASE_URL con base terminada en `_test`, schemas aleatorios y limpieza de sus propios recursos.

Las pruebas unitarias verifican formato, entropía, hash, status y límites con reloj fijo. Integration comprueba constraints reales, hash sin plaintext, rotación, cancelación, replay, Student ajena, actividad histórica, ventana y carreras. HTTP prueba roles, CSRF, payloads, límites por identidad, secretos ausentes, OpenAPI y vencimiento controlado. El flujo completo Admin → Student → Plan → Subscription → Schedule → Enrollment → ClassSession → activación → QR → PRESENT está en la suite Attendance previa adaptada al nuevo requisito. Resultados en [stage-5-validation.md](stage-5-validation.md).

## Recoveries y QR

Una autorización Recovery válida entra en expected para su ClassSession, sin Enrollment artificial. PRESENT reutiliza exactamente emisión, token, hash, TTL, rate limit, validación de replay y ventana. Sólo cambia la elegibilidad y la derivación de consumo: la autorización adicional no consume allowance otra vez. Una Recovery cancelada o contrato inválido no permite PRESENT aunque el challenge siga siendo válido para otras alumnas. No se agrega QR especial ni se guardan secretos en Recovery.

## Excepción administrativa explícita (Etapa 7)

Admin puede crear PRESENT manual sin challenge ante una falla del dispositivo, exclusivamente dentro de la ventana, con motivo y elegibilidad completa. Sólo una corrección Admin puede cambiar un resultado ya persistido. Esto no altera la validación ni los reintentos del endpoint Student.
