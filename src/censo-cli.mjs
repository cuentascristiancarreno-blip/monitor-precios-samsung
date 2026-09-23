// EL QUE CORRE EL CENSO: lee los datos de produccion, imprime, guarda la serie,
// avisa y SE VA EN CERO PASE LO QUE PASE.
//
// `process.exitCode` nunca se toca, y eso es la pieza central del arreglo del
// 2026-09-23, no un descuido: si este archivo pudiera fallar, seria otra vez un
// canario cableado a un interruptor. El paso del workflow ademas lleva
// `continue-on-error: true`, o sea dos candados abiertos a proposito.
//
// LA OTRA DECISION: el censo corre DESPUES del scrape. Asi mide el catalogo que
// la corrida acaba de escribir -- el numero fresco -- en vez del del checkout,
// que puede ser de varias horas antes. (Ese desfase existia de verdad: hasta hoy
// `npm test` corria ANTES de `git pull --ff-only origin main`, asi que las
// aserciones que tumbaban la corrida juzgaban un catalogo que ni siquiera era el
// de esa corrida.)
//
// LO QUE ESTE ARCHIVO HACE Y LA PRIMERA VERSION NO (segunda vuelta del
// 2026-09-23, defecto de tres verificadores):
//   - GUARDA LA SERIE en `datos/censo.jsonl`. Sin eso, los numeros solo existian
//     en el log de la corrida, que es efimero, y la deriva -- la leccion central
//     del incidente -- quedaba medida pero NO retenida. `resumenDeCenso` estaba
//     exportada y probada y no la llamaba nadie.
//   - EL FRENO ES POR CAMBIO, no "una vez al dia". Con el censo en atencion
//     permanente (hoy lo esta: la razon de observables quedo pegada a la raya
//     del 80%), "una vez al dia" son 365 mensajes identicos al ano por una
//     condicion que ya se dijo. Ahora habla cuando la CLAVE cambia, y vuelve a
//     recordar la condicion que sigue igual una vez por semana.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  censar,
  claveDeCenso,
  filaDeCenso,
  leerSerie,
  mensajeCenso,
  serializarSerie,
  ultimaClaveAvisada,
  OK,
} from "./censo.mjs";
import { notifyTecnico } from "./discord.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");
// CARPETA_DATOS: la misma puerta que usa run.mjs para correr sin tocar produccion.
const DATA_DIR = process.env.CARPETA_DATOS || path.join(RAIZ, "data");

/**
 * Cada cuantos dias se vuelve a recordar una condicion que no cambio.
 *
 * NO ES CERO (o sea "nunca repetir"): una alarma que se dice una sola vez y no
 * vuelve nunca se pierde en el scroll del canal y el sistema vuelve a quedarse
 * sin nadie mirando, que es el incidente. Siete dias es la misma ventana que ya
 * usa el resto de los avisos tecnicos del proyecto.
 */
const DIAS_PARA_RECORDAR = 7;

const leerTexto = (p) => readFile(p, "utf-8").catch(() => "");
const leerJson = async (p, porOmision) => {
  try {
    return JSON.parse(await readFile(p, "utf-8"));
  } catch {
    return porOmision;
  }
};

async function main() {
  const timestamp = new Date().toISOString();
  const catalogo = await leerJson(path.join(DATA_DIR, "latest.json"), {});
  const seed = await leerJson(path.join(RAIZ, "src", "seed.json"), []);
  const ejecuciones = await leerTexto(path.join(DATA_DIR, "ejecuciones.jsonl"));
  const fixture = await leerJson(path.join(RAIZ, "test", "fixtures", "catalogo.json"), null);

  if (Object.keys(catalogo).length === 0) {
    // No hay nada que censar y eso NO es una falla: pasa en un clon nuevo y en
    // cualquier corrida de prueba con CARPETA_DATOS vacia.
    console.log("INFO censo_sin_catalogo no hay catalogo que censar");
    return;
  }

  const censo = censar({ catalogo, seed, ejecuciones, fixture });

  // El log entero, siempre: los verdes tambien. Es lo que deja la serie
  // completa en el log de la corrida para poder mirar la deriva hacia atras.
  for (const i of censo.indicadores) {
    console.log(`${i.estado === OK ? "INFO" : i.estado === "alarma" ? "ERROR" : "WARNING"} censo ${i.clave} :: ${i.texto}`);
  }
  console.log(`INFO censo_estado ${censo.estado}`);

  const rutaSerie = path.join(DATA_DIR, "censo.jsonl");
  const serie = leerSerie(await leerTexto(rutaSerie));

  // LA SERIE SE GUARDA PASE LO QUE PASE: hable o no hable el censo, se entregue
  // o no se entregue el mensaje. La curva es lo que hace falta la proxima vez,
  // no el ultimo punto -- y los dias SANOS son la referencia contra la que se
  // mide todo lo demas, asi que guardar solo los dias malos deja la curva con
  // agujeros justo donde hace falta. Si la escritura fallara, el censo sigue su
  // camino igual: esto no puede tumbar una corrida.
  const guardarSerie = async (avisado) => {
    const filas = [...serie, filaDeCenso(censo, { timestamp, avisado })];
    await writeFile(rutaSerie, serializarSerie(filas, timestamp)).catch((err) =>
      console.error(`WARNING no se pudo guardar la serie del censo: ${err.message}`),
    );
  };

  const texto = mensajeCenso(censo, { timestamp, serie });
  if (!texto) {
    await guardarSerie(null);
    return;
  }

  // EL FRENO ES POR CAMBIO DE CLAVE, NO POR DIA. La clave lleva los indicadores
  // que estan mal y su estado, NO sus numeros: con los numeros cada corrida
  // tendria clave distinta y el freno no frenaria nada.
  const clave = claveDeCenso(censo);
  const ultima = ultimaClaveAvisada(serie);
  const dias = ultima ? (Date.parse(timestamp) - Date.parse(ultima.t)) / 86400000 : Infinity;
  if (ultima && ultima.clave === clave && Number.isFinite(dias) && dias < DIAS_PARA_RECORDAR) {
    console.log(`INFO aviso_tecnico_omitido ${clave} (no cambio nada desde el ultimo aviso, hace ${dias.toFixed(1)} dias)`);
    await guardarSerie(null);
    return;
  }

  // La huella SOLO si Discord lo acepto: si el envio falla, la corrida siguiente
  // lo vuelve a encontrar y lo reintenta (leccion del 2026-09-13).
  //
  // SIN WEBHOOK TAMPOCO SE MARCA, aunque notifyTecnico devuelva `entregado`
  // (para el resto del proyecto "sin webhook" significa "no hay nada que
  // reintentar"). Aca la consecuencia es otra: una corrida de prueba local
  // contra la carpeta de produccion dejaria el freno envenenado y la corrida
  // siguiente, la de verdad, se quedaria callada creyendo que ya lo dijo.
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  const { entregado } = await notifyTecnico(webhook, texto);
  if (!webhook) {
    console.log("INFO censo_sin_webhook el aviso no se manda y NO se marca como avisado");
    await guardarSerie(null);
    return;
  }
  if (!entregado) {
    console.error("WARNING el aviso del censo no llego a Discord: se reintenta en la corrida siguiente");
    await guardarSerie(null);
    return;
  }
  console.log(`INFO aviso_tecnico_enviado ${clave}`);
  await guardarSerie(clave);
}

// NADA DE ESTE ARCHIVO PUEDE TUMBAR UNA CORRIDA. Es literal el punto del cambio.
main().catch((err) => {
  console.error(`WARNING el censo se cayo y la corrida sigue igual: ${err?.stack ?? err}`);
});
