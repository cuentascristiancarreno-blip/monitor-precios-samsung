// SOLO SE NOTIFICAN LAS BAJAS DE PRECIO (regla del operador, 2026-10-14).
//
// Pedido textual: "para notificaciones discord, solo notifica si hay bajas de
// precio. Si sube el precio o se agotó un producto no lo notifiques. La
// notificacion de discord debería mostrar que hubo una baja de producto y una
// flecha verde por ejemplo, el nombre del producto completo y de que precio a
// que precio bajó."
//
// Son dos encargos y este archivo cubre los dos: EL FILTRO (quien pasa) y EL
// FORMATO (como se ve lo que pasa).
//
// LA PRUEBA QUE MAS IMPORTA es la de la SEMANA REAL: se reproduce la ultima
// semana del operador, congelada en test/fixtures/semana-2026-10-14.json, y se
// exige que al canal de productos salgan EXACTAMENTE las 11 bajas y nada mas.
// Los dos numeros medidos: 185 cambios notificables detectados, 11 avisos.
//
// REGLA QUE NO SE NEGOCIA: jamas se le manda un mensaje al webhook real. Todo
// pasa por globalThis.fetch interceptado y una URL falsa.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { esBajaDePrecio, pendienteCreible, pulsoDeLaRegla, TIPO_NOTIFICABLE } from "../src/solo-bajas.mjs";
import {
  encabezadoTanda,
  esDeProductoVigilado,
  esNotificable,
  esParaVivo,
  pendientesParaAvisar,
  repartirCierre,
  soloNotificables,
} from "../src/despachador-vivo.mjs";
import { mensajePulsoDeLaRegla, notifyDiscord, notifyTecnico, mensajeRebotando, reiniciarRitmo } from "../src/discord.mjs";
import { serializarPendientes } from "../src/pendientes.mjs";
import { ESTADO } from "../src/stock.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FOTO = JSON.parse(readFileSync(path.join(AQUI, "fixtures", "semana-2026-10-14.json"), "utf-8"));
const WEBHOOK = "https://fake.webhook/no-es-el-real";

// ---------------------------------------------------------------------------
// el transporte, interceptado
// ---------------------------------------------------------------------------

function capturar() {
  const enviados = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    enviados.push(JSON.parse(opts.body).content);
    return { ok: true, status: 204, text: async () => "", headers: { get: () => null } };
  };
  enviados.restaurar = () => {
    globalThis.fetch = original;
  };
  reiniciarRitmo();
  return enviados;
}

async function mensajesDe(opciones) {
  const enviados = capturar();
  try {
    await notifyDiscord(WEBHOOK, { totalRevisado: 1185, errores: 0, ...opciones });
  } finally {
    enviados.restaurar();
  }
  return enviados.join("\n");
}

// ---------------------------------------------------------------------------
// 1. EL FILTRO, Y QUE VALE PARA LOS DOS CAMINOS DE ENVIO
// ---------------------------------------------------------------------------

const TIPOS = ["baja", "sube", "stock", "nuevo", "recuperado", "desaparecido"];
const cambioDe = (tipo, extra = {}) => ({
  tipo,
  modelo: "SM-X",
  nombre: "Galaxy de prueba",
  categoria: "Smartphones",
  precio: 100000,
  precioAnterior: 200000,
  url: "https://www.samsung.com/cl/smartphones/galaxy-x/galaxy-x-sm-test/",
  ...extra,
});

test("de los seis tipos de cambio, SOLO la baja de precio se notifica", () => {
  for (const tipo of TIPOS) {
    assert.equal(esBajaDePrecio(cambioDe(tipo)), tipo === "baja", `esBajaDePrecio(${tipo})`);
    assert.equal(esNotificable(cambioDe(tipo)), tipo === "baja", `esNotificable(${tipo})`);
  }
  assert.equal(TIPO_NOTIFICABLE, "baja");
  // ni un cambio sin tipo, ni basura, pasan por error
  for (const raro of [undefined, null, {}, { tipo: "" }, { tipo: "bajas" }, { tipo: "BAJA" }]) {
    assert.equal(esNotificable(raro), false, `${JSON.stringify(raro)} no puede colarse`);
  }
});

test("el filtro vale para LOS DOS caminos de envio, porque los dos pasan por el mismo porton", () => {
  // Si estuviera escrito dos veces -- una en el despachador y otra en el cierre
  // -- se podria aplicar en uno y olvidar en el otro, y el aviso saldria igual
  // en vivo minutos antes de que el resumen lo agrupara. Es el mutante que
  // sobrevivio en la entrega del freno del 2026-09-13.
  for (const tipo of TIPOS) {
    const c = cambioDe(tipo);
    assert.equal(esParaVivo(c), tipo === "baja", `camino EN VIVO (${tipo})`);
    assert.equal(repartirCierre([c], null).paraDiscord.length, tipo === "baja" ? 1 : 0, `camino del CIERRE (${tipo})`);
  }
});

test("las reglas de catalogo siguen primero: un accesorio o un Book3 no pasan ni siendo baja", () => {
  assert.equal(esNotificable(cambioDe("baja", { categoria: "Accesorios móviles" })), false, "accesorio");
  assert.equal(esNotificable(cambioDe("baja", { nombre: "Galaxy Book3 Pro 360", modelo: "NP750QFG-KB2CL" })), false, "Book3 silenciado");
  // y las dos capas se distinguen: una es del catalogo, la otra del operador
  assert.equal(esDeProductoVigilado(cambioDe("baja", { categoria: "Accesorios móviles" })), false);
  assert.equal(esDeProductoVigilado(cambioDe("stock")), true, "un cambio de stock SI es de un producto vigilado: lo frena su tipo");
});

test("un aviso atrasado de una corrida anterior se vuelve a pasar por las reglas de HOY", () => {
  // data/pendientes.jsonl guarda los avisos que Discord rechazo, con todos sus
  // campos, y los escribio una corrida ANTERIOR -- posiblemente con otras reglas
  // de notificacion. Sin esto, el primer despliegue de esta regla habria
  // reenviado como alertas completas hasta MAX_PENDIENTES = 1.000 avisos que la
  // regla nueva ya no quiere.
  const atrasados = TIPOS.map((tipo) => cambioDe(tipo, { ts: "2026-10-13T10:00:00.000Z" }));
  assert.equal(atrasados.length, 6);
  assert.deepEqual(soloNotificables(atrasados).map((c) => c.tipo), ["baja"]);
  assert.deepEqual(soloNotificables(null), [], "sin archivo no revienta");
});

// ---------------------------------------------------------------------------
// 2. LA PRUEBA QUE MAS IMPORTA: LA SEMANA REAL DEL OPERADOR
// ---------------------------------------------------------------------------

// El desglose de la semana, medido sobre la foto congelada con el clasificador
// del repo (no copiado del encargo: la prueba lo vuelve a calcular abajo).
//
//   bajas de precio ....................... 11   <- lo unico que sigue avisando
//   subidas de precio ......................  9
//   se agoto ............................... 84
//   volvio el stock ........................ 44
//   cambio de motivo (sigue sin comprarse) . 16
//   desaparecido ........................... 12
//   recuperado .............................  8
//   producto nuevo .........................  1
//   TOTAL 185 -> 11, un 94% menos de mensajes.
const BAJAS_DE_LA_SEMANA = 11;
const NOTIFICABLES_DE_LA_SEMANA = 185;

test("LA SEMANA REAL: al canal de productos salen EXACTAMENTE las 11 bajas y nada mas", () => {
  const eventos = FOTO.eventos;
  assert.equal(eventos.length, 194, "la foto trae los 194 eventos crudos de la semana");

  const vigilados = eventos.filter(esDeProductoVigilado);
  const entregados = eventos.filter(esNotificable);

  // LOS DOS NUMEROS, los dos medidos sobre la misma foto
  assert.equal(vigilados.length, NOTIFICABLES_DE_LA_SEMANA, "cambios de productos vigilados que la semana detecto");
  assert.equal(entregados.length, BAJAS_DE_LA_SEMANA, "avisos que el operador recibe con la regla nueva");

  // y lo que sale es SOLO bajas, no "11 cosas cualesquiera"
  assert.deepEqual([...new Set(entregados.map((c) => c.tipo))], ["baja"]);
  assert.equal(vigilados.filter((c) => c.tipo === "baja").length, BAJAS_DE_LA_SEMANA, "y son TODAS las bajas de la semana: ni una se calla");

  // la reduccion que el operador pidio
  const reduccion = 1 - entregados.length / vigilados.length;
  assert.ok(reduccion > 0.93, `la reduccion medida es ${(reduccion * 100).toFixed(1)}%, tendria que pasar del 93%`);
});

test("...y lo que deja de avisarse es exactamente lo que el operador nombro", () => {
  const vigilados = FOTO.eventos.filter(esDeProductoVigilado);
  const porTipo = (tipo) => vigilados.filter((c) => c.tipo === tipo);
  const conteo = Object.fromEntries(TIPOS.map((t) => [t, porTipo(t).length]));
  assert.deepEqual(conteo, { baja: 11, sube: 9, stock: 144, nuevo: 1, recuperado: 8, desaparecido: 12 });

  // el desglose del stock, que es el grueso de lo que se apaga
  const stock = porTipo("stock");
  const esComprable = (e) => (e.estado ?? (e.disponible ? ESTADO.DISPONIBLE : ESTADO.AGOTADO)) === ESTADO.DISPONIBLE;
  const eraComprable = (e) => (e.estadoAnterior ?? (e.disponibleAnterior ? ESTADO.DISPONIBLE : ESTADO.AGOTADO)) === ESTADO.DISPONIBLE;
  assert.equal(stock.filter((e) => eraComprable(e) && !esComprable(e)).length, 84, "'se agoto'");
  assert.equal(stock.filter((e) => !eraComprable(e) && esComprable(e)).length, 44, "'volvio el stock'");
  assert.equal(stock.filter((e) => !eraComprable(e) && !esComprable(e)).length, 16, "cambio de motivo, sigue sin poder comprarse");

  // LO QUE SE APAGA Y DUELE, dicho aca y no solo en la bitacora: los 44 "volvio
  // el stock" eran el unico aviso de stock con el que el operador puede COMPRAR,
  // y conseguir que llegaran completos y en vivo costo el entregable entero del
  // 2026-10-05. Esta regla los apaga. Ya se le dijo al operador y es su
  // decision: esta asercion existe para que nadie lo "arregle" por su cuenta.
  for (const e of stock.filter((e) => !eraComprable(e) && esComprable(e))) {
    assert.equal(esNotificable(e), false, `la reposicion de ${e.modelo} ya no se avisa, a proposito`);
  }
});

test("la foto congelada se sigue pareciendo a un evento real del historial", () => {
  // Si alguien la regenera mal (o la recorta), las dos pruebas de arriba podrian
  // seguir en verde con material que no es el del operador. Esto fija la FORMA.
  for (const campo of ["ts", "tipo", "modelo", "categoria"]) {
    assert.ok(FOTO.eventos.every((e) => e[campo] !== undefined), `todos los eventos traen ${campo}`);
  }
  const bajas = FOTO.eventos.filter((e) => e.tipo === "baja");
  for (const b of bajas) {
    assert.ok(Number.isFinite(b.precio) && Number.isFinite(b.precioAnterior), `${b.modelo} trae los dos precios`);
    assert.ok(b.precio < b.precioAnterior, `${b.modelo} de verdad bajo`);
    assert.ok(typeof b.url === "string" && b.url.includes("samsung.com"), `${b.modelo} trae su link`);
  }
  assert.ok(FOTO.eventos.every((e) => e.ts >= FOTO.ventana.desde && e.ts <= FOTO.ventana.hasta), "nada fuera de la ventana");
});

// ---------------------------------------------------------------------------
// 3. EL CANAL TECNICO NO SE TOCA
// ---------------------------------------------------------------------------

test("el canal TECNICO sigue hablando: no es un aviso de producto", async () => {
  const enviados = capturar();
  try {
    // los cuatro avisos que salen por notifyTecnico y que el operador NO pidio
    // filtrar: la revision sospechosa, el censo, las momias y los rebotes
    const r1 = await notifyTecnico(WEBHOOK, "⚠️ **Monitor Samsung — revisión marcada como NO confiable**\nmotivo de prueba");
    const r2 = await notifyTecnico(WEBHOOK, "🕸️ **Monitor Samsung — productos que no se pueden verificar hace rato**\n1 producto");
    const r3 = await notifyTecnico(WEBHOOK, mensajeRebotando([{ modelo: "SM-X", magnitud: "precio", valores: [1, 2], valor: 1, veces: 2 }]));
    assert.equal(r1.entregado, true);
    assert.equal(r2.entregado, true);
    assert.equal(r3.entregado, true);
  } finally {
    enviados.restaurar();
  }
  assert.equal(enviados.length, 3, "los tres avisos tecnicos salieron");
  assert.match(enviados.join("\n"), /NO confiable/);
  assert.match(enviados.join("\n"), /no se pueden verificar/);
});

// ---------------------------------------------------------------------------
// 4. EL FORMATO: las cuatro cosas que pidio el operador
// ---------------------------------------------------------------------------

// Una baja REAL de la semana del operador, sacada de la foto congelada: los
// Galaxy Buds4 negros, $199.990 -> $139.990 el 2026-10-11.
const BUDS = FOTO.eventos.find((e) => e.modelo === "SM-R540NZKACHO" && e.tipo === "baja");

test("el aviso de una baja real dice QUE ES UNA BAJA, con flecha verde, nombre completo y de que precio a que precio", async () => {
  assert.ok(BUDS, "la baja real de los Buds4 esta en la foto");
  const texto = await mensajesDe({ changes: [BUDS] });

  // (1) que se vea que es una baja, y (2) la flecha verde -- las dos en la
  // PRIMERA linea, que es lo que se lee en la vista previa del telefono
  assert.match(texto, /🟢⬇️ \*\*BAJÓ DE PRECIO\*\*/, "bandera: flecha verde + la palabra");
  // (3) el nombre completo del producto, con su variante y su SKU
  assert.match(texto, /🎧 \*\*Galaxy Buds4 · Negro\*\* \(SM-R540NZKACHO\)/, "nombre completo + SKU");
  // (4) de que precio a que precio bajo
  assert.match(texto, /De \$199\.990 a \*\*\$139\.990\*\*/, "de que precio a que precio");
  // y cuanto se ahorra, que es lo que vuelve el aviso accionable
  assert.match(texto, /ahorras \$60\.000 \(−30,0%\)/);
  assert.ok(texto.includes(BUDS.url), "el link sigue");

  // la bandera va ANTES del nombre, no despues
  const linea = texto.split("\n").find((l) => l.includes("BAJÓ DE PRECIO"));
  assert.ok(linea.indexOf("🟢⬇️") < linea.indexOf("Galaxy Buds4"), "la flecha verde va primero");

  // y nada de lo que el formato anterior decia sigue ahi
  assert.doesNotMatch(texto, /Precio antes:/, "el formato viejo no sobrevive");
  assert.doesNotMatch(texto, /ahora: \$/, "el formato viejo no sobrevive");
  assert.ok(!texto.includes("NaN") && !texto.includes("undefined"), "jamas NaN ni undefined");
});

test("las 11 bajas de la semana salen las 11, cada una con su nombre, su tramo y su link", async () => {
  const bajas = FOTO.eventos.filter(esNotificable);
  const texto = await mensajesDe({ changes: bajas, detectados: NOTIFICABLES_DE_LA_SEMANA });
  assert.match(texto, /\*\*🟢⬇️ Bajas de precio \(11\)\*\*/, "la seccion declara las 11");
  const banderas = texto.match(/🟢⬇️ \*\*BAJÓ DE PRECIO\*\*/g) ?? [];
  assert.equal(banderas.length, 11, "una bandera por baja");
  for (const b of bajas) {
    assert.ok(texto.includes(`(${b.modelo})`), `falta el SKU de ${b.modelo}`);
    assert.ok(texto.includes(b.url), `falta el link de ${b.modelo}`);
  }
  // ninguna seccion de los tipos que ya no se avisan
  for (const titulo of ["Subas de precio", "Cambios de stock", "Productos nuevos", "De vuelta en el sitio", "Ya no aparecen"]) {
    assert.ok(!texto.includes(titulo), `la seccion "${titulo}" no tiene por que aparecer`);
  }
});

test("el encabezado declara lo DETECTADO, no solo lo avisado: no puede mentir por omision", async () => {
  const bajas = FOTO.eventos.filter(esNotificable);
  const texto = await mensajesDe({ changes: bajas, detectados: NOTIFICABLES_DE_LA_SEMANA });
  // Sin esta linea el operador leeria "11 avisos" y creeria que el sitio solo se
  // movio 11 veces. Es la misma regla que el proyecto ya se habia fijado con los
  // avisos en vivo ("el conteo tiene que declarar la corrida COMPLETA").
  assert.match(texto, /11 avisos/);
  assert.match(texto, /se detectaron 185 cambios en total/);
  assert.match(texto, /solo se avisan las bajas de precio/);
  assert.match(texto, /quedaron registrados en el historial/, "y dice donde quedo el resto");
});

test("...y cuando no se filtro nada, el encabezado no dice nada", async () => {
  const texto = await mensajesDe({ changes: [cambioDe("baja")], detectados: 1 });
  assert.doesNotMatch(texto, /se detectaron/, "sin nada filtrado no hay nota que poner");
  // y sin el dato tampoco se inventa
  const sinDato = await mensajesDe({ changes: [cambioDe("baja")] });
  assert.doesNotMatch(sinDato, /se detectaron/);
});

test("una BAJA degradada por el freno tambien dice que es una baja, y sigue siendo UNA linea", async () => {
  // Callarla es el defecto grave del 2026-09-13 (61 bajas reales perdidas en 30
  // dias) y esta regla no lo reabre: sale igual, compacta. Lo que cambia es que
  // la linea ya no se dibuja con un "⇄" que no declara el sentido -- por este
  // canal ahora SOLO salen bajas, asi que no declararlo es mentir por omision.
  const rebote = { ...BUDS, rebote: true, valoresRebote: [139990, 199990], vecesRebotado: 2 };
  const texto = await mensajesDe({ changes: [rebote] });
  assert.match(texto, /Siguen rebotando/, "va en su seccion compacta, no entre las bajas");
  assert.match(texto, /🟢⬇️ \*\*BAJÓ DE PRECIO\*\*/, "pero dice que es una baja");
  assert.match(texto, /De \$199\.990 a \*\*\$139\.990\*\*/, "y de que precio a que precio");
  assert.match(texto, /rebota entre \$139\.990 ⇄ \$199\.990/, "sin perder entre que valores va");
  assert.match(texto, /2ª vez/);
  const lineas = texto.split("\n").filter((l) => l.includes("SM-R540NZKACHO"));
  assert.equal(lineas.length, 1, "sigue siendo UNA sola linea");
  assert.ok(!lineas[0].includes("🔗"), "y sin link: ya salio con link la primera vez");
});

test("un pack sin categoria del listado ya no sale con el icono generico", async () => {
  // Medido sobre las 1.411 bajas de todo el historial: 29 (2,1%) salian con 🔹.
  // Son los packs (Watch + Buds, S26 Ultra + adaptador) que solo existen en una
  // pagina familia descubierta por sitemap, asi que su categoria es la generica
  // "Familia (auto-descubierta)". Su NOMBRE siempre fue completo; lo pobre era
  // el icono. La seccion de la URL lo resuelve, y cada seccion del sitio la usa
  // una sola categoria (censado: 22 secciones, 552 notificables).
  const pack = cambioDe("baja", {
    modelo: "F-SML34SMR602",
    nombre: "Galaxy Watch9 (Bluetooth, 40 mm) Cream + Galaxy Buds4 Pro Black",
    categoria: "Familia (auto-descubierta)",
    url: "https://www.samsung.com/cl/watches/galaxy-watch/watch-40mm-buds2-cream-f-sml34smr602/",
    precio: 500000,
    precioAnterior: 600000,
  });
  const texto = await mensajesDe({ changes: [pack] });
  assert.match(texto, /⌚ \*\*Galaxy Watch9 \(Bluetooth, 40 mm\) Cream \+ Galaxy Buds4 Pro Black\*\*/, "icono por seccion de la URL");
  assert.ok(!texto.includes("🔹"), "ya no sale el generico");

  // y una categoria REAL nunca pierde su icono por esto
  const normal = cambioDe("baja", { categoria: "Televisores", url: "https://www.samsung.com/cl/watches/x/" });
  assert.match(await mensajesDe({ changes: [normal] }), /📺/, "manda la categoria, no la seccion");

  // sin categoria y sin URL conocida sigue existiendo el respaldo generico
  const huerfano = cambioDe("baja", { categoria: "Vaya a saber", url: "https://www.samsung.com/cl/loquesea/x/" });
  assert.match(await mensajesDe({ changes: [huerfano] }), /🔹/, "el generico sigue siendo la ultima red");
});

// ---------------------------------------------------------------------------
// 5. LOS ARREGLOS DE LA SEGUNDA VUELTA (2026-10-14)
//
// Cada prueba de esta seccion corresponde a un defecto que encontro una
// verificacion independiente sobre la primera entrega de esta misma regla. El
// comentario de arriba de cada una dice que texto literal estaba mal.
// ---------------------------------------------------------------------------

// La corrida REAL mas grande de la semana del operador, sacada de la foto
// congelada: 15 cambios de productos vigilados, de los cuales 9 bajas (las otras
// son 2 subas y 4 de stock). Las 9 salieron EN VIVO, asi que el cierre llega con
// `changes` vacio -- que es el caso normal desde esta regla.
const CORRIDA_GRANDE = "2026-10-07T22:28:06.392Z";
const DE_LA_CORRIDA_GRANDE = FOTO.eventos.filter((e) => e.ts === CORRIDA_GRANDE && esDeProductoVigilado(e));
const BAJAS_DE_LA_CORRIDA_GRANDE = DE_LA_CORRIDA_GRANDE.filter(esNotificable);

test("el cierre NO puede decir 'todo lo detectado' en el mismo mensaje que declara que filtro", async () => {
  // DEFECTO ALTO: el mensaje se contradecia a si mismo. Texto literal que
  // producia la corrida real de arriba:
  //   Revisados 1185 productos · 9 avisos (9 ya avisados en vivo · 0 en este resumen)
  //   _(se detectaron 15 cambios en total; por tu regla solo se avisan las bajas…)_
  //   ✅ Revisión terminada. Todo lo detectado ya se avisó en vivo.
  // Las dos ultimas lineas se desmienten entre si. Medido sobre
  // data/history.jsonl agrupado por corrida: 103 de las 437 corridas reales
  // (23,6%) caen en esa combinacion, y esta es una de ellas.
  assert.equal(DE_LA_CORRIDA_GRANDE.length, 15, "la corrida real trae 15 cambios de productos vigilados");
  assert.equal(BAJAS_DE_LA_CORRIDA_GRANDE.length, 9, "9 de ellos son bajas");

  const texto = await mensajesDe({
    changes: [],
    avisadosEnVivo: BAJAS_DE_LA_CORRIDA_GRANDE.length,
    detectados: DE_LA_CORRIDA_GRANDE.length,
  });
  assert.match(texto, /se detectaron 15 cambios en total/, "la nota honesta se mantiene");
  assert.doesNotMatch(texto, /Todo lo detectado ya se avisó en vivo/, "esa frase es FALSA cuando la regla filtro algo");
  assert.match(texto, /Todas las bajas de precio ya se avisaron en vivo/, "y se dice lo que si es cierto");
  assert.match(texto, /Revisión terminada/, "la señal de que la revision termino no se pierde");
});

test("...y cuando la regla no filtro nada, la frase de siempre sigue saliendo", async () => {
  // La otra mitad: sin esto, el arreglo podria haber borrado la frase para todos
  // los casos, incluido el que SI es literalmente cierto (test/cierre-vivo
  // tambien lo exige, desde el otro extremo).
  const texto = await mensajesDe({ changes: [], avisadosEnVivo: 1, detectados: 1 });
  assert.match(texto, /Todo lo detectado ya se avisó en vivo/);
  assert.doesNotMatch(texto, /se detectaron/, "no se filtro nada: no hay nota que poner");
});

test("un aviso ATRASADO que se entrega se cuenta como aviso en el encabezado", async () => {
  // DEFECTO: el encabezado decia "0 avisos" justo encima de una baja entregada.
  // `totalCambios` no sumaba `pendientes`, asi que un aviso que Discord no acepto
  // en la corrida anterior se entregaba sin contarse. Con la palabra "avisos" y
  // con la nota de la regla pegada debajo, pasaba a ser una contradiccion
  // abierta.
  const atrasada = { ...BUDS, ts: "2026-10-13T10:00:00.000Z" };
  const texto = await mensajesDe({ changes: [], pendientes: [atrasada], detectados: 5 });
  assert.match(texto, /· 1 aviso/, "el aviso atrasado ES un aviso entregado");
  assert.doesNotMatch(texto, /· 0 avisos/);
  assert.match(texto, /BAJÓ DE PRECIO/, "y de verdad se entrega");
  // y la nota sigue midiendo lo que ESTA revision detecto: el pendiente es de
  // otra corrida, asi que no puede descontarse de lo silenciado hoy
  assert.match(texto, /se detectaron 5 cambios en total/);

  // el desglose tambien tiene que sumar: 1 en vivo + 1 atrasado = 2 avisos
  const conVivo = await mensajesDe({ changes: [], avisadosEnVivo: 1, pendientes: [atrasada], detectados: 3 });
  assert.match(conVivo, /· 2 avisos \(1 ya avisados en vivo · 1 en este resumen\)/);

  // ...y los pendientes NO pueden descontarse de lo que la regla silencio: son
  // de otra corrida. Con una baja de esta revision entregada, un cambio de stock
  // silenciado y dos avisos atrasados, la nota tiene que seguir saliendo (si se
  // restara el total entregado, el numero daria negativo y la nota desaparecia
  // justo en la corrida que mas tiene que declarar).
  const conAtrasados = await mensajesDe({
    changes: [cambioDe("baja")],
    pendientes: [atrasada, { ...atrasada, modelo: "SM-OTRO" }],
    detectados: 2,
  });
  assert.match(conAtrasados, /· 3 avisos/, "1 de esta revision + 2 atrasados");
  assert.match(conAtrasados, /se detectaron 2 cambios en total/, "y la nota de lo silenciado no se pierde");
});

test("un aviso atrasado que dice 'baja' pero no baja NO se entrega", async () => {
  // DEFECTO: `esBajaDePrecio` confia en el campo `tipo`, y data/pendientes.jsonl
  // es el unico material que llega al canal de productos sin pasar por el
  // detector de esta corrida (se fusiona por UNION ante un conflicto de git y el
  // caso ambiguo se conserva al leerlo). Sembrado a mano, uno con los montos al
  // reves salia rotulado "BAJÓ DE PRECIO … De $300.000 a **$400.000**
  // (+$100.000 · +33,3%)", y uno con matiz:true salia como linea de STOCK.
  assert.equal(pendienteCreible(BUDS).ok, true, "una baja de verdad pasa");
  assert.equal(pendienteCreible({ tipo: "baja", precioAnterior: 300000, precio: 400000 }).ok, false);
  assert.match(pendienteCreible({ tipo: "baja", precioAnterior: 300000, precio: 400000 }).motivo, /no bajan/);
  assert.equal(pendienteCreible({ tipo: "baja", matiz: true }).ok, false);
  assert.match(pendienteCreible({ tipo: "baja", matiz: true }).motivo, /matiz/);
  // sin precio anterior legible no se descarta: no hay con que desmentirlo, y
  // callar un aviso atrasado es justo lo que ese archivo existe para no hacer
  assert.equal(pendienteCreible({ tipo: "baja", precio: 200000 }).ok, true);

  const sembrados = [
    BUDS,
    { ...BUDS, modelo: "P-BAJA-SUBIENDO", precioAnterior: 300000, precio: 400000 },
    { ...BUDS, modelo: "P-BAJA-MATIZ", matiz: true },
    cambioDe("sube"),
    cambioDe("stock"),
  ];
  assert.deepEqual(soloNotificables(sembrados).map((c) => c.modelo), [BUDS.modelo]);

  const texto = await mensajesDe({ changes: [], pendientes: soloNotificables(sembrados), detectados: 1 });
  assert.ok(!texto.includes("P-BAJA-SUBIENDO"), "jamas un aviso rotulado al reves");
  assert.ok(!texto.includes("P-BAJA-MATIZ"));
  assert.ok(texto.includes(BUDS.modelo), "y la baja de verdad sigue llegando");
});

test("pendientesParaAvisar lee el archivo y aplica el mismo porton", () => {
  // La composicion (leer + filtrar) vivia suelta en run.mjs, donde ninguna
  // prueba la alcanza: se le podia borrar el filtro y la suite seguia entera en
  // verde (mutante M08 de la verificacion).
  const ahora = Date.parse("2026-10-14T12:00:00.000Z");
  const ts = "2026-10-14T10:00:00.000Z";
  const texto = serializarPendientes(
    [
      { ...BUDS, ts },
      { ...cambioDe("stock"), ts },
      { ...cambioDe("sube"), ts },
      { ...BUDS, modelo: "P-INVERTIDA", precioAnterior: 1000, precio: 2000, ts },
    ],
    ts,
  );
  assert.deepEqual(pendientesParaAvisar(texto, { ahora }).map((c) => c.modelo), [BUDS.modelo]);
  assert.deepEqual(pendientesParaAvisar("", { ahora }), [], "sin archivo no revienta");
});

test("la PRIMERA linea de un aviso en vivo de bajas dice que es una baja", () => {
  // DEFECTO: la razon escrita para poner la bandera primera era la vista previa
  // del telefono, "asi se lee sin abrir Discord". Era falsa: la primera linea de
  // un mensaje en vivo es el encabezado de la tanda ("⚡ **Monitor Samsung —
  // aviso en curso** · 22:28") y la del producto va tercera, con "🔥 " delante.
  // Y ese es el camino de casi todas las bajas: en la semana real, las 11 de 11.
  const dos = encabezadoTanda([cambioDe("baja"), cambioDe("baja")], { pagina: 300, totalPaginas: 1170 });
  const primera = dos.split("\n")[0];
  assert.match(primera, /🟢⬇️/, "la flecha verde, en la linea que muestra el push");
  assert.match(primera, /\*\*BAJÓ DE PRECIO: 2 productos\*\*/);
  assert.doesNotMatch(primera, /aviso en curso/, "la frase vieja no decia lo que pasaba");
  // y no se pierde ninguna de las dos cosas que el encabezado tiene que decir
  assert.match(dos, /revisando página 300 de 1170/);
  assert.match(dos, /_\(la revisión sigue en marcha\)_/);

  const una = encabezadoTanda([cambioDe("baja")], { pagina: 1, totalPaginas: 2 });
  assert.match(una, /\*\*BAJÓ DE PRECIO: 1 producto\*\*/, "singular");

  // Y SI LA REGLA SE REVIERTE, el encabezado vuelve solo al resumen por iconos:
  // una tanda con tipos mezclados no puede anunciarse como si fuera toda bajas.
  const mezclada = encabezadoTanda([cambioDe("baja"), cambioDe("stock")], { pagina: 5, totalPaginas: 9 });
  assert.match(mezclada, /⚡ \*\*Monitor Samsung — aviso en curso\*\*/);
  assert.match(mezclada, /🟢 1 · 📦 1 · revisando página 5 de 9/);
  assert.doesNotMatch(mezclada, /BAJÓ DE PRECIO/, "seria falso: no todas son bajas");
});

test("repartirCierre devuelve los dos contadores de la regla, y no los calcula run.mjs", () => {
  // DEFECTO: la formula `Math.max(0, detectados - (paraDiscord.length +
  // suprimidos))` y el `cambios.filter(esDeProductoVigilado).length` vivian
  // sueltos en run.mjs. Medido: borrarlos dejaba la suite entera en verde, y con
  // ellos se va la unica red contra "el detector se rompio y nadie se entera".
  const cambios = [
    cambioDe("baja"),
    cambioDe("sube", { modelo: "SM-SUBE" }),
    cambioDe("stock", { modelo: "SM-STOCK" }),
    cambioDe("baja", { modelo: "ACC-1", categoria: "Accesorios móviles" }),
  ];
  const r = repartirCierre(cambios, null);
  assert.equal(r.detectados, 3, "el accesorio no es un producto vigilado");
  assert.equal(r.paraDiscord.length, 1);
  assert.equal(r.suprimidos, 0);
  assert.equal(r.noNotificadosPorRegla, 2, "la suba y el cambio de stock");

  // una baja que ya salio en vivo cuenta como ENTREGADA, no como silenciada
  const despachador = { yaEnviado: (c) => c.tipo === "baja" && c.modelo === "SM-X" };
  const conVivo = repartirCierre(cambios, despachador);
  assert.equal(conVivo.paraDiscord.length, 0);
  assert.equal(conVivo.suprimidos, 1);
  assert.equal(conVivo.detectados, 3);
  assert.equal(conVivo.noNotificadosPorRegla, 2, "sigue siendo 2: la baja se entrego, no se silencio");

  // y sobre la semana REAL los dos numeros son los del encargo
  const semana = repartirCierre(FOTO.eventos, null);
  assert.equal(semana.detectados, NOTIFICABLES_DE_LA_SEMANA);
  assert.equal(semana.paraDiscord.length, BAJAS_DE_LA_SEMANA);
  assert.equal(semana.noNotificadosPorRegla, NOTIFICABLES_DE_LA_SEMANA - BAJAS_DE_LA_SEMANA, "174");
});

test("el PULSO del dia le lleva los dos numeros al operador, por el canal tecnico", () => {
  // DEFECTO: la nota del encabezado solo sale si hay mensaje de cierre, y
  // notifyDiscord corta temprano cuando no hay nada que mandar -- justo el caso
  // de una corrida con cambios detectados y 0 bajas. Medido sobre
  // data/history.jsonl agrupado por corrida: 283 de las 437 corridas reales
  // (64,8%) no mandarian NI UN mensaje al canal de productos, con 11.348 cambios
  // dentro; en la semana del operador, 64 de 67 corridas mudas con 168 cambios.
  // Los dos contadores quedaban solo en data/ejecuciones.jsonl, que el operador
  // no lee.
  const fila = (inicio, cambiosDetectados, noNotificadosPorRegla) =>
    JSON.stringify({ inicio, cambiosDetectados, noNotificadosPorRegla });
  const texto = [
    fila("2026-10-14T01:00:00.000Z", 40, 40), // 40 detectados, 0 bajas
    fila("2026-10-14T05:00:00.000Z", 12, 10), // 2 bajas
    JSON.stringify({ inicio: "2026-10-14T06:00:00.000Z" }), // fila vieja, sin los contadores
    "{basura que no parsea",
    fila("2026-10-12T05:00:00.000Z", 999, 999), // fuera de la ventana de 24 h
  ].join("\n");

  const p = pulsoDeLaRegla(texto, {
    ahora: "2026-10-14T12:00:00.000Z",
    deEstaCorrida: { cambiosDetectados: 3, noNotificadosPorRegla: 1 },
  });
  assert.equal(p.corridas, 4, "las 3 de la ventana mas esta corrida; la de anteayer no entra");
  assert.equal(p.conDato, 3, "la fila vieja no trae los contadores y se cuenta aparte");
  assert.equal(p.detectados, 55, "40 + 12 + 3");
  assert.equal(p.avisados, 4, "0 + 2 + 2");

  const mensaje = mensajePulsoDeLaRegla(p);
  assert.match(mensaje, /pulso del día/i);
  assert.match(mensaje, /\*\*55 cambios detectados\*\*/);
  assert.match(mensaje, /\*\*4 avisos de baja de precio\*\*/);
  assert.match(mensaje, /queda en el historial/, "dice donde esta lo que no llega");
  assert.match(mensaje, /no es un aviso de producto/, "el operador tiene que poder distinguirlo");
  assert.doesNotMatch(mensaje, /Cero cambios detectados/, "hubo cambios: no hay nada que sospechar");

  // Y EL CASO QUE JUSTIFICA TODO: el sitio quieto se distingue del detector roto
  const roto = mensajePulsoDeLaRegla(
    pulsoDeLaRegla(fila("2026-10-14T01:00:00.000Z", 0, 0), { ahora: "2026-10-14T12:00:00.000Z" }),
  );
  assert.match(roto, /\*\*0 cambios detectados\*\*/);
  assert.match(roto, /Cero cambios detectados en 24 h/, "sin esto, una semana sin bajas no se distingue de un monitor roto");
});

test("el aviso TECNICO de rebotes no puede contradecir a esNotificable", () => {
  // DEFECTO: el canal tecnico no se filtra -- y por eso no se toco una linea de
  // codigo --, pero su TEXTO quedo prometiendo lo contrario de lo que pasa.
  // Decia, en negrita, "**No dejo de avisarte nada**" y "Una reposición nunca
  // entra acá: 'volvió el stock' sale siempre como alerta fuerte". Medido: de los
  // 121 rebotes de productos vigilados del historial, 101 (82 de stock + 19
  // subas) ya no llegan al canal de productos.
  const texto = mensajeRebotando([
    { modelo: "F-SMS94EPT602", magnitud: "stock", valor: "agotado", valores: ["no-comprable"] },
    { modelo: "LS32DG300ELXZS", magnitud: "precio", valores: [199990, 279990] },
  ]);
  const stockLlega = esNotificable(cambioDe("stock"));
  const subaLlega = esNotificable(cambioDe("sube"));
  assert.equal(esNotificable(cambioDe("baja")), true, "la baja es lo que sigue llegando");

  if (!stockLlega || !subaLlega) {
    assert.match(texto, /no te llega nada desde tu regla del 2026-10-14/, "el texto tiene que decir lo que la regla apaga");
    assert.doesNotMatch(texto, /Una reposición nunca entra acá/, "prometia una alerta que ya no existe");
    assert.doesNotMatch(texto, /\*\*No dejo de avisarte nada\*\*/, "a secas es falso: solo vale para las bajas");
  } else {
    // si algun dia se revierte la regla, la promesa general vuelve a ser cierta
    assert.match(texto, /\*\*No dejo de avisarte nada\*\*/);
  }
  // la promesa que SI vale hoy, y que no se puede perder: una baja que rebota
  // sigue saliendo compacta (callarla es el defecto grave del 2026-09-13)
  assert.match(texto, /De las bajas de precio no dejo de avisarte nada/);
  assert.match(texto, /Siguen rebotando/);
});
