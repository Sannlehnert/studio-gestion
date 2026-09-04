# Modelo de dominio

Fuente: apps/backend/prisma/schema.prisma y sus cuatro migraciones. Tener una tabla de etapas futuras no significa tener su módulo de negocio.

## Modelos actuales

| Modelo        | Responsabilidad y relaciones                                                                              | Estado del comportamiento                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Admin         | Identidad administrativa; email único y passwordHash.                                                     | IMPLEMENTED: seed explícito, login y guard.                                                       |
| Student       | Identidad de alumna con estado activo y relaciones históricas.                                            | IMPLEMENTED: CRUD administrativo sin borrado, búsqueda, paginación, desactivación y reactivación. |
| StudentAccess | Pertenece a Student. tokenHash único, estado, expiración, activación y revocación.                        | IMPLEMENTED: emitir, consumir una vez y revocar un pendiente.                                     |
| Plan          | Oferta reusable con nombre, descripción, classCount, precio actual, ARS e isActive.                       | IMPLEMENTED: crear, listar, editar y activar/desactivar sin DELETE.                               |
| Subscription  | Contrato con Student/Plan, snapshot, precio acordado, período y estado operativo.                         | IMPLEMENTED: alta, consulta, cancelación, solapamiento prohibido y finanzas derivadas.             |
| Payment       | Dinero recibido, autor, importe Decimal, fecha, método, estado e idempotencia.                             | IMPLEMENTED: múltiples pagos parciales, consulta y anulación sin borrado.                         |
| Schedule      | Recurrencia con día, horas, capacidad habitual e isActive; agrupa ClassSession.                           | PLANNED: validaciones y materialización de clases.                                                |
| ClassSession  | Clase concreta de Schedule, inicio/fin, capacidad efectiva y estado.                                      | PLANNED: administración, cancelación y concurrencia de cupos.                                     |
| Enrollment    | Vincula Student, Subscription y ClassSession; conserva enrolledAt.                                        | PLANNED: inscripción y sus invariantes cruzadas.                                                  |
| Attendance    | Vincula Student y ClassSession; estado, markedAt y nota.                                                  | PLANNED: registro, ausencias automáticas y correcciones Admin.                                    |
| Recovery      | Vincula Student, Subscription, ausencia original y sesión destino.                                        | PLANNED: autorización, uso, vencimiento y revocación.                                             |
| Session       | userId + rol, tokenHash único, expiración, revocación y lastSeenAt.                                       | IMPLEMENTED: creación, validación y logout.                                                       |
| AuditLog      | actorId opcional, acción, entidad, ID, metadata JSON y fecha.                                             | IMPLEMENTED: eventos Auth, Students y núcleo comercial. Consulta administrativa aún no expuesta.  |

## Invariantes IMPLEMENTED

- Admin.email, StudentAccess.tokenHash y Session.tokenHash son únicos en PostgreSQL.
- Enrollment y Attendance tienen UNIQUE(studentId, classSessionId).
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

## Fuentes de verdad

Auth usa hashes y registros Session/StudentAccess persistidos, no cookies como base de datos. La cookie solo transporta un secreto opaco. El contrato vive en el snapshot de Subscription; el dinero recibido vive en Payment y el saldo se deriva. Todavía no existe un contador de clases operativo.

Schedule es fuente de recurrencia y capacidad habitual; ClassSession tendrá la capacidad efectiva. Enrollment es una relación a clases concretas en el schema actual, no una asignación recurrente a Schedule. La solución para inscripciones recurrentes todavía debe definirse.

## Invariantes PLANNED y riesgos antes de negocio

- Validar intervalos de Schedule, capacidades y días de semana.
- Resolver horas recurrentes y timezone: Schedule.startTime/endTime son DateTime en el schema actual. No asumir que eso implementa la recurrencia correctamente.
- Comprobar que Student, Subscription, Enrollment y Recovery se correspondan; las FKs individuales no prueban esas coincidencias.
- Implementar consumo, ausencias, clase cancelada, recuperación dentro del período y saldo reconciliable.
- Proteger cupos con una estrategia transaccional probada contra PostgreSQL.
- Revisar qué hacer ante una recuperación revocada cuando ya existe UNIQUE(originalAbsenceId); no sobrescribir historia sin una regla.
- Las relaciones comerciales Student→Subscription y Subscription→Payment usan RESTRICT. Modelos futuros aún conservan algunas cascadas; revisarlas antes de cualquier herramienta operativa de borrado.

## Índices y migraciones

Los índices actuales cubren hashes únicos, identidad/rol y expiración de sesión, períodos de una alumna, claves de relaciones y consultas de auditoría. No se agregaron índices especulativos en Fase 0.

Etapa 1 agregó `Student.isActive`. Etapa 2 agregó `20260904090000_commercial_core`: enums, snapshots, autores, constraints, índices de consulta, idempotencia y exclusión temporal con `btree_gist`. Preserva Plan existentes asignando ARS. Si detecta Subscription o Payment heredados sin información suficiente, aborta antes de modificar el schema para exigir un mapeo manual trazable.
