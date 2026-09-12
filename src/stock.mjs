// ESTADO DE STOCK: una sola maquina de estados para todo el sistema.
//
// POR QUE EXISTE ESTE MODULO
// Hasta 2026-09-11 el stock se decidia asi (src/extract.mjs):
//     const disponible = !/agotado|no disponible|fuera de stock|sin stock/i.test(bodyText)
// o sea: cuatro palabras buscadas en el texto de TODA la pagina, y cualquier
// pagina que no las trajera quedaba "disponible" POR DEFECTO. Samsung marca el
// sin-stock con el boton "Avísame", que no esta en esa lista, asi que 894 de 928
// productos activos figuraban disponibles.
//
// MEDICIONES QUE DEFINEN ESTE MODULO (no repetirlas, ya estan hechas):
//  - Aspiradoras: el catalogo decia 15 disponibles de 17; en vivo solo 1 era
//    comprable, 15 mostraban "Avísame" y 1 "no está a la venta".
//  - Muestra de 42 productos (2 por categoria notificable): la regla vieja
//    acertaba 26 de 42 (62%) y los 16 errores iban TODOS en la misma direccion
//    (decia "disponible" sobre 13 agotados y 5 no-a-la-venta).
//  - La trampa: NO basta con agregar "Avísame" al texto de la pagina completa.
//    El TV F6000, que SI tiene stock, lo trae 2 veces en el carrusel "¿Buscas
//    alternativas?". Por eso la lectura se acota al BLOQUE DE COMPRA
//    (document.querySelector("[class*='buying']"), alternativa "[class*='pd-buy']").
//
// REGLA QUE NO SE NEGOCIA: "desconocido" NUNCA se convierte en "disponible" por
// defecto. Si no se sabe, el estado no cambia y no se notifica nada. Todo el
// costo de un falso "agotado" o un falso "volvio el stock" lo paga el operador
// en Discord, asi que ante la duda se calla (misma filosofia que las reglas
// anti-falsas-alertas de src/comparar.mjs).

export const ESTADO = {
  DISPONIBLE: "disponible",
  AGOTADO: "agotado",
  NO_A_LA_VENTA: "no-a-la-venta",
  DESCONOCIDO: "desconocido",
};

const VALIDOS = new Set(Object.values(ESTADO));

/**
 * Version del detector de stock. Viaja en cada observacion y se guarda en el
 * catalogo; comparar() la usa para re-establecer la linea base UNA vez por SKU
 * sin notificar (ver "re-establecimiento de linea base" en src/comparar.mjs).
 * Subir este numero vuelve a re-establecer la linea base de todo el catalogo:
 * hacerlo SOLO cuando cambie de verdad como se decide el estado.
 *   1 = regex sobre el texto de la pagina completa (hasta 2026-09-11)
 *   2 = bloque de compra acotado + API por SKU + JSON-LD (este modulo)
 */
export const VERSION_STOCK = 2;

// minusculas, sin tildes y con los espacios colapsados: la pagina puede
// renderizar "AVÍSAME" (text-transform), "Avísame" o "Avisame" segun el ancho.
function normalizar(texto) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // marcas de tilde combinantes
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// "no está a la venta" es una frase inequivoca: el producto existe pero Samsung
// no lo vende. No es lo mismo que agotado y el operador quiere distinguirlos.
const RE_NO_A_LA_VENTA = /no esta a la venta|no disponible para la venta|producto descontinuado/;

// Senales de que NO se puede comprar ahora. "avisame" es EL marcador real de
// Samsung (el boton que reemplaza a "Comprar" cuando no hay stock).
// OJO con "hasta agotar stock": es una frase promocional ("mientras duren las
// existencias") y aparece en paginas CON stock -- por eso los marcadores usan
// "agotado/agotada" (participio) y nunca el infinitivo "agotar".
const RE_SIN_STOCK = /avisame|notificarme cuando|agotado|agotada|agotados|agotadas|sin stock|fuera de stock|no disponible|out of stock|sold out/;

// Senales de que SI se puede comprar. Medidas en vivo: los celulares dicen
// "Comprar" o "Comprar ahora", y los TV / linea blanca "Agregar al carro".
const RE_COMPRABLE = /comprar|agregar al carro|anadir al carro|agregar al carrito|anadir al carrito|add to cart|lo quiero/;

// "Dónde comprar" NO es un boton de compra: es el buscador de tiendas fisicas
// que Samsung pone en los productos que no vende online. Medido el 2026-09-11 en
// el Flip Pro WM85B (Signage) y en el hub SmartThings ET-WV521BWEGCH: su bloque
// de compra dice exactamente "Dónde comprar" y nada mas. Sin sacarlo antes, la
// palabra "comprar" que lleva dentro los daba por disponibles -- justo el tipo
// de falso positivo que este modulo viene a eliminar.
//
// QUE ESTADO LE CORRESPONDE (corregido 2026-09-11, defecto 3 de la revision):
// antes esto devolvia "desconocido" y extractSingleProduct se caia enseguida a
// la API, que para estos productos responde outOfStock -- o sea que el catalogo
// terminaba diciendo "agotado" y la decision deliberada de callarse quedaba
// anulada una linea despues. Un producto que Samsung no vende online NO esta
// agotado: esta "no a la venta", que es exactamente lo que el cliente ve en
// pantalla. Al ser un estado comprometido ya no hay fallback a la API, asi que
// la API tampoco puede resucitarlos con un falso "volvio el stock".
const RE_DONDE_COMPRAR = /\bdonde comprar\b|\bwhere to buy\b/g;

// ---------------------------------------------------------------------------
// EL CTA, NO EL PARRAFO
//
// En las paginas /buy/ con plantilla "hubble" (Galaxy Z Flip7, Z Fold7, Tab S9
// FE...) el primer [class*='buying'] del documento NO es la barra de precio sino
// el Buying Tool entero, y ese contenedor arrastra el pie promocional de
// Samsung. Medido en vivo el 2026-09-11 en galaxy-z-flip7/buy/, su innerText
// incluye estas dos frases:
//     "¡Al comprar tu Galaxy Z Flip7!"
//     "Acumula puntos al comprar tus productos favoritos y luego paga con puntos"
// Buscar la palabra "comprar" ahi adentro devolvia DISPONIBLE para un producto
// que la API daba outOfStock, y ademas de forma NO deterministica (segun si el
// pie alcanzo a renderizarse): el mismo SKU alternaba entre disponible y agotado
// de una corrida a otra. Era el mismo falso positivo que este modulo vino a
// eliminar, mudado de la pagina entera al bloque.
//
// La defensa tiene tres capas, de la mas fuerte a la mas debil:
//  1. los BOTONES del bloque (lista `ctas`): se compara el texto COMPLETO del
//     boton contra un vocabulario cerrado, asi que ninguna frase de marketing
//     puede colarse. Es la unica capa deterministica.
//  2. las LINEAS del innerText: el CTA real ocupa su propia linea ("Agregar al
//     carro"); la prosa promocional, no.
//  3. el texto colapsado, despues de cortar el pie promocional y de descartar
//     los "comprar" que son verbo de una oracion y no un boton.
// Si ninguna decide, el estado es "desconocido" y manda la API por SKU.

// Texto COMPLETO de un boton. Anclado al inicio a proposito: "Dónde comprar"
// empieza por "donde" y no cae aca. Sin \b al final: entre "agregar al car" y
// la "r" de "carro" no hay frontera de palabra y el boton real se perdia.
const RE_CTA_COMPRA = /^(?:comprar|compralo|compra ahora|agregar al car|anadir al car|add to cart|lo quiero)/;
const RE_CTA_SIN_STOCK = /^(?:avisame|avisarme|notificame|notificarme|notify me)\b/;
const RE_CTA_TIENDA = /^(?:donde comprar|where to buy)\b/;

// Encabezados del pie promocional del Buying Tool, medidos en vivo. Todo lo que
// venga DESPUES de cualquiera de ellos es marketing, no el bloque de compra.
// Solo los encabezados MEDIDOS dentro del bloque. A proposito NO entra
// "¿Buscas alternativas?": ese carrusel esta fuera del bloque de compra, y
// tratarlo como pie haria que leer la pagina ENTERA diera un veredicto -- lo que
// esta prohibido justo por la trampa del F6000 (test/stock.test.mjs).
const RE_PIE_PROMOCIONAL = /\b(?:regalos y promociones|ventajes samsung\.com|ventajas samsung|samsung rewards|recicla y ahorra)\b/;

// "comprar" usado como VERBO de una oracion, no como boton: "al comprar tus
// productos", "beneficios de comprar mi dispositivo", "¡Al comprar tu Galaxy
// Z Flip7!". Se borra antes de buscar el boton.
const RE_COMPRAR_EN_PROSA =
  /\b(?:al|del|de|para|por|tras|sin|antes de|despues de|puedes|podras|quieres|quiero)\s+comprar\b|\bcomprar\s+(?:tu|tus|un|una|uno|mi|mis|el|la|los|las|este|esta|estos|estas|aqui|ahi|online|en linea|desde)\b/g;

function cortarPie(t) {
  const m = RE_PIE_PROMOCIONAL.exec(t);
  return m ? t.slice(0, m.index) : t;
}

// UN BLOQUE DE COMPRA DE VERDAD TRAE EL PRECIO (medido el 2026-09-12).
//
// En las fichas planas el CTA "Comprar"/"Comprar ahora" NO agrega al carro: es
// un ENLACE a la pagina /buy/ (href="/cl/.../buy/?modelCode=..."), a diferencia
// de "Agregar al carro", que es href="javascript:;". O sea que ese boton, por si
// solo, NO prueba que haya stock.
//
// Medido sobre los 6 productos de la muestra cuyo CTA es ese enlace, cargando
// tambien su pagina /buy/:
//   · 5 de 6 (Watch9, Watch8 40mm, A37, Tab S10 Lite, Book6 Pro) -> la /buy/
//     dice "Agregar al carro": hay stock y la ficha plana acertaba.
//   · 1 de 6, Galaxy Book4 NP750XGJ-KS4CL -> la /buy/ dice "Avísame": NO hay
//     stock y la ficha plana lo daba por disponible.
// Lo que separa los dos casos no es el boton, es el PRECIO. En los 5 correctos
// el bloque dice "Desde $ 33.333 en 12 cuotas sin intereses* o $399.990
// *Aplican condiciones Comprar ahora"; en el Book4 el bloque entero dice
// literalmente "Comprar ahora" y nada mas: cuando Samsung no puede vender, la
// barra suelta el precio y deja solo el enlace.
//
// Por eso un veredicto DISPONIBLE exige que el bloque traiga un precio. Si no lo
// trae, el bloque no decide y mandan las fuentes siguientes (barra de precio ->
// API por SKU). Solo se exige cuando de verdad se leyo el texto del bloque: la
// barra de precio se consulta sin texto y ahi no hay nada que mirar. El fallo es
// hacia "desconocido", que no cambia el estado ni notifica nada.
//
// NO se exige para "Avísame" ni para "no está a la venta": esos son decisivos
// venga o no venga el precio (el Book4 justamente trae precio Y "Avísame").
const RE_PRECIO_EN_BLOQUE = /\$\s?\d/;

/** ¿Alguna LINEA del bloque es, ella entera, un boton de compra? */
function algunaLineaEsCta(texto, regla) {
  return String(texto ?? "")
    .split(/\r?\n/)
    .map((l) => normalizar(l).replace(/[.:;,!?¡¿*]+$/, ""))
    .some((l) => l && regla.test(l));
}

/** Veredicto a partir de los textos de los BOTONES del bloque. null = no decide. */
function estadoDesdeBotones(botones) {
  const sin = botones.some((b) => RE_CTA_SIN_STOCK.test(b));
  const compra = botones.some((b) => RE_CTA_COMPRA.test(b));
  if (sin && compra) return ESTADO.DESCONOCIDO; // selector con una variante sin stock
  if (sin) return ESTADO.AGOTADO;
  if (compra) return ESTADO.DISPONIBLE;
  // el unico boton es el buscador de tiendas fisicas: Samsung no lo vende online
  if (botones.some((b) => RE_CTA_TIENDA.test(b))) return ESTADO.NO_A_LA_VENTA;
  return null;
}

/**
 * Estado a partir del BLOQUE DE COMPRA (no de la pagina entera).
 *
 * @param texto innerText del bloque, con sus saltos de linea.
 * @param ctas  textos completos de los BOTONES del bloque, cuando se pudieron
 *   leer. Es la senal fuerte: ver "EL CTA, NO EL PARRAFO" mas arriba.
 *
 * Ejemplos literales medidos en paginas reales:
 *   "Desde $ 48.333 en 12 cuotas sin intereses* o $579.990 Precio original:
 *    $829.990 Ahorra $ 250.000 *Aplican condiciones Comprar"      -> disponible
 *   "Desde $ 19.166 ... *Aplican condiciones Agregar al carro"     -> disponible
 *   "Desde $ 83.333 en 12 cuotas ... $999.990 *Aplican condiciones
 *    Avísame"                                                      -> agotado
 *   "no está a la venta"                                           -> no-a-la-venta
 *   "Dónde comprar"                                                -> no-a-la-venta
 *
 * Senales contradictorias (el bloque trae a la vez un boton de compra y un
 * "Avísame", ej. un selector de color donde una variante no tiene stock) dan
 * "desconocido" a proposito: es mejor no cambiar el estado que inventarlo.
 */
export function estadoDesdeBloqueCompra(texto, ctas = null) {
  const botones = (ctas ?? []).map(normalizar).filter(Boolean);

  // la frase inequivoca manda, venga del texto o de un boton
  const crudo = normalizar(texto);
  if (RE_NO_A_LA_VENTA.test(crudo) || botones.some((b) => RE_NO_A_LA_VENTA.test(b))) return ESTADO.NO_A_LA_VENTA;

  // ¿el bloque se leyo pero no trae precio? Entonces no es un bloque de compra,
  // es un enlace suelto a la pagina /buy/ y no puede declarar stock (ver
  // RE_PRECIO_EN_BLOQUE). Todo lo demas sigue decidiendo igual.
  const sinPrecio = typeof texto === "string" && crudo !== "" && !RE_PRECIO_EN_BLOQUE.test(texto);

  // CAPA 1: los botones (deterministica, inmune a la prosa promocional)
  const porBoton = estadoDesdeBotones(botones);
  if (porBoton === ESTADO.DISPONIBLE && sinPrecio) return ESTADO.DESCONOCIDO;
  if (porBoton) return porBoton;

  if (!crudo) return ESTADO.DESCONOCIDO;

  // CAPAS 2 y 3: el texto, sin el pie promocional
  const t = cortarPie(crudo);
  const sinStock = RE_SIN_STOCK.test(t);
  // el buscador de tiendas fisicas se descuenta antes de buscar el boton de
  // compra ("Dónde comprar" lleva la palabra adentro y no vende nada) y despues
  // se descartan los "comprar" que son verbo de una oracion promocional.
  const sinTienda = t.replace(RE_DONDE_COMPRAR, " ");
  const comprable =
    algunaLineaEsCta(cortarPie(String(texto ?? "")), RE_CTA_COMPRA) ||
    RE_COMPRABLE.test(sinTienda.replace(RE_COMPRAR_EN_PROSA, " "));
  if (sinStock && comprable) return ESTADO.DESCONOCIDO;
  if (sinStock) return ESTADO.AGOTADO;
  if (comprable) return sinPrecio ? ESTADO.DESCONOCIDO : ESTADO.DISPONIBLE;
  // el bloque se leyo, es legible, y lo unico que ofrece es el buscador de
  // tiendas fisicas: no esta a la venta online, que es lo que ve el cliente
  if (RE_DONDE_COMPRAR.test(t)) return ESTADO.NO_A_LA_VENTA;
  return ESTADO.DESCONOCIDO;
}

/**
 * Estado desde la respuesta que la PROPIA pagina le pide a api.shop.samsung.com
 * (no se hace ningun request extra: run.mjs solo escucha lo que el navegador ya
 * recibe). Medido: { stock: { stockLevelStatus: "inStock" | "outOfStock",
 * stockLevel: 24 } }. Es la unica fuente por SKU en las paginas que agrupan
 * varios productos, donde el bloque de compra es un selector de grupo y no se
 * puede atribuir a ningun SKU en particular.
 */
export function estadoDesdeApi(producto) {
  const crudo = producto?.stock?.stockLevelStatus ?? producto?.stockLevelStatus ?? null;
  const s = normalizar(crudo);
  if (!s) return ESTADO.DESCONOCIDO;
  if (s === "instock" || s === "lowstock") return ESTADO.DISPONIBLE;
  if (s === "outofstock") return ESTADO.AGOTADO;
  return ESTADO.DESCONOCIDO;
}

/**
 * Estado desde el JSON-LD (schema.org/Offer) de las paginas familia, que se
 * resuelven con fetch plano y no tienen bloque de compra que leer.
 */
export function estadoDesdeJsonLd(availability) {
  const s = normalizar(availability);
  if (!s) return ESTADO.DESCONOCIDO;
  if (s.includes("instock") || s.includes("limitedavailability")) return ESTADO.DISPONIBLE;
  if (s.includes("outofstock") || s.includes("soldout") || s.includes("backorder")) return ESTADO.AGOTADO;
  if (s.includes("discontinued")) return ESTADO.NO_A_LA_VENTA;
  return ESTADO.DESCONOCIDO; // PreOrder y cualquier valor nuevo: no se adivina
}

/** ¿Se puede comprar? true / false / null cuando no se sabe. */
export function disponibleDe(estado) {
  if (estado === ESTADO.DISPONIBLE) return true;
  if (estado === ESTADO.AGOTADO || estado === ESTADO.NO_A_LA_VENTA) return false;
  return null;
}

/**
 * Estado de UNA observacion, sea del detector nuevo (campo `estadoStock`) o del
 * viejo esquema (booleano `disponible`). Devuelve null cuando no se sabe, que es
 * lo que el resto del sistema entiende como "no cambies nada".
 */
export function estadoObservado(obs) {
  const explicito = obs?.estadoStock;
  if (typeof explicito === "string" && VALIDOS.has(explicito)) {
    return explicito === ESTADO.DESCONOCIDO ? null : explicito;
  }
  if (obs?.disponible === true) return ESTADO.DISPONIBLE;
  if (obs?.disponible === false) return ESTADO.AGOTADO;
  return null;
}

/** Texto para el operador (Discord). */
export function textoEstado(estado) {
  if (estado === ESTADO.DISPONIBLE) return "disponible";
  if (estado === ESTADO.AGOTADO) return "agotado";
  if (estado === ESTADO.NO_A_LA_VENTA) return "no está a la venta";
  return "desconocido";
}
