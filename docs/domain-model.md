# Modelo de dominio

Fuente: apps/backend/prisma/schema.prisma y sus dos migraciones existentes. Tener una tabla implementada no significa tener su módulo de negocio.

## Modelos actuales

| Modelo        | Responsabilidad y relaciones                                                                              | Estado del comportamiento                                                               |
| ------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Admin         | Identidad administrativa; email único y passwordHash.                                                     | IMPLEMENTED: seed explícito, login y guard.                                             |
| Student       | Identidad de alumna; relaciones con suscripciones, inscripciones, asistencias, recuperaciones y accesos.  | IMPLEMENTED: lectura mínima para Auth. PLANNED: CRUD, isActive y reactivación.          |
| StudentAccess | Pertenece a Student. tokenHash único, estado, expiración, activación y revocación.                        | IMPLEMENTED: emitir, consumir una vez y revocar un pendiente.                           |
| Plan          | Modalidad con classCount, precio Decimal(10,2), nombre e isActive; tiene suscripciones.                   | PLANNED: módulo y validaciones de negocio. El default 8 no es un límite de modalidades. |
| Subscription  | Vincula Student y Plan; periodStart/periodEnd le pertenecen. Tiene pagos, inscripciones y recuperaciones. | PLANNED: contratación, consumo, vencimiento y saldo derivado.                           |
| Payment       | Pertenece a Subscription; importe Decimal(10,2), moneda, estado y paidAt.                                 | PLANNED: registro, consistencia monetaria e idempotencia.                               |
| Schedule      | Recurrencia con día, horas, capacidad habitual e isActive; agrupa ClassSession.                           | PLANNED: validaciones y materialización de clases.                                      |
| ClassSession  | Clase concreta de Schedule, inicio/fin, capacidad efectiva y estado.                                      | PLANNED: administración, cancelación y concurrencia de cupos.                           |
| Enrollment    | Vincula Student, Subscription y ClassSession; conserva enrolledAt.                                        | PLANNED: inscripción y sus invariantes cruzadas.                                        |
| Attendance    | Vincula Student y ClassSession; estado, markedAt y nota.                                                  | PLANNED: registro, ausencias automáticas y correcciones Admin.                          |
| Recovery      | Vincula Student, Subscription, ausencia original y sesión destino.                                        | PLANNED: autorización, uso, vencimiento y revocación.                                   |
| Session       | userId + rol, tokenHash único, expiración, revocación y lastSeenAt.                                       | IMPLEMENTED: creación, validación y logout.                                             |
| AuditLog      | actorId opcional, acción, entidad, ID, metadata JSON y fecha.                                             | IMPLEMENTED: eventos Auth. PLANNED: consulta administrativa y auditoría de negocio.     |

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

## Fuentes de verdad

Auth usa hashes y registros Session/StudentAccess persistidos, no cookies como base de datos. La cookie solo transporta un secreto opaco. El estado de Subscription y el futuro consumo se reconstruirán de las relaciones y registros de negocio; hoy no existe un contador de clases operativo.

Schedule es fuente de recurrencia y capacidad habitual; ClassSession tendrá la capacidad efectiva. Enrollment es una relación a clases concretas en el schema actual, no una asignación recurrente a Schedule. La solución para inscripciones recurrentes todavía debe definirse.

## Invariantes PLANNED y riesgos antes de negocio

- Validar períodos, intervalos, capacidades positivas, días de semana, importes y classCount.
- Preservar condiciones contratadas: hoy Subscription referencia un Plan mutable sin snapshot de cantidad/precio. Resolver antes de editar planes que tengan historial.
- Resolver horas recurrentes y timezone: Schedule.startTime/endTime son DateTime en el schema actual. No asumir que eso implementa la recurrencia correctamente.
- Comprobar que Student, Subscription, Enrollment y Recovery se correspondan; las FKs individuales no prueban esas coincidencias.
- Implementar consumo, ausencias, clase cancelada, recuperación dentro del período y saldo reconciliable.
- Proteger cupos con una estrategia transaccional probada contra PostgreSQL.
- Revisar qué hacer ante una recuperación revocada cuando ya existe UNIQUE(originalAbsenceId); no sobrescribir historia sin una regla.
- Varias relaciones tienen ON DELETE CASCADE, incluidas relaciones desde Student y Subscription. No agregar borrados físicos de negocio sin revisar este impacto. Students deberá priorizar desactivación.
- Student.isActive todavía no existe. Incorporar su migración y efecto sobre sesiones/accesos en Etapa 1.

## Índices y migraciones

Los índices actuales cubren hashes únicos, identidad/rol y expiración de sesión, períodos de una alumna, claves de relaciones y consultas de auditoría. No se agregaron índices especulativos en Fase 0.

No hubo cambios de schema ni migraciones nuevas en Fase 0. Se reutilizaron init y add_session, y se aplicaron en schemas aislados de PostgreSQL para E2E. No se ejecutaron resets ni migraciones destructivas sobre datos de desarrollo.
