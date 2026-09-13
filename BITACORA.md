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

---

# 2026-09-13 (tarde) — El ultimo tramo del vaiven: el precio se elegia mirando TODA la pagina

Encargo del operador: cerrar el vaiven que quedo. Desde el arreglo del 2026-09-12
salieron 5 avisos de precio y los 5 son vaiven. Se viene el Cyber y un aviso de
baja tiene que ser una baja.

## Lo medido ANTES de tocar nada (sin red, sobre el repo)

**1. ¿Cuantos SKU estan en la situacion del A36?** Sobre `data/latest.json`
(1.031 registros, 929 vivos) y `src/seed.json`:

```
SKU firmados hoy por una pagina /buy/                          160
  ...cuyo slug NOMBRA al SKU (son su propia ficha)             133
  ...cuyo slug NO lo nombra (la /buy/ es un SELECTOR)           27
de esos 27, por rango:   rango 3 (PROPIA) 11 · rango 2: 2 · rango 1: 14
de esos 27, con ficha plana propia en seed.json                  5
de esos 27, que SOLO existen en la /buy/                        22
```

Los **11 de rango 3** son exactamente los que entran por el camino "una sola
variante = es su ficha propia" (2026-09-11). De esos 11, **solo 2 tienen ficha
plana** (SM-A366ELVGLTL y SM-G990EZAKLTL); los **9 restantes no la tienen** y son
Z Flip3/6/7/7FE, Z Fold3/6, A56, Watch Ultra y S23 FE. Ninguna de las 18 paginas
/buy/ involucradas esta en `seed.json`: las descubre el sitemap.

**2. ¿Cuantos SKU tienen guardado su list_price y no su model_price?** El catalogo
**no guarda** `model_price`/`list_price` (comparar.mjs borra `precioTachado` y
`precioInterno` antes de escribir el registro), asi que la pregunta no se puede
responder directo y se responde por su firma observable: el SKU rebota A->B->A en
<= 24 h (un precio de verdad no vuelve al valor anterior en menos de un dia) y hoy
esta parqueado en el valor alto del par.

```
SKU vivos con firma de carrera de render en todo el historial   43  (37 notificables)
  ...que siguen bailando DESPUES del 2026-09-12 14:00Z            2
SKU vivos parqueados HOY en el valor alto de su par               8
SKU vivos que nunca se releyeron con el codigo nuevo (vP < 3)    71  (36 notificables)
```

Los 8 parqueados en el valor alto, los 8 notificables:
SM-A366ELVGLTL, LS32DG300ELXZS, NP960UJH-XG2CL, NP740VJG-KA2CL, QN48S85HAEXZS,
QN77S85HAEXZS, QN55LS01DAGXZS, F-SML330SMR39. **De los 8, solo los 2 primeros
siguen bailando**; en los otros 6 el par tiene forma de movimiento real de precio
(saltos que no se repiten) y su ultimo rebote es de agosto. La medicion mas amplia
— "vuelve a un valor ya visto" en 54 dias, sin exigir que el rebote sea rapido —
da 151 SKU y 40 parqueados en el alto, pero ahi entran las promociones que van y
vienen: no sirve como firma.

**3. ¿Cuantos siguen bailando despues del arreglo del 2026-09-12 14:00Z?**
Reconstruido de los **22 snapshots de `data/latest.json`** en git (2026-09-10
12:21Z a 2026-09-13 01:52Z) y cruzado con `data/history.jsonl`:

```
ventana de 22 snapshots:  24 SKU cambiaron de precio · 17 volvieron a un valor ya visto
solo los 5 snapshots POSTERIORES al arreglo:  2 SKU cambiaron · 2 volvieron
history.jsonl despues del corte:  5 eventos, 2 SKU
```

**Son 2, no 40**, y son los dos del encargo. El control del metodo reproduce las
cifras de la entrada anterior sobre 30 dias (68 SKU / 365 avisos; declarado
68 / 361-366).

## Las dos fichas, cargadas en vivo el 2026-09-13

UA `CazadorBot/1.0`, **5 s entre cargas** (habia una revision de produccion en
curso, verificado con `gh run list`), **8 paginas en todo el encargo**, cero
requests extra, jamas el webhook real.

| ficha | model_price | list_price | bloque de compra | `precioDelBloqueCompra` |
|---|---|---|---|---|
| `galaxy-a36/buy/` | 369.990 | 539.990 | Buying Tool hubble, **pintado entero esta vez** | 369.990 (el 1º de 8 montos) |
| ficha plana del A36 | 369.990 | 539.990 | `pd-buying-price`: "…o $369.990 **Precio original: $539.990**…" | 369.990 |
| `odyssey-g3-…-ls32dg300elxzs/` | 199.990 | 279.990 | `pd-buying-price`: **"Dónde comprar"**, sin monto | null |
| `galaxy-z-flip7/buy/` | 1.169.990 | 1.269.989 | Buying Tool: montos {1.169.990, 1.299.990} | 1.169.990 |
| `galaxy-a56/buy/` | 529.990 | 529.990 | Buying Tool: montos {529.990, 569.990} | 529.990 |
| `galaxy-watch-ultra/buy/` | 699.990 | 699.990 | Buying Tool sin " o $" | null |

Dos hallazgos que deciden el arreglo:

**(a) El 279.990 del monitor es su precio de LISTA.** Su `model_price` (199.990)
**no esta escrito en ninguna parte** del body; su `list_price` (279.990) si, y su
contexto literal es:

    …torGamerCurvo$1.099.99027"OdysseyG4G40HFHD300HzMonitorGamer$279.990Previous…

> ⚠️ **CORREGIDO EL MISMO DIA (tarde-noche) — aca decia una causa FALSA.** La
> version original de este parrafo concluia de ese contexto que "el 279.990 es el
> precio de OTRO PRODUCTO, el Odyssey G4 del carrusel", y sobre esa causa se
> reescribieron dos aserciones de prueba. **Es falso, y lo desmiente la respuesta
> que la PROPIA pagina le pide a `api.shop.samsung.com`** (capturada del trafico,
> cero requests extra, 2026-09-13):
>
>     LS32DG300ELXZS   price = {"$279.990", priceType "BUY"}   promotionPrice = "$199.990"
>     SM-A366ELVGLTL   price = {"$539.990", priceType "BUY"}   promotionPrice = "$369.990"
>
> O sea: **`model_price` es el precio CON la promocion aplicada (lo que se cobra) y
> `list_price` es el de lista.** El 279.990 SI es un numero propio del G3 — su
> precio de lista — y que ademas aparezca pegado a la tarjeta del G4 es una
> coincidencia. La conducta elegida (adoptar el `model_price`) se sostiene igual,
> pero por esta razon y no por la otra. Dejar escrita una causa falsa es caro aca:
> el proximo que lea "el body esta contaminado por el carrusel" va a construir un
> filtro de carrusel que no arregla nada. Las aserciones numericas no cambian.

Lo que si es cierto, y es lo que justifica acotar la lectura, es que el precio
salia de `document.body.innerText` entero — un texto que incluye el carrusel de
alternativas y, en las /buy/, los montos de todas las variantes del selector.

**(b) El Buying Tool de una /buy/ hubble publica el monto de CADA variante.** El
del A36, pintado, deja 8 montos en el bloque:
`["369.990","429.990","369.990","7.915","94.991","49.990","45.990","40.990"]`.
`precioDelBloqueCompra` tomaba **el primero**, que es el de la opcion que el
selector trae elegida por omision — no el de este SKU. Hoy acierta por suerte. Y
el encargo midio esa misma pagina **cortada** en "Galaxy A36 Desde", sin ningun
monto: ahi la decision caia al body y empezaba la carrera.

## La causa, en una frase

**Cuando el bloque de compra no entrega un monto, la eleccion entre model_price y
list_price la hacia `precioVisiblePreferido` mirando el texto de la PAGINA ENTERA
— y la pagina entera trae los precios del carrusel de alternativas y, en las
/buy/, los de todas las variantes del selector.** Cual alcanza a aparecer cambia
de una carga a otra, y con el cambia el precio guardado.

## El arreglo (3 piezas, todas en `src/extract.mjs`)

**1. `precioAdoptable`: con el bloque mudo y DOS candidatos, el body deja de
arbitrar.** Quedan dos salidas y ninguna es el list_price:

- la pagina **declara** que no la vende online (`estadoDesdeBloqueCompra` ==
  NO_A_LA_VENTA, vocabulario cerrado de `src/stock.mjs`) -> `model_price`. Es una
  propiedad ESTABLE de la ficha: no va a pintar un precio de venta mas tarde, asi
  que no queda carrera que perder. Cierra el monitor -> 199.990.
- cualquier otro caso -> **no hay precio**. Cierra la /buy/ cortada del A36. Las
  defensas medidas el 2026-09-12 (E9/E9b/E9c: un bloque legible sin monto que no
  declara nada es indistinguible de uno que no lo va a escribir nunca) quedan
  intactas, porque esos bloques no producen NO_A_LA_VENTA.

**Esto afloja el `!dosCandidatos` de la concesion del 2026-09-13 (manana), y esa
es una decision con su argumento:** aquella concesion heredaba el resultado de
`precioVisiblePreferido`, que SI depende del render, y por eso exigir un solo
candidato era lo unico seguro. La de hoy no hereda nada: elige un numero FIJO y
jamas el de lista. El control de aquella entrada (el pack F-UN85MHWB450, model
1.099.990 contra list 1.659.980 = la suma de las partes) se destraba en
**1.099.990, que es exactamente el numero que ya tenia guardado**: cero pesos de
diferencia, cero avisos, y a partir de ahora puede enterarse si Samsung se lo
cambia. Era el pendiente nº 1 de esa entrada.

**2. `precioDelBloqueCompra(texto, candidatos)`: un bloque con VARIOS montos es un
selector.** Un monto -> manda, como desde el 2026-09-12 (y vale aunque no coincida
con digitalData: SM-X400NZRDCHO cobra 494.990 mientras digitalData publica 379.990
y 549.989). Varios montos -> solo decide si **exactamente uno** es un candidato de
digitalData. Medido: A36 /buy/ {369.990, 429.990, …} contra {369.990, 539.990} = 1
-> 369.990 (el correcto, y ya no "el primero"); Z Flip7 {1.169.990, 1.299.990}
contra {1.169.990, 1.269.989} = 1 -> igual que hoy; A56 {529.990, 569.990} contra
{529.990} = 1 -> igual que hoy. **Ninguna de las tres pierde su precio.**

**3. `VERSION_PRECIO` 3 -> 4.** Los dos SKU tienen guardado el numero equivocado y
`versionPrecio: 3`, o sea la amnistia anterior ya esta gastada. Sin esta, la
primera corrida manda "bajo 31%" y "bajo 29%" a dias del Cyber por productos que
nunca bajaron. `corrigeFuenteDePrecio` los adopta sin aviso de precio y los saca
por el **canal tecnico**, con los dos numeros.

## Lo que se descarto, con la medicion

**La direccion (b) del encargo — que una /buy/ con bloque selector deje de valer
como ficha propia (rango) — NO se aplico.** Tres razones medidas:

1. **No arregla el monitor**, que es la mitad del problema: su pagina no es una
   /buy/, es su propia ficha plana. (b) a secas deja vivo uno de los dos sintomas.
2. **Le cobra a 9 SKU vivos que no tienen otra pagina.** Bajarlos a rango FAMILIA
   los deja permanentemente como "fuente de menos rango" frente a su propio
   registro guardado (rango 3): `rangoMenor` en `comparar.mjs` impide avisar, y
   cada cambio de precio esperaria `UMBRAL_PRECIO_OTRA_FUENTE` = 3 corridas **mas**
   6 h antes de salir, marcado "leido desde otra pagina". Son Z Flip7, Z Fold6,
   Watch Ultra, S23 FE y compania: atrasar 6 h una baja de esos productos en Cyber
   es justo lo contrario de lo que el operador pidio.
3. **No hace falta para el A36.** Medido en vivo: su ficha plana publica 369.990 en
   su propia barra de precio. Con la pieza 1, la /buy/ muda ya no entrega precio, y
   `conservaPrecio` (`src/catalogo.mjs`, ya existente y ya probado) deja pasar el
   unico precio que se pudo leer entre dos paginas del MISMO rango. Hay una prueba
   nueva que lo fija.

**La direccion (a) a secas tambien se descarto**, por lo que advertia el encargo:
dejaria al A36 congelado en 539.990 (su tachado) y al monitor en 279.990 (el precio
del vecino). El arreglo es (a) **mas** la salida deterministica para la pagina que
declara que no vende online, que es lo que desatasca los dos en el numero correcto.

**"Preferir siempre el model_price cuando el bloque esta mudo"** — la version
general y mas simple — esta refutada por la medicion del 2026-09-12: un bloque
legible que todavia no pinto su monto es indistinguible de uno que no lo va a
pintar nunca, y adoptar ahi daba 3 a 5 avisos falsos (E9, E9b, E9c). Por eso la
llave es lo que la pagina DECLARA, no el estado del bloque.

## Verificacion

- **`npm test`: 466 -> 482 verdes, 0 fallas.** Linea base 466, nunca baja. Archivo
  nuevo `test/vaiven-bloque-de-compra.test.mjs` (16 pruebas).
- **Siete aserciones viejas cambiaron, y las siete fijaban el comportamiento
  equivocado o una pagina que no existe.** Queda escrito en cada archivo:
  - `test/precio-sin-carrera.test.mjs` y `test/vaiven-precio.test.mjs` exigian que
    el monitor guardara **279.990**, con el argumento "lo unico escrito en la
    pagina es el precio de la pagina". La carga en vivo lo refuta: el model_price
    (199.990) no esta escrito en ninguna parte. (El comentario que acompañaba el
    cambio decia ademas que el 279.990 era "de otro producto"; **eso es falso y
    quedo corregido el mismo dia** — ver el recuadro de mas arriba. La asercion
    numerica no cambio.)
  - `test/precio-congelado.test.mjs`: el control del pack pasa de "sigue congelado"
    a "se destraba en su model_price", con el argumento de mas arriba.
  - `test/atribucion.test.mjs`: dos dobles daban un bloque de compra que ninguna
    ficha real publica ("*Aplican condiciones Comprar" a secas) mientras su body
    escribia "o $ 579.990 Precio original: $ 829.990" — y el body ES el bloque mas
    el resto de la pagina. **Es la misma reparacion de fixture que ya se hizo el
    2026-09-12**; quedaban dos sin corregir. Lo que las pruebas afirman no cambio.
  - Los dobles de pagina ahora dejan que cada ficha declare sus **CTA**: el bloque
    del monitor dice "Dónde comprar", no "Comprar", y de ese veredicto depende
    todo. Con "Comprar" para todas, la diferencia era inexpresable.
- **MUTANTES: 24 corridos sobre una copia fuera del arbol, uno por vez, suite
  entera, restaurando y verificando por md5 despues de cada uno. MUEREN LOS 24.**
  - 13 nuevos: sin la regla nueva (10 fallas), adoptar el list_price en vez del
    model_price (9), congelar siempre con dos candidatos (8), gatear en
    `bloqueLegible` en vez de en lo que declara la pagina (5), `!==` por `<` (1) y
    por `>` (12), el bloque selector volviendo a "gana el primer monto" (2),
    rechazar todo bloque con varios montos (3), no exigir unicidad del senalado
    (1), exigir candidato tambien con un solo monto (13), el call site sin pasar
    los candidatos (2), `VERSION_PRECIO` de vuelta en 3 (2), sin deduplicar los
    montos del bloque (2).
  - 11 del banco anterior, para comprobar que no se debilito nada viejo:
    `conservaPrecio` sin la comprobacion de rango, `conservaEstado`, la guarda del
    bloque ILEGIBLE, la guarda de "Precio original", `precio: null` en vez de
    omitir el campo, el tachado condicionado al bloque legible, `versionPrecio`
    sellandose sin lectura util, la espera de pintado, el timeout en la posicion de
    `arg`, `corrigeFuenteDePrecio` sin `precioInterno`, `mismaFuente` ignorando la
    pagina.
  - **DOS SOBREVIVIERON EN LA PRIMERA PASADA, y los dos eran VIEJOS**: la guarda
    del bloque ILEGIBLE y la guarda de "Precio original" del final. La regla nueva
    los habia dejado sin cobertura propia — la primera queda redundante mientras
    `paginaNoLoVendeOnline` no pueda ser cierto con el bloque ilegible, que es un
    acoplamiento entre dos modulos y no una garantia; la segunda solo es alcanzable
    con UN candidato y `precioFinal` finito, que ninguna prueba producia. Se
    agregaron las dos pruebas que faltaban y mueren.
- **Replay de `comparar()` sobre una COPIA del catalogo REAL (1.031 registros):**
  - el sitio sin cambios pero con la version subiendo 3 -> 4: **0 eventos, 0
    correcciones**, 929 registros sellados. El salto de version por si solo no
    emite nada.
  - los dos SKU con sus numeros reales: **0 avisos** y 2 correcciones tecnicas
    (539.990 -> 369.990 y 279.990 -> 199.990).
  - cota alta (los 929 cambiando de precio a la vez con el guardado como tachado):
    **0 avisos al operador**, 929 correcciones tecnicas.
  - control: una baja real del 23% en un SKU cuyo guardado NO es el tachado sale
    igual, en la primera corrida.
- **PIPELINE REAL (`src/run.mjs` entero) contra una COPIA del catalogo real, sin
  red**, con `procesarEntrada`, `discover` y `playwright` sustituidos por dobles
  que sirven los textos MEDIDOS y llaman al `extractSingleProduct` REAL (el stub de
  playwright revienta si alguien intenta abrir una pagina). `CARPETA_DATOS` en
  carpeta temporal, `env -u DISCORD_WEBHOOK_URL`, `VIVO=0`:

  | corrida (mismo material) | bajas | subes | correcciones | A36 | monitor |
  |---|---|---|---|---|---|
  | C1 selector pintado | 0 | 0 | **2** | 369.990 | 199.990 |
  | C2 selector CORTADO | 0 | 0 | 0 | 369.990 | 199.990 |
  | C3 selector pintado | 0 | 0 | 0 | 369.990 | 199.990 |
  | C4 selector CORTADO | 0 | 0 | 0 | 369.990 | 199.990 |
  | C5 CORTADO + baja real a 329.990 | **1** | 0 | 0 | 329.990 | 199.990 |
  | C6 pintado + baja real a 299.990 | **1** | 0 | 0 | 299.990 | 199.990 |

  Catalogo inicial: A36 en 539.990 (su tachado) y monitor en 279.990 (el del
  vecino). `history.jsonl` no se llego a crear hasta C5.

- **EL CONTROL CONTRA HEAD, mismo material, mismos dobles:**

  | | HEAD | con el arreglo |
  |---|---|---|
  | 4 corridas alternando el render | **4 avisos falsos** (baja/sube/baja/sube 539.990 <-> 369.990) | **0** |
  | A36 al final | 539.990 (el TACHADO) | 369.990 |
  | monitor al final | 279.990 (el del vecino) | 199.990 |

  Los 4 eventos de HEAD son la forma exacta de los 5 avisos reales del encargo.
- **Politica de scraping:** UA `CazadorBot/1.0`, **8 paginas en todo el encargo**
  (4 + 2 + 1 de reconocimiento y 1 de la corrida real con `LIMITE_PAGINAS=1
  SIN_DESCUBRIMIENTO=1`), **5 s entre cargas** porque habia una revision de
  produccion en curso, `DELAY_MS` 2500 sin tocar, cero requests extra. **Jamas se
  toco el webhook real** (`env -u DISCORD_WEBHOOK_URL` en cada corrida).
- **`data/` del repo intacta**: los md5 de los 5 archivos son identicos a los del
  principio. **No se commiteo nada.**

## Pendientes

1. **Mirar `precioCongelado` y `correccionesDePrecio` en la primera corrida real.**
   Hoy `precioCongelado` va en 94. La pieza 1 destraba ademas a los congelados con
   dos candidatos que declaran "no lo vendo online" — cuantos son no esta
   proyectado a proposito: depende de lo que cada pagina publique en esa lectura, y
   la proyeccion de escritorio ya salio circular una vez (entrada del 2026-09-13,
   manana). `correccionesDePrecio` tiene que **caer a 0 en pocas corridas**; si se
   queda alto, la migracion esta tapando cambios de verdad.
2. **Abrir la ficha de los primeros SKU corregidos y confirmar el numero contra la
   pagina** antes de darlos por buenos. Son numeros que llevaban dias sin
   verificarse.
3. **El bloque de compra de una /buy/ hubble tambien contamina el STOCK, medido hoy
   y NO arreglado aca.** `galaxy-a36/buy/` devuelve `estadoDesdeBloqueCompra` =
   **"agotado"** porque el selector de colores escribe "Gris increíble **Agotado**
   Grafito increíble **Agotado**" para OTRAS variantes, mientras la ficha plana del
   mismo SKU dice "Comprar" (disponible). Es la misma contaminacion que este
   encargo cerro para el precio, del otro lado. No se toco porque no es lo que se
   pidio y porque `conservaEstado` solo protege cuando la otra lectura es
   "desconocido", asi que arreglarlo toca la maquinaria de stock a dias del Cyber.
   **Merece su propio ticket, con esta medicion.**
4. **El agujero de la primera linea de `precioVisiblePreferido` sigue abierto**
   (pendiente heredado): con `list_price` invalido se adopta el `model_price` aunque
   no este escrito. Ahora es mas chico — si la pagina declara que no vende online o
   si el bloque publica el monto, la decision ya no pasa por ahi — pero no esta
   cerrado.
5. Siguen los pendientes de las entradas anteriores (rotar `history.jsonl` antes de
   los 50 MB, cachear Playwright, medir `duracionPrincipalesMin`, contar las
   livianas descartadas, el hueco de cobertura de `run.mjs`, las 126 /buy/
   duplicadas, y la decision de producto sobre una tercera revision completa).

---

# 2026-09-13 (tarde-noche) — El vaiven del A36 seguia vivo: la carrera era la HIDRATACION de digitalData

Tres verificaciones independientes midieron el arreglo de la tarde. **Dos lo
tumbaron y la tercera lo dejo pasar pero encontro un defecto grave aparte.** Los
tres tenian razon en lo que importa: el vaiven del A36 **no estaba cerrado**, y el
arreglo habia introducido **dos regresiones** propias. Esta entrada cierra los
diez defectos confirmados, cada uno con su prueba y su mutante.

## EL HALLAZGO QUE LO ORDENA TODO (medido en vivo, 2 cargas)

Se cargo `galaxy-a36/buy/` entrando **igual que produccion**
(`waitUntil: "domcontentloaded"`, UA CazadorBot) y se muestreo digitalData **y** el
bloque de compra JUNTOS cada 250 ms. La ventana mala existe y dura ~375 ms:

```
  935 ms   model_price "539990"   list_price ""
           bloque: "…Galaxy A36 Desde $ 44.999 al mes o $ 539.990 … 128GB｜6GB 256GB｜8GB $ 44.999 al mes o $ 539.990"
           body:   solo $44.999 y $539.990
1.310 ms   model_price "369990"   list_price "539990"
           bloque: "…Desde $ 30.832 al mes o $ 369.990 … 128GB｜6GB $ 35.832 al mes o $ 429.990 … 256GB｜8GB … o $ 369.990"
```

**Durante esos 375 ms la pagina publica el precio TACHADO en el campo del precio de
venta, no publica list_price, y el Buying Tool ya esta pintado mostrando ese mismo
numero.** La espera que habia (`model_price > 0`) se cumple ahi, asi que la lectura
de produccion entraba en ese estado y guardaba 539.990. **Ese es el mecanismo del
vaiven del A36**, el SKU de 3 de los 5 avisos falsos del encargo, y **ninguna regla
que mire el bloque lo puede detectar**, porque el bloque dice exactamente lo mismo
que digitalData.

De paso desmiente la fixture con la que se midio el arreglo de la tarde: ahi el
estado malo se modelaba como el tool CORTADO, sin ningun monto. La pagina real, en
ese instante, SI publica un monto — el equivocado. **La cifra titular de aquel
informe ("4 avisos falsos -> 0") estaba medida contra un estado inferido.**

## Los defectos confirmados, y su arreglo

### 1. (grave) La carrera de hidratacion — el vaiven nunca se cerro

Reproducido cabeza a cabeza, mismo material y mismo doble, con el doble modelando
el RELOJ de la pagina (cada espera del codigo adelanta un tic; la pagina se hidrata
al tic 2 o al 3 segun la corrida, y la espera que pide por `list_price` bloquea
hasta la hidratacion). Es justo con las dos versiones: HEAD tambien se hidrata si
la pagina gana la carrera sola.

| 6 corridas, el catalogo arrancando en 539.990 (el tachado real de hoy) | HEAD | con el arreglo |
|---|---|---|
| avisos FALSOS en C1-C4 | **4** (baja/sube/baja/sube 539.990 ↔ 369.990) | **0** |
| una baja REAL en C5 (la pagina asienta tarde) | **se la traga entera** | **se avisa** |
| una baja REAL en C6 (asienta rapido) | se avisa | se avisa |
| precio leido en las 4 primeras | alterna | 369.990 en las 4 |

Los 4 eventos de HEAD son la forma exacta de los 5 avisos reales del encargo. Y el
descubrimiento que el encargo no tenia: **HEAD no solo inventa, ademas se come las
bajas de verdad**, porque vuelve a escribir el tachado encima.

**Arreglo (`esperarDigitalDataAsentado`, src/extract.mjs):** despues de la espera
de `model_price` se espera a que digitalData traiga **los dos** campos. La senal es
`list_price`: los dos se llenan con la misma respuesta de api.shop.samsung.com, asi
que esperar al segundo garantiza que el primero ya no es el provisorio.

- Presupuesto propio, `HIDRATACION_TIMEOUT_MS = 3000`: **~8 veces la ventana medida**.
- **Solo se paga si la primera espera se cumplio.** Hay ~150 paginas que
  legitimamente nunca publican precio (filtros, kits, accesorios) y cobrarles
  ademas este presupuesto serian ~7 min por revision completa sobre paginas que no
  tienen nada que hidratar. Es la leccion del 2026-08-02: una espera nueva se mide
  contra el PEOR caso del catalogo. Medido en vivo: en la ficha del A36, ya
  asentada al llegar, `extractSingleProduct` tarda **311 ms**.
- Si el presupuesto se agota, la lectura queda marcada `digitalDataSinAsentar` y
  **no adopta ningun numero de digitalData**. Lo que sigue mandando es la barra de
  precio de la ficha cuando publica su monto: ese camino nunca dependio de
  digitalData.

### 2. (grave) REGRESION propia: el filtro por candidatos caia del lado malo

Con digitalData rancio y el bloque YA publicando el precio bueno, el filtro por
candidatos del arreglo de la tarde no encontraba coincidencia (ninguno de los 5
montos es 539.990), devolvia `null`, y el precio caia a `precioFinal` — o sea al
`model_price` rancio. **HEAD guardaba 369.990 y el arreglo guardaba 539.990: el
conjunto de estados que producen el numero equivocado era ESTRICTAMENTE MAYOR con
el arreglo que sin el.**

**Arreglo, dos piezas:**
- **el cuarto estado de `precioAdoptable`**: "el bloque publico montos pero ninguno
  es de este SKU" deja de confundirse con "el bloque no publica monto". Un bloque
  que escribe precios y no señala a este producto es un selector hablando de otras
  variantes: la respuesta honesta es que no se sabe, y ya no se cae al texto de
  toda la pagina.
- **con digitalData sin asentar no se le pasan candidatos al bloque**: desambiguar
  un selector contra numeros rancios es peor que no desambiguarlo. Medido: a los
  935 ms el tool publica un unico monto — el tachado — y ese monto SI coincide con
  el model_price provisorio, asi que el filtro lo bendecia.

### 3. (grave) REGRESION propia: "no hay precio" caia en la API, y la API publica el de LISTA

`precioElegido = varios && Number.isFinite(precioApi) && !montoVisible(precioVisto, bodyText) ? precioApi : precioVisto`

`montoVisible(null, body)` es `false`, asi que **el silencio deliberado de
`precioAdoptable` caia directo en `precioApi`**. Y la API publica el precio de
LISTA, medido hoy en las respuestas que las propias paginas piden:

```
SM-A366ELVGLTL   price $539.990 (BUY)   promotionPrice $369.990
LS32DG300ELXZS   price $279.990 (BUY)   promotionPrice $199.990
```

O sea que callarse se convertia en guardar el TACHADO: lo peor de los dos mundos.
Reproducido sobre una ficha fusionada REAL — el S25 FE, cuyo `model_code` trae tres
codigos, verificado en vivo hoy: `SM-S936BDBJLTL,SM-S931BDBJLTL,SM-S731BDBPLTL`:

| 5 lecturas alternando si el bloque publica su monto | HEAD | con el arreglo de la tarde | ahora |
|---|---|---|---|
| precios entregados | 579.990 x5 | **579.990 / 829.990 alternando** | 579.990 / (sin precio) |
| avisos falsos | 0 | **4** (+43% y -30%, dos veces) | **0** |

**Arreglo:** la rama de la API exige ademas `Number.isFinite(precioVisto)`. Su regla
original — "el precio leido no es de este SKU" — necesita que HAYA un precio leido;
"no hubo precio que leer" es otra cosa y no puede compartir el mismo `null`.

### 4. (alta) La fixture que se "reparo" era el hallazgo

En `test/atribucion.test.mjs` se le habia agregado el monto al bloque de dos dobles
(el S25 FE y el pack F-SMR640SML70) con el argumento de que "el body ES el bloque
mas el resto de la pagina, asi que un bloque mudo con el body escrito es un estado
que no existe". **Ese argumento es justo la premisa que este encargo existe para
negar**, y hoy esta medido en vivo que es falso: en la /buy/ del S25 FE, a los
1.640 ms, el body ya trae montos escritos ($556.500, $69.165, $829.990) mientras el
bloque todavia no publica ninguno.

**Arreglo:** las dos fixtures **vuelven a su forma de HEAD** y las aserciones dicen
la verdad de la conducta nueva, en los DOS estados de la pagina:
- bloque pintado -> 579.990 / 974.980, y la API de lista no los puede pisar;
- bloque mudo -> **no hay precio**, y explicitamente `notEqual(829990)`, que es lo
  que protege la guarda del defecto 3;
- y la prueba que faltaba: la MISMA ficha leida 5 veces alternando los dos estados
  tiene que dar **un solo precio o ninguno, nunca dos**, y 0 avisos.

**Regla que queda escrita:** una fixture solo se repara con una medicion en vivo de
ESA pagina en ESE estado, nunca con un argumento sobre como deberia ser.

### 5. (media) La llave "no lo vendo online" se leia de un texto ajeno al SKU

`estadoDesdeBloqueCompra` corre sobre el bloque ENTERO y le basta con que la frase
"no está a la venta" aparezca en cualquier parte. En una /buy/ hubble ese bloque es
el selector de grupo: habla de TODAS las variantes. Medido hoy en `galaxy-a36/buy/`,
el selector escribe "Gris increíble **Agotado** Grafito increíble **Agotado**" de
otros colores. **Darle a ese texto la llave del PRECIO era entregarsela justo al
texto que este arreglo acaba de declarar ajeno.**

**Arreglo:** `leerBloqueCompra` devuelve ahora **de que elemento** salio el texto
(`selector` / `barraDePrecio`), y la llave exige que sea la **barra de precio de
esta ficha** (`pd-buying-price` / `buying-tool__summary`), no el Buying Tool.
De los dos selectores que podrian ser esa barra, **solo cuenta `pd-buying-price`**:
el otro, `buying-tool__summary`, lleva "buying-tool" en el nombre — es el resumen
del MISMO selector de grupo — y ninguna medicion lo respalda como barra de un solo
producto. Ante la duda, el lado seguro es exigir que el monto señale a un candidato.

**Costo medido: de los 94 congelados, 9 vienen de una /buy/** y por lo tanto no se
destraban. Es el lado seguro (estaban congelados de antes) y queda como pendiente
medirlo en produccion. Los otros 85 salen de fichas planas y no se ven afectados.

### 6. (media) Un monto solitario mandaba aunque el bloque fuera un selector

La regla de la tarde era "UN monto manda, VARIOS son un selector", y esa cuenta se
rompe justo cuando importa: un Buying Tool **a medio pintar publica UN SOLO monto**
(medido: el tachado, a los 935 ms), y un render parcial que deje escrita solo la
fila de accesorios hacia adoptar **$49.990 para un celular de $369.990** — una
"baja" del 86% a dias del Cyber.

**Arreglo:** la regla mira el ORIGEN del texto, no la cantidad de montos.
- **barra de precio de la ficha**: un monto solitario manda, aunque no coincida con
  digitalData. Es el caso que la regla del 2026-09-12 vino a cubrir
  (SM-X400NZRDCHO: el bloque cobra $494.990 y digitalData publica 379.990/549.989).
- **selector de grupo**: todo monto, sea uno o sean ocho, tiene que señalar a un
  unico candidato de digitalData.

### 7. (media) El mutante que sobrevivia, y era de la regla nueva

Borrar `if (esPrecioOriginalEscrito(modelPrice, bodyText)) return null;` de dentro
del bloque de dos candidatos dejaba la suite en 482 verdes: ninguna prueba cubria
esa guarda, y **el informe anterior afirmaba "24 mutantes, mueren los 24"**. Se
agrego la prueba que faltaba (con su control sin la etiqueta) y el mutante muere.

### 8. (grave) La amnistia de la migracion se traga una baja REAL, y puede quedar armada dias

`corrigeFuenteDePrecio` calla el aviso de producto cuando el precio guardado es
exactamente el tachado de hoy. Eso distingue bien "el guardado estaba mal" de casi
todo… menos de **una oferta que estrena**, que tiene esa misma forma: al empezar la
promo, el precio de ayer pasa a ser el "Precio original" de hoy. Verificado sobre el
historial real: `EF-ES942COEGWW` 49.990 -> 34.993 con list_price 49.990 hoy;
`EF-DX825UWEGWW` 229.990 -> 160.993 con list_price 229.990.

Eso es aceptable **una vez**, en la corrida de migracion — es el precio que el
proyecto decidio pagar el 2026-09-12 para no mandar 420 avisos falsos. Lo que no es
aceptable es que la ventana quede armada **durante dias**: se cerraba por SKU en la
primera lectura CON precio, y el Buying Tool de una /buy/ no se pinta en cerca de la
mitad de las lecturas, asi que los **22 SKU que solo viven en una /buy/** podian
llegar al Cyber con la amnistia puesta.

**Arreglo:** `HORAS_MAX_MIGRACION_PRECIO = 24`, anclado en `migracionPrecioDesde`.
- El ancla se escribe en la primera observacion con version nueva **que no trae
  precio** — el caso peligroso, porque ahi la version no se sella y la ventana no se
  cierra sola. Cuando la lectura SI trae precio no hace falta ancla: la version se
  sella en esa misma corrida. **Medido sobre una copia del catalogo real: 0 de 929
  registros se llevan el campo en una corrida normal de migracion.**
- No se reinicia en cada corrida (si no, la ventana no se cerraria nunca) y se borra
  en cuanto deja de haber migracion pendiente.
- 24 h le da a cualquier SKU — incluidos los 733 de fuera del bloque liviano — al
  menos dos revisiones completas para cerrarla por las buenas.

**Y una condicion de despliegue, no un pendiente:** hay que desplegar esto y dejar
correr **una revision completa antes del Cyber**, para quemar la ventana a proposito.
Si no, el riesgo se invierte: una oferta real de Cyber saliendo por el canal tecnico.

### 9. (media) El aviso tecnico cortaba en 15 lineas

Es la unica forma que tiene el operador de enterarse de que una oferta real se fue
por el canal tecnico. La mayor ola simultanea que registra `data/history.jsonl` —
**206 bajas en UNA corrida, el 2026-09-09T16:56** — se veia como "…y 191 más".

Subirlo a un numero fijo mas grande no alcanzaba, **y lo cazo la prueba**: con los
modelos reales cada linea mide ~50 caracteres y 40 lineas se pasan del limite de
1900 que aplica `notifyTecnico`, **que ademas corta con `slice`** — o sea que se
perderian el "…y N más" y el pie, y el mensaje mentiria por omision sin decirlo.
Asi que el tope es el **presupuesto**: se llenan tantas lineas como quepan. Medido:
29 lineas con los modelos mas largos (1.879 caracteres), 43 con los cortos.

### 10. (media) La causa escrita en la bitacora era falsa

Ver el recuadro de la entrada anterior. `model_price` es el precio CON promocion y
`list_price` el de lista, medido contra la API que la propia pagina pide, en dos
fichas. El 279.990 SI es un numero del monitor. Corregido en BITACORA.md, en
`src/extract.mjs` y en los tres archivos de prueba que lo repetian. **Las
aserciones numericas no cambian.**

### 11. (media) Adopcion a ciegas, ahora contada

Cuando la pagina declara que no la vende online no hay NINGUN monto dibujado contra
el cual contrastar el numero: se adopta el `model_price` porque es el unico
deterministico que queda, no porque se haya visto. Nada lo delataria si algun dia
viene raro. Ahora el resumen de cada corrida trae **`precioDeclarado`** (cuantas
adopciones a ciegas) y **`digitalDataSinAsentar`** (cuantas paginas no terminaron de
hidratarse dentro del presupuesto). Los dos son diagnostico de la LECTURA y
`comparar()` los borra antes de guardar el registro.

## Las cuentas que faltaban

```
paginas que firman MAS DE UN SKU vivo (fichas fusionadas contables)     6  (14 SKU, rango AGRUPADA)
SKU vivos firmados por una pagina /buy/                                160
  ...cuyo slug NO los nombra (la /buy/ es un SELECTOR)                  27   (rango 3: 11 · 2: 2 · 1: 14)
  ...sin ficha plana en seed.json (sin pagina de respaldo)              22
SKU vivos congelados (corridasSinPrecio > 0)                            94   (los 94 "no-a-la-venta")
  ...cuya pagina es una /buy/ -> la llave nueva NO los destraba          9
SKU vivos que entran a la migracion (versionPrecio < 4)                929
```

**Lo que NO se puede contar offline, dicho con todas sus letras:** el catalogo no
guarda el `model_code` crudo, asi que las fichas fusionadas con un solo propio (la
forma del S25 FE) no se pueden censar desde `data/latest.json`. Que existen esta
verificado en vivo hoy; **cuantas son sigue sin medirse** y queda como pendiente.

## Verificacion

- **`npm test`: 482 -> 506 verdes, 0 fallas.** Linea base 466, nunca baja. Archivo
  nuevo `test/vaiven-hidratacion.test.mjs` (22 pruebas) y 2 pruebas nuevas en
  `test/atribucion.test.mjs`.
- **MUTANTES: 31 corridos, uno por vez, sobre una copia fuera del arbol, suite
  entera, restaurando y verificando por md5 (y respetando CRLF) despues de cada
  uno. MUEREN LOS 31.**
  - 21 nuevos: sin la espera de hidratacion, la espera agotada dandose por asentada,
    la espera agotada sin recordarse, sin la guarda de `digitalDataAsentado`, el
    selector desambiguado con candidatos rancios, sin el cuarto estado, un monto
    solitario mandando siempre, todo bloque contando como barra, ningun bloque
    contando como barra, el resumen del Buying Tool contando como barra, la llave
    desde cualquier bloque, sin la guarda de "Precio
    original", la API pisando el silencio, sin marcar la adopcion a ciegas, el
    diagnostico sobreviviendo al catalogo, la amnistia sin reloj, el ancla sin
    escribirse, el ancla reiniciandose, el ancla sin borrarse, el tope fijo de 15,
    el tope fijo sin presupuesto.
  - 10 del banco anterior, para comprobar que no se debilito nada viejo:
    `conservaPrecio` sin rango, la guarda del bloque ILEGIBLE, la guarda de "Precio
    original" del final, `precio: null` en vez de omitir el campo, `versionPrecio`
    sellandose sin lectura util, la espera de pintado, el timeout en la posicion de
    `arg`, `corrigeFuenteDePrecio` sin `precioInterno`, `mismaFuente` ignorando la
    pagina, el tachado condicionado al bloque legible.
  - **En la primera pasada sobrevivieron 2, los dos nuevos**: la guarda de
    `digitalDataAsentado` (el cuarto estado la tapaba en el caso del selector, pero
    no en el del bloque sin ningun monto) y el ancla reiniciandose en cada corrida.
    Se agregaron las dos pruebas que faltaban y mueren.
- **Replay de `comparar()` sobre una COPIA del catalogo REAL (1.031 registros):**

  | escenario | avisos | correcciones |
  |---|---|---|
  | el sitio sin cambios, version 3 -> 4 | **0** | **0** |
  | los dos SKU del encargo con sus numeros reales | **0** | 2 (539.990->369.990 y 279.990->199.990) |
  | cota alta: los 929 cambiando con el guardado como tachado | **0** | 929 |
  | control: baja real del 23% cuyo guardado NO es el tachado | **1 baja** | 0 |
  | el SKU se lee SIN precio: la ventana queda armada y anclada | 0 | 0 |
  | 25 h despues llega el precio: **vuelve a ser un aviso** | **1 baja** | 0 |
  | control, 1 h despues: sigue siendo correccion tecnica | 0 | 1 |

  Y 0 de 929 registros con diagnostico de lectura filtrado al catalogo.
- **EL CODIGO REAL CONTRA LAS PAGINAS REALES, extremo a extremo** (extract ->
  integrarVariantes -> comparar, partiendo del registro REAL de `data/latest.json`,
  sin webhook):

  | ficha | guardado hoy | leido ahora | avisos | canal tecnico |
  |---|---|---|---|---|
  | `galaxy-a36/buy/` | 539.990 (el TACHADO) | **369.990** en 311 ms | **0** | 1 correccion |
  | `odyssey-g3-…ls32dg300elxzs/` | 279.990 (el de LISTA) | **199.990** en 1.912 ms | **0** | 1 correccion |

  El monitor sale ademas con `precioDeclarado: true` — la adopcion a ciegas contada
  por primera vez sobre una pagina de verdad.
- **Pipeline real (`src/run.mjs` entero)** contra una COPIA del catalogo real en
  carpeta temporal, `LIMITE_PAGINAS`, `SIN_DESCUBRIMIENTO=1`, `VIVO=0`,
  `env -u DISCORD_WEBHOOK_URL`: 0 errores, 0 eventos, 0 correcciones, el resumen
  trae los dos campos nuevos (`precioDeclarado: 0`, `digitalDataSinAsentar: 0`) y el
  catalogo de la carpeta temporal queda intacto.
- **Politica de scraping:** **8 paginas de samsung.com en todo el encargo** (3 de
  muestreo — A36 /buy/, monitor y S25 FE /buy/ —, 3 de pipeline y 2 de la
  verificacion extremo a extremo), UA `CazadorBot/1.0`, `DELAY_MS` 2500 sin tocar,
  **cero requests extra** (las respuestas de la API se leyeron del trafico que la
  propia pagina genera). Habia una revision de produccion en curso, verificado con
  `gh run list`. **Jamas se toco el webhook real.**
- **`data/` del repo intacta**: los md5 de los 5 archivos son identicos a los del
  principio. **No se commiteo nada.**

## Pendientes

1. **CONDICION DE DESPLIEGUE, no observacion posterior: desplegar y dejar correr
   UNA revision completa antes del Cyber**, y confirmar que `correccionesDePrecio`
   vuelve a 0. Es lo que quema la ventana de amnistia a proposito.
2. **Mirar los tres contadores en la primera corrida real.** `precioCongelado` va en
   94 (bajaria a lo sumo a 9, que son los que vienen de una /buy/).
   `digitalDataSinAsentar` **tiene que quedar cerca de 0**: si es alto, hay paginas
   reales que no publican `list_price` y el presupuesto de 3 s quedo corto —
   entonces hay que subirlo o volver a mirar la regla. `precioDeclarado` dice
   cuantos precios se adoptaron sin ningun monto dibujado contra el cual
   contrastarlos.
3. **Abrir la ficha de los primeros SKU corregidos** y confirmar el numero contra la
   pagina antes de darlos por buenos.
4. **CUANTAS FICHAS FUSIONADAS HAY, sigue sin medirse.** Las contables desde el
   catalogo son 6 paginas / 14 SKU; la forma del S25 FE (varios `model_code` y un
   solo propio) no se puede censar offline y esta verificada en vivo. Hace falta
   contarlas en una corrida real, registrando cuando `codigos.length > 1`.
5. **EL PRECIO DE LA API ES EL DE LISTA, y hay una rama que lo adopta.** Medido hoy
   en dos paginas: `price` = precio de lista y `promotionPrice` = lo que se cobra.
   `productosDesdeApi` toma `price.value`, asi que **las paginas de grupo
   (`propios.length > 1`, 14 SKU vivos con rango AGRUPADA) pueden estar guardando el
   precio de lista por construccion.** No se toco: cambiarlo mueve el precio de esos
   SKU a dias del Cyber y merece su propio ticket, con esta medicion y una
   verificacion en vivo de cada uno.
6. **El bloque de compra de una /buy/ hubble contamina el STOCK** (pendiente
   heredado, y hoy REFORZADO). Medido de nuevo en la verificacion extremo a extremo:
   `galaxy-a36/buy/` devuelve `estadoStock: "agotado"` porque el selector escribe
   "Gris increíble Agotado…" de otros colores, mientras la ficha plana del mismo SKU
   dice "Comprar". El arreglo de hoy **saco a ese texto del camino del PRECIO pero
   no del camino del STOCK**, a proposito: `conservaEstado` solo protege cuando la
   otra lectura es "desconocido", asi que tocarlo mueve la maquinaria de stock a
   dias del Cyber. **Ahora se ve mas que antes, porque el precio ya no falla.**
   Merece su propio ticket, con la misma medicion que el precio.
7. **Los 22 SKU que solo viven en una /buy/ pagan hasta una corrida de atraso** cuando
   su Buying Tool no señala a ningun candidato: esa corrida quedan sin precio y
   `comparar()` conserva el ultimo bueno. Es el precio correcto por no inventar, pero
   conviene medirlo: bastaria una carga de cada uno mirando si su tool señala
   exactamente un candidato. No entro en el tope de 8 paginas de este encargo.
8. **El agujero de la primera linea de `precioVisiblePreferido`** (pendiente
   heredado) **quedo mucho mas chico**: con `list_price` invalido ya no se adopta el
   `model_price`, porque esa situacion es ahora, por definicion, "digitalData sin
   asentar" y no produce precio. Lo que queda por medir es cuantas paginas reales
   tienen un `list_price` genuinamente ausente — hoy no se conoce ninguna: las 6
   fichas cargadas en vivo publican los dos campos una vez asentadas.
9. Siguen los pendientes de las entradas anteriores: rotar `history.jsonl` antes de
   los 50 MB, cachear Playwright, medir `duracionPrincipalesMin`, contar las livianas
   descartadas, el hueco de cobertura de `run.mjs`, las 126 /buy/ duplicadas, y la
   decision de producto sobre una tercera revision completa.

---

# 2026-09-13 (noche) — El parpadeo de STOCK: el configurador, y el freno general

Encargo del operador, textual: *"Ultimamente me han llegado varias notificaciones
constantes. Por ejemplo, el Galaxy A36 256GB: dices que estaba antes a 539.990 y
ahora 369.990. Despues vuelve a 539.990, y despues baja a 369.990. (...) Verifica
que si ya me notificaste este cambio una vez, no es necesario volver a notificarlo
las veces siguientes; o si efectivamente Samsung esta cambiando el precio, ya,
esta bien que me notifiques, pero quizas puede ser un error. (...) Un caso similar
es el Galaxy Z Flip6, que a veces aparece agotado, despues no esta a la venta,
agotado, no esta a la venta, y asi sucesivamente."*

El vaiven de PRECIO del A36 ya tenia arreglo shippeado (4e09dab, la entrada
anterior). Esta entrada cierra las otras dos mitades: el parpadeo de STOCK, que
era un caso nuevo, y el FRENO general que el operador pidio para cuando vuelva a
pasar por otra causa.

## 1. LO MEDIDO EN VIVO: por que el bloque de un configurador da dos veredictos

Se cargaron `galaxy-a36/buy/` y `galaxy-z-flip7-fe/buy/` **entrando igual que
produccion** (`waitUntil: "domcontentloaded"`, UA CazadorBot) y se muestreo cada
250 ms el bloque de compra, la barra de precio pegajosa, digitalData y las
respuestas que la propia pagina le pide a `api.shop.samsung.com` (cero requests
extra). Dos cargas de cada pagina, 4 en total, espaciadas 5 s porque habia una
corrida de produccion en curso (verificado con `gh run list`).

**El A36 (SKU propio SM-A366ELVGLTL = Violeta increible, 256GB):**

```
1.191 ms  bloque="Buying Tool … 128GB｜6GB 256GB｜8GB $ 30.832 al mes o $ 369.990"
          -> veredicto del bloque: desconocido   (la grilla de colores NO se pinto)
1.450 ms  bloque="… Color … Verde lima increíble Violeta increíble
                  Gris increíble Agotado  Grafito increíble Agotado"
          -> veredicto del bloque: AGOTADO
API por codigo (8 respuestas, las que la pagina pide sola):
          SM-A366ELVGLTL = inStock      <- el SKU que se guarda
          los otros 7 colores          = outOfStock
```

**El "Agotado" que el monitor estaba guardando es el de OTROS COLORES.** El SKU
vigilado es el Violeta y la grilla no lo marca. 19 de 20 muestras dan "agotado"
por ese texto; la de los 1.191 ms da "desconocido", cae a la API y da
**disponible**. Esa moneda al aire es, exactamente, el
`disponible>agotado>disponible>agotado` de `history.jsonl`.

**El Z Flip7 FE (SM-F761BZKJCHO):**

```
  948 ms  botones de la barra pegajosa: ["Galaxy Z Flip7 FE" x5]  -> desconocido
1.480 ms  botones de la barra pegajosa: [... "No está a la venta" ...] -> NO A LA VENTA
API por codigo: los 4 codigos outOfStock
digitalData termina de asentarse a los 948 ms
```

19 de 20 muestras dan "no-a-la-venta" y 1 da "agotado" (por la API). Es el otro
vaiven del encargo. **Y el instante en que produccion lee cae JUSTO en el borde**:
la lectura arranca cuando digitalData se asienta (948 ms) y la barra recien
publica su CTA a los 1.480 ms.

**La causa, en una frase:** en una /buy/ de configurador el veredicto de stock no
lo decide el producto, lo decide **cuanto alcanzo a pintarse la pagina en el
instante de la lectura** — y las dos fuentes que se turnan responden preguntas
distintas (el selector habla de todas las variantes; la API, de este SKU).

## 2. EL ARREGLO A: en un configurador el stock sale de la API por codigo

`src/extract.mjs`, `selectorDeGrupo = !bloque.barraDePrecio && !slugNombraSku(url, propio)`.
Cuando la pagina es un configurador, el texto del bloque **y** la barra pegajosa
dejan de decidir el stock y manda la API por SKU; si la API no responde, el estado
queda "desconocido", que no cambia nada ni avisa nada.

Es la MISMA regla que el proyecto ya aplica a las paginas con varios SKU propios
("el bloque de compra es un selector de grupo que NO se puede atribuir a ningun
SKU"): estas se le escapaban solo porque su `digitalData.model_code` declara UN
codigo. Y es la continuacion exacta del arreglo del 2026-09-13 (tarde), que le
quito a ese mismo texto la llave del PRECIO y dejo anotado como pendiente nº 6 que
faltaba hacer lo mismo con el stock.

**A cuantos SKU toca, censado sobre `data/latest.json` (929 vivos):**

```
SKU vivos firmados por una /buy/ cuyo slug NO los nombra          27
  ...rango AGRUPADA (su pagina declara varios propios): YA usaban la API   14
  ...rango FAMILIA (entran por el JSON-LD, sin navegador)                   2
  ...rango PROPIA: LOS QUE ESTE ARREGLO CAMBIA                             11
De esos 11, sin ninguna otra pagina en el catalogo                          9
  (Z Flip7, Z Flip7 FE, Z Flip6, Z Flip3, Z Fold6, Z Fold3, Watch Ultra,
   S23 FE, A56)
```

**NINGUNO se queda sin fuente de stock:** los 9 sin otra pagina la tienen en la
API, y en las dos paginas cargadas en vivo la API respondio por los 12 codigos.
Para medirlo en produccion y no de escritorio, el resumen de cada corrida trae
ahora `stockDeSelector` (cuantas lecturas fueron de un configurador) y
`stockSinFuente` (cuantas de esas quedaron en "desconocido"). **El segundo tiene
que ser 0 o casi.**

**LO QUE CUESTA, DICHO CON NUMEROS:** los 3 de los 11 que hoy dicen
"no-a-la-venta" van a pasar a decir "agotado". Las dos cosas significan "no se
puede comprar" y el rebote entre ellas es justo el ruido que el operador pidio
sacar. Si alguna vez hay que recuperar ese matiz, la via MEDIDA es esperar a que
la barra pegajosa termine de pintarse (su CTA aparece a los ~1,5 s, medio segundo
despues de que digitalData se asienta), con presupuesto propio y solo en esas 27
paginas: ~40 s por revision completa.

**NO se subio `VERSION_STOCK` y no es un olvido.** El arreglo cambia la lectura de
11 SKU de 929, o sea que el tope de avisos es 11: no es "una tanda". Subir la
version dispararia la adopcion silenciosa sobre TODO el catalogo y, como esa regla
re-establece en silencio lo que este guardado como "disponible", se tragaria los
"se agoto" reales de los ~500 SKU disponibles de la primera corrida. El precio de
no migrar es a lo sumo 11 avisos; el de migrar, perder avisos reales del catalogo
entero.

## 3. EL ARREGLO B: el freno anti-parpadeo (`src/estabilidad.mjs`, nuevo)

> **ATENCION, 2026-09-13 (segunda vuelta): TODO ESTE APARTADO 3 QUEDO SUPERADO.**
> El mecanismo que describe -- marcar el producto "inestable" y CALLAR sus avisos
> hasta que se asiente 24 h -- se reemplazo entero, y tres de sus cifras estaban
> mal: "legitimos perdidos: 0" era circular con su propia ventana (callaba **61
> bajas de precio reales**, 49 de ellas del 20% o mas), "atraso maximo 24 h" era
> el piso por construccion y no una medicion, y los 23 + 8 "avisos al asentar"
> eran ruido FABRICADO por el propio freno. Lo que rige es la entrada del final
> de este archivo: **un rebote no se calla, se degrada** a una linea compacta de
> la seccion "Siguen rebotando", en la misma corrida y con el valor de hoy.
> Las cifras de las dos tablas de mas abajo se conservan como registro de lo que
> se midio entonces, no como descripcion del sistema actual.

Una red de seguridad GENERAL, independiente de la causa: **un producto que vuelve
a un valor que ya tuvo hace poco esta INESTABLE, y lo inestable no se avisa hasta
que se asiente.** Aplica a precio y a stock.

Las cuatro constantes salen de medir `data/history.jsonl` (30 dias: 769 avisos de
precio sobre 422 SKU y 60 de stock sobre 33 SKU), no de intuicion:

| constante | valor | por que, medido |
|---|---|---|
| `VENTANA_REBOTE_HORAS` | 24 | cuantos de los retornos a un valor ya tenido son LEGITIMOS (el valor dura >= 24 h despues): 6 h→20, 12 h→38, **24 h→41**, 48 h→41, 72 h→41. La curva se aplana en 24 h: de ahi en adelante solo se suman rebotes puros. 48 h captura 23 rebotes mas con el mismo costo, pero deja mas SKU frenados a la vez (31 vs 29) y la medicion es de ANTES del Cyber. |
| `REBOTES_PARA_FRENAR` | 1 | el primer aviso sale (todavia no hay evidencia de parpadeo) y el segundo — el que vuelve — se calla. Es literal lo que pidio el operador. Con 2 recibiria dos avisos antes del silencio. |
| `VALORES_RECORDADOS` | 2 | subir a 3 o a 5 no cambia NI UN aviso en los 30 dias (769 y 60, resultado identico). El parpadeo real es entre DOS valores. |
| `HORAS_ASENTADO` | 24 | la mayor separacion DENTRO de un episodio de parpadeo es 11,8 h y el p75 de las separaciones de los SKU inestables es 17,3 h. 24 h es el doble del peor caso medido. |

**Las dos reglas que impiden que el freno se vuelva silencio permanente:**

1. **Un valor NUEVO siempre se avisa**, este frenado o no: el freno solo calla
   RETORNOS. Una baja de Cyber es un numero que no esta en la memoria. Medido:
   frenar TODO mientras dura la inestabilidad da el MISMO total emitido (672 y
   672), o sea que esta garantia sale gratis.
2. **Al asentarse se dice el cambio NETO.** El modulo recuerda cual fue el ultimo
   valor que el operador escucho; cuando el producto lleva 24 h quieto, el freno
   se suelta y, si lo que quedo es distinto de lo que el operador cree, sale UN
   aviso. Si quedo donde el creia, no sale nada.

**Rastro, como pidio el operador:** un aviso por el canal TECNICO
(`mensajeInestables` en `src/discord.mjs`), una sola vez por producto y por
episodio, que dice ademas como se vuelve a hablar; y tres campos nuevos en
`data/ejecuciones.jsonl`: `avisosFrenados`, `productosInestables` (cuantos tienen
el freno puesto AHORA) y `productosMarcadosInestables`.

**El aviso frenado SIGUE yendo a `data/history.jsonl`**, marcado `frenado: true`.
Solo no llega a Discord. Sin ese rastro, la proxima medicion del parpadeo — que es
como se encontro cada una de las causas de este proyecto — quedaria ciega justo en
los eventos que interesan.

### Lo que la regla habria hecho con los ultimos 30 dias

| | avisos reales | con el freno | frenados | de esos: rebotes puros / anunciaban un valor que despues duro >= 24 h | **legitimos perdidos** | avisos al asentar |
|---|---|---|---|---|---|---|
| precio | 769 | **672** (−13%) | 120 | 79 / 41 | **0** | 23 |
| stock | 60 | **49** (−18%) | 19 | 8 / 11 | **0** | 8 |

**Ninguna baja real se pierde.** Los avisos frenados que anunciaban un valor que
despues se sostuvo salen igual al asentarse; el atraso maximo medido es de 24 h y
**solo puede tocarle a un retorno a un valor ya conocido**.

**Las tres olas de bajas mas grandes del historial, y que habria hecho el freno:**

```
2026-09-09T16:56 — 237 avisos de precio en una corrida:  0 frenados
2026-08-27T14:56 —  57 avisos:                            2 frenados
2026-08-20T22:41 —  41 avisos:                            0 frenados
```

Los 2 de la ola del 27-08 son el par de TV OLED S85H, que habian bajado
$849.990→$829.990 y $1.799.990→$1.599.990 **22 h antes** y volvieron a su precio:
la forma exacta de un rebote. Los dos salieron igual 24 h despues, al asentarse.

### La prueba que mas importa: la secuencia REAL de los tres SKU

Reconstruida de los **21 commits de `data/latest.json`** entre el 2026-09-11T19:35Z
y el 2026-09-13T14:46Z (`estadoStock`, `stockPendiente` y `precio` guardados en
cada corrida dicen que observo cada corrida) y procesada con **`comparar()` real**,
corrida por corrida, con las marcas de tiempo reales. Arranca en el snapshot del
12-09T08:21Z, que es donde empieza el ruido: antes de esa corrida los tres pasaron
de "disponible" a su estado real EN SILENCIO, por la adopcion de la migracion de
`versionStock` (`history.jsonl` lo confirma: el primer evento del Z Flip7 FE es
no-a-la-venta>agotado, no disponible>agotado).

| producto | avisos que recibio el operador | con el freno |
|---|---|---|
| Galaxy A36 — precio | 6 (sube/baja/sube/baja/sube/baja) | **1** |
| Galaxy A36 — stock | 3 | **1** |
| Galaxy Z Flip7 FE — stock | 4 | **1** |
| Galaxy Z Flip6 — stock (cambio UNA vez de verdad) | 1 | **1** |

## Verificacion

- **`npm test`: 506 → 536 verdes, 0 fallas.** Linea base 506, nunca baja. Dos
  archivos nuevos: `test/stock-configurador.test.mjs` (11) y
  `test/freno-parpadeo.test.mjs` (19).
- **MUTANTES: 33 corridos, uno por vez, sobre una copia fuera del arbol, suite
  entera, restaurando despues. MUEREN LOS 33.** *(Corregido el 2026-09-13,
  segunda vuelta: esa frase sugeria cobertura completa y no lo era. Una
  verificacion independiente diseno 40 mutantes propios sin mirar esta lista y le
  sobrevivieron 4, uno de ellos en `repartirCierre`, el camino por donde sale la
  mayoria de los avisos al cierre de cada corrida. La leccion: 'mueren todos los
  mios' no es una medida de cobertura, es una medida de mi propia imaginacion.) 9 del arreglo A (el arreglo
  borrado, el filtro sin el slug, el filtro sin mirar de que elemento salio el
  texto, el bloque volviendo a decidir, la barra volviendo a decidir, los dos
  diagnosticos, el diagnostico filtrandose al catalogo, y "sin fuente se inventa
  disponible") y 24 del freno.
  **En la primera pasada sobrevivieron 5**, y los cinco valen contarlos:
  - *el camino EN VIVO no aplica el freno*: el filtro estaba escrito a mano en el
    despachador y duplicado en el cierre, asi que se podia arreglar uno y no el
    otro — y el aviso frenado habria salido igual, en vivo, minutos antes. Ahora
    los dos caminos llaman a `esNotificable()` y hay una prueba que encola en vivo
    un rebote y exige 0.
  - *el freno reordena los avisos*: la prueba de orden usaba solo tipos que el
    freno no toca, asi que el mutante no la movia. Ahora hay un caso con
    recuperado + baja frenada + stock.
  - *el freno tambien se traga "nuevo" y "recuperado"*: un `recuperado` lleva el
    campo `precio`, asi que si la magnitud precio incluyera ese tipo, un producto
    frenado se quedaria sin el aviso de que volvio. Prueba agregada.
  - *`avisado` no arranca en el valor anterior*: era inexpresable con el material
    que habia; se agrego una prueba directa sobre `evaluarEstabilidad` con una
    memoria sin ese campo, que es el caso en que el freno se asienta y no dice
    nada.
  - *el aviso tecnico de inestable se repite cada corrida*: aca el mutante tenia
    razon y **el codigo sobraba**. La huella `avisadoInestable` en el registro era
    redundante (`inestablesNuevos` solo trae la TRANSICION a frenado). Se borro el
    campo en vez de escribirle una prueba: un campo menos en cada registro.
- **EL CODIGO REAL CONTRA LAS PAGINAS REALES, extremo a extremo** (resolver →
  extract → integrarVariantes → comparar, partiendo del registro que hoy tiene
  `data/latest.json`, sin webhook):

  | ficha | guardado hoy | leido ahora | avisos | canal tecnico |
  |---|---|---|---|---|
  | `galaxy-a36/buy/` | agotado / $539.990 | **disponible / $369.990** | 1 stock ("volvio el stock", legitimo) | 1 correccion de precio |
  | `galaxy-z-flip7-fe/buy/` | no-a-la-venta / $999.990 | **agotado / $999.990** | 0 (queda en `stockPendiente`: necesita 2 corridas) | 0 |

  Los dos salieron con `stockDeSelector: true`, `stockSinFuente: false` y
  `digitalDataSinAsentar: false`, y ningun campo de diagnostico sobrevivio al
  catalogo.
- **Pipeline real (`src/run.mjs` entero)** contra una COPIA del catalogo real en
  carpeta temporal (`CARPETA_DATOS`, `LIMITE_PAGINAS=2`, `SIN_DESCUBRIMIENTO=1`,
  `VIVO=0`, `env -u DISCORD_WEBHOOK_URL`): 0 errores, **0 eventos**,
  `history.jsonl` ni se creo, y el resumen trae los cinco campos nuevos
  (`stockDeSelector: 0`, `stockSinFuente: 0`, `avisosFrenados: 0`,
  `productosInestables: 0`, `productosMarcadosInestables: 0`).
- **Politica de scraping: 8 paginas de samsung.com en todo el encargo** (4 de
  muestreo — dos cargas de cada configurador —, 2 de la verificacion extremo a
  extremo y 2 del pipeline), UA `CazadorBot/1.0`, `DELAY_MS` 2500 sin tocar,
  espaciado de 5 s en las mediciones porque habia una corrida de produccion en
  curso (verificado con `gh run list`), **cero requests extra** (las respuestas de
  la API se leyeron del trafico que la propia pagina genera). **Jamas se toco el
  webhook real.**
- **`data/` del repo intacta**: los md5 de los 5 archivos son identicos a los del
  principio y `git status --porcelain data/` esta vacio. **No se commiteo nada.**

## Pendientes

1. **Mirar `stockSinFuente` en la primera corrida real.** Tiene que ser 0 o casi.
   Si sube, hay configuradores que no piden la API a sus 4-8 codigos y esos SKU se
   quedaron sin ninguna fuente de stock (no se inventa ninguna: quedan congelados
   y en silencio, que es el lado seguro, pero hay que enterarse).
2. **Mirar `productosInestables` la primera semana.** Si crece y no baja, hay un
   parpadeo nuevo que este proyecto todavia no diagnostico — el freno lo va a
   tapar, que es su trabajo, pero tapar no es arreglar.
3. **Los 9 SKU de configurador que no se cargaron en vivo** (Z Flip7, Z Flip6,
   Z Flip3, Z Fold6, Z Fold3, Watch Ultra, S23 FE, A56, S21 FE): de los 11 que
   toca el arreglo, solo 2 se midieron pagina a pagina por el tope de 8 cargas del
   encargo. El tope de avisos que pueden producir es 11 y cada uno seria un estado
   medido por SKU, pero conviene abrir sus fichas la primera semana y confirmar el
   veredicto contra la pantalla.
4. **Si el operador echa de menos el "no esta a la venta"** en esos 11: la via
   medida esta arriba (esperar a que la barra pegajosa se pinte, ~40 s por revision
   completa). Es una decision de producto, no tecnica.
5. **48 h de ventana de rebote** queda como la palanca si el ruido sigue: capturaria
   23 rebotes puros mas en 30 dias con 0 legitimos perdidos, a cambio de 2 SKU mas
   frenados a la vez.
6. **El cableado de `run.mjs` sigue sin cubrir `npm test`** (hueco conocido: el
   archivo arranca `main()` al importarse). Los cinco campos nuevos del resumen y
   el envio del aviso tecnico de inestables quedaron verificados con la corrida
   real del pipeline de arriba.
7. Siguen los pendientes de las entradas anteriores: rotar `history.jsonl` antes de
   los 50 MB, cachear Playwright, medir `duracionPrincipalesMin`, contar las
   livianas descartadas, las 126 /buy/ duplicadas, el precio de LISTA que la API
   entrega a las paginas de grupo, y la decision sobre una tercera revision
   completa.

---

# 2026-09-13 (noche, segunda vuelta) — El freno callaba, y eso era peor: ahora DEGRADA

Tres verificaciones independientes midieron el freno de la entrada anterior.
**Dos lo tumbaron y la tercera, que no lo tumbó, encontró cinco mutantes vivos.**
Las tres tenían razón: el freno tal como estaba **callaba bajas de precio reales**
y podía quedarse callado indefinidamente. Esta entrada reemplaza el mecanismo
entero, corrige tres números publicados que estaban mal, y cierra los 14 defectos
confirmados. Todo lo de abajo está medido sobre los mismos 30 días reales de
`data/history.jsonl` (829 eventos, 206 corridas reales de `ejecuciones.jsonl`).

## LO QUE REPRODUJE ANTES DE TOCAR NADA

Corrí los scripts que dejaron las verificaciones, sin modificarlos:

```
node scratchpad/monitor-replay.mjs   -> 22 avisos del Odyssey G3 en 30 dias,
                                        9 de ellos "[neto tras inestabilidad]"
node scratchpad/audit/replay.mjs     -> 125 frenados; 61 de ellos son BAJAS reales
node scratchpad/audit/cyber.mjs      -> 7 promos diarias reales -> 1 aviso;
                                        7 reposiciones reales  -> 1 aviso;
                                        los dos SIGUEN frenados al dia 7
```

Y medí yo mismo, sobre `replay-frenados.json`, el tamaño de lo que se callaba:
**61 bajas reales frenadas, 49 de ellas del 20% o más**, la mayor −46,9%
(SM-X820NZADCHO, $1.599.990 → $849.990), sobre 27 SKU distintos.

**Por qué el informe anterior decía "legítimos perdidos: 0":** definía *legítimo*
como "el valor duró ≥ 24 h después", definición **circular** con su propia
`VENTANA_REBOTE_HORAS = 24`. Toda promo más corta que un día quedaba declarada
ilegítima antes de contarla. El encargo fijaba el criterio contrario: *"si frena
bajas reales, la regla está mal calibrada"*.

## LA MEDICIÓN QUE ORDENA EL ARREGLO

El parpadeo-bug y la promo real **tienen la misma forma y la misma escala de
tiempo**: el vaivén del A36 sostiene cada valor 2,6 a 9,1 h; la promo real del
monitor Odyssey G3, 3 a 9 h. No hay cómo separarlos mirando la forma, que es lo
único que este módulo puede mirar.

**Entonces la decisión no puede ser QUÉ CALLAR, sino CÓMO CONTARLO.**

> Un rebote ya no produce su propia alerta ("BAJÓ de $279.990 a $199.990"), que
> es lo que el operador pidió no volver a recibir. Produce **una línea compacta**
> en la sección **"Siguen rebotando"** del mismo resumen de la misma corrida, que
> dice entre qué valores va, cuál es el valor de AHORA y cuántas veces lleva.
> **No hay atraso, no hay silencio, y no se puede perder una baja real: el número
> de hoy está ahí.**

## LAS DOS CONSTANTES, RECALIBRADAS CON MEDICIÓN NUEVA

`VENTANA_REBOTE_HORAS = 72` (era 24). Se calibra contra la separación real entre
cambios **dentro** de un episodio de parpadeo (26 pares SKU/magnitud con ≥3
retornos, 227 separaciones):

| ventana | separaciones cubiertas |
|---|---|
| 24 h | 76,2% |
| 36 h | 83,3% |
| 48 h | 85,9% |
| **72 h** | **87,2%** |
| 96 h | 87,7% |
| 168 h | 90,7% |

La curva se aplana en 72 h (96 h agrega 0,5 puntos) y 72 h cubre un fin de semana
entero, que 48 h no. Con 24 h el peor producto recibía 22 alertas fuertes en 30
días; con 72 h recibe 2. **El defecto que esto cierra es el parpadeo LENTO**: 95
de los 221 retornos de 30 días caían fuera de la ventana de 24 h y la versión
anterior no los veía.

`VALORES_RECORDADOS = 6` (era 2). Medido: 2 → 685 alertas fuertes, 4 → 680,
6 → 680, y el peso en disco es **idéntico** con 4 y con 6. No se deja en 2 porque
con 2 valores cualquier ciclo de 3 o más es **estructuralmente invisible**;
SM-X400NZAHCHO ya es ese caso casi real (vuelve siempre a $649.990 con un mínimo
distinto cada vez: 449.990 / 409.990 / 459.990 / 479.990).

**`HORAS_ASENTADO` y `REBOTES_PARA_FRENAR` desaparecen.** La primera era el reloj
del desfreno, que ya no existe porque no existe el freno; la segunda era
estructural (un repetido es un repetido).

## LA MEMORIA, TRES VECES MÁS BARATA QUE LA ANTERIOR

`{ v: [valores, el más reciente primero], hasta, n, ultimo, desde }`: **un solo
instante para todo el conjunto** y los rebotes **contados**, no listados. Medido
contra la forma cara (un instante por valor + la lista entera de rebotes):
resultado **idéntico** sobre los 829 eventos reales — mismos 680 emitidos,
mismos 149 degradados, mismo peor producto — a un tercio del tamaño.

**Peso real:** en el PEOR instante de los 30 días (2026-09-12T14:09) hay 292
memorias vigentes y ocupan **32,0 KB sobre los 917,2 KB de `data/latest.json` =
+3,5%**. La poda por reloj (que se aplica **al leer**, no al escribir) es lo que
lo mantiene ahí, y es lo que hace imposible un rebote inmortal.

## EL EFECTO, SOBRE LOS 30 DÍAS REALES

| | antes | ahora |
|---|---|---|
| líneas de alerta fuerte | 829 | **680** (−18%) |
| avisos perdidos | 61 bajas reales con la versión anterior | **0** |
| cuánto puede el operador estar sin saber el valor de hoy | hasta 100 h seguidas (medido por la verificación) | **0,0 h** |
| instantes con cambios que dejan de producir mensaje fuerte | — | **49 de 125 (39%)** |
| peor producto (LS32DG300ELXZS) | 58 cambios → 22 alertas | **2 alertas** + 56 líneas compactas |
| ola real de 206 bajas del 09-09 | 0 frenadas | **0 degradadas** |

Por tipo: de las 149 degradadas, 73 son subas, 71 bajas y 5 de stock. **Las 71
bajas llegan las 71, con su precio.**

## LOS 14 DEFECTOS CONFIRMADOS, Y CÓMO QUEDÓ CADA UNO

### Los cinco graves

1. **(grave) El freno silenciaba 61 bajas de precio REALES.** Arreglado de raíz:
   `esNotificable()` **ya no excluye** los rebotes. Nada se calla. Medido ahora:
   **0 bajas perdidas**, y las 71 bajas degradadas llegan todas con su precio.
2. **(grave) Bajo un ciclo recurrente el freno no se soltaba nunca.** Ya no hay
   estado "frenado" del que salir: cada cambio se decide solo y sale en su
   corrida. Lo fijan dos pruebas nuevas: 7 días de promo diaria real (7 bajas →
   7 entregas) y 7 de reposición diaria real (7 → 7). Con el código anterior esas
   dos daban 1 y 1.
3. **(grave) El parpadeo LENTO seguía produciendo la seguidilla.** El
   LS32DG300ELXZS pasa de **22 alertas fuertes a 2** en 30 días. Dos cosas lo
   arreglan: la ventana de 72 h y, sobre todo, que **el valor al que se vuelve se
   refresca** — sin eso cada vuelta parecía un episodio nuevo y volvía a sonar.
4. **(grave) El freno FABRICABA la mitad del ruido que venía a apagar.** La rama
   de "asentado" y el aviso `trasInestabilidad` **se borraron enteros**: eran 29
   de los 719 avisos emitidos, 9 de ellos en el propio Odyssey G3, y dos
   quedaban desmentidos por la realidad en menos de 2 h (uno en 45 segundos).
   Ahora el valor de hoy va en la línea compacta, en la misma corrida.
5. **(grave) Las olas con forma de Cyber eran las más frenadas.** Volví a medir
   **todas** las olas, no las tres mayores. Con el código nuevo ninguna se
   pierde: la de 206 bajas del 09-09 sale entera como alerta fuerte, y la de 13
   tablets del 12-09T05:19 (77% frenada antes) sale entera. Hay prueba de
   regresión con esas 13 bajas reales, y su contraparte: una baja que repite un
   precio de hace horas **también llega**, compacta y con el precio de hoy.

### Las medias y las leves

6. **(media) `VALORES_RECORDADOS = 2` hacía invisible cualquier ciclo de 4+.**
   Sube a 6, con la medición de arriba y dos pruebas (ciclo de 3 y ciclo de 6).
7. **(media) El atraso publicado (24,0 h) era la constante, no una medición.**
   Confirmado: era el piso por construcción. **Ya no hay atraso que publicar**:
   el peor caso medido de "cuánto puede el operador estar sin saber el valor de
   hoy" es **0,0 h**, porque la línea compacta sale en la misma corrida. Los
   números viejos se reemplazaron en BITACORA y README.
8. **(media) El aviso técnico tenía UNA sola oportunidad de entrega.**
   `notifyTecnico` ahora devuelve `{ entregado }` y `run.mjs` escribe la huella
   **solo si Discord aceptó**. Además la lista sale del CATÁLOGO
   (`rebotesDe(catalogo, timestamp)`), no de la transición de esa corrida: si el
   envío falla, la corrida siguiente lo vuelve a encontrar y lo reintenta. La
   misma disciplina se aplicó a `avisarUnaVezAlDia`, que también escribía la
   huella pasara lo que pasara — o sea que el defecto alcanzaba a TODOS los
   avisos técnicos, no solo a este.
9. **(media) Ninguna prueba cubría una promo ni una reposición recurrente.**
   Agregadas las dos, con 7 días y `comparar()` real.
10. **(media) `repartirCierre` no estaba fijada por ninguna prueba.** Agregada:
    un rebote pasa, un accesorio no. (El mutante original de la verificación ya
    no aplica, porque `esNotificable` dejó de mirar el freno; el camino igual
    quedó fijado, y hay un mutante propio que lo comprueba.)
11. **(media) Los tres campos del resumen vivían en `run.mjs`, sin cobertura.**
    Salieron a `resumenDeRebotes()` en `comparar.mjs`, pura y probada con valores
    distintos de cero. En `run.mjs` queda **una sola línea** de cableado, y la
    corrida real del pipeline con un rebote sembrado la ejercita.
12. **(leve) El texto del aviso técnico mentía.** Decía "Sale una sola vez por
    producto" y la verificación midió 12 avisos para un solo SKU en 30 días. El
    texto nuevo dice una vez por episodio, que puede repetirse si el vaivén dura
    más de una semana, y dice explícitamente **"No dejo de avisarte nada"**.
13. **(leve) Ninguna prueba ejercía un rebote más lento que la ventana.**
    Agregada, con los 58 cambios reales del Odyssey G3 copiados de
    `history.jsonl`, más una de un retorno pasada la ventana.
14. **(leve) La prueba principal trataba 3 marcas de tiempo `-03:00` como si
    fueran Z.** Corregido con `git log --format=%cI`: los tres commits son
    03:38:29Z, 03:39:09Z y 12:44:39Z, y el orden real cambia dos veces. Verifiqué
    que **ninguna celda de las series observadas se mueve** (los valores de las
    corridas que se intercambian son iguales), así que las aserciones no cambian.
    También se bajó el tono del comentario: la serie de PRECIO es el dato
    guardado tal cual, la de STOCK es una **reconstrucción** de lo observado.

## UN DEFECTO DE LA VERIFICACIÓN QUE NO ERA CIERTO, CON SU MEDICIÓN

La tercera verificación reportó que el censo de SKU de configurador estaba
subestimado: "son **12** de rango PROPIA, no 11". **Son 11.** Censo propio sobre
`data/latest.json` con el `slugNombraSku` real: 1.032 SKU en el catálogo, **929
vivos**, 160 firmados por una `/buy/`, 27 cuyo slug no los nombra, y de esos
14 AGRUPADA + 2 FAMILIA + **11 PROPIA**. Su duodécimo, `SM-F761BZWJCHO`, está
guardado con `presencia: "desaparecido"` — no es un SKU vivo. Por lo mismo
tampoco hay ninguna página de configurador con dos SKU propios **vivos**.

**Pero la otra mitad de ese defecto sí era cierta, y peor de lo que decían:** el
informe anterior decía "9 de esos 11 no tienen ninguna otra página". Buscando
cada SKU contra las 1.032 `paginaOrigen` y `url` del catálogo, **ninguno de los
11** aparece en otra página. **Los 11 dependen de la API por código**, no 9.
Corregido en `src/extract.mjs`, en el README y acá.

## VERIFICACIÓN

- **`npm test`: 506 → 550 verdes, 0 fallas.** La línea base de 506 nunca baja.
  `test/freno-parpadeo.test.mjs` reescrito entero (19 → 35 pruebas) y
  `test/stock-configurador.test.mjs` intacto (11).
- **MUTANTES: 38 corridos, uno por vez, sobre una copia FUERA DEL ÁRBOL
  (src+test+data+workflow+README+BITACORA), suite entera, restaurando desde el
  repo y verificando por md5 después de cada uno. MUEREN 37.**
  - 19 del freno: nunca degradar · degradarlo todo · no recordar el valor que se
    deja atrás · `VALORES_RECORDADOS` 2 y 1 · `VENTANA_REBOTE_HORAS` 24 e
    infinita · la memoria de valores sin podar · el contador de rebotes sin podar
    · el stock "desconocido" entrando · no marcar el rebote · no decir entre qué
    valores · no decir cuántas veces · el aviso técnico repitiéndose cada corrida
    · `esRebote` mirando un campo muerto · la memoria sin guardarse · la memoria
    vacía sin borrarse · reordenar los avisos.
  - 8 de la entrega: `esNotificable` volviendo a CALLAR los rebotes · el rebote
    saliendo en vivo · `repartirCierre` sin filtro · el rebote dibujado como
    alerta fuerte · la sección de rebotes sin mandarse · la línea sin el valor de
    ahora · `mensajeRebotando` mudo · `notifyTecnico` diciendo siempre que
    entregó.
  - 5 del resumen: los tres contadores clavados en cero · `rebotesDe` sin reloj ·
    `rebotesDe` contando a los que nunca rebotaron.
  - 6 del arreglo A del banco anterior, para comprobar que no se debilitó nada.
  - **En la primera pasada sobrevivieron 5.** Cuatro tenían razón y se les
    escribió prueba: el contador de rebotes sin podar (un episodio viejo figuraba
    rebotando para siempre), `rebotesDe` contando a los que solo tienen memoria,
    el aviso técnico repitiéndose en cada corrida, y `valorDe` dejando pasar
    "desconocido" al texto del aviso técnico.
  - **EL QUE SOBREVIVE, y por qué se declara EQUIVALENTE, con medición:** mover
    `recordar(m, nuevo, …)` detrás del `continue`, o sea no refrescar el valor al
    que se vuelve cuando es un rebote. Corrí el replay de los 829 eventos reales
    con las dos variantes y comparé decisión por decisión: **0 diferencias**. La
    razón es que salir de un valor siempre lo vuelve a recordar como `anterior`,
    así que el refresco explícito es redundante en toda secuencia real. Se dejó
    igual (las dos llamadas en un `for` con el comentario que lo explica) porque
    la redundancia es lo que hace obvio el invariante.
- **PIPELINE REAL (`src/run.mjs` entero) contra una COPIA del catálogo real en
  carpeta temporal** (`CARPETA_DATOS`, `LIMITE_PAGINAS=2`, `SIN_DESCUBRIMIENTO=1`,
  `VIVO=0`, `env -u DISCORD_WEBHOOK_URL`), **cuatro corridas**:
  - completo, sin sembrar nada: 0 errores, **0 eventos**, `history.jsonl` ni se
    creó, y el resumen trae los campos nuevos (`avisosDegradados: 0`,
    `productosRebotando: 0`, `productosNuevosRebotando: 0`) junto a los de la
    entrega anterior (`stockDeSelector: 0`, `stockSinFuente: 0`).
  - completo **con un rebote sembrado a propósito** en la copia (precio guardado
    $529.990 y memoria conteniendo el $479.980 que la página publica):
    `avisosDegradados: 1, productosRebotando: 1, productosNuevosRebotando: 1`,
    `INFO freno_parpadeo nuevos=1 degradados=1`, la línea de `history.jsonl`
    queda con `"rebote":true,"valoresRebote":[479980,529990],"vecesRebotado":1`,
    y la huella `rebotando:F-SMA27EBU25W:precio` se escribe. **Es la prueba de
    que los tres contadores no están clavados en cero en el cableado real**, que
    es justo el hueco que `run.mjs` no puede cubrir con `npm test`.
  - liviano, a continuación: 0 errores, `productosRebotando: 1` (la memoria sigue
    vigente) y `productosNuevosRebotando: 0` — **el aviso técnico no se repite**.
- **POLÍTICA DE SCRAPING: 8 páginas de samsung.com en todo el encargo** (4
  corridas de pipeline × 2 páginas), UA `CazadorBot/1.0`, y **`DELAY_MS` subido a
  5.000 SOLO EN LA COPIA** porque había una corrida de producción en curso
  (verificado con `gh run list`: run 34764115924 `in_progress`). Cero requests
  extra; toda la calibración salió de `data/` y del historial de git. **Jamás se
  tocó el webhook real** (todas las corridas con `env -u DISCORD_WEBHOOK_URL`).
- **`data/` del repo INTACTA**: los md5 de los 5 archivos son idénticos a los del
  principio (`history` fd99bda5…, `latest` 35ea663b…) y `git status --porcelain
  data/` está vacío. **No se commiteó nada.**

## PENDIENTES

1. **MIRAR `productosRebotando` LA PRIMERA SEMANA.** Si crece y no baja, apareció
   un parpadeo nuevo sin diagnosticar: la sección compacta lo va a ordenar, que
   es su trabajo, pero ordenar no es arreglar. El número esperado, proyectado
   sobre los 30 días medidos, es del orden de 5 a 25 productos.
2. **MIRAR EL LARGO DE LA SECCIÓN "Siguen rebotando".** Medido sobre el
   historial, el peor instante tendría 26 líneas. Las reparte el mismo
   empaquetador que el resto del resumen (nada se trunca, se abren más mensajes),
   pero si en Cyber se dispara hay que decidir si conviene un tope con "…y N
   más" — que rompería la garantía de que el valor de hoy siempre está.
3. **`stockSinFuente` sigue siendo la condición de observación de la entrega
   anterior**, y no cambió: tiene que ser 0 o casi.
4. **LOS 11 SKU DE CONFIGURADOR: 9 siguen sin cargarse en vivo** (solo el A36 y
   el Z Flip7 FE se midieron página a página). El tope de avisos que pueden
   producir es 11.
5. **LA VENTANA DE 168 h queda como la palanca** si el ruido sigue: bajaría las
   alertas fuertes de 680 a 649 con 0 pérdidas, a cambio de que un valor quede
   "conocido" una semana entera. No se tomó porque 96 h ya solo agrega 0,5 puntos
   de cobertura y la medición es de ANTES del Cyber.
6. **EL CABLEADO DE `run.mjs` SIGUE SIN CUBRIR `npm test`** (hueco conocido: el
   archivo arranca `main()` al importarse). Se redujo todo lo que se pudo —los
   tres contadores son ahora una sola línea `...resumenDeRebotes({…})`— y el
   resto quedó verificado con las corridas reales del pipeline de arriba.
7. Siguen los pendientes anteriores: rotar `history.jsonl` antes de los 50 MB,
   cachear Playwright, medir `duracionPrincipalesMin`, contar las livianas
   descartadas, las 126 `/buy/` duplicadas, el precio de LISTA que la API entrega
   a las páginas de grupo, y la decisión sobre una tercera revisión completa.
