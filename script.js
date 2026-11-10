/* ============================================================
   Lumen — light/dark glass switch
   Two fragment shader passes:
     A  paints the world  (page, track, dot-matrix icons, spill)
     B  lays the glass lens, its edge light and orbit strip on top
   ============================================================ */

(function () {
  'use strict';

  /* ---------- layout, in shader units ---------- */
  const TRACK_W = 300;      // full track width
  const KNOB    = 100;      // knob is taller than the track: it sits proud
  const TRAVEL  = 96;       // knob centre travel, ± units

  const canvas = document.getElementById('scene');
  const surface = document.getElementById('surface');
  const stateEl = document.getElementById('state');
  const numEl = document.getElementById('num');
  const fillEl = document.getElementById('fill');

  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
  });

  if (!gl) {
    document.body.classList.add('no-gl');
    bindFallback();
    return;
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ============================================================
     shaders
     ============================================================ */

  const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

  const COMMON = `
precision highp float;

#define PI 3.1415926536

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float gauss(float x, float s) {
  return exp(-0.5 * (x * x) / (s * s));
}

vec3 clipHi(vec3 c) {
  return c / (1.0 + max(c - 1.0, vec3(0.0)) * 0.62);
}

const vec2  TRACK    = vec2(150.0, 42.0);
const float TRACK_R  = 42.0;
const float KNOB_H   = 50.0;
const float KNOB_R   = 15.0;
const float TRAVEL   = 96.0;
`;

  /* ---------------- pass A : the world ---------------- */

  const FRAG_WORLD = COMMON + `
varying vec2 vUv;
uniform vec2  uRes;
uniform float uScale;
uniform float uT;
uniform float uTime;

/* crescent, opening to the upper right */
float moonField(vec2 q) {
  float a = length(q - vec2(-3.0, 1.5)) - 19.5;
  float b = length(q - vec2(8.0, -7.0)) - 17.5;
  return max(a, -b);
}

/* sun: a disc plus eight spokes, by polar symmetry */
float sunField(vec2 q) {
  float d = length(q) - 14.0;
  float r = length(q);
  float a = atan(q.y, q.x);
  float seg = mod(a + 0.3926991, 0.7853982) - 0.3926991;
  float ray = max(abs(seg) * r - 1.7, max(17.5 - r, r - 26.0));
  return min(d, ray);
}

/* four point twinkle */
float sparkleField(vec2 q, float r) {
  float a = abs(q.x) * 5.5 + abs(q.y) - r;
  float b = abs(q.y) * 5.5 + abs(q.x) - r;
  return min(a, b);
}

void main() {
  float t  = clamp(uT, 0.0, 1.0);
  float tp = smoothstep(0.04, 0.56, t);      /* glass / ink theme */
  float px = 1.0 / uScale;
  vec2  p  = (gl_FragCoord.xy - 0.5 * uRes) / uScale;
  float kx = mix(-TRAVEL, TRAVEL, t);

  /* ---- page ---- */
  vec3 bg = mix(vec3(0.038, 0.039, 0.044), vec3(0.928, 0.922, 0.908), tp);
  float vig = length(vUv - 0.5);
  bg -= (0.105 - 0.035 * tp) * vig * vig;

  vec3  stripCol = mix(vec3(0.44, 0.60, 1.00), vec3(1.00, 0.60, 0.10), t);
  float breathe  = 1.0 + 0.03 * sin(uTime * 0.9);

  /* the light spill from the strip, on the page itself */
  float rad = length(p - vec2(kx, 0.0));
  bg += stripCol * (0.34 * gauss(rad, 118.0) + 0.20 * gauss(rad, 46.0)) * breathe;

  /* ---- track ---- */
  float dTr  = sdRoundBox(p, TRACK - TRACK_R, TRACK_R);
  float trkA = 1.0 - smoothstep(-px * 1.8, px * 1.8, dTr);

  /* drop shadow of the whole track, cast on the page only */
  float shT = exp(-max(dTr, 0.0) / 30.0);
  vec3  bgSh = bg * (1.0 - mix(0.62, 0.15, tp) * shT * (1.0 - trkA) *
                          (0.55 + 0.45 * gauss(p.y + 26.0, 70.0)));

  vec3 trk = bg + mix(0.055, 0.032, tp);
  /* inner wall: dark toward the bottom, catch light on the top lip */
  float vpos = clamp((p.y + TRACK.y) / (2.0 * TRACK.y), 0.0, 1.0);
  trk -= 0.070 * (1.0 - smoothstep(0.0, 0.55, vpos));
  trk += 0.030 * gauss(p.y + TRACK.y - 1.0, 4.0);
  /* rim */
  float rimT = exp(-abs(dTr + 0.6) / 1.3);
  trk += rimT * mix(0.10, 0.34, tp);

  /* wash that runs along the track with the knob */
  vec2  sd  = vec2(cos(-PI * 0.5 + t * PI), sin(-PI * 0.5 + t * PI));
  float wash = gauss(p.x - kx, 62.0) * gauss(p.y - sd.y * 40.0, 30.0);
  trk += stripCol * wash * 0.30 * breathe;

  vec3 col = mix(bgSh, trk, trkA);

  /* ---- dot matrix icons, behind the glass ---- */
  const float PITCH = 5.6;
  const float DOT   = 1.55;
  const float REACH = 34.0;

  float sumA = 0.0;
  vec3  sumC = vec3(0.0);
  vec3  glowI = vec3(0.0);

  vec3 inkN = vec3(0.85, 0.88, 0.95);
  vec3 inkD = vec3(0.17, 0.17, 0.19);

  vec2 c0 = p - vec2(kx, 0.0);
  if (max(abs(c0.x), abs(c0.y)) < REACH + 12.0) {
    vec2 gi = floor(c0 / PITCH + 0.5);

    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        vec2 cell = gi + vec2(float(dx), float(dy));
        if (max(abs(cell.x), abs(cell.y)) < 6.0) {

          vec2  ci = cell * PITCH;
          float rr = length(ci) + 1e-4;
          float aa = atan(ci.y, ci.x);

          /* staggered wave: angle first, then radius */
          float w  = 0.55 * ((aa + PI) / (2.0 * PI)) + 0.45 * (rr / REACH);
          float kk = clamp(t * 1.5 - w * 0.50, 0.0, 1.0);

          /* per pixel spring */
          float sp = 1.0 - exp(-3.4 * kk) * cos(6.8 * kk);
          float sk = clamp(sp, 0.0, 1.0);

          /* swirl: alternate direction per cell, grow outward */
          float sgn = (mod(cell.x + cell.y, 2.0) < 0.5) ? -1.0 : 1.0;
          float swA = sgn * (0.12 + 0.26 * rr / REACH) * sin(PI * sk);

          /* moon pixel at angle a answers a sun pixel at a + swirl */
          float mv = moonField(rot(ci, swA * 1.3));
          float sv = sunField(rot(ci, swA * 1.3));

          float m = (1.0 - smoothstep(-1.4, 0.0, mv)) * (1.0 - smoothstep(0.62, 0.99, kk));
          float s = (1.0 - smoothstep(-1.4, 0.0, sv)) * smoothstep(0.03, 0.42, kk);
          float a = max(m, s);

          if (a > 0.02) {
            /* fly: tangential drift plus a breath outward */
            vec2 tng = vec2(-ci.y, ci.x) / rr;
            vec2 pos = ci + tng * min(rr * swA, 4.6) + (ci / rr) * (sin(PI * sk) * 2.2 * sgn);
            float sc = 1.0 - 0.55 * sin(PI * sk);

            float dpx = sdRoundBox(p - vec2(kx, 0.0) - pos, vec2(DOT * sc), 1.0 * sc);
            float cov = (1.0 - smoothstep(-px * 1.3, px * 1.3, dpx)) * a;

            float heat = hash21(cell + 7.0);
            vec3  ink  = mix(inkN, inkD, tp) * (0.86 + 0.24 * heat);

            sumA  += cov;
            sumC  += ink * cov;
            glowI += stripCol * cov * 0.30 * sin(PI * sk);
          }
        }
      }
    }
  }

  if (sumA > 1e-4) {
    col = mix(col, sumC / sumA, min(sumA, 1.0) * 0.94);
  }

  /* ---- twinkles ---- */
  float sp1 = 1.0 - smoothstep(-0.6, 2.2, sparkleField(c0 - vec2(30.0, 17.0), 7.0));
  float sp2 = 1.0 - smoothstep(-0.6, 1.8, sparkleField(c0 - vec2(37.0, 27.0), 4.4));
  float tw  = 0.55 + 0.45 * sin(uTime * 2.1 + 1.7);
  col += (sp1 + sp2 * 0.7) * 0.45 * vec3(1.0, 0.98, 0.92) * tw * mix(1.0, 0.5, tp);
  col += glowI;

  /* ---- grain ---- */
  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.022;

  col = clipHi(max(col, vec3(0.0)));
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

  /* ---------------- pass B : the glass ---------------- */

  const FRAG_GLASS = COMMON + `
varying vec2 vUv;
uniform sampler2D uWorld;
uniform vec2  uRes;
uniform float uScale;
uniform float uT;
uniform float uTime;

void main() {
  float t  = clamp(uT, 0.0, 1.0);
  float tp = smoothstep(0.04, 0.56, t);
  float px = 1.0 / uScale;

  vec2 res = uRes;
  vec2 uv  = gl_FragCoord.xy / res;
  vec2 p   = (gl_FragCoord.xy - 0.5 * res) / uScale;

  float kx = mix(-TRAVEL, TRAVEL, t);
  vec2  q  = p - vec2(kx, 0.0);

  /* ---- silhouette + outward normal ---- */
  vec2  hs = vec2(KNOB_H - KNOB_R);
  float d  = sdRoundBox(q, hs, KNOB_R);
  float e  = 1.2;
  vec2  g  = vec2(
    sdRoundBox(q + vec2(e, 0.0), hs, KNOB_R) - sdRoundBox(q - vec2(e, 0.0), hs, KNOB_R),
    sdRoundBox(q + vec2(0.0, e), hs, KNOB_R) - sdRoundBox(q - vec2(0.0, e), hs, KNOB_R)
  );
  vec2 nrm = g / (length(g) + 1e-6);

  /* bevel profile: 0 at the rim, 1 deep inside */
  float uu   = clamp(-d / 16.0, 0.0, 1.0);
  float lift = pow(1.0 - uu, 2.2);

  /* ---- refracted + frosted view of the world ---- */
  vec2 cUv = (0.5 * res + vec2(kx, 0.0) * uScale) / res;
  vec2 rel = uv - cUv;
  vec2 bUv = cUv + rel * (1.0 - 0.11 * lift);
  vec2 disp = nrm * (lift * 13.0 * uScale) / res;

  float cr = texture2D(uWorld, bUv + disp * 1.12).r;
  float cg = texture2D(uWorld, bUv + disp * 1.00).g;
  float cb = texture2D(uWorld, bUv + disp * 0.88).b;

  vec2 fr = vec2((1.4 + 3.0 * lift) * uScale) / res;
  vec3 frostCol = (
    texture2D(uWorld, bUv + disp + vec2(fr.x, 0.0)).rgb +
    texture2D(uWorld, bUv + disp - vec2(fr.x, 0.0)).rgb +
    texture2D(uWorld, bUv + disp + vec2(0.0, fr.y)).rgb +
    texture2D(uWorld, bUv + disp - vec2(0.0, fr.y)).rgb
  ) * 0.25;

  float frost = mix(0.06, 0.55, pow(1.0 - uu, 1.4));
  vec3  glass = mix(vec3(cr, cg, cb), frostCol, frost);

  /* ---- glass body ---- */
  vec3 tintD = vec3(0.075, 0.080, 0.095);
  vec3 tintL = vec3(0.985, 0.982, 0.975);
  vec3 tint  = mix(tintD, tintL, tp);
  glass = glass * 0.90 + tint * 0.16;

  /* top bevel catch-light, bottom inner shadow */
  float gy = clamp((q.y + KNOB_H) / (2.0 * KNOB_H), 0.0, 1.0);
  glass += 0.16 * pow(gy, 3.0) * smoothstep(-3.0, 3.0, -d);
  glass -= 0.20 * pow(1.0 - gy, 2.5) * smoothstep(-4.0, 2.0, -d);
  float zc = (d + 2.0) / 3.0;
  glass -= 0.22 * exp(-zc * zc);

  /* ---- the light ---- */
  float ang  = -PI * 0.5 + t * PI;      /* bottom at night, top by day */
  vec2  sdir = vec2(cos(ang), sin(ang));

  /* how much this edge point faces the strip */
  float face = clamp(dot(nrm, sdir), 0.0, 1.0);
  float wEdge = 0.26 + 0.74 * pow(face, 1.6);

  vec3 stripCol = mix(vec3(0.42, 0.58, 1.00), vec3(1.00, 0.58, 0.06), t);
  float shim = 1.0 + 0.05 * sin(uTime * 1.6);

  /* edge-lit line, hugging the glass */
  float rimLine = exp(-abs(d - 0.1) / 1.5);
  vec3  rimEmis = (vec3(1.0, 0.985, 0.95) * 1.5 + stripCol * 1.9) * rimLine * wEdge * shim;

  /* the strip itself: a hot arc on the glass edge */
  float aa     = atan(q.y, q.x);
  float ad     = abs(mod(aa - ang + PI, 2.0 * PI) - PI);
  float an     = ad / 0.55;
  float angMask = exp(-an * an * an * an);
  float zb     = (d - 1.0) / 2.6;
  float band   = exp(-zb * zb);
  vec3  stripEmis = (vec3(1.0, 0.99, 0.96) * 2.4 + stripCol * 1.6) * band * angMask * shim;

  /* bloom, same falloff on both backgrounds */
  float outD = max(d, 0.0);
  float wBloom = 0.20 + 0.80 * pow(face, 1.4);
  vec3  bloom = stripCol * wBloom *
                (0.62 * exp(-outD / 5.5) + 0.34 * exp(-outD / 20.0) + 0.13 * exp(-outD / 78.0));

  /* scatter inside the glass */
  float dS = length(q - sdir * 42.0);
  float insideF = 1.0 - smoothstep(-px * 2.0, px * 2.0, d);
  float warm = smoothstep(6.0, 44.0, q.y);
  vec3  scat = stripCol * insideF *
               (0.30 * gauss(dS, 34.0) + 0.45 * gauss(dS, 12.0) + 0.16 * warm * tp);

  /* ---- compose ---- */
  vec3 world = texture2D(uWorld, uv).rgb;
  float inside = 1.0 - smoothstep(-px * 2.0, px * 2.0, d);

  /* the knob's own shadow, cast down-right onto track and page */
  vec2  qs = q - vec2(3.0, 7.0);
  float ds = sdRoundBox(qs, hs, KNOB_R);
  float sh = exp(-max(ds, 0.0) / 16.0);

  vec3 col = world;
  col -= mix(0.60, 0.16, tp) * sh * (1.0 - inside);

  col = mix(col, glass, inside);
  col += scat + rimEmis + stripEmis + bloom;

  col = clipHi(max(col, vec3(0.0)));
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

  /* ============================================================
     webgl plumbing
     ============================================================ */

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  function makeProgram(fragSrc) {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  const progA = makeProgram(FRAG_WORLD);
  const progB = makeProgram(FRAG_GLASS);

  if (!progA || !progB) {
    document.body.classList.add('no-gl');
    bindFallback();
    return;
  }

  function uniforms(prog, names) {
    const out = {};
    for (const n of names) out[n] = gl.getUniformLocation(prog, n);
    return out;
  }

  const uA = uniforms(progA, ['uRes', 'uScale', 'uT', 'uTime']);
  const uB = uniforms(progB, ['uRes', 'uScale', 'uT', 'uTime', 'uWorld']);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1
  ]), gl.STATIC_DRAW);

  const aPosA = gl.getAttribLocation(progA, 'aPos');
  const aPosB = gl.getAttribLocation(progB, 'aPos');

  let fbo = null;
  let fboTex = null;

  function makeTarget(w, h) {
    if (fbo) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(fboTex);
    }
    fboTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function drawQuad(prog, aPos) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /* ============================================================
     sizing
     ============================================================ */

  let scale = 1;
  let dpr = 1;

  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    scale = Math.min(vw / 390, vh / 250, 2.6);

    const w = Math.max(1, Math.round(vw * dpr));
    const h = Math.max(1, Math.round(vh * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      makeTarget(w, h);
    }

    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';

    surface.style.width = (TRACK_W * scale) + 'px';
    surface.style.height = (KNOB * scale + 6) + 'px';
    surface.style.borderRadius = (KNOB * 0.2 * scale) + 'px';
  }

  window.addEventListener('resize', resize);

  /* ============================================================
     state
     ============================================================ */

  let t = 0;
  let tween = null;
  let dragging = false;
  let moved = false;
  let suppressClick = false;
  let lastX = 0;

  const easeSpring = (x) => 1 - Math.exp(-5.2 * x) * Math.cos(8.4 * x);

  function setChecked() {
    const day = t > 0.5;
    surface.setAttribute('aria-checked', day ? 'true' : 'false');
    document.body.dataset.mode = day ? 'day' : 'night';
    stateEl.textContent = day ? 'Day' : 'Night';
  }

  function animateTo(target) {
    const dur = reduceMotion.matches ? 0 : 900;
    if (dur === 0) {
      t = target;
      tween = null;
      setChecked();
      return;
    }
    tween = { from: t, to: target, start: performance.now(), dur: dur };
  }

  function toggle() {
    animateTo(t < 0.5 ? 1 : 0);
  }

  /* ============================================================
     pointer + keyboard
     ============================================================ */

  function scrubFrom(clientX) {
    const r = surface.getBoundingClientRect();
    const cx = r.left + r.width * 0.5;
    const half = TRAVEL * scale;
    const v = 0.5 + (clientX - cx) / (half * 2);
    t = Math.max(0, Math.min(1, v));
    tween = null;
    setChecked();
  }

  surface.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    dragging = true;
    moved = false;
    lastX = ev.clientX;
    try { surface.setPointerCapture(ev.pointerId); } catch (e) {}
    scrubFrom(ev.clientX);
  });

  surface.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    if (Math.abs(ev.clientX - lastX) > 4) moved = true;
    scrubFrom(ev.clientX);
  });

  surface.addEventListener('pointerup', (ev) => {
    if (!dragging) return;
    dragging = false;
    try { surface.releasePointerCapture(ev.pointerId); } catch (e) {}
    if (moved) {
      suppressClick = true;
      animateTo(t > 0.5 ? 1 : 0);
    }
  });

  surface.addEventListener('pointercancel', () => {
    dragging = false;
    animateTo(t > 0.5 ? 1 : 0);
  });

  surface.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    toggle();
  });

  surface.addEventListener('keydown', (ev) => {
    const k = ev.key;
    if (k === 'ArrowRight' || k === 'ArrowUp') {
      ev.preventDefault();
      animateTo(1);
    } else if (k === 'ArrowLeft' || k === 'ArrowDown') {
      ev.preventDefault();
      animateTo(0);
    } else if (k === 'Home') {
      ev.preventDefault();
      animateTo(0);
    } else if (k === 'End') {
      ev.preventDefault();
      animateTo(1);
    }
  });

  function bindFallback() {
    const btn = document.getElementById('surface');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const day = btn.getAttribute('aria-checked') === 'true';
      btn.setAttribute('aria-checked', day ? 'false' : 'true');
      document.body.dataset.mode = day ? 'night' : 'day';
      document.getElementById('state').textContent = day ? 'Night' : 'Day';
    });
  }

  /* ============================================================
     render loop
     ============================================================ */

  let raf = 0;
  let running = false;

  function frame(now) {
    if (tween) {
      const x = Math.min((now - tween.start) / tween.dur, 1);
      t = tween.from + (tween.to - tween.from) * easeSpring(x);
      if (x >= 1) { t = tween.to; tween = null; }
      setChecked();
    }
    render(now / 1000);
    updateReadout();
    raf = requestAnimationFrame(frame);
  }

  let lastPct = -1;

  function updateReadout() {
    const pct = Math.round(t * 100);
    if (pct === lastPct) return;
    lastPct = pct;
    fillEl.style.width = pct + '%';
    numEl.textContent = pct;
  }

  function render(time) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(progA);
    gl.uniform2f(uA.uRes, canvas.width, canvas.height);
    gl.uniform1f(uA.uScale, scale * dpr);
    gl.uniform1f(uA.uT, t);
    gl.uniform1f(uA.uTime, time);
    drawQuad(progA, aPosA);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(progB);
    gl.uniform2f(uB.uRes, canvas.width, canvas.height);
    gl.uniform1f(uB.uScale, scale * dpr);
    gl.uniform1f(uB.uT, t);
    gl.uniform1f(uB.uTime, time);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.uniform1i(uB.uWorld, 0);

    drawQuad(progB, aPosB);
  }

  function start() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  /* ============================================================
     boot
     ============================================================ */

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  resize();
  setChecked();
  updateReadout();
  start();
})();
