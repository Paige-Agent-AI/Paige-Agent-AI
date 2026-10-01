import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { presenceFrame, SILENT_ENERGY, type AudioEnergy, type PresenceState } from "@/lib/paigeLiveConversation/presence";

/**
 * Paige talking, as a single body in three dimensions.
 *
 * THE THREE THINGS THIS IS NOT, EACH LEARNED THE EXPENSIVE WAY. Not a character: a sculpted humanoid
 * shipped here first and was rejected on sight, because a figure in the corner of a call is a costume
 * for presence rather than presence. Not a stroke: the next build drew hairline strands and read as a
 * bleep, because a line has no mass. Not a running waveform either: the build after that filled the
 * strip into a ribbon, and a ribbon travelling left to right is a streaming audio meter, not someone
 * speaking. What was asked for, and what this is, is an ISOLATED ORB THAT PULSES AS A WHOLE OBJECT
 * and carries the wave ON ITS SURFACE.
 *
 * SO THE MOTION HAS TWO PARTS, AND BOTH MATTER. The BODY pulses — the entire radius swells and
 * settles with her amplitude, which is the beat you feel. The SURFACE waves — travelling bands run
 * across it, with fine chop added on bright consonants. A body that only pulsed would be a throbbing
 * ball; a surface that only rippled would be a textured sphere sitting still. Speech is both at once.
 *
 * IT IS DELIBERATELY NOT A PERFECT SPHERE. A slow, low-frequency noise field turns it just off-round
 * and keeps it turning, so it reads as a living body rather than as a primitive.
 *
 * WHY THE LIGHTING IS REAL. The shading normal is recomputed from the DISPLACED neighbours rather
 * than inherited from the undeformed sphere, so light actually travels across the new shape. That is
 * the whole difference between an object and a lit circle, and it is what makes this read as 3D
 * rather than as a disc with a gradient on it.
 *
 * CALM WHILE SHE IS BEING SPOKEN TO. presenceFrame reports energy for speaking and listening alike,
 * which is right for a generic presence and wrong for this one: when someone interrupts her she is
 * receiving, so the body settles and the warm accent drains out. Only her own voice moves it. That
 * gating lives here, in presentation, and only ever REMOVES motion — it can never manufacture any.
 *
 * HONEST BY CONSTRUCTION (§13). Every audio-derived value originates in presenceFrame, whose energy
 * is zero unless a real sample arrived from the output or microphone analyser, and whose detail
 * carries real spectral brightness. A body that pulsed on a timer would look richer and would be a
 * lie about whether anything was heard. The resting breath is fixed, slow and visibly not speech.
 *
 * GOLD IS THE ACT (§11). Indigo at rest and through every listening moment; the rim crosses to gold
 * only as her own output amplitude rises. Nothing else in the frame is warm.
 */

/** Resting breath of the whole body. Slow and shallow: never mistakable for speech. */
const IDLE_PULSE = 0.035;
/** How far her real amplitude may swell the body. This is the beat. */
const ENERGY_PULSE = 0.3;
/** How far her real amplitude may throw the travelling surface bands. */
const ENERGY_WAVE = 0.19;
/** Thinking reads as the livelier of the two busy states; working is steadier, because it runs long. */
const THINKING_PULSE = 0.055;
const WORKING_PULSE = 0.035;
/** Subdivision. 20·(n+1)² faces — 32 gives ~21k, smooth enough for fine chop on a laptop GPU. */
const SUBDIVISION = 24;
/** Base radius in world units. The camera and the fit are derived from this. */
const RADIUS = 1.0;

const SETTLED: ReadonlySet<PresenceState> = new Set(["held", "disconnected", "interrupted", "unavailable"]);

/**
 * Read one `H S% L%` design token into a colour.
 *
 * The scene lives in WebGL, where a CSS variable cannot reach, and answering that with hardcoded hex
 * makes the surface identical in both themes — silently breaking §23's requirement that light and
 * dark be unmistakably different. Resolving the real token at mount keeps the palette authoritative
 * in the one place it is written down.
 */
function token(styles: CSSStyleDeclaration, name: string, fallback: string): THREE.Color {
  const raw = styles.getPropertyValue(name).trim();
  const [h, s, l] = raw.split(/[\s/]+/);
  const colour = new THREE.Color();
  if (!h || !s || !l) return colour.set(fallback);
  const hue = Number.parseFloat(h), sat = Number.parseFloat(s), lum = Number.parseFloat(l);
  if (![hue, sat, lum].every(Number.isFinite)) return colour.set(fallback);
  return colour.setHSL(hue / 360, sat / 100, lum / 100);
}

/**
 * Ashima Arts / Stefan Gustavson 3D simplex noise (MIT). Vendored rather than added as a dependency:
 * §22 says a new npm package is a proposal, never a reflex, and this is fifty lines of GLSL that has
 * not changed in a decade.
 */
const SIMPLEX = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.); const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))
        +i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.; vec4 s1=floor(b1)*2.+1.; vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.); m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`;

// NOTE TO ANYONE EDITING THE GLSL BELOW: no backticks in these comments. A backtick terminates the
// template literal and breaks the build. It has happened twice; the smoke test now names it.
const VERTEX = /* glsl */ `
uniform float uTime, uEnergy, uDetail, uPulse, uBusy;
varying vec3 vNormal, vView;
varying float vCrest;
${SIMPLEX}

/**
 * Radial offset at a point on the unit sphere.
 *
 * Three terms, each doing a different job. The blob keeps the body off-round and slowly turning.
 * The bands are the WAVE: travelling rings that run across the surface, thrown by her amplitude.
 * The chop is fine structure that only appears on bright sounds, so consonants read differently
 * from vowels.
 */
float relief(vec3 n){
  float blob  = snoise(n * 1.15 + vec3(0.0, 0.0, uTime * 0.18)) * 0.15;
  float bands = sin(n.y * 7.0 - uTime * 3.2) * 0.6
              + sin(n.y * 11.0 + n.x * 4.0 - uTime * 5.1) * 0.4;
  float chop  = snoise(n * 4.2 + vec3(uTime * 0.9, 0.0, 0.0)) * uDetail * 0.085;
  float work  = sin(n.y * 5.0 - uTime * 2.2) * uBusy;
  return blob + bands * uEnergy * ${ENERGY_WAVE.toFixed(3)} + chop + work;
}

/** The body as a whole: base radius plus the pulse, plus the surface relief. */
float shape(vec3 n){
  return ${RADIUS.toFixed(2)} + uPulse + relief(n);
}

void main(){
  vec3 n = normalize(position);
  vec3 displaced = n * shape(n);

  // The shading normal must follow the deformation or the light slides over a shape it is not lit
  // by — the tell that separates an object from a lit circle. Sample two tangent neighbours and
  // cross their displaced offsets. With b = n x t, cross(PA-P, PB-P) resolves along +n, so the
  // winding is correct by construction rather than by trial.
  vec3 t = normalize(cross(n, abs(n.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
  vec3 b = cross(n, t);
  float eps = 0.03;
  vec3 na = normalize(n + t * eps); vec3 nb = normalize(n + b * eps);
  vec3 pa = na * shape(na);         vec3 pb = nb * shape(nb);
  vNormal = normalize(mat3(modelMatrix) * normalize(cross(pa - displaced, pb - displaced)));

  // How far this point rode out of the resting body, for the crest highlight.
  vCrest = clamp((length(displaced) - ${RADIUS.toFixed(2)}) * 2.2, -1.0, 1.0);

  vec4 world = modelMatrix * vec4(displaced, 1.0);
  vView = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform vec3 uCore, uRim, uGold, uGlow;
uniform float uLight, uSpeak, uFlash;
varying vec3 vNormal, vView;
varying float vCrest;

void main(){
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vView);

  // One key, high and to the left, wrapped so the terminator stays soft on a deep body.
  vec3 L = normalize(vec3(-0.42, 0.76, 0.64));
  float key = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
  float diffuse = pow(key, 1.5);

  // Fresnel: the body reads as volume because the edge carries the colour, not the middle.
  float fresnel = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);

  // Gold arrives ONLY with her own speech. At rest and while listening this is zero and the whole
  // body is indigo.
  vec3 rim = mix(uRim, uGold, clamp(uSpeak, 0.0, 1.0));

  // MORE COLOUR THAN A SINGLE HUE. The body travels from the deep core toward a lighter violet as
  // it turns into the light, so it reads as a coloured object rather than one tint at two
  // brightnesses. Still indigo family — the accent budget is untouched.
  vec3 body = mix(uCore, uGlow, smoothstep(0.15, 0.95, diffuse));
  vec3 colour = body * (0.34 + diffuse * 0.66);
  colour += rim * fresnel * (0.75 + uLight * 0.9);
  // Crests catch more light than troughs, so the travelling bands are legible as form.
  colour += rim * clamp(vCrest, 0.0, 1.0) * (0.55 + uSpeak * 1.1);

  // THE SPARK. On a peak in her voice the crests that are riding highest catch a brief highlight
  // that decays fast — the flash the owner asked for. It is keyed to uFlash, which only rises on a
  // real jump in output amplitude, so it fires on the stresses in a sentence and never on silence.
  float ridge = smoothstep(0.35, 1.0, clamp(vCrest, 0.0, 1.0));
  colour += mix(uGlow, uGold, clamp(uSpeak, 0.0, 1.0)) * ridge * uFlash * 1.5;

  // A soft interior lift keeps the centre from reading as a hole on the dark theme.
  colour += uCore * uLight * 0.3;

  gl_FragColor = vec4(colour, 1.0);
  #include <colorspace_fragment>
}
`;

function Orb({ state, reduced, readEnergy, onCrash }: {
  state: PresenceState;
  reduced: boolean;
  readEnergy: () => AudioEnergy;
  onCrash: () => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const group = useRef<THREE.Group>(null);
  const invalidate = useThree((three) => three.invalidate);
  const viewport = useThree((three) => three.viewport);
  const crashed = useRef(false);
  // Previous eased amplitude, so a RISE can be told from a level. A flash on loudness alone would
  // glow steadily through a long vowel; a flash on the rise fires on the stresses.
  const lastEnergy = useRef(0);
  const settled = SETTLED.has(state);

  const geometry = useMemo(() => new THREE.IcosahedronGeometry(RADIUS, SUBDIVISION), []);

  const material = useMemo(() => {
    const styles = getComputedStyle(document.documentElement);
    // --primary, NOT --ring. The focus ring resolves to a pale gold on the dark theme, so sourcing
    // the resting colour from it would make the body gold while nothing was being said — gold spent
    // on idling, the one thing §11 forbids.
    const primary = token(styles, "--primary", "#6c5ce0");
    const core = primary.clone().multiplyScalar(0.55);
    // A lighter, slightly cooler violet the body travels toward in the light. Derived from the same
    // token rather than a second hardcoded hue, so both themes stay coherent.
    const glow = primary.clone().lerp(new THREE.Color("#ffffff"), 0.34);
    return new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0 },
        uDetail: { value: 0 },
        uLight: { value: 0.28 },
        uSpeak: { value: 0 },
        uPulse: { value: 0 },
        uBusy: { value: 0 },
        uFlash: { value: 0 },
        uCore: { value: core },
        uGlow: { value: glow },
        uRim: { value: primary },
        uGold: { value: token(styles, "--accent", "#ebb94c") },
      },
    });
  }, []);

  // Both are created here rather than handed over by a cache, so both are ours to free. The stage
  // opens and closes repeatedly and three.js frees no GPU memory on unmount.
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);

  // FILL THE FRAME. The body is the presence, so it takes the room it is given rather than sitting
  // small in the middle of it — the previous build was called slim and slender, and a corner with a
  // thin thing in it does not read as someone in the room with you.
  useEffect(() => {
    if (!group.current) return;
    const fit = Math.min(viewport.width, viewport.height) / (RADIUS * 1.95);
    group.current.scale.setScalar(fit);
    if (reduced) invalidate();
  }, [viewport.width, viewport.height, reduced, invalidate]);

  // Reduced motion must SETTLE the body, not freeze it mid-deformation. The canvas is on demand, so
  // put the uniforms in their resting pose by hand and ask for the single frame that shows it.
  useEffect(() => {
    if (!reduced) return;
    const still = presenceFrame(state, 0);
    const u = material.uniforms;
    u.uTime.value = 0; u.uEnergy.value = 0; u.uDetail.value = 0;
    u.uSpeak.value = 0; u.uBusy.value = 0; u.uPulse.value = 0; u.uFlash.value = 0;
    u.uLight.value = still.light;
    if (mesh.current) mesh.current.rotation.set(0, 0, 0);
    invalidate();
  }, [reduced, state, material, invalidate]);

  useFrame(({ clock }, delta) => {
    if (reduced || crashed.current || !mesh.current) return;
    // A THROW HERE ESCAPES THE ERROR BOUNDARY ENTIRELY. R3F calls frame subscribers from inside a
    // requestAnimationFrame callback and React boundaries catch render and lifecycle errors only, so
    // an exception would repeat ~60 times a second forever, freeze the canvas on its last frame, and
    // never reach SceneBoundary or print the one console line the degrade contract rests on.
    try {
      const frame = presenceFrame(state, clock.elapsedTime, readEnergy());
      const t = clock.elapsedTime;

      // ONLY HER OWN VOICE MOVES THE BODY. While she is being spoken to she is receiving, so the
      // pulse settles and the accent drains. This can only ever reduce motion below what
      // presenceFrame reported; it can never invent any.
      const hers = state === "speaking" ? frame.energy : 0;
      const detail = state === "speaking" ? frame.detail : 0;
      // Her working the person's jobs is a state they should be able to SEE, distinct from both
      // silence and speech.
      const busy = state === "thinking" ? THINKING_PULSE : state === "working" ? WORKING_PULSE : 0;
      // Listening is the calmest state in the scene — calmer than idle, which is the point.
      const breathScale = state === "listening" ? 0.3 : settled ? 0.55 : 1;
      const breath = Math.sin(t * 0.85) * IDLE_PULSE * breathScale;
      const pulse = breath + hers * ENERGY_PULSE;

      const u = material.uniforms;
      u.uTime.value = t;
      // Eased toward the sample rather than snapped to it: a voice envelope is continuous, and
      // per-frame jitter on the raw analyser value reads as noise rather than speech.
      u.uEnergy.value += (hers - u.uEnergy.value) * Math.min(1, delta * 12);
      u.uDetail.value += (detail - u.uDetail.value) * Math.min(1, delta * 9);
      u.uSpeak.value += (hers - u.uSpeak.value) * Math.min(1, delta * 6);
      u.uPulse.value += (pulse - u.uPulse.value) * Math.min(1, delta * 10);
      u.uBusy.value += (busy - u.uBusy.value) * Math.min(1, delta * 4);
      // The spark: driven by the RISE in her amplitude, then decayed fast so it reads as a flash
      // rather than a glow. Never fires on silence, because hers is zero unless she is speaking.
      const rise = Math.max(0, hers - lastEnergy.current);
      lastEnergy.current = hers;
      u.uFlash.value = Math.max(u.uFlash.value * Math.max(0, 1 - delta * 7), Math.min(1, rise * 6));
      u.uLight.value = frame.light;

      // Integrated, never an absolute angle from elapsed time: multiplying elapsed time by a rate
      // that changes makes the body jump the moment the rate does.
      mesh.current.rotation.y += delta * (settled ? 0.02 : state === "thinking" || state === "working" ? 0.2 : 0.07);
      mesh.current.rotation.x = Math.sin(t * 0.23) * 0.09;
    } catch (error) {
      crashed.current = true;
      console.error("[PaigePresenceScene] the animation loop threw — standing down to the flat presence. Cause:", error);
      onCrash();
    }
  });

  return (
    <group ref={group}>
      <mesh ref={mesh} geometry={geometry} material={material} />
    </group>
  );
}

export default function PaigePresenceScene({ state, reduced, readEnergy = () => SILENT_ENERGY, onCrash = () => {} }: {
  state: PresenceState;
  reduced: boolean;
  readEnergy?: () => AudioEnergy;
  /** Called once if the animation loop throws — a boundary cannot see inside requestAnimationFrame. */
  onCrash?: () => void;
}) {
  return (
    <Canvas
      // PERSPECTIVE, not orthographic. An orthographic orb is a disc with a gradient on it; the
      // perspective divide is a real part of why a sphere reads as a sphere.
      camera={{ position: [0, 0, 4.2], fov: 38 }}
      // Transparent, so the stage's own ground shows through rather than a second black rectangle.
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      dpr={[1, 1.75]}
      // A still frame is not motion: under reduced motion the scene renders once and stops, instead
      // of disappearing.
      frameloop={reduced ? "demand" : "always"}
      style={{ width: "100%", height: "100%" }}
    >
      <Orb state={state} reduced={reduced} readEnergy={readEnergy} onCrash={onCrash} />
    </Canvas>
  );
}
