// EL CENSO: LO QUE SALIO DEL CANDADO TIENE QUE SEGUIR VIVO EN ALGUNA PARTE.
//
// Este archivo defiende la otra mitad del arreglo del 2026-09-23. La primera
// mitad -- que ninguna prueba del candado dependa de datos que cambian solos --
// la vigila test/candado-offline.test.mjs. Pero sacar una comprobacion del
// candado y no ponerla en ningun lado no es desacoplar: es borrarla. Aca se fija
// que cada pregunta que se mudo siga teniendo quien la haga, y que sus umbrales
// signifiquen lo que dicen.
//
// EL ESCENARIO QUE MAS IMPORTA de este archivo es "el censo habria visto venir el
// incidente": el par de estados reales medidos a los dos lados de la pared del
// 80%, el 2026-09-22 entre las 07:02Z y las 08:27Z.
//
// LOS DATOS DE ESTE ARCHIVO SON CONSTRUIDOS, NO HEREDADOS, y esa es la leccion
// del incidente aplicada a si misma: un catalogo de juguete con las proporciones
// puestas a mano no puede cambiar de significado porque Samsung publique paginas.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ALARMA,
  ATENCION,
  COMPLETAS_QUE_SE_MIRAN,
  DIAS_DE_SERIE,
  OK,
  censar,
  claveDeCenso,
  completasSospechosas,
  derivaDe,
  filaDeCenso,
  fixtureAlDia,
  formaDe,
  leerSerie,
  mensajeCenso,
  peorEstado,
  resumenDeCenso,
  serializarSerie,
  ultimaClaveAvisada,
} from "../src/censo.mjs";
import { TOLERANCIA_ENCOGIMIENTO } from "../src/alcance.mjs";

// ---------------------------------------------------------------------------
// UN SITIO DE JUGUETE CON LAS PROPORCIONES PUESTAS A MANO
//
// `seed` son las paginas del listado (las que el descubrimiento NO aporta) y
// `familia` las que solo existen porque el sitemap las encontro. La razon entre
// las dos es justo lo que el censo mide, asi que se declara aca en vez de
// deducirse de ningun archivo.
// ---------------------------------------------------------------------------
const paginaSeed = (i) => `https://www.samsung.com/cl/smartphones/ficha-${i}/`;
const paginaFamilia = (i) => `https://www.samsung.com/cl/smartphones/galaxy-familia-${i}/buy/`;

function sitio({ seedPaginas = 40, skuPorSeed = 1, familiaPaginas = 10, skuPorFamilia = 1, vivosFueraDelBloque = 0, teleFuera = true } = {}) {
  const seed = [];
  const catalogo = {};
  for (let i = 0; i < seedPaginas; i++) {
    seed.push({ categoria: "Smartphones", subcategoria: null, nombre: null, variante: null, modelo: null, url: paginaSeed(i), tipo: "listado" });
    for (let j = 0; j < skuPorSeed; j++) {
      catalogo[`SEED-${i}-${j}`] = { modelo: `SEED-${i}-${j}`, categoria: "Smartphones", url: paginaSeed(i), paginaOrigen: paginaSeed(i), presencia: "activo", precio: 100 };
    }
  }
  for (let i = 0; i < familiaPaginas; i++) {
    for (let j = 0; j < skuPorFamilia; j++) {
      catalogo[`FAM-${i}-${j}`] = { modelo: `FAM-${i}-${j}`, categoria: "Smartphones", url: paginaFamilia(i), paginaOrigen: paginaFamilia(i), presencia: "activo", precio: 100 };
    }
  }
  // Productos de fuera del bloque liviano: viven en una seccion que no es
  // principal, asi que el bloque no los recorre.
  for (let i = 0; i < vivosFueraDelBloque; i++) {
    const url = `https://www.samsung.com/cl/tvs/tele-${i}/`;
    seed.push({ categoria: "Televisores", subcategoria: null, nombre: null, variante: null, modelo: null, url, tipo: "listado" });
    catalogo[`TV-${i}`] = { modelo: `TV-${i}`, categoria: teleFuera ? "Televisores" : "Smartphones", url, paginaOrigen: url, presencia: "activo", precio: 100 };
  }
  return { seed, catalogo };
}

const EJECUCIONES_CON_COMPLETA = [
  JSON.stringify({ modo: "liviano", alcance: "principales", fin: "2026-09-22T05:00:00Z", paginasDelAlcance: 347 }),
  JSON.stringify({ modo: "completo", alcance: "todo", fin: "2026-09-22T08:00:00Z", paginasDelAlcance: 1185 }),
].join("\n");

const de = (censo, clave) => censo.indicadores.find((i) => i.clave === clave);

// ---------------------------------------------------------------------------
// 1. EL INCIDENTE: LOS DOS ESTADOS REALES A LOS DOS LADOS DE LA PARED DEL 80%
// ---------------------------------------------------------------------------

test("EL CENSO HABRIA VISTO VENIR EL INCIDENTE: avisa a 81,8% y VUELVE A HABLAR cuando la raya se cruza", () => {
  // LOS DOS ESTADOS ESTAN MEDIDOS, snapshot a snapshot, sobre el historial de
  // git del catalogo de produccion:
  //
  //   2026-09-22T07:02:54Z   1046 SKU   948 vivos   82,1% observables
  //   2026-09-22T08:27:50Z   1077 SKU   981 vivos   79,5% observables -> la prueba fallaba
  //
  // La ultima corrida buena (07:47Z) cae justo entre esas dos. Una revision
  // completa agrego 33 SKU vivos y movio la razon 2,6 puntos al otro lado de la
  // raya. Con el arreglo de hoy eso ya no apaga el monitor -- pero tiene que
  // seguir sabiendose, y este es el lugar donde se sabe.
  //
  // CUIDADO CON LA POLARIDAD, QUE LA PRIMERA VERSION DE ESTA PRUEBA TENIA AL
  // REVES (corregido el 2026-09-23, segunda vuelta). Cruzar hacia abajo NO es
  // una falla: `evaluarConfiabilidad` marca la corrida cuando
  // `encontrados < esperados * 0.8`, asi que POR DEBAJO del 80% una caida del
  // descubrimiento la atrapan las TRES redes, y por encima solo dos. El 79,5%
  // de hoy salia como ALARMA por tener la pregunta contestada al reves, y por
  // eso el censo nacia en rojo y no se apagaba nunca (medido: 0 verdes en los
  // 532 snapshots del historial).
  //
  // Lo que SI tiene que pasar, y es lo que esta prueba fija: que el censo hable
  // ANTES de la raya y VUELVA A HABLAR al cruzarla, porque cruzar cambia cuales
  // redes quedan y deja sin premisa a la prueba que vigila ese agujero.
  //
  // Las proporciones se CONSTRUYEN, que es la leccion del incidente aplicada a
  // esta misma prueba: 90 paginas de listado con 2 SKU cada una son 180
  // observables; los SKU que cuelgan solo de las 10 paginas descubiertas mueven
  // la razon a voluntad sin tocar nada mas.
  const antes = sitio({ seedPaginas: 90, skuPorSeed: 2, familiaPaginas: 10, skuPorFamilia: 4 }); // 180 de 220 = 81,8%
  const despues = sitio({ seedPaginas: 90, skuPorSeed: 2, familiaPaginas: 10, skuPorFamilia: 5 }); // 180 de 230 = 78,3%

  const cAntes = censar({ catalogo: antes.catalogo, seed: antes.seed, ejecuciones: EJECUCIONES_CON_COMPLETA });
  const cDespues = censar({ catalogo: despues.catalogo, seed: despues.seed, ejecuciones: EJECUCIONES_CON_COMPLETA });

  const iAntes = de(cAntes, "observables-sin-descubrimiento");
  const iDespues = de(cDespues, "observables-sin-descubrimiento");

  assert.ok(iAntes.valor > 0.8, `el estado "antes" tiene que estar arriba del 80%, y da ${iAntes.valor}`);
  assert.equal(iAntes.estado, ATENCION, "estar 1,8 puntos de la raya tiene que avisar, no quedarse callado: ESO es lo que falto el 2026-09-22");
  assert.match(iAntes.texto, /arriba de la raya del 80\.0%, a 1\.8 puntos/);
  assert.match(iAntes.texto, /la atrapan solo/, "el texto dejo de decir que arriba de la raya quedan dos redes y no tres");

  assert.ok(iDespues.valor < 0.8);
  assert.equal(iDespues.estado, ATENCION, "cruzar la raya NO es una falla: abajo del 80% la caida la atrapan las tres redes, no una menos");
  assert.match(iDespues.texto, /abajo de la raya del 80\.0%/);
  assert.match(iDespues.texto, /las TRES redes/);

  // NINGUN LADO DE LA RAYA ES UNA ALARMA. Si esto se vuelve ALARMA, el censo
  // vuelve a nacer en rojo el dia uno.
  assert.notEqual(iAntes.estado, ALARMA);
  assert.notEqual(iDespues.estado, ALARMA);

  // Y CRUZAR TIENE QUE CAMBIAR LA CLAVE DEL FRENO: si no, el sistema se queda
  // callado justo en el unico momento en que tiene algo nuevo que decir.
  assert.notEqual(
    claveDeCenso(cAntes),
    claveDeCenso(cDespues),
    "cruzar la raya no cambio la clave: el freno se comeria el aviso del cruce, que es el evento entero",
  );

  // Y LOS DOS TIENEN QUE SALIR EN EL MENSAJE. Un indicador que cambia de estado
  // y no llega a Discord es exactamente lo que no sirve.
  assert.match(mensajeCenso(cAntes) ?? "", /80\.0%/);
  assert.match(mensajeCenso(cDespues) ?? "", /abajo de la raya del 80\.0%/);
});

test("LEJOS de la raya el censo se calla: el 2026-09-22 estaba a 2,1 puntos, no a 20", () => {
  // La contraparte de la prueba de arriba. Un indicador que habla en los dos
  // lados y a cualquier distancia no es un indicador: es ruido con forma de
  // alerta. Medido sobre los 532 snapshots con este mismo colchon de 3 puntos:
  // 345 quedan en verde y 187 avisan, y los 187 son exactamente las semanas de
  // septiembre en que el sistema estuvo a 2,7-2,9 puntos de la raya sin que
  // nadie lo supiera.
  const lejosArriba = sitio({ seedPaginas: 90, skuPorSeed: 2, familiaPaginas: 10, skuPorFamilia: 1 }); // 180 de 190 = 94,7%
  const lejosAbajo = sitio({ seedPaginas: 90, skuPorSeed: 2, familiaPaginas: 10, skuPorFamilia: 10 }); // 180 de 280 = 64,3%
  for (const s of [lejosArriba, lejosAbajo]) {
    const i = de(censar({ ...s, ejecuciones: EJECUCIONES_CON_COMPLETA }), "observables-sin-descubrimiento");
    assert.equal(i.estado, OK, `a ${(Math.abs(i.valor - 0.8) * 100).toFixed(1)} puntos de la raya el censo tiene que callarse, y dijo ${i.estado}`);
  }
});

test("EL COLCHON ES RELATIVO AL PISO, y sin eso el censo nace en rojo y no se apaga nunca", () => {
  // MEDIDO SOBRE LOS 532 SNAPSHOTS DEL HISTORIAL. El colchon del piso era de 5
  // PUNTOS absolutos para todos. Sobre un piso del 10% eso significa exigir 15%
  // para estar en verde, o sea una vez y media la raya: `aporte-descubrimiento`
  // daba CERO verdes en 532 snapshots -- 192 atencion + 340 alarma -- y con el
  // 13,5% de hoy quedaba en ATENCION permanente. Un canario calibrado para
  // chillar todos los dias es la forma mas rapida de que deje de leerse, y lo
  // que se juega ahi es todo lo que se mudo del candado al censo.
  //
  // Con el colchon relativo (25% del piso = 2,5 puntos sobre un piso de 10):
  // 188 verdes, 4 atencion, 340 alarma -- y los 340 son julio y agosto, cuando
  // el aporte de verdad andaba entre 5,0% y 7,4%.
  //
  // El sitio de esta prueba reproduce la proporcion real de hoy: 13,5% de las
  // paginas vienen del descubrimiento.
  const { catalogo, seed } = sitio({ seedPaginas: 865, familiaPaginas: 135 }); // 135 de 1000 = 13,5%
  const i = de(censar({ catalogo, seed, ejecuciones: EJECUCIONES_CON_COMPLETA }), "aporte-descubrimiento");
  assert.ok(Math.abs(i.valor - 0.135) < 0.001, `el sitio de la prueba tiene que dar 13,5% y dio ${i.valor}`);
  assert.equal(i.estado, OK, "con 3,5 puntos de margen sobre un piso de 10 el censo tiene que estar en verde: si no, habla todos los dias desde el dia uno");

  // y el colchon sigue existiendo: justo encima del piso SI avisa
  const apretado = sitio({ seedPaginas: 890, familiaPaginas: 110 }); // 11,0%
  const j = de(censar({ ...apretado, ejecuciones: EJECUCIONES_CON_COMPLETA }), "aporte-descubrimiento");
  assert.equal(j.estado, ATENCION, "un margen de 1 punto sobre el piso tiene que avisar antes de cruzarlo");
  assert.match(j.texto, /queda poco/);
});

test("un sitio sano no dice nada, y para eso hacen falta las DOS holguras a la vez", () => {
  // La contraparte obligatoria: si el censo hablara siempre, el operador dejaria
  // de leerlo y volveriamos a un sistema que avisa y nadie escucha.
  //
  // OJO CON LA ARITMETICA, que no es obvia: los dos pisos tiran para lados
  // contrarios. `aporte-descubrimiento` exige que el descubrimiento traiga >=10%
  // de las PAGINAS; `observables-sin-descubrimiento` exige que de el cuelgue
  // <=20% de los SKU. Las dos cosas a la vez solo se cumplen si las paginas
  // descubiertas traen MENOS SKU por pagina que las del listado -- que es justo
  // como es el sitio real (13,5% de las paginas y 20,5% de los SKU, o sea que
  // ahi viene al reves y por eso el segundo indicador esta en alarma hoy).
  // 80 paginas de listado con 2 SKU = 160; 20 familia con 1 SKU = 20.
  // Paginas: 20 de 100 = 20% (sobre el piso). Observables: 160 de 180 = 88,9%.
  const { catalogo, seed } = sitio({ seedPaginas: 80, skuPorSeed: 2, familiaPaginas: 20, skuPorFamilia: 1 });
  const censo = censar({ catalogo, seed, ejecuciones: EJECUCIONES_CON_COMPLETA });
  const habla = censo.indicadores.filter((i) => i.estado !== OK).map((i) => i.clave);
  // las bandas de 1185/347/216/797/733 no aplican a un sitio de juguete: se
  // miran solo las que son proporciones, que son las que tienen sentido aca
  const proporciones = ["aporte-descubrimiento", "observables-sin-descubrimiento", "completas-sospechosas", "ejecuciones-con-completa", "premisa-sku-dentro-del-bloque"];
  assert.deepEqual(
    habla.filter((c) => proporciones.includes(c)),
    [],
    "un sitio sano disparo un aviso del censo",
  );
});

// ---------------------------------------------------------------------------
// 2. CADA PREGUNTA QUE SALIO DEL CANDADO TIENE QUIEN LA HAGA
// ---------------------------------------------------------------------------

test("el censo cubre, una por una, las comprobaciones que dejaron de bloquear la corrida", () => {
  // ESTA ES LA PRUEBA QUE IMPIDE QUE "DESACOPLAR" SE CONVIERTA EN "BORRAR".
  //
  // Cada clave de esta lista es una asercion que hasta el 2026-09-23 vivia en
  // `npm test` y podia apagar el monitor. Si alguien saca una del censo, la
  // pregunta deja de hacerse en TODO el sistema y esta prueba lo caza.
  //
  // De donde salio cada una:
  //   recorrido-completo / bloque-liviano / bloque-cyber  -> los cercaDe(1185),
  //     cercaDe(347) y cercaDe(216) de test/alcance.test.mjs (los dos primeros
  //     tumbaban 237 de 532 snapshots; el del Cyber, los 340).
  //   registros-fuera-del-bloque / vivos-fuera-del-bloque -> cercaDe(797) y
  //     cercaDe(733) de la prueba "no le toca UN SOLO BYTE".
  //   aporte-descubrimiento -> la guarda de linea 360 de alcance-revision, la
  //     que el arreglo del 2026-09-22 dejo heredada.
  //   observables-sin-descubrimiento -> la guarda del umbral del 80%: LA QUE
  //     TUMBO EL MONITOR.
  //   vivos-sin-pagina -> la guarda de "una revision completa SANA no dispara el
  //     chequeo de productos sin pagina".
  //   premisa-* -> "no se encontro un televisor fuera del bloque" y "no se
  //     encontro un SKU vivo dentro del bloque", las dos premisas que las
  //     pruebas de censo buscaban en el catalogo real.
  //   ejecuciones-con-completa -> la segunda dependencia mutable del candado.
  //   fixture-al-dia -> lo nuevo: que la foto congelada no se quede vieja.
  const { catalogo, seed } = sitio();
  const censo = censar({ catalogo, seed, ejecuciones: EJECUCIONES_CON_COMPLETA, fixture: catalogo });
  assert.deepEqual(
    censo.indicadores.map((i) => i.clave).sort(),
    [
      "aporte-descubrimiento",
      "bloque-cyber",
      "bloque-liviano",
      "completas-sospechosas",
      "ejecuciones-con-completa",
      "fixture-al-dia",
      "observables-sin-descubrimiento",
      "premisa-sku-dentro-del-bloque",
      "premisa-tele-fuera-del-bloque",
      "recorrido-completo",
      "registros-fuera-del-bloque",
      "vivos-fuera-del-bloque",
    ],
    "el censo perdio (o gano) un indicador: si se saco uno, esa pregunta dejo de hacerse en todo el sistema",
  );
  // y cada indicador tiene que traer un texto que se pueda leer en Discord
  for (const i of censo.indicadores) {
    assert.ok(i.texto && i.texto.length > 10, `el indicador ${i.clave} no dice nada`);
    assert.ok([OK, ATENCION, ALARMA].includes(i.estado), `el indicador ${i.clave} tiene un estado raro: ${i.estado}`);
  }
});

test("el piso del aporte del descubrimiento es el MISMO numero que usa la corrida", () => {
  // Si el censo mirara un umbral propio, podria decir "todo bien" mientras la
  // corrida se marca sospechosa por encogimiento, o al reves. Los dos numeros
  // tienen que venir de src/alcance.mjs.
  const { catalogo, seed } = sitio({ seedPaginas: 95, familiaPaginas: 5 }); // 5 de 100 = 5% < 10%
  const censo = censar({ catalogo, seed, ejecuciones: EJECUCIONES_CON_COMPLETA });
  const i = de(censo, "aporte-descubrimiento");
  assert.equal(i.referencia, TOLERANCIA_ENCOGIMIENTO);
  assert.equal(i.estado, ALARMA, `con el descubrimiento aportando ${i.valor} el censo tiene que hablar`);
});

test("dos revisiones completas sospechosas seguidas son una alarma: ese dia no se declaro ningun desaparecido", () => {
  // Es el reemplazo del indicador que la prueba del candado miraba y que aca
  // seria decorativo (ver el comentario largo en src/censo.mjs): el recorrido de
  // este modulo se reconstruye DEL catalogo, asi que "productos vivos sin
  // pagina" da 0 por construccion, con cualquier catalogo. Medido sobre el
  // catalogo real: 981 vivos, 0 sin pagina, 0 paginas descartadas.
  // Lo que si existe es el VEREDICTO que la corrida ya escribio.
  const { catalogo, seed } = sitio();
  const fila = (extra) => JSON.stringify({ modo: "completo", alcance: "todo", fin: "2026-09-22T08:00:00Z", ...extra });
  const sanas = [fila({ confiable: true }), fila({ confiable: true })].join("\n");
  const una = [fila({ confiable: true }), fila({ confiable: false, motivos: [{ tipo: "sku-sin-pagina" }] })].join("\n");
  const dos = [fila({ confiable: false, motivos: [{ tipo: "recorrido-encogido" }] }), fila({ confiable: false, motivos: [{ tipo: "sku-sin-pagina" }] })].join("\n");

  assert.equal(de(censar({ catalogo, seed, ejecuciones: sanas }), "completas-sospechosas").estado, OK);
  assert.equal(de(censar({ catalogo, seed, ejecuciones: una }), "completas-sospechosas").estado, ATENCION, "una completa sospechosa tiene que avisar");
  assert.equal(de(censar({ catalogo, seed, ejecuciones: dos }), "completas-sospechosas").estado, ALARMA, "dos seguidas son un dia sin deteccion de desaparecidos");
});

test("solo cuentan las revisiones COMPLETAS, y una linea ilegible no tumba el censo", () => {
  // En una revision liviana, no ver el 73% del catalogo es la normalidad: si las
  // livianas contaran, el indicador estaria en alarma permanente y no
  // significaria nada. Y `ejecuciones.jsonl` se fusiona por union entre corridas
  // concurrentes (.gitattributes), asi que una linea mezclada es posible.
  const livianasRotas = [
    JSON.stringify({ modo: "liviano", alcance: "principales", confiable: false, motivos: [{ tipo: "errores" }] }),
    JSON.stringify({ modo: "liviano", alcance: "principales", confiable: false, motivos: [{ tipo: "errores" }] }),
    "{esto no es json",
    JSON.stringify({ modo: "completo", alcance: "todo", confiable: true }),
  ].join("\n");
  assert.deepEqual(completasSospechosas(livianasRotas), []);
  // una fila sin `modo` es anterior al cambio del 2026-09-12: eran todas completas
  assert.equal(completasSospechosas(JSON.stringify({ confiable: false, motivos: [{ tipo: "errores" }] })).length, 1);
  assert.deepEqual(completasSospechosas(""), []);
  assert.deepEqual(completasSospechosas(null), []);
});

test("se miran las ULTIMAS completas, no las primeras", () => {
  // Invertir el corte dejaria el indicador clavado en la historia antigua: el
  // sistema diria que viene sano para siempre, que es como se apaga un canario
  // sin que se note.
  const viejasRotas = [
    JSON.stringify({ modo: "completo", fin: "2026-08-01T00:00:00Z", confiable: false, motivos: [{ tipo: "errores" }] }),
    JSON.stringify({ modo: "completo", fin: "2026-08-02T00:00:00Z", confiable: false, motivos: [{ tipo: "errores" }] }),
    ...Array.from({ length: COMPLETAS_QUE_SE_MIRAN }, (_, i) => JSON.stringify({ modo: "completo", fin: `2026-09-2${i}T00:00:00Z`, confiable: true })),
  ].join("\n");
  assert.deepEqual(completasSospechosas(viejasRotas), [], "el indicador se quedo mirando corridas viejas");

  const nuevasRotas = [
    ...Array.from({ length: COMPLETAS_QUE_SE_MIRAN }, (_, i) => JSON.stringify({ modo: "completo", fin: `2026-08-0${i}T00:00:00Z`, confiable: true })),
    JSON.stringify({ modo: "completo", fin: "2026-09-22T00:00:00Z", confiable: false, motivos: [{ tipo: "sku-sin-pagina" }] }),
  ].join("\n");
  assert.deepEqual(completasSospechosas(nuevasRotas).map((c) => c.motivos), [["sku-sin-pagina"]]);
});

test("las premisas de las pruebas de censo se denuncian cuando el catalogo deja de cumplirlas", () => {
  // Es el unico aviso que queda de que una prueba congelada dejo de parecerse a
  // la realidad. Sin esto, la fixture sigue verde para siempre y nadie se entera.
  const conTele = sitio({ vivosFueraDelBloque: 3, teleFuera: true });
  const sinTele = sitio({ vivosFueraDelBloque: 3, teleFuera: false });
  assert.equal(de(censar({ ...conTele, ejecuciones: EJECUCIONES_CON_COMPLETA }), "premisa-tele-fuera-del-bloque").estado, OK);
  assert.equal(de(censar({ ...sinTele, ejecuciones: EJECUCIONES_CON_COMPLETA }), "premisa-tele-fuera-del-bloque").estado, ALARMA);

  const vacio = { catalogo: {}, seed: conTele.seed };
  assert.equal(de(censar({ ...vacio, ejecuciones: EJECUCIONES_CON_COMPLETA }), "premisa-sku-dentro-del-bloque").estado, ALARMA);
});

test("un archivo de ejecuciones sin ninguna revision completa se denuncia en vez de tumbar la corrida", () => {
  // Medido: con este archivo vacio -- un clon nuevo, o una rotacion -- la prueba
  // que lo leia fallaba y bloqueaba el monitor. Ahora esto.
  const { catalogo, seed } = sitio();
  const soloLivianas = JSON.stringify({ modo: "liviano", alcance: "principales", fin: "2026-09-22T05:00:00Z" });
  assert.equal(de(censar({ catalogo, seed, ejecuciones: "" }), "ejecuciones-con-completa").estado, ALARMA);
  assert.equal(de(censar({ catalogo, seed, ejecuciones: soloLivianas }), "ejecuciones-con-completa").estado, ALARMA);
  assert.equal(de(censar({ catalogo, seed, ejecuciones: EJECUCIONES_CON_COMPLETA }), "ejecuciones-con-completa").estado, OK);
});

// ---------------------------------------------------------------------------
// 3. LA FIXTURE CONGELADA NO SE PUEDE QUEDAR VIEJA EN SILENCIO
// ---------------------------------------------------------------------------

test("la forma de un catalogo son los campos que trae al menos la mitad de sus registros", () => {
  // La mitad y no "alguno": un campo de diagnostico que aparece en tres
  // registros no es parte de la forma, y contarlo haria que el aviso de fixture
  // vencida saliera por ruido en cada corrida.
  const catalogo = {
    A: { modelo: "A", precio: 1, raro: 1 },
    B: { modelo: "B", precio: 2 },
    C: { modelo: "C", precio: 3 },
    D: { modelo: "D", precio: 4 },
  };
  assert.deepEqual(formaDe(catalogo), ["modelo", "precio"]);
  assert.deepEqual(formaDe({}), []);
  // en el borde exacto de la mitad, el campo cuenta
  assert.deepEqual(formaDe({ A: { x: 1, y: 1 }, B: { x: 1 } }), ["x", "y"]);
});

test("el censo avisa cuando el catalogo estrena un campo que la fixture no tiene", () => {
  // ES LA RESPUESTA A "¿Y SI NADIE REFRESCA LA FIXTURE?". Medido sobre los 532
  // snapshots: la forma del catalogo cambio 4 veces en 65 dias -- 2026-07-25,
  // 07-30 y 09-12 -- y las tres veces en el MISMO commit que agrego el campo.
  // O sea que refrescar la fixture no es mantenimiento periodico: es parte del
  // cambio que lo causa. Esto es lo que lo recuerda si se olvida igual.
  const foto = { A: { modelo: "A", precio: 1 }, B: { modelo: "B", precio: 2 } };
  const hoy = { A: { modelo: "A", precio: 1, rango: 3 }, B: { modelo: "B", precio: 2, rango: 3 } };

  assert.equal(fixtureAlDia(foto, foto).estado, OK);
  const vencida = fixtureAlDia(hoy, foto);
  assert.equal(vencida.estado, ATENCION, "la fixture se quedo sin un campo nuevo y el censo no dijo nada");
  assert.match(vencida.texto, /rango/);
  assert.match(vencida.texto, /LEEME/);

  // y tambien al reves: un campo que la fixture tiene y el catalogo ya no
  const alReves = fixtureAlDia(foto, hoy);
  assert.equal(alReves.estado, ATENCION);
  assert.match(alReves.texto, /rango/);
});

test("un cambio de VALORES no vence la fixture: lo que se compara son los campos", () => {
  // Los valores de la fixture estan viejos a proposito y para siempre. Si el
  // aviso mirara valores, saldria en cada corrida y habria que apagarlo.
  const foto = { A: { modelo: "A", precio: 1 }, B: { modelo: "B", precio: 2 } };
  const otrosValores = { A: { modelo: "A", precio: 999 }, Z: { modelo: "Z", precio: 7 } };
  assert.equal(fixtureAlDia(otrosValores, foto).estado, OK);
});

// ---------------------------------------------------------------------------
// 4. EL MENSAJE Y EL RESUMEN
// ---------------------------------------------------------------------------

test("cuando todo esta en verde el censo NO manda ningun mensaje", () => {
  assert.equal(mensajeCenso({ indicadores: [{ clave: "x", estado: OK, texto: "bien" }], estado: OK }), null);
});

test("el mensaje pone las alarmas antes que las atenciones y dice que no detiene nada", () => {
  const censo = {
    estado: ALARMA,
    indicadores: [
      { clave: "a", estado: ATENCION, texto: "queda poco margen" },
      { clave: "b", estado: OK, texto: "esto no tiene que salir" },
      { clave: "c", estado: ALARMA, texto: "se cruzo la raya" },
    ],
  };
  const texto = mensajeCenso(censo, { timestamp: "2026-09-23T12:00:00Z" });
  assert.ok(texto.indexOf("se cruzo la raya") < texto.indexOf("queda poco margen"), "una alarma quedo debajo de una atencion");
  assert.equal(texto.includes("esto no tiene que salir"), false, "un indicador en verde se colo al mensaje");
  assert.match(texto, /no\*{0,2} detiene el monitor/, "el mensaje no dice que esto no bloquea: es lo primero que el operador necesita saber");
  assert.match(texto, /2026-09-23T12:00:00Z/);
});

test("el peor estado manda sobre el resto", () => {
  assert.equal(peorEstado([]), OK);
  assert.equal(peorEstado([{ estado: OK }, { estado: ATENCION }]), ATENCION);
  assert.equal(peorEstado([{ estado: ATENCION }, { estado: ALARMA }, { estado: OK }]), ALARMA);
});

test("los numeros del censo quedan en el resumen de la corrida, tambien los que estan bien", () => {
  // Sin la serie completa, la deriva del 79,5% solo se pudo reconstruir a mano
  // desde git DESPUES del incidente. Guardar solo los que estan mal repetiria
  // ese error: lo que hace falta es la curva, no el ultimo punto.
  const { catalogo, seed } = sitio();
  const censo = censar({ catalogo, seed, ejecuciones: EJECUCIONES_CON_COMPLETA });
  const r = resumenDeCenso(censo);
  assert.equal(r.censoEstado, censo.estado);
  assert.equal(Object.keys(r.censo).length, censo.indicadores.length, "el resumen se guardo solo los indicadores que hablan");
  assert.equal(typeof r.censo["observables-sin-descubrimiento"], "number");
  assert.equal(typeof r.censo["recorrido-completo"], "number");
});

// ---------------------------------------------------------------------------
// 5. EL CENSO NO PUEDE APAGAR EL MONITOR. ES TODO EL PUNTO DEL CAMBIO.
// ---------------------------------------------------------------------------

test("`npm run censo` SE VA EN CERO aunque el censo este en alarma y aunque los datos esten rotos", async () => {
  // ESTA ES LA PRUEBA QUE IMPIDE QUE EL CANARIO VUELVA A SER UN CANDADO.
  //
  // El censo hace exactamente las preguntas que tumbaron el monitor 30 horas. Si
  // alguna vez su proceso saliera distinto de cero, el paso del workflow fallaria
  // y estariamos de vuelta donde empezamos -- con la diferencia de que ahora el
  // archivo se llama "censo" y nadie lo relacionaria con el incidente.
  //
  // Se corre el CLI de verdad, como subproceso, con CARPETA_DATOS en una carpeta
  // temporal y sin DISCORD_WEBHOOK_URL: ni toca datos de produccion ni puede
  // mandar nada a Discord.
  const { execFile } = await import("node:child_process");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const pathMod = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const RAIZ = pathMod.default.join(pathMod.default.dirname(fileURLToPath(import.meta.url)), "..");
  const CLI = pathMod.default.join(RAIZ, "src", "censo-cli.mjs");

  const correr = (dir) =>
    new Promise((resolve) => {
      const env = { ...process.env, CARPETA_DATOS: dir };
      delete env.DISCORD_WEBHOOK_URL;
      execFile(process.execPath, [CLI], { env, cwd: RAIZ }, (err, stdout, stderr) =>
        resolve({ codigo: err?.code ?? 0, stdout, stderr }),
      );
    });

  // (a) catalogo en ALARMA: el descubrimiento aporta demasiado poco y ademas no
  // hay ninguna revision completa registrada. Las dos cosas a la vez.
  const enAlarma = await mkdtemp(pathMod.default.join(tmpdir(), "censo-alarma-"));
  const { catalogo } = sitio({ seedPaginas: 95, familiaPaginas: 5 });
  await writeFile(pathMod.default.join(enAlarma, "latest.json"), JSON.stringify(catalogo));
  await writeFile(pathMod.default.join(enAlarma, "ejecuciones.jsonl"), "");
  const a = await correr(enAlarma);
  assert.equal(a.codigo, 0, `el censo en alarma se fue en ${a.codigo}: eso vuelve a apagar el monitor\n${a.stderr}`);
  assert.match(a.stdout, /censo_estado alarma/, "el censo en alarma ni siquiera lo dijo");

  // (b) catalogo ILEGIBLE: es lo que pasa si una corrida muere a mitad de
  // escribirlo. No alcanza con exigir que se vaya en cero -- eso lo cumpliria
  // tambien un censo que revienta y lo tapa el catch de arriba: hay que exigir
  // que DEGRADE, o sea que siga su camino y lo diga.
  const roto = await mkdtemp(pathMod.default.join(tmpdir(), "censo-roto-"));
  await writeFile(pathMod.default.join(roto, "latest.json"), "{ esto no es json");
  const b = await correr(roto);
  assert.equal(b.codigo, 0, `el censo con el catalogo ilegible se fue en ${b.codigo}`);
  assert.match(b.stdout, /censo_sin_catalogo/, "el censo reviento con un catalogo ilegible en vez de seguir su camino y decirlo");

  // (c) carpeta VACIA, sin ningun archivo.
  const vacia = await mkdtemp(pathMod.default.join(tmpdir(), "censo-vacio-"));
  const c = await correr(vacia);
  assert.equal(c.codigo, 0, `el censo sin datos se fue en ${c.codigo}`);
  assert.match(c.stdout, /censo_sin_catalogo/);

  // (d) LA ULTIMA RED, la que atrapa lo que nadie previo.
  //
  // Un `latest.json` que contiene exactamente `null` es JSON valido, asi que
  // pasa el parser y revienta mas adentro. Se eligio a proposito una forma que
  // las capas de arriba NO atajan: si todas las rutas estuvieran endurecidas,
  // no habria forma de comprobar que el `catch` de ultimo momento existe -- y un
  // catch que nunca se ejerce es un catch que alguien puede borrar sin que se
  // note. Medido: con este archivo el proceso tiene que seguir yendose en cero.
  const nulo = await mkdtemp(pathMod.default.join(tmpdir(), "censo-nulo-"));
  await writeFile(pathMod.default.join(nulo, "latest.json"), "null");
  const d = await correr(nulo);
  assert.equal(d.codigo, 0, `el censo se cayo y se llevo la corrida con el (codigo ${d.codigo}): eso vuelve a apagar el monitor`);
  assert.match(d.stderr, /la corrida sigue igual/, "el censo se cayo en silencio: tiene que dejar dicho que se cayo");
});

test("censar no se cae con un catalogo vacio ni con un seed vacio", () => {
  // El censo corre en cada corrida y no puede tumbar ninguna. Un clon nuevo, una
  // carpeta de datos de prueba y una corrida con CARPETA_DATOS vacia pasan por
  // aca.
  assert.doesNotThrow(() => censar({}));
  assert.doesNotThrow(() => censar({ catalogo: {}, seed: [], ejecuciones: "" }));
  assert.doesNotThrow(() => censar({ catalogo: { A: {} }, seed: [], ejecuciones: "{no es json" }));
});

// ---------------------------------------------------------------------------
// 6. LA SERIE: LOS NUMEROS TIENEN QUE QUEDAR GUARDADOS, NO SOLO DICHOS
//
// Es la leccion central del incidente, y la primera version del censo no la
// aplico: `resumenDeCenso` estaba exportada y probada y NADIE la llamaba, el
// comentario del modulo afirmaba que los numeros "quedan en el archivo de
// ejecuciones" (donde no habia ni una fila de censo) y el mensaje mandaba al
// operador -- que no programa -- a abrir ese mismo archivo a buscar "el numero
// de al lado".
// ---------------------------------------------------------------------------

test("cada censo deja su fila, y la serie se poda sola para no crecer para siempre", () => {
  const { catalogo, seed } = sitio();
  const censo = censar({ catalogo, seed, ejecuciones: EJECUCIONES_CON_COMPLETA });
  const fila = filaDeCenso(censo, { timestamp: "2026-09-23T12:00:00Z", avisado: "censo:x:atencion" });
  assert.equal(fila.t, "2026-09-23T12:00:00Z");
  assert.equal(fila.avisado, "censo:x:atencion");
  assert.equal(fila.censoEstado, censo.estado);
  assert.equal(
    Object.keys(fila.censo).length,
    censo.indicadores.length,
    "la fila se guardo solo algunos indicadores: sin la curva completa no hay deriva que mirar",
  );

  // ida y vuelta por el archivo
  const texto = serializarSerie([fila], "2026-09-23T12:00:00Z");
  assert.deepEqual(leerSerie(texto), [fila]);
  // una linea ilegible se ignora en vez de tumbar el censo (el archivo se
  // fusiona por union entre corridas concurrentes, ver .gitattributes)
  assert.deepEqual(leerSerie(`${texto}{esto no es json\n`), [fila]);
  assert.deepEqual(leerSerie(""), []);
  assert.deepEqual(leerSerie(null), []);

  // y lo viejo se poda: sin esto el archivo crece ~8 KB por dia para siempre
  const vieja = { ...fila, t: "2026-01-01T00:00:00Z" };
  const podada = leerSerie(serializarSerie([vieja, fila], "2026-09-23T12:00:00Z"));
  assert.deepEqual(
    podada.map((f) => f.t),
    [fila.t],
    `la serie no se podo a ${DIAS_DE_SERIE} dias`,
  );
  // pero lo de ayer se queda: la deriva de ayer es justo la que hace falta
  const ayer = { ...fila, t: "2026-09-22T12:00:00Z" };
  assert.equal(leerSerie(serializarSerie([ayer, fila], "2026-09-23T12:00:00Z")).length, 2);
});

test("la deriva la calcula el censo, no el operador: dice si saltó hoy o si viene de hace dias", () => {
  // EL DEFECTO QUE ESTO CIERRA: el mensaje decia literalmente "mirar el número
  // de al lado" en el archivo de ejecuciones "para ver si viene derivando hace
  // días o si saltó hoy". El operador no programa y no va a abrir un .jsonl de
  // cientos de KB a buscar un numero "de al lado" -- y el dato estaba a mano,
  // porque el censo ya lee ese archivo. Una instruccion que no se puede seguir
  // convierte el unico aviso que queda en ruido con forma de alerta.
  const indicador = { clave: "observables-sin-descubrimiento", valor: 0.795, referencia: 0.8, formato: "proporcion" };
  const serie = [
    { t: "2026-09-16T12:00:00Z", censo: { "observables-sin-descubrimiento": 0.829 } },
    { t: "2026-09-22T07:02:00Z", censo: { "observables-sin-descubrimiento": 0.821 } },
  ];
  const texto = derivaDe(serie, indicador, { timestamp: "2026-09-23T12:00:00Z" });
  assert.match(texto, /saltó en esta revisión desde 82\.1%/);
  assert.match(texto, /hace 7 días iba en 82\.9%/);

  // sin historia se dice que no hay historia, en vez de inventar una tendencia
  assert.match(derivaDe([], indicador, { timestamp: "2026-09-23T12:00:00Z" }), /primera medición/);
  assert.match(derivaDe(null, indicador, { timestamp: "2026-09-23T12:00:00Z" }), /primera medición/);

  // y un numero que no se movio se dice asi, que es informacion distinta
  const quieta = [{ t: "2026-09-16T12:00:00Z", censo: { "observables-sin-descubrimiento": 0.795 } }];
  const t2 = derivaDe(quieta, indicador, { timestamp: "2026-09-23T12:00:00Z" });
  assert.match(t2, /igual que en la revisión anterior/);
  assert.match(t2, /sin moverse en 7 días/);
});

test("el mensaje trae la deriva adentro y ya NO manda al operador a abrir un archivo", () => {
  // Un censo como el de produccion: uno o dos indicadores hablando, no doce.
  const censo = {
    estado: ATENCION,
    indicadores: [
      { clave: "observables-sin-descubrimiento", estado: ATENCION, valor: 0.795, referencia: 0.8, formato: "proporcion", texto: "Productos vivos...: 79.5% — abajo de la raya del 80.0%" },
      { clave: "recorrido-completo", estado: OK, valor: 1182, referencia: 1185, formato: "entero", texto: "esto no tiene que salir" },
    ],
  };
  const serie = [{ t: "2026-09-16T12:00:00Z", censo: { "observables-sin-descubrimiento": 0.9 } }];
  const texto = mensajeCenso(censo, { timestamp: "2026-09-23T12:00:00Z", serie });
  assert.match(texto, /↳ /, "el mensaje no trae la deriva de ningun indicador");
  assert.match(texto, /hace 7 días iba en 90\.0%/);
  assert.equal(/\.jsonl/.test(texto), false, "el mensaje volvio a mandar al operador a abrir un .jsonl");
  assert.match(texto, /no hace falta abrir ningún archivo/);
  assert.equal(texto.includes("esto no tiene que salir"), false, "un indicador en verde se colo al mensaje");
});

test("el mensaje del censo NUNCA pasa del tope que notifyTecnico corta con slice", () => {
  // Medido: con los doce indicadores hablando y su linea de deriva, el mensaje
  // daba 2.077 caracteres y `notifyTecnico` corta en 1.900 -- o sea que se
  // comia el pie, que es justo la linea que dice que esto NO detiene el
  // monitor. Se recorta de menos importante a mas (primero las derivas,
  // despues los indicadores) y el pie no se toca nunca. Es la misma disciplina
  // que ya tienen los otros avisos tecnicos del proyecto.
  const { catalogo, seed } = sitio();
  const censo = censar({ catalogo, seed, ejecuciones: "" });
  const serie = [{ t: "2026-09-16T12:00:00Z", censo: Object.fromEntries(censo.indicadores.map((i) => [i.clave, 0])) }];
  const texto = mensajeCenso(censo, { timestamp: "2026-09-23T12:00:00Z", serie });
  assert.ok(censo.indicadores.filter((i) => i.estado !== OK).length >= 5, "esta prueba necesita varios indicadores hablando a la vez");
  assert.ok(texto.length <= 1900, `el mensaje del censo mide ${texto.length} caracteres y notifyTecnico corta en 1900`);
  assert.match(texto, /no\*{0,2} detiene el monitor/, "el pie se perdio al recortar: es lo primero que el operador necesita saber");
  assert.match(texto, /censo del 2026-09-23T12:00:00Z/, "la marca de tiempo se perdio al recortar");
});

test("la clave del freno lleva los indicadores y su seña, y NUNCA sus numeros", () => {
  // Con los numeros adentro cada corrida tendria clave distinta y el freno no
  // frenaria nada: 20 mensajes diarios por el mismo canal donde llegan las
  // bajas de precio.
  const a = sitio({ seedPaginas: 90, skuPorSeed: 2, familiaPaginas: 10, skuPorFamilia: 4 }); // 81,8%
  const b = sitio({ seedPaginas: 91, skuPorSeed: 2, familiaPaginas: 10, skuPorFamilia: 4 }); // otro numero, mismo lado
  const cA = censar({ ...a, ejecuciones: EJECUCIONES_CON_COMPLETA });
  const cB = censar({ ...b, ejecuciones: EJECUCIONES_CON_COMPLETA });
  assert.notEqual(de(cA, "observables-sin-descubrimiento").valor, de(cB, "observables-sin-descubrimiento").valor);
  assert.equal(claveDeCenso(cA), claveDeCenso(cB), "la clave cambio con el numero: el freno no frenaria nada");
  assert.equal(/[0-9]/.test(claveDeCenso(cA)), false, "se colo un numero en la clave del freno");

  // un censo enteramente verde tiene clave vacia y no manda mensaje: no hay
  // nada que frenar
  const verde = { estado: OK, indicadores: [{ clave: "x", estado: OK, texto: "bien" }] };
  assert.equal(claveDeCenso(verde), "censo:");
  assert.equal(mensajeCenso(verde, { timestamp: "2026-09-23T12:00:00Z" }), null);
});

test("la ultima clave avisada sale de la serie, y las corridas que NO hablaron no la pisan", () => {
  // Es el estado del freno: si una corrida que se callo contara como "ya se
  // aviso", una condicion nueva quedaria tapada por la anterior.
  const serie = [
    { t: "2026-09-20T00:00:00Z", censo: {}, avisado: "censo:a:atencion" },
    { t: "2026-09-21T00:00:00Z", censo: {}, avisado: null },
    { t: "2026-09-22T00:00:00Z", censo: {}, avisado: null },
  ];
  assert.deepEqual(ultimaClaveAvisada(serie), { clave: "censo:a:atencion", t: "2026-09-20T00:00:00Z" });
  assert.equal(ultimaClaveAvisada([{ t: "x", censo: {}, avisado: null }]), null);
  assert.equal(ultimaClaveAvisada([]), null);
  assert.equal(ultimaClaveAvisada(null), null);
});

test("COMPLETAS_QUE_SE_MIRAN no se puede mover sin que nadie se entere", () => {
  // MUTANTE MEDIDO QUE SOBREVIVIA: subirlo de 5 a 50 no lo notaba nadie. Con 2
  // revisiones completas al dia, 5 son ~2,5 dias y 50 serian 25 DIAS: una tanda
  // de completas sospechosas de hace tres semanas mantendria el indicador en
  // alarma para siempre, y la de ayer no se distinguiria de la del mes pasado.
  assert.equal(COMPLETAS_QUE_SE_MIRAN, 5, "se movio la ventana de revisiones completas que se miran: con 2 completas al dia, 5 son ~2,5 dias");
  const fila = (i, confiable) =>
    JSON.stringify({ modo: "completo", fin: `2026-09-${String(i).padStart(2, "0")}T00:00:00Z`, confiable, motivos: confiable ? [] : [{ tipo: "errores" }] });
  // una sospechosa mas vieja que la ventana ya no cuenta
  const viejas = [fila(1, false), ...Array.from({ length: COMPLETAS_QUE_SE_MIRAN }, (_, k) => fila(10 + k, true))].join("\n");
  assert.deepEqual(completasSospechosas(viejas), []);
});

test("la deriva compara con el MISMO redondeo con que la serie guarda: si no, todo salta siempre", () => {
  // DEFECTO ENCONTRADO ESCRIBIENDO ESTO, y de los que no se ven leyendo: la
  // serie guarda los numeros con cuatro decimales (`toFixed(4)`) y el indicador
  // vivo trae la division entera. 0,1351 nunca es igual a 0,13513..., asi que la
  // deriva decia "saltó en esta revisión" en TODAS las revisiones -- o sea que
  // el dato que el operador iba a leer para distinguir un salto de una deriva
  // decia siempre lo mismo, que es peor que no decir nada.
  const indicador = { clave: "aporte-descubrimiento", valor: 135 / 1000 + 1e-9, referencia: 0.1, formato: "proporcion" };
  // la fila se arma como la arma el censo de verdad
  const fila = filaDeCenso({ estado: ATENCION, indicadores: [indicador] }, { timestamp: "2026-09-22T12:00:00Z" });
  const serie = leerSerie(serializarSerie([fila], "2026-09-23T12:00:00Z"));
  const texto = derivaDe(serie, indicador, { timestamp: "2026-09-23T12:00:00Z" });
  assert.match(texto, /igual que en la revisión anterior/, `el mismo numero se leyo como un salto: ${texto}`);
  assert.equal(/saltó/.test(texto), false);

  // y un cambio de verdad SI se ve
  const movido = { ...indicador, valor: 0.09 };
  assert.match(derivaDe(serie, movido, { timestamp: "2026-09-23T12:00:00Z" }), /saltó en esta revisión desde 13\.5%/);
});

test("la deriva escribe cada valor en SU unidad: un conteo no se escribe como porcentaje", () => {
  // DEFECTO ENCONTRADO REVISANDO: `fmtValor` adivinaba el formato mirando el
  // numero ("si el valor y su referencia caben en 1, es una proporcion") y se
  // equivocaba justo donde duele. `completas-sospechosas` es un CONTEO con
  // referencia 0, asi que UNA revision completa sospechosa se escribia como
  // "100.0%" y cero como "0.0%": el operador iba a leer un porcentaje inventado
  // en el unico mensaje que le queda. Ahora el formato lo DECLARA cada
  // indicador.
  const { catalogo, seed } = sitio();
  const censo = censar({ catalogo, seed, ejecuciones: EJECUCIONES_CON_COMPLETA });
  const formatos = Object.fromEntries(censo.indicadores.map((i) => [i.clave, i.formato]));
  assert.equal(formatos["completas-sospechosas"], "entero");
  assert.equal(formatos["recorrido-completo"], "entero");
  assert.equal(formatos["aporte-descubrimiento"], "proporcion");
  assert.equal(formatos["observables-sin-descubrimiento"], "proporcion");
  assert.equal(formatos["premisa-tele-fuera-del-bloque"], "si-no");
  for (const i of censo.indicadores) assert.ok(i.formato, `el indicador ${i.clave} no declara su formato: la deriva lo va a escribir adivinando`);

  const conteo = { clave: "completas-sospechosas", valor: 2, referencia: 0, formato: "entero" };
  const serie = [{ t: "2026-09-22T12:00:00Z", censo: { "completas-sospechosas": 0 } }];
  const texto = derivaDe(serie, conteo, { timestamp: "2026-09-23T12:00:00Z" });
  assert.match(texto, /desde 0(?!\.)/, `un conteo se escribio como porcentaje: ${texto}`);
  assert.equal(/%/.test(texto), false, `un conteo se escribio como porcentaje: ${texto}`);

  // y un si-o-no se escribe como si-o-no, no como "true"
  const siNo = { clave: "premisa-tele-fuera-del-bloque", valor: false, referencia: true, formato: "si-no" };
  const serie2 = [{ t: "2026-09-22T12:00:00Z", censo: { "premisa-tele-fuera-del-bloque": true } }];
  assert.match(derivaDe(serie2, siNo, { timestamp: "2026-09-23T12:00:00Z" }), /desde sí/);
});
