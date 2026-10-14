import { componerTitulo } from "./titulo.mjs";
import { reloj } from "./reloj.mjs";
import { ESTADO, textoEstado } from "./stock.mjs";
import { entorno } from "./entorno.mjs";
import { VENTANA_REBOTE_HORAS, VENTANA_QUIEBRE_HORAS, LADO, esMatiz, esMatizQueVuelve, esRebote, ventanaDe } from "./estabilidad.mjs";
import { seccionDeUrl } from "./identidad.mjs";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function fmt(n) {
  return Number.isFinite(n) ? CLP.format(n) : "sin precio";
}

// El porcentaje con COMA decimal, que es como se escribe en Chile. Antes era
// `.toFixed(1)`, o sea punto ("−5.0%"), mientras el comentario de esta misma
// funcion prometia "−15,9%": el texto y el codigo decian cosas distintas y el
// que estaba mal era el codigo. Los montos ya usaban es-CL (el formateador CLP).
const PCT = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// diferencia en pesos y porcentaje, ej: " (−$170.000 · −15,9%)"
function variacion(anterior, nuevo) {
  if (!Number.isFinite(anterior) || !Number.isFinite(nuevo) || anterior === 0) return "";
  const diff = nuevo - anterior;
  const signo = diff > 0 ? "+" : "−";
  const pctAbs = PCT.format(Math.abs((diff / anterior) * 100));
  return ` (${signo}${CLP.format(Math.abs(diff))} · ${signo}${pctAbs}%)`;
}

/**
 * LO QUE EL OPERADOR PIDIO VER EN UN AVISO DE BAJA (2026-10-14), textual: "que
 * se vea que hubo una baja de producto y una flecha verde por ejemplo, el nombre
 * del producto completo y de que precio a que precio bajo".
 *
 * Son cuatro cosas y las cuatro tienen su pieza:
 *  - QUE ES UNA BAJA: la palabra, escrita. El mensaje anterior decia "Precio
 *    antes: … → ahora: …" y nunca la palabra "baja": el unico indicio del
 *    sentido era un circulo verde, que es un color, no una direccion.
 *  - LA FLECHA VERDE: `BANDERA.baja`. En el set de emoji que usa Discord
 *    (Twemoji) no existe ninguna flecha verde de un solo caracter -- ⬇️ se
 *    dibuja azul oscuro y 🔻 es roja --, asi que el verde lo pone el circulo
 *    pegado a la flecha. Es la unica combinacion que se ve verde y se ve flecha
 *    en todas las plataformas.
 *  - EL NOMBRE COMPLETO: `componerTitulo` entero, sin recortar, con el SKU al
 *    lado. Medido sobre el catalogo de hoy (552 notificables): 0 titulos se
 *    recortan en el mensaje, 6 SKU comparten titulo con otro (y el SKU entre
 *    parentesis los distingue). Lo que si estaba pobre era el ICONO: 75
 *    notificables -- los packs, que entran por una pagina familia y por eso
 *    quedan con categoria "Familia (auto-descubierta)" -- salian con el 🔹
 *    generico (ver iconoPara).
 *  - DE QUE PRECIO A QUE PRECIO: `tramoDePrecio`, en castellano llano ("De $X a
 *    $Y") y con el monto de AHORA en negrita, que es el unico accionable.
 *
 * LA BANDERA VA PRIMERA, antes del nombre: la direccion del cambio se lee de un
 * golpe, antes del nombre del producto, sin tener que llegar a la segunda linea.
 * Antes la linea empezaba por el producto y habia que leer la de abajo para
 * saber si habia subido, bajado o agotado.
 *
 * ⚠️ CORREGIDO 2026-10-14 (segunda vuelta): la version anterior de este
 * comentario justificaba la bandera diciendo que "la vista previa de la
 * notificacion del telefono muestra el comienzo de la primera linea, asi que se
 * lee sin abrir Discord". **Los tres verificadores lo midieron y es falso para
 * los dos caminos de envio**: esta es la linea del PRODUCTO, no la primera del
 * mensaje. En vivo la primera linea es el encabezado de la tanda y la del
 * producto va tercera (y con "🔥 " delante cuando la baja es >= 15%); en el
 * cierre la primera linea es "**Monitor de precios Samsung Chile**". La promesa
 * del telefono se cumple ahora en `encabezadoTanda` (src/despachador-vivo.mjs),
 * que es la linea que el push si muestra, y donde quedo escrito que en la semana
 * medida las 11 bajas de 11 salieron por ese camino.
 */
const BANDERA = {
  baja: "🟢⬇️ **BAJÓ DE PRECIO**",
  // Se conserva aunque hoy ninguna suba llegue a Discord (regla del 2026-10-14,
  // src/solo-bajas.mjs): esa regla se revierte borrando UNA linea y entonces
  // esta tiene que estar. Rojo y hacia arriba, el opuesto exacto.
  sube: "🔴⬆️ **SUBIÓ DE PRECIO**",
};

/** "De $199.990 a **$139.990**" — los dos montos, el de ahora en negrita. */
function tramoDePrecio(anterior, nuevo) {
  if (!Number.isFinite(anterior)) return `Precio: **${fmt(nuevo)}**`;
  return `De ${fmt(anterior)} a **${fmt(nuevo)}**`;
}

/** " · ahorras $60.000 (−30,0%)" para una baja; la variacion cruda si sube. */
function ahorro(change) {
  const { precioAnterior: antes, precio: ahora } = change;
  if (!Number.isFinite(antes) || !Number.isFinite(ahora) || antes === 0) return "";
  if (ahora >= antes) return variacion(antes, ahora);
  const pct = PCT.format(((antes - ahora) / antes) * 100);
  return ` · ahorras ${CLP.format(antes - ahora)} (−${pct}%)`;
}

// Icono por categoria real de src/seed.json (nunca se usa para "Accesorios *"
// porque esas categorias se filtran antes de llegar aca -- ver esAccesorio en
// src/catalogo.mjs, aplicado en run.mjs justo antes de llamar a notifyDiscord).
const ICONO_CATEGORIA = {
  Smartphones: "📱",
  Tablets: "📱",
  Computadores: "💻",
  "Relojes (Galaxy Watch)": "⌚",
  "Audio y Galaxy Buds": "🎧",
  "Audio (Soundbars/Torres)": "🔊",
  Televisores: "📺",
  "TV Lifestyle": "🖼️",
  Monitores: "🖥️",
  Proyectores: "📽️",
  Signage: "📟",
  "LED Signage": "📟",
  Refrigeradores: "🧊",
  "Línea blanca": "🧊",
  Lavavajillas: "🍽️",
  Cocina: "🍳",
  Microondas: "♨️",
  "Lavado y secado": "🧺",
  "Aire acondicionado": "❄️",
  "Aire acondicionado (sistemas)": "❄️",
  Aspiradoras: "🧹",
  "Purificadores de aire": "🌬️",
  SmartThings: "🏠",
  Reproductores: "📀",
};
const ICONO_DEFAULT = "🔹";

/**
 * RESPALDO POR SECCION DE LA URL (2026-10-14, medido).
 *
 * `ICONO_CATEGORIA` se indexa por la categoria del LISTADO, y hay 75
 * notificables que no tienen una: son los packs (Watch + Buds, S26 Ultra +
 * adaptador, Tab + teclado) que solo existen en una pagina familia descubierta
 * por sitemap, asi que su categoria es la generica "Familia (auto-descubierta)"
 * y salian con el 🔹. Medido sobre las 1.411 bajas de todo el historial: 29
 * (2,1%) salieron con el icono generico, y los nombres de esos productos son
 * completos y buenos ("Galaxy Watch9 (Bluetooth, 40 mm) Cream + Galaxy Buds4 Pro
 * Black") -- lo unico pobre era el icono.
 *
 * La seccion de la URL si lo resuelve, y el mapa no es una suposicion: censando
 * los 552 notificables del catalogo, cada una de las 22 secciones del sitio la
 * usa UNA sola categoria (`smartphones` -> Smartphones, `watches` -> Relojes,
 * `tablets` -> Tablets, `computers` -> Computadores...), y las 4 secciones de
 * las que cuelgan los 75 packs son justo esas. Es la misma propiedad del sitio
 * en que se apoya `src/prioridad.mjs` desde el 2026-09-12.
 *
 * Solo se consulta cuando la categoria no esta en la tabla: una categoria real
 * nunca pierde su icono por esto.
 */
const ICONO_SECCION = {
  smartphones: "📱",
  tablets: "📱",
  watches: "⌚",
  computers: "💻",
  "audio-sound": "🎧",
  "audio-devices": "🔊",
  tvs: "📺",
  "lifestyle-tvs": "🖼️",
  monitors: "🖥️",
  projectors: "📽️",
  "smart-signage": "📟",
  "led-signage": "📟",
  refrigerators: "🧊",
  dishwashers: "🍽️",
  "cooking-appliances": "🍳",
  "microwave-ovens": "♨️",
  "washers-and-dryers": "🧺",
  "air-conditioners": "❄️",
  "system-air-conditioners": "❄️",
  "vacuum-cleaners": "🧹",
  "air-care": "🌬️",
  smartthings: "🏠",
};

function iconoPara(categoria, url) {
  return ICONO_CATEGORIA[categoria] || ICONO_SECCION[seccionDeUrl(url)] || ICONO_DEFAULT;
}

/** El icono de un cambio: su categoria, y si no la tiene, la seccion de su URL. */
function iconoDe(change) {
  return iconoPara(change?.categoria, change?.url || change?.paginaOrigen);
}

// El titulo va en negrita: un "*" o "_" que venga del sitio rompe el formato del
// resto del mensaje (precios y links incluidos). Hoy ningun nombre del catalogo
// los trae, pero el texto es de Samsung y puede cambiar en cualquier corrida.
// La barra invertida va PRIMERO en la clase y en la misma pasada: es el propio
// caracter de escape, y un nombre terminado en "\" convertia el ** de cierre en
// un asterisco literal -- la negrita no cerraba y se arrastraba el precio, el
// link y los productos siguientes del mismo mensaje. El pipe tambien se escapa
// porque "||texto||" es un spoiler en Discord (oculta el resto de la linea).
function escaparMarkdown(texto) {
  return texto.replace(/([\\*_`~|])/g, "\\$1");
}

/**
 * El precio que acompania a un aviso de stock es el ULTIMO CONOCIDO. Si lleva
 * corridas sin poder leerse, imprimirlo a secas lo presenta como vigente y el
 * operador puede ir a comprar con un numero viejo. Solo aparece cuando hay algo
 * que declarar (ver sinComprobar en src/comparar.mjs).
 */
function sinComprobar(change) {
  const n = change?.corridasSinPrecio;
  return Number.isFinite(n) && n > 0
    ? ` _(último precio conocido: la página no lo publica hace ${n} ${n === 1 ? "revisión" : "revisiones"})_`
    : "";
}

/**
 * Un cambio que se adopto porque la pagina que escribio el precio guardado no
 * volvio en varias corridas (ver UMBRAL_PRECIO_OTRA_FUENTE en src/comparar.mjs).
 * El numero es real, pero lo publica otra pagina del sitio: vale decirlo.
 */
function otraFuente(change) {
  return change?.desdeOtraFuente ? " _(precio leído desde otra página del sitio)_" : "";
}

function lineFor(change) {
  const icono = iconoDe(change);
  // el titulo ahora incluye las caracteristicas de la variante (capacidad, RAM,
  // color...) y el SKU sigue visible al final: es el unico identificador estable
  const nombre = escaparMarkdown(componerTitulo(change));
  const sku = change.modelo || "sin SKU";
  const titulo = `${icono} **${nombre}** (${sku})`;
  const link = change.url ? `\n　🔗 ${change.url}` : "";
  switch (change.tipo) {
    case "nuevo":
      if (!Number.isFinite(change.precio)) {
        // Un producto puede entrar al catalogo SIN precio publicado: su pagina no
        // escribe ningun monto y el monitor prefiere callarse antes que inventarlo
        // (ver precioAdoptable en src/extract.mjs). Se anuncia igual -- un producto
        // nuevo a la venta es noticia -- pero diciendo la verdad sobre el precio.
        return `${titulo}\n　🆕 Apareció en el catálogo. **La página todavía no publica precio**; se avisará en cuanto lo publique.${link}`;
      }
      // ...y cuando por fin lo publica, el aviso no puede decir "primera vez visto":
      // el operador ya lo vio aparecer.
      if (change.yaAnunciadoSinPrecio) {
        return `${titulo}\n　🆕 Ya publicaron su precio: **${fmt(change.precio)}**${link}`;
      }
      return `${titulo}\n　🆕 Precio: **${fmt(change.precio)}** (primera vez visto en el catálogo)${link}`;
    case "desaparecido":
      return `${titulo}\n　❌ Ya no aparece en el sitio (confirmado en 2 revisiones seguidas). Último precio: **${fmt(change.precioAnterior)}**${link}`;
    case "recuperado":
      return `${titulo}\n　✅ Volvió a aparecer en el sitio. Precio actual: **${fmt(change.precio)}**${sinComprobar(change)}${link}`;
    // LAS DOS LINEAS DE PRECIO LLEVAN SU BANDERA ADELANTE (2026-10-14, pedido
    // del operador; el por que de cada pieza esta en el comentario de BANDERA).
    case "baja":
      return `${BANDERA.baja} · ${titulo}\n　${tramoDePrecio(change.precioAnterior, change.precio)}${ahorro(change)}${otraFuente(change)}${link}`;
    case "sube":
      return `${BANDERA.sube} · ${titulo}\n　${tramoDePrecio(change.precioAnterior, change.precio)}${ahorro(change)}${otraFuente(change)}${link}`;
    // El operador puede ver TRES estados, no dos: "no está a la venta" (el
    // producto existe pero Samsung no lo vende) no es lo mismo que "agotado"
    // (se vende, pero no hay unidades). Los eventos viejos de history.jsonl solo
    // traen los booleanos, asi que se cae a ellos cuando faltan los estados.
    case "stock":
      return `${titulo}\n　📦 Stock antes: **${textoEstado(change.estadoAnterior ?? (change.disponibleAnterior ? ESTADO.DISPONIBLE : ESTADO.AGOTADO))}** → ahora: **${textoEstado(change.estado ?? (change.disponible ? ESTADO.DISPONIBLE : ESTADO.AGOTADO))}**\n　Precio actual: **${fmt(change.precio)}**${sinComprobar(change)}${link}`;
    default:
      return titulo + link;
  }
}

/**
 * LA LINEA COMPACTA DE UN REBOTE (2026-09-13, segunda vuelta).
 *
 * Un rebote es un cambio a un valor que el operador YA escucho dentro de las
 * ultimas VENTANA_REBOTE_HORAS. No se calla -- callarlo se tragaba 61 bajas
 * reales en 30 dias, medido -- pero tampoco merece el bloque de tres lineas con
 * link de una novedad, que es justo lo que el operador pidio dejar de recibir.
 *
 * UNA SOLA LINEA, y trae las tres cosas que hacen que no haga falta ninguna
 * otra: entre que valores va, cual es el valor de AHORA (en negrita, porque es
 * lo unico accionable) y cuantas veces lleva. Sin link: el producto ya salio con
 * link la primera vez, cuando era novedad de verdad.
 */
function lineaRebote(change) {
  const icono = iconoDe(change);
  const nombre = escaparMarkdown(componerTitulo(change));
  const sku = change.modelo || "sin SKU";
  const veces = Number.isFinite(change.vecesRebotado) ? ` (${change.vecesRebotado}ª vez en ${ventanaDe(change)} h)` : "";

  // UN REBOTE DE STOCK LLEVA PRECIO Y LINK (2026-10-05, agravante medido).
  //
  // La linea compacta de stock no los llevaba, que son justamente las dos cosas
  // que si lleva la alerta fuerte. El mismo mensaje del 2026-10-02 le dio el
  // bloque completo con precio y link al 98" The Frame y una linea pelada al
  // monitor Odyssey OLED G5 ($449.990, 73 h disponible): la unica diferencia era
  // que el monitor se habia agotado 23,6 h antes. Un cambio de stock degradado
  // sigue siendo accionable -- "se puede comprar AHORA" --, asi que la linea
  // tiene que traer con que actuar. Son pocas lineas (medido sobre el historial
  // completo con la regla nueva: 19 rebotes de stock en 2,5 meses, los 19
  // quiebres repetidos), asi que el link no amenaza el presupuesto de largo del
  // mensaje.
  //
  // EL PRECIO VA CON SU ADVERTENCIA, igual que en la alerta fuerte (defecto de
  // la segunda vuelta). `lineFor` termina el caso "stock" en `sinComprobar` y
  // esta rama no lo hacia: el precio de un aviso de stock es el ULTIMO CONOCIDO
  // y, si la pagina lleva corridas sin publicarlo, imprimirlo a secas lo
  // presenta como vigente -- el comentario de `sinComprobar`, 90 lineas mas
  // arriba, dice exactamente por que no se puede hacer eso. El dato llega:
  // comparar.mjs le mete `...sinComprobar(rec)` a todos los cambios de stock.
  //
  // Y DICE "2º CRUCE", NO "1ª VEZ". `vecesRebotado` cuenta rebotes, asi que la
  // primera repeticion es "1ª vez" -- dentro de una seccion titulada "ya te los
  // avisé" eso se lee como lo contrario de lo que el titulo promete. El numero
  // de cruce (rebotes + 1) es el que no se contradice.
  if (change.tipo === "stock") {
    const antes = textoEstado(change.estadoAnterior ?? (change.disponibleAnterior ? ESTADO.DISPONIBLE : ESTADO.AGOTADO));
    const ahora = textoEstado(change.estado ?? (change.disponible ? ESTADO.DISPONIBLE : ESTADO.AGOTADO));
    const cruces = Number.isFinite(change.vecesRebotado)
      ? ` (${change.vecesRebotado + 1}º cruce igual en ${ventanaDe(change)} h)`
      : "";
    const precio = Number.isFinite(change.precio) ? ` · ${fmt(change.precio)}${sinComprobar(change)}` : "";
    const link = change.url ? ` · 🔗 ${change.url}` : "";
    return `${icono} **${nombre}** (${sku}) — 🌀 ${antes} → **${ahora}**${cruces}${precio}${link}`;
  }

  // UNA BAJA DEGRADADA SIGUE SIENDO UNA BAJA, Y AHORA LO DICE (2026-10-14).
  //
  // Esta linea decia "🌀 $139.990 ⇄ $199.990 · ahora **$139.990**": el ⇄ es un
  // simbolo de ida y vuelta, o sea que NO declaraba la direccion, y la palabra
  // "baja" no aparecia. Daba lo mismo mientras por el canal de productos salieran
  // los dos sentidos (el titulo de la seccion los agrupaba a proposito, para que
  // el vaiven no se leyera como "bajo/subio/bajo/subio"). Desde la regla del
  // operador del 2026-10-14 (src/solo-bajas.mjs) por este canal SOLO salen
  // bajas, asi que una linea que no dice el sentido miente por omision justo en
  // el aviso con el que se va a comprar. Medido sobre los 30 dias del
  // 2026-09-13: de 149 avisos degradados, 71 eran bajas -- no es un caso raro.
  //
  // Sigue siendo UNA linea y sigue sin link (el producto ya salio con link la
  // primera vez, cuando era novedad de verdad): lo unico que cambia es que lleva
  // la bandera y el tramo de precio, los mismos que la alerta fuerte.
  const entre = (change.valoresRebote ?? []).map((v) => fmt(v)).join(" ⇄ ");
  const bandera = BANDERA[change.tipo] ?? "🌀";
  return `${bandera} · ${icono} **${nombre}** (${sku}) — ${tramoDePrecio(change.precioAnterior, change.precio)}${ahorro(change)} · 🌀 rebota entre ${entre}${veces}`;
}

/**
 * LA LINEA COMPACTA DE UN MATIZ DE "NO SE PUEDE COMPRAR" (2026-10-05).
 *
 * Un paso de "agotado" a "no esta a la venta" (o al reves) es un cambio real del
 * sitio, pero no mueve la unica frontera que le importa al operador: no podia
 * comprarlo antes y no puede ahora. Medido: 107 de las 590 alertas fuertes de la
 * semana del Cyber eran esto, 89 de ellas en UNA sola revision.
 *
 * NO SE CALLA Y NO SE FUSIONAN LOS ESTADOS -- el operador pidio distinguirlos y
 * los dos van escritos en la linea. Lo que se le quita es la alerta fuerte con
 * bloque y link.
 *
 * LAS DOS DIRECCIONES NO SE DIBUJAN IGUAL (2026-10-05, segunda vuelta, medido).
 * "agotado -> no esta a la venta" no lleva precio ni link a proposito: no hay
 * nada que comprar y en 113 casos del historial NI UNO tenia el stock de vuelta
 * en el evento siguiente. "no esta a la venta -> agotado" es Samsung volviendo a
 * LISTAR el producto y SI lleva precio y link: 9 de 23 tenian el stock de vuelta
 * en el evento siguiente, 6 de ellos a las 8,4 h (ver `matizDe` en
 * src/estabilidad.mjs). Sigue sin ser alerta fuerte -- en ese momento no se
 * puede comprar -- pero va en su propia seccion y con que actuar.
 */
function lineaMatiz(change) {
  const icono = iconoDe(change);
  const nombre = escaparMarkdown(componerTitulo(change));
  const sku = change.modelo || "sin SKU";
  const antes = textoEstado(change.estadoAnterior ?? (change.disponibleAnterior ? ESTADO.DISPONIBLE : ESTADO.AGOTADO));
  const ahora = textoEstado(change.estado ?? (change.disponible ? ESTADO.DISPONIBLE : ESTADO.AGOTADO));
  if (esMatizQueVuelve(change)) {
    const precio = Number.isFinite(change.precio) ? ` · ${fmt(change.precio)}${sinComprobar(change)}` : "";
    const link = change.url ? ` · 🔗 ${change.url}` : "";
    return `${icono} **${nombre}** (${sku}) — ${antes} → **${ahora}**${precio}${link}`;
  }
  return `${icono} **${nombre}** (${sku}) — ${antes} → **${ahora}**`;
}

/**
 * EL TOPE DE LINEAS DE LAS SECCIONES DE MATIZ (2026-10-05, segunda vuelta).
 *
 * La ola del 2026-10-02T11:19 dejo 89 matices que decian LITERALMENTE lo mismo
 * ("agotado → no está a la venta"): 6 mensajes de Discord y 11.037 caracteres de
 * texto sin nada accionable. El aviso tecnico hermano (`mensajeRebotando`) ya
 * tenia tope desde el 2026-09-13 y esta seccion no, asi que escalaba lineal: si
 * Samsung repite la ola a escala de catalogo, 500 matices son ~34 mensajes.
 *
 * NO SILENCIA NADA, y eso es la mitad del diseño: lo que no cabe en lineas se
 * resume CONTADO POR CATEGORIA en una linea final, y esa linea VIAJA CON TODOS
 * los cambios que resume -- asi, si Discord rechaza ese mensaje, los cambios
 * vuelven enteros a data/pendientes.jsonl y se reintentan en la corrida
 * siguiente, igual que cualquier otro aviso. El detalle completo queda siempre
 * en data/history.jsonl.
 */
export const TOPE_MATICES = 40;

function resumenPorCategoria(cambios) {
  const porCat = new Map();
  for (const c of cambios) {
    const cat = c?.categoria || "sin categoría";
    porCat.set(cat, (porCat.get(cat) ?? 0) + 1);
  }
  return [...porCat.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([cat, n]) => `${n} ${cat.toLowerCase()}`)
    .join(" · ");
}

/**
 * Convierte una lista de matices en items para `armarMensajesConCambios`,
 * recortada al tope y con la cola resumida por categoria.
 */
function itemsDeMatices(cambios, tope = TOPE_MATICES) {
  const items = cambios.slice(0, tope).map((c) => ({ linea: lineaMatiz(c), cambio: c }));
  const resto = cambios.slice(tope);
  if (resto.length > 0) {
    items.push({
      linea: `…y ${resto.length} más: ${resumenPorCategoria(resto)}. _(el detalle completo queda en el historial)_`,
      cambios: resto,
    });
  }
  return items;
}

const TITULOS = {
  nuevo: "🆕 Productos nuevos",
  baja: "🟢⬇️ Bajas de precio",
  sube: "🔴⬆️ Subas de precio",
  stock: "📦 Cambios de stock",
  recuperado: "✅ De vuelta en el sitio",
  desaparecido: "❌ Ya no aparecen (confirmado)",
  correccion: "⚠️ Correcciones de avisos en vivo",
  rebote: "🌀 Siguen rebotando (ya te los avisé, no es novedad)",
  matiz: "📦 Siguen sin poder comprarse (cambió el motivo, no la disponibilidad)",
  matizVuelve: "🔄 Volvieron al catálogo, todavía sin stock (puede volver el stock)",
  pendiente: "⏳ Avisos atrasados (no se pudieron entregar en la revisión anterior)",
};

const TIPO_EN_PALABRAS = {
  baja: "baja de precio",
  sube: "alza de precio",
  nuevo: "producto nuevo",
  stock: "cambio de stock",
  recuperado: "producto de vuelta en el sitio",
};

/**
 * Linea de CORRECCION de un aviso en vivo que la revision completa NO confirmo.
 *
 * POR QUE HACE FALTA (defecto critico medido el 2026-09-11)
 * El aviso en vivo se decide con la vista PARCIAL de la corrida: previo[sku]
 * contra lo que escribio ESA pagina. Un mismo SKU lo pueden publicar dos paginas
 * distintas de la misma corrida (medido en produccion: RS60T5200B1/ZS,
 * QN50LS03FAGXZS, SM-S931BDBKLTL) y si la segunda vuelve a publicar el precio
 * anterior, comparar() no emite NINGUN cambio: latest.json conserva el precio
 * viejo y el resumen final daba el aviso por bueno. El operador recibia
 * "−$200.000 · −22%", iba a comprar y el precio era el de siempre; y como el
 * catalogo nunca se enteraba, la corrida siguiente volvia a mandar el MISMO
 * aviso falso, 7 veces al dia, indefinidamente.
 *
 * @param aviso el cambio tal como salio en vivo
 * @param actual el registro del catalogo definitivo (comparar() es la autoridad)
 */
export function lineaCorreccion(aviso, actual) {
  const icono = iconoPara(aviso.categoria ?? actual?.categoria, aviso.url || actual?.url || actual?.paginaOrigen);
  const nombre = escaparMarkdown(componerTitulo({ ...actual, ...aviso }));
  const sku = aviso.modelo || "sin SKU";
  const url = aviso.url || actual?.url;
  const link = url ? `\n　🔗 ${url}` : "";
  const que = TIPO_EN_PALABRAS[aviso.tipo] ?? "cambio";

  let vigente;
  if (aviso.tipo === "stock") {
    const estado = actual?.estadoStock ?? (actual?.disponible ? ESTADO.DISPONIBLE : null);
    vigente = estado ? `El stock vigente es **${textoEstado(estado)}**.` : "El estado de stock vigente no se pudo confirmar.";
  } else if (Number.isFinite(actual?.precio)) {
    vigente = `El precio vigente sigue siendo **${fmt(actual.precio)}**.`;
  } else {
    vigente = "La revisión completa no encontró ese cambio.";
  }

  return `${icono} **${nombre}** (${sku})\n　⚠️ El aviso de ${que} que salió durante la revisión **no se confirmó** (otra página del sitio publica otro dato). ${vigente}${link}`;
}

// Un aviso que quedo de la revision ANTERIOR porque Discord no lo acepto. Lleva
// la fecha original para que no se lea como si acabara de pasar.
//
// RESPETA LA CLASIFICACION QUE EL CAMBIO YA TRAE (2026-10-05, segunda vuelta,
// defecto medido). Este camino llamaba a `lineFor` sin mirar nada, asi que un
// matiz o un rebote rechazado por Discord volvia a la corrida siguiente como
// ALERTA FUERTE COMPLETA, con bloque de tres lineas y link -- justo lo que el
// arreglo del dia viene a quitar. El flag viaja entero por data/pendientes.jsonl
// (`serializarPendientes` guarda el cambio con todos sus campos), asi que basta
// con leerlo. Antes el agujero daba lo mismo porque los rebotes son <= 5 por
// corrida; los matices fueron 89 en UNA revision (2026-10-02T11:19), asi que
// bastaba que Discord rechazara un mensaje para que ~15 volvieran como bloques.
function lineaPendiente(cambio) {
  const cuando = cambio?.ts ? new Date(cambio.ts) : null;
  const fecha = cuando && !Number.isNaN(cuando.getTime()) ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(cuando) : "la revisión anterior";
  const nota = `_(detectado en ${fecha}; no se pudo avisar en su momento)_`;
  // compacto queda compacto: la nota va en la MISMA linea, para no convertir una
  // linea en un bloque de dos
  if (esMatiz(cambio)) return `${lineaMatiz(cambio)} ${nota}`;
  if (esRebote(cambio)) return `${lineaRebote(cambio)} ${nota}`;
  return `${lineFor(cambio)}\n　${nota}`;
}

// ---------------------------------------------------------------------------
// TRANSPORTE: ritmo, reintentos y "Discord jamas puede matar la corrida"
// ---------------------------------------------------------------------------
//
// Antes esto era un fetch pelado: si Discord devolvia 429 el mensaje se perdia
// PARA SIEMPRE (el estado ya estaba escrito, asi que la corrida siguiente no lo
// vuelve a detectar) y si el fetch era RECHAZADO (DNS, socket, Discord caido) la
// excepcion subia hasta main() y mataba la corrida entera -- tres horas de
// scraping perdidas por un hipo de red de 200 ms.
//
// Ahora:
//  - Un solo POST en vuelo a la vez, con cubo de fichas sobre el unico webhook.
//    Discord no publica el numero por webhook; lo medido por la comunidad es
//    RAFAGA 5 cada 2 s y SOSTENIDO ~30 cada 60 s por webhook. Con capacidad 3 y
//    una ficha cada 2.300 ms: la peor ventana de 2 s tiene <= 4 (de 5) y la peor
//    de 60 s tiene 3 + floor(60000/2300) = 29 (de 30). Margen sin ser lento.
//  - 429: se respeta retry_after del cuerpo (segundos, float) en vez de
//    reintentar a ciegas; si viene global, se frena TODA la cola.
//  - Todo error se traga: la funcion devuelve {ok:false} y nunca lanza.
// Todos los numeros son configurables por variable de entorno (se leen en cada
// llamada, asi que se pueden ajustar sin tocar codigo). Se leen con entorno()
// y no con Number(): una variable vacia tiene que caer al valor por defecto, no
// valer cero (ver src/entorno.mjs).
const conf = entorno;

let fichas = null;
let ultimaRecarga = 0;
let pausaGlobalHasta = 0;
let cola = Promise.resolve();

/** Serializa: nunca dos POST a Discord en vuelo al mismo tiempo. */
function enCola(fn) {
  const turno = cola.then(fn, fn);
  cola = turno.then(
    () => {},
    () => {},
  );
  return turno;
}

async function esperarTurno() {
  const capacidad = Math.max(1, conf("DISCORD_RAFAGA", 3));
  const recarga = conf("DISCORD_PAUSA_MS", 2300);
  if (fichas === null) fichas = capacidad;
  fichas = Math.min(fichas, capacidad);

  for (;;) {
    const ahora = reloj.ahora();
    if (pausaGlobalHasta > ahora) {
      await reloj.dormir(pausaGlobalHasta - ahora + 10);
      continue;
    }
    if (recarga <= 0) return; // ritmo desactivado (pruebas)
    const transcurrido = ahora - ultimaRecarga;
    if (transcurrido > 0) {
      fichas = Math.min(capacidad, fichas + transcurrido / recarga);
      ultimaRecarga = ahora;
    }
    if (fichas >= 1) {
      fichas -= 1;
      return;
    }
    await reloj.dormir(Math.ceil((1 - fichas) * recarga));
  }
}

function cabecera(res, nombre) {
  try {
    return res?.headers?.get?.(nombre) ?? null;
  } catch {
    return null;
  }
}

async function cuerpoJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// TOPE DURO DE CUALQUIER ESPERA QUE FRENE LA CORRIDA.
//
// run.mjs llama al despachador en el hueco entre paginas, asi que todo lo que
// duerma aca DETIENE el barrido. Discord puede pedir esperas de minutos u horas
// (un retry_after de un ban de Cloudflare; un reset-after largo en la cabecera),
// y la IP del runner de Actions es compartida con miles de trabajos ajenos, asi
// que ese numero no depende solo de nosotros. Sin tope, un 429 global podia
// congelar el barrido 30 minutos (medido) sobre un job con timeout de 330 min:
// perder 3 horas de scraping por una espera de Discord es exactamente al reves
// de la prioridad del proyecto.
//
// Con el tope, el peor congelamiento posible es DISCORD_MAX_ESPERA_MS y lo que
// no se pueda mandar ahora vuelve a salir en el resumen final.
function topeEspera() {
  return conf("DISCORD_MAX_ESPERA_MS", 70000);
}

// Discord dice explicitamente que el limite por webhook no se adivina: se LEE.
// Si la respuesta avisa que quedan 0 peticiones en el cubo, se espera lo que
// ella misma indica antes del proximo envio. Es el unico numero no estimado
// (pero igual acotado: ver topeEspera).
async function respetarCabeceras(res) {
  if (cabecera(res, "x-ratelimit-remaining") !== "0") return;
  const resetAfter = Number(cabecera(res, "x-ratelimit-reset-after"));
  if (Number.isFinite(resetAfter) && resetAfter > 0) await reloj.dormir(Math.min(resetAfter * 1000, topeEspera()) + 200);
}

async function unIntento(webhookUrl, content) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    return { res };
  } catch (err) {
    return { errorRed: err?.message || String(err) };
  }
}

async function enviarConReintentos(webhookUrl, content) {
  const maxRed = conf("DISCORD_REINTENTOS_RED", 4);
  const max429 = conf("DISCORD_REINTENTOS_429", 5);
  const backoff = conf("DISCORD_BACKOFF_MS", 2000);
  const tope = topeEspera();
  let intentosRed = 0;
  let intentos429 = 0;

  for (;;) {
    await esperarTurno();
    const { res, errorRed } = await unIntento(webhookUrl, content);

    if (errorRed !== undefined) {
      intentosRed += 1;
      if (intentosRed > maxRed) {
        console.error(`Fallo el envio a Discord (red, ${intentosRed} intentos): ${errorRed}`);
        return { ok: false, status: 0, motivo: "red" };
      }
      await reloj.dormir(backoff * 2 ** (intentosRed - 1));
      continue;
    }

    if (res.ok) {
      await respetarCabeceras(res);
      return { ok: true, status: res.status ?? 200 };
    }

    if (res.status === 429) {
      intentos429 += 1;
      const cuerpo = await cuerpoJson(res);
      const desdeCabecera = Number(cabecera(res, "retry-after"));
      const segundos = Number.isFinite(cuerpo?.retry_after) ? cuerpo.retry_after : Number.isFinite(desdeCabecera) ? desdeCabecera : 1;
      const esperaMs = Math.max(0, Math.round(segundos * 1000));
      const global = cuerpo?.global === true || cabecera(res, "x-ratelimit-scope") === "global";
      // La pausa global tambien va acotada al tope. Antes se fijaba con el
      // retry_after crudo y ANTES de decidir si este mensaje se rendia: el tope
      // solo hacia que ESTE mensaje desistiera, y la espera completa la pagaba
      // el envio siguiente dentro de esperarTurno(), con el barrido detenido.
      // Medido: retry_after=1800 congelaba la corrida 30 minutos pese a que el
      // tope declarado son 70 s.
      if (global) pausaGlobalHasta = Math.max(pausaGlobalHasta, reloj.ahora() + Math.min(esperaMs, tope) + 1000);
      if (intentos429 > max429 || esperaMs > tope) {
        console.error(`Fallo el envio a Discord: 429, espera ${esperaMs} ms (intentos ${intentos429}). Queda para el resumen final.`);
        return { ok: false, status: 429, motivo: "429" };
      }
      await reloj.dormir(esperaMs + 300);
      continue;
    }

    if (res.status >= 500) {
      intentosRed += 1;
      if (intentosRed > maxRed) {
        console.error(`Fallo el envio a Discord: ${res.status} tras ${intentosRed} intentos`);
        return { ok: false, status: res.status, motivo: "5xx" };
      }
      await reloj.dormir(backoff * 2 ** (intentosRed - 1));
      continue;
    }

    // 400/401/403/404: el cuerpo esta mal armado o el webhook murio. Reintentar
    // solo gasta el cupo de peticiones invalidas (10.000/10 min POR IP, y la IP
    // del runner de Actions es compartida con miles de trabajos ajenos).
    let detalle = "";
    try {
      detalle = typeof res.text === "function" ? await res.text() : "";
    } catch {
      /* da igual: lo importante es no reintentar */
    }
    console.error(`Fallo el envio a Discord: ${res.status} ${detalle}`);
    return { ok: false, status: res.status, motivo: "permanente", permanente: true };
  }
}

/**
 * Envia UN mensaje. Nunca lanza: devuelve {ok, status, permanente}.
 * El scraping es lo mas valioso de la corrida; Discord no puede abortarla.
 */
export async function enviarMensaje(webhookUrl, content) {
  if (!webhookUrl) return { ok: false, status: 0, motivo: "sin-webhook", permanente: true };
  return enCola(() => enviarConReintentos(webhookUrl, content));
}

/** Solo para pruebas: vuelve a dejar el cubo de fichas y la pausa global en cero. */
export function reiniciarRitmo() {
  fichas = null;
  ultimaRecarga = reloj.ahora();
  pausaGlobalHasta = 0;
  cola = Promise.resolve();
}

// Discord corta cada mensaje en 2000 caracteres. En vez de truncar y perder
// cambios, se arman varios mensajes seguidos -- ninguna novedad se pierde.
//
// Ademas de los textos se devuelve QUE cambio viaja en cada mensaje. Sirve para
// saber exactamente que quedo sin entregar cuando Discord rechaza uno de los
// mensajes: sin ese dato, un fallo parcial obligaba a reintentar todo (y
// duplicar lo que si llego) o a no reintentar nada (y perderlo en silencio).
// @param secciones [tipo, items[]] con item = {linea, cambio?}
export function armarMensajesConCambios(encabezado, secciones) {
  const LIMITE = 1900;
  const mensajes = [];
  let actual = encabezado;
  let grupo = [];

  // UN ITEM PUEDE LLEVAR VARIOS CAMBIOS (2026-10-05): la linea que resume la
  // cola de una seccion recortada ("…y 49 más: 20 televisores…") viaja con TODOS
  // los cambios que resume, para que un mensaje rechazado por Discord los
  // devuelva enteros a pendientes.jsonl en vez de perderlos.
  const agregarLinea = (linea, cambios) => {
    if ((actual + "\n\n" + linea).length > LIMITE) {
      mensajes.push({ texto: actual, cambios: grupo });
      actual = linea;
      grupo = [];
    } else {
      actual += "\n\n" + linea;
    }
    if (cambios) grupo.push(...cambios);
  };

  for (const [tipo, items] of secciones) {
    if (items.length === 0) continue;
    // el conteo de la seccion es el de los CAMBIOS, no el de las lineas: una
    // seccion recortada tiene menos lineas que cambios
    const total = items.reduce((n, i) => n + (i.cambios?.length ?? (i.cambio ? 1 : 0)), 0) || items.length;
    agregarLinea(`**${TITULOS[tipo]} (${total})**`);
    for (const item of items) agregarLinea(item.linea, item.cambios ?? (item.cambio ? [item.cambio] : null));
  }

  mensajes.push({ texto: actual, cambios: grupo });
  return mensajes;
}

/** Igual, pero con la firma vieja (secciones de puros textos). */
export function armarMensajes(encabezado, secciones) {
  const conItems = secciones.map(([tipo, lineas]) => [tipo, lineas.map((linea) => ({ linea }))]);
  return armarMensajesConCambios(encabezado, conItems).map((m) => m.texto);
}

// ---------------------------------------------------------------------------
// AVISOS EN VIVO: tandas cortas mientras la revision todavia esta corriendo
// ---------------------------------------------------------------------------

// Descuento de una baja, en porcentaje (0 para cualquier otro tipo de cambio).
function pctBaja(cambio) {
  if (cambio.tipo !== "baja") return 0;
  const { precio, precioAnterior } = cambio;
  if (!Number.isFinite(precio) || !Number.isFinite(precioAnterior) || precioAnterior === 0) return 0;
  return ((precioAnterior - precio) / precioAnterior) * 100;
}

// Dentro de una tanda el orden es por OPORTUNIDAD, no por tipo: la tanda tipica
// trae 1-6 lineas y meterle encabezados de seccion ("🟢 Bajas de precio (2)")
// seria mas ruido que informacion. El emoji de cada linea ya dice el tipo.
function rangoOportunidad(c) {
  if (c.tipo === "baja") return 0;
  if (c.tipo === "stock") return c.disponible ? 1 : 4; // volver a haber stock vale mas que agotarse
  if (c.tipo === "nuevo") return 2;
  if (c.tipo === "sube") return 3;
  if (c.tipo === "recuperado") return 5;
  return 6;
}

export function ordenarPorOportunidad(cambios) {
  return [...cambios].sort((a, b) => rangoOportunidad(a) - rangoOportunidad(b) || pctBaja(b) - pctBaja(a));
}

// Umbral del 🔥, calibrado con el historial real: la baja mediana es 12,5% y el
// 41% de las bajas son >= 15%. Marcar todo no marca nada.
function destacar(cambio) {
  return pctBaja(cambio) >= conf("VIVO_UMBRAL_FUEGO", 15);
}

function lineaVivo(cambio, limiteLinea) {
  const linea = (destacar(cambio) ? "🔥 " : "") + lineFor(cambio);
  return linea.length > limiteLinea ? `${linea.slice(0, limiteLinea - 1)}…` : linea;
}

/**
 * Reparte los cambios de una tanda en mensajes bajo el limite de Discord,
 * devolviendo QUE cambios viajan en cada mensaje: si el segundo mensaje falla,
 * solo sus cambios quedan sin confirmar y vuelven al resumen final.
 * El encabezado se repite en cada mensaje: cada uno tiene que poder leerse solo.
 */
export function empaquetarCambios(encabezado, cambios, limite = 1850) {
  const paquetes = [];
  let texto = encabezado;
  let grupo = [];

  for (const cambio of ordenarPorOportunidad(cambios)) {
    const linea = lineaVivo(cambio, Math.max(200, limite - encabezado.length - 2));
    if (grupo.length > 0 && (texto + "\n\n" + linea).length > limite) {
      paquetes.push({ texto, cambios: grupo });
      texto = `${encabezado}\n\n${linea}`;
      grupo = [cambio];
    } else {
      texto += `\n\n${linea}`;
      grupo.push(cambio);
    }
  }
  if (grupo.length > 0) paquetes.push({ texto, cambios: grupo });
  return paquetes;
}

/**
 * Envia una tanda de avisos en vivo. Devuelve QUE cambios quedaron confirmados
 * con un 2xx de Discord: solo esos se dan por avisados. Nunca lanza.
 */
export async function enviarTandaVivo(webhookUrl, cambios, { encabezado = "", limite } = {}) {
  if (!webhookUrl || cambios.length === 0) {
    return { confirmados: [], fallidos: [], mensajes: 0, permanente: !webhookUrl };
  }
  const paquetes = empaquetarCambios(encabezado, cambios, limite);
  const confirmados = [];
  const fallidos = [];
  let permanente = false;

  for (const paquete of paquetes) {
    const r = await enviarMensaje(webhookUrl, paquete.texto);
    if (r.ok) {
      confirmados.push(...paquete.cambios);
    } else {
      fallidos.push(...paquete.cambios);
      if (r.permanente) permanente = true;
    }
  }
  return { confirmados, fallidos, mensajes: paquetes.length, permanente };
}

/**
 * @param correcciones [{aviso, actual}] avisos que salieron en vivo y que la
 *        revision completa NO confirmo (ver lineaCorreccion)
 * @param pendientes cambios que la revision ANTERIOR detecto pero que Discord
 *        nunca acepto (ver data/pendientes.jsonl en run.mjs)
 * @param detectados cuantos cambios de productos vigilados detecto la revision
 *        ANTES del filtro de notificacion del operador (src/solo-bajas.mjs).
 *        Omitirlo deja el encabezado como estaba.
 * @returns {{mensajes, fallidos, noEntregados}} noEntregados son los cambios que
 *        viajaban en los mensajes que Discord rechazo: run.mjs los persiste para
 *        que la corrida siguiente los vuelva a intentar.
 */
export async function notifyDiscord(webhookUrl, { changes, errores, totalRevisado, avisadosEnVivo = 0, correcciones = [], pendientes = [], detectados = null }) {
  if (!webhookUrl) {
    console.log("DISCORD_WEBHOOK_URL no configurado, no se envia notificacion.");
    return { mensajes: 0, fallidos: 0, noEntregados: [...(pendientes ?? []), ...(changes ?? [])] };
  }
  // sin novedades, no molestar. Pero si la corrida YA mando avisos en vivo, el
  // cierre se manda igual aunque no quede nada nuevo: es la unica senal de que
  // la revision termino y de cuantos cambios hubo en total. Una correccion o un
  // aviso atrasado tambien obligan a mandarlo.
  if (changes.length === 0 && avisadosEnVivo === 0 && correcciones.length === 0 && pendientes.length === 0) {
    return { mensajes: 0, fallidos: 0, noEntregados: [] };
  }

  const porTipo = { nuevo: [], baja: [], sube: [], stock: [], recuperado: [], desaparecido: [], rebote: [] };
  // los matices se juntan como CAMBIOS (no como lineas): su seccion se arma
  // despues, porque lleva tope y resumen por categoria
  const matices = { matiz: [], matizVuelve: [] };
  // UN REBOTE SE AGRUPA POR SER REBOTE, NO POR SU TIPO. Si fuera por tipo, el
  // vaiven del monitor quedaria repartido entre "Bajas de precio" y "Subas de
  // precio" y volveria a leerse como la seguidilla "bajo/subio/bajo/subio" que
  // el operador reclamo.
  //
  // Y un MATIZ entre dos formas de "no se puede comprar" tiene su propia
  // seccion, no la de los rebotes: no es un vaiven -- es un cambio real del
  // sitio -- y meterlo bajo "ya te los avise" seria falso (2026-10-05).
  for (const c of changes) {
    if (esRebote(c)) porTipo.rebote.push({ linea: lineaRebote(c), cambio: c });
    else if (esMatiz(c)) (esMatizQueVuelve(c) ? matices.matizVuelve : matices.matiz).push(c);
    else (porTipo[c.tipo] ?? porTipo.nuevo).push({ linea: lineFor(c), cambio: c });
  }

  // El conteo tiene que declarar la corrida COMPLETA, no la lista ya
  // deduplicada: si no, una corrida con 237 cambios de los que 229 salieron en
  // vivo diria "8 cambios" y el operador creeria que se perdio algo.
  // `avisadosEnVivo` lo calcula run.mjs contando los cambios que comparar() SI
  // emitio y que se omiten por haber salido ya: cuenta tambien los heredados de
  // una corrida muerta, y no cuenta los avisos en vivo que la revision termino
  // desmintiendo (esos van en su propia seccion de correcciones).
  //
  // Y LOS AVISOS ATRASADOS CUENTAN (2026-10-14, segunda vuelta, defecto medido):
  // un pendiente de data/pendientes.jsonl SE ENTREGA en este mismo mensaje, y no
  // estaba contado. Antes era un subconteo cosmetico; con la palabra "avisos" y
  // con la nota de la regla pegada debajo, pasaba a ser una contradiccion
  // abierta: el encabezado decia "0 avisos" y "por tu regla solo se avisan las
  // bajas de precio" justo encima de un bloque "BAJÓ DE PRECIO" entregado.
  const enEsteResumen = changes.length + pendientes.length;
  const totalCambios = enEsteResumen + avisadosEnVivo;
  const desglose = avisadosEnVivo > 0 ? ` (${avisadosEnVivo} ya avisados en vivo · ${enEsteResumen} en este resumen)` : "";
  const resumen = `Revisados ${totalRevisado} productos · ${totalCambios} ${totalCambios === 1 ? "aviso" : "avisos"}${desglose}${errores > 0 ? ` · ${errores} paginas con error` : ""}`;
  // EL CONTEO NO PUEDE MENTIR POR OMISION (2026-10-14). Este encabezado decia
  // "N cambios" cuando N es lo que se MANDO, y desde la regla del operador
  // (src/solo-bajas.mjs) eso ya no es lo que la revision detecto: en la semana
  // medida fueron 185 cambios detectados y 11 avisos. El operador leeria "11
  // cambios" y creeria que el sitio solo se movio 11 veces.
  //
  // Es exactamente la regla que el proyecto ya se habia fijado con los avisos en
  // vivo ("el conteo tiene que declarar la corrida COMPLETA, no la lista ya
  // deduplicada"), aplicada al filtro nuevo. La linea solo aparece cuando hay
  // algo que declarar: si no se filtro nada, no se dice nada.
  // `detectados` cuenta los cambios que ESTA revision detecto, asi que lo
  // silenciado se mide contra lo que ella misma entrego: sumarle los pendientes
  // (que son de otra corrida) haria parecer que la regla filtro uno menos.
  const silenciadosPorRegla = Number.isFinite(detectados) ? detectados - (changes.length + avisadosEnVivo) : 0;
  const nota = silenciadosPorRegla > 0
    ? `\n_(se detectaron ${detectados} cambios en total; por tu regla solo se avisan las bajas de precio — los demás quedaron registrados en el historial)_`
    : "";
  // "Todo lo detectado ya se avisó en vivo" solo puede salir cuando eso es
  // literalmente cierto: hubo avisos en vivo, no quedo nada por mandar, ninguno
  // se desmintio y no se arrastra nada de la revision anterior. Con una
  // correccion al lado, ese texto convertiria una alerta falsa en una
  // confirmacion; con un aviso atrasado, diria que se aviso algo que no.
  //
  // Y DESDE LA REGLA DEL OPERADOR HAY UN CUARTO CASO (2026-10-14, segunda
  // vuelta, defecto ALTO medido por los tres verificadores). Esta frase se
  // quedo igual mientras la linea de arriba empezaba a declarar lo detectado, y
  // asi el mismo mensaje afirmaba las dos cosas contradictorias, una debajo de
  // la otra: "_(se detectaron 15 cambios en total…)_" y "Todo lo detectado ya se
  // avisó en vivo" habiendo avisado 9. No era un caso raro: como las bajas salen
  // EN VIVO, lo normal es que `changes` quede vacio. Medido sobre
  // data/history.jsonl agrupado por corrida: **103 de las 437 corridas reales
  // (23,6%)** caen en esa combinacion, incluida la mas grande de la semana del
  // operador (la del 2026-10-07T22:28, 15 cambios y 9 bajas).
  //
  // No se borra la linea: es la unica senal de que la revision TERMINO. Se dice
  // lo que es cierto -- que lo avisado en vivo son todas las bajas --, y la nota
  // de arriba ya dice donde quedo el resto.
  const todoAvisado = avisadosEnVivo > 0 && changes.length === 0 && correcciones.length === 0 && pendientes.length === 0;
  const cierre = !todoAvisado
    ? ""
    : silenciadosPorRegla > 0
      ? "\n✅ Revisión terminada. Todas las bajas de precio ya se avisaron en vivo."
      : "\n✅ Revisión terminada. Todo lo detectado ya se avisó en vivo.";
  const encabezado = `**Monitor de precios Samsung Chile**\n${resumen}${nota}${cierre}`;

  const secciones = [
    // Las correcciones van PRIMERAS: desmienten un aviso que el operador ya
    // recibio y puede estar por ir a comprar.
    ["correccion", correcciones.map(({ aviso, actual }) => ({ linea: lineaCorreccion(aviso, actual) }))],
    ["pendiente", pendientes.map((c) => ({ linea: lineaPendiente(c), cambio: c }))],
    ["baja", porTipo.baja],
    ["sube", porTipo.sube],
    ["stock", porTipo.stock],
    // JUSTO DESPUES DE LOS CAMBIOS DE STOCK, y no al fondo: no es accionable hoy
    // -- el producto sigue sin stock -- pero esta MEDIDO que anticipa que se va a
    // poder comprar (9 de 23 lo tenian de vuelta en el evento siguiente, 6 a las
    // 8,4 h), asi que no es "lo que ya sabes" sino un aviso temprano.
    ["matizVuelve", itemsDeMatices(matices.matizVuelve)],
    ["recuperado", porTipo.recuperado],
    ["nuevo", porTipo.nuevo],
    ["desaparecido", porTipo.desaparecido],
    // ULTIMAS A PROPOSITO: son lo que el operador ya sabe (un rebote) o lo que
    // no le cambia nada (un matiz entre dos formas de no poder comprar). Van
    // despues de todo lo que si es novedad, para que no le tapen nada.
    ["rebote", porTipo.rebote],
    ["matiz", itemsDeMatices(matices.matiz)],
  ];

  const mensajes = armarMensajesConCambios(encabezado, secciones);
  let fallidos = 0;
  const noEntregados = [];
  for (const mensaje of mensajes) {
    const r = await enviarMensaje(webhookUrl, mensaje.texto);
    if (!r.ok) {
      fallidos += 1;
      noEntregados.push(...mensaje.cambios);
    }
  }
  if (fallidos > 0) console.error(`WARNING ${fallidos} de ${mensajes.length} mensajes del resumen final no llegaron a Discord`);
  return { mensajes: mensajes.length, fallidos, noEntregados };
}

// alerta tecnica (corrida sospechosa, error critico): un solo mensaje simple
/**
 * AVISO TECNICO DE PRECIOS CORREGIDOS DE ORIGEN (migracion versionPrecio).
 *
 * El precio guardado era el TACHADO o el numero INTERNO de digitalData, no lo
 * que se cobra, asi que corregirlo NO es un cambio del sitio y no puede salir
 * como aviso de precio: seria una tanda de "bajo 26%" por productos que nunca
 * bajaron (medido sobre el catalogo real: 420 SKU).
 *
 * PERO TAMPOCO SE CALLA. Desde UNA sola lectura no hay forma de distinguir "el
 * guardado estaba mal" de "este producto acaba de estrenar oferta y su precio de
 * ayer es el tachado de hoy": los dos casos se ven identicos. Callarse del todo
 * se tragaba bajas reales enteras y sin segunda oportunidad (versionPrecio queda
 * sellado). Aca quedan, con los dos numeros y las bajas primero.
 */
/**
 * EL TOPE DEJA DE SER UN NUMERO FIJO (2026-09-13 tarde, defecto medido).
 *
 * Este mensaje es la unica forma que tiene el operador de enterarse de que una
 * oferta REAL que estreno hoy se fue por el canal tecnico en vez de salir como
 * baja (ver HORAS_MAX_MIGRACION_PRECIO en src/comparar.mjs: desde una sola
 * lectura los dos casos son indistinguibles). Con las 15 lineas de antes, la
 * mayor ola simultanea que registra data/history.jsonl -- 206 bajas en UNA
 * corrida, el 2026-09-09T16:56 -- se veia como "…y 191 más", que es exactamente
 * no enterarse.
 *
 * Subirlo a un numero fijo mas grande no alcanzaba, y lo cazo la prueba: con los
 * modelos reales del catalogo cada linea mide ~50 caracteres
 * (`• 🟢 SM-X520NLBACHO-123: $1.999.990 → $1.799.990`) y 40 lineas se pasan del
 * limite de 1900 que aplica notifyTecnico, que ademas corta con `slice` -- o sea
 * que se perderia el "…y N más" y el pie, y el mensaje quedaria mintiendo por
 * omision sin decirlo. Asi que el tope es el PRESUPUESTO: se llenan tantas
 * lineas como quepan y el maximo duro queda como red de seguridad. Con los
 * modelos mas largos entran ~25; con los cortos, muchas mas.
 */
const LARGO_MAX_TECNICO = 1900;

export function mensajeCorreccionesDePrecio(correcciones, tope = 60) {
  const lista = correcciones ?? [];
  if (lista.length === 0) return null;
  const esBaja = (c) => Number.isFinite(c.precio) && Number.isFinite(c.precioAnterior) && c.precio < c.precioAnterior;
  // El desempate por modelo NO es cosmetico: sin el, entre dos correcciones del
  // mismo tipo mandaba el orden de llegada, o sea el orden del recorrido, y
  // CUALES 15 ve el operador cambiaba al reordenar las paginas (medido en la
  // revision del 2026-09-12).
  const ordenadas = [...lista].sort(
    (a, b) => Number(esBaja(b)) - Number(esBaja(a)) || String(a.modelo).localeCompare(String(b.modelo)),
  );
  const todas = ordenadas.map(
    (c) => `• ${esBaja(c) ? "🟢" : "🔴"} ${c.modelo}: ${fmt(c.precioAnterior)} → ${fmt(c.precio)}`,
  );
  const armar = (n) => {
    const resto = todas.length > n ? `\n…y ${todas.length - n} más.` : "";
    return (
      `🔧 **Monitor Samsung — precios corregidos de origen**\n` +
      `${lista.length} producto(s) tenían guardado un número que no era el que se cobra (el precio tachado, o un valor interno que la página no muestra). **No bajaron ni subieron**: se estaba leyendo mal, y por eso no salen como aviso de precio.\n` +
      `${todas.slice(0, n).join("\n")}${resto}\n` +
      `Si alguno de estos era una oferta de verdad que estrenó hoy, acá se ve: desde una sola lectura el monitor no puede distinguir los dos casos.\n` +
      `Sale una sola vez por producto.`
    );
  };
  // Se llenan tantas lineas como quepan en el presupuesto: nunca se entrega un
  // mensaje que notifyTecnico vaya a cortar a la mitad (ver la nota de arriba).
  let n = Math.min(todas.length, tope);
  while (n > 1 && armar(n).length > LARGO_MAX_TECNICO) n -= 1;
  return armar(n);
}

/**
 * EL RASTRO DEL FRENO ANTI-PARPADEO (2026-09-13), por el canal TECNICO.
 *
 * El operador pidio explicitamente poder enterarse de que un producto quedo
 * marcado como inestable, "canal tecnico, no el de productos". Va ahi a
 * proposito: no es una novedad de Samsung, es una declaracion sobre la calidad
 * de la lectura -- el mismo lugar donde ya viven las momias y las correcciones
 * de precio.
 *
 * QUE TIENE QUE DECIR, y que la version anterior decia mal: que el producto se
 * sigue mirando, que sus avisos NO se perdieron (siguen saliendo, compactos, en
 * el resumen) y cada cuanto puede repetirse este mensaje. La version anterior
 * terminaba con "Sale una sola vez por producto" y era falso: medido sobre el
 * historial real, el monitor LS32DG300ELXZS habria generado 12 de estos avisos
 * en 30 dias, porque el episodio cierra y vuelve a abrir.
 *
 * ⚠️ Y SU TEXTO HABIA QUEDADO MINTIENDO (2026-10-14, segunda vuelta, defecto
 * medido por dos verificadores). Este mensaje sale por notifyTecnico, que la
 * regla del operador no filtra, asi que "no se toco una linea" -- pero prometia
 * en negrita "**No dejo de avisarte nada**" y "Una reposición nunca entra acá:
 * 'volvió el stock' sale siempre como alerta fuerte", y desde esa regla las dos
 * frases son falsas para todo lo que no sea una baja. Medido sobre
 * data/history.jsonl: de los 121 rebotes de productos vigilados del historial,
 * **101 (82 de stock + 19 subas) ya no llegan al canal de productos** y solo las
 * 20 bajas siguen saliendo; en la semana del operador los 16 rebotes son los 16
 * de stock, o sea que este aviso llegaba anunciando una linea compacta que no
 * existia. El texto queda acotado a lo que es cierto y nombra la regla. Una
 * prueba exige que el texto y `esNotificable` no se puedan contradecir.
 *
 * Mismo presupuesto de largo que los otros avisos tecnicos: notifyTecnico corta
 * con `slice` y un mensaje cortado pierde el pie.
 */
export function mensajeRebotando(rebotando, tope = 60) {
  const lista = rebotando ?? [];
  if (lista.length === 0) return null;
  // orden estable: no puede depender de por donde empezo el recorrido
  const ordenadas = [...lista].sort(
    (a, b) => String(a.magnitud).localeCompare(String(b.magnitud)) || String(a.modelo).localeCompare(String(b.modelo)),
  );
  // LO QUE SE RECUERDA DE CADA MAGNITUD NO ES LO MISMO (2026-10-05): del precio
  // se recuerdan VALORES y del stock, CRUCES de la frontera comprable/no
  // comprable.
  //
  // Y LA LINEA DE STOCK IMPRIME EL ESTADO DE AHORA, NO SOLO LOS CRUCES (defecto
  // medido en la segunda vuelta). Un cruce guardado dice "esto ya te lo avise",
  // no "asi esta el producto": con una sola llave en la memoria -- que es el caso
  // normal desde que la reposicion no se degrada -- la linea quedaba en una
  // afirmacion pelada ("no se puede comprar") que podia ser FALSA. Medido
  // replayando el historial completo contra el catalogo al lado: 8 avisos
  // tecnicos ENTREGABLES lo decian de un producto que el catalogo daba por
  // DISPONIBLE (NP750XGJ-KS6CL 24/25/26-08, NP750XGJ-KS4CL 10 y 11-09,
  // SM-A366ELVGLTL 16 y 17-09, SM-A276BZBKLTL 02-10), y los 8 van en la
  // direccion que cuesta plata: le dicen que no puede comprar algo que si puede.
  // El estado real ya viajaba en el mismo item (`valor`, o sea `rec.estadoStock`)
  // y no se imprimia.
  const cruce = (v) => {
    if (v === LADO.COMPRABLE) return "volvió el stock";
    if (v === LADO.NO_COMPRABLE) return "se agotó";
    return textoEstado(v);
  };
  const todas = ordenadas.map((i) => {
    if (i.magnitud === "precio") {
      return `• 💲 ${i.modelo}: ${(i.valores ?? []).map((v) => fmt(v)).join(" ⇄ ")}`;
    }
    const estado = typeof i.valor === "string" && i.valor ? textoEstado(i.valor) : "sin leer";
    const cruces = (i.valores ?? []).map(cruce).join(" / ");
    return `• 📦 ${i.modelo}: ahora **${estado}**${cruces ? ` · ya avisados: ${cruces}` : ""}`;
  });
  const armar = (n) => {
    const resto = todas.length > n ? `\n…y ${todas.length - n} más.` : "";
    return (
      `🌀 **Monitor Samsung — productos que están rebotando**\n` +
      `${lista.length} producto(s) volvieron a algo que ya habían tenido hace poco: un precio ya visto hace menos de ${VENTANA_REBOTE_HORAS} h, o un segundo "se agotó" en menos de ${VENTANA_QUIEBRE_HORAS} h. Eso es un vaivén, no una novedad.\n` +
      `${todas.slice(0, n).join("\n")}${resto}\n` +
      `**De las bajas de precio no dejo de avisarte nada**: mientras rebotan, sus avisos salen juntos en una línea compacta al final del resumen (sección "Siguen rebotando"), con el precio de ahora y diciendo que es una baja. Una baja a un precio NUEVO vuelve a salir como alerta normal al instante.\n` +
      `De los cambios de STOCK y de las subas de precio no te llega nada desde tu regla del 2026-10-14 (solo se avisan las bajas): se siguen midiendo y quedan en el historial.\n` +
      `Este aviso sale una vez por episodio de rebote; si el vaivén dura más de una semana, puede repetirse.`
    );
  };
  let n = Math.min(todas.length, tope);
  while (n > 1 && armar(n).length > LARGO_MAX_TECNICO) n -= 1;
  return armar(n);
}

/**
 * EL PULSO DEL DIA, por el canal TECNICO (2026-10-14, segunda vuelta).
 *
 * POR QUE EXISTE: la nota del encabezado ("se detectaron N cambios en total")
 * solo sale si hay mensaje de cierre, y notifyDiscord corta temprano cuando no
 * hay nada que mandar -- justo el caso de una corrida con cambios detectados y 0
 * bajas. Medido sobre data/history.jsonl agrupado por corrida: **283 de las 437
 * corridas reales (64,8%) no mandarian NI UN mensaje** al canal de productos, y
 * esas 283 contienen 11.348 cambios detectados; en la semana del operador son
 * **64 de 67 corridas mudas con 168 cambios dentro**. O sea que la unica red
 * contra "el detector de precios se rompio y nadie se entera" vivia en
 * data/ejecuciones.jsonl, que el operador no lee.
 *
 * ES UNA LINEA AL DIA y va por el canal tecnico -- el que el operador no pidio
 * filtrar --, con el freno de una vez al dia por clave que ya existe
 * (src/avisos-repetidos.mjs). Mandar el resumen de cierre en cada corrida
 * deshacia el encargo: son 20 revisiones diarias.
 *
 * LO QUE TIENE QUE PERMITIR DISTINGUIR, y es la unica razon de que traiga los
 * DOS numeros: "el sitio no se movio" (detectados ~0) de "el sitio se movio y no
 * hubo ninguna baja" (detectados alto, avisados 0) de "el detector se rompio"
 * (detectados ~0 varios dias seguidos).
 */
export function mensajePulsoDeLaRegla({ horas = 24, corridas = 0, conDato = 0, detectados = 0, avisados = 0 } = {}) {
  const n = (x) => new Intl.NumberFormat("es-CL").format(x);
  const revisiones = corridas === 1 ? "1 revisión" : `${n(corridas)} revisiones`;
  // Las filas escritas antes del 2026-10-14 no traen los dos contadores. Sumar 0
  // por ellas haria que el primer dia se leyera como un detector roto, asi que
  // se dice cuantas filas pudieron contarse.
  const base = conDato < corridas ? ` (${n(conDato)} de ellas con el dato nuevo; las otras son de antes de la regla)` : "";
  const avisadosTexto = avisados === 1 ? "**1 aviso de baja de precio**" : `**${n(avisados)} avisos de baja de precio**`;
  const sospecha =
    detectados === 0
      ? `\n⚠️ **Cero cambios detectados en ${horas} h.** Eso casi nunca pasa: si se repite mañana, lo que está roto es el detector y no la regla — mirar los logs de las últimas corridas en GitHub Actions.`
      : "";
  return (
    `📊 **Monitor Samsung — pulso del día**\n` +
    `Últimas ${horas} h, ${revisiones}${base}: **${n(detectados)} cambios detectados** en el sitio y ${avisadosTexto} enviados.\n` +
    `El resto (subas de precio, stock, productos nuevos, desaparecidos) se sigue midiendo y queda en el historial: por tu regla del 2026-10-14 solo se avisan las bajas.${sospecha}\n` +
    `Esta línea existe para que una semana sin bajas se distinga de un monitor roto. Sale una vez al día y no es un aviso de producto.`
  );
}

/**
 * @returns {{entregado: boolean}} `entregado:false` SOLO cuando habia webhook y
 *   Discord rechazo el mensaje. Es lo que permite que quien lleva la huella de
 *   "este aviso ya salio" no la escriba y la corrida siguiente lo reintente:
 *   antes el resultado se descartaba, y un hipo de Discord borraba el aviso para
 *   siempre (defecto confirmado el 2026-09-13). Sin webhook no hay nada que
 *   reintentar, asi que cuenta como entregado.
 */
export async function notifyTecnico(webhookUrl, texto) {
  if (!webhookUrl) {
    console.log("DISCORD_WEBHOOK_URL no configurado, no se envia alerta tecnica.");
    return { entregado: true };
  }
  const r = await enviarMensaje(webhookUrl, texto.slice(0, 1900));
  return { entregado: r?.ok === true };
}
