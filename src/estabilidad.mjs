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
// LAS DOS CONSTANTES, MEDIDAS (no intuidas)
//
// VENTANA_REBOTE_HORAS = 72
//   Cuanto tiempo un valor sigue contando como "el operador ya lo escucho". Se
//   calibra contra la separacion real entre cambios DENTRO de un episodio de
//   parpadeo (26 pares SKU/magnitud con 3 o mas retornos, 227 separaciones):
//       ventana   separaciones que quedan cubiertas
//         24 h        76,2%
//         36 h        83,3%
//         48 h        85,9%
//         72 h        87,2%
//         96 h        87,7%
//        168 h        90,7%
//   La curva se aplana en 72 h (96 h agrega 0,5 puntos). Ademas 72 h cubre un
//   fin de semana entero, que 48 h no. Y el costo de equivocarse por arriba es
//   bajo A PROPOSITO: un rebote de mas solo cambia la FORMA del aviso, no lo
//   borra. Con 24 h, que es lo que tenia la version anterior, el peor producto
//   recibia 22 alertas fuertes en 30 dias; con 72 h recibe 2.
//
// VALORES_RECORDADOS = 6
//   Cuantos valores distintos se recuerdan por magnitud. Medido sobre los mismos
//   30 dias: 2 -> 685 alertas fuertes, 4 -> 680, 6 -> 680 (y el peso en disco es
//   IDENTICO con 4 y con 6, porque casi ningun producto llega a tener tantos).
//   No se deja en 2: con 2 valores recordados cualquier ciclo de 3 o mas valores
//   es ESTRUCTURALMENTE invisible -- el valor al que se vuelve se abandono tres
//   pasos atras y ya no esta en memoria. SM-X400NZAHCHO ya es ese caso casi
//   real: vuelve siempre a $649.990 pero con un minimo distinto cada vez
//   (449.990 / 409.990 / 459.990 / 479.990). Con 6 se cierran los ciclos de
//   hasta 6 valores sin costo medible.
//
// PESO EN DISCO, MEDIDO: en el PEOR instante de los 30 dias (2026-09-12T14:09)
// hay 292 memorias vigentes y ocupan 32,0 KB sobre los 917,2 KB de
// data/latest.json = +3,5%. La poda por reloj es lo que lo mantiene ahi: en
// cuanto un producto deja de moverse 72 h, su campo desaparece del registro.

// Se reusa el mismo `horasEntre` que los pisos de reloj de src/comparar.mjs (y
// que vive en src/alcance.mjs): devuelve null cuando el tiempo no se puede
// medir. Aca esa respuesta significa OLVIDAR la memoria, que es lo que impide
// que un registro legado quede degradando avisos para siempre.
import { horasEntre } from "./alcance.mjs";

/** Horas que un valor sigue contando como "el operador ya lo escucho". */
export const VENTANA_REBOTE_HORAS = 72;
/** Cuantos valores distintos hacia atras se recuerdan por magnitud. */
export const VALORES_RECORDADOS = 6;

/**
 * Las dos magnitudes que el freno vigila. Cada una dice de donde sale su valor
 * en el registro y que tipos de cambio la anuncian.
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
    valorDe: (rec) => (Number.isFinite(rec?.precio) ? rec.precio : null),
    valorDelCambio: (c) => c?.precio,
    anteriorDelCambio: (c) => c?.precioAnterior,
  },
  {
    clave: "stock",
    campo: "reboteStock",
    tipos: ["stock"],
    valorDe: (rec) =>
      typeof rec?.estadoStock === "string" && rec.estadoStock !== "desconocido" ? rec.estadoStock : null,
    valorDelCambio: (c) => c?.estado,
    anteriorDelCambio: (c) => c?.estadoAnterior,
  },
];

/**
 * La memoria guardada, en su forma compacta y con los dos relojes ya aplicados.
 *
 * FORMA: `{ v: [valores, el mas reciente primero], hasta, n, ultimo, desde }`.
 * Un solo instante (`hasta`) para TODO el conjunto de valores, y los rebotes
 * CONTADOS (`n`) en vez de una lista de instantes. Medido contra la forma cara
 * (un instante por valor y la lista entera de rebotes): resultado identico sobre
 * los 829 eventos reales -- mismos 680 emitidos, mismos 149 degradados, mismo
 * peor producto -- a un tercio del tamano.
 */
function memoriaDe(ant, campo, timestamp) {
  const m = ant?.[campo];
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

/** ¿queda algo que recordar? Si no, el campo se borra del registro. */
function vacia(m) {
  return m.v.length === 0 && m.n === 0;
}

/** Mete un valor adelante de la lista de conocidos, sin repetirlo. */
function recordar(m, valor, timestamp) {
  if (valor === undefined || valor === null) return;
  m.v = [valor, ...m.v.filter((x) => x !== valor)].slice(0, VALORES_RECORDADOS);
  m.hasta = timestamp;
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
 * @returns {{ memorias, cambios, rebotes, nuevosRebotando }}
 *   - `cambios`: los mismos que entraron; los que son un rebote salen marcados
 *     `rebote: true`, con `valoresRebote` (entre que valores va) y
 *     `vecesRebotado`. Siguen yendo enteros a data/history.jsonl.
 *   - `nuevosRebotando`: los que ACABAN de empezar a rebotar en esta corrida.
 */
export function evaluarEstabilidad({ ant, cambios = [], timestamp }) {
  const memorias = {};
  // EL ORDEN DE `cambios` SE CONSERVA. "recuperado" va antes que "baja" y eso lo
  // fija una prueba (test/vivo.test.mjs exige que evaluarObservado y comparar()
  // emitan exactamente la misma lista): reagrupar por magnitud la cambiaba.
  const decidido = new Map();
  const rebotes = [];
  const nuevosRebotando = [];

  for (const mag of MAGNITUDES) {
    const m = memoriaDe(ant, mag.campo, timestamp);

    for (const c of cambios.filter((x) => mag.tipos.includes(x?.tipo))) {
      const nuevo = mag.valorDelCambio(c);
      const anterior = mag.anteriorDelCambio(c);
      // ¿ES UN REBOTE? Solo si el valor al que va ya esta en la memoria, o sea
      // si el operador ya lo escucho dentro de la ventana. UN VALOR NUEVO ES
      // SIEMPRE NOVEDAD: una baja de Cyber es un numero que no esta ahi, asi que
      // sale como alerta fuerte aunque el producto venga rebotando hace dias.
      const esRebote = m.v.includes(nuevo);
      const veniaRebotando = m.n > 0;

      // El valor que se deja atras tambien pasa a ser conocido: el operador lo
      // sabia -- era lo que decia el catalogo -- asi que volver a el no es
      // novedad. Y el valor nuevo se refresca aunque sea un rebote: mientras el
      // producto siga visitandolo, sigue siendo un valor que el ya conoce. Ese
      // refresco es lo que impide que cada vuelta parezca un episodio nuevo,
      // que es como la version anterior dejaba escapar el parpadeo LENTO.
      // LOS DOS EN LA MISMA PASADA, y no uno en cada rama. Refrescar tambien el
      // valor al que se VUELVE es lo que impide que cada vuelta parezca un
      // episodio nuevo, que es como la version anterior dejaba escapar el
      // parpadeo LENTO. (Medido: separar las dos llamadas, dejando la del valor
      // nuevo solo para los que no son rebote, da el MISMO resultado sobre los
      // 829 eventos reales -- porque salir de un valor ya lo vuelve a recordar
      // como `anterior`. Se deja junto igual: la redundancia es el punto.)
      for (const valor of [anterior, nuevo]) recordar(m, valor, timestamp);

      if (!esRebote) continue;

      m.n += 1;
      m.ultimo = timestamp;
      if (!m.desde) m.desde = timestamp;
      if (!veniaRebotando) nuevosRebotando.push({ magnitud: mag.clave, valor: nuevo, anterior });
      rebotes.push({ magnitud: mag.clave, valor: nuevo, tipo: c.tipo });
      decidido.set(c, {
        ...c,
        rebote: true,
        // lo que necesita la linea compacta del resumen, calculado aca y no en
        // discord.mjs porque es lo unico que conoce la memoria
        valoresRebote: m.v.slice(0, 3),
        vecesRebotado: m.n,
        rebotandoDesde: m.desde,
      });
    }

    if (!vacia(m)) memorias[mag.campo] = m;
  }

  // Los cambios de otras magnitudes (nuevo, recuperado, desaparecido) pasan tal
  // cual: el freno es solo para precio y stock.
  const salida = cambios.map((c) => decidido.get(c) ?? c);
  return { memorias, cambios: salida, rebotes, nuevosRebotando };
}

/**
 * ¿Este cambio es un rebote (y por lo tanto va en la seccion compacta en vez de
 * en las secciones fuertes)? Una sola definicion, para que discord.mjs y el
 * despachador no puedan divergir.
 */
export function esRebote(cambio) {
  return cambio?.rebote === true;
}
