# Validar Monitor en Cloudflare Free

Monitor no exige Paid al instalar. Workers, D1, Durable Objects con SQLite y Queues tienen modalidades Free sujetas a límites. D1 utiliza las condiciones del plan de Workers, sin una suscripción separada denominada “D1 Paid”.

Disponibilidad no garantiza capacidad. Cien monitores por minuto generan 144,000 comprobaciones diarias antes de contar trabajos, índices, agregados, limpiezas, incidentes y notificaciones. Las cuotas de cuenta se comparten con otras aplicaciones.

No se alteran intervalos, retención ni planes para hacer caber una instalación. Revisá [Workers](https://developers.cloudflare.com/workers/platform/limits/), [D1: límites](https://developers.cloudflare.com/d1/platform/limits/) y [consumo](https://developers.cloudflare.com/d1/platform/pricing/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) y [Queues](https://developers.cloudflare.com/queues/platform/pricing/).

## Estado de validación

| Escenario | Estado |
| --- | --- |
| Instalación y actualización con APIs simuladas | Cubierto por pruebas de CLI |
| Runtime compilado sin código fuente | Verificación requerida por GitHub Actions |
| Instalación real en una cuenta Free dedicada | Pendiente |
| Actualización real entre dos versiones publicadas en Free | Pendiente |
| Capacidad y crecimiento del historial en Free | Pendiente de mediciones reales |
| Provenance real | Pendiente de la primera publicación |

## Protocolo opcional para certificar Free

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

Free installations are allowed within Cloudflare quotas; workload capacity is not yet certified. Validate installation and an upgrade between two published versions in a separate authorized Free account. Test a baseline and 1/5/10 monitors at 60/300-second intervals for at least 24 hours each, measuring CPU, errors, reads, writes, storage, Durable Objects and Queues. Record shared account usage and several days of storage growth. Do not promise 100 monitors per minute on Free or automatically change user intervals, retention or subscriptions. Never use AM25 production infrastructure for destructive tests.
