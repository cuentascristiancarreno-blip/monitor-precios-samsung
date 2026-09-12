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
