// ¿DE QUIEN ES ESTE PRODUCTO? Regla de propiedad y precedencia entre paginas.
//
// EL PROBLEMA MEDIDO (2026-09-11)
// La pagina del Galaxy S25 FE 512GB
// (.../galaxy-s/galaxy-s25-fe-navy-512gb-sm-s731bdbpltl/buy/) producia en el
// catalogo 4 SKU que NO son S25 FE sino S25 normal (SM-S931B*, todos a
// $1.069.990). Lo mismo pasaba con el TV The Frame 55" (emitia el SKU del 50") y
// con el refrigerador RS5300T gris (emitia el SKU del negro).
//
// LA CAUSA REAL, verificada cargando las paginas: son REDIRECCIONES. Cuando
// Samsung deja de vender una ficha, la redirige a la de un hermano:
//   ls03f-55-inch-...-qn55ls03fagxzs/  ->  ls03f-50-inch-...-qn50ls03fagxzs/
//   rs5300t-...-natural-gray-rs60t5200s9-zs/ -> rs5300t-...-ebony-black-rs60t5200b1-zs/
//   galaxy-s25-fe-navy-512gb-sm-s731bdbpltl/buy/ -> galaxy-s25/buy/?modelCode=SM-S731BDBPLTL
// El monitor pedia la URL A, aterrizaba en la pagina B y anotaba el producto de
// B como si fuera de A. Como el producto de B TAMBIEN se captura desde su propia
// pagina, el mismo SKU entraba por dos caminos y ganaba el ultimo que escribia,
// con precios distintos (el reclamo nº 3 del operador).
//
// PERO OJO: una redireccion NO siempre significa "aterrice en la ficha de otro".
// Samsung tambien renombra slugs del MISMO producto:
//   rs5300t-large-capacity-22-cu-ft-ebony-black-rs60t5200b1-zs/
//     -> rs5300t-large-capacity-628l-ebony-black-rs60t5200b1-zs/
// Ahi el SKU servido es exactamente el que la URL pedida nombra, asi que el
// producto SI es de esta entrada. Por eso la regla mira las dos cosas.
//
// Y NO todas las paginas con varios SKU estan mal: Tab S9 FE, Tab A9, Book3,
// Book3 Pro y Z Fold7 agrupan variantes que pertenecen a esa familia y no tienen
// ficha propia. Verificado en vivo: esas cinco NO redirigen y su slug no nombra
// ningun SKU. Tienen que seguir en el catalogo.

/**
 * Rango de procedencia de un registro: cuanto vale lo que dice esta pagina sobre
 * este SKU. Gana el numero mas alto (ver integrarVariantes en src/catalogo.mjs).
 *
 *  PROPIA (3)    la ficha del propio SKU: el bloque de compra, el precio y el
 *                boton que ve el cliente son de ESTE producto. Es la unica
 *                fuente autoritativa de precio. Medido en el S25 FE: la ficha
 *                propia muestra $579.990 con boton "Comprar" mientras la pagina
 *                agrupada y su API dicen $829.990 para el mismo SKU.
 *  FAMILIA (2)   JSON-LD de una pagina /buy/: trae precio y disponibilidad por
 *                variante, pero es el precio de lista de la familia.
 *  AGRUPADA (1)  pagina que expone varios SKU sin ficha por SKU: el precio sale
 *                de la API y el bloque de compra es un selector de grupo que no
 *                se puede atribuir a ninguno.
 */
export const RANGO = { AGRUPADA: 1, FAMILIA: 2, PROPIA: 3 };

export const RANGO_POR_VIA = { individual: RANGO.PROPIA, familia: RANGO.FAMILIA, agrupada: RANGO.AGRUPADA };

/** Solo letras y numeros, en minusculas: "RS60T5200B1/ZS" y "rs60t5200b1-zs" son el mismo codigo. */
function soloAlfanumerico(texto) {
  return String(texto ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Identidad de una pagina: host + ruta, sin query, sin ancla, sin barra final y
 * en minusculas. La query se ignora a proposito: la redireccion del S25 FE
 * termina en ".../galaxy-s25/buy/?modelCode=SM-S731BDBPLTL" y lo que importa es
 * que la RUTA es otra.
 */
export function rutaDe(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    return `${u.host.toLowerCase()}${u.pathname.toLowerCase().replace(/\/+$/, "")}`;
  } catch {
    return String(url).toLowerCase().split(/[?#]/)[0].replace(/\/+$/, "");
  }
}

/**
 * ¿La navegacion termino en la misma pagina que se pidio?
 * Sin informacion (falta una de las dos URL) devuelve true: no hay EVIDENCIA de
 * redireccion y este modulo nunca descarta productos por falta de datos.
 */
export function mismaPagina(pedida, final) {
  const a = rutaDe(pedida);
  const b = rutaDe(final);
  if (!a || !b) return true;
  return a === b;
}

/**
 * ¿La URL pedida nombra a este SKU? Samsung pone el codigo al final del slug
 * ("...-navy-512gb-sm-s731bdbpltl/", "...-rs60t5200b1-zs/"). Se exigen al menos
 * 5 caracteres alfanumericos para que un codigo corto no calce por accidente.
 */
export function slugNombraSku(url, sku) {
  const s = soloAlfanumerico(sku);
  if (s.length < 5) return false;
  return soloAlfanumerico(url).includes(s);
}

/**
 * REGLA DE PROPIEDAD. De los SKU que esta pagina publica, ¿cuales le pertenecen
 * de verdad a la entrada que se pidio?
 *
 *  1. Si la URL pedida nombra a alguno de los SKU -> esos y solo esos. Cubre a la
 *     vez el slug renombrado (el refrigerador, que redirige pero sigue siendo el
 *     mismo producto) y la ficha que ademas lista a sus hermanos (el S25 FE
 *     512GB, cuyo digitalData trae "SM-S936BDBJLTL,SM-S931BDBJLTL,SM-S731BDBPLTL"
 *     y del que solo le corresponde el ultimo).
 *  2. Si no nombra a ninguno y la navegacion ATERRIZO EN OTRA PAGINA -> ninguno.
 *     Se pidio la ficha de un producto y Samsung entrego la de otro; ese otro
 *     producto ya se captura desde su propia pagina.
 *  3. Si no nombra a ninguno y no hubo redireccion -> todos. Son las paginas de
 *     grupo legitimas (Tab S9 FE, Tab A9, Book3, Book3 Pro, Z Fold7) y las
 *     fichas normales cuyo slug no repite el codigo.
 *
 * @returns {{propios: string[], ajenos: string[], motivo: string}}
 */
export function repartirPorPropiedad(urlPedida, urlFinal, skus) {
  const lista = (skus ?? []).filter(Boolean);
  const nombrados = lista.filter((s) => slugNombraSku(urlPedida, s));

  if (nombrados.length > 0) {
    return {
      propios: nombrados,
      ajenos: lista.filter((s) => !nombrados.includes(s)),
      motivo: "la URL nombra a su producto",
    };
  }
  if (!mismaPagina(urlPedida, urlFinal)) {
    return { propios: [], ajenos: lista, motivo: "redirigida a la ficha de otro producto" };
  }
  return { propios: lista, ajenos: [], motivo: "pagina servida tal cual se pidio" };
}
