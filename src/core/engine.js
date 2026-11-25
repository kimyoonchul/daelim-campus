// 렌더러·장면·조명·하늘과 프레임 루프.
import * as THREE from 'three';

const TIMES = {
  day: { sky: [0x4f9fe8, 0xbfe3ff], fog: 0xcfe6f7, sun: 0xfff3dc, sunI: 2.5, hemiSky: 0xcfe8ff, hemiGround: 0x8a8f72, hemiI: 1.55, dir: [-0.55, 0.78, 0.45], night: 0 },
  sunset: { sky: [0x35477d, 0xffb27a], fog: 0xf2c4a0, sun: 0xffb070, sunI: 2.1, hemiSky: 0xd8b6c8, hemiGround: 0x7a6a62, hemiI: 1.1, dir: [-0.82, 0.3, 0.3], night: 0.45 },
  night: { sky: [0x070b1c, 0x1c2a4d], fog: 0x18213a, sun: 0x8fa8ff, sunI: 0.9, hemiSky: 0x5065a8, hemiGround: 0x232a40, hemiI: 1.05, dir: [0.4, 0.75, -0.35], night: 1 },
};

export function createEngine(canvas) {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 720;
  const quality = { low: coarse || small };

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !quality.low, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !quality.low;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.3, 1500);

  // 하늘: 위아래 색이 다른 큰 공. 카메라를 따라다닌다.
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() }, stars: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 bottom; uniform float stars; varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        float h = clamp(vDir.y * 1.25 + 0.08, 0.0, 1.0);
        vec3 c = mix(bottom, top, pow(h, 0.65));
        if (stars > 0.01 && vDir.y > 0.0) {
          vec3 g = floor(vDir * 190.0);
          float s = step(0.9965, hash(g)) * stars * smoothstep(0.0, 0.25, vDir.y);
          c += vec3(s);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1200, 24, 12), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  scene.fog = new THREE.Fog(0xffffff, 260, 1050);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = !quality.low;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70;
  sc.right = 70;
  sc.top = 70;
  sc.bottom = -70;
  sc.near = 10;
  sc.far = 420;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  scene.add(sun);
  scene.add(sun.target);

  const sunDir = new THREE.Vector3(-0.55, 0.78, 0.45).normalize();
  const state = { time: 'day', night: 0 };
  const nightListeners = [];

  function setTime(name) {
    const t = TIMES[name] || TIMES.day;
    state.time = name;
    state.night = t.night;
    skyMat.uniforms.top.value.setHex(t.sky[0]);
    skyMat.uniforms.bottom.value.setHex(t.sky[1]);
    skyMat.uniforms.stars.value = name === 'night' ? 1 : 0;
    scene.fog.color.setHex(t.fog);
    sun.color.setHex(t.sun);
    sun.intensity = t.sunI;
    hemi.color.setHex(t.hemiSky);
    hemi.groundColor.setHex(t.hemiGround);
    hemi.intensity = t.hemiI;
    sunDir.set(t.dir[0], t.dir[1], t.dir[2]).normalize();
    for (const f of nightListeners) f(t.night, name);
  }

  /** 그림자 카메라와 하늘을 주인공 주변으로 옮긴다 */
  function follow(x, y, z) {
    const snap = 2;
    const fx = Math.round(x / snap) * snap;
    const fz = Math.round(z / snap) * snap;
    sun.target.position.set(fx, y, fz);
    sun.position.set(fx + sunDir.x * 200, y + sunDir.y * 200, fz + sunDir.z * 200);
    sky.position.copy(camera.position);
  }

  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, quality.low ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();
  setTime('day');

  const updaters = [];
  let last = performance.now();
  const engine = {
    renderer,
    scene,
    camera,
    sun,
    hemi,
    quality,
    state,
    hold: false, // true면 시간 정지(디버그용). tick()으로 수동 진행.
    time: 0,
    setTime,
    follow,
    resize,
    onUpdate: (f) => updaters.push(f),
    onNight: (f) => {
      nightListeners.push(f);
      f(state.night, state.time);
    },
    tick(dt = 1 / 60, n = 1) {
      for (let i = 0; i < n; i++) step(dt);
      renderer.render(scene, camera);
    },
    setShadows(on) {
      renderer.shadowMap.enabled = on;
      sun.castShadow = on;
      scene.traverse((o) => {
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) m.needsUpdate = true;
        }
      });
    },
  };

  function step(dt) {
    engine.time += dt;
    for (const f of updaters) f(dt, engine.time);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!engine.hold) {
      step(dt);
      renderer.render(scene, camera);
    }
  }
  engine.start = () => {
    last = performance.now();
    requestAnimationFrame(frame);
  };
  return engine;
}
