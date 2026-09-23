# Frontend — Estado actual

**FRONTEND FOUNDATION = COMPLETE.** Fase 1 implementada y validada. Fase 2 no iniciada.

- [Arquitectura de Foundation](foundation-architecture.md)
- [Design System implementado](design-system.md)
- [Validación final F1](phase-1-validation.md)
- [Instalación y ejecución](../../apps/frontend/README.md)

El contenido siguiente conserva el estado histórico de F0 y sus propuestas; no reemplaza la evidencia ni el alcance actual de F1.

> Actualización Etapa 7.1: este documento conserva el diseño e inspección de F0. Para disponibilidad actual de endpoints y brechas, prevalecen [backend-contract-map](backend-contract-map.md) y el [contrato de integración](../frontend-integration-contract.md). F1 está implementada; ver el cierre actual arriba.

# Frontend Fase 0 — Product UX + Information Architecture

**Fase 0 completa como definición documental.** No implementación frontend ni cambios backend/base de datos. Preparada la propuesta de Fase 1: Foundation + Design System; no iniciada. El MVP conectado completo requiere resolver las brechas de lecturas e integración identificadas.

Fecha de cierre: 16 de septiembre de 2026. Base inspeccionada: commit `42fefa3ecf21247b825674823b3dab9916fa17f7` con working tree limpio al retomar; backend Etapa 7. Se preservan sus decisiones de negocio, seguridad, consumo e histórico.

## Entregables y orden de lectura

1. [Mapa del producto y contratos reales](backend-contract-map.md): F0.0, 69 operaciones actuales, relaciones y brechas API-01 a API-10.
2. [Product UX](product-ux.md): trabajos por rol, principios, Hoy, detalle de alumna y riesgos priorizados.
3. [Arquitectura de información](information-architecture.md): navegación, jerarquía, rutas y límites de estado/feature.
4. [Flujos Admin](admin-flows.md): diez flujos críticos y PRESENT manual adicional, con entradas, decisiones, estados, errores y salidas.
5. [Flujos Student](student-flows.md): ocho flujos críticos, acceso y sesión.
6. [Inventario de pantallas](screen-inventory.md): prioridad separada de disponibilidad real de API.
7. [Estados y feedback](ux-states.md): cargas, vacíos, errores, confirmaciones y concurrencia percibida.
8. [Dirección visual](design-direction.md): tokens conceptuales, estado visual, tipografía, responsive, accesibilidad y componentes conceptuales.

## Cobertura del pedido

| Subetapa | Definición entregada |
| --- | --- |
| F0.0 | backend-contract-map: inspección, endpoints, entidades, relaciones, frecuencia, sensibilidad y contratos. |
| F0.1 | product-ux: JTBD Admin y Student y sus respuestas de producto. |
| F0.2 | information-architecture: cuatro destinos Admin y contrato dentro de alumna. |
| F0.3 | product-ux: Hoy orientado a acción y bloques excluidos por falta de datos. |
| F0.4 | product-ux: hub por niveles y secciones mobile, límites de historial. |
| F0.5 | product-ux: listado, búsqueda, actividad y filas compactas. |
| F0.6 | product-ux y admin-flows A2: alta de nombre sin wizard. |
| F0.7 | admin-flows A3: contrato, precio de referencia/acordado y período. |
| F0.8 | admin-flows A4: pago, lectura financiera, retry y anulación. |
| F0.9 | admin-flows A5: horarios humanos, inscripción y generación. |
| F0.10 | admin-flows A6: clase concreta y roster en sala. |
| F0.11 | admin-flows A6 y design-direction: resultados y origen separados. |
| F0.12 | admin-flows A7: QR, rotación, ventana y estados. |
| F0.13 | admin-flows A11: PRESENT manual con motivo dentro de ventana. |
| F0.14 | admin-flows A8: corrección efectiva e historial inmutable. |
| F0.15 | admin-flows A9: Recovery, candidatos y brecha de disponibilidad. |
| F0.16 | admin-flows A10: auditoría secundaria y metadata legible. |
| F0.17 | information-architecture: tres destinos Student y Recovery integrada. |
| F0.18 | student-flows S2: Inicio y descubrimiento contractual faltante. |
| F0.19 | student-flows S4: cámara, challenge, errores genéricos fieles y salida. |
| F0.20 | student-flows S5: confirmación contextual y refresh sin POST. |
| F0.21 | student-flows S8: historial objetivo y bloqueo de lectura actual. |
| F0.22 | student-flows S1: activación, fragmento, limpieza y sesión. |
| F0.23 | admin-flows A1: login y errores sin enumeración de email. |
| F0.24 | student-flows: logout/vencimiento, duración y falta de refresh. |
| F0.25 | information-architecture: navegación por rol y tamaño. |
| F0.26 | design-direction: identidad clara y humana. |
| F0.27 | design-direction: minimal editorial, profundidad moderada y glass selectivo. |
| F0.28 | design-direction: paleta y escalas de tokens. |
| F0.29 | design-direction: tipografía y números. |
| F0.30 | design-direction: iconografía y nombres accesibles. |
| F0.31 | design-direction: estados reales y etiquetas. |
| F0.32 | ux-states: inline, toast, modal y banner. |
| F0.33 | ux-states: confirmaciones por consecuencia. |
| F0.34 | ux-states: vacíos reales y dato desconocido separado. |
| F0.35 | ux-states: loading y mutaciones sin optimismo de dominio. |
| F0.36 | ux-states: taxonomía y recuperación de errores. |
| F0.37 | design-direction: mobile-first, roster/pago/QR. |
| F0.38 | design-direction: objetivo WCAG 2.2 AA y criterios futuros. |
| F0.39 | design-direction: cambios por espacio de contenido. |
| F0.40 | information-architecture: URLs, retorno seguro y privacidad. |
| F0.41 | information-architecture: responsabilidades por feature. |
| F0.42 | information-architecture: TanStack Query, estado local y Pinia limitado. |
| F0.43 | ux-states: mapping HTTP contextual y ausencia de business codes. |
| F0.44 | admin-flows A1–A10 y student-flows S1–S8: flujos completos documentados. |
| F0.45 | screen-inventory: superficies, datos, prioridad y bloqueos separados. |
| F0.46 | design-direction: inventario conceptual de piezas repetidas. |
| F0.47 | product-ux: riesgos y mitigaciones priorizados. |
| F0.48 | Alcance documental exclusivo verificado en working tree. |

## Validación de esta fase

- Lectura de los 15 documentos obligatorios, OpenAPI actual y contraste puntual con DTOs/servicios/configuración.
- Mapa de 69/69 operaciones: 57 Admin, 7 Student y 5 compartidas; 83 schemas inspeccionados. No endpoints nuevos presentados como existentes.
- Revisión de contratos durante escritura: generación sólo por rango y todos los horarios activos; Payment requiere paidAt con zona, método opcional y motivo para VOID; revocar enlace pendiente no cierra sesiones establecidas.
- Revisión de enlaces locales, cobertura F0.0–F0.48 y alcance de archivos. Sólo documentación nueva bajo docs/frontend.
- Cálculo de contraste sRGB sobre nueve combinaciones sólidas propuestas: primary/blanco 6,38:1; texto/blanco 15,76:1; muted/background 5,87:1; success 6,43:1; warning 6,37:1; danger 6,49:1; info 6,22:1; border-strong sobre blanco 3,90:1 y sobre background 3,66:1. Cumplen los umbrales propuestos para esas combinaciones. No valida glass, foco renderizado ni accesibilidad de pantallas que aún no existen.
- No ejecutados como parte de F0: tests de dominio, migraciones, audit de dependencias o pruebas de navegador de una interfaz. No hacen falta para cambios exclusivamente documentales y no se presentan como nuevas verificaciones del backend. Las evidencias Etapa 7 permanecen en su documento original.

## Preparación para la siguiente fase

Foundation + Design System puede partir de esta IA, los tokens, componentes mínimos y estados; todavía requiere el próximo prompt. Durante su definición debe fijarse topología de origen para pagos (API-01) y revisar tipado OpenAPI (API-06) antes de conectar o generar clientes.

Antes de declarar integrado el MVP completo: resolver descubrimiento contractual Student (API-02), historial Student (API-03), historia/próximas Admin por alumna (API-04) y disponibilidad de destinos Recovery (API-05), o aprobar recortes explícitos que no presenten información parcial como completa. Fase 0 no autoriza esas modificaciones ni implementa placeholders engañosos.

Validaciones futuras: tareas de pago y QR en mobile, cámara real bajo HTTPS, teclado/lectores de pantalla, reflow/contraste renderizado, red incierta y concurrencia percibida. Son gates de implementación futura, no resultados obtenidos ahora.
