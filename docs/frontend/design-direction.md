> Actualización Etapa 7.1: este documento conserva el diseño e inspección de F0. Para disponibilidad actual de endpoints y brechas, prevalecen [backend-contract-map](backend-contract-map.md) y el [contrato de integración](../frontend-integration-contract.md). No se inició Frontend F1.

# Dirección visual, accesibilidad y componentes conceptuales

F0.26–F0.31, F0.37–F0.39 y F0.46. Propuesta, sin pantallas finales, CSS, componentes ni dependencias.

## Dirección

Minimal editorial: jerarquía por tipografía, alineación y espacio; listas compactas, pocas superficies. Una identidad humana y ágil, sin panel corporativo recargado. Spatial moderado: profundidad sólo para separar menú, diálogo o acción flotante del contenido. Liquid glass selectivo: navegación u overlay con respaldo opaco; el área que contiene el QR siempre blanca y sólida. El glass no debe reducir contraste ni mostrar datos superpuestos confusos.

Evitar cards dentro de cards, gradientes decorativos, métricas sin acción, sombras grandes, blobs y una pill por cada dato. El énfasis numérico se reserva para restantes, precio/saldo relevante y horario próximo; no convertir todo número en KPI. Marca verde petróleo, fondos neutros cálidos y texto oscuro. Los colores son una propuesta de tokens a validar en Fase 1, no identidad visual aprobada por pruebas con usuarios.

## Tokens conceptuales — F0.28

| Token | Propuesta | Uso |
| --- | --- | --- |
| primary | #0B6B62 | Acción principal y selección; texto blanco encima. |
| background | #F7F8F6 | Fondo general. |
| surface | #FFFFFF | Formularios, listas cuando necesitan delimitación, QR. |
| text | #152622 | Texto principal. |
| muted | #53645F | Información secundaria legible; no opacidad arbitraria. |
| border / border-strong | #CCD5D1 / #77847E | Separador decorativo / control que necesita límite reconocible. |
| success | #146342 sobre #E9F4EC | Presente, operación confirmada; siempre con texto. |
| warning | #795100 sobre #FFF3D6 | Pendiente o situación a revisar. |
| danger | #A12632 sobre #FDECEF | Ausente, error, acción destructiva cuando corresponda al contexto. |
| info | #205C8F sobre #EAF2FA | Recuperación como origen e información contextual. |
| neutral | text/muted sobre surface/background | Finalizado, cancelado o inactivo cuando sólo se informa estado. |

Paleta cerrada inicial; no un color por entidad. Separadores decorativos no sustituyen bordes funcionales. El foco usa anillo primary con separación visible para funcionar sobre botones oscuros; nunca anillo pegado del mismo color. No aplicar transparencia a texto de bajo contraste.

| Familia | Escala inicial | Regla |
| --- | --- | --- |
| Espacio | 4, 8, 12, 16, 24, 32, 48 | 4 para detalles, 16 para ritmo de contenido, 24/32 para secciones; mobile inicia en 16 de margen. |
| Radius | 8, 12, 20 | Control, superficie, overlay; forma circular sólo avatar/icono cuando corresponda. |
| Sombra | Ninguna / nivel 1 / nivel 2 | Contenido plano; nivel 1 menú flotante; nivel 2 diálogo. Parámetros exactos en Fase 1. |
| Blur | 0 / 12 | Sólo capa flotante con alternativa opaca; no sobre QR ni datos financieros. |
| Movimiento | 0 / 120 / 180 ms | Respuesta de control / transición breve; sin movimiento ornamental continuo. |
| Capas | contenido 0, sticky 10, navegación 20, menú 30, backdrop 40, diálogo 50, aviso 60 | Orden semántico; avisos no capturan foco ni cubren controles importantes. |

## Tipografía y números — F0.29

Una familia de sistema sans serif como base; no requiere descargar fuentes. Segunda familia sólo si una necesidad de marca posterior lo justifica. Pesos normal/medio/semibold, sin catálogo de variaciones.

| Rol | Tamaño / interlínea inicial | Aplicación |
| --- | --- | --- |
| Display | 32 / 40 | Encabezado destacado, muy limitado. |
| Heading | 24 / 32 y 20 / 28 | Página y sección. |
| Body | 16 / 24 | Lectura y formulario. |
| Label | 14 / 20 | Campo, acción compacta y fila. |
| Caption | 12 / 18 | Metadato no esencial; nunca único lugar de una restricción crítica. |
| Numeric emphasis | 32 / 40, cifras tabulares | Restantes o importe principal, con unidad y contexto cercanos. |

Importes alineados a la derecha en columnas y con formato es-AR/ARS; preservar decimal exacto del backend, no sumar dinero con punto flotante. Horas en 24 h, “martes 19:00–21:00”; fechas con día/mes y año cuando evita ambigüedad. Zona IANA del negocio uniforme y explícita cuando pueda confundirse con dispositivo; no hardcodear un offset como sustituto de zona. Fechas civiles se conservan civiles. Cantidades y horarios usan cifras tabulares; nombres no se cortan sin opción de ver completo.

## Iconografía — F0.30

Familia única de trazos consistentes a seleccionar después: personas (Alumnas), calendario (Clases/Horarios), recibo (Pagos), QR, check (Presente), ausencia con texto, flecha de retorno (Recuperación), ajustes (Gestión) y reloj/historial. Sin iconos decorativos por campo. Navegación siempre con rótulo; botones sólo icono requieren nombre accesible contextual, por ejemplo “Más acciones de Martina”. Tooltip no es el único nombre.

## Sistema de estados — F0.31

| Campo backend | Etiqueta humana | Tratamiento |
| --- | --- | --- |
| Attendance PRESENT | Presente | Check + success. |
| Attendance ABSENT | Ausente | Símbolo distinto + danger; sin juicio moral. |
| Roster PENDING | Pendiente | Reloj + warning; no equivale a falta. |
| Roster UNRESOLVED | Resultado pendiente de resolver | Aviso + warning; anomalía después del cierre, sin alta histórica. |
| Roster NOT_REQUIRED_INACTIVE | No requerida por inactividad | Neutral y explicación contextual. |
| ParticipationOrigin RECOVERY | Recuperación | Info junto al resultado, no en lugar de Presente/Ausente. |
| ParticipationOrigin ENROLLMENT | Clase habitual | Texto secundario cuando ayude a contrastar origen. |
| Subscription ACTIVE / EXPIRED / CANCELLED | Activa / Finalizada / Cancelada | Neutral/info según contexto; período futuro agrega “Empieza el…”. |
| Financial PENDING / PARTIAL / PAID / OVERPAID | Pendiente de pago / Pago parcial / Pagada / Pagado de más | Warning / warning / success / aviso de revisión. OVERPAID no inventa crédito o devolución. |
| Payment CONFIRMED / VOIDED | Registrado / Anulado | Resultado conservado; anulado no es eliminado. |
| ClassSession SCHEDULED / COMPLETED / CANCELLED | Programada / Finalizada / Cancelada | Estado de clase; separado de ventana y asistencia individual. |
| Window UPCOMING / OPEN / CLOSED / CANCELLED | Registro aún no abierto / Podés registrar asistencia / Registro cerrado / Clase cancelada | Acción contextual sólo OPEN y elegibilidad confirmada al mutar. |
| Recovery AUTHORIZED / COMPLETED / MISSED | Autorizada / Realizada / No asistió (Student: No asististe) | Info / success / danger; no cambia consumo original. |
| Recovery CANCELLED / UNAVAILABLE | Cancelada / No disponible | Neutral / warning; causa real visible cuando la respuesta la incluye. |
| Alumna/Plan/Schedule activo/inactivo | Activa/Activo o Inactiva/Inactivo | Texto y estilo neutral; no inferir histórico de actividad actual. |
| ClassAllowance OVERCONSUMED | Registro de clases a revisar | Aviso operativo, sin ajuste cliente. |

source STUDENT/SYSTEM/ADMIN original se traduce sólo donde Admin necesita trazabilidad: “Registrada por alumna / Ausencia automática / Registro manual de administración”. No cambiar source cuando hay corrección. Student no ve esta clasificación técnica.

## Responsive — F0.37 y F0.39

Partir de contenido en 320 px y una columna. Ampliar cuando las tareas lo necesiten, no por marcas de dispositivo. Anchos orientativos de transición 600, 900 y 1200 px a revisar con contenido real; no compromiso de CSS.

| Espacio disponible | Comportamiento |
| --- | --- |
| Pequeño, desde 320 | Filas nombre/estado en dos líneas, formularios apilados y acciones con texto; sin scroll horizontal general. |
| Móvil más amplio | Mismo orden; importes en tres filas o columnas sólo si rótulos no se comprimen; barra inferior con safe area. |
| Intermedio/tablet | Lista y resumen pueden convivir si no estrechan controles; formularios siguen con ancho de lectura cómodo. |
| Desktop | Sidebar Admin y columnas de datos útiles; no estirar formulario ni convertir cada sección en panel. |

Roster usable con una mano, acciones secundarias separadas del estado. Pago con teclado decimal y fecha/hora accesibles. Detalle Student con índice de secciones, sin pestañas desbordadas. QR centrado, quiet zone intacta y tamaño según espacio, no decorado; encuadre válido tanto en monitor como teléfono. En landscape con poco alto reducir elementos auxiliares antes que comprimir ilegiblemente el QR. Cámara y diálogo ocupan viewport disponible con cierre accesible. No bloquear orientación.

## Accesibilidad — F0.38

Objetivo WCAG 2.2 AA: contraste de texto normal 4,5:1, texto grande 3:1 y elementos no textuales relevantes 3:1; teclado, foco visible/no oculto, reflow, etiquetas y errores asociados. Es un objetivo a verificar en implementación, no certificación de esta documentación. [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

El producto elige controles táctiles de al menos 44×44 CSS px para acciones habituales; supera el mínimo AA de 24×24 con sus excepciones. Filas densas mantienen separación de acciones. [Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Decisiones verificables en fases siguientes:

- Orden DOM de lectura coincide con orden visual; landmarks, salto al contenido y un encabezado principal. Rutas anuncian título y sitúan foco sin saltar durante refetch.
- Menús y diálogos funcionan con teclado; foco inicial útil, contención modal y retorno al disparador. Escape cierra edición no enviada; si hay envío en curso, aclarar que salir no cancela operación. Alertas no secuestran foco repetidamente.
- Formularios con labels persistentes, ayudas y errores vinculados; indicar requerido mediante texto. Permitir pegar y usar gestores en login; botón mostrar contraseña con estado accesible.
- Resultado/mutación se anuncia una vez mediante estado accesible. No anunciar cada segundo del QR; anunciar expiración o fallo relevante. Texto e icono acompañan color.
- Reduced motion elimina transiciones no necesarias; conservar comprensión sin animación. Probar zoom de texto 200%, reflow equivalente a 320 px y zoom de página 400% sin perder controles.
- Scanner tiene instrucciones textuales, estado “Buscando código” y salida visible. No exige gestos complejos. Cámara requiere permiso y contexto seguro: la disponibilidad depende del navegador/dispositivo; un fallo ofrece instrucciones y ayuda de profesora. [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- Fallback accesible de operación: profesora registra PRESENT manual si hay elegibilidad y ventana. No presentar la cámara como única manera humana de resolver presencia, ni prometer alternativa fuera de las reglas del backend.

## Inventario conceptual de componentes — F0.46

| Pieza | Reutilización concreta |
| --- | --- |
| Shell por rol y PageHeader | Destinos, cuenta, título y acción primaria con jerarquía común, navegación distinta. |
| FormField y SearchInput | Labels, errores, ayudas y búsqueda de alumnas/filtros. |
| DataList / Pagination | Alumnas, pagos, clases, Recoveries y auditoría; semántica de tabla sólo cuando relaciones de columnas ayudan. |
| StatusLabel / AttendanceStatus | Texto + icono + tono; origen de recuperación independiente. |
| EmptyState / QueryState | Vacío, carga/error y datos desactualizados; nunca vacío para endpoint faltante. |
| ConfirmDialog / ContextActions | Confirmaciones sensibles y menú excepcional con foco accesible. |
| MoneyDisplay / DateTimeDisplay | Formato consistente de importe, instante y fecha civil; sin reglas de dominio. |
| StudentRow / ClassSummary | Filas compactas y contexto reutilizado en Home/lista/detalle. |
| AttendanceRoster / CorrectionHistory | Roster Admin e historia estructurada dentro de attendance. |
| QRChallengeDisplay / ScannerFeedback | Emisión visible y estados de cámara; componentes de feature, no primitivas globales. |

No anticipar librería universal de gráficos, calendario complejo, editor de tablas, formularios por schema o veinte variantes de tarjeta. Se abstrae cuando exista repetición real en los flujos definidos.
