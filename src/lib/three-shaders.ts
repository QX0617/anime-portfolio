// 星海各层的 GLSL。
//
// 契约（与 lib/three-scene.ts 的 uniform 一一对应，改任一侧必须同步）：
// - 纵深回绕全在顶点着色器里用 mod 完成，JS 每帧只推 uTravel 一个值。
// - 回绕点必须落在看不见的地方：靠 vFade / vDepthFade 在相机后方与远平面附近淡出。
// - 星屑用普通混合 + 饱和色（浅色炫彩底上才有对比），只有大面积柔光才用加色混合。

/** 星屑 / 光尘：一次 draw call 画几千颗，纵深循环 + 大小分级 + 呼吸明灭 */
export const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aHue;
attribute float aPhase;
attribute float aSpeed;
uniform float uTravel;
uniform float uTime;
uniform float uScale;
uniform float uRange;
varying float vFade;
varying float vHue;
varying float vTwinkle;
varying float vFar;
varying float vRay;
void main() {
  vec3 p = position;
  // 走满 uRange 就从最远处重新开始：永远滑不到头
  p.z = mod(position.z + uTravel * aSpeed, uRange) - uRange * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vFade = smoothstep(1.5, 9.0, d) * (1.0 - smoothstep(uRange * 0.42, uRange * 0.56, d));
  vHue = aHue;
  vTwinkle = 0.62 + 0.38 * sin(uTime * 1.7 + aPhase * 6.2831);
  // 光针是「屏幕上够大」才画得出来的形态 —— 按真实像素尺寸分两级：
  // 微尘保持实心小点，只有亮星才长芒。2px 的星芒等于没有。
  float size = clamp(aSize * uScale / max(d, 0.8), 1.0, 56.0);
  vRay = smoothstep(6.0, 20.0, size);
  // 0 = 贴近相机（要锐），1 = 最远（只能轻微柔化，不能糊成一团）
  vFar = clamp(d / uRange, 0.0, 1.0);
  // 上限 56px：再大就只剩柔光，星点的“晶亮”会被摊平
  gl_PointSize = size;
  gl_Position = projectionMatrix * mv;
}`;

export const STAR_FRAG = /* glsl */ `
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec3 uC4;
uniform float uHueShift;
uniform float uOpacity;
varying float vFade;
varying float vHue;
varying float vTwinkle;
varying float vFar;
varying float vRay;
vec3 palette(float h) {
  float x = fract(h);
  vec3 c = mix(uC1, uC2, clamp(x * 3.0, 0.0, 1.0));
  c = mix(c, uC3, clamp((x - 0.33) * 1.6, 0.0, 1.0));
  c = mix(c, uC4, clamp((x - 0.66) * 3.0, 0.0, 1.0));
  return c;
}
/** 一根针状光芒：调用前把要延伸的方向摆到 p.x */
float ray(vec2 p, float reach, float width) {
  float along = abs(p.x);
  float across = abs(p.y);
  // 越往尖端越细 → 是「光针」不是「光条」
  float w = width * max(0.0, 1.0 - along / reach);
  float body = 1.0 - smoothstep(0.0, max(w, 0.0008), across);
  return body * (1.0 - smoothstep(reach * 0.55, reach, along));
}
void main() {
  vec2 uv = (gl_PointCoord - 0.5) * 2.0;
  float r = length(uv);
  if (r > 1.0) discard;

  // 四芒星：竖 + 横两根光针，长度几乎顶到 sprite 边缘，越远收得越短
  float reach = mix(0.99, 0.46, vFar);
  float width = mix(0.075, 0.048, vFar);
  float rays = max(ray(uv, reach, width), ray(uv.yx, reach, width)) * vRay;

  // 实心核收紧：核一大就把光针吞掉，只剩一个圆点
  float core = smoothstep(mix(0.24, 0.14, vFar), 0.0, r);
  float halo = pow(smoothstep(1.0, 0.34, r), 4.0) * 0.2;

  vec3 col = palette(vHue + uHueShift);
  // 底色很亮，实测靠「饱和实心核 + 光针」才认得出是星，所以只在中芯点一点白
  col = mix(col, vec3(1.0), core * core * 0.4);
  float a = clamp(rays + core * 1.0 + halo, 0.0, 1.0);
  gl_FragColor = vec4(col, clamp(a * vFade * vTwinkle * uOpacity, 0.0, 1.0));
}`;

/** 星云光团 / 远景发光体：大尺度柔光，加色混合只提亮不遮底 */
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
  // 两层噪声：低频推动外缘（边界不规则）、高频做出云丝
  float n1 = noise(vUv * 3.4 + uSeed + vec2(uTime * 0.012, uTime * -0.008));
  float n2 = noise(vUv * 7.6 - uSeed * 1.3 + vec2(uTime * -0.02, uTime * 0.016));
  float n = n1 * 0.68 + n2 * 0.32;
  // 外缘被噪声推着走 → 有明确边界但仍像云，而不是一个圆盘
  float rim = 0.74 + 0.22 * n1;
  float mask = 1.0 - smoothstep(rim * 0.86, rim, r);
  // 贴边一道亮弧：加色混合下这是唯一能把「边界」读出来的手段
  float rimLine = exp(-pow((r - rim * 0.88) / 0.05, 2.0)) * step(r, rim);
  float body = pow(smoothstep(1.0, 0.0, r), uSoft * 0.5);
  float strands = 0.30 + 0.95 * pow(n, 1.3); // 提高对比 → 看得出丝缕，不是一片雾
  float a = (body * mask * strands * 0.85 + rimLine * 0.75) * vDepthFade * uOpacity;
  vec3 col = mix(uColorA, uColorB, clamp(n * 1.1 + vUv.y * 0.2, 0.0, 1.0));
  col = mix(col, vec3(1.0), rimLine * 0.6);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

/** 极光带：顶点起伏的大平面 */
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
  // 收窄边缘渐变：极光带要像一条「带」，过渡铺满整张 uv 就只剩一片雾
  float edgeX = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
  float edgeY = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
  // 上缘压一道亮边：让「带」的形状与走向读得出来
  float lip = exp(-pow((vUv.y - 0.70) / 0.075, 2.0));
  float stria = 0.72 + 0.28 * sin(vUv.x * 24.0 + vUv.y * 8.0); // 纵向条纹 = 极光帘幕感
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
