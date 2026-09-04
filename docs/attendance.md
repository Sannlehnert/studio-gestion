# Attendance Engine y ausencias

## Responsabilidad y fuente de verdad

`Attendance` registra una clase consumida por una Student y conserva la `Subscription` exacta que explicó ese consumo. Sólo existen dos estados con regla vigente:

- `PRESENT`, creado por la Student y con source `STUDENT`;
- `ABSENT`, creado por reconciliación y con source `SYSTEM`.

Ambos consumen una clase. No existe `usedClasses++` ni `remainingClasses--`: `usedClasses` es el conteo de Attendance de la Subscription y `remainingClasses = max(0, classAllowance - usedClasses)`. Si datos externos producen más registros que allowance, la respuesta expone `integrityStatus=OVERCONSUMED` y `overconsumedClasses`; no oculta la anomalía con un saldo negativo.

Una ClassSession CANCELLED no admite Attendance, no genera ausencia y no consume. El servicio tampoco permite cancelar una clase que ya tiene Attendance. Recovery y correcciones administrativas no forman parte de esta etapa.

## Ventana y elegibilidad

La configuración central usa `ATTENDANCE_OPEN_BEFORE_MINUTES` y `ATTENDANCE_CLOSE_AFTER_MINUTES`, ambos 60 por defecto. La ventana es semiabierta:

`[startAt - openBefore, endAt + closeAfter)`

La apertura es inclusiva y el cierre exclusivo. `CLOCK` aporta el instante del backend; el cliente no envía timestamp ni timezone. El servicio comprueba la ventana al empezar y nuevamente, después de adquirir los locks necesarios, justo antes de persistir.

Para crear PRESENT deben coincidir sesión Student vigente, Student activa, ClassSession SCHEDULED, Enrollment válido en `occurrenceDate`, Subscription propia y operativa en `startAt`, ventana abierta, ausencia de un ABSENT previo y allowance disponible. La Student no puede elegir identidad, contrato, estado, source ni totales.

## Idempotencia y concurrencia

`UNIQUE(studentId, classSessionId)` impide dos resultados para una alumna y clase. Un replay de un PRESENT devuelve el mismo registro con 200 y no duplica consumo ni AuditLog. Si ya existe ABSENT, responde conflicto.

Las mutaciones bloquean la ClassSession. Después bloquean Students y Subscriptions en orden estable, vuelven a leer elegibilidad y cuentan consumo dentro de la transacción. Esto serializa:

- dos PRESENT de la misma clase;
- PRESENT contra el cierre de esa clase;
- dos reconciliadores;
- dos clases que compiten por el último allowance.

Las claves foráneas compuestas garantizan que Attendance no pueda apuntar a la Subscription de otra Student. Los CHECKs sólo permiten las combinaciones PRESENT/STUDENT y ABSENT/SYSTEM. Las relaciones históricas usan `ON DELETE RESTRICT`.

## Reconciliación y downtime

`attendanceClosedAt` identifica el cierre procesado y ClassSession `COMPLETED` exige ese timestamp por CHECK. Al iniciar el módulo se buscan hasta 100 ClassSessions SCHEDULED cuya ventana ya cerró. La misma operación se repite cada `ATTENDANCE_RECONCILE_INTERVAL_MINUTES`, cinco minutos por defecto.

Para cada candidata, una transacción vuelve a comprobar estado y ventana, deriva expected students para la fecha, conserva Attendance existentes, crea ABSENT para activas faltantes con allowance y finalmente marca la clase COMPLETED. Repetir el trabajo no duplica filas ni auditoría. Si el servidor estuvo apagado, el barrido de inicio procesa cierres vencidos sin depender de ejecutar a una hora exacta.

Si una faltante agotó el allowance, no se crea un saldo negativo: la ClassSession permanece SCHEDULED, el resultado informa `unresolvedAllowance` y el siguiente ciclo vuelve a evaluarla. Requiere intervención sobre la anomalía contractual antes de poder cerrar.

Una Student actualmente inactiva se omite en reconciliación futura y aparece como `NOT_REQUIRED_INACTIVE` para Admin. Attendance histórica ya registrada no se cambia. El modelo actual no guarda cuándo estuvo activa; si en el futuro se necesita reconstruir su estado exacto durante un downtime, hará falta historia temporal de activación.

## API

| Método | Ruta | Acceso | Uso |
| --- | --- | --- | --- |
| POST | `/api/v1/student/class-sessions/:classSessionId/attendance` | STUDENT | Registrar o repetir PRESENT propio |
| GET | `/api/v1/student/class-sessions/upcoming` | STUDENT | Ver próximas clases propias, ventana, estado y resumen |
| GET | `/api/v1/student/class-sessions/:classSessionId/attendance` | STUDENT | Ver estado propio de una clase |
| GET | `/api/v1/student/subscriptions/:subscriptionId/class-summary` | STUDENT propietaria | Ver consumo propio derivado |
| GET | `/api/v1/admin/class-sessions/:classSessionId/attendance` | ADMIN | Ver expected, present, absent, pending e inactivas |
| GET | `/api/v1/admin/subscriptions/:subscriptionId/class-summary` | ADMIN | Ver consumo derivado del contrato |

Admin sólo dispone de lectura en esta etapa. El POST Student requiere body vacío, Origin/Referer permitido y tiene un rate limit específico configurable. OpenAPI describe ventanas, estados, fuentes, resúmenes y errores.

## Auditoría

PRESENT crea `ATTENDANCE_PRESENT_RECORDED` con actor Student y referencias de ClassSession/Subscription. Cada cierre efectivo crea un único `CLASS_SESSION_ATTENDANCE_RECONCILED` con actor nulo y metadata agregada: ausencias creadas, inactivas omitidas, pendientes por allowance y estado de cierre. No se registra un Admin ficticio.

## Migración

`20260904220000_attendance_engine` elimina `EXCUSED`, agrega source, Subscription, `recordedAt` y `attendanceClosedAt`, refuerza CHECKs, índices y FKs RESTRICT. Attendance provisional no permite deducir qué Subscription consumió ni su origen; Recovery depende de ese significado. Por eso el upgrade aborta antes de modificar el schema si encuentra Attendance, Recovery o ClassSession ya COMPLETED y exige un mapeo manual trazable.
