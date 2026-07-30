// Integracion de lo observado en una corrida al mapa "observado" (SKU -> datos)
// y reglas de que se notifica. Sin I/O: se saco de run.mjs para poder probarlo.
//
// REGLA DE ORO: la identidad de un producto es su SKU (v.modelo) y nada mas. Ni
// el nombre ni el titulo ni la variante pueden decidir si un producto entra al
// catalogo: si un SKU dejara de entrar por no poder armarle un titulo lindo,
// comparar() lo declararia desaparecido en 2 corridas y se irian ~60 avisos
// falsos por Discord (ya paso: ~150 avisos falsos en 4 dias, ver BITACORA.md).
import { varianteUtil } from "./titulo.mjs";

// Las categorias "Accesorios *" nunca se notifican (regla del operador).
export function esAccesorio(categoria) {
  return (categoria || "").toLowerCase().startsWith("accesorio");
}

// "Familia (auto-descubierta)" es la categoria generica de las paginas /buy/
// descubiertas por sitemap; la del listado siempre es mas especifica.
const esFamiliaGenerica = (categoria) => (categoria || "").startsWith("Familia");

/**
 * Integra las variantes extraidas de una pagina.
 * @param observado mapa SKU -> registro de esta corrida (se muta)
 * @param entry fila del listado o pagina familia (aporta categoria y variante)
 * @param variants salida de extractFamilyVariants / extractSingleProduct
 * @param via "familia" cuando el nombre viene del JSON-LD de una pagina familia
 */
export function integrarVariantes(observado, entry, variants, { via = "individual", timestamp } = {}) {
  for (const v of variants ?? []) {
    if (!v.modelo) continue; // sin SKU no hay identidad posible
    const existente = observado[v.modelo];
    // el nombre del JSON-LD de la familia suele traer capacidad/RAM/color que
    // digitalData.displayName no tiene ("Galaxy S26 Ultra 256 GB|12 GB Pinkgold")
    const nombreRico = via === "familia" ? v.nombre || null : null;

    // si el SKU ya se capturo desde su pagina especifica, una pagina familia
    // generica no le pisa nada (precio, stock ni categoria)...
    if (existente && !esFamiliaGenerica(existente.categoria) && esFamiliaGenerica(entry.categoria)) {
      // ...pero su nombre rico y sus especificaciones igual se aprovechan para el
      // titulo: son datos del mismo SKU, no del precio
      if (nombreRico && !existente.nombreFamilia) existente.nombreFamilia = nombreRico;
      if (v.especificaciones && !existente.especificaciones) existente.especificaciones = v.especificaciones;
      continue;
    }

    observado[v.modelo] = {
      ...v,
      // un dato bueno ya capturado nunca se reemplaza por un vacio
      nombre: v.nombre ?? existente?.nombre ?? null,
      categoria: entry.categoria,
      subcategoria: entry.subcategoria,
      // la union con el listado es por URL: el campo "modelo" del seed esta
      // derivado del slug y NO es el SKU real, no sirve como llave
      variante: varianteUtil(entry.variante) ?? existente?.variante ?? null,
      // Cuando el registro entra POR una pagina familia, nombreFamilia queda con
      // el mismo texto que nombre. La repeticion es a proposito y cuesta ~15 KB
      // por snapshot: es el respaldo para la corrida siguiente, en la que el
      // mismo SKU puede verse por su pagina individual y traer el nombre pobre
      // ("Galaxy Z Fold7"). Sin ese respaldo el titulo perderia la capacidad.
      nombreFamilia: nombreRico ?? existente?.nombreFamilia ?? null,
      // especificaciones por SKU leidas de la propia pagina (color, capacidad,
      // RAM). Misma regla: un dato bueno ya capturado no se pierde porque esta
      // corrida no lo haya podido leer.
      especificaciones: v.especificaciones ?? existente?.especificaciones ?? null,
      paginaOrigen: entry.url,
      ultimaRevision: timestamp,
    };
  }
  return observado;
}
