// FRENO PARA LOS AVISOS TECNICOS QUE SE REPITEN SOLOS.
//
// EL PROBLEMA (medido en la revision del 2026-09-12). Hay avisos tecnicos cuya
// condicion DURA: "una categoria principal ya no esta en el listado" sigue
// siendo cierta hasta que una persona edite src/prioridad.mjs. Sin freno, el
// aviso sale en CADA corrida: 7 mensajes identicos por dia, por el mismo canal
// donde llegan las momias y los precios corregidos, hasta que alguien lo arregle.
//
// El proyecto ya resolvio esto en otros lados con la regla "una sola vez por
// SKU" (avisadoSinVerificar, avisadoSinPrecio en src/comparar.mjs), pero ahi la
// huella vive en el catalogo. Estos avisos no cuelgan de ningun SKU, asi que
// necesitan su propio registro.
//
// LA REGLA ELEGIDA ES "UNA VEZ AL DIA POR CLAVE", no "una sola vez para
// siempre": una condicion que dura meses tiene que seguir recordandose, pero una
// vez al dia, no siete. Y si se arregla y vuelve a pasar, el aviso vuelve solo.
//
// El archivo es .jsonl y va por union en los conflictos de git (ver
// .gitattributes): ante un choque entre dos corridas, una huella de mas solo
// evita un aviso repetido.

/** Una linea por huella: {"clave":"...","dia":"2026-09-12"}. Lo ilegible se ignora. */
export function leerHuellas(texto) {
  return String(texto ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((h) => h && typeof h.clave === "string" && typeof h.dia === "string");
}

/** El dia (sin hora) de un timestamp ISO: la unidad en que se cuenta el freno. */
export function diaDe(timestamp) {
  return String(timestamp ?? "").slice(0, 10);
}

/** ¿Este aviso ya salio hoy? */
export function yaSeAviso(huellas, clave, dia) {
  return (huellas ?? []).some((h) => h.clave === clave && h.dia === dia);
}

/**
 * De las claves que hay que avisar, cuales todavia no salieron hoy. Se
 * devuelven en el orden en que llegaron, sin repetidas.
 */
export function clavesPorAvisar(huellas, claves, dia) {
  const nuevas = [];
  for (const clave of claves ?? []) {
    if (yaSeAviso(huellas, clave, dia) || nuevas.includes(clave)) continue;
    nuevas.push(clave);
  }
  return nuevas;
}

/**
 * El archivo que queda escrito: las huellas de hoy mas las de los ultimos
 * `diasQueSeGuardan` dias. Podar es lo que impide que el archivo crezca para
 * siempre; guardar varios dias (y no solo hoy) es lo que hace que el freno
 * sobreviva a una corrida que cruza la medianoche.
 *
 * Sin repetidas y ordenado: asi el diff de git es estable y no depende del orden
 * en que se agregaron.
 */
export function serializarHuellas(huellas, hoy, diasQueSeGuardan = 7) {
  const limite = new Date(`${hoy}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - (diasQueSeGuardan - 1));
  const desde = limite.toISOString().slice(0, 10);
  const vivas = new Map();
  for (const h of huellas ?? []) {
    if (h.dia < desde) continue;
    vivas.set(`${h.clave}|${h.dia}`, { clave: h.clave, dia: h.dia });
  }
  return [...vivas.values()]
    .sort((a, b) => (a.dia === b.dia ? (a.clave < b.clave ? -1 : 1) : a.dia < b.dia ? -1 : 1))
    .map((h) => JSON.stringify(h))
    .join("\n")
    .concat(vivas.size > 0 ? "\n" : "");
}
