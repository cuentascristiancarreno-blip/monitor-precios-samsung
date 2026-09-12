import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { DELAY_MS, USER_AGENT } from "./config.mjs";
import { discoverFamilyUrls } from "./discover.mjs";
import { procesarEntrada } from "./resolver.mjs";
import { comparar, marcarSinPrecioProlongado, marcarSinVerificarProlongado, UMBRAL_SIN_VERIFICAR } from "./comparar.mjs";
import { integrarVariantes } from "./catalogo.mjs";
import { resumirSilenciados } from "./silenciados.mjs";
import { mensajeCorreccionesDePrecio, notifyDiscord, notifyTecnico } from "./discord.mjs";
import { crearDespachadorVivo, repartirCierre } from "./despachador-vivo.mjs";
import { leerPendientes, serializarPendientes } from "./pendientes.mjs";
import { entorno } from "./entorno.mjs";
import { medicionPrincipales, prepararRecorrido, skusQueCambiaronDeSeccion } from "./prioridad.mjs";
import { diaDe, leerHuellas, serializarHuellas, yaSeAviso } from "./avisos-repetidos.mjs";
import { masCorridas, muestraDeUrls } from "./muestras.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
// CARPETA_DATOS permite correr pruebas completas sin tocar los datos reales
const DATA_DIR = process.env.CARPETA_DATOS || path.join(AQUI, "..", "data");
const LATEST_PATH = path.join(DATA_DIR, "latest.json");
const HISTORY_PATH = path.join(DATA_DIR, "history.jsonl");
const EJECUCIONES_PATH = path.join(DATA_DIR, "ejecuciones.jsonl");
// Huellas de lo ya avisado en vivo. Solo sirve cuando la corrida muere a mitad:
// se trunca apenas latest.json queda escrito (ver mas abajo).
const NOTIFICADOS_PATH = path.join(DATA_DIR, "notificados.jsonl");
// Avisos que Discord nunca acepto. A diferencia de notificados.jsonl, este NO se
// borra al terminar la corrida: se borra cuando por fin se entregan (ver
// src/pendientes.mjs).
const PENDIENTES_PATH = path.join(DATA_DIR, "pendientes.jsonl");
// Huellas de los avisos tecnicos que se repiten solos (ver
// src/avisos-repetidos.mjs): sin esto, una condicion que dura hasta que alguien
// edite el codigo manda 7 mensajes identicos por dia.
const AVISOS_TECNICOS_PATH = path.join(DATA_DIR, "avisos-tecnicos.jsonl");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readJsonSafe(p, fallback) {
  try {
    return JSON.parse(await readFile(p, "utf-8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const inicio = new Date();
  const timestamp = inicio.toISOString();
  await mkdir(DATA_DIR, { recursive: true });

  const seedRaw = JSON.parse(await readFile(path.join(AQUI, "seed.json"), "utf-8"));
  let familyEntries = [];
  if (!process.env.SIN_DESCUBRIMIENTO) {
    try {
      familyEntries = await discoverFamilyUrls(seedRaw.map((r) => r.url));
    } catch (err) {
      console.error(`WARNING descubrimiento de paginas familia fallo: ${err.message}`);
    }
  }

  // EL RECORRIDO ARRANCA POR LAS CATEGORIAS PRINCIPALES (ver src/prioridad.mjs).
  // Todo el armado -- juntar, deduplicar por URL, reordenar y recortar -- vive
  // en prepararRecorrido() y no aca, porque este archivo arranca main() al
  // importarse y nada de lo que este adentro lo puede cubrir una prueba.
  const {
    entries,
    paginasPrincipales,
    recorridasPrincipales,
    bloquePrincipalCompleto,
    porCategoria,
    ausentes,
    inversiones,
  } = prepararRecorrido({ seedRaw, familyEntries, limite: process.env.LIMITE_PAGINAS });

  console.log(`INFO paginas=${entries.length} (listado=${seedRaw.length}, familia=${familyEntries.length})`);
  // El tamano REAL del bloque y cuantas de esas alcanza a visitar esta corrida
  // son dos numeros distintos (con LIMITE_PAGINAS no coinciden). Imprimir uno
  // solo hacia que la linea se contradijera con su propio desglose por categoria.
  console.log(
    `INFO bloque_principal paginas=${paginasPrincipales} recorridas=${recorridasPrincipales} ${porCategoria
      .map((c) => `${c.categoria}=${c.listado}+${c.familia}`)
      .join(" ")}`,
  );

  const previo = await readJsonSafe(LATEST_PATH, {});
  const observado = {};
  let fallidas = [];
  // Paginas que Samsung redirigio a la ficha de OTRO producto. No son errores
  // (no se reintentan y no ensucian el indicador de corrida confiable), pero
  // tampoco son evidencia de que sus productos hayan desaparecido: se le pasan a
  // comparar() junto con las fallidas para que los SKU que colgaban de ellas
  // conserven su ultimo dato bueno en vez de acumular ausencias.
  const redirigidas = [];

  const webhook = process.env.DISCORD_WEBHOOK_URL;

  // FRENO DE LOS AVISOS TECNICOS QUE SE REPITEN SOLOS. Las condiciones de abajo
  // duran hasta que una persona edite el codigo, asi que sin freno salen 7 veces
  // por dia por el mismo canal donde llegan las momias. Una vez al dia por clave
  // (ver src/avisos-repetidos.mjs).
  const hoy = diaDe(timestamp);
  const huellasAviso = leerHuellas(await readFile(AVISOS_TECNICOS_PATH, "utf-8").catch(() => ""));
  const avisarUnaVezAlDia = async (clave, texto) => {
    if (yaSeAviso(huellasAviso, clave, hoy)) {
      console.log(`INFO aviso_tecnico_omitido ${clave} (ya salio hoy)`);
      return false;
    }
    await notifyTecnico(webhook, texto);
    huellasAviso.push({ clave, dia: hoy });
    // se guarda al tiro: si la corrida muere despues, el aviso no se repite
    await writeFile(AVISOS_TECNICOS_PATH, serializarHuellas(huellasAviso, hoy)).catch((err) =>
      console.error(`WARNING no se pudo guardar la huella del aviso tecnico: ${err.message}`),
    );
    return true;
  };

  // UNA CATEGORIA PRINCIPAL QUE YA NO ESTA EN EL LISTADO NO PUEDE PASAR CALLADA.
  // Nada se rompe (esas paginas se siguen recorriendo, y si la seccion de la URL
  // sigue viva incluso siguen entrando temprano), pero la promesa que se le hizo
  // al operador deja de cumplirse y hay que corregir el nombre en
  // src/prioridad.mjs. Sale al PRINCIPIO de la corrida, no al final: la revision
  // dura del orden de 2 h y el aviso no tiene por que esperarlas.
  if (ausentes.length > 0) {
    for (const a of ausentes) {
      console.error(`WARNING categoria principal "${a.categoria}" no aparece en el listado (paginas bajo /${a.seccion}/: ${a.paginasEnLaSeccion})`);
    }
    const detalle = ausentes
      .map((a) =>
        a.paginasEnLaSeccion > 0
          ? `• **${a.categoria}** — ya no existe con ese nombre, pero la sección /${a.seccion}/ sigue teniendo ${a.paginasEnLaSeccion} página(s): parece un cambio de nombre.`
          : `• **${a.categoria}** — no hay ninguna página en el listado ni en la sección /${a.seccion}/: la categoría desapareció del sitio.`,
      )
      .join("\n");
    await avisarUnaVezAlDia(
      `categorias-ausentes:${ausentes.map((a) => a.categoria).join(",")}`,
      `🧭 **Monitor Samsung — una categoría principal ya no está en el listado**\n${detalle}\nLa revisión sigue corriendo normal y no se pierde ninguna página; lo que se pierde es la garantía de revisarla primero.\nPara arreglarlo hay que corregir el nombre en la lista de categorías principales (src/prioridad.mjs).\nEste aviso sale una vez al día mientras la condición dure.`,
    );
  }

  // EL GUARDIAN DEL INVARIANTE DEL ORDEN (ver inversionesIntraSeccion en
  // src/prioridad.mjs). Que reordenar el recorrido no cambie el RESULTADO se
  // apoya en un hecho: el reordenamiento no invierte nunca dos paginas de la
  // misma seccion, y dos paginas que hablan del mismo producto viven siempre
  // bajo la misma seccion. Hoy son 0 inversiones sobre el recorrido real. Si
  // alguna vez deja de ser 0, el orden vuelve a poder decidir resultados y hay
  // que enterarse el mismo dia, no a los tres avisos raros.
  if (inversiones.length > 0) {
    for (const i of inversiones) {
      console.error(`WARNING el reordenamiento invierte dos paginas de la seccion /${i.seccion}/: ${i.antes} pasa a ir despues de ${i.ahora}`);
    }
    const muestra = inversiones.slice(0, 5).map((i) => `• /${i.seccion}/: ${i.antes}\n  pasa a ir después de ${i.ahora}`).join("\n");
    await avisarUnaVezAlDia(
      `inversiones-intra-seccion:${inversiones.length}`,
      `🔀 **Monitor Samsung — el orden del recorrido volvió a poder cambiar resultados**\nEl reordenamiento por categorías principales adelantó ${inversiones.length} par(es) de páginas de una MISMA sección del sitio, y eso es justo lo que no debía pasar: dos páginas que hablan del mismo producto viven bajo la misma sección.\n${muestra}\nLa causa típica es que una categoría principal pasó a tener páginas en la sección de otra (por ejemplo, una ficha catalogada como "Smartphones" que vive bajo /tablets/). Revisar la lista de src/prioridad.mjs.\nEste aviso sale una vez al día mientras la condición dure.`,
    );
  }

  // GUARDA CONTRA EL CATALOGO VACIO: si latest.json se corrompio o el checkout
  // vino sin el, previo={} y comparar() emite "nuevo" para CADA SKU (~650
  // notificables). Al final eso son ~93 mensajes agrupados, molesto pero
  // legible; en vivo serian ~650 avisos goteando durante 3 horas y el canal
  // queda inutilizable justo el dia de Cyber. Ademas los tres motivos de
  // "corrida no confiable" fallan con previo vacio (el guard prevRelevantes > 0
  // desactiva el unico que aplicaria), asi que nadie lo detecta.
  // NO se aborta la corrida: el scraping es lo mas valioso y el resumen final
  // agrupado sigue siendo perfectamente legible. Solo se apaga el vivo.
  const minPrevio = entorno("VIVO_MIN_PREVIO", 500);
  const previoChico = Object.keys(previo).length < minPrevio;
  const vivoActivo = process.env.VIVO !== "0" && !previoChico;
  if (previoChico) {
    console.error(`WARNING catalogo anterior con ${Object.keys(previo).length} registros (< ${minPrevio}): avisos en vivo apagados en esta corrida`);
    await notifyTecnico(
      webhook,
      `⚠️ **Monitor Samsung — catálogo anterior vacío o incompleto**\nSe encontraron ${Object.keys(previo).length} productos en el estado anterior (se esperaban al menos ${minPrevio}).\nLos avisos en vivo quedaron apagados en esta revisión para no inundar el canal: todo llegará agrupado al final.`,
    );
  }

  const despachador = crearDespachadorVivo({
    webhook,
    previo,
    timestamp,
    rutaNotificados: NOTIFICADOS_PATH,
    totalPaginas: entries.length,
    activo: vivoActivo,
  });
  const heredados = await despachador.cargarNotificados();
  if (heredados > 0) console.log(`INFO avisos heredados de una corrida anterior que no alcanzo a guardar: ${heredados}`);

  // `escritos` son los SKU que ESTA pagina escribio de verdad: la rama de
  // integrarVariantes que solo enriquece el titulo de un SKU ya capturado no
  // toca precio ni stock y queda fuera sola.
  const integrar = (entry, variants, via) => {
    const escritos = [];
    integrarVariantes(observado, entry, variants, { via, timestamp, escritos });
    return escritos;
  };

  const browser = await chromium.launch();
  const context = await browser.newContext({ userAgent: USER_AGENT });
  // Cuando se termino de recorrer el bloque de categorias principales. Se mide
  // en la PRIMERA pasada: el reintento del final vuelve sobre las paginas lentas
  // de toda la corrida, y meterlo aca convertiria "cuanto tarda el bloque
  // principal" en "cuanto tarda la corrida entera".
  let finPrincipales = null;
  try {
    let pagina = 0;
    for (const entry of entries) {
      pagina += 1;
      try {
        const { variants, via } = await procesarEntrada(entry, context, 30000);
        // AVISO EN VIVO: el unico momento en que existen a la vez previo[sku]
        // (intacto) y el registro recien fusionado es justo despues de integrar.
        despachador.evaluar(observado, integrar(entry, variants, via), { pagina });
        if (variants.length === 0) console.log(`INFO sin_precio ${entry.url}`);
      } catch (err) {
        if (err?.ajena) {
          console.log(`INFO redirigida ${entry.url} -> ${err.urlFinal} (producto de otra ficha: ${err.ajenos.join(", ") || "sin SKU"})`);
          redirigidas.push(entry);
        } else {
          console.error(`ERROR intento=1 ${entry.url}: ${err.message}`);
          fallidas.push(entry);
        }
      }
      // El envio va EN PARALELO con la pausa de la politica de scraping, que
      // igual hay que esperar: los avisos no le agregan tiempo a la corrida.
      await Promise.all([sleep(DELAY_MS), despachador.quizasEnviar()]);
      if (pagina === recorridasPrincipales) {
        finPrincipales = Date.now();
        console.log(
          `INFO bloque_principal_listo paginas=${recorridasPrincipales}${bloquePrincipalCompleto ? "" : ` (de ${paginasPrincipales}, recortado por LIMITE_PAGINAS)`} minutos=${Math.round((finPrincipales - inicio) / 60000)}`,
        );
      }
    }

    // reintento unico con mas timeout: recupera la mayoria de los 10-30
    // timeouts esporadicos por corrida que antes se daban por perdidos
    const fallidasFinal = [];
    for (const entry of fallidas) {
      try {
        const { variants, via } = await procesarEntrada(entry, context, 45000);
        despachador.evaluar(observado, integrar(entry, variants, via), { pagina: entries.length });
        console.log(`INFO reintento_ok ${entry.url}`);
      } catch (err) {
        if (err?.ajena) {
          console.log(`INFO redirigida ${entry.url} -> ${err.urlFinal} (producto de otra ficha: ${err.ajenos.join(", ") || "sin SKU"})`);
          redirigidas.push(entry);
        } else {
          console.error(`ERROR intento=2 ${entry.url}: ${err.message}`);
          fallidasFinal.push(entry);
        }
      }
      await Promise.all([sleep(DELAY_MS), despachador.quizasEnviar()]);
    }
    fallidas = fallidasFinal;
  } finally {
    await browser.close();
  }

  // Vaciado forzado ANTES de seguir: si main() resolviera con mensajes todavia
  // en la cola, Node saldria y esos avisos se perderian en silencio -- que es
  // exactamente el bug que este cambio viene a arreglar, reinventado.
  const statsVivo = await despachador.cerrar();
  console.log(`INFO vivo ${JSON.stringify(statsVivo)}`);

  // una corrida sospechosa NO puede declarar productos desaparecidos ni
  // gatillar avisos masivos: conserva el ultimo estado confiable
  const encontrados = Object.keys(observado).length;
  const prevRelevantes = Object.values(previo).filter((r) => r.presencia !== "desaparecido").length;
  const motivos = [];
  if (fallidas.length > Math.max(5, entries.length * 0.1)) {
    motivos.push(`demasiadas paginas con error (${fallidas.length} de ${entries.length})`);
  }
  if (prevRelevantes > 0 && encontrados < prevRelevantes * 0.8) {
    motivos.push(`se encontraron muchos menos productos que la vez anterior (${encontrados} vs ${prevRelevantes})`);
  }
  if (encontrados === 0) motivos.push("no se encontro ningun producto");
  const corridaConfiable = motivos.length === 0;

  // "paginas no verificadas" = las que fallaron + las que Samsung redirigio a la
  // ficha de otro producto. En ambos casos NO hay evidencia de que sus productos
  // hayan desaparecido, asi que comparar() conserva el ultimo dato bueno y no
  // cuenta ausencias. Esta es la red de seguridad de toda la regla de propiedad:
  // por muchas paginas que empiecen a redirigir, nunca se puede convertir en una
  // tanda de falsos "ya no aparece".
  const noVerificadas = new Set([...fallidas, ...redirigidas].map((f) => f.url));

  const { catalogo, cambios, correccionesDePrecio } = comparar({
    previo,
    observado,
    paginasFallidas: noVerificadas,
    corridaConfiable,
    timestamp,
  });

  // UN SKU QUE CAMBIO DE SECCION DEL SITIO. Es el unico sintoma observable, en
  // datos reales, de que dos paginas de secciones distintas se estan peleando el
  // mismo producto -- y esa pelea es la unica forma en que el orden del recorrido
  // podria decidir un resultado. Paso una sola vez en 348 corridas
  // (GP-TOS928SBEYW el 2026-07-25: su ficha de /mobile-accessories/ perdio
  // contra una de /tv-accessories/ y volvio sola a la corrida siguiente).
  // El desempate de src/identidad.mjs ya no deja que lo decida el orden, pero el
  // aviso queda igual: es lo que hay que ir a mirar.
  const cambiosDeSeccion = skusQueCambiaronDeSeccion(previo, catalogo);

  // PRODUCTOS MOMIFICADOS. Un SKU cuya pagina falla o que Samsung redirige
  // conserva su ultimo dato bueno y no acumula ausencias (eso esta bien: no hay
  // evidencia de que se haya ido), pero entonces puede quedar congelado para
  // siempre con su precio viejo presentado como vigente. Esto no cambia esa
  // regla: solo lo hace visible, una vez por SKU y por el canal tecnico.
  const momificados = marcarSinVerificarProlongado(catalogo);
  const sinVerificar = Object.values(catalogo).filter((r) => r.presencia === "error_verificacion").length;

  // MOMIAS DE PRECIO: el SKU aparecio, pero su pagina no escribio ningun monto y
  // se conservo el precio anterior (ver precioVisiblePreferido en extract.mjs).
  // Es la contracara del arreglo del vaiven y hay que vigilarla: si este numero
  // se dispara, la espera del render se quedo corta y hay precios congelados.
  const sinPrecioMomificados = marcarSinPrecioProlongado(catalogo);
  const sinPrecioVisible = Object.values(observado).filter((r) => !Number.isFinite(r.precio)).length;
  const precioCongelado = Object.values(catalogo).filter((r) => (r.corridasSinPrecio ?? 0) > 0).length;

  // CLAVES ORDENADAS. El orden de las claves de latest.json seguia el orden en
  // que se visitaban las paginas, asi que reordenar el recorrido lo reordenaba
  // entero y cada diff diario mezclaba cambios reales con movimientos de lineas.
  // Ordenar por SKU no cambia ningun dato (un objeto JSON no tiene orden) y hace
  // que el diff muestre solo lo que de verdad cambio, para siempre.
  const catalogoOrdenado = Object.fromEntries(Object.entries(catalogo).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(LATEST_PATH, JSON.stringify(catalogoOrdenado, null, 1));

  // El estado quedo guardado: las huellas de lo avisado en vivo ya no sirven
  // para nada (previo ya incluye estos cambios, asi que comparar() no puede
  // volver a emitirlos) y dejarlas seria arriesgar que silencien un cambio
  // legitimo mas adelante. Solo se reescribe si tenia contenido, para no crear
  // un archivo vacio en las corridas que nunca avisaron nada.
  try {
    if ((await readFile(NOTIFICADOS_PATH, "utf-8")).length > 0) await writeFile(NOTIFICADOS_PATH, "");
  } catch {
    // no existe: no habia nada que limpiar
  }

  // history.jsonl registra EVENTOS de cambio (lineas con campo "tipo").
  // El snapshot completo de cada corrida ya queda en el historial git de
  // latest.json -- duplicarlo aqui hacia crecer el repo ~2.5MB/dia.
  if (cambios.length > 0) {
    await appendFile(HISTORY_PATH, cambios.map((c) => JSON.stringify({ ts: timestamp, ...c })).join("\n") + "\n");
  }

  const fin = new Date();
  const porTipo = (t) => cambios.filter((c) => c.tipo === t).length;
  const resumen = {
    inicio: timestamp,
    fin: fin.toISOString(),
    duracionMin: Math.round((fin - inicio) / 60000),
    paginas: entries.length,
    // La promesa "primero las categorias principales", medible: cuantas paginas
    // tenia ese bloque y cuanto tardo en quedar listo. `paginasPrincipales` es el
    // tamano REAL del bloque (no el recortado por LIMITE_PAGINAS) y
    // `duracionPrincipalesMin` es null cuando la corrida no alcanzo a
    // terminarlo: informar el tamano recortado hacia que una corrida que nunca
    // termino el bloque se leyera como si lo hubiera terminado.
    ...medicionPrincipales({
      paginas: paginasPrincipales,
      desde: inicio.getTime(),
      hasta: bloquePrincipalCompleto ? finPrincipales : null,
    }),
    // categorias principales que el listado ya no trae con ese nombre (ver
    // src/prioridad.mjs). Casi siempre vacio; si deja de estarlo, el orden del
    // recorrido ya no es el que el operador pidio.
    categoriasPrincipalesAusentes: ausentes.map((a) => a.categoria),
    // pares de paginas de la MISMA seccion que el reordenamiento invierte: tiene
    // que ser 0 siempre (ver inversionesIntraSeccion en src/prioridad.mjs)
    inversionesIntraSeccion: inversiones.length,
    // SKU que pasaron a estar firmados por una pagina de otra seccion del sitio
    skusQueCambiaronDeSeccion: cambiosDeSeccion.length,
    errores: fallidas.length,
    // MUESTRAS ESTABLES (ver src/muestras.mjs): cuales 20 se muestran no puede
    // depender de por donde empezo el recorrido. La lista que se REINTENTA sigue
    // en orden de recorrido, que es la prioridad que pidio el operador.
    urlsConError: muestraDeUrls(fallidas, 20),
    // fichas que Samsung redirigio a la de otro producto: no son errores, pero
    // conviene verlas en el resumen (si el numero se dispara, Samsung cambio algo)
    redirigidas: redirigidas.length,
    urlsRedirigidas: muestraDeUrls(redirigidas, 20),
    // SKU que esta corrida no se pudo verificar (su pagina fallo o redirigio):
    // conservan su ultimo dato bueno y no cuentan ausencias, pero si el numero
    // crece corrida tras corrida hay productos congelados en el catalogo
    sinVerificar,
    sinVerificarProlongado: momificados.length,
    // SKU observados cuya pagina no escribio ningun monto en esta corrida (y que
    // por eso conservan su precio anterior), y cuantos llevan al menos una
    // corrida asi. Sin estos dos numeros, el arreglo del vaiven podria estar
    // congelando precios en silencio y nadie lo sabria.
    sinPrecioVisible,
    precioCongelado,
    sinPrecioProlongado: sinPrecioMomificados.length,
    // SKU cuyo precio guardado se corrigio en silencio porque lo que habia
    // guardado era el tachado o el numero interno (migracion versionPrecio).
    // Tiene que caer a 0 en pocas corridas: si no cae, la migracion esta
    // tapando cambios de precio de verdad.
    correccionesDePrecio: correccionesDePrecio.length,
    productosEncontrados: encontrados,
    nuevos: porTipo("nuevo"),
    bajas: porTipo("baja"),
    subes: porTipo("sube"),
    cambiosStock: porTipo("stock"),
    desaparecidos: porTipo("desaparecido"),
    recuperados: porTipo("recuperado"),
    avisadosEnVivo: statsVivo.avisados,
    mensajesEnVivo: statsVivo.mensajes,
    vivoApagadoPor: statsVivo.apagadoPor,
    confiable: corridaConfiable,
    motivos,
  };

  // El filtro de notificacion va DESPUES de escribir catalogo e historial: los
  // productos filtrados siguen vigilados y con su historial de precios completo,
  // solo se omite el mensaje de Discord (ver silenciados.mjs).
  const silenciados = resumirSilenciados(cambios);
  for (const [regla, n] of silenciados) console.log(`INFO silenciados regla=${regla} avisos=${n}`);
  // Se descarta lo que YA salio en vivo con un 2xx confirmado de Discord. Todo
  // lo demas vuelve a salir aca: los "desaparecido" (que solo se pueden decidir
  // al final), lo que el camino en vivo no alcanzo a confirmar, y las
  // correcciones de un SKU que se re-emitio con otro precio en la misma corrida.
  // `suprimidos` es el conteo honesto de lo omitido (incluye las huellas
  // heredadas de una corrida muerta, que statsVivo.avisados no cuenta).
  const { paraDiscord: cambiosParaDiscord, suprimidos } = repartirCierre(cambios, despachador);

  // AUDITORIA DE LO AVISADO EN VIVO. comparar() es la autoridad del estado, asi
  // que tambien es la autoridad sobre si un aviso en vivo era cierto: un aviso
  // que salio con la vista parcial de una pagina y que la revision completa no
  // ratifico es una alerta FALSA que nadie corregia, y que ademas se repetia en
  // todas las corridas siguientes porque el catalogo nunca se enteraba.
  const noRatificados = despachador.avisosNoRatificados(cambios);
  const correcciones = noRatificados.map((aviso) => ({ aviso, actual: catalogo[aviso.modelo] }));
  if (correcciones.length > 0) {
    console.error(`WARNING ${correcciones.length} avisos en vivo no los ratifico la revision completa: se corrigen en el cierre (${noRatificados.map((c) => `${c.tipo}:${c.modelo}`).join(", ")})`);
  }

  // Avisos que la corrida ANTERIOR detecto y que Discord nunca acepto.
  const pendientes = leerPendientes(await readFile(PENDIENTES_PATH, "utf-8").catch(() => ""));
  if (pendientes.length > 0) console.log(`INFO avisos atrasados de una corrida anterior que Discord no acepto: ${pendientes.length}`);

  resumen.suprimidosPorVivo = suprimidos;
  resumen.correccionesEnVivo = correcciones.length;
  resumen.avisosAtrasados = pendientes.length;
  await appendFile(EJECUCIONES_PATH, JSON.stringify(resumen) + "\n");
  console.log(`INFO resumen ${JSON.stringify(resumen)}`);

  if (momificados.length > 0) {
    const lista = masCorridas(momificados, 15).map((m) => `• ${m.modelo} (${m.corridas} revisiones)`).join("\n");
    const resto = momificados.length > 15 ? `\n…y ${momificados.length - 15} más.` : "";
    await notifyTecnico(
      webhook,
      `🕸️ **Monitor Samsung — productos que no se pueden verificar hace rato**\n${momificados.length} producto(s) llevan ${UMBRAL_SIN_VERIFICAR}+ revisiones seguidas sin poder comprobarse: su página falla o Samsung la redirige a la ficha de otro producto.\nNo se marcan como desaparecidos a propósito (no hay evidencia de que lo estén), pero su precio y su stock en el catálogo son los de la última vez que sí se vieron.\n${lista}${resto}\nEste aviso sale una sola vez por producto.`,
    );
  }

  if (sinPrecioMomificados.length > 0) {
    const lista = masCorridas(sinPrecioMomificados, 15).map((m) => `• ${m.modelo} (${m.corridas} revisiones, último precio $${(m.precio ?? 0).toLocaleString("es-CL")})`).join("\n");
    const resto = sinPrecioMomificados.length > 15 ? `\n…y ${sinPrecioMomificados.length - 15} más.` : "";
    await notifyTecnico(
      webhook,
      `💤 **Monitor Samsung — productos que hace rato no muestran precio**\n${sinPrecioMomificados.length} producto(s) llevan ${UMBRAL_SIN_VERIFICAR}+ revisiones seguidas en que su página no escribió ningún precio.\nSe conservó a propósito el último precio conocido (más vale callarse que inventar), pero ese precio ya no está comprobado.\n${lista}${resto}\nEste aviso sale una sola vez por producto.`,
    );
  }

  // CORRECCIONES DE LA FUENTE DEL PRECIO (migracion versionPrecio 2 -> 3).
  // El precio guardado era el TACHADO o el numero INTERNO de digitalData, no lo
  // que se cobra, asi que corregirlo no es un cambio del sitio y no puede salir
  // como aviso de precio, pero tampoco se calla: va por el canal tecnico. El
  // por que esta entero en mensajeCorreccionesDePrecio (src/discord.mjs).
  if (correccionesDePrecio.length > 0) {
    await notifyTecnico(webhook, mensajeCorreccionesDePrecio(correccionesDePrecio));
  }

  // DOS SECCIONES PELEANDOSE UN PRODUCTO (ver arriba). Una vez al dia por SKU:
  // mientras la pelea dure, el registro va a cambiar de mano en cada corrida y
  // sin freno serian 7 avisos diarios del mismo producto.
  for (const c of cambiosDeSeccion.slice(0, 5)) {
    console.error(`WARNING ${c.modelo} cambio de seccion: /${c.antes}/ -> /${c.ahora}/ (${c.paginaAhora})`);
    await avisarUnaVezAlDia(
      `seccion-cambiada:${c.modelo}`,
      `🧩 **Monitor Samsung — un producto cambió de sección del sitio**\n**${c.modelo}** estaba colgado de una página de **/${c.antes}/** y ahora lo firma una de **/${c.ahora}/**:\n${c.paginaAhora}\nNo es un error por sí solo (Samsung mueve fichas), pero es la señal de que dos páginas distintas publican el mismo producto. Su precio y su categoría pueden venir de la página equivocada.\nEste aviso sale una vez al día por producto.`,
    );
  }
  if (cambiosDeSeccion.length > 5) {
    console.error(`WARNING ${cambiosDeSeccion.length - 5} SKU mas cambiaron de seccion (no se avisan uno por uno)`);
  }

  if (!corridaConfiable) {
    await notifyTecnico(
      webhook,
      `⚠️ **Monitor Samsung — revisión marcada como NO confiable**\n${motivos.join("; ")}.\nNo se marcaron productos como desaparecidos y se conservó el último estado confiable. Revisar los logs de la corrida en GitHub Actions.\nLos avisos que llegaron durante la revisión siguen siendo válidos: salen de observaciones reales de la página y no dependen de esto. Lo único que se suspendió es la detección de productos desaparecidos.`,
    );
  }
  const envio = await notifyDiscord(webhook, {
    changes: cambiosParaDiscord,
    errores: fallidas.length,
    totalRevisado: entries.length,
    avisadosEnVivo: suprimidos,
    correcciones,
    pendientes,
  });

  // Lo que Discord no acepto queda anotado para la corrida siguiente; si se
  // entrego todo, el archivo se vacia. Se escribe SIEMPRE (aunque quede vacio)
  // porque los pendientes que si llegaron tienen que dejar de estar ahi.
  const noEntregados = envio?.noEntregados ?? [];
  try {
    await writeFile(PENDIENTES_PATH, serializarPendientes(noEntregados, timestamp));
    if (noEntregados.length > 0) {
      console.error(`WARNING ${noEntregados.length} avisos no llegaron a Discord: quedan anotados en pendientes.jsonl para la proxima revision`);
    }
  } catch (err) {
    console.error(`WARNING no se pudo escribir el registro de pendientes: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
