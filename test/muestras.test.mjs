// LO QUE SE MUESTRA CUANDO NO CABE TODO no puede depender de por donde empezo
// el recorrido. Varios mensajes al operador cortan la lista en 15 o 20, y esas
// listas salian en el orden en que se visitaron las paginas: al reordenar el
// recorrido por categorias principales, CUALES 15 ve el operador cambiaba sin
// que nadie lo hubiera decidido.
import { test } from "node:test";
import assert from "node:assert/strict";
import { masCorridas, muestraDeUrls } from "../src/muestras.mjs";

const momia = (modelo, corridas) => ({ modelo, corridas });

test("se muestran las momias mas insistentes, no las que se visitaron primero", () => {
  const lista = [momia("SM-A", 2), momia("SM-B", 9), momia("SM-C", 5)];
  assert.deepStrictEqual(masCorridas(lista, 2).map((m) => m.modelo), ["SM-B", "SM-C"]);
});

test("a igualdad de corridas manda el nombre, no el orden de llegada", () => {
  // Este es el punto: las dos listas traen lo MISMO en distinto orden y tienen
  // que mostrar lo mismo.
  const a = [momia("SM-Z", 4), momia("SM-A", 4), momia("SM-M", 4)];
  const b = [momia("SM-M", 4), momia("SM-Z", 4), momia("SM-A", 4)];
  assert.deepStrictEqual(masCorridas(a, 2), masCorridas(b, 2));
  assert.deepStrictEqual(masCorridas(a, 2).map((m) => m.modelo), ["SM-A", "SM-M"]);
});

test("no se toca la lista original ni se pierde nada cuando cabe entera", () => {
  const lista = [momia("SM-A", 1), momia("SM-B", 2)];
  const copia = [...lista];
  assert.equal(masCorridas(lista, 15).length, 2);
  assert.deepStrictEqual(lista, copia, "masCorridas no puede reordenar la lista que recibe");
});

test("una momia sin contador no revienta y queda al final", () => {
  const lista = [{ modelo: "SM-SIN" }, momia("SM-CON", 3)];
  assert.deepStrictEqual(masCorridas(lista, 5).map((m) => m.modelo), ["SM-CON", "SM-SIN"]);
});

test("la muestra de URL es la misma para el mismo contenido en distinto orden", () => {
  const a = [{ url: "https://b/" }, { url: "https://a/" }, { url: "https://c/" }];
  const b = [{ url: "https://c/" }, { url: "https://b/" }, { url: "https://a/" }];
  assert.deepStrictEqual(muestraDeUrls(a, 2), muestraDeUrls(b, 2));
  assert.deepStrictEqual(muestraDeUrls(a, 2), ["https://a/", "https://b/"]);
});

test("la muestra de URL no repite y acepta tanto entradas como strings", () => {
  assert.deepStrictEqual(muestraDeUrls([{ url: "https://a/" }, { url: "https://a/" }, "https://b/"], 20), [
    "https://a/",
    "https://b/",
  ]);
});

test("listas vacias o con basura no revientan", () => {
  assert.deepStrictEqual(muestraDeUrls([], 20), []);
  assert.deepStrictEqual(muestraDeUrls(undefined, 20), []);
  assert.deepStrictEqual(muestraDeUrls([{ sinUrl: 1 }, null], 20), []);
  assert.deepStrictEqual(masCorridas(undefined, 15), []);
});
