// AVISOS QUE DISCORD NUNCA ACEPTO: data/pendientes.jsonl
//
// EL AGUJERO QUE TAPA (regresion medida el 2026-09-11)
// Antes de los avisos en vivo, un fetch RECHAZADO hacia Discord subia hasta
// main(), la corrida salia con exit 1 y el paso "Guardar historial y ultimo
// estado" del workflow se saltaba: nada se commiteaba, y la corrida siguiente
// volvia a detectar los mismos cambios y los avisaba. Feo, pero se auto-reparaba.
//
// Ahora enviarMensaje() nunca lanza (para que un hipo de red no tire 3 horas de
// scraping) y el paso de guardado corre con `if: always()`. Eso convirtio la
// falla que se auto-reparaba en una PERDIDA SILENCIOSA: con Discord caido toda
// la corrida, latest.json igual se escribe con los cambios dentro, asi que la
// corrida siguiente ya no los ve y nadie los avisa nunca. Medido end-to-end:
// 4 bajas reales detectadas, 0 avisos, estado guardado, exit 0.
//
// La red de seguridad: lo que no se pudo entregar se anota aca y la corrida
// siguiente lo manda al principio de su resumen final, con la fecha original.
//
// DOS TOPES, los dos por la misma razon (un archivo asi no puede crecer solo):
//  - EDAD: pasadas MAX_HORAS un aviso ya no es accionable (el precio de hace dos
//    dias no sirve para ir a comprar hoy) y mandarlo confunde mas que ayuda.
//  - CANTIDAD: se conservan los MAS RECIENTES. El numero sale de la simulacion
//    de Cyber: el peor caso previsto son 300-600 cambios por revision, asi que
//    1.000 cubre una revision entera con Discord caido de punta a punta sin
//    perder nada (con 400 se perdian 200 de 600, medido). Mas alla de eso el
//    archivo ya no es una red de seguridad sino un problema propio.
export const MAX_HORAS = 48;
export const MAX_PENDIENTES = 1000;

/**
 * Lee el archivo (texto crudo) y devuelve los cambios todavia vigentes.
 * Cada linea es el cambio tal cual, con un campo `ts` con la fecha en que se
 * detecto. Una linea ilegible se ignora: puede ser de una corrida que murio
 * mientras escribia.
 */
export function leerPendientes(texto, { ahora = Date.now(), maxHoras = MAX_HORAS, max = MAX_PENDIENTES } = {}) {
  const corte = ahora - maxHoras * 3600 * 1000;
  const vigentes = [];
  for (const linea of String(texto ?? "").split("\n")) {
    if (!linea.trim()) continue;
    let o;
    try {
      o = JSON.parse(linea);
    } catch {
      continue;
    }
    if (!o || !o.tipo || !o.modelo) continue;
    const t = Date.parse(o.ts);
    // Al reves que en notificados.jsonl: alla el caso ambiguo caduca (una huella
    // de mas SILENCIA un aviso), aca el caso ambiguo se conserva (un pendiente
    // de mas solo manda un aviso repetido). En los dos casos se elige el lado
    // que no deja al operador sin enterarse.
    if (Number.isFinite(t) && t < corte) continue;
    vigentes.push(o);
  }
  // Sin duplicados: el archivo se fusiona por union ante un conflicto de git
  // (ver .gitattributes), asi que la misma linea puede aparecer dos veces.
  const vistas = new Set();
  const unicos = [];
  for (const o of vigentes) {
    const clave = [o.tipo, o.modelo, o.precioAnterior ?? "", o.precio ?? "", o.estado ?? "", o.estadoAnterior ?? ""].join("|");
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    unicos.push(o);
  }
  return unicos.slice(-max);
}

/**
 * Texto a escribir en el archivo (una linea por cambio, con su fecha).
 * El tope tambien se aplica al escribir: si no, el archivo podia crecer sin
 * limite y recien se recortaba al leerlo en la corrida siguiente.
 */
export function serializarPendientes(cambios, timestamp, { max = MAX_PENDIENTES } = {}) {
  const lineas = (cambios ?? []).slice(-max).map((c) => JSON.stringify({ ts: c?.ts ?? timestamp, ...c }));
  return lineas.length > 0 ? lineas.join("\n") + "\n" : "";
}
