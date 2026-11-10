/* ============================================================
   Lumen — light/dark glass switch
   Everything you see inside the canvas is two fragment shader
   passes: pass A paints the world (page, track, pixel icons,
   light wash, spill), pass B lays the glass lens and its
   orbiting light strip over that world.
   ============================================================ */

(function () {
  'use strict';

  /* ---------- layout constants shared with the shaders ---------- */
  const TRACK_W = 300;      // units
  const TRACK_H = 120;
  const TRAVEL = 100;

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
     shader source
     ============================================================ */

  const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

  /* shared GLSL helpers, injected into both fragment shaders */
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

/* highlight roll-off: keeps hue while letting the core go white */
vec3 clipHi(vec3 c) {
  return c / (1.0 + max(c - 1.0, vec3(0.0)) * 0.62);
}

const vec2  TRACK    = vec2(148.0, 60.0);
const float TRACK_R  = 58.0;
const float KNOB_H   = 40.0;
const float KNOB_R   = 16.0;
const float TRAVEL   = 100.0;
`;

  const FRAG_WORLD = COMMON + `
varying vec2 vUv;
uniform vec2  uRes;
uniform float uScale;
uniform float uT;
uniform float uTime;

/* crescent moon */
float moonField(vec2 q) {
  float a = length(q - vec2(-2.5, 1.5)) - 20.0;
  float b = length(q - vec2(8.5, -8.0)) - 18.5;
  return max(a, -b);
}

/* sun: disc plus eight radiating spokes */
float sunField(vec2 q) {
  float d = length(q) - 14.5;
  float rays = 1e9;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * (PI * 0.25);
    vec2 dir = vec2(cos(a), sin(a));
    vec2 u = vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x)));
    float dr = sdRoundBox(u - vec2(21.5, 0.0), vec2(1.4, 0.0), 2.6);
    rays = min(rays, dr);
  }
  return min(d, rays);
}

void main() {
  float t  = clamp(uT, 0.0, 1.0);
  float px = 1.0 / uScale;
  vec2  p  = (gl_FragCoord.xy - 0.5 * uRes) / uScale;
  float kx = mix(-TRAVEL, TRAVEL, t);

  /* ---------- page ---------- */
  vec3 bg = mix(vec3(0.043, 0.047, 0.058), vec3(0.906, 0.898, 0.874), t);
  float vig = length(vUv - 0.5);
  bg -= (0.030 + 0.030 * t) * vig * vig * 1.35;

  vec3  stripTint = mix(vec3(0.55, 0.74, 1.00), vec3(1.00, 0.79, 0.45), t);
  float breathe   = 1.0 + 0.03 * sin(uTime * 0.9);

  /* one glow model: cool at night, warm by day, same falloff */
  float rad = length(p - vec2(kx, 0.0));
  bg += stripTint * (0.26 * gauss(rad, 160.0) + 0.09 * gauss(rad, 54.0)) * breathe;

  /* ---------- track ---------- */
  float dTr  = sdRoundBox(p, TRACK - TRACK_R, TRACK_R);
  float trkA = 1.0 - smoothstep(-px * 1.8, px * 1.8, dTr);

  vec3 trk = bg + mix(0.068, -0.070, t);
  trk += mix(0.14, 0.09, t) * exp(-abs(dTr + 0.7) / 1.3);              /* hairline */
  float zw = (dTr + 3.0) / 5.5;
  trk -= 0.045 * exp(-zw * zw) * mix(1.0, 0.7, t);                     /* inner wall */

  /* light washing along the track */
  vec2  sdir = vec2(cos(-PI * 0.5 + t * PI), sin(-PI * 0.5 + t * PI));
  float wash = gauss(p.x - kx, 58.0) * gauss(p.y - sdir.y * 46.0, 26.0);
  trk += stripTint * wash * 0.52 * breathe;

  vec3 col = mix(bg, trk, trkA);

  /* ---------- pixel icons behind the glass ---------- */
  const float PITCH = 9.2;
  const float CELL  = 4.0;
  const float SPAN  = 32.2;

  float sumA = 0.0;
  vec3  sumC = vec3(0.0);
  vec3  glowI = vec3(0.0);

  vec2 c0 = p - vec2(kx, 0.0);
  if (max(abs(c0.x), abs(c0.y)) < 52.0) {
    vec3 inkCool = vec3(0.60, 0.78, 1.00);
    vec3 inkWarm = vec3(0.92, 0.66, 0.30);

    for (int j = 0; j < 7; j++) {
      for (int i = 0; i < 7; i++) {
        vec2  ci = (vec2(float(i), float(j)) - 3.0) * PITCH;
        float rr = length(ci) + 1e-4;
        float aa = atan(ci.y, ci.x);

        /* stagger: a wave that sweeps by angle, then by radius */
        float w  = 0.60 * ((aa + PI) / (2.0 * PI)) + 0.40 * (rr / SPAN);
        float kk = clamp((t * 1.55 - w * 0.55), 0.0, 1.0);

        /* per-pixel spring */
        float sp = 1.0 - exp(-3.2 * kk) * cos(6.5 * kk);
        float sk = clamp(sp, 0.0, 1.0);

        /* swirl direction alternates per pixel, grows outward */
        float sgn = (mod(float(i) + float(j), 2.0) < 0.5) ? -1.0 : 1.0;
        float sw  = sgn * (0.30 + 0.78 * rr / SPAN) * sin(PI * sk);

        /* pairing by angle: the sun pixel at angle a+sw answers the moon pixel at a */
        float mv = moonField(rot(ci, sw));
        float sv = sunField(rot(ci, sw));

        float m = (1.0 - smoothstep(-2.5, 0.0, mv)) * (1.0 - smoothstep(0.60, 1.0, kk));
        float s = (1.0 - smoothstep(-2.5, 0.0, sv)) * smoothstep(0.02, 0.44, kk);
        float a = max(m, s);

        if (a > 0.012) {
          vec2  pos = rot(ci, sw * 1.15);
          float sc  = 1.0 - 0.52 * sin(PI * sk);
          vec2  lp  = rot(p - vec2(kx, 0.0) - pos, -sw * 1.9);
          float dPx = sdRoundBox(lp, vec2(CELL) * sc * 0.84, 1.7 * sc);
          float cov = (1.0 - smoothstep(-px * 1.5, px * 1.5, dPx)) * a;

          vec3 ink = mix(inkCool, inkWarm, smoothstep(0.0, 1.0, kk));
          sumA += cov;
          sumC += ink * cov;
          glowI += ink * cov * 0.45 * sin(PI * sk);
        }
      }
    }
  }

  if (sumA > 1e-4) {
    col = mix(col, sumC / sumA, min(sumA, 1.0));
    col += glowI;
  }

  /* ---------- grain ---------- */
  col += (hash21(gl_FragCoord.xy) - 0.5) * 0.02;

  col = clipHi(max(col, vec3(0.0)));
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

  const FRAG_GLASS = COMMON + `
varying vec2 vUv;
uniform sampler2D uWorld;
uniform vec2  uRes;
uniform float uScale;
uniform float uT;
uniform float uTime;

void main() {
  float t  = clamp(uT, 0.0, 1.0);
  float px = 1.0 / uScale;

  vec2 res = uRes;
  vec2 uv  = gl_FragCoord.xy / res;
  vec2 p   = (gl_FragCoord.xy - 0.5 * res) / uScale;

  float kx = mix(-TRAVEL, TRAVEL, t);
  vec2  q  = p - vec2(kx, 0.0);

  /* knob silhouette */
  float d = sdRoundBox(q, vec2(KNOB_H - KNOB_R), KNOB_R);
  vec2  hs = vec2(KNOB_H - KNOB_R);
  float e  = 1.0;
  vec2 g = vec2(
    sdRoundBox(q + vec2(e, 0.0), hs, KNOB_R) - sdRoundBox(q - vec2(e, 0.0), hs, KNOB_R),
    sdRoundBox(q + vec2(0.0, e), hs, KNOB_R) - sdRoundBox(q - vec2(0.0, e), hs, KNOB_R)
  );
  vec2 nrm = g / (length(g) + 1e-6);

  /* bevel depth */
  float uu   = clamp(-d / (KNOB_R * 0.74), 0.0, 1.0);
  float lift = pow(1.0 - uu, 1.9);

  /* ---------- refracted, frosted view of the world ---------- */
  vec2 cUv   = (0.5 * res + vec2(kx, 0.0) * uScale) / res;
  vec2 rel   = uv - cUv;
  vec2 bUv   = cUv + rel * (1.0 - 0.12 * lift);
  vec2 disp  = nrm * (lift * 12.0 * uScale) / res;

  /* chromatic aberration: each channel bends a little differently */
  float cr = texture2D(uWorld, bUv + disp * 1.09).r;
  float cg = texture2D(uWorld, bUv + disp * 1.00).g;
  float cb = texture2D(uWorld, bUv + disp * 0.90).b;

  /* frost: a widening cross blur */
  vec2 fr = vec2((2.2 + 4.6 * lift) * uScale) / res;
  vec3 frostCol = (
    texture2D(uWorld, bUv + disp + vec2(fr.x, 0.0)).rgb +
    texture2D(uWorld, bUv + disp - vec2(fr.x, 0.0)).rgb +
    texture2D(uWorld, bUv + disp + vec2(0.0, fr.y)).rgb +
    texture2D(uWorld, bUv + disp - vec2(0.0, fr.y)).rgb
  ) * 0.25;

  float frost = mix(0.10, 0.88, pow(1.0 - uu, 1.1));
  vec3  glass = mix(vec3(cr, cg, cb), frostCol, frost);

  /* glass body */
  vec3 tint = mix(vec3(0.40, 0.50, 0.72), vec3(0.94, 0.88, 0.76), t);
  glass = glass * 0.93 + tint * (0.05 + 0.06 * frost);
  float zd = (d + 2.2) / 3.2;
  glass -= 0.30 * exp(-zd * zd);
  glass += exp(-abs(d + 0.7) / 1.2) * (0.26 + 0.14 * lift) * vec3(1.0, 0.99, 0.96);

  /* a faint diagonal highlight across the bevel */
  glass += gauss(q.x + q.y * 1.25 - 24.0, 10.0) * smoothstep(-3.0, 4.0, -d) * 0.10;

  /* ---------- the light strip ---------- */
  float ang  = -PI * 0.5 + t * PI;     /* bottom at night, top by day */
  vec2  sdir = vec2(cos(ang), sin(ang));

  float aa   = atan(q.y, q.x);
  float adiff = abs(mod(aa - ang + PI, 2.0 * PI) - PI);
  float an = adiff / 0.60;
  float angMask = exp(-an * an * an * an);

  float zb = (d - 1.5) / 2.4;
  float band  = exp(-zb * zb);
  float shim  = 1.0 + 0.07 * sin(uTime * 1.6);
  float core  = band * angMask * shim;

  vec3 stripCol = mix(vec3(0.58, 0.78, 1.00), vec3(1.00, 0.80, 0.45), t);
  vec3 emitS = (vec3(1.0, 0.985, 0.94) * 2.5 + stripCol * 1.2) * core;

  /* spill onto the page: same glow model, wide falloff */
  float outD = max(d, 0.0);
  vec3  halo = stripCol * angMask *
               (0.42 * exp(-outD / 10.0) + 0.15 * exp(-outD / 36.0));

  /* scatter inside the glass */
  float dS = length(q - sdir * 34.0);
  float insideF = 1.0 - smoothstep(-px * 2.0, px * 2.0, d);
  vec3  scat = stripCol * insideF *
               (0.50 * gauss(dS, 30.0) + 0.65 * gauss(dS, 10.0));

  /* ---------- compose ---------- */
  vec3 world = texture2D(uWorld, uv).rgb;
  float inside = 1.0 - smoothstep(-px * 2.0, px * 2.0, d);

  vec3 col = world;
  col -= mix(0.26, 0.08, t) * exp(-outD / 9.0) * (1.0 - inside);   /* contact shade */
  col = mix(col, glass, inside);
  col += scat + emitS + halo;

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

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1
  ]), gl.STATIC_DRAW);

  const aPosA = gl.getAttribLocation(progA, 'aPos');
  const aPosB = gl.getAttribLocation(progB, 'aPos');

  /* off-screen target for the world pass */
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

  let scale = 1;       // CSS px per layout unit
  let dpr = 1;

  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);

    scale = Math.min(vw / 380, vh / 250, 2.6);

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
    surface.style.height = (TRACK_H * scale) + 'px';
    surface.style.borderRadius = (TRACK_H * 0.5 * scale) + 'px';
  }

  window.addEventListener('resize', resize);

  /* ============================================================
     state
     ============================================================ */

  let t = 0;                 // current scrub position, 0 night – 1 day
  let tween = null;          // { from, to, start, dur }
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
    const half = TRAVEL * 2 * scale * 0.5;     // half of the travel in px
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
    if (!dragging) toggle();
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
  let running = true;

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

  const uB = uniforms(progB, ['uRes', 'uScale', 'uT', 'uTime', 'uWorld']);

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
  raf = requestAnimationFrame(frame);
})();
