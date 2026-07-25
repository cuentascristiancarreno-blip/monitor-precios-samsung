# Auditoría completa del monitor — 2026-07-24

Pedida por el operador. Ejecutada de forma autónoma durante la noche.
Bitácora de avance en `BITACORA.md` (raíz del repo).

## Cómo funcionaba el sistema antes de la auditoría

1. `run.mjs` recorría ~1160 páginas (seed + familias descubiertas por sitemap),
   extraía precio/stock (JSON-LD para familias, Playwright + digitalData para
   el resto), y comparaba contra `latest.json` de la corrida anterior.
2. Todo producto presente antes y ausente ahora se reportaba como "eliminado";
   todo producto ausente antes y presente ahora, como "nuevo".
3. `latest.json` se sobrescribía completo; `history.jsonl` acumulaba un
   snapshot completo (~900 líneas) por corrida.

## Hallazgos, por gravedad

| # | Gravedad | Problema | Evidencia |
|---|---|---|---|
| 1 | **Crítica** | Falsas alertas masivas de "eliminado"/"nuevo": cada página con timeout hacía "desaparecer" su producto | 77 episodios de parpadeo en 19 corridas ≈ 150 avisos falsos en 4 días (medido en history.jsonl) |
| 2 | **Alta** | Sin regla de confirmación de desaparición (bastaba 1 ausencia) ni distinción entre "ausente", "página falló" y "desaparecido de verdad" | Diseño del diff original |
| 3 | **Alta** | Sin registro de ejecuciones: imposible saber si una corrida fue completa o parcial | No existía ejecuciones.jsonl |
| 4 | **Media** | Detección de stock frágil (busca "agotado" en el texto de TODA la página) y sin confirmación → alertas de stock falsas posibles | Diseño de extract.mjs |
| 5 | **Media** | history.jsonl crecía ~2.5 MB/día duplicando lo que ya guarda el historial git de latest.json | 19 corridas ≈ 17k líneas en 4 días |
| 6 | **Media** | Un modelo capturado por página propia y por página familia quedaba con categoría "Familia (auto-descubierta)" → rompía íconos y podía saltarse el filtro de accesorios | Revisión de código |
| 7 | **Baja** | Sin reintentos: un timeout esporádico = página perdida esa corrida | 10-30 errores/corrida en logs |
| 8 | **Baja** | Conflictos de git push cuando un push de código coincidía con una corrida | Ocurrió 2 veces (corridas #2 y del 21-07) |
| 9 | **Baja** | Sin pruebas automatizadas de ningún tipo | No existía test/ |

## Correcciones aplicadas

- **`src/comparar.mjs` (nuevo):** toda la lógica de comparación extraída a un
  módulo puro y testeable. Estados por producto: `presencia`
  (activo/ausente/desaparecido/error_verificacion) + `estadoStock`
  (disponible/agotado, confirmado) + contadores.
  - "Desaparecido" exige ≥2 corridas **confiables** consecutivas sin ver el
    producto, con su página cargando bien. Se notifica UNA vez
    (`notificadoDesaparecido`).
  - Si la página del producto falló, se conserva el último dato bueno con
    presencia `error_verificacion` — sin contar ausencia ni avisar nada.
  - Reaparición tras desaparición confirmada → aviso "recuperado" (no "nuevo").
    Reaparición tras ausencia corta → silenciosa.
  - Cambio de stock requiere verse igual 2 corridas seguidas (anti-parpadeo).
  - La categoría específica del listado nunca es pisada por la genérica de una
    página familia.
  - Registros con esquema viejo se migran al vuelo sin generar alertas falsas.
- **`src/run.mjs`:** reintento único (timeout 45s) para páginas fallidas;
  detección de corrida no confiable (errores > máx(5, 10% de páginas), o caída
  >20% en productos encontrados, o 0 productos); en ese caso NO se marca nada
  como desaparecido y se envía **alerta técnica** a Discord en vez de alertas
  comerciales falsas. Registro por corrida en `data/ejecuciones.jsonl` (inicio,
  fin, duración, páginas, errores + URLs, conteos por tipo de cambio, confiable
  y motivos). Deduplicación de URLs. Variables `CARPETA_DATOS`,
  `LIMITE_PAGINAS` y `SIN_DESCUBRIMIENTO` para pruebas sin tocar producción.
- **`src/discord.mjs`:** tipos nuevos "recuperado" y "desaparecido
  (confirmado)"; diferencia en pesos + porcentaje en cambios de precio;
  `notifyTecnico` para alertas de operación. Se mantiene: íconos por categoría,
  link por producto, partición en varios mensajes sin truncar, filtro de
  accesorios, jamás "$NaN".
- **`history.jsonl`:** ahora registra eventos de cambio (líneas con `tipo`),
  no snapshots completos. El snapshot completo por corrida sigue disponible en
  el historial git de `latest.json` (cada corrida lo commitea).
- **Workflow:** `npm test` bloquea la corrida si las pruebas fallan;
  `git add data/` completo; `git pull --rebase -X theirs` resuelve el choque
  código-vs-datos a favor de los datos recién generados.
- **Pruebas (`test/`, 26 casos, node:test):** extracción (variantes,
  ProductGroup, precio NaN/0/negativo, JSON-LD malformado, duplicados),
  comparación (nuevo, baja/sube, precio corrupto, stock con confirmación y
  parpadeo, desaparición en 2 pasos sin repetición, página fallida, corrida no
  confiable, recuperado, ausencia corta silenciosa, categoría familia, esquema
  viejo), Discord (todos los tipos con precio y link, sin NaN, partición <2000
  chars sin pérdida, sin webhook, alerta técnica).

## Validación ejecutada

1. `npm test`: **26/26 verdes** (126 ms).
2. Simulación completa con carpeta de datos temporal (producción intacta):
   - Corrida 1 (6 páginas reales): 5 productos capturados, 5 "nuevo", confiable.
   - Corrida 2 (idéntica): **0 cambios** — estable, sin ruido.
   - Corrida 3 (recortada a 4 páginas, simulando cobertura caída): marcada
     **NO confiable**, los 2 productos no revisados conservaron datos con
     `error_verificacion`, **0 alertas falsas**.
3. Corrida real de validación disparada en GitHub Actions tras el push
   (resultado en `data/ejecuciones.jsonl` y en la pestaña Actions).

## Riesgos que permanecen (aceptados y documentados)

- La detección de stock en páginas individuales sigue basada en texto de la
  página; la confirmación de 2 corridas la contiene, pero un texto ambiguo
  presente en forma estable podría clasificar mal un producto puntual.
- Estados finos del pedido original ("próximamente", "descontinuado") no son
  distinguibles con las señales que expone el sitio; se cubren con
  agotado/desaparecido.
- Un evento masivo real (ej. CyberDay) generará cientos de avisos legítimos en
  ráfaga; se decidió NO suprimirlos (son reales), solo agruparlos por mensajes.
- El precio monitoreado es el precio de venta vigente que Samsung publica en
  `digitalData.model_price` / JSON-LD `offers.price` (con descuento incluido);
  no se rastrean por separado precio-lista vs precio-oferta ni precios por
  cupón/tarjeta.

## Recomendaciones futuras

- Si el operador quiere gráficos de tendencia, leer el historial git de
  `latest.json` + eventos de `history.jsonl` (todo ya queda registrado).
- Revisar `data/ejecuciones.jsonl` ante cualquier duda: es el primer lugar
  donde mirar (por corrida: errores, conteos, confiable y motivos).
- Si los timeouts crecieran sostenidamente (>10% de páginas), considerar subir
  el delay entre requests o dividir el recorrido en dos jobs.
