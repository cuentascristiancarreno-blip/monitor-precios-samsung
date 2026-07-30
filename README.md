# Monitor de precios Samsung Chile

Revisa el precio, stock y catálogo de los productos de samsung.com/cl y avisa por Discord cuando algo cambia (precio nuevo, producto nuevo, producto que desapareció, cambio de stock). Corre solo, en la nube (GitHub Actions), sin necesidad de tener el computador prendido.

## Cómo funciona

- `src/seed.json`: el listado base de ~1023 productos/variantes (viene del Excel que armaste).
- `src/discover.mjs`: antes de cada revisión, además busca automáticamente páginas "familia" (como el Galaxy S25, donde una sola página agrupa todos los colores y capacidades) que no estaban en el listado.
- `src/run.mjs`: revisa cada página (con un reintento para las que fallan), detecta si la corrida completa es confiable, y delega la comparación.
- `src/catalogo.mjs`: arma el catálogo de la corrida (un producto por SKU) y decide qué categorías no se notifican. La identidad de un producto es **siempre su SKU**: el nombre nunca influye en si algo se considera nuevo, desaparecido o cambiado.
- `src/comparar.mjs`: la lógica que decide qué cambió y qué se notifica (ver reglas abajo). Es un módulo puro con pruebas automatizadas.
- `src/titulo.mjs`: arma el título legible de cada producto agregándole las características que lo distinguen (capacidad, RAM, color, pulgadas), porque el nombre que publica Samsung es igual para todas las variantes ("Galaxy S26 Ultra (Exclusivo en Samsung.com)" son 4 productos distintos). No hace **ninguna consulta extra** al sitio: las características salen de la misma página que ya se carga para leer el precio (Samsung las publica por código de modelo), más el listado y la dirección de la página como respaldo. Ejemplo real: `Galaxy S26 Ultra (Exclusivo en Samsung.com) · 256GB · 12GB RAM · Oro rosa`.
- `src/discord.mjs`: arma y envía los avisos (íconos por categoría, link por producto, antes/después con diferencia en pesos y %).
- `data/latest.json`: catálogo con el último estado conocido de cada producto (precio, stock confirmado, presencia). El historial git de este archivo es el snapshot completo de cada revisión.
- `data/history.jsonl`: eventos de cambio (una línea por cambio detectado, con campo `tipo`).
- `data/ejecuciones.jsonl`: registro de cada corrida — duración, páginas, errores, conteos por tipo de cambio, y si fue confiable.
- `.github/workflows/monitor.yml`: la tarea programada (7 veces al día, hora Chile: 01, 04, 10, 13, 16, 19, 22). Corre las pruebas antes de cada revisión, sube los datos actualizados y dispara los avisos.

## Reglas anti-falsas-alertas (auditoría 2026-07-24)

- Un producto se declara **desaparecido** solo tras 2 revisiones confiables seguidas sin encontrarlo, con su página cargando bien — y se avisa una sola vez. Si reaparece después, se avisa "recuperado".
- Si la **página de un producto falló** (timeout, error de red), se conserva su último dato bueno y no se cuenta como ausencia.
- Si la **corrida completa es sospechosa** (muchos errores, o aparecen >20% menos productos que la vez anterior), no se declara nada desaparecido y llega una alerta técnica a Discord en vez de avisos falsos.
- Un **cambio de stock** se avisa solo tras verse igual en 2 revisiones seguidas (el detector puede parpadear).
- Los productos de categorías de **accesorios nunca notifican** a Discord (pedido del operador), aunque su historial sí se guarda.
- Detalle completo: `docs/auditoria-2026-07-24.md`.

## Diagnóstico rápido

- ¿Dudas de una corrida? Mirar la última línea de `data/ejecuciones.jsonl` (confiable sí/no, motivos, URLs con error).
- ¿Probar sin tocar los datos reales? `CARPETA_DATOS=<carpeta-temporal> SIN_DESCUBRIMIENTO=1 LIMITE_PAGINAS=6 node src/run.mjs`
- Pruebas: `npm test` (también corren solas antes de cada revisión programada).

Las páginas de producto individuales necesitan un navegador real (Playwright/Chromium) porque Samsung arma el precio con JavaScript en el momento de la navegación — confirmado con pruebas directas, no es un bloqueo anti-bot, así que no estamos evadiendo ningún control técnico.

## Publicarlo (una vez)

Estos son los únicos pasos que requieren tu cuenta — el resto ya está armado.

1. **Crear el repositorio en GitHub:**
   - Entra a [github.com/new](https://github.com/new) con tu cuenta `cuentascristiancarreno-blip`.
   - Nombre: `monitor-precios-samsung` (o el que prefieras).
   - Visibilidad: **Public** (así los minutos de GitHub Actions son gratis e ilimitados — no hay nada sensible en precios públicos de Samsung).
   - No marques "Add a README" ni ".gitignore" (ya los tenemos).
   - Click "Create repository".
   - Copia la URL que te muestra GitHub (algo como `https://github.com/cuentascristiancarreno-blip/monitor-precios-samsung.git`) y pásamela — yo hago el push por ti.

2. **Agregar el webhook de Discord como secreto** (para que el bot pueda avisar sin exponer la URL en el código):
   - En el repo recién creado, ve a **Settings → Secrets and variables → Actions**.
   - Click **New repository secret**.
   - Name: `DISCORD_WEBHOOK_URL`
   - Value: pega el contenido de tu archivo `discord_webhook.txt` (el mismo que ya usa el otro monitor).
   - Click **Add secret**.

3. **Probar que corre bien antes de esperar al horario programado:**
   - Ve a la pestaña **Actions** del repo.
   - Click en el workflow "Monitor de precios Samsung" (columna izquierda).
   - Click **Run workflow** (botón a la derecha) → **Run workflow** de nuevo para confirmar.
   - Se va a demorar entre 35 y 100 minutos la primera vez (son ~1000 páginas). Puedes cerrar la pestaña y volver más tarde — corre en los servidores de GitHub, no en tu computador.
   - Cuando termine, revisa el canal de Discord: la primera corrida no manda avisos de "cambio" (no hay nada previo con qué comparar), pero sí deja `data/latest.json` lleno — eso confirma que funcionó.

Después de eso, corre solo 3 veces al día sin que hagas nada.

## Para agregar productos nuevos al listado

Edita `src/seed.json` (o pídeme que lo actualice si tienes un Excel nuevo) y sube el cambio — la próxima revisión programada ya los incluye.
