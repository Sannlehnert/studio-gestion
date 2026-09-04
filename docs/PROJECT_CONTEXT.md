# Contexto del proyecto

Studio Gestión es un sistema real para una profesora que alquila una sala y administra grupos de alumnas. La prioridad es conservar el dominio, los datos históricos y la seguridad con una arquitectura mantenible. No se agregan patrones ni capas sin una necesidad concreta.

## Alcance y estado

- IMPLEMENTED: foundation, Auth, Students y el núcleo comercial de Plans, Subscriptions y Payments. La evidencia está en las validaciones de [Fase 0](phase-0-validation.md), [Etapa 1](stage-1-validation.md) y [Etapa 2](stage-2-validation.md).
- PLANNED: programaciones, clases, cupos, inscripciones, asistencias, ausencias y recuperaciones.
- NOT STARTED: frontend. StudentModule singular aporta la ruta de permisos de alumna; StudentsModule contiene su gestión administrativa.
- Fuera del MVP: múltiples profesores/salas/sedes, reservas, WhatsApp, pagos online, notificaciones y SaaS.

## Usuarios

Admin se autentica con email y contraseña. Administrará alumnas y operaciones de negocio cuando existan esos módulos. Student no requiere email, usuario ni contraseña: recibe un enlace temporal, lo intercambia una sola vez por una cookie de sesión y opera con su identidad persistida. Una alumna no podrá modificar asistencias, pagos, planes ni períodos.

Actualmente Admin tiene login, comprobación de permisos, gestión de alumnas y accesos, catálogo de planes, contratos y registro de pagos. Student tiene activación, identidad, comprobación de permisos y logout; no puede acceder al núcleo comercial.

## Reglas del producto que deben conservarse

1. Plan define una modalidad configurable; no limita el producto a ocho clases. Está implementado como catálogo mutable, activable y sin borrado físico.
2. Subscription representa lo contratado por una alumna, conserva snapshot comercial y usa períodos [inicio, fin). El estado financiero se deriva del precio acordado y pagos confirmados.
3. Schedule define una recurrencia; ClassSession representa una clase fechada, con capacidad efectiva que puede diferir de la habitual.
4. Enrollment conserva pertenencia e historial; no fijar un único horario permanente en Student.
5. Una clase CANCELLED no admite asistencia, no genera ausencia y no consume clase.
6. El backend autoriza la asistencia entre inicio menos una hora y fin más una hora. Si no se registra en la ventana corresponde ABSENT y consume clase. La combinación alumna/clase debe ser única también en PostgreSQL.
7. Recovery vincula una ausencia concreta, una alumna y otra ClassSession real dentro de la misma Subscription. La ausencia original permanece.
8. La capacidad no puede superarse con operaciones concurrentes.
9. El futuro QR será dinámico, temporal y asociado a ClassSession. Además del challenge se validarán sesión, suscripción, inscripción, clase, ventana y ausencia de asistencia previa. Sin GPS en el MVP.

Las reglas 1–2 están implementadas en el núcleo comercial. Las reglas 3–9 siguen planificadas; los constraints existentes se describen en [modelo de dominio](domain-model.md).

## Stack y decisiones

Monolito modular con NestJS 12, TypeScript strict, PostgreSQL 16, Prisma 6 y OpenAPI. Controllers delgados; servicios coordinan dominio y transacciones. Dinero en Decimal/Numeric. Tiempo del negocio configurado centralmente. Sesiones y tokens son revocables; no guardar credenciales en localStorage.

No introducir microservicios, CQRS, event sourcing ni repositorios ceremoniales. Antes de cada operación importante analizar permiso, identidad, inputs manipulables, validación, invariantes, transacción, concurrencia, repetición, auditoría, filtraciones y tests.

## Roadmap

- Fase 0: saneamiento, cierre de Auth y seguridad, documentación y validación.
- Etapa 1: Students — IMPLEMENTED, con activación/desactivación, historial y `Student.isActive`.
- Etapa 2: Plans, Subscriptions y Payments — IMPLEMENTED, con snapshots, pagos parciales, anulaciones y concurrencia protegida.
- Próxima: Schedules, Enrollments y ClassSessions. Después, los demás módulos de negocio, frontend y QR según sus respectivos prompts.

No avanzar de etapa automáticamente. Cualquier etapa necesita lint, typecheck, tests pertinentes y build en verde. No borrar tests fallidos ni modificar producción solo para satisfacer mocks.
