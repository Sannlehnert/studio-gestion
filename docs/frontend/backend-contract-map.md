# Mapa del producto y contratos reales — F0.0

Inspección iniciada el 15 y cerrada el 16 de septiembre de 2026. Base: backend funcional Etapa 7. Este documento separa contratos existentes de necesidades UX propuestas. No modifica la API.

Se leyeron PROJECT_CONTEXT, domain-model, backend-architecture, api-conventions, security, authentication, students, plans-subscriptions-payments, scheduling, attendance, attendance-qr, recoveries, admin-corrections, operational-audit y stage-7-validation. Todos están en la carpeta docs padre. Las restricciones históricas superadas por Etapa 7 se interpretan según el contrato y código actuales.

Se inspeccionó el OpenAPI 3.0.0 generado desde el módulo compilado actual: **69 operaciones y 83 schemas**. La inspección construyó la documentación sin inicializar/listen de la aplicación, conectar Prisma ni ejecutar reconciliación. También se contrastaron DTOs, servicios, políticas de Attendance/Recovery y configuración CORS en src. No se consultó ni modificó la base.

## Estado vigente después de Etapa 7.1

Validado el 23 de septiembre de 2026: 193 unit tests y 151 PostgreSQL/HTTP tests PASS. OpenAPI actual: **75 operaciones / 94 schemas**. Las cifras y limitaciones de la inspección F0 que siguen se conservan como antecedente; esta sección y el [contrato de integración](../frontend-integration-contract.md) describen el estado vigente.

| Brecha | Estado | Resolución y evidencia |
| --- | --- | --- |
| API-01 | RESOLVED | CORS permite Idempotency-Key explícito con credentials/allowlist. Preflight real permitido/rechazado y replay de pago verificados en integration-readiness.e2e-spec.ts. |
| API-02 | RESOLVED | Student Home descubre CURRENT/UPCOMING/NONE, contrato y consumo sin finanzas, aun con próximas vacías. Casos NONE/futuro/límites/cancelado verificados. Auth/me sin cambios. |
| API-03 | RESOLVED | Historial propio paginado desde Attendance persistida, filtros estrictos y ownership; contrato y correcciones de ida/vuelta probados por HTTP. |
| API-04 | RESOLVED | Resumen contractual Admin, próximas e historial por Student, sin recorrer rosters. Lectura por lote y visibilidad histórica tras inactividad verificadas. |
| API-05 | RESOLVED | Recovery options comparte reservas del dominio. Pruebas de ocupación por inactivas y carrera por última plaza: POST revalida y devuelve CLASS_SESSION_FULL. |
| API-06 | RESOLVED | Enteros, escalares nullable, dinero, fechas, enums y errores corregidos. Generación e inspección HTTP de docs-json PASS; contratos esenciales probados sin snapshots gigantes. |
| API-07 | RESOLVED | ApiError.code aditivo y catálogo explícito; infra/guards/CSRF/rate limiter cubiertos. Payment y PRESENT conservan replay válido. No parsear message. |
| API-08 | DEFERRED | No nuevos agregados financieros globales ni filtros globales de pagos/Recovery. El MVP acordado usa flujos contextuales; no bloquea F1 ni ese MVP. |
| API-09 | PARTIAL | corrected deriva existencia de Correction, incluso vuelta al estado original. Sigue diferido el nombre amigable universal del actor Audit; mostrar actorType/actorId autorizado. No bloquea el alcance acordado. |
| API-10 | PARTIAL | Home y today aportan readAt/businessDate/timeZone. QR conserva expiración/autoridad del servidor y no agrega serverTime; accesos no agregan listado ni recuperación de URLs. Countdown orientativo y emisión explícita siguen siendo el recorte de UX. |

Las seis nuevas lecturas y today=true se detallan en el contrato enlazado. No quedan bloqueantes de integración para F1 ni para el MVP recortado en F0. No se habilitan dashboards financieros o funcionalidades diferidas mediante cálculos cliente. Ver [gates y límites](../stage-7.1-validation.md).
## Endpoints existentes al cierre de F0 (referencia histórica)

Todas las rutas incluyen /api/v1. Admin y Student requieren su sesión correspondiente; las lecturas Student verifican pertenencia. Login/activación son entradas públicas; me requiere sesión; logout es idempotente. Health y check son técnicos, sin pantalla de producto.

### Admin (57)

| Método | Ruta | Propósito declarado |
| --- | --- | --- |
| GET | `/api/v1/admin/check` | Ruta de prueba protegida para administradores |
| POST | `/api/v1/admin/students/{studentId}/access` | Generar un acceso independiente para una alumna |
| POST | `/api/v1/admin/students/{studentId}/access/{accessId}/revoke` | Revocar un acceso pendiente; repetir la revocación es idempotente |
| POST | `/api/v1/admin/students` | Crear una alumna activa |
| GET | `/api/v1/admin/students` | Listar y buscar alumnas con paginación por página |
| GET | `/api/v1/admin/students/{id}` | Obtener una alumna por ID |
| PATCH | `/api/v1/admin/students/{id}` | Modificar el nombre de una alumna |
| POST | `/api/v1/admin/students/{id}/deactivate` | Desactivar una alumna y revocar sesiones y accesos pendientes |
| POST | `/api/v1/admin/students/{id}/reactivate` | Reactivar una alumna sin revivir credenciales anteriores |
| POST | `/api/v1/admin/plans` | Crear una oferta de plan activa |
| GET | `/api/v1/admin/plans` | Listar, filtrar y buscar planes |
| GET | `/api/v1/admin/plans/{id}` | Consultar el detalle de un plan |
| PATCH | `/api/v1/admin/plans/{id}` | Editar campos del catálogo sin reescribir suscripciones |
| POST | `/api/v1/admin/plans/{id}/activate` | Activar un plan de forma idempotente |
| POST | `/api/v1/admin/plans/{id}/deactivate` | Desactivar un plan de forma idempotente |
| POST | `/api/v1/admin/subscriptions` | Crear una suscripción con snapshot contractual |
| GET | `/api/v1/admin/subscriptions` | Listar suscripciones con estado operativo |
| GET | `/api/v1/admin/subscriptions/{id}/financial-summary` | Obtener el estado financiero derivado |
| GET | `/api/v1/admin/subscriptions/{id}` | Consultar contrato y resumen financiero |
| POST | `/api/v1/admin/subscriptions/{id}/cancel` | Cancelar una suscripción de forma idempotente |
| GET | `/api/v1/admin/students/{studentId}/subscriptions` | Listar suscripciones de una alumna |
| GET | `/api/v1/admin/payments` | Listar pagos preservando anulaciones |
| GET | `/api/v1/admin/payments/{id}` | Consultar el detalle de un pago |
| POST | `/api/v1/admin/payments/{id}/void` | Anular un pago de forma trazable e idempotente |
| POST | `/api/v1/admin/subscriptions/{subscriptionId}/payments` | Registrar dinero recibido para una suscripción |
| GET | `/api/v1/admin/subscriptions/{subscriptionId}/payments` | Listar pagos de una suscripción |
| POST | `/api/v1/admin/schedules` | Crear un horario recurrente activo |
| GET | `/api/v1/admin/schedules` | Listar horarios por estado y día ISO |
| GET | `/api/v1/admin/schedules/{id}` | Consultar un horario recurrente |
| PATCH | `/api/v1/admin/schedules/{id}` | Editar sólo futuras generaciones del horario |
| POST | `/api/v1/admin/schedules/{id}/activate` | Activar un horario de forma idempotente |
| POST | `/api/v1/admin/schedules/{id}/deactivate` | Desactivar un horario de forma idempotente |
| POST | `/api/v1/admin/enrollments` | Inscribir una alumna en un horario por vigencia |
| GET | `/api/v1/admin/enrollments/{id}` | Consultar una inscripción histórica |
| POST | `/api/v1/admin/enrollments/{id}/end` | Finalizar anticipadamente una inscripción |
| POST | `/api/v1/admin/enrollments/{id}/change-schedule` | Cambiar de horario preservando ambas vigencias |
| GET | `/api/v1/admin/students/{studentId}/enrollments` | Listar inscripciones de una alumna |
| GET | `/api/v1/admin/subscriptions/{subscriptionId}/enrollments` | Listar inscripciones de una suscripción |
| GET | `/api/v1/admin/schedules/{scheduleId}/enrollments` | Listar inscripciones de un horario |
| POST | `/api/v1/admin/class-sessions/generate` | Generar clases idempotentemente para fechas locales |
| GET | `/api/v1/admin/class-sessions` | Listar clases concretas |
| GET | `/api/v1/admin/class-sessions/{id}/expected-students` | Derivar las alumnas esperadas para Attendance |
| GET | `/api/v1/admin/class-sessions/{id}` | Consultar una clase concreta y su snapshot |
| PATCH | `/api/v1/admin/class-sessions/{id}/capacity` | Cambiar la capacidad efectiva de una clase |
| PATCH | `/api/v1/admin/class-sessions/{id}/time` | Aplicar una excepción horaria a una clase |
| POST | `/api/v1/admin/class-sessions/{id}/cancel` | Cancelar una clase con motivo e histórico |
| POST | `/api/v1/admin/class-sessions/{classSessionId}/students/{studentId}/attendance` | Registrar PRESENT manual durante la ventana; sin QR; no sobrescribe Attendance existente |
| POST | `/api/v1/admin/attendances/{attendanceId}/corrections` | Corregir PRESENT/ABSENT conservando origen y consumo; no-op sin nuevo historial |
| GET | `/api/v1/admin/attendances/{attendanceId}/corrections` | Historial inmutable de correcciones, ordenado por secuencia ascendente |
| POST | `/api/v1/admin/class-sessions/{classSessionId}/qr-challenge` | Emitir un challenge QR temporal para una clase abierta |
| GET | `/api/v1/admin/class-sessions/{classSessionId}/attendance` | Consultar expected, presentes, ausentes y pendientes |
| GET | `/api/v1/admin/subscriptions/{subscriptionId}/class-summary` | Consultar consumo derivado de una suscripción |
| POST | `/api/v1/admin/attendances/{attendanceId}/recovery` | Autorizar Recovery desde ABSENT; replay lógico devuelve la misma autorización |
| POST | `/api/v1/admin/recoveries/{id}/cancel` | Cancelar una autorización sin Attendance con motivo; idempotente |
| GET | `/api/v1/admin/recoveries` | Listar Recoveries por alumna, ausencia o cancelación manual |
| GET | `/api/v1/admin/recoveries/{id}` | Consultar autorización, resultado e indisponibilidad |
| GET | `/api/v1/admin/audit-logs` | Consultar auditoría operativa con metadata pública |

### Student (7)

| Método | Ruta | Propósito declarado |
| --- | --- | --- |
| GET | `/api/v1/student/check` | Ruta de prueba protegida para estudiantes |
| GET | `/api/v1/student/class-sessions/upcoming` | Consultar próximas clases propias y su ventana |
| POST | `/api/v1/student/class-sessions/{classSessionId}/attendance` | Registrar PRESENT propio con challenge QR vigente |
| GET | `/api/v1/student/class-sessions/{classSessionId}/attendance` | Consultar la asistencia propia de una clase |
| GET | `/api/v1/student/subscriptions/{subscriptionId}/class-summary` | Consultar clases usadas y restantes propias |
| GET | `/api/v1/student/recoveries` | Consultar únicamente Recoveries propias |
| GET | `/api/v1/student/recoveries/{id}` | Consultar una Recovery propia |

### Compartido (5)

| Método | Ruta | Propósito declarado |
| --- | --- | --- |
| GET | `/api/v1/health` | Health check |
| POST | `/api/v1/auth/admin/login` | Login de administrador |
| POST | `/api/v1/auth/student/activate` | Consumir un acceso y crear sesión de alumna |
| GET | `/api/v1/auth/me` | Obtener identidad desde la sesión |
| POST | `/api/v1/auth/logout` | Logout idempotente: revocar sesión y limpiar cookie |

## Entidades, relaciones y fuentes de verdad

| Entidad | Relación / significado de interfaz |
| --- | --- |
| Admin / Session | Admin opera; sesión cookie decide identidad y permisos. |
| Student / StudentActivePeriod | Alumna con actividad actual e histórica; desactivar hoy no borra resultados anteriores. |
| StudentAccess | Enlace de activación de un uso; emisión muestra URL una vez, revocación por referencia conocida. |
| Plan | Catálogo con clases y precio de referencia; no altera contratos existentes. |
| Subscription | Contrato de una alumna, período y valores acordados conservados; no es un pago. |
| Payment | Pago de un contrato; CONFIRMED suma y VOIDED permanece en historial. |
| Schedule | Recurrencia semanal y capacidad por defecto para nuevas clases. |
| Enrollment | Asigna contrato/alumna a recurrencia por intervalo civil; no equivale a Attendance. |
| ClassSession | Ocurrencia concreta con fecha, horario, estado y capacidad propia. |
| Attendance | Resultado único Student/ClassSession; originalStatus inmutable y status efectivo. Source conserva STUDENT/SYSTEM/ADMIN original. |
| AttendanceCorrection | Transición ordenada, motivo y Admin; puede haber varias, sin editar ni borrar historia. |
| AttendanceChallenge | QR opaco, temporal y estrictamente asociado a clase; sólo hash persistido. |
| Recovery | Autorización desde una ausencia habitual a un destino; resultado Attendance con recoveryId, consumo cero. |
| AuditLog | Evidencia operativa de actor/acción/entidad/fecha; no reemplaza historial estructurado ni estado del dominio. |

## Frecuencia y sensibilidad

| Frecuencia | Operaciones | Jerarquía |
| --- | --- | --- |
| Frecuente | Hoy, buscar alumna, cobrar, abrir roster/QR; Student próximas, restantes y escanear. | Acceso principal o contextual inmediato. |
| Ocasional | Planes, horarios, contratos, generar clases, asignar/cambiar inscripción, autorizar recuperación, emitir acceso. | Desde contexto o Gestión. |
| Excepcional | Corrección, VOID, cancelar clase/contrato/Recovery, desactivar alumna, revocar acceso, consultar auditoría. | Menú contextual, motivo/confirmación según contrato. |

No hay editor universal. Payment se anula y registra otro; contratos históricos no se reescriben; las clases tienen operaciones específicas. Cancelaciones y desactivaciones conservan datos. Revocar un acceso pendiente impide activarlo, pero no cierra sesiones establecidas; un enlace consumido no admite esa revocación. Desactivar Student revoca sus sesiones y accesos pendientes. No ofrecer Undo si no existe operación inversa. Reactivar alumna no revive enlaces/sesiones.

## Estados y límites reales

- Attendance: PRESENT/ABSENT. Roster: además PENDING, NOT_REQUIRED_INACTIVE y UNRESOLVED. Ventana: UPCOMING/OPEN/CLOSED/CANCELLED; no se infiere únicamente de ClassSession.status. Recovery es origen de participación, no un tercer resultado Attendance.
- Subscription: ACTIVE/EXPIRED/CANCELLED; separar de estado financiero y del hecho de que el período ya haya empezado. Dinero decimal como string, ARS. No calcular saldo con floats ni deducir elegibilidad del pago.
- ClassSession: SCHEDULED/COMPLETED/CANCELLED. Schedule y Plan activos/inactivos. Recovery deriva AUTHORIZED/COMPLETED/MISSED/CANCELLED/UNAVAILABLE y causa cuando aplica.
- Consumo: contar Attendance sin recoveryId, tanto PRESENT como ABSENT. Correction conserva consumo. Recovery, incluso manual, añade cero. remainingClasses está limitado a cero y OVERCONSUMED exige aviso, no ajuste cliente.
- Manual Admin: sólo PRESENT nuevo dentro de ventana, motivo 3–500, sin QR. Existente da 409. Correction existente no exige ventana ni actividad actual, con reglas de Recovery; mismo estado efectivo es no-op.
- QR: token de 256 bits, TTL predeterminado 60 s configurable 30–120; a lo sumo dos challenges no revocados según rotación; emitir tercero revoca el más antiguo. Cada expiry es original; cierre invalida uso. No hay serverTime en respuesta. Student necesita challenge válido incluso en reintentos.
- Sesiones absolutas predeterminadas: Admin 24 h, Student 30 días; configurables, sin refresh/sliding. Auth/me no devuelve suscripciones ni vencimiento. Activación usa fragmento, no query; errores de token vencido/usado/revocado/inactividad se unifican en 401.
- upcoming Student: máximo 20, sin cursor histórico. Incluye clases cuya ventana aún no cerró, no sólo inicios futuros. La respuesta trae classSummary por contrato conocido, no un catálogo de contratos propios.
- Generación de clases explícita por rango de fechas de hasta 366 días; no se ejecuta al consultar. Enrollment usa validFrom inclusivo y validUntil exclusivo. Mostrar último día incluido requiere conversión civil, no restar 24 horas a un instante.
- Errores: statusCode, timestamp, path, error y message; no business code estable. Expirado/revocado/cross-session QR comparte conflicto genérico. No prometer distinguir lo que el servidor deliberadamente agrupa.

## Brechas detectadas en F0 (referencia histórica)

P0 bloquea el flujo integrado indicado; P1 limita una tarea relevante; P2 admite un recorte fiel al contrato. No son modificaciones autorizadas del backend en F0.

| ID | Prioridad / evidencia concreta | Impacto UX | Resolución propuesta, todavía sin implementar |
| --- | --- | --- | --- |
| API-01 | P0 cross-origin: configure-app.ts permite sólo Content-Type en CORS; POST pago exige Idempotency-Key UUIDv4. | Preflight de pago entre orígenes distintos falla, aunque la cookie exista. | Elegir proxy del frontend bajo mismo origen o solicitar ajuste CORS y validar OPTIONS real. No quitar la clave. |
| API-02 | P0: auth/me sólo identidad; Student no lista contratos. class-summary requiere subscriptionId conocido. | Home no puede descubrir siempre contrato/restantes cuando upcoming está vacío. | Lectura propia de contrato/resumen actual; hasta entonces sólo resumen de contrato identificado y “No pudimos determinar tu período actual”. Nunca cero supuesto. |
| API-03 | P0: no listado Student de Attendance histórica; upcoming limitado y detalle por ID. | Historial completo requerido no se puede construir. | Lectura propia paginada por fecha/período. Diseñar pantalla, condicionar implementación integrada; no usar caché como historia. |
| API-04 | P1: no Attendance por Student Admin ni filtro Student en clases; roster enumera expected, no todo resultado persistido. | Hub no garantiza próximas/historial de asistencia completo con composición actual. | Lecturas contextuales paginadas; conservar contratos, pagos, inscripciones y Recoveries reales mientras tanto. No recorrer todos los rosters. |
| API-05 | P1: expected-students y capacidad disponibles, pero reserva incluye casos de inactividad que expected excluye. No endpoint de candidatos elegibles/ocupación real. | Capacidad menos expected no es cupo libre; no se puede prometer todos los destinos válidos de Recovery. | Lectura de destinos/elegibilidad/cupo compartiendo criterio backend. Alternativa limitada: candidatos por fecha/período, “Cupo a confirmar”, POST decide. No llamarla disponibilidad verificada. |
| API-06 | P1: OpenAPI describe algunos page/limit mediante Object; ciertos nullable de strings/fechas como object. | Cliente generado puede tipar mal payloads y respuestas. | Revisar contrato OpenAPI antes de generación automática; contrastar DTO/runtime y documentar adaptaciones explícitas si se aprueban. |
| API-07 | P2: no código de negocio estable; error.message no es enum. | No distinguir automáticamente todos los 409 ni token usado/vencido. | HTTP + contexto + relectura segura cuando alcanza; fallback genérico. Códigos estables serían mejora futura, sin dividir errores de auth por seguridad. |
| API-08 | P2: pagos globales filtran estado; no alumna/fecha. No agregados financieros globales ni filtro próximo destino en Recovery. | Dashboard de deuda/recuperaciones globales requeriría barrido/N+1. | Omitir bloques; pago desde alumna y Recovery del roster/detalle. No totales de una página. |
| API-09 | P2: Audit entrega actorType/actorId sin nombre amigable; Attendance no tiene hasCorrections/correctionCount. | No identificar siempre persona ni detectar correcciones que vuelven a originalStatus. | Mostrar rol y nombre sólo si se resuelve con dato autorizado. Student sin badge de corrección por ahora; historial Admin usa GET corrections. |
| API-10 | P2: accesos sin listado, QR sin serverTime, sin configuración pública de zona horaria. | No recuperar URLs anteriores ni asegurar countdown desde reloj local o zona del negocio. | URL efímera al emitir; nueva emisión explícita si se pierde. Configuración pública IANA alineada con backend; countdown orientativo y servidor como autoridad. |

La definición de producto está preparada para Foundation + Design System. El MVP conectado completo queda condicionado por estas lecturas y por resolver la topología CORS; no confundir readiness de diseño con disponibilidad de todos los contratos API.
