# Validar Monitor en Cloudflare Free

[Español](#español) · [English](#english)

## Español

Monitor no exige Paid al instalar. Workers, D1, Durable Objects con SQLite y Queues tienen modalidades Free sujetas a límites. D1 utiliza las condiciones del plan de Workers, sin una suscripción separada denominada “D1 Paid”.

Disponibilidad no garantiza capacidad. Cien monitores por minuto generan 144,000 comprobaciones diarias antes de contar trabajos, índices, agregados, limpiezas, incidentes y notificaciones. Las cuotas de cuenta se comparten con otras aplicaciones.

No se alteran intervalos, retención ni planes para hacer caber una instalación. Revisá [Workers](https://developers.cloudflare.com/workers/platform/limits/), [D1: límites](https://developers.cloudflare.com/d1/platform/limits/) y [consumo](https://developers.cloudflare.com/d1/platform/pricing/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) y [Queues](https://developers.cloudflare.com/queues/platform/pricing/).

### Estado de validación

| Escenario | Estado |
| --- | --- |
| Instalación y actualización con APIs simuladas | Cubierto por pruebas de CLI |
| Runtime compilado sin código fuente | Verificación requerida por GitHub Actions |
| Instalación real en una cuenta Free dedicada | Pendiente |
| Actualización real entre dos versiones publicadas en Free | Pendiente |
| Capacidad y crecimiento del historial en Free | Pendiente de mediciones reales |
| Publicación con provenance | Requerida por GitHub Actions mediante `npm publish --provenance`; independiente de la validación de Free |

### Protocolo opcional para certificar Free

Esta certificación no es un requisito para instalar o publicar Monitor. No se requiere crear otra cuenta para usar la CLI. Mientras no existan mediciones, la capacidad en Free permanece sin verificar.

1. Usar una cuenta Free de prueba autorizada y zona/hostname dedicados, sin infraestructura productiva. Registrar fecha, plan, versión y otros consumos de la cuenta.
2. Instalar el paquete publicado. Ejecutar `doctor`, iniciar sesión y comprobar páginas públicas, HTTP, TCP y heartbeat con destinos propios de prueba. Enviar alertas únicamente a destinatarios de prueba autorizados.
3. Medir una instalación sin monitores y después 1, 5 y 10 monitores, en ejecuciones separadas, con intervalos de 60 y 300 segundos. Registrar CPU, errores, comprobaciones esperadas/recibidas, filas leídas/escritas, tamaño de D1, operaciones de Durable Objects y Queues. Usar métricas reales; no equiparar comprobaciones con filas escritas.
4. Mantener cada escenario al menos 24 horas. Separar consumo de fondo e incremental; detener aumentos de carga ante errores de cuota o CPU. Cron y alarmas también consumen recursos sin monitores.
5. Actualizar entre dos versiones publicadas compatibles y verificar respaldo, esquema, dominio, namespaces, historial, credenciales y continuidad de comprobaciones. Usar simulaciones o infraestructura expresamente dedicada para fallos, nunca producción de AM25.
6. Medir varios días de crecimiento de base e índices. Las proyecciones a seis meses deben indicar duración observada, supuestos y margen. Revisar agregados e incidentes sin vencimiento automático.
7. Documentar cargas recomendadas solo después de medirlas. `doctor` verifica configuración y actividad reciente, no capacidad ni cuotas futuras.

Conservar resultados con versión/SHA, fecha, duración, plan, consumo compartido, límites vigentes, métricas iniciales/finales, errores y conclusión. No incluir tokens, llaves ni credenciales.

## English

Monitor does not require Paid when installing. Workers, D1, SQLite-backed Durable Objects and Queues have Free tiers subject to limits. D1 uses the terms of the Workers plan, without a separate subscription called “D1 Paid”.

Availability does not guarantee capacity. One hundred monitors checked every minute generate 144,000 daily checks before counting jobs, indexes, aggregates, cleanup, incidents and notifications. Account quotas are shared with other applications.

Intervals, retention and plans are not changed to make an installation fit. Review [Workers](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) and [usage](https://developers.cloudflare.com/d1/platform/pricing/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [Queues](https://developers.cloudflare.com/queues/platform/pricing/).

### Validation status

| Scenario | Status |
| --- | --- |
| Installation and upgrades with simulated APIs | Covered by CLI tests |
| Compiled runtime without source code | Verification required by GitHub Actions |
| Real installation in a dedicated Free account | Pending |
| Real upgrade between two published versions on Free | Pending |
| Capacity and history growth on Free | Pending real measurements |
| Publishing with provenance | Required by GitHub Actions through `npm publish --provenance`; independent of Free validation |

### Optional protocol to certify Free

This certification is not required to install or publish Monitor. You do not need to create another account to use the CLI. Until measurements exist, capacity on Free remains unverified.

1. Use an authorized Free test account and dedicated zone/hostname without production infrastructure. Record the date, plan, version and other account usage.
2. Install the published package. Run `doctor`, sign in and check public pages, HTTP, TCP and heartbeats with your own test targets. Send alerts only to authorized test recipients.
3. Measure an installation with no monitors and then 1, 5 and 10 monitors in separate runs, at 60- and 300-second intervals. Record CPU, errors, expected/received checks, rows read/written, D1 size, Durable Object operations and Queues. Use actual metrics; do not equate checks with rows written.
4. Maintain each scenario for at least 24 hours. Separate background and incremental usage; stop increasing load if quota or CPU errors occur. Cron and alarms also consume resources without monitors.
5. Upgrade between two compatible published versions and check the backup, schema, domain, namespaces, history, credentials and continuity of checks. Use simulations or expressly dedicated infrastructure for failures, never AM25 production.
6. Measure several days of database and index growth. Six-month projections must state the observed duration, assumptions and margin. Review aggregates and incidents without automatic expiry.
7. Document recommended workloads only after measuring them. `doctor` verifies configuration and recent activity, not capacity or future quotas.

Keep results with the version/SHA, date, duration, plan, shared usage, current limits, initial/final metrics, errors and conclusion. Do not include tokens, keys or credentials.
