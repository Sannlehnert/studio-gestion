# Schedules, Enrollments y ClassSessions

## Responsabilidades

`Schedule` es una recurrencia semanal del negocio. Guarda día ISO (`1` lunes a `7` domingo), minuto local de inicio y fin, capacidad habitual y estado. Editarlo sólo cambia generaciones futuras; las clases ya materializadas no se recalculan.

`Enrollment` afirma que una Student pertenece a un Schedule durante `[validFrom, validUntil)`, respaldada por una Subscription concreta. Las fechas son fechas civiles del negocio, sin offset. El intervalo propio permite cambiar de horario dentro de un mismo contrato sin modificar el pasado.

`ClassSession` es una clase real. `occurrenceDate` identifica la fecha local de la recurrencia y, junto con `scheduleId`, impide duplicados. `startAt` y `endAt` son instantes UTC; `capacity` es el valor efectivo copiado al generar. Cambiar Schedule nunca modifica este snapshot.

## Tiempo

`BUSINESS_TIMEZONE` es la única zona usada para interpretar recurrencias y contratos en fechas locales. No está hardcodeada en el dominio y se valida al iniciar. La API de Schedule usa `HH:mm`; Enrollment y rangos de generación usan `YYYY-MM-DD`; excepciones de ClassSession usan ISO 8601 con offset o `Z`.

La conversión de una fecha local y un minuto a UTC verifica el resultado contra `Intl`. Si esa hora no existe o aparece dos veces por un cambio de offset, la generación responde 400 en vez de elegir un instante arbitrario. El navegador nunca decide la fecha efectiva.

## Vigencia e histórico

- Una Subscription debe pertenecer a la Student, estar ACTIVE, no haber vencido y contener por completo la vigencia del Enrollment.
- Student y Schedule deben estar activos al crear o mover una inscripción.
- `[validFrom, validUntil)` evita que el cierre y el alta siguiente se superpongan en la fecha de cambio.
- No existe DELETE de estos recursos.
- Finalizar acorta el extremo futuro. No permite reescribir fechas pasadas.
- Cambiar horario cierra el Enrollment original y crea otro con la misma Subscription dentro de una transacción. Repetir exactamente el cambio devuelve el mismo par histórico.
- Desactivar Schedule lo conserva y detiene nuevas generaciones.

PostgreSQL repite las defensas que no dependen de estado externo: CHECK de rangos, FK compuesta Student/Subscription, FK RESTRICT, exclusión GiST de solapamientos y UNIQUE de recurrencia/fecha.

## Generación

`POST /api/v1/admin/class-sessions/generate` recibe un rango local inclusivo de hasta 366 días. Toma los Schedules activos, calcula sus días ISO, convierte inicio/fin a UTC y copia capacidad y referencia.

La operación bloquea los Schedules activos en modo compartido mientras construye el snapshot. Inserta todos los candidatos con `skipDuplicates`; `UNIQUE(scheduleId, occurrenceDate)` decide la carrera final. Dos procesos pueden calcular el mismo candidato, pero sólo uno lo persiste. La respuesta distingue candidatos, creados y ya existentes. Un replay sin cambios crea cero filas y no duplica auditoría.

## Cupo y concurrencia

La expectativa de una ClassSession se deriva de los Enrollment vigentes en `occurrenceDate` cuya Subscription cubría `startAt`. Una Subscription cancelada después del inicio conserva la explicación histórica; una cancelada antes de una clase futura no ocupa cupo.

Schedule serializa altas, cambios y ediciones de capacidad. Una inscripción nueva debe respetar el máximo de intervalos concurrentes y también cada capacidad excepcional ya generada en su vigencia. Bajar `Schedule.defaultCapacity` no puede dejar por debajo inscripciones futuras; bajar `ClassSession.capacity` no puede dejar fuera alumnas esperadas.

No se creó una tabla de reservas. Attendance reutiliza la misma derivación de `expected-students`. Una clase CANCELLED devuelve `attendanceRequired=false`, no genera ausencias y no consume allowance.

## Excepciones y cancelación

Sólo una ClassSession SCHEDULED admite cambio de capacidad o de horario. La excepción de horario debe conservar la misma fecha local de `occurrenceDate`, tener inicio anterior al fin y durar como máximo 24 horas. La identidad de generación no cambia.

Cancelar exige motivo de 3 a 500 caracteres y persiste estado, autor y fecha. El CHECK de PostgreSQL no permite un CANCELLED incompleto ni datos de cancelación sobre otros estados. El replay es idempotente y no reemplaza el motivo original. Una clase con Attendance o ya COMPLETED no puede cancelarse porque alteraría consumo histórico.

## API Admin

| Método y ruta | Uso |
| --- | --- |
| POST `/api/v1/admin/schedules` | Crear recurrencia activa |
| GET `/api/v1/admin/schedules` | Listar por estado/día y paginar |
| GET `/api/v1/admin/schedules/:id` | Consultar detalle |
| PATCH `/api/v1/admin/schedules/:id` | Editar futuras generaciones |
| POST `/api/v1/admin/schedules/:id/activate` | Activar idempotentemente |
| POST `/api/v1/admin/schedules/:id/deactivate` | Desactivar idempotentemente |
| POST `/api/v1/admin/enrollments` | Crear pertenencia temporal |
| GET `/api/v1/admin/enrollments/:id` | Consultar detalle histórico |
| POST `/api/v1/admin/enrollments/:id/end` | Finalizar vigencia |
| POST `/api/v1/admin/enrollments/:id/change-schedule` | Cerrar y crear el nuevo horario |
| GET `/api/v1/admin/students/:id/enrollments` | Listar por Student |
| GET `/api/v1/admin/subscriptions/:id/enrollments` | Listar por Subscription |
| GET `/api/v1/admin/schedules/:id/enrollments` | Listar por Schedule |
| POST `/api/v1/admin/class-sessions/generate` | Materializar un rango idempotentemente |
| GET `/api/v1/admin/class-sessions` | Listar por estado, horario y fecha |
| GET `/api/v1/admin/class-sessions/:id` | Consultar snapshot |
| PATCH `/api/v1/admin/class-sessions/:id/capacity` | Cambiar capacidad efectiva |
| PATCH `/api/v1/admin/class-sessions/:id/time` | Cambiar horario excepcional |
| POST `/api/v1/admin/class-sessions/:id/cancel` | Cancelar con motivo |
| GET `/api/v1/admin/class-sessions/:id/expected-students` | Derivar roster para Attendance |

Todos requieren sesión ADMIN. Los POST/PATCH requieren Origin o Referer permitido. OpenAPI documenta DTOs, filtros, paginación y respuestas sin exponer minutos internos ni cancelledByAdminId.

## Migración

`20260904180000_scheduling_core` reemplaza el modelo provisional. Como los DateTime antiguos de Schedule no definen con certeza una recurrencia local y Enrollment apuntaba a una clase, la migración sólo puede convertir una instalación sin filas de scheduling. Si encuentra Schedule, ClassSession o Enrollment, aborta antes de abrir la transacción destructiva y exige un mapeo manual. El verificador prueba fresh, upgrade vacío y el guard sobre PostgreSQL real.

## Integración con Recoveries

Expected combina Enrollment normal y Recovery válida por Student, contrato e historial. El cupo agrega las autorizaciones a las reservas contractuales habituales; inactividad de Student no libera por sí sola una reserva que podría volver con reactivación. No se agrega Enrollment artificial. Crear/mover Enrollment rechaza cubrir una autorización vigente y controla la capacidad de cada clase generada.

Una Recovery normal no coexiste con pertenencia habitual en el mismo destino; la deduplicación defensiva conserva el consumo normal. Capacidad y cambio horario de ClassSession consultan la misma unión bajo Schedule → ClassSession. Cambiar hora conserva fecha e identidad, revalida contrato/cronología y adapta ventana. Cancelar clase mantiene las Recoveries trazables como UNAVAILABLE, sin ABSENT. Ver [modelo y locks](recoveries.md).
