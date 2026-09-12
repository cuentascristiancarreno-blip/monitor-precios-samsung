// QUE SE MUESTRA CUANDO NO CABE TODO.
//
// EL PROBLEMA (medido en la revision del 2026-09-12). Varios mensajes al
// operador y varios campos del resumen muestran solo los primeros N de una lista
// (`momificados.slice(0, 15)`, `urlsConError.slice(0, 20)`...). Esas listas
// salen en el orden en que se visitaron las paginas, asi que CUALES 15 ve el
// operador dependia de por donde empezo el recorrido. Al reordenar el recorrido
// por categorias principales, la seleccion cambia sin que nadie lo haya decidido.
//
// Hoy no muerde -- en 305 corridas registradas ninguna de esas listas paso de 15
// --, pero "hoy no muerde" no es una razon para que lo decida el azar. Estas dos
// funciones ordenan por un criterio propio ANTES de cortar, asi que lo que se
// muestra es siempre lo mismo para el mismo contenido.

/**
 * Los `tope` casos mas insistentes: primero los que llevan mas corridas en esa
 * condicion (que son los que de verdad hay que mirar), y a igualdad de corridas
 * por nombre de modelo. Se usa para las dos listas de "momias".
 */
export function masCorridas(lista, tope) {
  return [...(lista ?? [])]
    .sort((a, b) => (b.corridas ?? 0) - (a.corridas ?? 0) || String(a.modelo).localeCompare(String(b.modelo)))
    .slice(0, tope);
}

/**
 * Una muestra estable de URL: sin repetidas, en orden alfabetico, las primeras
 * `tope`. Se usa para urlsConError y urlsRedirigidas del resumen.
 *
 * OJO: esto es para MOSTRAR. La lista de paginas fallidas que se reintenta
 * conserva su orden de recorrido a proposito, porque ese orden es la prioridad
 * que pidio el operador.
 */
export function muestraDeUrls(entradas, tope) {
  const urls = [...new Set((entradas ?? []).map((e) => (typeof e === "string" ? e : e?.url)).filter(Boolean))];
  return urls.sort().slice(0, tope);
}
