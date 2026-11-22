export const MEET_PAIGE_INTRO_MS = 4350;
const TAU = 2 * Math.PI;
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;
const smooth = (value: number) => clamp(value) ** 2 * (3 - 2 * clamp(value));
const ease = (value: number) => 1 - (1 - clamp(value)) ** 3;

const colors = [
  "#7fbccc40", "#98aeef7a", "#b6dee2bb", "#d39fea5e", "#ffd099a5", "#fff4dae8",
];
type Dust = Readonly<{ distance: number; angle: number; depth: number; size: number; color: number }>;

function makeField(count: number, clouds: boolean): Dust[] {
  let seed = clouds ? 0x19359eaf : 0x7520182e;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: count }, (_, index) => {
    const distance = clouds ? .095 + random() * .87 : .018 + random() ** 1.015 * 1.01;
    const spray = random() + random() + random() - 1.5;
    const angle = index % 3 * TAU / 3 + distance * 6.45 + spray * (.23 + distance * .48);
    const depth = (random() + random() - 1) * (.175 - distance * .09);
    const level = random();
    const color = clouds ? Math.floor(level * 3)
      : distance < .21 ? 3 + Math.floor(level * 3) : level > .96 ? 5 : Math.floor(level * 4);
    return { distance, angle, depth, color, size: clouds ? .09 + random() * .27 : .48 + random() ** 4 * 1.8 };
  }).sort((first, second) => first.color - second.color);
}

const dust = makeField(5200, false);
const clouds = makeField(164, true);

function makeGlow(document: Document, stops: ReadonlyArray<readonly [number, string]>) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 112;
  const ink = canvas.getContext("2d");
  if (!ink) return null;
  const fill = ink.createRadialGradient(56, 56, 0, 56, 56, 56);
  for (const [at, color] of stops) fill.addColorStop(at, color);
  ink.fillStyle = fill;
  ink.fillRect(0, 0, 112, 112);
  return canvas;
}

function drawOrbits(ink: CanvasRenderingContext2D, x: number, y: number, radius: number,
  turn: number, light: number, foreground: boolean) {
  ink.save();
  ink.translate(x, y);
  const bronze = ink.createLinearGradient(-radius, radius / 2, radius, -radius);
  bronze.addColorStop(0, "#c18f53");
  bronze.addColorStop(.27, "#b5775c55");
  bronze.addColorStop(.47, "#ffe8b6fa");
  bronze.addColorStop(.7, "#e9ae74a9");
  bronze.addColorStop(1, "#a4745444");
  ink.strokeStyle = bronze;
  for (let ring = 0; ring < 7; ring++) {
    const tilt = .4 + ring * .075;
    const yaw = turn * (ring % 2 ? .68 : -.4) + ring * 1.07;
    const orbit = radius * (1.02 + ring * .026);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    ink.globalAlpha = light * (foreground ? .58 : .22) * (ring === 2 || ring === 5 ? 1 : .61);
    ink.lineWidth = ring === 2 ? 1.4 : .72;
    ink.beginPath();
    const start = foreground ? 0 : Math.PI;
    for (let i = 0; i <= 55; i++) {
      const angle = start + i / 55 * Math.PI;
      const a = Math.cos(angle), b = Math.sin(angle);
      const projected = orbit * 3.8 / (3.8 - b * st);
      const px = (a * cy - b * ct * sy) * projected;
      const py = (a * sy + b * ct * cy) * projected;
      if (i === 0) ink.moveTo(px, py); else ink.lineTo(px, py);
    }
    ink.stroke();
  }
  ink.restore();
}

export function createMeetPaigeGalaxy(ink: CanvasRenderingContext2D) {
  const document = ink.canvas.ownerDocument;
  const mist = [
    makeGlow(document, [[0, "#b790ec53"], [.43, "#8062b327"], [1, "#48317c00"]]),
    makeGlow(document, [[0, "#82dddb4e"], [.40, "#477f901c"], [1, "#314b8500"]]),
    makeGlow(document, [[0, "#f5c7a643"], [.34, "#c278ae26"], [1, "#751c4500"]]),
  ];
  const flare = makeGlow(document, [[0, "#fff8ed"], [.10, "#ffe8c9c8"], [.32, "#b482d456"], [1, "#674ba000"]]);
  const corona = makeGlow(document, [[0, "#f6d0a638"], [.47, "#9577be26"], [1, "#674ba000"]]);
  const glow = (image: HTMLCanvasElement | null, x: number, y: number, width: number, height: number) => {
    if (image) ink.drawImage(image, x - width / 2, y - height / 2, width, height);
  };

  return (width: number, height: number, elapsed: number, intro: boolean, reduced: boolean) => {
    ink.clearRect(0, 0, width, height);
    const light = intro ? smooth((elapsed - 2500) / 1360) : 1;
    if (light < .005) return;
    const reveal = intro ? ease((elapsed - 2720) / 1550) : 1;
    const turn = reduced ? .32 : elapsed * .00031 + reveal * 1.04;
    const compact = width < 650;
    const x = width * .5, y = height * (compact ? .36 : .4);
    const radius = Math.min(width * .32, height * .335) * mix(.06, 1, ease(light));
    const tilt = mix(1.02, .47, reveal);
    const outline = -.19;
    const cos = Math.cos(outline), sin = Math.sin(outline);
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const project = (point: Dust) => {
      const across = Math.cos(point.angle + turn) * point.distance;
      const rise = Math.sin(point.angle + turn) * point.distance;
      const up = rise * ct - point.depth * st;
      const projection = radius * 3.8 / (3.8 - rise * st - point.depth * ct);
      return [x + (across * cos - up * sin) * projection, y + (across * sin + up * cos) * projection];
    };

    ink.save();
    ink.globalCompositeOperation = "screen";
    ink.globalAlpha = light * .64;
    glow(corona, x, y, radius * 3.04, radius * 2.69);
    drawOrbits(ink, x, y, radius, turn, light, false);
    ink.globalAlpha = light * .83;
    for (const cloud of clouds) {
      const [px, py] = project(cloud);
      glow(mist[cloud.color], px, py, radius * cloud.size, radius * cloud.size * .87);
    }
    ink.globalAlpha = light;
    let color = -1;
    for (let index = 0; index < dust.length; index += compact ? 2 : 1) {
      const point = dust[index];
      if (color !== point.color) { color = point.color; ink.fillStyle = colors[color]; }
      const [px, py] = project(point);
      const size = point.size * (compact ? .84 : 1);
      ink.fillRect(px, py, size, size);
    }
    ink.globalAlpha = light * .72;
    glow(flare, x, y, radius * .72, radius * .66);
    drawOrbits(ink, x, y, radius, turn, light, true);
    ink.restore();
  };
}
