// 星海各层的 GLSL。
//
// 契约（与 lib/three-scene.ts 的 uniform 一一对应，改任一侧必须同步）：
// - 纵深回绕全在顶点着色器里用 mod 完成，JS 每帧只推 uTravel 一个值。
// - 回绕点必须落在看不见的地方：靠 vFade 在相机后方与远平面附近淡出。
// - **星点是光源不是圆面**：肉眼永远分辨不出恒星圆面（极限约 1′，最大的参宿四也只有 0.04″），
//   所以尺寸只由星等决定（aSize = CSS 像素），**不再随纵深 1/d 放大**——
//   一旦按透视放大，近处星就变成 20~50px 的光斑，正是「糊」与「不像星空」的根因。
// - 加色混合：星要「亮过底」，底必须比星暗（见 ThreeBackground.tsx 的黄昏底）。
// - 闪烁只给一部分星，幅度随仰角降低而增大（大气路径更长），频率 0.2~1.2Hz 量级。

/** 星屑 / 光尘：一次 draw call 画几千颗，纵深循环 + 星等定尺寸 + 随仰角消光与闪烁 */
export const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aHue;
attribute float aPhase;
attribute float aSpeed;
attribute float aTint;
attribute float aTwink;
uniform float uTravel;
uniform float uTime;
uniform float uPx;
uniform float uRange;
varying float vFade;
varying float vHue;
varying float vTint;
varying float vTwAmp;
varying float vTwRate;
varying float vRay;
varying float vFar;
void main() {
  vec3 p = position;
  // 走满 uRange 就从最远处重新开始：永远滑不到头
  p.z = mod(position.z + uTravel * aSpeed, uRange) - uRange * 0.5;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  float d = -(modelViewMatrix * vec4(p, 1.0)).z;
  vFade = smoothstep(1.5, 9.0, d) * (1.0 - smoothstep(uRange * 0.42, uRange * 0.56, d));

  // 画面下方 = 地平线方向：大气路径更长 → 更暗（消光）但更容易闪、色偏更明显
  float alt = clamp((clip.y / max(0.0001, clip.w) + 1.0) * 0.5, 0.0, 1.0);
  float secAlt = 1.0 / max(0.18, sin(alt * 1.48353));
  vFade *= mix(1.0, 0.6, clamp(secAlt - 1.0, 0.0, 1.0));
  // 朝地平线方向再多消光一点（大气路径长）。夜色底现在铺满整屏，
  // 所以这里只留一点梯度，不再把画面下方一整片抹掉。
  vFade *= mix(0.74, 1.0, smoothstep(0.05, 0.45, alt));
  vTwAmp = aTwink * min(0.3, 0.05 * pow(secAlt, 1.5));
  vTwRate = 1.2 + aPhase * 5.4;

  vHue = aHue;
  vTint = aTint;
  vFar = clamp(d / uRange, 0.0, 1.0);
  // aSize 就是目标 CSS 直径；乘像素比得到设备像素，再给一点抖动避免「全班一样大」
  float px = aSize * uPx * mix(0.9, 1.12, fract(aPhase * 7.0));
  vRay = smoothstep(15.0, 24.0, px);
  gl_PointSize = px;
  gl_Position = clip;
}`;

export const STAR_FRAG = /* glsl */ `
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
uniform float uHueShift;
uniform float uOpacity;
uniform float uTime;
varying float vFade;
varying float vHue;
varying float vTint;
varying float vTwAmp;
varying float vTwRate;
varying float vRay;
varying float vFar;
vec3 palette(float h) {
  float x = fract(h);
  vec3 c = mix(uC1, uC2, clamp(x * 3.0, 0.0, 1.0));
  c = mix(c, uC3, clamp((x - 0.33) * 1.6, 0.0, 1.0));
  c = mix(c, uC4, clamp((x - 0.66) * 3.0, 0.0, 1.0));
  return c;
}
/** 一根短光针：只在最大的几颗星上出现，长度不超过星核的 1.5 倍 */
float ray(vec2 p, float reach, float width) {
  float along = abs(p.x);
  float across = abs(p.y);
  float w = width * max(0.0, 1.0 - along / reach);
  float body = 1.0 - smoothstep(0.0, max(w, 0.0008), across);
  return body * (1.0 - smoothstep(reach * 0.5, reach, along));
}
void main() {
  vec2 uv = (gl_PointCoord - 0.5) * 2.0;
  float r = length(uv);
  if (r > 1.0) discard;

  // 高斯 PSF + 实心核：小尺寸下这就是肉眼看到的「一颗星」
  float psf = exp(-pow(r * 2.3, 2.0));
  float core = 1.0 - smoothstep(0.22, 0.62, r);
  float reach = mix(0.5, 0.28, vFar);
  float rays = max(ray(uv, reach, 0.05), ray(uv.yx, reach, 0.05)) * vRay;

  // 绝大多数星是纯白：暗光下视杆细胞不辨色，只有最亮几颗看得出蓝白 / 暖黄
  vec3 col = mix(vec3(1.0), palette(vHue + uHueShift), vTint);
  float a = clamp(core * 1.0 + psf * 0.75 + rays * 0.6, 0.0, 1.0);
  float tw = 1.0 - vTwAmp * (0.5 + 0.5 * sin(uTime * vTwRate + vHue * 6.2831));
  gl_FragColor = vec4(col, clamp(a * vFade * tw * uOpacity, 0.0, 1.0));
}`;

/** 银河雾气：大尺度低对比的雾，只用来给密带一点厚度，不再画成有亮边的「云团」 */
export const CLOUD_VERT = /* glsl */ `
uniform float uTravel;
uniform float uSpeed;
uniform float uPhase;
uniform float uRange;
varying vec2 vUv;
varying float vDepthFade;
void main() {
  vUv = uv;
  vec3 p = position;
  p.z += mod(uTravel * uSpeed + uPhase, uRange) - uRange * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vDepthFade = smoothstep(6.0, 46.0, d) * (1.0 - smoothstep(uRange * 0.40, uRange * 0.55, d));
  gl_Position = projectionMatrix * mv;
}`;

export const CLOUD_FRAG = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uOpacity;
uniform float uSoft;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
varying float vDepthFade;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
void main() {
  vec2 uv = vUv - 0.5;
  float r = length(uv) * 2.0;
  float n1 = noise(vUv * 3.4 + uSeed + vec2(uTime * 0.012, uTime * -0.008));
  float n2 = noise(vUv * 7.6 - uSeed * 1.3 + vec2(uTime * -0.02, uTime * 0.016));
  float n = n1 * 0.68 + n2 * 0.32;
  float rim = 0.74 + 0.22 * n1;
  float mask = 1.0 - smoothstep(rim * 0.86, rim, r);
  float body = pow(smoothstep(1.0, 0.0, r), uSoft * 0.5);
  float strands = 0.30 + 0.95 * pow(n, 1.3);
  // 不再画贴边亮弧：那道「轮廓」在近白底上会被读成肥皂泡
  float a = body * mask * strands * 0.85 * vDepthFade * uOpacity;
  vec3 col = mix(uColorA, uColorB, clamp(n * 1.1 + vUv.y * 0.2, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

/** 极光带：顶点起伏的大平面（当前场景已不再使用，保留着色器备用） */
export const RIBBON_VERT = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uFreq;
uniform float uTravel;
uniform float uSpeed;
uniform float uPhase;
uniform float uRange;
varying vec2 vUv;
varying float vDepthFade;
void main() {
  vUv = uv;
  vec3 p = position;
  p.z += sin(p.x * uFreq + uTime * 0.6) * cos(p.y * uFreq * 0.9 - uTime * 0.42) * uAmp;
  p.z += mod(uTravel * uSpeed + uPhase, uRange) - uRange * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vDepthFade = smoothstep(8.0, 52.0, d) * (1.0 - smoothstep(uRange * 0.40, uRange * 0.55, d));
  gl_Position = projectionMatrix * mv;
}`;

export const RIBBON_FRAG = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uOpacity;
varying vec2 vUv;
varying float vDepthFade;
void main() {
  float edgeX = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
  float edgeY = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
  float lip = exp(-pow((vUv.y - 0.70) / 0.075, 2.0));
  float stria = 0.72 + 0.28 * sin(vUv.x * 24.0 + vUv.y * 8.0);
  vec3 col = mix(uColorA, uColorB, clamp(vUv.x * 0.55 + vUv.y * 0.45, 0.0, 1.0));
  col = mix(col, vec3(1.0), lip * 0.6);
  float a = edgeX * edgeY * stria * (0.6 + 0.95 * lip) * uOpacity * vDepthFade;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

/** 流星：0 = 尾，1 = 头 */
export const METEOR_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const METEOR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float along = vUv.x; // 0 = 尾，1 = 头
  float across = 1.0 - abs(vUv.y - 0.5) * 2.0;
  float tail = pow(along, 1.55); // 拖尾更长，方向看得出来
  float slit = pow(smoothstep(0.0, 0.42, across), 1.3); // 更细的芯
  float head = exp(-pow((along - 0.93) / 0.06, 2.0)); // 头部亮点
  float a = (tail * slit * 0.85 + head * 0.95) * uOpacity;
  vec3 col = mix(uColor, vec3(1.0), head * 0.45);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;
