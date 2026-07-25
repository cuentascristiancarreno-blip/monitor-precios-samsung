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

export const UMBRAL_AUSENCIAS = 2;

function stockObservado(disponible) {
  if (disponible === true) return "disponible";
  if (disponible === false) return "agotado";
  return null; // desconocido (ej. variante de familia sin dato de stock)
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
      cambios.push({ tipo: "nuevo", modelo, nombre: obs.nombre, precio: obs.precio, categoria: obs.categoria, url: obs.url });
      continue;
    }

    // la categoria especifica del listado gana sobre la generica de una
    // pagina familia auto-descubierta (si no, se rompen iconos y filtros)
    const categoria =
      (obs.categoria || "").startsWith("Familia") && ant.categoria && !(ant.categoria || "").startsWith("Familia")
        ? ant.categoria
        : obs.categoria;

    const rec = {
      ...ant,
      ...obs,
      categoria,
      presencia: "activo",
      ausencias: 0,
      notificadoDesaparecido: false,
      ultimaVezVisto: timestamp,
    };

    let yaAnunciado = false;
    if (ant.notificadoDesaparecido) {
      cambios.push({ tipo: "recuperado", modelo, nombre: rec.nombre, precio: rec.precio, categoria, url: rec.url });
      yaAnunciado = true;
    }

    // precios: sube/baja solo entre dos precios validos; si recien se conoce
    // el precio (antes corrupto o sin precio), se anuncia una unica vez
    const precioAnt = ant.precio;
    if (!Number.isFinite(precioAnt) && Number.isFinite(obs.precio)) {
      if (!yaAnunciado) {
        cambios.push({ tipo: "nuevo", modelo, nombre: rec.nombre, precio: obs.precio, categoria, url: rec.url });
      }
    } else if (Number.isFinite(precioAnt) && Number.isFinite(obs.precio) && precioAnt !== obs.precio) {
      cambios.push({
        tipo: obs.precio < precioAnt ? "baja" : "sube",
        modelo,
        nombre: rec.nombre,
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
          nombre: rec.nombre,
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
      cambios.push({ tipo: "desaparecido", modelo, nombre: ant.nombre, precioAnterior: ant.precio, categoria: ant.categoria, url: ant.url });
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
