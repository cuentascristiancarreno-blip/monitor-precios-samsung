# Las fotos congeladas que usan las pruebas

> Si llegaste acá porque Discord dijo **"HAY QUE REFRESCAR test/fixtures/catalogo.json"**,
> andá directo a [Cómo se refresca](#cómo-se-refresca). Son dos comandos.

## Qué hay acá y por qué

| archivo | qué es | de dónde salió |
|---|---|---|
| `catalogo.json` | una copia entera de `data/latest.json` | del commit `3d1f32e`, 2026-09-22T08:27:50Z — la última revisión buena antes del incidente |
| `ejecuciones.jsonl` | las últimas 24 filas de `data/ejecuciones.jsonl` | el mismo día |

Son **fotos**: no se actualizan solas y no tienen que hacerlo.

## Por qué existen (el incidente de las 30 horas)

El 2026-09-22 el monitor se apagó solo y estuvo **30 horas caído**: 24 corridas
fallidas seguidas, cero avisos a Discord, y el operador se enteró por un correo
de GitHub. **Nadie había cambiado una línea de código.**

La causa: `npm test` es el paso del workflow que **bloquea la corrida**, y adentro
había pruebas que leían `data/latest.json` — el catálogo de producción, que las
propias corridas reescriben y commitean 20 veces al día. Esas pruebas no
preguntaban *"¿el código hace lo que dice?"*. Preguntaban *"¿el catálogo de hoy
tiene esta forma?"*, y esa respuesta cambia sola. El catálogo creció, cruzó una
raya del 80%, y una prueba que avisaba correctamente se convirtió, por estar
cableada al candado, en 30 horas sin monitoreo.

**Medido:** se cargaron los 532 snapshots de `data/latest.json` que hay en el
historial de git (2026-07-19 a 2026-09-22) y se corrió la suite entera contra cada
uno. **340 de 532 (63,9%) tumbaban `npm test`** — julio 62 de 66, agosto 199 de
199, septiembre 79 de 267. Con estas fixtures: **0 de 532**.

La regla que queda, y que vigila `test/candado-offline.test.mjs`:

> Una prueba del candado no abre `data/`. Si su respuesta puede cambiar sin que
> nadie toque una línea de código, no es una prueba: es un canario, y su lugar es
> `npm run censo`.

## Qué se pierde con esto, sin adornos

Estas dos pruebas dejaron de ser un censo de **hoy** y pasaron a ser regresión
contra una **foto**. Y eso tiene un costo real, porque media docena de defectos
graves de este proyecto salieron justamente de correr contra el catálogo de
verdad: los 4 SKU fantasma del S25 FE, las 126 páginas duplicadas, el orden del
recorrido. Si Samsung estrena una forma de página nueva, la fixture no la tiene y
la prueba no la ve.

Lo que lo compensa es que **el censo sí mira la realidad, todos los días y con más
indicadores que antes** (`npm run censo`, ver `src/censo.mjs`). Pero el censo
**avisa; no bloquea**. Es el canje que se aceptó a ojos abiertos: un candado no se
puede ignorar, un canario sí. 30 horas sin monitoreo es peor que un aviso no
leído, pero no es gratis y no hay que venderlo como gratis.

## Cuándo hay que refrescarlas

**Cuando alguien le agrega un campo al registro del catálogo, en el mismo commit
que se lo agrega.** No es mantenimiento periódico.

Eso no es una corazonada: se barrió la FORMA del catálogo (el conjunto de campos
presentes en ≥50% de los registros) a lo largo de los 532 snapshots. **Cambió 4
veces en 65 días** — 2026-07-25 (`ausencias`, `estadoStock`, `presencia`…), 07-30
(`especificaciones`, `nombreFamilia`, `variante`), 09-12 (`rango`,
`versionPrecio`, `versionStock`) — y **las tres veces en el mismo commit que
agregó el campo. Nunca cambió sola.**

Esa asimetría es el argumento entero: **el dato se mueve 20 veces al día; la forma
se mueve una vez al mes y con una persona adentro.**

## Qué se rompe si nadie las refresca

Nada se rompe: se **degrada**, en silencio, y por eso hay un aviso.

- La suite sigue verde para siempre. **Ese es el problema, no la solución:** verde
  deja de significar "el código anda con el catálogo de hoy" y pasa a significar
  "el código anda con el catálogo de septiembre".
- Un campo nuevo no queda cubierto por ninguna de las dos pruebas hasta que
  alguien refresque.
- Las premisas de dos pruebas pueden dejar de parecerse a la realidad (por
  ejemplo, que siga habiendo un televisor vivo fuera del bloque liviano).

**Por eso el sistema lo dice solo.** `npm run censo` corre en cada revisión y trae
tres indicadores dedicados a esto:

- `fixture-al-dia` — compara los **campos** (no los valores: los valores de la foto
  están viejos a propósito y para siempre) de `catalogo.json` contra el catálogo
  de producción. Si aparece uno nuevo, lo nombra y manda a este archivo.
- `premisa-tele-fuera-del-bloque` y `premisa-sku-dentro-del-bloque` — las premisas
  de las pruebas de censo.

Si nadie refresca, el aviso vuelve a salir **una vez al día**, por el canal técnico.
No se apaga solo.

## Cómo se refresca

Desde la raíz del repo, con el repo al día (`git pull`), **y en una rama, no
directo en `main`**:

```
git switch -c refresca-la-fixture
cp data/latest.json test/fixtures/catalogo.json
tail -24 data/ejecuciones.jsonl > test/fixtures/ejecuciones.jsonl
npm test
```

**Por qué en una rama, y no es una formalidad:** si el refresco rompe una
aserción, en una rama eso falla en `pruebas.yml`, delante tuyo, y no pasa nada.
En `main` el que falla es el **candado de `monitor.yml`**, o sea el monitor
apagado hasta que alguien lo note — exactamente el incidente del 2026-09-22.

Y después mirá dos cosas:

1. **`npm test` tiene que quedar verde sin tocar ninguna aserción.** Si una falla,
   **no le aflojes el número**: eso es justo lo que convirtió un aviso en 30 horas
   de apagón. Lo que falló es una afirmación sobre el catálogo que dejó de ser
   cierta, y su lugar es `src/censo.mjs`, no el candado.
2. **Corré `npm run censo`** y confirmá que `fixture-al-dia` quedó en verde.

### Qué aserciones puede romper un refresco

> **Corrección del 2026-09-23 (segunda vuelta).** Este apartado decía "la ÚNICA
> aserción que un refresco puede volver a romper" y nombraba una sola. Era falso,
> y subestimaba el riesgo justo para la persona que va a hacer el cambio. Se
> midió poniendo **cada uno de los 532 snapshots** del historial de git como
> `test/fixtures/catalogo.json` y corriendo la suite entera contra cada uno:

```
snapshots probados como fixture:  532   (2026-07-19 -> 2026-09-22)
rompen npm test:                  340   (63,9%)
quedan verdes:                    192
  2026-07:  4 de 66 verdes
  2026-08:  0 de 199 verdes
  2026-09:  188 de 267 verdes
a partir del 2026-09-12 quedan todos verdes
```

Las aserciones que caen, en orden de cuántos snapshots las rompen:

- **340 de 532** — `con el descubrimiento caido, una revision COMPLETA no declara ni un desaparecido`
- **340 de 532** — `el bloque del modo Cyber es mas chico, sigue siendo un prefijo y no rompe el invariante del orden`
- **237 de 532** — `una revision liviana recorre exactamente el bloque principal, y es un PREFIJO del recorrido completo`
- **237 de 532** — `el alcance se arma DESPUES del recorte: lo que LIMITE_PAGINAS deja afuera queda fuera del alcance`
- **1 de 532** — `UN PRODUCTO QUE SE MUDA A UNA PAGINA DE FUERA DEL BLOQUE no produce ningun aviso, sobre el catalogo REAL`
- **1 de 532** — `y si el descubrimiento NO vuelve, la revision completa siguiente tampoco declara nada (la vara no se normaliza sola)`
- **1 de 532** — `una revision completa SANA no dispara el chequeo de productos sin pagina`
- **1 de 532** — `una revision LIVIANA no se marca sospechosa por los 733 productos que no se propuso mirar`
- **1 de 532** — `completo -> liviano x9 -> completo -> liviano x9 sobre el catalogo REAL: cero desaparecidos falsos y cero avisos que no correspondan`
- **1 de 532** — `...y una revision liviana no le toca UN SOLO BYTE a lo que no miro`
- **1 de 532** — `un televisor que desaparece DE VERDAD se avisa en el SEGUNDO completo, no antes y no despues`
- **1 de 532** — `con el censo ENTERO EN VERDE no se manda nada, pero la fila de la serie se escribe igual`

> El último de la lista tiene su historia y vale la pena contarla: su primera
> versión partía de esta misma fixture y le agregaba SKU, y así rompía en **344
> de 532** — era la aserción más frágil de toda la suite, más que las dos
> preexistentes. Escribiendo el arreglo del acoplamiento se había introducido un
> acoplamiento nuevo, del mismo tipo. Se reescribió con un catálogo
> **construido**, que no hereda nada de la fixture salvo los NOMBRES de sus
> campos: pasó de 344 a 1.

**Lo que esto significa en la práctica:** refrescar con el catálogo de HOY es
seguro (la fixture de hoy ES el catálogo de hoy). Lo que no es seguro es
refrescar con un catálogo de una forma distinta — y la forma del catálogo se
mueve de verdad: el 2026-09-12/13 el aporte del descubrimiento saltó de 7,3% a
13,7% **en un día**.

**Las dos que más peso tienen:**

- **"con el descubrimiento caído, una revisión COMPLETA no declara ni un
  desaparecido"** necesita que el descubrimiento aporte **más del 10% de las
  páginas** (`TOLERANCIA_ENCOGIMIENTO`). Hoy va en 13,5%; entre el 2026-07-23 y
  el 09-11 estuvo entre 5,0% y 7,4%, o sea **por debajo del piso**.
- **"el bloque del modo Cyber es más chico…"** (`cercaDe(216)`) exige que el
  bloque quede en la banda [162, 270]. Antes del 2026-09-12 medía 108-154.

Que estas comprobaciones sigan dentro del candado es defendible — con la entrada
congelada su respuesta ya no cambia sola — pero **no es cierto que se hayan
"mudado" al censo: están en los dos lados.** El censo las mira todos los días con
los mismos umbrales (`aporte-descubrimiento`, `bloque-cyber`), así que te avisa
antes de que nadie refresque nada; el candado las vuelve a evaluar el día del
refresco.

Refrescar la fixture va en el **mismo commit** que el cambio que la volvió vieja,
igual que las tres veces que la forma cambió de verdad.

## Lo que NO hay que hacer

- **No la achiques "para que pese menos".** Se midió: sacarle los campos
  descriptivos la deja en 806 KB (−18%) y sigue verde; una submuestra del 25% la
  deja en 203 KB pero **rompe 5 pruebas**, y acortar las URL a ids opacos rompe 8
  (las URL no son relleno: hacen el join con `src/seed.json` y llevan la sección
  de la que depende `src/prioridad.mjs`). Quedó entera, sin tocar un byte, porque
  así **ninguna aserción tuvo que cambiar** — y porque 980 KB una sola vez no es
  nada al lado de los 980 KB que el repo commitea 20 veces por día. Si algún día
  se quiere achicar, hay que correr antes el banco de mutantes completo del
  proyecto, no unos pocos inventados para la ocasión: la bitácora ya dejó escrito
  que *"'mueren todos los míos' no es una medida de cobertura, es una medida de mi
  propia imaginación"*.
- **No la muevas a `data/`.** `test/candado-offline.test.mjs` lo caza en ese mismo
  commit, que es para lo que existe.
