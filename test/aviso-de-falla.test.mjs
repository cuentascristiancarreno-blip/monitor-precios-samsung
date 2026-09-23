// EL OPERADOR SE TIENE QUE ENTERAR CUANDO EL MONITOR NO ARRANCA.
//
// Es la segunda mitad del encargo del 2026-09-23, y la que el operador pidio con
// todas las letras. El monitor lleva meses avisando por Discord cuando algo va
// mal DENTRO de una corrida, pero todo ese camino sale de `notifyTecnico`
// (el modulo de Discord), que solo puede hablar desde adentro de la revision. Si
// la corrida muere ANTES de llegar ahi, no hay quien avise.
//
// MEDIDO SOBRE LAS 594 CORRIDAS REALES DEL REPO (2026-07-20 a 2026-09-23):
//   525 success · 32 failure · 35 cancelled
//   racha de fallas mas larga ANTES del incidente: 2. La del incidente: 24.
//   hueco entre corridas buenas: mediana 2,91 h, p90 4,81 h. El del incidente: 29,5 h.
//   de las 32 fallas: las 24 de la racha murieron en "Pruebas automatizadas"
//   (job de 0 min, antes de tocar samsung.com) y 7 de las 8 anteriores murieron
//   en "Guardar historial y ultimo estado", o sea DESPUES de revisar y DESPUES
//   de que los avisos salieran. Son incidentes de gravedad OPUESTA y el mensaje
//   los tiene que distinguir.
//   de las 35 canceladas: 15 son descartes de concurrencia (0 jobs, ruido
//   normal) y 20 son muertes de verdad que hasta hoy no mandaron un solo mensaje.
//
// LO QUE CAMBIO EN LA SEGUNDA VUELTA DEL 2026-09-23, Y ES LA LECCION DE ESTE
// ARCHIVO: la primera version comprobaba que el TEXTO de la condicion del
// escalon siguiera escrito igual, con una expresion regular. Eso NO es probar la
// aritmetica: dos verificadores encontraron, ejecutandola, que la cuenta
// enmudecia para siempre a partir de la falla nº 50 -- justo el apagon largo que
// este workflow existe para cubrir -- y la suite seguia en verde. Ahora el
// bloque de aritmetica del YAML se EXTRAE y se EJECUTA con rachas de 1 a 200.
//
// Lo que este archivo sigue sin poder probar es que GitHub dispare el workflow.
// Lo que si prueba son las formas en que esto se rompe en silencio: que el
// nombre del workflow que escucha deje de calzar, que el aviso pase a depender
// del codigo que podria estar roto, que el freno desaparezca y el canal se
// llene, y que el guard del webhook quede invertido y no mande nada justo cuando
// el secreto SI esta puesto.
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");
const wf = (nombre) => path.join(RAIZ, ".github", "workflows", nombre);

/**
 * LOS FIN DE LINEA SE NORMALIZAN AL LEER, UNA SOLA VEZ.
 *
 * El clon del operador tiene `core.autocrlf=true`. Los archivos del arbol de
 * trabajo son LF hoy, pero un clon nuevo en Windows los baja con CRLF y todas
 * las aserciones de este archivo -- que son expresiones regulares con `\n`
 * literal -- fallarian sin que nada este roto. Medido el 2026-09-23: una
 * extraccion de HEAD con la conversion puesta dejaba la suite en 549/550, por
 * una prueba de YAML que no estaba rota. El `.gitattributes` ademas declara
 * `*.yml text eol=lf`; esto es el cinturon del tirante.
 */
const leerWf = (nombre) => readFileSync(wf(nombre), "utf-8").replace(/\r\n/g, "\n");

const MONITOR = leerWf("monitor.yml");
const AVISO = leerWf("avisar-falla.yml");
const PRUEBAS = leerWf("pruebas.yml");
const PAQUETE = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf-8"));

/**
 * El aviso SIN sus comentarios, para las aserciones que dicen "esto ya no puede
 * estar". Los comentarios de este workflow citan a proposito las formas
 * defectuosas que reemplazaron (`|| echo 1`, `index("success") // 40`) porque
 * ahi esta escrita la medicion; buscarlas en el texto crudo denunciaria la
 * documentacion en vez del codigo.
 */
const AVISO_CODIGO = AVISO.replace(/^\s*#.*$/gm, "");

// ===========================================================================
// 1. EL AVISO TIENE QUE ESCUCHAR AL WORKFLOW QUE DE VERDAD CORRE
// ===========================================================================

test("el workflow del aviso escucha EXACTAMENTE el nombre del workflow del monitor", () => {
  // LA FORMA MAS SILENCIOSA DE ROMPER ESTO: `on.workflow_run.workflows` compara
  // por el `name:` del otro archivo, literal. Si alguien le cambia el titulo al
  // monitor -- o le pone una tilde, o cambia una mayuscula -- el aviso deja de
  // dispararse y NADIE se entera, porque su sintoma es justamente el silencio.
  // Es el mismo modo de falla que el incidente que este cambio viene a cerrar.
  const nombreMonitor = MONITOR.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  assert.ok(nombreMonitor, "monitor.yml perdio su `name:`");
  assert.ok(
    AVISO.includes(`workflows: ["${nombreMonitor}"]`),
    `el aviso escucha un nombre distinto del que tiene el monitor ("${nombreMonitor}"): si no calzan, el aviso no se dispara NUNCA y el sintoma es el silencio`,
  );
});

test("el aviso se dispara con las corridas que NO terminaron bien, y solo con esas", () => {
  assert.match(AVISO, /types:\s*\[completed\]/, "el aviso dejo de escuchar el fin de la corrida");
  assert.match(
    AVISO,
    /if:\s*\$\{\{\s*github\.event\.workflow_run\.conclusion\s*!=\s*'success'\s*\}\}/,
    "el aviso perdio su condicion: o habla en cada corrida buena o no habla nunca",
  );
});

// ===========================================================================
// 2. EL AVISO NO PUEDE DEPENDER DEL CODIGO QUE PODRIA ESTAR ROTO
// ===========================================================================

test("el aviso no corre nada del repo: ni node, ni npm, ni un import de src/", () => {
  // EL CASO QUE HAY QUE CUBRIR ES "LAS PRUEBAS FALLARON", o sea que el codigo del
  // repo es sospechoso. Un aviso que importara el modulo de Discord dependeria
  // justo de lo que podria estar roto; uno que instalara dependencias se caeria
  // con un package.json malo. Por eso es un curl y nada mas.
  //
  // Tampoco hace checkout: no necesita el repo, y no traerlo es lo que garantiza
  // que no pueda ejecutar nada de adentro.
  const sinComentarios = AVISO.replace(/^\s*#.*$/gm, "");
  for (const prohibido of ["npm ", "node ", "actions/setup-node", "actions/checkout", "src/"]) {
    assert.equal(
      sinComentarios.includes(prohibido),
      false,
      `el aviso empezo a usar "${prohibido}": si el repo esta roto, el aviso se rompe con el, que es exactamente el caso que tiene que cubrir`,
    );
  }
  assert.match(sinComentarios, /curl /, "el aviso dejo de mandar el mensaje por curl");
});

test("el aviso pide solo permiso de lectura", () => {
  // No escribe nada en el repo a proposito: escribir una huella exigiria
  // commitear desde este workflow, que correria carrera con los commits del
  // monitor. El estado del freno es el propio historial de corridas de GitHub.
  assert.match(AVISO, /permissions:\s*\n\s*actions:\s*read\s*\n\s*contents:\s*read/);
  assert.equal(/contents:\s*write/.test(AVISO), false, "el aviso pidio permiso de escritura: no tiene nada que escribir");
});

// ===========================================================================
// 3. EL ESCALON, EJECUTADO DE VERDAD
//
// Esta seccion extrae del YAML el bloque marcado `# >>> ARITMETICA` y lo CORRE.
// Es la respuesta al defecto que sobrevivio a los mutantes de la primera vuelta:
// comprobar que la condicion sigue escrita igual no dice nada sobre lo que la
// condicion hace con una racha de 60.
// ===========================================================================

/** Saca del YAML el bloque de aritmetica, sin comentarios y sin la sangria del `run:`. */
function aritmeticaDelYaml(texto) {
  const ini = texto.indexOf("# >>> ARITMETICA");
  const fin = texto.indexOf("# <<< ARITMETICA");
  assert.ok(ini >= 0 && fin > ini, "el aviso perdio el bloque marcado `# >>> ARITMETICA`: sin el, esta seccion no puede ejecutar nada y la aritmetica vuelve a quedar sin probar");
  const bloque = texto.slice(texto.indexOf("\n", ini) + 1, fin);
  const lineas = bloque.split("\n").filter((l) => !/^\s*#/.test(l));
  const conTexto = lineas.filter((l) => l.trim());
  const sangria = Math.min(...conTexto.map((l) => l.match(/^ */)[0].length));
  return lineas.map((l) => l.slice(sangria)).join("\n");
}

/**
 * CON QUE SHELL SE EJECUTA LA ARITMETICA.
 *
 * `bash` primero, y no es indiferente: GitHub Actions corre cada bloque `run:`
 * con `bash --noprofile --norc -eo pipefail`, asi que ejecutar con bash es
 * ejecutar lo mismo que corre en produccion. `sh` queda de respaldo para una
 * maquina que no tenga bash; en `ubuntu-latest`, que es donde este candado
 * bloquea la revision, bash siempre esta.
 *
 * Si no hubiera ninguno de los dos, estas cuatro pruebas se SALTAN en vez de
 * fallar. Es a proposito y es la leccion del incidente aplicada a esta suite:
 * `npm test` bloquea la revision de produccion, asi que no puede ponerse rojo
 * por algo que no es el codigo. Las aserciones de TEXTO sobre los numeros del
 * escalon corren siempre, con shell o sin el.
 */
const SHELL = (() => {
  for (const candidato of ["bash", "sh"]) {
    const r = spawnSync(candidato, ["-c", "exit 0"]);
    if (!r.error && r.status === 0) return candidato;
  }
  return null;
})();
const SIN_SH = SHELL ? false : "hace falta bash o un shell POSIX para ejecutar la aritmetica del workflow; en ubuntu-latest, que es donde corre el candado, bash siempre esta";

const TMP = mkdtempSync(path.join(tmpdir(), "aviso-arit-"));
const ARIT = (() => {
  const f = path.join(TMP, "arit.sh");
  writeFileSync(f, aritmeticaDelYaml(AVISO));
  return f;
})();

/** Corre `contar_racha` del YAML con una ventana de conclusiones (de la mas nueva a la mas vieja). */
function contarRacha(conclusiones) {
  const r = spawnSync(SHELL, ["-c", '. "$1"; contar_racha', SHELL, ARIT], { input: `${conclusiones.join("\n")}\n`, encoding: "utf-8" });
  assert.equal(r.error, undefined, `no se pudo correr la aritmetica: ${r.error?.message}`);
  return { n: Number(r.stdout.trim()), ventanaAgotada: r.status !== 0 };
}

/**
 * El escalon corrido de 1 a `hasta`, EN UN SOLO PROCESO.
 *
 * El bucle va adentro del shell a proposito: una llamada por valor son 400
 * procesos y 40 s, y esta suite es el candado que bloquea cada revision de
 * produccion -- una suite lenta es una suite que alguien termina sacando del
 * camino. Medido: 400 llamadas 39 s, dos llamadas 0,2 s.
 */
function correrEscalon(hasta) {
  const guion = `
. "$1"
n=1
while [ "$n" -le "$2" ]; do
  if habla_en "$n"; then echo "$n"; fi
  n=$((n + 1))
done
`;
  const r = spawnSync(SHELL, ["-c", guion, SHELL, ARIT, String(hasta)], { encoding: "utf-8" });
  assert.equal(r.error, undefined, `no se pudo correr la aritmetica: ${r.error?.message}`);
  return r.stdout.trim().split("\n").filter(Boolean).map(Number);
}

/**
 * Los mensajes que saldrian durante una racha de `largo` fallas, tomando la
 * MISMA decision que el YAML: se cuenta la racha en la ventana, y cuando la
 * ventana se agota la cadencia la marca el numero de corrida del propio aviso
 * (que aca avanza de a uno por falla).
 */
function mensajesDeUnaRacha(largo, ventana = 100) {
  // Ni un fork por iteracion: la ventana se arma con `printf` (builtin) y el
  // resultado se lee con `read` desde un archivo. Con tuberias y sustitucion de
  // comandos esto tardaba 27 s en Windows, y esta suite es el candado que
  // bloquea cada revision de produccion. Asi tarda 0,4 s.
  const guion = `
. "$1"
LARGO=$2
VENTANA=$3
TMP=$4
W=""
i=1
while [ "$i" -le "$LARGO" ]; do
  if [ "$i" -le "$VENTANA" ]; then W="\${W}failure
"; fi
  if [ "$i" -lt "$VENTANA" ]; then printf '%s\\nsuccess\\n' "$W" > "$TMP/in"; else printf '%s\\n' "$W" > "$TMP/in"; fi
  AG=no
  contar_racha < "$TMP/in" > "$TMP/out" || AG=si
  read -r N < "$TMP/out"
  if [ "$AG" = "si" ]; then
    if [ $((i % 24)) -eq 0 ]; then echo "$i"; fi
  else
    [ "$N" -lt 1 ] && N=1
    if habla_en "$N"; then echo "$i"; fi
  fi
  i=$((i + 1))
done
`;
  const r = spawnSync(SHELL, ["-c", guion, SHELL, ARIT, String(largo), String(ventana), TMP], { encoding: "utf-8" });
  assert.equal(r.error, undefined, `no se pudo correr la aritmetica: ${r.error?.message}`);
  return r.stdout.trim().split("\n").filter(Boolean).map(Number);
}

test("contar_racha cuenta las fallas seguidas y no deja que una cancelada parta la racha", { skip: SIN_SH }, () => {
  // Las canceladas NO cortan ni suman: 15 de las 35 de la historia del repo son
  // descartes de concurrencia (ver README) y caen en el medio de cualquier racha.
  // Si cortaran, una racha de 24 se leeria como tres rachas de 8 y el escalon
  // hablaria tres veces en la falla 1.
  assert.deepEqual(contarRacha(["failure", "failure", "success"]), { n: 2, ventanaAgotada: false });
  assert.deepEqual(contarRacha(["failure", "cancelled", "failure", "success"]), { n: 2, ventanaAgotada: false });
  assert.deepEqual(contarRacha(["failure", "skipped", "failure", "success"]), { n: 2, ventanaAgotada: false });
  assert.deepEqual(contarRacha(["success", "failure", "failure"]), { n: 0, ventanaAgotada: false });
});

test("EL AVISO NO SE CALLA NUNCA EN UN APAGON LARGO: la ventana sin un solo exito se declara, no se disfraza de numero", { skip: SIN_SH }, () => {
  // ESTE ES EL DEFECTO GRAVE DE LA PRIMERA VUELTA, y es el unico de toda esta
  // pieza que se comia justo el caso que la pieza existe para cubrir.
  //
  // La cuenta era `index("success") // 40` en jq: cuando en la ventana de 50
  // corridas ya no quedaba ningun exito, jq devolvia null y N quedaba CLAVADO
  // en 40. Y 40 no es 1, no es 3, no es 12, y 40 % 24 = 16, asi que el escalon
  // no hablaba nunca mas. Medido ejecutando aquel shell: con 200 fallas seguidas
  // mandaba 5 mensajes y despues silencio absoluto, PARA SIEMPRE -- mientras el
  // comentario del propio archivo prometia "~1,7 mensajes por dia, ruidoso a
  // proposito, porque a esa altura el silencio es peor".
  //
  // Ahora `contar_racha` SALE EN 1 cuando la ventana no trae ningun exito, y ese
  // caso tiene su propia cadencia en el YAML en vez de caer en un numero mudo.
  const todoFallas = Array(100).fill("failure");
  const r = contarRacha(todoFallas);
  assert.equal(r.ventanaAgotada, true, "la ventana entera sin un solo exito tiene que DECIRSE: si se devuelve como un numero cualquiera, el escalon puede caer en un valor que no habla y el aviso enmudece para siempre");
  assert.equal(r.n, 100, "y ademas tiene que contar cuantas vio");

  // Y con canceladas adentro, que es como se ve de verdad.
  const conCanceladas = Array.from({ length: 100 }, (_, i) => (i % 5 === 4 ? "cancelled" : "failure"));
  assert.equal(contarRacha(conCanceladas).ventanaAgotada, true);
});

test("el escalon habla en la falla 1, 3, 12 y despues cada 24, EJECUTADO de 1 a 200", { skip: SIN_SH }, () => {
  // MEDIDO SOBRE LAS 594 CORRIDAS REALES, con esta misma aritmetica:
  //   - durante el incidente (24 fallas en 30 h) son 4 MENSAJES: 08:39Z (racha
  //     1), 09:53Z (racha 3), 19:46Z (racha 12) y 13:43Z del dia siguiente
  //     (racha 24). El primero a los ~9 minutos de la primera falla, contra las
  //     30 horas que tardo el correo de GitHub.
  //   - en TODA la historia (65,5 dias), 29 mensajes = 0,44 por dia, contando
  //     las 20 muertes por cancelacion que hasta hoy eran invisibles.
  // Con un aviso por falla habrian sido 24 en el incidente; sin escalon, uno
  // solo y despues 30 h de silencio otra vez.
  const hablan = correrEscalon(200);
  assert.deepEqual(
    hablan.slice(0, 8),
    [1, 3, 12, 24, 48, 72, 96, 120],
    "el escalon cambio: con un aviso por falla el incidente habrian sido 24 mensajes, y sin escalon uno solo y despues silencio",
  );
  // y nunca deja un hueco mayor a 24 fallas, que es la promesa del README
  for (let i = 1; i < hablan.length; i++) {
    assert.ok(hablan[i] - hablan[i - 1] <= 24, `el escalon dejo un hueco de ${hablan[i] - hablan[i - 1]} fallas entre ${hablan[i - 1]} y ${hablan[i]}: eso es medio dia de apagon en silencio`);
  }
});

test("la racha del incidente real (24 fallas) produce exactamente 4 mensajes, y una de 140 no produce silencio", { skip: SIN_SH }, () => {
  assert.deepEqual(mensajesDeUnaRacha(24), [1, 3, 12, 24], "la racha del 2026-09-22 tiene que dar 4 mensajes");

  // UNA SEMANA CAIDO: 140 corridas a 20 diarias. Con la version anterior eran 5
  // mensajes, todos en los primeros 2,5 dias, y despues silencio absoluto.
  const semana = mensajesDeUnaRacha(140);
  assert.deepEqual(semana, [1, 3, 12, 24, 48, 72, 96, 120]);
  assert.ok(
    semana[semana.length - 1] > 100,
    `pasada la ventana de 100 corridas el aviso se callo para siempre: el ultimo mensaje fue en la falla ${semana[semana.length - 1]}`,
  );

  // Y con la ventana chica se ve el defecto original en limpio: si la ventana
  // fuera de 40, la version anterior enmudecia a partir de la falla 40.
  const conVentanaChica = mensajesDeUnaRacha(140, 40);
  assert.ok(
    conVentanaChica.filter((i) => i > 40).length >= 4,
    "con la ventana agotada temprano el aviso dejo de hablar: esa es exactamente la falla que este cambio cierra",
  );
});

// ===========================================================================
// 4. LOS NUMEROS DE LOS QUE DEPENDE EL ESCALON ESTAN FIJADOS
//
// La aritmetica de arriba se ejecuta, pero se ejecuta sobre lo que le den. Los
// dos numeros que deciden QUE le llega -- el tamano de la ventana y los
// escalones -- viven en el YAML y sobrevivieron a los mutantes de la primera
// vuelta. Aca quedan clavados.
// ===========================================================================

test("la ventana de corridas que se miran esta fijada, y es la que el mensaje promete", () => {
  // Achicarla a 3 dejaria el aviso mudo despues de la tercera falla (mutante
  // medido que sobrevivia). Con 20 revisiones diarias, 100 corridas son ~5 dias.
  assert.match(AVISO, /^ *VENTANA=100$/m, "cambio el tamano de la ventana: con una ventana chica el aviso se queda sin corridas que contar y enmudece antes");
  assert.match(AVISO, /per_page=\$VENTANA/, "la consulta dejo de usar la ventana declarada");
  assert.match(AVISO, /status=completed/, "la cuenta dejo de mirar solo las corridas terminadas");
});

test("los escalones escritos en el YAML son los que el README le promete al operador", () => {
  const readme = readFileSync(path.join(RAIZ, "README.md"), "utf-8");
  assert.match(AVISO, /habla_en\(\) \{\n\s*\[ "\$1" -eq 1 \] \|\| \[ "\$1" -eq 3 \] \|\| \[ "\$1" -eq 12 \] \|\| \[ \$\(\(\$1 % 24\)\) -eq 0 \]/);
  assert.match(
    readme,
    /falla 1, en la 3, en la 12 y\s*\n?\s*después cada 24/,
    "el README le promete al operador un escalon distinto del que tiene el archivo",
  );
  assert.match(readme, /no se calla nunca/i, "el README dejo de prometer que el aviso sigue hablando en una caida larga");
});

// ===========================================================================
// 5. LAS FORMAS DE ROMPER ESTO EN SILENCIO
// ===========================================================================

test("el guard del webhook dice `-z` y no `-n`: invertirlo deja el aviso MUDO en produccion", () => {
  // MUTANTE MEDIDO QUE SOBREVIVIA: cambiar `[ -z "${WEBHOOK:-}" ]` por `[ -n ... ]`
  // hace que el aviso salga sin mandar nada justo cuando el secreto SI esta
  // configurado -- o sea silencio total en produccion -- y la suite quedaba en
  // verde. Es uno de los tres modos de falla silenciosa que este archivo dice
  // cubrir en su cabecera.
  assert.match(AVISO, /if \[ -z "\$\{WEBHOOK:-\}" \]; then/, "el guard del webhook quedo invertido: el aviso no manda nada cuando el secreto SI esta puesto");
  assert.equal(/if \[ -n "\$\{WEBHOOK:-\}" \]; then/.test(AVISO_CODIGO), false);
});

test("el curl falla ruidosamente si Discord rechaza el aviso", () => {
  // MUTANTE MEDIDO QUE SOBREVIVIA: sin `--fail-with-body`, curl se va en cero
  // aunque Discord conteste 4xx y el paso queda VERDE en Actions. Un aviso que
  // no llego tiene que notarse, en el workflow cuyo unico trabajo es que algo se
  // note.
  assert.match(AVISO, /curl -sS --fail-with-body -X POST/, "el curl dejo de fallar cuando Discord rechaza: un aviso perdido pasaria en verde");
});

test("una corrida SALTADA no se trata como una corrida muerta", () => {
  // El `if` del job de monitor.yml salta las corridas del minuto 53 mientras
  // MODO_CYBER no este en "on", y GitHub le pone conclusion "skipped" a la
  // corrida entera. Ese `if` existe justamente por si alguien agrega los 18
  // horarios y se olvida de la variable -- que es un procedimiento del README,
  // hecho a mano por el operador. Sin este filtro serian 18 falsas alarmas
  // DIARIAS, cada una diciendo "la corrida no llego a terminar" cuando no murio
  // nadie.
  assert.match(AVISO, /if \[ "\$CONCLUSION" = "skipped" \]; then/, "el aviso volvio a tratar una corrida saltada como una muerte");
  assert.match(AVISO, /case "\$c" in\n\s*success\)[\s\S]*?cancelled\|skipped\|""\) continue ;;/, "las saltadas volvieron a contar dentro de la racha");
  // y el `if` del job que las produce tiene que seguir existiendo
  assert.match(MONITOR, /startsWith\(github\.event\.schedule, '53 '\)/, "monitor.yml perdio la red de seguridad del modo Cyber");
});

test("si la API de GitHub no contesta, el aviso lo DICE en vez de fingir que es la primera falla", () => {
  // DEFECTO MEDIDO: las tres llamadas terminaban en `|| echo 1`, asi que un
  // fallo de la API hacia N=1 en TODAS las corridas -- y N=1 siempre habla, o
  // sea las 24 veces que el escalon existe para evitar. Y el mensaje salia
  // diciendo "el job murio sin dejar un paso fallido: suele ser el timeout de
  // 330 min", que era falso. El caso realista es el peor: una incidencia de
  // GitHub tumba 20 corridas seguidas Y degrada la API al mismo tiempo.
  assert.equal(/\|\| echo 1/.test(AVISO_CODIGO), false, "volvio el `|| echo 1`: un fallo de la API se disfraza de primera falla y el freno desaparece");
  assert.match(AVISO, /CONTEO=incierto/, "el aviso ya no distingue 'no hubo exito reciente' de 'no pude contar'");
  assert.match(AVISO, /sleep 5/, "se perdio el reintento: un fallo transitorio de la API no tiene que costar un mensaje falso");
  assert.match(AVISO, /no se pudo contar \(la API de GitHub no respondio\)/, "el mensaje ya no dice que la cuenta es incierta");
  assert.match(AVISO, /no se pudo averiguar: la API de GitHub no respondio/, "el mensaje vuelve a afirmar el timeout cuando en realidad no pudo averiguar nada");
});

test("una cancelacion sin jobs NO se avisa: son los descartes de concurrencia", () => {
  // Medido: 15 de las 35 canceladas de la historia tienen 0 jobs. Son la cola de
  // concurrencia de monitor.yml haciendo lo que tiene que hacer (esta explicado
  // en el README) y avisarlas seria ruido diario garantizado. Las otras 20 SI
  // arrancaron el job -- incluidas 5 que murieron a los 330 min exactos por el
  // timeout -- y esas hasta hoy no mandaban un solo mensaje.
  assert.match(AVISO, /\.jobs \| length/, "el aviso dejo de contar los jobs y ya no puede distinguir un descarte de una muerte");
  assert.match(AVISO, /\$CONCLUSION" = "cancelled" \] && \[ "\$\{JOBS:-x\}" = "0" \]/, "se perdio el filtro de los descartes de concurrencia");
  // y el `:-x` no es cosmetico: con `:-0`, una consulta de jobs que falla se
  // lee como "0 jobs" y una muerte de verdad se descarta como si fuera ruido
  assert.equal(/JOBS:-0/.test(AVISO_CODIGO), false, "con `:-0`, una API caida convierte una muerte de verdad en un descarte silencioso");
});

test("la racha se cuenta del historial de GitHub, no de un archivo del repo", () => {
  // Un archivo de huellas exigiria commitear desde este workflow (carrera con
  // los commits del monitor) o leer la carpeta de datos (confiar en el codigo
  // que podria ser el roto). El historial de corridas no se puede desincronizar.
  assert.match(AVISO, /actions\/workflows\/\$WF_ID\/runs/);
  assert.match(AVISO, /contar_racha/, "se perdio la cuenta de la racha");
  assert.equal(/index\("success"\)/.test(AVISO_CODIGO), false, "volvio la cuenta con `index(\"success\") // N`, que enmudece para siempre cuando la ventana no trae ningun exito");
});

// ===========================================================================
// 6. EL MENSAJE TIENE QUE DECIR SI HUBO O NO HUBO MONITOREO
// ===========================================================================

test("el mensaje distingue morir en las pruebas de morir al guardar: son gravedades opuestas", () => {
  // Medido: las 24 fallas del incidente murieron en "Pruebas automatizadas", o
  // sea NO HUBO REVISION. Las 7 anteriores murieron en "Guardar historial y
  // ultimo estado", o sea el sitio SI se reviso y los avisos SI salieron: no es
  // una emergencia. Un mensaje que las tratara igual entrenaria al operador a
  // ignorar el importante.
  assert.match(AVISO, /\*Guardar\*\)/, "el mensaje dejo de reconocer la falla de guardado");
  assert.match(AVISO, /\*Pruebas\*\)/, "el mensaje dejo de reconocer la falla de pruebas");
  assert.match(AVISO, /No hubo revisi/, "el mensaje ya no dice si hubo o no hubo monitoreo");
  assert.match(AVISO, /No perdiste avisos/, "el mensaje ya no tranquiliza cuando la falla es inofensiva");
  assert.match(AVISO, /steps\[\]\? \| select\(\.conclusion == "failure"\)/, "el aviso dejo de averiguar que paso fallo");
  // Y los nombres que busca tienen que ser los que monitor.yml de verdad usa:
  // si alguien renombra el paso, el mensaje cae en el caso generico y el
  // operador deja de distinguir un apagon de un choque de push.
  assert.match(MONITOR, /- name: Pruebas automatizadas/, "el paso de pruebas se renombro y el mensaje del aviso ya no lo reconoce");
  assert.match(MONITOR, /- name: Guardar historial/, "el paso de guardado se renombro y el mensaje del aviso ya no lo reconoce");
});

test("el titulo del mensaje lo decide el paso que CUENTA, no el que manda", () => {
  // DEFECTO ENCONTRADO EJECUTANDO EL WORKFLOW DE VERDAD (con `gh`, `jq` y `curl`
  // de mentira, bajo `bash -eo pipefail`, que es como corre en Actions): el
  // titulo se armaba en el paso del mensaje a partir del numero de la racha, y
  // con la cuenta incierta ese numero es 0. El operador habria recibido "El
  // monitor lleva 0 revisiones seguidas sin correr", que es una frase sin
  // sentido justo en el caso mas confuso. Ahora el titulo sale del paso que sabe
  // cual de los tres casos es.
  assert.match(AVISO, /echo "titulo=\$TITULO"/, "el paso que cuenta dejo de decidir el titulo");
  assert.match(AVISO, /TITULO: \$\{\{ steps\.decidir\.outputs\.titulo \}\}/, "el mensaje dejo de recibir el titulo del paso anterior");
  // los tres titulos, uno por caso
  assert.match(AVISO, /no se pudo averiguar cuántas van/, "se perdio el titulo del caso 'no pude contar'");
  assert.match(AVISO, /El monitor lleva más de \$VENTANA revisiones seguidas sin correr/, "se perdio el titulo del apagon mas largo que la ventana");
  assert.match(AVISO, /Una revisión del monitor falló\*\*"/, "se perdio el titulo de la primera falla");
  // y el mensaje tiene su propia frase para cuando no se pudo averiguar el paso
  assert.match(AVISO, /No se pudo averiguar qué falló/, "el mensaje cae en el caso generico cuando la API no contesto");
});

test("el mensaje trae la ultima revision que si termino bien y el link a la corrida", () => {
  // Es el dato con el que el operador distingue un tropiezo de un apagon sin
  // tener que entrar a Actions.
  assert.match(AVISO, /status=success/, "el aviso ya no busca la ultima corrida buena");
  assert.match(AVISO, /workflow_run\.html_url/, "el aviso perdio el link a la corrida");
});

// ===========================================================================
// 7. EL CANDADO SIGUE BLOQUEANDO, Y AHORA TAMBIEN CORRE EN CADA PUSH
// ===========================================================================

test("`npm test` sigue BLOQUEANDO la revision de produccion", () => {
  // La reaccion facil al incidente habria sido ponerle `continue-on-error` a
  // este paso. No se hizo: el candado defiende que un codigo roto no gaste 1.185
  // requests contra samsung.com ni escriba un catalogo malo (revertir eso obliga
  // a revertir DATOS, ver BITACORA.md del 2026-09-11). Lo que cambio es lo que
  // hay adentro, no el candado.
  const paso = MONITOR.slice(MONITOR.indexOf("- name: Pruebas automatizadas"));
  const hastaElSiguiente = paso.slice(0, paso.indexOf("- run: npx"));
  assert.match(hastaElSiguiente, /run: npm test/);
  assert.equal(/continue-on-error/.test(hastaElSiguiente), false, "el candado de produccion dejo de bloquear: no es lo que arregla el incidente");
});

test("las pruebas ademas corren en cada push, que es donde bloquear no cuesta nada", () => {
  // Medido: hasta el 2026-09-23, monitor.yml era el UNICO workflow del repo y
  // solo se disparaba por `schedule` y `workflow_dispatch`. Las 550 pruebas no
  // corrian NUNCA al cambiar codigo: el commit malo entraba igual y el candado
  // solo podia apagar el monitoreo horas despues. Con esto, el mismo candado
  // frena al autor.
  assert.match(PRUEBAS, /^on:\n\s*push:/m, "el workflow de pruebas dejo de correr en push");
  assert.match(PRUEBAS, /pull_request:/);
  assert.match(PRUEBAS, /run: npm test/);
  // y no puede mandar nada a Discord ni abrir samsung.com. Se miran las lineas
  // de verdad y no los comentarios, que es donde este archivo EXPLICA que no le
  // pasa el webhook.
  const sinComentarios = PRUEBAS.replace(/^\s*#.*$/gm, "");
  assert.equal(/DISCORD_WEBHOOK_URL/.test(sinComentarios), false, "el workflow de pruebas recibio el webhook: no tiene nada que avisar");
  assert.equal(/playwright/.test(sinComentarios), false, "el workflow de pruebas instalo un navegador: la suite corre offline");
});

test("el censo corre en la revision y NO puede tumbarla", () => {
  // Las dos mitades importan. Si el censo no corriera, las preguntas que salieron
  // del candado no las haria nadie; si pudiera fallar, seria otra vez un canario
  // cableado al interruptor -- con la diferencia de que se llamaria distinto y
  // nadie lo relacionaria con el incidente.
  const paso = MONITOR.slice(MONITOR.indexOf("- name: Censo del cat"));
  const hastaElSiguiente = paso.slice(0, paso.indexOf("- name: Guardar historial"));
  assert.match(hastaElSiguiente, /run: npm run censo/, "el censo dejo de correr en la revision");
  assert.match(hastaElSiguiente, /continue-on-error: true/, "el censo puede tumbar la corrida: es exactamente el defecto que este cambio cierra");
  assert.match(hastaElSiguiente, /if: always\(\)/, "el censo dejo de correr cuando el scrape se cae, que es cuando mas sirve");
  // y va DESPUES del scrape, para medir el catalogo que esta corrida escribio
  assert.ok(
    MONITOR.indexOf("- name: Censo del cat") > MONITOR.indexOf("- name: Revisar precios"),
    "el censo quedo antes del scrape: mediria el catalogo del checkout, que puede ser de horas antes",
  );
});

test("`npm run censo` de verdad apunta al censo, y no a otra cosa", () => {
  // MUTANTE MEDIDO QUE SOBREVIVIA: las pruebas verificaban por un lado que el
  // workflow dijera `npm run censo` y por otro lanzaban el CLI directo, y nadie
  // unia los dos extremos. O sea que el censo se podia desconectar entero
  // editando UNA linea de package.json, con la suite en verde. Aca se resuelve
  // el script como lo resuelve npm.
  const script = PAQUETE.scripts?.censo;
  assert.ok(script, "package.json se quedo sin el script `censo`: el paso del workflow no corre nada");
  assert.match(script, /censo-cli\.mjs/, `el script \`censo\` apunta a otra cosa ("${script}"): el paso del workflow queda en verde sin censar nada`);
  assert.ok(existsSync(path.join(RAIZ, "src", "censo-cli.mjs")), "el script `censo` apunta a un archivo que no existe");
});

// ===========================================================================
// 8. LOS TRES ARCHIVOS TIENEN QUE SER YAML VALIDO
// ===========================================================================

test("ningun workflow tiene una linea pegada al margen dentro de un bloque `run:`", () => {
  // NO ES UNA REGLA DE ESTILO: es el unico error de YAML que se comete de verdad
  // escribiendo estos archivos, y se cometio escribiendo el aviso (un script
  // embebido en un `run: |` empezaba en la columna 0 y el archivo dejo de
  // parsearse). Un YAML que no parsea no es "un paso que falla": es el workflow
  // ENTERO deshabilitado, o sea el monitor apagado y sin aviso, que es peor que
  // el incidente que este cambio cierra. La nota de `timeout-minutes` en
  // monitor.yml ya advierte de esto mismo.
  //
  // Los tres archivos se parsearon ademas con un parser de YAML de verdad al
  // escribirlos; esto es lo que queda vigilando en cada corrida sin agregar una
  // dependencia al proyecto.
  const CLAVES_RAIZ = /^(name|on|permissions|concurrency|jobs|env|defaults):/;
  for (const [nombre, texto] of [
    ["monitor.yml", MONITOR],
    ["avisar-falla.yml", AVISO],
    ["pruebas.yml", PRUEBAS],
  ]) {
    texto.split("\n").forEach((l, i) => {
      if (l.trim() === "" || /^\s/.test(l)) return;
      if (/^#/.test(l)) return;
      if (CLAVES_RAIZ.test(l)) return;
      assert.fail(`${nombre}:${i + 1} tiene una linea pegada al margen que no es una clave raiz: "${l.slice(0, 60)}" — el archivo no va a parsear y GitHub deshabilita el workflow entero`);
    });
  }
});

test("los tres workflows existen y ninguno se quedo sin job", () => {
  for (const nombre of ["monitor.yml", "avisar-falla.yml", "pruebas.yml"]) {
    assert.ok(existsSync(wf(nombre)), `falta .github/workflows/${nombre}`);
  }
  for (const [nombre, texto] of [
    ["monitor.yml", MONITOR],
    ["avisar-falla.yml", AVISO],
    ["pruebas.yml", PRUEBAS],
  ]) {
    assert.match(texto, /^jobs:$/m, `${nombre} se quedo sin jobs`);
    assert.match(texto, /^\s{4}runs-on: ubuntu-latest$/m, `${nombre} se quedo sin runner`);
  }
});
