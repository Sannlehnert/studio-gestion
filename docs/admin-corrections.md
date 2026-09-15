# Admin Corrections y asistencia manual — Etapa 7

## Modelo y fuentes de verdad

Attendance conserva Student/Subscription/ClassSession/recoveryId, `originalStatus`, `source` y `recordedAt` originales e inmutables. `status` es la proyección efectiva actual del historial estructurado AttendanceCorrection. La migración inicializa originalStatus con status existente, sin reconstruirlo desde AuditLog.

AttendanceCorrection registra attendanceId, sequence, previousStatus, targetStatus, reason, correctedByAdminId y correctedAt. Permite múltiples correcciones PRESENT ↔ ABSENT, ordenadas por secuencia ascendente. La secuencia se asigna dentro de la transacción y después de bloquear Attendance; UNIQUE(attendanceId, sequence) protege su orden. No se permite editar ni borrar correcciones.

El caso de uso cambia el estado efectivo, inserta Correction y registra AuditLog en UNA transacción. No se agrega un trigger para reconstruir la proyección: el servicio coordina esa coherencia. Los guards PostgreSQL protegen identidad, origen inmutable e interacción con Recovery independientemente del DTO.

## Análisis de operaciones

| Aspecto | Corrección existente | PRESENT manual |
|---|---|---|
| Regla | Corregir un resultado persistido erróneo | Registrar presencia cuando falla el dispositivo/QR |
| Permiso | Admin autenticado | Admin autenticado |
| Fuente de verdad | Attendance bloqueada y dependencias Recovery | Expected histórico, contrato, ventana y allowance |
| Input externo | attendanceId, targetStatus y reason | classSessionId, studentId y reason |
| Input manipulable | El backend rechaza identidad, fuente, fecha y consumo en body | Rechaza status, source, subscriptionId, recoveryId, recordedAt y consumption |
| Validaciones | Estado PRESENT/ABSENT, motivo trim 3–500, clase no cancelada | Actividad actual/histórica, contrato aplicable, ventana abierta y registro inexistente |
| PostgreSQL | FK RESTRICT, CHECKs, origen/historial inmutable, secuencia única | UNIQUE Student/ClassSession, FK compuestas y CHECK de atribución ADMIN |
| Transacción | Attendance + Correction + AuditLog | Attendance + AuditLog y revalidación de ventana |
| Concurrencia | ClassSession → Student → Subscription → Attendance | ClassSession → Student → Subscription |
| Repetición | Mismo estado: 200, correction null, sin historial ni audit nuevos | Existente: 409; utilizar Correction |
| Idempotencia | No-op contra el estado efectivo vigente; no hay Idempotency-Key | No sobrescribe ni duplica; alta repetida devuelve conflicto |
| Auditoría | Admin real, motivo, transición y referencia a Correction | Admin real, motivo y referencias de Student/clase/contrato |
| Filtraciones | Historial y auditoría sólo Admin; no secretos | La vista compartida Attendance no expone el motivo ni el Admin creador |
| Tests | DB, consumo, dependencias, rollback, carreras y HTTP | Ventana, elegibilidad, allowance, Recovery, atribución, carreras y HTTP |

## Operación normal e histórica

La corrección no requiere QR ni Attendance Window. Puede corregir un resultado existente después del cierre y no reescribe el contrato ni exige que la alumna siga activa hoy. ClassSession CANCELLED con Attendance existente es una anomalía: 409 y evidencia preservada.

El alta manual sólo crea PRESENT dentro de la ventana normal, sin QR, con motivo obligatorio. Resuelve Enrollment habitual o Recovery mediante el mismo endpoint. Persiste createdByAdminId, creationReason y recordedAt; las correcciones no modifican esa atribución. El backend determina estado, relaciones y consumo.

No se implementa creación arbitraria de Attendance histórica. Si la clase cerró y existe ABSENT, usar Correction. Si cerró y falta Attendance, el alta manual informa conflicto de integridad. La vista Admin mantiene UNRESOLVED para expected sin resultado después de la ventana; no reconstruye histórico desde la pertenencia actual.

STUDENT significa PRESENT creado por la alumna; SYSTEM significa ABSENT creado por reconciliación; ADMIN significa PRESENT manual. Una corrección ABSENT/SYSTEM → PRESENT conserva source SYSTEM y originalStatus ABSENT. Student sigue necesitando challenge vigente incluso en reintentos; no puede invocar operaciones Admin.

## Recovery y consumo

| Situación de una ausencia original | Corrección a PRESENT |
|---|---|
| Sin Recovery no cancelada | Permitida |
| Recovery pendiente/no cancelada | 409; cancelar explícitamente primero |
| Recovery con resultado PRESENT o ABSENT | 409; no se puede ocultar ni cancelar su resultado |
| Sólo Recoveries canceladas | Permitida; todo el histórico permanece |

Attendance resultado de Recovery puede corregirse en ambos sentidos. COMPLETED/MISSED se deriva del resultado efectivo; no hay cancelación automática como efecto secundario.

Consumo: COUNT(Attendance WHERE subscriptionId = contrato AND recoveryId IS NULL). Normal PRESENT ↔ ABSENT mantiene 1; Recovery PRESENT ↔ ABSENT mantiene 0. El alta manual normal consume 1; Recovery manual puede registrarse con cero restante y no añade consumo. No hay contador, override, delta ni ajuste administrativo de clases.

## Locks

Recovery conserva Schedule destino → ClassSession destino → Student → Subscription. Registro/reconciliación conservan ClassSession → Student → Subscription. Correction agrega lock Attendance al final y no bloquea el destino de una Recovery desde su origen. Student serializa la corrección del origen con autorización/cancelación; autorizar relee el origen después de esperar ese lock.

Las pruebas cubren dos correcciones, Admin/Student PRESENT, Admin/reconciliador atravesando el cierre, Correction/reconciliador, Correction/autorización y Correction/cancelación. Las pruebas con barreras observan bloqueos reales PostgreSQL. El rate limiting no sostiene integridad.

## Límites deliberados

Payment incorrecto: VOID → nuevo Payment; no editar importe histórico. Subscription conserva su snapshot contractual. ClassSession usa sus operaciones específicas de capacidad, horario y cancelación. No existe editor universal ni creación histórica arbitraria.

## Migración

`20260915180000_admin_corrections` preserva filas y agrega campos, tabla e índices. La guardia de atribución histórica aborta antes de DDL cuando no hay evidencia determinista. El enum ADMIN se confirma antes de usarlo en constraints, como exige PostgreSQL. Si ocurre un fallo posterior puede quedar ese valor agregado; revisar el error y el registro de migraciones antes de resolver/reintentar, sin resetear datos existentes.

Validación sólo en schemas efímeros de *_test. La base de desarrollo no se migra. Resultados: [stage-7-validation.md](stage-7-validation.md).
