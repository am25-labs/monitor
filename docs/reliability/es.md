# Validar la fiabilidad del motor

[English](en.md)

El límite de 100 monitores es una capacidad de configuración, no una garantía de que cada comprobación termine exactamente cada 60 segundos. La puntualidad depende de las alarmas del programador y de los ejecutores, D1 y el timeout del servicio vigilado.

## Programación de los ciclos

Un Durable Object mantiene una alarma por minuto y prepara la siguiente antes de ejecutar el ciclo. El cron inicia la primera alarma tras el despliegue y recupera una alarma ausente o atrasada más de dos minutos; no ejecuta las comprobaciones directamente. Un fallo del ciclo programa un reintento en un máximo de 15 segundos. Las migraciones y los bindings del programador y los ejecutores se crean con el despliegue habitual, sin variables adicionales.

Cada monitor tiene un ejecutor Durable Object independiente. El programador le entrega el identificador del trabajo por RPC y el ejecutor lo guarda antes de activar su alarma. Las comprobaciones habituales no esperan a Queues. Un fallo interno conserva el trabajo y programa su reintento a los 30 segundos; las leases y los identificadores existentes impiden duplicar resultados. La cola sigue disponible para drenar mensajes de versiones anteriores.

Las alarmas también pueden retrasarse; este cambio reduce la dependencia del cron, pero debe medirse en producción. El historial conserva colores sólidos según las comprobaciones observadas; la cobertura parcial de los segmentos cerrados se puede consultar en el tooltip. “Sin datos” indica estado sin confirmar, no degradación del servicio.

## Qué protege el motor

- Programa los trabajos de un ciclo en una transacción y los entrega a hasta 100 ejecutores independientes.
- Reclama el despacho de forma atómica para evitar publicaciones duplicadas entre ciclos concurrentes.
- Libera el despacho si falla la publicación. Una entrega ambigua puede repetirse; los resultados siguen protegidos por el identificador del trabajo y su lease.
- Cancela trabajos vencidos antes de despachar, para que una cola antigua no bloquee las comprobaciones actuales. Cancelar un trabajo no equivale a comprobar el servicio ni genera resultados históricos.
- Aísla las comprobaciones por monitor: una respuesta lenta no ocupa el ejecutor de otro monitor. El consumidor de Queues conserva sus límites para mensajes anteriores.
- Conserva únicamente el tiempo válido del último resultado en el historial. El tiempo posterior al vencimiento sigue sin datos.

## Pruebas locales

Ejecuta `pnpm exec vitest run tests/engine.test.ts tests/scheduler.test.ts tests/runner.test.ts tests/history.test.ts` y `pnpm typecheck`.

Las pruebas cubren 25 y 100 monitores, ciclos concurrentes, recuperación tras fallos de publicación, una cola de trabajos vencidos, reintentos sin resultados duplicados y 100 timeouts simultáneos de 30 segundos. La última prueba exige persistir los 100 fallos en menos de 60 segundos después de iniciar sus consumidores.

Estas pruebas utilizan D1 y Workers locales, y respuestas HTTP simuladas. No reproducen la puntualidad de las alarmas ni las condiciones de red de producción.

## Medir en producción

Después del despliegue habitual, abre **Workers & Pages → tu Worker → Observability → Logs**. Mantén la captura de logs habilitada. Filtra por estos eventos:

| Evento | Campos | Qué mide |
| --- | --- | --- |
| `engine_cycle` | `scheduler`, `dispatch`, `schedulerDelaySeconds` | Tipo de programador, recorrido de despacho y retraso entre la hora programada y el inicio real del ciclo. |
| `engine_cycle` | `schedulingMs`, `dispatchMs`, `due`, `dispatched`, `cancelled` | Tiempo del programador, publicación y trabajos descartados por vencimiento, pausa o cambios de configuración. |
| `engine_cycle` | `notificationsMs`, `cleanupMs`, `totalMs` | Tiempo de las operaciones restantes del ciclo. |
| `check_completed` | `jobAgeSeconds` | Tiempo desde el inicio del ciclo que creó el trabajo hasta el inicio de su consumidor; incluye programación y activación del ejecutor. |
| `check_completed` | `checkGapSeconds` | Tiempo entre los resultados de un monitor, medido al terminar la comprobación y antes de persistir. |
| `check_completed` | `checkMs`, `persistenceMs`, `totalMs` | Duración de la comprobación, escritura y ejecución del consumidor. |
| `check_cancelled` | `reason`, `jobAgeSeconds` | Trabajo que llegó al consumidor y se descartó. |
| `check_superseded` | `jobId` | Comprobación cuyo resultado no se guardó porque otro resultado, lease o cambio de configuración lo reemplazó. |
| `check_execution_failure`, `engine_failure`, `runner_retry`, `scheduler_retry` | `stage`, cuando esté presente | Fallos internos que requieren investigación. |

Los logs no incluyen URLs, credenciales, cuerpos de respuesta ni diagnósticos privados. Los identificadores permiten relacionar el trabajo con sus resultados en D1.

## Criterios para evaluar una instalación

Para monitores HTTP/TCP con intervalo de 60 segundos, utiliza inicialmente estos objetivos de operación:

- P95 de `schedulingMs + dispatchMs` menor a 5 segundos.
- P95 de `jobAgeSeconds` menor a 10 segundos; P99 menor a 30 segundos.
- P95 de `checkGapSeconds` de hasta 90 segundos; P99 de hasta 120 segundos.
- Sin crecimiento sostenido del backlog ni cancelaciones por vencimiento durante operación normal.
- Ningún resultado duplicado y ningún fallo interno sin explicar.

Son objetivos de validación, no un SLA publicado. Mide 24 horas para detectar regresiones y siete días para evaluar estabilidad. Valida 100 monitores en una instalación de pruebas separada, incluyendo respuestas rápidas, lentas, timeouts y caídas simultáneas. No utilices cien destinos ajenos sin autorización ni alteres los monitores reales para hacer la prueba.

Si el retraso está en `schedulerDelaySeconds`, agrupar escrituras o aumentar la concurrencia no lo elimina. Las alarmas deben medirse con los mismos criterios, además de vigilar el motor desde un sistema independiente. Un motor detenido tampoco puede garantizar que enviará una alerta sobre su propia detención.

El tiempo de detección incluye el intervalo, el timeout y las comprobaciones fallidas consecutivas configuradas. La entrega de notificaciones añade el tiempo del proveedor y del dispositivo; no equivale al tiempo de detección.

Referencias: [transacciones de D1](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [publicación por lotes](https://developers.cloudflare.com/queues/configuration/javascript-apis/), [concurrencia de consumidores](https://developers.cloudflare.com/queues/configuration/consumer-concurrency/).
