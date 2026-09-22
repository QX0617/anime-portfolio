// ── 世界空间天体场
//
// 与旧版「天穹层」的根本区别：天体不再挂在相机上装作无限远。
// 它们和星屑在同一个 `world` 分组里、共用同一条 `travel`、同一套透视，
// 于是必然：近大远小、按 1/d 与星星同速后掠、拖出同一条式子算出来的尾迹、
// 并且从画面边上**真正穿过去**。上一版被否掉就是因为挂在无限远 ——
// 那里不管把动画调多快，相对星屑都是静止的。
//
// 契约（勿回退）：
// 1) 尾迹长度 = 屏幕速度 × `shutter`，`shutter` 由 three-scene 传进来，与 STAR_VERT
//    用的是同一个常数。两边不一致就会出现「星星拖影、行星不拖」的两套速度感。
// 2) 每个天体每帧只做变换与 uniform 更新，绝不重建几何体。
// 3) 近到糊屏 / 远到看不见 / 屏外 → 立刻 visible=false，别让片元着色器白跑。
// 4) 全场只有一个世界空间点光源，球体的明暗界线由「该点 − 天体位置」算 ——
//    各天体各打各的光就是拼贴感的来源。
import type * as ThreeNS from "three";

type ThreeModule = typeof import("three");
type Mesh = InstanceType<ThreeModule["Mesh"]>;
type Group = InstanceType<ThreeModule["Group"]>;
type Camera = InstanceType<ThreeModule["PerspectiveCamera"]>;

const RANGE = 560;
const CAMERA_Z = 18;
/** 世界空间点光源：在场深处偏上，天体飞过它时明暗界线会自己转起来 */
const LIGHT = { x: -150, y: 104, z: 250 };
/** 单位 quad 里球面只占 r ≤ 0.9，外面一圈留给大气边与抗锯齿 */
const PAD = 0.9;

const NOISE = /* glsl */ `
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
/** 3 阶足够：这些球在屏上只有几十到几百 px，更多阶是白烧填充率 */
float fbm3(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.3) * 0.3 + vnoise(p * 4.7) * 0.15; }
`;

/** 圆盘 → 球：法线 sqrt(1-r²)；「像球不像贴纸」全靠边缘变暗 + 朝光侧的大气 rim */
const SPHERE = /* glsl */ `
struct Sphere { vec3 n; float edge; float limb; float rim; };
Sphere makeSphere(vec2 p, vec3 L) {
  Sphere s;
  float r = length(p);
  s.edge = 1.0 - smoothstep(${(PAD * 0.95).toFixed(3)}, ${PAD.toFixed(3)}, r);
  float q = min(r, ${PAD.toFixed(3)});
  float zz = sqrt(max(0.0, 1.0 - (q * q) / ${(PAD * PAD).toFixed(4)}));
  s.n = normalize(vec3(p.x, p.y, zz));
  float facing = max(0.0, s.n.z);
  s.limb = pow(facing, 0.42);
  s.rim = pow(1.0 - facing, 2.6) * clamp(dot(s.n, L) + 0.35, 0.0, 1.0);
  return s;
}`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const EARTH_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uSky;
varying vec2 vUv;
${NOISE}
${SPHERE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  Sphere s = makeSphere(p, uSun);
  float lit = smoothstep(-0.22, 0.42, dot(s.n, uSun));
  // 在球面坐标上采样并让它随时间转：不转的贴图就是一张贴纸
  vec2 sph = vec2(atan(s.n.x, s.n.y) * 1.5 + uTime * 0.05, s.n.z * 2.2);
  float land = smoothstep(0.46, 0.58, fbm3(sph * 1.7 + 3.1));
  float ice = smoothstep(0.74, 0.96, abs(sph.y * 0.66));
  vec3 surf = mix(vec3(0.06, 0.22, 0.44), vec3(0.27, 0.44, 0.25), land);
  surf = mix(surf, vec3(0.93, 0.96, 0.99), clamp(ice, 0.0, 1.0) * 0.8);
  float cloud = smoothstep(0.5, 0.72, fbm3(sph * 2.6 + vec2(uTime * 0.07, 1.7)));
  surf = mix(surf, vec3(0.96), cloud * 0.5);
  // 海面高光只在「不是陆地也不是云」的地方出现 —— 这是认得出它是水行星的关键一笔
  vec3 h = normalize(uSun + vec3(0.0, 0.0, 1.0));
  float glint = pow(max(0.0, dot(s.n, h)), 46.0) * (1.0 - land) * (1.0 - cloud);
  vec3 city = vec3(1.0, 0.76, 0.4) * land * (1.0 - lit) * smoothstep(0.55, 0.9, vnoise(sph * 8.0));
  vec3 col = surf * (0.05 + 0.95 * lit) + city + uSky * (1.0 - lit) * 0.1;
  col += vec3(0.9, 0.96, 1.0) * glint * 0.7;
  col += vec3(0.34, 0.6, 1.0) * s.rim * 0.95;
  col += vec3(1.0, 0.5, 0.26) * exp(-pow((lit - 0.4) / 0.15, 2.0)) * 0.18;
  gl_FragColor = vec4(col * s.limb, clamp(s.edge, 0.0, 1.0) * uOpacity);
}`;

const MOON_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uOpacity;
uniform vec3 uSky;
varying vec2 vUv;
${NOISE}
${SPHERE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  Sphere s = makeSphere(p, uSun);
  float lit = smoothstep(-0.12, 0.2, dot(s.n, uSun));
  float maria = smoothstep(0.44, 0.66, fbm3(s.n.xz * 2.4 + 3.1));
  float craters = smoothstep(0.6, 0.9, vnoise(s.n.xz * 9.0)) * 0.3;
  vec3 surf = mix(vec3(0.84, 0.82, 0.79), vec3(0.54, 0.55, 0.6), maria) * (0.92 - craters);
  vec3 col = mix(surf, uSky, (1.0 - lit) * 0.62);
  float a = (lit + 0.06 * (1.0 - lit)) * s.limb;
  gl_FragColor = vec4(col * (0.78 + 0.22 * lit), clamp(a, 0.0, 1.0) * s.edge * uOpacity);
}`;

const GAS_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uA;
uniform vec3 uB;
varying vec2 vUv;
${NOISE}
${SPHERE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  Sphere s = makeSphere(p, uSun);
  float lat = s.n.y;
  // 带不是整体刚转：不同纬度漂移速度不同（木星的纬向流），才有「大气在动」的感觉
  float lon = atan(s.n.x, s.n.z) + uTime * (0.05 + 0.14 * sin(lat * 5.4));
  // 先做域扭曲再造带，带才会「拧」起来；直接 sin(lat) 只是平线条纹
  float warp = fbm3(vec2(lon * 1.8, lat * 3.4));
  float bands = pow(0.5 + 0.5 * sin(lat * 15.0 + warp * 3.6), 1.4);
  vec3 col = mix(uA, uB, bands);
  float spot = 1.0 - smoothstep(0.0, 0.22, length(vec2((lon - uTime * 0.06 - 0.9) * 1.4, (lat + 0.22) * 4.0)));
  col = mix(col, vec3(0.84, 0.4, 0.28), spot * 0.7);
  col *= 0.9 + 0.1 * fbm3(vec2(lon * 6.0, lat * 12.0));
  float lit = smoothstep(-0.3, 0.6, dot(s.n, uSun));
  col += vec3(0.6, 0.66, 0.8) * s.rim * 0.35;
  gl_FragColor = vec4(col * (0.14 + 0.86 * lit) * s.limb, s.edge * uOpacity);
}`;

/** 行星环画两遍：整圈在下、只留「球前面」那半在上，才有正确的穿插关系 */
const RING_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uFront;
uniform float uTilt;
uniform vec3 uColor;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float ry = length(vec2(p.x, p.y * 3.4));
  float ring = smoothstep(1.14, 1.2, ry) * (1.0 - smoothstep(1.84, 1.92, ry));
  ring *= 0.55 + 0.45 * step(0.42, fract(ry * 6.4));
  ring *= 1.0 - 0.6 * step(0.86, fract(ry * 3.1));
  float dust = 0.72 + 0.28 * vnoise(vec2(ry * 20.0, 1.7));
  // 环面与视面的交线在屏幕上是一条倾斜直线 —— 前后两半就按它切
  float line = p.y * cos(uTilt) - p.x * sin(uTilt);
  float keep = mix(step(0.0, line), step(line, 0.0), uFront);
  gl_FragColor = vec4(uColor, clamp(ring * dust * keep * uOpacity, 0.0, 1.0));
}`;

const LAVA_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
${NOISE}
${SPHERE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  Sphere s = makeSphere(p, uSun);
  vec2 sph = vec2(atan(s.n.x, s.n.y) * 1.6, s.n.z * 2.4);
  float cracks = 1.0 - smoothstep(0.0, 0.15, abs(fbm3(sph * 2.6 + uTime * 0.01) - 0.5));
  float rock = smoothstep(0.4, 0.62, fbm3(sph * 3.6));
  vec3 col = mix(vec3(0.06, 0.05, 0.06), vec3(0.19, 0.15, 0.14), rock);
  col += mix(vec3(1.0, 0.34, 0.05), vec3(1.0, 0.82, 0.32), cracks * 0.5) * cracks * 1.6;
  float lit = smoothstep(-0.3, 0.5, dot(s.n, uSun));
  col *= 0.28 + 0.72 * lit;
  col += vec3(1.0, 0.45, 0.15) * s.rim * 0.55;
  gl_FragColor = vec4(col * s.limb, s.edge * uOpacity);
}`;

const ICE_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
${NOISE}
${SPHERE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  Sphere s = makeSphere(p, uSun);
  vec2 sph = vec2(atan(s.n.x, s.n.y) * 1.6 + uTime * 0.04, s.n.z * 2.2);
  vec3 col = mix(vec3(0.6, 0.75, 0.86), vec3(0.92, 0.96, 1.0), fbm3(sph * 3.1));
  col = mix(col, vec3(1.0), smoothstep(0.6, 0.92, abs(s.n.z)));
  float crack = 1.0 - smoothstep(0.0, 0.045, abs(vnoise(sph * 7.0) - 0.5));
  col = mix(col, vec3(0.42, 0.58, 0.74), crack * 0.4);
  float lit = smoothstep(-0.3, 0.6, dot(s.n, uSun));
  col += vec3(0.6, 0.8, 1.0) * s.rim * 0.5;
  gl_FragColor = vec4(col * (0.18 + 0.82 * lit) * s.limb, s.edge * uOpacity);
}`;

const NEUTRON_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float core = exp(-pow(r * 12.0, 2.0));
  float ring = exp(-pow((r - 0.26) / 0.05, 2.0)) * 0.3;
  float pulse = 0.74 + 0.26 * sin(uTime * 5.3);
  vec3 col = mix(vec3(0.72, 0.86, 1.0), vec3(1.0), core);
  gl_FragColor = vec4(col, clamp((core * 1.7 + ring) * pulse, 0.0, 1.0) * uOpacity);
}`;

/** 脉冲星光束：锥形、越远越散越淡，整组在画面内扫掠 */
const BEAM_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
void main() {
  float along = vUv.x;
  float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float cone = pow(across, 1.0 / (0.22 + along * 1.8));
  float fade = pow(1.0 - along, 1.7);
  float flick = 0.75 + 0.25 * sin(uTime * 5.3);
  gl_FragColor = vec4(0.74, 0.86, 1.0, cone * fade * flick * uOpacity);
}`;

/** 黑洞：事件视界 + 光子环 + 多普勒增亮的吸积盘 + 上下被透镜弯上来的弧 */
const HOLE_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float horizon = 1.0 - smoothstep(0.2, 0.235, r);
  // 光子环在 ~2.6rs（视界 5.2rs 的一半），之前放在 1.3 倍处太贴边
  float photon = exp(-pow((r - 0.31) / 0.026, 2.0));
  float halo = exp(-abs(r - 0.31) / 0.42) * 0.14;
  vec2 q = vec2(p.x * 0.62, p.y * 2.6 + p.x * 0.16);
  float dr = length(q);
  float disk = smoothstep(0.34, 0.5, dr) * (1.0 - smoothstep(1.02, 1.34, dr));
  // 开普勒剪切：内圈转得快（Ω ∝ r^-1.5），盘才会拧出「绕着转」而不是整体平移
  float kepler = uTime * 1.6 * pow(max(dr, 0.42), -1.5);
  float swirl = 0.7 + 0.3 * vnoise(vec2(atan(p.y, p.x) * 3.0 + kepler, dr * 7.0));
  float doppler = 0.3 + 1.1 * smoothstep(-1.0, 1.0, p.x);
  float lens = exp(-pow((abs(p.y / 2.0) - 0.3) / 0.05, 2.0)) * (1.0 - smoothstep(0.45, 1.0, abs(p.x)));
  float glow = pow(max(0.0, 1.0 - r), 3.0) * 0.25;
  float a = (photon * 0.85 + halo + disk * swirl * doppler * 0.8 + lens * 0.35 + glow) * uOpacity;
  vec3 col = mix(uColor, vec3(1.0, 0.95, 0.84), photon * 0.7 + disk * 0.2);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * (1.0 - horizon));
}`;

/**
 * 旋涡星系：按密度波（density wave）的做法画臂脊，而不是 `cos(螺旋角)` 那种
 * 均匀等距的假臂。要点来自公开实现（log-spiral 臂脊 + exp 角向衰减、核球/盘
 * 分段径向轮廓、按星族上色、臂内侧尘埃带、最后走一遍指数色调映射）。
 * 最后那条尤其重要：加色混合下不做 tone map，核部只会糊成一块死白。
 */
const GALAXY_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
uniform float uTwist;
uniform float uArms;
uniform float uIncl;
uniform vec3 uCore;
uniform vec3 uArm;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  // 倾角只压盘面，核球仍是圆的高斯 —— 这个对比才读得出「一个侧着看的盘」，
  // 整张图一起压扁只会得到一个椭圆贴图
  vec2 q = vec2(p.x, p.y / max(0.3, uIncl));
  float r = length(q);
  float rb = length(p);
  float theta = atan(q.y, q.x);
  // 对数螺线臂脊：r = a·e^(b·φ) → φ = ln(r/a)/b
  float armAng = log(max(r, 0.035) / 0.035) * uTwist + uTime * 0.05;
  // 到最近一条臂的角距，归一化到「一个臂间距 = 1」
  float d = fract((armAng - theta) * uArms / 6.28318 + 0.5) - 0.5;
  float width = 0.055 + 0.09 * r;                       // 外圈臂更散
  float ridge = exp(-pow(d / width, 2.0));
  float bulge = exp(-pow(rb * 3.3, 2.0)) + exp(-pow(rb * 9.0, 2.0)) * 0.6;
  float disk = exp(-r * 1.75) * smoothstep(1.0, 0.34, r);
  float arms = ridge * disk * smoothstep(0.03, 0.3, r);
  // 尘埃带：贴在臂脊内侧一点点，把星光挡住 → 臂才有「毛边」而不是光带
  float dust = exp(-pow((d + width * 0.55) / (width * 0.75), 2.0));
  arms *= 1.0 - dust * 0.62;
  // 噪声采样在「跟着臂一起旋」的坐标系里，团块才骑在臂上；在屏幕坐标采样就是糊成一片雾
  float fr = -log(max(r, 0.035)) * uTwist + uTime * 0.05;
  vec2 nq = vec2(q.x * cos(fr) - q.y * sin(fr), q.x * sin(fr) + q.y * cos(fr));
  float grains = 0.62 + 0.62 * fbm3(nq * 3.2);
  // 星族决定颜色：核部年老偏黄、臂上年轻偏蓝、臂脊上点缀粉色 Hα 区
  vec3 col = uArm * (arms * grains) + uCore * bulge * 1.5;
  float ha = smoothstep(0.62, 0.95, vnoise(vec2(theta * 7.0, r * 13.0))) * ridge * disk;
  col += vec3(1.0, 0.42, 0.55) * ha * 0.5;
  col += uArm * pow(max(0.0, 1.0 - rb), 3.0) * 0.12;
  float lum = 1.35;
  col = vec3(1.0) - exp(-col * lum);                    // 指数色调映射，压住死白核
  float a = clamp((bulge * 0.85 + arms + ha * 0.4) * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

const COMET_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float nucleus = 1.0 - smoothstep(0.1, 0.28, r);
  float coma = pow(max(0.0, 1.0 - r), 2.6);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), nucleus * 0.7), clamp(nucleus + coma * 0.7, 0.0, 1.0) * uOpacity);
}`;

/** 天体尾迹：与星屑同一套「速度 × 快门」，剖面也保持同款 */
const STREAK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float along = vUv.x;
  float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float taper = pow(across, 1.3) * (0.28 + 0.72 * along);
  gl_FragColor = vec4(uColor, taper * pow(along, 1.7) * uOpacity);
}`;

interface Sat {
  mesh: Mesh;
  rx: number;
  ry: number;
  w: number;
  ph: number;
}

interface Body {
  root: Group;
  kind: string;
  baseX: number;
  baseY: number;
  baseZ: number;
  speed: number;
  radius: number;
  spin: number;
  sunUniforms: { value: InstanceType<ThreeModule["Vector3"]> }[];
  timeUniforms: { value: number }[];
  fades: { u: { value: number }; base: number }[];
  streak: { mesh: Mesh; op: { value: number } } | null;
  sats: Sat[];
  beamGroup?: Group;
  baseOpacity: number;
  /** 彗星：尾巴按「背向光源」摆，而不是沿速度 */
  antiSolarTail?: boolean;
}

export interface CelestialField {
  update: (step: number, elapsed: number, travel: number, camera: Camera, halfHeightPx: number) => void;
  dispose: () => void;
}

export function createCelestialField(
  THREE: ThreeModule,
  world: Group,
  opts: { isMobile: boolean; reduceMotion: boolean; shutter: number }
): CelestialField {
  const trash: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T): T => (trash.push(x), x);
  const quad = keep(new THREE.PlaneGeometry(1, 1));
  const bodies: Body[] = [];
  const rand = (a: number, b: number) => a + Math.random() * (b - a);

  const shader = (fragmentShader: string, uniforms: Record<string, { value: unknown }>, additive = true) =>
    keep(
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: QUAD_VERT,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
    );

  function blank(kind: string, radius: number): Body {
    const root = new THREE.Group();
    return {
      root,
      kind,
      baseX: rand(-64, 64),
      baseY: rand(-42, 42),
      baseZ: rand(0, RANGE),
      speed: rand(0.7, 1.0),
      radius,
      spin: rand(0.05, 0.22),
      sunUniforms: [],
      timeUniforms: [],
      fades: [],
      streak: null,
      sats: [],
      baseOpacity: 1,
    };
  }

  function attachStreak(b: Body, color: number) {
    const op = { value: 0 };
    const m = shader(STREAK_FRAG, { uColor: { value: new THREE.Color(color) }, uOpacity: op });
    const mesh = new THREE.Mesh(quad, m);
    mesh.visible = false;
    mesh.renderOrder = -1;
    b.root.add(mesh);
    b.streak = { mesh, op };
  }

  /** 球体：把 uSun / uTime / uOpacity 接到这个 body 的更新表上 */
  function addSphere(b: Body, mesh: Mesh, m: InstanceType<ThreeModule["ShaderMaterial"]>, opacity: number) {
    b.root.add(mesh);
    if (m.uniforms.uSun) b.sunUniforms.push(m.uniforms.uSun as { value: InstanceType<ThreeModule["Vector3"]> });
    if (m.uniforms.uTime) b.timeUniforms.push(m.uniforms.uTime as { value: number });
    if (m.uniforms.uOpacity) b.fades.push({ u: m.uniforms.uOpacity as { value: number }, base: opacity });
  }

  const KINDS = opts.isMobile
    ? ["earth", "gas", "galaxy", "comet"]
    : ["earth", "earth", "gas", "gas", "lava", "ice", "neutron", "hole", "hole", "galaxy", "comet", "comet"];

  for (const kind of KINDS) {
    if (kind === "earth") {
      const r = 26;
      const b = blank(kind, r);
      const m = shader(EARTH_FRAG, {
        uSun: { value: new THREE.Vector3(1, 0, 0) },
        uTime: { value: 0 },
        uOpacity: { value: 1 },
        uSky: { value: new THREE.Color(0x1a2150) },
      }, false);
      addSphere(b, new THREE.Mesh(quad, m), m, 0.98);
      const moonMat = shader(MOON_FRAG, {
        uSun: { value: new THREE.Vector3(1, 0, 0) },
        uOpacity: { value: 1 },
        uSky: { value: new THREE.Color(0x1e2455) },
      }, false);
      const moon = new THREE.Mesh(quad, moonMat);
      addSphere(b, moon, moonMat, 0.95);
      b.sats.push({ mesh: moon, rx: r * 2.9, ry: r * 0.85, w: 0.5, ph: rand(0, 6.28) });
      attachStreak(b, 0x9fd4ff);
      world.add(b.root);
      bodies.push(b);
    } else if (kind === "gas") {
      const r = 30;
      const b = blank(kind, r);
      const m = shader(GAS_FRAG, {
        uSun: { value: new THREE.Vector3(1, 0, 0) },
        uTime: { value: 0 },
        uOpacity: { value: 1 },
        uA: { value: new THREE.Color(0xeccfa6) },
        uB: { value: new THREE.Color(0x9a6a4e) },
      }, false);
      const sphere = new THREE.Mesh(quad, m);
      sphere.scale.setScalar(r * 2);
      sphere.renderOrder = 2;
      addSphere(b, sphere, m, 0.97);
      const tilt = 0.34;
      for (const front of [0, 1]) {
        const rm = shader(RING_FRAG, {
          uOpacity: { value: front ? 0.42 : 0.3 },
          uFront: { value: front },
          uTilt: { value: tilt },
          uColor: { value: new THREE.Color(0xf1e4ca) },
        }, false);
        const ring = new THREE.Mesh(quad, rm);
        ring.scale.setScalar(r * 2.05);
        ring.rotation.z = tilt;
        ring.renderOrder = front ? 3 : 1;
        b.root.add(ring);
        b.fades.push({ u: rm.uniforms.uOpacity as { value: number }, base: front ? 0.42 : 0.3 });
      }
      attachStreak(b, 0xf0d8b0);
      world.add(b.root);
      bodies.push(b);
    } else if (kind === "lava" || kind === "ice") {
      const r = kind === "lava" ? 21 : 15;
      const b = blank(kind, r);
      const m =
        kind === "lava"
          ? shader(LAVA_FRAG, {
              uSun: { value: new THREE.Vector3(1, 0, 0) },
              uTime: { value: 0 },
              uOpacity: { value: 1 },
            }, false)
          : shader(ICE_FRAG, {
              uSun: { value: new THREE.Vector3(1, 0, 0) },
              uOpacity: { value: 1 },
              uTime: { value: 0 },
            }, false);
      const sphere = new THREE.Mesh(quad, m);
      sphere.scale.setScalar(r * 2);
      addSphere(b, sphere, m, 0.96);
      attachStreak(b, kind === "lava" ? 0xff9a4a : 0xcfe8ff);
      world.add(b.root);
      bodies.push(b);
    } else if (kind === "neutron") {
      const r = 9;
      const b = blank(kind, r);
      const m = shader(NEUTRON_FRAG, { uOpacity: { value: 1 }, uTime: { value: 0 } });
      const core = new THREE.Mesh(quad, m);
      core.scale.setScalar(r * 2);
      addSphere(b, core, m, 0.95);
      const beamMat = shader(BEAM_FRAG, { uOpacity: { value: 0.26 }, uTime: { value: 0 } });
      b.timeUniforms.push(beamMat.uniforms.uTime as { value: number });
      const beams = new THREE.Group();
      for (const dir of [1, -1]) {
        const beam = new THREE.Mesh(quad, beamMat);
        beam.scale.set(r * 6 * dir, r * 1.6, 1);
        beam.position.x = r * 3 * dir;
        beam.rotation.z = dir > 0 ? 0 : Math.PI;
        beams.add(beam);
      }
      b.root.add(beams);
      b.beamGroup = beams;
      b.fades.push({ u: beamMat.uniforms.uOpacity as { value: number }, base: 0.26 });
      attachStreak(b, 0xbcd6ff);
      world.add(b.root);
      bodies.push(b);
    } else if (kind === "hole") {
      const r = 24;
      const b = blank(kind, r);
      const m = shader(HOLE_FRAG, {
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xffb86a) },
      });
      const disc = new THREE.Mesh(quad, m);
      disc.scale.setScalar(r * 2.2);
      disc.rotation.z = 0.24;
      addSphere(b, disc, m, 0.95);
      attachStreak(b, 0xffc98a);
      world.add(b.root);
      bodies.push(b);
    } else if (kind === "galaxy") {
      const r = 74;
      const b = blank(kind, r);
      b.speed = rand(0.4, 0.55);
      b.baseY = rand(-24, 34);
      const m = shader(GALAXY_FRAG, {
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        uTwist: { value: rand(3.6, 5.2) },
        uArms: { value: Math.random() < 0.5 ? 2 : 3 },
        uIncl: { value: rand(0.42, 0.95) },
        uCore: { value: new THREE.Color(0xfff0d4) },
        uArm: { value: new THREE.Color(0x9db8ff) },
      });
      const g = new THREE.Mesh(quad, m);
      g.scale.set(r * 2, r * 2, 1);
      g.rotation.z = rand(-1, 1);
      addSphere(b, g, m, 0.5);
      attachStreak(b, 0xc9b8ff);
      world.add(b.root);
      bodies.push(b);
    } else {
      const r = 11;
      const b = blank(kind, r);
      b.speed = rand(1.15, 1.4);
      b.antiSolarTail = true;
      const m = shader(COMET_FRAG, { uOpacity: { value: 1 }, uColor: { value: new THREE.Color(0xd8f0ff) } });
      const head = new THREE.Mesh(quad, m);
      head.scale.setScalar(r * 2);
      addSphere(b, head, m, 0.95);
      attachStreak(b, 0xbfe6ff);
      world.add(b.root);
      bodies.push(b);
    }
  }

  const wp = new THREE.Vector3();
  const ndc = bodies.map(() => ({ x: 0, y: 0, ok: false }));
  const vel = bodies.map(() => 0);
  const light = new THREE.Vector3(LIGHT.x, LIGHT.y, LIGHT.z);

  return {
    update(step, elapsed, travel, camera, halfHeightPx) {
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        const z = ((((b.baseZ + travel * b.speed) % RANGE) + RANGE) % RANGE) - RANGE * 0.5;
        const d = CAMERA_Z - z;
        b.root.position.set(b.baseX, b.baseY, z);

        // 远处进场淡入、近到糊屏淡出：两项方向相反，别写反（写反就等于只留贴脸那一段）
        const appear = smooth(10, 34, d) * (1 - smooth(255, 335, d));
        if (d < 6 || appear < 0.012) {
          b.root.visible = false;
          ndc[i].ok = false;
          vel[i] = 0;
          continue;
        }
        b.root.visible = true;

        for (const f of b.fades) f.u.value = f.base * appear;
        for (const u of b.timeUniforms) u.value = elapsed;
        if (!opts.reduceMotion && b.kind !== "galaxy") b.root.rotation.y = Math.sin(elapsed * 0.05 + b.baseX) * 0.06;
        if (b.beamGroup && !opts.reduceMotion) b.beamGroup.rotation.z = elapsed * 0.55;

        // 唯一光源：明暗界线随天体相对灯的位置变化（并且飞过时会自动转向）
        wp.copy(light).sub(b.root.position).normalize();
        for (const u of b.sunUniforms) u.value.copy(wp);

        for (const s of b.sats) {
          const a = s.ph + elapsed * s.w;
          s.mesh.position.set(Math.cos(a) * s.rx, Math.sin(a) * s.ry, Math.sin(a) * s.rx * 0.55);
          const near = 1 - smooth(-s.rx, s.rx, s.mesh.position.z);
          s.mesh.scale.setScalar(b.radius * (0.26 + 0.1 * near));
        }

        // ── 尾迹：屏幕速度（设备像素/秒）× 与星屑同一个快门
        b.root.getWorldPosition(wp);
        const worldPos = wp.clone();
        wp.project(camera);
        const cx = wp.x;
        const cy = wp.y;
        const p = ndc[i];
        if (b.streak) {
          if (b.antiSolarTail) {
            // 彗尾：轴 = 彗星→光源 的反方向；越靠近光源越亮越长（活性 ∝ 1/距离²）
            const away = new THREE.Vector3().subVectors(worldPos, light);
            const dist = away.length();
            away.normalize();
            const act = Math.min(1, 14000 / (dist * dist));
            const sx = away.x * (halfHeightPx / Math.max(20, d)) * camera.aspect;
            const sy = -away.y * (halfHeightPx / Math.max(20, d));
            const ang = Math.atan2(-sy, -sx);
            const len = b.radius * (7 + 22 * act);
            b.streak.mesh.visible = appear > 0.05;
            b.streak.mesh.rotation.z = ang;
            b.streak.mesh.scale.set(len, b.radius * (0.9 + act * 1.1), 1);
            b.streak.mesh.position.set(-Math.cos(ang) * len * 0.5, -Math.sin(ang) * len * 0.5, -0.05);
            b.streak.op.value = (0.16 + 0.34 * act) * appear;
          } else if (!p.ok || step <= 0) {
            b.streak.mesh.visible = false;
          } else {
            const vx = ((cx - p.x) / step) * halfHeightPx * camera.aspect;
            const vy = ((cy - p.y) / step) * halfHeightPx;
            const sp = Math.hypot(vx, vy);
            vel[i] += (sp - vel[i]) * Math.min(1, step * 10);
            const len = Math.min(b.radius * 26, vel[i] * opts.shutter);
            if (len > 2.5) {
              const ang = Math.atan2(-vy, -vx);
              b.streak.mesh.visible = true;
              b.streak.mesh.rotation.z = ang;
              b.streak.mesh.scale.set(len, b.radius * 1.5, 1);
              b.streak.mesh.position.set(-Math.cos(ang) * len * 0.5, -Math.sin(ang) * len * 0.5, -0.05);
              b.streak.op.value = Math.min(0.45, len / (b.radius * 60)) * appear;
            } else {
              b.streak.mesh.visible = false;
            }
          }
        }
        p.x = cx;
        p.y = cy;
        p.ok = true;
      }
    },
    dispose() {
      for (const b of bodies) b.root.removeFromParent();
      for (const item of trash) {
        try {
          item.dispose();
        } catch {
          // 卸载期释放失败不影响页面
        }
      }
    },
  };
}

function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
