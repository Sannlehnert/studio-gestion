> Actualización Etapa 7.1: este documento conserva el diseño e inspección de F0. Para disponibilidad actual de endpoints y brechas, prevalecen [backend-contract-map](backend-contract-map.md) y el [contrato de integración](../frontend-integration-contract.md). No se inició Frontend F1.

# Inventario de pantallas — F0.45

Derivado de [flujos Admin](admin-flows.md) y [Student](student-flows.md). Prioridad y disponibilidad de API son dimensiones diferentes. MUST HAVE MVP no afirma que el backend ya entregue todos los datos. SECONDARY sigue siendo parte del producto operativo, con menor frecuencia; LATER no es parte de la foundation. Formularios y paneles contextuales cuentan como superficies de tarea, no como más destinos de navegación.

| Rol | Pantalla / superficie | Propósito y acción principal | Datos necesarios / disponibilidad | Prioridad |
| --- | --- | --- | --- | --- |
| Public/Admin | Login | Ingresar a gestión. | Login y me; disponible. | MUST HAVE MVP |
| Public/Student | Activación | Consumir acceso recibido. | Fragmento efímero y activate; disponible. | MUST HAVE MVP |
| Public/Student | Acceso requerido | Recuperar entrada pidiendo enlace. | Estado de sesión; sin recuperación de contraseña Student. | MUST HAVE MVP |
| Admin | Hoy | Abrir clase/QR del día. | ClassSessions por fecha, Attendance de visibles; sin KPIs globales. | MUST HAVE MVP |
| Admin | Alumnas | Buscar/abrir por nombre y actividad. | Students paginado y filtros reales; disponible. | MUST HAVE MVP |
| Admin | Alta de alumna | Guardar nombre. | POST Student; disponible. | MUST HAVE MVP |
| Admin | Detalle de alumna | Entender contrato, saldo, clases y próximos pasos. | Student, contratos, resumen, pagos, enrollments, recoveries. Próximas/historial completo condicionados API-04. | MUST HAVE MVP |
| Admin | Acceso/actividad de alumna | Emitir/revocar acceso o desactivar con contexto. | Emisión/revocación conocidas; no listado de enlaces API-10. | MUST HAVE MVP |
| Admin | Crear/detalle de contrato | Acordar período/precio y operar pagos/horarios. | Plan, Student, Subscription y resúmenes; disponible. | MUST HAVE MVP |
| Admin | Registrar pago | Imputar importe al contrato correcto. | FinancialSummary, Payment, clave idempotente; cross-origin condicionado API-01. | MUST HAVE MVP |
| Admin | Detalle/anulación de pago | Consultar registro y anular error sin borrado. | Payment y reason para VOID; disponible. | MUST HAVE MVP |
| Admin | Asignar/cambiar/finalizar horario | Gestionar pertenencia habitual. | Enrollment, Schedule, contrato; cupo validado al mutar. | MUST HAVE MVP |
| Admin | Clases por fecha | Encontrar clase concreta. | Lista filtrada/paginada; disponible. | MUST HAVE MVP |
| Admin | Generar clases | Materializar rango de todos los horarios activos. | dateFrom/dateTo y respuesta creada/existente; disponible. | MUST HAVE MVP |
| Admin | Clase/roster | Leer estados y operar contexto. | ClassSession, Attendance, expected/origen; disponibilidad libre no derivable, API-05. | MUST HAVE MVP |
| Admin | Mostrar QR | Permitir escaneo en sala. | Challenge y expiresAt, ventana; disponible, countdown orientativo. | MUST HAVE MVP |
| Admin | PRESENT manual | Resolver falla de dispositivo dentro de ventana. | Expected/Attendance, motivo; disponible. | MUST HAVE MVP |
| Admin | Corrección e historial de Attendance | Cambiar estado efectivo sin perder historia. | Attendance, GET/POST corrections y dependencias Recovery; disponible. | MUST HAVE MVP |
| Admin | Autorizar/detalle de Recovery | Elegir destino y consultar/cancelar autorización. | Origen, clases, contrato, Recovery; selección con disponibilidad real condicionada API-05. | MUST HAVE MVP |
| Admin | Gestión | Encontrar tareas ocasionales. | Navegación secundaria, sin agregados inexistentes. | MUST HAVE MVP |
| Admin | Planes y formulario | Mantener catálogo activo. | List/detail/create/update/status Plan; disponible. | MUST HAVE MVP |
| Admin | Horarios y formulario | Mantener recurrencias semanales. | Schedule y estado; disponible. | MUST HAVE MVP |
| Admin | Auditoría | Investigar acción y actor contextual. | AuditLog filtros y metadata pública; nombre de actor parcial API-09. | SECONDARY |
| Admin | Contratos globales | Consultar por estado/período visible y abrir hub. | Subscription lista con filtros reales; sin búsqueda nominal global prometida. | SECONDARY |
| Admin | Pagos globales | Revisar registrados/anulados. | Payment lista por estado; sin filtro alumna/fecha API-08. | SECONDARY |
| Student | Inicio | Próxima clase, restantes y acción actual. | Upcoming/recoveries; descubrimiento contractual condicionado API-02. | MUST HAVE MVP |
| Student | Clases/próximas | Consultar calendario próximo acotado. | Upcoming hasta 20, detalle propio; disponible con límite explícito. | MUST HAVE MVP |
| Student | Detalle de clase | Entender horario, ventana y resultado propio. | GET Attendance Student; disponible. | MUST HAVE MVP |
| Student | Scanner | Leer challenge de clase seleccionada. | Cámara, permiso, POST Attendance; disponible con requisitos de navegador. | MUST HAVE MVP |
| Student | Confirmación | Saber que quedó presente. | Resultado confirmado + classSummary; disponible. | MUST HAVE MVP |
| Student | Restantes contextual | Entender consumo del contrato de la clase. | class-summary con ID conocido; global actual condicionado API-02. | MUST HAVE MVP |
| Student | Recuperaciones lista/detalle | Consultar autorización/resultado propios. | Recovery paginado y detalle; disponible. | MUST HAVE MVP |
| Student | Historial | Consultar Attendance pasada completa. | Lectura propia faltante API-03; no simular con upcoming. | MUST HAVE MVP |
| Ambos | Cuenta/sesión | Cerrar sesión o entender vencimiento. | me/logout; disponible, sin perfil editable inventado. | MUST HAVE MVP |
| Admin | Calendario semanal visual avanzado | Vista alternativa si pruebas muestran necesidad. | No necesario para tareas iniciales; sin drag/drop previsto. | LATER |
| Admin | Agregados/gráficos globales | Responder futura necesidad operativa demostrada. | Sin endpoints de agregado actuales; no aprobado para construir. | LATER |

## Orden de abordaje propuesto

Foundation posterior: shells por rol, navegación, tipografía, estados y formularios básicos con contratos claramente delimitados. Luego los flujos más frecuentes y ya soportados; resolver antes de integrar pagos la topología API-01. Inicio Student completo, historial y disponibilidad Recovery requieren decisiones de lectura específicas antes de declarar listo el MVP conectado. Este orden es una evaluación de preparación, no autorización para empezar la Fase 1.
