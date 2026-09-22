/**
 * 天穹层：月亮、卫星过境、低空云带，以及远处天体（星系 / 带环行星 / 星团）。
 *
 * 三个分组，运动规则不同：
 * - wheel：绕视轴缓慢**轮转**（远处的星系、星团、行星整片一起转）。
 * - moonArm：只有月亮和它的光晕。**不跟着轮转**，而是自己沿一道弧缓慢横越天空 ——
 *   挂在轮转组里时它的位移是「绕屏幕中心画圆」，滚一整页才偏 16°，看着就是钉死的。
 * - horizon：低云与卫星，走自己的直线。
 *
 * 从属约束：所有新增天体都是「远处 faint 元素」，尺寸与亮度都压在月亮以下；
 * 月亮是画面唯一的强锚点。这条是上一轮「像多边体」的教训。
 * 但月亮本身不能是硬边白盘 —— 那正是「贴图」的来源，边缘要羽化、暗面要掺天空色。
 */
import { CLOUD_FRAG, CLOUD_VERT } from "./three-shaders";

type ThreeNS = typeof import("three");

const DOME_Z = 60;
const FOV = 58;
const WHEEL_SPIN = 0.00012; // 每世界单位 travel 对应的轮转弧度
const IDLE_SPIN = 0.0016; // 不滚动时的自转（rad/s）
/** 月亮的相位初值：右上方 */
const MOON_ANG0 = 0.62;
/** 滚动驱动：每世界单位 travel 推进的弧度（滚一屏 ≈ 走 30°，横越大半个天空） */
const MOON_TRAVEL = 0.0011;
/** 不滚动时的缓慢推进：约 4% 屏宽 / 分钟，盯一会儿看得出在走，读正文时不抢戏 */
const MOON_IDLE = 0.0025;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const MOON_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec2 uSun;
uniform vec3 uSky;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  // 硬裁一个圆就是「贴纸」：边缘羽化，月面外再留一层大气散射
  float disc = 1.0 - smoothstep(0.86, 1.0, r);
  float scatter = exp(-pow(max(0.0, r - 0.88) / 0.36, 2.0)) * 0.14;
  float rr = min(r, 0.999);
  float z = sqrt(1.0 - rr * rr);
  vec3 n = normalize(vec3(p.x, p.y, z));
  float lam = dot(n, normalize(vec3(uSun, 0.42)));
  float lit = smoothstep(-0.14, 0.2, lam);
  float maria = smoothstep(0.44, 0.66, noise(n.xy * 1.7 + 3.1));
  float grain = noise(n.xy * 5.2) * 0.5 + noise(n.xy * 13.0) * 0.5;
  vec3 surf = mix(vec3(0.9, 0.87, 0.82), vec3(0.6, 0.6, 0.66), maria * 0.62);
  surf *= 0.86 + 0.18 * grain;
  // 暗面掺天空色：夜里看月亮，背光那侧本来就该被天空「吃掉」一部分
  vec3 col = mix(surf, uSky, (1.0 - lit) * 0.55);
  float limb = pow(z, 0.42);
  float earthshine = 0.06 * (1.0 - lit);
  float a = clamp((lit + earthshine) * disc * 0.94 + scatter, 0.0, 1.0);
  gl_FragColor = vec4(col * (0.76 + 0.24 * lit) * limb, a * uOpacity);
}`;

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

/** 带环行星：球体明暗 + 条纹云带 + 压扁的环（含环缝） */
const PLANET_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float ry = length(vec2(p.x, p.y * 3.1));
  float ring = smoothstep(1.18, 1.24, ry) * (1.0 - smoothstep(1.78, 1.86, ry));
  ring *= 0.55 + 0.45 * step(0.42, fract(ry * 7.4)); // 环缝
  float r = length(p);
  float disc = 1.0 - smoothstep(0.97, 1.0, r);
  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 n = normalize(vec3(p.x, p.y, z));
  float lit = smoothstep(-0.3, 0.55, dot(n, normalize(vec3(-0.55, 0.32, 0.72))));
  float bands = 0.8 + 0.2 * sin(p.y * 16.0 + 0.6);
  vec3 col = uColor * bands;
  float a = (disc * (0.22 + 0.78 * lit) + ring * 0.5) * uOpacity;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

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
  const wheel = new THREE.Group();
  const moonArm = new THREE.Group();
  const horizon = new THREE.Group();
  group.add(wheel, moonArm, horizon);
  group.position.z = -DOME_Z;

  const trash: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T): T => (trash.push(x), x);
  const quad = keep(new THREE.PlaneGeometry(1, 1));
  const viewH = 2 * DOME_Z * Math.tan((FOV * Math.PI) / 360);

  const mat = (fragmentShader: string, uniforms: Record<string, { value: unknown }>, additive = true) =>
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

  // ── 月亮：唯一强锚点。位置每帧自己算（见 update），不参与轮转
  const moonMat = mat(
    MOON_FRAG,
    {
      uOpacity: { value: 0.86 },
      uSun: { value: new THREE.Vector2(-0.42, 0.3) },
      uSky: { value: new THREE.Color(0x2a2f6b) },
    },
    false
  );
  const moon = new THREE.Mesh(quad, moonMat);
  moon.scale.setScalar(viewH * 0.042);
  moon.position.set(viewH * 0.24, viewH * 0.23, 0);
  moonArm.add(moon);

  const haloMat = mat(GLOW_FRAG, {
    uOpacity: { value: 0.15 },
    uPow: { value: 2.9 },
    uColor: { value: new THREE.Color(0xdbe0ff) },
  });
  const halo = new THREE.Mesh(quad, haloMat);
  halo.scale.setScalar(viewH * 0.19);
  halo.position.copy(moon.position);
  moonArm.add(halo);

  // ── 远处天体
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

  const planet = new THREE.Mesh(
    quad,
    mat(PLANET_FRAG, {
      uOpacity: { value: 0.8 },
      uColor: { value: new THREE.Color(0xf0d8b0) },
    })
  );
  planet.scale.setScalar(viewH * 0.026);
  planet.position.set(-viewH * 0.16, viewH * 0.31, -1);
  planet.rotation.z = 0.22;
  wheel.add(planet);

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

  // ── 卫星：缓慢直线横穿，亮度因翻滚起伏
  const sats = Array.from({ length: opts.isMobile ? 1 : 2 }, (_, i) => {
    const m = mat(DOT_FRAG, { uOpacity: { value: 0 } });
    const mesh = new THREE.Mesh(quad, m);
    mesh.scale.setScalar(viewH * 0.007);
    horizon.add(mesh);
    return { mesh, m, t: i * 0.37, speed: 0.021 + i * 0.008, y: 0.2 + i * 0.3, phase: i * 2.1 };
  });

  // ── 低空云带：贴住地平线天光，给天空一个「地面」
  const clouds = Array.from({ length: 2 }, (_, i) => {
    const m = mat(CLOUD_FRAG, {
      uTravel: { value: 0 },
      uSpeed: { value: 0 },
      uPhase: { value: i * 40 + 12 },
      uRange: { value: 200 },
      uTime: { value: 0 },
      uSeed: { value: i * 3.7 },
      uSoft: { value: 1.5 },
      uOpacity: { value: i === 0 ? 0.13 : 0.09 },
      uColorA: { value: new THREE.Color(i === 0 ? 0xf6d9ea : 0xdfe4ff) },
      uColorB: { value: new THREE.Color(i === 0 ? 0xd9e6ff : 0xf3e2ff) },
    });
    const mesh = new THREE.Mesh(quad, m);
    mesh.scale.set(viewH * (1.5 + i * 0.5), viewH * (0.16 + i * 0.05), 1);
    // CLOUD_VERT 按 -mv.z 做纵深淡出，z 只能给小的正偏移，否则整层被淡没
    mesh.position.set(0, -viewH * (0.3 - i * 0.07), 2 + i * 4);
    horizon.add(mesh);
    return { mesh, m, drift: (i === 0 ? 1 : -0.7) * 0.5 };
  });

  let spin = 0;

  return {
    group,
    update(step, elapsed, aspect, pointerX, pointerY, travel) {
      const w = viewH * aspect;
      // 整片天穹缓慢轮转：滚动驱动为主，不滚动也有极慢自转 —— 月亮因此「自己会动」
      if (!opts.reduceMotion) spin += step * IDLE_SPIN;
      wheel.rotation.z = -(spin + travel * WHEEL_SPIN);

      group.position.x = -pointerX * viewH * 0.012;
      group.position.y = pointerY * viewH * 0.012 - viewH * 0.14;

      // 月亮沿一道弧缓慢横越天空：滚动是主驱动（滚一屏 ≈ 30°），不滚动时自己继续爬。
      // 用 sin/cos 而不是线性累加，角度越界也不会突然跳回或飘出画面。
      const ang = MOON_ANG0 + travel * MOON_TRAVEL + elapsed * MOON_IDLE;
      moon.position.set(
        w * 0.3 * Math.cos(ang),
        viewH * (0.13 + 0.17 * Math.sin(ang)),
        0
      );
      halo.position.copy(moon.position);

      // 月相缓慢变化：光照方向随时间转，明暗界线会一点点移动
      const sunA = 0.62 + elapsed * 0.012;
      moonMat.uniforms.uSun.value.set(Math.cos(sunA) * 0.62, Math.sin(sunA) * 0.4);
      haloMat.uniforms.uOpacity.value = 0.13 + 0.04 * Math.sin(elapsed * 0.07);

      for (const g of galaxies) g.m.uniforms.uTime.value = elapsed;
      clusterMat.uniforms.uPx.value = opts.px;

      for (const s of sats) {
        if (!opts.reduceMotion) s.t += step * s.speed;
        const t = s.t % 1.35;
        if (t > 1.1) {
          s.m.uniforms.uOpacity.value = 0;
          s.mesh.visible = false;
          continue;
        }
        s.mesh.visible = true;
        const fade = Math.min(1, Math.min(t, 1.1 - t) / 0.12);
        s.mesh.position.set(-w * 0.62 + t * w * 1.24, viewH * s.y, 0.1);
        s.m.uniforms.uOpacity.value = 0.7 * fade * (0.72 + 0.28 * Math.sin(elapsed * 1.9 + s.phase));
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
