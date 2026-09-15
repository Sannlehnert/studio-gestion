# Recoveries — Etapa 6

## Regla y fuentes de verdad

Recovery autoriza una clase adicional real para compensar una Attendance normal ABSENT de la misma Student y Subscription. No crea Enrollment ni cambia la ausencia original. Admin autoriza y cancela; Student consulta sus propias autorizaciones y utiliza el POST PRESENT y el QR existentes.

La autorización reside en Recovery. La pertenencia habitual reside en Enrollment. El período y allowance residen en Subscription, el horario y cupo efectivo en ClassSession, la actividad histórica en StudentActivePeriod y el resultado en Attendance. `Attendance.recoveryId` identifica de forma estructural el resultado de una recuperación. `consumesAllowance` sólo es una proyección de respuesta, nunca un campo editable o persistido.

| Attendance | Consumo | Resultado de Recovery |
| --- | --- | --- |
| Normal PRESENT | 1 | No aplica |
| Normal ABSENT | 1 | Puede originar una autorización |
| Recovery PRESENT | 0 | COMPLETED |
| Recovery ABSENT | 0 | MISSED, sin cadenas |

`usedClasses = count(Attendance where subscriptionId = contrato AND recoveryId IS NULL)`; `remainingClasses = max(0, classAllowance - usedClasses)`. Una Recovery válida funciona incluso con cero restantes. Ejemplo Plan 8: ABSENT original deja 1 usada/7 restantes; PRESENT o ABSENT en destino conserva 1/7. Con allowance 1, conserva 1/0.

## Autorización y repetición

El único input del body es `targetClassSessionId`; la ausencia proviene del UUID de la ruta. Student y Subscription se derivan de esa ausencia y Admin del guard. Se rechazan ausencia inexistente, PRESENT, ausencia de otra Recovery, misma clase, origen cancelado, destino no programado, ya iniciado o anterior al origen, Student inactiva, contrato no ACTIVE o destino fuera de `[periodStart, periodEnd)`, asistencia previa en destino y falta de cupo.

Si la Student ya sería expected por Enrollment normal en el destino, responde 409. Un Enrollment nuevo o un cambio de Schedule tampoco puede cubrir una Recovery vigente: primero se cancela explícitamente la autorización. No hay prioridad gratuita sobre clases habituales. La deduplicación defensiva de expected conserva la participación normal si una escritura externa creó coexistencia inválida.

Máximo una autorización no cancelada por ausencia y una por Student/destino. Misma ausencia y destino devuelve 200 y el mismo registro, sin otra auditoría, incluso si ya tiene resultado o indisponibilidad derivada. Otro destino devuelve 409. Para reasignar, Admin cancela la anterior y autoriza otra; los registros anteriores permanecen. No se restaura la autorización al repetir un POST cancelado.

## Estado y cancelación

No se persiste un enum operativo ni contadores. `state` se deriva: cancelación manual → CANCELLED; Attendance PRESENT → COMPLETED; ABSENT → MISSED; destino/contrato/actividad histórica inválidos → UNAVAILABLE; sin resultado ni impedimento → AUTHORIZED. AUTHORIZED significa autorización sin resultado, incluso si el reconciliador todavía debe procesar un cierre vencido.

Cancelación manual exige Admin y motivo de 3–500 caracteres; guarda autor, fecha y motivo. Sólo antes del inicio y sin Attendance. Si la clase o el contrato ya hicieron imposible la recuperación, se permite liberarla explícitamente aunque haya pasado el inicio, siempre sin Attendance. Esto permite una nueva decisión administrativa y conserva la causa previa. Repetir cancelación devuelve el primer motivo/fecha sin otro AuditLog. Una Recovery con resultado no se cancela ni habilita cadenas automáticas.

Una ClassSession CANCELLED deriva `unavailableReason=CLASS_CANCELLED`, conserva su propia cancelación y no fabrica autor o evento de cancelación de Recovery. Una Subscription cancelada en o antes de `startAt` deriva SUBSCRIPTION_INELIGIBLE. Ambas impiden PRESENT y ABSENT de Recovery sin borrar autorización ni consumo original. Los timestamps y motivo de la clase, y `subscriptionCancelledAt`, permiten explicar la indisponibilidad. Una cancelación contractual posterior al inicio conserva elegibilidad histórica, igual que Attendance normal.

Actividad histórica se evalúa en `ClassSession.startAt`. Desactivar antes excluye el destino y evita ABSENT; desactivar después no borra la obligación histórica. PRESENT exige además actividad actual. Reactivar no revive credenciales ni habilita clases iniciadas durante un intervalo inactivo.

## Cupo, horario y expected

ClassParticipationService concentra la derivación compartida por ClassSessions, Attendance, Recoveries y Enrollment. Expected es la unión por Student de Enrollment normal y Recovery no cancelada, con contrato y actividad históricos válidos. Las respuestas incluyen `origin`, `enrollmentId` nullable y `recoveryId` nullable. Upcoming incorpora Recovery sin Enrollment y mantiene pertenencia propia, orden estable, límites y SQL parametrizado.

Para reservar capacidad se conserva la política contractual prudente de scheduling: la inactividad de Student no libera automáticamente una reserva normal ni una Recovery autorizada. Así una reactivación no puede producir sobrecupo sin pasar por una operación de cupos. La cancelación manual, clase cancelada o contrato inválido para ese inicio sí eliminan la reserva aplicable. Se cuentan Student únicas; nunca se cuentan dos veces. No se introduce una tabla de reservas.

Autorizar Recovery, crear/mover Enrollment y reducir capacidad de una ClassSession usan el mismo cupo efectivo bajo Schedule. `Schedule.defaultCapacity` sigue rigiendo nuevas generaciones y los intervalos habituales; Recovery no modifica esa recurrencia. Las clases ya generadas tienen su capacidad propia. La cancelación manual libera su lugar. Dos solicitudes por la última plaza no pueden superar capacidad.

Cambiar hora conserva ClassSession y Recovery. No se copian horarios en la autorización; ventana y QR usan startAt/endAt actuales. El cambio debe conservar fecha local, período y cupo, y no puede convertir la Recovery en una clase habitual ni moverla antes de su autorización. Un contrato invalidado exige resolver/cancelar su autorización antes de un cambio horario que la mantenga inconsistente.

## Transacciones y análisis de locks

Antes de Etapa 6, Enrollment tomaba Student → Subscription → Schedule(s) → Enrollment. ClassSession tomaba Schedule → ClassSession, Attendance ClassSession → Student(s) → Subscription(s), y emisión QR sólo ClassSession. Una Recovery necesita sincronizar el cupo con Schedule y el resultado con ClassSession. Agregar luego Student produce un ciclo alcanzable con el orden anterior de Enrollment: Recovery retiene Schedule/ClassSession y espera Student; Enrollment retiene Student y espera Schedule.

Se cambió únicamente la adquisición de contexto de Enrollment. Orden canónico de las operaciones que compiten: **Schedule(s) ordenados → ClassSession → Student(s) ordenados → Subscription(s) ordenados → fila de Enrollment/Recovery/Attendance**. Una operación puede omitir niveles, pero no adquirir un nivel anterior después de uno posterior.

| Operación | Locks relevantes en orden | Revalidación / integridad |
| --- | --- | --- |
| Enrollment alta, finalización y cambio | Schedule(s) ordenados → Student → Subscription → Enrollment si existe | Vigencia, cupo efectivo, Recovery y exclusión GiST |
| ClassSession capacidad, hora y cancelación | Schedule → ClassSession | Unión de reservas, estado, Attendance y QR |
| Recovery autorización/cancelación | Schedule destino → ClassSession destino → Student → Subscription | Ausencia, contrato, expected, cupo, duplicados y resultado |
| PRESENT | ClassSession → Student → Subscription | Expected tras locks, QR, reloj y allowance sólo normal |
| Reconciliación | ClassSession → Students ordenados → Subscriptions ordenadas | Expected histórico releído, consumo normal y unicidad |
| Generación | Schedules ordenados FOR SHARE → inserciones ClassSession | Snapshots compatibles y UNIQUE de fecha/recurrencia |
| Schedule edición/estado | Schedule | Compatibilidad de Enrollment futuro; snapshots existentes conservados |
| Subscription cancelación / Payment | Subscription | No adquieren Schedule o Student después |
| Student actividad | Student → períodos/credenciales | No adquiere Schedule, ClassSession o Subscription |
| QR emisión | ClassSession | Nunca adquiere Schedule |

No se cambió el orden de Attendance ni se agregó un lock global. Las transacciones de autorización y cancelación incluyen AuditLog. Capacidad es un invariante entre tablas protegido por este protocolo de locks PostgreSQL, no por un CHECK que cuente otras tablas ni por rate limiting. Escrituras SQL externas deben respetar el mismo protocolo.

Las pruebas coordinan bloqueos reales y observan `pg_blocking_pids`: una transacción retiene ClassSession, Recovery adquiere Schedule y espera, Enrollment compite por Schedule con la misma Student; al liberar, Recovery termina y Enrollment responde 409, sin el ciclo anterior. Otra prueba retiene Student mientras PRESENT espera, avanza CLOCK al cierre y ejecuta reconciliación: PRESENT revierte y queda un solo ABSENT no consumidor.

## Persistencia

Migration `20260912180000_recoveries` reemplaza el modelo provisional sólo si está vacío. El guard anterior al DDL aborta si encuentra autorizaciones sin correspondencia histórica confiable. No inventa Admins ni resultados. Agrega `Attendance.recoveryId` nullable y preserva los registros existentes como asistencia normal.

Recovery conserva Student, Subscription, origen, destino, Admin autorizante y timestamp; la cancelación agrega tres campos coherentes por CHECK. Sus seis FKs usan RESTRICT. FKs compuestas ligan origen a Student/Subscription y resultado a Recovery/Student/Subscription/ClassSession; `UNIQUE(recoveryId)` permite un resultado máximo. Prisma necesita además la clave única compuesta de la relación uno a uno. No se usa cascada DELETE.

Dos índices únicos parciales (`cancelledAt IS NULL`) protegen ausencia y Student/destino. Índices de consultas cubren Student/fecha/id, ausencia/fecha y destino. Triggers impiden eliminar Recovery, alterar la identidad autorizada/cancelación, usar un origen no ABSENT normal, convertir el origen a PRESENT mientras tenga Recovery no cancelada, modificar la identidad de consumo de Attendance y registrar resultados en una Recovery cancelada. El resultado tiene FK RESTRICT hacia su autorización y el origen hacia Attendance, por lo que tampoco puede borrarse la ausencia original referenciada.

## API y seguridad

Todas las rutas usan `/api/v1`. Errores y no-store son globales. Mutaciones exigen Origin/Referer permitido y DTO estricto. No hay DELETE ni endpoint alternativo para marcar recuperaciones.

| Método | Ruta | Rol | Respuesta |
| --- | --- | --- | --- |
| POST | `/admin/attendances/:attendanceId/recovery` | ADMIN | 200, Recovery creada o replay lógico |
| POST | `/admin/recoveries/:id/cancel` | ADMIN | 200, cancelación idempotente |
| GET | `/admin/recoveries` | ADMIN | Lista paginada |
| GET | `/admin/recoveries/:id` | ADMIN | Detalle trazable |
| GET | `/student/recoveries` | STUDENT | Sólo propias |
| GET | `/student/recoveries/:id` | STUDENT | Propia, ajena devuelve 404 |

Listas: page 1–100000, limit 1–100; orden authorizedAt/id descendente, snapshot RepeatableRead para página/total. `cancellation=all|not_cancelled|cancelled` filtra cancelación administrativa; el estado operativo se deriva en la respuesta. Admin agrega studentId/originalAttendanceId UUID. Student no puede enviar filtros de identidad, y su guard fija la propiedad dentro de la consulta. No se exponen Admin internos, hashes, sesiones o tokens.

PRESENT mantiene token opaco de 256 bits, hash persistido, TTL, asociación exacta y rechazo de challenge vencido/revocado/cruzado incluso en replay. Múltiples Student elegibles comparten el challenge; no existe QR especial. Límites por Student y por Admin/ClassSession para emisión QR, con IP secundaria, permanecen. Recuperaciones administrativas heredan el límite general existente; integridad depende de locks/constraints.

AuditLog sólo registra RECOVERY_AUTHORIZED y RECOVERY_CANCELLED en cambios efectivos, con actor real y referencias/motivo, sin secretos. Resultados usan los eventos existentes de Attendance/reconciliación. La respuesta no refleja SQL, stacks ni payloads maliciosos.

## Validación y límites

Ver [evidencia de Etapa 6](stage-6-validation.md). Unit cubre consumo, origen, período y estados; PostgreSQL cubre reglas, FKs, unicidad, histórico y carreras; HTTP cubre flujos completos, propiedad, CSRF, DTOs y OpenAPI. La migración prueba fresh, upgrade 5→6 con snapshot, y guard sobre datos provisionales. Los runners sólo tocan schemas aleatorios en la base `_test`.

Límites existentes: una instancia con contadores de rate limit en memoria; backups, TLS y observabilidad de producción no están provisionados; Vite avisa sobre configuración CommonJS. No se agregó reasignación automática. Etapa 7 agrega correcciones administrativas con las reglas siguientes.

## Correcciones (Etapa 7)

Origen sin Recovery no cancelada: ABSENT→PRESENT permitido. Pendiente: cancelar primero explícitamente. Con resultado: bloquear origen incluso si el resultado es ABSENT. Las canceladas se conservan y no bloquean. El resultado Recovery admite PRESENT↔ABSENT; estado operativo derivado y consumo cero. Admin manual usa el mismo destino/elegibilidad/ventana, source ADMIN y recoveryId real, sin QR ni doble consumo. Autorizar relee el origen después del lock Student para controlar la carrera con Correction. [Detalles](admin-corrections.md).
