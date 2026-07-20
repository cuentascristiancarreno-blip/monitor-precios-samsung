# Monitor de precios Samsung Chile

Revisa el precio, stock y catálogo de los productos de samsung.com/cl y avisa por Discord cuando algo cambia (precio nuevo, producto nuevo, producto que desapareció, cambio de stock). Corre solo, en la nube (GitHub Actions), sin necesidad de tener el computador prendido.

## Cómo funciona

- `src/seed.json`: el listado base de ~1023 productos/variantes (viene del Excel que armaste).
- `src/discover.mjs`: antes de cada revisión, además busca automáticamente páginas "familia" (como el Galaxy S25, donde una sola página agrupa todos los colores y capacidades) que no estaban en el listado.
- `src/run.mjs`: revisa cada página, compara contra la última revisión guardada, arma la lista de cambios y avisa por Discord.
- `data/latest.json`: foto del último precio/stock conocido de cada producto (se sobrescribe cada revisión).
- `data/history.jsonl`: historial completo, una línea por producto por revisión — para poder armar gráficos de tendencia más adelante.
- `.github/workflows/monitor.yml`: la tarea programada. Corre 3 veces al día, sube los datos actualizados al repo y dispara el aviso de Discord.

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
