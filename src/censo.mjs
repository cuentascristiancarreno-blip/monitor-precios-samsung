// EL CENSO: LAS PREGUNTAS QUE SON SOBRE EL SITIO DE HOY, FUERA DEL CANDADO.
//
// POR QUE EXISTE ESTE ARCHIVO (incidente del 2026-09-22/23, ver BITACORA.md).
//
// Hasta el 2026-09-23, `npm test` -- el paso que BLOQUEA la corrida -- contenia
// aserciones que no preguntaban nada sobre el codigo. Preguntaban sobre la FORMA
// DEL CATALOGO DE HOY: cuantas paginas mide el recorrido, cuanto aporta el
// descubrimiento, cuantos SKU quedan fuera del bloque liviano. La respuesta de
// esas preguntas cambia sola, porque las propias corridas reescriben el catalogo
// 20 veces al dia. El catalogo crecio, cruzo una raya, y el monitor quedo 30
// HORAS CAIDO: 24 corridas fallidas seguidas, cero avisos, y el operador se
// entero por un correo de GitHub.
//
// LA SEPARACION QUE ESTE MODULO COMPLETA:
//   - una PRUEBA pregunta "¿el codigo hace lo que dice?". Su insumo puede ser
//     congelado, su respuesta solo cambia si alguien toca codigo, y por eso puede
//     vivir en el candado.
//   - un CENSO pregunta "¿el mundo sigue estando donde el codigo supone?". Su
//     insumo es mutable por definicion, asi que NO puede vivir en el candado.
//     Avisa; no bloquea nunca.
//
// Las preguntas de abajo son, una por una, las que tumbaron el monitor. Ahora
// cada una tiene su numero, su margen y su historia, y se miden en cada corrida
// en vez de una vez cada 30 horas -- que es como se tuvo que reconstruir a mano
// desde git la deriva que causo el incidente.
//
// ESTE MODULO ES PURO: no abre archivos ni la red. Quien lo alimenta es
// src/censo-cli.mjs, que es el que sabe donde viven los datos de produccion.
import { MODO_COMPLETO, MODO_LIVIANO, TOLERANCIA_ENCOGIMIENTO, ultimoCompleto } from "./alcance.mjs";
import { BLOQUE_CYBER, BLOQUE_PRINCIPAL, prepararRecorrido } from "./prioridad.mjs";

/** Cuantas de las ultimas revisiones completas se miran para juzgar si el sistema viene sano. */
export const COMPLETAS_QUE_SE_MIRAN = 5;

/** Los tres estados de un indicador. Ninguno bloquea nada: el peor solo sube el tono del mensaje. */
export const OK = "ok";
export const ATENCION = "atencion";
export const ALARMA = "alarma";

const ORDEN = { [OK]: 0, [ATENCION]: 1, [ALARMA]: 2 };

/** El peor estado de una lista de indicadores. */
export function peorEstado(indicadores) {
  return (indicadores ?? []).reduce((peor, i) => (ORDEN[i.estado] > ORDEN[peor] ? i.estado : peor), OK);
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

/**
 * UNA CANTIDAD QUE SE ESPERA CERCA DE UN NUMERO MEDIDO.
 *
 * Es la version fuera-del-candado del `cercaDe()` que vivia en las pruebas. La
 * diferencia no es la formula, es la consecuencia: alla, salirse de la banda
 * apagaba el monitor; aca manda un mensaje. Por eso ademas nunca da ALARMA --
 * que Samsung publique 300 paginas nuevas es una noticia, no una falla.
 */
function banda({ clave, titulo, valor, referencia, holgura = 0.25, unidad = "" }) {
  const min = Math.floor(referencia * (1 - holgura));
  const max = Math.ceil(referencia * (1 + holgura));
  const dentro = valor >= min && valor <= max;
  return {
    clave,
    titulo,
    valor,
    referencia,
    formato: "entero",
    estado: dentro ? OK : ATENCION,
    texto: dentro
      ? `${titulo}: ${valor}${unidad} (esperado ${min}-${max}, medido el 2026-09-12: ${referencia})`
      : `${titulo}: ${valor}${unidad} quedó FUERA de [${min}, ${max}] — el número medido el 2026-09-12 era ${referencia}`,
  };
}

/**
 * EL COLCHON DE `piso`, COMO FRACCION DEL PISO Y NO EN PUNTOS ABSOLUTOS.
 *
 * ESTO ES UNA CICATRIZ DE CALIBRACION (2026-09-23, segunda vuelta). La primera
 * version usaba 5 PUNTOS absolutos para todos los pisos. Sobre un piso del 80%
 * eso es un colchon del 6% y esta bien; sobre un piso del 10% es un colchon del
 * 50%, o sea que el indicador exige 15% para estar en verde cuando la raya esta
 * en 10. Medido sobre los 532 snapshots del historial: con 5 puntos,
 * `aporte-descubrimiento` daba CERO verdes en 532 -- 192 atencion + 340 alarma
 * --, o sea un canario que chilla todos los dias desde el dia uno. Con el
 * colchon relativo (2,5 puntos sobre un piso de 10): 188 verdes, 4 atencion y
 * 340 alarma, y los 340 son julio y agosto, cuando el aporte de verdad andaba
 * entre 5,0% y 7,4%, o sea de verdad bajo el piso.
 *
 * Un canario calibrado para chillar siempre es la forma mas rapida de que deje
 * de leerse, y lo que se juega ahi es todo lo que se mudo al censo.
 */
const COLCHON = 0.25;

/**
 * UNA PROPORCION QUE NO PUEDE BAJAR DE UN PISO.
 *
 * `aviso` es el colchon, EN FRACCION DEL PISO (ver COLCHON): cuando el valor
 * sigue arriba del piso pero por menos de ese margen, el indicador queda en
 * ATENCION. Es justo lo que faltaba el 2026-09-22: el sistema estaba a 2,1
 * puntos de una pared y nadie lo sabia, porque nadie lo estaba midiendo.
 */
function piso({ clave, titulo, valor, minimo, aviso = COLCHON, porque = "" }) {
  const colchon = minimo * aviso;
  const margen = valor - minimo;
  const estado = margen < 0 ? ALARMA : margen < colchon ? ATENCION : OK;
  const detalle = porque ? ` — ${porque}` : "";
  return {
    clave,
    titulo,
    valor,
    referencia: minimo,
    formato: "proporcion",
    estado,
    texto:
      margen < 0
        ? `${titulo}: ${pct(valor)}, POR DEBAJO del piso de ${pct(minimo)}${detalle}`
        : `${titulo}: ${pct(valor)} (piso ${pct(minimo)}, margen ${(margen * 100).toFixed(1)} puntos)${margen < colchon ? " — queda poco" : ""}`,
  };
}

/**
 * UNA PROPORCION QUE NO TIENE UN LADO BUENO Y UN LADO MALO, PERO SI UNA RAYA
 * QUE IMPORTA CRUZAR.
 *
 * POR QUE EXISTE ESTA FUNCION, Y ES EL DEFECTO MAS SERIO QUE SE ENCONTRO EN LA
 * PRIMERA VERSION DEL CENSO: `observables-sin-descubrimiento` estaba modelado
 * como un `piso` del 80% y su explicacion estaba AL REVES.
 *
 * Lo que dice el codigo de verdad (src/alcance.mjs, evaluarConfiabilidad):
 *   `if (esperados > 0 && encontrados < esperados * 0.8) -> motivo faltan-productos`
 * O sea que si el descubrimiento se cae y quedan observables MENOS del 80% de
 * los SKU vivos, la heuristica SI atrapa la corrida. Quedar POR DEBAJO del 80%
 * es mas proteccion, no menos. El texto anterior afirmaba lo contrario ("por
 * debajo, una caida del descubrimiento la atrapan solo las otras dos redes") y
 * por eso el 79,5% de hoy salia como ALARMA: el censo nacia en rojo por una
 * pregunta contestada al reves.
 *
 * De donde salio el 80% en primer lugar: de la GUARDA DE UNA PRUEBA
 * (test/alcance-revision.test.mjs, "con el descubrimiento caido..."), que
 * necesita quedar ARRIBA del 80% para que el escenario ejercite el agujero que
 * la prueba vigila. Es una condicion de validez de un escenario, no un
 * invariante de produccion. Ningun lado de la raya es una falla; lo que importa
 * es saber de que lado esta el sistema, porque de eso depende CUALES redes
 * atrapan una caida del descubrimiento y si la premisa de esa prueba se sigue
 * pareciendo a la realidad.
 *
 * Por eso: nunca ALARMA. ATENCION cuando esta pegado a la raya -- que es cuando
 * puede cruzarla y volver -- y en verde el resto del tiempo.
 *
 * MEDIDO sobre los 532 snapshots, con `cerca` = 3 puntos: 345 en verde y 187
 * avisando, y los 187 son exactamente las semanas de septiembre en que el
 * sistema estuvo a 2,7-2,9 puntos de la raya sin que nadie lo supiera. Con 2
 * puntos habrian sido 531 verdes, pero el 2026-09-22 a las 07:02Z (82,1%) NO
 * habria dicho nada: habria avisado recien despues de cruzar.
 */
function raya({ clave, titulo, valor, raya: linea, cerca = 0.03, arriba = "", abajo = "" }) {
  const distancia = Math.abs(valor - linea);
  const dondeEsta = valor >= linea ? "arriba" : "abajo";
  const explicacion = valor >= linea ? arriba : abajo;
  const pegado = distancia < cerca;
  const estado = pegado ? ATENCION : OK;
  return {
    clave,
    titulo,
    valor,
    referencia: linea,
    formato: "proporcion",
    estado,
    // LA SEÑA LLEVA EL LADO, Y NO ES UN ADORNO: el freno del censo compara
    // claves, y sin el lado adentro pasar de 82,1% a 79,5% -- o sea CRUZAR la
    // raya, que es el evento entero -- daria la misma clave que antes y el
    // sistema se quedaria callado justo cuando tiene algo nuevo que decir.
    sena: `${estado}:${dondeEsta}`,
    texto:
      `${titulo}: ${pct(valor)} — ${dondeEsta} de la raya del ${pct(linea)}` +
      `, a ${(distancia * 100).toFixed(1)} puntos${pegado ? " (pegado a la raya: puede cruzarla y volver)" : ""}` +
      (explicacion ? `. ${explicacion}` : ""),
  };
}

/**
 * Un conteo que no puede pasar de un maximo. La simetrica de `piso`, en unidades
 * enteras.
 *
 * NO HAY UNA VERSION EN PORCENTAJE, y no es un olvido: la unica proporcion con
 * techo que tenia sentido censar era "productos vivos sin pagina en el
 * recorrido", y esa resulto ser CERO por construccion (ver el comentario largo
 * del indicador `completas-sospechosas`). Una funcion sin llamador seria
 * decoracion.
 */
function cuenta({ clave, titulo, valor, maximo, alarmaEn, porque = "" }) {
  const estado = valor >= alarmaEn ? ALARMA : valor > maximo ? ATENCION : OK;
  const detalle = porque ? ` — ${porque}` : "";
  return {
    clave,
    titulo,
    valor,
    referencia: maximo,
    formato: "entero",
    estado,
    texto: estado === OK ? `${titulo}: ${valor}` : `${titulo}: ${valor} (lo normal es ${maximo})${detalle}`,
  };
}

/** Un si-o-no. Se usa para las PREMISAS de las pruebas de censo, que son de verdad binarias. */
function condicion({ clave, titulo, cumple, texto, textoRoto }) {
  return { clave, titulo, valor: cumple, referencia: true, formato: "si-no", estado: cumple ? OK : ALARMA, texto: cumple ? texto : textoRoto };
}

/**
 * LOS CAMPOS QUE TIENE UN CATALOGO, definidos como "los que aparecen en al menos
 * la mitad de los registros".
 *
 * La mitad y no "alguno" a proposito: un campo de diagnostico que aparece en tres
 * registros no es parte de la forma del catalogo, y contarlo haria que el aviso
 * de fixture vencida saliera por ruido.
 *
 * MEDIDO (barrido de los 532 snapshots del historial de git): esta forma cambio
 * 4 veces en 65 dias -- 2026-07-25, 07-30 y 09-12 -- y las TRES veces en el mismo
 * commit que agrego el campo. Nunca cambio sola. Esa asimetria es el argumento
 * entero de la fixture congelada: el dato se mueve 20 veces al dia, la forma se
 * mueve una vez al mes y con una persona adentro.
 */
export function formaDe(catalogo) {
  const registros = Object.values(catalogo ?? {});
  if (registros.length === 0) return [];
  const cuenta = new Map();
  for (const r of registros) for (const k of Object.keys(r ?? {})) cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  return [...cuenta.entries()]
    .filter(([, c]) => c >= registros.length / 2)
    .map(([k]) => k)
    .sort();
}

/**
 * LAS ULTIMAS `cuantas` REVISIONES COMPLETAS QUE QUEDARON MARCADAS SOSPECHOSAS.
 *
 * Se lee de `data/ejecuciones.jsonl`, que es append-only y se fusiona por union
 * (.gitattributes), asi que una linea ilegible o mezclada es posible: se ignora
 * en vez de tumbar el censo.
 *
 * Solo se miran las COMPLETAS: en una liviana, no ver el 73% del catalogo es la
 * normalidad y no significa nada.
 */
export function completasSospechosas(texto, cuantas = COMPLETAS_QUE_SE_MIRAN) {
  const filas = String(texto ?? "")
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
    .filter((f) => f && (f.modo ?? MODO_COMPLETO) === MODO_COMPLETO);
  return filas
    .slice(-cuantas)
    .filter((f) => f.confiable === false)
    .map((f) => ({ fin: f.fin ?? f.inicio ?? null, motivos: (f.motivos ?? []).map((m) => m?.tipo ?? m).filter(Boolean) }));
}

/**
 * EL CENSO ENTERO. Todo lo que recibe son datos ya leidos: nada de I/O aca.
 *
 * @param catalogo  el catalogo de produccion de hoy
 * @param seed      src/seed.json
 * @param ejecuciones  el texto de data/ejecuciones.jsonl
 * @param fixture   test/fixtures/catalogo.json, para el indicador de fixture vencida
 */
export function censar({ catalogo = {}, seed = [], ejecuciones = "", fixture = null } = {}) {
  const urlsSeed = new Set(seed.map((e) => e.url));
  // LAS PAGINAS FAMILIA SE RECONSTRUYEN DEL CATALOGO, igual que en las pruebas:
  // pedirle los sitemaps a Samsung para hacer un censo serian 4 requests extra
  // por corrida, y la reconstruccion ya esta validada (da 162 paginas familia y
  // 1.185 en total, el mismo numero que la ultima corrida real).
  const familia = [
    ...new Set(
      Object.values(catalogo)
        .map((r) => r?.paginaOrigen ?? r?.url)
        .filter((u) => u && !urlsSeed.has(u)),
    ),
  ].map((url) => ({ categoria: "Familia (auto-descubierta)", subcategoria: null, nombre: null, variante: null, modelo: null, url, tipo: "familia" }));

  const completo = prepararRecorrido({ seedRaw: seed, familyEntries: familia });
  const liviano = prepararRecorrido({ seedRaw: seed, familyEntries: familia, modo: MODO_LIVIANO, bloque: BLOQUE_PRINCIPAL });
  const cyber = prepararRecorrido({ seedRaw: seed, familyEntries: familia, modo: MODO_LIVIANO, bloque: BLOQUE_CYBER });
  const sinDescubrimiento = prepararRecorrido({ seedRaw: seed, familyEntries: [] });

  const registros = Object.entries(catalogo);
  const vivos = registros.filter(([, r]) => r?.presencia !== "desaparecido");
  const paginaDe = (r) => r?.paginaOrigen ?? r?.url;

  const paginasCompleto = completo.alcance.paginas.size;
  const paginasSinDesc = sinDescubrimiento.alcance.paginas.size;
  const aporte = paginasCompleto > 0 ? 1 - paginasSinDesc / paginasCompleto : 0;

  const observables = vivos.filter(([, r]) => sinDescubrimiento.alcance.paginas.has(paginaDe(r))).length;
  const razonObservables = vivos.length > 0 ? observables / vivos.length : 1;

  const fuera = registros.filter(([, r]) => !liviano.alcance.paginas.has(paginaDe(r))).length;
  const fueraVivos = vivos.filter(([, r]) => !liviano.alcance.paginas.has(paginaDe(r))).length;

  const indicadores = [
    banda({ clave: "recorrido-completo", titulo: "Páginas de una revisión completa", valor: completo.entries.length, referencia: 1185 }),
    banda({ clave: "bloque-liviano", titulo: "Páginas del bloque liviano", valor: liviano.entries.length, referencia: 347 }),
    banda({ clave: "bloque-cyber", titulo: "Páginas del bloque Cyber", valor: cyber.entries.length, referencia: 216 }),
    banda({ clave: "registros-fuera-del-bloque", titulo: "Registros fuera del bloque liviano", valor: fuera, referencia: 797 }),
    banda({ clave: "vivos-fuera-del-bloque", titulo: "Productos vivos fuera del bloque liviano", valor: fueraVivos, referencia: 733 }),

    // EL PISO DEL 10%: es la guarda que el arreglo del 2026-09-22 (57d5bd8)
    // dejo heredada. Medido sobre los 532 snapshots: del 2026-07-23 al 09-11 el
    // descubrimiento aportaba entre 5,0% y 7,4% de las paginas -- o sea DEBAJO
    // de este piso durante casi todo el historial --; el 2026-09-12/13 salto de
    // 7,3% a 13,7% en un dia. Que pueda moverse 6 puntos en una jornada es
    // exactamente por lo que esto se mide y no se asume.
    piso({
      clave: "aporte-descubrimiento",
      titulo: "Páginas que aporta el descubrimiento por sitemap",
      valor: aporte,
      minimo: TOLERANCIA_ENCOGIMIENTO,
      porque: "si baja de ahí, una caída del descubrimiento deja de marcar la revisión como sospechosa por encogimiento",
    }),

    // LA RAYA DEL 80%: ESTE ES EL NUMERO QUE TUMBO EL MONITOR. Reconstruido
    // snapshot a snapshot: el 2026-09-22T07:02Z iba en 82,1% (1.046 SKU, 948
    // vivos) y a las 08:27Z en 79,5% (1.077 SKU, 981 vivos). Una revision
    // completa agrego 33 SKU vivos y movio la razon 2,6 puntos al otro lado de
    // la raya. El monitor estaba a 2,1 puntos del borde y nadie lo sabia,
    // porque esto no se estaba midiendo en ninguna parte.
    //
    // NO ES UN PISO, Y MODELARLO COMO PISO ERA UN DEFECTO (ver el comentario de
    // `raya`): cruzar hacia abajo significa MAS proteccion, no menos. Lo que
    // cambia al cruzar es cuales redes atrapan una caida del descubrimiento, y
    // que la premisa de la prueba que vigila ese agujero deja de parecerse al
    // catalogo. Las dos cosas hay que saberlas; ninguna es una falla.
    raya({
      clave: "observables-sin-descubrimiento",
      titulo: "Productos vivos que se seguirían viendo si el descubrimiento se cae",
      valor: razonObservables,
      raya: 0.8,
      cerca: 0.03,
      arriba:
        "Arriba de la raya, una caída del descubrimiento NO la marca la heurística de corrida sospechosa: la atrapan solo `recorrido-encogido` y `sku-sin-pagina`.",
      abajo:
        "Abajo de la raya, una caída del descubrimiento la atrapan las TRES redes (se suma `faltan-productos`) — y la prueba que vigila ese agujero ya no puede heredar la proporción del día: la construye (test/alcance-revision.test.mjs).",
    }),

    // LAS ULTIMAS REVISIONES COMPLETAS, ¿SE ESTAN DANDO POR BUENAS?
    //
    // Una revision completa marcada sospechosa NO declara desaparecidos. Dos
    // seguidas son un dia entero con esa deteccion apagada, y hasta hoy eso no
    // lo miraba nadie: queda escrito en `data/ejecuciones.jsonl` y ese archivo
    // solo se leia para otra cosa.
    //
    // POR QUE ESTE INDICADOR Y NO "productos vivos sin pagina en el recorrido",
    // QUE ES LO QUE MIRABA LA PRUEBA QUE SALIO DEL CANDADO. Porque esa cuenta,
    // hecha aca, es SIEMPRE CERO por construccion: las paginas familia se
    // reconstruyen del propio catalogo, asi que todo SKU vivo tiene su pagina en
    // el recorrido por definicion. Medido sobre el catalogo real: 981 vivos, 0
    // sin pagina, 0 paginas descartadas -- y da 0 con cualquier catalogo. La
    // asercion original (`sinPagina <= 2,5% de vivos`) no podia fallar nunca, y
    // repetirla aca seria mudar un indicador decorativo en vez de la pregunta.
    // La pregunta de verdad -- "¿el recorrido REAL, el que arma el sitemap, dejo
    // productos sin mirar?" -- solo se puede contestar durante la corrida, y la
    // corrida ya la contesta: `evaluarConfiabilidad` levanta el motivo
    // `sku-sin-pagina` y el resultado queda en esta misma fila. Asi que lo que
    // el censo mira es el VEREDICTO, que es el dato que de verdad existe.
    cuenta({
      clave: "completas-sospechosas",
      titulo: `Revisiones completas marcadas sospechosas de las últimas ${COMPLETAS_QUE_SE_MIRAN}`,
      valor: completasSospechosas(ejecuciones, COMPLETAS_QUE_SE_MIRAN).length,
      maximo: 0,
      alarmaEn: 2,
      porque: "una revisión completa sospechosa no declara desaparecidos; dos seguidas son un día con esa detección apagada",
    }),

    // LAS PREMISAS DE DOS PRUEBAS DE CENSO. Viven aca porque son afirmaciones
    // sobre el catalogo real, no sobre el codigo: las pruebas las comprueban
    // contra la fixture congelada, y si el sitio deja de cumplirlas la fixture
    // sigue verde mientras la realidad ya no se parece. Esto lo denuncia.
    condicion({
      clave: "premisa-tele-fuera-del-bloque",
      titulo: "Sigue habiendo un televisor vivo fuera del bloque liviano",
      cumple: vivos.some(([, r]) => r?.categoria === "Televisores" && !liviano.alcance.paginas.has(paginaDe(r))),
      texto: "Premisas del censo: hay televisor vivo fuera del bloque y SKU vivo dentro",
      textoRoto: "Ya no hay ningún televisor vivo fuera del bloque liviano: la prueba del desaparecido real dejó de parecerse al catálogo",
    }),
    condicion({
      clave: "premisa-sku-dentro-del-bloque",
      titulo: "Sigue habiendo un SKU vivo dentro del bloque liviano",
      cumple: vivos.some(([, r]) => liviano.alcance.paginas.has(paginaDe(r))),
      texto: "Hay SKU vivo dentro del bloque liviano",
      textoRoto: "Ya no hay ningún SKU vivo dentro del bloque liviano: el bloque principal dejó de cubrir producto",
    }),

    // LA FIXTURE DE ejecuciones.jsonl TENIA LA MISMA FORMA DE BOMBA que la del
    // catalogo, mas chica: medido, con el archivo vacio (un clon nuevo, o una
    // rotacion) o sin ninguna fila completa, la prueba de `ultimoCompleto`
    // fallaba y tumbaba la corrida. Ahora la prueba lee una fixture y lo que se
    // mira del archivo real es esto.
    condicion({
      clave: "ejecuciones-con-completa",
      titulo: "El archivo de ejecuciones trae una revisión completa legible",
      cumple: Boolean(ultimoCompleto(ejecuciones)),
      texto: `El archivo de ejecuciones trae una revisión completa legible (${ultimoCompleto(ejecuciones) ?? "-"})`,
      textoRoto: "El archivo de ejecuciones no trae ninguna revisión completa legible: la escalada automática a revisión completa se quedó sin vara",
    }),
  ];

  if (fixture) indicadores.push(fixtureAlDia(catalogo, fixture));

  return { indicadores, estado: peorEstado(indicadores) };
}

/**
 * ¿LA FIXTURE CONGELADA SIGUE PARECIENDOSE AL CATALOGO DE HOY?
 *
 * ES LA RESPUESTA A "¿Y QUE PASA SI NADIE LA REFRESCA?". Una fixture congelada
 * deja de ser un censo de hoy y pasa a ser regresion contra una foto: si Samsung
 * estrena un campo, la fixture no lo tiene y ninguna prueba lo ve. El costo es
 * real y esta escrito en BITACORA.md. Lo que lo acota es esto: el sistema avisa
 * solo cuando la foto se quedo vieja, en vez de esperar a que alguien se acuerde.
 *
 * Se comparan CAMPOS y no valores: los valores de la fixture estan viejos a
 * proposito y para siempre.
 */
export function fixtureAlDia(catalogo, fixture) {
  const hoy = formaDe(catalogo);
  const foto = formaDe(fixture);
  const faltan = hoy.filter((k) => !foto.includes(k));
  const sobran = foto.filter((k) => !hoy.includes(k));
  const cumple = faltan.length === 0 && sobran.length === 0;
  return {
    clave: "fixture-al-dia",
    titulo: "La fixture congelada tiene los mismos campos que el catálogo de hoy",
    valor: cumple,
    referencia: true,
    formato: "si-no",
    estado: cumple ? OK : ATENCION,
    texto: cumple
      ? `La fixture congelada tiene los mismos ${hoy.length} campos que el catálogo de hoy`
      : `HAY QUE REFRESCAR test/fixtures/catalogo.json (ver test/fixtures/LEEME.md)` +
        (faltan.length ? ` — campos nuevos que la fixture no tiene: ${faltan.join(", ")}` : "") +
        (sobran.length ? ` — campos que la fixture tiene y el catálogo ya no: ${sobran.join(", ")}` : ""),
  };
}

// ===========================================================================
// LA SERIE: LOS NUMEROS DEL CENSO A LO LARGO DEL TIEMPO
//
// ES LA LECCION CENTRAL DEL INCIDENTE, Y LA PRIMERA VERSION NO LA APLICO.
// El 2026-09-22 el sistema llevaba SEMANAS a 2,9 puntos de una raya y la deriva
// solo se pudo reconstruir DESPUES, snapshot a snapshot desde git. La primera
// version del censo media el numero de hoy, lo imprimia en el log de la corrida
// -- que es efimero -- y en el mensaje le decia al operador que mirara la serie
// "en data/ejecuciones.jsonl", donde no habia ni una fila de censo. Las dos
// cosas eran falsas: `resumenDeCenso` estaba exportada y probada, y NADIE la
// llamaba.
//
// Ahora cada revision deja su fila en `data/censo.jsonl` (append-only, union en
// los conflictos, se commitea con el resto de `data/`), y el mensaje calcula la
// deriva SOLO en vez de mandar al operador -- que no programa -- a abrir un
// .jsonl de cientos de KB a buscar "el numero de al lado".
// ===========================================================================

/**
 * Cuantos dias de serie se guardan.
 *
 * Lo suficiente para ver una deriva de verdad (la del incidente tardo semanas en
 * juntarse) y acotado para que el archivo no crezca para siempre. MEDIDO: una
 * fila pesa 435 bytes, son 20 por dia, asi que el archivo se estabiliza en
 * ~390 KB -- menos de la mitad de lo que pesa el catalogo que el repo commitea
 * en CADA una de esas 20 corridas.
 */
export const DIAS_DE_SERIE = 45;

/** El mismo tope que aplica `notifyTecnico`, que corta con `slice` y se comeria el pie del mensaje. */
const LARGO_MAX = 1900;

/** Una fila de la serie: los numeros de este censo, mas la clave que se aviso (o null). */
export function filaDeCenso(censo, { timestamp = "", avisado = null } = {}) {
  return { t: timestamp, ...resumenDeCenso(censo), avisado };
}

/** Lee `data/censo.jsonl`. Una linea ilegible se ignora en vez de tumbar el censo. */
export function leerSerie(texto) {
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
    .filter((f) => f && typeof f === "object" && f.censo);
}

/** La serie, podada a los ultimos `dias`. Es lo que se vuelve a escribir. */
export function serializarSerie(serie, hoy, dias = DIAS_DE_SERIE) {
  const limite = new Date(`${String(hoy).slice(0, 10)}T00:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() - (dias - 1));
  const desde = limite.toISOString().slice(0, 10);
  const vivas = (serie ?? []).filter((f) => String(f?.t ?? "").slice(0, 10) >= desde);
  return vivas.map((f) => JSON.stringify(f)).join("\n").concat(vivas.length > 0 ? "\n" : "");
}

/** La ultima clave que de verdad salio por Discord, o null si la serie no recuerda ninguna. */
export function ultimaClaveAvisada(serie) {
  for (let i = (serie ?? []).length - 1; i >= 0; i--) if (serie[i]?.avisado) return { clave: serie[i].avisado, t: serie[i].t ?? "" };
  return null;
}

/**
 * LA CLAVE DEL FRENO: que indicadores estan mal y en que estado. NO sus numeros.
 *
 * Con los numeros adentro, cada corrida tendria clave distinta y el freno no
 * frenaria nada: 20 mensajes diarios por el mismo canal donde llegan las bajas
 * de precio. Con el estado adentro, que un indicador pase de ATENCION a ALARMA
 * si vuelve a hablar.
 *
 * `sena` es el estado mas lo que el indicador considere que cambia el mensaje
 * (hoy: de que lado de la raya esta). Un indicador que no la define usa su
 * estado, que es lo de siempre.
 */
export function claveDeCenso(censo) {
  return `censo:${(censo?.indicadores ?? [])
    .filter((i) => i.estado !== OK)
    .map((i) => `${i.clave}:${i.sena ?? i.estado}`)
    .sort()
    .join("|")}`;
}

/**
 * COMO SE ESCRIBE EL VALOR DE UN INDICADOR EN LA LINEA DE DERIVA.
 *
 * El formato lo DECLARA cada indicador, y no se adivina mirando el numero. La
 * primera version lo adivinaba ("si el valor y su referencia caben en 1, es una
 * proporcion") y se equivocaba justo donde duele: `completas-sospechosas` es un
 * CONTEO con referencia 0, asi que una revision sospechosa se escribia como
 * "100.0%" y cero como "0.0%". El operador iba a leer un porcentaje inventado
 * en el unico mensaje que le queda.
 */
const fmtValor = (indicador, v) => {
  if (typeof v === "boolean") return v ? "sí" : "no";
  if (typeof v !== "number") return String(v);
  return indicador?.formato === "proporcion" ? pct(v) : String(v);
};

/**
 * EL REDONDEO CON QUE LOS NUMEROS VIAJAN A LA SERIE, Y CON EL QUE HAY QUE
 * COMPARARLOS DE VUELTA.
 *
 * Sin esto la comparacion es siempre distinta: la serie guarda 0,1351 y el
 * indicador vivo trae 0,13513..., asi que el mensaje diria "saltó en esta
 * revisión" en TODAS las revisiones, que es justo la clase de ruido que mata un
 * canario. Medido escribiendolo: el primer borrador lo hacia.
 */
const redondear = (v) => (typeof v === "number" ? Number(v.toFixed(4)) : v);

/**
 * LA DERIVA DE UN INDICADOR, DICHA POR EL CENSO EN VEZ DE DELEGADA.
 *
 * Contesta la pregunta que el operador necesita y no puede contestar solo:
 * ¿esto salto hoy, o viene derivando hace dias? Devuelve null cuando no hay con
 * que comparar, y lo dice en vez de inventar una tendencia con un solo punto.
 */
export function derivaDe(serie, indicador, { timestamp = "" } = {}) {
  const puntos = (serie ?? [])
    .filter((f) => f?.censo && f.censo[indicador.clave] !== undefined && f.censo[indicador.clave] !== null)
    .map((f) => ({ t: String(f.t ?? ""), v: f.censo[indicador.clave] }));
  if (puntos.length === 0) return "primera medición: todavía no hay serie con qué compararlo";

  const hoy = redondear(indicador.valor);
  const anterior = puntos[puntos.length - 1];
  const masViejo = puntos[0];
  const partes = [];
  if (anterior.v !== hoy) partes.push(`saltó en esta revisión desde ${fmtValor(indicador, anterior.v)}`);
  else partes.push("igual que en la revisión anterior");

  const dias = (Date.parse(timestamp) - Date.parse(masViejo.t)) / 86400000;
  if (Number.isFinite(dias) && dias >= 1 && masViejo.v !== hoy) {
    const d = Math.round(dias);
    partes.push(`hace ${d} ${d === 1 ? "día" : "días"} iba en ${fmtValor(indicador, masViejo.v)}`);
  } else if (Number.isFinite(dias) && dias >= 1) {
    const d = Math.round(dias);
    partes.push(`sin moverse en ${d} ${d === 1 ? "día" : "días"}`);
  }
  return partes.join("; ");
}

/**
 * EL MENSAJE PARA EL CANAL TECNICO.
 *
 * Solo salen los indicadores que NO estan en ok: un mensaje de 12 lineas verdes
 * en cada corrida es ruido, y el proyecto lleva desde agosto limpiando ese
 * canal. Los numeros de TODOS, verdes incluidos, quedan en `data/censo.jsonl`,
 * que es de donde sale la deriva que va debajo de cada linea.
 */
export function mensajeCenso(censo, { timestamp = "", serie = [] } = {}) {
  const malos = censo.indicadores.filter((i) => i.estado !== OK);
  if (malos.length === 0) return null;
  const alarmas = malos.filter((i) => i.estado === ALARMA);
  const cabecera =
    alarmas.length > 0
      ? `⚠️ **El censo del catálogo cruzó ${alarmas.length === 1 ? "una raya" : `${alarmas.length} rayas`}**`
      : `ℹ️ **El censo del catálogo se está acercando a una raya**`;
  const ordenados = [...alarmas, ...malos.filter((i) => i.estado === ATENCION)];

  // EL PRESUPUESTO DE LARGO, igual que el resto de los avisos tecnicos del
  // proyecto: `notifyTecnico` corta con `slice(0, 1900)`, y un mensaje cortado
  // pierde el pie -- o sea la linea que dice que esto NO detiene el monitor,
  // que es lo primero que el operador necesita saber. Con las lineas de deriva
  // agregadas, 12 indicadores en rojo pasan de 1.900 (medido: 2.077), asi que
  // se recorta de menos importante a mas: primero las derivas, despues los
  // indicadores, y el pie no se toca nunca.
  const armar = (conDeriva, cuantos) => {
    const lista = ordenados.slice(0, cuantos).flatMap((i) => {
      const deriva = conDeriva ? derivaDe(serie, i, { timestamp }) : null;
      return [`• ${i.texto}`, deriva ? `   ↳ ${deriva}` : null].filter((l) => l !== null);
    });
    const resto = ordenados.length > cuantos ? [`…y ${ordenados.length - cuantos} indicador(es) más.`] : [];
    // La linea en blanco separa los hallazgos de la explicacion y tiene que
    // sobrevivir: se filtra por `null`, no por falsy, que se la comia.
    return [
      cabecera,
      ...lista,
      ...resto,
      "",
      "Esto **no** detiene el monitor: son indicadores de que el catálogo se movió, no fallas del código.",
      "Qué hacer: nada urgente, y no hace falta abrir ningún archivo — la deriva va escrita arriba. Este aviso vuelve a salir solo cuando alguno de estos indicadores CAMBIE de estado (o una vez por semana, si la condición sigue igual).",
      timestamp ? `(censo del ${timestamp})` : null,
    ]
      .filter((l) => l !== null)
      .join("\n");
  };

  let texto = armar(true, ordenados.length);
  if (texto.length > LARGO_MAX) texto = armar(false, ordenados.length);
  let cuantos = ordenados.length;
  while (texto.length > LARGO_MAX && cuantos > 1) texto = armar(false, --cuantos);
  return texto;
}

/** Los numeros del censo tal como quedan en la fila de la serie. */
export function resumenDeCenso(censo) {
  return {
    censoEstado: censo.estado,
    censo: Object.fromEntries(censo.indicadores.map((i) => [i.clave, redondear(i.valor)])),
  };
}
