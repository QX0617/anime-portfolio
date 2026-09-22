/**
 * 天穹层：月亮、卫星过境、低空云带。
 *
 * 为什么单独一层并且挂在相机上：这三样都是「无限远」的锚点，不该跟星屑一起做
 * 纵深穿越（那会让月亮看起来像在飘），但又要跟着鼠标视差轻轻反向移动，
 * 所以放在相机空间里，只按指针做小量反向偏移。
 *
 * 约束：全部从属于星野 —— 月亮是唯一的强锚点，其余元素亮度都压在低位。
 */
import { CLOUD_FRAG, CLOUD_VERT } from "./three-shaders";

type ThreeNS = typeof import("three");

const DOME_Z = 60; // 天穹到相机的距离
const MOON_FRAG = /* glsl */ `
uniform float uOpacity;
uniform vec2 uSun;
varying vec2 vUv;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;
  float z = sqrt(1.0 - r * r);
  vec3 n = normalize(vec3(p.x, p.y, z));
  // 明暗界线：真实月相的过渡很柔，靠 dot 的一个窄 smoothstep 得到
  float lam = dot(n, normalize(vec3(uSun, 0.42)));
  float lit = smoothstep(-0.14, 0.2, lam);
  // 月海（大块暗斑）+ 细粒纹理，避免画成一个纯白圆盘
  float maria = smoothstep(0.44, 0.66, noise(n.xy * 1.7 + 3.1));
  float grain = noise(n.xy * 5.2) * 0.5 + noise(n.xy * 13.0) * 0.5;
  vec3 surf = mix(vec3(0.95, 0.94, 0.91), vec3(0.63, 0.64, 0.7), maria * 0.72);
  surf *= 0.84 + 0.22 * grain;
  float limb = pow(z, 0.42); // 边缘变暗，球体才立得住
  float earthshine = 0.055 * (1.0 - lit); // 暗面被地球反光照亮一点点
  float a = clamp(lit + earthshine, 0.0, 1.0) * limb;
  gl_FragColor = vec4(surf * (0.7 + 0.32 * lit), a * uOpacity);
}`;

const MOON_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPow;
varying vec2 vUv;
void main() {
  float r = length((vUv - 0.5) * 2.0);
  float a = pow(max(0.0, 1.0 - r), uPow) * uOpacity;
  gl_FragColor = vec4(uColor, a);
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

export interface SkyDome {
  group: InstanceType<ThreeNS["Group"]>;
  update: (step: number, elapsed: number, aspect: number, pointerX: number, pointerY: number) => void;
  dispose: () => void;
}

export function createSkyDome(THREE: ThreeNS, opts: { isMobile: boolean; reduceMotion: boolean }): SkyDome {
  const group = new THREE.Group();
  const trash: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(x: T): T => (trash.push(x), x);

  const quad = keep(new THREE.PlaneGeometry(1, 1));
  const viewH = 2 * DOME_Z * Math.tan((58 * Math.PI) / 360); // 相机空间里视口高度对应的世界单位

  // ── 月亮：唯一的强锚点
  const moon = new THREE.Mesh(
    quad,
    keep(
      new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: 1 }, uSun: { value: new THREE.Vector2(-0.42, 0.3) } },
        vertexShader: MOON_VERT,
        fragmentShader: MOON_FRAG,
        transparent: true,
        depthWrite: false,
      })
    )
  );
  moon.scale.setScalar(viewH * 0.046);
  moon.renderOrder = -2;
  group.add(moon);

  // 月晕：加色柔光，把月亮「接」进天空里，而不是一个贴纸
  const halo = new THREE.Mesh(
    quad,
    keep(
      new THREE.ShaderMaterial({
        uniforms: {
          uOpacity: { value: 0.3 },
          uPow: { value: 2.6 },
          uColor: { value: new THREE.Color(0xdfe6ff) },
        },
        vertexShader: MOON_VERT,
        fragmentShader: GLOW_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    )
  );
  halo.scale.setScalar(viewH * 0.3);
  halo.renderOrder = -3;
  group.add(halo);

  // ── 卫星：缓慢直线横穿，亮度因翻滚缓慢起伏
  const sats = Array.from({ length: opts.isMobile ? 1 : 2 }, (_, i) => {
    const mat = keep(
      new THREE.ShaderMaterial({
        uniforms: { uOpacity: { value: 0 } },
        vertexShader: MOON_VERT,
        fragmentShader: DOT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    const mesh = new THREE.Mesh(quad, mat);
    mesh.scale.setScalar(viewH * 0.006);
    group.add(mesh);
    return {
      mesh,
      mat,
      t: i * 0.37,
      speed: 0.021 + i * 0.008,
      y: 0.18 + i * 0.34,
      phase: i * 2.1,
    };
  });

  // ── 低空云带：贴住地平线天光，给天空一个「地面」
  const clouds = Array.from({ length: 2 }, (_, i) => {
    const mat = keep(
      new THREE.ShaderMaterial({
        uniforms: {
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
        },
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    const mesh = new THREE.Mesh(quad, mat);
    mesh.scale.set(viewH * (1.5 + i * 0.5), viewH * (0.16 + i * 0.05), 1);
    // z 只给小的正偏移：CLOUD_VERT 按 -mv.z 做纵深淡出，偏移过大（>80）会被整层淡没
    mesh.position.set(0, -viewH * (0.3 - i * 0.07), 2 + i * 4);
    mesh.renderOrder = -1;
    group.add(mesh);
    return { mesh, mat, drift: (i === 0 ? 1 : -0.7) * 0.5 };
  });

  group.position.z = -DOME_Z;
  moon.position.z = 0;
  halo.position.z = 0.2;

  return {
    group,
    update(step, elapsed, aspect, pointerX, pointerY) {
      const w = viewH * aspect;
      // 天穹跟着指针做一点点反向移动：比星屑小得多，读起来就是「无限远」
      group.position.x = -pointerX * viewH * 0.012;
      group.position.y = pointerY * viewH * 0.012 - viewH * 0.14;

      moon.position.set(w * 0.29, viewH * 0.3, 0);
      halo.position.set(w * 0.29, viewH * 0.3, 0.2);

      for (const s of sats) {
        if (!opts.reduceMotion) s.t += step * s.speed;
        const t = s.t % 1.35;
        if (t > 1.1) {
          s.mat.uniforms.uOpacity.value = 0; // 出场前后不画，避免「凭空出现」
          s.mesh.visible = false;
          continue;
        }
        s.mesh.visible = true;
        const fade = Math.min(1, Math.min(t, 1.1 - t) / 0.12);
        s.mesh.position.set(-w * 0.62 + t * w * 1.24, viewH * s.y, 0.1);
        s.mat.uniforms.uOpacity.value = 0.7 * fade * (0.72 + 0.28 * Math.sin(elapsed * 1.9 + s.phase));
      }

      for (const c of clouds) {
        c.mat.uniforms.uTime.value = elapsed;
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
