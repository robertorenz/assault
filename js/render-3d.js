/* Assault Revamped — 3D renderer (Three.js / WebGL).
 * The arcade islands rebuilt as a real 3D scene: each stage is a floating
 * landmass with a rocky underside hanging over a nebula, a ringed gas giant
 * and drifting asteroids. Boulders, trees, bunkers, city towers, the fortress
 * and every unit are lit, shadow-casting meshes. Shots and plasma glow through
 * an HDR bloom pass, explosions throw fire, smoke, sparks, shockwaves and
 * tumbling debris, and a chase camera with cinematic intro, death and
 * stage-clear shots follows the tank. The HUD is drawn on the 2D canvas that
 * sits on top of the WebGL canvas, reusing the 2.5D renderer's HUD code. */
(function (global) {
  'use strict';

  const THREE = global.THREE;
  if (!THREE || !THREE.EffectComposer || !THREE.UnrealBloomPass) return;
  const { TS, T } = global.Assault;

  const TAU = Math.PI * 2;
  const PLAT = 6;                         // height of the fortress platform
  const SLAB = 26;                        // thickness of the island's soil layer
  const PINK = '#f6a8d8';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const damp = (k, dt) => 1 - Math.exp(-k * dt);
  function hash(x, y, k) {
    let h = (x * 374761393 + y * 668265263 + (k || 0) * 1442695041) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  const hex = h => new THREE.Color(h);
  const hdr = (h, k) => new THREE.Color(h).multiplyScalar(k);
  const rgbArr = (h, k) => { const c = new THREE.Color(h); k = k || 1; return [c.r * k, c.g * k, c.b * k]; };

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const _c = new THREE.Color();

  function setInst(mesh, i, x, y, z, ry, sx, sy, sz, rx, rz) {
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }

  function instanced(geo, mat, n, cast, receive) {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = !!cast;
    m.receiveShadow = !!receive;
    return m;
  }

  const std = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0.08 }, o || {}));
  const glowMat = (color, k, o) => new THREE.MeshBasicMaterial(Object.assign({ color: hdr(color, k || 1), toneMapped: false }, o || {}));

  /* ---------------- generated textures ---------------- */

  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }

  const glowTex = () => canvasTex(64, 64, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.65)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.16)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  });

  const smokeTex = () => canvasTex(64, 64, (x, w) => {
    for (let i = 0; i < 7; i++) {
      const cx = 32 + rnd(-9, 9), cy = 32 + rnd(-9, 9), r = rnd(12, 22);
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, w);
    }
  });

  const ringTex = () => canvasTex(128, 128, (x, w) => {
    const g = x.createRadialGradient(64, 64, 40, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.15)');
    g.addColorStop(0.85, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, w);
  });

  const treadTex = () => canvasTex(16, 32, (x, w, h) => {
    x.fillStyle = '#6a5020'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#3a2a0c';
    for (let y = 0; y < h; y += 8) x.fillRect(0, y, w, 3);
    x.fillStyle = '#a8883c'; x.fillRect(0, 0, 2, h); x.fillRect(w - 2, 0, 2, h);
  }, true);

  const windowsTex = () => canvasTex(64, 128, (x, w, h) => {
    x.fillStyle = '#1a1e2a'; x.fillRect(0, 0, w, h);
    for (let y = 6; y < h - 6; y += 12) {
      for (let xx = 5; xx < w - 5; xx += 11) {
        const r = Math.random();
        x.fillStyle = r < 0.45 ? '#2a3040' : r < 0.8 ? '#ffd27a' : r < 0.93 ? '#8ae8ff' : '#ffffff';
        x.fillRect(xx, y, 6, 7);
      }
    }
    x.fillStyle = '#0c0f16'; x.fillRect(0, 0, w, 3);
  }, true);

  const stoneTex = () => canvasTex(64, 64, (x) => {
    x.fillStyle = '#6a7286'; x.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 400; i++) {
      x.fillStyle = ['#5c6476', '#7a8296', '#868ea2', '#606a7c'][i % 4];
      x.fillRect((hash(i, 1) * 64) | 0, (hash(i, 2) * 64) | 0, 2, 1);
    }
    x.strokeStyle = '#3e4454'; x.lineWidth = 1.5; x.beginPath();
    for (const y of [0, 21, 42]) { x.moveTo(0, y + 0.5); x.lineTo(64, y + 0.5); }
    for (const [y, off] of [[0, 0], [21, 16], [42, 8]]) for (let k = 0; k < 3; k++) { const xx = (off + k * 24) % 64 + 0.5; x.moveTo(xx, y); x.lineTo(xx, y + 21); }
    x.stroke();
  }, true);

  const beamTex = () => canvasTex(4, 128, (x, w, h) => {
    const g = x.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });

  /* ---------------- GLSL ---------------- */

  const NOISE = `
    float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
    float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
  `;

  const FinalShader = {
    uniforms: {
      tDiffuse: { value: null }, time: { value: 0 }, flash: { value: 0 }, flashColor: { value: new THREE.Color(1, 1, 1) },
      aberr: { value: 0.012 }, res: { value: new THREE.Vector2(1, 1) }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float time, flash, aberr; uniform vec3 flashColor; uniform vec2 res; varying vec2 vUv;
      vec3 soft(vec3 c){ vec3 k = max(c - 0.8, 0.0); return min(c, 0.8) + 0.2 * (1.0 - exp(-k / 0.2)); }
      float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5;
        float ca = aberr * dot(d, d) * 4.0;
        vec3 col = vec3(texture2D(tDiffuse, vUv + d * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d * ca).b);
        col = soft(col);
        float l = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(vec3(l), col, 1.1);
        col *= 1.0 - smoothstep(0.38, 0.95, length(d * vec2(1.0, 0.92))) * 0.6;
        col = mix(col, flashColor, clamp(flash, 0.0, 1.0));
        col += (rand(vUv * res + fract(time)) - 0.5) * 0.022;
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }`
  };

  /* ---------------- particles ---------------- */

  class Particles {
    constructor(max, tex, blending, order) {
      this.max = max;
      this.items = [];
      const g = new THREE.BufferGeometry();
      this.pos = new Float32Array(max * 3);
      this.col = new Float32Array(max * 3);
      this.size = new Float32Array(max);
      this.alpha = new Float32Array(max);
      const attr = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', attr(this.pos, 3));
      g.setAttribute('pcolor', attr(this.col, 3));
      g.setAttribute('size', attr(this.size, 1));
      g.setAttribute('alpha', attr(this.alpha, 1));
      this.geo = g;
      this.mat = new THREE.ShaderMaterial({
        uniforms: { map: { value: tex }, scale: { value: 600 } },
        vertexShader: `
          attribute float size; attribute float alpha; attribute vec3 pcolor; uniform float scale;
          varying vec3 vColor; varying float vAlpha;
          void main(){ vColor = pcolor; vAlpha = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = size * scale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `
          uniform sampler2D map; varying vec3 vColor; varying float vAlpha;
          void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha); }`,
        transparent: true, depthWrite: false, blending
      });
      this.points = new THREE.Points(g, this.mat);
      this.points.frustumCulled = false;
      this.points.renderOrder = order || 0;
    }

    add(o) {
      if (this.items.length >= this.max) return;
      o.max = o.life;
      if (o.grav === undefined) o.grav = 0;
      if (o.drag === undefined) o.drag = 0;
      if (o.s1 === undefined) o.s1 = o.s0;
      if (o.c1 === undefined) o.c1 = o.c0;
      if (o.vx === undefined) { o.vx = 0; o.vy = 0; o.vz = 0; }
      this.items.push(o);
    }

    clear() { this.items.length = 0; }

    update(dt) {
      const it = this.items;
      for (let i = it.length - 1; i >= 0; i--) {
        const p = it[i];
        p.life -= dt;
        if (p.life <= 0) { it[i] = it[it.length - 1]; it.pop(); continue; }
        const dr = 1 - p.drag * dt;
        p.vx *= dr; p.vy *= dr; p.vz *= dr;
        p.vy -= p.grav * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.floor && p.y < 1) { p.y = 1; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
      }
    }

    sync() {
      const it = this.items, n = it.length;
      for (let i = 0; i < n; i++) {
        const p = it[i], k = 1 - p.life / p.max, j = i * 3;
        this.pos[j] = p.x; this.pos[j + 1] = p.y; this.pos[j + 2] = p.z;
        this.col[j] = lerp(p.c0[0], p.c1[0], k); this.col[j + 1] = lerp(p.c0[1], p.c1[1], k); this.col[j + 2] = lerp(p.c0[2], p.c1[2], k);
        this.size[i] = lerp(p.s0, p.s1, k);
        const fin = p.fadeIn ? clamp(k / p.fadeIn, 0, 1) : 1;
        this.alpha[i] = (p.a0 === undefined ? 1 : p.a0) * fin * Math.min(1, (p.life / p.max) * (p.hold || 1.6));
      }
      const g = this.geo;
      g.setDrawRange(0, n);
      for (const k of ['position', 'pcolor', 'size', 'alpha']) g.attributes[k].needsUpdate = true;
    }
  }

  /* ---------------- shared geometry ---------------- */

  function rockGeometry(seed) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = 1 + (hash(Math.round(x * 100), Math.round(y * 100) + Math.round(z * 100) * 7, seed) - 0.5) * 0.42;
      pos.setXYZ(i, x * k, y * k * 0.85, z * k);
    }
    g.computeVertexNormals();
    return g;
  }

  /* ================================================================== */

  class ThreeRenderer {
    constructor(hudCanvas) {
      this.hudCanvas = hudCanvas;
      this.ctx = hudCanvas.getContext('2d');
      this.hud = new global.ModernRenderer(hudCanvas);   // HUD panels and messages
      this.hideHud = false;
      this.active = false;
      this.t = 0;
      this.frameDt = 0;
      this.w = 1; this.h = 1;
      this.camInit = false;
      this.playerBaseY = 0;

      const canvas = document.createElement('canvas');
      canvas.id = 'screen3d';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.display = 'none';
      hudCanvas.parentNode.insertBefore(canvas, hudCanvas);
      this.canvas = canvas;

      const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.setClearColor(0x01030a, 1);
      this.renderer = r;
      this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      this.perf = { acc: 0, n: 0 };

      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.Fog(0x030814, 1500, 6200);
      this.camera = new THREE.PerspectiveCamera(56, 1, 4, 60000);
      this.camPos = new THREE.Vector3();
      this.camLook = new THREE.Vector3();

      const rt = new THREE.WebGLRenderTarget(4, 4, { type: r.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType });
      this.composer = new THREE.EffectComposer(r, rt);
      this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
      this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(256, 256), 0.95, 0.6, 0.88);
      this.composer.addPass(this.bloom);
      this.final = new THREE.ShaderPass(FinalShader);
      this.composer.addPass(this.final);

      this.tex = { glow: glowTex(), smoke: smokeTex(), ring: ringTex(), tread: treadTex(), windows: windowsTex(), stone: stoneTex(), beam: beamTex() };
      this.geo = {
        box: new THREE.BoxGeometry(1, 1, 1),
        sphere: new THREE.SphereGeometry(1, 20, 14),
        hemi: new THREE.SphereGeometry(1, 20, 10, 0, TAU, 0, Math.PI / 2),
        cyl: new THREE.CylinderGeometry(1, 1, 1, 14),
        cone: new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0),
        pyramid: new THREE.ConeGeometry(1, 1, 3).translate(0, 0.5, 0),
        stalactite: new THREE.ConeGeometry(1, 1, 6).rotateX(Math.PI).translate(0, -0.5, 0),
        rock: rockGeometry(3),
        blob: new THREE.IcosahedronGeometry(1, 0),
        flat: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        ring: new THREE.RingGeometry(0.86, 1, 64).rotateX(-Math.PI / 2),
        bolt: new THREE.CapsuleGeometry(1, 1, 4, 8)
      };
      this.colorStalactites();

      this.buildLights();
      this.buildSpace();
      this.buildFx();

      this.stageGroup = null;
      this.stageRef = null;
      this.enemyObjs = new Map();
      this.dyn = new THREE.Group();
      this.scene.add(this.dyn);
      this.player = this.buildTank(true);
      this.dyn.add(this.player.root);
      this.buildPlayerExtras();
      this.reset();
    }

    /* ---------------- lifecycle ---------------- */

    setActive(on) {
      this.active = on;
      this.canvas.style.display = on ? 'block' : 'none';
      if (on) { this.stageRef = null; this.camInit = false; }
    }

    reset() {
      this.glow.clear(); this.smoke.clear();
      this.debris.length = 0;
      for (const r of this.rings) r.life = 0;
      this.flashes = [];
      this.popups = [];
      this.shake = 0; this.flash = 0; this.flashColor = new THREE.Color(1, 1, 1);
      this.camInit = false;
      for (const o of this.enemyObjs.values()) this.dyn.remove(o.root);
      this.enemyObjs.clear();
    }

    resize(w, h) {
      this.w = w; this.h = h;
      this.hud.resize(w, h);
      this.applySize();
    }

    applySize() {
      const cw = window.innerWidth, ch = window.innerHeight;
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setSize(cw, ch, false);
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(cw, ch);
      this.camera.aspect = cw / Math.max(1, ch);
      this.camera.updateProjectionMatrix();
      const ph = ch * this.pixelRatio;
      const sc = ph * 0.5 / Math.tan(this.camera.fov * Math.PI / 360);
      this.glow.mat.uniforms.scale.value = sc;
      this.smoke.mat.uniforms.scale.value = sc;
      this.final.uniforms.res.value.set(cw * this.pixelRatio, ph);
      this.stars.material.uniforms.pr.value = this.pixelRatio;
    }

    /* Drop the render resolution on slow machines. */
    adaptQuality(dt) {
      const P = this.perf;
      P.acc += dt; P.n++;
      if (P.acc < 2) return;
      const avg = P.acc / P.n;
      P.acc = 0; P.n = 0;
      if (avg > 0.024 && this.pixelRatio > 0.75) { this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25); this.applySize(); }
    }

    /* ---------------- lights & space ---------------- */

    buildLights() {
      const s = this.scene;
      this.sunDir = new THREE.Vector3(-0.55, 0.62, -0.56).normalize();
      s.add(new THREE.HemisphereLight(0xa8dcff, 0x3a2c1c, 0.6));
      s.add(new THREE.AmbientLight(0x1a2438, 0.35));
      const sun = new THREE.DirectionalLight(0xfff0dc, 1.15);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const sc = sun.shadow.camera;
      sc.left = -460; sc.right = 460; sc.top = 460; sc.bottom = -460; sc.near = 10; sc.far = 2600;
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.8;
      s.add(sun); s.add(sun.target);
      this.sun = sun;
      const under = new THREE.DirectionalLight(0x2dd4bf, 0.55);   // teal bounce from the planet, lights the island's underside
      under.position.set(0.4, -1, 0.3);
      s.add(under);
      this.pool = [];
      for (let i = 0; i < 6; i++) {
        const l = new THREE.PointLight(0xffffff, 0, 240, 2);
        s.add(l);
        this.pool.push(l);
      }
    }

    buildSpace() {
      const space = new THREE.Group();
      this.space = space;
      this.scene.add(space);

      // nebula sky dome — follows the camera
      const sky = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: this.sunDir } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: NOISE + `
          uniform vec3 sunDir; varying vec3 vDir;
          void main(){
            vec3 d = normalize(vDir);
            float n = fbm(d * 2.6 + vec3(0.0, 0.0, 1.7));
            float n2 = fbm(d * 5.5 + n * 1.6);
            float band = exp(-pow((d.y * 0.9 + 0.3 * sin(d.x * 2.0 + d.z * 1.3)) / 0.5, 2.0));
            vec3 col = vec3(0.004, 0.010, 0.026);
            col += vec3(0.02, 0.17, 0.21) * smoothstep(0.42, 0.85, n2) * band * 1.5;
            col += vec3(0.02, 0.06, 0.20) * smoothstep(0.32, 0.78, n) * 0.9;
            col += vec3(0.26, 0.12, 0.02) * pow(smoothstep(0.5, 0.95, n2 * n * 1.7), 2.0) * band;
            float sd = max(dot(d, sunDir), 0.0);
            col += vec3(1.0, 0.85, 0.6) * pow(sd, 900.0) * 6.0 + vec3(0.9, 0.55, 0.25) * pow(sd, 14.0) * 0.22;
            gl_FragColor = vec4(col, 1.0);
          }`,
        side: THREE.BackSide, depthWrite: false
      }));
      sky.renderOrder = -10;
      this.sky = sky;
      space.add(sky);

      // stars
      const N = 4200, sp = new Float32Array(N * 3), sc = new Float32Array(N * 3), ss = new Float32Array(N), sph = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * TAU, r = Math.sqrt(1 - u * u);
        sp[i * 3] = Math.cos(a) * r * 25000; sp[i * 3 + 1] = u * 25000; sp[i * 3 + 2] = Math.sin(a) * r * 25000;
        const c = pick([[1, 1, 1], [0.75, 0.88, 1], [1, 0.9, 0.7], [0.7, 1, 0.95]]);
        const b = Math.random() < 0.04 ? rnd(2.2, 4) : rnd(0.35, 1.1);
        sc[i * 3] = c[0] * b; sc[i * 3 + 1] = c[1] * b; sc[i * 3 + 2] = c[2] * b;
        ss[i] = b > 2 ? rnd(2.5, 4) : rnd(1, 2.4);
        sph[i] = Math.random() * TAU;
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      sg.setAttribute('pcolor', new THREE.BufferAttribute(sc, 3));
      sg.setAttribute('size', new THREE.BufferAttribute(ss, 1));
      sg.setAttribute('phase', new THREE.BufferAttribute(sph, 1));
      this.stars = new THREE.Points(sg, new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, pr: { value: 1 } },
        vertexShader: `
          attribute vec3 pcolor; attribute float size; attribute float phase; uniform float time, pr; varying vec3 vC;
          void main(){ float tw = 0.7 + 0.3 * sin(time * (1.5 + phase * 0.4) + phase * 7.0); vC = pcolor * tw;
            gl_PointSize = size * pr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: 'varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vC, smoothstep(0.5, 0.05, d)); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      this.stars.frustumCulled = false;
      this.stars.renderOrder = -9;
      space.add(this.stars);

      // ringed gas giant
      const planet = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: this.sunDir }, time: { value: 0 } },
        vertexShader: 'varying vec3 vL; varying vec3 vN; varying vec3 vW; void main(){ vL = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: NOISE + `
          uniform vec3 sunDir; uniform float time; varying vec3 vL; varying vec3 vN; varying vec3 vW;
          void main(){
            float n = fbm(vL * 3.0 + vec3(time * 0.004, 0.0, 0.0));
            float b = sin(vL.y * 17.0 + n * 4.5) * 0.5 + 0.5;
            vec3 c = mix(vec3(0.78, 0.52, 0.28), vec3(0.16, 0.44, 0.50), b);
            c = mix(c, vec3(0.95, 0.88, 0.72), smoothstep(0.62, 0.9, fbm(vL * 7.0 + n)) * 0.55);
            float storm = smoothstep(0.16, 0.0, length(vL.xy - vec2(0.35, -0.28)));
            c = mix(c, vec3(0.85, 0.32, 0.12), storm * 0.8);
            vec3 N = normalize(vN);
            float diff = clamp(dot(N, sunDir) * 1.1 + 0.05, 0.0, 1.0);
            float rim = pow(1.0 - max(dot(N, normalize(cameraPosition - vW)), 0.0), 3.0);
            vec3 col = c * (0.025 + diff * 1.05) + vec3(0.3, 0.8, 0.95) * rim * (0.15 + diff) * 0.9;
            gl_FragColor = vec4(col, 1.0);
          }`
      }));
      planet.add(body);
      const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.07, 64, 48), new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: this.sunDir } },
        vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `uniform vec3 sunDir; varying vec3 vN; varying vec3 vW;
          void main(){ vec3 N = normalize(vN); float f = 1.0 - abs(dot(N, normalize(cameraPosition - vW)));
            float lit = clamp(dot(N, sunDir) + 0.35, 0.0, 1.0);
            gl_FragColor = vec4(vec3(0.25, 0.75, 0.95) * 1.6, pow(f, 5.0) * lit); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      planet.add(atmo);
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.35, 2.35, 160, 1), new THREE.ShaderMaterial({
        uniforms: { sunDir: { value: this.sunDir } },
        vertexShader: 'varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `varying vec3 vL;
          float h(float x){ return fract(sin(x * 91.7) * 43758.5); }
          void main(){ float r = length(vL.xy); float k = (r - 1.35) / 1.0;
            float bands = 0.55 + 0.45 * sin(k * 90.0) * sin(k * 23.0 + 1.0);
            float gap = smoothstep(0.02, 0.0, abs(k - 0.62)) ;
            float a = bands * smoothstep(0.0, 0.06, k) * smoothstep(1.0, 0.85, k) * (1.0 - gap) * 0.75;
            vec3 c = mix(vec3(0.85, 0.72, 0.52), vec3(0.55, 0.62, 0.62), h(floor(k * 40.0)));
            gl_FragColor = vec4(c * 0.85, a); }`,
        side: THREE.DoubleSide, transparent: true, depthWrite: false
      }));
      ring.rotation.x = -Math.PI / 2 + 0.32;
      ring.rotation.y = 0.18;
      planet.add(ring);
      planet.scale.setScalar(2500);
      planet.rotation.z = 0.25;
      this.planet = planet;
      this.planetBody = body;
      space.add(planet);

      // a small moon
      const moon = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), std('#9aa0aa', { roughness: 1, fog: false }));
      moon.scale.setScalar(260);
      this.moon = moon;
      space.add(moon);

      // drifting asteroids and distant floating islets (positioned per stage)
      const ast = instanced(rockGeometry(11), std('#6e6862', { flatShading: true, roughness: 0.95 }), 160, false, false);
      ast.count = 160;
      this.asteroids = ast;
      this.astData = [];
      for (let i = 0; i < 160; i++) {
        this.astData.push({ x: 0, y: 0, z: 0, s: rnd(8, 90) * (Math.random() < 0.1 ? 2.2 : 1), rx: rnd(0, TAU), ry: rnd(0, TAU), vr: rnd(-0.4, 0.4), vy: rnd(-4, 4) });
        _c.setHSL(0.08, rnd(0.05, 0.2), rnd(0.25, 0.5));
        ast.setColorAt(i, _c);
      }
      space.add(ast);

      this.islets = new THREE.Group();
      space.add(this.islets);
    }

    buildFx() {
      const s = this.scene;
      this.smoke = new Particles(1800, this.tex.smoke, THREE.NormalBlending, 1);
      this.glow = new Particles(3200, this.tex.glow, THREE.AdditiveBlending, 2);
      s.add(this.smoke.points);
      s.add(this.glow.points);

      // tumbling debris chunks
      this.debris = [];
      this.debrisMesh = instanced(this.geo.box, std('#ffffff', { roughness: 0.6 }), 320, true, false);
      for (let i = 0; i < 320; i++) this.debrisMesh.setColorAt(i, _c.set('#888888'));
      s.add(this.debrisMesh);

      // shockwave rings
      this.rings = [];
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(this.geo.flat, new THREE.MeshBasicMaterial({ map: this.tex.ring, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
        m.visible = false;
        m.renderOrder = 3;
        s.add(m);
        this.rings.push({ mesh: m, life: 0 });
      }

      // floor glow decals under shots, lights and blasts
      this.decals = instanced(this.geo.flat, new THREE.MeshBasicMaterial({ map: this.tex.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), 200, false, false);
      for (let i = 0; i < 200; i++) this.decals.setColorAt(i, _c.set('#ffffff'));
      this.decals.renderOrder = 1;
      s.add(this.decals);

      // projectiles
      this.boltMesh = instanced(this.geo.bolt, glowMat('#ffffff', 1), 16, false, false);
      for (let i = 0; i < 16; i++) this.boltMesh.setColorAt(i, _c.setRGB(0.9, 2.2, 3.2));
      s.add(this.boltMesh);
      this.eshotMesh = instanced(this.geo.sphere, glowMat('#ffffff', 1), 64, false, false);
      for (let i = 0; i < 64; i++) this.eshotMesh.setColorAt(i, _c.setRGB(3, 1.2, 2.2));
      s.add(this.eshotMesh);
      this.nadeMesh = instanced(this.geo.sphere, std('#30343c', { emissive: hex('#ff8a20'), emissiveIntensity: 0.6, metalness: 0.6, roughness: 0.3 }), 24, true, false);
      s.add(this.nadeMesh);
      this.markMesh = instanced(this.geo.ring, glowMat('#ff6ac0', 2.2, { transparent: true, opacity: 0.9, depthWrite: false }), 24, false, false);
      s.add(this.markMesh);

      // the yellow exit arrow, as a floating hologram
      const sh = new THREE.Shape();
      sh.moveTo(0, 15); sh.lineTo(12, 1); sh.lineTo(4.5, 1); sh.lineTo(4.5, -12); sh.lineTo(-4.5, -12); sh.lineTo(-4.5, 1); sh.lineTo(-12, 1); sh.closePath();
      const ag = new THREE.ExtrudeGeometry(sh, { depth: 3, bevelEnabled: true, bevelSize: 0.8, bevelThickness: 0.8, bevelSegments: 1 });
      ag.rotateX(-Math.PI / 2);
      this.arrow = new THREE.Mesh(ag, glowMat('#ffc21a', 1.9, { transparent: true, opacity: 0.88, depthWrite: false }));
      this.arrow.renderOrder = 4;
      s.add(this.arrow);
      this.arrowRing = new THREE.Mesh(this.geo.ring, glowMat('#ffc21a', 1.6, { transparent: true, opacity: 0.6, depthWrite: false }));
      s.add(this.arrowRing);

      // drifting space dust near the camera
      const DN = 500, dp = new Float32Array(DN * 3);
      for (let i = 0; i < DN * 3; i++) dp[i] = rnd(-700, 700);
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x8fd8ff, size: 1.6, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      this.dust.frustumCulled = false;
      this.dustPos = dp;
      s.add(this.dust);
    }

    colorStalactites() {
      const g = this.geo.stalactite, pos = g.attributes.position, cols = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const k = clamp(-pos.getY(i), 0, 1);            // 0 at the base, 1 at the tip
        const v = lerp(1, 0.32, Math.pow(k, 0.7));
        cols[i * 3] = v; cols[i * 3 + 1] = v * 0.97; cols[i * 3 + 2] = v * 0.94;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    }

    /* ---------------- stage building ---------------- */

    ensureStage(g) {
      if (this.stageRef === g.stage) return;
      this.stageRef = g.stage;
      this.buildStage(g.stage);
    }

    disposeStage() {
      if (!this.stageGroup) return;
      this.scene.remove(this.stageGroup);
      for (const d of this.stageDisp) d.dispose();
      this.stageGroup = null;
    }

    buildStage(st) {
      this.disposeStage();
      for (const o of this.enemyObjs.values()) this.dyn.remove(o.root);
      this.enemyObjs.clear();
      const grp = new THREE.Group();
      const disp = [];
      this.stageGroup = grp;
      this.stageDisp = disp;
      const keep = x => { disp.push(x); return x; };
      const { MW, MH, map } = st;
      const W = MW * TS, H = MH * TS;
      this.W = W; this.H = H;
      const theme = global.MAP_THEME[st.theme.key];
      const rockCols = global.ROCK_COLORS[theme.rock];
      const key = st.theme.key;
      const at = (x, y) => (x < 0 || y < 0 || x >= MW || y >= MH ? T.VOID : map[y * MW + x]);

      // floor: the painted arcade map as a texture
      this.mapTex = new global.MapTexture(st, 'floor');
      const ft = keep(new THREE.CanvasTexture(this.mapTex.canvas));
      ft.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.floorTex = ft;
      this.texDirty = false; this.texClock = 0;
      const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2)), keep(std('#ffffff', { map: ft, alphaTest: 0.5, roughness: 0.92, metalness: 0 })));
      floor.position.set(W / 2, 0, H / 2);
      floor.receiveShadow = true;
      grp.add(floor);

      // distance (in tiles) from each land tile to open space
      const edge = new Int16Array(MW * MH).fill(-1);
      const q = [];
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
        if (at(x, y) === T.VOID) continue;
        let nearVoid = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(x + dx, y + dy) === T.VOID) nearVoid = true;
        if (nearVoid) { edge[y * MW + x] = 0; q.push(y * MW + x); }
      }
      for (let qi = 0; qi < q.length; qi++) {
        const i = q[qi], x = i % MW, y = (i / MW) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (at(nx, ny) === T.VOID || edge[ny * MW + nx] >= 0) continue;
          edge[ny * MW + nx] = edge[i] + 1;
          q.push(ny * MW + nx);
        }
      }

      // soil slab and the hanging rocky underside
      const land = [];
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (at(x, y) !== T.VOID) land.push([x, y]);
      const slab = instanced(this.geo.box, keep(std(theme.ground[0], { roughness: 1 })), land.length, false, true);
      const under = instanced(this.geo.stalactite, keep(std('#ffffff', { vertexColors: true, flatShading: true, roughness: 1 })), land.length * 2, false, false);
      let ui = 0;
      const rc = new THREE.Color(rockCols[1]), dc = new THREE.Color(theme.ground[1]);
      land.forEach(([x, y], i) => {
        setInst(slab, i, (x + 0.5) * TS, -SLAB / 2 - 0.5, (y + 0.5) * TS, 0, TS, SLAB, TS);
        const e = Math.max(0, edge[y * MW + x]);
        const depth = 30 + Math.min(e, 9) * 44 + hash(x, y, 5) * 60 + Math.pow(Math.min(e, 9) / 9, 2) * 260;
        const r = TS * (0.75 + hash(x, y, 6) * 0.5);
        setInst(under, ui, (x + 0.5) * TS + (hash(x, y, 7) - 0.5) * 12, -SLAB + 2, (y + 0.5) * TS + (hash(x, y, 8) - 0.5) * 12, hash(x, y, 9) * TAU, r, depth, r);
        _c.copy(rc).lerp(dc, hash(x, y, 10) * 0.45).multiplyScalar(0.85 + hash(x, y, 11) * 0.3);
        under.setColorAt(ui++, _c);
        if (hash(x, y, 12) < 0.35) {
          const d2 = depth * (0.4 + hash(x, y, 13) * 0.4), r2 = r * 0.5;
          setInst(under, ui, (x + hash(x, y, 14)) * TS, -SLAB + 2, (y + hash(x, y, 15)) * TS, 0, r2, d2, r2);
          under.setColorAt(ui++, _c);
        }
      });
      slab.count = land.length;
      under.count = ui;
      grp.add(slab, under);
      this.under = under;
      this.landTiles = land;

      // boulders on rock tiles
      const rocks = [];
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (at(x, y) === T.ROCK) rocks.push(...global.rockBlobs(x, y));
      const rockMesh = instanced(this.geo.rock, keep(std('#ffffff', { flatShading: true, roughness: 0.9 })), rocks.length, true, true);
      const rcA = new THREE.Color(rockCols[1]), rcB = new THREE.Color(rockCols[2]);
      rocks.forEach((b, i) => {
        const k = hash(b.x | 0, b.y | 0, 1);
        setInst(rockMesh, i, b.x, b.r * 0.35, b.y, k * TAU, b.r * 1.15, b.r * (0.9 + k * 0.5), b.r * 1.1, (k - 0.5) * 0.4, 0);
        rockMesh.setColorAt(i, _c.copy(rcA).lerp(rcB, hash(b.x | 0, b.y | 0, 2) * 0.6));
      });
      rockMesh.count = rocks.length;
      grp.add(rockMesh);

      // trees and shrubs on bush tiles
      const leaf = global.LEAF_COLORS;
      const trees = [];
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
        if (at(x, y) !== T.BUSH) continue;
        const n = 1 + (hash(x, y, 3) < 0.5 ? 1 : 0);
        for (let k = 0; k < n; k++) trees.push({ x: (x + 0.2 + hash(x, y, 20 + k) * 0.6) * TS, y: (y + 0.2 + hash(x, y, 30 + k) * 0.6) * TS, s: 0.75 + hash(x, y, 40 + k) * 0.6, c: hash(x, y, 50 + k) });
      }
      const pine = key === 'forest', shrub = key === 'sand';
      const trunk = instanced(this.geo.cyl, keep(std('#5a3a1e', { roughness: 1 })), trees.length, true, false);
      const canopy = instanced(pine ? this.geo.cone : this.geo.blob, keep(std('#ffffff', { flatShading: true, roughness: 0.85 })), trees.length * 2, true, true);
      let ci = 0;
      trees.forEach((tr, i) => {
        const s = tr.s, col = _c.set(leaf[1]).lerp(new THREE.Color(leaf[3]), tr.c * 0.7);
        if (shrub) col.lerp(new THREE.Color('#9a8a3a'), 0.45);
        if (pine) {
          setInst(trunk, i, tr.x, 4 * s, tr.y, 0, 2 * s, 8 * s, 2 * s);
          setInst(canopy, ci, tr.x, 6 * s, tr.y, tr.c * TAU, 11 * s, 22 * s, 11 * s); canopy.setColorAt(ci++, col);
          setInst(canopy, ci, tr.x, 18 * s, tr.y, tr.c * 3, 7.5 * s, 18 * s, 7.5 * s); canopy.setColorAt(ci++, col.multiplyScalar(1.12));
        } else if (shrub) {
          setInst(trunk, i, tr.x, 0, tr.y, 0, 0.01, 0.01, 0.01);
          setInst(canopy, ci, tr.x, 4 * s, tr.y, tr.c * TAU, 9 * s, 6 * s, 9 * s); canopy.setColorAt(ci++, col);
        } else {
          setInst(trunk, i, tr.x, 5 * s, tr.y, 0, 2 * s, 10 * s, 2 * s);
          setInst(canopy, ci, tr.x, 15 * s, tr.y, tr.c * TAU, 11 * s, 10 * s, 11 * s); canopy.setColorAt(ci++, col);
          setInst(canopy, ci, tr.x + 4 * s, 19 * s, tr.y - 2 * s, tr.c * 5, 7 * s, 7 * s, 7 * s); canopy.setColorAt(ci++, col.multiplyScalar(1.15));
        }
      });
      trunk.count = trees.length;
      canopy.count = ci;
      grp.add(trunk, canopy);

      // destructible structures
      const blocks = [];
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (at(x, y) === T.BLOCK) blocks.push([x, y]);
      this.blockIndex = new Map();
      this.blockParts = [];
      const addPart = (geo, mat, cast) => { const m = instanced(geo, keep(mat), blocks.length, cast, true); m.count = blocks.length; grp.add(m); this.blockParts.push(m); return m; };
      this.blockLights = null;
      if (key === 'city') {
        const wt = this.tex.windows;
        const side = keep(std('#ffffff', { map: wt, emissiveMap: wt, emissive: hex('#ffffff'), emissiveIntensity: 1.3, roughness: 0.5, metalness: 0.3 }));
        const top = keep(std('#3a4252', { roughness: 0.6 }));
        const towers = addPart(this.geo.box, [side, side, top, top, side, side], true);
        const roof = addPart(this.geo.box, std('#2a6ad8', { roughness: 0.4, metalness: 0.4 }), true);
        const beacons = addPart(this.geo.sphere, glowMat('#ff3a2a', 3));
        this.blockLights = beacons;
        blocks.forEach(([x, y], i) => {
          const h = 30 + Math.floor(hash(x, y, 60) * 4) * 12;
          setInst(towers, i, (x + 0.5) * TS, h / 2, (y + 0.5) * TS, 0, 26, h, 26);
          setInst(roof, i, (x + 0.5) * TS, h + 1.5, (y + 0.5) * TS, 0, 18, 3, 18);
          setInst(beacons, i, (x + 0.5) * TS, h + 4.5, (y + 0.5) * TS, 0, 1.6, 1.6, 1.6);
          this.blockIndex.set(y * MW + x, i);
        });
      } else if (key === 'base') {
        const hull = addPart(this.geo.box, std('#7a5038', { roughness: 0.7 }), true);
        const trim = addPart(this.geo.box, glowMat('#3a8ad0', 1.6));
        const dome = addPart(this.geo.hemi, std('#3a6ae0', { emissive: hex('#3a6ae0'), emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.25 }), true);
        blocks.forEach(([x, y], i) => {
          setInst(hull, i, (x + 0.5) * TS, 7, (y + 0.5) * TS, 0, 28, 14, 28);
          setInst(trim, i, (x + 0.5) * TS, 14.3, (y + 0.5) * TS, 0, 29, 1, 29);
          setInst(dome, i, (x + 0.5) * TS, 14, (y + 0.5) * TS, 0, 9, 9, 9);
          this.blockIndex.set(y * MW + x, i);
        });
      } else {
        const hull = addPart(this.geo.box, std('#6a6e78', { roughness: 0.8 }), true);
        const roof = addPart(this.geo.box, std('#9a9ea8', { roughness: 0.7 }), true);
        const slit = addPart(this.geo.box, std('#1a1c22'), false);
        const light = addPart(this.geo.sphere, glowMat('#ff3a2a', 3));
        this.blockLights = light;
        blocks.forEach(([x, y], i) => {
          setInst(hull, i, (x + 0.5) * TS, 6, (y + 0.5) * TS, 0, 26, 12, 26);
          setInst(roof, i, (x + 0.5) * TS, 13, (y + 0.5) * TS, 0, 22, 2, 22);
          setInst(slit, i, (x + 0.5) * TS, 8, (y + 0.5) * TS + 13, 0, 14, 3, 1);
          setInst(light, i, (x + 0.5) * TS, 15, (y + 0.5) * TS, 0, 1.6, 1.6, 1.6);
          this.blockIndex.set(y * MW + x, i);
        });
      }

      // animated water overlay, masked to water tiles
      const mask = new Uint8Array(MW * MH * 4);
      let anyWater = false;
      for (let i = 0; i < MW * MH; i++) if (map[i] === T.WATER) { mask[i * 4] = 255; mask[i * 4 + 3] = 255; anyWater = true; }
      if (anyWater) {
        const mt = keep(new THREE.DataTexture(mask, MW, MH, THREE.RGBAFormat));
        mt.magFilter = THREE.LinearFilter; mt.minFilter = THREE.LinearFilter; mt.needsUpdate = true;
        const wc = theme.water;
        this.waterMat = keep(new THREE.ShaderMaterial({
          uniforms: { mask: { value: mt }, time: { value: 0 }, size: { value: new THREE.Vector2(W, H) }, c1: { value: hex(wc[2]) }, c2: { value: hex(wc[1]) } },
          vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
          fragmentShader: `uniform sampler2D mask; uniform float time; uniform vec2 size; uniform vec3 c1, c2; varying vec3 vW;
            void main(){ float m = texture2D(mask, vW.xz / size).r; if (m < 0.3) discard;
              vec2 p = vW.xz * 0.055;
              float w = sin(p.x * 1.7 + time * 1.3) + sin(p.y * 2.3 - time * 1.1) + sin((p.x + p.y) * 1.3 + time * 0.7) + sin(length(p) * 0.9 - time);
              float caust = pow(0.5 + 0.5 * sin(w * 2.2), 8.0);
              vec3 col = mix(c1, c2, 0.5 + 0.25 * sin(w)) + caust * vec3(0.7, 1.3, 1.3);
              gl_FragColor = vec4(col, smoothstep(0.3, 0.6, m) * 0.62); }`,
          transparent: true, depthWrite: false
        }));
        const water = new THREE.Mesh(keep(new THREE.PlaneGeometry(W, H).rotateX(-Math.PI / 2)), this.waterMat);
        water.position.set(W / 2, 0.7, H / 2);
        water.renderOrder = 1;
        grp.add(water);
      } else this.waterMat = null;

      // lift zones: glowing rings with a light column
      this.liftObjs = st.lifts.map(l => {
        const o = new THREE.Group();
        o.position.set((l.x + 1) * TS, 0, (l.y + 1) * TS);
        const ring = new THREE.Mesh(this.geo.ring, keep(glowMat('#5ad0ff', 2.6, { transparent: true, depthWrite: false })));
        ring.scale.setScalar(28); ring.position.y = 1.2;
        const ring2 = new THREE.Mesh(this.geo.ring, keep(glowMat('#2dd4bf', 2.2, { transparent: true, depthWrite: false })));
        ring2.scale.setScalar(20); ring2.position.y = 1.4;
        const beam = new THREE.Mesh(keep(new THREE.CylinderGeometry(24, 24, 170, 32, 1, true).translate(0, 85, 0)),
          keep(new THREE.MeshBasicMaterial({ map: this.tex.beam, color: hdr('#5ad0ff', 1.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false })));
        o.add(ring, ring2, beam);
        grp.add(o);
        return { lift: l, o, ring, ring2, beam };
      });

      // jump pads: pulsing chevron rings
      this.jumpObjs = [];
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
        if (at(x, y) !== T.JUMP) continue;
        const o = new THREE.Mesh(this.geo.ring, keep(glowMat('#5a90ff', 2.4, { transparent: true, depthWrite: false })));
        o.position.set((x + 0.5) * TS, 1.3, (y + 0.5) * TS);
        grp.add(o);
        this.jumpObjs.push(o);
      }

      // fortress: a raised stone pentagon, five pylons, a shield dome and a beacon
      const f = st.fort;
      const shape = new THREE.Shape(f.verts.map(([vx, vy]) => new THREE.Vector2((vx - f.cx) * TS * 1.08, (vy - f.cy) * TS * 1.08)));
      const pg = keep(new THREE.ExtrudeGeometry(shape, { depth: PLAT + 2, bevelEnabled: true, bevelSize: 2, bevelThickness: 1.5, bevelSegments: 1 }));
      pg.rotateX(Math.PI / 2).translate(0, PLAT, 0);
      const stone = keep(this.tex.stone.clone()); stone.needsUpdate = true; stone.repeat.set(1 / 40, 1 / 40);
      const plat = new THREE.Mesh(pg, [keep(std('#8a92a6', { map: stone, roughness: 0.85 })), keep(std('#4a5060', { roughness: 0.9 }))]);
      plat.position.set(f.cx * TS, 0, f.cy * TS);
      plat.castShadow = plat.receiveShadow = true;
      grp.add(plat);
      const trimPts = f.verts.map(([vx, vy]) => new THREE.Vector3((vx - f.cx) * TS * 1.12, PLAT + 0.6, (vy - f.cy) * TS * 1.12));
      trimPts.push(trimPts[0].clone());
      this.fortTrim = new THREE.Line(keep(new THREE.BufferGeometry().setFromPoints(trimPts)), keep(new THREE.LineBasicMaterial({ color: hdr('#ff3a2a', 2.5), toneMapped: false })));
      this.fortTrim.position.copy(plat.position);
      grp.add(this.fortTrim);
      this.pylonTips = [];
      const pylonMat = keep(std('#3a3e4a', { roughness: 0.6, metalness: 0.4 }));
      this.tipMat = keep(glowMat('#ff3a2a', 3));
      for (const [vx, vy] of f.verts) {
        const px = f.cx * TS + (vx - f.cx) * TS * 1.32, pz = f.cy * TS + (vy - f.cy) * TS * 1.32;
        const py = new THREE.Mesh(keep(new THREE.CylinderGeometry(3, 7, 64, 4)), pylonMat);
        py.position.set(px, 32, pz); py.castShadow = true;
        const tip = new THREE.Mesh(this.geo.sphere, this.tipMat);
        tip.position.set(px, 68, pz); tip.scale.setScalar(4);
        grp.add(py, tip);
        this.pylonTips.push(tip);
      }
      this.shield = new THREE.Mesh(keep(new THREE.IcosahedronGeometry(1, 3)), keep(new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, color: { value: new THREE.Color(1.6, 0.35, 0.3) } },
        vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `uniform float time; uniform vec3 color; varying vec3 vN; varying vec3 vW;
          void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW)));
            float scan = 0.5 + 0.5 * sin(vW.y * 0.5 - time * 4.0);
            gl_FragColor = vec4(color, pow(f, 2.5) * 0.85 + scan * 0.06); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
      })));
      this.shield.material.wireframe = false;
      this.shield.scale.set(44, 34, 44);
      this.shield.position.set(f.cx * TS, PLAT, f.cy * TS);
      grp.add(this.shield);
      this.shieldWire = new THREE.Mesh(this.shield.geometry, keep(new THREE.MeshBasicMaterial({ color: hdr('#ff5a3a', 1.2), wireframe: true, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })));
      this.shieldWire.scale.copy(this.shield.scale).multiplyScalar(1.002);
      this.shieldWire.position.copy(this.shield.position);
      grp.add(this.shieldWire);
      this.beacon = new THREE.Mesh(keep(new THREE.CylinderGeometry(9, 16, 2600, 24, 1, true).translate(0, 1300, 0)),
        keep(new THREE.MeshBasicMaterial({ map: this.tex.beam, color: hdr('#ff4a2a', 1.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false })));
      this.beacon.position.set(f.cx * TS, PLAT, f.cy * TS);
      grp.add(this.beacon);
      this.hole = new THREE.Group();
      const holeDisc = new THREE.Mesh(keep(new THREE.CircleGeometry(24, 40).rotateX(-Math.PI / 2)), keep(new THREE.MeshBasicMaterial({ color: 0x000000 })));
      const holeRim = new THREE.Mesh(this.geo.ring, keep(glowMat('#ff8a20', 2.5, { transparent: true, depthWrite: false })));
      holeRim.scale.setScalar(27); holeRim.position.y = 0.2;
      this.hole.add(holeDisc, holeRim);
      this.hole.position.set(f.cx * TS, PLAT + 0.8, f.cy * TS);
      this.hole.visible = false;
      grp.add(this.hole);

      // minimap source
      const mm = document.createElement('canvas');
      mm.width = 72; mm.height = Math.round(72 * H / W);
      const mx = mm.getContext('2d');
      mx.imageSmoothingEnabled = true;
      mx.drawImage(this.mapTex.canvas, 0, 0, mm.width, mm.height);
      this.mini = mm;

      this.placeSpace(W, H);
      this.scene.add(grp);
    }

    /* Spread asteroids and islets around this stage's island. */
    placeSpace(W, H) {
      const cx = W / 2;
      for (const a of this.astData) {
        for (let k = 0; k < 40; k++) {
          a.x = rnd(-3200, W + 3200); a.y = rnd(-2600, 900); a.z = rnd(-3500, H + 2500);
          if (Math.abs(a.x - cx) > W / 2 + 350 || a.y < -900) break;
        }
      }
      this.planet.position.set(cx + 4200, -2900, -8200);
      this.moon.position.set(cx - 5200, 1400, -6400);
      for (const c of this.islets.children.slice()) {
        this.islets.remove(c);
        c.traverse(o => { if (o.geometry && o.geometry !== this.geo.cone) o.geometry.dispose(); });
      }
      const theme = global.MAP_THEME[this.stageRef.theme.key];
      const topMat = std(theme.ground[2], { flatShading: true, roughness: 1 });
      const rockMat = std('#5a5560', { flatShading: true, roughness: 1 });
      const treeMat = std('#2f7a20', { flatShading: true });
      this.isletData = [];
      for (let i = 0; i < 9; i++) {
        const side = i % 2 ? 1 : -1;
        const r = rnd(90, 260);
        const g = new THREE.Group();
        const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, 22, 9), topMat);
        const bot = new THREE.Mesh(new THREE.ConeGeometry(r * 0.95, r * rnd(1.6, 2.6), 9).rotateX(Math.PI), rockMat);
        bot.position.y = -11 - r * 1.05;
        g.add(top, bot);
        for (let k = 0; k < 5; k++) {
          const t = new THREE.Mesh(this.geo.cone, treeMat);
          const a = rnd(0, TAU), d = rnd(0, r * 0.7), s = rnd(14, 30);
          t.position.set(Math.cos(a) * d, 11, Math.sin(a) * d);
          t.scale.set(s * 0.5, s * 1.4, s * 0.5);
          g.add(t);
        }
        g.position.set(cx + side * rnd(1300, 3200), rnd(-900, 500), rnd(-1500, H + 800));
        g.rotation.y = rnd(0, TAU);
        this.islets.add(g);
        this.isletData.push({ g, y: g.position.y, ph: rnd(0, TAU) });
      }
    }

    /* ---------------- models ---------------- */

    mesh(geo, mat, w, h, d, x, y, z, parent) {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(w, h, d);
      m.position.set(x, y, z);
      m.castShadow = true;
      if (parent) parent.add(m);
      return m;
    }

    /* A tank facing -z. root: position + heading; roll: barrel roll and altitude; pitch: wheelie about the rear axle. */
    buildTank(isPlayer) {
      const B = this.geo.box;
      const root = new THREE.Group(), roll = new THREE.Group(), pitch = new THREE.Group(), body = new THREE.Group();
      root.add(roll); roll.add(pitch); pitch.add(body);
      roll.position.y = 8; pitch.position.set(0, -8, 15); body.position.z = -15;
      const tread = this.tex.tread.clone(); tread.needsUpdate = true; tread.repeat.set(1, isPlayer ? 4 : 3.5);
      const tm = std(isPlayer ? '#d8b25a' : '#8a5a78', { map: tread, roughness: 0.9 });
      const paints = [];
      let turret, barrel;
      if (isPlayer) {
        this.mesh(B, tm, 9, 9, 30, -13, 4.5, 0, body);
        this.mesh(B, tm, 9, 9, 30, 13, 4.5, 0, body);
        const hull = std('#c8ced8', { roughness: 0.45, metalness: 0.35 });
        this.mesh(B, hull, 17, 8, 26, 0, 8, 0, body);
        this.mesh(B, std('#eef1f5', { roughness: 0.4, metalness: 0.3 }), 15, 1.2, 21, 0, 12.4, 1, body);
        const blue = std('#2a50d0', { emissive: hex('#2a50d0'), emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.4 });
        this.mesh(B, blue, 3.2, 4.5, 14, -7, 11.5, -2, body);
        this.mesh(B, blue, 3.2, 4.5, 14, 7, 11.5, -2, body);
        const lamp = glowMat('#fff4d0', 3.2);
        this.mesh(B, lamp, 3, 1.6, 0.8, -5, 9, -13.2, body);
        this.mesh(B, lamp, 3, 1.6, 0.8, 5, 9, -13.2, body);
        this.mesh(B, glowMat('#ff4a2a', 2.5), 3, 1.2, 0.8, -6, 9, 13.2, body);
        this.mesh(B, glowMat('#ff4a2a', 2.5), 3, 1.2, 0.8, 6, 9, 13.2, body);
        turret = new THREE.Group(); turret.position.set(0, 13, 1); body.add(turret);
        this.mesh(B, std('#dfe3ea', { roughness: 0.4, metalness: 0.3 }), 11, 5, 13, 0, 2.5, 0, turret);
        this.mesh(this.geo.sphere, glowMat('#ff3a2a', 3), 1.6, 1.6, 1.6, 0, 5.4, 2.5, turret);
        this.mesh(this.geo.cyl, std('#5a606a', { metalness: 0.6, roughness: 0.4 }), 0.5, 14, 0.5, 3.5, 10, 5, turret);
        barrel = new THREE.Group(); barrel.position.set(0, 3, 0); turret.add(barrel);
        const bm = this.mesh(this.geo.cyl, std('#d8dde4', { metalness: 0.7, roughness: 0.3 }), 2.2, 24, 2.2, 0, 0, -12, barrel);
        bm.rotation.x = Math.PI / 2;
        const tip = this.mesh(this.geo.cyl, glowMat('#7ad0ff', 2.5), 2.6, 1.5, 2.6, 0, 0, -24, barrel);
        tip.rotation.x = Math.PI / 2;
      } else {
        this.mesh(B, tm, 7, 8, 26, -11, 4, 0, body);
        this.mesh(B, tm, 7, 8, 26, 11, 4, 0, body);
        const hp = std('#c46a9a', { roughness: 0.5, metalness: 0.25 });
        paints.push(hp);
        this.mesh(B, hp, 15, 8, 22, 0, 7, 0, body);
        turret = new THREE.Group(); turret.position.set(0, 11, 0); body.add(turret);
        const tp = std('#e8a8c8', { roughness: 0.45, metalness: 0.25 });
        paints.push(tp);
        this.mesh(B, tp, 10, 6, 11, 0, 3, 0, turret);
        this.mesh(this.geo.sphere, glowMat('#ff4a8a', 2.6), 1.3, 1.3, 1.3, 0, 6.4, 2, turret);
        barrel = new THREE.Group(); barrel.position.set(0, 4, 0); turret.add(barrel);
        const bm = this.mesh(this.geo.cyl, std('#3a3440', { metalness: 0.5 }), 1.6, 21, 1.6, 0, 0, -10.5, barrel);
        bm.rotation.x = Math.PI / 2;
      }
      return { root, roll, pitch, body, turret, barrel, tread, paints };
    }

    buildPlayerExtras() {
      this.shieldBubble = new THREE.Mesh(this.geo.sphere, new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: 'varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `uniform float time; varying vec3 vN; varying vec3 vW;
          void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW)));
            float hex = 0.5 + 0.5 * sin(vW.x * 0.8 + time * 3.0) * sin(vW.z * 0.8 - time * 2.0) * sin(vW.y * 0.8);
            gl_FragColor = vec4(vec3(0.5, 1.6, 2.6), pow(f, 3.0) * 0.9 + hex * 0.05); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      this.shieldBubble.scale.setScalar(27);
      this.shieldBubble.position.y = 10;
      this.player.root.add(this.shieldBubble);
      this.liftGlow = new THREE.Mesh(this.geo.cone, new THREE.MeshBasicMaterial({ map: this.tex.beam, color: hdr('#5ad0ff', 1.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
      this.liftGlow.rotation.x = Math.PI;
      this.player.root.add(this.liftGlow);
    }

    makeEnemy(e) {
      const B = this.geo.box;
      const o = { type: e.type, paints: [] };
      switch (e.type) {
        case 'tank': {
          const t = this.buildTank(false);
          Object.assign(o, t);
          break;
        }
        case 'turret': {
          const root = new THREE.Group();
          this.mesh(B, std('#4a4a54', { roughness: 0.8 }), 28, 6, 28, 0, 3, 0, root);
          this.mesh(B, glowMat('#ff4a8a', 2), 29, 0.8, 29, 0, 6.2, 0, root);
          const turret = new THREE.Group(); turret.position.y = 15; root.add(turret);
          const head = std('#8a8a96', { metalness: 0.6, roughness: 0.3 });
          o.paints.push(head);
          this.mesh(this.geo.sphere, head, 9.5, 9.5, 9.5, 0, 0, 0, turret);
          const b1 = this.mesh(this.geo.cyl, std('#2a2a32', { metalness: 0.5 }), 1.6, 20, 1.6, -2.5, 0, -12, turret); b1.rotation.x = Math.PI / 2;
          const b2 = this.mesh(this.geo.cyl, std('#2a2a32', { metalness: 0.5 }), 1.6, 20, 1.6, 2.5, 0, -12, turret); b2.rotation.x = Math.PI / 2;
          this.mesh(this.geo.sphere, glowMat('#ff4a8a', 3), 1.6, 1.6, 1.6, 0, 4, -8, turret);
          Object.assign(o, { root, turret });
          break;
        }
        case 'mortar': {
          const root = new THREE.Group();
          const dome = std('#c4a45a', { roughness: 0.6, metalness: 0.2 });
          o.paints.push(dome);
          this.mesh(this.geo.hemi, dome, 13, 11, 13, 0, 0, 0, root);
          this.mesh(this.geo.cyl, std('#4a3e22'), 14, 2, 14, 0, 1, 0, root);
          const turret = new THREE.Group(); turret.position.y = 9; root.add(turret);
          const tube = this.mesh(this.geo.cyl, std('#24221e', { metalness: 0.5 }), 3.4, 20, 3.4, 0, 8, -4, turret);
          tube.rotation.x = -0.55;
          this.mesh(this.geo.cyl, glowMat('#ff8a20', 2), 2.4, 0.6, 2.4, 0, 16.5, -9.2, turret).rotation.x = -0.55;
          Object.assign(o, { root, turret });
          break;
        }
        case 'chopper': {
          const root = new THREE.Group(), tilt = new THREE.Group();
          root.add(tilt);
          const hull = std('#9aa0aa', { metalness: 0.5, roughness: 0.35 });
          o.paints.push(hull);
          const bodyM = this.mesh(this.geo.bolt, hull, 6.5, 7, 6.5, 0, 0, 0, tilt); bodyM.rotation.x = Math.PI / 2;
          this.mesh(this.geo.sphere, std('#5ad0f0', { metalness: 0.9, roughness: 0.1, emissive: hex('#1a6a8a'), emissiveIntensity: 0.6 }), 5, 4.2, 5.5, 0, 1.5, -7, tilt);
          const boom = this.mesh(this.geo.cyl, hull, 1.6, 26, 1.6, 0, 1.5, 17, tilt); boom.rotation.x = Math.PI / 2;
          this.mesh(B, std('#e46aa8'), 1, 8, 5, 0, 5, 29, tilt);
          this.mesh(B, std('#5a5e66'), 1.2, 1.2, 18, -6, -7, 0, tilt);
          this.mesh(B, std('#5a5e66'), 1.2, 1.2, 18, 6, -7, 0, tilt);
          this.mesh(B, std('#5a5e66'), 12, 1, 1, 0, -6, -4, tilt);
          this.mesh(this.geo.sphere, glowMat('#ff3a2a', 3), 1.2, 1.2, 1.2, -6.5, 0, 0, tilt);
          this.mesh(this.geo.sphere, glowMat('#3aff8a', 3), 1.2, 1.2, 1.2, 6.5, 0, 0, tilt);
          const rotor = new THREE.Group(); rotor.position.y = 8; tilt.add(rotor);
          this.mesh(B, std('#2a2c32'), 44, 0.6, 2.6, 0, 0, 0, rotor);
          this.mesh(B, std('#2a2c32'), 2.6, 0.6, 44, 0, 0, 0, rotor);
          const disc = new THREE.Mesh(this.geo.flat, new THREE.MeshBasicMaterial({ map: this.tex.glow, color: 0x9aa4b4, transparent: true, opacity: 0.22, depthWrite: false }));
          disc.scale.set(46, 1, 46); disc.position.y = 8.4; tilt.add(disc);
          const tail = new THREE.Group(); tail.position.set(1.2, 5, 29); tilt.add(tail);
          this.mesh(B, std('#2a2c32'), 0.4, 12, 1.4, 0, 0, 0, tail);
          Object.assign(o, { root, tilt, rotor, tail });
          break;
        }
        case 'fortgun': {
          const root = new THREE.Group();
          const red = std('#d4302a', { roughness: 0.4, metalness: 0.3, emissive: hex('#ff2a1a'), emissiveIntensity: 0.25, flatShading: true });
          o.paints.push(red);
          const pyr = this.mesh(this.geo.pyramid, red, 15, 24, 15, 0, 0, 0, root);
          pyr.rotation.y = Math.PI / 2 - e.a;
          const gem = this.mesh(this.geo.sphere, glowMat('#ffb070', 3), 2.2, 2.2, 2.2, 0, 24, 0, root);
          this.mesh(this.geo.ring, glowMat('#ff3a2a', 2, { transparent: true, depthWrite: false }), 19, 1, 19, 0, 0.4, 0, root).castShadow = false;
          Object.assign(o, { root, gem });
          break;
        }
        case 'core': {
          const root = new THREE.Group();
          const red = std('#a8201c', { roughness: 0.5, metalness: 0.3 });
          o.paints.push(red);
          this.mesh(new THREE.CylinderGeometry(1, 1.12, 1, 5), red, 17, 6, 17, 0, 3, 0, root);
          this.mesh(new THREE.CylinderGeometry(1, 1, 1, 5), std('#3a0806'), 10, 0.5, 10, 0, 6.2, 0, root);
          const shell = this.mesh(this.geo.sphere, std('#7a1410', { roughness: 0.3, metalness: 0.6 }), 6, 6, 6, 0, 8, 0, root);
          const heart = this.mesh(this.geo.sphere, glowMat('#ff5a2a', 3.4), 9, 9, 9, 0, 17, 0, root);
          heart.castShadow = false;
          const r1 = this.mesh(new THREE.TorusGeometry(1, 0.06, 8, 48), glowMat('#ffc890', 2.6), 15, 15, 15, 0, 17, 0, root);
          const r2 = this.mesh(new THREE.TorusGeometry(1, 0.05, 8, 48), glowMat('#ff8a40', 2.4), 19, 19, 19, 0, 17, 0, root);
          Object.assign(o, { root, shell, heart, r1, r2 });
          break;
        }
      }
      o.root.traverse(m => { if (m.isMesh && m.material && m.material.isMeshStandardMaterial) m.receiveShadow = true; });
      o.baseEmissive = o.paints.map(p => ({ c: p.emissive.clone(), i: p.emissiveIntensity }));
      this.dyn.add(o.root);
      return o;
    }

    disposeEnemy(o) {
      this.dyn.remove(o.root);
      o.root.traverse(m => {
        if (!m.isMesh) return;
        const shared = Object.values(this.geo).includes(m.geometry);
        if (!shared) m.geometry.dispose();
        if (m.material && m.material.dispose) m.material.dispose();
      });
      if (o.tread) o.tread.dispose();
    }

    /* ---------------- events ---------------- */

    onEvent(ev, g) {
      if (!this.active) return;
      this.ensureStage(g);
      switch (ev.type) {
        case 'tile': {
          this.mapTex.redraw(ev.tx, ev.ty);
          this.texDirty = true;
          const v = g.tileAt(ev.tx, ev.ty), idx = ev.ty * g.stage.MW + ev.tx;
          if (v === T.RUBBLE && this.blockIndex.has(idx)) {
            const i = this.blockIndex.get(idx);
            for (const m of this.blockParts) { setInst(m, i, 0, -999, 0, 0, 0.001, 0.001, 0.001); m.instanceMatrix.needsUpdate = true; }
            this.blockIndex.delete(idx);
            const key = g.stage.theme.key;
            this.burstDebris((ev.tx + 0.5) * TS, 8, (ev.ty + 0.5) * TS, 14, key === 'city' ? ['#3a4252', '#ffd27a', '#2a6ad8'] : key === 'base' ? ['#7a5038', '#3a6ae0'] : ['#6a6e78', '#9a9ea8', '#3a3c44'], 1.4);
          }
          break;
        }
        case 'explode': {
          const sz = ev.size || 1;
          const alt = ev.flying ? 70 : ev.enemy === 'fortgun' ? PLAT + 14 : ev.enemy === 'core' ? PLAT + 16 : 10;
          this.explosion(ev.x, alt, ev.y, sz);
          const cols = { tank: ['#c46a9a', '#e8a8c8', '#3a3440'], turret: ['#4a4a54', '#8a8a96'], mortar: ['#c4a45a', '#24221e'], chopper: ['#9aa0aa', '#2a2c32', '#5ad0f0'], fortgun: ['#d4302a', '#7a1410'], core: ['#a8201c', '#ff5a2a', '#ffc890'], block: ['#6a6e78'] }[ev.enemy] || ['#666'];
          this.burstDebris(ev.x, alt, ev.y, Math.round(8 * sz), cols, sz);
          if (!ev.flying) { this.mapTex.crater(ev.x, ev.y, 9 + sz * 4, (ev.x * 13 + ev.y) | 0); this.texDirty = true; }
          if (ev.points) this.popups.push({ x: ev.x, y: ev.y, alt: alt + 26, text: '+' + ev.points, life: 1.2, max: 1.2 });
          break;
        }
        case 'blast': {
          const enemy = ev.owner === 'enemy';
          this.fireball(ev.x, 4, ev.y, ev.r / 34, enemy ? [[3, 1.4, 2.4], [2, 0.6, 1.4]] : [[3.2, 2.4, 1.2], [2.6, 0.9, 0.2]]);
          this.ring(ev.x, ev.y, ev.r * 1.5, enemy ? '#ff9ad8' : '#ffd27a');
          this.addFlash(ev.x, 20, ev.y, enemy ? '#ff6ac0' : '#ffaa40', 5, 0.4, 300);
          this.dustRing(ev.x, ev.y, ev.r * 0.6, 14);
          this.mapTex.crater(ev.x, ev.y, ev.r * 0.35, (ev.x * 7 + ev.y) | 0);
          this.texDirty = true;
          this.shake = Math.max(this.shake, ev.r / 8);
          break;
        }
        case 'hit': this.sparks(ev.x, 12, ev.y, 16, [[3, 3, 3], [3, 2.4, 0.6]], 170); this.addFlash(ev.x, 14, ev.y, '#ffe060', 2, 0.1, 120); break;
        case 'spark': this.sparks(ev.x, 14, ev.y, 10, ev.enemy ? [[3, 1.4, 2.4], [2, 2, 2]] : [[1.2, 2.4, 3], [2.6, 2.6, 2.6]], 130); break;
        case 'intercept':
          this.sparks(ev.x, 15, ev.y, 18, [[3, 2.4, 0.6], [3, 1.4, 2.4], [3, 3, 3]], 190);
          this.addFlash(ev.x, 15, ev.y, '#ff9ad8', 3, 0.2, 140);
          break;
        case 'shoot': {
          const fx = Math.sin(ev.a), fz = -Math.cos(ev.a);
          const y = this.playerBaseY + 16;
          this.addFlash(ev.x, y, ev.y, '#7ad0ff', 3.5, 0.09, 180);
          for (let i = 0; i < 8; i++) this.glow.add({ x: ev.x, y, z: ev.y, vx: fx * rnd(60, 200) + rnd(-40, 40), vy: rnd(-20, 40), vz: fz * rnd(60, 200) + rnd(-40, 40), life: rnd(0.08, 0.18), s0: rnd(5, 9), s1: 1, c0: [1.6, 2.8, 3.2], c1: [0.4, 1, 2], drag: 4 });
          this.glow.add({ x: ev.x, y, z: ev.y, life: 0.07, s0: 26, s1: 10, c0: [2, 3, 3.4], c1: [0.4, 1.2, 2] });
          break;
        }
        case 'enemyShoot': {
          const y = ev.kind === 'plasma' ? 60 : 15;
          this.addFlash(ev.x, y, ev.y, ev.kind === 'plasma' ? '#ff4a2a' : '#ff6ac0', 2, 0.1, 110);
          this.glow.add({ x: ev.x, y, z: ev.y, life: 0.08, s0: 18, s1: 6, c0: [3, 1.2, 2.2], c1: [1, 0.2, 0.6] });
          break;
        }
        case 'mortarFire':
          this.addFlash(ev.x, 24, ev.y, '#ff8a20', 3, 0.15, 160);
          for (let i = 0; i < 6; i++) this.smoke.add({ x: ev.x + rnd(-4, 4), y: 26, z: ev.y + rnd(-4, 4), vx: rnd(-10, 10), vy: rnd(30, 60), vz: rnd(-10, 10), life: rnd(0.8, 1.4), s0: 12, s1: 40, c0: [0.5, 0.48, 0.45], c1: [0.2, 0.2, 0.2], a0: 0.6, drag: 1.5 });
          break;
        case 'land':
          this.ring(ev.x, ev.y, 110, '#c8c8d2');
          this.dustRing(ev.x, ev.y, 20, 26);
          this.shake = Math.max(this.shake, 10);
          break;
        case 'jump':
        case 'wheelie':
        case 'roll': {
          const p = g.player;
          this.dustRing(p.x, p.y, 14, ev.type === 'jump' ? 22 : 8);
          if (ev.type === 'jump') {
            this.ring(p.x, p.y, 60, '#5a90ff');
            for (let i = 0; i < 24; i++) this.glow.add({ x: p.x + rnd(-10, 10), y: 2, z: p.y + rnd(-10, 10), vx: rnd(-30, 30), vy: rnd(80, 240), vz: rnd(-30, 30), life: rnd(0.3, 0.7), s0: 8, s1: 1, c0: [1, 1.8, 3.2], c1: [0.2, 0.4, 1.2], drag: 2 });
          }
          break;
        }
        case 'lift': {
          const p = g.player;
          this.ring(p.x, p.y, 90, '#5ad0ff');
          this.addFlash(p.x, 20, p.y, '#5ad0ff', 4, 0.5, 260);
          break;
        }
        case 'playerDie':
          this.explosion(ev.x, 10, ev.y, 2.2);
          this.burstDebris(ev.x, 12, ev.y, 26, ['#c8ced8', '#eef1f5', '#2a50d0', '#d8b25a', '#d8dde4'], 2);
          this.flash = 0.45; this.flashColor.set(1, 1, 1);
          this.shake = 20;
          break;
        case 'coreOpen': {
          const f = g.stage.fort;
          this.flash = 0.35; this.flashColor.setRGB(1, 0.35, 0.22);
          this.burstDebris(f.cx * TS, PLAT + 20, f.cy * TS, 40, ['#ff5a3a', '#ffb0a0', '#ff2a1a'], 2.2, true);
          this.ring(f.cx * TS, f.cy * TS, 180, '#ff5a3a');
          this.shake = Math.max(this.shake, 12);
          break;
        }
        case 'stageClear': this.flash = 0.55; this.flashColor.set(1, 1, 1); this.shake = 22; break;
        case 'extraLife': this.popups.push({ x: ev.x, y: ev.y, alt: 50, text: '1UP', life: 1.8, max: 1.8, color: PINK }); break;
      }
    }

    /* ---------------- effects ---------------- */

    addFlash(x, y, z, color, intensity, life, dist) {
      this.flashes.push({ x, y, z, color: new THREE.Color(color), intensity, life, max: life, dist: dist || 220 });
    }

    sparks(x, y, z, n, cols, speed) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, u = rnd(-0.3, 1), sp = rnd(0.3, 1) * speed;
        const c = pick(cols);
        this.glow.add({ x, y, z, vx: Math.cos(a) * sp, vy: u * sp, vz: Math.sin(a) * sp, life: rnd(0.25, 0.7), s0: rnd(3, 6), s1: 1, c0: c, c1: [c[0] * 0.5, c[1] * 0.25, c[2] * 0.1], grav: 380, drag: 1.2, floor: true });
      }
    }

    fireball(x, y, z, power, cols) {
      const n = Math.round(16 * power);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * TAU, e = rnd(-0.1, 1), sp = rnd(20, 110) * Math.sqrt(power);
        this.glow.add({ x: x + rnd(-4, 4), y: y + rnd(0, 6), z: z + rnd(-4, 4), vx: Math.cos(a) * sp, vy: e * sp + 20, vz: Math.sin(a) * sp, life: rnd(0.35, 0.8), s0: rnd(14, 24) * power, s1: rnd(30, 52) * power, c0: cols[0], c1: cols[1], drag: 3.5, hold: 2.2 });
      }
      this.glow.add({ x, y: y + 6, z, life: 0.16, s0: 70 * power, s1: 110 * power, c0: [3.2, 3, 2.6], c1: [2.4, 1.2, 0.4] });
    }

    explosion(x, y, z, power) {
      this.fireball(x, y, z, power, [[3.2, 2.6, 1.4], [2.4, 0.7, 0.15]]);
      this.sparks(x, y, z, Math.round(28 * power), [[3.2, 2.8, 1.2], [3.2, 1.6, 0.4], [3, 3, 3]], 260 * Math.sqrt(power));
      for (let i = 0; i < 9 * power; i++) {
        const a = Math.random() * TAU, sp = rnd(10, 50);
        this.smoke.add({ x: x + rnd(-8, 8), y: y + rnd(0, 10), z: z + rnd(-8, 8), vx: Math.cos(a) * sp, vy: rnd(25, 70), vz: Math.sin(a) * sp, life: rnd(1.3, 2.6), s0: rnd(16, 26) * power, s1: rnd(55, 90) * power, c0: [0.32, 0.28, 0.26], c1: [0.1, 0.1, 0.11], a0: 0.75, drag: 1.2, fadeIn: 0.15 });
      }
      // embers that keep rising
      for (let i = 0; i < 6 * power; i++) this.glow.add({ x: x + rnd(-10, 10), y: y + rnd(0, 10), z: z + rnd(-10, 10), vx: rnd(-20, 20), vy: rnd(40, 110), vz: rnd(-20, 20), life: rnd(0.9, 1.8), s0: 3.5, s1: 1, c0: [3, 1.6, 0.4], c1: [1.2, 0.3, 0.05], drag: 0.6 });
      this.addFlash(x, y + 10, z, '#ffaa50', 4.5 * Math.min(power, 2), 0.45, 260 * Math.sqrt(power));
      if (y < 40) this.ring(x, z, 70 * power, '#ff6a3a');
      this.shake = Math.max(this.shake, 5 * power);
    }

    burstDebris(x, y, z, n, cols, power, glowing) {
      for (let i = 0; i < n; i++) {
        if (this.debris.length >= 320) this.debris.shift();
        const a = Math.random() * TAU, sp = rnd(60, 190) * Math.sqrt(power);
        this.debris.push({
          x, y, z, vx: Math.cos(a) * sp, vy: rnd(90, 260) * Math.sqrt(power), vz: Math.sin(a) * sp,
          rx: rnd(0, TAU), ry: rnd(0, TAU), vrx: rnd(-14, 14), vry: rnd(-14, 14),
          s: rnd(1.6, 4.2) * Math.min(1.6, power), life: rnd(1.6, 2.8), col: new THREE.Color(pick(cols)).multiplyScalar(glowing ? 2.5 : 1), trail: Math.random() < 0.35
        });
      }
    }

    ring(x, z, r, color) {
      const slot = this.rings.find(s => s.life <= 0) || this.rings[0];
      slot.life = slot.max = 0.55;
      slot.r = r; slot.x = x; slot.z = z;
      slot.mesh.material.color.copy(hdr(color, 2.2));
      slot.mesh.visible = true;
    }

    dustRing(x, z, r, n) {
      const dc = this.stageRef ? new THREE.Color(global.MAP_THEME[this.stageRef.theme.key].ground[3]) : new THREE.Color('#a29268');
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + rnd(-0.2, 0.2), sp = rnd(40, 110);
        this.smoke.add({ x: x + Math.cos(a) * r, y: 3, z: z + Math.sin(a) * r, vx: Math.cos(a) * sp, vy: rnd(8, 30), vz: Math.sin(a) * sp, life: rnd(0.7, 1.3), s0: 14, s1: 42, c0: [dc.r, dc.g, dc.b], c1: [dc.r * 0.7, dc.g * 0.7, dc.b * 0.7], a0: 0.55, drag: 2.5 });
      }
    }

    /* ---------------- simulation of effects ---------------- */

    update(dt, g) {
      if (!this.active) return;
      this.t += dt;
      this.frameDt += dt;
      this.glow.update(dt);
      this.smoke.update(dt);
      for (const d of this.debris) {
        d.life -= dt;
        d.vy -= 520 * dt;
        d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
        d.rx += d.vrx * dt; d.ry += d.vry * dt;
        if (d.y < d.s * 0.5) { d.y = d.s * 0.5; d.vy *= -0.38; d.vx *= 0.7; d.vz *= 0.7; d.vrx *= 0.7; d.vry *= 0.7; }
        if (d.trail && d.y > 6 && Math.random() < 0.5) this.smoke.add({ x: d.x, y: d.y, z: d.z, vy: 10, vx: 0, vz: 0, life: 0.6, s0: 6, s1: 18, c0: [0.3, 0.28, 0.27], c1: [0.12, 0.12, 0.12], a0: 0.5 });
      }
      this.debris = this.debris.filter(d => d.life > 0);
      for (const r of this.rings) if (r.life > 0) { r.life -= dt; if (r.life <= 0) r.mesh.visible = false; }
      for (const f of this.flashes) f.life -= dt;
      this.flashes = this.flashes.filter(f => f.life > 0);
      for (const p of this.popups) { p.life -= dt; p.alt += 34 * dt; }
      this.popups = this.popups.filter(p => p.life > 0);
      this.shake = Math.max(0, this.shake - dt * 30);
      if (this.flash > 0) this.flash -= dt;
      if (g) this.emitAmbient(dt, g);
      this.adaptQuality(dt);
    }

    /* Continuous emitters: exhaust, trails, core embers, lift sparkles. */
    emitAmbient(dt, g) {
      const p = g.player;
      if (p.alive && g.state === 'play') {
        const fx = Math.sin(p.a), fz = -Math.cos(p.a), rx = Math.cos(p.a), rz = Math.sin(p.a);
        if (p.speed !== 0 && p.alt === 0 && Math.random() < dt * 30) {
          const dc = new THREE.Color(global.MAP_THEME[g.stage.theme.key].ground[3]);
          for (const side of [-1, 1]) this.smoke.add({ x: p.x - fx * 15 + rx * side * 13, y: 2, z: p.y - fz * 15 + rz * side * 13, vx: rnd(-8, 8) - fx * 20, vy: rnd(6, 18), vz: rnd(-8, 8) - fz * 20, life: rnd(0.5, 0.9), s0: 7, s1: 22, c0: [dc.r, dc.g, dc.b], c1: [dc.r * 0.8, dc.g * 0.8, dc.b * 0.8], a0: 0.4, drag: 2 });
        }
        if (p.lift > 0.05 && Math.random() < dt * 40) this.glow.add({ x: p.x + rnd(-16, 16), y: this.playerBaseY - 2, z: p.y + rnd(-16, 16), vx: 0, vy: rnd(-90, -40), vz: 0, life: rnd(0.3, 0.6), s0: 6, s1: 1, c0: [0.8, 2.2, 3.2], c1: [0.2, 0.6, 1.4] });
        if (p.jump && Math.random() < dt * 60) this.glow.add({ x: p.x - fx * 14, y: this.playerBaseY + 6, z: p.y - fz * 14, vx: -fx * 60, vy: -40, vz: -fz * 60, life: 0.35, s0: 10, s1: 2, c0: [1.4, 2, 3.2], c1: [0.3, 0.4, 1.2] });
      }
      for (const s of g.shots) if (Math.random() < dt * 60) this.glow.add({ x: s.x, y: this.playerBaseY + 16, z: s.y, life: 0.16, s0: 7, s1: 1, c0: [0.6, 1.6, 2.6], c1: [0.1, 0.3, 0.8] });
      for (const b of g.eshots) if (b.kind === 'plasma' && Math.random() < dt * 30) this.glow.add({ x: b.x, y: b.flying ? 60 : 15, z: b.y, life: 0.2, s0: 8, s1: 1, c0: [3, 0.8, 0.4], c1: [1, 0.1, 0.05] });
      for (const n of g.grenades) if (Math.random() < dt * 50) this.smoke.add({ x: n.x, y: 10 + n.alt * 80, z: n.y, vx: 0, vy: 5, vz: 0, life: 0.5, s0: 4, s1: 14, c0: [0.7, 0.68, 0.65], c1: [0.3, 0.3, 0.3], a0: 0.5 });
      if (g.coreOpen) {
        const core = g.enemies.find(e => e.type === 'core');
        if (core && Math.random() < dt * 25) this.glow.add({ x: core.x + rnd(-8, 8), y: PLAT + 17, z: core.y + rnd(-8, 8), vx: rnd(-20, 20), vy: rnd(30, 80), vz: rnd(-20, 20), life: rnd(0.5, 1.1), s0: 5, s1: 1, c0: [3, 1.4, 0.5], c1: [1.2, 0.2, 0.05], drag: 0.5 });
      }
      if (g.stage.cleared && Math.random() < dt * 20) {
        const f = g.stage.fort;
        this.smoke.add({ x: f.cx * TS + rnd(-12, 12), y: PLAT, z: f.cy * TS + rnd(-12, 12), vx: rnd(-6, 6), vy: rnd(40, 70), vz: rnd(-6, 6), life: rnd(1.5, 2.5), s0: 18, s1: 60, c0: [0.3, 0.28, 0.27], c1: [0.1, 0.1, 0.1], a0: 0.6 });
      }
      // grit falling from the island's underside near the camera
      if (this.landTiles && Math.random() < dt * 10) {
        const [tx, ty] = pick(this.landTiles);
        const x = (tx + 0.5) * TS, z = (ty + 0.5) * TS;
        if (Math.abs(x - this.camPos.x) + Math.abs(z - this.camPos.z) < 1400) this.smoke.add({ x, y: -SLAB - rnd(20, 120), z, vx: 0, vy: -rnd(20, 50), vz: 0, life: 3, s0: 5, s1: 3, c0: [0.5, 0.45, 0.4], c1: [0.3, 0.28, 0.25], a0: 0.5, fadeIn: 0.2 });
      }
    }

    /* ---------------- per-frame sync ---------------- */

    groundY(x, y) {
      const tile = this.stageRef ? this.stageRef.map[Math.floor(y / TS) * this.stageRef.MW + Math.floor(x / TS)] : 0;
      return tile === T.FORT ? PLAT : 0;
    }

    syncPlayer(g, dt) {
      const p = g.player, P = this.player;
      P.root.visible = p.alive;
      const gy = this.groundY(p.x, p.y);
      this.pGround = this.pGround === undefined ? gy : lerp(this.pGround, gy, damp(14, dt));
      const alt = p.lift * 90 + (p.jump ? p.alt * 70 : 0);
      this.playerBaseY = this.pGround + alt;
      if (!p.alive) return;
      P.root.position.set(p.x, this.playerBaseY, p.y);
      P.root.rotation.y = -p.a;
      P.pitch.rotation.x = p.wheelie * 0.75 + (p.jump ? Math.sin(p.alt * Math.PI) * 0.1 : 0);
      if (p.rollT > 0) {
        const k = 1 - p.rollT / 0.28;
        P.roll.rotation.z = -p.rollDir * ease(k) * TAU;
        P.roll.position.y = 8 + Math.sin(k * Math.PI) * 6;
      } else {
        P.roll.rotation.z = lerp(P.roll.rotation.z % TAU, -p.turn * 0.05, damp(10, dt));
        P.roll.position.y = 8;
      }
      P.barrel.position.z = p.recoil * 5;
      P.tread.offset.y = -p.tread / 30;
      const sh = p.invuln > 0 && p.invuln < 50;
      this.shieldBubble.visible = sh;
      this.shieldBubble.material.uniforms.time.value = this.t;
      this.liftGlow.visible = p.lift > 0.02;
      if (this.liftGlow.visible) {
        const hh = Math.max(1, alt);
        this.liftGlow.scale.set(26 * p.lift, hh, 26 * p.lift);
        this.liftGlow.position.y = 2;
        this.liftGlow.material.opacity = 0.7 * p.lift;
      }
    }

    syncEnemies(g, dt) {
      const mark = (this.mark = (this.mark || 0) + 1);
      const cam = this.camPos;
      for (const e of g.enemies) {
        let o = this.enemyObjs.get(e.id);
        if (!o) { o = this.makeEnemy(e); this.enemyObjs.set(e.id, o); }
        o.mark = mark;
        const far = Math.abs(e.x - cam.x) + Math.abs(e.y - cam.z) > 2600;
        o.root.visible = !far;
        if (far) continue;
        const gy = (e.type === 'fortgun' || e.type === 'core') ? PLAT : this.groundY(e.x, e.y);
        const fl = e.hitFlash > 0;
        o.paints.forEach((m, i) => {
          if (fl) { m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = 1.6; }
          else { m.emissive.copy(o.baseEmissive[i].c); m.emissiveIntensity = o.baseEmissive[i].i; }
        });
        switch (e.type) {
          case 'tank':
            o.root.position.set(e.x, gy, e.y);
            o.root.rotation.y = -e.a;
            o.turret.rotation.y = -(e.ta - e.a);
            o.tread.offset.y = -e.tread / 26;
            break;
          case 'turret':
          case 'mortar':
            o.root.position.set(e.x, gy, e.y);
            o.turret.rotation.y = -e.ta;
            break;
          case 'chopper': {
            const alt = 68 + Math.sin(e.t * 2 + e.id) * 4;
            o.root.position.set(e.x, alt, e.y);
            o.root.rotation.y = -e.a;
            o.tilt.rotation.x = -0.18;
            o.tilt.rotation.z = Math.sin(e.t * 1.3) * 0.08;
            o.rotor.rotation.y = this.t * 24;
            o.tail.rotation.x = this.t * 40;
            break;
          }
          case 'fortgun':
            o.root.position.set(e.x, gy, e.y);
            o.gem.scale.setScalar(2.2 + Math.sin(this.t * 6 + e.id) * 0.5);
            break;
          case 'core': {
            o.root.position.set(e.x, gy, e.y);
            const open = g.coreOpen, pulse = 0.5 + 0.5 * Math.sin(this.t * 8);
            o.shell.visible = !open;
            o.heart.visible = o.r1.visible = o.r2.visible = open;
            if (open) {
              o.heart.scale.setScalar(8 + pulse * 2.5);
              o.r1.rotation.set(this.t * 2.1, this.t * 1.3, 0);
              o.r2.rotation.set(-this.t * 1.4, 0, this.t * 1.8);
            }
            break;
          }
        }
      }
      for (const [id, o] of this.enemyObjs) if (o.mark !== mark) { this.disposeEnemy(o); this.enemyObjs.delete(id); }
    }

    syncProjectiles(g) {
      const by = this.playerBaseY || 0;
      let n = 0;
      for (const s of g.shots) {
        if (n >= 16) break;
        const sp = Math.hypot(s.vx, s.vy) || 1;
        _v.set(s.vx / sp, 0, s.vy / sp);
        _q.setFromUnitVectors(_up, _v);
        _p.set(s.x, by + 16, s.y); _s.set(2.2, 9, 2.2);
        _m.compose(_p, _q, _s);
        this.boltMesh.setMatrixAt(n++, _m);
      }
      this.boltMesh.count = n;
      this.boltMesh.instanceMatrix.needsUpdate = true;

      n = 0;
      for (const b of g.eshots) {
        if (n >= 64) break;
        const plasma = b.kind === 'plasma';
        const r = plasma ? 5 + Math.sin(this.t * 30 + n) * 1 : 3.6;
        setInst(this.eshotMesh, n, b.x, b.flying ? 60 : 15, b.y, 0, r, r, r);
        this.eshotMesh.setColorAt(n, plasma ? _c.setRGB(3.2, 0.9, 0.4) : _c.setRGB(3, 1.3, 2.3));
        n++;
      }
      this.eshotMesh.count = n;
      this.eshotMesh.instanceMatrix.needsUpdate = true;
      if (this.eshotMesh.instanceColor) this.eshotMesh.instanceColor.needsUpdate = true;

      n = 0;
      let mk = 0;
      for (const gr of g.grenades) {
        if (n >= 24) break;
        setInst(this.nadeMesh, n++, gr.x, 10 + gr.alt * 80, gr.y, this.t * 8, 3.4, 3.4, 3.4, this.t * 6);
        if (gr.owner === 'enemy' && mk < 24) {
          const pulse = 1 + Math.sin(this.t * 14) * 0.08;
          setInst(this.markMesh, mk++, gr.x1, this.groundY(gr.x1, gr.y1) + 1.5, gr.y1, 0, gr.r * pulse, 1, gr.r * pulse);
        }
      }
      this.nadeMesh.count = n;
      this.nadeMesh.instanceMatrix.needsUpdate = true;
      this.markMesh.count = mk;
      this.markMesh.instanceMatrix.needsUpdate = true;

      // floor glow under projectiles and flashes
      const D = this.decals;
      let d = 0;
      const decal = (x, z, r, cr, cg, cb) => {
        if (d >= 200) return;
        setInst(D, d, x, this.groundY(x, z) + 0.9, z, 0, r, 1, r);
        D.setColorAt(d++, _c.setRGB(cr, cg, cb));
      };
      for (const s of g.shots) decal(s.x, s.y, 60, 0.2, 0.55, 0.9);
      for (const b of g.eshots) if (!b.flying) decal(b.x, b.y, 46, 0.8, 0.3, 0.6);
      for (const f of this.flashes) { const k = f.life / f.max; decal(f.x, f.z, f.dist * 0.9, f.color.r * k, f.color.g * k, f.color.b * k); }
      for (const l of this.liftObjs) if (!l.lift.used) decal(l.o.position.x, l.o.position.z, 110, 0.15, 0.5, 0.7);
      if (g.coreOpen) {
        const core = g.enemies.find(e => e.type === 'core');
        if (core) decal(core.x, core.y, 240, 0.9, 0.25, 0.1);
      }
      D.count = d;
      D.instanceMatrix.needsUpdate = true;
      if (D.instanceColor) D.instanceColor.needsUpdate = true;

      // debris
      const M = this.debrisMesh;
      let k = 0;
      for (const db of this.debris) {
        const sc = db.s * Math.min(1, db.life * 2);
        setInst(M, k, db.x, db.y, db.z, db.ry, sc, sc, sc, db.rx);
        M.setColorAt(k++, db.col);
      }
      M.count = k;
      M.instanceMatrix.needsUpdate = true;
      if (M.instanceColor) M.instanceColor.needsUpdate = true;

      for (const r of this.rings) {
        if (r.life <= 0) continue;
        const k2 = 1 - r.life / r.max, rr = 4 + (r.r - 4) * (1 - Math.pow(1 - k2, 3));
        r.mesh.position.set(r.x, this.groundY(r.x, r.z) + 1.6, r.z);
        r.mesh.scale.set(rr, 1, rr);
        r.mesh.material.opacity = 1 - k2;
      }
    }

    syncLights() {
      const list = this.flashes.slice().sort((a, b) => b.intensity * b.life / b.max - a.intensity * a.life / a.max);
      this.pool.forEach((l, i) => {
        const f = list[i];
        if (!f) { l.intensity = 0; return; }
        l.position.set(f.x, f.y, f.z);
        l.color.copy(f.color);
        l.distance = f.dist;
        l.intensity = f.intensity * (f.life / f.max);
      });
    }

    syncWorld(g) {
      const t = this.t;
      if (this.blockLights) {
        this.blockLights.material.color.copy(Math.floor(t * 2) % 2 ? hdr('#ff3a2a', 3) : hdr('#3a0a08', 1));
      }
      if (this.waterMat) this.waterMat.uniforms.time.value = t;
      for (const l of this.liftObjs) {
        l.o.visible = !l.lift.used;
        l.ring.rotation.y = t * 1.2;
        l.ring.scale.setScalar(28 + Math.sin(t * 4) * 1.5);
        l.ring2.position.y = 1.4 + ((t * 30) % 60);
        l.ring2.material.opacity = 1 - ((t * 30) % 60) / 60;
        l.beam.material.opacity = 0.55 + Math.sin(t * 5) * 0.15;
      }
      for (const j of this.jumpObjs) {
        const k = (t * 1.6 + j.position.x * 0.01) % 1;
        j.scale.setScalar(6 + k * 18);
        j.material.opacity = 1 - k;
        j.position.y = 1.3 + k * 10;
      }
      const cleared = g.stage.cleared;
      const fortAlive = g.enemies.some(e => e.type === 'fortgun');
      this.shield.visible = this.shieldWire.visible = fortAlive && !cleared;
      this.shield.material.uniforms.time.value = t;
      this.shieldWire.rotation.y = t * 0.2;
      this.hole.visible = cleared;
      const beaconCol = cleared ? hdr('#2dd4bf', 1.4) : g.coreOpen ? hdr('#ff7a2a', 1.6) : hdr('#ff4a2a', 1.2);
      this.beacon.material.color.copy(beaconCol);
      this.beacon.material.opacity = 0.75 + Math.sin(t * 3) * 0.15;
      this.tipMat.color.copy(cleared ? hdr('#2dd4bf', 3) : hdr('#ff3a2a', 2 + Math.sin(t * 5) * 1.2));
      this.fortTrim.material.color.copy(cleared ? hdr('#2dd4bf', 2.5) : hdr('#ff3a2a', 1.6 + Math.sin(t * 5) * 0.9));

      // the exit arrow hologram
      const p = g.player;
      const showArrow = p.alive && g.state === 'play' && !this.hideHud;
      this.arrow.visible = this.arrowRing.visible = showArrow;
      if (showArrow) {
        const ga = g.guideAngle(p.x, p.y), fx = Math.sin(ga), fz = -Math.cos(ga);
        const ax = p.x + fx * 62, az = p.y + fz * 62;
        const gy = this.groundY(ax, az);
        this.arrow.position.set(ax, this.playerBaseY + 34 + Math.sin(t * 4) * 3, az);
        this.arrow.rotation.y = -ga;
        this.arrow.material.opacity = 0.65 + Math.sin(t * 6) * 0.25;
        this.arrowRing.position.set(ax, gy + 1.2, az);
        this.arrowRing.scale.setScalar(12 + Math.sin(t * 4) * 1.5);
      }

      // space motion
      this.stars.material.uniforms.time.value = t;
      this.planetBody.material.uniforms.time.value = t;
      this.planet.rotation.y = t * 0.01;
      const A = this.asteroids;
      this.astData.forEach((a, i) => {
        setInst(A, i, a.x, a.y + Math.sin(t * 0.2 + i) * a.vy * 4, a.z, a.ry + t * a.vr * 0.3, a.s, a.s * 0.8, a.s, a.rx + t * a.vr * 0.2);
      });
      A.instanceMatrix.needsUpdate = true;
      if (this.isletData) for (const d of this.isletData) { d.g.position.y = d.y + Math.sin(t * 0.3 + d.ph) * 18; d.g.rotation.y += 0.0004; }

      // dust motes wrap around the camera
      const dp = this.dustPos, c = this.camPos;
      for (let i = 0; i < dp.length; i += 3) {
        dp[i] = c.x + ((dp[i] - c.x + 2100) % 1400 + 1400) % 1400 - 700;
        dp[i + 1] = c.y + ((dp[i + 1] - c.y + 2100) % 1400 + 1400) % 1400 - 700;
        dp[i + 2] = c.z + ((dp[i + 2] - c.z + 2100) % 1400 + 1400) % 1400 - 700;
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
    }

    /* ---------------- camera ---------------- */

    cameraTarget(g) {
      const p = g.player, t = this.t;
      const base = new THREE.Vector3(p.x, this.playerBaseY || 0, p.y);
      const a = g.camA, fx = Math.sin(a), fz = -Math.cos(a);
      const back = 150 + p.lift * 120 + (p.jump ? p.alt * 40 : 0);
      const height = 92 + p.lift * 170 + (p.jump ? p.alt * 30 : 0);
      const chase = { pos: new THREE.Vector3(p.x - fx * back, base.y + height, p.y - fz * back), look: new THREE.Vector3(p.x + fx * 120, base.y + 8, p.y + fz * 120), k: 9 };
      const orbit = (cx, cy, cz, R, Hh, ang, lookY) => ({ pos: new THREE.Vector3(cx + Math.sin(ang) * R, cy + Hh, cz - Math.cos(ang) * R), look: new THREE.Vector3(cx, cy + (lookY || 0), cz) });

      if (this.hideHud) {
        // attract mode: a rotating set of cinematic shots
        const shot = Math.floor(t / 7) % 4, k = (t % 7) / 7;
        if (g.state === 'clear' || g.state === 'dying' || g.state === 'gameover') {
          const f = g.stage.fort;
          const c = g.state === 'clear' ? new THREE.Vector3(f.cx * TS, PLAT, f.cy * TS) : base;
          return Object.assign(orbit(c.x, c.y, c.z, 320, 190, t * 0.25, 10), { k: 2 });
        }
        if (shot === 0) return chase;
        if (shot === 1) {
          const rx = Math.cos(a), rz = Math.sin(a);
          return { pos: new THREE.Vector3(p.x + rx * 110 + fx * lerp(90, -60, k), base.y + 26, p.y + rz * 110 + fz * lerp(90, -60, k)), look: new THREE.Vector3(p.x, base.y + 12, p.y), k: 3 };
        }
        if (shot === 2) return Object.assign(orbit(p.x, base.y, p.y, 260, 300, a + Math.PI + t * 0.18, 0), { k: 2.5 });
        return { pos: new THREE.Vector3(p.x + fx * 150, base.y + 40, p.y + fz * 150), look: new THREE.Vector3(p.x - fx * 40, base.y + 10, p.y - fz * 40), k: 3 };
      }

      switch (g.state) {
        case 'intro':
        case 'ready': {
          const dur = g.state === 'intro' ? 2.6 : 1.4;
          const e = ease(clamp(1 - g.stateTimer / dur, 0, 1));
          const sweep = g.state === 'intro' ? 2.4 : 1.2;
          const h = a + Math.PI + (1 - e) * sweep;
          const R = lerp(g.state === 'intro' ? 620 : 360, back, e), Hh = lerp(g.state === 'intro' ? 460 : 260, height, e);
          return { pos: new THREE.Vector3(p.x + Math.sin(h) * R, base.y + Hh, p.y - Math.cos(h) * R), look: base.clone().lerp(chase.look, e), k: 30 };
        }
        case 'dying':
        case 'gameover':
          return Object.assign(orbit(p.x, 0, p.y, 260, 170, a + Math.PI + t * 0.35, 0), { k: 1.6 });
        case 'clear': {
          const f = g.stage.fort;
          return Object.assign(orbit(f.cx * TS, PLAT, f.cy * TS, 340, 210, a + Math.PI + t * 0.3, 10), { k: 1.8 });
        }
      }
      return chase;
    }

    updateCamera(g, dt) {
      const tg = this.cameraTarget(g);
      if (!this.camInit) { this.camPos.copy(tg.pos); this.camLook.copy(tg.look); this.camInit = true; }
      const k = damp(tg.k, dt);
      this.camPos.lerp(tg.pos, k);
      this.camLook.lerp(tg.look, k);
      const cam = this.camera;
      cam.position.copy(this.camPos);
      if (this.shake > 0) cam.position.add(_v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(this.shake * 0.6));
      cam.lookAt(this.camLook);
      const fov = 56 + (Math.abs(g.player.speed) > 100 ? 3 : 0) + (g.player.jump ? 6 : 0);
      if (Math.abs(cam.fov - fov) > 0.05) {
        cam.fov = lerp(cam.fov, fov, damp(3, dt));
        cam.updateProjectionMatrix();
      }
      // the sun's shadow box follows the action
      const focus = this.camLook;
      this.sun.target.position.copy(focus);
      this.sun.position.copy(focus).addScaledVector(this.sunDir, 1200);
      this.sky.position.copy(cam.position);
      this.stars.position.copy(cam.position);
    }

    /* ---------------- frame ---------------- */

    render(g) {
      if (!this.active) return;
      this.ensureStage(g);
      const dt = Math.min(0.1, this.frameDt);
      this.frameDt = 0;
      this.syncPlayer(g, dt);
      this.updateCamera(g, dt);
      this.syncEnemies(g, dt);
      this.syncProjectiles(g);
      this.syncLights();
      this.syncWorld(g);
      this.glow.sync();
      this.smoke.sync();
      this.texClock += dt;
      if (this.texDirty && this.texClock > 0.2) { this.floorTex.needsUpdate = true; this.texDirty = false; this.texClock = 0; }

      const fu = this.final.uniforms;
      fu.time.value = this.t;
      fu.flash.value = Math.max(0, this.flash) * 0.6;
      fu.flashColor.value.copy(this.flashColor);
      this.composer.render();

      // 2D overlay: popups, minimap and the shared HUD
      const c = this.ctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      c.clearRect(0, 0, this.w, this.h);
      this.drawPopups();
      if (!this.hideHud) {
        this.drawMinimap(g);
        this.hud.t = this.t;
        this.hud.drawHUD(g);
        this.hud.drawMessage(g);
      }
    }

    drawPopups() {
      const c = this.ctx, u = this.hud.ui;
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      for (const pp of this.popups) {
        _v.set(pp.x, pp.alt, pp.y).project(this.camera);
        if (_v.z > 1) continue;
        const x = (_v.x * 0.5 + 0.5) * this.w, y = (-_v.y * 0.5 + 0.5) * this.h;
        c.globalAlpha = clamp(pp.life / pp.max * 2, 0, 1);
        c.font = '700 ' + Math.round(18 * u) + 'px Rajdhani, "Segoe UI", sans-serif';
        c.fillStyle = pp.color || '#ffffff';
        c.shadowColor = 'rgba(74,20,56,0.95)';
        c.shadowBlur = 6 * u;
        c.fillText(pp.text, x, y);
      }
      c.restore();
    }

    drawMinimap(g) {
      if (!this.mini || this.w < 700) return;
      const c = this.ctx, u = this.hud.ui, st = g.stage;
      const mh = Math.min(this.h * 0.42, 420 * u), mw = mh * this.mini.width / this.mini.height;
      const x = 18 * u, y = this.h / 2 - mh / 2;
      c.save();
      global.roundRectPath(c, x - 6 * u, y - 6 * u, mw + 12 * u, mh + 12 * u, 8 * u);
      c.fillStyle = 'rgba(6,10,24,0.55)';
      c.fill();
      c.strokeStyle = 'rgba(94,234,212,0.22)';
      c.lineWidth = Math.max(1, u);
      c.stroke();
      c.globalAlpha = 0.85;
      c.drawImage(this.mini, x, y, mw, mh);
      c.globalAlpha = 1;
      const sx = mw / (st.MW * TS), sy = mh / (st.MH * TS);
      // view cone
      const p = g.player;
      c.fillStyle = '#f6a8d8';
      for (const e of g.enemies) {
        if (e.type === 'fortgun' || e.type === 'core') continue;
        c.fillRect(x + e.x * sx - 1.5 * u, y + e.y * sy - 1.5 * u, 3 * u, 3 * u);
      }
      const f = st.fort;
      c.fillStyle = st.cleared ? '#2dd4bf' : Math.floor(this.t * 3) % 2 ? '#ff3a2a' : '#ff9a8a';
      c.beginPath(); c.arc(x + f.cx * TS * sx, y + f.cy * TS * sy, 4 * u, 0, TAU); c.fill();
      if (p.alive) {
        c.translate(x + p.x * sx, y + p.y * sy);
        c.rotate(p.a);
        c.fillStyle = '#5eead4';
        c.beginPath(); c.moveTo(0, -6 * u); c.lineTo(4 * u, 4 * u); c.lineTo(-4 * u, 4 * u); c.closePath(); c.fill();
      }
      c.restore();
    }
  }

  /* Only expose the renderer if WebGL actually works here. */
  try {
    const probe = document.createElement('canvas');
    if (probe.getContext('webgl2') || probe.getContext('webgl')) global.ThreeRenderer = ThreeRenderer;
  } catch (e) { /* no WebGL */ }
})(window);
