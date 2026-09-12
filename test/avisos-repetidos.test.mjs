// EL FRENO DE LOS AVISOS TECNICOS QUE SE REPITEN SOLOS.
//
// El aviso de "una categoria principal ya no esta en el listado" salia en CADA
// corrida mientras la condicion durara: 7 mensajes identicos por dia, por el
// mismo canal donde llegan las momias y los precios corregidos, hasta que una
// persona editara src/prioridad.mjs. El proyecto ya tenia la disciplina "una
// sola vez" en otros avisos (avisadoSinVerificar, avisadoSinPrecio); esto es lo
// mismo para los avisos que no cuelgan de ningun SKU.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clavesPorAvisar, diaDe, leerHuellas, serializarHuellas, yaSeAviso } from "../src/avisos-repetidos.mjs";

test("el dia sale del timestamp de la corrida, sin la hora", () => {
  assert.equal(diaDe("2026-09-12T18:00:00.000Z"), "2026-09-12");
  assert.equal(diaDe(undefined), "");
});

test("un aviso que ya salio hoy NO vuelve a salir hoy", () => {
  const huellas = [{ clave: "categorias-ausentes:Tablets", dia: "2026-09-12" }];
  assert.equal(yaSeAviso(huellas, "categorias-ausentes:Tablets", "2026-09-12"), true);
  assert.equal(clavesPorAvisar(huellas, ["categorias-ausentes:Tablets"], "2026-09-12").length, 0);
});

test("...pero SI vuelve a salir al dia siguiente", () => {
  // La condicion puede durar semanas y hay que seguir recordandola. Lo que no
  // puede es sonar 7 veces al dia.
  const huellas = [{ clave: "categorias-ausentes:Tablets", dia: "2026-09-12" }];
  assert.equal(yaSeAviso(huellas, "categorias-ausentes:Tablets", "2026-09-13"), false);
  assert.deepStrictEqual(clavesPorAvisar(huellas, ["categorias-ausentes:Tablets"], "2026-09-13"), [
    "categorias-ausentes:Tablets",
  ]);
});

test("dos avisos distintos el mismo dia no se tapan entre si", () => {
  const huellas = [{ clave: "seccion-cambiada:GP-TOS928SBEYW", dia: "2026-09-12" }];
  assert.deepStrictEqual(
    clavesPorAvisar(huellas, ["seccion-cambiada:GP-TOS928SBEYW", "seccion-cambiada:SM-OTRO"], "2026-09-12"),
    ["seccion-cambiada:SM-OTRO"],
  );
});

test("la misma clave repetida en la misma corrida se avisa una sola vez", () => {
  assert.deepStrictEqual(clavesPorAvisar([], ["a", "a", "b"], "2026-09-12"), ["a", "b"]);
});

test("sin huellas previas (primera corrida, archivo inexistente) se avisa todo", () => {
  assert.deepStrictEqual(clavesPorAvisar(leerHuellas(""), ["a"], "2026-09-12"), ["a"]);
  assert.deepStrictEqual(leerHuellas(undefined), []);
});

test("una linea rota del archivo no rompe la lectura ni tapa las buenas", () => {
  // Nunca se puede perder un aviso por un archivo a medio escribir.
  const texto = ['{"clave":"a","dia":"2026-09-12"}', "{ esto no es json", "", '{"clave":"b"}', '{"clave":"c","dia":"2026-09-12"}'].join("\n");
  assert.deepStrictEqual(leerHuellas(texto), [
    { clave: "a", dia: "2026-09-12" },
    { clave: "c", dia: "2026-09-12" },
  ]);
});

test("el archivo que queda escrito poda las huellas viejas y no crece para siempre", () => {
  const huellas = [
    { clave: "vieja", dia: "2026-08-01" },
    { clave: "de-ayer", dia: "2026-09-11" },
    { clave: "de-hoy", dia: "2026-09-12" },
  ];
  const texto = serializarHuellas(huellas, "2026-09-12");
  assert.ok(!texto.includes("vieja"), "una huella de hace 6 semanas no tiene por que seguir ahi");
  assert.ok(texto.includes("de-ayer"), "las de los ultimos dias se conservan: una corrida puede cruzar la medianoche");
  assert.ok(texto.includes("de-hoy"));
});

test("el archivo no repite huellas y sale en orden estable (diffs de git legibles)", () => {
  const huellas = [
    { clave: "b", dia: "2026-09-12" },
    { clave: "a", dia: "2026-09-12" },
    { clave: "b", dia: "2026-09-12" },
  ];
  assert.equal(serializarHuellas(huellas, "2026-09-12"), '{"clave":"a","dia":"2026-09-12"}\n{"clave":"b","dia":"2026-09-12"}\n');
  // y escribirlo dos veces da exactamente lo mismo
  const una = serializarHuellas(huellas, "2026-09-12");
  assert.equal(serializarHuellas(leerHuellas(una), "2026-09-12"), una);
});

test("sin huellas vivas el archivo queda vacio, no con una linea en blanco", () => {
  assert.equal(serializarHuellas([{ clave: "vieja", dia: "2020-01-01" }], "2026-09-12"), "");
  assert.equal(serializarHuellas([], "2026-09-12"), "");
});
