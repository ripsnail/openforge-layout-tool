import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const INCH = 25.4;

export function initScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2a3e);
  scene.fog = new THREE.Fog(0x2a2a3e, 50 * INCH, 100 * INCH);

  const camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    1,
    3000,
  );
  camera.position.set(12 * INCH, 10 * INCH, 12 * INCH);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 2 * INCH;
  controls.maxDistance = 60 * INCH;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.target.set(0, 0, 0);
  controls.update();

  const ambientLight = new THREE.AmbientLight(0x8888bb, 1.0);
  scene.add(ambientLight);

  const hemiLight = new THREE.HemisphereLight(0xaabbff, 0x887744, 0.8);
  scene.add(hemiLight);

  const mainLight = new THREE.DirectionalLight(0xfff5e6, 2.0);
  mainLight.position.set(15 * INCH, 25 * INCH, 10 * INCH);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.width = 2048;
  mainLight.shadow.mapSize.height = 2048;
  mainLight.shadow.camera.near = 0.5 * INCH;
  mainLight.shadow.camera.far = 60 * INCH;
  mainLight.shadow.camera.left = -25 * INCH;
  mainLight.shadow.camera.right = 25 * INCH;
  mainLight.shadow.camera.top = 25 * INCH;
  mainLight.shadow.camera.bottom = -25 * INCH;
  mainLight.shadow.bias = -0.001;
  scene.add(mainLight);

  const fillLight = new THREE.DirectionalLight(0xbbccff, 0.6);
  fillLight.position.set(-10 * INCH, 15 * INCH, -10 * INCH);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
  rimLight.position.set(-5 * INCH, 10 * INCH, 15 * INCH);
  scene.add(rimLight);

  const gridSize = 40 * INCH;
  const gridStep = INCH;

  const gridHelper = new THREE.Group();
  const gridMat = new THREE.LineBasicMaterial({
    color: 0x444466,
    transparent: true,
    opacity: 0.4,
  });

  const half = gridSize / 2;
  const steps = Math.floor(gridSize / gridStep);
  for (let i = 0; i <= steps; i++) {
    const pos = -half + i * gridStep;
    const p1 = new THREE.Vector3(pos, 0, -half);
    const p2 = new THREE.Vector3(pos, 0, half);
    const g1 = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    gridHelper.add(new THREE.Line(g1, gridMat));

    const p3 = new THREE.Vector3(-half, 0, pos);
    const p4 = new THREE.Vector3(half, 0, pos);
    const g2 = new THREE.BufferGeometry().setFromPoints([p3, p4]);
    gridHelper.add(new THREE.Line(g2, gridMat));
  }

  const majorMat = new THREE.LineBasicMaterial({
    color: 0x6666aa,
    transparent: true,
    opacity: 0.6,
  });
  for (let i = 0; i <= steps; i += 5) {
    const pos = -half + i * gridStep;
    const p1 = new THREE.Vector3(pos, 0, -half);
    const p2 = new THREE.Vector3(pos, 0, half);
    const g1 = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    gridHelper.add(new THREE.Line(g1, majorMat));

    const p3 = new THREE.Vector3(-half, 0, pos);
    const p4 = new THREE.Vector3(half, 0, pos);
    const g2 = new THREE.BufferGeometry().setFromPoints([p3, p4]);
    gridHelper.add(new THREE.Line(g2, majorMat));
  }

  scene.add(gridHelper);

  const groundGeo = new THREE.PlaneGeometry(
    gridSize + 20 * INCH,
    gridSize + 20 * INCH,
  );
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a4a,
    roughness: 0.9,
    metalness: 0,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  ground.name = "ground";
  scene.add(ground);

  let renderRequested = false;

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    requestRender();
  }
  window.addEventListener("resize", resize);

  function requestRender() {
    if (!renderRequested) {
      renderRequested = true;
      requestAnimationFrame(animate);
    }
  }

  function animate() {
    renderRequested = false;
    if (controls.update()) {
      requestRender();
    }
    renderer.render(scene, camera);
  }

  controls.addEventListener("change", requestRender);
  requestRender();

  return {
    scene,
    camera,
    renderer,
    controls,
    ground,
    gridHelper,
    resize,
    requestRender,
  };
}
