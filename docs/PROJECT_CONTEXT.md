# Contexto del proyecto

Studio Gestión es un sistema real para una profesora que alquila una sala y administra grupos de alumnas. La prioridad es conservar el dominio, los datos históricos y la seguridad con una arquitectura mantenible. No se agregan patrones ni capas sin una necesidad concreta.

## Alcance y estado

- IMPLEMENTED: foundation NestJS/PostgreSQL/Prisma, health, OpenAPI, autenticación Admin, activación Student, sesiones opacas, revocación individual de accesos pendientes, auditoría de operaciones Auth y protección HTTP. La evidencia de cierre está en [validación de Fase 0](phase-0-validation.md).
- PLANNED: StudentsModule de negocio, desactivación/reactivación, planes, suscripciones, pagos, programaciones, clases, cupos, asistencias, ausencias y recuperaciones.
- NOT STARTED: frontend. La existencia de StudentModule singular solo aporta una ruta de comprobación de permisos; no equivale a StudentsModule.
- Fuera del MVP: múltiples profesores/salas/sedes, reservas, WhatsApp, pagos online, notificaciones y SaaS.

## Usuarios

Admin se autentica con email y contraseña. Administrará alumnas y operaciones de negocio cuando existan esos módulos. Student no requiere email, usuario ni contraseña: recibe un enlace temporal, lo intercambia una sola vez por una cookie de sesión y opera con su identidad persistida. Una alumna no podrá modificar asistencias, pagos, planes ni períodos.

Actualmente Admin solo tiene login, comprobación de permisos y gestión de accesos. Student solo tiene activación, identidad, comprobación de permisos y logout. No hay operaciones de negocio implementadas por la mera presencia de sus modelos.

## Reglas del producto que deben conservarse

1. Plan define una modalidad configurable; no limitar el producto a ocho clases.
2. Subscription representa lo contratado por una alumna y contiene el período. Las clases no utilizadas vencen al finalizarlo. El saldo se derivará de registros persistidos, nunca de un contador decrementado como única verdad.
3. Schedule define una recurrencia; ClassSession representa una clase fechada, con capacidad efectiva que puede diferir de la habitual.
4. Enrollment conserva pertenencia e historial; no fijar un único horario permanente en Student.
5. Una clase CANCELLED no admite asistencia, no genera ausencia y no consume clase.
6. El backend autoriza la asistencia entre inicio menos una hora y fin más una hora. Si no se registra en la ventana corresponde ABSENT y consume clase. La combinación alumna/clase debe ser única también en PostgreSQL.
7. Recovery vincula una ausencia concreta, una alumna y otra ClassSession real dentro de la misma Subscription. La ausencia original permanece.
8. La capacidad no puede superarse con operaciones concurrentes.
9. El futuro QR será dinámico, temporal y asociado a ClassSession. Además del challenge se validarán sesión, suscripción, inscripción, clase, ventana y ausencia de asistencia previa. Sin GPS en el MVP.

Las reglas de los puntos 1–9 están PLANNED como casos de uso; los constraints existentes se describen por separado en [modelo de dominio](domain-model.md).

## Stack y decisiones

Monolito modular con NestJS 12, TypeScript strict, PostgreSQL 16, Prisma 6 y OpenAPI. Controllers delgados; servicios coordinan dominio y transacciones. Dinero en Decimal/Numeric. Tiempo del negocio configurado centralmente. Sesiones y tokens son revocables; no guardar credenciales en localStorage.

No introducir microservicios, CQRS, event sourcing ni repositorios ceremoniales. Antes de cada operación importante analizar permiso, identidad, inputs manipulables, validación, invariantes, transacción, concurrencia, repetición, auditoría, filtraciones y tests.

## Roadmap

- Fase 0: saneamiento, cierre de Auth y seguridad, documentación y validación.
- Etapa 1: Students, empezando por reglas de activación/desactivación, historial y migración de Student.isActive.
- Etapas posteriores: módulos de negocio, frontend y QR según sus respectivos prompts.

No avanzar de etapa automáticamente. Cualquier etapa necesita lint, typecheck, tests pertinentes y build en verde. No borrar tests fallidos ni modificar producción solo para satisfacer mocks.
