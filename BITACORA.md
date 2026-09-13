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

## Incidente 2026-08-02: el monitor estuvo ~15 h sin completar una revisión

**Causado por el arreglo del día anterior (regresión propia, no de Samsung).**

Qué pasó: la espera de precio se aplicaba a TODAS las páginas sin precio válido, y
además hacía `throw`, lo que las mandaba al reintento. Hay ~150 páginas que
legítimamente nunca publican precio (accesorios: filtros, kits). Medido en vivo:
esas páginas tardan ~30 s en disparar `load`, así que cada una pasó a costar
~37 s **dos veces** (intento + reintento) ≈ 92 min extra. La corrida se pasó del
límite de 240 min del job y **GitHub la mató sin dejar datos ni avisos**. Las
corridas programadas siguientes hicieron lo mismo o quedaron canceladas por la
concurrencia, así que ninguna completó entre las 00:43 y las 15:48 UTC.

Cómo se detectó: la corrida de validación figuraba `cancelled` exactamente a las
4 h de arrancar el job (00:43:20Z → 04:43:36Z), la firma del timeout.

Arreglos:
- `PRECIO_TIMEOUT_MS` 8000 → **3000 ms** (34 veces la carrera medida de 88 ms).
- El `throw` protector ahora es **selectivo**: solo cuando el precio parece estar
  cargando, señal medida = relleno con coma (`"0,0"`, lo que publica una página
  multi-producto mientras espera a la API — el caso del Book3). Las páginas que
  simplemente no tienen precio traen un valor permanente (`"NaN"` en el filtro de
  purificador, `"0"` en el kit receptor) y vuelven a devolver `null` sin lanzar y
  **sin reintento**.
- `timeout-minutes` 240 → **330** como red de seguridad: es preferible una
  corrida larga que una muerta.

Verificado en vivo tras el arreglo: el filtro y el kit devuelven `null` sin
lanzar; el Book3 360 se separa en `NP750QFG-KB2CL` ($1.399.990) y
`NP750XFG-KB4CL` ($849.990) en 1,0 s; el S26 Ultra sigue normal ($1.199.990).
Pruebas 115 → 116.

**Lección:** un cambio que agrega espera hay que medirlo contra el PEOR caso del
catálogo (páginas lentas sin precio), no contra el caso que se está arreglando.

### Resultado medido de la corrida de restauración (run 30755481919, commit 9fde55b)

Corrida completa el 2026-08-02, **success**, `confiable: true`, 1168 páginas,
13 errores, 940 productos.

**Los 3 arreglos, verificados con datos reales:**

1. **Ciclo desaparece/reaparece: detenido.** Esta corrida emitió **0
   desaparecidos y 0 recuperados** (antes eran el ruido principal: 48 avisos).
   Las líneas `precio no disponible` pasaron de **150 a 0**, y los reintentos de
   81 a 13 — o sea la tormenta de reintentos que mataba la corrida se apagó.
2. **Fichas fusionadas: separadas.** 0 llaves con coma en el catálogo. Los 10
   productos reales quedaron con su propio precio:
   Book3 360 $1.399.990 · Book3 $849.990 · Book3 Pro $1.699.990 · Book3 Pro 360
   $1.999.990 · Tab A9 $159.990 · Tab A9 Plus $239.990 · Tab S9 FE WiFi $499.990
   · Tab S9 FE 5G $619.990 · Tab S9 FE+ WiFi $669.990 · Tab S9 FE+ 5G $779.990.
   Antes los 4 primeros compartían un solo precio con otro producto.
3. **Corridas que se pisan:** la concurrencia a nivel de workflow funcionó (se
   vio en vivo: una corrida quedó en cola en vez de ejecutarse en paralelo).

**Silencio del Book3 funcionando:** el log dice
`INFO silenciados regla=book3 avisos=3`. De los 9 avisos "nuevo" que generó la
separación de fichas, 3 eran Book3 y **no se enviaron a Discord**; los otros 6
son las tablets reales (Tab A9, A9 Plus y las 4 del Tab S9 FE) que ahora se
vigilan individualmente. El operador recibió 7 avisos: esos 6 + 1 suba de precio.

**PENDIENTE — la corrida tardó 212 min, fuera del rango histórico (127-179,
promedio 140).** De mis cambios solo puedo atribuir ~7 min medidos (135 páginas
sin precio × 3 s); el resto no está explicado y puede ser latencia de Samsung ese
día. Importa porque **con 7 revisiones al día cada 3 h, una corrida de 3,5 h se
solapa con la siguiente** y la concurrencia la deja en cola o la cancela: en la
práctica saldrían 5-6 revisiones al día en vez de 7. Decisión pendiente del
operador: bajar a 6 revisiones (cada 4 h) o acelerar la corrida. Candidato
concreto para acelerar: cambiar `waitUntil: "load"` por `"domcontentloaded"` en
`src/run.mjs` — medido, las páginas de accesorios tardan ~30 s en disparar
`load`, y hay 135 de ellas por corrida (~60 min del total).

### Aceleración de la corrida: `domcontentloaded` (2026-08-02)

Decisión del operador tras el informe anterior: acelerar la corrida en vez de
bajar la frecuencia de revisiones.

`src/run.mjs` pasa de `waitUntil: "load"` a `"domcontentloaded"`. Es seguro
porque el precio **no viene en la carga inicial de todos modos**: la página se lo
pide después a `api.shop.samsung.com`, y `extractSingleProduct` ya lo espera
explícitamente (hasta 3 s). Esperar a que terminen de bajar imágenes y scripts de
terceros no aportaba nada.

**Verificado antes de aplicarlo**, comparando los dos modos sobre 10 páginas
reales de tipos distintos (accesorio sin precio, accesorio 2, smartphone
flagship, smartphone gama media, tablet, multi-producto Book3, TV, línea blanca,
monitor, reloj): **10 de 10 dieron resultado IDÉNTICO** en precio, stock y
especificaciones. Ahorro medido: 3,12 s promedio por página → **~61 min menos por
corrida** sobre 1168 páginas.

Detalle del ahorro por tipo: TV 6,8 s · smartphone flagship 4,5 s · línea blanca
2,0 s · reloj 1,5 s · smartphone gama media 1,0 s · tablet 0,7 s · multi-producto
0,6 s. Las 2 páginas sin precio siguen siendo lentas (~31 s): tardan en llegar al
propio `domcontentloaded`, así que ahí el ahorro es marginal — la ganancia viene
del resto del catálogo.

Prueba end-to-end con el flujo completo sobre 6 páginas reales: 7 productos
capturados con precio, stock y especificaciones correctos, Book3 separado en
$1.399.990 y $849.990 y silenciado (`INFO silenciados regla=book3 avisos=2`).
Pruebas: 116 verdes.

---

# Precio fantasma en fichas de pack — 2026-08-03

**Reporte del operador:** llego un aviso de baja de precio del pack
"Watch Ultra (2025) Blue + Galaxy Buds4 Pro" (F-SMR640SML70), pero al entrar a la
pagina el precio era el normal ($974.980) y ademas figuraba sin stock.

**Causa (medida en vivo, 3 cargas seguidas):** esa ficha publica DOS precios
distintos en `digitalData`:
- `model_price` = 555980 -> es el que leia el monitor
- `list_price` = 974980 -> es el que el cliente VE en pantalla

El numero 555.980 **no aparece en ninguna parte de la pagina**: los unicos montos
visibles son $974.980 y la cuota de $81.248. O sea el monitor llevaba meses
vigilando un precio que no existe para el cliente, y su vaiven genero los avisos
del 03-08 (sube 555.980 -> 974.980 a las 19:13 y baja de vuelta a las 22:04).

**No es "todos los packs".** Comparadas 8 fichas (4 packs y 4 productos normales),
solo esta cae en la excepcion; en las otras 7 el `model_price` es exactamente el
monto visible, incluidos los packs de aire acondicionado.

**Arreglo:** `precioVisiblePreferido()` en `src/extract.mjs`. Si el `model_price`
no esta escrito en la pagina pero el `list_price` si, gana el `list_price`. Si
ninguno de los dos esta visible (pagina a medio renderizar) no se cambia nada,
para no inventar un precio. Cuesta cero requests: el texto de la pagina ya se lee
para detectar el stock.

Verificado en vivo tras el arreglo: el pack pasa a $974.980 y los tres controles
quedan intactos (S26 Ultra $1.199.990, TV F6000 $209.990, pack aire+microondas
$1.395.980). Pruebas 116 -> 122. Se corrigio a mano el precio guardado del pack
en `data/latest.json` para que la correccion no dispare un aviso de "subio".

## Pendiente: el stock del pack no se detecto

El operador tambien vio "Avísame" (= sin stock) mientras el monitor lo tenia como
disponible. `STOCK_NEGATIVO` busca "agotado|no disponible|fuera de stock|sin
stock" en el texto de TODA la pagina, y Samsung marca el sin-stock con el boton
**"Avísame"**, que no esta en esa lista.

**Pero agregar la palabra sin mas seria peor:** medido, el TV F6000 — que SI
tiene stock — contiene "avisame" 2 veces en su texto (viene del carrusel
"¿Buscas alternativas?"). Agregarla generaria falsos "agotado" en productos
disponibles.

El arreglo correcto es acotar la deteccion de stock al bloque de compra en vez de
leer la pagina entera, y eso hay que verificarlo contra una ficha que este
realmente sin stock en el momento de la prueba. Cuando se probo, la ficha del
pack ya habia vuelto a tener stock ("Avísame" ya no aparecia), asi que quedo
pendiente de verificacion. NO se toco `STOCK_NEGATIVO` para no cambiar a ciegas
algo que hoy funciona.

# 2026-09-11 — El stock estaba mal en todo el sistema (y productos colgados de la pagina equivocada)

Cierra el "Pendiente: el stock del pack no se detecto" de mas arriba, y de paso
dos problemas de atribucion que salieron de la misma investigacion.

## 1. El stock: 894 de 928 "disponibles" era un default, no una medicion

`STOCK_NEGATIVO` buscaba 4 palabras en el texto de TODA la pagina y lo que no las
trajera quedaba **disponible por defecto**. Samsung marca el sin-stock con el
boton "Avísame", que no estaba en esa lista.

Medido antes del arreglo:
- Aspiradoras: el catalogo decia 15 disponibles de 17; en vivo solo 1 era
  comprable, 15 mostraban "Avísame" y 1 "no está a la venta".
- Muestra de 42 productos (2 por categoria notificable): la regla vieja acertaba
  **26 de 42 (62%)** y los 16 errores iban TODOS en el mismo sentido.

**Arreglo:** `src/stock.mjs`, una maquina de estados unica con cuatro estados
(disponible / agotado / no-a-la-venta / desconocido) alimentada, en este orden de
confianza, por el **bloque de compra** (`[class*='buying']`), por
`stock.stockLevelStatus` de la API que la propia pagina ya pide, y por el
`availability` del JSON-LD. **"desconocido" nunca se convierte en "disponible"**:
si no se sabe, el estado no cambia y no se notifica nada.

La trampa que documentaba la entrada anterior sigue viva y ahora tiene prueba: el
TV F6000 trae "avisame" en el carrusel "¿Buscas alternativas?", y por eso la
lectura se acota al bloque de compra en vez de al body.

Dos falsos positivos mas aparecieron al verificar contra paginas reales, los dos
tambien con prueba:
- "Agregar al carro" es el boton de compra de TV y linea blanca (los celulares
  dicen "Comprar" y los relojes "Comprar ahora"). Sin el, media tienda habria
  quedado en "desconocido".
- **"Dónde comprar" NO es un boton de compra**: es el buscador de tiendas fisicas
  que Samsung pone en lo que no vende online (medido en el Flip Pro WM85B y en el
  hub SmartThings ET-WV521BWEGCH). La palabra "comprar" que lleva adentro los
  daba por disponibles.

## 2. Productos atribuidos a la pagina equivocada: son REDIRECCIONES

La pagina del Galaxy S25 FE 512GB producia 4 SKU que no son S25 FE sino S25
normal (SM-S931B*, $1.069.990). Verificado cargando las paginas: Samsung redirige
la ficha que deja de vender a la de un hermano, y el monitor anotaba el producto
del hermano como si fuera de la URL que habia pedido.

    ls03f-55-inch-...-qn55ls03fagxzs/        -> ls03f-50-inch-...-qn50ls03fagxzs/
    rs5300t-...-natural-gray-rs60t5200s9-zs/ -> rs5300t-...-ebony-black-rs60t5200b1-zs/
    galaxy-s25-fe-navy-512gb-sm-s731bdbpltl/buy/ -> galaxy-s25/buy/?modelCode=SM-S731BDBPLTL

Como el producto del hermano TAMBIEN se captura desde su propia pagina, el mismo
SKU entraba por dos caminos y ganaba el ultimo que escribia, con precios
distintos: ese era el reclamo de los "precios contradictorios".

**Arreglo:** `src/identidad.mjs`. Una entrada se queda con un SKU si la URL pedida
lo nombra, o si la navegacion no termino en otra pagina. Mirar solo la
redireccion no alcanzaba: Samsung tambien **renombra slugs** del mismo producto
("22-cu-ft" -> "628l") y esa ficha si es la suya.

Las 5 paginas de grupo legitimas (Tab S9 FE, Tab A9, Book3, Book3 Pro, Z Fold7)
se verificaron en vivo: no redirigen y su slug no nombra ningun SKU, asi que
siguen entregando todas sus variantes.

**Red de seguridad:** una pagina redirigida NO cuenta como error (no se reintenta
ni ensucia el indicador de corrida confiable) pero SI entra al conjunto de
"paginas no verificadas" que recibe `comparar()`. Por muchas fichas que Samsung
empiece a redirigir, sus productos conservan el ultimo dato bueno y jamas se
convierten en una tanda de falsos "ya no aparece".

## 3. Precedencia: manda la ficha donde el cliente compra

Medido en el S25 FE 256GB: su ficha propia muestra **$579.990 con boton
"Comprar"** mientras la pagina agrupada y su API dicen **$829.990** para el mismo
SKU, y hasta lo marcan agotado. Cada registro lleva ahora un **rango**
(propia 3 > familia 2 > agrupada 1) y en `integrarVariantes` gana el rango mas
alto, no el ultimo que escribe. Antes esto dependia de que la categoria fuera
"Familia (auto-descubierta)", asi que dos paginas agrupadas entre si se pisaban
por orden de llegada.

## 4. Migracion: por que no llegaron cientos de "se agoto"

Si el detector nuevo hubiera entrado sin mas, la primera corrida habria dejado
cientos de "agotado" esperando confirmacion y la SEGUNDA los habria notificado
todos juntos: cientos de avisos que no son novedades del sitio, sino la
correccion de un dato que siempre estuvo mal.

Cada observacion viaja ahora con la **version del detector** que la produjo
(`VERSION_STOCK`, hoy 2). Cuando la observacion viene de un detector mas nuevo
que el que produjo el estado guardado, el estado se adopta **en silencio** y se
sella la version en el registro. Se auto-desactiva sola y por SKU: a la corrida
siguiente vuelven a regir las reglas normales, incluida la confirmacion en 2
corridas. No hay fecha de corte ni variable de entorno que apagar.

Verificado con una corrida real de 10 paginas contra el catalogo de produccion:
9 productos leidos, **8 tenian el estado equivocado**, **0 eventos emitidos**
(`history.jsonl` no se llego a crear).

### Que se re-establece y que no

Solo se re-establece en silencio lo que la version vieja **no habia medido**: su
"disponible" era un DEFECTO, no una lectura. El "agotado" de la version vieja si
salia de encontrar la palabra en la pagina, asi que es linea base valida y NO se
re-establece. Si tambien se re-estableciera, un producto que estaba agotado y
vuelve a tener stock se adoptaria en silencio y se perderia el aviso que el
operador mas quiere. Costo medido sobre el catalogo real: ~891 SKU se siguen
corrigiendo en silencio, ~34 conservan su linea base, ~19 avisos legitimos en la
segunda corrida.

Eso ademas **cierra la ventana**. Antes, un SKU que se leyera siempre como
"desconocido" no sellaba nunca la version y quedaba con la adopcion silenciosa
armada indefinidamente (caso real: SM-S741BLGPLTL).

### ⚠️ LA MIGRACION ES DE UNA SOLA VIA: revertir el codigo OBLIGA a revertir los datos

Despues de la primera corrida corregida, `data/latest.json` queda lleno de
estados v2 ("agotado", "no-a-la-venta") con su `versionStock` sellado. Si en ese
momento se revierte SOLO el codigo -- el gesto natural si algo se ve raro en
pleno Cyber --, vuelve el detector viejo, que daba "disponible" por defecto en el
96% de las paginas, y la confirmacion en 2 corridas retrasa el golpe una corrida
y despues lo suelta entero.

Simulado con el `comparar.mjs` de HEAD sobre el catalogo real: corrida 1 con el
codigo nuevo, 0 eventos; se revierte el codigo; corrida 2, 0 eventos (se llenan
los pendientes); corrida 3: **407 eventos de stock y ~256 avisos de golpe, todos
falsos**. Revertir SOLO los datos y dejar el codigo nuevo da 0 eventos, porque la
migracion se re-arma sola.

Reglas practicas:

1. El commit del codigo y el de `data/latest.json` tienen que ser **el mismo
   commit**, para que un `git revert` unico deje las dos cosas consistentes.
2. Si hay que volver atras: revertir el codigo **y** `data/latest.json` al mismo
   commit. Alternativa equivalente: borrarle `estadoStock` y `versionStock` a
   todos los registros.
3. Revertir solo los datos es seguro. Revertir solo el codigo, no.

## 5. Limpieza de data/latest.json

Se borraron 4 registros: SM-S931BDBKLTL, SM-S931BLBKLTL, SM-S931BZKKLTL y
SM-S931BZDKLTL. Colgaban de la pagina del S25 FE y su pagina duena
(`/smartphones/galaxy-s25/buy/`) **no esta ni en `seed.json` ni en ninguno de los
4 sitemaps**, o sea que nadie los va a observar nunca mas. Borrar la llave no
genera avisos: el segundo bucle de `comparar()` solo recorre lo que existe en
`previo`, asi que un SKU que ya no esta simplemente no produce ningun evento
(dejarlos habria dado 4 falsos "ya no aparece").

Los demas mal atribuidos (QN50LS03FAGXZS, RS60T5200B1/ZS y dos kits de repuesto)
NO se tocaron: cada uno tiene su propia pagina en `seed.json` y se recaptura ahi,
con su precio correcto.

## Verificacion

Recorrido nuevo sobre 22 paginas reales, una por categoria notificable, distintas
de las 42 de la medicion inicial: 14 disponible, 5 agotado, 2 no-a-la-venta,
1 redireccion detectada, 0 errores. **En 7 de las 22 la regla vieja decia
"disponible" y la nueva dice que no** (32%, consistente con el 38% de la muestra
original). Cada veredicto calza con el texto literal del bloque de compra.

Pruebas: 144 -> 196.

---

## 2026-09-11 (tarde) — Reparacion tras la revision del arreglo de stock

Tres revisores independientes auditaron el arreglo anterior y encontraron 13
defectos. Se corrigieron todos. Lo importante:

### 1. El falso "disponible" se habia mudado, no eliminado (critico)

El arreglo de la manana acotaba la lectura al bloque de compra
(`[class*='buying']`). Pero en las paginas /buy/ con plantilla **hubble**
(galaxy-z-flip7/buy/ y companeras) el primer `[class*='buying']` del documento no
es la barra de precio: es el Buying Tool ENTERO, con el pie promocional adentro.
Texto literal medido en vivo:

    "¡Al comprar tu Galaxy Z Flip7!"
    "Acumula puntos al comprar tus productos favoritos y luego paga con puntos"

Buscar la palabra "comprar" ahi devolvia DISPONIBLE para un producto agotado, y
ademas de forma **no deterministica** segun si el pie alcanzaba a renderizarse:
el mismo SKU alternaba entre disponible y agotado de una corrida a otra. Era el
mismo falso positivo de siempre, mudado de la pagina entera al bloque.

Ahora el veredicto sale del **CTA, no del parrafo**, en tres capas:

1. los **botones** del bloque: se compara el texto COMPLETO del boton contra un
   vocabulario cerrado, asi que ninguna frase de marketing se puede colar. Es la
   capa deterministica.
2. las **lineas** del innerText: el CTA real ocupa su propia linea.
3. el texto colapsado, despues de cortar el pie promocional y de descartar los
   "comprar" que son verbo de una oracion ("al comprar tu…", "de comprar mi…").

Y el bloque se elige del mas **estrecho** al mas amplio: `pd-buying-price`
(verificado en vivo sobre TV, notebook y accesorio: su innerText es exactamente
precio + CTA) antes que el contenedor grande.

### 2. Las /buy/ de una sola variante nunca abrian el navegador (alto)

`procesarEntrada` cortaba apenas el JSON-LD devolvia una variante, asi que para
esos SKU el bloque de compra no se leia jamas. Y el `availability` del JSON-LD
**miente**: medido en `galaxy-book4-…-np750xgj-ks4cl/buy/`, dice `"inStock"`
mientras el boton en pantalla dice "Avísame" y la API responde outOfStock. Como
esa pagina es la UNICA fuente de ese SKU, el rango FAMILIA no salvaba nada.

Ahora una /buy/ de UNA variante va al navegador (son 71 de ~1170 paginas, del
orden de 7 min de corrida) y una de VARIAS sigue resolviendose barata. Si el
navegador falla, el SKU no se pierde: se conserva el PRECIO del JSON-LD y el
stock queda "desconocido". El nombre rico del JSON-LD se reinyecta por SKU para
no perder capacidad/RAM/color en el titulo.

`procesarEntrada` se movio de `run.mjs` a **`src/resolver.mjs`** para poder
probarlo (run.mjs arranca `main()` al importarse).

### 3. La barra de precio pegajosa, antes de la API

En las paginas hubble el bloque no trae ningun boton, pero la barra de abajo si:
en galaxy-z-flip7/buy/ dice literalmente **"No está a la venta"**
(`a.cta.price-bar-cart-btn.is-cta-disabled`, visible) y esta FUERA de
`[class*='buying']`. Sin mirarla ese SKU se guardaba como "agotado" por la API,
que es un estado distinto del que ve el cliente. Orden de fuentes:
**bloque -> barra -> API**, cada una solo si la anterior no decidio, asi que
agregar la barra no le puede quitar el veredicto a nadie.

### 4. "Dónde comprar" es "no esta a la venta", no "agotado"

El modulo documentaba que ahi habia que callarse, pero `extractSingleProduct`
caia enseguida a la API, que para esos productos responde outOfStock: la decision
de callarse duraba una linea. Un producto que Samsung no vende online no esta
agotado. Ahora es un estado comprometido y corta el fallback a la API, asi que la
API tampoco lo puede resucitar con un falso "volvió el stock".

### 5. El precio de la API ya no pisa al que el cliente ve

`varios ? precioApi : precioFinal` tiraba a la basura `precioVisiblePreferido()`
justo en el caso que esa defensa vino a cubrir (el pack Watch Ultra + Buds4 Pro,
03-08). La API entra SOLO cuando el precio leido no aparece escrito en ninguna
parte de la pagina, que es la senal de que no es de este SKU.

### 6. Otros

- **La migracion ya no se puede quedar armada** y no se traga un "volvió el
  stock": ver "Que se re-establece y que no" mas arriba.
- **El registro ya no se contradice**: `disponible` se deriva SIEMPRE del
  `estadoStock` comprometido.
- **Productos momificados visibles**: un SKU cuya pagina falla o redirige
  conserva su ultimo dato (bien) pero podia quedar congelado para siempre sin que
  nada lo dijera. Se cuenta en el resumen (`sinVerificar`) y a las 20 corridas
  seguidas sale UNA vez por el canal tecnico. La regla de ausencias no se toco.

### Verificacion

- **Muestra nueva de 49 paginas** (2 por categoria notificable, distintas de las
  muestras anteriores, mas los 4 casos problema), con el `procesarEntrada` real:
  **36 de 36 comparables correctas = 100%**. La regla vieja habria acertado 17 de
  36 (47%). Verdad medida: 16 disponibles, 11 agotados, 9 no a la venta.
- Las 13 paginas restantes no producen registro porque Samsung nunca publica
  `model_price` en ellas (se verifico hasta 10 s). **Las 13 son pre-existentes**:
  10 nunca estuvieron en el catalogo y 3 ya figuraban "desaparecido" con 240-271
  ausencias. No es una regresion de este cambio.
- **Mutantes**: se deshizo cada arreglo uno por uno en una copia fuera del arbol y
  la suite fallo en los 12 casos. Ninguna prueba nueva es decorativa.
- Corrida real de `run.mjs` contra el catalogo de produccion en carpeta temporal
  (sin webhook, VIVO=0): 1027 registros conservados, **0 eventos**.
- Pruebas: 214 -> 241.

---

## 2026-09-12 — Segunda revision en vivo: el enlace a /buy/ y el precio tachado

Verificacion independiente del arreglo anterior, con muestra PROPIA (percentiles 10 y 90 de cada categoria por precio guardado, un puesto que ninguna ronda anterior habia usado) y verdad medida a mano sobre el texto literal del bloque de compra. 29 paginas + 6 comparaciones ficha-plana-contra-/buy/ + 46 paginas para el precio. UA CazadorBot, >=2,5 s entre requests, cero requests extra, jamas el webhook real.

El arreglo del 11-09 quedo confirmado (de 29 paginas, el catalogo decia "disponible" en las 29 y la realidad eran 10), pero aparecieron dos defectos que la revision anterior no cubrio.

### 1. El CTA "Comprar" de una ficha plana es un ENLACE, no un boton de compra

Medido: en las fichas planas, "Comprar"/"Comprar ahora" lleva `href="/cl/.../buy/?modelCode=..."` — es navegacion a la pagina de compra. El boton que de verdad agrega al carro es "Agregar al carro", con `href="javascript:;"`.

Comparando las 6 fichas de la muestra cuyo CTA es ese enlace contra su propia pagina /buy/:

| Producto | Ficha plana | Su /buy/ | Veredicto |
|---|---|---|---|
| Watch9, Watch8 40mm, A37, Tab S10 Lite, Book6 Pro | "Comprar ahora" + precio | "Agregar al carro" | hay stock: la ficha plana acertaba |
| Galaxy Book4 NP750XGJ-KS4CL | "Comprar ahora", SIN precio | **"Avísame"** | NO hay stock: la ficha plana lo daba por disponible |

Lo que separa los dos casos no es el boton sino el PRECIO: los 5 correctos traen "Desde $ 33.333 en 12 cuotas sin intereses* o $399.990 ... Comprar ahora"; el Book4 trae literalmente "Comprar ahora" y nada mas. Cuando Samsung no puede vender, la barra suelta el precio y deja solo el enlace.

**Arreglo** (`src/stock.mjs`): un veredicto DISPONIBLE exige que el bloque traiga un precio. Sin precio el bloque no decide y mandan las fuentes siguientes (barra pegajosa -> API por SKU). No se exige para "Avísame" ni "no está a la venta": esos son decisivos igual, y ese es el lado seguro.

**Arreglo 2** (`src/catalogo.mjs`): dos paginas del MISMO rango pueden ver el mismo SKU y que solo una logre leer el stock (la ficha plana del Book4 queda "desconocido"; su /buy/ dice "agotado"). Antes ganaba la que llegara ultima, o sea que el orden de las paginas decidia. Ahora una lectura "desconocido" no borra un estado que si se pudo medir.

Verificado en vivo despues del arreglo: 10 de 10 casos coinciden con lo medido a mano (Book4 plana -> desconocido, Book4 /buy/ -> agotado, los 5 con stock -> disponible, ademas de "Agregar al carro" -> disponible, "Avísame" -> agotado y "Dónde comprar" -> no-a-la-venta).

### 2. El precio guardado era el TACHADO en ~4% de las fichas

Verdad independiente: el monto que el bloque escribe despues de " o $", que es el que se cobra. Medido sobre 46 paginas (2 por categoria notificable, percentiles 30 y 60): **35 de 37 comparables correctas, 2 mal** — y las 2 guardaban el precio tachado.

| SKU | Guardaba | El cliente paga | Diferencia |
|---|---|---|---|
| SM-X520NLBECHO | $839.990 | $579.990 | 31% |
| SM-X400NZAHCHO | $649.990 | $479.990 | 26% |
| SM-X400NZRDCHO (visto aparte) | $549.989 | $494.990 | 10% |

Causa: en esas fichas `digitalData.model_price` es un numero que no esta escrito en la pagina (379990 en el Tab S10 Lite) y `list_price` es el precio TACHADO. `precioVisiblePreferido` hacia lo correcto segun su regla — descartar el monto que no aparece en la pagina — pero el tachado tambien aparece, asi que elegia el mas caro.

**Arreglo** (`src/extract.mjs`, `precioDelBloqueCompra`): el precio sale del monto escrito en el bloque de compra cuando esta la frase; si no esta, sigue mandando digitalData sin cambio de comportamiento. Proyectado sobre la muestra: cambia exactamente esos 2 y deja los otros 35 igual (37/37).

**Y una migracion para no inundar Discord.** Sin proteccion, la primera corrida corregida mandaria del orden de 40 avisos de "bajo 26-31%" con fuego, por productos que nunca bajaron. `corrigePrecioTachado` en `src/comparar.mjs` adopta el precio nuevo en silencio SOLO cuando el guardado es EXACTAMENTE el tachado que la pagina muestra hoy (`precioTachado`, que extract.mjs escribe solo cuando las dos fuentes discrepan). Una baja de verdad en ese mismo SKU y esa misma corrida tiene otro numero y se avisa igual. Se apaga sola por SKU al sellar `versionPrecio`. El rastro `precioTachado` no se guarda en el catalogo: es diagnostico de la lectura.

### Verificacion

- `npm test`: 241 -> **256 verdes** (+15), ninguna prueba vieja debilitada. Dos fixtures se corrigieron porque les faltaba el precio que el bloque REAL si trae ("*Aplican condiciones Agregar al carro" -> "Desde $ 19.166 ... *Aplican condiciones Agregar al carro").
- **Mutantes: los 6 arreglos mueren** al deshacerlos uno por uno (1 a 4 fallas cada uno). El primer intento dejo vivo el cableado del precio dentro de `extractSingleProduct` — se agrego la prueba que faltaba y murio.
- Corrida real de `run.mjs` contra el catalogo de produccion en carpeta temporal, sin webhook: 25 paginas, 23 productos, **0 eventos**, `history.jsonl` ni se creo, 14 estados de stock corregidos en silencio, 0 registros con `precioTachado` guardado.
- Verificacion en vivo del precio despues del arreglo: los 3 rotos leen el precio real y su `precioTachado` calza con lo guardado (la correccion sera silenciosa); los 4 sanos no se mueven.

### Pendiente que quedo anotado

Hay paginas que nunca publican `model_price` y por eso no producen registro (~9 de 46 en la muestra). Hoy no cuentan como pagina fallida, asi que si le pasara a un producto VIVO sus SKU acumularian ausencias y en 2 corridas saldria un "desaparecio" falso. En la muestra los casos observados ya estaban clasificados como desaparecidos de antes (243-246 ausencias) o redirigen a la home / al soporte, o sea que el sistema no esta inventando nada — pero merece su propio arreglo: si la pagina trae `model_code` y nunca `model_price`, tratarla como no verificada.

---

## 2026-09-12 (tarde) — El vaiven de precios: la carrera contra el render

Encargo del operador: "hay productos cuyo precio guardado va y viene entre dos valores de una corrida a la otra, y cada vaiven manda un aviso FALSO. Viene el Cyber y necesito que un aviso de baja signifique una baja de verdad".

### Lo medido

**En data/ (offline, ventana de 30 dias):** 784 avisos de precio sobre 425 SKU. **68 SKU tienen el precio volviendo exactamente a un valor ya visto** y entre ellos suman **361 avisos (46% de todos los avisos de precio del mes)**. El peor es el monitor gamer LS32DG300ELXZS, con 56 avisos rebotando entre $199.990 y $279.990. **50 de esos 68 tienen HOY guardado uno de los dos valores del baile.**

**En vivo (2 fichas, UA CazadorBot, >=3,2 s entre cargas, cero requests extra):**

| Ficha | model_price | list_price | ¿escritos en la pagina? | bloque de compra |
|---|---|---|---|---|
| SM-X520NLBACHO (Tab S10 FE) | 479.990 | 729.990 | model NO, list SI | "…o $656.990 Precio original: $729.990" |
| AR-KH00E (control remoto) | 47.020 | 47.020 | ninguno de los dos | "no está a la venta" (la pagina no escribe NINGUN monto) |

### La causa

`precioVisiblePreferido` (src/extract.mjs) elige entre `model_price` y `list_price` segun cual este ESCRITO en `document.body.innerText`, y si no encontraba ninguno devolvia `model_price`. Pero ese texto se leia sin esperar a que el precio se PINTARA: la unica espera era `waitForFunction` sobre la VARIABLE `digitalData.model_price`, que se llena apenas responde api.shop.samsung.com (medido: 1,3-1,7 s) y ANTES de que el bloque de compra se re-renderice.

O sea: la misma pagina tenia dos salidas estables segun quien ganara la carrera — el `list_price` (el TACHADO) si alcanzo a pintarse, el `model_price` (un numero interno que en las fichas con descuento no aparece en ninguna parte) si no. Cada cambio de ganador mandaba un "subio" o un "bajo" que no correspondia a ningun cambio en Samsung. Por eso el baile siempre es entre los MISMOS dos numeros y no una deriva.

El arreglo del 09-12 en la manana (`precioDelBloqueCompra`) no cerro la carrera: `precioBloque ?? precioFinal` vuelve a caer en la misma regla cuando el bloque no esta pintado. Solo agrego un tercer valor posible.

Segunda puerta, mas chica: el mismo SKU visto desde DOS paginas. El JSON-LD de una pagina familia publica el precio de LISTA, y **126 paginas /buy/ tienen su ficha plana en el seed, o sea 135 SKU que se scrapean dos veces por corrida** (las dos valen rango PROPIA, asi que el rango no arbitra nada y decide el orden de llegada).

### El arreglo (5 piezas)

1. **`src/extract.mjs`, `esperarMontoPintado`:** antes de leer el texto de la pagina se espera a que uno de los dos montos este ESCRITO — el mismo criterio que usa `montoVisible` una linea despues, asi que la decision deja de depender del instante de la lectura. Reparte el MISMO `PRECIO_TIMEOUT_MS` de 3 s (no agrega presupuesto: con 8 s de espera la corrida se pasaba de las 4 h, incidente del 2026-08-02). Medido: 7 ms cuando la pagina ya pinto; 1.823 ms (el resto del presupuesto) en una ficha que nunca escribe precio.
2. **`precioVisiblePreferido` devuelve `null`** cuando ninguno de los dos montos esta escrito, en vez de inventar con el `model_price` invisible. Se conserva a proposito la primera linea (sin `list_price` valido no hay segundo candidato y por lo tanto no hay carrera: LS32DG300ELXZS estuvo clavado ~75 corridas hasta que su ficha estreno tachado).
3. **El campo `precio` se OMITE, no se pone en `null`** (un `null` pisa el precio guardado y la corrida siguiente emite "nuevo"), y `comparar.mjs` conserva explicitamente (`precio: obs.precio ?? ant.precio`). Es el "no se sabe" del precio, el equivalente de lo que el stock ya tenia. `integrarVariantes` hace lo mismo entre dos paginas del mismo rango dentro de una corrida.
4. **Corroboracion solo cuando cambia la FUENTE** (`mismaFuenteDePrecio`): un cambio de precio que ademas viene de otra pagina o de otro rango no se avisa ni se adopta hasta que una segunda corrida lo repita. Un cambio desde la MISMA pagina se avisa al tiro — que es el 97% de los casos (385 de 397 cambios entre corridas consecutivas vienen del mismo origen), asi que ninguna baja normal de Cyber se atrasa.
5. **Visibilidad:** `corridasSinPrecio` por SKU, `sinPrecioVisible`/`precioCongelado` en `ejecuciones.jsonl` y un aviso tecnico unico por SKU (`marcarSinPrecioProlongado`) a las 20 corridas. **Solo para productos a la venta**: 426 de los 933 registros activos no estan "disponible" y muchos de esos, como AR-KH00E, simplemente no publican precio — eso no es una falla, y avisarlo seria un mensaje de cientos de lineas sin nada que hacer.

**Migracion (`VERSION_PRECIO` 2 -> 3).** Sin adopcion silenciosa, la primera corrida con el arreglo mandaria del orden de 50 a 68 avisos de "subio/bajo 20-40%" por productos que nunca cambiaron de precio (los 50 SKU medidos con el precio guardado clavado en un valor del baile). `corrigeFuenteDePrecio` calla el aviso SOLO cuando el guardado es exactamente uno de los dos numeros que la propia pagina publica hoy y que el arreglo dejo de elegir: `precioTachado` (list_price) o `precioInterno` (model_price). Cualquier otro numero es un cambio real y se avisa. Se apaga sola por SKU al sellar `versionPrecio`; los rastros no se guardan en el catalogo.

### Verificacion

- `npm test`: **257 -> 274 verdes**, ninguna prueba vieja debilitada. Dos assertions de `test/precio-visible.test.mjs` cambiaron porque fijaban el comportamiento EQUIVOCADO: la prueba se llamaba "no se inventa un precio" y exigia justamente que, con la pagina a medio renderizar, se devolviera el `model_price`. Queda escrito en el archivo por que.
- **Mutantes: 13 de 13 mueren.** Se deshizo cada pieza en una copia fuera del arbol y la suite fallo siempre (1 a 8 pruebas por mutante). Incluye deshacer la espera del render, el `null`, la omision del campo, la conservacion, las dos mitades de la adopcion silenciosa, la corroboracion por fuente, el contador y el filtro del aviso tecnico.
- **Ensayo con el codigo real sobre la ficha del Tab S10 FE** (resolver -> extract -> integrarVariantes -> comparar, 1 carga): la observacion sale con `precio: 656990`, `precioTachado: 729990`, `precioInterno: 479990` — los dos numeros que bailaban en `history.jsonl`. Catalogo con 479.990 guardado -> 0 eventos y adopta 656.990; con 729.990 -> 0 eventos y adopta; con 699.990 (un precio real anterior) -> **1 evento "baja"**. Las bajas de verdad siguen saliendo en la primera corrida.
- **Dos corridas reales de `run.mjs`** contra una COPIA del catalogo en carpeta temporal (`CARPETA_DATOS`, `LIMITE_PAGINAS=1`, `SIN_DESCUBRIMIENTO=1`, sin webhook): **0 eventos** en las dos, `history.jsonl` quedo vacio, el precio de AR-KH00E se conservo en $47.020 y su `corridasSinPrecio` subio 1 -> 2. El resumen trae los campos nuevos (`sinPrecioVisible: 1`, `precioCongelado: 1`).
- Politica: 5 cargas de samsung.com en total (de 8 autorizadas), UA CazadorBot, >=3,2 s entre cargas en las mediciones y una sola pagina por corrida de prueba, cero requests extra, jamas el webhook real.

### Lo que se descarto, con datos

- **"Quedarse con el mas barato":** el peor caso del mes va al reves — LS32DG300ELXZS vale $279.990 y la lectura equivocada es la BARATA ($199.990). Serian 28 avisos falsos de "bajo", el aviso mas caro que existe.
- **"Confirmar TODO cambio en 2 corridas":** atrasa ~3 h cada baja real de Cyber. Por eso la corroboracion se aplica solo cuando cambia la fuente, que es donde no cuesta nada.
- **"Ignorar cambios mayores a X%":** los saltos falsos van de +2% a +88% y la promo REAL del 09-09 fue -30% en 206 accesorios. Ningun umbral los separa.
- **"Esperar mas":** con 8 s la corrida se pasaba de 4 h y GitHub la mataba sin dejar datos (2026-08-02). Por eso la espera nueva reparte el presupuesto que ya se gastaba.

### Pendientes anotados

1. **`DELAY_MS` esta en 2000 ms (`src/config.mjs`) y la politica del encargo dice 2,5 s.** No se toco: subirlo agrega ~10 min a una corrida de 169-186 min (tope 330), pero es un cambio de cadencia de scraping y lo decide el operador.
2. **Las 126 paginas /buy/ duplicadas** (135 SKU leidos dos veces por corrida). La pieza 4 ya impide que se vuelquen el precio, pero descartarlas en `src/discover.mjs` ahorraria ~20 min de corrida y 126 cargas innecesarias a samsung.com.
3. **Costo de tiempo de la espera nueva:** hasta ~1,7 s en las fichas que nunca escriben un monto. Cota alta: los 426 registros que no estan "disponible" -> ~12 min sobre 169-186 min. Hay que mirar `sinPrecioVisible` en `ejecuciones.jsonl` la primera semana.
4. **A vigilar dentro de una semana:** repetir el conteo de "el precio vuelve a un valor ya visto" sobre `data/history.jsonl`. Hoy son 361 avisos/mes en 68 SKU; tiene que caer a cerca de 0.

---

## 2026-09-12 (noche) — Segunda vuelta del vaiven: los agujeros que dejo el arreglo de la tarde

Tres verificadores independientes midieron el arreglo de la tarde y los tres lo tumbaron: **el vaiven seguia vivo**, con los mismos dos numeros. Esta entrada arregla los seis defectos confirmados y anota, de paso, una medicion que nadie habia hecho.

### El agujero principal: la regla se aplico a la lectura equivocada

El arreglo de la tarde puso "no inventar un precio" en `precioVisiblePreferido`, que lee `document.body.innerText`. Pero el numero que **realmente gana** sale de una SEGUNDA lectura, en `extractSingleProduct`:

    const precioBloque = precioDelBloqueCompra(bloque.texto);
    const precioVisto = precioBloque ?? precioFinal;   // <- la puerta que quedo abierta

`leerBloqueCompra` es otro `page.evaluate`, posterior, por selector y **envuelto en `.catch(() => null)`**. Cuando esa lectura falla, el `??` cae directo a `precioFinal`, que con la ficha ya pintada es el **TACHADO** — el numero exacto al que saltaba el vaiven historico. Y encima:

- `precioTachado` NO se escribia en ese caso (su guarda exigia `Number.isFinite(precioBloque)`), asi que la amnistia de la migracion tampoco podia taparlo;
- `precioIlegible` quedaba en `false`, asi que `corridasSinPrecio`, `sinPrecioVisible` y `marcarSinPrecioProlongado` — toda la instrumentacion de la contracara — estaban **ciegos**. El operador veria `sinPrecioVisible: 0` mientras los avisos falsos salen.

Y las 274 pruebas no lo veian porque el doble `fichaQuePintaTarde` manejaba las dos lecturas del DOM con UNA sola bandera `pintado`: solo podia producir "las dos pintadas" o "ninguna". El estado que fallaba — **body pintado con el tachado + bloque ilegible** — era inexpresable.

**Medido cabeza a cabeza** (mismo script, dos copias del arbol, sin red; `scratchpad/probe.mjs`): 5 corridas alternando solo la legibilidad del bloque, con el body identico y pintado en todas.

| Ficha | antes | ahora |
|---|---|---|
| SM-X520NLBACHO (con "Precio original" escrito) | **4 avisos falsos** | 0 |
| SM-X620NZAACHO (sin esa etiqueta) | **4 avisos falsos** | 0 |

**El arreglo** es `precioAdoptable` (src/extract.mjs), que distingue los tres estados que antes se confundian en un solo `null`:

- **(a) el bloque no se pudo leer** (evaluate fallido, o bloque todavia sin texto) -> no se sabe: no hay precio. `leerBloqueCompra` devuelve ahora una senal explicita, `legible`.
- **(b) el bloque se leyo y no publica monto** ("Dónde comprar", "no está a la venta") -> eso es una propiedad ESTABLE de la pagina, no una carrera: el numero escrito vale.
- **(c) el bloque publica el monto** -> ese manda, siempre.

Con dos reglas que cruzan las tres: un monto que la propia pagina marca como **"Precio original"** no se adopta nunca (`esPrecioOriginalEscrito`), y cuando digitalData publica **un solo candidato** (list_price invalido o igual al model_price) el bloque ilegible no bloquea nada, porque sin dos numeros distintos no hay carrera posible.

### Una medicion que faltaba: el tope de espera del precio NUNCA se aplico

`page.waitForFunction(fn, { timeout: PRECIO_TIMEOUT_MS })`. La firma de Playwright es `waitForFunction(pageFunction, arg, options)`: ese objeto entraba como **`arg`**, no como opciones. Medido contra el Chromium real, sin red (una pagina en blanco escrita con `setContent`):

    waitForFunction(fn, { timeout: 500 })             -> 30.017 ms
    waitForFunction(fn, undefined, { timeout: 500 })  ->    518 ms

Esta mal desde el 2026-08-01 (`62e52ea`), o sea que **ni los 8 s ni los 3 s existieron nunca**: la espera siempre corrio con el default de 30 s de Playwright. Consecuencias:

- Las ~150 paginas que legitimamente no publican precio pagan **30 s cada una**, no 3. Son ~75 min de una corrida de 169-210 min.
- El incidente del 2026-08-02 **no lo causo el valor de la constante** (8000 tampoco se aplicaba nunca): lo arreglo el `throw` selectivo del mismo commit, que dejo de mandar esas paginas al reintento. La nota anterior de esta bitacora atribuia el arreglo al numero y queda corregida.
- La espera de pintado de la tarde recibia `PRECIO_TIMEOUT_MS - (Date.now() - t0)`. Con t0 llevando 30 s consumidos, la resta quedaba **negativa** y la defensa central del arreglo se auto-descartaba justo en las paginas lentas, que son las que corren la carrera.

Arreglado: el timeout va en la posicion de opciones, `PRECIO_TIMEOUT_MS` sube a **8 s** (ahora si es un tope real: ~4,7 veces la peor espera medida de digitalData, y 22 s menos por pagina que hoy) y `esperarMontoPintado` recibe **presupuesto propio**, `RENDER_TIMEOUT_MS = 1500`, en vez de las sobras.

### Las otras piezas

**3. `versionPrecio` solo se compromete con lectura util** (src/comparar.mjs). Salia de `{...ant, ...obs}` y `extract.mjs` lo estampa en TODA lectura, incluida la que no leyo precio: bastaba que una ficha no pintara UNA vez para que la ventana de migracion quedara cerrada para siempre en ese SKU, y la primera lectura buena saliera anunciada como "subio/bajo 20-40%". **Es el mismo bug que ya estaba arreglado para `versionStock` doce lineas mas abajo.** Medido sobre una copia del catalogo real: corrida ciega + corrida buena daba **931 avisos falsos** contra **0** del control; ahora da **0 y 0**.

**4. `conservaPrecio` exige el MISMO rango** (src/catalogo.mjs) — que es lo que su propio comentario ya prometia. Sin eso, con la pagina familia integrada antes que la ficha propia lenta (el reintento del final de `run.mjs` corre DESPUES de todas las entradas), el precio de LISTA del JSON-LD se copiaba al registro firmado `rango: 3, paginaOrigen: <ficha propia>`; con ese disfraz `mismaFuenteDePrecio` lo veia como "misma fuente" y avisaba al tiro. Medido: **1 aviso falso -> 0**, y el resultado deja de depender del orden de llegada de las paginas.

**5. La fuente DEL PRECIO se guarda aparte** (`fuentePrecio`). Antes se deducia del `rango`/`paginaOrigen` del registro, que `{...ant, ...obs}` ya habia reemplazado por los de la lectura de hoy: el registro mentia sobre de donde salio su precio. Con una ficha propia que caia una corrida si y otra no, el pendiente se pisaba en cada corrida, nunca se corroboraba y el precio quedaba **congelado indefinidamente** (el verificador midio 21 corridas sin un solo aviso mientras Samsung bajaba de verdad). El campo solo se escribe cuando NO coincide con el origen del registro, y una lectura que confirma el precio se lo apropia: medido sobre el catalogo real, una corrida normal le agrega el campo a **0 de 1031** registros.

**6. Un rango menor no le pisa el precio a uno mayor, pero con TOPE.** La pagina familia publica el precio de lista; si la ficha propia fallaba dos corridas seguidas, la regla anterior corroboraba el tachado y cobraba **dos** avisos falsos (el "sube" al adoptarlo y el "baja" al volver la ficha). Ahora una fuente de menos rango no adopta ni avisa — pero si la ficha propia no vuelve en `UMBRAL_PRECIO_OTRA_FUENTE` = 3 corridas (~9 h), se adopta igual y se avisa, marcado como "precio leido desde otra pagina del sitio": nada queda congelado para siempre. La corroboracion, ademas, ahora exige que quien repite el valor sea **la misma pagina que lo propuso** (antes dos paginas distintas publicando el mismo numero equivocado se confirmaban entre si).

**7. La correccion de la migracion sale por el canal TECNICO, no en silencio.** Desde una sola lectura no hay forma de distinguir "el guardado estaba mal" de "este producto estreno oferta hoy y su precio de ayer es el tachado de hoy": los dos casos se ven identicos. Callarse del todo se tragaba **bajas reales enteras y sin segunda oportunidad** (`versionPrecio` queda sellado y el cambio ya adoptado; el verificador midio una baja real del 18% que desaparecia). Ahora `mensajeCorreccionesDePrecio` (src/discord.mjs) las manda por el canal tecnico, con los dos numeros y las bajas primero. Medido sobre el catalogo real: **420 SKU** se corrigen y salen **0 avisos de precio** al operador.

**8. Y ademas:** un producto NUEVO a la venta sin precio publicado se anuncia igual ("la pagina todavia no publica precio") en vez de quedar invisible por tiempo indefinido; `corridasSinPrecio` cuenta tambien cuando nunca hubo precio (antes exigia un precio previo, asi que esos productos no llegaban jamas al aviso tecnico); el aviso tecnico de precios congelados incluye a los **agotados** (Samsung los vende, solo que sin unidades); y un precio que lleva corridas sin comprobarse viaja marcado dentro de los avisos de stock: "ultimo precio conocido: la pagina no lo publica hace N revisiones".

**9. `DELAY_MS` 2000 -> 2500 ms** (src/config.mjs): el sistema estaba fuera de su propia politica de scraping, que pide >= 2,5 s entre requests al mismo host. Cuesta ~10 min sobre 1.183 paginas y cabe de sobra (corridas de 169-210 min, el job corta a 330); ademas queda mas que compensado por el arreglo del tope de espera.

**Balance de tiempo estimado por corrida:** **-55 min** por el tope que por fin existe, **+10 min** por la espera de pintado, **+10 min** por `DELAY_MS`. Son cuentas de papel (paginas x segundos), no de reloj: hay que medirlas en la primera corrida real.

### Verificacion

- `npm test`: **274 -> 308 verdes, 0 fallas.** Linea base 257, nunca baja. Archivo nuevo: `test/precio-sin-carrera.test.mjs` (28 pruebas).
- **Mutantes: 24 de 24 mueren.** Se deshizo cada pieza, una por vez, en una copia fuera del arbol (`scratchpad/mutantes.mjs`), se corrio la suite entera y se restauro. Los dos primeros intentos **sobrevivieron**: la ficha de prueba tenia la etiqueta "Precio original" escrita, asi que la segunda defensa tapaba el agujero de la primera. Por eso se agrego `SIN_ETIQUETA` (SM-X620NZAACHO), una ficha sin esa etiqueta — y ahi mueren los dos.
- **El doble de pruebas se rehizo:** las dos lecturas del DOM (`body` y `bloque`) se controlan ahora por separado, con los cuatro estados posibles. Sin eso, el defecto principal seguia siendo inexpresable y las pruebas verdes no significaban nada sobre el.
- **Dos dobles viejos cambiaron de firma, no de exigencia:** los de `test/precio-tardio.test.mjs` declaraban `waitForFunction(fn, { timeout })`, copiando la llamada equivocada del codigo. Un doble que copia el error del codigo no puede detectarlo.
- **Replay del pipeline contra una COPIA del catalogo real** (1031 SKU, sin red, sin webhook; `scratchpad/replay.mjs` y `replay2.mjs`): corrida ciega -> 0 eventos de precio, 931/931 precios conservados y **0 registros con `versionPrecio` sellada sin lectura util**; migracion realista -> 0 avisos de precio y 420 correcciones tecnicas, **identico con y sin una corrida ciega de por medio**; corrida normal -> 0 eventos; una baja real del 30% -> sale en la PRIMERA corrida; ningun campo de diagnostico sobrevive al catalogo guardado.
- **Medicion propia del historial**, independiente de la del implementador: 790 avisos de precio en 30 dias, 68 SKU con el precio volviendo a un valor ya visto, 366 avisos (46%). Coincide con lo declarado (68 / 361 / 46%).
- **El patron horario del encargo queda descartado, medido:** sobre los 1490 eventos de precio de `history.jsonl` no hay ningun corte limpio por hora (hora 16 UTC: 68 "sube" / 225 "baja"; hora 19: 193 / 51; hora 22: 96 / 65). "Sube a las 16:49 y baja a las 05:19" era un artefacto de muestra chica de un SKU y no contradice la teoria de la carrera de render.
- **Cero requests a samsung.com.** Todas las paginas son dobles; la unica vez que se abrio Chromium fue para medir el timeout de `waitForFunction` sobre una pagina en blanco escrita con `setContent`. Jamas el webhook real. `data/` del repo intacta.

### Pendientes

1. **Las 126 paginas /buy/ duplicadas** (sigue abierto). Ya no pueden volcarse el precio, pero descartarlas en `src/discover.mjs` ahorraria ~20 min de corrida y 126 cargas innecesarias a samsung.com.
2. **El presupuesto de tiempo hay que MEDIRLO en la primera corrida real.** Mirar `duracionMin`, `sinPrecioVisible` y `errores` en `ejecuciones.jsonl`: si `errores` sube, el tope de 8 s quedo corto para alguna pagina lenta y hay que subirlo — ahora que por fin se aplica, subir el numero si tiene efecto.
3. **`correccionesDePrecio` en `ejecuciones.jsonl` tiene que caer a 0 en pocas corridas.** Si se queda alto, la migracion esta tapando cambios de verdad.
4. **A vigilar en una semana:** repetir el conteo de "el precio vuelve a un valor ya visto". Hoy 68 SKU y 366 avisos en 30 dias; tiene que caer a cerca de 0.
5. **Pendiente antiguo que sigue abierto:** una pagina con `model_code` que nunca publica `model_price` no cuenta como pagina fallida, asi que si le pasara a un producto vivo sus SKU acumularian ausencias y en 2 corridas saldria un "desaparecio" falso.
6. **Menor:** `npm test` todavia intenta alcanzar discord.com en algunas pruebas de transporte (URLs falsas, nunca el webhook real). Seria mas limpio interceptar `globalThis.fetch` tambien ahi.

---

## 2026-09-12 (cierre) — Las categorias principales van primero

Encargo del operador, textual: *"Smartphones / Tablets / Audio y Galaxy Buds / Relojes / Computadoras. ¿Puedes dejar estas categorias como las principales? Y siempre que comience un nuevo ciclo o revision, partir por estas categorias?"*. Con avisos en vivo, lo que se revisa primero es lo primero que se entera, y se viene el Cyber.

### Lo medido ANTES de tocar nada

`src/seed.json` viene ordenado alfabeticamente por categoria, asi que el recorrido partia por "Accesorios linea blanca". Sobre el listado real (1.023 paginas) mas las paginas familia reales (162, sacadas de `data/latest.json`, sin red), y al ritmo de la ultima corrida real (126 min / 1.185 paginas = 6,4 s por pagina):

| Categoria | Primera pagina, antes | Ahora | Se adelanta |
|---|---|---|---|
| Smartphones | 717 | **1** | ~76 min |
| Tablets | 810 | 186 | ~66 min |
| Audio y Galaxy Buds | 456 | 254 | ~22 min |
| Relojes (Galaxy Watch) | 688 | 268 | ~45 min |
| Computadores | 492 | 317 | ~19 min |

El bloque principal son **347 paginas de 1.185 (29%), ~37 min**: 185 del listado (18%) y 162 familia.

**Traduccion de los nombres.** El operador dijo "Relojes" y "Computadoras"; el listado dice "Relojes (Galaxy Watch)" y "Computadores". Y existe ademas "Audio (Soundbars/Torres)" (14 paginas) que NO se pidio: no entra, y no puede colarse porque vive en otra seccion de la web (`audio-devices` contra `audio-sound`, verificado sobre las 1.023 paginas).

### Lo que se hizo

**`src/prioridad.mjs` (nuevo).** Un solo lugar con la lista, en el orden del operador, cada linea con el nombre EXACTO del listado y la seccion de la URL que le corresponde. Exporta `ordenarRecorrido()` (la particion) y `medicionPrincipales()` (los campos del resumen). `run.mjs` solo lo llama.

**El reordenamiento es una particion estable por baldes** (sin comparador): dentro de cada balde las paginas quedan en el orden en que llegaron. Mismo insumo, mismo recorrido, siempre; y reordenar lo ya ordenado no lo mueve.

**Se aplica ANTES de `LIMITE_PAGINAS`**, a proposito: asi una corrida de prueba corta visita justo lo que hay que poder comprobar.

### La decision del punto 3 del encargo, con su razon

Las paginas familia auto-descubiertas de una seccion principal entran **en el bloque de su propia categoria, inmediatamente despues de las del listado de esa categoria**. Dos decisiones, las dos medidas:

1. **En el bloque de su categoria y no en un bloque unico detras de las cinco.** Medido sobre `data/latest.json`: de los 130 SKU que cuelgan de `/smartphones/`, **37 no tienen ficha plana en el listado** — solo existen en una pagina familia. Con un bloque unico al final, "partir por Smartphones" habria cubierto 93 de sus 130 SKU y los otros 37 (los Galaxy nuevos) habrian esperado detras de las 94 paginas de listado de las otras cuatro categorias, ~10 min. Lo mismo en Relojes (13 de 31) y Computadores (7 de 20). **Lo que se pierde:** la segunda categoria arranca mas tarde (Smartphones pasa de 91 a 185 paginas) y el bloque de cada categoria deja de ser un tramo puro del listado.
2. **Despues del listado de su categoria, no intercaladas una a una.** Esto no es cosmetico. Hay **126 paginas /buy/ descubiertas cuya ficha plana tambien esta en el listado (116 SKU con las dos paginas del MISMO rango)**, y para ese par el orden de llegada si decide quien firma el registro. Intercalar de verdad exigiria inventar un emparejamiento URL a URL y podria poner la /buy/ delante de su ficha plana, que es **exactamente el orden que produjo el defecto del 2026-09-12 (noche), pieza 4**.

> ⚠️ **Corregido el mismo dia — aca decia una cosa falsa.** La frase original era "hoy en produccion el listado va siempre antes que lo descubierto; manteniendo ese orden relativo, el reordenamiento no puede cambiar ningun resultado". **Es falsa**, y la midieron los tres verificadores: el reordenamiento invierte 273.380 pares de paginas del recorrido real y 146.246 de ellos son una pagina familia que pasa a ir antes de una del listado. La conclusion (el resultado no cambia) igual se sostiene, pero por otra razon, y la razon esta abajo, en la seccion "segunda vuelta".

Ese invariante se apoya en un hecho medido: las cinco secciones (`smartphones`, `tablets`, `audio-sound`, `watches`, `computers`) las usa **una sola categoria cada una** en las 1.023 paginas del listado. Si algun dia una categoria que no es principal pasara a vivir bajo una de esas secciones, su /buy/ se adelantaria a su ficha — y hay una prueba contra el listado REAL que lo caza.

### La promesa es comprobable

`data/ejecuciones.jsonl` trae ahora `paginasPrincipales` y `duracionPrincipalesMin` (null si la corrida no alcanzo a terminar el bloque; se mide en la PRIMERA pasada, porque el reintento del final vuelve sobre paginas de toda la corrida). En el log: `INFO bloque_principal` al empezar, con el desglose por categoria, y `INFO bloque_principal_listo` al terminarlo.

### Si una categoria cambia de nombre o desaparece del listado

Ni se rompe ni se calla. Las paginas se siguen recorriendo todas; si la seccion de la URL sigue viva, **igual entran temprano** (respaldo por seccion en `indicePrincipal`). Y se denuncia por tres vias: `WARNING` en el log, aviso por el canal TECNICO al PRINCIPIO de la corrida (no al final: la revision dura ~2 h) y `categoriasPrincipalesAusentes` en el resumen. El aviso distingue los dos casos con `paginasEnLaSeccion`: > 0 es un renombre (hay que corregir el nombre en `src/prioridad.mjs`), 0 es que la categoria desaparecio del sitio. Contar solo las entradas del LISTADO es deliberado: contar las familia taparia justo la desaparicion que se quiere detectar.

### Verificacion

- `npm test`: **308 -> 333 verdes, 0 fallas.** Linea base 308, nunca baja. Archivo nuevo: `test/orden-recorrido.test.mjs` (25 pruebas).
- **Mutantes: 19 de 19 mueren.** Se deshizo cada pieza, una por vez, en una copia fuera del arbol (`scratchpad/mutantes.mjs` + `scratchpad/mut/`), se corrio la suite entera y se restauro. Incluye: cambiar el orden de la lista, sacarle una categoria, escribir "Computadoras" en vez de "Computadores", apuntar Buds a `audio-devices`, poner las familia antes del listado, volver al bloque unico de familia, romper la estabilidad, romper el orden del resto, no denunciar ausentes, dar por presente una categoria con sus paginas familia, no distinguir renombre de desaparicion, sacar el respaldo por seccion, mirar una sola de las dos marcas de pagina descubierta, no saltar el tramo `/cl/` de la URL, devolver 0 en vez de null en la duracion, renombrar el campo del resumen, no reordenar, y confundir listado con familia en el desglose.
- **ORDEN VIEJO CONTRA ORDEN NUEVO, el punto central del encargo.** Prueba con un recorrido de juguete que tiene TODAS las formas de colision reales (mismo SKU desde dos paginas del mismo rango, desde rangos distintos con el precio de LISTA, una pagina que no leyo el precio, otra que no leyo el stock, un SKU que solo existe en la familia, un accesorio y un producto que ya no aparece): se procesa en el orden viejo y en el nuevo y se exige **catalogo identico y los mismos cambios emitidos**. Pasa. No es una comparacion entre listas vacias: la prueba exige que salgan una "baja" y un "desaparecido".
- **Ensayo sobre datos reales, sin red** (`scratchpad/ensayo-orden.mjs`, listado real + las 162 paginas familia de `data/latest.json`): **0 /buy/ adelantadas a su ficha plana**, ninguna pagina perdida ni duplicada, `ausentes` vacio.
- **Corrida real del pipeline** contra una COPIA del catalogo real en carpeta temporal (`CARPETA_DATOS`, `LIMITE_PAGINAS=8`, sin `DISCORD_WEBHOOK_URL`, descubrimiento activo): **las 8 paginas visitadas fueron de Smartphones** (antes habrian sido las 8 primeras de "Accesorios linea blanca"), 0 errores, resumen con `paginasPrincipales: 8` y `duracionPrincipalesMin: 1`, y `INFO bloque_principal Smartphones=91+96 Tablets=45+21 Audio y Galaxy Buds=14+0 Relojes (Galaxy Watch)=18+29 Computadores=17+14`. La corrida quedo marcada `confiable: false` por el limite de paginas, que es lo correcto y lo que protege de falsos desaparecidos.
- **Politica:** 8 cargas de paginas + 4 sitemaps en una sola corrida, UA CazadorBot, `DELAY_MS` 2500 sin tocar, cero requests extra. Jamas el webhook real. `data/` del repo intacta (todo en carpeta temporal). No se commiteo nada.

### Un defecto que aparecio al medir, y que NO es de este cambio

Buscando si el orden puede cambiar el resultado se encontro uno que **ya existia**: cuando dos paginas del MISMO rango publican **precios distintos** para el mismo SKU, gana la que llegue ultima. Medido con el codigo real (`scratchpad/probe-orden.mjs`, Tab S10 FE, $656.990 en la ficha plana y $729.990 en su /buy/): en un orden el registro queda firmado por la /buy/ y con `precioPendiente: 729990` + `corridasPrecioDistinto: 1`; en el otro queda limpio y firmado por la ficha plana. Los avisos de ESA corrida son los mismos (la corroboracion por fuente los contiene), pero el estado guardado difiere y a las 3 corridas ese pendiente se adopta y **se avisa**.

- **Alcance:** los 116 SKU que se ven desde su ficha plana y desde su /buy/ descubierta. Hoy ninguno tiene `fuentePrecio` ni `precioPendiente` guardado, o sea que las dos paginas vienen coincidiendo: el defecto esta latente, no disparando.
- **Ya pasa en produccion sin este cambio:** el reintento del final de `run.mjs` procesa las paginas lentas DESPUES de todas las demas, asi que una ficha plana que timeoutea una vez gana esa corrida y pierde la siguiente. Ese flapping es real.
- **Este cambio no lo toca ni lo despierta:** el orden relativo listado -> familia se conserva, y hay dos pruebas que lo exigen (una de ellas contra el listado real completo).
- **Arreglo propuesto, para su propio ticket:** un desempate determinista dentro del rango (por ejemplo, la /buy/ manda sobre la ficha plana, que es lo que ocurre hoy cuando no hay reintento), o directamente el pendiente nº 1 de abajo: dejar de descubrir las 126 /buy/ que ya tienen ficha plana, que ademas ahorra ~20 min de corrida. No se aplico aca: cambia el `paginaOrigen`/`fuentePrecio` de 116 SKU reales, roza la maquinaria de corroboracion de precios a dias del Cyber, y no es lo que el operador pidio en este encargo.

### Pendientes

1. **Las 126 paginas /buy/ duplicadas** (sigue abierto, y ahora tiene un motivo mas: es la raiz del defecto de arriba).
2. **`data/latest.json` se va a reordenar entero una vez.** Las claves del archivo siguen el orden en que se visitan las paginas, asi que el primer commit despues de este cambio va a tener un diff gigante y de una sola vez. No cambia ningun dato. Si molesta, escribirlo con las claves ordenadas alfabeticamente haria legibles los diffs diarios para siempre — cambio chico, pero es otro ticket.
3. **Medir la promesa en la primera corrida real:** `duracionPrincipalesMin` deberia dar del orden de 37 min con 347 paginas. Si da mucho mas, el bloque principal esta cargando paginas mas lentas que el promedio.
4. **`categoriasPrincipalesAusentes` tiene que quedarse vacio.** Si aparece algo, Samsung renombro una categoria y hay que corregir `src/prioridad.mjs`.

---

## 2026-09-12 (cierre, segunda vuelta) — Lo que encontro la revision del reordenamiento

Tres verificadores independientes revisaron el cambio de arriba. **Dos lo tumbaron.** Ninguno encontro que el reordenamiento estuviera cambiando resultados HOY — a escala real, con el catalogo real y el despachador real, los dos ordenes dan el mismo catalogo y los mismos avisos —, pero si encontraron que **la razon por la que no los cambia no era la que el codigo declaraba**, y que varias piezas nuevas no las defendia ninguna prueba. Once defectos. Estan los once arreglados.

### 1. El invariante declarado era falso (gravedad media, 2 verificadores)

El comentario de `src/prioridad.mjs` y el reporte decian: *"hoy en produccion el listado va siempre antes que lo descubierto; manteniendo ese orden relativo, el reordenamiento no puede cambiar ningun resultado"*.

**Lo medi yo mismo antes de tocar nada, sobre el recorrido real (1.023 del listado + 162 familia):**

```
pares invertidos TOTAL:                           273.380
de esos, listado -> familia (la que "no pasaba"): 146.246
inversiones DENTRO de la misma seccion:                 0
```

O sea: el reordenamiento **si** adelanta paginas descubiertas por delante de paginas del listado, a montones. Es justo lo que el operador pidio. Lo que no hace nunca es adelantar una pagina por delante de otra **de su misma seccion**, y ESE es el invariante que de verdad protege el resultado, porque dos paginas que hablan del mismo producto viven bajo la misma seccion.

**Y eso ya se rompio una vez en produccion.** Barri los 348 snapshots commiteados de `data/latest.json` (~7 semanas):

```
SKU firmados por mas de una pagina:                 111
...por paginas de SECCIONES distintas:                1
```

El unico: **GP-TOS928SBEYW**, el 2026-07-25 (commit `49b8557`). Su ficha de `/mobile-accessories/` ($10.493) perdio contra `.../tv-accessories/customizable-frame--vg-scfa--vg-scfa43wtbru/` ($14.990, categoria "Accesorios TV") y volvio sola a la corrida siguiente. Lo decidio el orden de llegada.

**Lo que se hizo:**

- **El comentario dice ahora el invariante verdadero**, con los numeros de arriba, y la frase vieja quedo marcada como falsa donde estaba (mas arriba en esta bitacora).
- **`inversionesIntraSeccion()` (nuevo, en `src/prioridad.mjs`)**: calcula los pares de la misma seccion que el reordenamiento invierte. Hoy da 0. Se comprueba en una prueba contra el listado REAL **y en cada corrida**, y si alguna vez deja de dar 0 sale un aviso tecnico y queda en el resumen (`inversionesIntraSeccion`).
- **`skusQueCambiaronDeSeccion()` (nuevo)**: el sintoma observable en datos reales. Si un SKU pasa a estar firmado por una pagina de otra seccion, aviso tecnico + campo en el resumen. Habria cazado el caso del 2026-07-25.

### 2. El desempate ya no lo decide el orden de llegada (gravedad media)

El verificador construyo el caso que faltaba: un SKU publicado por una pagina de seccion PRINCIPAL y por una de seccion NO principal, las dos con el MISMO rango. Lo reproduje con el codigo real: en un orden el registro queda firmado por una y con `precioPendiente`; en el otro, por la otra y limpio. **Mismo insumo, dos catalogos.**

**Lo que se hizo: `ganaElEmpate()` en `src/identidad.mjs`.** Cuando dos paginas del mismo rango y de **secciones distintas** publican el mismo SKU, ya no gana la ultima en llegar: gana la que **NOMBRA al SKU en su slug** (es la ficha de ese producto, no una que lo menciona de pasada); si eso no desempata, la ruta menor en orden alfabetico. Arbitrario a proposito: lo que importa es que sea siempre la misma.

Aplicado al caso real: la ficha de `/mobile-accessories/` nombra a GP-TOS928SBEYW y la de `/tv-accessories/` no, asi que gana la propia. Verificado.

**Por que solo entre secciones distintas, y no en todos los empates.** Porque el empate intra-seccion (la ficha plana y su propia /buy/, 115 SKU) el recorrido no lo mueve nunca, y cambiar ahi el criterio si tendria consecuencias: medi que hoy hay **6 registros reales** firmados por una pagina que no los nombra existiendo otra que si, dos de ellos con rango 3. Cambiarlos tocaria el `paginaOrigen` y el `fuentePrecio` de productos reales a dias del Cyber, sin ganar nada: son todos intra-seccion. **La rama nueva esta muerta sobre los datos de hoy** (0 SKU publicados desde dos secciones, de 1.031) y existe para el dia que Samsung lo haga.

### 3. `duracionPrincipalesMin` nunca salia null (gravedad media)

`const principales = Math.min(paginasPrincipales, entries.length)` reescribia el TAMANO del bloque en vez de marcar que quedo incompleto. La corrida de humo del cambio anterior informo `{paginasPrincipales: 8, duracionPrincipalesMin: 1}` y se reporto como correcta: se lee como "el bloque eran 8 paginas y lo termine en 1 minuto" cuando el bloque son 347 y no se termino nunca.

Ahora el resumen lleva el tamano REAL y la duracion en null cuando no se completo. **Verificado en la corrida real de hoy: `"paginasPrincipales":345,"duracionPrincipalesMin":null`.**

### 4. La linea del log se contradecia sola (gravedad baja)

`INFO bloque_principal paginas=8 Smartphones=91+96 Tablets=45+21 ...` — 8 no es la suma de nada. Ahora: `paginas=345 recorridas=8 ...`, que son los dos numeros que existen de verdad.

### 5. El aviso de categoria ausente no tenia freno (gravedad baja)

Salia en CADA corrida mientras la condicion durara: 7 mensajes identicos por dia, por el mismo canal donde llegan las momias, hasta que una persona editara `src/prioridad.mjs`. El proyecto ya tenia la disciplina "una sola vez" en otros avisos (`avisadoSinVerificar`, `avisadoSinPrecio`) pero ahi la huella vive en el catalogo, y estos avisos no cuelgan de ningun SKU.

**`src/avisos-repetidos.mjs` (nuevo)**: una vez al dia por clave, con huella en `data/avisos-tecnicos.jsonl` (append-only, `merge=union` en `.gitattributes`, se poda sola a los 7 dias). No es "una sola vez para siempre" a proposito: una condicion que dura semanas tiene que seguir recordandose, pero una vez al dia, no siete.

**Verificado end-to-end, sin tocar samsung.com ni el webhook real**: tres corridas seguidas con un listado local y un webhook falso en `127.0.0.1`, con una categoria principal inventada. Resultado: **1 aviso, no 3**; en la segunda y la tercera el log dice `INFO aviso_tecnico_omitido ... (ya salio hoy)`; el archivo de huellas queda con una sola linea.

### 6. Lo que se muestra cuando no cabe todo dependia del recorrido (gravedad baja)

Tres mensajes al operador y dos campos del resumen cortan la lista (`slice(0, 15)` / `slice(0, 20)`), y esas listas salian en el orden en que se visitaron las paginas: **cuales 15 veia el operador cambiaba al reordenar**. Hoy no muerde (en 305 corridas ninguna paso de 15), pero no tiene por que decidirlo el azar.

**`src/muestras.mjs` (nuevo)**: `masCorridas()` ordena por insistencia y despues por modelo; `muestraDeUrls()` ordena alfabeticamente y saca repetidas. Y `mensajeCorreccionesDePrecio()` gano el desempate por modelo que le faltaba. **La lista que se REINTENTA sigue en orden de recorrido**, que es la prioridad que pidio el operador.

De yapa: **`data/latest.json` se escribe con las claves ordenadas por SKU**. No cambia ningun dato y era el pendiente nº 2 del cambio anterior; ademas quita la ultima salida cuyo orden dependia del recorrido. El primer commit despues de esto trae un diff grande de una sola vez.

### 7. Las promesas de tiempo estaban calculadas con la corrida mas rapida (gravedad baja)

El "~37 min" del bloque salia de 126 min / 1.183 paginas = 6,39 s/pagina, que es **la mas rapida de las ultimas 20 corridas completas**. La mediana de esas 20 es 9,13 (→ 53 min) y la mas lenta 10,65 (→ 62 min). Ademas el bloque se lleva el **100% de las 162 paginas /buy/ descubiertas**, que son las que pagan navegador.

README y pendientes dicen ahora **"entre 37 y 62 min, del orden de 53"**, y los adelantos por categoria van con rango. Lo que no depende del ritmo — el PUESTO en que empieza cada categoria — se mantiene exacto: Smartphones 717 → 1.

### 8. Piezas que ninguna prueba defendia (gravedad media y baja)

- **`seccion: "tablets"` no lo probaba nada**: era el unico de los cinco valores cuyo mutante sobrevivia (escribir `"tablet"` dejaba la suite en 333 verdes), porque el recorrido de juguete no tenia paginas familia bajo `/tablets/` y esa entrada siempre calzaba por NOMBRE. Costo medido del typo (medicion propia sobre el recorrido real): **23 paginas familia bajo `/tablets/`, que hoy firman 27 registros del catalogo**, se irian del bloque principal al final del recorrido — del minuto ~27 al ~126 — y en silencio, porque "Tablets" sigue existiendo por nombre y `categoriasPrincipalesAusentes` seguiria vacio.
  - **Ojo con la trampa**: mi primer intento de prueba fabricaba la pagina a partir del `seccion` declarado, asi que el typo se fabricaba a si mismo y **el mutante seguia sobreviviendo**. La prueba buena saca la seccion de los DATOS REALES (`src/seed.json`): exige que la seccion declarada de cada categoria sea la que esa categoria usa de verdad. Cierra las cinco y las que se agreguen manana.
- **El cableado de `run.mjs` no lo defendia nada**: borrar `entries = recorrido` apagaba la funcionalidad entera con la suite en verde. Ahora todo el armado (juntar, deduplicar, reordenar, recortar) es **`prepararRecorrido()`**, una funcion pura probada directo: que reordene, que deduplique, que el recorte por `LIMITE_PAGINAS` vaya DESPUES del reordenamiento, que un limite vacio/cero/negativo/basura no recorte, y que informe el tamano real del bloque.

### Verificacion

- **`npm test`: 308 → 371 verdes, 0 fallas.** Linea base 308 (sin el archivo de orden), 333 al cerrar el cambio anterior, 371 ahora.
- **MUTANTES: 52 corridos, 0 SOBREVIVEN.**
  - 33 mutantes nuevos sobre los arreglos de hoy (`scratchpad/fix2/mutar.py`), uno por vez sobre una copia fuera del arbol, suite entera, restaurando despues. **En la primera pasada sobrevivieron 4** — el typo de Tablets (prueba circular), borrar la regla del slug del desempate (la prueba lo dejaba ganar igual por alfabeto), el orden estable del canario (probado con un solo elemento) y no calcular las inversiones (comparado contra una lista vacia). Los cuatro son ahora pruebas mas duras y los cuatro mueren.
  - 19 mutantes del banco anterior re-corridos (`mutar2.py`) para comprobar que los arreglos de hoy no debilitaron ninguna proteccion vieja: mueren los 19, incluidos los dos del nucleo (`conservaPrecio` sin la comprobacion de rango, `conservaEstado`).
- **Corrida real del pipeline** contra una COPIA del catalogo real (1.031 registros) en carpeta temporal, `LIMITE_PAGINAS=8`, sin `DISCORD_WEBHOOK_URL`: 8 cargas de pagina + 4 sitemaps, las 8 de Smartphones, 0 errores, `inversionesIntraSeccion: 0`, `skusQueCambiaronDeSeccion: 0`, `paginasPrincipales: 345`, `duracionPrincipalesMin: null`, claves de `latest.json` ordenadas, `confiable: false` por el limite (correcto). Ningun aviso tecnico disparo, asi que `avisos-tecnicos.jsonl` ni se creo.
- **Corrida del cableado de avisos**: 3 corridas mas con listado y webhook LOCALES (`127.0.0.1`), **cero requests a samsung.com**.
- **Politica:** UA `CazadorBot/1.0`, `DELAY_MS` 2500 sin tocar, cero requests extra. **Jamas se toco el webhook real.** `data/` del repo intacta (md5 de `latest.json` identico antes y despues, `ejecuciones.jsonl` sigue en 305 lineas).
- **No se commiteo nada.**

### Lo que sigue pendiente

1. **Las 126 paginas /buy/ duplicadas** (pendiente antiguo). Sigue abierto: ahorra ~20 min de corrida y 126 cargas a samsung.com. **Ojo con una cosa al hacerlo**: no basta con borrarlas del descubrimiento. Esas /buy/ son las que leen el stock y el precio que la ficha plana a veces no logra leer (para eso existen `conservaEstado` y `conservaPrecio`), asi que sacarlas perderia datos. Habria que medir antes cuantos SKU dependen de ellas.
2. **Medir la promesa en la primera corrida real**: `duracionPrincipalesMin` deberia dar **entre 37 y 62 min (del orden de 53)** con 347 paginas. Si da mucho mas que 62, el bloque esta cargando paginas mas lentas de lo que se estimo.
3. **`categoriasPrincipalesAusentes`, `inversionesIntraSeccion` y `skusQueCambiaronDeSeccion` tienen que quedarse en vacio/0.** Si `inversionesIntraSeccion` deja de ser 0, el orden del recorrido volvio a poder cambiar resultados y hay que mirarlo el mismo dia.
4. **Sigue sin cubrir `npm test`**: las pocas lineas que quedan en `run.mjs` (llamar a `prepararRecorrido`, el instante en que se marca el fin del bloque, y el envio de los tres avisos tecnicos). Quedaron verificadas con las corridas reales de arriba, incluida la del webhook falso.
5. **Si el operador quiere agregar "Audio (Soundbars/Torres)"** (14 paginas, seccion `audio-devices`) es una linea en `src/prioridad.mjs`, explicada en el README.

---

# 2026-09-12 (noche, cuarta tanda) — Dos tipos de revision: el ALCANCE declarado

Pedido del operador, textual: *"Me gustaria que solo 2 veces al dia hagamos el recorrido y revision
de todas las categorias. Y el resto de las veces, la mayor cantidad de veces posible, solo estas 5
categorias que te mencionaba."* Eligio la propuesta de 20 ciclos: 2 completos + 18 livianos.

## El problema de fondo, que no es el horario

El horario es lo facil. Lo dificil es que **todo el sistema daba por sentado que cada corrida veia el
catalogo COMPLETO**. `comparar()` recorria todo el catalogo previo y a lo que no habia observado le
sumaba una ausencia; a las 2 ausencias lo declaraba desaparecido.

Medido sobre `data/latest.json` (1.031 registros, 102 ya desaparecidos): una corrida liviana ve 196
productos vivos y **no ve 733**. Sin arreglar nada, dos livianas seguidas habrian declarado
desaparecidos ~700 productos vivos en una hora: el incidente de los ~150 avisos falsos en 4 dias,
multiplicado por cinco.

**Hoy eso no pasa, pero por accidente**, y ese accidente era el que habia que sacar: la heuristica de
"corrida sospechosa" (encontrados < 80% de lo esperado) marcaba como NO confiable a toda corrida
liviana (196 de 929 es 21%), y una corrida no confiable no declara desaparecidos. El precio del
accidente: **un aviso tecnico "revision NO confiable" en cada corrida liviana** (18 al dia, por el
mismo canal donde llegan las bajas de precio), la deteccion de desaparecidos apagada en 18 de 20
corridas incluso para lo que SI se reviso, y 797 registros de `latest.json` cambiando a
`error_verificacion` en cada liviana para que el completo siguiente los revirtiera.

## Lo que se hizo

**`src/alcance.mjs` (nuevo, puro).** Una corrida DECLARA su alcance: `{modo, etiqueta, parcial,
paginas}`, donde `paginas` son las URL que esta corrida va a visitar **de verdad** (armadas DESPUES
del recorte por modo y por `LIMITE_PAGINAS`; declarar el bloque teorico habria hecho acumular
ausencias a SKU de paginas nunca visitadas). Ademas: `decidirModo()` con la escalada, `enAlcance()`,
`evaluarConfiabilidad()` y `claveNoConfiable()`. Vive en un modulo aparte y no en `run.mjs` porque
`run.mjs` arranca `main()` al importarse y nada de lo que este ahi lo puede cubrir una prueba
(leccion del cambio anterior).

**`comparar()`** recibe `alcance` (opcional, default = todo dentro, asi las 371 pruebas viejas y
todas las llamadas actuales siguen igual). El unico cambio de logica esta en el segundo bucle, y el
ORDEN importa:

1. `if (observado[modelo]) continue;` **va primero, sin excepcion**.
2. fuera del alcance -> `catalogo[modelo] = {...ant}` y `continue`. Byte por byte igual.
3. pagina fallida o corrida sospechosa -> la rama de siempre.
4. ausencia normal, ahora con piso de reloj.

**Por que NO se reuso la rama de paginas fallidas para "fuera del alcance"**, que era el atajo
obvio: "no lo revise" no es "fallo". Medido: dejaria 733 SKU en `error_verificacion` por liviana,
convertiria `resumen.sinVerificar` de 1 en 733 (dejando de servir para lo unico que sirve) y, si dos
completos seguidos se perdieran, dispararia un aviso tecnico nombrando 733 productos que nadie dejo
de vender. **Verificado en la corrida real**: `sinVerificar` da 1 en la liviana y 924 en la completa
recortada.

**La confiabilidad se juzga contra el alcance.** `prevRelevantes` (previo no-desaparecido) paso a ser
`esperados` (previo no-desaparecido **y dentro del alcance**). El umbral de errores ya escalaba solo
con `entries.length`. Y el aviso de "NO confiable" pasa por `avisarUnaVezAlDia()` con clave
`no-confiable:<modo>:<tipos de motivo>`: **con el motivo y sin los numeros**. Con los numeros, cada
corrida tendria clave distinta y el freno no frenaria nada; con solo el modo, la primera falla del
dia taparia una falla DISTINTA tres horas despues. El aviso de `previoChico` tambien pasa por el
freno (clave `catalogo-chico`).

**Los cuatro umbrales que contaban corridas ahora cuentan horas** (`src/comparar.mjs`, "los pisos de
reloj"). Los pisos **solo retrasan, nunca adelantan**: la evidencia en corridas sigue siendo
obligatoria y ademas tiene que pasar el tiempo. Con la cadencia de hoy ninguno cambia nada.

| Umbral | Piso nuevo | Argumento en dias |
|---|---|---|
| `UMBRAL_AUSENCIAS = 2` (desaparecido) | 6 h sobre `ultimaVezVisto` | Hoy 2 ausencias ya son ~6,2 h (separacion mediana medida: 3,08 h). Sin piso serian **1 h** para un Galaxy. Y es la regla que mas se equivoca: de los 157 "desaparecido" de `history.jsonl`, **35 (22,3%) los desmintio un "recuperado" en <= 24 h**, mediana 9,2 h. Los pares de corridas consecutivas que pueden gatillarla pasan de 6 a 19 por dia sobre justo el bloque liviano. |
| `UMBRAL_SIN_VERIFICAR = 20` (momia sin verificar) | 72 h sobre `ultimaVezVisto` | El comentario del codigo prometia "~3 dias a 7 corridas diarias"; a 3,08 h medidas, 20 corridas son 62 h. 72 h vuelve verdadero el comentario. Sin piso: 1 dia para un Galaxy, 10 dias para un televisor. |
| `corridasSinPrecio >= 20` (momia de precio) | 72 h sobre `sinPrecioDesde` (campo nuevo) | Igual que el anterior. No tenia ancla de ningun tipo. |
| `UMBRAL_PRECIO_OTRA_FUENTE = 3` | 6 h sobre `precioDistintoDesde` (campo nuevo) | La cuenta llega a 3 dos intervalos despues de la primera lectura distinta: hoy ~6,2 h. Con livianas cada hora serian 3 h de margen para que el sitio se estabilice, y el vaiven ya costo ~8 avisos falsos diarios durante un mes. |

Los dos campos nuevos **viven y mueren con el contador que acompanan** (`olvidarPrecioDistinto()`
los borra juntos), asi que los ~940 registros sanos de `latest.json` no engordan ni un byte. Cuando
el tiempo no se puede medir (registro viejo sin `ultimaVezVisto`, o un `timestamp` que no es fecha),
el piso se da por cumplido: es lo que deja intacto el comportamiento de las 371 pruebas anteriores y
lo que impide que un registro legado quede inmortal.

**El workflow**: 38 horarios (2 completos + 18 livianos + 18 de modo Cyber). El modo sale de
`github.event.schedule` en un paso con nombre que ademas emite un `::notice`. **Escalada automatica**:
si hace mas de 16 h que no hay un completo, la liviana se amplia sola y lo avisa. Cubre los tres
modos de perder un completo — que la cola de GitHub lo descarte, que lo cancele la corrida anterior,
y que alguien rompa el string del cron — y este ultimo es el que importa, porque el paso del yml cae
en "liviano" cuando no reconoce el cron: eso protege contra fantasmas pero deja la cobertura
desprotegida, y perder el 70% del catalogo en silencio es la peor falla posible aca.

**Modo Cyber**: variable de repositorio `MODO_CYBER=on`, dos clicks, paso a paso en el README. Los 18
horarios de media hora estan escritos permanentemente y el job se salta solo con un `if` a nivel de
job. Y `MODO_CYBER=on` **ademas achica el bloque** a Smartphones + Computadores (216 paginas): sin
eso el modo Cyber es aritmeticamente imposible — 347 paginas son 37-62 min y no caben en media hora,
asi que cada corrida se comeria la siguiente y el operador recibiria MENOS revisiones, no mas.

## Tres premisas del encargo que resultaron falsas (medidas)

1. **"si uno se atrasa el siguiente QUEDA EN COLA"** — no. El grupo de concurrencia deja como maximo
   UNA corrida pendiente y la siguiente la reemplaza. No hay cola larga posible: hay **perdida
   silenciosa de franjas**, que el operador va a ver como filas grises en Actions. Esta explicado
   en el README y es la razon principal de que ninguna regla pueda contar corridas.
2. **"corridas reales recientes: 126, 134, 134 min"** — son las unicas 3 asi, todas de hoy y
   posteriores a los arreglos de hoy. Sobre las 307 corridas de `ejecuciones.jsonl`: **minimo 126,
   mediana 176, p90 194, maximo 242**. A 9,0 s/pagina (mediana medida) el bloque liviano son **52
   min, no 37**. Cuentas honestas: 2x176 + 18x52 + 20x5 de preparacion = **~23 h de un dia de 24**.
   En un dia lento se van a descartar solas 2-4 livianas. Se entrega igual la cadencia que el
   operador eligio, pero el diseno no depende de que las 20 ocurran.
3. **"los comentarios del cron usan UTC-3 (invierno, vigente en julio)"** — el archivo mentia desde
   julio: en julio Chile es UTC-4. UTC-3 SI es correcto hoy (Chile entro en horario de verano el
   05-09-2026) y lo sera hasta el primer sabado de abril de 2027. El comentario ahora dice la verdad.

## Una decision que se desvia del encargo, con su medicion

El encargo pedia los horarios en punto (`"0 5 * * *"`). **Quedaron en el minuto 7, 23 y 53.** La
documentacion de GitHub avisa que el schedule se atrasa en las horas de mas carga y que "las horas
de mas carga incluyen el comienzo de cada hora". Medido sobre las 306 transiciones de
`ejecuciones.jsonl` con los 7 horarios en punto anteriores: atraso mediano **68 min**, p90 172,
maximo 342. Y mirando SOLO las corridas que arrancaron con la maquina libre (mas de 30 min sin
correr nada), para descartar la saturacion propia: mediana **74 min**, p90 222. O sea no es culpa de
la cola propia. **Las HORAS acordadas con el operador no se tocaron** (completos 02 y 14, livianos
cada hora): solo el minuto.

## Verificacion

- **`npm test`: 371 -> 411 verdes, 0 fallas.** Las 371 anteriores siguen pasando sin tocar una linea:
  `alcance` es opcional en `comparar()` y las funciones de momia aceptan la forma vieja `(catalogo, 3)`.
- **MUTANTES: 18 corridos sobre una copia fuera del arbol, 0 SOBREVIVEN.** Uno por cada pieza nueva:
  borrar la rama de fuera-de-alcance, tratarla como pagina fallida, mover el filtro antes del
  `continue`, borrar cada uno de los cuatro pisos de reloj, no escribir `sinPrecioDesde`, no borrar
  el ancla junto con el contador, dar por dentro un registro sin pagina, juzgar la confiabilidad
  contra el catalogo entero, sacarle el motivo a la clave del aviso, no escalar nunca, contar las
  corridas viejas como livianas, armar el alcance antes del recorte, no recortar en modo liviano, y
  tres del modo Cyber. **En la primera pasada sobrevivio 1**: mover el filtro de alcance antes del
  `if (observado[modelo]) continue;`. Mi razonamiento inicial (y el de uno de los informes) decia que
  eso emitiria un "nuevo" falso, y es **falso**: los dos bucles son independientes y el primero
  siempre usa `previo[modelo]`. Lo que de verdad rompe es peor y mas silencioso: le **pisa el
  registro recien calculado con el dato viejo**, o sea tira a la basura el precio que la pagina acaba
  de publicar DESPUES de que el aviso ya salio, y la corrida siguiente vuelve a detectar el mismo
  cambio y a avisarlo, para siempre. Es la forma del defecto que mando ~8 avisos falsos por dia
  durante un mes. La prueba nueva lo mata (afirma que el catalogo se queda con lo observado y que la
  misma baja no se avisa dos veces) y el comentario del codigo quedo corregido.
- **La prueba que mas importa**: `completo -> liviano x9 -> completo -> liviano x9` sobre una copia del
  catalogo REAL (1.031 registros), con `comparar()` real y un sitio perfectamente estable:
  **0 eventos de cualquier tipo, 0 desaparecidos falsos, 0 corridas marcadas como sospechosas**, el
  catalogo conserva sus 1.031 registros, y los 797 registros de fuera del alcance salen
  `deepStrictEqual` al de antes en cada liviana. Su contraparte tambien verde: un televisor que
  desaparece DE VERDAD se avisa **en el segundo completo** (hora 12), no antes, y durante las 9
  livianas del medio no se le movio ni una ausencia.
- **Fragilidad corregida sobre la marcha**: las primeras aserciones de esa prueba eran numeros exactos
  (1185, 347, 797). `npm test` corre en el workflow ANTES de scrapear y **bloquea la corrida si
  falla**, y `data/latest.json` cambia hasta 20 veces al dia: una asercion exacta habria convertido
  "Samsung publico tres paginas nuevas" en "el monitor dejo de correr". Ahora van con holgura del
  25% (`cercaDe()`), con el numero medido en el mensaje de error.
- **Corrida real del pipeline en los DOS modos**, contra copias del catalogo real en carpetas
  temporales, `LIMITE_PAGINAS=6`, sin `DISCORD_WEBHOOK_URL`:
  - **completo**: `alcance:"todo"`, `noVerificadosPorAlcance:0`, `productosEsperados:929`,
    `sinVerificar:924`, `confiable:false` (correcto: con 6 paginas ve 5 productos de 929), 0
    desaparecidos, 0 avisos. Huella del freno escrita una vez:
    `{"clave":"no-confiable:completo:faltan-productos","dia":"2026-09-12"}`. **928 de 1.031 registros
    cambiaron** (a `error_verificacion`, comportamiento de siempre para una corrida que no vio nada).
  - **liviano**: `alcance:"principales"`, `noVerificadosPorAlcance:1026`, `sinVerificar:1`,
    `confiable:true`, 0 desaparecidos, 0 avisos, **ningun aviso tecnico** (`avisos-tecnicos.jsonl` ni
    se creo). **1.026 de 1.031 registros byte por byte identicos**; solo cambiaron los 5 observados.
  - Los dos numeros juntos son el cambio entero en una linea: la liviana toca 5 registros donde antes
    habria tocado 1.031, y no manda el aviso tecnico que habria mandado 18 veces al dia.
- **Politica de scraping**: UA `CazadorBot/1.0`, `DELAY_MS` 2500 sin tocar, **cero requests extra**
  (el recorrido liviano es un subconjunto estricto del completo). Volumen diario con el plan:
  2x1.185 + 18x347 = **8.616 paginas/dia contra 8.281 hoy, +4%**. Las dos corridas de verificacion
  fueron 12 cargas de pagina + 8 sitemaps en total. **Jamas se toco el webhook real.**
- **`data/` del repo intacta** y **no se commiteo nada** (`git status`: solo los 4 archivos
  modificados y los 2 nuevos).
- **Avisos en vivo**: `src/despachador-vivo.mjs` no se toco ni una linea. Solo necesita `previo[sku]`
  y lo recien observado, asi que funciona igual sin saber de que modo es la corrida; `totalPaginas`
  ya sale de `entries.length`, asi que el encabezado "revisando pagina X de 347" queda correcto
  gratis. Meterle el alcance habria duplicado la decision en el unico lugar donde hoy no puede
  divergir de `comparar()`.

## Lo que sigue pendiente

1. **Medir `duracionPrincipalesMin` de verdad.** El campo ya existe desde el cambio anterior y cada
   revision completa lo escribe: **es la duracion exacta del bloque liviano, medida, no estimada**.
   A la semana de correr esto hay que mirarlo. Si da cerca de 40 min, los 18 livianos entran comodos;
   si da 60, hay que sacar algunas lineas de cron. **No hace falta adivinar: el dato se recolecta
   solo desde la primera corrida.**
2. **Mirar cuantas livianas se descartan de verdad** (filas grises en Actions) durante la primera
   semana. Si son mas de 4-5 por dia, la cadencia real es de ~1,5 h y conviene bajar a livianos cada
   2 h (9 en vez de 18): se borran 9 lineas de cron y nada mas.
3. **`data/history.jsonl` va en 9,64 MB** (19.286 lineas) y crece 173 KB/dia con 7 corridas. Con 20
   no se triplica (los cambios de fondo son los mismos eventos) pero si captura parpadeos intradia:
   estimacion 260-350 KB/dia. Cruza el aviso de GitHub de 50 MB por archivo en ~5 meses y el limite
   duro de 100 MB (que RECHAZA el push) en ~10. **No lo causa este cambio, pero le acorta la mecha a
   la mitad.** La salida limpia es rotar por mes a `data/historial/AAAA-MM.jsonl` — sigue siendo
   append-only, y la regla `merge=union` de `.gitattributes` hay que extenderla al patron nuevo EN EL
   MISMO cambio o se vuelve al `-X theirs` que borraba lineas. No se hizo aca para no mezclar dos
   cosas.
4. **Cachear `~/.cache/ms-playwright`** con `actions/cache`: `npx playwright install --with-deps
   chromium` pasa de correr 7 a 20 veces al dia (~1-3 min cada vez). Son ~20-60 min/dia de reloj que
   salen justo del margen que no sobra. Opcional hoy; deja de serlo si la duracion vuelve a los 176
   min medianos.
5. **`run.mjs` sigue sin cubrir `npm test`** en las lineas de cableado (llamar a `decidirModo`,
   `prepararRecorrido`, y el envio de los avisos tecnicos). Quedaron verificadas con las dos corridas
   reales de arriba — en particular el freno del aviso de no confiable, que dejo su huella en
   `avisos-tecnicos.jsonl` de la corrida completa.

---

# 2026-09-12 (cierre) — Lo que encontraron tres verificaciones independientes, y como quedo

El cambio del alcance declarado (entrada anterior) se sometio a tres revisiones independientes. Una
lo **refuto**. Las tres encontraron defectos reales y reproducibles. Esta entrada es el cierre: que se
arreglo, que se midio de nuevo, y que queda sabido.

## Los defectos, y el arreglo de cada uno

**1. Un producto que se MUDA de seccion recibia un DESAPARECIDO falso** (lo encontraron DOS
verificadores por separado, con `comparar()` real sobre el catalogo real). El filtro de alcance mira
la `paginaOrigen` GUARDADA: mientras esa pagina siga dentro del bloque liviano, las livianas cuentan
el SKU como propio, no lo ven nunca (ya se publica desde otra pagina, de fuera del bloque) y le suman
ausencias con todas las de la ley. A las 6 h: "DESAPARECIDO". El completo siguiente: "RECUPERADO". El
producto estuvo a la venta todo el tiempo. **Es la forma exacta del incidente de los ~150 avisos
falsos en 4 dias, y era una REGRESION**: el sistema anterior, con todas las corridas completas, daba 0
eventos para ese mismo hecho.

Arreglo (`ausenciaVerificada` en `src/comparar.mjs`): ademas de las 2 ausencias, **al menos una tiene
que venir de una revision que miro el catalogo ENTERO**. Una corrida parcial no puede distinguir "ya
no se vende" de "se mudo a una pagina que yo no miro"; una completa si, porque la visita. El campo
`ausenciaEnCompleto` vive y muere con el contador `ausencias`. Cuesta: una desaparicion real DENTRO
del bloque se avisa entre 5 y 12 h en vez de 5-7 h. Fuera del bloque no cambia nada.

**2. Encogimiento silencioso del alcance.** Juzgar la confiabilidad contra el alcance DECLARADO abrio
un agujero: un alcance que se achica **se justifica solo** (`esperados` se achica junto con
`encontrados`). Si el descubrimiento por sitemap devuelve menos paginas, el liviano pasa de 347 a 185
y 160 productos caen de 20 miradas diarias a 2, con 0 corridas sospechosas y 0 avisos durante dias. El
sistema anterior convertia esa caida en 160 avisos falsos: ruidoso y equivocado, pero VISIBLE.

Arreglo (`TOLERANCIA_ENCOGIMIENTO` + `ultimoRecorrido`, `src/alcance.mjs`): el tamano del recorrido de
hoy se compara con el de la ultima corrida **del mismo tipo**, leido de `data/ejecuciones.jsonl`, y un
encogimiento de mas del 10% marca la corrida sospechosa.

**2bis. Y ESE ARREGLO NO ALCANZABA — lo encontre yo al re-verificar, simulando 7 dias de la cadencia
real.** El encogimiento se mide contra la corrida anterior, asi que **la vara se mueve sola**: con el
sitemap caido, la primera completa se marca sospechosa y no declara nada, pero la segunda ya compara
1.023 contra 1.023, se da por sana, y **a la tercera salen 160 desaparecidos falsos**, a las ~24 h del
corte. Medido: `eventos={"desaparecido":160}` en 7 dias simulados.

Arreglo (`TOLERANCIA_SIN_PAGINA = 0.05`): una revision COMPLETA cuenta cuantos productos vivos del
catalogo se quedaron **sin ninguna pagina en su recorrido**. Se juzga contra el CATALOGO y no contra
la corrida anterior, asi que **no se normaliza**: mientras el sitemap siga caido, cada completa vuelve
a encontrar los mismos 160 y sigue sin declarar nada. Los tres numeros que fijan el 5%: una completa
SANA deja **0** de 929 sin pagina; con el sitemap caido son **160 (17%)**; y el peor dia de
desapariciones reales de toda la historia (`history.jsonl`, 157 eventos en 26 dias) son **29 (3,1%)**,
mediana 4. Solo aplica a las completas: en una liviana "sin pagina" es la normalidad (733) y lo
resuelve `enAlcance()`. Resultado medido: los mismos 7 dias pasan de **160 desaparecidos falsos a 0**,
con las 14 completas correctamente marcadas sospechosas, y los 160 productos saliendo por el canal
correcto ("no se pueden verificar hace 3 dias") en vez del incorrecto.

**3. El aviso de momia se atrasaba de ~3 dias a ~9,6 dias para el 73% del catalogo**, y el comentario
del codigo decia lo contrario. `corridasSinVerificar` solo avanza cuando la corrida MIRA al producto:
con 20, dentro del bloque son ~1 dia (y mandaba el piso de 72 h) pero fuera son ~10 DIAS (y mandaba el
contador). Los pisos de reloj solo retrasan, nunca adelantan, asi que 72 h no podia arreglarlo.
Arreglo: **`UMBRAL_SIN_VERIFICAR` de 20 a 6**. A 2 miradas diarias, 6 corridas son 3 dias = el piso.
Las dos puntas del catalogo avisan a los 3 dias. Verificado que no produce ninguna rafaga al
desplegarse: hoy el maximo de `corridasSinPrecio` es 3 y el de `corridasSinVerificar` es 5, ninguno
cruza el 6, y el unico que esta en 5 se vio hace 26 h (el piso de 72 h lo sostiene igual).

**4. La clave del freno diario no distinguia gravedad.** Una liviana con 36 de 347 paginas caidas a
las 05:23 consumia la clave del dia y **silenciaba** una con 340 de 347 caidas a las 13:23: mismo tipo
de motivo. Arreglo: los motivos viajan como `{tipo, gravedad, texto}` y la clave lleva
`tipo:gravedad`. Dos baldes (leve/grave, corte en el 50%) frenan el ruido diario y dejan pasar el
empeoramiento.

**5. El modo Cyber apagaba en silencio la vigilancia de 3 categorias**, y la apagaba **tambien en las
revisiones completas**. `ordenarRecorrido` usaba la misma lista para dos cosas distintas. Arreglo:
`ordenarRecorrido(entries, categorias, vigiladas)` — el bloque decide que se mira seguido, las
vigiladas son SIEMPRE las 5. Lo que el Cyber si cuesta (77 productos vivos pasan a 2 miradas diarias)
quedo escrito en el README, que es donde el operador lo va a leer.

**6. Los 18 horarios del Cyber se disparaban aunque el Cyber estuviera apagado.** El `if` que los
salta esta a nivel de JOB y `concurrency` a nivel de WORKFLOW: GitHub mete la corrida al grupo ANTES
de evaluar el `if`, y el grupo deja como maximo UNA pendiente. O sea que una corrida del minuto 53 que
no va a hacer nada **desaloja de la ranura pendiente a una liviana de verdad** — lo contrario de lo
que pidio el operador. Arreglo: los 18 horarios quedan **comentados**; encender el Cyber es la
variable `MODO_CYBER=on` **y** descomentarlos. El `if` se queda como red de seguridad. El README tiene
el paso a paso y una prueba vigila que los dos digan lo mismo.

**7. "Run workflow" venia con `default: liviano`.** El operador que aprieta el boton sin tocar el
desplegable — que es lo que hizo siempre, porque antes no habia desplegable — se llevaba el 21% del
catalogo creyendo haber revisado todo. Arreglo: `default: completo`.

**8, 9, 10. Tres piezas sin prueba que las sostuviera** (mutantes que sobrevivian con la suite en
verde): `ultimoCompleto` no tenia ningun caso con DOS filas completas, asi que invertir el bucle — que
convierte toda liviana en una completa de 3 h mas un aviso diario — dejaba las pruebas verdes; la
prueba del umbral de escalada era **tautologica** (derivaba su entrada de la propia constante, asi que
pasaba con `HORAS_SIN_COMPLETO = 9999`); y `alcanceDe` podia mentir la etiqueta, `prepararRecorrido`
devolvia un campo `modo` que no consumia nadie, y `claveNoConfiable` podia perder su `.sort()`.
Arreglo: una prueba por cada uno, y el campo muerto borrado.

**11. EL QUE NO TIENE ARREGLO DE CODIGO, y es el mas importante para el operador.** Un quiebre de
stock TEMPORAL de menos de ~12 h en un producto que no sea de las 5 categorias pasa de avisarse el
75-100% de las veces a avisarse el **0%**. No es un atraso: es silencio. La confirmacion de stock
exige 2 observaciones seguidas, y para los 733 productos de fuera del bloque dos observaciones
seguidas ahora estan a 12 h. Lo reproduje por mi cuenta, con `comparar()` real de las dos versiones y
las dos agendas reales, barriendo 72 momentos de inicio x 8 duraciones, y **me dio exactamente lo
mismo** que el verificador (de cada 100 veces que pasa, cuantas se entera el operador):

| duracion del hecho (h) | 2 | 4 | 6 | 8 | 10 | 12 | 16 | 24 |
|---|---|---|---|---|---|---|---|---|
| quiebre de stock, TV — VIEJO | 0 | 25 | 75 | 92 | 100 | 100 | 100 | 100 |
| quiebre de stock, TV — NUEVO | 0 | 0 | 0 | 0 | 0 | 0 | 33 | 100 |
| oferta, TV — VIEJO | 58 | 92 | 100 | 100 | 100 | 100 | 100 | 100 |
| oferta, TV — NUEVO | 17 | 33 | 50 | 67 | 83 | 100 | 100 | 100 |
| quiebre de stock, Galaxy — NUEVO | **75** | 97 | 100 | 100 | 100 | 100 | 100 | 100 |
| oferta, Galaxy — NUEVO | **89** | 100 | 100 | 100 | 100 | 100 | 100 | 100 |

Las dos ultimas filas son lo que se gana, y es exactamente lo que el operador pidio: dentro del bloque
un quiebre de 2 h pasa de 0 a 75. Lo de arriba es aritmetica de muestreo con 2 completas al dia: no se
arregla en el codigo, se DICE. Quedo escrito en el README con esta tabla, en castellano y antes de que
pase, junto con la palanca medida: **una tercera completa** (cada 8 h en vez de cada 12) recupera las
ofertas (4 h de 33 a 50, 6 h de 50 a 75, 8 h a 100) pero casi nada de los quiebres de stock (10 h de 0
a 25, 12 h de 0 a 50). Una prueba fija las dos mitades: el comportamiento medido **y** que la
advertencia siga en el README.

## Verificacion de este cierre

- **`npm test`: 411 -> 446 verdes, 0 fallas.** Las 371 originales siguen intactas.
- **MUTANTES: 33 corridos sobre una copia fuera del arbol, uno por arreglo. 32 mueren.**
  - El unico que sobrevive a `npm test` es **"run.mjs no le pasa el recorrido anterior"**, y es el
    hueco conocido: `run.mjs` arranca `main()` al importarse, asi que ninguna prueba lo alcanza. **No
    quedo sin verificar**: lo mata la corrida real del pipeline (abajo), donde el motivo "(1023 vs
    1183)" desaparece en cuanto se aplica el mutante.
  - Uno sobrevivio en la primera pasada y vale contarlo: **"ultimoRecorrido ignora el modo"**. Es casi
    un mutante equivalente (hoy la etiqueta ya determina el modo), pero `ejecuciones.jsonl` se
    commitea y se fusiona **por union** entre corridas concurrentes, asi que una fila mezclada es
    posible — y con un solo filtro, una completa se compararia contra un recorrido liviano (1.185 vs
    347 = "encogimiento" del 71%) y quedaria sospechosa sin motivo, que es como se apaga la deteccion
    de desaparecidos sin que nadie lo pida. Prueba agregada; el mutante muere.
- **SIMULACION DE 7 Y 30 DIAS DE LA CADENCIA REAL** (2 completos + 18 livianos) sobre una copia del
  catalogo REAL, con `comparar()`, `alcance.mjs` y `prioridad.mjs` de verdad, y el simulador fuera del
  repo. El modelo se valido primero: reproduce 1.185 paginas, 347, 929 vivos, 196 dentro, 733 fuera, y
  el recorrido liviano es prefijo exacto del completo.
  - baseline 7 dias (140 corridas) y 30 dias (600 corridas): **0 eventos de cualquier tipo, 0 corridas
    sospechosas, 1.031 registros, ausencia maxima 0**. El contador de ausencias no deriva.
  - saltar 1 completo / los 2 de un dia / los 4 de dos dias / **los 14 de la semana entera**: 0 falsos
    en todos; 1, 2, 3 y 10 escaladas automaticas respectivamente. La escalada no se gatillo ni una vez
    de gratis en 30 dias de baseline.
  - una pagina principal caida todos los livianos de un dia: 0 falsos. Las 94 paginas /buy/ de
    smartphones caidas: 0 falsos y 18 corridas correctamente sospechosas. 2% de paginas al azar 7
    dias: 0 falsos.
  - **descubrimiento caido**: solo en livianos, 0 falsos; **en todas las corridas 7 dias, 0 falsos**
    (eran 160 antes del arreglo 2bis) con las 14 completas marcadas sospechosas; solo en los 2
    completos de un dia, 0 falsos.
  - modo Cyber encendido 7 dias: 0 falsos.
- **PIPELINE REAL (`src/run.mjs` entero) EN LOS DOS MODOS, SIN RED.** Copia fuera del arbol
  sustituyendo solo las tres puertas al exterior (`procesarEntrada`, `discoverFamilyUrls` y el
  navegador). **Cero requests a samsung.com, webhook vacio.**
  - **completo**: 1.185 paginas, `alcance:"todo"`, `noVerificadosPorAlcance:0`,
    `productosEsperados:929`, `encontrados:929`, `confiable:true`, 0 desaparecidos, ningun aviso
    tecnico.
  - **liviano**: 347 paginas, `alcance:"principales"`, `noVerificadosPorAlcance:797`,
    `productosEsperados:196` (juzgado contra su alcance, no contra 929), `confiable:true`,
    `motivos:[]`, 0 desaparecidos, `avisos-tecnicos.jsonl` ni se creo, y **797 de 1.031 registros byte
    por byte identicos**. El recorrido liviano es subconjunto estricto del completo: cero requests
    nuevos.
  - **completo con el descubrimiento caido** (la tercera, la que cubre el cableado): 1.023 paginas,
    `confiable:false` con los DOS motivos nuevos, **0 desaparecidos**, 160 en `sinVerificar` (el canal
    correcto), y la huella del freno escrita una vez:
    `{"clave":"no-confiable:completo:recorrido-encogido:leve|sku-sin-pagina:leve"}`.
- **`data/` del repo intacta**: `git status --porcelain data/` vacio, y los md5 de `latest.json`,
  `ejecuciones.jsonl` e `history.jsonl` identicos a los del principio. **No se commiteo nada.**

## Lo que queda pendiente

Siguen los 5 de la entrada anterior (medir `duracionPrincipalesMin`, contar las livianas descartadas,
rotar `history.jsonl` antes de los 50 MB, cachear Playwright, y el hueco de cobertura de `run.mjs`), y
se agregan dos:

6. **Decidir si hace falta la tercera revision completa.** La tabla del punto 11 es el insumo: si al
   operador le importan los quiebres de stock cortos de televisores y linea blanca, la palanca es una
   linea de cron. Si no, no se toca nada. **Es una decision de producto, no tecnica.**
7. **Mirar `sku-sin-pagina` en `ejecuciones.jsonl` la primera semana.** Hoy una revision sana deja 0
   productos sin pagina. Si aparece un numero distinto de 0 sin que el descubrimiento este caido, el
   umbral del 5% hay que revisarlo con el dato en la mano en vez de con la estimacion de hoy.

---

# 2026-09-13 — Precios congelados de mas: la llave es lo que declara la pagina, no digitalData

El arreglo del vaiven (2026-09-12) exige que el monto este ESCRITO en la pagina antes de adoptarlo, y
si no hay ninguno escrito la observacion va SIN precio. Eso cerro la carrera contra el render, pero
dejo 94 SKU sin poder leer su precio nunca mas. Un producto sin precio legible queda con el ultimo
precio bueno presentado como vigente y **no se puede enterar** de que Samsung se lo cambio.

## Lo medido en produccion

El contador `precioCongelado` del resumen fue **72 -> 85 -> 91 -> 94** en cuatro corridas seguidas
(`ejecuciones.jsonl`, 2026-09-12). De esos 94, **57 llevan las 4 corridas seguidas sin poder leer el
precio** (y son exactamente los 57 que siguen con `versionPrecio: 2`). Notificables son **47** con el
filtro real del repo — 94 menos 45 accesorios y 2 Book3 silenciados —: Familia 11, Televisores 9, TV
Lifestyle 7, Lavado y secado 3, Refrigeradores 3, LED Signage 2, Cocina 2, Proyectores 2, y 1 en cada
una de Aire acondicionado (sistemas), SmartThings, Smartphones, Monitores, Audio y Galaxy Buds,
Relojes, Signage, Aspiradoras.

Los 94 estan `no-a-la-venta` (los 94, sin excepcion), tienen `rango: 3`, `url == paginaOrigen` y
ningun `fuentePrecio`: su precio guardado salio de su propia ficha. Y ninguno llega jamas al aviso
tecnico de momia de precio, porque `marcarSinPrecioProlongado` excluye a proposito los
`no-a-la-venta`: el congelamiento era **silencioso**.

Cuatro de esas fichas, cargadas en vivo el 2026-09-13:

| SKU | guardado | model_price | list_price | bloque |
|---|---|---|---|---|
| NX52A5411CS/ZS | 479.990 | 479.990 | 479.990 | "No está a la venta" |
| NP750XGJ-KS3CL | 899.990 | 899.990 | 899.990 | "No está a la venta" |
| QN43LS03BAGXZS | 839.990 | 839.990 | 839.990 | "Dónde comprar" |
| F-UN85MHWB450 | 1.099.990 | 1.099.990 | **1.659.980** | "Dónde comprar" |

## El primer intento, y por que se cayo

La primera version agregaba una linea en `precioVisiblePreferido`:

    if (modelPrice === listPrice) return modelPrice;   // <- REFUTADA, no esta en el codigo

con el argumento "con un solo candidato en digitalData no hay carrera posible". **El argumento es
correcto sobre digitalData y falso sobre la pagina: hay un TERCER numero, el del bloque de compra
(`precioDelBloqueCompra`), y es el que manda cuando se deja leer.** Que los dos campos de digitalData
coincidan no lo elimina; y esa funcion no sabe si el bloque se dejo leer, asi que aplicaba la
concesion tambien cuando la respuesta honesta era "no se".

Medido con `extractSingleProduct`, `integrarVariantes` y `comparar()` REALES, sobre una ficha con
oferta cuyo digitalData publica 839.990 en los dos campos (= el tachado) mientras el bloque cobra
$599.990 — avisos falsos, o sea avisos que no corresponden a ningun cambio en Samsung:

| escenario (5 o 4 corridas) | con la linea refutada | HEAD (sin nada) | con el arreglo de hoy |
|---|---|---|---|
| E1 render intermitente (bloque ilegible) | **4** | 0 | **0** |
| E1b el mismo material al reves | **5** | 0 | **0** |
| E3 digitalData iguales una vez y distintos la siguiente | **3** | 0 | **0** |
| E3b simetria de E3 | **4** | 0 | **0** |
| E7 congelado con `versionPrecio: 2`: la lectura ciega sella la version | **1 a Discord** | correccion tecnica | **correccion tecnica** |
| E8a dos paginas del mismo SKU en la misma corrida | **1** (y el precio queda MAL) | 0 | **0** |
| E2 control (el body si alcanzo a pintarse) | 0 | 0 | 0 |
| E5 / E6 estreno y retiro de oferta reales | salen | salen | **salen** |

E7 importa aparte: `comparar.mjs` preserva `ant.versionPrecio` solo cuando la observacion no trae
precio. Con la linea refutada, una lectura totalmente ciega ya traia un numero, sellaba
`versionPrecio: 3` y **cerraba la amnistia de `corrigeFuenteDePrecio`**; la primera lectura buena
salia a Discord como "bajo 839.990 -> 599.990". Es el mismo defecto que la entrada del 2026-09-12
(noche) dice haber arreglado, reabierto por el otro lado, y hoy hay 57 SKU reales en ese estado.

Y una premisa del primer informe era **falsa**: "los 94 estan no-a-la-venta, por lo mismo no pueden
tener descuento, y sin descuento los dos montos coinciden". Medido sobre `data/latest.json`: **16 de
los 94 tienen guardado un precio con forma de descuento aplicado** (no termina en 990/980/000), y uno
de ellos, `GP-FPS938OBJTW`, recibio un **-30% real el 2026-09-09** (39.990 -> 27.993) leido de su
propia pagina. Ademas **18 de los 112 registros `no-a-la-venta` no estan congelados**: sus paginas si
dibujan un monto. O sea que "no-a-la-venta" no implica ni "la pagina no dibuja monto" ni "no hay
descuento". El arreglo que quedo no usa esa premisa en ninguna parte.

## El segundo intento tampoco alcanzaba

La contramedida propuesta era mover la concesion a `precioAdoptable` — que si sabe si el bloque se
dejo leer — y gatearla en `bloqueLegible`. Cierra E1, E1b, E3, E3b, E7 y E8a, pero **medido, deja
abierta la misma puerta un instante mas tarde**: un bloque que ya tiene texto pero todavia no
escribio su monto es indistinguible de uno que no lo va a escribir nunca.

| escenario (bloque LEGIBLE, sin monto) | con `bloqueLegible` | con el arreglo de hoy |
|---|---|---|
| E9 el bloque dice "Comprar" y el monto no llego | **4** | **0** |
| E9b simetria de E9 | **5** | **0** |
| E9c el bloque dice "Cargando..." | **3** | **0** |

## El arreglo que quedo

La concesion vive en `precioAdoptable` (`src/extract.mjs`) y su llave no es "el bloque se dejo leer"
sino **"el bloque de compra declaro que Samsung no lo vende online"**:

    if (!Number.isFinite(precioFinal) && !dosCandidatos && paginaNoLoVendeOnline
        && Number.isFinite(modelPrice) && modelPrice > 0) {
      if (esPrecioOriginalEscrito(modelPrice, bodyText)) return null;
      return modelPrice;
    }

con `paginaNoLoVendeOnline = estadoDesdeBloqueCompra(bloque.texto, bloque.ctas) === NO_A_LA_VENTA` en
`extractSingleProduct`. Es la pagina diciendo, en el mismo lugar donde escribiria el precio, que no
hay precio de venta que leer ("Dónde comprar" / "No está a la venta", vocabulario cerrado de
`src/stock.mjs`). Tres decisiones deliberadas, todas hacia el lado seguro:

- **No la barra de precio pegajosa**, aunque sirva para el stock: no es donde va el precio y nadie
  midio si puede decir "No está a la venta" mientras el bloque se termina de pintar.
- **No la API por SKU**: describe el stock de una bodega, no lo que la ficha publica.
- **Sigue exigiendo un solo candidato** (`!dosCandidatos`). Cualquier ficha con descuento tiene
  `model_price != list_price` y cae sola del lado seguro — por eso los 16 congelados con precio
  descontado no necesitan ninguna premisa sobre el catalogo.

Las defensas del 2026-09-12 quedan intactas: con dos candidatos distintos el bloque ilegible sigue
impidiendo adoptar el tachado, y un monto marcado "Precio original" sigue sin adoptarse aunque sea el
unico candidato.

## El efecto, por el pipeline real (`src/run.mjs` entero, sin red, sin webhook)

Copia fuera del arbol con las dos puertas al exterior sustituidas (un doble de `procesarEntrada` que
sirve las 4 fichas medidas y llama al `extractSingleProduct` REAL, y un stub de `playwright` que
revienta si alguien intenta abrir una pagina), `CARPETA_DATOS` en carpeta temporal con copia del
catalogo real, `SIN_DESCUBRIMIENTO=1`, sin `DISCORD_WEBHOOK_URL`:

| corrida | `sinPrecioVisible` | `precioCongelado` | avisos | `history.jsonl` |
|---|---|---|---|---|
| HEAD (sin arreglo) | 4 de 4 | 94 | 0 | vacio |
| con el arreglo | **1 de 4** (solo el control) | **91** | 0 | vacio |
| con el arreglo + una baja de verdad inyectada | 1 de 4 | 91 | **1 baja** | 1 linea |
| dos corridas: la ficha estrena oferta y despues se lee a medias — **con la linea refutada** | 1 | — | **1 "sube" FALSO 599.990 -> 839.990** | 1 linea |
| las mismas dos corridas **con el arreglo de hoy** | 2 | — | **0** | vacio |

Las tres fichas de montos iguales salen con su precio (479.990 / 899.990 / 839.990, los mismos que ya
tenian), pierden `corridasSinPrecio` y sellan `versionPrecio: 3`. El control F-UN85MHWB450 sigue
congelado: conserva su $1.099.990, contador 4 -> 5, `versionPrecio` sigue en 2. Ningun campo de
diagnostico sobrevive al catalogo guardado. La tercera fila existe porque las dos primeras dan 0
avisos las dos: sin ella, "0 avisos" no distingue "no hubo cambios" de "el canal estaba muerto".

## Lo que NO esta medido, dicho con todas sus letras

- **Cuantos de los 94 se van a destrabar no se sabe hasta la primera corrida real.** Depende de lo
  que cada pagina declare y publique en esa lectura, no del catalogo. La proyeccion del primer
  informe ("86 se destraban, 0 avisos") era **circular**: alimentaba como `model_price` el numero que
  ya estaba guardado, asi que el 0 estaba garantizado por construccion. Lo unico medido de verdad son
  las 4 fichas cargadas en vivo: 3 se destraban, 1 (el pack) no.
- **Si una ficha destrabada publica un numero DISTINTO del guardado, sale un aviso normal**, medido:
  `versionPrecio` 2 o 3 da lo mismo, porque `corrigeFuenteDePrecio` solo calla cuando el guardado es
  exactamente el `precioTachado` o el `precioInterno` de esa lectura, y en una ficha de montos
  iguales no hay ninguno de los dos. Eso **es** la cobertura que se recupera; tambien es el riesgo, si
  el numero guardado estaba mal. Tasa medida de cambio de precio de este grupo: 15 eventos de precio
  en 54,5 dias sobre 94 SKU = **2,9e-3 por SKU-dia**.
- **El vaiven historico de este grupo es uno solo:** de los 94, ocho tienen algun evento de precio y
  **solo `F-SMR640SML70` vuelve a un valor ya visto** — justo el pack medido el 2026-08-03 con los dos
  montos distintos (555.980 contra 974.980), rebotando entre esos mismos dos numeros. El unico
  congelado que bailo es el unico del que se sabe que tiene dos candidatos.
- **Residual conocido (E10):** si una pagina alterna de verdad entre "no lo vendo online" y "lo vendo
  con oferta", el precio va a alternar con ella (medido: 3 avisos en 4 corridas). No es la carrera de
  render: son dos estados verdaderos distintos, de la misma familia que E5 (estrenar y retirar una
  oferta), y el arreglo del 2026-09-12 los tapaba dejando el precio viejo para siempre.
- **El agujero de la PRIMERA linea de `precioVisiblePreferido` sigue abierto, y es anterior a esto.**
  Con `list_price` invalido ("", null, 0, NaN, ausente) se adopta el `model_price` aunque no este
  escrito en ninguna parte; si ese campo aparece y desaparece entre lecturas, el vaiven entra por ahi:
  medido, **2 avisos falsos por ciclo, identicos en HEAD, con la linea refutada y con el arreglo de
  hoy**. Cerrarlo (pasar esa linea por la misma puerta) baja esos 10 avisos simulados a 0, pero rompe
  4 pruebas que fijan paginas reales sin bloque legible: cambiaria un vaiven hipotetico por un
  congelamiento medido, que es justo el defecto que esta entrada viene a arreglar. Queda como
  pendiente con su medicion en vivo, no como decision de escritorio.

## Verificacion

- **`npm test`: 446 -> 466 verdes, 0 fallas.** Las 446 anteriores pasan sin tocar una linea. Archivo
  nuevo `test/precio-congelado.test.mjs` (20 pruebas) con las cuatro fichas reales y sus numeros
  literales, mas los escenarios E1, E1b, E9, E9c, E7 y E8a de arriba.
- **MUTANTES sobre una copia fuera del arbol (suite entera por mutante, `src/extract.mjs` restaurado
  y verificado por md5 despues de cada uno): 11 de 13 mueren.** Deshacer el arreglo (5 fallas), la
  contramedida insuficiente `bloqueLegible` (3), el arreglo refutado de vuelta en
  `precioVisiblePreferido` (10) y encima del bueno (9), sin la guarda de dos candidatos (3), aflojar
  `!==` a `<` (1) y a `>` (5), sin la guarda de "Precio original" (1), la llave dada por cualquier
  estado que no sea disponible (8), la llave siempre abierta (8), la llave tambien desde la barra o
  desde la API (1 cada una). **Sobreviven 2 y los dos son equivalentes de verdad**: devolver
  `listPrice` en vez de `modelPrice` cuando los dos son el mismo numero, y sacar la guarda
  `!Number.isFinite(precioFinal)` (con un solo candidato, `precioFinal` finito ya es el
  `model_price`). Quedan anotados en vez de inventarles una prueba.
- **Cero requests a samsung.com** (toda la evidencia en vivo venia medida en el encargo; las paginas
  de las pruebas y del pipeline son dobles y el stub de playwright revienta si alguien intenta abrir
  una real) y **jamas el webhook real** (`env -u DISCORD_WEBHOOK_URL` en cada corrida).
- **`data/` del repo intacta** (md5 de los 5 archivos iguales a los del principio) y **no se commiteo
  nada**.

## Pendientes

1. **Mirar `precioCongelado` en la primera corrida real.** Hoy son 94. Cuanto baja no esta proyectado
   a proposito (ver arriba): lo que hay que revisar es si baja *algo*. Si queda en 94, la llave es
   demasiado estrecha y hay que mirar de a una que declara el bloque de esas fichas.
2. **Y mirar `bajas` / `subes` de esa misma corrida.** Cada aviso de un SKU que estaba congelado es un
   numero que llevaba dias sin verificarse: vale la pena abrir la ficha de los primeros y confirmar
   contra la pagina antes de darlos por buenos.
3. **Medir en vivo el agujero de la primera linea** cuando la revision de produccion libere el sitio:
   cuantas fichas reales se leen con el bloque ilegible, y cuantas tienen `list_price` invalido. Con
   eso se decide si esa linea pasa por la misma puerta o se queda como esta.
4. **`data/latest.json` viene de una version anterior a la del alcance declarado**: sus 94 registros
   congelados tienen `corridasSinPrecio` pero no `sinPrecioDesde` (el ancla de reloj se agrego en la
   cuarta tanda del 12-09, que todavia no corrio en produccion). No rompe nada y se corrige solo en la
   primera corrida con el codigo de hoy.
5. Siguen los 7 pendientes de la entrada anterior.
