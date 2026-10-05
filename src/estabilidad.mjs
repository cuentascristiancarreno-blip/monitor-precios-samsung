// FRENO ANTI-PARPADEO: un rebote NO se calla, se DEGRADA.
//
// PEDIDO DEL OPERADOR (2026-09-13), textual: "Verifica que si ya me notificaste
// este cambio una vez, no es necesario volver a notificarlo las veces
// siguientes; o si efectivamente Samsung esta cambiando el precio, ya, esta bien
// que me notifiques, pero quizas puede ser un error. Siempre hay que hacer la
// revision versus la version anterior."
//
// ES UNA RED DE SEGURIDAD GENERAL, NO EL ARREGLO DE UNA CAUSA. Cada vaiven que
// se arreglo en este proyecto tenia su propia causa (la carrera del precio
// tachado, la hidratacion de digitalData, el selector de grupo de una /buy/) y
// cada una tardo dias en encontrarse. Este modulo no averigua la causa: mira la
// FORMA. Un producto que vuelve a un valor que el operador YA escucho hace poco
// no es una novedad, es un rebote.
//
// =========================================================================
// POR QUE ESTA VERSION NO CALLA NADA (2026-09-13, segunda vuelta)
//
// La primera version de este modulo SI callaba: marcaba el producto "inestable"
// y no avisaba nada hasta que se asentara 24 h. Tres verificaciones
// independientes la tumbaron, y las tres tenian razon. Medido sobre los 30 dias
// reales de data/history.jsonl (829 eventos), aquella version:
//
//   * CALLABA 61 BAJAS DE PRECIO REALES, 49 de ellas del 20% o mas (la mayor,
//     -46,9%: SM-X820NZADCHO de $1.599.990 a $849.990). Su informe decia
//     "legitimos perdidos: 0" porque definia legitimo como "el valor duro
//     >= 24 h despues", definicion CIRCULAR con su propia ventana de 24 h: toda
//     promo mas corta que un dia quedaba declarada ilegitima antes de contarla.
//     El encargo fijaba el criterio contrario: "si frena bajas reales, la regla
//     esta mal calibrada".
//   * NO SE SOLTABA NUNCA bajo un ciclo recurrente. El desfreno exigia 24 h
//     CORRIDAS sin ningun cambio y el reloj se reiniciaba con cada cambio,
//     incluidos los callados. Simulado con comparar() real: 7 dias de promo
//     diaria de verdad (-30%, 09:00-21:00) -> 1 aviso; 7 reposiciones de verdad
//     -> 1 aviso; los dos seguian callados al dia 7.
//   * FABRICABA la mitad del ruido que venia a apagar: al soltarse emitia un
//     aviso propio ("cambio neto"), 29 de los 719 emitidos en 30 dias. En el
//     monitor LS32DG300ELXZS eran 9 de sus 21 avisos, alternando "bajo/subio"
//     -- letra por letra el reclamo del operador.
//   * NO VEIA el parpadeo dominante del catalogo, que es LENTO: 95 de los 221
//     retornos de 30 dias caian fuera de su ventana de 24 h. El peor producto
//     seguia recibiendo 22 avisos en 30 dias.
//
// LA CONCLUSION QUE ORDENA ESTA VERSION: la forma de un parpadeo-bug y la de
// una promo real son la MISMA (medido: el vaiven del A36 sostiene cada valor 2,6
// a 9,1 h; la promo real del monitor, 3 a 9 h). No hay como separarlos mirando
// la forma, que es lo unico que este modulo puede mirar. Entonces no se decide
// por la forma QUE CALLAR: se decide COMO CONTARLO.
//
//   Un rebote no produce su propia alerta ("🟢 BAJO de $279.990 a $199.990"),
//   que es lo que el operador pidio no recibir de nuevo. Produce UNA LINEA
//   COMPACTA en la seccion "🌀 Siguen rebotando" del mismo resumen de la misma
//   corrida, que dice entre que valores rebota, cual es el valor de AHORA y
//   cuantas veces va. No hay atraso, no hay silencio, y no se puede perder una
//   baja real: el numero de hoy esta ahi.
//
// MEDIDO SOBRE LOS MISMOS 30 DIAS REALES (829 eventos, 206 corridas reales):
//   lineas de alerta "fuerte":            829 -> 680  (-18%)
//   bajas reales perdidas:                  0   (la primera version perdia 61)
//   el operador desinformado:               0,0 h   (la primera version, hasta
//                                           100 h seguidas segun la verificacion)
//   instantes con cambios:                125, de los cuales 49 (39%) dejan de
//                                         producir un mensaje fuerte del todo
//   peor producto (LS32DG300ELXZS):        22 -> 2 alertas fuertes en 30 dias
//   la ola REAL de 206 bajas del 09-09:     0 degradadas
//
// =========================================================================
// EL STOCK NO SE MIDE COMO EL PRECIO (2026-10-05, defecto medido en pleno Cyber)
//
// LO QUE PASO. En la semana del Cyber, 15 avisos de "volvio el stock" de
// productos que de verdad volvieron a estar comprables salieron DEGRADADOS, o
// sea como una linea chica bajo el titulo "Siguen rebotando (ya te los avise, no
// es novedad)". Medido sobre data/history.jsonl: 15 de los 73 avisos de
// reposicion de la semana (20,5%), 1.018 horas de disponibilidad real repartidas
// en 15 productos, 10 de ellos disponibles 24 h o mas y 8 todavia disponibles al
// cierre de la medicion. Entre ellos el 75" Micro RGB R85H ($1.399.990, 97 h) y
// el S26 Ultra + monitor Odyssey ($1.346.490, 92 h). 14 de los 15 eran la
// PRIMERA vez que ese producto volvia: nunca se le aviso.
//
// LA CAUSA, Y ES ESTRUCTURAL. El stock tiene SOLO TRES estados con valor
// (disponible / agotado / no-a-la-venta), asi que "volver a un valor que ya
// escuchaste" es, para el stock, simplemente... volver a estar disponible. Un
// producto que se agota el lunes genera `recordar(disponible)` y
// `recordar(agotado)` en la misma pasada -- las dos puntas del cambio --, asi
// que 48 h despues, cuando vuelve a haber stock, "disponible" ya esta en la
// memoria y el aviso sale degradado SIN QUE HAYA HABIDO NINGUN PARPADEO. Solo
// salia fuerte si el producto volvia pasadas las 72 h de la ventana. Dos de los
// 15 venian de 63,3 y 71,9 h agotados: estaban a horas de la raya.
//
// La ventana de 72 h funciona para el PRECIO porque ahi hay cientos de valores
// posibles y volver al valor exacto de antes es, de verdad, una señal. Para el
// stock es absurda.
//
// LA REGLA NUEVA: para el stock, lo que el operador "ya escucho" no es el ESTADO
// sino el CRUCE DE LA FRONTERA comprable <-> no comprable. Hay dos cruces
// posibles -- "volvio a poder comprarse" (reposicion) y "dejo de poder
// comprarse" (quiebre) -- y NO se tratan igual:
//
//   la REPOSICION no tiene ventana: SIEMPRE es alerta fuerte.
//   VENTANA_QUIEBRE_HORAS = 72   (el cruce HACIA no comprable)
//
// LA ASIMETRIA ES DELIBERADA Y TIENE SU RAZON ECONOMICA: una reposicion es el
// unico aviso de stock con el que el operador puede COMPRAR, y en Cyber un aviso
// de reposicion perdido cuesta plata; un "se agoto" repetido no cuesta nada.
// Ante la duda, el proyecto elige que el operador se entere.
//
// LA PRIMERA VERSION DE ESTE ARREGLO LE PUSO UN PISO DE 12 h A LA REPOSICION, Y
// SE SACO PORQUE NO COMPRABA NADA (2026-10-05, segunda vuelta, medido por tres
// verificaciones independientes y reproducido aca). Sobre los 478 eventos de
// stock notificables de todo el historial (2026-07-20 a 2026-10-05), clasificados
// con `cruceDeStock`/`esMatizNoComprable` -- o sea con el respaldo a los
// booleanos de los 101 eventos anteriores al 2026-09-12, que la medicion de la
// primera version se habia dejado afuera:
//
//     342 cruces de frontera (213 reposiciones · 129 quiebres) + 136 matices
//     88 casos en que el MISMO cruce se repite en el mismo SKU
//       repeticiones de REPOSICION: n=52 · minimo 20,44 h · p25 143 h · mediana 337 h
//       repeticiones de QUIEBRE:    n=36 · minimo 15,70 h · p25 36 h  · mediana 62 h
//     cubiertas por la ventana (las 88):  12 h -> 0 · 24 h -> 10 · 48 h -> 22 · 72 h -> 30
//
//   * LA REPOSICION NO SE DEGRADA NUNCA. Con el piso de 12 h, las 213
//     reposiciones del historial salian fuertes las 213: la ventana no degrado
//     NI UNA en 2,5 meses, asi que sacarla cuesta exactamente CERO eventos
//     distintos. Lo que si cargaba era riesgo: es el unico aviso de stock
//     accionable y el freno se le aplicaba justo a el. La reposicion mas rapida
//     que se repite en todo el historial esta a 20,44 h (NP750XGJ-KS4CL,
//     2026-08-15), y el caso limite del Galaxy A27 5G volvio a las 23,99 h --
//     o sea ni una ventana de 24 h habria tenido material, y el piso de 12 h
//     menos. Hay ademas una razon estructural: un cambio de stock necesita DOS
//     observaciones seguidas para confirmarse (ver comparar.mjs), y con 20
//     revisiones al dia dos reposiciones del mismo SKU no pueden estar a menos
//     de ~3 h una de otra.
//   * 72 h para el quiebre: es donde se aplana la curva (96 h agrega 2 casos de
//     los 22 de 48 h) y cubre un fin de semana entero. Ahi SI hay material: 19
//     de los 36 quiebres repetidos caen dentro, y el unico parpadeo de stock
//     DIAGNOSTICADO del proyecto -- el A36 del 2026-09-12/14, que resulto ser el
//     selector de grupo de su /buy/ -- sigue saliendo compacto en sus repetidos:
//     de sus 7 cruces, 5 fuertes y 2 compactos (sus reposiciones se repiten a
//     22,65 h y 26,34 h, o sea que tampoco las tocaba el piso de 12 h).
//
// MEDIDO, los 73 avisos de reposicion de la semana del Cyber pasan de 58 fuertes
// a 73 fuertes, y de los 34 avisos de stock degradados de esa semana solo 6 eran
// parpadeo de verdad. Sobre el historial completo: 403 fuertes / 75 degradados
// con la regla vieja -> 323 fuertes / 19 degradados / 136 matices, y los 19
// degradados son TODOS quiebres repetidos (0 reposiciones).
//
// LA MEMORIA VIEJA NO PRODUCE NINGUNA TANDA AL DESPLEGAR. La memoria de stock
// cambia de forma (de `v: ["disponible","agotado"]` a `c: {cruce: instante}`) y
// una memoria vieja se lee como vacia, asi que la primera corrida con este
// codigo no degrada ningun cambio de stock. El efecto solo puede ir en la
// direccion de MAS alertas fuertes, nunca menos, y esta acotado por los cambios
// de stock de esa corrida.
//
// =========================================================================
// DOS FORMAS DE "NO SE PUEDE COMPRAR" NO SON UNA NOVEDAD (2026-10-05)
//
// La otra mitad del mismo defecto. 107 de las 590 alertas fuertes de la semana
// del Cyber (18,1%) avisaban que un producto paso de "agotado" a "no esta a la
// venta". Las dos cosas significan que el operador no puede comprarlo: no podia
// antes y no puede ahora. 89 de ellas (132 contando accesorios) salieron en UNA
// SOLA revision, la del 2026-10-02T11:19, en una seguidilla de mensajes que
// decian todos lo mismo: 43 televisores, 14 de lavado y secado, 6 aspiradoras,
// 6 monitores, 6 de cocina.
//
// NO ES UNA LECTURA MALA: 124 de los 132 seguian en "no esta a la venta" tres
// dias despues. Samsung cambio algo de verdad. Y es NUEVO: ese par de estados
// dio 12, 5, 1 y 0 avisos en las semanas anteriores y esa semana dio 117.
// Entraba por una puerta que el freno no podia cubrir: "no-a-la-venta" era un
// estado no visto en 72 h, o sea NOVEDAD por diseño.
//
// EL OPERADOR PIDIO DISTINGUIR LOS DOS ESTADOS y se siguen distinguiendo en el
// catalogo, en el historial y en el mensaje. Lo que cambia es que la TRANSICION
// entre dos formas de "no se puede comprar" deja de merecer una alerta fuerte:
// sale como una linea compacta en su propia seccion. Lo que cruza la frontera
// comprable <-> no comprable -- "se agoto" y "volvio el stock" -- sigue saliendo
// fuerte SIEMPRE, y eso lo fija una prueba.
//
// PERO LAS DOS DIRECCIONES NO VALEN LO MISMO, Y ESO ESTA MEDIDO (2026-10-05,
// segunda vuelta). La primera version de este arreglo las trato igual; dos
// verificaciones independientes midieron que no lo son, y se reprodujo aca
// agrupando los 478 eventos por SKU y mirando el evento de stock SIGUIENTE:
//
//   agotado -> no esta a la venta   n=113 · siguiente evento ya disponible:  0
//                                         · con reposicion dentro de 72 h:   5 (4,4%)
//   no esta a la venta -> agotado   n= 23 · siguiente evento ya disponible:  9
//                                         · con reposicion dentro de 72 h:  10 (43%)
//   base (cualquier evento que deja el producto no comprable): 63 de 265 (24%)
//
// O sea: "no esta a la venta -> agotado" significa que Samsung volvio a LISTAR
// el producto para venta, y es un ANTICIPO de que se va a poder comprar -- 9 de
// 23 tenian el stock de vuelta en el evento siguiente, 6 de ellos a las 8,4 h
// (seis combos Galaxy Watch + Buds de $674.980 a $1.024.980, revision del
// 2026-10-02T15:54). En la direccion contraria eso no paso NI UNA vez en 113
// casos. Las dos siguen sin ser alerta fuerte -- en el momento del matiz no se
// puede comprar nada, que es lo que el encargo autorizo degradar -- pero la que
// anticipa tiene su propia linea, con precio y link, en vez de ir con un titulo
// que dice "siguen sin poder comprarse". Son 23 en 2,5 meses y 15 en la semana
// del Cyber: no mueve el presupuesto de mensajes.

// Se reusa el mismo `horasEntre` que los pisos de reloj de src/comparar.mjs (y
// que vive en src/alcance.mjs): devuelve null cuando el tiempo no se puede
// medir. Aca esa respuesta significa OLVIDAR la memoria, que es lo que impide
// que un registro legado quede degradando avisos para siempre.
import { horasEntre } from "./alcance.mjs";
import { ESTADO, disponibleDe } from "./stock.mjs";

/** Horas que un PRECIO sigue contando como "el operador ya lo escucho". */
export const VENTANA_REBOTE_HORAS = 72;
/** Cuantos valores distintos hacia atras se recuerdan por magnitud. */
export const VALORES_RECORDADOS = 6;
/** Horas que un QUIEBRE ("dejo de poder comprarse") sigue contando como ya escuchado. */
export const VENTANA_QUIEBRE_HORAS = 72;

/**
 * Los dos lados de la unica frontera que le importa al operador: puede comprarlo
 * o no puede. "agotado" y "no esta a la venta" son el mismo lado.
 */
export const LADO = { COMPRABLE: "comprable", NO_COMPRABLE: "no-comprable" };

/**
 * La ventana de cada cruce. `null` significa QUE ESE CRUCE NO SE DEGRADA NUNCA,
 * y es el caso de la reposicion: medido sobre el historial completo, el piso de
 * 12 h que tuvo la primera version de este arreglo no degrado ni una de las 213
 * reposiciones, y es el unico aviso de stock con el que el operador puede
 * comprar (ver la nota larga de arriba).
 */
const VENTANA_POR_LADO = {
  [LADO.COMPRABLE]: null,
  [LADO.NO_COMPRABLE]: VENTANA_QUIEBRE_HORAS,
};
/** ¿Este cruce puede salir compacto por repetirse? Solo el quiebre. */
function ventanaDelLado(lado) {
  const v = VENTANA_POR_LADO[lado];
  return Number.isFinite(v) && v > 0 ? v : null;
}
const VENTANA_STOCK_MAX = VENTANA_QUIEBRE_HORAS;

/**
 * Las dos magnitudes que el freno vigila. Este descriptor es lo que consumen
 * comparar() y el resumen de la corrida; la decision de cada una vive en
 * evaluarEstabilidad, en dos bloques explicitos, porque el precio compara
 * VALORES y el stock compara CRUCES y forzar las dos cosas en un mismo bucle
 * generico fue justo lo que produjo el defecto del 2026-10-05.
 *
 * El stock "desconocido" NO es un valor: es la ausencia de uno (misma regla que
 * src/stock.mjs). Si entrara a la memoria, una lectura ilegible contaria como un
 * valor mas y dos lecturas ilegibles seguidas se verian como un rebote.
 */
export const MAGNITUDES = [
  {
    clave: "precio",
    campo: "rebotePrecio",
    tipos: ["baja", "sube"],
    ventanaMax: VENTANA_REBOTE_HORAS,
    valorDe: (rec) => (Number.isFinite(rec?.precio) ? rec.precio : null),
    valoresDe: (m) => (Array.isArray(m?.v) ? m.v.slice(0, 3) : []),
    memoriaVigente: () => true,
  },
  // `valoresDe` RECIBE EL INSTANTE, y para el stock no es un adorno (2026-10-05,
  // segunda vuelta, defecto medido). `rebotesDe` publica estos valores en el
  // aviso tecnico de "productos que estan rebotando", y hasta ahora imprimia las
  // llaves CRUDAS del registro: la poda por cruce vivia solo dentro de
  // `memoriaDeStock`, o sea al EVALUAR y no al MOSTRAR. Medido replayando el
  // historial con el catalogo al lado: 8 avisos tecnicos entregables afirmaban
  // "no se puede comprar" de un producto que el catalogo daba por DISPONIBLE
  // (NP750XGJ-KS6CL 24/25/26-08, NP750XGJ-KS4CL 10 y 11-09, SM-A366ELVGLTL 16 y
  // 17-09, SM-A276BZBKLTL 02-10), y los 8 van en la direccion que cuesta plata.
  {
    clave: "stock",
    campo: "reboteStock",
    tipos: ["stock"],
    ventanaMax: VENTANA_STOCK_MAX,
    valorDe: (rec) =>
      typeof rec?.estadoStock === "string" && rec.estadoStock !== ESTADO.DESCONOCIDO ? rec.estadoStock : null,
    // las llaves de la memoria de stock son los CRUCES ya escuchados, PODADOS
    // con la ventana de cada uno: la misma poda que usa la decision, para que
    // lo que se muestra y lo que se decide no puedan divergir.
    valoresDe: (m, timestamp) => Object.keys(crucesVigentes(m, timestamp)),
    // UNA MEMORIA DE LA VERSION ANTERIOR NO CUENTA (2026-10-05). La version
    // anterior guardaba `v: [estados]` y su contador de rebotes lo produjo una
    // regla que ya no existe. Medido sobre el catalogo real: 190 de 1.086
    // registros la traen, y sin esta linea la primera corrida con este codigo
    // manda un aviso tecnico nombrando ~17 productos "rebotando" segun la regla
    // retirada (lo midio la corrida real del pipeline contra una copia). Se
    // olvida sola: en cuanto ese SKU tenga su proximo cambio de stock, el campo
    // se reescribe con la forma nueva. Una memoria heredada NO tiene respaldo a
    // `v`, y es a proposito: el aviso tecnico mudo es el resultado buscado.
    memoriaVigente: (m) => m?.c !== undefined,
  },
];

/**
 * Estado de stock que viaja en un cambio. Los eventos viejos de
 * data/history.jsonl y de data/pendientes.jsonl solo traen los booleanos, asi
 * que se cae a ellos igual que lo hace src/discord.mjs.
 */
function estadoDelCambio(cambio, campo, booleano) {
  const e = cambio?.[campo];
  if (typeof e === "string" && e) return e;
  if (cambio?.[booleano] === true) return ESTADO.DISPONIBLE;
  if (cambio?.[booleano] === false) return ESTADO.AGOTADO;
  return null;
}

/** ¿De que lado de la frontera esta este estado? null cuando no se sabe. */
export function ladoDe(estado) {
  const d = disponibleDe(estado);
  if (d === true) return LADO.COMPRABLE;
  if (d === false) return LADO.NO_COMPRABLE;
  return null;
}

/**
 * El CRUCE que anuncia un cambio de stock: el lado al que se mueve, o null si no
 * cruza la frontera (o si alguno de los dos estados no se puede leer).
 */
export function cruceDeStock(cambio) {
  if (cambio?.tipo !== "stock") return null;
  const antes = ladoDe(estadoDelCambio(cambio, "estadoAnterior", "disponibleAnterior"));
  const ahora = ladoDe(estadoDelCambio(cambio, "estado", "disponible"));
  if (antes === null || ahora === null || antes === ahora) return null;
  return ahora;
}

/**
 * ¿Este cambio de stock va de una forma de "no se puede comprar" a OTRA forma de
 * "no se puede comprar"? (agotado <-> no esta a la venta)
 *
 * Se exige que los DOS lados sean el no-comprable y no solo que sean iguales: un
 * hipotetico comprable -> comprable (que hoy no puede emitirse, porque
 * comparar() solo emite cuando el estado cambia) no tiene por que quedar
 * degradado por esta regla.
 */
export function esMatizNoComprable(cambio) {
  if (cambio?.tipo !== "stock") return false;
  const antes = ladoDe(estadoDelCambio(cambio, "estadoAnterior", "disponibleAnterior"));
  const ahora = ladoDe(estadoDelCambio(cambio, "estado", "disponible"));
  return antes === LADO.NO_COMPRABLE && ahora === LADO.NO_COMPRABLE;
}

/**
 * Las dos clases de matiz. La direccion importa y esta medida (ver la nota de
 * arriba): "no esta a la venta -> agotado" es Samsung volviendo a LISTAR el
 * producto, y 9 de 23 tenian el stock de vuelta en el evento siguiente -- 6 de
 * ellos a las 8,4 h -- contra 0 de 113 en la direccion contraria.
 */
export const MATIZ = {
  /** volvio al catalogo, todavia sin stock (no-a-la-venta -> agotado) */
  VUELVE: "vuelve-al-catalogo",
  /** lo sacaron de venta (agotado -> no-a-la-venta, y cualquier otro par) */
  SALE: "sale-de-venta",
};

/**
 * ¿Que clase de matiz es este cambio? null si no es un matiz.
 *
 * El caso "agotado -> agotado" no lo puede emitir comparar() (solo emite cuando
 * el estado cambia), pero SI aparece al replayar los eventos viejos de
 * history.jsonl, que solo traen los booleanos: ahi las dos puntas se leen
 * "agotado" y la direccion no se puede saber. Cae en SALE, que es la clase
 * generica.
 */
export function matizDe(cambio) {
  if (!esMatizNoComprable(cambio)) return null;
  const antes = estadoDelCambio(cambio, "estadoAnterior", "disponibleAnterior");
  const ahora = estadoDelCambio(cambio, "estado", "disponible");
  return antes === ESTADO.NO_A_LA_VENTA && ahora === ESTADO.AGOTADO ? MATIZ.VUELVE : MATIZ.SALE;
}

/**
 * ¿Este matiz es el que ANTICIPA una reposicion ("volvio al catalogo, todavia
 * sin stock")? Una sola definicion para discord.mjs y para el resumen.
 */
export function esMatizQueVuelve(cambio) {
  return cambio?.matiz === true && cambio?.matizClase === MATIZ.VUELVE;
}

/**
 * Los cruces de una memoria de stock que TODAVIA cuentan como "ya avisados",
 * cada uno podado con SU ventana. Una llave sin ventana se descarta, y eso cubre
 * dos casos de una vez: la reposicion (que nunca se degrada, asi que no hay nada
 * que recordar) y una llave ajena o corrupta, que si no quedaria para siempre --
 * la poda es por ventana, y para una llave desconocida no hay ninguna.
 */
export function crucesVigentes(m, timestamp) {
  const c = {};
  for (const [lado, ts] of Object.entries(m?.c ?? {})) {
    const ventana = ventanaDelLado(lado);
    if (ventana === null) continue;
    const h = horasEntre(ts, timestamp);
    if (h !== null && h <= ventana) c[lado] = ts;
  }
  return c;
}

/**
 * La memoria de PRECIO guardada, en su forma compacta y con los dos relojes ya
 * aplicados. NO CAMBIO en el arreglo del 2026-10-05: el precio es la magnitud
 * donde "volver a un valor ya visto" si es una señal, y toda la calibracion de
 * la entrega anterior (y el peso en disco medido) se apoya en esta forma.
 *
 * FORMA: `{ v: [valores, el mas reciente primero], hasta, n, ultimo, desde }`.
 * Un solo instante (`hasta`) para TODO el conjunto de valores, y los rebotes
 * CONTADOS (`n`) en vez de una lista de instantes. Medido contra la forma cara
 * (un instante por valor y la lista entera de rebotes): resultado identico sobre
 * los 829 eventos reales -- mismos 680 emitidos, mismos 149 degradados, mismo
 * peor producto -- a un tercio del tamano.
 */
function memoriaDePrecio(ant, timestamp) {
  const m = ant?.rebotePrecio;
  const vigente = (ts) => {
    const h = horasEntre(ts, timestamp);
    return h !== null && h <= VENTANA_REBOTE_HORAS;
  };
  const mem = {
    v: Array.isArray(m?.v) ? m.v.filter((x) => x !== undefined && x !== null) : [],
    hasta: m?.hasta ?? null,
    n: Number.isFinite(m?.n) ? m.n : 0,
    ultimo: m?.ultimo ?? null,
    desde: m?.desde ?? null,
  };
  // LOS DOS RELOJES SE APLICAN AL LEER, NO AL ESCRIBIR. Asi un registro que
  // quedo guardado hace una semana (o con una fecha ilegible) no arrastra su
  // memoria: se olvida sola. Es lo que hace imposible un "rebote inmortal".
  if (!vigente(mem.hasta)) {
    mem.v = [];
    mem.hasta = null;
  }
  if (!vigente(mem.ultimo)) {
    mem.n = 0;
    mem.ultimo = null;
    mem.desde = null;
  }
  return mem;
}

/**
 * La memoria de STOCK: un instante por CRUCE ya escuchado, podado con la ventana
 * de ese cruce (72 h el quiebre; la reposicion no se guarda, porque no se
 * degrada nunca).
 *
 * FORMA: `{ c: { "no-comprable": instante }, n, ultimo, desde }`.
 *
 * Una llave que no tenga ventana se descarta (ver `crucesVigentes`), y eso es lo
 * que hace la migracion gratis: la memoria de la version anterior guardaba
 * ESTADOS (`v: ["disponible","agotado"]`) y aca se lee como vacia, asi que la
 * primera corrida con este codigo no degrada ningun cambio de stock.
 */
function memoriaDeStock(ant, timestamp) {
  const m = ant?.reboteStock;
  // UNA MEMORIA HEREDADA SE OLVIDA ENTERA, CONTADOR INCLUIDO. La version anterior
  // guardaba `v: [estados]` y su `n` lo conto una regla que ya no existe: 190 de
  // los 1.086 registros del catalogo real los traen, y dejarles el contador vivo
  // habria hecho que la primera corrida con este codigo mandara un aviso tecnico
  // nombrando ~17 productos "rebotando" segun una regla retirada (medido en la
  // corrida real del pipeline). El dato no se pierde: sigue en el registro hasta
  // que ese SKU tenga su proximo cambio de stock, y el aviso tecnico queda mudo
  // a proposito: no hay nada que contar sobre una regla retirada.
  const heredada = Boolean(m) && m.c === undefined;
  const c = crucesVigentes(m, timestamp);
  const mem = {
    c,
    n: !heredada && Number.isFinite(m?.n) ? m.n : 0,
    ultimo: heredada ? null : m?.ultimo ?? null,
    desde: heredada ? null : m?.desde ?? null,
  };
  const h = horasEntre(mem.ultimo, timestamp);
  if (h === null || h > VENTANA_STOCK_MAX) {
    mem.n = 0;
    mem.ultimo = null;
    mem.desde = null;
  }
  return mem;
}

/** ¿queda algo que recordar? Si no, el campo se borra del registro. */
function vaciaPrecio(m) {
  return m.v.length === 0 && m.n === 0;
}
function vaciaStock(m) {
  return Object.keys(m.c).length === 0 && m.n === 0;
}

/** Mete un valor adelante de la lista de conocidos, sin repetirlo. */
function recordar(m, valor, timestamp) {
  if (valor === undefined || valor === null) return;
  m.v = [valor, ...m.v.filter((x) => x !== valor)].slice(0, VALORES_RECORDADOS);
  m.hasta = timestamp;
}

/**
 * ¿Este precio es uno que el operador YA escucho dentro de la ventana?
 *
 * Lo necesita comparar() ANTES de decidir si adopta el precio observado (ver
 * `reboteArribaReciente`), o sea antes de que este modulo corra sobre los
 * cambios ya decididos. Es la misma memoria y la misma poda, asi que las dos
 * decisiones no pueden divergir.
 */
export function precioYaConocido({ ant, precio, timestamp }) {
  if (!Number.isFinite(precio)) return false;
  return memoriaDePrecio(ant, timestamp).v.includes(precio);
}

/**
 * HORAS MINIMAS PARA CREERLE A UN REBOTE HACIA ARRIBA (2026-10-05).
 *
 * El numero sale de medir los 1.598 eventos de precio notificables de todo el
 * historial. De ellos, 119 son "rebotes hacia arriba": el precio sube a un valor
 * que el SKU ya habia tenido dentro de la ventana del freno. Ordenados por
 * cuanto tiempo paso desde el cambio de precio ANTERIOR del mismo SKU:
 *
 *     0,72 h  ->  17 eventos   (los 16 del 2026-10-01T17:20 + SM-A075MLVGLTL)
 *     2,55 h  ->  el siguiente mas rapido (A36 y monitor Odyssey G3)
 *     mediana 4,26 h · p75 13,47 h
 *
 * Hay un hueco limpio entre 0,72 h y 2,55 h, y los 17 que caen abajo son
 * exactamente los dos episodios que una medicion INDEPENDIENTE (los avisos cuya
 * base resulto revertida por la lectura siguiente) marco como lecturas malas. 2 h
 * deja 1,8 h de margen contra el rebote hacia arriba real mas rapido que existe.
 *
 * 2 h es ademas del orden de tres revisiones: las tres corridas del vaiven
 * fueron 16:37, 17:20 y 18:00, o sea ~41 min cada una.
 */
export const HORAS_MIN_REBOTE_ARRIBA = 2;

/**
 * ¿Este cambio de precio es un rebote HACIA ARRIBA tan rapido que no se le puede
 * creer con una sola lectura?
 *
 * Tres condiciones, y las tres hacen falta:
 *  1. sube (el precio nuevo es mayor que el guardado). Un cambio hacia ABAJO es
 *     una oportunidad de compra y se avisa al instante, rebote o no: en Cyber un
 *     aviso perdido cuesta mas que uno de mas.
 *  2. va a un valor que el operador YA escucho dentro de la ventana. Un valor
 *     nuevo es indistinguible de un cambio real y no se toca.
 *  3. llega a menos de HORAS_MIN_REBOTE_ARRIBA del cambio de precio anterior del
 *     mismo SKU (`hasta` de la memoria, que se refresca con cada cambio emitido).
 *     Si no se puede medir el tiempo, NO se frena: el lado seguro es avisar.
 *
 * La condicion 3 es la que impide que esta regla congele un producto que rebota
 * de verdad: el monitor Odyssey G3, con sus 58 cambios reales en 30 dias, nunca
 * vuelve a un valor en menos de 2,55 h, asi que sus avisos salen todos (compactos
 * cuando repiten, con el precio de hoy).
 */
export function reboteArribaReciente({ ant, precio, precioAnterior, timestamp }) {
  if (!Number.isFinite(precio) || !Number.isFinite(precioAnterior)) return false;
  if (!(precio > precioAnterior)) return false;
  const mem = memoriaDePrecio(ant, timestamp);
  if (!mem.v.includes(precio)) return false;
  const h = horasEntre(mem.hasta, timestamp);
  return h !== null && h <= HORAS_MIN_REBOTE_ARRIBA;
}

/**
 * Decide, para UN producto y UNA corrida, cuales avisos son novedad y cuales son
 * un rebote (que sale igual, pero en la seccion compacta del resumen).
 *
 * Es PURA a proposito: la misma funcion la llaman el despachador de avisos en
 * vivo (a mitad de corrida) y comparar() al cerrar, con el mismo `ant` y el
 * mismo `timestamp`, y tienen que dar exactamente lo mismo. Si mutara el
 * registro anterior, el aviso saldria en vivo y el cierre lo volveria a mandar
 * (o al reves).
 *
 * @param ant registro guardado: la "version anterior" contra la que el operador
 *   pidio comparar siempre
 * @param cambios los cambios que evaluarObservado ya decidio
 * @returns {{ memorias, cambios, rebotes, nuevosRebotando, matices }}
 *   - `cambios`: los mismos que entraron; los que son un rebote salen marcados
 *     `rebote: true`, con `valoresRebote` (entre que valores va) y
 *     `vecesRebotado`, y los que son un matiz de "no se puede comprar" salen
 *     marcados `matiz: true`. Siguen yendo enteros a data/history.jsonl.
 *   - `nuevosRebotando`: los que ACABAN de empezar a rebotar en esta corrida.
 *   - `matices`: los cambios de stock que no cruzan la frontera.
 */
export function evaluarEstabilidad({ ant, cambios = [], timestamp }) {
  const memorias = {};
  // EL ORDEN DE `cambios` SE CONSERVA. "recuperado" va antes que "baja" y eso lo
  // fija una prueba (test/vivo.test.mjs exige que evaluarObservado y comparar()
  // emitan exactamente la misma lista): reagrupar por magnitud la cambiaba.
  const decidido = new Map();
  const rebotes = [];
  const nuevosRebotando = [];
  const matices = [];

  // ---------------------------------------------------------------- PRECIO
  // Compara VALORES: con cientos de precios posibles, volver al valor exacto de
  // antes dentro de la ventana es una señal de vaiven.
  const mp = memoriaDePrecio(ant, timestamp);
  for (const c of cambios.filter((x) => x?.tipo === "baja" || x?.tipo === "sube")) {
    const nuevo = c?.precio;
    const anterior = c?.precioAnterior;
    // ¿ES UN REBOTE? Solo si el valor al que va ya esta en la memoria, o sea
    // si el operador ya lo escucho dentro de la ventana. UN VALOR NUEVO ES
    // SIEMPRE NOVEDAD: una baja de Cyber es un numero que no esta ahi, asi que
    // sale como alerta fuerte aunque el producto venga rebotando hace dias.
    const esUnRebote = mp.v.includes(nuevo);
    const veniaRebotando = mp.n > 0;

    // El valor que se deja atras tambien pasa a ser conocido: el operador lo
    // sabia -- era lo que decia el catalogo -- asi que volver a el no es
    // novedad. Y el valor nuevo se refresca aunque sea un rebote: mientras el
    // producto siga visitandolo, sigue siendo un valor que el ya conoce. Ese
    // refresco es lo que impide que cada vuelta parezca un episodio nuevo,
    // que es como la version anterior dejaba escapar el parpadeo LENTO.
    // (Medido: separar las dos llamadas, dejando la del valor nuevo solo para
    // los que no son rebote, da el MISMO resultado sobre los 829 eventos reales
    // -- porque salir de un valor ya lo vuelve a recordar como `anterior`. Se
    // deja junto igual: la redundancia es el punto.)
    for (const valor of [anterior, nuevo]) recordar(mp, valor, timestamp);

    if (!esUnRebote) continue;

    mp.n += 1;
    mp.ultimo = timestamp;
    if (!mp.desde) mp.desde = timestamp;
    if (!veniaRebotando) nuevosRebotando.push({ magnitud: "precio", valor: nuevo, anterior });
    rebotes.push({ magnitud: "precio", valor: nuevo, tipo: c.tipo });
    decidido.set(c, {
      ...c,
      rebote: true,
      // lo que necesita la linea compacta del resumen, calculado aca y no en
      // discord.mjs porque es lo unico que conoce la memoria
      valoresRebote: mp.v.slice(0, 3),
      vecesRebotado: mp.n,
      rebotandoDesde: mp.desde,
    });
  }
  if (!vaciaPrecio(mp)) memorias.rebotePrecio = mp;

  // ----------------------------------------------------------------- STOCK
  // Compara CRUCES DE FRONTERA, no estados (ver la nota larga de arriba).
  const ms = memoriaDeStock(ant, timestamp);
  for (const c of cambios.filter((x) => x?.tipo === "stock")) {
    // (1) Dos formas de "no se puede comprar": no es novedad y no entra a la
    //     memoria de cruces. No se calla -- sale compacto, con su estado nuevo.
    if (esMatizNoComprable(c)) {
      const clase = matizDe(c);
      matices.push({
        magnitud: "stock",
        clase,
        estado: estadoDelCambio(c, "estado", "disponible"),
        estadoAnterior: estadoDelCambio(c, "estadoAnterior", "disponibleAnterior"),
      });
      decidido.set(c, { ...c, matiz: true, matizClase: clase });
      continue;
    }

    // (2) Un cruce de verdad. Si no se puede leer de que cruce se trata (estados
    //     ausentes o "desconocido"), no se toca nada: sale como alerta fuerte,
    //     que es el lado seguro.
    const lado = cruceDeStock(c);
    if (lado === null) continue;

    // (3) UNA REPOSICION NO SE DEGRADA NUNCA, y por eso tampoco se recuerda: no
    //     hay ningun instante contra el cual compararla despues. Medido sobre el
    //     historial completo, el piso de 12 h que tuvo la primera version de
    //     este arreglo no degrado ni una de las 213 reposiciones (la mas rapida
    //     que se repite esta a 20,44 h), y es el unico aviso de stock con el que
    //     el operador puede comprar. Ver la nota larga del encabezado.
    if (ventanaDelLado(lado) === null) continue;

    const esUnRebote = Boolean(ms.c[lado]);
    const veniaRebotando = ms.n > 0;
    // el cruce se refresca siempre, igual que el valor del precio: un parpadeo
    // sostenido sigue saliendo compacto en vez de parecer un episodio nuevo
    ms.c[lado] = timestamp;

    if (!esUnRebote) continue;

    ms.n += 1;
    ms.ultimo = timestamp;
    if (!ms.desde) ms.desde = timestamp;
    if (!veniaRebotando) {
      nuevosRebotando.push({
        magnitud: "stock",
        valor: estadoDelCambio(c, "estado", "disponible"),
        anterior: estadoDelCambio(c, "estadoAnterior", "disponibleAnterior"),
      });
    }
    rebotes.push({ magnitud: "stock", valor: estadoDelCambio(c, "estado", "disponible"), tipo: c.tipo });
    decidido.set(c, {
      ...c,
      rebote: true,
      ladoRebote: lado,
      vecesRebotado: ms.n,
      rebotandoDesde: ms.desde,
    });
  }
  if (!vaciaStock(ms)) memorias.reboteStock = ms;

  // Los cambios de otras magnitudes (nuevo, recuperado, desaparecido) pasan tal
  // cual: el freno es solo para precio y stock.
  const salida = cambios.map((c) => decidido.get(c) ?? c);
  return { memorias, cambios: salida, rebotes, nuevosRebotando, matices };
}

/**
 * ¿Este cambio es un rebote (y por lo tanto va en la seccion compacta en vez de
 * en las secciones fuertes)? Una sola definicion, para que discord.mjs y el
 * despachador no puedan divergir.
 */
export function esRebote(cambio) {
  return cambio?.rebote === true;
}

/**
 * ¿Este cambio es un matiz entre dos formas de "no se puede comprar"? Tambien
 * sale compacto, pero en su propia seccion y con su propio titulo: no es un
 * vaiven, es un cambio real del sitio que no mueve la unica frontera que le
 * importa al operador.
 *
 * Hay DOS clases (ver `matizDe`): el que anticipa una reposicion y el que no.
 * Las dos salen compactas; `esMatizQueVuelve` separa la que lleva precio y link.
 */
export function esMatiz(cambio) {
  return cambio?.matiz === true;
}

/** Horas de la ventana que le aplica a este cambio, para poder decirlo en el mensaje. */
export function ventanaDe(cambio) {
  if (cambio?.tipo !== "stock") return VENTANA_REBOTE_HORAS;
  return ventanaDelLado(cambio?.ladoRebote) ?? VENTANA_STOCK_MAX;
}
