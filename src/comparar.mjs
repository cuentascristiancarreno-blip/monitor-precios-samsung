// Logica pura de comparacion entre el catalogo de la corrida anterior y lo
// observado en la corrida actual. Sin I/O ni dependencias externas: todo lo
// que decide "que cambio y que se notifica" vive aca y es testeable.
//
// Cada registro del catalogo lleva, ademas de los datos del producto:
//  - presencia: "activo" | "ausente" | "desaparecido" | "error_verificacion"
//  - estadoStock: "disponible" | "agotado" (ultimo estado CONFIRMADO)
//  - stockPendiente: estado observado 1 sola vez, a la espera de confirmacion
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
import { normalizar } from "./titulo.mjs";

export const UMBRAL_AUSENCIAS = 2;

function stockObservado(disponible) {
  if (disponible === true) return "disponible";
  if (disponible === false) return "agotado";
  return null; // desconocido (ej. variante de familia sin dato de stock)
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

export function comparar({ previo, observado, paginasFallidas, corridaConfiable, timestamp }) {
  const catalogo = {};
  const cambios = [];

  for (const [modelo, obs] of Object.entries(observado)) {
    const ant = previo[modelo];
    const stockObs = stockObservado(obs.disponible);

    if (!ant) {
      catalogo[modelo] = {
        ...obs,
        presencia: "activo",
        estadoStock: stockObs ?? "disponible",
        stockPendiente: null,
        ausencias: 0,
        notificadoDesaparecido: false,
        ultimaVezVisto: timestamp,
      };
      cambios.push({ tipo: "nuevo", modelo, ...paraTitulo(obs), precio: obs.precio, categoria: obs.categoria, url: obs.url });
      continue;
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
    } else if (Number.isFinite(precioAnt) && Number.isFinite(obs.precio) && precioAnt !== obs.precio) {
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
    const comprometido = ant.estadoStock ?? stockObservado(ant.disponible) ?? "disponible";
    rec.estadoStock = comprometido;
    rec.stockPendiente = null;
    if (stockObs && stockObs !== comprometido) {
      if (ant.stockPendiente === stockObs) {
        rec.estadoStock = stockObs;
        cambios.push({
          tipo: "stock",
          modelo,
          ...paraTitulo(rec),
          disponible: stockObs === "disponible",
          disponibleAnterior: comprometido === "disponible",
          precio: rec.precio,
          categoria,
          url: rec.url,
        });
      } else {
        rec.stockPendiente = stockObs;
      }
    }

    catalogo[modelo] = rec;
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
