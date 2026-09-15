# Modelo de dominio

Fuente: apps/backend/prisma/schema.prisma y sus diez migraciones. Tener una tabla de etapas futuras no significa tener su módulo de negocio.

## Modelos actuales

| Modelo        | Responsabilidad y relaciones                                                                              | Estado del comportamiento                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Admin         | Identidad administrativa; email único y passwordHash.                                                     | IMPLEMENTED: seed explícito, login y guard.                                                       |
| Student       | Identidad de alumna con estado activo y relaciones históricas.                                            | IMPLEMENTED: CRUD administrativo sin borrado, búsqueda, paginación, desactivación y reactivación. |
| StudentActivePeriod | Intervalos semiabiertos de actividad de una Student.                                                 | IMPLEMENTED: ciclos múltiples, límites exactos, no solapamiento y proyección actual coherente.     |
| StudentAccess | Pertenece a Student. tokenHash único, estado, expiración, activación y revocación.                        | IMPLEMENTED: emitir, consumir una vez y revocar un pendiente.                                     |
| Plan          | Oferta reusable con nombre, descripción, classCount, precio actual, ARS e isActive.                       | IMPLEMENTED: crear, listar, editar y activar/desactivar sin DELETE.                               |
| Subscription  | Contrato con Student/Plan, snapshot, precio acordado, período y estado operativo.                         | IMPLEMENTED: alta, consulta, cancelación, solapamiento prohibido y finanzas derivadas.             |
| Payment       | Dinero recibido, autor, importe Decimal, fecha, método, estado e idempotencia.                             | IMPLEMENTED: múltiples pagos parciales, consulta y anulación sin borrado.                         |
| Schedule      | Recurrencia semanal local, capacidad habitual e isActive; origina ClassSession.                            | IMPLEMENTED: CRUD sin borrado, estado, filtros y snapshot futuro.                                 |
| ClassSession  | Clase concreta con fecha de recurrencia, instantes UTC, capacidad, cancelación y cierre de asistencia.     | IMPLEMENTED: generación, consulta, excepciones, cancelación y reconciliación idempotente.           |
| Enrollment    | Vincula Student, Subscription y Schedule durante un intervalo local semiabierto.                           | IMPLEMENTED: alta, listados, finalización y cambio de horario histórico.                           |
| Attendance    | Vincula Student, Subscription y ClassSession; estado, origen y recordedAt.                                | IMPLEMENTED: PRESENT Student/Admin, ABSENT de sistema, correcciones, consultas y consumo derivado.                  |
| AttendanceChallenge | Secreto efímero representado sólo por hash, ligado a ClassSession y Admin emisor. | IMPLEMENTED: emisión, rotación, validación, revocación por cancelación y limpieza acotada. |
| Recovery      | Vincula Student, Subscription, ausencia original y sesión destino.                                        | IMPLEMENTED: autorización Admin, cancelación trazable, resultado y estado derivados.                                             |
| Session       | userId + rol, tokenHash único, expiración, revocación y lastSeenAt.                                       | IMPLEMENTED: creación, validación y logout.                                                       |
| AuditLog      | actorType explícito, actorId, acción, entidad, ID, metadata JSON y fecha.                                             | IMPLEMENTED: eventos de mutaciones y consulta Admin paginada con metadata controlada.  |

## Invariantes IMPLEMENTED

- Admin.email, StudentAccess.tokenHash y Session.tokenHash son únicos en PostgreSQL.
- Attendance tiene UNIQUE(studentId, classSessionId). Enrollment prohíbe solapamientos para una misma Student y Schedule.
- Recovery tiene índices únicos parciales por ausencia y Student/destino para autorizaciones no canceladas; permite conservar varias cancelaciones históricas.
- Las relaciones ordinarias están protegidas por claves foráneas. Session.userId y AuditLog.actorId son identificadores polimórficos sin FK.
- SessionGuard comprueba en cada request que exista la identidad del rol persistido. El request no elige identidad ni rol.
- Una sesión válida requiere revokedAt nulo y expiresAt estrictamente posterior al reloj del backend. Se vuelve a comprobar ese predicado al actualizar lastSeenAt.
- Activar StudentAccess exige PENDING, activatedAt/revokedAt nulos y expiresAt futuro. El cambio de estado es condicional y comparte transacción con sesión y auditoría.
- Revocar un acceso exige que corresponda a la alumna indicada. Repetir la revocación no reemplaza su fecha ni genera otro evento.
- Los estados y timestamps de StudentAccess se mantienen mediante servicios; no existen CHECKs de coherencia entre esos campos.
- Es válido tener varios enlaces pendientes de una alumna. Emitir otro no invalida los anteriores. Revocarlos individualmente conserva semántica e historial.
- StudentActivePeriod es la fuente temporal de actividad; `Student.isActive` es su proyección actual. Desactivar cierra el período abierto y revoca sesiones Student y accesos pendientes en una transacción. Reactivar abre un período nuevo sin restaurar estados anteriores.
- Los períodos usan `[validFrom, validUntil)`. PostgreSQL controla límites, exclusión de solapamientos, un único período abierto, FK RESTRICT y coherencia diferida entre el período abierto y `Student.isActive`.
- No existe borrado físico de Student por API. Las mutaciones de una misma Student se serializan con bloqueo de fila y generan auditoría solo cuando cambia el estado.
- Plan exige nombre no vacío, classCount positivo, precio no negativo y moneda ARS también mediante CHECK. Desactivarlo impide nuevos contratos y no cambia snapshots previos.
- Subscription copia planName, classAllowance, agreedPrice y currency. El período es [periodStart, periodEnd), debe ser creciente y no puede superponerse con otra Subscription ACTIVE de la misma Student. La exclusión GiST es la defensa final.
- Subscription persiste ACTIVE/CANCELLED. EXPIRED se deriva de periodEnd; PENDING/PARTIAL/PAID/OVERPAID se derivan de agreedPrice y Payments CONFIRMED.
- Payment exige importe positivo, ARS, paidAt explícito, Admin creador e Idempotency-Key único. CONFIRMED no tiene datos de anulación; VOIDED exige autor, fecha y motivo.
- No hay DELETE comercial ni PATCH genérico de contratos o pagos. Las cancelaciones y anulaciones repetidas no duplican auditoría.
- Schedule guarda día ISO 1–7, minutos locales de inicio/fin y capacidad habitual. Sus CHECK exigen rango válido, inicio anterior al fin y capacidad 1–1000.
- ClassSession guarda `occurrenceDate` como identidad local de la recurrencia y `startAt/endAt` como instantes UTC. UNIQUE(scheduleId, occurrenceDate) hace segura la generación concurrente.
- Una ClassSession conserva su snapshot aunque cambie Schedule. Sólo SCHEDULED admite excepciones; CANCELLED exige autor, fecha y motivo coherentes por CHECK.
- Enrollment usa `[validFrom, validUntil)` como fechas locales. La FK compuesta exige que Subscription pertenezca a Student y la exclusión GiST evita períodos superpuestos para Student/Schedule.
- Crear o mover Enrollment valida Student activa, Subscription operativa y propia, Schedule activo, período contractual, al menos una recurrencia y cupo habitual/efectivo.
- Cambiar de horario cierra el Enrollment anterior y crea otro en una transacción. Finalizar o repetir el mismo cambio no borra ni duplica historia.
- Attendance original admite PRESENT/STUDENT, PRESENT/ADMIN y ABSENT/SYSTEM. El estado efectivo puede diferir tras una corrección; originalStatus/source/recordedAt son inmutables. La FK compuesta garantiza que la Subscription pertenece a la Student y UNIQUE(studentId, classSessionId) impide estados contradictorios.
- ClassSession COMPLETED exige `attendanceClosedAt`; los demás estados exigen que sea nulo. Una clase con Attendance no se puede cancelar desde el servicio.
- PRESENT y ABSENT normales consumen una clase; con recoveryId no consumen. `usedClasses` se cuenta sobre Attendance con recoveryId nulo y `remainingClasses` se deriva sin persistir contadores ni devolver negativos. Si used supera allowance se expone `OVERCONSUMED`.
- La ventana es `[startAt - openBefore, endAt + closeAfter)`. El reloj del backend decide. CANCELLED nunca admite Attendance.
- El reconciliador crea las ausencias faltantes y cierra la ClassSession en una transacción. Student, Subscription y ClassSession se bloquean; la unicidad PostgreSQL es la defensa final entre workers.
- Expected Students y reconciliación evalúan la actividad de Student en `ClassSession.startAt`. PRESENT agrega la exigencia de actividad actual para no autorizar una sesión revocada.

## Fuentes de verdad

Auth usa hashes y registros Session/StudentAccess persistidos, no cookies como base de datos. La cookie solo transporta un secreto opaco. El contrato vive en el snapshot de Subscription; el dinero recibido vive en Payment y el saldo se deriva. El consumo de clases vive en Attendance y también se deriva.

Schedule es fuente de recurrencia y capacidad habitual para generaciones futuras. ClassSession es el snapshot y la capacidad efectiva de una fecha ya creada. Enrollment es la pertenencia temporal al Schedule respaldada por una Subscription. Las alumnas esperadas para una ClassSession se derivan de esos tres registros, de la vigencia del contrato y de StudentActivePeriod en `startAt`. Attendance conserva qué contrato consumió cada clase; no hay tabla de reservas ni contador mutable.

## Recovery implementada

La autorización exige ausencia habitual, misma Student/Subscription, destino adicional dentro del período y cupo. Attendance.recoveryId vincula el resultado sin doble consumo. FKs compuestas, índices parciales y guards PostgreSQL protegen identidad e histórico. Ver [Recoveries](recoveries.md).

## Índices y migraciones

Los índices actuales cubren hashes únicos, identidad/rol y expiración de sesión, períodos de una alumna, claves de relaciones y consultas de auditoría. No se agregaron índices especulativos en Fase 0.

Etapa 1 agregó `Student.isActive`. Etapa 2 agregó `20260904090000_commercial_core`: enums, snapshots, autores, constraints, índices de consulta, idempotencia y exclusión temporal con `btree_gist`. Etapa 3 agregó `20260904180000_scheduling_core`: fechas locales, snapshots UTC, cancelación trazable, FK compuesta, exclusión de Enrollment y clave de generación. Etapa 4 agregó `20260904220000_attendance_engine`: contrato consumido, origen, cierre, CHECKs, índices y FK RESTRICT. Etapa 4.1 agregó `20260904233000_historical_student_eligibility`: períodos activos, reconstrucción segura, exclusión temporal, proyección coherente y guard ante historia ambigua.

## Challenge de Attendance (Etapa 5)

AttendanceChallenge almacena id, generation, classSessionId, tokenHash, createdAt, expiresAt, revokedAt y createdByAdminId. El secreto nunca se guarda. generation usa una secuencia BIGINT para ordenar emisiones incluso si ocurren en el mismo milisegundo; no es el secreto ni se expone por API.

La migración 20260910120000_attendance_challenge es aditiva: conserva Attendance y el historial previo. PostgreSQL exige hash único con formato hexadecimal de 64 caracteres, expiresAt > createdAt, revokedAt nulo o >= createdAt y FKs RESTRICT a ClassSession/Admin. Índice por ClassSession/generation para rotación y limpieza local, además del unique del hash y la PK. No necesita índice global de expiry porque no se implementó un barrido global.

Emisión y PRESENT bloquean la ClassSession. La emisión deja como máximo dos challenges no revocados; uno anterior conserva su expiry original. El tercero desplaza al más antiguo. El límite del conjunto lo garantiza el protocolo transaccional con bloqueo PostgreSQL, no el rate limit ni un CHECK basado en el reloj. Escrituras externas que omitan ese protocolo no están autorizadas.

Cancelar revoca los challenges en la misma transacción. PRESENT Student siempre valida el estado y la ventana actuales, incluso si cambió el horario de la clase. Repetir PRESENT exige challenge vigente y no vuelve a consumir allowance. Ver [QR](attendance-qr.md).

## Persistencia de Recoveries (Etapa 6)

`20260912180000_recoveries` inspecciona el modelo provisional antes del DDL, preserva Attendance y agrega la relación opcional de resultado. Seis FKs RESTRICT, cancelación coherente por CHECK, unicidad parcial por ausencia/Student-destino y triggers de histórico. Estado operativo, resultado y consumo se derivan; no hay estado editable ni contador.

## Etapa 7: correcciones y actores

AttendanceCorrection pertenece a Attendance y Admin con FK RESTRICT, motivo trim 3–500, transición distinta y secuencia positiva única por Attendance. Su historial no admite UPDATE/DELETE. Attendance manual guarda createdByAdminId y creationReason; CHECK exige ambos sólo para source ADMIN. AuditLog agrega actorType obligatorio y CHECK de actor, más índices de filtros/orden. El backfill originalStatus=status conserva el estado previo. La guardia de actor rechaza histórico ambiguo antes de DDL. [Modelo y reglas completas](admin-corrections.md).
