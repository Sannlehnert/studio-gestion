# Validación de Etapa 5

Fecha: 2026-09-12. Entorno: Node.js 24.20.0, Prisma 6.19.3, Vitest 4.1.11 y PostgreSQL 16.15 de pruebas.

## Resultado

Dynamic QR Attendance Challenge implementado y validado. No se aplicaron migraciones a la base de desarrollo. Los runners utilizaron únicamente `studio_gestion_test`, crearon schemas aleatorios y eliminaron sus propios schemas al finalizar.

| Comprobación | Resultado real |
| --- | --- |
| Prisma generate | PASS, Client 6.19.3 |
| Prisma validate | PASS |
| Lint | PASS, oxlint sin warnings |
| Typecheck | PASS |
| Unit | PASS, 163 tests en 19 archivos |
| Integration PostgreSQL | PASS, 40 tests en 6 archivos |
| E2E HTTP PostgreSQL | PASS, 48 tests en 8 archivos |
| Runner PostgreSQL total | PASS, 88 tests en 14 archivos |
| Nuevos QR PostgreSQL | PASS, 19 tests: 11 integration y 8 HTTP |
| Concurrencia QR | PASS: emisiones simultáneas, rotación/PRESENT, PRESENT duplicado, cancelación/PRESENT, expiry durante espera real |
| Build | PASS |
| Fresh migrations | PASS, ocho migraciones más inspección de constraints e índices |
| Upgrade 4.1 → 5 | PASS, snapshot histórico preservado |
| npm audit online | PASS, cero vulnerabilidades después de corregir Multer |

La primera ejecución de fixtures QR detectó una moneda contractual faltante; se corrigió el fixture, sin cambiar el dominio, y se repitieron las suites hasta pasar. Prisma validate inicialmente se ejecutó desde la raíz sin DATABASE_URL; se repitió con un URL de validación sintáctica hacia `_test` y pasó. No se presenta ninguno de esos intentos fallidos como validación exitosa.

## Challenge, replay y límites

Token opaco CSPRNG de 256 bits; hash SHA-256 persistido; TTL default 60s y rango 30–120. Emisión on demand sólo dentro de la ventana de una clase SCHEDULED. Expiry limitado por closesAt y nunca prorrogado.

La política transaccional conserva actual y predecesor, revoca el más antiguo ante una tercera emisión y limpia vencidos/revocados durante la emisión siguiente. No impone medio TTL como cooldown. Quedan como máximo dos no revocados y tres registros físicos por ClassSession mediante el protocolo con lock PostgreSQL. La generación interna de secuencia ordena también emisiones en el mismo milisegundo.

Múltiples Students elegibles comparten un token. La misma Student conserva una sola Attendance y un consumo, incluso con saldo restante cero al repetir. Un token vencido, revocado o cruzado se rechaza también en replay. Los replays deben seguir cumpliendo acceso y ventana actuales.

Attendance limita por Student.id, independientemente de IP o cantidad de sesiones. Emisión limita por Admin.id + ClassSession. Ambos mantienen el límite general por IP como defensa secundaria. Las pruebas HTTP agotan el límite de una Student, intentan otra sesión de esa misma Student y verifican que otra Student bajo la misma IP siga operando. También verifican límites de emisión independientes por clase.

## Seguridad y casos cubiertos

| Caso requerido | Evidencia |
| --- | --- |
| Random inválido, vencido, revocado, cross-ClassSession | Suites QR integration y HTTP; rechazo incluso tras PRESENT previo |
| Student ajena, inactive e históricamente no elegible | QR integration/HTTP y suites históricas |
| Subscription cancelada/expirada y allowance agotado | Attendance HTTP adaptada con QR válido |
| Fuera de ventana | Reloj controlado; también cambio horario real con token todavía no vencido |
| Body con studentId/status/timestamp | 400 con DTO estricto |
| Token vacío, ausente, malformed y excesivamente largo | Unit y HTTP; 400/413 sin reflejar secreto |
| Double replay y varias Students con mismo token | Una fila/consumo por Student y una auditoría por alta |
| ClassSession cancelada | Challenges revocados y ambos POST rechazados |
| Rotación inmediata y emisiones concurrentes | Sin cooldown; predecesor tolerado, límite acotado, expiry original preservado |
| Expiry durante transacción | Bloqueo real de Student en PostgreSQL, observación de espera, avance de CLOCK y rechazo sin Attendance/AuditLog |
| Secretos y contrato OpenAPI | Hash sólo en tabla; auditoría y errores sin secreto/hash; challenge obligatorio y sin ejemplos reales |
| Autorización y CSRF | Admin/Student separados, QR solo insuficiente, Origin obligatorio |

El flujo E2E completo conserva todas las operaciones administrativas y activación reales, agrega emisión Admin de QR y confirma PRESENT con resumen 1 consumida/7 restantes. Los flujos de vencimiento controlado cubren tanto un primer intento sin Attendance como un replay.

## Persistencia y migración

La migración aditiva agrega AttendanceChallenge, generación de secuencia, tokenHash UNIQUE, tres CHECKs y dos FKs RESTRICT. El índice por clase/generación sirve a la rotación y limpieza local. Integration intenta violar unicidad, formato, fechas y FKs en PostgreSQL real.

El verificador aplica siete migraciones, inserta Student, período activo, contrato, clase, PRESENT y AuditLog; luego aplica sólo la octava y compara el snapshot. Además valida un esquema fresh y consulta catálogos PostgreSQL para verificar constraints e índices. No hay transformación destructiva ni secretos inventados.

## Dependencias y avisos

La auditoría online inicial informó cinco dependencias afectadas por cuatro avisos de Multer 2.2.0, arrastrado por @nestjs/platform-express. Se añadió un override acotado a Multer 2.3.0, cuyo release oficial corrige esos avisos; el lockfile sólo cambia ese paquete. La suite completa, build y npm audit posteriores pasaron. Referencia: [Multer 2.3.0](https://github.com/expressjs/multer/releases/tag/v2.3.0).

Siguen los avisos previos de Vite sobre configuración CommonJS con sintaxis ESM y la sugerencia de resolver paths nativamente. No impiden los tests. No se hizo un cambio de tooling ajeno a la etapa.

## Deuda y límites operativos

- Rate limiting en memoria por instancia: requiere store compartido antes de escalar horizontalmente. Dimensionar el límite IP general con tráfico real de grupos.
- Hasta tres hashes efímeros residuales por clase cerrada permanecen hasta una política futura de retención global; AuditLog mantiene su política operativa pendiente. No hay crecimiento por cada rotación en la tabla de challenges.
- Retirar el override de Multer cuando Nest declare una versión corregida.
- Proxies/APM/cachés externos deben excluir payloads sensibles; esa infraestructura aún no está provisionada por este proyecto.
- El QR no prueba presencia física ni bloquea compartirlo en tiempo real. La superposición tolera una rotación, no una cadena ilimitada de recargas.

La base está preparada para diseñar la Etapa 6 Recoveries, conservando Attendance histórica, consumo derivado y controles temporales. Esa etapa no se inició.
