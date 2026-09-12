// Logica pura de comparacion entre el catalogo de la corrida anterior y lo
// observado en la corrida actual. Sin I/O ni dependencias externas: todo lo
// que decide "que cambio y que se notifica" vive aca y es testeable.
//
// Cada registro del catalogo lleva, ademas de los datos del producto:
//  - presencia: "activo" | "ausente" | "desaparecido" | "error_verificacion"
//  - estadoStock: "disponible" | "agotado" | "no-a-la-venta" | "desconocido"
//    (ultimo estado CONFIRMADO; ver la maquina de estados en src/stock.mjs)
//  - stockPendiente: estado observado 1 sola vez, a la espera de confirmacion
//  - precioPendiente: precio visto UNA vez desde otra pagina/rango que el que
//    escribio el precio guardado, a la espera de que una segunda corrida lo
//    repita (solo existe mientras dure la espera)
//  - corridasSinPrecio: corridas seguidas en que la pagina no escribio ningun
//    monto y por eso se conservo el precio anterior (solo mientras dure)
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
//  - una lectura SIN precio no cambia el precio ni notifica: desde el
//    2026-09-12 el precio tiene su propio "no se sabe" (el campo ausente), que
//    es lo que devuelve una pagina que no escribio ningun monto.
//  - un cambio de precio que ademas cambia de PAGINA o de RANGO no se avisa en
//    el acto: espera a que una segunda corrida lo repita. El 97% de los cambios
//    reales vienen de la misma pagina y salen al instante.
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
 * CORRECCION DE LA FUENTE DEL PRECIO (adopcion silenciosa, una sola vez por SKU).
 *
 * Desde el 2026-09-12 el precio sale del monto escrito en el bloque de compra
 * (ver precioDelBloqueCompra en src/extract.mjs) y, si la pagina no escribe
 * ningun monto, no sale ningun precio (ver precioVisiblePreferido). Las dos
 * reglas anteriores dejaban guardados numeros que NO son el precio de venta:
 *  - el TACHADO (list_price): medido sobre 37 productos, 2 lo guardaban
 *    (SM-X520NLBECHO $839.990 en vez de $579.990, SM-X400NZAHCHO $649.990 en vez
 *    de $479.990);
 *  - el INTERNO (model_price), que en las fichas con descuento no aparece
 *    escrito en ninguna parte: medido en las 5 fichas que mas avisos falsos
 *    generaron (479.990 en SM-X520NLBACHO, 199.990 en LS32DG300ELXZS...).
 *
 * Medido sobre data/history.jsonl y data/latest.json: 68 SKU con vaiven en 30
 * dias y 50 de ellos tienen HOY guardado uno de los dos valores que bailan. Sin
 * esta regla, la primera corrida con el arreglo mandaria del orden de 50-68
 * avisos de "subio/bajo 20-40%" marcados con fuego por productos que nunca
 * cambiaron de precio: lo que cambio es de donde se lee el numero.
 *
 * ES DELIBERADAMENTE ESTRECHA: solo calla el aviso cuando el precio guardado es
 * EXACTAMENTE uno de los dos numeros que la propia pagina publica hoy y que el
 * arreglo dejo de elegir (obs.precioTachado / obs.precioInterno, que extract.mjs
 * solo escribe cuando difieren del elegido). Una baja de verdad, en ese mismo
 * SKU y en esa misma corrida, tiene otro numero y se avisa igual. Se
 * auto-desactiva por SKU al sellar versionPrecio.
 */
function corrigeFuenteDePrecio(ant, obs) {
  if (!(Number(obs?.versionPrecio ?? 0) > Number(ant?.versionPrecio ?? 0))) return false;
  if (Number.isFinite(obs?.precioTachado) && ant?.precio === obs.precioTachado) return true;
  return Number.isFinite(obs?.precioInterno) && ant?.precio === obs.precioInterno;
}

/**
 * ¿ESTA OBSERVACION VIENE DE LA MISMA PAGINA QUE ESCRIBIO EL PRECIO GUARDADO?
 *
 * El vaiven tiene una segunda puerta, mas chica que la carrera de render pero
 * medida igual: el MISMO SKU se ve desde dos paginas distintas y cada una
 * publica otro numero. Pasa de dos formas:
 *  - rango distinto: el JSON-LD de una pagina familia publica el precio de LISTA
 *    (medido: 10 de 10 variantes de galaxy-tab-s10-fe/buy/ y galaxy-tab-s11/buy/
 *    coinciden exactamente con el "Precio original" tachado de cada ficha). Si la
 *    ficha propia falla una corrida, la familia escribe el tachado y a la
 *    siguiente vuelve.
 *  - mismo rango, otra pagina: 135 SKU se scrapean dos veces por corrida (su
 *    ficha plana del seed y su propia /buy/ descubierta por sitemap; 126 paginas
 *    /buy/ con ficha plana en el seed, medido sobre data/latest.json). Las dos
 *    valen PROPIA, asi que el rango no arbitra nada y decide el orden de llegada.
 *
 * La precedencia por rango de integrarVariantes (src/catalogo.mjs) solo arbitra
 * DENTRO de una corrida; entre corridas no existia nada.
 *
 * LA FUENTE DEL PRECIO SE GUARDA APARTE (2026-09-12, defecto medido). Antes
 * esta funcion comparaba el `rango`/`paginaOrigen` del REGISTRO, y el registro
 * se arma con `{...ant, ...obs}`: sus dos campos son los de la observacion de
 * HOY aunque el precio venga conservado de ayer. O sea que cuando una ficha
 * propia caia una corrida si y otra no, el registro decia "el precio es de la
 * pagina que lo vio hoy" y a la corrida siguiente todo volvia a ser "otra
 * fuente": el pendiente se pisaba cada vez, nunca se corroboraba y el precio
 * quedaba congelado indefinidamente (medido: 0 avisos en 21 corridas mientras
 * Samsung bajaba de verdad de $656.990 a $599.990).
 *
 * `fuentePrecio` describe de donde salio EL PRECIO que quedo guardado. Solo se
 * escribe cuando NO coincide con el origen del propio registro, asi que los
 * ~1000 registros normales de data/latest.json no engordan ni un byte.
 */
function rangoDe(rec) {
  const r = Number(rec?.rango);
  return Number.isFinite(r) && r > 0 ? r : null;
}

function paginaDe(rec) {
  return rec?.paginaOrigen ?? rec?.url ?? null;
}

/** De donde salio el precio GUARDADO (por defecto, del propio registro). */
function fuenteDelPrecio(ant) {
  if (ant?.fuentePrecio) return { rango: rangoDe(ant.fuentePrecio), pagina: ant.fuentePrecio.pagina ?? null };
  return { rango: rangoDe(ant), pagina: paginaDe(ant) };
}

/** De donde sale ESTA lectura. */
function fuenteDeLaLectura(obs) {
  return { rango: rangoDe(obs), pagina: paginaDe(obs) };
}

function mismaFuente(a, b) {
  if (a.rango !== null && b.rango !== null && a.rango !== b.rango) return false;
  if (a.pagina && b.pagina && a.pagina !== b.pagina) return false;
  return true;
}

/**
 * Cuantas corridas seguidas puede una pagina de MENOS rango (o una pagina
 * distinta que nunca se corrobora) publicar otro precio antes de que se adopte
 * igual, con aviso. Es el tope que le falta a la regla "un rango menor no toca
 * el precio": sin el, un SKU cuya ficha propia muera quedaria con su ultimo
 * precio para siempre. 3 corridas son ~9 h a 7 corridas diarias.
 */
export const UMBRAL_PRECIO_OTRA_FUENTE = 3;

function reestableceLineaBase(ant, obs) {
  if (!(Number(obs?.versionStock ?? 0) > Number(ant?.versionStock ?? 0))) return false;
  const guardado = ant?.estadoStock ?? estadoObservado(ant) ?? ESTADO.DESCONOCIDO;
  return guardado === ESTADO.DISPONIBLE || guardado === ESTADO.DESCONOCIDO;
}

/**
 * Los rastros que extract.mjs adjunta a UNA LECTURA para que este modulo pueda
 * distinguir una correccion de fuente de un cambio de precio real. Describen la
 * lectura, no el producto, asi que jamas se guardan en data/latest.json (que
 * esta en un repo publico y es lo que mira el operador).
 */
/**
 * UN PRECIO QUE HACE RATO NO SE PUEDE COMPROBAR VIAJA MARCADO. El aviso de
 * stock y el de "volvio al sitio" imprimen el ultimo precio conocido; si ese
 * numero lleva corridas sin poder leerse, decirlo a secas es presentarlo como
 * vigente. Solo se manda cuando hay algo que declarar, para no agregarle un
 * campo a cada linea de data/history.jsonl.
 */
function sinComprobar(rec) {
  return rec?.corridasSinPrecio ? { corridasSinPrecio: rec.corridasSinPrecio } : {};
}

function borrarDiagnosticoDePrecio(rec) {
  delete rec.precioTachado;
  delete rec.precioInterno;
  delete rec.precioIlegible;
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
  // Correcciones de la FUENTE del precio: no son cambios del sitio, asi que no
  // viajan con `cambios` (que va a los avisos de producto de Discord) sino por
  // el canal tecnico del cierre. Ver corrigeFuenteDePrecio.
  const correcciones = [];
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
    borrarDiagnosticoDePrecio(rec); // diagnostico de la lectura, no del producto
    // el booleano historico SIEMPRE se deriva del estado comprometido (ver la
    // nota en el otro punto donde se hace lo mismo)
    rec.disponible = disponibleDe(rec.estadoStock);
    // La version de la fuente del precio tampoco se compromete sin lectura util
    // (ver la nota larga mas abajo, donde se hace lo mismo con un `ant` vivo).
    if (!Number.isFinite(obs.precio) && rec.versionPrecio !== undefined) delete rec.versionPrecio;
    if (Number.isFinite(obs.precio)) {
      cambios.push({ tipo: "nuevo", modelo, ...paraTitulo(obs), precio: obs.precio, categoria: obs.categoria, url: obs.url });
    } else {
      // Un SKU nuevo SIN precio legible tampoco desaparece del radar (defecto
      // medido: antes no se anunciaba nunca, y como corridasSinPrecio solo
      // contaba cuando YA habia un precio guardado, el aviso tecnico de las 20
      // revisiones tampoco lo alcanzaba: un lanzamiento real quedaba invisible
      // por tiempo indefinido).
      //
      // Se anuncia solo si esta A LA VENTA, que es la misma linea que traza
      // marcarSinPrecioProlongado: de los ~1000 registros activos, 426 no estan
      // "disponible" y muchos (accesorios, kits, productos descontinuados)
      // simplemente no publican precio. Anunciarlos a todos seria ruido.
      rec.corridasSinPrecio = 1;
      if (rec.estadoStock === ESTADO.DISPONIBLE) {
        rec.nuevoSinPrecio = true;
        cambios.push({ tipo: "nuevo", modelo, ...paraTitulo(obs), precio: null, categoria: obs.categoria, url: obs.url });
      }
    }
    return { rec, cambios, correcciones };
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
    // UNA LECTURA QUE NO PUDO LEER EL PRECIO NO CAMBIA NADA. Es la regla de oro
    // del proyecto aplicada al precio, y el espejo de lo que ya se hace con el
    // stock ("desconocido" nunca pisa un estado confirmado). Esta escrito
    // explicito, y no solo confiado a que extract.mjs omita el campo, porque un
    // `precio: null` que se colara pisaria el precio bueno y la corrida
    // siguiente anunciaria "nuevo" (medido reproduciendo el flujo real).
    precio: obs.precio ?? ant.precio,
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
  // datos de diagnostico de ESTA lectura, no del producto: no se guardan
  borrarDiagnosticoDePrecio(rec);

  // CUANTAS CORRIDAS SEGUIDAS LLEVA ESTE SKU SIN PRECIO LEGIBLE. Conservar el
  // ultimo precio bueno es lo correcto, pero sin este contador un producto podia
  // quedar con un precio viejo presentado como vigente y nadie enterarse
  // (momia de precio). Se borra en cuanto vuelve a leerse, para no agregarle un
  // campo a los ~1000 registros sanos de data/latest.json.
  //
  // CUENTA TAMBIEN CUANDO NUNCA HUBO PRECIO (defecto medido): la condicion
  // anterior exigia `Number.isFinite(ant.precio)`, asi que un producto que
  // NUNCA logro publicar un precio no llegaba jamas al aviso tecnico.
  delete rec.corridasSinPrecio;
  if (!Number.isFinite(obs.precio)) {
    rec.corridasSinPrecio = (ant.corridasSinPrecio ?? 0) + 1;
    rec.avisadoSinPrecio = ant.avisadoSinPrecio ?? false;
  } else {
    delete rec.avisadoSinPrecio;
  }

  // LA VERSION DE LA FUENTE DEL PRECIO SE COMPROMETE SOLO CON LECTURA UTIL,
  // igual que versionStock doce lineas mas abajo (2026-09-12, defecto medido por
  // dos verificadores; es el MISMO bug que ya se habia arreglado para el stock y
  // que se paso por alto aca).
  //
  // `rec.versionPrecio` sale de `{...ant, ...obs}` y extract.mjs estampa la
  // version en TODA lectura, incluida la que no pudo leer el precio. Bastaba con
  // que una ficha no alcanzara a pintar UNA vez para que la ventana de migracion
  // quedara cerrada para siempre en ese SKU y la primera lectura buena saliera
  // anunciada como "subio/bajo 20-40%" -- exactamente el aviso falso que la
  // migracion existe para evitar, y justo sobre las paginas de render flojo, que
  // son las que el arreglo viene a atender. Medido sobre una copia del catalogo
  // real: una corrida sin precios sellaba 1031/1031 registros sin haber leido un
  // solo precio, y la siguiente emitia 50 avisos falsos (0 en el control).
  if (!Number.isFinite(obs.precio)) {
    if (ant.versionPrecio === undefined) delete rec.versionPrecio;
    else rec.versionPrecio = ant.versionPrecio;
  }

  let yaAnunciado = false;
  if (ant.notificadoDesaparecido) {
    cambios.push({ tipo: "recuperado", modelo, ...paraTitulo(rec), precio: rec.precio, categoria, url: rec.url, ...sinComprobar(rec) });
    yaAnunciado = true;
  }

  // precios: sube/baja solo entre dos precios validos; si recien se conoce
  // el precio (antes corrupto o sin precio), se anuncia una unica vez
  const precioAnt = ant.precio;
  const fuenteAnt = fuenteDelPrecio(ant);
  const fuenteObs = fuenteDeLaLectura(obs);
  // De donde sale el precio que quedara en el registro. Arranca en "el de
  // siempre" y solo cambia cuando de verdad se adopta el precio observado.
  let fuentePrecio = fuenteAnt;
  delete rec.precioPendiente;
  delete rec.precioPendienteDe;
  // UNA LECTURA QUE CONFIRMA EL PRECIO GUARDADO SE LO APROPIA. Es la contracara
  // de todo lo de abajo: si esta pagina publica el mismo numero, es tan duena
  // del precio como la que lo escribio, y el campo `fuentePrecio` desaparece.
  // Sin esto, un registro cuyo `rango` o `paginaOrigen` cambio por motivos
  // ajenos al precio arrastraba el campo para siempre (medido sobre el catalogo
  // real: 16 registros lo llevaban en una corrida en que nadie cambio de precio).
  // Una pagina de MENOS rango no se apropia de nada: confirmar no la asciende.
  //
  // Y la cuenta de corridas con otro precio solo se reinicia aca. Una corrida
  // que no pudo leer no borra nada: si lo hiciera, una ficha propia muerta que
  // alterna con corridas ilegibles dejaria el precio congelado para siempre.
  if (Number.isFinite(obs.precio) && obs.precio === precioAnt) {
    delete rec.corridasPrecioDistinto;
    const menorConfirma = fuenteAnt.rango !== null && fuenteObs.rango !== null && fuenteObs.rango < fuenteAnt.rango;
    if (!menorConfirma) fuentePrecio = fuenteObs;
  }

  if (!Number.isFinite(precioAnt) && Number.isFinite(obs.precio)) {
    fuentePrecio = fuenteObs;
    delete rec.corridasPrecioDistinto;
    if (!yaAnunciado) {
      // Si ya se habia anunciado SIN precio, este aviso no es "primera vez
      // visto": es "ya publicaron cuanto vale".
      const yaEstaba = ant.nuevoSinPrecio === true;
      cambios.push({ tipo: "nuevo", modelo, ...paraTitulo(rec), precio: obs.precio, categoria, url: rec.url, ...(yaEstaba ? { yaAnunciadoSinPrecio: true } : {}) });
    }
    delete rec.nuevoSinPrecio;
  } else if (Number.isFinite(precioAnt) && Number.isFinite(obs.precio) && precioAnt !== obs.precio) {
    // UNA PAGINA QUE VALE MENOS NO LE PISA EL PRECIO A UNA QUE VALE MAS. Es la
    // precedencia por rango de integrarVariantes (src/catalogo.mjs), que hasta
    // hoy solo arbitraba DENTRO de una corrida. Medido sobre el historial real:
    // el JSON-LD de una pagina familia publica el precio de LISTA (10 de 10
    // variantes de galaxy-tab-s10-fe/buy/ coinciden con el "Precio original"
    // tachado de cada ficha), asi que cuando la ficha propia falla una corrida
    // la familia escribia el tachado, se corroboraba a la segunda y salian DOS
    // avisos falsos: el "sube" al adoptarlo y el "baja" al volver la ficha.
    const rangoMenor = fuenteAnt.rango !== null && fuenteObs.rango !== null && fuenteObs.rango < fuenteAnt.rango;
    // La corroboracion exige ademas que quien repite el valor sea la MISMA
    // pagina que lo propuso: si no, dos paginas distintas que publican el mismo
    // numero equivocado se confirmaban entre si.
    const corroborado =
      ant.precioPendiente === obs.precio &&
      (!ant.precioPendienteDe || !fuenteObs.pagina || ant.precioPendienteDe === fuenteObs.pagina);
    const corridasDistinto = (ant.corridasPrecioDistinto ?? 0) + 1;

    // La correccion de la migracion NO pasa por la guarda de rango, y no hace
    // falta: `versionPrecio`, `precioTachado` y `precioInterno` los escribe solo
    // extractSingleProduct, o sea la ficha propia (rango PROPIA). El JSON-LD de
    // una pagina familia no trae ninguno de los tres, asi que una fuente de menos
    // rango nunca puede disparar esta rama.
    if (corrigeFuenteDePrecio(ant, obs)) {
      // El numero guardado era el tachado o el interno: se adopta el bueno sin
      // aviso de PRECIO... pero no en silencio total. No hay forma de
      // distinguir, desde una sola lectura, "el guardado estaba mal" de "este
      // producto acaba de estrenar oferta y su precio de ayer es el tachado de
      // hoy" (defecto medido: una baja real del 18% se perdia entera, y sin
      // segunda oportunidad porque versionPrecio queda sellado). Asi que la
      // correccion se cuenta por el canal TECNICO, con los dos numeros, y el
      // operador puede mirar las que le interesen.
      fuentePrecio = fuenteObs;
      delete rec.corridasPrecioDistinto;
      correcciones.push({ modelo, ...paraTitulo(rec), precioAnterior: precioAnt, precio: obs.precio, categoria, url: rec.url });
    } else if (!rangoMenor && (mismaFuente(fuenteAnt, fuenteObs) || corroborado)) {
      // MISMA PAGINA Y MISMO RANGO: se avisa AL TIRO, como siempre. Una baja de
      // verdad de Samsung no cambia de donde se lee el numero, asi que esto es
      // el 97% de los cambios (medido: 385 de 397 cambios entre corridas
      // consecutivas vienen del mismo origen) y el Cyber no pierde ni un minuto.
      // La segunda condicion es la corroboracion: un cambio que venia de otra
      // fuente y que se repite desde la misma pagina ya no es un rebote.
      fuentePrecio = fuenteObs;
      delete rec.corridasPrecioDistinto;
      cambios.push({
        tipo: obs.precio < precioAnt ? "baja" : "sube",
        modelo,
        ...paraTitulo(rec),
        precio: obs.precio,
        precioAnterior: precioAnt,
        categoria,
        url: rec.url,
      });
    } else if (corridasDistinto >= UMBRAL_PRECIO_OTRA_FUENTE) {
      // SE ACABO LA ESPERA. Llevan UMBRAL corridas seguidas en que el precio
      // guardado no se confirma y lo unico que se ve es otro numero. La pagina
      // que escribio el precio guardado no volvio: aferrarse a el seria dejar un
      // precio viejo presentado como vigente para siempre. Se adopta y se avisa.
      fuentePrecio = fuenteObs;
      delete rec.corridasPrecioDistinto;
      cambios.push({
        tipo: obs.precio < precioAnt ? "baja" : "sube",
        modelo,
        ...paraTitulo(rec),
        precio: obs.precio,
        precioAnterior: precioAnt,
        categoria,
        url: rec.url,
        // para que el mensaje pueda decir que el numero viene de otra pagina
        desdeOtraFuente: true,
      });
    } else {
      // OTRA FUENTE: no se avisa y TAMPOCO se adopta todavia. Queda pendiente,
      // igual que un cambio de stock sin confirmar. Si la corrida siguiente lo
      // repite desde la misma pagina, se avisa y se adopta; si vuelve el valor
      // de siempre, el rebote muere aca sin gastar un aviso.
      rec.precio = precioAnt;
      rec.precioPendiente = obs.precio;
      if (fuenteObs.pagina) rec.precioPendienteDe = fuenteObs.pagina;
      rec.corridasPrecioDistinto = corridasDistinto;
    }
  }

  // DE DONDE SALIO EL PRECIO QUE QUEDA GUARDADO. Solo se anota cuando NO es el
  // origen del propio registro (`{...ant, ...obs}` ya dejo ahi el de la lectura
  // de hoy): asi el campo aparece unicamente en los pocos SKU cuyo precio viene
  // conservado de otra pagina, y los ~1000 registros normales de
  // data/latest.json no crecen ni un byte.
  const fuentePropia = fuenteDeLaLectura(rec);
  if (Number.isFinite(rec.precio) && (fuentePrecio.rango !== fuentePropia.rango || fuentePrecio.pagina !== fuentePropia.pagina)) {
    rec.fuentePrecio = { rango: fuentePrecio.rango, pagina: fuentePrecio.pagina };
  } else {
    delete rec.fuentePrecio;
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
          ...sinComprobar(rec),
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

  return { rec, cambios, correcciones };
}

export function comparar({ previo, observado, paginasFallidas, corridaConfiable, timestamp }) {
  const catalogo = {};
  const cambios = [];
  const correccionesDePrecio = [];

  for (const [modelo, obs] of Object.entries(observado)) {
    const { rec, cambios: propios, correcciones } = evaluarObservado({ modelo, ant: previo[modelo], obs, timestamp });
    catalogo[modelo] = rec;
    cambios.push(...propios);
    correccionesDePrecio.push(...(correcciones ?? []));
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

  return { catalogo, cambios, correccionesDePrecio };
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

/**
 * MOMIAS DE PRECIO. El SKU SI aparece en la corrida (su pagina responde y su
 * stock se lee), pero la pagina no escribe ningun monto y por eso conserva el
 * ultimo precio bueno. Eso es lo correcto -- mas vale callarse que inventar --,
 * pero un producto que lleva dias asi tiene en el catalogo un precio viejo
 * presentado como vigente, y sin esto nadie se enteraria: marcarSinVerificarProlongado
 * no lo ve, porque su presencia es "activo".
 *
 * Mismo contrato que su hermana: avisa UNA sola vez por SKU, por el canal
 * tecnico, y muta el catalogo para recordarlo.
 *
 * SOLO SE AVISA DE LOS QUE ESTAN A LA VENTA. Medido en vivo el 2026-09-12 sobre
 * la ficha del control remoto AR-KH00E: su bloque de compra dice "no está a la
 * venta" y la pagina NO escribe ningun monto (digitalData publica 47.020 como
 * model_price y como list_price, y ese numero no aparece por ninguna parte).
 * Eso no es una falla del monitor: es un producto que Samsung dejo de vender y
 * cuyo precio no publica. Son 426 de los 933 registros activos los que no estan
 * "disponible" (113 explicitamente "no a la venta"), asi que avisarlos a todos
 * seria un aviso tecnico de cientos de lineas sin nada que hacer al respecto.
 * El caso que SI hay que ver es el contrario: un producto a la venta cuyo precio
 * no se logra leer, porque ahi la espera del render se quedo corta.
 */
export function marcarSinPrecioProlongado(catalogo, umbral = UMBRAL_SIN_VERIFICAR) {
  const nuevos = [];
  for (const [modelo, rec] of Object.entries(catalogo ?? {})) {
    if ((rec?.corridasSinPrecio ?? 0) < umbral) continue;
    // Se avisa de los productos que Samsung VENDE (con o sin unidades). Los
    // "no a la venta" y los "desconocido" quedan fuera a proposito: son 426 de
    // los ~1000 activos y muchos simplemente no publican precio (medido en vivo
    // en el control remoto AR-KH00E), asi que avisarlos seria un aviso tecnico
    // de cientos de lineas sin nada que hacer al respecto.
    if (rec.estadoStock !== ESTADO.DISPONIBLE && rec.estadoStock !== ESTADO.AGOTADO) continue;
    if (rec.avisadoSinPrecio) continue;
    rec.avisadoSinPrecio = true;
    nuevos.push({ modelo, corridas: rec.corridasSinPrecio, precio: rec.precio ?? null, url: rec.url ?? null });
  }
  return nuevos;
}
