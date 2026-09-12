// RE-ESTABLECIMIENTO DE LINEA BASE DEL STOCK.
//
// El 2026-09-11 cambio como se decide el stock: antes se buscaban 4 palabras en
// el texto de la pagina completa y lo que no las trajera quedaba "disponible"
// POR DEFECTO (894 de 928 productos activos figuraban disponibles); ahora se lee
// el bloque de compra. Medido sobre 42 productos, el estado real difiere del
// guardado en 16 casos y los 16 van en el mismo sentido.
//
// Sin la migracion, la primera corrida corregida dejaria cientos de "agotado" en
// stockPendiente y la SEGUNDA los notificaria todos juntos: el operador
// recibiria cientos de "se agoto" que no son novedades del sitio, sino la
// correccion de un dato que siempre estuvo mal.
//
// El mecanismo es AUTO-DESACTIVABLE y por SKU: la observacion viaja con la
// version del detector que la produjo, y en cuanto el registro guardado alcanza
// esa version vuelven a regir las reglas normales. No hay fecha de corte ni
// variable de entorno que alguien tenga que acordarse de apagar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { comparar } from "../src/comparar.mjs";
import { ESTADO, VERSION_STOCK } from "../src/stock.mjs";

const TS = "2026-09-11T12:00:00.000Z";

/** Registro tal como lo dejo el detector VIEJO: sin versionStock. */
function registroViejo(extra = {}) {
  return {
    modelo: "SKU-1",
    nombre: "Producto de prueba",
    precio: 100000,
    moneda: "CLP",
    disponible: true,
    url: "https://example.com/p",
    categoria: "Televisores",
    paginaOrigen: "https://example.com/p",
    presencia: "activo",
    estadoStock: ESTADO.DISPONIBLE, // heredado del "disponible por defecto"
    stockPendiente: null,
    ausencias: 0,
    notificadoDesaparecido: false,
    ...extra,
  };
}

/** Observacion tal como la emite el detector NUEVO. */
function observacion(estado, extra = {}) {
  return {
    modelo: "SKU-1",
    nombre: "Producto de prueba",
    precio: 100000,
    moneda: "CLP",
    estadoStock: estado,
    disponible: estado === ESTADO.DISPONIBLE ? true : estado === ESTADO.DESCONOCIDO ? null : false,
    versionStock: VERSION_STOCK,
    url: "https://example.com/p",
    categoria: "Televisores",
    paginaOrigen: "https://example.com/p",
    ...extra,
  };
}

function correr(previo, observado) {
  return comparar({ previo, observado, paginasFallidas: new Set(), corridaConfiable: true, timestamp: TS });
}

test("primera corrida corregida: adopta el estado real y NO notifica", () => {
  const { catalogo, cambios } = correr(
    { "SKU-1": registroViejo() },
    { "SKU-1": observacion(ESTADO.AGOTADO) },
  );
  assert.equal(cambios.length, 0, "el operador no recibe nada: no es una novedad, es una correccion");
  assert.equal(catalogo["SKU-1"].estadoStock, ESTADO.AGOTADO, "el estado real se adopta de una vez");
  assert.equal(catalogo["SKU-1"].stockPendiente, null, "no queda nada pendiente que explote en la corrida siguiente");
  assert.equal(catalogo["SKU-1"].versionStock, VERSION_STOCK, "queda sellado: la migracion no se repite");
});

test("segunda corrida: la migracion ya se apago sola y vuelven las reglas normales", () => {
  const paso1 = correr({ "SKU-1": registroViejo() }, { "SKU-1": observacion(ESTADO.AGOTADO) });

  // ahora el producto vuelve a tener stock de verdad: eso SI es una novedad,
  // pero necesita las 2 observaciones seguidas de siempre
  const paso2 = correr(paso1.catalogo, { "SKU-1": observacion(ESTADO.DISPONIBLE) });
  assert.equal(paso2.cambios.length, 0, "una sola observacion no basta (regla anti-parpadeo)");
  assert.equal(paso2.catalogo["SKU-1"].estadoStock, ESTADO.AGOTADO);
  assert.equal(paso2.catalogo["SKU-1"].stockPendiente, ESTADO.DISPONIBLE);

  const paso3 = correr(paso2.catalogo, { "SKU-1": observacion(ESTADO.DISPONIBLE) });
  assert.equal(paso3.cambios.length, 1);
  assert.equal(paso3.cambios[0].tipo, "stock");
  assert.equal(paso3.cambios[0].estadoAnterior, ESTADO.AGOTADO);
  assert.equal(paso3.cambios[0].estado, ESTADO.DISPONIBLE);
  assert.equal(paso3.cambios[0].disponible, true, "el booleano historico sigue viajando");
  assert.equal(paso3.catalogo["SKU-1"].estadoStock, ESTADO.DISPONIBLE);
});

test("la avalancha completa: 900 productos mal marcados no producen ni un aviso", () => {
  const previo = {};
  const observado = {};
  for (let i = 0; i < 900; i++) {
    previo[`SKU-${i}`] = registroViejo({ modelo: `SKU-${i}` });
    observado[`SKU-${i}`] = observacion(ESTADO.AGOTADO, { modelo: `SKU-${i}` });
  }
  const paso1 = correr(previo, observado);
  assert.equal(paso1.cambios.length, 0, "primera corrida: silencio total");

  // y la corrida siguiente tampoco dispara nada, porque no quedo nada pendiente
  const paso2 = correr(paso1.catalogo, observado);
  assert.equal(paso2.cambios.length, 0, "segunda corrida: tampoco, que es donde explotaba antes");
});

test("sin la migracion, esos mismos 900 habrian avisado en la segunda corrida", () => {
  // Prueba de control: la MISMA observacion sin el sello de version (o sea, lo
  // que pasaria si alguien quitara la migracion) recorre el camino normal y
  // termina notificando. Deja documentado que la migracion es lo que lo evita.
  const sinSello = { ...observacion(ESTADO.AGOTADO) };
  delete sinSello.versionStock;

  const paso1 = correr({ "SKU-1": registroViejo() }, { "SKU-1": sinSello });
  assert.equal(paso1.cambios.length, 0);
  assert.equal(paso1.catalogo["SKU-1"].stockPendiente, ESTADO.AGOTADO, "queda armado...");

  const paso2 = correr(paso1.catalogo, { "SKU-1": sinSello });
  assert.equal(paso2.cambios.length, 1, "...y en la segunda corrida dispara");
  assert.equal(paso2.cambios[0].tipo, "stock");
});

test("un estado desconocido no sella la version ni cambia nada", () => {
  // si el bloque de compra no se pudo leer, el SKU queda SIN migrar y espera a
  // la primera corrida que si logre leerlo. Dar por migrado lo que no se leyo
  // haria que la primera lectura buena saliera anunciada como cambio.
  const paso1 = correr({ "SKU-1": registroViejo() }, { "SKU-1": observacion(ESTADO.DESCONOCIDO) });
  assert.equal(paso1.cambios.length, 0);
  assert.equal(paso1.catalogo["SKU-1"].estadoStock, ESTADO.DISPONIBLE, "el estado guardado no se toca");
  assert.equal(paso1.catalogo["SKU-1"].stockPendiente, null);
  assert.equal(paso1.catalogo["SKU-1"].versionStock, null, "sigue pendiente de migrar");

  // la corrida que si lo lee migra en silencio, como corresponde
  const paso2 = correr(paso1.catalogo, { "SKU-1": observacion(ESTADO.AGOTADO) });
  assert.equal(paso2.cambios.length, 0);
  assert.equal(paso2.catalogo["SKU-1"].estadoStock, ESTADO.AGOTADO);
  assert.equal(paso2.catalogo["SKU-1"].versionStock, VERSION_STOCK);
});

test("'desconocido' nunca se convierte en 'disponible' por defecto", () => {
  // producto nunca visto cuyo bloque de compra no se pudo leer
  const { catalogo, cambios } = correr({}, { "SKU-1": observacion(ESTADO.DESCONOCIDO) });
  assert.equal(catalogo["SKU-1"].estadoStock, ESTADO.DESCONOCIDO);
  assert.equal(catalogo["SKU-1"].versionStock, null);
  assert.equal(cambios.length, 1);
  assert.equal(cambios[0].tipo, "nuevo", "se anuncia como producto nuevo, pero NO se afirma que tenga stock");

  // cuando por fin se lee, se aprende en silencio: pasar de "no se sabe" a un
  // estado real no es un cambio de stock que valga la pena avisar
  const paso2 = correr(catalogo, { "SKU-1": observacion(ESTADO.AGOTADO) });
  assert.equal(paso2.cambios.length, 0);
  assert.equal(paso2.catalogo["SKU-1"].estadoStock, ESTADO.AGOTADO);
});

test("una lectura fallida despues de migrar tampoco mueve el estado", () => {
  const paso1 = correr({ "SKU-1": registroViejo() }, { "SKU-1": observacion(ESTADO.DISPONIBLE) });
  assert.equal(paso1.catalogo["SKU-1"].versionStock, VERSION_STOCK);

  const paso2 = correr(paso1.catalogo, { "SKU-1": observacion(ESTADO.DESCONOCIDO) });
  assert.equal(paso2.cambios.length, 0);
  assert.equal(paso2.catalogo["SKU-1"].estadoStock, ESTADO.DISPONIBLE, "se conserva el ultimo estado conocido");
  assert.equal(paso2.catalogo["SKU-1"].versionStock, VERSION_STOCK, "y no se des-migra");
});

test("'no a la venta' es un estado propio y se notifica como tal", () => {
  const previo = { "SKU-1": registroViejo({ versionStock: VERSION_STOCK }) };
  const paso1 = correr(previo, { "SKU-1": observacion(ESTADO.NO_A_LA_VENTA) });
  assert.equal(paso1.cambios.length, 0, "necesita confirmacion como cualquier cambio de stock");
  assert.equal(paso1.catalogo["SKU-1"].stockPendiente, ESTADO.NO_A_LA_VENTA);

  const paso2 = correr(paso1.catalogo, { "SKU-1": observacion(ESTADO.NO_A_LA_VENTA) });
  assert.equal(paso2.cambios.length, 1);
  assert.equal(paso2.cambios[0].estado, ESTADO.NO_A_LA_VENTA);
  assert.equal(paso2.cambios[0].estadoAnterior, ESTADO.DISPONIBLE);
  assert.equal(paso2.catalogo["SKU-1"].estadoStock, ESTADO.NO_A_LA_VENTA);
});

test("pasar de agotado a no-a-la-venta se nota, aunque el booleano no cambie", () => {
  // los dos estados comparten disponible=false: si la distincion no viajara, el
  // cambio seria invisible para el operador
  const previo = { "SKU-1": registroViejo({ versionStock: VERSION_STOCK, estadoStock: ESTADO.AGOTADO, stockPendiente: ESTADO.NO_A_LA_VENTA }) };
  const { cambios } = correr(previo, { "SKU-1": observacion(ESTADO.NO_A_LA_VENTA) });
  assert.equal(cambios.length, 1);
  assert.equal(cambios[0].estadoAnterior, ESTADO.AGOTADO);
  assert.equal(cambios[0].estado, ESTADO.NO_A_LA_VENTA);
  assert.equal(cambios[0].disponible, false);
  assert.equal(cambios[0].disponibleAnterior, false, "el booleano no alcanza a distinguirlos, el estado si");
});

test("un catalogo del esquema viejo (sin estadoStock) se migra sin alertas", () => {
  const muyViejo = { modelo: "SKU-1", nombre: "P", precio: 100000, disponible: true, url: "u", categoria: "Cocina", paginaOrigen: "u" };
  const { catalogo, cambios } = correr({ "SKU-1": muyViejo }, { "SKU-1": observacion(ESTADO.AGOTADO) });
  assert.equal(cambios.length, 0);
  assert.equal(catalogo["SKU-1"].estadoStock, ESTADO.AGOTADO);
  assert.equal(catalogo["SKU-1"].versionStock, VERSION_STOCK);
});

// ---------------------------------------------------------------------------
// LA VENTANA SE CIERRA, Y "VOLVIÓ EL STOCK" NO SE PIERDE
// (defecto 9 de la revision del 2026-09-11)
// ---------------------------------------------------------------------------
//
// La re-base existe porque la version vieja dejaba "disponible" POR DEFECTO: ese
// valor era un relleno, no una medicion. Pero su "agotado" SI salia de una
// deteccion positiva de la regex, asi que es una linea base valida. Re-basarlo
// tambien tenia dos costos medidos:
//  1. un SKU que estaba agotado y VUELVE a tener stock se adoptaba en silencio:
//     se perdia el aviso mas valioso del monitor.
//  2. un SKU que se leyera siempre como "desconocido" nunca sellaba la version y
//     quedaba con la adopcion silenciosa armada para siempre (medido en vivo:
//     SM-S741BLGPLTL, un smartphone notificable, seguia sin sellar tras 20
//     corridas).

test("un 'agotado' de la version vieja es linea base valida: 'volvió el stock' se avisa", () => {
  // SM-S741BLGPLTL: la regex vieja lo marco agotado a proposito (encontro la
  // palabra en la pagina), no por defecto.
  let previo = { "SKU-1": registroViejo({ estadoStock: ESTADO.AGOTADO, disponible: false }) };

  const c1 = comparar({
    previo,
    observado: { "SKU-1": observacion(ESTADO.DISPONIBLE) },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.deepEqual(c1.cambios, [], "la primera vez solo queda pendiente: sigue rigiendo la confirmacion en 2 corridas");
  assert.equal(c1.catalogo["SKU-1"].estadoStock, ESTADO.AGOTADO, "NO se adopta en silencio");
  assert.equal(c1.catalogo["SKU-1"].stockPendiente, ESTADO.DISPONIBLE);

  const c2 = comparar({
    previo: c1.catalogo,
    observado: { "SKU-1": observacion(ESTADO.DISPONIBLE) },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: TS,
  });
  const stock = c2.cambios.filter((c) => c.tipo === "stock");
  assert.equal(stock.length, 1, "el aviso que el operador mas quiere SI sale");
  assert.equal(stock[0].estadoAnterior, ESTADO.AGOTADO);
  assert.equal(stock[0].estado, ESTADO.DISPONIBLE);
});

test("pero el 'disponible' por defecto de la version vieja se sigue corrigiendo en silencio", () => {
  // es el caso de los ~891 SKU del catalogo real: el contraste con la prueba de
  // arriba es lo que hace que la migracion siga siendo util
  const previo = { "SKU-1": registroViejo() }; // estadoStock disponible, sin versionStock
  const r = comparar({
    previo,
    observado: { "SKU-1": observacion(ESTADO.AGOTADO) },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.deepEqual(r.cambios, []);
  assert.equal(r.catalogo["SKU-1"].estadoStock, ESTADO.AGOTADO);
  assert.equal(r.catalogo["SKU-1"].versionStock, VERSION_STOCK);
});

test("un SKU que nunca se puede leer ya no queda con la migracion armada para siempre", () => {
  // 20 corridas con el bloque ilegible: antes la version nunca se sellaba, asi
  // que en la corrida 21 cualquier lectura buena se adoptaba en silencio
  let previo = { "SKU-1": registroViejo({ estadoStock: ESTADO.AGOTADO, disponible: false }) };
  for (let i = 0; i < 20; i++) {
    previo = comparar({
      previo,
      observado: { "SKU-1": observacion(ESTADO.DESCONOCIDO) },
      paginasFallidas: new Set(),
      corridaConfiable: true,
      timestamp: TS,
    }).catalogo;
  }
  assert.equal(previo["SKU-1"].estadoStock, ESTADO.AGOTADO);

  // corrida 21: el telefono vuelve a tener stock
  const c21 = comparar({ previo, observado: { "SKU-1": observacion(ESTADO.DISPONIBLE) }, paginasFallidas: new Set(), corridaConfiable: true, timestamp: TS });
  const c22 = comparar({ previo: c21.catalogo, observado: { "SKU-1": observacion(ESTADO.DISPONIBLE) }, paginasFallidas: new Set(), corridaConfiable: true, timestamp: TS });
  assert.deepEqual(c21.cambios, [], "confirmacion en 2 corridas: la primera no avisa");
  assert.equal(c22.cambios.filter((c) => c.tipo === "stock").length, 1, "y la segunda SI avisa, en vez de perderse en silencio");
});

// ---------------------------------------------------------------------------
// EL REGISTRO NO SE CONTRADICE A SI MISMO (defectos 4 y 11 de la revision)
// ---------------------------------------------------------------------------

test("estadoStock y disponible nunca dicen cosas distintas en el catalogo", () => {
  const coherente = (rec) => {
    const esperado = rec.estadoStock === ESTADO.DISPONIBLE ? true : rec.estadoStock === ESTADO.DESCONOCIDO ? null : false;
    assert.equal(rec.disponible, esperado, `${rec.estadoStock} / ${rec.disponible}`);
  };

  // 1. lectura ilegible sobre un registro disponible: antes quedaba
  //    {estadoStock:"disponible", disponible:null}
  const ilegible = comparar({
    previo: { "SKU-1": registroViejo({ versionStock: VERSION_STOCK }) },
    observado: { "SKU-1": observacion(ESTADO.DESCONOCIDO) },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.equal(ilegible.catalogo["SKU-1"].estadoStock, ESTADO.DISPONIBLE, "un desconocido no cambia el estado");
  coherente(ilegible.catalogo["SKU-1"]);

  // 2. cambio observado una sola vez (esperando confirmacion): antes quedaba
  //    {estadoStock:"disponible", stockPendiente:"agotado", disponible:false}
  const pendiente = comparar({
    previo: { "SKU-1": registroViejo({ versionStock: VERSION_STOCK }) },
    observado: { "SKU-1": observacion(ESTADO.AGOTADO) },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.equal(pendiente.catalogo["SKU-1"].stockPendiente, ESTADO.AGOTADO);
  coherente(pendiente.catalogo["SKU-1"]);

  // 3. producto nuevo cuyo bloque no se pudo leer
  const nuevo = comparar({
    previo: {},
    observado: { "SKU-1": observacion(ESTADO.DESCONOCIDO) },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: TS,
  });
  assert.equal(nuevo.catalogo["SKU-1"].estadoStock, ESTADO.DESCONOCIDO);
  coherente(nuevo.catalogo["SKU-1"]);

  // 4. migracion silenciosa
  const migrado = comparar({
    previo: { "SKU-1": registroViejo() },
    observado: { "SKU-1": observacion(ESTADO.NO_A_LA_VENTA) },
    paginasFallidas: new Set(),
    corridaConfiable: true,
    timestamp: TS,
  });
  coherente(migrado.catalogo["SKU-1"]);
});
