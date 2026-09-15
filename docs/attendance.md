# Attendance Engine y ausencias

## Responsabilidad y fuente de verdad

`Attendance` registra el resultado de una clase para una Student y conserva la `Subscription` exacta que explicó ese consumo. Los estados efectivos son PRESENT y ABSENT. Al crear una Attendance:

- `PRESENT`, creado por Student con source `STUDENT`, o por Admin manual con source `ADMIN`;
- `ABSENT`, creado por reconciliación y con source `SYSTEM`.

Ambos consumen una clase si recoveryId es nulo. Una Attendance ligada a Recovery no consume adicionalmente. No existe `usedClasses++` ni `remainingClasses--`: `usedClasses` es el conteo de Attendance de la Subscription con recoveryId nulo y `remainingClasses = max(0, classAllowance - usedClasses)`. Si datos externos producen más registros que allowance, la respuesta expone `integrityStatus=OVERCONSUMED` y `overconsumedClasses`; no oculta la anomalía con un saldo negativo.

El POST PRESENT Student exige challenge QR vigente para la ClassSession, además de todas las reglas de dominio. Una ClassSession CANCELLED no admite Attendance, no genera ausencia y no consume. El servicio tampoco permite cancelar una clase que ya tiene Attendance. Recoveries se integra desde Etapa 6 y las correcciones administrativas desde Etapa 7.

## Ventana y elegibilidad

La configuración central usa `ATTENDANCE_OPEN_BEFORE_MINUTES` y `ATTENDANCE_CLOSE_AFTER_MINUTES`, ambos 60 por defecto. La ventana es semiabierta:

`[startAt - openBefore, endAt + closeAfter)`

La apertura es inclusiva y el cierre exclusivo. `CLOCK` aporta el instante del backend; el cliente no envía timestamp ni timezone. El servicio comprueba la ventana al empezar y nuevamente, después de adquirir los locks necesarios, después de consultar consumo y antes de persistir. También revalida challenge y ventana al finalizar las consultas/escrituras; si vencen durante una espera, la transacción revierte.

La elegibilidad contractual de una clase se decide en `ClassSession.startAt`: la Student debe tener un `StudentActivePeriod` que contenga ese instante, un Enrollment válido en `occurrenceDate` o una Recovery adicional autorizada y una Subscription propia y operativa en `startAt`.

Para crear PRESENT también se exige que la Student esté activa ahora, además de ClassSession SCHEDULED, ventana abierta, ausencia de un ABSENT previo y allowance disponible para participación habitual; Recovery puede ejecutarse con cero restante. Una reactivación posterior no habilita marcar una clase durante cuya hora de inicio estaba inactiva. La Student no puede elegir identidad, contrato, estado, source ni totales.

## Idempotencia y concurrencia

`UNIQUE(studentId, classSessionId)` impide dos resultados para una alumna y clase. Un replay de un PRESENT con challenge vigente, ventana abierta y acceso/elegibilidad válidos devuelve el mismo registro con 200 y no duplica consumo ni AuditLog. Un token inválido, vencido, revocado o de otra clase se rechaza también en replays. El replay no exige allowance adicional. Si ya existe ABSENT, responde conflicto.

Las mutaciones bloquean la ClassSession. Después bloquean Students y Subscriptions en orden estable, vuelven a leer elegibilidad y cuentan consumo dentro de la transacción. Esto serializa:

- dos PRESENT de la misma clase;
- PRESENT contra el cierre de esa clase;
- dos reconciliadores;
- dos clases que compiten por el último allowance.

Las claves foráneas compuestas garantizan que Attendance no pueda apuntar a la Subscription de otra Student. Los CHECKs vinculan originalStatus con source: PRESENT/STUDENT, PRESENT/ADMIN o ABSENT/SYSTEM. El estado efectivo puede cambiar mediante Correction; el origen no cambia. Las relaciones históricas usan `ON DELETE RESTRICT`.

## Reconciliación y downtime

`attendanceClosedAt` identifica el cierre procesado y ClassSession `COMPLETED` exige ese timestamp por CHECK. Al iniciar el módulo se buscan hasta 100 ClassSessions SCHEDULED cuya ventana ya cerró. La misma operación se repite cada `ATTENDANCE_RECONCILE_INTERVAL_MINUTES`, cinco minutos por defecto.

Para cada candidata, una transacción vuelve a comprobar estado y ventana, deriva expected students según el estado histórico en `startAt`, conserva Attendance existentes, crea ABSENT para las faltantes habituales con allowance y para Recovery sin consumo adicional y finalmente marca la clase COMPLETED. Repetir el trabajo no duplica filas ni auditoría. Si el servidor estuvo apagado, el barrido de inicio procesa cierres vencidos sin depender de ejecutar a una hora exacta ni del estado actual de la alumna.

Si una faltante habitual agotó el allowance, no se crea un saldo negativo: la ClassSession permanece SCHEDULED, el resultado informa `unresolvedAllowance` y el siguiente ciclo vuelve a evaluarla. Requiere intervención sobre la anomalía contractual antes de poder cerrar.

Una desactivación posterior a la clase no evita su ABSENT; una desactivación anterior sí la excluye aunque luego haya reactivación. La reconciliación no cambia Attendance histórica ya registrada; una corrección Admin explícita sí puede cambiar su estado efectivo. El enum `NOT_REQUIRED_INACTIVE` y el total homónimo se conservan temporalmente en la respuesta Admin por compatibilidad, pero el motor histórico ya no usa ese estado y el total es cero.

## API

| Método | Ruta | Acceso | Uso |
| --- | --- | --- | --- |
| POST | `/api/v1/student/class-sessions/:classSessionId/attendance` | STUDENT | Registrar o repetir PRESENT propio |
| GET | `/api/v1/student/class-sessions/upcoming` | STUDENT | Ver próximas clases propias, ventana, estado y resumen |
| GET | `/api/v1/student/class-sessions/:classSessionId/attendance` | STUDENT | Ver estado propio de una clase |
| GET | `/api/v1/student/subscriptions/:subscriptionId/class-summary` | STUDENT propietaria | Ver consumo propio derivado |
| GET | `/api/v1/admin/class-sessions/:classSessionId/attendance` | ADMIN | Ver expected histórico, present, absent y pendientes |
| GET | `/api/v1/admin/subscriptions/:subscriptionId/class-summary` | ADMIN | Ver consumo derivado del contrato |

Admin también emite challenges con POST /api/v1/admin/class-sessions/:classSessionId/qr-challenge. El POST Student requiere `{ challenge }`, Origin/Referer permitido y tiene un rate limit específico por Student configurable. OpenAPI describe ventanas, estados, fuentes, resúmenes y errores.

## Auditoría

PRESENT crea `ATTENDANCE_PRESENT_RECORDED` con actor Student y referencias de ClassSession/Subscription. Cada cierre efectivo crea un único `CLASS_SESSION_ATTENDANCE_RECONCILED` con actor nulo y metadata agregada: ausencias creadas, alumnas históricamente elegibles, pendientes por allowance y estado de cierre. No se registra un Admin ficticio.

## Migración

`20260904220000_attendance_engine` elimina `EXCUSED`, agrega source, Subscription, `recordedAt` y `attendanceClosedAt`, refuerza CHECKs, índices y FKs RESTRICT. Attendance provisional no permite deducir qué Subscription consumió ni su origen; Recovery depende de ese significado. Por eso el upgrade aborta antes de modificar el schema si encuentra Attendance, Recovery o ClassSession ya COMPLETED y exige un mapeo manual trazable.

## Integración del challenge (Etapa 5)

La lógica normal de PRESENT sigue en AttendanceService; Student no puede omitir el QR; Etapa 7 agrega un caso Admin autenticado de alta manual durante la ventana. El secreto no identifica a la Student ni elige Subscription: sólo se compara mediante hash contra un challenge de la clase de la ruta. La emisión y rotación comparten el bloqueo de ClassSession con PRESENT, reconciliación y cancelación.

AttendanceChallengeService mantiene como máximo el actual y el predecesor no revocados, TTL original y expiración no posterior al cierre calculado al emitir. Si cambia la hora de ClassSession, PRESENT utiliza siempre la ventana actual. El motor ABSENT y el consumo derivado no necesitan challenges y conservan su comportamiento.

Ver [attendance-qr.md](attendance-qr.md) para lifecycle, amenazas, limpieza, rate limiting e idempotencia, y [stage-5-validation.md](stage-5-validation.md) para resultados reales.

## Resultado de Recovery

Attendance.recoveryId nullable distingue el consumo sin counters ni flags persistidos. PRESENT Student sigue exigiendo el mismo QR, Student activa y elegibilidad histórica. Admin puede suplir el QR mediante el alta manual auditada bajo las mismas condiciones de elegibilidad/ventana. El reconciliador genera Recovery ABSENT incluso con cero restante, pero no aumenta el consumo. CANCELLED de clase/contrato anterior al inicio excluye el destino. La ausencia original queda intacta. Expected, upcoming y vista Admin comparten origin/recoveryId. Ver [Recoveries](recoveries.md).

## Correcciones y asistencia manual

Etapa 7 mantiene originalStatus/source/recordedAt inmutables. Sólo Admin puede crear PRESENT manual durante la ventana o corregir un estado persistido con motivo. La corrección no cambia consumo ni depende de la ventana. Registro inexistente en clase cerrada es anomalía; no se inventa histórico. SYSTEM se registra explícitamente como actorType, con actorId null. [Reglas completas](admin-corrections.md).
