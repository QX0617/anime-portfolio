// ── 世界空间天体场
//
// 为什么是**真几何体**而不是 billboard 四边形：
// 上一版用一张四边形 + `sqrt(1-r²)` 假装有球面，结果在真实截图里暴露出三个问题 ——
// ① 四边形边缘会露出来（黑洞的吸积盘直接显示成一个橙色矩形）；
// ② 行星环没有深度关系，只能用「画两遍 + 解析裁一半」硬凑，凑歪了就成了刮在球面上的白条；
// ③ 明暗界线是算在贴图空间里的，球怎么转光都不动 → 一眼假。
// 现在：球是 SphereGeometry（不透明、写深度），环与吸积盘是 RingGeometry（开深度测试），
// 遮挡关系由深度缓冲负责 —— 这也是 Celestia 的做法。星星是透明加色且默认开 depthTest，
// 所以会被行星**正确挡住**，不再出现「星穿在球身上」。
//
// 密度也是真实宇宙的一部分：星际空间是空的。
// RANGE 拉到 1500、桌面只放 6 个、位置刻意避开中央文字栏、表观尺寸上限收到半屏高 55%，
// 目标是「同一时刻通常只看见一个天体，偶尔两个」，而不是堆成太阳系模型。
//
// 契约（勿回退）：
// 1) 尾迹长度 = 屏幕速度 × `shutter`，与 STAR_VERT 共用 three-scene 传入的同一个常数。
// 2) 每帧只做变换与 uniform 更新，绝不重建几何体。
// 3) 尾迹/光晕这类贴图必须挂在**不自转**的 frame 分组上，否则会被球体的 rotation.y 带歪。
// 4) 全场只有一个世界空间光源 uLight，明暗界线由「光源 − 天体世界坐标」现算。
import type * as ThreeNS from "three";

type ThreeModule = typeof import("three");
type Mesh = InstanceType<ThreeModule["Mesh"]>;
type Group = InstanceType<ThreeModule["Group"]>;
type Camera = InstanceType<ThreeModule["PerspectiveCamera"]>;
type Vec3U = { value: InstanceType<ThreeModule["Vector3"]> };

const RANGE = 1500;
const CAMERA_Z = 18;
/** 远处的一颗恒星：够远所以光照方向近似平行，但仍在天体之间产生可见差异 */
const LIGHT = { x: -900, y: 620, z: 1400 };

const NOISE = /* glsl */ `
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm3(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.3) * 0.3 + vnoise(p * 4.7) * 0.15; }
`;

/** 球体公共部分：世界法线 + 世界位置 → 真实的光照方向、边缘变暗与大气 rim */
const SPHERE_HEAD = /* glsl */ `
uniform vec3 uLight;
uniform float uTime;
uniform float uOpacity;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
${NOISE}
void main() {
  vec3 L = normalize(uLight - vW);
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float ndl = dot(N, L);
  float lit = smoothstep(-0.16, 0.34, ndl);            // 有一点软度的晨昏线
  float limb = clamp(dot(N, V), 0.0, 1.0);
  float rim = pow(1.0 - limb, 3.0);                    // 边缘大气散射
  \${BODY}
}`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SPHERE_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
void main() {
  vObj = normalize(position);
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** 球面坐标：经度随自转（vObj 是物体空间法线，所以纹理跟着球转） */
const SPHERE_COORDS = /* glsl */ `
  float lon = atan(vObj.x, vObj.z);
  float lat = vObj.y;`;

const EARTH_BODY = /* glsl */ `
  ${SPHERE_COORDS}
  vec2 sph = vec2(lon * 1.5, lat * 2.4);
  float land = smoothstep(0.46, 0.58, fbm3(sph * 1.9 + 3.1));
  float cloud = smoothstep(0.52, 0.74, fbm3(sph * 2.9 + vec2(uTime * 0.02, 1.7)));
  vec3 surf = mix(vec3(0.05, 0.2, 0.42), vec3(0.24, 0.42, 0.24), land);
  surf = mix(surf, vec3(0.95), cloud * 0.5);
  surf = mix(surf, vec3(0.93, 0.96, 0.99), smoothstep(0.82, 0.98, abs(lat)) * 0.85);
  vec3 H = normalize(L + V);
  float glint = pow(max(0.0, dot(N, H)), 52.0) * (1.0 - land) * (1.0 - cloud);
  vec3 city = vec3(1.0, 0.72, 0.38) * land * (1.0 - lit) * smoothstep(0.5, 0.86, vnoise(sph * 9.0));
  vec3 col = surf * (0.04 + 0.96 * lit) + city * 0.9 + vec3(0.9, 0.96, 1.0) * glint * 0.8;
  col += vec3(0.36, 0.6, 1.0) * rim * (0.25 + 0.75 * lit) * 1.15;
  gl_FragColor = vec4(col, uOpacity);`;

const MOON_BODY = /* glsl */ `
  ${SPHERE_COORDS}
  vec2 sph = vec2(lon * 1.6, lat * 2.2);
  float maria = smoothstep(0.44, 0.62, fbm3(sph * 2.2 + 3.1));
  float craters = smoothstep(0.62, 0.9, vnoise(sph * 11.0));
  vec3 surf = mix(vec3(0.62, 0.6, 0.58), vec3(0.4, 0.41, 0.46), maria) * (1.0 - craters * 0.28);
  vec3 col = surf * (0.03 + 0.97 * lit);
  col += vec3(0.7, 0.76, 0.95) * rim * lit * 0.35;
  gl_FragColor = vec4(col, uOpacity);`;

const GAS_BODY = /* glsl */ `
  ${SPHERE_COORDS}
  // 纬向流：不同纬度漂移速度不同，带才会拧起来（木星的样子）
  float flow = lon + uTime * (0.06 + 0.5 * sin(lat * 5.4));
  float warp = fbm3(vec2(flow * 1.9, lat * 3.4));
  float bands = pow(0.5 + 0.5 * sin(lat * 13.0 + warp * 2.6), 1.5);
  vec3 col = mix(vec3(0.72, 0.55, 0.4), vec3(0.94, 0.86, 0.74), bands);
  col = mix(col, vec3(0.6, 0.44, 0.34), smoothstep(0.55, 0.95, fbm3(vec2(flow * 4.0, lat * 9.0))) * 0.4);
  float spot = 1.0 - smoothstep(0.0, 0.16, length(vec2((flow - 1.1) * 1.3, (lat + 0.2) * 4.4)));
  col = mix(col, vec3(0.78, 0.4, 0.3), spot * 0.65);
  col *= 0.06 + 0.94 * lit;
  col += vec3(0.85, 0.78, 0.7) * rim * lit * 0.5;
  gl_FragColor = vec4(col, uOpacity);`;

const LAVA_BODY = /* glsl */ `
  ${SPHERE_COORDS}
  vec2 sph = vec2(lon * 1.7, lat * 2.4);
  float rock = smoothstep(0.4, 0.62, fbm3(sph * 3.4));
  // 裂缝：|fbm-0.5| 的细等高线，只在少数地方开口发光，别铺满（铺满就是蜘蛛网）
  float crack = 1.0 - smoothstep(0.0, 0.075, abs(fbm3(sph * 2.7) - 0.5));
  float hot = crack * smoothstep(0.35, 0.75, fbm3(sph * 1.3 + 7.0));
  vec3 col = mix(vec3(0.05, 0.045, 0.05), vec3(0.17, 0.14, 0.13), rock);
  col += mix(vec3(0.95, 0.3, 0.05), vec3(1.0, 0.8, 0.34), hot * 0.6) * hot * 1.5;
  col *= 0.22 + 0.78 * lit;
  col += vec3(1.0, 0.42, 0.14) * rim * (0.3 + 0.7 * lit) * 0.8;
  gl_FragColor = vec4(col, uOpacity);`;

const ICE_BODY = /* glsl */ `
  ${SPHERE_COORDS}
  vec2 sph = vec2(lon * 1.6, lat * 2.3);
  vec3 col = mix(vec3(0.55, 0.7, 0.82), vec3(0.9, 0.95, 1.0), fbm3(sph * 3.2));
  col = mix(col, vec3(1.0), smoothstep(0.86, 0.99, abs(lat)));
  float crack = 1.0 - smoothstep(0.0, 0.05, abs(vnoise(sph * 6.5) - 0.5));
  col = mix(col, vec3(0.4, 0.56, 0.72), crack * 0.35);
  col *= 0.08 + 0.92 * lit;
  col += vec3(0.62, 0.82, 1.0) * rim * lit * 0.7;
  gl_FragColor = vec4(col, uOpacity);`;

/** 行星环：几何本身就是环，半径由局部坐标算 → 不会再有矩形边 */
const RING_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uInner;
uniform float uOuter;
uniform vec3 uColor;
uniform vec3 uLight;
varying vec3 vW;
varying vec3 vLocal;
${NOISE}
void main() {
  float t = (length(vLocal) - uInner) / max(0.0001, uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  // 环缝：几道锐缝 + 密度起伏，别做成均匀渐变的「光碟」
  float bands = 0.55 + 0.45 * step(0.36, fract(t * 5.6));
  bands *= 1.0 - 0.85 * smoothstep(0.42, 0.47, t) * (1.0 - smoothstep(0.5, 0.55, t)); // 卡西尼缝
  float dust = 0.75 + 0.25 * vnoise(vec2(t * 34.0, 2.3));
  float edge = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.9, 1.0, t));
  gl_FragColor = vec4(uColor, clamp(bands * dust * edge * uOpacity, 0.0, 1.0));
}`;

const RING_VERT = /* glsl */ `
varying vec3 vW;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

/** 星系：盘面用极坐标；臂脊按密度波，且小半径处限制绕数（否则核心糊成同心圆指纹） */
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
  // 倾角只压盘面，核球保持圆形 —— 整张图一起压扁就只是椭圆贴图
  vec2 q = vec2(p.x, p.y / max(0.34, uIncl));
  float r = length(q);
  float rb = length(p);
  if (rb > 1.0) discard;
  float theta = atan(q.y, q.x);
  // 用 r^0.62 而不是 log(r)：log 在核心处绕数发散，采样不足就变成一圈圈同心纹
  float wind = pow(max(r, 0.02), 0.62) * uTwist * 6.28318;
  float d = fract((wind - theta) * uArms / 6.28318 + 0.5) - 0.5;
  float width = 0.07 + 0.16 * r;
  float ridge = exp(-pow(d / width, 2.0));
  float bulge = exp(-pow(rb * 3.4, 2.0)) + exp(-pow(rb * 9.0, 2.0)) * 0.5;
  float disk = exp(-r * 2.1) * smoothstep(1.0, 0.3, r);
  float arms = ridge * disk * smoothstep(0.05, 0.34, r);
  float dust = exp(-pow((d + width * 0.6) / (width * 0.8), 2.0));
  arms *= 1.0 - dust * 0.55;
  float fr = -wind + uTime * 0.05;
  vec2 nq = vec2(q.x * cos(fr) - q.y * sin(fr), q.x * sin(fr) + q.y * cos(fr));
  float grains = 0.6 + 0.66 * fbm3(nq * 3.4);
  vec3 col = uArm * (arms * grains) + uCore * bulge * 1.35;
  float ha = smoothstep(0.6, 0.94, vnoise(vec2(theta * 6.0, r * 11.0))) * ridge * disk;
  col += vec3(1.0, 0.4, 0.55) * ha * 0.4;
  col = vec3(1.0) - exp(-col * 1.25);                  // 指数色调映射：核部不要死白
  float a = clamp((bulge * 0.7 + arms + ha * 0.3) * uOpacity, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPow;
varying vec2 vUv;
void main() {
  float r = length((vUv - 0.5) * 2.0);
  r = min(r, 1.0);
  gl_FragColor = vec4(uColor, pow(1.0 - r, uPow) * uOpacity);
}`;

const NEUTRON_FRAG = /* glsl */ `
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = min(length(p), 1.0);
  float core = exp(-pow(r * 11.0, 2.0));
  float pulse = 0.74 + 0.26 * sin(uTime * 5.3);
  vec3 col = mix(vec3(0.72, 0.86, 1.0), vec3(1.0), core);
  gl_FragColor = vec4(col, core * 1.7 * pulse * uOpacity);
}`;

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

const COMET_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = min(length(p), 1.0);
  float nucleus = 1.0 - smoothstep(0.08, 0.26, r);
  float coma = pow(1.0 - r, 2.8);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), nucleus * 0.7), clamp(nucleus + coma * 0.6, 0.0, 1.0) * uOpacity);
}`;

/** 尾迹：与星屑同一套「速度 × 快门」，剖面也保持同款 */
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

interface Body {
  kind: string;
  root: Group;
  /** 不自转的挂载点：光晕与尾迹放这里，免得被球体 rotation 带歪 */
  frame: Group;
  radius: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  speed: number;
  spinRate: number;
  fades: { u: { value: number }; base: number }[];
  times: { value: number }[];
  streak: { mesh: Mesh; op: { value: number } } | null;
  antiSolarTail?: boolean;
  moon?: { mesh: Mesh; rx: number; ry: number; w: number; ph: number };
  beamGroup?: Group;
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
  const lightUniform: Vec3U = { value: new THREE.Vector3(LIGHT.x, LIGHT.y, LIGHT.z) };
  /** 刻意避开中央的文字栏：横向位置只落在两侧外带 */
  const sideOffset = () => (Math.random() < 0.5 ? -1 : 1) * rand(30, 88);

  const sphereMat = (body: string, extra: Record<string, { value: unknown }> = {}, opacity = 1) =>
    keep(
      new THREE.ShaderMaterial({
        uniforms: { uLight: lightUniform, uTime: { value: 0 }, uOpacity: { value: opacity }, ...extra },
        vertexShader: SPHERE_VERT,
        fragmentShader: SPHERE_HEAD.replace("\${BODY}", body),
        // 要能按距离淡出所以是 transparent；深度仍然写，环与星才挡得住。
        // 显式 renderOrder：球(1) 先画写深度 → 环(2) 开深度测试，被球挡住的那半自动消失。
        transparent: true,
        depthWrite: true,
      })
    );

  const spriteMat = (fragmentShader: string, uniforms: Record<string, { value: unknown }>) =>
    keep(
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: QUAD_VERT,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );

  function frameOf(b: Body) {
    world.add(b.frame);
  }

  function attachStreak(b: Body, color: number) {
    const op = { value: 0 };
    const m = spriteMat(STREAK_FRAG, { uColor: { value: new THREE.Color(color) }, uOpacity: op });
    const mesh = new THREE.Mesh(quad, m);
    mesh.visible = false;
    b.frame.add(mesh);
    b.streak = { mesh, op };
  }

  function newBody(kind: string, radius: number): Body {
    const root = new THREE.Group();
    const b: Body = {
      kind,
      root,
      frame: new THREE.Group(),
      radius,
      baseX: sideOffset(),
      baseY: rand(-46, 46),
      baseZ: rand(0, RANGE),
      speed: rand(0.7, 1.05),
      spinRate: rand(0.05, 0.13),
      fades: [],
      times: [],
      streak: null,
    };
    world.add(root);
    frameOf(b);
    return b;
  }

  function addSphere(b: Body, mesh: Mesh, m: InstanceType<ThreeModule["ShaderMaterial"]>, opacity: number) {
    b.root.add(mesh);
    b.times.push(m.uniforms.uTime as { value: number });
    b.fades.push({ u: m.uniforms.uOpacity as { value: number }, base: opacity });
  }

  /** 环：几何就是环带，深度测试自动负责被球挡住的那一半 */
  function addRing(b: Body, inner: number, outer: number, color: number, opacity: number, tiltX: number, tiltZ: number) {
    const geo = keep(new THREE.RingGeometry(inner, outer, 128, 1));
    const m = keep(
      new THREE.ShaderMaterial({
        uniforms: {
          uOpacity: { value: opacity },
          uInner: { value: inner },
          uOuter: { value: outer },
          uColor: { value: new THREE.Color(color) },
          uLight: lightUniform,
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    const ring = new THREE.Mesh(geo, m);
    ring.rotation.set(tiltX, 0, tiltZ);
    ring.renderOrder = 2;
    b.root.add(ring);
    b.fades.push({ u: m.uniforms.uOpacity as { value: number }, base: opacity });
  }

  // ── 地球 + 月亮
  {
    const r = 9.5;
    const b = newBody("earth", r);
    const m = sphereMat(EARTH_BODY);
    const sphere = new THREE.Mesh(keep(new THREE.SphereGeometry(r, 44, 30)), m);
    sphere.renderOrder = 1;
    addSphere(b, sphere, m, 1);
    const moonMat = sphereMat(MOON_BODY);
    const moon = new THREE.Mesh(keep(new THREE.SphereGeometry(r * 0.28, 24, 16)), moonMat);
    b.root.add(moon);
    b.times.push(moonMat.uniforms.uTime as { value: number });
    b.fades.push({ u: moonMat.uniforms.uOpacity as { value: number }, base: 1 });
    b.moon = { mesh: moon, rx: r * 3.1, ry: r * 0.9, w: 0.34, ph: rand(0, 6.28) };
    attachStreak(b, 0x9fd4ff);
    bodies.push(b);
  }

  // ── 带环气态巨行星
  {
    const r = 11.5;
    const b = newBody("gas", r);
    const m = sphereMat(GAS_BODY);
    const sphere = new THREE.Mesh(keep(new THREE.SphereGeometry(r, 44, 30)), m);
    sphere.renderOrder = 1;
    addSphere(b, sphere, m, 1);
    addRing(b, r * 1.35, r * 2.35, 0xf0e6d0, 0.5, -1.15, 0.22);
    attachStreak(b, 0xf0d8b0);
    bodies.push(b);
  }

  // ── 熔岩行星
  {
    const r = 7.5;
    const b = newBody("lava", r);
    const m = sphereMat(LAVA_BODY);
    addSphere(b, new THREE.Mesh(keep(new THREE.SphereGeometry(r, 40, 26)), m), m, 1);
    attachStreak(b, 0xff9a4a);
    bodies.push(b);
  }

  // ── 冰质矮行星
  {
    const r = 5.5;
    const b = newBody("ice", r);
    const m = sphereMat(ICE_BODY);
    addSphere(b, new THREE.Mesh(keep(new THREE.SphereGeometry(r, 36, 24)), m), m, 1);
    attachStreak(b, 0xcfe8ff);
    bodies.push(b);
  }

  // ── 黑洞：不透明黑球（真的会挡住星）+ 倾斜吸积盘 + 光子环光晕
  {
    const r = 4.2;
    const b = newBody("hole", r);
    const shadow = new THREE.Mesh(
      keep(new THREE.SphereGeometry(r, 32, 20)),
      keep(new THREE.MeshBasicMaterial({ color: 0x000000 }))
    );
    shadow.renderOrder = 1;
    b.root.add(shadow);
    const diskGeo = keep(new THREE.RingGeometry(r * 1.5, r * 5.2, 128, 1));
    const diskMat = keep(
      new THREE.ShaderMaterial({
        uniforms: {
          uOpacity: { value: 0.9 },
          uInner: { value: r * 1.5 },
          uOuter: { value: r * 5.2 },
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(0xffb063) },
        },
        vertexShader: RING_VERT,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          uniform float uInner;
          uniform float uOuter;
          uniform float uTime;
          uniform vec3 uColor;
          varying vec3 vW;
          varying vec3 vLocal;
          ${NOISE}
          void main() {
            float t = (length(vLocal) - uInner) / max(0.0001, uOuter - uInner);
            if (t < 0.0 || t > 1.0) discard;
            float dr = uInner + t * (uOuter - uInner);
            // 开普勒剪切：内圈转得快，盘才会拧起来
            float kepler = uTime * 2.2 * pow(dr, -1.5) * 40.0;
            float swirl = 0.7 + 0.3 * vnoise(vec2(atan(vLocal.y, vLocal.x) * 3.0 + kepler, t * 6.0));
            float heat = pow(1.0 - t, 1.8);
            // 多普勒增亮：朝我们转的那一侧明显更亮
            float doppler = 0.35 + 1.15 * smoothstep(-1.0, 1.0, normalize(vLocal).x);
            float edge = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.72, 1.0, t));
            float a = swirl * heat * doppler * edge * uOpacity;
            gl_FragColor = vec4(mix(uColor, vec3(1.0, 0.95, 0.86), heat * 0.55), clamp(a, 0.0, 1.0));
          }`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      })
    );
    const disk = new THREE.Mesh(diskGeo, diskMat);
    disk.rotation.set(-1.05, 0, 0.18);
    disk.renderOrder = 2;
    b.root.add(disk);
    b.times.push(diskMat.uniforms.uTime as { value: number });
    b.fades.push({ u: diskMat.uniforms.uOpacity as { value: number }, base: 0.9 });
    const glowMat = spriteMat(GLOW_FRAG, {
      uColor: { value: new THREE.Color(0xffd9a0) },
      uOpacity: { value: 0.3 },
      uPow: { value: 3.6 },
    });
    const glow = new THREE.Mesh(quad, glowMat);
    glow.scale.setScalar(r * 5.4);
    b.frame.add(glow);
    b.fades.push({ u: glowMat.uniforms.uOpacity as { value: number }, base: 0.3 });
    attachStreak(b, 0xffc98a);
    bodies.push(b);
  }

  // ── 脉冲星：亮点 + 两道扫掠光束
  {
    const r = 2.6;
    const b = newBody("neutron", r);
    const m = spriteMat(NEUTRON_FRAG, { uOpacity: { value: 1 }, uTime: { value: 0 } });
    const core = new THREE.Mesh(quad, m);
    core.scale.setScalar(r * 7);
    b.frame.add(core);
    b.times.push(m.uniforms.uTime as { value: number });
    b.fades.push({ u: m.uniforms.uOpacity as { value: number }, base: 0.95 });
    const beamMat = spriteMat(BEAM_FRAG, { uOpacity: { value: 0.22 }, uTime: { value: 0 } });
    b.times.push(beamMat.uniforms.uTime as { value: number });
    const beams = new THREE.Group();
    for (const dir of [1, -1]) {
      const beam = new THREE.Mesh(quad, beamMat);
      beam.scale.set(r * 22 * dir, r * 5, 1);
      beam.position.x = r * 11 * dir;
      beam.rotation.z = dir > 0 ? 0 : Math.PI;
      beams.add(beam);
    }
    b.frame.add(beams);
    b.beamGroup = beams;
    b.fades.push({ u: beamMat.uniforms.uOpacity as { value: number }, base: 0.22 });
    attachStreak(b, 0xbcd6ff);
    bodies.push(b);
  }

  // ── 旋涡星系（远、慢、暗一点：它是背景地标，不是主角）
  {
    const r = 30;
    const b = newBody("galaxy", r);
    b.speed = rand(0.34, 0.5);
    b.baseY = rand(-30, 40);
    const m = spriteMat(GALAXY_FRAG, {
      uOpacity: { value: 0.42 },
      uTime: { value: 0 },
      uTwist: { value: rand(0.75, 1.15) },
      uArms: { value: Math.random() < 0.5 ? 2 : 3 },
      uIncl: { value: rand(0.45, 0.95) },
      uCore: { value: new THREE.Color(0xfff0d4) },
      uArm: { value: new THREE.Color(0x9db8ff) },
    });
    const g = new THREE.Mesh(quad, m);
    g.scale.setScalar(r * 2);
    g.rotation.z = rand(-1, 1);
    b.frame.add(g);
    b.times.push(m.uniforms.uTime as { value: number });
    b.fades.push({ u: m.uniforms.uOpacity as { value: number }, base: 0.42 });
    attachStreak(b, 0xc9b8ff);
    bodies.push(b);
  }

  // ── 彗星：头 + 背向光源的尾巴
  {
    const r = 1.6;
    const b = newBody("comet", r);
    b.speed = rand(1.1, 1.35);
    const m = spriteMat(COMET_FRAG, { uOpacity: { value: 1 }, uColor: { value: new THREE.Color(0xd8f0ff) } });
    const head = new THREE.Mesh(quad, m);
    head.scale.setScalar(r * 9);
    b.frame.add(head);
    b.fades.push({ u: m.uniforms.uOpacity as { value: number }, base: 0.95 });
    b.antiSolarTail = true;
    attachStreak(b, 0xbfe6ff);
    bodies.push(b);
  }

  if (opts.isMobile) {
    // 移动端只留三类：球体 + 环 + 星系，填充率与着色器数量都砍下来
    for (const b of bodies) {
      if (b.kind !== "earth" && b.kind !== "gas" && b.kind !== "galaxy") {
        b.root.visible = false;
        b.frame.visible = false;
        b.speed = -1;
      }
    }
  }

  const wp = new THREE.Vector3();
  const away = new THREE.Vector3();
  const lightVec = new THREE.Vector3(LIGHT.x, LIGHT.y, LIGHT.z);
  const ndc = bodies.map(() => ({ x: 0, y: 0, ok: false }));
  const vel = bodies.map(() => 0);

  return {
    update(step, elapsed, travel, camera, halfHeightPx) {
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b.speed < 0) continue;
        const z = ((((b.baseZ + travel * b.speed) % RANGE) + RANGE) % RANGE) - RANGE * 0.5;
        const d = CAMERA_Z - z;
        b.root.position.set(b.baseX, b.baseY, z);
        b.frame.position.copy(b.root.position);

        // 表观尺寸上限：屏幕半径超过半屏高 55% 就淡出（真实宇宙里行星不会糊满屏）
        const rPx = (b.radius * halfHeightPx) / Math.max(1, d);
        const cap = halfHeightPx * 0.55;
        const appear =
          smooth(14, 46, d) * (1 - smooth(RANGE * 0.17, RANGE * 0.22, d)) * (1 - smooth(cap * 0.6, cap, rPx));
        if (d < 10 || appear < 0.012) {
          b.root.visible = false;
          b.frame.visible = false;
          ndc[i].ok = false;
          vel[i] = 0;
          continue;
        }
        b.root.visible = true;
        b.frame.visible = true;

        for (const f of b.fades) f.u.value = f.base * appear;
        for (const u of b.times) u.value = elapsed;
        // 真自转：纹理在物体空间，所以转动会带着地表走
        if (!opts.reduceMotion) b.root.rotation.y += step * b.spinRate;
        if (b.beamGroup && !opts.reduceMotion) b.beamGroup.rotation.z = elapsed * 0.5;

        if (b.moon) {
          const a = b.moon.ph + elapsed * b.moon.w;
          b.moon.mesh.position.set(Math.cos(a) * b.moon.rx, Math.sin(a) * b.moon.ry * 0.35, Math.sin(a) * b.moon.rx);
        }

        // ── 尾迹：与星屑同一个「速度 × 快门」式子
        b.frame.getWorldPosition(wp);
        const worldPos = wp.clone();
        wp.project(camera);
        const cx = wp.x;
        const cy = wp.y;
        const p = ndc[i];
        const s = b.streak;
        if (s) {
          if (b.antiSolarTail) {
            away.subVectors(worldPos, lightVec).normalize();
            const sx = away.x * (halfHeightPx / Math.max(30, d));
            const sy = -away.y * (halfHeightPx / Math.max(30, d));
            const ang = Math.atan2(-sy, -sx);
            const len = b.radius * 26;
            s.mesh.visible = true;
            s.mesh.rotation.z = ang;
            s.mesh.scale.set(len, b.radius * 4.2, 1);
            s.mesh.position.set(-Math.cos(ang) * len * 0.5, -Math.sin(ang) * len * 0.5, -0.1);
            s.op.value = 0.3 * appear;
          } else if (!p.ok || step <= 0) {
            s.mesh.visible = false;
          } else {
            const vx = ((cx - p.x) / step) * halfHeightPx * camera.aspect;
            const vy = ((cy - p.y) / step) * halfHeightPx;
            vel[i] += (Math.hypot(vx, vy) - vel[i]) * Math.min(1, step * 10);
            const len = Math.min(b.radius * 22, vel[i] * opts.shutter);
            if (len > 2.5) {
              const ang = Math.atan2(-vy, -vx);
              s.mesh.visible = true;
              s.mesh.rotation.z = ang;
              s.mesh.scale.set(len, b.radius * 1.3, 1);
              s.mesh.position.set(-Math.cos(ang) * len * 0.5, -Math.sin(ang) * len * 0.5, -0.1);
              s.op.value = Math.min(0.4, len / (b.radius * 60)) * appear;
            } else {
              s.mesh.visible = false;
            }
          }
        }
        p.x = cx;
        p.y = cy;
        p.ok = true;
      }
    },
    dispose() {
      for (const b of bodies) {
        b.root.removeFromParent();
        b.frame.removeFromParent();
      }
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
