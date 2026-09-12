import { componerTitulo } from "./titulo.mjs";
import { reloj } from "./reloj.mjs";
import { ESTADO, textoEstado } from "./stock.mjs";
import { entorno } from "./entorno.mjs";

const CLP = new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 });

function fmt(n) {
  return Number.isFinite(n) ? CLP.format(n) : "sin precio";
}

// diferencia en pesos y porcentaje, ej: " (−$170.000 · −15,9%)"
function variacion(anterior, nuevo) {
  if (!Number.isFinite(anterior) || !Number.isFinite(nuevo) || anterior === 0) return "";
  const diff = nuevo - anterior;
  const signo = diff > 0 ? "+" : "−";
  const pctAbs = Math.abs((diff / anterior) * 100).toFixed(1);
  return ` (${signo}${CLP.format(Math.abs(diff))} · ${signo}${pctAbs}%)`;
}

// Icono por categoria real de src/seed.json (nunca se usa para "Accesorios *"
// porque esas categorias se filtran antes de llegar aca -- ver esAccesorio en
// src/catalogo.mjs, aplicado en run.mjs justo antes de llamar a notifyDiscord).
const ICONO_CATEGORIA = {
  Smartphones: "📱",
  Tablets: "📱",
  Computadores: "💻",
  "Relojes (Galaxy Watch)": "⌚",
  "Audio y Galaxy Buds": "🎧",
  "Audio (Soundbars/Torres)": "🔊",
  Televisores: "📺",
  "TV Lifestyle": "🖼️",
  Monitores: "🖥️",
  Proyectores: "📽️",
  Signage: "📟",
  "LED Signage": "📟",
  Refrigeradores: "🧊",
  "Línea blanca": "🧊",
  Lavavajillas: "🍽️",
  Cocina: "🍳",
  Microondas: "♨️",
  "Lavado y secado": "🧺",
  "Aire acondicionado": "❄️",
  "Aire acondicionado (sistemas)": "❄️",
  Aspiradoras: "🧹",
  "Purificadores de aire": "🌬️",
  SmartThings: "🏠",
  Reproductores: "📀",
};
const ICONO_DEFAULT = "🔹";

function iconoPara(categoria) {
  return ICONO_CATEGORIA[categoria] || ICONO_DEFAULT;
}

// El titulo va en negrita: un "*" o "_" que venga del sitio rompe el formato del
// resto del mensaje (precios y links incluidos). Hoy ningun nombre del catalogo
// los trae, pero el texto es de Samsung y puede cambiar en cualquier corrida.
// La barra invertida va PRIMERO en la clase y en la misma pasada: es el propio
// caracter de escape, y un nombre terminado en "\" convertia el ** de cierre en
// un asterisco literal -- la negrita no cerraba y se arrastraba el precio, el
// link y los productos siguientes del mismo mensaje. El pipe tambien se escapa
// porque "||texto||" es un spoiler en Discord (oculta el resto de la linea).
function escaparMarkdown(texto) {
  return texto.replace(/([\\*_`~|])/g, "\\$1");
}

/**
 * El precio que acompania a un aviso de stock es el ULTIMO CONOCIDO. Si lleva
 * corridas sin poder leerse, imprimirlo a secas lo presenta como vigente y el
 * operador puede ir a comprar con un numero viejo. Solo aparece cuando hay algo
 * que declarar (ver sinComprobar en src/comparar.mjs).
 */
function sinComprobar(change) {
  const n = change?.corridasSinPrecio;
  return Number.isFinite(n) && n > 0
    ? ` _(último precio conocido: la página no lo publica hace ${n} ${n === 1 ? "revisión" : "revisiones"})_`
    : "";
}

/**
 * Un cambio que se adopto porque la pagina que escribio el precio guardado no
 * volvio en varias corridas (ver UMBRAL_PRECIO_OTRA_FUENTE en src/comparar.mjs).
 * El numero es real, pero lo publica otra pagina del sitio: vale decirlo.
 */
function otraFuente(change) {
  return change?.desdeOtraFuente ? " _(precio leído desde otra página del sitio)_" : "";
}

function lineFor(change) {
  const icono = iconoPara(change.categoria);
  // el titulo ahora incluye las caracteristicas de la variante (capacidad, RAM,
  // color...) y el SKU sigue visible al final: es el unico identificador estable
  const nombre = escaparMarkdown(componerTitulo(change));
  const sku = change.modelo || "sin SKU";
  const titulo = `${icono} **${nombre}** (${sku})`;
  const link = change.url ? `\n　🔗 ${change.url}` : "";
  switch (change.tipo) {
    case "nuevo":
      if (!Number.isFinite(change.precio)) {
        // Un producto puede entrar al catalogo SIN precio publicado: su pagina no
        // escribe ningun monto y el monitor prefiere callarse antes que inventarlo
        // (ver precioAdoptable en src/extract.mjs). Se anuncia igual -- un producto
        // nuevo a la venta es noticia -- pero diciendo la verdad sobre el precio.
        return `${titulo}\n　🆕 Apareció en el catálogo. **La página todavía no publica precio**; se avisará en cuanto lo publique.${link}`;
      }
      // ...y cuando por fin lo publica, el aviso no puede decir "primera vez visto":
      // el operador ya lo vio aparecer.
      if (change.yaAnunciadoSinPrecio) {
        return `${titulo}\n　🆕 Ya publicaron su precio: **${fmt(change.precio)}**${link}`;
      }
      return `${titulo}\n　🆕 Precio: **${fmt(change.precio)}** (primera vez visto en el catálogo)${link}`;
    case "desaparecido":
      return `${titulo}\n　❌ Ya no aparece en el sitio (confirmado en 2 revisiones seguidas). Último precio: **${fmt(change.precioAnterior)}**${link}`;
    case "recuperado":
      return `${titulo}\n　✅ Volvió a aparecer en el sitio. Precio actual: **${fmt(change.precio)}**${sinComprobar(change)}${link}`;
    case "baja":
      return `${titulo}\n　🟢 Precio antes: ${fmt(change.precioAnterior)} → **ahora: ${fmt(change.precio)}**${variacion(change.precioAnterior, change.precio)}${otraFuente(change)}${link}`;
    case "sube":
      return `${titulo}\n　🔴 Precio antes: ${fmt(change.precioAnterior)} → **ahora: ${fmt(change.precio)}**${variacion(change.precioAnterior, change.precio)}${otraFuente(change)}${link}`;
    // El operador puede ver TRES estados, no dos: "no está a la venta" (el
    // producto existe pero Samsung no lo vende) no es lo mismo que "agotado"
    // (se vende, pero no hay unidades). Los eventos viejos de history.jsonl solo
    // traen los booleanos, asi que se cae a ellos cuando faltan los estados.
    case "stock":
      return `${titulo}\n　📦 Stock antes: **${textoEstado(change.estadoAnterior ?? (change.disponibleAnterior ? ESTADO.DISPONIBLE : ESTADO.AGOTADO))}** → ahora: **${textoEstado(change.estado ?? (change.disponible ? ESTADO.DISPONIBLE : ESTADO.AGOTADO))}**\n　Precio actual: **${fmt(change.precio)}**${sinComprobar(change)}${link}`;
    default:
      return titulo + link;
  }
}

const TITULOS = {
  nuevo: "🆕 Productos nuevos",
  baja: "🟢 Bajas de precio",
  sube: "🔴 Subas de precio",
  stock: "📦 Cambios de stock",
  recuperado: "✅ De vuelta en el sitio",
  desaparecido: "❌ Ya no aparecen (confirmado)",
  correccion: "⚠️ Correcciones de avisos en vivo",
  pendiente: "⏳ Avisos atrasados (no se pudieron entregar en la revisión anterior)",
};

const TIPO_EN_PALABRAS = {
  baja: "baja de precio",
  sube: "alza de precio",
  nuevo: "producto nuevo",
  stock: "cambio de stock",
  recuperado: "producto de vuelta en el sitio",
};

/**
 * Linea de CORRECCION de un aviso en vivo que la revision completa NO confirmo.
 *
 * POR QUE HACE FALTA (defecto critico medido el 2026-09-11)
 * El aviso en vivo se decide con la vista PARCIAL de la corrida: previo[sku]
 * contra lo que escribio ESA pagina. Un mismo SKU lo pueden publicar dos paginas
 * distintas de la misma corrida (medido en produccion: RS60T5200B1/ZS,
 * QN50LS03FAGXZS, SM-S931BDBKLTL) y si la segunda vuelve a publicar el precio
 * anterior, comparar() no emite NINGUN cambio: latest.json conserva el precio
 * viejo y el resumen final daba el aviso por bueno. El operador recibia
 * "−$200.000 · −22%", iba a comprar y el precio era el de siempre; y como el
 * catalogo nunca se enteraba, la corrida siguiente volvia a mandar el MISMO
 * aviso falso, 7 veces al dia, indefinidamente.
 *
 * @param aviso el cambio tal como salio en vivo
 * @param actual el registro del catalogo definitivo (comparar() es la autoridad)
 */
export function lineaCorreccion(aviso, actual) {
  const icono = iconoPara(aviso.categoria ?? actual?.categoria);
  const nombre = escaparMarkdown(componerTitulo({ ...actual, ...aviso }));
  const sku = aviso.modelo || "sin SKU";
  const url = aviso.url || actual?.url;
  const link = url ? `\n　🔗 ${url}` : "";
  const que = TIPO_EN_PALABRAS[aviso.tipo] ?? "cambio";

  let vigente;
  if (aviso.tipo === "stock") {
    const estado = actual?.estadoStock ?? (actual?.disponible ? ESTADO.DISPONIBLE : null);
    vigente = estado ? `El stock vigente es **${textoEstado(estado)}**.` : "El estado de stock vigente no se pudo confirmar.";
  } else if (Number.isFinite(actual?.precio)) {
    vigente = `El precio vigente sigue siendo **${fmt(actual.precio)}**.`;
  } else {
    vigente = "La revisión completa no encontró ese cambio.";
  }

  return `${icono} **${nombre}** (${sku})\n　⚠️ El aviso de ${que} que salió durante la revisión **no se confirmó** (otra página del sitio publica otro dato). ${vigente}${link}`;
}

// Un aviso que quedo de la revision ANTERIOR porque Discord no lo acepto. Lleva
// la fecha original para que no se lea como si acabara de pasar.
function lineaPendiente(cambio) {
  const cuando = cambio?.ts ? new Date(cambio.ts) : null;
  const fecha = cuando && !Number.isNaN(cuando.getTime()) ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(cuando) : "la revisión anterior";
  return `${lineFor(cambio)}\n　_(detectado en ${fecha}; no se pudo avisar en su momento)_`;
}

// ---------------------------------------------------------------------------
// TRANSPORTE: ritmo, reintentos y "Discord jamas puede matar la corrida"
// ---------------------------------------------------------------------------
//
// Antes esto era un fetch pelado: si Discord devolvia 429 el mensaje se perdia
// PARA SIEMPRE (el estado ya estaba escrito, asi que la corrida siguiente no lo
// vuelve a detectar) y si el fetch era RECHAZADO (DNS, socket, Discord caido) la
// excepcion subia hasta main() y mataba la corrida entera -- tres horas de
// scraping perdidas por un hipo de red de 200 ms.
//
// Ahora:
//  - Un solo POST en vuelo a la vez, con cubo de fichas sobre el unico webhook.
//    Discord no publica el numero por webhook; lo medido por la comunidad es
//    RAFAGA 5 cada 2 s y SOSTENIDO ~30 cada 60 s por webhook. Con capacidad 3 y
//    una ficha cada 2.300 ms: la peor ventana de 2 s tiene <= 4 (de 5) y la peor
//    de 60 s tiene 3 + floor(60000/2300) = 29 (de 30). Margen sin ser lento.
//  - 429: se respeta retry_after del cuerpo (segundos, float) en vez de
//    reintentar a ciegas; si viene global, se frena TODA la cola.
//  - Todo error se traga: la funcion devuelve {ok:false} y nunca lanza.
// Todos los numeros son configurables por variable de entorno (se leen en cada
// llamada, asi que se pueden ajustar sin tocar codigo). Se leen con entorno()
// y no con Number(): una variable vacia tiene que caer al valor por defecto, no
// valer cero (ver src/entorno.mjs).
const conf = entorno;

let fichas = null;
let ultimaRecarga = 0;
let pausaGlobalHasta = 0;
let cola = Promise.resolve();

/** Serializa: nunca dos POST a Discord en vuelo al mismo tiempo. */
function enCola(fn) {
  const turno = cola.then(fn, fn);
  cola = turno.then(
    () => {},
    () => {},
  );
  return turno;
}

async function esperarTurno() {
  const capacidad = Math.max(1, conf("DISCORD_RAFAGA", 3));
  const recarga = conf("DISCORD_PAUSA_MS", 2300);
  if (fichas === null) fichas = capacidad;
  fichas = Math.min(fichas, capacidad);

  for (;;) {
    const ahora = reloj.ahora();
    if (pausaGlobalHasta > ahora) {
      await reloj.dormir(pausaGlobalHasta - ahora + 10);
      continue;
    }
    if (recarga <= 0) return; // ritmo desactivado (pruebas)
    const transcurrido = ahora - ultimaRecarga;
    if (transcurrido > 0) {
      fichas = Math.min(capacidad, fichas + transcurrido / recarga);
      ultimaRecarga = ahora;
    }
    if (fichas >= 1) {
      fichas -= 1;
      return;
    }
    await reloj.dormir(Math.ceil((1 - fichas) * recarga));
  }
}

function cabecera(res, nombre) {
  try {
    return res?.headers?.get?.(nombre) ?? null;
  } catch {
    return null;
  }
}

async function cuerpoJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// TOPE DURO DE CUALQUIER ESPERA QUE FRENE LA CORRIDA.
//
// run.mjs llama al despachador en el hueco entre paginas, asi que todo lo que
// duerma aca DETIENE el barrido. Discord puede pedir esperas de minutos u horas
// (un retry_after de un ban de Cloudflare; un reset-after largo en la cabecera),
// y la IP del runner de Actions es compartida con miles de trabajos ajenos, asi
// que ese numero no depende solo de nosotros. Sin tope, un 429 global podia
// congelar el barrido 30 minutos (medido) sobre un job con timeout de 330 min:
// perder 3 horas de scraping por una espera de Discord es exactamente al reves
// de la prioridad del proyecto.
//
// Con el tope, el peor congelamiento posible es DISCORD_MAX_ESPERA_MS y lo que
// no se pueda mandar ahora vuelve a salir en el resumen final.
function topeEspera() {
  return conf("DISCORD_MAX_ESPERA_MS", 70000);
}

// Discord dice explicitamente que el limite por webhook no se adivina: se LEE.
// Si la respuesta avisa que quedan 0 peticiones en el cubo, se espera lo que
// ella misma indica antes del proximo envio. Es el unico numero no estimado
// (pero igual acotado: ver topeEspera).
async function respetarCabeceras(res) {
  if (cabecera(res, "x-ratelimit-remaining") !== "0") return;
  const resetAfter = Number(cabecera(res, "x-ratelimit-reset-after"));
  if (Number.isFinite(resetAfter) && resetAfter > 0) await reloj.dormir(Math.min(resetAfter * 1000, topeEspera()) + 200);
}

async function unIntento(webhookUrl, content) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    return { res };
  } catch (err) {
    return { errorRed: err?.message || String(err) };
  }
}

async function enviarConReintentos(webhookUrl, content) {
  const maxRed = conf("DISCORD_REINTENTOS_RED", 4);
  const max429 = conf("DISCORD_REINTENTOS_429", 5);
  const backoff = conf("DISCORD_BACKOFF_MS", 2000);
  const tope = topeEspera();
  let intentosRed = 0;
  let intentos429 = 0;

  for (;;) {
    await esperarTurno();
    const { res, errorRed } = await unIntento(webhookUrl, content);

    if (errorRed !== undefined) {
      intentosRed += 1;
      if (intentosRed > maxRed) {
        console.error(`Fallo el envio a Discord (red, ${intentosRed} intentos): ${errorRed}`);
        return { ok: false, status: 0, motivo: "red" };
      }
      await reloj.dormir(backoff * 2 ** (intentosRed - 1));
      continue;
    }

    if (res.ok) {
      await respetarCabeceras(res);
      return { ok: true, status: res.status ?? 200 };
    }

    if (res.status === 429) {
      intentos429 += 1;
      const cuerpo = await cuerpoJson(res);
      const desdeCabecera = Number(cabecera(res, "retry-after"));
      const segundos = Number.isFinite(cuerpo?.retry_after) ? cuerpo.retry_after : Number.isFinite(desdeCabecera) ? desdeCabecera : 1;
      const esperaMs = Math.max(0, Math.round(segundos * 1000));
      const global = cuerpo?.global === true || cabecera(res, "x-ratelimit-scope") === "global";
      // La pausa global tambien va acotada al tope. Antes se fijaba con el
      // retry_after crudo y ANTES de decidir si este mensaje se rendia: el tope
      // solo hacia que ESTE mensaje desistiera, y la espera completa la pagaba
      // el envio siguiente dentro de esperarTurno(), con el barrido detenido.
      // Medido: retry_after=1800 congelaba la corrida 30 minutos pese a que el
      // tope declarado son 70 s.
      if (global) pausaGlobalHasta = Math.max(pausaGlobalHasta, reloj.ahora() + Math.min(esperaMs, tope) + 1000);
      if (intentos429 > max429 || esperaMs > tope) {
        console.error(`Fallo el envio a Discord: 429, espera ${esperaMs} ms (intentos ${intentos429}). Queda para el resumen final.`);
        return { ok: false, status: 429, motivo: "429" };
      }
      await reloj.dormir(esperaMs + 300);
      continue;
    }

    if (res.status >= 500) {
      intentosRed += 1;
      if (intentosRed > maxRed) {
        console.error(`Fallo el envio a Discord: ${res.status} tras ${intentosRed} intentos`);
        return { ok: false, status: res.status, motivo: "5xx" };
      }
      await reloj.dormir(backoff * 2 ** (intentosRed - 1));
      continue;
    }

    // 400/401/403/404: el cuerpo esta mal armado o el webhook murio. Reintentar
    // solo gasta el cupo de peticiones invalidas (10.000/10 min POR IP, y la IP
    // del runner de Actions es compartida con miles de trabajos ajenos).
    let detalle = "";
    try {
      detalle = typeof res.text === "function" ? await res.text() : "";
    } catch {
      /* da igual: lo importante es no reintentar */
    }
    console.error(`Fallo el envio a Discord: ${res.status} ${detalle}`);
    return { ok: false, status: res.status, motivo: "permanente", permanente: true };
  }
}

/**
 * Envia UN mensaje. Nunca lanza: devuelve {ok, status, permanente}.
 * El scraping es lo mas valioso de la corrida; Discord no puede abortarla.
 */
export async function enviarMensaje(webhookUrl, content) {
  if (!webhookUrl) return { ok: false, status: 0, motivo: "sin-webhook", permanente: true };
  return enCola(() => enviarConReintentos(webhookUrl, content));
}

/** Solo para pruebas: vuelve a dejar el cubo de fichas y la pausa global en cero. */
export function reiniciarRitmo() {
  fichas = null;
  ultimaRecarga = reloj.ahora();
  pausaGlobalHasta = 0;
  cola = Promise.resolve();
}

// Discord corta cada mensaje en 2000 caracteres. En vez de truncar y perder
// cambios, se arman varios mensajes seguidos -- ninguna novedad se pierde.
//
// Ademas de los textos se devuelve QUE cambio viaja en cada mensaje. Sirve para
// saber exactamente que quedo sin entregar cuando Discord rechaza uno de los
// mensajes: sin ese dato, un fallo parcial obligaba a reintentar todo (y
// duplicar lo que si llego) o a no reintentar nada (y perderlo en silencio).
// @param secciones [tipo, items[]] con item = {linea, cambio?}
export function armarMensajesConCambios(encabezado, secciones) {
  const LIMITE = 1900;
  const mensajes = [];
  let actual = encabezado;
  let grupo = [];

  const agregarLinea = (linea, cambio) => {
    if ((actual + "\n\n" + linea).length > LIMITE) {
      mensajes.push({ texto: actual, cambios: grupo });
      actual = linea;
      grupo = [];
    } else {
      actual += "\n\n" + linea;
    }
    if (cambio) grupo.push(cambio);
  };

  for (const [tipo, items] of secciones) {
    if (items.length === 0) continue;
    agregarLinea(`**${TITULOS[tipo]} (${items.length})**`);
    for (const item of items) agregarLinea(item.linea, item.cambio);
  }

  mensajes.push({ texto: actual, cambios: grupo });
  return mensajes;
}

/** Igual, pero con la firma vieja (secciones de puros textos). */
export function armarMensajes(encabezado, secciones) {
  const conItems = secciones.map(([tipo, lineas]) => [tipo, lineas.map((linea) => ({ linea }))]);
  return armarMensajesConCambios(encabezado, conItems).map((m) => m.texto);
}

// ---------------------------------------------------------------------------
// AVISOS EN VIVO: tandas cortas mientras la revision todavia esta corriendo
// ---------------------------------------------------------------------------

// Descuento de una baja, en porcentaje (0 para cualquier otro tipo de cambio).
function pctBaja(cambio) {
  if (cambio.tipo !== "baja") return 0;
  const { precio, precioAnterior } = cambio;
  if (!Number.isFinite(precio) || !Number.isFinite(precioAnterior) || precioAnterior === 0) return 0;
  return ((precioAnterior - precio) / precioAnterior) * 100;
}

// Dentro de una tanda el orden es por OPORTUNIDAD, no por tipo: la tanda tipica
// trae 1-6 lineas y meterle encabezados de seccion ("🟢 Bajas de precio (2)")
// seria mas ruido que informacion. El emoji de cada linea ya dice el tipo.
function rangoOportunidad(c) {
  if (c.tipo === "baja") return 0;
  if (c.tipo === "stock") return c.disponible ? 1 : 4; // volver a haber stock vale mas que agotarse
  if (c.tipo === "nuevo") return 2;
  if (c.tipo === "sube") return 3;
  if (c.tipo === "recuperado") return 5;
  return 6;
}

export function ordenarPorOportunidad(cambios) {
  return [...cambios].sort((a, b) => rangoOportunidad(a) - rangoOportunidad(b) || pctBaja(b) - pctBaja(a));
}

// Umbral del 🔥, calibrado con el historial real: la baja mediana es 12,5% y el
// 41% de las bajas son >= 15%. Marcar todo no marca nada.
function destacar(cambio) {
  return pctBaja(cambio) >= conf("VIVO_UMBRAL_FUEGO", 15);
}

function lineaVivo(cambio, limiteLinea) {
  const linea = (destacar(cambio) ? "🔥 " : "") + lineFor(cambio);
  return linea.length > limiteLinea ? `${linea.slice(0, limiteLinea - 1)}…` : linea;
}

/**
 * Reparte los cambios de una tanda en mensajes bajo el limite de Discord,
 * devolviendo QUE cambios viajan en cada mensaje: si el segundo mensaje falla,
 * solo sus cambios quedan sin confirmar y vuelven al resumen final.
 * El encabezado se repite en cada mensaje: cada uno tiene que poder leerse solo.
 */
export function empaquetarCambios(encabezado, cambios, limite = 1850) {
  const paquetes = [];
  let texto = encabezado;
  let grupo = [];

  for (const cambio of ordenarPorOportunidad(cambios)) {
    const linea = lineaVivo(cambio, Math.max(200, limite - encabezado.length - 2));
    if (grupo.length > 0 && (texto + "\n\n" + linea).length > limite) {
      paquetes.push({ texto, cambios: grupo });
      texto = `${encabezado}\n\n${linea}`;
      grupo = [cambio];
    } else {
      texto += `\n\n${linea}`;
      grupo.push(cambio);
    }
  }
  if (grupo.length > 0) paquetes.push({ texto, cambios: grupo });
  return paquetes;
}

/**
 * Envia una tanda de avisos en vivo. Devuelve QUE cambios quedaron confirmados
 * con un 2xx de Discord: solo esos se dan por avisados. Nunca lanza.
 */
export async function enviarTandaVivo(webhookUrl, cambios, { encabezado = "", limite } = {}) {
  if (!webhookUrl || cambios.length === 0) {
    return { confirmados: [], fallidos: [], mensajes: 0, permanente: !webhookUrl };
  }
  const paquetes = empaquetarCambios(encabezado, cambios, limite);
  const confirmados = [];
  const fallidos = [];
  let permanente = false;

  for (const paquete of paquetes) {
    const r = await enviarMensaje(webhookUrl, paquete.texto);
    if (r.ok) {
      confirmados.push(...paquete.cambios);
    } else {
      fallidos.push(...paquete.cambios);
      if (r.permanente) permanente = true;
    }
  }
  return { confirmados, fallidos, mensajes: paquetes.length, permanente };
}

/**
 * @param correcciones [{aviso, actual}] avisos que salieron en vivo y que la
 *        revision completa NO confirmo (ver lineaCorreccion)
 * @param pendientes cambios que la revision ANTERIOR detecto pero que Discord
 *        nunca acepto (ver data/pendientes.jsonl en run.mjs)
 * @returns {{mensajes, fallidos, noEntregados}} noEntregados son los cambios que
 *        viajaban en los mensajes que Discord rechazo: run.mjs los persiste para
 *        que la corrida siguiente los vuelva a intentar.
 */
export async function notifyDiscord(webhookUrl, { changes, errores, totalRevisado, avisadosEnVivo = 0, correcciones = [], pendientes = [] }) {
  if (!webhookUrl) {
    console.log("DISCORD_WEBHOOK_URL no configurado, no se envia notificacion.");
    return { mensajes: 0, fallidos: 0, noEntregados: [...(pendientes ?? []), ...(changes ?? [])] };
  }
  // sin novedades, no molestar. Pero si la corrida YA mando avisos en vivo, el
  // cierre se manda igual aunque no quede nada nuevo: es la unica senal de que
  // la revision termino y de cuantos cambios hubo en total. Una correccion o un
  // aviso atrasado tambien obligan a mandarlo.
  if (changes.length === 0 && avisadosEnVivo === 0 && correcciones.length === 0 && pendientes.length === 0) {
    return { mensajes: 0, fallidos: 0, noEntregados: [] };
  }

  const porTipo = { nuevo: [], baja: [], sube: [], stock: [], recuperado: [], desaparecido: [] };
  for (const c of changes) (porTipo[c.tipo] ?? porTipo.nuevo).push({ linea: lineFor(c), cambio: c });

  // El conteo tiene que declarar la corrida COMPLETA, no la lista ya
  // deduplicada: si no, una corrida con 237 cambios de los que 229 salieron en
  // vivo diria "8 cambios" y el operador creeria que se perdio algo.
  // `avisadosEnVivo` lo calcula run.mjs contando los cambios que comparar() SI
  // emitio y que se omiten por haber salido ya: cuenta tambien los heredados de
  // una corrida muerta, y no cuenta los avisos en vivo que la revision termino
  // desmintiendo (esos van en su propia seccion de correcciones).
  const totalCambios = changes.length + avisadosEnVivo;
  const desglose = avisadosEnVivo > 0 ? ` (${avisadosEnVivo} ya avisados en vivo · ${changes.length} en este resumen)` : "";
  const resumen = `Revisados ${totalRevisado} productos · ${totalCambios} cambios${desglose}${errores > 0 ? ` · ${errores} paginas con error` : ""}`;
  // "Todo lo detectado ya se avisó en vivo" solo puede salir cuando eso es
  // literalmente cierto: hubo avisos en vivo, no quedo nada por mandar, ninguno
  // se desmintio y no se arrastra nada de la revision anterior. Con una
  // correccion al lado, ese texto convertiria una alerta falsa en una
  // confirmacion; con un aviso atrasado, diria que se aviso algo que no.
  const todoAvisado = avisadosEnVivo > 0 && changes.length === 0 && correcciones.length === 0 && pendientes.length === 0;
  const cierre = todoAvisado ? "\n✅ Revisión terminada. Todo lo detectado ya se avisó en vivo." : "";
  const encabezado = `**Monitor de precios Samsung Chile**\n${resumen}${cierre}`;

  const secciones = [
    // Las correcciones van PRIMERAS: desmienten un aviso que el operador ya
    // recibio y puede estar por ir a comprar.
    ["correccion", correcciones.map(({ aviso, actual }) => ({ linea: lineaCorreccion(aviso, actual) }))],
    ["pendiente", pendientes.map((c) => ({ linea: lineaPendiente(c), cambio: c }))],
    ["baja", porTipo.baja],
    ["sube", porTipo.sube],
    ["stock", porTipo.stock],
    ["recuperado", porTipo.recuperado],
    ["nuevo", porTipo.nuevo],
    ["desaparecido", porTipo.desaparecido],
  ];

  const mensajes = armarMensajesConCambios(encabezado, secciones);
  let fallidos = 0;
  const noEntregados = [];
  for (const mensaje of mensajes) {
    const r = await enviarMensaje(webhookUrl, mensaje.texto);
    if (!r.ok) {
      fallidos += 1;
      noEntregados.push(...mensaje.cambios);
    }
  }
  if (fallidos > 0) console.error(`WARNING ${fallidos} de ${mensajes.length} mensajes del resumen final no llegaron a Discord`);
  return { mensajes: mensajes.length, fallidos, noEntregados };
}

// alerta tecnica (corrida sospechosa, error critico): un solo mensaje simple
/**
 * AVISO TECNICO DE PRECIOS CORREGIDOS DE ORIGEN (migracion versionPrecio).
 *
 * El precio guardado era el TACHADO o el numero INTERNO de digitalData, no lo
 * que se cobra, asi que corregirlo NO es un cambio del sitio y no puede salir
 * como aviso de precio: seria una tanda de "bajo 26%" por productos que nunca
 * bajaron (medido sobre el catalogo real: 420 SKU).
 *
 * PERO TAMPOCO SE CALLA. Desde UNA sola lectura no hay forma de distinguir "el
 * guardado estaba mal" de "este producto acaba de estrenar oferta y su precio de
 * ayer es el tachado de hoy": los dos casos se ven identicos. Callarse del todo
 * se tragaba bajas reales enteras y sin segunda oportunidad (versionPrecio queda
 * sellado). Aca quedan, con los dos numeros y las bajas primero.
 */
export function mensajeCorreccionesDePrecio(correcciones, tope = 15) {
  const lista = correcciones ?? [];
  if (lista.length === 0) return null;
  const esBaja = (c) => Number.isFinite(c.precio) && Number.isFinite(c.precioAnterior) && c.precio < c.precioAnterior;
  // El desempate por modelo NO es cosmetico: sin el, entre dos correcciones del
  // mismo tipo mandaba el orden de llegada, o sea el orden del recorrido, y
  // CUALES 15 ve el operador cambiaba al reordenar las paginas (medido en la
  // revision del 2026-09-12).
  const ordenadas = [...lista].sort(
    (a, b) => Number(esBaja(b)) - Number(esBaja(a)) || String(a.modelo).localeCompare(String(b.modelo)),
  );
  const lineas = ordenadas
    .slice(0, tope)
    .map((c) => `• ${esBaja(c) ? "🟢" : "🔴"} ${c.modelo}: ${fmt(c.precioAnterior)} → ${fmt(c.precio)}`)
    .join("\n");
  const resto = ordenadas.length > tope ? `\n…y ${ordenadas.length - tope} más.` : "";
  return (
    `🔧 **Monitor Samsung — precios corregidos de origen**\n` +
    `${lista.length} producto(s) tenían guardado un número que no era el que se cobra (el precio tachado, o un valor interno que la página no muestra). **No bajaron ni subieron**: se estaba leyendo mal, y por eso no salen como aviso de precio.\n` +
    `${lineas}${resto}\n` +
    `Si alguno de estos era una oferta de verdad que estrenó hoy, acá se ve: desde una sola lectura el monitor no puede distinguir los dos casos.\n` +
    `Sale una sola vez por producto.`
  );
}

export async function notifyTecnico(webhookUrl, texto) {
  if (!webhookUrl) {
    console.log("DISCORD_WEBHOOK_URL no configurado, no se envia alerta tecnica.");
    return;
  }
  await enviarMensaje(webhookUrl, texto.slice(0, 1900));
}
