// Integracion de lo observado en una corrida al mapa "observado" (SKU -> datos)
// y reglas de que se notifica. Sin I/O: se saco de run.mjs para poder probarlo.
//
// REGLA DE ORO: la identidad de un producto es su SKU (v.modelo) y nada mas. Ni
// el nombre ni el titulo ni la variante pueden decidir si un producto entra al
// catalogo: si un SKU dejara de entrar por no poder armarle un titulo lindo,
// comparar() lo declararia desaparecido en 2 corridas y se irian ~60 avisos
// falsos por Discord (ya paso: ~150 avisos falsos en 4 dias, ver BITACORA.md).
import { varianteUtil } from "./titulo.mjs";
import { ganaElEmpate, mismaSeccion, RANGO, RANGO_POR_VIA } from "./identidad.mjs";
import { ESTADO } from "./stock.mjs";

// Las categorias "Accesorios *" nunca se notifican (regla del operador).
export function esAccesorio(categoria) {
  return (categoria || "").toLowerCase().startsWith("accesorio");
}

// "Familia (auto-descubierta)" es la categoria generica de las paginas /buy/
// descubiertas por sitemap; la del listado siempre es mas especifica.
// Se exporta porque el camino de avisos en vivo la necesita: un SKU visto por
// primera vez desde una pagina familia todavia NO tiene categoria real, asi que
// no se puede decidir si es un accesorio (ver src/despachador-vivo.mjs).
export const esFamiliaGenerica = (categoria) => (categoria || "").startsWith("Familia");

/**
 * Cuanto vale lo que ESTA pagina dice sobre este SKU (ver src/identidad.mjs).
 * El rango viaja en la variante; cuando falta (registros armados a mano en las
 * pruebas, o un catalogo escrito por la version anterior) se deduce del camino:
 * lo que estaba bajo una categoria "Familia (auto-descubierta)" venia de una
 * pagina familia y todo lo demas de su ficha propia. Asi la regla nueva se
 * comporta igual que la vieja para lo que ya estaba guardado.
 */
function rangoDe(registro, porDefecto) {
  const r = Number(registro?.rango);
  return Number.isFinite(r) && r > 0 ? r : porDefecto;
}

/**
 * Integra las variantes extraidas de una pagina.
 * @param observado mapa SKU -> registro de esta corrida (se muta)
 * @param entry fila del listado o pagina familia (aporta categoria y variante)
 * @param variants salida de extractFamilyVariants / extractSingleProduct
 * @param via "familia" cuando el nombre viene del JSON-LD de una pagina familia
 * @param escritos array opcional donde se apilan los SKU que ESTA llamada
 *        escribio de verdad en el mapa. Lo usa el camino de avisos en vivo para
 *        evaluar solo lo que cambio en esta pagina: la rama de arriba (pagina
 *        familia que solo enriquece el titulo de un SKU ya capturado) no toca
 *        precio ni stock y por eso queda fuera. El VALOR DE RETORNO no cambia
 *        (sigue siendo el mapa `observado`): test/catalogo.test.mjs lo fija.
 */
export function integrarVariantes(observado, entry, variants, { via = "individual", timestamp, escritos } = {}) {
  for (const v of variants ?? []) {
    if (!v.modelo) continue; // sin SKU no hay identidad posible
    const existente = observado[v.modelo];
    // el nombre del JSON-LD de la familia suele traer capacidad/RAM/color que
    // digitalData.displayName no tiene ("Galaxy S26 Ultra 256 GB|12 GB Pinkgold")
    const nombreRico = via === "familia" ? v.nombre || null : null;

    // PRECEDENCIA POR RANGO. Si el SKU ya se capturo desde una pagina que vale
    // MAS que esta (su ficha propia contra una pagina que solo lo agrupa), lo de
    // aca no le pisa nada: ni precio, ni stock, ni categoria.
    //
    // Medido en el Galaxy S25 FE 256GB: su ficha propia muestra $579.990 con
    // boton "Comprar" mientras la pagina agrupada y su API dicen $829.990 para el
    // mismo SKU y hasta lo marcan agotado. El precio que vale es el de la ficha
    // donde el cliente compra. Antes esto dependia de que la categoria fuera
    // "Familia (auto-descubierta)", asi que dos paginas agrupadas entre si (o una
    // pagina /buy/ que si estaba en el listado) se pisaban por orden de llegada.
    const rangoNuevo = rangoDe(v, RANGO_POR_VIA[via] ?? RANGO.FAMILIA);
    const rangoExistente = rangoDe(existente, esFamiliaGenerica(existente?.categoria) ? RANGO.FAMILIA : RANGO.PROPIA);

    // EMPATE ENTRE PAGINAS DE SECCIONES DISTINTAS (2026-09-12, arreglo de la
    // revision del reordenamiento del recorrido). Dos paginas del MISMO rango
    // que publican el mismo SKU son casi siempre la ficha plana y su propia
    // /buy/ (medido: 115 SKU, mismas seccion las dos): el recorrido nunca las
    // separa, asi que entre ellas el orden de llegada es siempre el mismo y
    // sigue mandando como hasta ahora.
    //
    // Lo que el recorrido SI puede invertir es un par de paginas de SECCIONES
    // DISTINTAS (una de /smartphones/, que ahora va al principio, contra una de
    // /mobile-accessories/, que va al final). Ahi el orden de llegada dejaria de
    // ser estable y el mismo insumo daria dos catalogos distintos, asi que el
    // empate se arbitra con un criterio propio de las paginas (ver ganaElEmpate
    // en src/identidad.mjs): gana la que NOMBRA al SKU en su slug.
    //
    // Medido antes de escribirlo: hoy esta rama esta MUERTA. Ningun SKU del
    // catalogo es publicado por paginas de dos secciones (0 de 1.031; 0 de los
    // 111 SKU que en 348 snapshots cambiaron de pagina firmante, salvo el
    // GP-TOS928SBEYW del 2026-07-25, que hoy ya lo contiene repartirPorPropiedad).
    // No cambia nada de lo que hay; existe para que el dia que Samsung publique
    // un SKU desde dos secciones, lo decida una regla y no el azar del recorrido.
    const pierdeElEmpate =
      existente &&
      rangoNuevo === rangoExistente &&
      existente.paginaOrigen &&
      !mismaSeccion(existente.paginaOrigen, entry.url) &&
      !ganaElEmpate(entry.url, existente.paginaOrigen, v.modelo);

    if (existente && (rangoNuevo < rangoExistente || pierdeElEmpate)) {
      // ...pero su nombre rico y sus especificaciones igual se aprovechan para el
      // titulo: son datos del mismo SKU, no del precio
      if (nombreRico && !existente.nombreFamilia) existente.nombreFamilia = nombreRico;
      if (v.especificaciones && !existente.especificaciones) existente.especificaciones = v.especificaciones;
      continue;
    }

    // MISMO RANGO, UNA SOLA LECTURA UTIL. El rango resuelve quien vale mas, pero
    // dos paginas del MISMO rango pueden ver el mismo SKU y que solo una logre
    // leer el stock: pasa con la ficha plana y su propia pagina /buy/ (medido en
    // Galaxy Book4 NP750XGJ-KS4CL, cuya ficha plana no trae precio en el bloque y
    // por eso queda "desconocido", mientras su /buy/ dice "Avísame"). Sin esto,
    // el orden de las paginas decidia: la que llegara ultima borraba el unico
    // estado que se habia podido medir.
    const conservaEstado =
      existente &&
      (v.estadoStock ?? ESTADO.DESCONOCIDO) === ESTADO.DESCONOCIDO &&
      existente.estadoStock &&
      existente.estadoStock !== ESTADO.DESCONOCIDO;

    // LO MISMO PARA EL PRECIO (2026-09-12). Desde que una pagina que no alcanzo
    // a pintar el monto devuelve la observacion SIN precio (ver
    // precioVisiblePreferido en src/extract.mjs), dos paginas del mismo rango que
    // ven el mismo SKU pueden traer una el precio y la otra nada. Son 135 SKU que
    // se scrapean dos veces por corrida (su ficha plana del seed y su propia
    // pagina /buy/ descubierta por sitemap, ambas rango PROPIA): sin esto, la que
    // llegara ultima borraba el unico precio que se habia podido leer.
    //
    // Y SOLO ENTRE PAGINAS DEL MISMO RANGO, que es lo que dice el parrafo de
    // arriba y lo que el codigo no comprobaba (2026-09-12, defecto medido por
    // los tres verificadores). Sin la comprobacion, cuando la pagina FAMILIA se
    // integraba primero y la ficha propia llegaba sin precio (el reintento del
    // final de run.mjs procesa las paginas lentas DESPUES de todas las demas),
    // el precio de LISTA de la familia -- el tachado del JSON-LD -- se copiaba
    // al registro y quedaba firmado con `rango: 3` y `paginaOrigen: <ficha
    // propia>`. Con ese disfraz, la guarda de fuente de comparar.mjs lo veia como "misma
    // fuente" y avisaba al tiro: el lado "sube" del vaiven, blanqueado y
    // esquivando la guardia que deberia detenerlo. Medido: el mismo insumo daba
    // dos resultados distintos segun el ORDEN de llegada de las paginas.
    const conservaPrecio =
      existente && !Number.isFinite(v.precio) && Number.isFinite(existente.precio) && rangoExistente === rangoNuevo;

    observado[v.modelo] = {
      ...v,
      rango: rangoNuevo,
      // el stock que SI se pudo leer no se pierde porque otra pagina del mismo
      // rango no haya podido leerlo
      estadoStock: conservaEstado ? existente.estadoStock : v.estadoStock,
      disponible: conservaEstado ? existente.disponible : v.disponible,
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
    // el precio se conserva DESPUES del spread para no dejar `precio: undefined`
    // en el registro: comparar() distingue el campo ausente del campo en null
    if (conservaPrecio) observado[v.modelo].precio = existente.precio;
    escritos?.push(v.modelo);
  }
  return observado;
}
