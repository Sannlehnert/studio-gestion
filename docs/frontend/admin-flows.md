> Actualización Etapa 7.1: este documento conserva el diseño e inspección de F0. Para disponibilidad actual de endpoints y brechas, prevalecen [backend-contract-map](backend-contract-map.md) y el [contrato de integración](../frontend-integration-contract.md). No se inició Frontend F1.

# Flujos Admin — F0.7–F0.16 y F0.44

Contrato transversal: [errores y estados](ux-states.md). Todas las mutaciones esperan confirmación backend; conservar formulario durante un error recuperable. Cada flujo usa sesión Admin y guarda el contexto para volver. Rutas API completas en [mapa](backend-contract-map.md).

## A1. Login

- Entrada: `/admin/login` o sesión perdida al intentar una ruta Admin.
- Pasos: email y contraseña → validación local de formato/campos → POST login con credenciales → GET me cuando haga falta confirmar identidad → Hoy o retorno interno autorizado.
- Decisiones: si ya hay sesión Admin, ir al destino; si es Student, ofrecer cambiar de acceso explícitamente. No autocompletar contraseñas propias ni impedir gestores de contraseñas.
- Estados/errores: botón Ingresar ocupado; error de credenciales genérico, 429 con espera, red permite intentar de nuevo; no revelar si existe el email.
- Salida: contexto Admin confirmado y formulario secreto descartado. No token en almacenamiento cliente.

## A2. Crear alumna y emitir acceso

- Entrada: Alumnas → Agregar alumna.
- Pasos: nombre completo → Guardar → POST students → detalle. Opciones siguientes Crear contrato, Generar acceso o volver.
- Decisiones: no exigir contrato/acceso durante alta; nombres repetidos no son error de unicidad. Si no se sabe si guardó por corte de red, revisar búsqueda/listado antes de enviar otra alta.
- Estados/errores: validación junto al nombre, envío bloquea doble clic; error de servidor conserva nombre. Vacío inicial invita al alta; búsqueda sin coincidencias invita a cambiar filtro.
- Salida: alumna identificada por respuesta, detalle visible.
- Acceso opcional: emitir desde menú contextual, elegir vigencia dentro de 1–30 días (default 7), POST access. Mostrar enlace sólo en memoria para copiar/compartir deliberadamente; no autoenviar mensajes. Confirmar copia sin registrar URL en telemetría. Al salir se descarta; no existe listado para recuperar enlaces anteriores. Revocar sólo un acceso pendiente de referencia conocida: impide activarlo, no cierra sesiones ya establecidas. Un enlace consumido no se revoca con esta operación. Desactivar alumna sí revoca sesiones y accesos pendientes; reactivarla no los revive.

## A3. Crear contrato

- Entrada: detalle de alumna → Crear contrato.
- Pasos: alumna fija → elegir plan activo → período → precio acordado → revisar clases incluidas y precio de referencia frente al acordado → Crear contrato → detalle.
- Decisiones: mostrar “Precio del plan” y “Precio acordado” por separado si difieren. Valores contractuales de respuesta prevalecen; no usar “snapshot” en la UI. Si agreedPrice se omite, el backend toma el precio actual del plan; no enviar campos de clases/precio de referencia como editables. Mostrar fechas del período y límite final sin ambigüedad: el fin es exclusivo. Un selector de último día incluido debe convertir al inicio del día siguiente en la zona del negocio. No atribuir el contrato futuro al período actual sólo por ACTIVE.
- Estados/errores: planes cargando; sin planes utilizables ofrece ir a Gestión/Planes y volver. Validación fecha/importe inline. Conflicto de período, actividad o plan exige refrescar contexto y corregir selección, sin reemplazar contrato previo.
- Salida: contrato creado; siguientes acciones Registrar pago y Asignar horario, opcionales. Cambios posteriores del Plan no cambian lo pactado.

## A4. Registrar y consultar pago

- Entrada: alumna → contrato elegido → Registrar pago. Encabezado con alumna, plan y período evita imputación a otro contrato.
- Pasos: mostrar total acordado, pagado, restante → ingresar importe, fecha/hora de pago y, opcionalmente, método (Efectivo/Transferencia/Otro) y nota → Registrar pago → POST con Idempotency-Key UUIDv4 → confirmar respuesta → actualizar pagos/resumen. paidAt exige instante con zona; prellenar ahora y permitir editar fecha/hora, sin inventar medianoche para un pago histórico.
- Decisiones: no pedir estado CONFIRMED, moneda derivada, actor ni IDs editables. Formatear ARS sin perder decimales; importe positivo de hasta dos decimales, sin superar saldo confirmado, y fecha/hora no futura. El servidor revalida saldo al guardar; si cambió concurrentemente, no ajustar importe sin decisión Admin. Crear una clave por intención de pago, conservar clave y cuerpo exacto durante retry; cambios del cuerpo representan nueva intención sólo después de aclarar resultado anterior.
- Estados/errores: enviando → confirmado o resultado incierto si se cortó la respuesta. La incertidumbre no se presenta como rechazo: consultar pagos y reintentar exactamente la misma intención cuando corresponda. Si se recarga y se perdió la clave, revisar registros antes de nuevo envío. Conflicto de saldo/doble operación obliga a releer resumen. API-01 condiciona operación cross-origin.
- Salida: “Pago registrado”, importe/fecha visibles y resumen actualizado; si falla sólo el refresco, conservar éxito y mostrar resumen pendiente de actualizar.
- Anulación: detalle → Más opciones → Anular pago → mostrar importe, contrato y explicación “El pago queda anulado y permanece en el historial; dejará de contar en el total pagado” → motivo obligatorio de 3–500 caracteres → confirmar → POST void. No editar importe histórico ni ofrecer borrado. No fingir devolución de dinero: VOID es estado del registro.

## A5. Asignar horario y preparar clases

- Entrada: contrato → Horarios → Asignar horario.
- Pasos: elegir recurrencia por día/hora/capacidad → vigencia dentro del período → revisar → POST enrollment → mostrar asignación. Para cambiar: seleccionar inscripción existente → nuevo horario y fecha efectiva → POST change-schedule; para finalizar, usar end.
- Decisiones: traducir día ISO a nombre y horas HH:mm; “Martes, 19:00–21:00”. Si la UX pide último día incluido, adaptar al límite civil exclusivo de validUntil, sin aritmética UTC de 24 h. Mantener límites reales de DTO y no permitir cambios históricos arbitrarios.
- Estados/errores: sin horarios invita a Gestión/Horarios; conflicto por cupo, superposición o Recovery exige recargar y elegir otra opción. No resolver automáticamente cancelando una recuperación.
- Salida: asignación vigente confirmada, no Attendance creada.
- Gestión de recurrencias: lista semanal agrupada por día; formulario de día, inicio, fin y capacidad. Activación/desactivación secundaria. No calendario complejo ni drag-and-drop que oculte consecuencias. Cambiar defaultCapacity no reescribe capacidad de clases generadas.
- Generación: Clases → Generar clases → rango civil hasta 366 días → aclarar que abarca todos los horarios activos → generar → informar creadas/existentes. El DTO sólo admite dateFrom/dateTo, sin selección de horarios. Consultar un calendario no genera nada; repetir generación respeta unicidad del backend.

## A6. Abrir clase y operar roster

- Entrada: Hoy o Clases por fecha → fila de clase.
- Pasos: GET detalle y Attendance → fecha/hora/estado/capacidad → totales y lista con nombre, estado efectivo y origen → elegir acción contextual.
- Decisiones: mostrar “Esperadas” separado de capacidad. PRESENT “Presente”; ABSENT “Ausente”; PENDING “Pendiente”; UNRESOLVED “Resultado pendiente de resolver”; NOT_REQUIRED_INACTIVE “No requerida por inactividad”. “Recuperación” es etiqueta adicional al resultado. No generar ABSENT desde reloj cliente. attendanceRequired y window determinan mensajes, no sólo el estado de clase.
- Estados/errores: carga estructural; sin esperadas no significa alumnos ausentes ni cupo totalmente libre. 404 vuelve a Clases; cierre durante consulta actualiza opciones; error conserva última lectura con aviso sin afirmar actualidad.
- Salida: clase correcta abierta; Mostrar QR es primaria durante ventana. Un roster posterior al cierre con UNRESOLVED pide revisar estado, no ofrece crear asistencia histórica.
- Operaciones secundarias: capacidad, hora y cancelar clase con resumen de consecuencias y motivo según DTO. Mostrar que la cancelación puede volver no disponibles recuperaciones; no afirmar que las cancela manualmente ni que borra asistencia. El servidor rechaza operaciones incompatibles.

## A7. Mostrar y renovar QR

- Entrada: detalle con ventana OPEN → Mostrar QR.
- Pasos: abrir pantalla propia → pedir challenge bajo demanda → representar localmente QR grande sobre blanco opaco → mostrar clase, horario, estado y cuenta orientativa hasta expiresAt → renovar mientras esté visible si sigue habilitado.
- Decisiones: un emisor activo por pantalla, sin requests superpuestos. La política cliente puede solicitar renovación cerca del vencimiento con margen configurable y ajustar tras validación de latencia; no convertir medio TTL en regla ni emitir cada render/recarga automática. Mantener QR anterior sólo mientras no expiró y hasta recibir reemplazo; el servidor tolera rotación acotada, pero otro emisor puede revocarlo. Varias alumnas usan el mismo QR; no emitir uno por alumna.
- Estados/errores: generando sin QR viejo inventado; expirado oculta imagen; renovación fallida permite “Renovar QR” manualmente. 429 espera, 401 vuelve a login, cierre/cancelación quita QR y muestra motivo. No mostrar éxito de emisión antes de respuesta. Countdown local no prueba validez y no hay serverTime en contrato.
- Salida: QR vigente recibido y escaneable. Al salir no seguir emitiendo; no guardar token en URL, historial, logs, caché persistente ni ejemplos. El backend no entrega imagen. No afirmar prueba de proximidad física o seguridad garantizada.

## A8. Corregir Attendance existente

- Entrada: resultado en roster/detalle → Más opciones → Corregir asistencia.
- Pasos: cargar Attendance e historial estructurado → mostrar resultado efectivo y original separados → elegir Presente/Ausente → motivo obligatorio de 3–500 → revisión “De Ausente a Presente; la corrección quedará registrada en el historial” → POST corrections → actualizar resultado e historial.
- Decisiones: el formulario y botón “Confirmar corrección” bastan como confirmación sensible; no otro modal genérico. No editable source, autor, fecha original, consumo o contrato. Si target equivale al estado efectivo, evitar envío innecesario; backend responde no-op si llega.
- Estados/errores: fuera de ventana puede corregirse resultado existente. Clase cancelada anómala, Recovery no cancelada u otros conflictos bloquean. Si hay Recovery pendiente, ir a ella para evaluar cancelación explícita; con resultado no se desbloquea cancelándola. Corte de red: releer resultado/historial antes de reenviar; no retry automático que pudiera deshacer una corrección concurrente.
- Salida: estado efectivo actualizado, original y source conservados, secuencia/motivo/autor/fecha en historial. Nuevas correcciones se agregan, no editan la anterior. Ambas transiciones normales conservan una clase usada; las de Recovery conservan cero.

## A9. Autorizar recuperación

- Entrada: Attendance habitual Ausente → Autorizar recuperación.
- Pasos: mostrar alumna, ausencia y período → seleccionar clase futura posterior al origen y dentro del período, distinta y programada → revisar fecha/hora y disponibilidad → POST recovery con sólo targetClassSessionId → detalle y enlaces a alumna/destino.
- Decisiones: no pedir IDs manualmente, no permitir origen Recovery, no crear una cadena ni repetir clase habitual en destino. API-05 impide garantizar candidatos válidos y lugares libres hoy: diseño objetivo exige lectura de disponibilidad; alternativa limitada rotula “Cupo a confirmar” y sólo prefiltra restricciones observables. Destino visiblemente inválido se excluye o queda deshabilitado con razón verificable, nunca una razón inventada.
- Estados/errores: sin candidatas invita a otra fecha dentro del contrato; no prometer extensión. Último lugar tomado, origen corregido o contrato cambiado: 409, releer contexto y ofrecer otra elección. Misma autorización puede ser replay; mostrar registro existente. Otro destino requiere cancelar anterior explícitamente antes de nueva autorización.
- Salida: “Recuperación autorizada” con fecha/hora, sin prometer notificación enviada. Consultable en alumna, Student y roster destino. No cambia ausencia original ni descuenta otra clase.
- Cancelar: detalle → cancelar con motivo y consecuencia de liberar autorización sin borrar historial; sólo condiciones permitidas por backend. Resultado existente no se cancela. UNAVAILABLE por clase/contrato no se etiqueta CANCELLED salvo cancelación manual real.

## A10. Consultar historial y auditoría

- Entrada: Attendance → Historial de correcciones; o Gestión → Auditoría; o enlace de entidad que precarga filtros.
- Pasos: elegir rango de fechas, tipo de actor, acción y entidad → GET audit-logs paginado → resumen legible → detalle de campos públicos permitidos y recurso si hay acceso. Historial de correcciones usa GET corrections, no AuditLog.
- Decisiones: convertir fecha final inclusiva elegida a dateTo exclusivo en zona del negocio. No búsqueda libre de metadata. ActorType SYSTEM “Sistema”; ADMIN “Administración”; STUDENT “Alumna”. Añadir nombre sólo si realmente disponible; actorId no es un nombre. No selector de todos los Admin si no existe lectura para poblarlo. Identificadores precargados desde contexto o filtro avanzado técnico opcional, no tarea cotidiana de escribir UUIDs.
- Estados/errores: sin resultados invita a quitar filtros; 403 no expone metadata; evento desconocido conserva fecha/tipo con “Detalle no disponible”, sin JSON crudo ni inventar atributos descartados. Paginación estable y no exportación inexistente.
- Salida: explicación de quién/tipo de actor, qué cambió, sobre qué registro y cuándo. Ejemplo de transición: “Cambió asistencia de Ausente a Presente”. El historial global de asistencia de alumna sigue condicionado por API-04.

## A11. PRESENT manual contextual — F0.13

- Entrada: fila sin Attendance dentro de ventana → Más opciones → Registrar presente desde administración.
- Pasos: confirmar nombre/clase/origen → motivo obligatorio 3–500 → Registrar presente → endpoint Admin de clase/alumna, sin challenge.
- Decisiones: si existe Attendance, usar A8; no sobrescribir. Fuera de ventana no crear registro histórico. Si ya existe ABSENT después del cierre, corregirlo con motivo; si no existe resultado, mostrar incidencia de integridad.
- Estados/errores: cierre durante envío, pérdida de elegibilidad, allowance normal agotado o registro concurrente dan conflicto; refrescar roster. Recovery válida admite cero restantes. No asumir manual confirmado si ganó Student: mostrar resultado real recibido por lectura y no inventar autor.
- Salida: PRESENT original source ADMIN y auditoría confirmados; normal consume una clase, Recovery ninguna. No botón dominante repetido en cada fila.
