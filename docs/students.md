# Students

## Alcance implementado

StudentsModule administra el ciclo de vida de una alumna sin borrar su historial. Solo Admin puede crear, listar, buscar, consultar, editar, desactivar y reactivar. La respuesta pública conserva `id`, `fullName`, `isActive`, `createdAt` y `updatedAt`; los períodos operativos son internos.

No se agregaron email, contraseña, documento, domicilio ni fecha de nacimiento porque no existen requisitos de producto para esos datos.

## Estado e invariantes

`StudentActivePeriod` es la fuente de verdad temporal. Cada fila representa un intervalo semiabierto `[validFrom, validUntil)`; `validUntil=null` identifica el período vigente. Los huecos entre períodos significan inactividad. `Student.isActive` se mantiene como proyección actual para autorización y listados.

- Una creación siempre empieza activa y crea su primer período desde el reloj del backend. El request no puede elegir ID, estado, timestamps ni relaciones.
- Desactivar cierra el único período abierto y cambia `isActive=false` en la misma transacción. Reactivar crea un período nuevo y cambia `isActive=true` también atómicamente.
- PostgreSQL prohíbe períodos invertidos, solapamientos, más de un período abierto por alumna y el borrado directo del historial. Triggers diferidos comprueban al commit que la proyección coincida con la existencia de un período abierto.
- Desactivar no borra la Student ni toca Subscription, Enrollment, Attendance o Recovery.
- Desactivar revoca, en la misma transacción, todas sus Session con rol STUDENT aún no revocadas y todos sus StudentAccess PENDING. Así no puede seguir operando ni reutilizar credenciales al reactivarse.
- SessionGuard exige una Student activa además de una Session válida. Esta comprobación cubre carreras y registros heredados que no hayan sido revocados.
- No se puede emitir StudentAccess para una Student inactiva. Un token emitido antes de la desactivación tampoco puede activarse después.
- Reactivar no revive sesiones, enlaces, ausencias, inscripciones, suscripciones ni estados anteriores. Admin debe emitir un acceso nuevo cuando corresponda.
- Desactivar, reactivar o guardar el mismo nombre otra vez es idempotente: devuelve el estado actual sin duplicar AuditLog.

Las operaciones mutables sobre una misma Student toman un bloqueo de fila antes de leer el reloj de la transición. Emisión y activación de accesos usan el mismo orden de bloqueo. Esto serializa cambios de estado, emisión, activación y reconciliación sin confiar en el orden de llegada al controller.

## Nombre

`fullName` admite de 2 a 120 caracteres. Se recorta el espacio de los extremos y las secuencias de whitespace se convierten en un espacio. No se cambia la capitalización ni se exige unicidad: dos personas pueden compartir nombre.

La validación se aplica en DTOs y los campos se mapean explícitamente. La migración no agrega un CHECK de longitud porque podría rechazar filas históricas desconocidas; la base de desarrollo no estaba disponible para auditar esos valores. Esta decisión debe revisarse si aparecen otras vías de escritura fuera del backend.

## Listado, búsqueda y paginación

`GET /api/v1/admin/students` usa paginación por página/offset. El uso esperado es un listado administrativo pequeño y navegación directa por páginas; cursor agregaría estado de contrato sin una necesidad real.

- `status`: `active` por defecto, `inactive` o `all`.
- `page`: 1–100000, default 1.
- `limit`: 1–100, default 20.
- `search`: opcional, 1–80 caracteres después de normalizar whitespace.
- Orden estable: `fullName ASC`, luego `id ASC`.
- Respuesta: `items` y `meta` con `page`, `limit`, `total` y `totalPages`.

La búsqueda usa `contains` case-insensitive parametrizado por Prisma/PostgreSQL. No es full-text y su comportamiento de acentos depende de la collation de la base. No se agregó un B-tree de nombre porque no acelera de forma general una consulta `%texto%`; antes de necesitar más escala se debe medir y evaluar `pg_trgm`.

El total y la página se leen en una transacción `REPEATABLE READ` para devolver metadata de una misma fotografía lógica.

## API administrativa

| Método | Ruta                                    | Resultado                        |
| ------ | --------------------------------------- | -------------------------------- |
| POST   | `/api/v1/admin/students`                | 201, crea Student activa         |
| GET    | `/api/v1/admin/students`                | 200, lista/busca con paginación  |
| GET    | `/api/v1/admin/students/:id`            | 200 o 404                        |
| PATCH  | `/api/v1/admin/students/:id`            | 200, modifica solamente fullName |
| POST   | `/api/v1/admin/students/:id/deactivate` | 200, operación idempotente       |
| POST   | `/api/v1/admin/students/:id/reactivate` | 200, operación idempotente       |

No existe DELETE. Los endpoints de StudentAccess mantienen sus rutas anteriores bajo `/api/v1/admin/students/:studentId/access`.

## Auditoría

Acciones: `STUDENT_CREATED`, `STUDENT_UPDATED`, `STUDENT_DEACTIVATED` y `STUDENT_REACTIVATED`.

Creación registra el nombre; actualización guarda solo nombre anterior y posterior; desactivación y reactivación registran `effectiveAt`; desactivación además guarda cantidades de accesos y sesiones revocados. No se guardan tokens, hashes, cookies ni objetos relacionados.

## Migración del historial

`20260904233000_historical_student_eligibility` reconstruye una sola vez los períodos previos con `Student.createdAt` y los eventos `STUDENT_DEACTIVATED`/`STUDENT_REACTIVATED`. El runtime no consulta `AuditLog` para decidir elegibilidad. Si el orden de eventos es inválido, hay timestamps simultáneos ambiguos o el estado derivado no coincide con `Student.isActive`, la migración aborta antes de crear la tabla. Una alumna inactiva sin una desactivación trazable no se aproxima ni se marca desde una fecha inventada.
