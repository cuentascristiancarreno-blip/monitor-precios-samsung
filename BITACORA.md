# Bitácora de auditoría — 2026-07-24 (sesión nocturna autónoma)

Registro de avance para poder retomar si la sesión se interrumpe.
Pedido del operador: auditoría completa del sistema, corregir fallas de diseño,
eliminar falsas alertas, agregar pruebas, validar con corrida real.

## Diagnóstico (con evidencia)

- **CRÍTICO — Falsas alertas de "ya no aparece"/"nuevo":** el conteo por corrida
  oscila entre 891 y 950 productos porque siempre hay 10-30 páginas con timeout.
  Todo producto cuya página falló se reportaba como "eliminado", y al volver a
  cargar bien, como "nuevo". Medido en `history.jsonl`: **77 episodios de
  parpadeo en 19 corridas (~150 avisos falsos en 4 días)**.
- **ALTO — Sin regla de confirmación:** un producto se daba por desaparecido con
  UNA sola ausencia, sin verificar que su página cargó bien ni que la corrida
  completa fue sana.
- **ALTO — Sin registro de ejecuciones:** no quedaba rastro de cuántas páginas
  fallaron por corrida ni si una corrida fue completa o parcial.
- **MEDIO — Stock frágil:** `disponible` se deduce buscando "agotado" en el
  texto de TODA la página (puede venir de productos relacionados) → alertas de
  stock falsas. Sin confirmación de 2 observaciones.
- **MEDIO — history.jsonl crece sin control:** ~900 líneas por corrida × 7
  corridas/día ≈ 2.5 MB/día en un repo git público. El snapshot completo ya
  queda en el historial git de latest.json — duplicado innecesario.
- **MEDIO — Duplicados familia/seed:** un modelo capturado por su página propia
  y por una página familia descubierta quedaba con categoría
  "Familia (auto-descubierta)", rompiendo el ícono y el filtro de accesorios.
- **BAJO — Sin reintentos:** una página con timeout se daba por perdida sin
  segundo intento.
- **BAJO — Conflictos de push:** si un push de código coincide con la corrida,
  el rebase de datos puede chocar (pasó 2 veces en la práctica).

## Plan

1. [x] Bitácora inicial (este archivo)
2. [x] `src/comparar.mjs`: lógica pura de comparación (testeable) con:
       presencia (activo/ausente/desaparecido/error_verificacion), confirmación
       de desaparición (≥2 corridas confiables), confirmación de stock (2
       observaciones), arrastre de datos cuando la página falló, categoría
       específica gana sobre "Familia".
3. [x] `src/run.mjs`: reintento único por página fallida, detección de corrida
       no confiable (muchos errores o caída >20% de productos), registro en
       `data/ejecuciones.jsonl`, history.jsonl pasa a registrar EVENTOS de
       cambio (no snapshots completos).
4. [x] `src/discord.mjs`: tipos nuevos (recuperado, desaparecido confirmado),
       diferencia en pesos + % en cambios de precio, alerta técnica cuando la
       corrida es sospechosa.
5. [x] Pruebas automatizadas (node:test): extracción, comparación, formato
       Discord. `npm test` + paso de test en el workflow.
6. [x] Workflow: `git add data/` completo, rebase `-X theirs`, npm test previo.
7. [x] Smoke test local con carpeta de datos temporal (sin tocar producción).
8. [x] Documentación: README + docs/auditoria-2026-07-24.md.
9. [x] Corrida real de validación disparada y verificada end-to-end.

## Estado: AUDITORÍA COMPLETA — los 9 pasos terminados (2026-07-25 05:20 UTC)

Resultado de la corrida real de validación (run 30141264929, commit 2841a05):
- success de punta a punta, 130 min, 1168 páginas, solo 13 errores finales
  (el reintento recuperó el resto — antes eran 10-30 por corrida).
- 944 productos capturados; catálogo final 951 con `presencia`/`estadoStock`
  en todos y 0 precios inválidos.
- 6 productos ausentes quedaron en observación SIN alerta falsa (con el
  sistema anterior habrían sido 12 avisos falsos: 6 "eliminado" + 6 "nuevo").
- 1 página fallida conservó su último dato bueno (presencia error_verificacion).
- Cambios reales detectados y notificados: 17 bajas de precio legítimas
  (ej. Galaxy Tab S10 con ~10% de descuento) + 1 producto nuevo.
- Corrida marcada confiable:true; pruebas 26/26 también en CI.

---

# Títulos con variante — 2026-07-29

**Pedido del operador:** una notificación decía
`Galaxy S26 Ultra (Exclusivo en Samsung.com) (SM-S948BZDJLTL)` y no permitía
saber qué variante era (ese SKU es 256GB Pink Gold). Cada título debe incluir
producto, modelo y características clave.

**Causa:** `digitalData.displayName`, el nombre de las páginas individuales, no
trae variante. Medido: 144 de 592 productos notificables (24,3%) compartían
título con otro; 4 SKU distintos se llamaban igual. El campo `variante` del
listado (`src/seed.json`) existía pero `run.mjs` no lo copiaba al registro.

**Cambio:**
- `src/titulo.mjs` (nuevo, puro): compone `nombre · tamaño · almacenamiento ·
  RAM · color · CPU`. Fuentes en orden: diccionario por SKU (`especificaciones`,
  slot listo y sin conectar) → slug de `paginaOrigen` → nombre del JSON-LD de la
  página familia (solo capacidades) → `seed.variante`. Nunca repite lo que el
  nombre ya dice (comparación sin acentos, con límite de palabra y con los
  equivalentes en castellano), limpia el ruido (`<br>`, `｜`, tabuladores,
  paréntesis vacíos, placeholders `—`) y es idempotente.
- `src/catalogo.mjs` (nuevo): `integrarVariantes` + `esAccesorio`, salidos de
  `run.mjs` para poder probarlos. La unión con el listado es por URL (el campo
  `modelo` del seed está derivado del slug y no es el SKU real).
- `src/comparar.mjs`: los seis tipos de cambio llevan los datos del título, y el
  merge conserva variante/nombre si la corrida los observa vacíos.
- `src/discord.mjs`: usa el título compuesto, escapa markdown y mantiene el SKU
  entre paréntesis.

**Resultado medido sobre `data/latest.json` (969 productos):** títulos
compartidos entre notificables 144 → 22 (los 22 restantes no son distinguibles
con los datos disponibles: pares LTE/Bluetooth con el mismo slug, 4 pares de
línea blanca con nombre idéntico y The Wall). 0 contradicciones de color, 0
títulos que repiten información que el nombre ya traía. Título promedio
43,8 → 48,8 caracteres, sin cambio en la cantidad de mensajes. Pruebas
26 → 82, todas verdes.

**Costo en disco (medido, no estimado):**
- `data/latest.json`: 699 KB → 746 KB, **+46,5 KB por snapshot (+6,7%)** — no el
  +4% que decía la primera versión de este informe. `variante` y `nombreFamilia`
  se escriben siempre, incluso en null, para que el esquema quede uniforme;
  `nombreFamilia` son 24 KB de esos 46,5.
- `data/history.jsonl` (append-only, ya pesa 9 MB, va en git): cada evento lleva
  solo los campos que de verdad cambian un título, así que el sobrecosto es
  **+15 bytes por evento (x1,05)**. La primera versión mandaba 5 campos siempre y
  costaba +202 bytes por evento (x1,66): en un día malo como el 23/07 (4.483
  eventos) eso eran ~900 KB en un solo commit. Verificado que el payload liviano
  no cambia ningún título: 0 de 971.

**Lo que se descartó con medición:** los kg del slug (contradicen al nombre:
`DV90TA040BE/ZS` se llama "Secadora 9Kg" y su slug dice `8kg`); las pulgadas
fuera de pantallas (el slug del refrigerador Family Hub aportaba 32"); el color
del slug en bundles con dos colores; y las líneas de especificación de las
reseñas, que están agregadas por modelo y no por SKU.

## Arreglos de la auditoría adversarial del mismo día

Tres revisiones independientes encontraron 14 defectos sobre la versión anterior
de este cambio (ninguno crítico ni alto). Arreglados, con una prueba nueva cada
uno:

- **Información repetida en el título (3 + 1 + 3 productos notificables).** El
  nombre abrevia lo que el título agregaba: "i5" no calzaba con el patrón
  "core i5" y "16G" no calzaba con "16GB", así que se repetían CPU y memoria
  (`Galaxy Book3 Pro (16", i7, 16G) · 512GB · 16GB RAM · Core i7`). Y Samsung
  Chile traduce "Glam Deep Charcoal" como "Grafito", así que 3 lavadoras decían
  el mismo color en dos idiomas. Ahora los patrones aceptan la forma corta y
  "grafito" cuenta como charcoal. Medido: 0 títulos redundantes en los 969.
- **Separador sobrecargado.** El pipe del JSON-LD (`｜`) se traducía al mismo
  ` · ` que separa las características, así que no se distinguía el nombre de la
  variante: `Galaxy Z Fold7 256 GB · 12 GB Azul Intenso` parecía traer dos
  capacidades. Ahora el pipe va a ` / ` y ` · ` queda reservado para lo que
  agrega `titulo.mjs`.
- **Color inventado desde el listado.** `seed.variante` tiene filas con el color
  mal extraído ("Red" sacado de "Wired", "Blue" de "Bluetooth"): eran los 3
  únicos casos en que el listado cambiaba un título y los 3 estaban mal. Se
  descartan cuando la palabra aparece dentro de otra palabra del nombre.
- **Negrita sin cerrar en Discord.** `escaparMarkdown` no escapaba la barra
  invertida, que es su propio carácter de escape: un nombre terminado en `\`
  dejaba el `**` de cierre como asterisco literal y se arrastraba el precio, el
  link y los productos siguientes del mismo mensaje. Hoy ningún nombre trae
  barras, pero el texto es de Samsung. También se escapa el pipe (spoilers).
- **Dos fallas en el diccionario de especificaciones por SKU** (la fuente nº1,
  todavía sin conectar): un color llamado `constructor`/`toString` hacía reventar
  `notifyDiscord` y se perdían TODOS los avisos de la corrida; y un valor sin
  nada alfanumérico (`★★`) no se podía deduplicar y se repetía en cada pasada.
  Corregidas antes de conectar la fuente, no después.
- **Título inestable entre corridas.** El mismo SKU visto por su página
  individual traía el nombre pobre y pisaba el nombre con variante de la página
  familia, así que se anunciaba con color una corrida y sin color la siguiente.
  Ahora, si el nombre nuevo es el anterior recortado, se conserva el anterior
  (17 SKU lo hacían de verdad). La identidad sigue siendo el SKU: hay 2 pruebas
  dedicadas a que esto no cree ni duplique productos.
- **Peso de `history.jsonl`** (arriba): de +202 a +15 bytes por evento.
- Comentario obsoleto en `discord.mjs`: `esAccesorio` se mudó a `catalogo.mjs`.

**No se arreglaron, con motivo:** la ambigüedad que queda en 12 productos (no hay
dato que los distinga sin requests extra: los pares de Galaxy Watch8 se
diferencian por la AUSENCIA del token `bluetooth` en un slug, y ausencia no es
evidencia — verificado que ningún par ambiguo tiene token `lte`); y la
repetición de `nombreFamilia` con `nombre`, que es a propósito (es el respaldo
para la corrida siguiente, cuando el mismo SKU se ve por su página individual y
trae el nombre pobre — hay una prueba que lo demuestra).

## Conexión de la fuente nº1: especificaciones por SKU (RAM incluida)

El pedido del operador incluía la **RAM** y la versión anterior de este cambio la
dejó pendiente: `titulo.mjs` aceptaba el diccionario `especificaciones` pero nadie
lo llenaba, porque hacerlo exige tocar el mismo `page.evaluate` del que sale el
PRECIO y el agente que implementó no podía verificarlo en vivo.

**Verificado en vivo el 2026-07-29** (Playwright, ≥2 s entre requests, 8 páginas
reales: smartphone flagship y gama media, tablet, reloj, notebook, TV, monitor,
refrigerador y secadora) y conectado:

- `src/extract.mjs` lee las especificaciones por SKU de **dos lugares del HTML que
  ya está cargado para obtener el precio**, o sea **cero requests extra**:
  el input oculto `#BV-buyingOptionData` (diccionario SKU → {Color, Almacenamiento,
  RAM, …}) y el acordeón `.pdd32-product-spec` (única fuente de la RAM de celulares
  y tablets: `Memoria_(GB)`). Medido: 1 a 34 ms por página (~0,3% de la corrida).
  No se usa `page.content()` a propósito: medido 290 ms, 12 veces más caro.
- En las páginas familia, que se resuelven con `fetch` plano sin navegador, el
  mismo diccionario se lee del HTML descargado (`especificacionesDesdeHtml`), y
  como incluye a **todos los SKU hermanos**, cada variante toma las suyas.
- El precio nunca queda expuesto: la lectura va DESPUÉS de tener el precio y
  envuelta en `.catch(() => null)`. Si Samsung cambia un selector, se pierde el
  adorno del título, nunca el aviso de precio.
- `filtrarEspecificacionesUtiles` (en `titulo.mjs`, única autoridad de la lista
  blanca) guarda **solo 4 llaves canónicas** — `color`, `almacenamiento`, `ram`,
  `tamano` — de las ~60 que publica cada página. Descarta el ruido que probé que
  llega: `Velocidad CPU`, `Tamaño Pantalla Principal` (el largo en mm), `Color
  delantero`, `Tamaño de la caja`. Guardar la llave canónica y no la de Samsung
  evita el dato duplicado que medí en el TV (`tamaño` y `Tamaño de pantalla`).
- **Memorias en MB descartadas:** el Galaxy Fit3 publica `Memory (MB): 16 MB` y
  "16MB RAM" al lado de una pulsera de $49.990 confunde más de lo que informa.

**Resultado en vivo, por el flujo completo (navegador → catálogo → mensaje):**

| SKU | antes | ahora |
|---|---|---|
| SM-S948BZDJLTL | Galaxy S26 Ultra (Exclusivo en Samsung.com) | … · **256GB · 12GB RAM · Oro rosa** |
| SM-S948BZSKLTL | Galaxy S26 Ultra (Exclusivo en Samsung.com) | … · **512GB · 12GB RAM · Sombra plateada** |
| SM-A176BZKQLTL | Galaxy A17 5G | … · **256GB · 8GB RAM · Negro** |
| SM-X133NZAAL07 | Galaxy Tab A11 | … · **64GB · 4GB RAM · Gris** |

Los dos S26 Ultra tenían el título IDÉNTICO y ahora se distinguen solos. Además el
color pasa a ser el oficial que Samsung muestra en su propia caja de compra ("Oro
rosa", "Sombra plateada") en vez del que se deducía del slug.

**Costo medido:** `data/latest.json` 683 KB → 786 KB, **+103 KB por snapshot
(+15,1%, +109 bytes por producto)**. Se guarda a propósito: sin eso, los avisos de
"ya no aparece" (donde el producto justamente no se puede volver a consultar)
perderían las características. Pruebas 82 → 97, todas verdes.

### Resultado medido de la corrida real de validación (run 30507200349, commit dfce212)

Corrida completa el 2026-07-30, 132 min, 1168 páginas, 12 errores, 953 productos
capturados, `confiable: true`.

- **Cero cambios detectados de cualquier tipo.** Es el control de regresión más
  importante: agregar campos nuevos a cada registro NO generó ni un aviso falso
  de "nuevo" ni de "desaparecido". La identidad sigue siendo el SKU.
- **867 de 969 productos (89,5%)** quedaron con especificaciones leídas del sitio;
  **773 con el color oficial** y **108 con RAM** (los 108 son celulares, tablets y
  notebooks: el resto de las categorías no tiene RAM que informar).
- **Títulos compartidos entre notificables: 144 → 8** (se habían proyectado 22; la
  fuente por SKU resolvió 14 casos más de los previstos). 0 títulos con basura
  (`undefined`/`NaN`/`null`) sobre los 969.
- Los 8 que quedan son 4 pares que Samsung publica con nombre y datos idénticos:
  dos combos aspiradora+lavadora `Midnight Blue`, dos `The Wall All-in-One`, dos
  `Galaxy Z Flip7` (entran por página familia, sin especificaciones propias) y dos
  `Galaxy Watch8 (Bluetooth, 44 mm) · Plata` (se diferencian por LTE, dato que el
  sitio no expone por SKU). En todos, el código de modelo entre paréntesis sigue
  siendo el diferenciador.
- **Costo real en disco:** `data/latest.json` 683,3 KB → 808,1 KB, **+124,8 KB
  (+18,3%)** por snapshot. Es más que el +15,1% que estimé simulando, porque la
  estimación asumía 3 llaves para todos y hay productos con 4.
- Caso del operador verificado sobre el dato real de producción:
  `Galaxy S26 Ultra (Exclusivo en Samsung.com) · 256GB · 12GB RAM · Oro rosa`.

---

# Ruido de avisos repetidos y lista de silencio — 2026-08-01

**Pedido del operador:** "Hay productos como Book3 y sus variantes que siempre
envían notificaciones, pero nunca tendrán stock o están obsoletos. ¿Qué otros
están así? Ayúdame a decidir si mandarlos a una lista de no notificar."

**La premisa era incorrecta, y se comprobó cargando las páginas.** El Book3 no
está obsoleto: el 2026-08-01 su página responde 200 en su propia URL con precio
$1.399.990 (Book3 Pro $1.999.990, S23 FE $679.990, Tab A9 $159.990, Watch Ultra
$699.990). Los avisos repetidos eran **tres errores del monitor**:

1. **Carrera con el precio (48 avisos).** Samsung no trae el precio en el HTML:
   la página se lo pide a `api.shop.samsung.com`. Medido: el evento `load` ocurre
   a los 739 ms y el precio llega a los 827 ms. El monitor leía en el medio y
   encontraba el relleno `"0,0"` → `NaN` → "producto sin precio" → el SKU no
   entraba al observado → 2 ausencias → "desapareció", y a la corrida siguiente
   "reapareció".
2. **Fichas fusionadas.** En páginas con varios productos,
   `digitalData.product.model_code` viene con los códigos pegados
   (`NP750QFG-KB2CL,NP750XFG-KB4CL`). 4 fichas así escondían **10 productos
   reales**, 9 de ellos sin vigilancia individual, todos compartiendo UN precio.
   Medido en vivo: la página del Book3 360 publica 4 precios distintos
   ($1.399.990, $849.990, $749.990, $1.299.991) y el monitor guardaba uno.
3. **Corridas que se pisan y borran historial.** El workflow usaba
   `git pull --rebase -X theirs`, que en archivos append-only resuelve el
   conflicto BORRANDO las líneas de la otra corrida. Verificado recorriendo el
   historial de git: hay commits donde `history.jsonl` pierde líneas (22 en la
   ventana medida). Además, una corrida que arranca con catálogo viejo reenvía
   avisos ya mandados.

**Los productos que SÍ están obsoletos son otros: 27** (24 monitores
descontinuados + 3 páginas familia). Su firma es distinta y verificada: la página
**redirige** fuera de su ficha (ej. a `/cl/tvs/all-tvs/`) y el precio nunca llega
ni esperando 12 s. Y ya están en silencio: avisaron "desapareció" una vez y no
volvieron a hacer ruido (43 avisos en total, ninguno nuevo). O sea: **lo obsoleto
ya está callado y lo que hacía ruido estaba vivo.**

**Decisiones del operador (2026-08-01):** aplicar los 3 arreglos en orden;
limpiar antes de separar las fichas para no emitir avisos falsos; dejar los 24
monitores descontinuados como están; y **silenciar Book3 y todas sus variantes
hasta nuevo aviso**.

## Cambios aplicados

- `src/silenciados.mjs` (nuevo): reglas de silencio por nombre y por código de
  modelo. Book3 queda silenciado por `/\bbook\s*3\b/i` más los prefijos
  `NP730QFG|NP750QFG|NP750XFG|NP960XFG|NP960QFG|NP940XFG` (estos últimos cubren
  los SKU que aparecen al separar las fichas, cuyo nombre puede no decir
  "Book3"). Probado que NO alcanza a Book2, Book4, Book5 ni Book 6.
  El filtro se aplica en `run.mjs` DESPUÉS de escribir catálogo e historial: el
  producto se sigue vigilando y su historial de precios se sigue guardando, solo
  se omite el mensaje. Para reactivarlo basta borrar la regla.
- `src/extract.mjs`: espera hasta 8 s a que el precio llegue (acepta coma
  decimal); y si la página identifica un producto pero el precio nunca llega,
  **lanza** en vez de dar el producto por inexistente, para que la página cuente
  como fallida y `comparar()` conserve el último dato bueno. Un producto dado de
  baja de verdad no llega ahí: su página redirige y ya no trae `model_code`.
- `src/extract.mjs` + `src/run.mjs`: las páginas con varios productos emiten un
  registro por SKU, con su propio precio, tomado de la respuesta que **la propia
  página ya le pide** a la API de Samsung (se escucha con `page.on("response")`:
  cero requests extra, no cambia la carga sobre el sitio). Si esa respuesta no
  llega, la página se trata como fallida en vez de volver a guardar una ficha
  fusionada.
- `.github/workflows/monitor.yml`: `concurrency` pasa a nivel de workflow (a
  nivel de job no impidió el solape), `git pull --ff-only` antes de comparar, y
  se quita `-X theirs`.
- `.gitattributes` (nuevo): `merge=union` para los `.jsonl`, que es lo correcto
  en archivos que solo crecen.
- `data/latest.json`: se borraron a mano las 4 fichas fusionadas en este mismo
  commit, para que su desaparición no genere avisos falsos.

**Verificación en vivo (página real del Book3 360 + una de control):** la ficha
fusionada se separó en `NP750QFG-KB2CL` ($1.399.990) y `NP750XFG-KB4CL`
($849.990), y el log confirma `INFO silenciados regla=book3 avisos=2` — o sea los
dos avisos existieron, quedaron en el historial y NO se enviaron a Discord.
Pruebas 97 → 115, todas verdes.

**Lo que el operador va a ver una vez:** al separarse las fichas aparecen 9
productos que antes estaban escondidos. 3 son Book3 (silenciados) y **6 son
tablets reales** (Tab A9, Tab A9 Plus, Tab S9 FE en sus 4 variantes) que van a
anunciarse como "producto nuevo" en la primera corrida. No son avisos falsos: son
productos que hasta hoy nadie vigilaba individualmente y ahora tienen su propio
precio bajo seguimiento.
