# Frontend F1 — Sistema visual implementado

Fuente: `apps/frontend/src/shared/styles/tokens.css`. Continúa la dirección de F0: minimal editorial, verde petróleo, neutros y tipografía de sistema. Sin dark mode ni biblioteca de tarjetas. Las superficies son sólidas; no hubo un caso que justificara glass en esta foundation. Profundidad reservada a navegación móvil y diálogo.

## Tokens

Variables CSS integradas con @theme de Tailwind 4: primary/hover, background, surface, ink, muted, border/control-border, success/warning/danger/info y fondos semánticos, backdrop. Tipografía de sistema, escala caption/label/body/section/heading/display; espaciado base de 4 px, radios control/surface/overlay, sombras menu/dialog. Capas semánticas y duraciones 120/180 ms con easing compartido. No colores por entidad. Reduced motion elimina transiciones.

## Componentes

- AppButton: primary/secondary/danger, tipo nativo, busy/disabled. Semántica button y feedback de operación.
- TextField: label persistente, id único, hint/error vinculado, aria-invalid, model tipado y atributos HTML nativos. Sin framework de formularios propio.
- PageHeader: jerarquía y h1 enfocable para cambios de ruta.
- FeedbackState: loading/error/empty, regiones status/alert y retry explícito.
- ConfirmDialog: dialog nativo, nombre/descripción asociados, foco inicial en Cancelar, contención Tab/Shift+Tab, Escape y retorno al disparador. El test real detectó la necesidad de contención explícita.

No se crearon Select, Textarea, Checkbox, tablas universales, Toast ni IconButton sin uso concreto. Etiqueta de estado estructural y navegación se componen con HTML/CSS semántico. F2 agregará primitivas cuando sus formularios las necesiten, conservando tokens y convenciones.

## Layout y responsive

Admin usa sidebar desde 900 px; antes, navegación inferior con cuatro etiquetas. Student usa tres destinos inferiores en mobile y superiores en desktop. Un solo árbol semántico por shell. Safe-area inferior y espacio de contenido evitan que navegación tape el final de página. Formularios mantienen ancho de lectura; la introducción editorial del login sólo aparece cuando hay espacio.

Verificados 320, 390, 768 y 1440 px. Texto largo, diálogo con scroll, foco, controles de 44 px mínimos habituales, text zoom 200% y reflow estrecho. El símbolo de marca e iconos no se comprimen al ampliar texto. No tablas de negocio ni scanner implementados.

## Accesibilidad

Objetivo WCAG 2.2 AA. HTML semántico, skip link, labels reales, nombres de navegación, aria-current de RouterLink, foco visible con separación, estado por texto además de color, contraseña compatible con gestores, reduced motion. El diálogo se valida en Chromium por apertura, cancelación, confirmación, Escape, Tab inverso y devolución de foco.

axe-core comprueba reglas A/AA sobre login, shell y diálogo. Esto no certifica conformidad completa: falta evaluación manual con lector de pantalla real, Safari/Firefox y dispositivos físicos. No se atribuyen esos resultados a la auditoría automatizada. Las capturas son fixtures de foundation, no evidencia de features de negocio.
