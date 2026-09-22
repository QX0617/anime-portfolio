// ── 星海场景：滚动 = 向前穿越，各层按自己的速度循环回收（无限、无缝）
//
// 性能契约（勿回退）：
// 1) 纵深回绕一律放在着色器里（GPU 侧 mod 取模），前端每帧只推一个"已飞行距离"；
//    星屑/光尘/星云加到几千个也不掉帧——绝不要改成逐帧在 JS 里改顶点或重建几何体。
// 2) 回绕必须发生在看不见的地方（相机后方 + 远平面附近），两端淡入淡出是配套手段。
// 3) CPU 侧只更新十几个对象（流星、天穹层的月亮/卫星/低云），这个数量级不能涨。
// 4) 推进量只由"滚动位置"决定（可逆、按可滚动范围归一化并夹紧），不做时间累积式单向飞行。
import type * as ThreeNS from "three";
import {
  CLOUD_FRAG,
  CLOUD_VERT,
  METEOR_FRAG,
  METEOR_VERT,
  RIBBON_FRAG,
  RIBBON_VERT,
  STAR_FRAG,
  STAR_VERT,
} from "@/lib/three-shaders";
import { createSkyDome } from "@/lib/sky-dome";

type ThreeModule = typeof import("three");

const CAMERA_Z = 18;
const FOV = 58;
const STAR_RANGE = 260;
const DUST_RANGE = 150;
const CLOUD_RANGE = 330;
const RIBBON_RANGE = 420;
const SHAPE_RANGE = 180;
/** 滑完一整页对应的飞行距离（世界单位） */
const PAGE_TRAVEL = 2400;

/** 大面积柔光：只提亮不遮底 → 加色混合 */
const GLOW = [0xf58cbe, 0xbf86e8, 0x74b8e8, 0x7ad3b8] as const;
/**
 * 星屑色：发光体本身。真实星的色差只是「偏冷 / 偏暖」，不是粉紫青；
 * 配合加色混合与黄昏底，白芯 + 淡彩晕才读得出「亮」而不是「黑点」或「纸屑」。
 */
const STAR = [0xffffff, 0xdce8ff, 0xfff0d6, 0xe4dcff] as const;
/**
 * 深色结构色：只给几何体线框与流星用 —— 它们靠明度差读出轮廓，越深越清楚。
 */
const DEEP = [0xa81f6b, 0x5b3bbd, 0x1f5fa8, 0x0d7a63] as const;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};
const wrapZ = (value: number, range: number) => (((value % range) + range) % range) - range * 0.5;
/**
 * 悬浮几何体专用的纵深衰减：中段是一条平台期（全程清晰），
 * 只在极近与极远收掉 —— 它们是背景里唯一「看得出形状」的主体，不能中途淡没了。
 */
const shapeFade = (distance: number, range: number) =>
  smoothstep(0.4, 5, distance) * (1 - smoothstep(range * 0.72, range * 0.95, distance));

interface StarLayerOptions {
  count: number;
  range: number;
  xSpread: number;
  ySpread: number;
  speedMin: number;
  speedMax: number;
  /** 星点屏幕直径区间（CSS 像素）；实际取值按星等幂律落在区间内，亮星极稀 */
  sizeMin: number;
  sizeMax: number;
  opacity: number;
  /** 是否把大部分粒子压进一条斜向密带（银河） */
  banded: boolean;
}

interface ShapeItem {
  mesh: ThreeNS.Group;
  faceMaterial: ThreeNS.MeshBasicMaterial;
  lineMaterial: ThreeNS.MeshBasicMaterial;
  baseX: number;
  baseY: number;
  baseZ: number;
  speed: number;
  range: number;
  spinX: number;
  spinY: number;
  phase: number;
  bob: number;
  baseOpacity: number;
}

interface MeteorItem {
  mesh: ThreeNS.Mesh;
  material: ThreeNS.ShaderMaterial;
  angle: number;
  speed: number;
  life: number;
  age: number;
  wait: number;
  baseOpacity: number;
}

export function createThreeScene(
  THREE: ThreeModule,
  host: HTMLElement,
  isHidden?: () => boolean
): () => void {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = window.matchMedia("(max-width: 767px)").matches;

  const scene = new THREE.Scene();
  const world = new THREE.Group();
  scene.add(world);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 900);
  camera.position.set(0, 0, CAMERA_Z);
  // 天穹层是相机的子节点，相机必须在场景图里才会被遍历到
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    // 细线框不开抗锯齿会全是锯齿，远看像噪点 —— 这是「清晰」的前提
    antialias: !isMobile,
    powerPreference: "high-performance",
  });
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  host.appendChild(canvas);

  const disposables: { dispose: () => void }[] = [];
  function keep<T extends { dispose: () => void }>(item: T): T {
    disposables.push(item);
    return item;
  }

  const travelUniforms: { value: number }[] = [];
  const timeUniforms: { value: number }[] = [];
  const pxUniforms: { value: number }[] = [];
  const hueUniforms: { value: number }[] = [];

  // ── 星屑 / 光尘：一次 draw call，纵深回绕全在着色器里
  function createStarLayer(opts: StarLayerOptions): ThreeNS.Points {
    const positions = new Float32Array(opts.count * 3);
    const sizes = new Float32Array(opts.count);
    const hues = new Float32Array(opts.count);
    const phases = new Float32Array(opts.count);
    const speeds = new Float32Array(opts.count);
    const tints = new Float32Array(opts.count);
    const twinkles = new Float32Array(opts.count);
    const theta = 0.52; // 银河密带的倾角
    const ct = Math.cos(theta);
    const st = Math.sin(theta);

    for (let i = 0; i < opts.count; i++) {
      const i3 = i * 3;
      let x: number;
      let y: number;
      if (opts.banded && i % 100 < 72) {
        const along = rand(-1, 1) * opts.xSpread * 1.35;
        // 四个随机数之和 ≈ 正态：真实银河是中心密、两翼淡的带，不是等宽粗条
        let side = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * opts.ySpread * 0.3;
        // 尘埃暗带：带心一侧的一窄条把星挤开，形成银河被劈开的观感
        const lane = opts.ySpread * 0.09;
        if (Math.abs(side - lane) < opts.ySpread * 0.035) side *= 2.4;
        x = ct * along - st * side;
        y = st * along + ct * side;
      } else {
        x = rand(-opts.xSpread, opts.xSpread);
        y = rand(-opts.ySpread, opts.ySpread);
      }
      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = rand(0, opts.range);
      // 星等 → 屏幕直径（CSS 像素）。肉眼星等是幂律分布：绝大多数只有 1~1.5px，
      // 亮星极稀（全天 1 等星只有约 19 颗），绝不该出现 15~20px 的光斑。
      const mag = Math.pow(Math.random(), 2.4);
      sizes[i] = opts.sizeMin + mag * mag * (opts.sizeMax - opts.sizeMin);
      // 暗光下视杆细胞不辨色：只有最亮约 7% 允许带色偏
      tints[i] = mag > 0.93 ? 0.35 : 0;
      // 闪烁只属于一部分星，其余保持稳定
      twinkles[i] = Math.random() < 0.4 ? 1 : 0;
      if (i % 1400 === 0) {
        // 几颗「行星」：更亮、带明显色偏，但完全不闪 —— 面源会把抖动平均掉
        sizes[i] = 5.2;
        tints[i] = 0.55;
        twinkles[i] = 0;
      }
      hues[i] = Math.random();
      phases[i] = Math.random();
      speeds[i] = rand(opts.speedMin, opts.speedMax);
    }

    const geometry = keep(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.Float32BufferAttribute(sizes, 1));
    geometry.setAttribute("aHue", new THREE.Float32BufferAttribute(hues, 1));
    geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(phases, 1));
    geometry.setAttribute("aSpeed", new THREE.Float32BufferAttribute(speeds, 1));
    geometry.setAttribute("aTint", new THREE.Float32BufferAttribute(tints, 1));
    geometry.setAttribute("aTwink", new THREE.Float32BufferAttribute(twinkles, 1));

    const uTravel = { value: 0 };
    const uTime = { value: 0 };
    const uPx = { value: 1 };
    const uHueShift = { value: 0 };
    const material = keep(
      new THREE.ShaderMaterial({
        uniforms: {
          uTravel,
          uTime,
          uPx,
          uHueShift,
          uRange: { value: opts.range },
          uOpacity: { value: opts.opacity },
          uC1: { value: new THREE.Color(STAR[0]) },
          uC2: { value: new THREE.Color(STAR[1]) },
          uC3: { value: new THREE.Color(STAR[2]) },
          uC4: { value: new THREE.Color(STAR[3]) },
        },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        // 星是光源：加色混合才能在黄昏底上「加出亮」。普通混合在近白区会被当成暗点
        blending: THREE.AdditiveBlending,
      })
    );

    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false; // 位置由着色器回绕，包围盒不再可信
    world.add(points);
    travelUniforms.push(uTravel);
    timeUniforms.push(uTime);
    pxUniforms.push(uPx);
    hueUniforms.push(uHueShift);
    return points;
  }

  // ── 星云光团 / 远景发光体：大尺度柔光，加色混合只提亮不遮底
  function createCloud(opts: {
    geometry: ThreeNS.PlaneGeometry;
    x: number;
    y: number;
    width: number;
    height: number;
    range: number;
    speed: number;
    phase: number;
    opacity: number;
    soft: number;
    colorA: number;
    colorB: number;
    seed: number;
  }): void {
    const uTravel = { value: 0 };
    const uTime = { value: 0 };
    const material = keep(
      new THREE.ShaderMaterial({
        uniforms: {
          uTravel,
          uTime,
          uSpeed: { value: opts.speed },
          uPhase: { value: opts.phase },
          uRange: { value: opts.range },
          uColorA: { value: new THREE.Color(opts.colorA) },
          uColorB: { value: new THREE.Color(opts.colorB) },
          uOpacity: { value: opts.opacity },
          uSoft: { value: opts.soft },
          uSeed: { value: opts.seed },
        },
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    const mesh = new THREE.Mesh(opts.geometry, material);
    mesh.position.set(opts.x, opts.y, 0);
    mesh.scale.set(opts.width, opts.height, 1);
    mesh.frustumCulled = false;
    world.add(mesh);
    travelUniforms.push(uTravel);
    timeUniforms.push(uTime);
  }

  // ── 极光带：顶点起伏的大平面，加色混合铺在星云之下
  function createRibbons(geometry: ThreeNS.PlaneGeometry): void {
    const configs = [
      { y: 6.5, tilt: -0.2, amp: 2.0, freq: 0.18, speed: 0.3, phase: 0, colorA: GLOW[0], colorB: GLOW[1], opacity: 0.2 },
      { y: -5.0, tilt: 0.16, amp: 1.6, freq: 0.24, speed: 0.42, phase: 150, colorA: GLOW[2], colorB: GLOW[3], opacity: 0.17 },
      { y: 0.8, tilt: -0.08, amp: 1.3, freq: 0.3, speed: 0.56, phase: 270, colorA: GLOW[1], colorB: GLOW[2], opacity: 0.12 },
    ].slice(0, isMobile ? 2 : 3);

    for (const cfg of configs) {
      const uTravel = { value: 0 };
      const uTime = { value: 0 };
      const material = keep(
        new THREE.ShaderMaterial({
          uniforms: {
            uTravel,
            uTime,
            uSpeed: { value: cfg.speed },
            uPhase: { value: cfg.phase },
            uRange: { value: RIBBON_RANGE },
            uAmp: { value: cfg.amp },
            uFreq: { value: cfg.freq },
            uColorA: { value: new THREE.Color(cfg.colorA) },
            uColorB: { value: new THREE.Color(cfg.colorB) },
            uOpacity: { value: cfg.opacity },
          },
          vertexShader: RIBBON_VERT,
          fragmentShader: RIBBON_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        })
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(0, cfg.y, 0);
      mesh.rotation.z = cfg.tilt;
      mesh.frustumCulled = false;
      world.add(mesh);
      travelUniforms.push(uTravel);
      timeUniforms.push(uTime);
    }
  }

  // ── 悬浮几何体：数量少，CPU 侧回绕 + 两端淡出
  const shapes: ShapeItem[] = [];
  function createShapes(): void {
    const geometries = [
      keep(new THREE.IcosahedronGeometry(1.5, 0)),
      keep(new THREE.TorusGeometry(1.25, 0.4, 10, 28)),
      keep(new THREE.OctahedronGeometry(1.6, 0)),
      keep(new THREE.TorusKnotGeometry(0.95, 0.3, 72, 8)),
      keep(new THREE.DodecahedronGeometry(1.4, 0)),
    ];
    // 几何体只当「远处的点缀物」，一旦数量上到两位数就会抢走星野的主体地位
    const count = isMobile ? 2 : 3;
    for (let i = 0; i < count; i++) {
      const geo = geometries[i % geometries.length];
      // 双层：实心半透明面给体积，锐利线框给轮廓。浅底上只画线框会看不见
      const faceMaterial = keep(
        new THREE.MeshBasicMaterial({
          color: DEEP[i % DEEP.length],
          transparent: true,
          opacity: 0.06,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      const lineMaterial = keep(
        new THREE.MeshBasicMaterial({
          color: DEEP[i % DEEP.length],
          wireframe: true,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
        })
      );
      const face = new THREE.Mesh(geo, faceMaterial);
      const line = new THREE.Mesh(geo, lineMaterial);
      face.renderOrder = 0; // 固定顺序：面先画、线后画，避免共面互相盖住
      line.renderOrder = 1;
      const mesh = new THREE.Group();
      mesh.add(face, line);
      mesh.scale.setScalar(rand(0.35, 0.8));
      mesh.frustumCulled = false;
      world.add(mesh);
      shapes.push({
        mesh,
        faceMaterial,
        lineMaterial,
        baseX: rand(-46, 46),
        baseY: rand(-30, 30),
        baseZ: rand(0, SHAPE_RANGE),
        speed: rand(0.3, 0.85),
        range: SHAPE_RANGE,
        spinX: rand(-0.25, 0.25),
        spinY: rand(-0.32, 0.32),
        phase: rand(0, Math.PI * 2),
        bob: rand(0.6, 2.2),
        baseOpacity: rand(0.14, 0.26),
      });
    }
  }

  // ── 流星：自主出现，带拖尾，间隔与方向都随机
  const meteors: MeteorItem[] = [];
  function createMeteors(geometry: ThreeNS.PlaneGeometry): void {
    const count = isMobile ? 2 : 4;
    for (let i = 0; i < count; i++) {
      const material = keep(
        new THREE.ShaderMaterial({
          uniforms: {
            uOpacity: { value: 0 },
            uColor: { value: new THREE.Color(DEEP[i % DEEP.length]) },
          },
          vertexShader: METEOR_VERT,
          fragmentShader: METEOR_FRAG,
          transparent: true,
          depthWrite: false,
          blending: THREE.NormalBlending,
          side: THREE.DoubleSide,
        })
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.scale.set(rand(9, 20), rand(0.5, 1.0), 1);
      mesh.visible = false;
      mesh.frustumCulled = false;
      world.add(mesh);
      meteors.push({
        mesh,
        material,
        angle: -0.45,
        speed: 40,
        life: 1.6,
        age: -1,
        // 错开首次出场，避免同时亮起
        wait: rand(0.6, 5.5),
        baseOpacity: rand(0.5, 0.85),
      });
    }
  }

  // ── 组装各层（移动端整体降载）
  // 极光带与线框多面体已停用：真实夜空里没有这类元素，且它们会把画面主体从星野抢走
  // （线框 0.8 不透明 + 14 颗时，观感直接变成「漂浮几何体」。要回旧效果恢复这两行即可）
  // createRibbons(keep(new THREE.PlaneGeometry(64, 22, 48, 16)));
  const cloudGeometry = keep(new THREE.PlaneGeometry(1, 1));
  const cloudCount = isMobile ? 2 : 4;
  for (let i = 0; i < cloudCount; i++) {
    createCloud({
      geometry: cloudGeometry,
      x: rand(-95, 95),
      y: rand(-58, 58),
      width: rand(70, 165),
      height: rand(55, 130),
      range: CLOUD_RANGE,
      speed: rand(0.1, 0.32),
      phase: rand(0, CLOUD_RANGE),
      opacity: rand(0.05, 0.09), // 星云只是陪衬：压低它才能把星点的对比让出来
      soft: rand(2.4, 3.6),
      colorA: GLOW[i % GLOW.length],
      colorB: GLOW[(i + 2) % GLOW.length],
      seed: rand(0, 40),
    });
  }
  const anchorCount = isMobile ? 1 : 2;
  for (let i = 0; i < anchorCount; i++) {
    createCloud({
      geometry: cloudGeometry,
      x: i === 0 ? rand(-80, -46) : rand(46, 84),
      y: i === 0 ? rand(-36, -14) : rand(16, 40),
      width: 40,
      height: 40,
      range: CLOUD_RANGE,
      speed: 0.06,
      phase: rand(0, CLOUD_RANGE),
      opacity: 0.08,
      soft: 5.4, // 远景发光体收紧，避免大块糊面
      colorA: GLOW[(i + 1) % GLOW.length],
      colorB: GLOW[(i + 3) % GLOW.length],
      seed: rand(0, 40),
    });
  }
  createStarLayer({
    count: isMobile ? 2600 : 9000,
    range: STAR_RANGE,
    xSpread: 120,
    ySpread: 72,
    speedMin: 0.55,
    speedMax: 1.5,
    // 绝大多数星 2px 上下，最亮一档到 8px；仍远小于「光斑」区间
    sizeMin: 1.9,
    sizeMax: 8.2,
    opacity: 1,
    banded: true,
  });
  createStarLayer({
    count: isMobile ? 1100 : 3600,
    range: DUST_RANGE,
    xSpread: 80,
    ySpread: 46,
    speedMin: 1.0,
    speedMax: 2.4,
    sizeMin: 1.6,
    sizeMax: 3.6,
    opacity: 0.72,
    banded: false,
  });
  // createShapes(); // 同上，几何体停用
  createMeteors(keep(new THREE.PlaneGeometry(1, 1)));

  // 天穹层：月亮 / 卫星过境 / 低空云带 —— 挂在相机上，视为无限远
  const dome = createSkyDome(THREE, { isMobile, reduceMotion, px: renderer.getPixelRatio() });
  camera.add(dome.group);

  // ── 滚动 → 穿越（可逆：只由滚动位置决定）
  let travel = 0;
  let travelTarget = 0;
  let rise = 0;
  let riseTarget = 0;
  let pointerX = 0;
  let pointerY = 0;
  let pointerTargetX = 0;
  let pointerTargetY = 0;

  function readScroll(): void {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, window.scrollY / max));
    travelTarget = progress * PAGE_TRAVEL;
    riseTarget = progress * 7;
  }

  let elapsed = 0;

  function pose(step: number): void {
    const travelK = 1 - Math.exp(-step * 6);
    const pointerK = 1 - Math.exp(-step * 4);
    travel += (travelTarget - travel) * travelK;
    rise += (riseTarget - rise) * travelK;
    pointerX += (pointerTargetX - pointerX) * pointerK;
    pointerY += (pointerTargetY - pointerY) * pointerK;

    for (const u of travelUniforms) u.value = travel;
    for (const u of timeUniforms) u.value = elapsed;
    const hue = Math.sin(elapsed * 0.021) * 0.24; // 自主变化：色相极缓慢漂移
    for (const u of hueUniforms) u.value = hue;

    world.position.y = rise + Math.sin(travel * 0.0038) * 1.8;
    world.position.x = Math.sin(travel * 0.0024) * 2.6;
    world.rotation.z = Math.sin(travel * 0.0015) * 0.04;

    // 鼠标视差：**平移相机**而不是旋转世界。
    // 旋转会让远处物体位移更大（和视差相反），平移才会近大远小地错开，
    // 这才是真正的“空间感”；顺带留一点点旋转当作“轻微转头”。
    camera.position.x = pointerX * 0.78;
    camera.position.y = -pointerY * 0.5;
    world.rotation.y = pointerX * 0.02;
    world.rotation.x = -pointerY * 0.012;

    dome.update(step, elapsed, camera.aspect, pointerX, pointerY, travel);

    for (const item of shapes) {
      const z = wrapZ(item.baseZ + travel * item.speed, item.range);
      item.mesh.position.set(
        item.baseX,
        item.baseY + Math.sin(elapsed * 0.35 + item.phase) * item.bob,
        z
      );
      item.mesh.rotation.x = elapsed * item.spinX;
      item.mesh.rotation.y = elapsed * item.spinY;
      const opacity = shapeFade(CAMERA_Z - z, item.range);
      item.lineMaterial.opacity = item.baseOpacity * opacity;
      item.faceMaterial.opacity = item.baseOpacity * 0.16 * opacity;
      item.mesh.visible = opacity > 0.01;
    }

    for (const meteor of meteors) {
      if (meteor.age < 0) {
        meteor.wait -= step;
        if (meteor.wait > 0) {
          meteor.mesh.visible = false;
          continue;
        }
        meteor.age = 0;
        meteor.life = rand(1.1, 2.0);
        meteor.speed = rand(28, 62);
        meteor.angle = rand(-0.62, -0.3);
        meteor.mesh.rotation.z = meteor.angle;
        meteor.mesh.position.set(rand(-72, 40), rand(8, 46), rand(-26, -3));
        meteor.mesh.visible = true;
      }
      meteor.age += step;
      const progress = meteor.age / meteor.life;
      if (progress >= 1) {
        meteor.age = -1;
        meteor.wait = rand(1.4, 5.2);
        meteor.mesh.visible = false;
        continue;
      }
      meteor.mesh.position.x += Math.cos(meteor.angle) * meteor.speed * step;
      meteor.mesh.position.y += Math.sin(meteor.angle) * meteor.speed * step;
      meteor.material.uniforms.uOpacity.value = meteor.baseOpacity * Math.sin(Math.PI * progress);
    }
  }

  function resize(): void {
    const width = Math.max(1, host.clientWidth || window.innerWidth);
    const height = Math.max(1, host.clientHeight || window.innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // 星点尺寸只由星等决定（CSS 像素），这里只需要像素比做换算。
    // 不再用透视投影系数 —— 按 1/纵深 放大正是把近处星撑成 20~50px 光斑的来源。
    const px = renderer.getPixelRatio();
    for (const u of pxUniforms) u.value = px;
    readScroll();
    if (reduceMotion) {
      pose(0);
      renderer.render(scene, camera);
    }
  }

  const onPointerMove = (event: PointerEvent): void => {
    pointerTargetX = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
    pointerTargetY = (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
  };
  const onContextLost = (event: Event): void => {
    // 上下文丢失：只移除自己，页面回到 CSS 炫彩渐变
    event.preventDefault();
    canvas.style.visibility = "hidden";
  };

  let raf = 0;
  let pending = 0;
  const minDelta = 1 / (isMobile ? 30 : 45);
  const clock = new THREE.Clock();

  function frame(): void {
    raf = requestAnimationFrame(frame);
    const delta = Math.min(clock.getDelta(), 0.2);
    if (document.hidden) return; // 后台标签页停绘
    if (isHidden?.()) return; // 天空滚出首屏后停绘
    pending += delta;
    if (pending < minDelta) return; // 帧率上限：省电
    const step = pending;
    pending = 0;
    elapsed += step;
    pose(step);
    renderer.render(scene, camera);
  }

  window.addEventListener("resize", resize);
  canvas.addEventListener("webglcontextlost", onContextLost);
  const bodyObserver = new ResizeObserver(() => readScroll());
  bodyObserver.observe(document.body);
  if (!reduceMotion) {
    window.addEventListener("scroll", readScroll, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
  }

  resize();
  readScroll();
  if (reduceMotion) {
    pose(0);
    renderer.render(scene, camera);
  } else {
    raf = requestAnimationFrame(frame);
  }

  return () => {
    cancelAnimationFrame(raf);
    bodyObserver.disconnect();
    window.removeEventListener("resize", resize);
    window.removeEventListener("scroll", readScroll);
    window.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    dome.dispose();
    for (const item of disposables) {
      try {
        item.dispose();
      } catch {
        // 释放失败不影响卸载
      }
    }
    renderer.dispose();
    canvas.remove();
  };
}
