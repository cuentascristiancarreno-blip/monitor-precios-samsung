// Avisos EN VIVO: en vez de esperar a que terminen las ~1170 paginas (165-185
// min) para avisar todo junto, cada pagina recien scrapeada se evalua al
// instante y lo que cambio sale por Discord en tandas cortas.
//
// Pedido del operador (2026-09-11): "prefiero que a medida que vaya haciendo la
// revision, si detecta algo me vaya notificando de forma inmediata. Esto
// pensando en que se viene cyber, y necesito estar al tanto de cada movimiento".
//
// QUE SE PUEDE AVISAR EN VIVO Y QUE NO
//   En vivo: nuevo, baja, sube, stock, recuperado. Los cinco dependen solo de
//   previo[sku] y de lo recien observado, asi que se pueden decidir sin conocer
//   el resto de la corrida (ver evaluarObservado en src/comparar.mjs).
//   Al final: "desaparecido" (necesita saber que el SKU no aparecio en TODA la
//   corrida y que la corrida fue confiable) y la alerta tecnica de corrida no
//   confiable (necesita los contadores finales).
//
// QUIEN MANDA
//   comparar() sigue siendo la autoridad del estado: al final corre IGUAL que
//   siempre y produce el catalogo y la lista completa de cambios. Este modulo
//   solo adelanta el aviso. Por eso el envio final DEDUPLICA contra las huellas
//   que este despachador confirmo, y todo lo que NO tenga un 2xx confirmado
//   vuelve a salir en el resumen final: nada se pierde y nada se duplica.
//
// LO QUE ESTE MODULO TIENE PROHIBIDO
//   Escribir en `previo`, en `observado`, en latest.json o en history.jsonl.
//   Solo lee (y escribe su propio registro de notificados). Si tocara
//   previo[sku].stockPendiente para "no repetir el aviso", invertiria la
//   decision de comparar() al final y romperia la regla anti-parpadeo de stock
//   que costo ~150 avisos falsos en 2026-07 (ver BITACORA.md).
import { appendFile, readFile } from "node:fs/promises";
import { evaluarObservado } from "./comparar.mjs";
import { esAccesorio, esFamiliaGenerica } from "./catalogo.mjs";
import { estaSilenciado } from "./silenciados.mjs";
import { enviarTandaVivo } from "./discord.mjs";
import { reloj } from "./reloj.mjs";
import { entorno as num } from "./entorno.mjs";

/**
 * Huella de un cambio. Lleva el TIPO porque un mismo SKU puede generar hasta
 * tres eventos distintos en la misma corrida (medido: SM-X520NZAECHO emitio
 * recuperado + baja + stock el 2026-09-05), y lleva los VALORES porque un SKU
 * puede re-emitirse con otro precio cuando aparece en dos paginas de la misma
 * corrida (medido: RS60T5200B1/ZS, QN50LS03FAGXZS, SM-S931BDBKLTL).
 *
 * El envio final omite un cambio SOLO si esta huella exacta ya se confirmo en
 * vivo. Si el (tipo, SKU) coincide pero el valor no, el final lo manda igual:
 * es la correccion, y comparar() es la autoridad del estado.
 *
 * Los ESTADOS de stock van ademas de los booleanos porque desde 2026-09-11 hay
 * cuatro estados y dos de ellos ("agotado" y "no-a-la-venta") comparten el mismo
 * booleano false: sin esto, pasar de agotado a no-a-la-venta tendria la misma
 * huella que el cambio anterior y el aviso se perderia por deduplicacion.
 */
export function firmaCambio(c) {
  return [
    c?.tipo,
    c?.modelo,
    c?.precioAnterior ?? "",
    c?.precio ?? "",
    c?.disponibleAnterior ?? "",
    c?.disponible ?? "",
    c?.estadoAnterior ?? "",
    c?.estado ?? "",
  ].join("|");
}

/**
 * ¿Este cambio se le manda al operador? Son las dos reglas de PRODUCTO (no de
 * transporte): nada de accesorios, nada de Galaxy Book3.
 */
export function esNotificable(cambio) {
  return !esAccesorio(cambio?.categoria) && !estaSilenciado(cambio);
}

/**
 * Reparto del cierre: de todo lo que comparar() detecto, que va al resumen final
 * y cuanto se omite por haber salido ya en vivo.
 *
 * Vive aca y no dentro de run.mjs porque run.mjs no tiene pruebas: mientras esta
 * linea estuvo alli se le podia borrar el filtro de accesorios, o la
 * deduplicacion, y la suite seguia 196/196 en verde (probado mutandola).
 *
 * `suprimidos` NO es lo mismo que stats().avisados: cuenta los cambios que
 * comparar() SI emitio y que se omiten por huella ya confirmada, incluidas las
 * huellas heredadas de una corrida que murio a mitad. Con avisados, un cierre
 * con 3 heredados y 2 nuevos declaraba "2 cambios" cuando hubo 5 -- y si todo
 * era heredado no salia ningun mensaje de cierre.
 */
export function repartirCierre(cambios, despachador) {
  const paraDiscord = [];
  let suprimidos = 0;
  for (const c of cambios ?? []) {
    if (!esNotificable(c)) continue;
    if (despachador?.yaEnviado?.(c)) {
      suprimidos += 1;
      continue;
    }
    paraDiscord.push(c);
  }
  return { paraDiscord, suprimidos };
}

const ICONO_TIPO = { baja: "🟢", sube: "🔴", stock: "📦", nuevo: "🆕", recuperado: "✅" };

function horaChile() {
  try {
    return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(11, 16) + " UTC";
  }
}

/**
 * Encabezado de una tanda en vivo. Tiene que dejar claro de un vistazo que la
 * revision NO termino (si no, el operador lee "3 cambios" y cree que eso fue
 * todo) y cuanto falta por revisar.
 */
export function encabezadoTanda(cambios, { pagina = 0, totalPaginas = 0 } = {}) {
  const conteo = new Map();
  for (const c of cambios) conteo.set(c.tipo, (conteo.get(c.tipo) ?? 0) + 1);
  const resumen = [...conteo].map(([tipo, n]) => `${ICONO_TIPO[tipo] ?? "🔹"} ${n}`).join(" · ");
  const avance = totalPaginas > 0 ? ` · revisando página ${pagina} de ${totalPaginas}` : "";
  return `⚡ **Monitor Samsung — aviso en curso** · ${horaChile()}\n${resumen}${avance} _(la revisión sigue en marcha)_`;
}

/**
 * @param webhook URL del webhook (sin webhook el despachador queda apagado)
 * @param previo catalogo de la corrida anterior. SOLO LECTURA.
 * @param timestamp timestamp de la corrida (el mismo que usa comparar())
 * @param rutaNotificados data/notificados.jsonl: huellas ya avisadas, para que
 *        una corrida que muere a mitad no haga que la siguiente reavise todo.
 * @param activo false apaga el camino en vivo sin tocar el resto
 */
export function crearDespachadorVivo({ webhook, previo = {}, timestamp, rutaNotificados = null, totalPaginas = 0, activo = true } = {}) {
  // Cuando se vacia la cola: lo PRIMERO de (ventana cumplida | tanda llena |
  // fin de corrida). La ventana es corta a proposito: con 176 min de corrida hay
  // presupuesto para ~5.280 mensajes y el peor Cyber necesita ~86, o sea el cupo
  // sobra 59 veces. Lo escaso es la paciencia del operador, no el cupo.
  const ventanaMs = num("VIVO_VENTANA_MS", 15000);
  // CUANTOS CAMBIOS ENTRAN EN UNA TANDA. Es el tope de la tanda, no una promesa
  // de que la tanda sea un solo mensaje: la linea MEDIA de un cambio real pesa
  // ~252 caracteres (6 x 252 + 112 de encabezado = 1.624, un mensaje), pero la
  // linea mas larga del catalogo real llega a 389 (titulo largo + URL larga), y
  // seis de esas se van a 2.446 y empaquetarCambios las parte en dos mensajes.
  // Medido sobre datos reales: ~14% de las tandas de 6 salen en dos mensajes.
  // Se deja en 6 igual: bajarlo a 4 para garantizar un solo mensaje siempre
  // subiria el total de mensajes ~50% (600 cambios: 150 en vez de 112) y el
  // recurso escaso es el cupo de Discord, no el largo del mensaje. Nada se
  // pierde en ninguno de los dos casos.
  const maxCambios = Math.max(1, num("VIVO_MAX_CAMBIOS", 6));
  const maxCaracteres = num("VIVO_MAX_CARACTERES", 1850);
  const ventanaNotificadosMs = num("VIVO_HORAS_NOTIFICADOS", 8) * 3600 * 1000;
  const maxFallosSeguidos = Math.max(1, num("VIVO_MAX_FALLOS_SEGUIDOS", 3));
  const topeAvisos = num("VIVO_TOPE_AVISOS", 0); // 0 = sin tope
  // CUANTAS TANDAS COMO MAXIMO EN UNA SOLA LLAMADA. run.mjs llama a
  // quizasEnviar() en el hueco entre paginas, asi que mientras esta mandando el
  // barrido no avanza. Sin tope, una rafaga (una oferta relampago que descuelga
  // muchas variantes de una) vaciaba la cola entera de una sentada: medido,
  // 1.000 cambios detectados en UNA pagina dejaban el bucle parado 428 s. Con el
  // tope, el peor bloqueo por pagina es 3 mensajes (~7 s, y 2 de esos ya los
  // gastaba igual la pausa de scraping) y el resto sale en los huecos de las
  // paginas siguientes, que es exactamente para lo que existe este punto de
  // enganche. cerrar() usa forzar y vacia todo igual.
  const tandasPorLlamada = Math.max(1, num("VIVO_TANDAS_POR_LLAMADA", 3));

  const encolados = new Set(); // huellas ya puestas en la cola de esta corrida
  const confirmados = new Set(); // huellas con 2xx de Discord (las unicas que deduplican)
  // Los cambios que ESTA corrida confirmo (no los heredados de una corrida
  // muerta). Al final, run.mjs comprueba cuales de estos comparar() ratifico:
  // los que no, se desmienten con una linea de correccion.
  const confirmadosDeEstaCorrida = [];
  let cola = [];
  let desde = null; // cuando entro el cambio mas viejo de la cola
  let enviando = false;
  let habilitado = Boolean(activo && webhook);
  let pagina = 0;
  let fallosSeguidos = 0;

  const stats = { avisados: 0, mensajes: 0, sinConfirmar: 0, heredados: 0, encolados: 0, apagadoPor: null };

  async function registrarConfirmados(cambios) {
    for (const c of cambios) {
      confirmados.add(firmaCambio(c));
      confirmadosDeEstaCorrida.push(c);
    }
    if (!rutaNotificados || cambios.length === 0) return;
    // La huella se anota SOLO despues del 2xx, nunca al encolar: si se anotara
    // antes, un 429 dejaria el cambio sin avisar en vivo Y deduplicado del
    // resumen final, o sea desaparecido.
    const ahora = new Date().toISOString();
    const lineas = cambios.map((c) => JSON.stringify({ ts: ahora, firma: firmaCambio(c), sku: c.modelo, tipo: c.tipo })).join("\n");
    try {
      await appendFile(rutaNotificados, lineas + "\n");
    } catch (err) {
      console.error(`WARNING no se pudo escribir el registro de notificados: ${err.message}`);
    }
  }

  return {
    /**
     * Carga las huellas ya avisadas por una corrida anterior que no llego a
     * guardar su estado (murio a mitad, timeout del job). Sin esto, esa corrida
     * habria avisado en vivo cambios que latest.json nunca registro, y la
     * corrida siguiente los volveria a detectar y a avisar: duplicado masivo
     * justo el dia que mas importa.
     * Solo se consideran las lineas recientes: una huella vieja silenciando un
     * cambio legitimo es peor que un duplicado.
     */
    async cargarNotificados() {
      if (!rutaNotificados) return 0;
      let texto = "";
      try {
        texto = await readFile(rutaNotificados, "utf-8");
      } catch {
        return 0; // no existe todavia: corrida limpia
      }
      const corte = Date.now() - ventanaNotificadosMs;
      for (const linea of texto.split("\n")) {
        if (!linea.trim()) continue;
        try {
          const o = JSON.parse(linea);
          if (!o?.firma) continue;
          // El caso ambiguo CADUCA. Si el ts no se puede leer (linea escrita a
          // medias por la corrida que murio, archivo tocado a mano) no hay forma
          // de saber si esa huella es de hace un minuto o de hace un mes, y una
          // huella que se da por vigente silencia ese aviso en vivo Y en el
          // resumen final, indefinidamente, mientras ninguna corrida llegue a
          // completarse. La regla declarada de esta funcion es la contraria: un
          // silencio equivocado es peor que un duplicado.
          const t = Date.parse(o.ts);
          if (!Number.isFinite(t) || t < corte) continue;
          if (!confirmados.has(o.firma)) {
            confirmados.add(o.firma);
            stats.heredados += 1;
          }
        } catch {
          // linea a medio escribir por una corrida muerta: se ignora
        }
      }
      return stats.heredados;
    },

    /**
     * Evalua los SKU que ESTA pagina acaba de escribir y encola lo notificable.
     * Retorna al instante: nunca frena el crawl.
     * @param observado mapa de la corrida (solo lectura)
     * @param escritos SKU que integrarVariantes escribio en esta pagina
     */
    evaluar(observado, escritos, { pagina: nro } = {}) {
      if (Number.isFinite(nro)) pagina = nro;
      if (!habilitado) return 0;
      let encoladosAhora = 0;

      for (const modelo of new Set(escritos ?? [])) {
        const obs = observado[modelo];
        if (!obs) continue;
        let cambios = [];
        try {
          // MISMA funcion que usa comparar() al final: las reglas finas (stock
          // confirmado en 2 corridas, "nuevo" por precio recien conocido,
          // "recuperado" que suprime ese "nuevo") no pueden divergir.
          ({ cambios } = evaluarObservado({ modelo, ant: previo[modelo], obs, timestamp }));
        } catch (err) {
          console.error(`ERROR vivo evaluando ${modelo}: ${err.message}`);
          continue;
        }
        for (const c of cambios) {
          // El filtro va al ENTRAR a la cola. Si se olvidara, el pico del
          // 2026-09-09 habria mandado 200 avisos de accesorios moviles y el
          // operador recibiria el spam de Book3 que pidio no recibir.
          if (esAccesorio(c.categoria) || estaSilenciado(c)) continue;
          // ...y dos guardas mas, porque la categoria del cambio es la que el
          // SKU tiene EN ESTE MOMENTO de la corrida, no la definitiva:
          //  a) un SKU que NUNCA se habia visto y que lo escribe primero una
          //     pagina familia llega con categoria "Familia (auto-descubierta)",
          //     que no empieza con "accesorio": un cargador se colaba en vivo y
          //     recien el resumen final lo filtraba, sin corregir el aviso ya
          //     enviado (medido end-to-end). Para un SKU que YA existe esto no
          //     pasa, porque evaluarObservado cae a la categoria anterior.
          //  b) si el catalogo anterior ya lo tenia como accesorio, no se avisa
          //     aunque esta pagina lo publique bajo otra categoria.
          // En ambos casos NO se pierde nada: el cambio queda para el resumen
          // final, donde la categoria ya es la definitiva y el filtro decide
          // bien. El costo es postergar el aviso de un SKU nuevo, que en 301
          // corridas fueron 90 en total.
          if (!previo[modelo] && esFamiliaGenerica(c.categoria)) continue;
          if (esAccesorio(previo[modelo]?.categoria)) continue;
          const f = firmaCambio(c);
          if (encolados.has(f) || confirmados.has(f)) continue;
          encolados.add(f);
          cola.push(c);
          encoladosAhora += 1;
          stats.encolados += 1;
          if (desde === null) desde = reloj.ahora();
        }
      }
      return encoladosAhora;
    },

    /**
     * Manda si toca. run.mjs la llama en el hueco que ya existe entre paginas,
     * en paralelo con el sleep de la politica de scraping: asi no se agrega ni
     * un segundo a la corrida y no hace falta un setInterval (un timer vivo
     * impide que Node termine y dejaria el job colgado hasta el timeout).
     */
    async quizasEnviar({ forzar = false } = {}) {
      if (!habilitado || enviando || cola.length === 0) return { mensajes: 0 };
      const edad = desde === null ? 0 : reloj.ahora() - desde;
      if (!forzar && cola.length < maxCambios && edad < ventanaMs) return { mensajes: 0 };

      enviando = true;
      let mensajes = 0;
      try {
        let primera = true;
        let tandas = 0;
        while (cola.length > 0 && (forzar || primera || cola.length >= maxCambios)) {
          // Tope de tandas por llamada: el barrido no puede quedar parado
          // mientras se drena una rafaga entera (ver tandasPorLlamada arriba).
          // cerrar() pasa forzar:true y vacia todo.
          if (!forzar && tandas >= tandasPorLlamada) break;
          tandas += 1;
          primera = false;
          const tanda = cola.splice(0, maxCambios);
          const r = await enviarTandaVivo(webhook, tanda, {
            encabezado: encabezadoTanda(tanda, { pagina, totalPaginas }),
            limite: maxCaracteres,
          });
          mensajes += r.mensajes;
          stats.mensajes += r.mensajes;

          if (r.confirmados.length > 0) {
            stats.avisados += r.confirmados.length;
            await registrarConfirmados(r.confirmados);
          }

          if (r.permanente) {
            // webhook muerto o cuerpo invalido: insistir solo gasta el cupo de
            // peticiones invalidas, que es POR IP y la IP del runner es ajena
            habilitado = false;
            stats.apagadoPor = "webhook-permanente";
            cola = [];
            console.error("WARNING avisos en vivo apagados: Discord rechaza el envio de forma permanente. Todo va al resumen final.");
            break;
          }

          if (r.fallidos.length > 0) {
            fallosSeguidos += 1;
            if (fallosSeguidos >= maxFallosSeguidos) {
              habilitado = false;
              stats.apagadoPor = "fallos-seguidos";
              stats.sinConfirmar += cola.length + r.fallidos.length;
              cola = [];
              console.error(`WARNING avisos en vivo apagados tras ${fallosSeguidos} tandas fallidas. Todo va al resumen final.`);
            } else {
              cola.unshift(...r.fallidos); // vuelven a intentarse en la proxima tanda
            }
            break;
          }
          fallosSeguidos = 0;

          if (topeAvisos > 0 && stats.avisados >= topeAvisos) {
            habilitado = false;
            stats.apagadoPor = "tope-avisos";
            stats.sinConfirmar += cola.length;
            cola = [];
            console.error(`WARNING avisos en vivo apagados: se superaron ${topeAvisos} avisos en esta corrida. El resto va al resumen final.`);
            break;
          }
        }
      } catch (err) {
        // Discord jamas puede abortar la revision: el scraping es lo valioso
        console.error(`ERROR en el envio en vivo (se sigue igual): ${err.message}`);
      } finally {
        enviando = false;
        desde = cola.length > 0 ? reloj.ahora() : null;
      }
      return { mensajes };
    },

    /** Vacia lo que quede antes de que la corrida siga con el cierre. */
    async cerrar() {
      await this.quizasEnviar({ forzar: true });
      stats.sinConfirmar += cola.length;
      cola = [];
      return stats;
    },

    /** ¿Este cambio ya salio en vivo con 2xx confirmado? */
    yaEnviado(cambio) {
      return confirmados.has(firmaCambio(cambio));
    },

    /**
     * Avisos que ESTA corrida mando en vivo y que la revision completa NO
     * ratifico: comparar() no emitio ningun cambio del mismo (tipo, SKU).
     * Son alertas falsas que hay que desmentir en el cierre (ver run.mjs).
     *
     * Se compara por (tipo, SKU) y no por huella exacta a proposito: si
     * comparar() emitio el MISMO tipo de cambio para ese SKU con otro valor, esa
     * linea del resumen final ya es la correccion y no hace falta una segunda.
     * Los heredados de una corrida muerta quedan fuera: su aviso salio en otra
     * corrida, con otro estado de partida, y desmentirlos aca seria ruido.
     */
    avisosNoRatificados(cambiosFinales) {
      const finales = new Set((cambiosFinales ?? []).map((c) => `${c.tipo}|${c.modelo}`));
      return confirmadosDeEstaCorrida.filter((c) => !finales.has(`${c.tipo}|${c.modelo}`));
    },

    get habilitado() {
      return habilitado;
    },
    get pendientes() {
      return cola.length;
    },
    stats() {
      return { ...stats };
    },
  };
}
