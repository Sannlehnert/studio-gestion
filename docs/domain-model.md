# Modelo de dominio

Fuente: apps/backend/prisma/schema.prisma y sus cinco migraciones. Tener una tabla de etapas futuras no significa tener su módulo de negocio.

## Modelos actuales

| Modelo        | Responsabilidad y relaciones                                                                              | Estado del comportamiento                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Admin         | Identidad administrativa; email único y passwordHash.                                                     | IMPLEMENTED: seed explícito, login y guard.                                                       |
| Student       | Identidad de alumna con estado activo y relaciones históricas.                                            | IMPLEMENTED: CRUD administrativo sin borrado, búsqueda, paginación, desactivación y reactivación. |
| StudentAccess | Pertenece a Student. tokenHash único, estado, expiración, activación y revocación.                        | IMPLEMENTED: emitir, consumir una vez y revocar un pendiente.                                     |
| Plan          | Oferta reusable con nombre, descripción, classCount, precio actual, ARS e isActive.                       | IMPLEMENTED: crear, listar, editar y activar/desactivar sin DELETE.                               |
| Subscription  | Contrato con Student/Plan, snapshot, precio acordado, período y estado operativo.                         | IMPLEMENTED: alta, consulta, cancelación, solapamiento prohibido y finanzas derivadas.             |
| Payment       | Dinero recibido, autor, importe Decimal, fecha, método, estado e idempotencia.                             | IMPLEMENTED: múltiples pagos parciales, consulta y anulación sin borrado.                         |
| Schedule      | Recurrencia semanal local, capacidad habitual e isActive; origina ClassSession.                            | IMPLEMENTED: CRUD sin borrado, estado, filtros y snapshot futuro.                                 |
| ClassSession  | Clase concreta con fecha de recurrencia, instantes UTC, capacidad efectiva, estado y cancelación.          | IMPLEMENTED: generación, consulta, excepciones y cancelación idempotente.                          |
| Enrollment    | Vincula Student, Subscription y Schedule durante un intervalo local semiabierto.                           | IMPLEMENTED: alta, listados, finalización y cambio de horario histórico.                           |
| Attendance    | Vincula Student y ClassSession; estado, markedAt y nota.                                                  | PLANNED: registro, ausencias automáticas y correcciones Admin.                                    |
| Recovery      | Vincula Student, Subscription, ausencia original y sesión destino.                                        | PLANNED: autorización, uso, vencimiento y revocación.                                             |
| Session       | userId + rol, tokenHash único, expiración, revocación y lastSeenAt.                                       | IMPLEMENTED: creación, validación y logout.                                                       |
| AuditLog      | actorId opcional, acción, entidad, ID, metadata JSON y fecha.                                             | IMPLEMENTED: eventos Auth, Students y núcleo comercial. Consulta administrativa aún no expuesta.  |

## Invariantes IMPLEMENTED

- Admin.email, StudentAccess.tokenHash y Session.tokenHash son únicos en PostgreSQL.
- Attendance tiene UNIQUE(studentId, classSessionId). Enrollment prohíbe solapamientos para una misma Student y Schedule.
- Recovery.originalAbsenceId es único: hoy una ausencia puede tener como máximo un registro Recovery.
- Las relaciones ordinarias están protegidas por claves foráneas. Session.userId y AuditLog.actorId son identificadores polimórficos sin FK.
- SessionGuard comprueba en cada request que exista la identidad del rol persistido. El request no elige identidad ni rol.
- Una sesión válida requiere revokedAt nulo y expiresAt estrictamente posterior al reloj del backend. Se vuelve a comprobar ese predicado al actualizar lastSeenAt.
- Activar StudentAccess exige PENDING, activatedAt/revokedAt nulos y expiresAt futuro. El cambio de estado es condicional y comparte transacción con sesión y auditoría.
- Revocar un acceso exige que corresponda a la alumna indicada. Repetir la revocación no reemplaza su fecha ni genera otro evento.
- Los estados y timestamps de StudentAccess se mantienen mediante servicios; no existen CHECKs de coherencia entre esos campos.
- Es válido tener varios enlaces pendientes de una alumna. Emitir otro no invalida los anteriores. Revocarlos individualmente conserva semántica e historial.
- Student.isActive es la fuente de verdad operativa. Desactivar revoca sesiones Student y accesos pendientes en una transacción, sin borrar relaciones históricas. Reactivar no restaura credenciales anteriores.
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

## Fuentes de verdad

Auth usa hashes y registros Session/StudentAccess persistidos, no cookies como base de datos. La cookie solo transporta un secreto opaco. El contrato vive en el snapshot de Subscription; el dinero recibido vive en Payment y el saldo se deriva. Todavía no existe un contador de clases operativo.

Schedule es fuente de recurrencia y capacidad habitual para generaciones futuras. ClassSession es el snapshot y la capacidad efectiva de una fecha ya creada. Enrollment es la pertenencia temporal al Schedule respaldada por una Subscription. Las alumnas esperadas para una ClassSession se derivan de esos tres registros y de la vigencia del contrato; no hay tabla de reservas ni contador consumido todavía.

## Invariantes PLANNED y riesgos antes de negocio

- Implementar consumo, ausencias, clase cancelada, recuperación dentro del período y saldo reconciliable.
- Revisar qué hacer ante una recuperación revocada cuando ya existe UNIQUE(originalAbsenceId); no sobrescribir historia sin una regla.
- Attendance y Recovery todavía conservan algunas cascadas heredadas; revisarlas antes de exponer cualquier borrado operativo en esas etapas.

## Índices y migraciones

Los índices actuales cubren hashes únicos, identidad/rol y expiración de sesión, períodos de una alumna, claves de relaciones y consultas de auditoría. No se agregaron índices especulativos en Fase 0.

Etapa 1 agregó `Student.isActive`. Etapa 2 agregó `20260904090000_commercial_core`: enums, snapshots, autores, constraints, índices de consulta, idempotencia y exclusión temporal con `btree_gist`. Etapa 3 agregó `20260904180000_scheduling_core`: fechas locales, snapshots UTC, cancelación trazable, FK compuesta, exclusión de Enrollment y clave de generación. Si detecta filas Schedule, ClassSession o Enrollment del modelo provisional, aborta antes de modificar el schema para exigir un mapeo manual trazable.
