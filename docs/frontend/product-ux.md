> Actualización Etapa 7.1: este documento conserva el diseño e inspección de F0. Para disponibilidad actual de endpoints y brechas, prevalecen [backend-contract-map](backend-contract-map.md) y el [contrato de integración](../frontend-integration-contract.md). No se inició Frontend F1.

# Product UX — Fase 0

Estado: definición de producto; sin implementación. [Contratos inspeccionados](backend-contract-map.md), [navegación](information-architecture.md) y [cobertura de la fase](README.md).

## Usuarios y trabajos concretos — F0.1

| Rol | Cuando… quiero… para… | Respuesta de producto |
| --- | --- | --- |
| Admin | Antes de una clase quiero abrirla y mostrar el QR, sin recorrer módulos. | Hoy → clase → Mostrar QR. |
| Admin | Cuando una alumna paga quiero registrar el importe en su contrato correcto. | Buscar alumna → resumen contractual → Registrar pago. |
| Admin | Cuando preguntan cuánto queda quiero distinguir clases restantes de saldo por pagar. | Dos resúmenes separados con unidades y período. |
| Admin | Cuando llega una alumna nueva quiero guardar su nombre y seguir atendiendo. | Alta de un campo; contrato y acceso opcionales después. |
| Admin | Cuando autorizo recuperar una falta quiero elegir una clase admisible sin gestionar identificadores. | Ausencia → elección de destino → autorización explícita; disponibilidad condicionada por API-05. |
| Admin | Cuando hay un error quiero corregir el resultado conservando quién lo cambió y por qué. | Corrección contextual y consulta del historial inmutable. |
| Admin | Cuando preparo el próximo período quiero configurar horarios y generar sus clases. | Gestión → Horarios; generación explícita desde Clases. |
| Student | Al abrir la app quiero saber cuándo voy y qué puedo hacer ahora. | Inicio con clase abierta o próxima, horario y acción contextual. |
| Student | Quiero saber cuántas clases me quedan sin interpretar contratos internos. | Resumen del período identificado; dato desconocido nunca equivale a cero. |
| Student | Al llegar quiero escanear y saber si quedé presente. | Scanner contextual → confirmación persistente con clase y hora. |
| Student | Si falté quiero entender el resultado y la recuperación autorizada. | Historial y enlace a recuperación; no autoservicio de autorización. |

## Principios y decisiones

Dos experiencias: Admin gestiona; Student consulta y registra presencia. Los permisos reales los decide el backend, incluso cuando la interfaz oculta acciones.

Una acción primaria por contexto. Mostrar QR durante la ventana; registrar pago desde un contrato; escanear desde una clase habilitada. Las operaciones excepcionales están en acciones secundarias con consecuencia explícita. Se conserva el contexto de alumna/clase al navegar y regresar.

Estado efectivo y fuente de verdad siempre visibles en lenguaje humano. Clases usadas incluye Attendance normal PRESENT y ABSENT. Una recuperación no añade consumo. Una corrección no devuelve clases. Dinero adeudado no equivale automáticamente a falta de elegibilidad. Fechas, cupos, autorización y saldo se revalidan en servidor.

La interfaz propone y explica; no inventa elegibilidad ni reconstruye históricos incompletos. Cada vista distingue dato existente, propuesta de lectura futura y dato no disponible. No se diseñan indicadores calculados sobre una sola página como si fueran totales.

## Hoy Admin — F0.3

Orden de lectura: fecha del negocio → clase en curso/ventana abierta → resto de clases de hoy → búsqueda rápida de alumna. Cada fila muestra horario y estado; abrir clase es el acceso primario, Mostrar QR sólo cuando la ventana consultada lo permite. Si hay varias clases abiertas, elegir por horario, nunca adivinar una.

Fuente: listado de ClassSessions filtrado por día; Attendance de las clases visibles para estado/esperadas. Consultas limitadas a contenido visible y con concurrencia acotada; sin cargar rosters de todo el mes. Capacidad y cantidad esperada se muestran como conceptos distintos. No llamar “lugares libres” a capacidad menos esperadas.

No incluir gráficos de ingresos, deuda global o recuperaciones próximas como bloques obligatorios: los agregados/filtros necesarios no están disponibles. El pago relevante aparece al entrar a la alumna. Las recuperaciones del día aparecen en el roster de su destino. Vacío: “No hay clases programadas para hoy”, con Ver otras fechas y Generar clases como acción secundaria Admin; consultar nunca genera clases.

## Detalle de alumna — F0.4

Nivel 1: nombre, actividad y resumen del contrato seleccionado: plan, período, incluidas/usadas/restantes, acordado/pagado/por pagar. Contratos futuros y anteriores se distinguen del período actual; ACTIVE por sí solo no significa que el período haya empezado. Si hay varios contratos, selector por período, sin sumar allowances de períodos distintos.

Nivel 2: horarios y recuperaciones; acceso a pagos y contrato completo. Próximas clases y Attendance reciente son parte del objetivo de producto, pero requieren las lecturas faltantes API-04 para cobertura completa. No simularlas recorriendo todos los rosters ni usando AuditLog.

Nivel 3: contratos anteriores, pagos anulados, historial de correcciones contextual, accesos y actividad administrativa. El encabezado mantiene una acción contextual principal y un menú “Más acciones” para acceso/desactivación. Sin contrato: “Todavía no tiene un contrato”, CTA Crear contrato. Sin resultados de búsqueda: no es “sin alumnas”.

Mobile: secciones apiladas, con selector “Ir a…” y carga por sección; no seis pestañas horizontales comprimidas. Desktop: mismo orden con índice lateral opcional. No cargar simultáneamente todos los históricos. La información financiera mantiene sus tres rótulos junto a sus importes.

## Listado y alta — F0.5–F0.6

Listado: búsqueda por nombre, filtro Activas/Inactivas/Todas, paginación y filas compactas. Desktop puede alinear nombre/estado/acción; mobile conserva nombre y estado en dos líneas. No añadir saldo ni plan a cada fila mediante una consulta por alumna. Nombres duplicados son válidos: abrir el detalle y verificar contexto contractual/horario; no inventar un documento identificatorio obligatorio.

Alta: nombre completo, 2–120 caracteres según DTO, con normalización del backend; Guardar y Cancelar. Sin wizard ni datos inventados. Éxito abre detalle y ofrece Crear contrato / Generar acceso; ambas opcionales. El listado conserva filtro y página al volver, ajustando la página si dejó de existir.

## Decisiones de alcance y riesgos — F0.47

| Prioridad | Riesgo | Mitigación y validación futura |
| --- | --- | --- |
| P0 | Home Student muestra cero cuando desconoce contrato. | API-02; distinguir no disponible/no contrato/sin restantes con evidencia. Probar upcoming vacío. |
| P0 | Historial incompleto parece exhaustivo. | API-03/04; no usar caché o roster como historial. Pantalla condicionada hasta contrato de lectura. |
| P0 | Pago repetido tras mala conexión. | Misma clave y cuerpo en retry; estado incierto visible; comprobar listado antes de crear otra intención. |
| P0 | Cupo visual induce autorización inválida. | API-05; disponibilidad real pendiente, POST final sigue siendo autoridad. Probar última plaza concurrente. |
| P1 | Hub Admin tiene demasiadas acciones en celular. | Jerarquía por niveles; prueba de búsqueda → pago y clase → QR en ancho pequeño. |
| P1 | Rotación QR rechaza lectura o usa secreto vencido. | Un emisor activo, renovación controlada, ocultar vencido; errores genéricos fieles al contrato. |
| P1 | Corregir se confunde con alta manual. | Acciones distintas según existencia de Attendance; motivo, transición visible e historial. |
| P1 | Recovery se confunde con estado Presente. | Etiqueta de origen adicional; estado efectivo independiente. |
| P1 | Alumna cree que Ausente no consume. | Explicación junto al resumen y recuperación: clase habitual registrada consume, recuperación no añade. |
| P1 | Sesión Student vencida deja un callejón sin salida. | Pedir nuevo acceso a profesora; no prometer refresh ni recuperar contraseña Student. |
| P1 | Mutación termina pero falla el refresco. | Mantener éxito confirmado y avisar que el resumen está desactualizado; nunca repetir operación para refrescar. |
| P2 | QR/cámara poco accesibles o conexión débil en sala. | Instrucciones, permisos recuperables y ayuda de profesora con PRESENT manual dentro de ventana. |
| P2 | Fecha cambia por zona del dispositivo. | Zona IANA del negocio en configuración pública futura; fechas civiles no convertidas como UTC arbitrario. |

Estas son hipótesis de diseño para validar con tareas reales en Fase 1 y posteriores, no resultados de entrevistas ni pruebas de usabilidad ya realizadas.
