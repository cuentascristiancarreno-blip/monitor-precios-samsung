// UNA NOTIFICACION POR AVISO EN EL CELULAR: ntfy.sh (pedido del operador 2026-11-06)
//
// Pedido textual: "Al igual que el proyecto Vigia de seguimiento favoritos,
// quiero que todas las notificaciones tambien lleguen por Notify. Para que
// llegue una notificacion por una. Por cada actualizacion o por" (el mensaje se
// corto ahi).
//
// EL PROBLEMA QUE RESUELVE, que es el mismo que ya resolvio Vigia:
// Discord en Android junta todos los mensajes de un canal en UNA notificacion.
// El operador quiere una notificacion por cada aviso, como el correo: llegan 5,
// ve 5, y las descarta una por una. ntfy hace exactamente eso -- cada mensaje
// publicado es su propia notificacion del sistema.
//
// POR QUE NTFY Y NO OTRA COSA: es gratis, no pide cuenta y NO PIDE TARJETA
// (comprobado en su documentacion: el servidor publico acepta publicar sin
// registro). El operador rechaza los servicios que piden tarjeta aunque sean
// gratis, asi que esto importa. El celular se suscribe a un "tema" y listo.
//
// EL TEMA ES LA CLAVE. No hay usuario ni contrasena: quien sabe el nombre del
// tema recibe los avisos (y puede publicar en el). Por eso el tema es un nombre
// largo y aleatorio, vive en el SECRETO `NTFY_TEMA` del repositorio y JAMAS se
// escribe en el codigo, en el README ni en la bitacora. Y por eso se publica
// mandando el tema en el CUERPO del POST y no en la URL: una URL queda escrita
// en logs, en cabeceras y en cualquier proxy del camino.
//
// NTFY ES EL ULTIMO ESLABON Y EL MENOS IMPORTANTE. Es una COPIA de lo que ya
// llego a Discord, que sigue siendo el registro completo. Las tres consecuencias
// de eso, que son las reglas de este archivo:
//   1. se publica DESPUES del 2xx de Discord, nunca antes (ver entregarConCopia
//      y notifyTecnico en src/discord.mjs);
//   2. si falla, no bloquea, no reintenta y no pierde nada: el aviso esta en
//      Discord y el error queda en el log;
//   3. nunca puede frenar la revision mas que unos segundos (tope de espera,
//      corte tras N fallos seguidos y tope de avisos por corrida, abajo).
//
// LOS LIMITES DEL SERVIDOR PUBLICO, documentados por ntfy (NO medidos por mi:
// publicar de prueba en un tema real estaba prohibido en este encargo):
//   - 250 mensajes por dia;
//   - rafaga de 60 peticiones y despues una cada 5 s;
//   - 4.096 bytes por mensaje, 1 KB por titulo.
// Y UN AGRAVANTE QUE NO ESTA EN LA DOCUMENTACION PERO SI EN ESTE REPO: esos
// limites son POR VISITANTE, o sea por IP, y la IP del runner de GitHub Actions
// es compartida con miles de trabajos ajenos -- es la misma razon por la que
// src/discord.mjs no reintenta un 400 ("el cupo de peticiones invalidas es POR
// IP y la IP del runner es ajena"). O sea que el cupo no es solo nuestro y no se
// puede contar con el: de ahi que no se reintente nunca y que haya tope.
//
// LO QUE ESTO COSTARIA, MEDIDO sobre data/history.jsonl con el filtro REAL del
// repo (esNotificable, o sea solo bajas de precio desde la regla del
// 2026-10-14):
//   bajas notificables en todo el historial .......... 1.037 en 87 dias
//   mediana de bajas por corrida ......................     2
//   p90 de bajas por corrida ..........................    18
//   corridas con >= 20 bajas ..........................    11 de 154
//   PEOR CORRIDA .....................................    141  (2026-10-01T22:16)
//   PEOR DIA ..........................................   237  (2026-10-01)
//   semana que midio el operador ......................    11
// O sea: el volumen normal cabe de sobra (11 por semana), y el peor dia real del
// historial -- el vaiven del 1 de octubre, cuya causa sigue sin diagnosticar --
// habria rozado el tope diario de 250 del servidor. El tope por corrida de abajo
// existe por esa corrida de 141, no por el caso normal.

import { componerTitulo } from "./titulo.mjs";
import { entorno as num } from "./entorno.mjs";
import { esParaCelular } from "./despachador-vivo.mjs";

export const SERVIDOR_POR_DEFECTO = "https://ntfy.sh";

/** Prioridades de ntfy: 1 min, 3 normal, 5 max. */
export const PRIORIDAD_BAJA = 4; // un aviso de producto: suena y se ve arriba
export const PRIORIDAD_TECNICA = 3; // un aviso de mantencion: no es una oferta
// Un DESMENTIDO no puede sonar mas bajo que la oferta que desmiente: el
// operador ya recibio el aviso falso con prioridad 4 y puede estar yendo a
// comprar. Va en 4, igual que la oferta, y lo que lo distingue es el titulo
// ("SE CORRIGE"), no el volumen. No se usa el 5 de ntfy (vibracion larga que
// atraviesa el silencio del telefono): esto corrige un precio, no es una
// emergencia.
export const PRIORIDAD_CORRECCION = 4;

/**
 * LOS TRES FRENOS, CON EL NUMERO QUE DE VERDAD SE DESPLIEGA.
 *
 * Estan juntos y exportados porque la verificacion del 2026-11-06 midio que no
 * lo estaban: tres mutantes que subian estos valores por defecto a 300.000 /
 * 100.000 / 100.000 dejaban la suite ENTERA en verde, porque cada prueba pasaba
 * su propio valor (`tope: 4`, `timeoutMs: 5`) y ninguna miraba el que corre en
 * produccion. O sea los tres frenos que justifican toda la seccion de
 * resiliencia no estaban atados por ninguna prueba. Ahora `config()` los deja
 * ver y hay pruebas sobre un avisador creado SIN opciones.
 */
export const POR_DEFECTO = {
  // 3 s: esto corre en el hueco entre dos paginas (ver publicar).
  timeoutMs: 3000,
  // 3 fallos seguidos y se apaga: igual que VIVO_MAX_FALLOS_SEGUIDOS.
  maxFallosSeguidos: 3,
  // 60 avisos de producto por corrida: la rafaga que documenta ntfy.
  tope: 60,
};

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });
const PCT = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function monto(n) {
  return Number.isFinite(n) ? CLP.format(n) : "sin precio";
}

/**
 * El tema configurado, o null.
 *
 * SE LEE COMO LO LEE src/entorno.mjs Y POR LA MISMA RAZON MEDIDA: una variable
 * DEFINIDA PERO VACIA es exactamente lo que deja GitHub Actions cuando se
 * escribe `NTFY_TEMA: ${{ secrets.NTFY_TEMA }}` y ese secreto no existe todavia.
 * Tratarla como configurada dejaria publicando en el tema "" en cada corrida.
 *
 * Null es lo que permite desplegar esto ANTES de que el operador cree su tema:
 * sin tema, el sistema se comporta EXACTAMENTE como hoy (ver avisadorDelEntorno).
 */
export function temaDelEntorno(env = process.env) {
  const crudo = env?.NTFY_TEMA;
  if (crudo === undefined || crudo === null) return null;
  const t = String(crudo).trim();
  return t === "" ? null : t;
}

/**
 * Un cambio de producto como notificacion del celular. PURO.
 *
 * El medio es otro que Discord y por eso el texto es otro: aca no hay Markdown
 * (un `**` se veria literal en la notificacion), el titulo es un campo aparte
 * -- es lo que el telefono muestra en grande -- y el link no va en el cuerpo
 * sino en `click`, que es lo que se abre al tocar la notificacion.
 *
 * LO QUE NO PUEDE DIVERGIR DE DISCORD son los HECHOS: la palabra "BAJO DE
 * PRECIO", el nombre completo con su SKU, los dos montos, el ahorro y el
 * porcentaje. Hay una prueba que renderiza el mismo cambio por los dos caminos
 * y exige que digan lo mismo (test/ntfy.test.mjs): si alguien cambia el formato
 * de un lado y no del otro, muere.
 *
 * Y CADA TIPO DICE LO QUE ES, no solo la baja. Hoy por aca solo pasan bajas (la
 * regla del operador del 2026-10-14, src/solo-bajas.mjs), pero esa regla se
 * revierte borrando una linea: el dia que se revierta, una suba rotulada "BAJO
 * DE PRECIO" seria el peor aviso posible -- el operador iria a comprar algo que
 * subio. Hay un mutante para eso.
 */
export function avisoDeCambio(cambio = {}) {
  const nombre = componerTitulo(cambio);
  const sku = cambio?.modelo || "sin SKU";
  const antes = cambio?.precioAnterior;
  const ahora = cambio?.precio;
  const click = cambio?.url || null;

  const tramo = Number.isFinite(antes) ? `De ${monto(antes)} a ${monto(ahora)}` : `Precio: ${monto(ahora)}`;
  const diferencia =
    Number.isFinite(antes) && Number.isFinite(ahora) && antes !== 0
      ? ahora < antes
        ? ` · ahorras ${CLP.format(antes - ahora)} (−${PCT.format(((antes - ahora) / antes) * 100)}%)`
        : ` · ${CLP.format(ahora - antes)} mas (+${PCT.format(((ahora - antes) / antes) * 100)}%)`
      : "";

  let titulo;
  let cuerpo;
  switch (cambio?.tipo) {
    case "baja":
      titulo = `🟢⬇️ BAJÓ DE PRECIO · ${nombre}`;
      cuerpo = `${tramo}${diferencia}`;
      break;
    case "sube":
      titulo = `🔴⬆️ SUBIÓ DE PRECIO · ${nombre}`;
      cuerpo = `${tramo}${diferencia}`;
      break;
    case "stock":
      titulo = `📦 Cambió el stock · ${nombre}`;
      cuerpo = `Precio actual: ${monto(ahora)}`;
      break;
    case "nuevo":
      titulo = `🆕 Producto nuevo · ${nombre}`;
      cuerpo = `Precio: ${monto(ahora)}`;
      break;
    case "recuperado":
      titulo = `✅ Volvió al sitio · ${nombre}`;
      cuerpo = `Precio actual: ${monto(ahora)}`;
      break;
    case "desaparecido":
      titulo = `❌ Ya no aparece en el sitio · ${nombre}`;
      cuerpo = `Último precio: ${monto(antes)}`;
      break;
    default:
      titulo = `🔹 Cambió algo · ${nombre}`;
      cuerpo = tramo;
  }
  // El SKU va en el CUERPO y no en el titulo: el titulo es lo que el telefono
  // recorta primero y el nombre del producto vale mas que el codigo. Medido
  // sobre el catalogo (552 notificables): mediana 51 caracteres de titulo, maximo
  // 136, asi que con el prefijo de la bandera el peor caso cabe en los 250.
  return { titulo: recortar(titulo, 250), mensaje: recortar(`${cuerpo}\n${sku}`, 3500), click, prioridad: PRIORIDAD_BAJA };
}

/**
 * Un aviso TECNICO (revision sospechosa, censo, productos momificados, el pulso
 * del dia) como notificacion del celular. PURO.
 *
 * Primera linea del mensaje de Discord = titulo, el resto = cuerpo. Es la misma
 * conversion que hace Vigia, y funciona porque TODOS los avisos tecnicos de este
 * repo estan escritos con la misma forma: primera linea "🧭 **Monitor Samsung —
 * de que se trata**" y el detalle debajo (comprobado en los 9 textos de
 * run.mjs, censo-cli.mjs y discord.mjs).
 *
 * PRIORIDAD 3 Y NO 4, a proposito: un problema del monitor no puede verse igual
 * que una oferta. El telefono le da un trato distinto y, ademas, el titulo
 * empieza por "Monitor Samsung" y no por un producto.
 */
export function avisoTecnico(texto) {
  const lineas = String(texto ?? "").split("\n").filter((l) => l.trim() !== "");
  const titulo = (lineas[0] ?? "Monitor Samsung").replace(/\*\*/g, "").trim();
  const cuerpo = lineas.slice(1).join("\n").replace(/\*\*/g, "") || titulo;
  return { titulo: recortar(titulo, 250), mensaje: recortar(cuerpo, 3500), click: null, prioridad: PRIORIDAD_TECNICA };
}

/**
 * EL DESMENTIDO DE UN AVISO FALSO. PURO.
 *
 * POR QUE EXISTE (defecto ALTO medido el 2026-11-06 por dos verificadores). Un
 * aviso en vivo que la revision completa NO ratifica genera en Discord la
 * seccion "Correcciones de avisos", que este repo pone PRIMERA a proposito
 * porque desmiente algo que el operador ya recibio y por lo que puede estar por
 * ir a comprar. Esa seccion no producia ninguna notificacion: la oferta FALSA
 * sonaba en el telefono como su propia notificacion (salio en vivo) y el
 * desmentido quedaba sepultado dentro de la notificacion agrupada de Discord --
 * o sea exactamente al reves de lo que este canal vino a arreglar. Medido sobre
 * data/ejecuciones.jsonl: 20 correcciones en 897 corridas, 16 corridas
 * afectadas, 4 de ellas en la semana que midio el operador, peor corrida 4.
 *
 * EL TITULO EMPIEZA POR "SE CORRIGE" y no por el nombre del producto: en la
 * lista de notificaciones del telefono el desmentido tiene que poder
 * distinguirse de la oferta a la que contradice sin abrirlo.
 *
 * Y NUNCA PUEDE DECIR "BAJÓ DE PRECIO": seria la misma frase que el aviso que
 * esta desmintiendo. Hay una prueba para eso.
 */
export function avisoDeCorreccion(aviso = {}, actual = {}) {
  const nombre = componerTitulo({ ...actual, ...aviso });
  const sku = aviso?.modelo || actual?.modelo || "sin SKU";
  const que = aviso?.tipo === "stock" ? "cambio de stock" : aviso?.tipo === "baja" ? "baja de precio" : "cambio";
  const vigente = Number.isFinite(actual?.precio)
    ? `El precio vigente sigue siendo ${monto(actual.precio)}.`
    : "La revisión completa no encontró ese cambio.";
  return {
    titulo: `⚠️ SE CORRIGE: no se confirmó · ${nombre}`,
    mensaje: `El aviso de ${que} que te llegó durante la revisión NO se confirmó (otra página del sitio publica otro dato).\n${vigente}\n${sku}`,
    click: aviso?.url || actual?.url || null,
    prioridad: PRIORIDAD_CORRECCION,
  };
}

/**
 * LOS DOS AVISOS DEL TOPE, y son dos porque el numero se sabe DESPUES.
 *
 * NO SE CALLA LO QUE NO CUPO, y es la regla mas vieja de este proyecto: un aviso
 * que desaparece en silencio es peor que un aviso de mas. Pero tampoco se puede
 * MENTIR el numero, que es la regla que este repo peleo el 2026-10-14 (el
 * encabezado que decia "11 cambios" habiendo detectado 185).
 *
 * EL DEFECTO QUE ESTO ARREGLA (medido el 2026-11-06 por dos verificadores): el
 * aviso salia en la PRIMERA omision, cuando el contador valia 1, asi que el
 * titulo decia "1 bajas mas que no caben" tambien cuando faltaban 220. El
 * comentario del modulo prometia "dice cuantos faltan" y era falso.
 *
 * Asi que son dos:
 *  - `avisoDeTopeAlCruzar` sale en el momento, SIN numero (todavia no existe) y
 *    diciendo que al final se dira cuantas fueron. Sale en el momento porque la
 *    corrida se puede morir antes de terminar y el operador tiene que saber que
 *    hubo mas.
 *  - `avisoDeTopeFinal` sale al cerrar la corrida (ver cerrarCorrida), con el
 *    numero REAL y en castellano, singular incluido.
 */
export function avisoDeTopeAlCruzar(tope) {
  return {
    titulo: "🟢⬇️ Hay más bajas de las que caben en el teléfono",
    mensaje:
      `Esta revisión pasó de ${tope} bajas de precio y el teléfono recibe una notificación por cada una, ` +
      `así que las siguientes no se mandan de a una.\n` +
      `Están TODAS completas en Discord, con su precio y su link. Cuando la revisión termine te digo cuántas fueron. ` +
      `Esto pasa en una ola de ofertas (un Cyber), no en un día normal.`,
    click: null,
    prioridad: PRIORIDAD_BAJA,
  };
}

export function avisoDeTopeFinal(omitidos, tope) {
  const n = Number.isFinite(omitidos) ? omitidos : 0;
  // El singular y el plural se escriben los dos: "1 bajas" es lo que salia
  // antes de este arreglo, y un mensaje al operador no se escribe asi.
  const titulo = n === 1 ? "🟢⬇️ 1 baja más que no cabe en el teléfono" : `🟢⬇️ ${n} bajas más que no caben en el teléfono`;
  const esas = n === 1 ? "esa baja" : `esas ${n}`;
  return {
    titulo,
    mensaje:
      `Esta revisión encontró más de ${tope} bajas de precio, así que ${esas} no llegaron como notificación de a una.\n` +
      `Están TODAS completas en Discord, con su precio y su link.`,
    click: null,
    prioridad: PRIORIDAD_BAJA,
  };
}

function recortar(texto, max) {
  const t = String(texto ?? "");
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Publica UN aviso. Nunca lanza: devuelve {ok, error}.
 *
 * EL TOPE DE ESPERA NO ES NEGOCIABLE y la razon es la misma que la del tope de
 * Discord (topeEspera en src/discord.mjs): esto corre en el hueco entre dos
 * paginas, asi que todo lo que espere aca DETIENE el barrido. Lo que ahi se
 * acota a 70 s aca se acota a 3 s, porque Discord puede perder un aviso y ntfy
 * no puede perder nada (la copia es de algo que ya llego).
 *
 * NO HAY REINTENTOS, y es una decision con tres razones:
 *   - el aviso NO se pierde: esta en Discord, que es el registro;
 *   - el cupo de ntfy.sh es por IP y la IP del runner es ajena (arriba): insistir
 *     gasta un cupo que no es nuestro, que es exactamente lo que src/discord.mjs
 *     ya decidio no hacer con los 400;
 *   - cada reintento multiplica el rato que el barrido queda parado, y en una
 *     tanda de 6 bajas eso se multiplica por 6.
 *
 * El temporizador se cancela y va con unref(): un timer vivo impide que Node
 * termine, y la leccion de este repo es que eso deja el job colgado hasta el
 * timeout.
 *
 * Y SE ABORTA SIEMPRE AL SALIR, aunque la respuesta haya sido un 200. Es el
 * defecto ALTO que midio un verificador el 2026-11-06 y es la unica forma en que
 * ntfy podia costar una corrida entera: `fetch` resuelve con las CABECERAS, el
 * tope de espera se cancela ahi, y el CUERPO de la respuesta queda abierto. Si
 * el servidor nunca lo cierra (un proxy atascado, un balanceador que acepto y se
 * quedo pegado), cada notificacion deja un socket vivo y Node NO TERMINA aunque
 * la revision ya hizo todo su trabajo. Medido con HTTP de verdad: cuerpo que
 * calla -> el proceso sale a los 323 s en vez de 19 s (el bodyTimeout de
 * undici); cuerpo que gotea un byte cada 2 s -> no sale nunca (tres corridas
 * matadas a los 120, 150 y 240 s, con los mensajes de Discord ya entregados).
 * En Actions eso es el timeout de 330 min, el aviso falso de "NO HUBO REVISION"
 * y el grupo de concurrencia tomado 5,5 h, o sea ~5 revisiones perdidas por
 * corrida colgada. Y los tres frenos de abajo son CIEGOS a ese caso, porque la
 * respuesta es un 2xx: el log diria `enviados=10 fallidos=0 apagado_por=no`.
 * `control.abort()` en el finally destruye ese socket. Verificado con una prueba
 * de HTTP real (ninguna prueba con `fetch` interceptado puede cazarlo: los
 * dobles devuelven objetos sin cuerpo).
 */
export async function publicar(tema, aviso, { fetchFn = fetch, servidor = SERVIDOR_POR_DEFECTO, timeoutMs = POR_DEFECTO.timeoutMs } = {}) {
  if (!tema) return { ok: false, error: "ntfy: sin tema configurado" };
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), Math.max(1, timeoutMs));
  reloj.unref?.();
  try {
    const res = await fetchFn(servidor, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // El tema viaja en el CUERPO, no en la URL: es la clave de acceso (ver
      // arriba) y una URL queda escrita en logs y proxies.
      body: JSON.stringify({
        topic: tema,
        title: aviso?.titulo,
        message: aviso?.mensaje,
        priority: aviso?.prioridad ?? PRIORIDAD_BAJA,
        ...(aviso?.click ? { click: aviso.click } : {}),
      }),
      signal: control.signal,
    });
    return res?.ok ? { ok: true } : { ok: false, error: `ntfy HTTP ${res?.status ?? "sin respuesta"}` };
  } catch (err) {
    return { ok: false, error: `ntfy: ${err?.message || String(err)}` };
  } finally {
    clearTimeout(reloj);
    // El cuerpo de la respuesta no se lee NUNCA (no hay nada que nos interese en
    // el) y por eso hay que cerrarlo a mano: ver la nota de arriba. Es seguro
    // despues de un 200 -- la respuesta ya esta devuelta -- y es lo unico que
    // garantiza que no quede un socket vivo pase lo que pase.
    control.abort();
  }
}

/**
 * El avisador de una corrida: publica, cuenta, y se apaga solo antes de poder
 * hacer dano.
 *
 * LOS DOS FRENOS DE ESTA FUNCION (el tercero es el tope de espera de publicar),
 * los dos copiados de piezas que ya existen en este repo porque ya se midio que
 * hacian falta:
 *
 *  - CORTE TRAS N FALLOS SEGUIDOS, igual que VIVO_MAX_FALLOS_SEGUIDOS en
 *    src/despachador-vivo.mjs. Si ntfy no responde, el peor caso sin este freno
 *    es 3 s de espera por CADA baja de CADA tanda, en el hueco entre paginas: en
 *    una corrida de 1.170 paginas eso es tiempo de scraping tirado a la basura
 *    por el eslabon menos importante. Con el freno, el techo del dano en toda la
 *    corrida son 3 x 3 s = 9 s, una vez, y se dice en el log.
 *
 *  - TOPE DE AVISOS DE PRODUCTO POR CORRIDA, igual que VIVO_TOPE_AVISOS. El
 *    numero por defecto es 60 porque 60 es la RAFAGA que documenta ntfy: hasta
 *    ahi el servidor acepta sin frenar, y a partir de ahi deja pasar una cada
 *    5 s. Medido sobre el historial real: de las 154 corridas con bajas, 153
 *    tuvieron 46 o menos, asi que el tope no toca el caso normal ni el de un
 *    Cyber corriente; la unica que lo cruza es la del 2026-10-01T22:16, con 141
 *    bajas -- y mandar esas 141 de a una habria significado 81 esperas de 5 s
 *    (6,8 min de barrido parado) para empezar a chocar igual con el tope diario
 *    de 250. Pasado el tope salen DOS avisos y ninguno miente: uno al cruzarlo,
 *    sin numero, y uno al cerrar la corrida con el numero real (ver
 *    avisoDeTopeAlCruzar / avisoDeTopeFinal). No se calla nada.
 *
 * LO QUE EL TOPE SI AHORRA Y LO QUE NO (corregido el 2026-11-06). La version
 * anterior de esta nota lo justificaba con segundos de barrido parado, y un
 * verificador midio que en el pipeline completo eso NO existe: con 900 paginas y
 * 280 bajas, ntfy apagado 139,4 s contra 140,2 s sin tope (+0,5%), porque el
 * envio va en el hueco entre paginas y queda tapado por los 63 mensajes de
 * Discord a 2,3 s cada uno, que ya frenaban el barrido igual. El argumento que
 * SI se sostiene es el techo de 250 mensajes al dia del servidor publico,
 * contado por IP compartida: pasado el tope, las notificaciones siguientes
 * empezarian a gastar un cupo diario que ademas no es solo nuestro, y el aviso
 * del dia siguiente podria quedarse sin lugar. Con un servidor lento (2,9 s por
 * aviso, medido) el tope ademas acota el peor caso a ~1,4 min.
 *
 * LOS AVISOS TECNICOS Y LAS CORRECCIONES NO CUENTAN CONTRA EL TOPE, a proposito
 * -- y desde el 2026-11-06 es cierto: el tope se compara contra `deProducto` y
 * no contra `enviados`, que los sumaba todos (defecto medido: con tope=10, 4
 * avisos tecnicos dejaban sonar 6 bajas en vez de 10). Los tecnicos ya tienen su
 * propio freno de "una vez al dia por clave" (src/avisos-repetidos.mjs) y son
 * del orden de 2 a 4 al dia (medido sobre data/avisos-tecnicos.jsonl). Si
 * compartieran el tope, una ola de 141 bajas dejaria sin mandar justo el aviso
 * que dice que el monitor esta roto, que es el aviso que mas importa.
 */
export function crearAvisadorNtfy({
  tema,
  servidor = process.env.NTFY_SERVIDOR || SERVIDOR_POR_DEFECTO,
  fetchFn = undefined,
  timeoutMs = num("NTFY_TIMEOUT_MS", POR_DEFECTO.timeoutMs),
  maxFallosSeguidos = Math.max(1, num("NTFY_MAX_FALLOS_SEGUIDOS", POR_DEFECTO.maxFallosSeguidos)),
  tope = num("NTFY_TOPE_AVISOS", POR_DEFECTO.tope), // 0 = sin tope
  log = console,
} = {}) {
  let activo = Boolean(tema);
  let fallosSeguidos = 0;
  let avisoDeTopeMandado = false;
  let cerrada = false;
  // `deProducto` ES EL CONTADOR DEL TOPE, y no `enviados`: ese era el defecto
  // medido el 2026-11-06 (el comentario de abajo decia que los avisos tecnicos
  // no cuentan contra el tope y si contaban, porque el tope se comparaba contra
  // `enviados`, que los suma todos). Medido con tope=10: 4 avisos tecnicos antes
  // del cierre dejaban sonar 6 bajas en vez de 10.
  const stats = { enviados: 0, deProducto: 0, fallidos: 0, omitidosPorTope: 0, noUrgentes: 0, tecnicos: 0, correcciones: 0, apagadoPor: null };

  const opciones = { servidor, timeoutMs, ...(fetchFn ? { fetchFn } : {}) };

  async function mandar(aviso) {
    if (!activo) return { ok: false, error: "ntfy apagado en esta corrida" };
    const r = await publicar(tema, aviso, opciones);
    if (r.ok) {
      stats.enviados += 1;
      fallosSeguidos = 0;
      return r;
    }
    stats.fallidos += 1;
    fallosSeguidos += 1;
    // Se dice SIEMPRE, no solo al apagarse: un aviso que no llego al celular
    // tiene que poder verse en el log de la corrida.
    log.error?.(`WARNING no se pudo copiar un aviso al celular (se sigue igual, el aviso esta en Discord): ${r.error}`);
    if (fallosSeguidos >= maxFallosSeguidos) {
      activo = false;
      stats.apagadoPor = "fallos-seguidos";
      log.error?.(
        `WARNING copias al celular (ntfy) apagadas en esta revision tras ${fallosSeguidos} fallos seguidos. Discord sigue recibiendo todo.`,
      );
    }
    return r;
  }

  return {
    get activo() {
      return activo;
    },

    /**
     * LOS TRES FRENOS QUE SE DESPLIEGAN DE VERDAD, a la vista.
     * Existe para que una prueba pueda atar los numeros por defecto sin tener
     * que esperar 3 s ni mandar 60 avisos: ver POR_DEFECTO arriba.
     */
    config() {
      return { timeoutMs, maxFallosSeguidos, tope };
    },

    /** Un cambio de producto que Discord YA acepto. Una notificacion por cambio. */
    async avisarCambio(cambio) {
      if (!activo) return { ok: false };
      // EL PORTON DEL CELULAR, Y ES EL UNICO. Lo que no es un aviso urgente no
      // suena: un rebote es un valor que el operador YA escucho y Discord lo
      // manda compacto bajo "ya te los avisé, no es novedad" (ver esParaCelular
      // en src/despachador-vivo.mjs). Esta linea es la que impide que el canal
      // nuevo reintroduzca la notificacion repetida que el freno anti-parpadeo
      // saco el 2026-09-13.
      if (!esParaCelular(cambio)) {
        stats.noUrgentes += 1;
        return { ok: false, noUrgente: true };
      }
      if (tope > 0 && stats.deProducto >= tope) {
        stats.omitidosPorTope += 1;
        if (!avisoDeTopeMandado) {
          // SE MANDA AL CRUZAR EL TOPE, SIN NUMERO: al final puede no haber
          // final (la corrida se puede morir) y el operador tiene que saber que
          // hubo mas. El numero real lo dice cerrarCorrida().
          //
          // Y LA BANDERA SE LEVANTA DESPUES DEL OK, no antes (defecto medido el
          // 2026-11-06): levantarla antes hacia que un 503 o un timeout en ese
          // unico POST lo perdiera para siempre -- la corrida seguia omitiendo
          // bajas y no volvia a intentar decirlo. Medido con tope=3 y 8 bajas:
          // el operador recibia 3 notificaciones y CERO avisos de que faltaban 5.
          const r = await mandar(avisoDeTopeAlCruzar(tope));
          if (r.ok) avisoDeTopeMandado = true;
        }
        return { ok: false, omitido: true };
      }
      stats.deProducto += 1;
      return mandar(avisoDeCambio(cambio));
    },

    /**
     * El desmentido de un aviso que salio en vivo y la revision no confirmo.
     *
     * NO CUENTA CONTRA EL TOPE DE PRODUCTO, igual que los tecnicos y por la
     * misma razon: es el aviso que menos puede faltar (el operador ya recibio la
     * oferta falsa) y el volumen esta medido en <= 4 por corrida, 20 en 897
     * corridas. Una ola de bajas no puede callar justo la correccion.
     */
    async avisarCorreccion(aviso, actual) {
      if (!activo) return { ok: false };
      stats.correcciones += 1;
      return mandar(avisoDeCorreccion(aviso, actual));
    },

    /** Un aviso tecnico que Discord YA acepto. */
    async avisarTecnico(texto) {
      if (!activo) return { ok: false };
      stats.tecnicos += 1;
      return mandar(avisoTecnico(texto));
    },

    /**
     * El cierre de la corrida: dice CUANTAS bajas no cupieron.
     *
     * El total solo se sabe cuando la corrida termina, asi que el unico lugar
     * donde se puede decir sin mentir es aca (ver avisoDeTopeFinal). Es
     * idempotente: llamarlo dos veces no manda dos avisos.
     */
    async cerrarCorrida() {
      if (cerrada) return { ok: false, yaCerrada: true };
      cerrada = true;
      if (stats.omitidosPorTope <= 0) return { ok: false, nadaQueDecir: true };
      return mandar(avisoDeTopeFinal(stats.omitidosPorTope, tope));
    },

    stats() {
      return { ...stats };
    },
  };
}

/**
 * Cierra la copia al celular y deja UNA linea en el log de la corrida.
 *
 * VIVE ACA Y NO EN run.mjs por la razon de siempre en este repo: run.mjs arranca
 * main() al importarse y ninguna prueba lo alcanza, asi que todo lo que se
 * escriba alla queda sin cubrir (medido el 2026-11-06: el mutante que borraba la
 * linea `INFO ntfy` dejaba la suite entera en verde, y esa linea es la UNICA
 * observabilidad de este canal). Aca queda cubierta y en run.mjs es una linea.
 *
 * La linea NO va a data/ejecuciones.jsonl a proposito: ese resumen se escribe
 * ANTES del envio del cierre, asi que cualquier contador de ntfy guardado alli
 * seria un numero a medias -- y un numero a medias en el archivo que lee el
 * pulso del dia es peor que no tenerlo (la leccion del conteo honesto).
 */
export async function cerrarCorridaNtfy(avisador, { log = console } = {}) {
  if (!avisador) return null;
  await avisador.cerrarCorrida();
  const n = avisador.stats();
  log.log?.(
    `INFO ntfy enviados=${n.enviados} de_producto=${n.deProducto} fallidos=${n.fallidos} tecnicos=${n.tecnicos} ` +
      `correcciones=${n.correcciones} no_urgentes=${n.noUrgentes} omitidos_por_tope=${n.omitidosPorTope} apagado_por=${n.apagadoPor ?? "no"}`,
  );
  return n;
}

/**
 * El avisador de esta corrida, o null si el operador no configuro su tema.
 *
 * NULL ES LO QUE PERMITE DESPLEGAR ESTO ANTES DE QUE EL TEMA EXISTA: sin tema no
 * se crea nada, no se toca ningun camino de envio y el monitor se comporta
 * EXACTAMENTE como antes de este cambio. Se dice UNA vez en el log y no se
 * repite (una linea por proceso: la revision y el censo son dos procesos).
 */
export function avisadorDelEntorno({ env = process.env, log = console } = {}) {
  const tema = temaDelEntorno(env);
  if (!tema) {
    log.log?.("INFO NTFY_TEMA no configurado: no se mandan copias al celular (todo sigue llegando a Discord igual).");
    return null;
  }
  // El tema NO se imprime: es la clave de acceso al canal.
  log.log?.("INFO copias al celular por ntfy: activadas (una notificacion por aviso).");
  // El servidor sale del MISMO entorno que el tema (y no de process.env a
  // escondidas): es lo que permite correr el pipeline real contra un servidor de
  // mentira en 127.0.0.1 y lo que hace que una prueba que pasa su propio entorno
  // pruebe de verdad el camino completo.
  return crearAvisadorNtfy({ tema, servidor: env?.NTFY_SERVIDOR || SERVIDOR_POR_DEFECTO });
}
