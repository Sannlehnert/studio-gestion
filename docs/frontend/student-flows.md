> Actualización Etapa 7.1: este documento conserva el diseño e inspección de F0. Para disponibilidad actual de endpoints y brechas, prevalecen [backend-contract-map](backend-contract-map.md) y el [contrato de integración](../frontend-integration-contract.md). No se inició Frontend F1.

# Flujos Student — F0.18–F0.24 y F0.44

Experiencia propia y mobile-first. Sólo lecturas Student y POST de Attendance autorizado; nunca acceder a endpoints Admin para completar datos faltantes. [Brechas API](backend-contract-map.md) y [estados compartidos](ux-states.md).

## S1. Activar acceso

- Entrada: enlace recibido de la profesora con token en fragmento de `/activate`.
- Pasos: capturar token una vez en memoria → quitar inmediatamente fragmento mediante sustitución de URL, antes de analytics/logs → POST activation → recibir cookie de sesión → Inicio y descartar token. No localStorage/sessionStorage ni query params. Si hay una sesión de otro rol conocida, explicar el cambio antes de sustituir acceso; el token continúa sólo en memoria.
- Decisiones: fragmento faltante es detectable localmente: “Abrí el enlace que te compartió tu profesora”. Vencido, revocado, usado e inactividad son situaciones de dominio contempladas, pero todas se presentan como “Este acceso no se puede usar. Pedile uno nuevo a tu profesora”, porque el servidor devuelve el mismo 401.
- Estados/errores: activando, éxito, acceso no utilizable, límite de intentos o problema de conexión. Si la respuesta se perdió, consultar me: una sesión Student confirmada permite entrar sin volver a consumir token; no asumir que una sesión Admin prueba activación. Si no puede confirmarse identidad, explicar incertidumbre y permitir reintento consciente del flujo conservando token sólo mientras permanezca en memoria.
- Salida: Inicio con identidad confirmada, URL limpia y token descartado. Recargar una activación ya consumida no fabrica otra sesión: comprobar sesión existente o pedir enlace.

## S2. Entrar a Inicio

- Entrada: abrir app, sesión Student o S1.
- Pasos: confirmar identidad → próximas clases propias y recuperaciones pertinentes → presentar primero clase con acción habilitada y luego próxima; resumen del contrato identificado → acción contextual.
- Decisiones: responder cuándo voy, cuántas quedan y qué hago ahora. Si hay varias clases abiertas, elegir por fecha/hora explícitamente. Mostrar recuperación como tipo de participación. El contrato para “restantes actuales” requiere API-02; un contrato de una recuperación vieja o de clase futura no se supone vigente.
- Estados/errores: skeleton de fecha/resumen; próximas vacías “No aparecen próximas clases programadas” sin inferir fin de contrato. Resumen desconocido “No pudimos determinar tu período actual”; error de lectura ofrece Reintentar. Cero confirmado se muestra como cero, sin deshabilitar Recovery válida por consumo.
- Salida: clase y acción comprensibles; contador con período cuando esté disponible. Si contrato actual no es descubrible, la vista debe reconocer la limitación y no simular un producto completamente integrado.

## S3. Consultar próxima clase

- Entrada: Inicio → tarjeta de clase o Clases → Próximas.
- Pasos: lista cronológica → detalle propio mediante GET Attendance por ClassSession → fecha/hora, origen habitual/recuperación, ventana y resultado si existe.
- Decisiones: upcoming puede incluir una clase iniciada cuya ventana sigue abierta; no etiquetar toda la lista como “aún no empezaron”. Máximo 20 sin paginación/cursor: “Próximas clases” no promete agenda ilimitada. “Ver todas” sólo si existe lectura que realmente permita todas.
- Estados/errores: UPCOMING explica cuándo abre; OPEN ofrece Escanear QR si no tiene resultado; CLOSED informa cierre; CANCELLED, cancelación. 404 no revela clase ajena. Si ya hay PRESENT, mostrar presencia; si hay ABSENT, no invitar a sobrescribir.
- Salida: entiende cuándo asistir o si debe consultar a profesora; desde Recovery se vuelve al mismo contexto Clases.

## S4. Escanear QR

- Entrada: clase propia → Escanear QR con ventana consultada OPEN.
- Pasos: instrucciones “Apuntá al QR que muestra tu profesora para esta clase” → solicitar cámara por acción de usuaria → scanner → lectura de formato válido → detener nuevas lecturas concurrentes → POST Attendance para la clase seleccionada con challenge → S5.
- Decisiones: preferir cámara trasera cuando el dispositivo permita; selector de cámara sólo si hay alternativas. Solicitar permiso al entrar al flujo, no al abrir Home. Un QR contiene challenge opaco, no clase legible: la clase seleccionada es el contexto; no extraer una identidad inexistente del token. No abrir URLs detectadas ni subir imágenes. Sin ingreso manual de una cadena larga como fallback principal.
- Estados/errores: permiso denegado muestra instrucciones para habilitar y opción Volver; cámara inexistente/ocupada permite intentar otra disponible o pedir ayuda a profesora. Formato ajeno se detecta localmente como “Ese código no es válido para registrar asistencia”. Expirado, revocado o de otra clase comparten “No pudimos validar ese QR. Escaneá el que muestra tu profesora para esta clase”. No elegir una causa exacta por intuición.
- Conflictos: reconsultar clase para verificar cierre/resultado cuando permita explicarlo. “Ya estás presente” sólo con evidencia actual; POST repetido necesita challenge vigente, aunque hubiera resultado previo. Elegibilidad agotada/inválida sin código estable conserva mensaje prudente y contacto con profesora, sin afirmar que debe pagar. 429 pausa intentos; el scanner no entra en bucle de POST.
- Salida: respuesta de Attendance confirmada o resultado verificado por GET tras red incierta. Apagar cámara, limpiar challenge y frames al salir, al perder sesión o al completar. Pedir PRESENT manual a profesora es alternativa operativa dentro de ventana; no elimina las reglas.

## S5. Ver confirmación

- Entrada: S4 con respuesta válida o lectura confirmada de PRESENT tras respuesta perdida.
- Pasos: “Asistencia registrada” → fecha/hora de clase → hora recordedAt del registro y restantes si classSummary está disponible → Volver a Inicio/Ver clase.
- Decisiones: éxito visible en el contenido, no sólo toast efímero. Sin confetti; icono con texto y microtransición breve. Si GET confirma registro preexistente, “Ya tenés registrada tu asistencia” evita atribuirlo a un envío no comprobado. No presentar recordedAt original como fecha de una corrección posterior.
- Estados/errores: actualizando resumen conserva confirmación; fallo de resumen muestra dato temporalmente no disponible. Recargar ruta de confirmación ejecuta lectura, nunca POST; si el estado efectivo cambió, mostrar actual sin mantener éxito viejo de caché.
- Salida: usuaria sabe que quedó registrada y a qué clase corresponde. La presencia de Recovery aclara que no descuenta otra clase.

## S6. Consultar clases restantes

- Entrada: resumen Inicio o clase propia.
- Pasos: identificar contrato desde fuente autorizada → GET class-summary cuando sea necesario → mostrar restantes e incluidas/usadas del mismo período → explicación breve.
- Decisiones: “Las clases habituales registradas, presentes o ausentes, cuentan dentro de tu plan. Las recuperaciones autorizadas no descuentan otra clase”. No gamificación ni números negativos. El período/contrato actual global está condicionado por API-02; en detalle de una clase puede mostrarse “Clases del contrato de esta clase”, sin inventar nombre/fecha de contrato ausentes del DTO.
- Estados/errores: cero confirmado no es error; OVERCONSUMED muestra “Hay una diferencia en tu registro. Consultá con tu profesora”, sin recalcular ni ofrecer ajuste. 404 no identifica contratos ajenos. Resumen cargando no muestra 0 provisional.
- Salida: saldo de clases comprensible y con contexto correcto, separado de dinero.

## S7. Consultar recuperación

- Entrada: Clases → Recuperaciones, aviso contextual en Inicio o enlace propio de detalle.
- Pasos: GET propias paginado → seleccionar → fecha/hora destino y ausencia original → estado operativo → entrar a clase destino y escanear mediante flujo normal si corresponde.
- Decisiones: no botón de autorizar, cancelar ni cambiar destino Student. AUTHORIZED “Autorizada”; COMPLETED “Realizada”; MISSED “No asististe”; CANCELLED “Cancelada”; UNAVAILABLE “No disponible” con causa segura realmente recibida. El estado AUTHORIZED puede esperar reconciliación y no garantiza que la ventana siga abierta: consultar ventana del destino.
- Estados/errores: sin autorizaciones “No tenés recuperaciones autorizadas”. Clase cancelada explica indisponibilidad y contacto con profesora, no reasignación automática. 404 es genérico. Recuperaciones paginadas por autorización no equivalen a próximas por fecha; no filtrar una sola página para afirmar que no existen próximas.
- Salida: sabe a qué clase ir y cuál es el resultado; recuperación se mantiene como participación separada de estado Attendance, no crea nuevas clases disponibles.

## S8. Consultar historial

- Entrada: Historial en navegación objetivo.
- Pasos propuestos: lectura propia paginada por fecha/período → filas con fecha, horario, Presente/Ausente y etiqueta Recuperación cuando corresponda → detalle del resultado.
- Decisiones: MUST HAVE condicionado por API-03; no existe aún el listado para ejecutar este flujo completo. No reconstruirlo desde upcoming, AuditLog, caché o conjunto arbitrario de IDs. No source técnico, IDs, motivo Admin ni metadata en la UI Student. Badge “Corregida por administración” se pospone hasta indicador fiable: originalStatus distinto detecta algunos casos, pero no correcciones múltiples que vuelven al estado inicial.
- Estados/errores diseñados para el contrato futuro: carga, primera página vacía, filtro sin coincidencias, error de página conservando filas previas y 401. Su ausencia actual de endpoint es bloqueo de integración, no estado vacío de datos.
- Salida objetivo: historial real y completo mediante paginación. No declarado disponible en F0.

## Sesión y cierre — F0.24

Sesión Student predeterminada de 30 días absolutos, Admin 24 h; duración configurable por backend. No prometer sesión permanente ni renovación automática. Ante 401, limpiar datos protegidos y llevar Admin a login, Student a acceso requerido con explicación para pedir nuevo enlace. No ofrecer contraseña Student inexistente.

Cerrar sesión: acción visible en cuenta, POST logout y limpiar caché/estado al confirmar. Si falla la red, ocultar datos locales y avisar “No pudimos confirmar el cierre de sesión. Volvé a intentarlo cuando tengas conexión”; no afirmar revocación de cookie HttpOnly desde JavaScript. No conservar formularios sensibles entre identidades. Cerrar la pestaña no equivale a cerrar sesión.
