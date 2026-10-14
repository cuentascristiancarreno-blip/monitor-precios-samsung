// SOLO SE NOTIFICAN LAS BAJAS DE PRECIO, por decisión del operador (2026-10-14).
//
// Pedido textual: "para notificaciones discord, solo notifica si hay bajas de
// precio. Si sube el precio o se agotó un producto no lo notifiques."
//
// IMPORTANTE, y es la misma regla que src/silenciados.mjs: esto es un filtro de
// NOTIFICACIÓN, no de detección. Todo lo demás se sigue midiendo, se sigue
// escribiendo en data/latest.json y en data/history.jsonl, sigue pasando por la
// confirmación en 2 corridas, por el freno anti-parpadeo y por las correcciones
// silenciosas de la migración. Lo único que no ocurre es el mensaje de Discord.
// Si se filtrara antes, comparar() vería los productos ausentes, les contaría
// ausencias y en 2 corridas los declararía desaparecidos: es el incidente de los
// ~150 avisos falsos en 4 días (ver BITACORA.md, 2026-07-24).
//
// POR QUÉ ESTA REGLA VIVE EN SU PROPIO MÓDULO Y NO EN run.mjs: run.mjs arranca
// main() al importarse, así que ninguna prueba lo alcanza, y mientras el filtro
// de accesorios vivió allí se le podía borrar con la suite entera en verde
// (probado mutándolo, ver el comentario de repartirCierre en
// src/despachador-vivo.mjs). Se aplica desde esNotificable(), que es el ÚNICO
// portón que comparten los dos caminos de envío: el de avisos en vivo
// (esParaVivo) y el del resumen de cierre (repartirCierre).
//
// LO QUE CUESTA, MEDIDO sobre la última semana real de data/history.jsonl
// (2026-10-07 a 2026-10-14, eventos ya filtrados por esAccesorio +
// estaSilenciado):
//
//   bajas de precio ....................... 11   <- lo único que sigue avisando
//   subidas de precio ......................  9
//   se agotó ............................... 84
//   volvió el stock ........................ 44
//   cambio de motivo (sigue sin comprarse) . 16
//   desaparecido ........................... 12
//   recuperado .............................  8
//   producto nuevo .........................  1
//   TOTAL 185 -> 11, o sea un 94% menos de mensajes.
//
// LO QUE SE APAGA Y EL OPERADOR YA SABE QUE SE APAGA: el aviso de "volvió el
// stock" era el único aviso de stock con el que se podía COMPRAR, y el
// 2026-10-05 costó un entregable entero conseguir que llegara completo y en vivo
// (44 esta semana; 73 en la semana del Cyber, de las cuales 15 salían
// degradadas). Esta regla los apaga a los 44. Ya se le dijo al operador y es su
// decisión; no se revive por cuenta propia.
//
// PARA REACTIVAR TODO: borrar (o comentar) la línea de `esBajaDePrecio` dentro de
// `esNotificable` en src/despachador-vivo.mjs. Las secciones de subas, stock,
// matices, nuevos, recuperados y desaparecidos siguen enteras en
// src/discord.mjs, solo les deja de llegar material. El historial del período
// filtrado queda completo, así que no se pierde nada.
//
// EL CANAL TÉCNICO NO PASA POR ACÁ, a propósito: los avisos de "la revisión
// salió sospechosa", el censo, los productos momificados, los precios corregidos
// de origen y los productos rebotando salen por notifyTecnico(), que no es un
// aviso de producto. El operador pidió filtrar las notificaciones de PRODUCTOS.
//
// PERO SU TEXTO SÍ HABÍA QUE CORREGIRLO (2026-10-14, segunda vuelta): no basta
// con no tocar el código. `mensajeRebotando` le prometía al operador, en
// negrita, "No dejo de avisarte nada" y "una reposición sale siempre como alerta
// fuerte", y desde esta regla las dos frases son falsas para todo lo que no sea
// una baja. Medido: de los 121 rebotes de productos vigilados del historial,
// 101 (82 de stock + 19 subas) ya no llegan al canal de productos y solo las 20
// bajas siguen saliendo. Hay una prueba que exige que el texto del aviso técnico
// y `esNotificable` no se puedan contradecir.

/** El único tipo de cambio de producto que se notifica. */
export const TIPO_NOTIFICABLE = "baja";

/**
 * ¿Este cambio es una baja de precio?
 *
 * Se mira el TIPO y nada más, y la razón es que `comparar()` es la ÚNICA
 * autoridad que emite el tipo "baja" y lo emite dentro de
 * `obs.precio < precioAnt` con los dos montos finitos (src/comparar.mjs, las dos
 * líneas que emiten una caída de precio): los montos ya se compararon ahí, así
 * que volver a compararlos acá no agrega información sobre un cambio que salió
 * del detector.
 *
 * ⚠️ CORREGIDO 2026-10-14 (segunda vuelta): la versión anterior de este
 * comentario justificaba la decisión diciendo que "en el camino de los avisos
 * atrasados un cambio viejo puede llegar sin `precioAnterior` legible". **Eso es
 * falso y lo midió un verificador**: `serializarPendientes` guarda el cambio con
 * TODOS sus campos (`{ts, ...c}`) y `leerPendientes` no borra ninguno — el
 * comentario de `lineaPendiente` ya lo decía ("el flag viaja entero por
 * data/pendientes.jsonl"). La razón buena es la de arriba; y para el único camino
 * que lee un archivo que ninguna corrida de hoy escribió está
 * `pendienteCreible`, abajo.
 */
export function esBajaDePrecio(cambio) {
  return cambio?.tipo === TIPO_NOTIFICABLE;
}

/**
 * ¿Un aviso ATRASADO de data/pendientes.jsonl se puede entregar tal cual?
 *
 * POR QUÉ ESTE ARCHIVO SÍ SE DESCONFÍA Y EL DETECTOR NO (2026-10-14, segunda
 * vuelta, defecto medido). `esBajaDePrecio` confía en el campo `tipo` porque
 * `comparar()` lo emitió comparando los montos. Pero data/pendientes.jsonl lo
 * escribió OTRA corrida, se fusiona por UNIÓN ante un conflicto de git
 * (.gitattributes) y el caso ambiguo se conserva a propósito al leerlo
 * (`leerPendientes`): es el único material que llega al canal de productos sin
 * pasar por el detector de ESTA corrida. Medido sembrando pendientes a mano: uno
 * con `tipo: "baja"` y los montos al revés salía rotulado
 * `🟢⬇️ BAJÓ DE PRECIO … De $300.000 a **$400.000** (+$100.000 · +33,3%)`, y uno
 * con `matiz: true` salía como una línea de STOCK sin precio ni bandera.
 *
 * No es alcanzable desde el detector (comparar() no puede emitir ninguno de los
 * dos), así que no es una fuga: es la puerta por la que entraría un archivo
 * corrupto o editado a mano. Se cierra con lo mínimo:
 *  - si los dos montos vienen legibles, tienen que BAJAR de verdad;
 *  - un cambio marcado `matiz` no es una baja de precio (esa marca solo se pone
 *    sobre cambios de stock, src/estabilidad.mjs) y además lo rutearía a la línea
 *    de matiz, que no lleva bandera ni precio.
 *
 * Devuelve el motivo para poder dejarlo en el log: un pendiente descartado en
 * silencio sería la perdida silenciosa que ese archivo existe para evitar.
 */
export function pendienteCreible(cambio) {
  if (cambio?.matiz === true) return { ok: false, motivo: "viene marcado como matiz de stock" };
  const antes = cambio?.precioAnterior;
  const ahora = cambio?.precio;
  if (Number.isFinite(antes) && Number.isFinite(ahora) && ahora >= antes) {
    return { ok: false, motivo: `dice "baja" pero sus montos no bajan (${antes} -> ${ahora})` };
  }
  return { ok: true, motivo: null };
}

/**
 * EL PULSO DEL DÍA: los dos números de la regla, sumados sobre las últimas
 * `horas` de data/ejecuciones.jsonl.
 *
 * POR QUÉ EXISTE (2026-10-14, segunda vuelta, defecto medido por dos
 * verificadores). La nota del encabezado ("se detectaron N cambios en total")
 * solo puede salir si hay un mensaje de cierre, y `notifyDiscord` corta temprano
 * cuando no hay nada que mandar — que es justo el caso de una corrida con
 * cambios detectados y 0 bajas. Medido sobre data/history.jsonl agrupado por
 * corrida: de las **437 corridas reales con al menos un cambio de producto
 * vigilado, 283 (64,8%) no mandarían NI UN mensaje** al canal de productos, y
 * esas 283 contienen 11.348 cambios detectados. En la semana del operador son
 * **64 de 67 corridas mudas, con 168 cambios dentro**.
 *
 * O sea: la mitigación que la entrega anterior escribió para su propio riesgo
 * ("si cambiosDetectados se cae a casi 0 sin que suba bajas, el roto es el
 * detector") quedaba solo en data/ejecuciones.jsonl, un archivo que el operador
 * —que no programa— no lee. Con un solo tipo de aviso vivo, una semana en 0
 * bajas dejaba de distinguirse de un detector roto.
 *
 * LO QUE NO SE HIZO: mandar el resumen de cierre en cada corrida. Son 20
 * revisiones al día y el operador pidió MENOS mensajes; eso desharía el encargo.
 * Esto es UNA línea al día por el canal TÉCNICO, que es el canal que el operador
 * no pidió filtrar y que ya tiene el freno de "una vez al día por clave"
 * (src/avisos-repetidos.mjs).
 *
 * Las filas sin los dos contadores (las escritas antes del 2026-10-14) se
 * cuentan aparte y el mensaje lo dice: sumar 0 por ellas haría que el primer día
 * se leyera como un detector roto.
 */
export function pulsoDeLaRegla(textoEjecuciones, { ahora, horas = 24, deEstaCorrida = null } = {}) {
  const fin = Date.parse(ahora);
  const corte = Number.isFinite(fin) ? fin - horas * 3600 * 1000 : null;
  let corridas = 0;
  let conDato = 0;
  let detectados = 0;
  let avisados = 0;

  const sumar = (fila) => {
    corridas += 1;
    const det = fila?.cambiosDetectados;
    const noAvisados = fila?.noNotificadosPorRegla;
    if (!Number.isFinite(det)) return;
    conDato += 1;
    detectados += det;
    avisados += Math.max(0, det - (Number.isFinite(noAvisados) ? noAvisados : 0));
  };

  for (const linea of String(textoEjecuciones ?? "").split("\n")) {
    if (!linea.trim()) continue;
    let fila;
    try {
      fila = JSON.parse(linea);
    } catch {
      continue; // fila a medio escribir por una corrida que murio
    }
    const t = Date.parse(fila?.inicio);
    // Una fila sin fecha legible no se puede ubicar en la ventana: se descarta,
    // porque contarla inflaria el pulso con corridas de cualquier epoca.
    if (!Number.isFinite(t) || corte === null || t < corte || t > fin) continue;
    sumar(fila);
  }
  if (deEstaCorrida) sumar(deEstaCorrida);

  return { horas, corridas, conDato, detectados, avisados };
}
