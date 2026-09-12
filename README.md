# Monitor de precios Samsung Chile

Revisa el precio, stock y catálogo de los productos de samsung.com/cl y avisa por Discord cuando algo cambia (precio nuevo, producto nuevo, producto que desapareció, cambio de stock). Corre solo, en la nube (GitHub Actions), sin necesidad de tener el computador prendido.

## Cómo funciona

- `src/seed.json`: el listado base de ~1023 productos/variantes (viene del Excel que armaste).
- `src/discover.mjs`: antes de cada revisión, además busca automáticamente páginas "familia" (como el Galaxy S25, donde una sola página agrupa todos los colores y capacidades) que no estaban en el listado.
- `src/prioridad.mjs`: **por dónde empieza cada revisión.** Acá está la lista de las categorías principales, en el orden en que las quieres ver (ver la sección "Por dónde empieza cada revisión" más abajo). Es el único lugar donde se edita esa lista.
- `src/run.mjs`: revisa cada página (con un reintento para las que fallan), detecta si la corrida completa es confiable, y delega la comparación.
- `src/catalogo.mjs`: arma el catálogo de la corrida (un producto por SKU) y decide qué categorías no se notifican. La identidad de un producto es **siempre su SKU**: el nombre nunca influye en si algo se considera nuevo, desaparecido o cambiado.
- `src/comparar.mjs`: la lógica que decide qué cambió y qué se notifica (ver reglas abajo). Es un módulo puro con pruebas automatizadas.
- `src/titulo.mjs`: arma el título legible de cada producto agregándole las características que lo distinguen (capacidad, RAM, color, pulgadas), porque el nombre que publica Samsung es igual para todas las variantes ("Galaxy S26 Ultra (Exclusivo en Samsung.com)" son 4 productos distintos). No hace **ninguna consulta extra** al sitio: las características salen de la misma página que ya se carga para leer el precio (Samsung las publica por código de modelo), más el listado y la dirección de la página como respaldo. Ejemplo real: `Galaxy S26 Ultra (Exclusivo en Samsung.com) · 256GB · 12GB RAM · Oro rosa`.
- `src/discord.mjs`: arma y envía los avisos (íconos por categoría, link por producto, antes/después con diferencia en pesos y %). También le pone el ritmo al envío para no chocar con el límite de Discord, y reintenta cuando Discord contesta "más despacio".
- `src/despachador-vivo.mjs`: los **avisos en vivo** — ver la sección siguiente.
- `data/latest.json`: catálogo con el último estado conocido de cada producto (precio, stock confirmado, presencia). El historial git de este archivo es el snapshot completo de cada revisión.
- `data/history.jsonl`: eventos de cambio (una línea por cambio detectado, con campo `tipo`).
- `data/ejecuciones.jsonl`: registro de cada corrida — duración, páginas, errores, conteos por tipo de cambio, si fue confiable, y **cuánto tardó el bloque de categorías principales** (`paginasPrincipales`, `duracionPrincipalesMin`).
- `data/notificados.jsonl`: apunte temporal de lo que ya se avisó en vivo. Se borra solo al terminar cada revisión; solo sirve para que una revisión que se muere a mitad no haga que la siguiente te avise dos veces lo mismo.
- `data/pendientes.jsonl`: avisos que Discord nunca llegó a aceptar (por ejemplo, Discord caído durante toda la revisión). Se mandan al principio del resumen de la revisión siguiente y ahí se borran.
- `data/avisos-tecnicos.jsonl`: qué avisos técnicos ya salieron hoy, para que una condición que dura días (por ejemplo, una categoría que Samsung renombró) no te mande 7 mensajes idénticos por día. Se poda solo a los 7 días.
- `.github/workflows/monitor.yml`: la tarea programada (7 veces al día, hora Chile: 01, 04, 10, 13, 16, 19, 22). Corre las pruebas antes de cada revisión, sube los datos actualizados y dispara los avisos.

## Avisos en vivo (2026-09-11)

Antes había que esperar a que terminara la revisión completa (unas 3 horas) para recibir todo junto. Ahora **cada página que se revisa avisa al toque**: si a las 14:32 baja un precio, el mensaje llega alrededor de las 14:32, no a las 17:00.

- Llegan en vivo: **baja, sube, producto nuevo, cambio de stock y producto recuperado**. Cada aviso dice "aviso en curso" y por qué página va la revisión, para que se note que todavía falta.
- Llegan **al final**, como siempre: los **productos desaparecidos** (recién ahí se sabe que no apareció en ninguna página) y la alerta técnica si la revisión fue sospechosa. Al final llega además un mensaje de cierre con el total de la revisión ("237 cambios · 229 avisados en vivo · 8 en este resumen").
- Las bajas de 15% o más van marcadas con 🔥 y se muestran primero: la idea es reconocer una oportunidad de un vistazo.
- Los **accesorios y el Galaxy Book3 siguen silenciados** también en los avisos en vivo. Un producto que nunca se había visto y que aparece por primera vez en una página "familia" espera al resumen final: ahí recién se sabe si es un accesorio, y así no te llega un cargador en vivo.
- Nada se avisa dos veces y nada se pierde: el resumen final descarta exactamente lo que Discord confirmó haber recibido en vivo, y vuelve a mandar lo que no.
- **Correcciones.** Un aviso en vivo sale con lo que vio *esa* página. Si más adelante, en la misma revisión, otra página publica otro dato para el mismo producto, manda siempre la revisión completa — y el mensaje de cierre te avisa con un ⚠️ que ese aviso no se confirmó y cuál es el precio vigente. Antes ese aviso falso se quedaba sin desmentir y además se repetía en todas las revisiones siguientes.
- **Si Discord se cae**, lo que no se pudo entregar queda anotado en `data/pendientes.jsonl` y se manda al principio del resumen de la revisión siguiente, con su fecha original. Caduca a las 48 horas (un precio de anteayer ya no sirve para ir a comprar).

Se puede ajustar sin tocar código, con variables de entorno (todas tienen un valor por defecto razonable):

| Variable | Por defecto | Para qué |
|---|---|---|
| `VIVO` | encendido | `VIVO=0` apaga los avisos en vivo y vuelve al comportamiento viejo (todo al final). |
| `VIVO_VENTANA_MS` | `15000` | Cuánto se espera juntando cambios antes de mandar la tanda. |
| `VIVO_MAX_CAMBIOS` | `6` | Cuántos cambios entran, como máximo, en una tanda antes de mandarla sin esperar. Con títulos y links largos una tanda de 6 puede salir en dos mensajes: es normal y no se pierde nada. |
| `VIVO_TANDAS_POR_LLAMADA` | `3` | Cuántas tandas se mandan en la pausa entre una página y la siguiente. Evita que una ráfaga grande deje la revisión detenida mientras manda. |
| `VIVO_UMBRAL_FUEGO` | `15` | Desde qué % de descuento se marca 🔥. |
| `VIVO_MIN_PREVIO` | `500` | Si el catálogo anterior tiene menos productos que esto, se apagan los avisos en vivo (pasa si `latest.json` se corrompió: si no, llegarían ~650 avisos de "producto nuevo"). |
| `DISCORD_PAUSA_MS` | `2300` | Ritmo de envío: un mensaje cada 2,3 s como máximo sostenido. |
| `DISCORD_RAFAGA` | `3` | Cuántos mensajes seguidos se permiten de golpe. |
| `DISCORD_MAX_ESPERA_MS` | `70000` | Lo máximo que la revisión se queda esperando a Discord. Si Discord pide más (un bloqueo de minutos u horas), el mensaje se deja para el resumen final en vez de congelar el barrido. |

Medido simulando una revisión completa (1.183 páginas) con los módulos reales:

| Escenario | Mensajes en vivo | Primer aviso | Último aviso | Perdidos | Repetidos |
|---|---|---|---|---|---|
| 1 cambio (la mediana de un día normal) | 1 | 18 s | 18 s | 0 | 0 |
| 237 cambios de golpe (el pico histórico) | 79 | al instante | 3 min 10 s | 0 | 0 |
| 600 cambios de golpe (Cyber pesimista) | 200 | al instante | 7 min 39 s | 0 | 0 |
| 600 cambios repartidos por toda la revisión | 300 | 18 s | — | 0 | 0 |

Nunca se pasa de 3 mensajes en 2 segundos ni de 28 en 60 segundos (los topes de Discord son ~5 y ~30), y ningún mensaje llega al límite de 2.000 caracteres. En el peor caso la revisión se alarga 2 min 42 s sobre 3 horas: los avisos se mandan en la pausa que igual hay que esperar entre página y página.

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

## Stock de verdad y "de quién es este producto" (2026-09-11)

Dos arreglos grandes, en simple. El detalle técnico y las mediciones están en `BITACORA.md`.

**1. El stock estaba mal en casi todo el catálogo.** El monitor daba por "disponible" cualquier producto en cuya página no encontrara las palabras "agotado", "sin stock", "fuera de stock" o "no disponible". Pero Samsung marca el sin-stock con el botón **"Avísame"**, que no estaba en esa lista: 894 de 928 productos figuraban disponibles sin que nadie lo hubiera comprobado. Medido sobre 42 productos, acertaba en 26.

Ahora el stock se lee **del botón que ve el cliente** (el que está junto al precio y las cuotas) y hay **cuatro estados**:

| Estado | Qué significa |
|---|---|
| disponible | el botón dice "Comprar", "Comprar ahora" o "Agregar al carro" |
| agotado | el botón dice "Avísame": se vende, pero no hay unidades |
| no está a la venta | el botón está apagado y dice "No está a la venta", o lo único que ofrece es "Dónde comprar" (el buscador de tiendas físicas de lo que Samsung no vende online) |
| desconocido | no se pudo leer — **no se cambia el estado y no se avisa nada** |

Lo importante: **"desconocido" nunca se convierte en "disponible"**. Antes, cualquier lectura fallida se transformaba en un "disponible" inventado.

Se midió sobre **49 páginas nuevas**, dos por cada categoría que avisa: de las 36 en que se pudo comprobar qué ve el cliente, el monitor acertó en **las 36 (100%)**. La regla vieja habría acertado 17 (47%).

**2. Había productos colgando de la página equivocada.** Cuando Samsung deja de vender una ficha, la **redirige** a la de un producto hermano. El monitor pedía la página A, aterrizaba en la B y anotaba el producto de B como si fuera de A. Por eso la página del Galaxy S25 FE 512GB producía cuatro Galaxy S25 normales a $1.069.990, y por eso un mismo producto aparecía con dos precios distintos según por qué camino se lo hubiera visto.

Ahora cada página se queda **solo con el producto que le corresponde**, y cuando el mismo producto se ve por dos caminos manda **la ficha donde el cliente compra**: medido en el S25 FE, su ficha propia muestra $579.990 con botón "Comprar" mientras la página agrupada dice $829.990.

Las páginas que agrupan varias versiones de una misma familia (Tab S9 FE, Tab A9, Book3, Book3 Pro, Z Fold7) se revisaron una por una y siguen funcionando igual. Y si una ficha empieza a redirigir, sus productos **conservan su último dato conocido**: una redirección nunca se puede convertir en un falso "ya no aparece".

**Por qué no llegó una avalancha de avisos.** Corregir el stock significaba que cientos de productos pasaban de "disponible" a "agotado" de golpe — pero eso no es una novedad de la tienda, es la corrección de un dato que siempre estuvo mal. La primera vez que el monitor lee un producto con el detector nuevo **anota el estado real en silencio, sin avisar**. De ahí en adelante ese producto vuelve a las reglas de siempre (un cambio de stock se avisa solo después de verse igual en 2 revisiones seguidas). Se apaga solo, producto por producto: no hay nada que acordarse de desactivar después.

> ⚠️ **Si alguna vez hay que volver atrás, hay que volver atrás con los datos también.** El arreglo del stock deja el catálogo (`data/latest.json`) escrito con los estados nuevos. Si se deshace solo el código y se dejan los datos nuevos, dos revisiones después llegan **~250 avisos falsos de stock de una sola vez**. La regla es simple: el código y `data/latest.json` van en el **mismo commit**, y se deshacen juntos. Deshacer solo los datos no hace daño; deshacer solo el código, sí.

## Dos correcciones mas, del 2026-09-12

Verificando lo anterior con productos distintos aparecieron dos cosas mas.

**El boton "Comprar" no siempre significa que haya stock.** En la ficha normal de un producto, "Comprar" / "Comprar ahora" no agrega al carro: es un enlace que te lleva a la pagina de compra. El boton que de verdad compra es "Agregar al carro". Se compararon 6 productos con ese enlace contra su propia pagina de compra: en 5 habia stock de verdad, y en 1 (Galaxy Book4 de 1 TB) la pagina de compra decia "Avísame" — o sea que no se podia comprar y el monitor lo daba por disponible.

La diferencia entre los dos casos es el precio: cuando Samsung puede vender, el bloque muestra el precio y las cuotas junto al boton; cuando no puede, deja solo el enlace. Ahora el monitor exige ver el precio para decir "disponible". Si no lo ve, no cambia nada y no avisa — nunca inventa un "hay stock".

**El precio guardado era el tachado en ~4% de los productos.** Medido sobre 46 paginas, 2 guardaban el precio cruzado en vez del que se cobra:

| Producto | Guardaba | Precio real | Diferencia |
|---|---|---|---|
| Galaxy Tab S10 FE | $839.990 | $579.990 | 31% |
| Galaxy Tab S10 Lite | $649.990 | $479.990 | 26% |
| Galaxy Tab S10 Lite (otro color) | $549.989 | $494.990 | 10% |

Pasaba porque Samsung no siempre publica el precio de venta en los datos internos de la pagina, y ahi el monitor terminaba tomando el precio original. Ahora **lee el numero que tu ves junto al boton de compra**, que es el que se cobra.

Como eso corrige del orden de 40 productos de golpe, la primera revision los ajusta **en silencio**, igual que con el stock: si no, llegarian 40 avisos de "bajo 31%" por productos que nunca bajaron. La proteccion es estrecha a proposito — solo calla el aviso cuando el precio guardado es exactamente el tachado que la pagina muestra hoy; una baja de verdad, en ese mismo producto y esa misma revision, se avisa igual.

## El precio que iba y venía entre dos valores (2026-09-12, tarde)

**El problema.** Había productos cuyo precio saltaba de un valor a otro de una revisión a la siguiente, y volvía al anterior unas horas después. Cada salto mandaba un aviso de "subió" o "bajó" que no correspondía a nada: Samsung nunca había cambiado ese precio. Medido en el último mes: **68 productos con ese vaivén y 361 avisos de precio de esos productos — el 46% de todos los avisos de precio del mes**. El peor fue un monitor gamer, con 56 avisos rebotando entre $199.990 y $279.990.

**Por qué pasaba.** La página de Samsung no trae el precio escrito: lo pide aparte y lo dibuja unos instantes después. El monitor esperaba a que el precio existiera *por dentro* de la página, pero no a que estuviera *escrito en pantalla*, y ahí leía. Según cuál de las dos cosas llegara primero, la misma página le entregaba uno de dos números distintos:

| Lo que leía | Qué es ese número |
|---|---|
| $729.990 | el precio **tachado** ("Precio original"), cuando alcanzaba a dibujarse |
| $479.990 | un número **interno** que no aparece por ninguna parte de la página, cuando no |
| $656.990 | lo que el cliente **realmente paga**, que es lo único que había que guardar |

(Son los números reales de un Galaxy Tab S10 FE, medidos cargando su ficha.)

**Qué cambió.**

1. Ahora el monitor **espera a ver el precio escrito en la página** antes de leerla. No se demora más: reparte el mismo tiempo de espera que ya gastaba.
2. Si igual no aparece ningún precio, **el monitor no inventa uno**: deja el precio que ya tenía y no avisa nada. Es la misma regla que ya usa para el stock — más vale callarse que inventar.
3. Si un precio cambia y además **viene de otra página** (un mismo producto puede verse desde su ficha y desde la página de su familia, y cada una publica un número distinto), el aviso espera a que una segunda revisión lo confirme. **Una baja normal, vista en la ficha de siempre, se avisa al instante como hasta ahora**: es el 97% de los casos, así que el Cyber no pierde ni un minuto.

**Por qué no llega una avalancha de avisos.** Hoy hay unos 50 productos con uno de esos números equivocados guardados. La primera revisión con el arreglo los corrige **en silencio**, igual que se hizo con el stock, y solo calla cuando el precio guardado es exactamente uno de los dos números que la propia página publica y que el monitor dejó de usar. Cualquier otro cambio es real y se avisa. Se apaga solo, producto por producto.

**Qué mirar la primera semana.** En `data/ejecuciones.jsonl` aparecen dos números nuevos por revisión: `sinPrecioVisible` (productos cuya página no mostró precio esa vez) y `precioCongelado` (los que llevan al menos una revisión así). Si un producto **a la venta** lleva 20 revisiones sin mostrar precio, llega un aviso técnico, una sola vez. Los productos que Samsung ya no vende no generan ese aviso: hay 426 así, y simplemente no publican precio — eso es normal, no una falla.

## El vaivén, segunda parte: lo que faltaba tapar (2026-09-12, noche)

El arreglo de arriba no alcanzó. Tres revisiones independientes lo probaron pieza por pieza y encontraron que **el vaivén seguía vivo, con los mismos dos números**. Lo que se corrigió:

**1. El monitor mira la página en dos lugares, y solo uno estaba arreglado.** Primero lee el texto de la página; después lee, aparte, el bloque de compra (el recuadro con el precio y el botón). Ese segundo vistazo es el que manda — y cuando fallaba, el monitor se quedaba con el **precio tachado**, que es exactamente el número al que saltaba el vaivén. Peor: en ese caso ni siquiera quedaba registrado como "no pude leer", así que los contadores nuevos marcaban todo en orden mientras salían los avisos falsos.

Ahora el monitor distingue tres situaciones que antes eran una sola:

| Lo que pasa con el bloque de compra | Qué hace el monitor |
|---|---|
| No se pudo leer | **No se sabe el precio**: conserva el que tenía y no avisa nada |
| Se leyó y no publica monto (productos que Samsung no vende online) | Usa el precio escrito en la página, que ahí sí es el único que hay |
| Se leyó y publica el monto | Ese es el precio, siempre |

Y una regla que cruza las tres: **un número que la propia página marca como "Precio original" no se adopta nunca.**

Medido con el código real, 5 revisiones seguidas alternando solo si el bloque se deja leer: **antes salían 4 avisos falsos, ahora salen 0.**

**2. La "corrección silenciosa" se quemaba sola.** El monitor marca cada producto como ya corregido para no repetir la corrección. El problema era que lo marcaba **incluso cuando no había logrado leer ningún precio**: bastaba una revisión mala para que un producto perdiera su corrección y, en la siguiente, su precio bueno saliera anunciado como "subió 37%". Probado sobre una copia del catálogo real: **antes eso producía avisos falsos en masa; ahora, cero.**

**3. El precio de la página de familia se disfrazaba de precio de la ficha.** Un mismo producto se ve desde su propia ficha y desde la página de su familia, y esa segunda publica el precio de **lista**. Cuando la ficha se demoraba, el precio de la familia se copiaba al registro **con el nombre de la ficha encima**, y el monitor lo trataba como si viniera de la fuente de siempre: aviso inmediato. Ahora un precio solo se presta entre páginas del mismo tipo, y el registro **recuerda de qué página salió su precio** aunque después lo vea otra.

**4. Una página que vale menos ya no le pisa el precio a una que vale más** — pero con plazo. Si la ficha propia falla dos revisiones seguidas, antes la página de familia imponía su precio de lista y cobraba **dos** avisos falsos (uno al adoptarlo y otro al volver la ficha). Ahora no adopta nada... salvo que la ficha propia no vuelva en 3 revisiones (unas 9 horas): ahí se adopta igual y se avisa, aclarando que **el precio viene de otra página del sitio**. Ningún producto queda congelado para siempre con un precio viejo.

**5. Las correcciones silenciosas ya no son del todo silenciosas.** Cuando el precio guardado era el tachado, hay dos historias posibles que se ven **idénticas** desde una sola lectura: que el monitor lo estuviera leyendo mal, o que el producto **acabe de estrenar una oferta** y su precio de ayer sea justamente el tachado de hoy. Callarse las dos se tragaba rebajas reales, enteras y sin segunda oportunidad. Ahora las correcciones llegan por el **canal técnico** (no como avisos de precio, que seguirían siendo falsos), con los dos números y **las bajas primero**, para que una oferta real quede a la vista.

**6. Varios detalles que también costaban información:**

- Un producto **nuevo y a la venta** cuya página todavía no publica precio ahora **se anuncia igual**, diciendo que no hay precio. Antes quedaba invisible por tiempo indefinido.
- Cuando un aviso de stock muestra un precio que lleva revisiones sin poder comprobarse, ahora lo dice: *"último precio conocido: la página no lo publica hace N revisiones"*.
- El aviso técnico de precios congelados ahora incluye a los productos **agotados** (Samsung los vende, solo que sin unidades).

**7. Dos cosas de fondo, medidas.** El tiempo máximo que el monitor esperaba por el precio de cada página **nunca se estaba aplicando**: por un error de una línea, en vez de esperar los 3 segundos configurados esperaba **30**. Eso significa que cada una de las ~150 páginas que legítimamente no publican precio costaba medio minuto — unos 75 minutos por revisión. Ya está corregido, y de paso la pausa entre visitas subió de 2 a 2,5 segundos, que es lo que pide la política de scraping del proyecto. En neto, la revisión debería **acortarse**, no alargarse; hay que confirmarlo con el reloj en la primera corrida real.

---

## Por dónde empieza cada revisión (2026-09-12)

Los avisos llegan **en vivo**, a medida que la revisión avanza. Eso significa que lo que se revisa primero es lo primero que te enteras. Hasta ahora la revisión seguía el orden crudo del listado, que está ordenado alfabéticamente por categoría: partía por "Accesorios línea blanca" y **el primer smartphone era la página 717 de 1.185**. Una baja de un Galaxy podía llegarte con más de una hora de atraso.

Desde ahora la revisión **parte por las categorías que pediste, en tu orden**:

1. Smartphones
2. Tablets
3. Audio y Galaxy Buds
4. Relojes (Galaxy Watch)
5. Computadores

### Lo que se gana, con números

Lo que no depende de nada es el **puesto**: en qué número de página empieza cada categoría. Los minutos sí dependen de lo rápido que vaya esa revisión, así que van como rango, medido sobre las últimas 20 revisiones completas (entre 6,4 y 10,7 segundos por página; lo típico son 9,1):

| Categoría | Antes empezaba en la página… | Ahora empieza en… | Se adelanta (típico) |
|---|---|---|---|
| Smartphones | 717 | **1** | ~109 min (76 a 127) |
| Tablets | 810 | 186 | ~95 min (66 a 111) |
| Audio y Galaxy Buds | 456 | 254 | ~31 min (22 a 36) |
| Relojes (Galaxy Watch) | 688 | 268 | ~64 min (45 a 75) |
| Computadores | 492 | 317 | ~27 min (19 a 31) |

El bloque de las cinco categorías son **347 páginas de 1.185 (29%)**: entre **37 y 62 minutos, del orden de 53 en una revisión normal**. Ojo con una cosa al comparar: ese bloque se lleva el **100% de las páginas que el monitor descubre solo**, que son las que cuestan una carga extra (pasan por navegador), así que tarda un poco más que el promedio de una página cualquiera.

Después del bloque la revisión sigue con todo lo demás exactamente como antes: **no se deja de revisar nada, solo cambia el orden**.

### Las páginas "familia" también entran temprano

Hay dos tipos de página: las del listado y las que el monitor **descubre solo** (las páginas donde una sola dirección agrupa todos los colores y capacidades de un modelo). Las descubiertas entran **dentro del bloque de su propia categoría**, justo después de las del listado.

Por qué importa: de los 130 productos que el monitor conoce bajo "smartphones", **37 solo existen en una página descubierta** — no tienen ficha propia en el listado. Si las descubiertas hubieran quedado todas juntas al final del bloque, "empezar por Smartphones" habría cubierto 93 de los 130 y los otros 37 (los Galaxy nuevos, justo los del Cyber) habrían esperado detrás de las otras cuatro categorías, unos 10 minutos más. Lo mismo pasa en Relojes (13 de 31) y Computadores (7 de 20).

Lo que se pierde con esta decisión: la segunda categoría arranca más tarde, porque Smartphones pasa de 91 a 185 páginas.

### Cómo comprobar que se está cumpliendo

Cada revisión anota en `data/ejecuciones.jsonl`:

- `paginasPrincipales`: cuántas páginas tenía el bloque de categorías principales. Es el tamaño **real** del bloque, aunque la revisión no lo haya terminado.
- `duracionPrincipalesMin`: cuántos minutos tardó en terminarlo (contados desde que empezó la revisión). Si sale `null`, la revisión **no alcanzó a completar el bloque** — no es lo mismo que cero.
- `inversionesIntraSeccion`: tiene que ser **0 siempre** (ver la sección de abajo).
- `skusQueCambiaronDeSeccion`: productos que pasaron a colgar de una página de otra sección de la web. Casi siempre 0.

En el log de GitHub Actions aparecen además dos líneas: `INFO bloque_principal` (al empezar, con el tamaño del bloque, cuántas de esas se van a recorrer y el desglose por categoría) y `INFO bloque_principal_listo` (al terminarlo).

### Si quieres cambiar la lista

La lista está en **`src/prioridad.mjs`**, arriba del todo, y es la única copia que existe. Cada línea tiene el nombre de la categoría tal como aparece en el listado y el tramo de la dirección web que le corresponde. Por ejemplo, para agregar los soundbars (que hoy **no** están, porque no los pediste) habría que agregar una línea con `"Audio (Soundbars/Torres)"` y `audio-devices`.

Ojo con una trampa: el nombre tiene que ser el **exacto del listado**. Tú los nombraste "Relojes" y "Computadoras"; en el listado se llaman "Relojes (Galaxy Watch)" y "Computadores". Hay una prueba automática que revienta si alguien escribe un nombre que no existe en el listado.

### Si Samsung le cambia el nombre a una categoría

No se rompe nada y no se queda callado:

- La revisión sigue corriendo igual y **no se pierde ninguna página**.
- Si la sección de la web sigue existiendo (o sea, fue un cambio de nombre), esas páginas **igual entran temprano**, reconocidas por su dirección.
- Te llega un aviso por el **canal técnico** diciendo cuál categoría dejó de calzar y si parece un cambio de nombre o una desaparición, y queda anotado en `data/ejecuciones.jsonl` en `categoriasPrincipalesAusentes`.
- Ese aviso sale **una vez al día como máximo**, no en cada revisión. La condición dura hasta que alguien corrija el archivo, y siete mensajes idénticos por día por el mismo canal donde llegan las momias no ayudan a nadie.

### Lo más importante: cambiar el orden no cambia el resultado

El sistema ya tuvo un defecto causado por el orden de las páginas (el precio de lista de una página de familia quedando firmado como si fuera de la ficha propia, ver más arriba), así que esto es lo que hay que cuidar.

**La versión corta:** dos páginas que hablan del mismo producto viven siempre bajo la misma sección de la web (`/smartphones/`, `/tablets/`…), y el reordenamiento **nunca cambia el orden entre dos páginas de la misma sección**. Por eso no puede cambiar quién escribe qué.

Hay que decirlo así y no como estaba escrito antes ("las páginas del listado van siempre antes que las descubiertas"), porque eso **no es cierto**: el reordenamiento adelanta 146.246 páginas descubiertas por delante de páginas del listado — es justo lo que pediste. Lo que nunca adelanta es una página por delante de otra **de su misma sección**.

Tres cosas lo sostienen, y las tres se vigilan solas:

1. **Pruebas contra el listado real.** Que cada sección de la web pertenezca a una sola categoría, que ninguna categoría viva repartida en dos secciones, y que sobre las 1.023 páginas reales el reordenamiento no invierta **ningún** par de la misma sección. Si Samsung cambia eso, las pruebas se ponen rojas antes de que salga un aviso equivocado.
2. **Un desempate que no depende del orden.** Si dos páginas de secciones distintas publican el mismo producto, ya no gana "la última que pasó": gana la página que **nombra al producto en su dirección**, que es la ficha de ese producto. Esto pasó de verdad una vez (el 25 de julio, una tarjeta para Galaxy quedó colgada de una página de accesorios de TV y volvió sola a la revisión siguiente).
3. **Dos alarmas en cada revisión.** Si el reordenamiento llegara a invertir dos páginas de la misma sección, o si un producto cambia de sección, te llega un aviso técnico (una vez al día) y queda en el resumen de la revisión.

Y sigue estando la prueba que toma el mismo conjunto de observaciones, lo procesa en el orden viejo y en el nuevo, y exige que **el catálogo y los avisos sean idénticos** — ahora incluyendo el caso cruzado (un producto publicado por una página de una categoría principal y por otra que no lo es), que antes no cubría.

Lo único que cambia a propósito es **el orden en que te llegan los avisos**.

### Dos detalles chicos que también se arreglaron

- **Los mensajes que cortan la lista** ("y 12 más") ya no muestran los primeros que pasaron, sino los más insistentes, en un orden fijo. Antes, cuáles 15 veías dependía de por dónde había empezado la revisión.
- **`data/latest.json` se guarda ordenado por producto.** No cambia ningún dato: hace que el historial de cambios del archivo muestre solo lo que de verdad cambió. La primera revisión después de este cambio va a tener un cambio grande de una sola vez, y nunca más.
