// Paige live presence — headless runtime smoke test.
//
// WHY THIS EXISTS (§32). The presence is wrapped in a SceneBoundary, so a runtime throw degrades to
// the flat presence instead of crashing the stage. That is the right behaviour and it is also how a
// compiles-but-crashes bug hides: `tsc` and `vite build` pass, the corner quietly shows the 2D
// fallback, and nobody learns the 3D never ran. Worse for a shader: a GLSL uniform that the
// JavaScript never supplies does not throw at all — it silently reads as zero, and the strand
// renders as an invisible flat line that looks exactly like "Paige isn't talking". No type checker
// on earth catches that, because the shader is a string.
//
// So this script executes the real geometry the scene builds, and cross-checks the shader's
// declared uniforms against the ones the component actually provides, in both directions.
//
// Run:  node scripts/paige-presence-3d-smoke.mjs   (plain node; no type stripping, so it runs on CI's Node 20)
// Exit: 0 = the runtime logic runs clean; non-zero = it would render wrong or fall back to flat.
import * as THREE from "three";
import fs from "node:fs";

const SCENE = "src/components/paige/live/PaigePresenceScene.tsx";

let failures = 0;
const ok = (msg) => console.log("✓ " + msg);
const bad = (msg) => { console.error("✗ " + msg); failures += 1; };

if (!fs.existsSync(SCENE)) {
  console.error(`✗ ${SCENE} is missing`);
  process.exit(1);
}
const source = fs.readFileSync(SCENE, "utf8");

// ---------------------------------------------------------------------------------------------
// §30 — THE STRIP ACTUALLY HAPPENED.
// Two designs were removed from this file: the sculpted humanoid GLB, and the sphere that briefly
// replaced it. "Did I actually strip the old out, or just cover it?" is the question §30 exists to
// force, and the honest answer has to be checkable rather than remembered. Comments are allowed to
// discuss what was removed; code is not allowed to still do it.
// ---------------------------------------------------------------------------------------------
const code = source.replace(/\/\*[\s\S]*?\*\//g, (m) => (m.startsWith("/* glsl */") ? m : "")).replace(/^\s*\/\/.*$/gm, "");
for (const [pattern, what] of [
  [/useGLTF/, "the GLTF loader"],
  [/paige-woman\.glb|\.glb["'`]/, "a GLB model reference"],
  [/TorusGeometry/, "the old halo torus"],
  [/PlaneGeometry/, "the flat waveform ribbon"],
]) {
  if (pattern.test(code)) bad(`§30: ${what} is still live in the scene — the previous design was covered, not stripped`);
  else ok(`§30: ${what} is gone from the scene`);
}

// ---------------------------------------------------------------------------------------------
// THE SHADER/UNIFORM CONTRACT. This is the check that earns the file.
// ---------------------------------------------------------------------------------------------
// A BACKTICK INSIDE THE GLSL ENDS THE TEMPLATE LITERAL AND BREAKS THE BUILD. It has happened twice
// while writing this shader, both times in a prose comment quoting an identifier, and both times the
// symptom was a baffling "unbalanced braces" from the checks below rather than the actual cause.
// Named explicitly so the next occurrence reports itself in one line.
const shaderRegion = source.slice(source.indexOf("const VERTEX"), source.lastIndexOf("`;") + 2);
const opens = (shaderRegion.match(/\/\* glsl \*\/ `/g) || []).length;
const ticks = (shaderRegion.match(/`/g) || []).length;
if (opens > 0 && ticks !== opens * 2) {
  bad(`a stray backtick is inside a GLSL template literal (${ticks} backticks across ${opens} shader(s); expected ${opens * 2}) — this terminates the literal and is a build break, not a shader bug`);
}

const glsl = {};
for (const name of ["VERTEX", "FRAGMENT"]) {
  const match = source.match(new RegExp(`const ${name} = /\\* glsl \\*/ \`([\\s\\S]*?)\``));
  if (!match) { bad(`could not extract the ${name} shader source`); continue; }
  glsl[name] = match[1];
}
if (!glsl.VERTEX || !glsl.FRAGMENT) process.exit(1);
ok("both shader sources extracted");

// three injects its own declarations for these, so a shader using them declares nothing.
const BUILTIN = new Set([
  "modelMatrix", "modelViewMatrix", "projectionMatrix", "viewMatrix", "normalMatrix",
  "cameraPosition", "position", "normal", "uv",
]);

const declared = new Set();
for (const body of [glsl.VERTEX, glsl.FRAGMENT]) {
  for (const line of body.matchAll(/^\s*uniform\s+\w+\s+([^;]+);/gm)) {
    for (const name of line[1].split(",")) {
      const clean = name.trim().replace(/\[.*$/, "");
      if (clean && !BUILTIN.has(clean)) declared.add(clean);
    }
  }
}
if (declared.size === 0) bad("no uniforms were parsed out of the shaders — the parser is broken, not the shader");
else ok(`${declared.size} uniform(s) declared in GLSL: ${[...declared].sort().join(", ")}`);

// The uniforms the component actually hands to ShaderMaterial.
const block = source.match(/uniforms:\s*\{([\s\S]*?)\n\s{6}\},/);
const supplied = new Set();
if (!block) bad("could not find the `uniforms:` object in the component");
else for (const key of block[1].matchAll(/^\s*(u[A-Za-z0-9_]*)\s*:/gm)) supplied.add(key[1]);
ok(`${supplied.size} uniform(s) supplied by the component: ${[...supplied].sort().join(", ")}`);

for (const name of declared) {
  // THE SILENT ONE. A uniform the shader reads and the component never sets is zero forever: no
  // throw, no warning, just a wave that never moves.
  if (!supplied.has(name)) bad(`${name} is read by the shader but never supplied — it would be silently zero at runtime`);
}
for (const name of supplied) {
  if (!declared.has(name)) bad(`${name} is supplied by the component but declared in neither shader — dead, or a typo of one that is missing`);
}
if (declared.size && supplied.size && [...declared].every((n) => supplied.has(n)) && [...supplied].every((n) => declared.has(n))) {
  ok("every shader uniform is supplied, and every supplied uniform is used — no silently-zero terms");
}

// Structural GLSL sanity. Not a compiler, but it catches the truncation and paste errors that make
// a shader fail to compile — which three reports only to the console, leaving a blank canvas.
for (const [name, body] of Object.entries(glsl)) {
  const braces = (body.match(/\{/g) || []).length - (body.match(/\}/g) || []).length;
  const parens = (body.match(/\(/g) || []).length - (body.match(/\)/g) || []).length;
  if (braces !== 0) bad(`${name}: unbalanced braces (${braces > 0 ? braces + " unclosed" : -braces + " extra"})`);
  else if (parens !== 0) bad(`${name}: unbalanced parentheses (${parens > 0 ? parens + " unclosed" : -parens + " extra"})`);
  else ok(`${name}: braces and parentheses balance`);
  if (!/void\s+main\s*\(\s*\)/.test(body)) bad(`${name}: no main()`);
}
if (!/gl_Position\s*=/.test(glsl.VERTEX)) bad("VERTEX never assigns gl_Position — nothing would be drawn");
else ok("VERTEX assigns gl_Position");
if (!/gl_FragColor\s*=/.test(glsl.FRAGMENT)) bad("FRAGMENT never assigns gl_FragColor — nothing would be shaded");
else ok("FRAGMENT assigns gl_FragColor");

// Every varying written by the vertex shader must be declared by the fragment shader that reads it,
// or the program fails to link — again, console-only.
const vVarying = new Set([...glsl.VERTEX.matchAll(/^\s*varying\s+\w+\s+([^;]+);/gm)].flatMap((m) => m[1].split(",").map((s) => s.trim())));
const fVarying = new Set([...glsl.FRAGMENT.matchAll(/^\s*varying\s+\w+\s+([^;]+);/gm)].flatMap((m) => m[1].split(",").map((s) => s.trim())));
for (const name of fVarying) {
  if (!vVarying.has(name)) bad(`FRAGMENT reads varying ${name} that VERTEX never declares — the program would not link`);
}
if ([...fVarying].every((n) => vVarying.has(n))) ok(`varyings agree across stages (${[...fVarying].sort().join(", ") || "none"})`);

// ---------------------------------------------------------------------------------------------
// ONLY HER OWN VOICE MOVES THE STRAND.
// The owner asked for the wave to go CALM while he is speaking to her, because she is being
// interrupted and is receiving rather than performing. `presenceFrame` reports energy for listening
// too, so that behaviour lives entirely in this one gate — and a refactor that "simplified" it back
// to frame.energy would restore a wave that dances while someone talks over her, with every test
// still green. It is asserted here because there is nowhere else it can be.
// ---------------------------------------------------------------------------------------------
if (!/state === "speaking" \? frame\.energy : 0/.test(code)) {
  bad("the scene no longer gates amplitude on her OWN speech — it would animate while being spoken to");
} else ok("amplitude is gated on speaking: being spoken to leaves the wave calm");
if (!/state === "listening" \? 0\.\d+ :/.test(code)) {
  bad("listening is no longer the calmest state — the resting breath is not damped while she listens");
} else ok("listening damps below idle: the calmest state in the scene");

// ---------------------------------------------------------------------------------------------
// THE GEOMETRY THE SCENE ACTUALLY BUILDS.
// ---------------------------------------------------------------------------------------------
const subdivision = Number(source.match(/const SUBDIVISION = (\d+);/)?.[1]);
const radius = Number(source.match(/const RADIUS = ([\d.]+);/)?.[1]);
if (!Number.isFinite(subdivision)) bad("could not read SUBDIVISION out of the scene");
if (!Number.isFinite(radius)) bad("could not read RADIUS out of the scene");

// IT MUST BE A BODY IN 3D, NOT A DISC. Each of these is a property the owner asked for by name and
// that nothing else in the suite can observe, because a shader is a string and jsdom draws nothing.
if (!/IcosahedronGeometry/.test(code)) bad("the presence is no longer built on a sphere — it was asked to be an isolated orb");
else ok("the body is an icosphere");
if (!/camera=\{\{ position: \[0, 0, [\d.]+\], fov: [\d.]+ \}\}/.test(code)) {
  bad("the camera is no longer perspective — an orthographic orb is a disc with a gradient on it");
} else ok("the camera is perspective: the orb reads as a body");
if (!/cross\(pa - displaced, pb - displaced\)/.test(source)) {
  bad("the shading normal is no longer recomputed from the displaced neighbours — light would slide over a shape it is not lit by");
} else ok("the shading normal follows the deformation: it is lit as the shape it actually is");
if (!/uPulse/.test(source)) bad("the whole-body pulse is gone — the object would ripple without beating");
else ok("the body pulses as a whole object");
if (!/bands/.test(source)) bad("the travelling surface bands are gone — the object would beat without waving");
else ok("the surface carries travelling bands");

try {
  const geometry = new THREE.IcosahedronGeometry(radius, subdivision);
  const position = geometry.attributes.position;
  if (!position?.count) bad(`IcosahedronGeometry(${radius}, ${subdivision}) built with no vertices`);
  else {
    const array = position.array;
    let finite = true;
    for (let i = 0; i < array.length; i++) if (!Number.isFinite(array[i])) { finite = false; break; }
    if (!finite) bad("the body geometry produced non-finite positions");
    else ok(`IcosahedronGeometry(${radius}, ${subdivision}) builds (${position.count} vertices, all finite)`);
    // A budget, not a hope.
    if (position.count > 80000) bad(`the body would build ${position.count} vertices, over the 80000 budget for a corner surface`);
    else ok(`total presence cost: ${position.count} vertices`);
  }
  geometry.dispose();
} catch (error) {
  bad(`IcosahedronGeometry threw: ${error?.message ?? error}`);
}

// ---------------------------------------------------------------------------------------------
// HONESTY — that silence stays silent, and that being spoken TO does not animate her, are asserted
// in src/lib/paigeLiveConversation/presence.test.ts. They need to import presence.ts, and the CI job
// that runs this smoke is on Node 20, which has no type stripping; importing it here would have
// meant the honesty checks silently SKIPPED in the one place they matter. Splitting them to the
// runner that can execute them is the difference between a check that runs and a check that reports
// nothing and looks identical.
// ---------------------------------------------------------------------------------------------

if (failures) {
  console.error(`\n✗ paige live presence smoke: ${failures} failure(s) — this would render wrong or degrade to flat in production`);
  process.exit(1);
}
console.log("\n✓ paige live presence smoke: shaders link, every uniform is supplied, the strand geometry builds");
