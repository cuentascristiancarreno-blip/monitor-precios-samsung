// EL ALCANCE DE UNA CORRIDA: QUE SE PROPUSO MIRAR, Y CONTRA QUE SE LA JUZGA.
//
// POR QUE EXISTE (el pedido del operador del 2026-09-12): dos revisiones
// completas al dia y el resto solo las 5 categorias principales, que son mas
// rapidas y por eso pueden ir mas seguido.
//
// EL PROBLEMA QUE ABRE ESE PEDIDO. Hasta hoy el sistema daba por sentado que
// cada corrida veia el catalogo ENTERO: comparar() recorria todo el catalogo
// previo y a lo que no habia observado le sumaba una ausencia; a las 2 ausencias
// lo declaraba "desaparecido". Una corrida liviana no ve 733 de los 929
// productos vivos (medido sobre data/latest.json: 1.031 registros, 102 ya
// desaparecidos, 196 vivos dentro del bloque principal de 347 paginas).
//
// Hoy eso NO produce fantasmas, pero por accidente: la heuristica de "corrida
// sospechosa" (encontrados < 80% de lo esperado) marcaria TODA corrida liviana
// como no confiable -- 196 de 929 es 21% -- y una corrida no confiable no
// declara desaparecidos. El precio de ese accidente es feo: un aviso tecnico
// "revision NO confiable" en cada corrida liviana (18 al dia con la cadencia
// nueva) y la deteccion de desaparecidos apagada en 18 de 20 corridas, incluso
// para las paginas que SI se recorrieron.
//
// EL MODELO CORRECTO, Y ES LO QUE HAY ACA: la corrida DECLARA su alcance. Los
// SKU dentro del alcance siguen las reglas de siempre (ausencias y desaparicion
// incluidas); los SKU fuera del alcance son "no verificados" y no acumulan
// nada, conservando su ultimo dato tal cual. La confiabilidad se juzga contra el
// alcance declarado, no contra el catalogo entero.
//
// Este modulo es PURO (sin I/O, sin fechas implicitas, sin red) a proposito: es
// lo unico que permite probar la decision, porque src/run.mjs arranca main() al
// importarse y nada de lo que este ahi lo cubre una prueba.

export const MODO_COMPLETO = "completo";
export const MODO_LIVIANO = "liviano";

/**
 * Cuantas horas puede pasar el sistema sin una revision completa antes de que
 * una corrida liviana se ascienda sola a completa.
 *
 * POR QUE 16 Y NO 12. Los dos completos van separados 12 h nominales, y el
 * atraso que GitHub le mete al cron esta medido sobre data/ejecuciones.jsonl
 * (306 transiciones): mediana 68 min, p90 172 min, maximo 342 min -- y sigue
 * siendo mediana 74 min incluso mirando solo las corridas que arrancaron con la
 * maquina libre, asi que no es culpa de la saturacion propia. Con un umbral de
 * 12-14 h la escalada se gatillaria sola casi todos los dias; con 16 h no se
 * gatilla nunca de gratis, y cuando un completo se pierde de verdad (la cola de
 * GitHub lo descarta, o alguien rompe el string del cron) el PRIMER liviano
 * siguiente lo recupera.
 *
 * ES LA RED CONTRA LA PEOR FALLA POSIBLE: que el 70% del catalogo deje de
 * mirarse EN SILENCIO. El modo se decide por el horario que disparo la corrida y
 * cae en "liviano" cuando no reconoce el cron -- eso protege contra fantasmas
 * (un liviano no puede declarar desaparecido lo que no miro) pero deja
 * desprotegida la cobertura. Esto cierra ese lado.
 */
export const HORAS_SIN_COMPLETO = 16;

/**
 * Horas entre dos marcas de tiempo ISO, o null cuando alguna no se puede medir.
 *
 * `null` significa "no se puede medir el tiempo", y en TODOS los usos de este
 * modulo y de src/comparar.mjs eso se resuelve conservando el comportamiento de
 * siempre (el que habia antes de que existieran los pisos de reloj). Es lo que
 * permite que un registro viejo sin `ultimaVezVisto` no quede inmortal.
 */
export function horasEntre(desde, hasta) {
  const a = Date.parse(desde ?? "");
  const b = Date.parse(hasta ?? "");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return (b - a) / 3600000;
}

/** El modo que PIDE el entorno (lo escribe el workflow). Por defecto, completo. */
export function modoPedido(env = {}) {
  return String(env.MODO ?? "").trim().toLowerCase() === MODO_LIVIANO ? MODO_LIVIANO : MODO_COMPLETO;
}

/**
 * EL ALCANCE, armado a partir de las paginas que ESTA corrida va a visitar de
 * verdad.
 *
 * `entries` tiene que ser el recorrido YA RECORTADO (por el modo y por
 * LIMITE_PAGINAS), no el bloque teorico. Si se declarara el bloque entero y la
 * corrida solo alcanzara a visitar una parte, los SKU de las paginas no
 * visitadas acumularian ausencias sin que nadie los haya mirado, que es
 * exactamente el fantasma que este modulo viene a evitar.
 */
export function alcanceDe({ modo = MODO_COMPLETO, etiqueta = "principales", entries = [] } = {}) {
  const parcial = modo === MODO_LIVIANO;
  return {
    modo: parcial ? MODO_LIVIANO : MODO_COMPLETO,
    // como se llama el bloque recorrido, para el log y para ejecuciones.jsonl
    etiqueta: parcial ? etiqueta : "todo",
    parcial,
    paginas: new Set((entries ?? []).map((e) => e?.url).filter(Boolean)),
  };
}

/**
 * ¿Esta corrida se propuso mirar la pagina de la que cuelga este registro?
 *
 * TRES DECISIONES, CADA UNA CON SU RAZON:
 *
 *  1. Sin alcance, o alcance completo, devuelve SIEMPRE true -- ni siquiera mira
 *     el conjunto de paginas. Un completo tiene que poder declarar desaparecido
 *     un SKU cuya pagina Samsung borro del sitio; si filtrara por pertenencia al
 *     recorrido, esos registros se volverian inmortales. Ademas es lo que deja
 *     que las 371 pruebas y todas las llamadas actuales sigan funcionando sin
 *     pasar nada.
 *  2. Se mira `paginaOrigen` primero y `url` despues, que es el mismo par que
 *     usa comparar() para las paginas fallidas. Medido sobre data/latest.json:
 *     los 1.031 registros tienen al menos uno de los dos, y 23 los tienen
 *     distintos.
 *  3. Un registro sin ninguno de los dos queda FUERA del alcance (no dentro). No
 *     se puede saber si esta corrida lo miro, y ante la duda no se toca: es la
 *     regla de oro del proyecto. Hoy no hay ninguno asi.
 */
export function enAlcance(rec, alcance) {
  if (!alcance?.parcial) return true;
  const pagina = rec?.paginaOrigen ?? rec?.url ?? null;
  if (!pagina) return false;
  return alcance.paginas.has(pagina);
}

/**
 * Cuando termino la ultima revision COMPLETA segun data/ejecuciones.jsonl.
 *
 * Las lineas anteriores a este cambio no traen el campo `modo`: todas esas
 * corridas eran completas, asi que se cuentan como tales. Sin eso, el primer
 * liviano tras el despliegue creeria que nunca hubo un completo y se ascenderia
 * solo.
 */
export function ultimoCompleto(texto) {
  const lineas = String(texto ?? "").split("\n");
  for (let i = lineas.length - 1; i >= 0; i--) {
    const linea = lineas[i].trim();
    if (!linea) continue;
    let fila;
    try {
      fila = JSON.parse(linea);
    } catch {
      continue;
    }
    if ((fila?.modo ?? MODO_COMPLETO) !== MODO_COMPLETO) continue;
    return fila?.fin ?? fila?.inicio ?? null;
  }
  return null;
}

/**
 * EL MODO DEFINITIVO DE ESTA CORRIDA. El workflow declara una INTENCION (segun
 * que cron la disparo); la ultima palabra la tiene esta funcion, que ademas
 * escala a completo cuando hace demasiado que no hay uno.
 *
 * Lo que NUNCA hace: degradar un completo a liviano para "recuperar el horario".
 * Un completo atrasado sigue siendo lo unico que mira el otro 70% del catalogo:
 * llega tarde o no llega, pero no se achica.
 */
export function decidirModo({ pedido, ultimoCompletoFin, ahora, horas = HORAS_SIN_COMPLETO } = {}) {
  if (pedido !== MODO_LIVIANO) return { modo: MODO_COMPLETO, escalado: false, horasSinCompleto: null, motivo: null };
  const h = horasEntre(ultimoCompletoFin, ahora);
  if (h === null) {
    return { modo: MODO_COMPLETO, escalado: true, horasSinCompleto: null, motivo: "no hay ninguna revision completa registrada" };
  }
  if (h >= horas) {
    return { modo: MODO_COMPLETO, escalado: true, horasSinCompleto: h, motivo: `la última revisión completa terminó hace ${Math.round(h)} h (el máximo son ${horas} h)` };
  }
  return { modo: MODO_LIVIANO, escalado: false, horasSinCompleto: h, motivo: null };
}

/**
 * CUANTO PUEDE ENCOGERSE EL RECORRIDO DE UNA CORRIDA, RESPECTO DE LA ANTERIOR
 * DEL MISMO TIPO, ANTES DE QUE SEA UNA FALLA.
 *
 * POR QUE EXISTE (defecto medido por los verificadores el 2026-09-12, y es el
 * agujero que abrio juzgar la confiabilidad contra el alcance declarado): un
 * alcance que se achica se justifica SOLO. Si el descubrimiento por sitemap
 * (src/discover.mjs, envuelto en un try/catch que solo imprime) devuelve menos
 * paginas, el recorrido liviano pasa de 347 a 185 paginas y 160 productos del
 * bloque principal caen de 20 miradas diarias a 2 -- y como `esperados` se
 * achica junto con `encontrados`, la heuristica de "faltan productos" no ve
 * NADA: 0 corridas sospechosas, 0 avisos, durante dias. El sistema anterior
 * convertia esa misma caida en 160 avisos falsos: ruidoso y equivocado, pero
 * VISIBLE. Callarlo choca de frente con la regla del proyecto de que ninguna
 * fuente puede fallar en silencio.
 *
 * Y EL MISMO CHEQUEO CUBRE EL CASO PEOR, que es preexistente: si el
 * descubrimiento se cae durante DOS COMPLETOS SEGUIDOS, son 160 desaparecidos
 * falsos + 160 recuperados, y el umbral del 80% no los atrapa (el margen de un
 * completo son 184 SKU y el descubrimiento aporta 160: pasa raspando por
 * debajo). Marcar la corrida como NO confiable apaga los desaparecidos de esa
 * corrida, que es exactamente lo que hace falta.
 *
 * POR QUE 10%: el recorrido real se mueve de a pocas paginas por dia (Samsung
 * publica y retira fichas), y las 162 paginas que aporta el descubrimiento son
 * el 14% del recorrido completo y el 47% del liviano. 10% deja pasar el
 * movimiento normal y atrapa la caida del descubrimiento en los dos modos.
 *
 * SE COMPARA CONTRA LA ULTIMA CORRIDA DEL MISMO TIPO, no contra la anterior a
 * secas: un liviano de 347 paginas despues de un completo de 1.185 no es una
 * falla, es el dia normal. Y la vara se mueve sola con el sitio -- si Samsung
 * retira 200 paginas de verdad, esto avisa UNA vez y la corrida siguiente ya
 * compara contra el tamano nuevo.
 */
export const TOLERANCIA_ENCOGIMIENTO = 0.1;

/**
 * QUE PROPORCION DEL CATALOGO VIVO PUEDE QUEDARSE SIN NINGUNA PAGINA EN EL
 * RECORRIDO DE UNA REVISION COMPLETA ANTES DE QUE LA REVISION NO SIRVA.
 *
 * POR QUE NO ALCANZA CON TOLERANCIA_ENCOGIMIENTO (medido el 2026-09-12,
 * simulando 7 dias de la cadencia real sobre el catalogo real con `comparar()`
 * de verdad). El encogimiento se mide contra la ULTIMA corrida del mismo tipo, y
 * esa vara se mueve sola: si el descubrimiento por sitemap se cae y NO vuelve,
 * la primera completa se marca sospechosa y no declara nada, pero la segunda ya
 * compara 1.023 contra 1.023, se da por sana, y a la tercera salen **160
 * desaparecidos falsos** -- a las ~24 h del corte, con un solo aviso tecnico de
 * por medio. Es la forma exacta del incidente de los ~150 avisos falsos en 4
 * dias (BITACORA.md), y el sistema anterior hacia lo mismo.
 *
 * ESTA REGLA NO SE NORMALIZA, y esa es toda la gracia: se juzga contra el
 * CATALOGO, no contra la corrida anterior. Mientras el descubrimiento siga
 * caido, cada completa vuelve a encontrar los mismos 160 productos sin pagina,
 * sigue marcandose sospechosa y sigue sin declarar nada; el operador recibe el
 * aviso tecnico una vez al dia hasta que se arregle, y los 160 productos
 * terminan saliendo por el canal correcto ("no se pueden verificar hace 3 dias",
 * que es la verdad) en vez del incorrecto ("desaparecieron").
 *
 * POR QUE 5%, CON LOS DOS NUMEROS MEDIDOS HOY:
 *  - una revision completa SANA deja **0** de los 929 productos vivos sin pagina
 *    en su recorrido (medido sobre data/latest.json: las 1.185 paginas cubren
 *    las 920 paginas que publican el catalogo);
 *  - con el descubrimiento caido son **160 (17%)**;
 *  - y el dia con MAS desapariciones reales de toda la historia del monitor
 *    (data/history.jsonl, 157 eventos en 26 dias) son **29 (3,1%)**, con mediana
 *    de 4 por dia.
 * 5% (46 productos) deja pasar con margen el peor dia real y atrapa el corte del
 * descubrimiento con margen de sobra.
 *
 * Y SI SAMSUNG DE VERDAD RETIRA 46 PRODUCTOS DE GOLPE, el monitor se calla y
 * avisa por el canal tecnico en vez de mandar 46 avisos. Es la regla de oro del
 * proyecto: mas vale callarse que inventar, y un aviso tecnico diciendo el
 * numero es algo que el operador puede ir a mirar.
 *
 * SOLO APLICA A LAS REVISIONES COMPLETAS. En una liviana, "sin pagina en el
 * recorrido" es la normalidad (733 productos) y lo resuelve enAlcance(): esos
 * SKU no acumulan nada y por eso no pueden producir un falso desaparecido.
 */
export const TOLERANCIA_SIN_PAGINA = 0.05;

/**
 * Cuantas paginas recorrio la ultima corrida del MISMO tipo (mismo modo y mismo
 * bloque), segun data/ejecuciones.jsonl. null cuando no hay ninguna.
 *
 * Las filas anteriores a este cambio no traen `paginasDelAlcance` ni `alcance`:
 * eran todas completas y visitaban todo, asi que su `paginas` ES el tamano de su
 * alcance y se usa como tal. Sin eso, el primer completo tras el despliegue no
 * tendria contra que compararse justo el dia en que mas conviene mirar.
 */
export function ultimoRecorrido(texto, { modo = MODO_COMPLETO, etiqueta = "todo" } = {}) {
  const lineas = String(texto ?? "").split("\n");
  for (let i = lineas.length - 1; i >= 0; i--) {
    const linea = lineas[i].trim();
    if (!linea) continue;
    let fila;
    try {
      fila = JSON.parse(linea);
    } catch {
      continue;
    }
    if ((fila?.modo ?? MODO_COMPLETO) !== modo) continue;
    if ((fila?.alcance ?? "todo") !== etiqueta) continue;
    const n = Number(fila?.paginasDelAlcance ?? fila?.paginas);
    if (!Number.isFinite(n) || n <= 0) continue;
    return n;
  }
  return null;
}

/**
 * ¿ES SOSPECHOSA ESTA CORRIDA? La misma pregunta de siempre, pero contra el
 * ALCANCE DECLARADO en vez de contra el catalogo entero.
 *
 * Sin este cambio, TODA corrida liviana seria sospechosa por definicion: ve 196
 * de los 929 productos vivos (21%), muy por debajo del 80% del umbral. Medido
 * simulando 2 dias de la cadencia nueva: 36 avisos tecnicos "revision NO
 * confiable", 18 por dia, por el mismo canal donde llegan las bajas de precio.
 * Con el alcance declarado, un liviano normal da 196 esperados contra 196
 * encontrados y queda confiable; un liviano ROTO de verdad sigue cayendo.
 *
 * El umbral de errores ya escalaba solo con el tamano del recorrido
 * (max(5, paginas*0,1)), asi que en un liviano son 35 paginas y no 119.
 *
 * Los motivos viajan como {tipo, gravedad, texto}: el texto lleva los numeros
 * del dia (y es lo que lee el operador); el tipo y la gravedad son lo estable y
 * son lo unico que entra en la clave del freno de avisos -- si la clave llevara
 * los numeros, cada corrida tendria una clave distinta y el freno no frenaria
 * nada.
 *
 * LA GRAVEDAD EXISTE POR UN DEFECTO MEDIDO (2026-09-12): con el freno de una vez
 * al dia y una clave que solo lleva el tipo, una liviana con 36 de 347 paginas
 * caidas a las 05:23 consumia la clave del dia, y la liviana de las 13:23 con
 * 340 de 347 caidas quedaba SILENCIADA -- el mismo tipo de motivo. Dos baldes
 * (leve/grave) frenan el ruido diario y dejan pasar el empeoramiento.
 *
 * @param recorrido {{actual: number, anterior: number|null}} tamano del alcance
 *   de ESTA corrida y de la ultima del mismo tipo (ver ultimoRecorrido). Sin
 *   esto no se evalua el encogimiento, que es lo que hacen las pruebas y las
 *   llamadas que no lo pasan.
 */
export function evaluarConfiabilidad({ previo = {}, observado = {}, alcance, fallidas = 0, paginas = 0, recorrido = null } = {}) {
  const encontrados = Object.keys(observado).length;
  const esperados = Object.values(previo).filter((r) => r?.presencia !== "desaparecido" && enAlcance(r, alcance)).length;
  const motivos = [];
  const grave = (condicion) => (condicion ? "grave" : "leve");
  if (fallidas > Math.max(5, paginas * 0.1)) {
    motivos.push({ tipo: "errores", gravedad: grave(paginas > 0 && fallidas >= paginas * 0.5), texto: `demasiadas paginas con error (${fallidas} de ${paginas})` });
  }
  if (esperados > 0 && encontrados < esperados * 0.8) {
    motivos.push({ tipo: "faltan-productos", gravedad: grave(encontrados < esperados * 0.5), texto: `se encontraron muchos menos productos que la vez anterior (${encontrados} vs ${esperados})` });
  }
  // PRODUCTOS VIVOS QUE SE QUEDARON SIN NINGUNA PAGINA EN EL RECORRIDO (ver
  // TOLERANCIA_SIN_PAGINA). Solo en revisiones COMPLETAS: en una parcial eso es
  // la normalidad y lo resuelve enAlcance(). Sin `alcance` no se evalua, que es
  // lo que deja intactas las llamadas y las pruebas que no lo pasan.
  if (alcance && !alcance.parcial && alcance.paginas?.size > 0) {
    const vivos = Object.values(previo).filter((r) => r?.presencia !== "desaparecido");
    const sinPagina = vivos.filter((r) => !alcance.paginas.has(r?.paginaOrigen ?? r?.url ?? "")).length;
    if (vivos.length > 0 && sinPagina > vivos.length * TOLERANCIA_SIN_PAGINA) {
      motivos.push({
        tipo: "sku-sin-pagina",
        gravedad: grave(sinPagina > vivos.length * 0.25),
        texto: `${sinPagina} de los ${vivos.length} productos del catálogo se quedaron sin ninguna página en el recorrido de esta revisión completa`,
      });
    }
  }
  // EL RECORRIDO SE ENCOGIO. Va antes que "sin-productos" solo por orden de
  // lectura; el que manda es el conjunto, no el orden.
  const previoRecorrido = Number(recorrido?.anterior);
  const actualRecorrido = Number(recorrido?.actual);
  if (Number.isFinite(previoRecorrido) && previoRecorrido > 0 && Number.isFinite(actualRecorrido) && actualRecorrido < previoRecorrido * (1 - TOLERANCIA_ENCOGIMIENTO)) {
    motivos.push({
      tipo: "recorrido-encogido",
      gravedad: grave(actualRecorrido < previoRecorrido * 0.5),
      texto: `esta revisión iba a mirar muchas menos páginas que la anterior del mismo tipo (${actualRecorrido} vs ${previoRecorrido})`,
    });
  }
  if (encontrados === 0) motivos.push({ tipo: "sin-productos", gravedad: "grave", texto: "no se encontro ningun producto" });
  return { confiable: motivos.length === 0, motivos, esperados, encontrados };
}

/**
 * La clave con que el aviso de "corrida no confiable" pasa por el freno de una
 * vez al dia (src/avisos-repetidos.mjs).
 *
 * LLEVA EL MOTIVO Y SU GRAVEDAD, no solo el modo. Si la clave fuera solo el
 * modo, la primera falla del dia taparia una falla DISTINTA tres horas despues;
 * y si llevara solo el tipo, una anomalia leve de la manana taparia una
 * catastrofe de la tarde del mismo tipo (medido: 36 de 347 paginas caidas
 * silenciando 340 de 347). Los numeros crudos NO entran: cambian en cada corrida
 * y el freno no frenaria nada.
 *
 * El `.sort()` es lo que hace que dos corridas con los mismos motivos en distinto
 * orden compartan clave. Hoy evaluarConfiabilidad los empuja siempre en el mismo
 * orden, asi que es una defensa contra el futuro, no contra el presente.
 */
export function claveNoConfiable(modo, motivos) {
  const tipos = (motivos ?? []).map((m) => (m?.tipo ? `${m.tipo}:${m.gravedad ?? "leve"}` : String(m))).sort();
  return `no-confiable:${modo}:${tipos.join("|")}`;
}
