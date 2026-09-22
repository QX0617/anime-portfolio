/**
 * 天穹层：一个**有光源、有轨道**的星空，而不是一张贴纸墙。
 *
 * 核心约定（勿回退）：
 * - 画面外有一颗「恒星」SUN3。所有天体的明暗、月相、彗尾朝向都由它决定 ——
 *   同一个场景里光从不同方向打，观感就是「拼贴」，这是上一轮「月亮很突兀」的根因。
 * - 月亮不独立横越天空了：它是**绕地球公转**的卫星，走一条闭合椭圆。
 *   上一版用 `travel` 直接算它的角度，结果是一条不像轨道的正弦弧，用户原话
 *   「那个月球轨迹不对」。现在它的近大远小、相位变化都来自轨道本身。
 * - 行星 / 彗星各自沿自己的椭圆轨道运行，轨道画成一圈极淡的环（这就是「轨迹」），
 *   身后拖一道按速度算长度的尾迹。
 * - 天体仍然从属于星野：亮度与尺寸压在「一眼看上去先是星海、再看才认出天体」的量级。
 *   极光带与线框几何体已停用（用户原话「像多边体」）。
 */
import { CLOUD_FRAG, CLOUD_VERT } from "./three-shaders";

type ThreeNS = typeof import("three");

const DOME_Z = 60;
const FOV = 58;
const WHEEL_SPIN = 0.00012; // 每世界单位 travel 对应的轮转弧度
const IDLE_SPIN = 0.0016; // 不滚动时的自转（rad/s）
/** 画面外那颗恒星的方向（单位向量，从右下方照过来） */
const SUN3 = (() => {
  const v = { x: 0.62, y: -0.55, z: 0.56 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();
/** 把恒星当成一个足够远的点光源，彗尾朝向才会有细微变化 */
const SUN_PT_DIST = 6.0;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NOISE_GLSL = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

/** 卫星 / 行星 / 彗星共用的一条尾迹：1 = 头（亮且宽），0 = 尾（窄而淡） */
const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float along = vUv.x;
  float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float taper = pow(across, 1.35) * (0.30 + 0.70 * along);
  float fade = pow(along, 1.7);
  float head = exp(-pow((along - 0.965) / 0.07, 2.0));
  float a = (taper * fade * 0.75 + head * 0.55) * uOpacity;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), head * 0.5), clamp(a, 0.0, 1.0));
}`;

/** 月亮：真实相位由 uSunZ（光照方向朝不朝镜头）给出，边缘羽化，暗面掺天空色 */
const MOON_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec2 uSun;
uniform float uSunZ;
uniform vec3 uSky;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float disc = 1.0 - smoothstep(0.86, 1.0, r);
  float scatter = exp(-pow(max(0.0, r - 0.88) / 0.36, 2.0)) * 0.12;
  float rr = min(r, 0.999);
  float z = sqrt(1.0 - rr * rr);
  vec3 n = normalize(vec3(p.x, p.y, z));
  float lam = dot(n, normalize(vec3(uSun, uSunZ)));
  float lit = smoothstep(-0.12, 0.16, lam);
  float maria = smoothstep(0.44, 0.66, noise(n.xy * 1.7 + 3.1));
  float grain = noise(n.xy * 5.2) * 0.5 + noise(n.xy * 13.0) * 0.5;
  vec3 surf = mix(vec3(0.88, 0.85, 0.8), vec3(0.58, 0.58, 0.64), maria * 0.6);
  surf *= 0.86 + 0.18 * grain;
  vec3 col = mix(surf, uSky, (1.0 - lit) * 0.6);
  float limb = pow(z, 0.42);
  float earthshine = 0.07 * (1.0 - lit);
  float a = clamp((lit + earthshine) * disc * 0.95 + scatter, 0.0, 1.0);
  gl_FragColor = vec4(col * (0.76 + 0.24 * lit) * limb, a * uOpacity);
}`;

/** 地球：海洋 + 大陆 + 移动的云带 + 背光面的城市灯火 + 青蓝大气边 */
const EARTH_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec2 uSun;
uniform float uTime;
uniform vec3 uSky;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float disc = 1.0 - smoothstep(0.9, 1.0, r);
  float rr = min(r, 0.999);
  float z = sqrt(1.0 - rr * rr);
  vec3 n = normalize(vec3(p.x, p.y, z));
  float lit = smoothstep(-0.28, 0.34, dot(n, normalize(vec3(uSun, 0.42))));
  float land = smoothstep(0.5, 0.62, noise(n.xy * 2.1 + 5.3) * 0.62 + noise(n.yz * 4.4) * 0.38);
  float ice = smoothstep(0.74, 0.93, abs(n.z));
  vec3 surf = mix(vec3(0.09, 0.28, 0.5), vec3(0.26, 0.43, 0.27), land);
  surf = mix(surf, vec3(0.92, 0.95, 0.98), ice * 0.85);
  float cloud = smoothstep(0.54, 0.76, noise(n.xy * 3.4 + vec2(uTime * 0.006, 4.0)));
  surf = mix(surf, vec3(0.95), cloud * 0.55);
  float night = 1.0 - lit;
  vec3 city = vec3(1.0, 0.8, 0.45) * land * night * (0.3 + 0.7 * noise(n.xy * 9.0));
  vec3 col = surf * (0.06 + 0.94 * lit) + city + uSky * night * 0.12;
  // 晨昏线一道暖边：日出感来自这里，不是来自整体提亮
  float terminator = exp(-pow((lit - 0.42) / 0.16, 2.0));
  col += vec3(1.0, 0.55, 0.28) * terminator * 0.16;
  float rim = pow(smoothstep(0.52, 1.0, r), 2.2) * (0.22 + 0.78 * lit);
  col += vec3(0.32, 0.58, 1.0) * rim * 0.85;
  float a = clamp(disc + rim * 0.55, 0.0, 1.0) * uOpacity;
  gl_FragColor = vec4(col, a);
}`;

/** 星云光团 / 柔光核 */
const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPow;
varying vec2 vUv;
void main() {
  float r = length((vUv - 0.5) * 2.0);
  gl_FragColor = vec4(uColor, pow(max(0.0, 1.0 - r), uPow) * uOpacity);
}`;

const DOT_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float r = length((vUv - 0.5) * 2.0);
  if (r > 1.0) discard;
  float core = 1.0 - smoothstep(0.05, 0.42, r);
  float halo = pow(1.0 - r, 3.0) * 0.4;
  gl_FragColor = vec4(1.0, 0.99, 0.96, clamp(core + halo, 0.0, 1.0) * uOpacity);
}`;

/** 旋涡星系：对数螺线臂 + 亮核 + 尘埃颗粒，侧视压扁 */
const GALAXY_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
uniform float uTwist;
uniform float uArms;
uniform vec3 uCore;
uniform vec3 uArm;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x);
  float spiral = ang + log(max(r, 0.03)) * uTwist + uTime * 0.05;
  float arms = pow(0.5 + 0.5 * cos(spiral * uArms), 3.0);
  float disk = exp(-r * 2.1);
  float core = exp(-pow(r * 3.6, 2.0));
  float dust = 0.7 + 0.3 * sin(r * 42.0 - uTime * 0.2);
  float edge = smoothstep(1.0, 0.5, r);
  vec3 col = mix(uArm, uCore, core);
  float a = (core + arms * disk * 0.62 * dust) * edge * uOpacity;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

/** 带环行星：球体明暗 + 条纹云带 + 压扁的环（含环缝），光照方向由外部统一给 */
const PLANET_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
uniform vec2 uSun;
uniform float uSunZ;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float ry = length(vec2(p.x, p.y * 3.1));
  float ring = smoothstep(1.18, 1.24, ry) * (1.0 - smoothstep(1.78, 1.86, ry));
  ring *= 0.55 + 0.45 * step(0.42, fract(ry * 7.4));
  float r = length(p);
  float disc = 1.0 - smoothstep(0.96, 1.0, r);
  float rr = min(r, 0.999);
  float z = sqrt(max(0.0, 1.0 - rr * rr));
  vec3 n = normalize(vec3(p.x, p.y, z));
  float lit = smoothstep(-0.3, 0.55, dot(n, normalize(vec3(uSun, uSunZ))));
  float bands = 0.82 + 0.18 * sin(p.y * 16.0 + 0.6);
  vec3 col = uColor * bands;
  float a = (disc * (0.18 + 0.82 * lit) + ring * 0.5) * uOpacity;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

/** 一条椭圆轨道（viewH 为单位），tilt 让它不必都横平竖直 */
interface Orbit {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  tilt: number;
  /** 角速度 rad/s */
  w: number;
  ph: number;
}

function orbitAt(o: Orbit, t: number) {
  const a = o.ph + o.w * t;
  const x = Math.cos(a) * o.rx;
  const y = Math.sin(a) * o.ry;
  const c = Math.cos(o.tilt);
  const s = Math.sin(o.tilt);
  return { x: o.cx + x * c - y * s, y: o.cy + x * s + y * c, a };
}

type Trail = { mesh: InstanceType<ThreeNS["Mesh"]>; m: InstanceType<ThreeNS["ShaderMaterial"]> };

export interface SkyDome {
  group: InstanceType<ThreeNS["Group"]>;
  update: (
    step: number,
    elapsed: number,
    aspect: number,
    pointerX: number,
    pointerY: number,
    travel: number
  ) => void;
  dispose: () => void;
}

export function createSkyDome(
  THREE: ThreeNS,
  opts: { isMobile: boolean; reduceMotion: boolean; px: number }
): SkyDome {
  const group = new THREE.Group();
  const wheel = new THREE.Group(); // 深远天体：整片缓慢轮转
  const sky = new THREE.Group(); // 有各自轨道的天体：不参与轮转
  const horizon = new THREE.Group(); // 低云与卫星
  group.add(wheel, sky, horizon);
  group.position.z = -DOME_Z;

  const trash: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T): T => (trash.push(x), x);
  const quad = keep(new THREE.PlaneGeometry(1, 1));
  const viewH = 2 * DOME_Z * Math.tan((FOV * Math.PI) / 360);

  const mat = (
    fragmentShader: string,
    uniforms: Record<string, { value: unknown }>,
    additive = true,
    vertexShader = QUAD_VERT
  ) =>
    keep(
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
    );

  /** 轨道环：极淡的一圈线，让「轨迹」看得见 */
  const makeRing = (o: Orbit, opacity: number) => {
    const segs = 96;
    const pts: number[] = [];
    for (let i = 0; i < segs; i++) {
      const p = orbitAt({ ...o, cx: 0, cy: 0 }, (i / segs) * ((Math.PI * 2) / o.w));
      pts.push(p.x * viewH, p.y * viewH, 0);
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const lineMat = keep(
      new THREE.LineBasicMaterial({ color: 0xbcd0ff, transparent: true, opacity, depthWrite: false })
    );
    const loop = new THREE.LineLoop(geo, lineMat);
    loop.position.set(o.cx * viewH, o.cy * viewH, 0);
    sky.add(loop);
    return loop;
  };

  /** 尾迹：贴在身上的加色光带，长度按速度给 */
  const makeTrail = (parent: InstanceType<ThreeNS["Group"]>, color: number, opacity: number) => {
    const m = mat(TRAIL_FRAG, {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    });
    const mesh = new THREE.Mesh(quad, m);
    mesh.visible = false;
    parent.add(mesh);
    return { mesh, m };
  };

  /** 天体在画面里的位置 → 该处「朝镜头」方向与光源夹角 → 相位 */
  const phase = (px: number, py: number) => {
    const vx = -px, vy = -py, vz = DOME_Z;
    const vl = Math.hypot(vx, vy, vz) || 1;
    const k = (SUN3.x * vx + SUN3.y * vy + SUN3.z * vz) / vl; // +1 = 满相
    // 光照方向去掉朝镜头的分量 → 留在画面里的那截，就是明暗界线的指向
    let lx = SUN3.x - vx / vl * k;
    let ly = SUN3.y - vy / vl * k;
    const ll = Math.hypot(lx, ly) || 1;
    lx /= ll;
    ly /= ll;
    return { k, lx, ly };
  };

  // ── 地球：月亮的母星，本身也是场景里第二强的锚点
  const EARTH: Orbit = { cx: -0.33, cy: -0.06, rx: 0, ry: 0, tilt: 0, w: 0, ph: 0 };
  const earthMat = mat(
    EARTH_FRAG,
    {
      uOpacity: { value: 0.9 },
      uSun: { value: new THREE.Vector2(SUN3.x, SUN3.y) },
      uTime: { value: 0 },
      uSky: { value: new THREE.Color(0x1a2150) },
    },
    false
  );
  const earth = new THREE.Mesh(quad, earthMat);
  const earthR = 0.062;
  earth.scale.setScalar(viewH * earthR * 2);
  earth.position.set(EARTH.cx * viewH, EARTH.cy * viewH, 0);
  sky.add(earth);

  const atmoMat = mat(GLOW_FRAG, {
    uOpacity: { value: 0.2 },
    uPow: { value: 3.4 },
    uColor: { value: new THREE.Color(0x6fa8ff) },
  });
  const atmo = new THREE.Mesh(quad, atmoMat);
  atmo.scale.setScalar(viewH * earthR * 3.1);
  atmo.position.copy(earth.position);
  sky.add(atmo);

  // ── 月亮：绕地球的一条闭合椭圆（近大远小 + 真实相位）
  const MOON: Orbit = { cx: EARTH.cx, cy: EARTH.cy, rx: 0.2, ry: 0.128, tilt: -0.5, w: 0.05, ph: 1.9 };
  makeRing(MOON, 0.075);
  const moonMat = mat(
    MOON_FRAG,
    {
      uOpacity: { value: 0.9 },
      uSun: { value: new THREE.Vector2(-0.42, 0.3) },
      uSunZ: { value: 0.6 },
      uSky: { value: new THREE.Color(0x242a63) },
    },
    false
  );
  const moon = new THREE.Mesh(quad, moonMat);
  sky.add(moon);
  const haloMat = mat(GLOW_FRAG, {
    uOpacity: { value: 0.13 },
    uPow: { value: 2.9 },
    uColor: { value: new THREE.Color(0xdbe0ff) },
  });
  const halo = new THREE.Mesh(quad, haloMat);
  sky.add(halo);

  // ── 三条行星轨道，各自带环状轨迹与尾迹
  interface Body {
    mesh: InstanceType<ThreeNS["Mesh"]>;
    m: InstanceType<ThreeNS["ShaderMaterial"]>;
    orbit: Orbit;
    trail: Trail | null;
    r: number;
    prev: { x: number; y: number };
    trailGain: number;
  }
  const bodies: Body[] = [];

  const addPlanet = (orbit: Orbit, radius: number, color: number, opacity: number, trailGain: number) => {
    makeRing(orbit, 0.055);
    const m = mat(PLANET_FRAG, {
      uOpacity: { value: opacity },
      uColor: { value: new THREE.Color(color) },
      uSun: { value: new THREE.Vector2(SUN3.x, SUN3.y) },
      uSunZ: { value: 0.55 },
    });
    const mesh = new THREE.Mesh(quad, m);
    mesh.scale.setScalar(viewH * radius * 2);
    sky.add(mesh);
    bodies.push({
      mesh,
      m,
      orbit,
      trail: trailGain > 0 ? makeTrail(sky, color, 0.3) : null,
      r: radius,
      prev: { x: 0, y: 0 },
      trailGain,
    });
  };

  addPlanet({ cx: 0.31, cy: 0.27, rx: 0.27, ry: 0.105, tilt: 0.36, w: -0.031, ph: 0.4 }, 0.03, 0xf0d8b0, 0.82, 1);
  // 轨道整体收在 ±0.36 viewH 内：天穹组本身往下挪了 0.14，压到边缘会被切掉
  addPlanet({ cx: -0.04, cy: -0.2, rx: 0.35, ry: 0.09, tilt: -0.22, w: 0.046, ph: 2.4 }, 0.016, 0x9fd0ff, 0.85, 1.4);
  addPlanet({ cx: 0.13, cy: 0.34, rx: 0.16, ry: 0.155, tilt: 1.15, w: 0.017, ph: 4.1 }, 0.022, 0xffd0a0, 0.7, 0.8);

  // ── 彗星：一条很扁的椭圆，尾巴永远背向那颗隐形太阳，近日点附近变长
  const COMET: Orbit = { cx: 0.02, cy: 0.04, rx: 0.46, ry: 0.17, tilt: 0.72, w: 0.026, ph: 3.4 };
  makeRing(COMET, 0.05);
  const cometHeadMat = mat(GLOW_FRAG, {
    uOpacity: { value: 0.5 },
    uPow: { value: 2.2 },
    uColor: { value: new THREE.Color(0xd8f0ff) },
  });
  const cometHead = new THREE.Mesh(quad, cometHeadMat);
  cometHead.scale.setScalar(viewH * 0.05);
  sky.add(cometHead);
  const cometNuc = new THREE.Mesh(quad, mat(DOT_FRAG, { uOpacity: { value: 0.9 } }));
  cometNuc.scale.setScalar(viewH * 0.008);
  sky.add(cometNuc);
  const cometTail = makeTrail(sky, 0xbfe6ff, 0.42);
  const sunPt = { x: SUN3.x * SUN_PT_DIST * viewH, y: SUN3.y * SUN_PT_DIST * viewH };

  // ── 深远天体：星系 / 星团，跟着 wheel 缓慢轮转
  const galaxies = [0, 1].map((i) => {
    const m = mat(GALAXY_FRAG, {
      uOpacity: { value: i === 0 ? 0.5 : 0.34 },
      uTime: { value: i * 30 },
      uTwist: { value: i === 0 ? 3.1 : 2.4 },
      uArms: { value: i === 0 ? 2 : 3 },
      uCore: { value: new THREE.Color(i === 0 ? 0xfff2d8 : 0xe8f0ff) },
      uArm: { value: new THREE.Color(i === 0 ? 0x9fb6ff : 0xd8a8ff) },
    });
    const mesh = new THREE.Mesh(quad, m);
    const s = viewH * (i === 0 ? 0.085 : 0.06);
    mesh.scale.set(s, s * (i === 0 ? 0.42 : 0.62), 1);
    mesh.rotation.z = i === 0 ? 0.5 : -0.9;
    mesh.position.set(viewH * (i === 0 ? -0.34 : 0.12), viewH * (i === 0 ? 0.1 : -0.16), -2 - i * 3);
    wheel.add(mesh);
    return { mesh, m };
  });

  // 星团：一小撮紧挨着的蓝白星 + 背后一层淡淡蓝雾（昴星团的反射星云观感）
  const clusterN = 16;
  const cpos = new Float32Array(clusterN * 3);
  const csize = new Float32Array(clusterN);
  for (let i = 0; i < clusterN; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 1.8) * viewH * 0.035;
    cpos[i * 3] = Math.cos(a) * r;
    cpos[i * 3 + 1] = Math.sin(a) * r * 0.7;
    cpos[i * 3 + 2] = 0;
    csize[i] = 2.2 + Math.random() * 3.6;
  }
  const clusterGeo = keep(new THREE.BufferGeometry());
  clusterGeo.setAttribute("position", new THREE.Float32BufferAttribute(cpos, 3));
  clusterGeo.setAttribute("aSize", new THREE.Float32BufferAttribute(csize, 1));
  const POINT_VERT = /* glsl */ `
attribute float aSize;
uniform float uPx;
void main() {
  gl_PointSize = aSize * uPx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
  const POINT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  float r = length((gl_PointCoord - 0.5) * 2.0);
  if (r > 1.0) discard;
  gl_FragColor = vec4(uColor, pow(1.0 - r, 2.4) * uOpacity);
}`;
  const clusterMat = keep(
    new THREE.ShaderMaterial({
      uniforms: { uPx: { value: opts.px }, uColor: { value: new THREE.Color(0xdce8ff) }, uOpacity: { value: 0.85 } },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  const cluster = new THREE.Points(clusterGeo, clusterMat);
  cluster.position.set(viewH * 0.42, viewH * 0.02, -4);
  wheel.add(cluster);

  const clusterHaze = new THREE.Mesh(
    quad,
    mat(GLOW_FRAG, {
      uOpacity: { value: 0.16 },
      uPow: { value: 2.2 },
      uColor: { value: new THREE.Color(0x9fc0ff) },
    })
  );
  clusterHaze.scale.setScalar(viewH * 0.13);
  clusterHaze.position.copy(cluster.position);
  wheel.add(clusterHaze);

  // ── 卫星 / 飞船：缓慢直线横穿，身后一道拖迹
  const sats = Array.from({ length: opts.isMobile ? 1 : 2 }, (_, i) => {
    const m = mat(DOT_FRAG, { uOpacity: { value: 0 } });
    const mesh = new THREE.Mesh(quad, m);
    mesh.scale.setScalar(viewH * 0.007);
    horizon.add(mesh);
    const trail = makeTrail(horizon, 0xdfe8ff, 0);
    return {
      mesh,
      m,
      trail,
      t: i * 0.37,
      speed: 0.021 + i * 0.008,
      y: 0.2 + i * 0.3,
      phase: i * 2.1,
      prev: { x: 0, y: 0 },
    };
  });

  // ── 低空云带：贴住地平线天光，给天空一个「地面」
  const clouds = Array.from({ length: 2 }, (_, i) => {
    // 必须配 CLOUD_VERT（CLOUD_FRAG 要用它的 vDepthFade），且 uSpeed 固定为 0 时
    // uPhase 要正好落在 uRange/2 —— 否则那个 mod 会把云面推到淡出区间之外，整层直接不见
    const m = mat(
      CLOUD_FRAG,
      {
        uTravel: { value: 0 },
        uSpeed: { value: 0 },
        uPhase: { value: 100 },
        uRange: { value: 200 },
        uTime: { value: 0 },
        uSeed: { value: i * 3.7 },
        uSoft: { value: 1.5 },
        uOpacity: { value: i === 0 ? 0.13 : 0.09 },
        uColorA: { value: new THREE.Color(i === 0 ? 0xf6d9ea : 0xdfe4ff) },
        uColorB: { value: new THREE.Color(i === 0 ? 0xd9e6ff : 0xf3e2ff) },
      },
      true,
      CLOUD_VERT
    );
    const mesh = new THREE.Mesh(quad, m);
    mesh.scale.set(viewH * (1.5 + i * 0.5), viewH * (0.16 + i * 0.05), 1);
    // CLOUD_VERT 按 -mv.z 做纵深淡出，z 只能给小的正偏移，否则整层会被淡没
    mesh.position.set(0, -viewH * (0.3 - i * 0.07), 2 + i * 4);    horizon.add(mesh);
    return { mesh, m, drift: (i === 0 ? 1 : -0.7) * 0.5 };
  });

  let spin = 0;

  /** 把一条尾迹摆成「从头指向运动反方向」，长度按速度 */
  function placeTrail(
    trail: Trail,
    x: number,
    y: number,
    vx: number,
    vy: number,
    width: number,
    gain: number,
    opacity: number
  ) {
    const sp = Math.hypot(vx, vy);
    if (sp < 1e-4) {
      trail.mesh.visible = false;
      return;
    }
    const len = width * (2 + 6 * Math.min(1, sp * gain * 0.35));
    trail.mesh.visible = true;
    // 网格 vUv.x = 1 是头：把 mesh 沿 x 正向摆成运动的反方向
    trail.mesh.rotation.z = Math.atan2(-vy, -vx);
    trail.mesh.position.set(x - Math.cos(trail.mesh.rotation.z) * len * 0.5, y - Math.sin(trail.mesh.rotation.z) * len * 0.5, 0);
    trail.mesh.scale.set(len, width, 1);
    trail.m.uniforms.uOpacity.value = opacity;
  }

  return {
    group,
    update(step, elapsed, aspect, pointerX, pointerY, travel) {
      const w = viewH * aspect;
      // 竖屏的可见半宽只有 0.23 viewH：整套轨道系统按屏宽一起缩，
      // 否则手机上「带环行星」一辈子有六成时间在画面外。
      sky.scale.setScalar(Math.min(1, aspect * 0.86));
      if (!opts.reduceMotion) spin += step * IDLE_SPIN;
      wheel.rotation.z = -(spin + travel * WHEEL_SPIN);

      group.position.x = -pointerX * viewH * 0.012;
      group.position.y = pointerY * viewH * 0.012 - viewH * 0.14;

      earthMat.uniforms.uTime.value = elapsed;
      for (const g of galaxies) g.m.uniforms.uTime.value = elapsed;
      clusterMat.uniforms.uPx.value = opts.px;

      // 月亮：沿绕地的椭圆走一步，近大远小 + 相位由隐形太阳决定
      const t = elapsed;
      const mp = orbitAt(MOON, t);
      const mx = mp.x * viewH;
      const my = mp.y * viewH;
      // 轨道画在画面上的约定：椭圆的下缘 = 离我们近，上缘 = 远
      const depth = Math.max(-1, Math.min(1, (mp.y - MOON.cy) / MOON.ry));
      const near = (1 - depth) * 0.5;
      moon.position.set(mx, my, 0);
      const moonScale = viewH * 0.034 * (0.8 + 0.4 * near);
      moon.scale.setScalar(moonScale);
      halo.scale.setScalar(moonScale * 4.4);
      halo.position.copy(moon.position);
      // 相位取「轨道前后」这层几何：椭圆下缘 = 走到地球与太阳之间 = 新月，
      // 上缘 = 地球背后 = 满月。亮边永远朝那颗隐形太阳，所以月相与光向自洽。
      moonMat.uniforms.uSun.value.set(SUN3.x, SUN3.y);
      moonMat.uniforms.uSunZ.value = -depth * 0.95;
      haloMat.uniforms.uOpacity.value = 0.05 + 0.12 * Math.max(0, -depth);

      // 行星与彗星
      for (const b of bodies) {
        const p = orbitAt(b.orbit, t);
        const x = p.x * viewH;
        const y = p.y * viewH;
        const vx = (x - b.prev.x) / Math.max(step, 1e-4);
        const vy = (y - b.prev.y) / Math.max(step, 1e-4);
        b.mesh.position.set(x, y, 0);
        const bp = phase(x, y);
        b.m.uniforms.uSun.value.set(bp.lx, bp.ly);
        b.m.uniforms.uSunZ.value = bp.k * 1.1;
        if (b.trail) {
          placeTrail(b.trail, x, y, vx, vy, b.r * viewH * 0.9, b.trailGain, 0.22);
        }
        b.prev.x = x;
        b.prev.y = y;
      }

      const cp = orbitAt(COMET, t);
      const cx = cp.x * viewH;
      const cy = cp.y * viewH;
      // 尾巴背向光源：这是彗星唯一的「身份特征」，画成沿轨迹就变成流星了
      const awayX = cx - sunPt.x;
      const awayY = cy - sunPt.y;
      // 离那颗隐形太阳越近 → 越活跃（彗发更大、尾巴更长更亮）
      const dn = Math.hypot(awayX, awayY) / viewH;
      const act = Math.max(0.2, Math.min(1, 1.62 - dn * 0.16));
      cometHead.position.set(cx, cy, 0);
      cometNuc.position.set(cx, cy, 0);
      cometHead.scale.setScalar(viewH * (0.03 + 0.035 * act));
      cometHeadMat.uniforms.uOpacity.value = 0.28 + 0.3 * act;
      cometTail.mesh.rotation.z = Math.atan2(awayY, awayX);
      const tlen = viewH * (0.1 + 0.26 * act);
      cometTail.mesh.position.set(
        cx - Math.cos(cometTail.mesh.rotation.z) * tlen * 0.5,
        cy - Math.sin(cometTail.mesh.rotation.z) * tlen * 0.5,
        0
      );
      cometTail.mesh.scale.set(tlen, viewH * 0.035 * (0.6 + act), 1);
      cometTail.mesh.visible = true;
      cometTail.m.uniforms.uOpacity.value = 0.18 + 0.24 * act;

      for (const s of sats) {
        if (!opts.reduceMotion) s.t += step * s.speed;
        const tt = s.t % 1.35;
        if (tt > 1.1) {
          s.m.uniforms.uOpacity.value = 0;
          s.mesh.visible = false;
          s.trail.mesh.visible = false;
          continue;
        }
        s.mesh.visible = true;
        const fade = Math.min(1, Math.min(tt, 1.1 - tt) / 0.12);
        const x = -w * 0.62 + tt * w * 1.24;
        const y = viewH * s.y;
        s.mesh.position.set(x, y, 0.1);
        const op = 0.7 * fade * (0.72 + 0.28 * Math.sin(elapsed * 1.9 + s.phase));
        s.m.uniforms.uOpacity.value = op;
        const vx = (x - s.prev.x) / Math.max(step, 1e-4);
        const vy = (y - s.prev.y) / Math.max(step, 1e-4);
        placeTrail(s.trail, x, y, vx, vy, viewH * 0.006, 0.5, op * 0.5);
        s.prev.x = x;
        s.prev.y = y;
      }

      for (const c of clouds) {
        c.m.uniforms.uTime.value = elapsed;
        c.mesh.position.x += step * c.drift;
        if (Math.abs(c.mesh.position.x) > w * 0.9) c.mesh.position.x = -Math.sign(c.mesh.position.x) * w * 0.9;
      }
    },
    dispose() {
      for (const item of trash) {
        try {
          item.dispose();
        } catch {
          // 卸载期释放失败不影响页面
        }
      }
      group.clear();
    },
  };
}
