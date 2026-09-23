# Etapa 7.1 — Validación

Cierre: 23 de septiembre de 2026. **FRONTEND INTEGRATION CONTRACT = READY**, para el alcance acordado de F0/7.1. Frontend F1 no iniciado. No certifica preparación del despliegue de producción.

## Resultados reales

| Gate | Resultado | Evidencia |
| --- | --- | --- |
| Prisma generate | PASS | Prisma Client 6.19.3 generado sin conexión a DB. |
| Prisma validate | PASS | Schema actual válido. |
| Unit | PASS | 193 tests / 23 archivos; última ejecución 23/09. |
| Lint | PASS | oxlint --deny-warnings; reejecutado después del último cambio de tests. |
| Typecheck | PASS | tsc --project tsconfig.check.json; última ejecución posterior al ajuste del test OpenAPI. |
| Build | PASS | nest build con implementación actual; cambios posteriores sólo tests/documentación. |
| PostgreSQL integration + HTTP/E2E | PASS | 151 tests / 19 archivos en PostgreSQL 16.15, runner completo, exit 0. |
| Contract tests | PASS | Los 19 casos de integration-readiness.e2e-spec.ts pasaron aislados y dentro de la suite completa. Incluyen proyecciones, privacidad, contexto, shapes y paginación. |
| CORS/preflight | PASS | Stack HTTP unitario y HTTP real: Idempotency-Key permitido, origin ajeno rechazado, credenciales/CSRF conservados. |
| Concurrencia | PASS | Suite completa incluye regresiones de dominio y nueva disputa de último cupo: un POST gana y el otro devuelve 409 CLASS_SESSION_FULL. |
| Fresh migrations | PASS | Runner creó schema efímero vacío en studio_gestion_test y aplicó las 10 migraciones; limpieza final del schema propio. |
| OpenAPI /api/docs-json | PASS | HTTP real y generación sin DB: 75 operaciones / 94 schemas; enteros, enums, nullables, errores y contratos esenciales verificados. |
| npm audit completo online | PASS | Exit 0, 0 vulnerabilidades / 422 dependencias; sin --omit=dev. No hizo falta alternativa offline. |

Los 19 tests nuevos están incluidos en los 151, no se suman nuevamente. Integration, HTTP, contract y concurrencia son distintas coberturas de esa suite; no se presentan como ejecuciones independientes adicionales. Unit y typecheck finales se ejecutaron juntos y finalizaron exit 0. No se atribuyen resultados previos de Etapa 7 a los nuevos casos.

## Incidencias resueltas y advertencias

El primer intento E2E falló antes de ejecutar pruebas por PrismaClientInitializationError. Docker estaba inaccesible desde el entorno por permisos de su canal local. El usuario levantó únicamente docker-compose.test.yml y confirmó Healthy; después pasaron la suite nueva y la completa. El warning sobre el contenedor de desarrollo huérfano no motivó eliminarlo.

Un fixture nuevo carecía de currency y se corrigió a ARS antes del typecheck final. El test OpenAPI se ajustó al schema público StudentHomeSummaryDto porque Swagger aplana su clase base. No hubo fallos de assertions PostgreSQL en las ejecuciones posteriores.

Las interrupciones por límites externos del servicio no eran fallos del proyecto. Persisten avisos no bloqueantes de Vite/CommonJS y resolución de paths; no se silencian para aparentar validación. La suite unitaria provoca un 500 controlado al verificar sanitización.

## Persistencia y coherencia final

Sin cambios en schema.prisma, índices o migraciones: no existe migración 7 → 7.1 ni corresponde un upgrade adicional. No se modificó la base de desarrollo ni se ejecutaron seed/reset sobre ella. Generate/validate usaron una URL no conectable. El runner exige TEST_DATABASE_URL de base *_test y opera en su schema aleatorio, nunca usa DATABASE_URL como fallback.

No se repiten pruebas de dominio después de cambios exclusivamente documentales. Se conserva la evidencia del build de la implementación; tests posteriores no alteran el artefacto productivo. El build modificó el cache rastreado apps/backend/tsconfig.build.tsbuildinfo. Se conserva ese artefacto generado: la limpieza mediante Git no tuvo permiso para crear index.lock; no afecta los gates ni el comportamiento.

## Límites y brechas pendientes

- API-01 a API-07: RESOLVED con evidencia anterior.
- API-08: DEFERRED; agregados/filtros globales excluidos del MVP acordado.
- API-09: PARTIAL; corrected resuelto, nombre universal de actor Audit diferido.
- API-10: PARTIAL; contexto temporal resuelto donde aporta significado, listado de accesos/serverTime QR diferidos.
- Nuevas próximas/Home y opciones tienen defensa de 1000 candidatas. Options permite acotar fechas; Home requerirá evolución si el volumen generado supera ese límite. No hay truncamiento silencioso.
- Cookies cross-origin requieren despliegue same-site o proxy; CORS no elimina restricciones SameSite. F1 debe configurar origins y credentials correctamente.

No quedan bloqueantes de F1 ni del MVP delimitado. Estos límites no autorizan dashboards adicionales ni reconstrucción de reglas de negocio en frontend. Contrato completo: [frontend-integration-contract.md](frontend-integration-contract.md). Estado por brecha: [frontend/backend-contract-map.md](frontend/backend-contract-map.md).
