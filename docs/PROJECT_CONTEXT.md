# Contexto del proyecto

Studio Gestión es un sistema real para una profesora que alquila una sala y administra grupos de alumnas. La prioridad es conservar el dominio, los datos históricos y la seguridad con una arquitectura mantenible. No se agregan patrones ni capas sin una necesidad concreta.

## Alcance y estado

- IMPLEMENTED: foundation, Auth, Students, Plans, Subscriptions, Payments, Schedules, Enrollments, ClassSessions, Attendance, historial temporal de actividad, challenge QR, Recoveries y correcciones/auditoría administrativas. La evidencia está en las validaciones de [Fase 0](phase-0-validation.md), [Etapa 1](stage-1-validation.md), [Etapa 2](stage-2-validation.md), [Etapa 3](stage-3-validation.md), [Etapa 4](stage-4-validation.md), [Etapa 4.1](stage-4.1-validation.md) y [Etapa 5](stage-5-validation.md) y [Etapa 6](stage-6-validation.md).
- Etapa 7: IMPLEMENTED. Ver [validación final](stage-7-validation.md).
- NOT STARTED: frontend. StudentModule singular aporta la ruta de permisos de alumna; StudentsModule contiene su gestión administrativa.
- Fuera del MVP: múltiples profesores/salas/sedes, reservas, WhatsApp, pagos online, notificaciones y SaaS.

## Usuarios

Admin se autentica con email y contraseña. Administrará alumnas y operaciones de negocio cuando existan esos módulos. Student no requiere email, usuario ni contraseña: recibe un enlace temporal, lo intercambia una sola vez por una cookie de sesión y opera con su identidad persistida. Una alumna no podrá modificar asistencias, pagos, planes ni períodos.

Actualmente Admin tiene login, gestión de alumnas y accesos, catálogo, contratos, pagos, horarios, inscripciones, clases, lectura de asistencia, PRESENT manual durante la ventana, correcciones trazables, auditoría operativa y autorización/cancelación de Recoveries. Student tiene activación, identidad, logout, consulta de sus propias clases y Recoveries, y registro de PRESENT con challenge QR vigente dentro de la ventana autorizada.

## Reglas del producto que deben conservarse

1. Plan define una modalidad configurable; no limita el producto a ocho clases. Está implementado como catálogo mutable, activable y sin borrado físico.
2. Subscription representa lo contratado por una alumna, conserva snapshot comercial y usa períodos [inicio, fin). El estado financiero se deriva del precio acordado y pagos confirmados.
3. Schedule define una recurrencia; ClassSession representa una clase fechada, con capacidad efectiva que puede diferir de la habitual.
4. Enrollment conserva pertenencia e historial; no fijar un único horario permanente en Student.
5. Una clase CANCELLED no admite asistencia, no genera ausencia y no consume clase.
6. El backend autoriza la asistencia entre inicio menos una hora y fin más una hora. Si no se registra en la ventana corresponde ABSENT; una Attendance normal consume clase y una Recovery no añade consumo. La combinación alumna/clase debe ser única también en PostgreSQL.
7. Recovery vincula una ausencia concreta, una alumna y otra ClassSession real dentro de la misma Subscription. La ausencia original permanece.
8. La capacidad no puede superarse con operaciones concurrentes.
9. El QR es dinámico, temporal y asociado a ClassSession. Además del challenge se validan sesión, actividad actual e histórica, suscripción, inscripción, clase, ventana e idempotencia. No demuestra presencia física ni impide compartirlo en tiempo real. Sin GPS en el MVP.

Las reglas 1–9 están implementadas. Recovery conserva el consumo original y su resultado no consume otra clase. Los constraints se describen en [modelo de dominio](domain-model.md).

## Stack y decisiones

Monolito modular con NestJS 12, TypeScript strict, PostgreSQL 16, Prisma 6 y OpenAPI. Controllers delgados; servicios coordinan dominio y transacciones. Dinero en Decimal/Numeric. Tiempo del negocio configurado centralmente. Sesiones y tokens son revocables; no guardar credenciales en localStorage.

No introducir microservicios, CQRS, event sourcing ni repositorios ceremoniales. Antes de cada operación importante analizar permiso, identidad, inputs manipulables, validación, invariantes, transacción, concurrencia, repetición, auditoría, filtraciones y tests.

## Roadmap

- Fase 0: saneamiento, cierre de Auth y seguridad, documentación y validación.
- Etapa 1: Students — IMPLEMENTED, con activación/desactivación, historial y `Student.isActive`.
- Etapa 2: Plans, Subscriptions y Payments — IMPLEMENTED, con snapshots, pagos parciales, anulaciones y concurrencia protegida.
- Etapa 3: Schedules, Enrollments y ClassSessions — IMPLEMENTED.
- Etapa 4: Attendance Engine y Absences — IMPLEMENTED, con consumo derivado y reconciliación recuperable.
- Etapa 4.1: Historical Student Eligibility — IMPLEMENTED, con ciclos temporales y reconciliación histórica.
- Etapa 5: Dynamic QR Attendance Challenge — IMPLEMENTED, con hash, TTL, rotación acotada y límites por identidad.
- Etapa 6: Recoveries — IMPLEMENTED. Ver [reglas y concurrencia](recoveries.md).
- Etapa 7: Admin Corrections + Operational Audit — IMPLEMENTED.

No avanzar de etapa automáticamente. Cualquier etapa necesita lint, typecheck, tests pertinentes y build en verde. No borrar tests fallidos ni modificar producción solo para satisfacer mocks.

## Correcciones administrativas

Attendance conserva originalStatus/source/recordedAt; status es su proyección efectiva corregible. Historial estructurado y auditoría comparten transacción. Recovery cancelada no bloquea corregir el origen; con resultado lo bloquea. Ver [correcciones](admin-corrections.md) y [auditoría](operational-audit.md). BACKEND FUNCTIONAL CORE = COMPLETE para el alcance funcional acordado hasta Etapa 7; esto no certifica preparación de producción. Frontend requiere un nuevo prompt.

## Integración frontend — Etapa 7.1

Etapa 7.1 agrega seis lecturas para integración frontend, códigos de error estables y CORS para Idempotency-Key. CURRENT/UPCOMING/NONE describe selección contractual, separado del status persistido. Auth/me conserva identidad. No cambia schema ni reglas del dominio; Frontend F1 requiere el próximo prompt.

Contrato completo y límites: [frontend-integration-contract.md](frontend-integration-contract.md). Evidencia: [stage-7.1-validation.md](stage-7.1-validation.md).
