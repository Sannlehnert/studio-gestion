# Validación de Etapa 4.1

Fecha: 2026-09-10. Entorno: Node.js 24.20.0 y PostgreSQL 16.15 de pruebas en schemas aleatorios.

## Resultado

Historical Student Eligibility quedó implementado sin aplicar la migración a la base de desarrollo. Los runners utilizaron exclusivamente `studio_gestion_test` y eliminaron sus propios schemas aislados.

| Comprobación | Resultado |
| --- | --- |
| Prisma generate | PASS, Prisma Client 6.19.3 |
| Prisma validate | PASS |
| Lint | PASS, sin warnings de oxlint |
| Typecheck | PASS |
| Unit | PASS, 148 tests en 18 archivos |
| Integration + E2E PostgreSQL | PASS, 69 tests en 12 archivos |
| Tests nuevos de Etapa 4.1 | PASS, 8 tests en 2 archivos |
| Concurrencia temporal | PASS contra PostgreSQL |
| Downtime | PASS para actividad e inactividad históricas |
| Build | PASS |
| Migraciones previas | PASS, Students/comercial/scheduling/Attendance |
| Migración Etapa 4.1 | PASS, fresh + upgrade Etapa 4 + guard |
| npm audit offline | PASS, 0 vulnerabilidades |

La advertencia conocida de Vite sobre configuración CommonJS con sintaxis ESM sigue presente y no afecta la ejecución. Esta etapa no modificó dependencias ni lockfile.

## Fuente temporal y semántica

`StudentActivePeriod` es la fuente de verdad histórica. Guarda solamente períodos activos semiabiertos `[validFrom, validUntil)`; un hueco significa inactividad y `validUntil=null` representa el estado activo actual. Permite cualquier cantidad de ciclos sin reconstruir el dominio desde eventos.

La elegibilidad de Student para una ClassSession se evalúa exactamente en `ClassSession.startAt`. Ese instante es estable, ya existe como snapshot de la clase y coincide con la evaluación temporal de Subscription. Se descartó usar el inicio de la ventana porque es una regla de acceso configurable, y exigir actividad durante toda o cualquier parte de la clase agregaría ambigüedad ante transiciones intermedias.

`Student.isActive` se conserva como proyección actual para autorización y listados. Un PRESENT interactivo exige esa proyección activa y además elegibilidad histórica/contractual. Expected Students y reconciliación usan el período en `startAt` y no filtran por estado actual.

## Transiciones y concurrencia

Deactivate y reactivate bloquean primero la fila Student y luego leen el reloj del backend. Deactivate cierra el período abierto, cambia la proyección, revoca sesiones y accesos pendientes y audita dentro de una transacción. Reactivate abre un período nuevo, cambia la proyección y audita sin restaurar credenciales ni registros anteriores.

Los replays no cambian períodos, `effectiveAt` ni AuditLog. Las pruebas reales cubren dos deactivate, dos reactivate, deactivate junto con reactivate, deactivate contra reconciliación y reactivate contra reconciliación. El resultado depende del orden serializado de una transición actual, mientras que una clase pasada siempre depende de su historia en `startAt`.

## Downtime y casos de dominio

- Activa al inicio de la clase y desactivada antes de una reconciliación tardía: crea ABSENT.
- Desactivada antes de la clase: no crea ABSENT.
- Inactiva al inicio y reactivada después: no crea ABSENT ni aparece en Expected Students para esa clase.
- PRESENT anterior a la desactivación: permanece, conserva la Subscription y el consumo derivado.
- Varios ciclos: clases en períodos activos producen expected y clases en huecos inactivos no lo producen.
- Próximas clases filtran temporalmente antes de aplicar el límite solicitado, por lo que una clase no elegible no oculta una posterior elegible.

No cambió el cálculo de `usedClasses`, `remainingClasses` ni `OVERCONSUMED`; Attendance sigue siendo la fuente del consumo.

## Persistencia y migración

La migración `20260904233000_historical_student_eligibility` agrega:

- tabla `StudentActivePeriod` y FK `ON DELETE RESTRICT`;
- CHECK de límites;
- índice por Student y período;
- unique parcial para un solo período abierto;
- exclusión GiST para impedir solapamientos;
- trigger de período inicial para nuevas Students;
- constraint triggers diferidos que exigen coherencia entre `Student.isActive` y el período abierto al commit.
- trigger que rechaza el borrado directo de períodos históricos.

El upgrade reconstruye una sola vez desde `Student.createdAt` y las transiciones de AuditLog. Se validaron Students activas, inactivas y con ciclos múltiples. Antes de crear la tabla aborta si encuentra eventos anteriores a la creación, transiciones simultáneas ambiguas, una secuencia inválida o un estado actual que no coincide. AuditLog no participa en consultas runtime.

## API y seguridad

No se agregó ningún endpoint. Deactivate y reactivate mantienen su contrato externo, DTO vacío, autorización Admin y reloj exclusivo del backend. Student no puede consultar ni mutar períodos, y ningún request acepta `validFrom`, `validUntil` o `effectiveAt`.

El flujo HTTP validado cubre login Admin, Student, Plan, Subscription, dos Schedules/Enrollments, generación de ClassSessions, desactivación y reactivación en instantes controlados, reconciliación tardía y lecturas históricas Admin. No se exponen períodos ni se registran tokens o cookies en auditoría.
