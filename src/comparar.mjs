// Logica pura de comparacion entre el catalogo de la corrida anterior y lo
// observado en la corrida actual. Sin I/O ni dependencias externas: todo lo
// que decide "que cambio y que se notifica" vive aca y es testeable.
//
// Cada registro del catalogo lleva, ademas de los datos del producto:
//  - presencia: "activo" | "ausente" | "desaparecido" | "error_verificacion"
//  - estadoStock: "disponible" | "agotado" | "no-a-la-venta" | "desconocido"
//    (ultimo estado CONFIRMADO; ver la maquina de estados en src/stock.mjs)
//  - stockPendiente: estado observado 1 sola vez, a la espera de confirmacion
//  - versionStock: version del detector que produjo el estadoStock guardado
//  - rango: de que tipo de pagina salio el registro (ver src/identidad.mjs)
//  - ausencias: corridas confiables consecutivas en que NO se encontro
//  - notificadoDesaparecido: true si ya se aviso por Discord que desaparecio
//  - ultimaVezVisto: timestamp de la ultima corrida en que SI aparecio
//
// Reglas anti-falsas-alertas (auditoria 2026-07-24, ver BITACORA.md):
//  - "desaparecido" requiere >= UMBRAL_AUSENCIAS corridas confiables seguidas
//    sin encontrarlo, y nunca cuenta una ausencia si su pagina fallo o la
//    corrida completa es sospechosa (antes: 1 sola ausencia bastaba, y los
//    timeouts diarios generaron ~150 avisos falsos en 4 dias).
//  - un cambio de stock solo se notifica tras verse igual 2 corridas seguidas
//    (el detector de stock lee texto de la pagina y puede parpadear).
//  - un producto que reaparece tras ausencia corta NO se re-anuncia como nuevo.
//  - un stock "desconocido" NUNCA cambia el estado ni notifica: no es
//    "disponible", es "no se sabe" (ver src/stock.mjs).
import { normalizar } from "./titulo.mjs";
import { ESTADO, disponibleDe, estadoObservado } from "./stock.mjs";

export const UMBRAL_AUSENCIAS = 2;

/**
 * Estado observado, o null cuando no se sabe. Acepta el campo nuevo
 * `estadoStock` (4 estados) y el viejo booleano `disponible`, para que un
 * catalogo escrito por la version anterior se siga leyendo igual.
 */
function stockObservado(obs) {
  return estadoObservado(obs);
}

/**
 * RE-ESTABLECIMIENTO DE LINEA BASE DEL STOCK (migracion auto-desactivable).
 *
 * El detector de stock cambio el 2026-09-11: antes buscaba 4 palabras en el
 * texto de la pagina completa y dejaba "disponible" POR DEFECTO (894 de 928
 * productos activos figuraban disponibles); ahora lee el bloque de compra.
 * Medido sobre 42 productos, el estado real difiere del guardado en 16 casos y
 * los 16 van en el mismo sentido. Sin esta regla, la primera corrida corregida
 * dejaria cientos de "agotado" en stockPendiente y la SEGUNDA los notificaria
 * todos de golpe: el operador recibiria cientos de "se agoto" que no son
 * novedades, sino la correccion de un dato que siempre estuvo mal.
 *
 * La regla: cuando la observacion viene de un detector MAS NUEVO que el que
 * produjo el estado guardado, el estado nuevo se adopta en silencio (sin evento)
 * y se sella la version en el registro. Se auto-desactiva sola, por SKU: en la
 * corrida siguiente ese producto ya tiene la version al dia y vuelven a regir
 * las reglas normales, incluida la confirmacion en 2 corridas. No hay fecha de
 * corte ni variable de entorno que alguien tenga que acordarse de apagar.
 *
 * Solo se sella cuando hubo lectura util: si el estado observado es
 * "desconocido" el SKU queda sin migrar y se re-establece en la primera corrida
 * que si logre leerlo.
 *
 * QUE ESTADOS SE RE-ESTABLECEN Y CUALES NO (corregido 2026-09-11, defecto 9 de
 * la revision). La re-base existe porque el detector viejo dejaba "disponible"
 * POR DEFECTO: ese valor no es una medicion, es un relleno, y corregirlo no es
 * una novedad que avisar. Pero el "agotado" de la version vieja SI salia de una
 * deteccion POSITIVA de la regex, asi que es una linea base valida. Si tambien
 * se re-estableciera, un SKU que estaba agotado y vuelve a tener stock se
 * adoptaria EN SILENCIO y el operador se perderia el aviso mas valioso del
 * monitor ("volvió el stock").
 *
 * Eso ademas cierra la ventana: antes, un SKU que se leyera SIEMPRE como
 * "desconocido" nunca sellaba la version y quedaba con la adopcion silenciosa
 * armada indefinidamente (medido: SM-S741BLGPLTL, un smartphone notificable).
 * Ahora la re-base depende del estado GUARDADO, no de que alguna corrida logre
 * leerlo, asi que a lo sumo se aplica sobre un valor que era un relleno.
 *
 * Costo medido sobre el catalogo real: ~891 SKU se siguen corrigiendo en
 * silencio, ~34 conservan su linea base y ~19 avisos aparecen en la segunda
 * corrida -- todos sobre productos que la regla vieja marco agotados a proposito.
 */
/**
 * CORRECCION DEL PRECIO TACHADO (adopcion silenciosa, una sola vez por SKU).
 *
 * Desde el 2026-09-12 el precio sale del monto escrito en el bloque de compra
 * (ver precioDelBloqueCompra en src/extract.mjs). En las fichas donde
 * digitalData no publica el precio de venta, la regla anterior terminaba
 * eligiendo el precio TACHADO: medido sobre 37 productos, 2 guardaban el
 * tachado (SM-X520NLBECHO $839.990 en vez de $579.990 y SM-X400NZAHCHO $649.990
 * en vez de $479.990), o sea ~4% del catalogo -- del orden de 40 SKU.
 *
 * Sin esta regla, la primera corrida con el arreglo mandaria ~40 avisos de
 * "bajo 26-31%" marcados con fuego por productos que nunca bajaron: lo que
 * cambio es de donde se lee el numero, no el precio.
 *
 * ES DELIBERADAMENTE ESTRECHA: solo calla el aviso cuando el precio guardado es
 * EXACTAMENTE el tachado que la pagina muestra hoy (obs.precioTachado, que
 * extract.mjs solo escribe cuando las dos fuentes discrepan). Una baja de
 * verdad, en ese mismo SKU y en esa misma corrida, tiene otro numero y se avisa
 * igual. Se auto-desactiva por SKU al sellar versionPrecio.
 */
function corrigePrecioTachado(ant, obs) {
  if (!(Number(obs?.versionPrecio ?? 0) > Number(ant?.versionPrecio ?? 0))) return false;
  return Number.isFinite(obs?.precioTachado) && ant?.precio === obs.precioTachado;
}

function reestableceLineaBase(ant, obs) {
  if (!(Number(obs?.versionStock ?? 0) > Number(ant?.versionStock ?? 0))) return false;
  const guardado = ant?.estadoStock ?? estadoObservado(ant) ?? ESTADO.DESCONOCIDO;
  return guardado === ESTADO.DISPONIBLE || guardado === ESTADO.DESCONOCIDO;
}

// Datos que el mensaje de Discord necesita para armar el titulo legible del
// producto (ver src/titulo.mjs). Van juntos en una sola funcion para que ningun
// tipo de cambio se quede sin ellos y termine imprimiendo "undefined": los seis
// tipos de cambio se arman en seis lugares distintos de este archivo.
// NADA de esto participa en decidir que cambio: la identidad es el SKU.
//
// CADA cambio se escribe tambien como una linea de data/history.jsonl, que esta
// en git y en un repo publico, asi que se manda lo minimo que cambia un titulo:
//  - los campos vacios se omiten (componerTitulo trata igual null y ausente);
//  - "paginaOrigen" solo cuando difiere de "url": en 966 de 969 registros reales
//    son el mismo string y componerTitulo ya cae a url cuando falta;
//  - "subcategoria" no se manda: probado sobre los 969 registros, quitarla no
//    cambia NINGUN titulo (CATEGORIAS_CON_TAMANO ya calza con la categoria sola).
// Medido sobre los 971 eventos que genera el catalogo real: mandar los 5 campos
// siempre costaba +202 bytes por evento (x1,66 el archivo) y en un dia malo
// (4.483 eventos) eran ~900 KB en un solo commit; asi son +15 bytes (x1,05),
// y se verifico que los 971 titulos salen identicos con el payload liviano.
function paraTitulo(rec) {
  const datos = {};
  for (const campo of ["nombre", "variante", "nombreFamilia", "especificaciones"]) {
    const valor = rec?.[campo];
    if (valor !== null && valor !== undefined) datos[campo] = valor;
  }
  if (rec?.paginaOrigen && rec.paginaOrigen !== rec.url) datos.paginaOrigen = rec.paginaOrigen;
  return datos;
}

// Samsung expone dos nombres para el MISMO SKU segun por donde se lo vea: el del
// JSON-LD de la pagina familia trae la variante ("Galaxy Z Fold7 256 GB｜12 GB
// Azul Intenso") y el digitalData de la pagina individual no ("Galaxy Z Fold7").
// Si el nombre nuevo es el anterior recortado, se conserva el anterior: sin esto
// el mismo producto se anunciaba con color una corrida y sin color la siguiente,
// segun por que camino se lo vio (17 SKU medidos haciendolo de verdad).
// No toca la identidad: quien decide que es "el mismo producto" sigue siendo el SKU.
function nombreMasInformativo(nuevo, anterior) {
  if (!nuevo) return anterior ?? null;
  if (!anterior) return nuevo;
  const n = normalizar(nuevo);
  const a = normalizar(anterior);
  return n !== a && a.startsWith(`${n} `) ? anterior : nuevo;
}

/**
 * Que cambio para UN SOLO SKU, comparando su registro anterior con lo que se
 * acaba de observar. Es pura y NO mira ningun otro producto ni el resultado
 * global de la corrida: por eso el camino de avisos en vivo
 * (src/despachador-vivo.mjs) puede llamarla apenas se scrapea una pagina, y
 * comparar() la llama despues para armar el catalogo definitivo.
 *
 * Es deliberadamente UNA sola implementacion de "que cambio" para los dos
 * caminos: asi la huella de deduplicacion del envio final calza con la del
 * aviso en vivo por construccion y no por coincidencia, y las reglas finas
 * (stock confirmado en 2 corridas, "nuevo" por precio recien conocido,
 * "recuperado" que suprime ese "nuevo") no pueden divergir.
 *
 * Lo unico que NO se puede decidir aca es "desaparecido": necesita saber que el
 * SKU no aparecio en TODA la corrida y que la corrida fue confiable. Eso sigue
 * viviendo en el segundo bucle de comparar() y por eso solo se avisa al final.
 *
 * @returns {{rec: object, cambios: object[]}} rec es el registro para el catalogo.
 */
export function evaluarObservado({ modelo, ant, obs, timestamp }) {
  const cambios = [];
  const stockObs = stockObservado(obs);

  if (!ant) {
    const rec = {
      ...obs,
      presencia: "activo",
      // Un producto recien visto cuyo stock no se pudo leer queda en
      // "desconocido", NO en "disponible". Antes el default era "disponible" y
      // eso convertia cualquier lectura fallida en un "se agoto" dos corridas
      // despues. "desconocido" no notifica nada y se resuelve solo en la primera
      // corrida que si logre leer el bloque de compra.
      estadoStock: stockObs ?? ESTADO.DESCONOCIDO,
      versionStock: stockObs ? (obs.versionStock ?? null) : null,
      stockPendiente: null,
      ausencias: 0,
      notificadoDesaparecido: false,
      ultimaVezVisto: timestamp,
    };
    delete rec.precioTachado; // diagnostico de la lectura, no del producto
    // el booleano historico SIEMPRE se deriva del estado comprometido (ver la
    // nota en el otro punto donde se hace lo mismo)
    rec.disponible = disponibleDe(rec.estadoStock);
    cambios.push({ tipo: "nuevo", modelo, ...paraTitulo(obs), precio: obs.precio, categoria: obs.categoria, url: obs.url });
    return { rec, cambios };
  }

  // la categoria especifica del listado gana sobre la generica de una
  // pagina familia auto-descubierta (si no, se rompen iconos y filtros)
  const categoria =
    (obs.categoria || "").startsWith("Familia") && ant.categoria && !(ant.categoria || "").startsWith("Familia")
      ? ant.categoria
      : obs.categoria;

  // el spread de obs sobre ant pisa TODO lo que obs traiga, incluidos los
  // nulos: si esta corrida el SKU se observo desde una pagina familia (sin
  // fila en el listado) se perderia la variante y el titulo cambiaria de una
  // corrida a otra. 39 SKU estan expuestos a ese vaiven y 17 lo hicieron de
  // verdad, asi que los datos de presentacion se conservan si el nuevo es vacio
  // (y el nombre, ademas, cuando el nuevo es el mismo nombre pero recortado).
  const rec = {
    ...ant,
    ...obs,
    nombre: nombreMasInformativo(obs.nombre, ant.nombre),
    variante: obs.variante ?? ant.variante ?? null,
    nombreFamilia: obs.nombreFamilia ?? ant.nombreFamilia ?? null,
    especificaciones: obs.especificaciones ?? ant.especificaciones ?? null,
    categoria,
    presencia: "activo",
    ausencias: 0,
    notificadoDesaparecido: false,
    ultimaVezVisto: timestamp,
  };
  // el SKU se volvio a ver: se borra la cuenta de corridas sin verificar (y el
  // aviso tecnico queda rearmado por si vuelve a perderse mas adelante). Se
  // BORRAN en vez de ponerse en 0 para no agregarle dos campos a cada uno de los
  // ~1000 registros sanos de data/latest.json.
  delete rec.corridasSinVerificar;
  delete rec.avisadoSinVerificar;
  // dato de diagnostico de ESTA lectura, no del producto: no se guarda
  delete rec.precioTachado;

  let yaAnunciado = false;
  if (ant.notificadoDesaparecido) {
    cambios.push({ tipo: "recuperado", modelo, ...paraTitulo(rec), precio: rec.precio, categoria, url: rec.url });
    yaAnunciado = true;
  }

  // precios: sube/baja solo entre dos precios validos; si recien se conoce
  // el precio (antes corrupto o sin precio), se anuncia una unica vez
  const precioAnt = ant.precio;
  if (!Number.isFinite(precioAnt) && Number.isFinite(obs.precio)) {
    if (!yaAnunciado) {
      cambios.push({ tipo: "nuevo", modelo, ...paraTitulo(rec), precio: obs.precio, categoria, url: rec.url });
    }
  } else if (
    Number.isFinite(precioAnt) &&
    Number.isFinite(obs.precio) &&
    precioAnt !== obs.precio &&
    !corrigePrecioTachado(ant, obs)
  ) {
    cambios.push({
      tipo: obs.precio < precioAnt ? "baja" : "sube",
      modelo,
      ...paraTitulo(rec),
      precio: obs.precio,
      precioAnterior: precioAnt,
      categoria,
      url: rec.url,
    });
  }

  // stock con confirmacion: el estado comprometido solo cambia (y notifica)
  // cuando el nuevo estado se observa 2 corridas seguidas
  const comprometido = ant.estadoStock ?? stockObservado(ant) ?? ESTADO.DESCONOCIDO;
  rec.estadoStock = comprometido;
  rec.stockPendiente = null;
  // La version del detector se COMPROMETE solo cuando hubo lectura util (mas
  // abajo). Una corrida que no pudo leer el stock no puede dar por migrado un
  // SKU: si lo hiciera, la primera lectura buena saldria anunciada como cambio.
  rec.versionStock = ant.versionStock ?? null;

  if (stockObs) {
    // Dos situaciones en que el estado nuevo se adopta EN SILENCIO, sin evento:
    //  1. re-establecimiento de linea base: el estado guardado lo produjo un
    //     detector mas viejo, asi que la diferencia no es una novedad del sitio
    //     sino la correccion de un dato que siempre estuvo mal.
    //  2. el estado guardado es "desconocido": pasar de "no se sabe" a un estado
    //     real es aprender, no un cambio de stock que valga la pena avisar.
    if (reestableceLineaBase(ant, obs) || comprometido === ESTADO.DESCONOCIDO) {
      rec.estadoStock = stockObs;
      rec.versionStock = obs.versionStock ?? ant.versionStock ?? null;
    } else if (stockObs !== comprometido) {
      if (ant.stockPendiente === stockObs) {
        rec.estadoStock = stockObs;
        cambios.push({
          tipo: "stock",
          modelo,
          ...paraTitulo(rec),
          // Los 4 estados viajan en `estado`/`estadoAnterior`. Los booleanos se
          // mantienen porque history.jsonl ya tiene miles de lineas con ellos y
          // el orden de prioridad de Discord los usa.
          estado: stockObs,
          estadoAnterior: comprometido,
          disponible: stockObs === ESTADO.DISPONIBLE,
          disponibleAnterior: comprometido === ESTADO.DISPONIBLE,
          precio: rec.precio,
          categoria,
          url: rec.url,
        });
      } else {
        rec.stockPendiente = stockObs;
      }
    }
  }

  // EL BOOLEANO SE DERIVA DEL ESTADO, SIEMPRE (defectos 4 y 11 de la revision).
  // `{...ant, ...obs}` copia el `disponible` de la observacion, pero
  // `rec.estadoStock` se reescribe con el estado COMPROMETIDO: sin esta linea el
  // registro quedaba diciendo dos cosas distintas a la vez -- estadoStock
  // "agotado" con disponible true mientras un cambio espera confirmacion, o
  // "disponible" con disponible null cuando la lectura fue ilegible. Hoy nadie
  // decide con el booleano (todo el sistema lee estadoStock primero), pero
  // data/latest.json esta en un repo publico y es lo que mira el operador, y el
  // respaldo a `disponible` sigue vivo en src/stock.mjs.
  rec.disponible = disponibleDe(rec.estadoStock);

  return { rec, cambios };
}

export function comparar({ previo, observado, paginasFallidas, corridaConfiable, timestamp }) {
  const catalogo = {};
  const cambios = [];

  for (const [modelo, obs] of Object.entries(observado)) {
    const { rec, cambios: propios } = evaluarObservado({ modelo, ant: previo[modelo], obs, timestamp });
    catalogo[modelo] = rec;
    cambios.push(...propios);
  }

  for (const [modelo, ant] of Object.entries(previo)) {
    if (observado[modelo]) continue;

    const paginaFallo = ant.paginaOrigen && paginasFallidas.has(ant.paginaOrigen);
    if (paginaFallo || !corridaConfiable) {
      // no hay evidencia de que el producto haya desaparecido: su pagina no se
      // pudo verificar (o la corrida entera es sospechosa). Se conserva el
      // ultimo dato confiable sin incrementar ausencias ni avisar nada.
      catalogo[modelo] = {
        ...ant,
        presencia: ant.notificadoDesaparecido ? "desaparecido" : "error_verificacion",
      };
      // Cuantas corridas seguidas lleva ESTE SKU con su pagina sin poder
      // verificarse. La regla de ausencias NO se toca (esta bien: no hay
      // evidencia de que el producto se haya ido), pero sin este contador un SKU
      // podia quedar momificado para siempre -- con su ultimo precio y su ultimo
      // stock presentados como vigentes -- sin que nada lo reportara. Con el
      // detector nuevo deja de ser raro: 3 de 13 paginas del recorrido real
      // redirigian.
      //
      // Solo cuenta cuando fallo SU pagina: una corrida entera marcada como no
      // confiable no es evidencia contra ningun producto en particular, y
      // contarla le sumaria a los ~1000 registros de una sola vez. Y los que ya
      // se anunciaron como desaparecidos no se cuentan: de esos el operador ya
      // se entero.
      if (paginaFallo && !ant.notificadoDesaparecido) {
        catalogo[modelo].corridasSinVerificar = (ant.corridasSinVerificar ?? 0) + 1;
      }
      continue;
    }

    const ausencias = (ant.ausencias ?? 0) + 1;
    if (ausencias >= UMBRAL_AUSENCIAS && !ant.notificadoDesaparecido) {
      catalogo[modelo] = { ...ant, presencia: "desaparecido", ausencias, notificadoDesaparecido: true };
      cambios.push({ tipo: "desaparecido", modelo, ...paraTitulo(ant), precioAnterior: ant.precio, categoria: ant.categoria, url: ant.url });
    } else {
      catalogo[modelo] = {
        ...ant,
        presencia: ant.notificadoDesaparecido ? "desaparecido" : "ausente",
        ausencias,
      };
    }
  }

  return { catalogo, cambios };
}

/**
 * Cuantas corridas seguidas puede un SKU quedar sin verificarse antes de que
 * valga la pena decirlo. 20 son ~3 dias a 7 corridas diarias: lo bastante como
 * para descartar los timeouts esporadicos y las caidas de un dia.
 */
export const UMBRAL_SIN_VERIFICAR = 20;

/**
 * SKU que llevan demasiadas corridas seguidas sin poder verificarse (su pagina
 * falla o Samsung la redirige a la ficha de otro producto). NO son
 * "desaparecidos" -- no hay evidencia de eso y por eso no se cuentan ausencias
 * --, pero quedan congelados en el catalogo con su ultimo precio y su ultimo
 * stock como si estuvieran vigentes. Esto solo los hace VISIBLES: se avisa una
 * sola vez por SKU y por el canal tecnico, que no se mezcla con los avisos de
 * producto (defecto 12 de la revision).
 *
 * Muta `catalogo` marcando los que ya se avisaron, asi que se llama ANTES de
 * escribir latest.json.
 */
export function marcarSinVerificarProlongado(catalogo, umbral = UMBRAL_SIN_VERIFICAR) {
  const nuevos = [];
  for (const [modelo, rec] of Object.entries(catalogo ?? {})) {
    if (rec?.presencia !== "error_verificacion") continue;
    if ((rec.corridasSinVerificar ?? 0) < umbral) continue;
    if (rec.avisadoSinVerificar) continue;
    rec.avisadoSinVerificar = true;
    nuevos.push({ modelo, corridas: rec.corridasSinVerificar, url: rec.url ?? null, paginaOrigen: rec.paginaOrigen ?? null });
  }
  return nuevos;
}
