// POR DONDE EMPIEZA CADA REVISION. Un solo lugar para editar las categorias
// principales, y el reordenamiento del recorrido que las pone adelante.
//
// POR QUE EXISTE
// Los avisos salen EN VIVO, a medida que se recorren las paginas (ver
// src/despachador-vivo.mjs), asi que lo que se revisa primero es lo primero que
// el operador se entera. Hasta hoy el recorrido iba en el orden crudo del
// listado (src/seed.json, que esta ordenado alfabeticamente por categoria:
// "Accesorios linea blanca" primero, "Smartphones" en el puesto 24 de 28), asi
// que una baja de un Galaxy le llegaba al operador con hasta 2 horas de atraso.
// Medido sobre las dos ultimas corridas reales: 126 y 180 min para 1.183
// paginas, o sea 6,4 a 9,1 s por pagina contando la pausa de la politica.
//
// LO QUE ESTE MODULO NO HACE: no agrega, no saca ni cambia ninguna pagina. Solo
// las reordena. Que el RESULTADO no dependa del orden es lo que se verifica en
// test/orden-recorrido.test.mjs.
import { esFamiliaGenerica } from "./catalogo.mjs";
import { seccionDeUrl } from "./identidad.mjs";

// La seccion de una pagina (el tramo bajo /cl/) la define src/identidad.mjs,
// porque tambien la usa el desempate entre paginas del mismo rango. Se re-exporta
// aca para no cambiarle el import a quien ya la pedia a este modulo.
export { seccionDeUrl };

/**
 * Las categorias por las que el operador quiere que parta cada revision, EN SU
 * ORDEN. Esta es la lista para editar; no hay otra copia en el proyecto.
 *
 *  - `categoria` es el nombre EXACTO tal como viene en src/seed.json. El pedido
 *    del operador decia "Relojes" y "Computadoras"; los nombres reales del
 *    listado son "Relojes (Galaxy Watch)" y "Computadores".
 *  - `seccion` es el primer tramo de la URL bajo /cl/. Sirve para las paginas
 *    familia auto-descubiertas, que TODAS llegan con la categoria generica
 *    "Familia (auto-descubierta)" y cuya unica pista de a que seccion
 *    pertenecen es su URL.
 *
 * OJO con "Audio y Galaxy Buds": el listado tiene ADEMAS una categoria
 * "Audio (Soundbars/Torres)" (14 paginas) que el operador NO pidio. No comparten
 * seccion -- audio-sound contra audio-devices, verificado sobre las 1.023
 * paginas del listado --, asi que los soundbars no se cuelan por la puerta de
 * atras. Si el operador los quiere despues, se agregan aca una linea mas abajo.
 *
 * Tamanos medidos hoy (listado + paginas familia que ganaron el registro en
 * data/latest.json): Smartphones 91+94, Tablets 45+23, Audio y Galaxy Buds 14+0,
 * Relojes 18+31, Computadores 17+14. Son 185 paginas del listado de 1.023 (18%)
 * y del orden de 347 con las familia, o sea ~37 min del recorrido.
 */
export const CATEGORIAS_PRINCIPALES = [
  { categoria: "Smartphones", seccion: "smartphones" },
  { categoria: "Tablets", seccion: "tablets" },
  { categoria: "Audio y Galaxy Buds", seccion: "audio-sound" },
  { categoria: "Relojes (Galaxy Watch)", seccion: "watches" },
  { categoria: "Computadores", seccion: "computers" },
];

/**
 * ¿Esta entrada la trajo el descubrimiento por sitemap (src/discover.mjs) o el
 * listado? Se miran las dos marcas que deja discover.mjs -- el campo `tipo` y la
 * categoria generica -- para que renombrar una no deje la deteccion coja.
 */
function esDescubierta(entry) {
  return entry?.tipo === "familia" || esFamiliaGenerica(entry?.categoria);
}

/**
 * A que categoria principal pertenece una entrada, o -1 si no es de ninguna.
 *
 * PRIMERO EL NOMBRE DE LA CATEGORIA, DESPUES LA SECCION DE LA URL. El nombre es
 * el dato que el operador eligio; la seccion es el respaldo para las paginas
 * familia (que no traen categoria util) y, de yapa, la red de seguridad para el
 * dia en que el listado le cambie el nombre a una categoria: esas paginas
 * siguen entrando temprano por su URL mientras alguien corrige la lista.
 */
function indicePrincipal(entry) {
  const porNombre = CATEGORIAS_PRINCIPALES.findIndex((c) => c.categoria === entry?.categoria);
  if (porNombre !== -1) return porNombre;
  const seccion = seccionDeUrl(entry?.url);
  if (!seccion) return -1;
  return CATEGORIAS_PRINCIPALES.findIndex((c) => c.seccion === seccion);
}

/**
 * Reordena el recorrido: primero las categorias principales en el orden que
 * pidio el operador, despues todo lo demas.
 *
 * DENTRO DE CADA CATEGORIA PRINCIPAL VAN PRIMERO LAS PAGINAS DEL LISTADO Y
 * DESPUES LAS FAMILIA DE ESA MISMA SECCION. Las dos decisiones tienen una razon
 * medida:
 *
 *  1. Las familia entran en el bloque de SU categoria (y no en un bloque unico
 *     detras de las cinco). Medido sobre data/latest.json: de los 130 SKU que
 *     cuelgan de /smartphones/, 37 NO tienen ficha plana en el listado -- solo
 *     existen en una pagina familia. Con un bloque unico al final, "partir por
 *     Smartphones" habria cubierto 93 de sus 130 SKU y los otros 37 (los Galaxy
 *     S/Z/Fold nuevos, justo los del Cyber) habrian esperado detras de las 94
 *     paginas de listado de las otras cuatro categorias, del orden de 10 min.
 *     Lo mismo en Relojes (13 de 31) y Computadores (7 de 20). Lo que se pierde:
 *     la segunda categoria arranca mas tarde (Smartphones pasa de 91 a 185
 *     paginas), y en el log el bloque de cada categoria deja de ser un tramo
 *     puro del listado.
 *  2. Las familia van DESPUES del listado de su categoria, no intercaladas una a
 *     una. Esto no es cosmetico: hay 126 paginas /buy/ descubiertas cuya ficha
 *     plana TAMBIEN esta en el listado (116 SKU con las dos paginas del mismo
 *     rango), y para ese par el orden de llegada SI decide quien firma el
 *     registro. Intercalar de verdad exigiria inventar un emparejamiento URL a
 *     URL y podria poner el /buy/ delante de su ficha plana, que es exactamente
 *     el orden que produjo el defecto del 2026-09-12 (el precio de LISTA firmado
 *     como si fuera de la ficha propia, ver BITACORA.md).
 *
 * POR QUE EL REORDENAMIENTO NO CAMBIA NINGUN RESULTADO (el invariante de verdad,
 * corregido el 2026-09-12 tras la revision; antes aca decia algo que los
 * verificadores midieron y resulto FALSO).
 *
 * NO es cierto que "el listado va siempre antes que lo descubierto": medido
 * sobre el recorrido real (1.023 del listado + 162 familia), el reordenamiento
 * invierte 273.380 pares de paginas, y 146.246 de ellos son una pagina FAMILIA
 * de una seccion principal que pasa a ir ANTES de paginas del LISTADO de otras
 * categorias. Eso es a proposito: es justo lo que el operador pidio.
 *
 * Lo que de verdad sostiene el invariante son dos cosas, las dos medidas y las
 * dos vigiladas por una prueba:
 *
 *  a. TODAS esas inversiones son ENTRE SECCIONES DISTINTAS. Dentro de una misma
 *     seccion el reordenamiento no invierte NADA (medido: 0 de 273.380). Lo
 *     comprueba `inversionesIntraSeccion()` aca abajo, contra el listado real y
 *     tambien en cada corrida.
 *  b. Un empate entre paginas de secciones distintas ya no lo decide el orden:
 *     lo arbitra `ganaElEmpate()` (src/identidad.mjs), que mira cual de las dos
 *     nombra al SKU en su slug. Antes ganaba la ultima en llegar.
 *
 * La particion es ESTABLE por construccion (baldes + concat, sin comparador):
 * dentro de cada balde las entradas quedan en el orden en que llegaron, asi que
 * el mismo insumo da siempre el mismo recorrido.
 *
 * @param entries entradas ya deduplicadas (listado + familia), en su orden crudo
 * @returns {{recorrido: object[], paginasPrincipales: number,
 *            porCategoria: {categoria: string, listado: number, familia: number}[],
 *            ausentes: {categoria: string, seccion: string, paginasEnLaSeccion: number}[]}}
 */
export function ordenarRecorrido(entries) {
  const lista = entries ?? [];
  // dos baldes por categoria principal: [0] listado, [1] familia descubierta
  const baldes = CATEGORIAS_PRINCIPALES.map(() => [[], []]);
  const resto = [];

  for (const entry of lista) {
    const i = indicePrincipal(entry);
    if (i === -1) resto.push(entry);
    else baldes[i][esDescubierta(entry) ? 1 : 0].push(entry);
  }

  const principales = baldes.flat(2);

  // DENUNCIA DE CATEGORIAS QUE YA NO ESTAN. Una categoria principal que el
  // listado renombre o deje de traer no puede romper nada (las paginas siguen
  // recorriendose, solo cambia cuando) ni pasar callada (la promesa que se le
  // hizo al operador dejaria de cumplirse sin que nadie se entere). Se cuenta
  // por NOMBRE EXACTO y solo sobre las entradas del listado: las familia llegan
  // todas con la categoria generica y contarlas taparia justo la desaparicion.
  // `paginasEnLaSeccion` distingue los dos casos: > 0 es un RENOMBRE (las
  // paginas siguen ahi, hay que corregir el nombre en este archivo); 0 es que la
  // categoria de verdad ya no existe en el sitio.
  const ausentes = [];
  for (const { categoria, seccion } of CATEGORIAS_PRINCIPALES) {
    const enListado = lista.filter((e) => !esDescubierta(e) && e?.categoria === categoria).length;
    if (enListado > 0) continue;
    ausentes.push({ categoria, seccion, paginasEnLaSeccion: lista.filter((e) => seccionDeUrl(e?.url) === seccion).length });
  }

  return {
    recorrido: [...principales, ...resto],
    paginasPrincipales: principales.length,
    porCategoria: CATEGORIAS_PRINCIPALES.map((c, i) => ({
      categoria: c.categoria,
      listado: baldes[i][0].length,
      familia: baldes[i][1].length,
    })),
    ausentes,
  };
}

/**
 * EL GUARDIAN DEL INVARIANTE (2026-09-12). Pares de paginas de la MISMA SECCION
 * cuyo orden relativo cambia al reordenar.
 *
 * Por que la misma seccion: dos paginas que hablan del mismo producto viven
 * siempre bajo la misma seccion (medido: de los 1.031 SKU del catalogo, 115 los
 * publica mas de una pagina y NINGUNO desde dos secciones distintas). Mientras
 * el reordenamiento no invierta ningun par intra-seccion, no puede cambiar el
 * orden en que dos paginas escriben el mismo SKU -- y por lo tanto no puede
 * cambiar el resultado.
 *
 * Hoy da 0 sobre el recorrido real. Dejaria de dar 0 el dia en que una categoria
 * que NO es principal pase a vivir bajo una seccion que SI lo es (por ejemplo
 * "Accesorios moviles" mudandose a /smartphones/): sus paginas se irian al final
 * mientras las de la categoria principal se van al principio. Por eso se
 * comprueba en la prueba contra el listado real Y en cada corrida.
 *
 * Se miran solo los pares CONSECUTIVOS de cada seccion: una secuencia esta en
 * orden si y solo si lo estan todos sus pares consecutivos, asi que esto detecta
 * cualquier inversion (aunque no las liste todas).
 */
export function inversionesIntraSeccion(crudo, recorrido) {
  const pos = new Map((recorrido ?? []).map((e, i) => [e?.url, i]));
  const porSeccion = new Map();
  for (const e of crudo ?? []) {
    if (!e?.url) continue;
    const s = seccionDeUrl(e.url);
    if (!porSeccion.has(s)) porSeccion.set(s, []);
    porSeccion.get(s).push(e.url);
  }
  const encontradas = [];
  for (const [seccion, paginas] of porSeccion) {
    for (let i = 1; i < paginas.length; i++) {
      if (pos.get(paginas[i - 1]) > pos.get(paginas[i])) {
        encontradas.push({ seccion, antes: paginas[i - 1], ahora: paginas[i] });
      }
    }
  }
  return encontradas;
}

/**
 * EL SINTOMA OBSERVABLE de que el orden empezo a importar: un SKU que en la
 * corrida anterior estaba firmado por una pagina de una seccion y ahora lo firma
 * una de OTRA seccion.
 *
 * Paso de verdad una vez en 348 corridas (GP-TOS928SBEYW, el 2026-07-25: su
 * ficha de /mobile-accessories/ perdio contra una pagina de /tv-accessories/ y
 * volvio sola a la corrida siguiente). Con el desempate de src/identidad.mjs eso
 * ya no lo decide el orden, pero el aviso se queda igual: es la unica senal en
 * datos reales de que dos secciones empezaron a pelearse un SKU, y esa pelea es
 * la que habria que ir a mirar.
 *
 * Devuelve la lista ordenada por SKU, para que lo que se muestre no dependa del
 * orden del recorrido.
 */
export function skusQueCambiaronDeSeccion(previo, catalogo) {
  const cambios = [];
  for (const [modelo, rec] of Object.entries(catalogo ?? {})) {
    const antes = seccionDeUrl(previo?.[modelo]?.paginaOrigen);
    const ahora = seccionDeUrl(rec?.paginaOrigen);
    if (!antes || !ahora || antes === ahora) continue;
    cambios.push({ modelo, antes, ahora, paginaAntes: previo[modelo].paginaOrigen, paginaAhora: rec.paginaOrigen });
  }
  return cambios.sort((a, b) => (a.modelo < b.modelo ? -1 : a.modelo > b.modelo ? 1 : 0));
}

/**
 * TODO EL ARMADO DEL RECORRIDO, EN UNA FUNCION PURA. Junta listado y paginas
 * descubiertas, saca las URL repetidas, reordena y recorta.
 *
 * Vive aca y no adentro de main() porque src/run.mjs arranca main() al
 * importarse y por eso nada de lo que este ahi lo puede cubrir una prueba: los
 * verificadores mostraron que borrar `entries = recorrido` dejaba la suite
 * entera en verde con la funcionalidad apagada. Ahora el cableado es esta
 * funcion y se prueba directo.
 *
 *  - El reordenamiento va ANTES del recorte, a proposito: asi una corrida de
 *    prueba corta (LIMITE_PAGINAS) visita justo lo que el operador quiere ver
 *    primero, que es lo que hay que poder comprobar.
 *  - `paginasPrincipales` es el tamano REAL del bloque; `recorridasPrincipales`
 *    es cuantas de esas alcanza a visitar esta corrida. Confundirlos hacia que
 *    una corrida recortada informara un bloque mas chico y una duracion como si
 *    lo hubiera terminado (defecto medido en la revision del 2026-09-12).
 */
export function prepararRecorrido({ seedRaw = [], familyEntries = [], limite } = {}) {
  const vistas = new Set();
  const unicas = [...seedRaw, ...familyEntries].filter((e) => e?.url && !vistas.has(e.url) && vistas.add(e.url));
  const { recorrido, paginasPrincipales, porCategoria, ausentes } = ordenarRecorrido(unicas);
  const tope = Number(limite);
  const entries = Number.isFinite(tope) && tope > 0 ? recorrido.slice(0, tope) : recorrido;
  return {
    entries,
    paginasPrincipales,
    recorridasPrincipales: Math.min(paginasPrincipales, entries.length),
    bloquePrincipalCompleto: entries.length >= paginasPrincipales,
    porCategoria,
    ausentes,
    inversiones: inversionesIntraSeccion(unicas, recorrido),
  };
}

/**
 * Los campos con que cada corrida le rinde cuentas al operador sobre la promesa
 * "primero las categorias principales": cuantas paginas tenia ese bloque y
 * cuanto tardo en terminarlo. Va aca y no en run.mjs para que los nombres de los
 * campos de data/ejecuciones.jsonl esten cubiertos por una prueba.
 *
 * `paginas` es el tamano REAL del bloque (`paginasPrincipales` de
 * prepararRecorrido), no cuantas se alcanzaron a visitar. `hasta` es null cuando
 * la corrida termino antes de completarlo (por ejemplo con LIMITE_PAGINAS mas
 * chico): entonces la duracion se informa null, que es distinto de 0 y no se
 * puede confundir con "tardo nada".
 *
 * Las dos cosas juntas son el punto: un resumen con
 * {paginasPrincipales: 347, duracionPrincipalesMin: null} dice "el bloque eran
 * 347 paginas y esta corrida no lo termino". Pasarle el numero ya recortado
 * hacia que dijera "eran 8 paginas y las termine en 1 minuto", que es mentira
 * con cara de verdad (defecto medido en la revision del 2026-09-12).
 */
export function medicionPrincipales({ paginas, desde, hasta }) {
  return {
    paginasPrincipales: paginas,
    duracionPrincipalesMin: hasta == null ? null : Math.round((hasta - desde) / 60000),
  };
}
