import * as THREE from '../node_modules/three/build/three.module.js';
import { RULES, SKINS } from './game.js';

const laneX = (lane) => (lane - 1) * RULES.laneWidth;
const depth = (x) => 2 - (x - RULES.chickenX) * RULES.worldScale;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 2, .1, 150);
    this.camera.position.set(0, 6.8, 10.5);
    this.camera.lookAt(0, .65, -11);
    this.materials = new Map();
    this.templates = new Map();
    this.obstacleMeshes = new Map();
    this.particles = [];
    this.scene.add(new THREE.HemisphereLight('#fff9e4', '#829e79', 2.4));
    this.sun = new THREE.DirectionalLight('#fff2d0', 3);
    this.sun.position.set(-9, 18, 8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -14, right: 14, top: 18, bottom: -25, near: 1, far: 60 });
    this.sun.shadow.normalBias = .04;
    this.sun.target.position.set(0, 0, -8);
    this.scene.add(this.sun, this.sun.target);
    this.makeTrack();
    this.grassScenery = this.makeScenery(false);
    this.oceanScenery = this.makeScenery(true);
    this.chicken = this.makeChicken();
    this.scene.add(this.chicken);
    this.chickenBody = [...this.chicken.children];
    this.skinModels = new Map(SKINS.map(({ id }) => [id, this.makeSkin(id)]));
    for (const model of this.skinModels.values()) this.chicken.add(model);
    this.rewardMeshes = new Map();
    this.bubble = this.sphere(this.chicken, '#dcffff', [0, .9, 0], [.95, 1.05, .95], .1);
    this.bubble.material = new THREE.MeshPhongMaterial({ color: '#dcffff', transparent: true, opacity: .10, shininess: 100, depthWrite: false });
    this.caughtMesh = this.makeNet(1.4, 1.2, false);
    this.chicken.add(this.caughtMesh);
    this.resize();
  }

  material(color, opacity = 1) {
    const key = `${color}/${opacity}`;
    if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshStandardMaterial({
      color, roughness: .8, transparent: opacity < 1, opacity, depthWrite: opacity === 1,
    }));
    return this.materials.get(key);
  }

  mesh(parent, geometry, color, position = [0, 0, 0], opacity = 1) {
    const mesh = new THREE.Mesh(geometry, this.material(color, opacity));
    mesh.position.set(...position);
    mesh.castShadow = opacity === 1; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  sphere(parent, color, position, scale = [1, 1, 1], opacity = 1) {
    const mesh = this.mesh(parent, new THREE.SphereGeometry(1, 16, 12), color, position, opacity);
    mesh.scale.set(...scale);
    return mesh;
  }

  box(parent, color, size, position) {
    return this.mesh(parent, new THREE.BoxGeometry(...size), color, position);
  }

  rod(parent, from, to, radius, color) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const mesh = this.mesh(parent, new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 7), color);
    mesh.position.copy(a).add(b).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
    return mesh;
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.webgl.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = this.camera.aspect < 1.2 ? 62 : 48;
    this.camera.updateProjectionMatrix();
  }

  makeTrack() {
    this.floor = this.box(this.scene, '#a6c58e', [240, .12, 190], [0, -.22, -50]);
    this.track = this.box(this.scene, '#c7d7a6', [RULES.laneWidth * 3, .12, 112], [0, -.1, -44]);
    for (const x of [-RULES.laneWidth / 2, RULES.laneWidth / 2]) {
      this.box(this.scene, '#fff4ce', [.065, .025, 112], [x, -.025, -44]);
    }
    for (const x of [-RULES.laneWidth * 1.5, RULES.laneWidth * 1.5]) {
      this.box(this.scene, '#e8e7ba', [.14, .10, 112], [x, -.045, -44]);
    }
    this.trackDetails = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), this.material('#b5c791'), 65);
    const dot = new THREE.Object3D();
    dot.scale.set(.018, .012, .06);
    for (let i = 0; i < 65; i++) {
      dot.position.set(((i * 37) % 67) / 10 - 3.3, -.025, -i); dot.updateMatrix();
      this.trackDetails.setMatrixAt(i, dot.matrix);
    }
    this.scene.add(this.trackDetails);
  }

  makeScenery(ocean) {
    const group = new THREE.Group();
    this.scene.add(group);
    group.userData.scroll = [];
    for (let i = 0; i < 32; i++) {
      const item = new THREE.Group();
      const side = i % 2 ? 1 : -1;
      item.position.set(side * (5.9 + (i * 7 % 5) * 1.25), 0, -i * 3.1);
      item.userData.baseZ = item.position.z;
      item.scale.setScalar(.75 + (i * 11 % 7) / 10);
      if (ocean) {
        if (i % 3 === 0) {
          const color = i % 2 ? '#eeb0a9' : '#caa6cb';
          this.rod(item, [0, 0, 0], [0, 1.9, 0], .09, color);
          for (let j = 0; j < 4; j++) {
            const y = .4 + j * .32, sign = j % 2 ? 1 : -1;
            this.rod(item, [0, y, 0], [sign * .45, y + .3, .05], .07, color);
            this.rod(item, [sign * .45, y + .3, .05], [sign * .5, y + .65, .05], .065, color);
          }
        } else {
          for (let j = 0; j < 3; j++) {
            const blade = this.mesh(item, new THREE.ConeGeometry(.12, 1.4 + j * .35, 5), j % 2 ? '#669f89' : '#7bb9a0', [j * .22, .65 + j * .13, 0]);
            blade.rotation.z = (j - 1) * .22;
          }
          this.sphere(item, '#e5ccb0', [-.2, .12, .2], [.4, .2, .25]);
        }
      } else if (i % 3 !== 0) {
        const key = `tree/${i % 4}`;
        if (!this.templates.has(key)) this.templates.set(key, this.makeTree(i % 4));
        const tree = this.templates.get(key).clone(true);
        tree.rotation.y = i * .71;
        item.add(tree);
      } else {
        const key = `garden/${i % 2}`;
        if (!this.templates.has(key)) this.templates.set(key, this.makeGarden(i % 2));
        item.add(this.templates.get(key).clone(true));
      }
      group.add(item); group.userData.scroll.push(item);
    }
    if (!ocean) {
      for (let i = 0; i < 7; i++) {
        const x = (i - 3) * 9;
        this.sphere(group, '#a1bd8c', [x, 1.5, -75 - i % 2 * 9], [9, 5 + i % 3, 7]);
      }
      this.makeGrassSky(group);
      // Low flowers and stones sit outside the lane boundaries.
      for (let i = 0; i < 18; i++) {
        const patch = this.templates.get(`garden/${i % 2}`).clone(true);
        patch.scale.setScalar(.32 + i % 3 * .08);
        patch.position.set((i % 2 ? 1 : -1) * (4.15 + i % 3 * .3), 0, -i * 4.6);
        patch.userData.baseZ = patch.position.z;
        group.add(patch); group.userData.scroll.push(patch);
      }
    } else {
      this.fish = [];
      for (let i = 0; i < 12; i++) {
        const fish = new THREE.Group(); fish.position.set((i % 2 ? -1 : 1) * (5 + i % 3), 2 + i % 4, -8 - i * 4);
        const color = ['#efcc83', '#e7a7b4', '#b2d4b4'][i % 3];
        this.sphere(fish, color, [0, 0, 0], [.38, .19, .14]);
        this.mesh(fish, new THREE.ConeGeometry(.21, .32, 3), color, [-.42, 0, 0]).rotation.z = -Math.PI / 2;
        this.sphere(fish, '#415f57', [.23, .055, .115], [.027, .027, .027]);
        fish.userData.baseX = fish.position.x;
        group.add(fish); this.fish.push(fish);
      }
      this.bubbles = [];
      for (let i = 0; i < 22; i++) this.bubbles.push(this.sphere(group, '#def8f5', [((i * 13) % 21) - 10, i % 7, -5 - i * 2], [.07, .07, .07], .25));
    }
    if (!ocean) this.batchScrollingScenery(group);
    return group;
  }

  batchScrollingScenery(group) {
    const batches = new Map();
    for (const item of group.userData.scroll) {
      item.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const key = `${mesh.geometry.uuid}/${mesh.material.uuid}/${mesh.castShadow}`;
        if (!batches.has(key)) batches.set(key, { geometry: mesh.geometry, material: mesh.material, castShadow: mesh.castShadow, sources: [] });
        const batch = batches.get(key);
        if (mesh.isInstancedMesh) {
          for (let i = 0; i < mesh.count; i++) {
            const local = new THREE.Matrix4(); mesh.getMatrixAt(i, local);
            batch.sources.push({ mesh, local });
          }
        } else batch.sources.push({ mesh });
        mesh.visible = false;
      });
    }
    group.userData.batches = [...batches.values()];
    for (const batch of group.userData.batches) {
      batch.mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.sources.length);
      batch.mesh.castShadow = batch.castShadow; batch.mesh.receiveShadow = true;
      // The instances continuously wrap along the course, so their bounds move.
      batch.mesh.frustumCulled = false;
      group.add(batch.mesh);
    }
    this.batchMatrix = new THREE.Matrix4();
  }

  makeTree(variant) {
    const tree = new THREE.Group();
    const height = 1.45 + variant * .13;
    this.mesh(tree, new THREE.CylinderGeometry(.11, .23, height, 12), '#a28663', [0, height / 2, 0]);
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3 + .3;
      this.rod(tree, [0, .18, 0], [Math.cos(angle) * .35, .02, Math.sin(angle) * .35], .065, '#a28663');
      this.rod(tree, [0, height * .65, 0], [Math.cos(angle) * .5, height + .24, Math.sin(angle) * .4], .06, '#a28663');
    }
    // A gently uneven, smooth crown gives the foliage a soft organic silhouette.
    const crownGeometry = new THREE.SphereGeometry(1, 24, 18);
    const positions = crownGeometry.getAttribute('position');
    const colors = [];
    const low = new THREE.Color(['#729764', '#729d70', '#819e66', '#779f74'][variant]);
    const high = new THREE.Color(['#a8c886', '#afd094', '#bad493', '#a6c78b'][variant]);
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
      const ripple = 1 + .055 * Math.sin(x * 8 + variant) * Math.sin(z * 6 + y * 3);
      positions.setXYZ(i, x * ripple, y * ripple, z * ripple);
      const color = low.clone().lerp(high, Math.max(0, Math.min(1, (y + 1) * .5)));
      colors.push(color.r, color.g, color.b);
    }
    crownGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    crownGeometry.computeVertexNormals();
    const crownMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const crown = new THREE.Mesh(crownGeometry, crownMaterial);
    crown.position.set(0, height + .64, 0);
    crown.scale.set(1.04 + variant % 2 * .12, 1 + variant % 3 * .13, 1);
    crown.castShadow = true; crown.receiveShadow = true; tree.add(crown);
    for (const [x, y, z, scale] of [[-.58, -.05, .08, .68], [.54, .12, -.15, .66], [-.2, .65, -.1, .63]]) {
      const lobe = crown.clone();
      lobe.position.set(x, height + .64 + y, z); lobe.scale.setScalar(scale);
      tree.add(lobe);
    }
    for (let i = 0; i < 2; i++) {
      const scar = this.mesh(tree, new THREE.TorusGeometry(.075, .012, 4, 10, Math.PI), '#836b50', [0, .5 + i * .3, .17]);
      scar.scale.y = .5;
    }
    if (variant === 1) {
      for (const [x, y, z] of [[-.45, 1.93, .78], [.51, 2.15, .72], [.24, 2.58, .86]]) {
        this.sphere(tree, '#e5a084', [x, y, z], [.085, .09, .085]);
      }
    }
    return tree;
  }

  makeGarden(variant) {
    const patch = new THREE.Group();
    for (const [x, z, scale] of [[-.30, 0, .55], [.25, -.10, .46], [.04, .20, .40]]) {
      this.sphere(patch, '#8fac78', [x, scale * .3, z], [scale, scale * .5, scale * .8]);
    }
    this.sphere(patch, '#bbbda6', [-.6, .12, .4], [.24, .14, .19]);
    const petals = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 7), this.material(variant ? '#f4c9b5' : '#fff9dc'), 20);
    const flower = new THREE.Object3D();
    for (let i = 0; i < 4; i++) {
      const x = -.45 + i * .27, y = .46 + i % 2 * .13, z = .38;
      this.rod(patch, [x, .04, z], [x, y, z], .017, '#6e9661');
      this.sphere(patch, '#e3b755', [x, y, z], [.045, .04, .045]);
      for (let j = 0; j < 5; j++) {
        const angle = j * Math.PI * 2 / 5;
        flower.position.set(x + Math.cos(angle) * .075, y + Math.sin(angle) * .075, z);
        flower.scale.set(.065, .044, .03); flower.rotation.z = angle; flower.updateMatrix();
        petals.setMatrixAt(i * 5 + j, flower.matrix);
      }
    }
    petals.castShadow = false; patch.add(petals);
    return patch;
  }

  makeGrassSky(group) {
    this.clouds = [];
    for (let i = 0; i < 6; i++) {
      const cloud = new THREE.Group();
      cloud.position.set(-26 + i * 10.5, 11 + i % 3 * 1.9, -58 - i % 2 * 12);
      cloud.userData.baseX = cloud.position.x;
      cloud.scale.setScalar(.8 + i % 3 * .17);
      for (const [x, y, size] of [[-2.2, 0, 1.3], [-.9, .35, 1.6], [.5, .58, 1.9], [2, .08, 1.3], [.4, -.25, 1.5]]) {
        const puff = this.sphere(cloud, '#fffdf1', [x, y, 0], [size, size * .65, size * .75]);
        puff.castShadow = false;
      }
      group.add(cloud); this.clouds.push(cloud);
    }
    const sun = new THREE.Group(); sun.position.set(23, 10.2, -64);
    const face = this.mesh(sun, new THREE.SphereGeometry(1.85, 24, 16), '#fff0ad');
    face.material = new THREE.MeshBasicMaterial({ color: '#fff0ad', fog: false }); face.castShadow = false;
    const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 128;
    const ctx = glowCanvas.getContext('2d');
    const glow = ctx.createRadialGradient(64, 64, 18, 64, 64, 64);
    glow.addColorStop(0, '#fff0aa90'); glow.addColorStop(.5, '#ffe6a838'); glow.addColorStop(1, '#fff0aa00');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 128, 128);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowCanvas), transparent: true, depthWrite: false }));
    halo.scale.set(9, 9, 1); sun.add(halo); group.add(sun);

    this.butterflies = [];
    for (let i = 0; i < 6; i++) {
      const butterfly = new THREE.Group();
      const color = ['#edbf73', '#d3b1d6', '#e7a59c'][i % 3];
      const wings = [-1, 1].map((side) => {
        const wing = new THREE.Group();
        this.sphere(wing, color, [side * .19, .10, 0], [.20, .24, .035]);
        this.sphere(wing, color, [side * .15, -.15, 0], [.15, .15, .03]);
        this.sphere(wing, '#fff1cf', [side * .22, .13, .035], [.07, .09, .013]);
        butterfly.add(wing); return wing;
      });
      this.sphere(butterfly, '#746f51', [0, 0, 0], [.028, .20, .026]);
      for (const side of [-1, 1]) this.rod(butterfly, [0, .18, 0], [side * .07, .29, 0], .008, '#746f51');
      butterfly.position.set((i % 2 ? 1 : -1) * (4.1 + i % 3 * .6), 1 + i % 2 * .3, -4 - i * 5.6);
      butterfly.userData = { wings, origin: butterfly.position.clone() };
      butterfly.traverse((mesh) => { if (mesh.isMesh) mesh.castShadow = false; });
      group.add(butterfly); this.butterflies.push(butterfly);
    }
    this.birds = [];
    for (let i = 0; i < 5; i++) {
      const bird = new THREE.Group(), color = i % 2 ? '#adbbb5' : '#91a8bb';
      this.sphere(bird, color, [0, 0, 0], [.14, .14, .29]);
      this.sphere(bird, '#d4ded9', [0, .10, -.21], [.12, .12, .12]);
      this.mesh(bird, new THREE.ConeGeometry(.045, .15, 5), '#d5ad67', [0, .09, -.36]).rotation.x = -Math.PI / 2;
      const wings = [-1, 1].map((side) => {
        const wing = new THREE.Group();
        this.sphere(wing, color, [side * .24, 0, .015], [.30, .045, .15]);
        wing.rotation.z = side * .12; bird.add(wing); return wing;
      });
      this.mesh(bird, new THREE.ConeGeometry(.12, .24, 3), color, [0, -.02, .35]).rotation.x = Math.PI / 2;
      bird.position.set((i % 2 ? 1 : -1) * (6 + i * 1.4), 4.4 + i % 3 * .55, -14 - i * 5);
      bird.rotation.y = i % 2 ? Math.PI / 2 : -Math.PI / 2;
      bird.userData = { wings, origin: bird.position.clone() };
      bird.traverse((mesh) => { if (mesh.isMesh) mesh.castShadow = false; });
      group.add(bird); this.birds.push(bird);
    }
  }

  makeChicken() {
    const chick = new THREE.Group();
    const body = this.mesh(chick, new THREE.SphereGeometry(1, 32, 24), '#ffdc70', [0, .88, 0]);
    body.scale.set(.66, .67, .62);
    this.wings = [-1, 1].map((side) => this.sphere(chick, '#f2c353', [side * .60, .86, .02], [.105, .24, .22]));
    // One continuous three-crested wave, rather than three separate sticks.
    const crest = new THREE.Shape();
    crest.moveTo(-.34, 0); crest.quadraticCurveTo(-.06, -.04, .29, 0);
    crest.bezierCurveTo(.41, .15, .40, .33, .28, .34);
    crest.bezierCurveTo(.32, .25, .18, .20, .16, .10);
    crest.bezierCurveTo(.23, .34, .15, .42, .07, .41);
    crest.bezierCurveTo(.10, .28, -.02, .21, -.035, .10);
    crest.bezierCurveTo(.02, .32, -.07, .41, -.15, .38);
    crest.bezierCurveTo(-.13, .26, -.25, .19, -.27, .09);
    crest.quadraticCurveTo(-.32, .05, -.34, 0);
    this.mesh(chick, new THREE.ExtrudeGeometry(crest, { depth: .085, bevelEnabled: true, bevelThickness: .025, bevelSize: .02, bevelSegments: 3, steps: 1, curveSegments: 16 }), '#efbd49', [0, 1.48, -.06]);
    this.mesh(chick, new THREE.ConeGeometry(.12, .23, 4), '#eaa047', [0, 1.01, -.68]).rotation.x = -Math.PI / 2;
    for (const side of [-1, 1]) {
      this.sphere(chick, '#444939', [side * .235, 1.12, -.55], [.045, .065, .035]);
      this.sphere(chick, '#fffaf0', [side * .235 + .012, 1.145, -.577], [.012, .015, .01]);
      this.sphere(chick, '#efa186', [side * .35, .95, -.51], [.065, .04, .028]);
    }
    this.feet = [-1, 1].map((side) => {
      const foot = new THREE.Group(); foot.position.set(side * .24, .09, .09);
      this.rod(foot, [0, 0, 0], [0, .23, 0], .035, '#df9745');
      for (const tip of [[0, -.035, -.24], [-.15, -.035, -.15], [.15, -.035, -.15]]) {
        this.rod(foot, [0, 0, 0], tip, .035, '#df9745');
        this.sphere(foot, '#df9745', tip, [.035, .035, .035]);
      }
      chick.add(foot); return foot;
    });
    return chick;
  }

  makeSkin(id) {
    const group = new THREE.Group();
    if (id === 'pig') {
      this.sphere(group, '#f4aeb7', [0, .82, 0], [.68, .65, .61]);
      this.sphere(group, '#fa8ea1', [0, .88, -.60], [.30, .20, .11]);
      for (const side of [-1, 1]) {
        this.sphere(group, '#a65f77', [side * .11, .90, -.706], [.035, .055, .015]);
        const ear = this.mesh(group, new THREE.ConeGeometry(.23, .45, 3), '#f4aeb7', [side * .42, 1.43, 0]);
        ear.rotation.z = side * -.3;
        this.sphere(group, '#f97e9c', [side * .45, 1.42, -.08], [.09, .13, .045]);
        this.box(group, '#965a6e', [.22, .18, .26], [side * .30, .09, 0]);
      }
      const curl = new THREE.CatmullRomCurve3(Array.from({ length: 25 }, (_, i) => {
        const a = i / 24 * Math.PI * 3;
        return new THREE.Vector3(Math.cos(a) * .10, .78 + Math.sin(a) * .10, .59 + i / 24 * .25);
      }));
      this.mesh(group, new THREE.TubeGeometry(curl, 24, .035, 6, false), '#ec8da1');
    } else if (id === 'banana') {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-.40, .18, 0), new THREE.Vector3(.04, .48, 0),
        new THREE.Vector3(.27, 1.02, 0), new THREE.Vector3(.12, 1.60, 0),
      ]);
      this.mesh(group, new THREE.TubeGeometry(curve, 24, .29, 10, false), '#ffe05c');
      this.rod(group, [.12, 1.58, 0], [.08, 1.81, 0], .085, '#8d7040');
      this.sphere(group, '#8d7040', [-.42, .17, 0], [.09, .08, .09]);
      for (const side of [-1, 1]) {
        this.rod(group, [side * .12, .62, -.16], [side * .48, .35, -.08], .10, '#fff08e');
        this.box(group, '#c3973e', [.17, .12, .23], [side * .20, .07, 0]);
      }
    } else if (id === 'dragonfruit') {
      this.sphere(group, '#ef5a98', [0, .84, 0], [.58, .74, .52]);
      this.sphere(group, '#fff6dc', [0, .88, -.44], [.42, .53, .12]);
      for (let i = 0; i < 18; i++) {
        const a = i * 2.4, y = .40 + (i % 5) * .20;
        this.sphere(group, '#554b53', [Math.sin(a) * .29, y, -.55], [.018, .027, .012]);
      }
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 3, y = .45 + Math.floor(i / 6) * .67;
        const leaf = this.mesh(group, new THREE.ConeGeometry(.13, .43, 3), '#8dc65b', [Math.cos(a) * .55, y, Math.sin(a) * .48]);
        leaf.rotation.z = -Math.cos(a) * .9; leaf.rotation.x = Math.sin(a) * .9;
      }
      for (const side of [-1, 1]) this.box(group, '#8dc65b', [.19, .13, .25], [side * .22, .07, 0]);
    } else if (SKINS.find((skin) => skin.id === id)?.category === 'animal') {
      const color = { cat: '#e7b06c', dog: '#c1946e', rabbit: '#fff4ec', panda: '#f7f4e8', bear: '#9d7153' }[id];
      this.sphere(group, color, [0, .79, 0], [.62, .65, .56]);
      this.sphere(group, color, [0, 1.24, -.10], [.48, .43, .44]);
      for (const side of [-1, 1]) {
        if (id === 'cat') this.mesh(group, new THREE.ConeGeometry(.20, .38, 3), color, [side * .32, 1.65, -.10]);
        else this.sphere(group, id === 'panda' ? '#424641' : color, [side * .34, id === 'rabbit' ? 1.85 : 1.57, -.03], id === 'rabbit' ? [.14, .50, .12] : id === 'dog' ? [.16, .32, .14] : [.19, .19, .13]);
        this.sphere(group, id === 'panda' ? '#424641' : color, [side * .29, .12, -.1], [.19, .15, .26]);
        if (id === 'panda') this.sphere(group, '#424641', [side * .19, 1.3, -.48], [.12, .14, .04]);
        this.sphere(group, '#303832', [side * .18, 1.32, -.52], [.04, .055, .025]);
      }
      this.sphere(group, '#fff0d9', [0, 1.11, -.51], [.22, .15, .07]);
      this.sphere(group, '#64504c', [0, 1.18, -.59], [.065, .045, .03]);
      this.sphere(group, color, [0, .58, .58], id === 'rabbit' ? [.17, .17, .17] : [.10, .12, .35]);
    } else {
      const color = { apple: '#e96a62', orange: '#ffac47', watermelon: '#79b760', strawberry: '#ef7290', grape: '#ac88c8' }[id];
      if (id === 'grape') {
        for (let i = 0; i < 10; i++) {
          const a = i * 2.4; this.sphere(group, color, [Math.sin(a) * .32, .42 + Math.floor(i / 3) * .28, Math.cos(a) * .30], [.28, .28, .28]);
        }
      } else this.sphere(group, color, [0, .85, 0], id === 'strawberry' ? [.53, .68, .5] : [.65, .66, .60]);
      this.rod(group, [0, 1.42, 0], [.08, 1.68, 0], .045, '#7d6346');
      this.sphere(group, '#80af58', [.17, 1.58, 0], [.24, .07, .12]).rotation.z = .4;
      if (id === 'watermelon') {
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(Math.sin(a) * .3, .3, Math.cos(a) * .3), new THREE.Vector3(Math.sin(a) * .655, .85, Math.cos(a) * .605), new THREE.Vector3(Math.sin(a) * .3, 1.4, Math.cos(a) * .3)]);
          this.mesh(group, new THREE.TubeGeometry(curve, 12, .027, 5, false), '#376b42');
        }
      }
      if (id === 'strawberry') for (let i = 0; i < 20; i++) {
        const a = i * 2.4, y = .4 + (i % 5) * .18;
        this.sphere(group, '#ffe493', [Math.sin(a) * .5, y, Math.cos(a) * .47], [.018, .035, .016]);
      }
      for (const side of [-1, 1]) this.box(group, '#80af58', [.19, .12, .25], [side * .22, .07, 0]);
    }
    for (const side of [-1, 1]) this.sphere(group, '#414839', [side * .15, 1.07, id === 'pig' ? -.57 : id === 'banana' ? -.27 : -.60], [.035, .055, .025]);
    return group;
  }

  makeStar() {
    const group = new THREE.Group(), shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const angle = Math.PI / 2 + i * Math.PI / 5, radius = i % 2 ? .17 : .38;
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    const star = this.mesh(group, new THREE.ExtrudeGeometry(shape, { depth: .10, bevelEnabled: true, bevelSize: .025, bevelThickness: .025, bevelSegments: 2, steps: 1 }), '#ffd13c');
    star.material = new THREE.MeshStandardMaterial({ color: '#ffd13c', emissive: '#ffa900', emissiveIntensity: .8, metalness: .35, roughness: .3 });
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d'), glow = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    glow.addColorStop(0, '#fff2a5aa'); glow.addColorStop(.4, '#ffd54a55'); glow.addColorStop(1, '#ffd54a00');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 64, 64);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(1.4, 1.4, 1); group.add(halo);
    return group;
  }

  makeShop() {
    const group = new THREE.Group();
    this.box(group, '#f5d9a6', [1.8, 1.5, 1.2], [0, .75, 0]);
    this.mesh(group, new THREE.ConeGeometry(1.5, .7, 4), '#e98182', [0, 1.8, 0]).rotation.y = Math.PI / 4;
    this.box(group, '#795f48', [.65, .95, .04], [0, .48, .62]);
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff6da'; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#76523d'; ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('★ 皮肤商城', 128, 43);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) }));
    label.position.y = 2.5; label.scale.set(2.7, .67, 1); group.add(label);
    return group;
  }

  renderRewards(game) {
    const active = new Set();
    for (const [kind, rewards] of [['star', game.stars], ['shop', game.shops]]) {
      for (const reward of rewards) {
        const key = `${game.world}/${kind}/${reward.id}`; active.add(key);
        let mesh = this.rewardMeshes.get(key);
        if (!mesh) {
          if (!this.templates.has(kind)) this.templates.set(kind, kind === 'star' ? this.makeStar() : this.makeShop());
          mesh = this.templates.get(kind).clone(true); this.scene.add(mesh); this.rewardMeshes.set(key, mesh);
        }
        mesh.position.set(kind === 'star' ? laneX(reward.lane) : 4.9,
          kind === 'star' ? (reward.height + Math.sin(game.time * 2 + reward.id) * 7) * RULES.worldScale : 0, depth(reward.x));
        if (kind === 'star') { mesh.children[0].rotation.y = game.time * .65; mesh.children[0].rotation.z = Math.sin(game.time * .4) * .1; }
      }
    }
    for (const [key, mesh] of this.rewardMeshes) {
      if (!active.has(key)) { this.scene.remove(mesh); this.rewardMeshes.delete(key); }
    }
  }

  makeNet(width, height, fresh) {
    const group = new THREE.Group(), color = fresh ? '#326b55' : '#919473';
    const top = (x, z) => height * Math.max(.1, 1 - (Math.abs(x) + Math.abs(z)) / (width * 1.25));
    const n = 6;
    // All rope segments share one draw call, including the shadow pass.
    const ropes = new THREE.InstancedMesh(new THREE.CylinderGeometry(.016, .016, 1, 6), this.material(color), (n + 1) * n * 2);
    ropes.castShadow = true; ropes.receiveShadow = true;
    const segment = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
    let index = 0;
    const addSegment = (from, to) => {
      const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
      segment.position.copy(a).add(b).multiplyScalar(.5);
      segment.scale.set(1, a.distanceTo(b), 1);
      segment.quaternion.setFromUnitVectors(up, b.sub(a).normalize());
      segment.updateMatrix(); ropes.setMatrixAt(index++, segment.matrix);
    };
    for (let i = 0; i <= n; i++) {
      const p = (i / n - .5) * width;
      for (let j = 0; j < n; j++) {
        const a = (j / n - .5) * width, b = ((j + 1) / n - .5) * width;
        addSegment([p, top(p, a), a], [p, top(p, b), b]);
        addSegment([a, top(a, p), p], [b, top(b, p), p]);
      }
    }
    group.add(ropes);
    return group;
  }

  makeObstacle(kind, ocean) {
    const group = new THREE.Group();
    if (kind === 'pipe') {
      const color = ocean ? '#377d65' : '#86b86c';
      this.mesh(group, new THREE.CylinderGeometry(.70, .70, 1.42, 24, 1, true), color, [0, .71, 0]);
      const inner = this.mesh(group, new THREE.CylinderGeometry(.59, .59, .55, 24, 1, true), '#294e40', [0, 1.24, 0]);
      inner.material = inner.material.clone(); inner.material.side = THREE.DoubleSide;
      this.mesh(group, new THREE.TorusGeometry(.70, .10, 8, 28), color, [0, 1.49, 0]).rotation.x = Math.PI / 2;
      this.mesh(group, new THREE.RingGeometry(.59, .76, 28), '#c2dda0', [0, 1.53, 0]).rotation.x = -Math.PI / 2;
      this.mesh(group, new THREE.CircleGeometry(.59, 24), '#183e36', [0, 1.14, 0]).rotation.x = -Math.PI / 2;
      this.box(group, ocean ? '#72ad8c' : '#a9cd87', [.09, 1.18, .08], [-.40, .69, .58]);
      this.mesh(group, new THREE.OctahedronGeometry(.12), '#fff0ad', [0, 1.95, 0]);
    } else if (kind === 'oldnet' || kind === 'fallingnet') {
      group.add(this.makeNet(kind === 'oldnet' ? 1.18 : 1.48, kind === 'oldnet' ? .72 : 1.08, kind === 'fallingnet'));
    } else if (kind === 'bottle') {
      const bottle = new THREE.Group(); bottle.position.set(0, .35, 0); bottle.rotation.z = 1.13;
      this.mesh(bottle, new THREE.CylinderGeometry(.23, .23, .69, 12), '#b6e2df', [0, 0, 0], .65);
      this.mesh(bottle, new THREE.CylinderGeometry(.09, .23, .20, 12), '#b6e2df', [0, .44, 0], .65);
      this.mesh(bottle, new THREE.CylinderGeometry(.09, .09, .16, 10), '#b6e2df', [0, .6, 0], .65);
      this.mesh(bottle, new THREE.CylinderGeometry(.105, .105, .10, 10), '#658db1', [0, .68, 0]);
      this.mesh(bottle, new THREE.CylinderGeometry(.237, .237, .21, 12), '#e9d7a0', [0, -.03, 0]);
      this.rod(bottle, [-.16, -.24, .15], [-.16, .25, .15], .018, '#eafaf8');
      group.add(bottle);
    } else if (kind === 'blackbag' || kind === 'clearbag') {
      const black = kind === 'blackbag', color = black ? '#353e43' : '#ebfcf8', opacity = black ? 1 : .35;
      this.sphere(group, color, [0, .36, 0], [.52, .37, .40], opacity);
      for (const x of [-.25, .25]) {
        const handle = this.mesh(group, new THREE.TorusGeometry(.15, .047, 6, 14), color, [x, .68, 0], opacity);
        handle.scale.y = 1.45;
      }
      for (let i = -1; i <= 1; i++) this.rod(group, [i * .20, .12, .28], [i * .13, .57, .29], .013, black ? '#667073' : '#c3e0dc');
    } else if (kind === 'bone') {
      this.rod(group, [-.32, .22, -.1], [.32, .55, .1], .12, '#f8eed4');
      for (const [x, y, z] of [[-.33, .22, -.1], [.33, .55, .1]]) {
        for (const dz of [-.10, .10]) this.sphere(group, '#fff5df', [x, y, z + dz], [.15, .15, .15]);
      }
    } else if (kind === 'fishbone') {
      this.rod(group, [-.45, .32, 0], [.5, .32, 0], .04, '#ece7cc');
      for (let i = 0; i < 4; i++) {
        const x = -.18 + i * .15;
        this.rod(group, [x + .04, .59, 0], [x, .32, 0], .028, '#f9efd7');
        this.rod(group, [x + .04, .06, 0], [x, .32, 0], .028, '#f9efd7');
      }
      this.sphere(group, '#f9efd7', [-.43, .34, 0], [.18, .29, .12]);
      this.sphere(group, '#89957d', [-.48, .43, .11], [.04, .04, .02]);
      this.rod(group, [.47, .32, 0], [.62, .52, 0], .045, '#f9efd7');
      this.rod(group, [.47, .32, 0], [.62, .13, 0], .045, '#f9efd7');
    } else if (kind === 'branch') {
      this.rod(group, [-.5, .1, .1], [.50, .38, -.15], .09, '#997552');
      this.rod(group, [-.15, .20, 0], [-.24, .60, -.05], .065, '#997552');
      this.rod(group, [.20, .3, -.1], [.42, .18, .28], .065, '#997552');
    } else if (kind === 'applecore') {
      this.mesh(group, new THREE.CylinderGeometry(.18, .19, .52, 10), '#fff0ce', [0, .38, 0]);
      for (const y of [.13, .63]) this.sphere(group, '#d88570', [0, y, 0], [.31, .12, .28]);
      this.rod(group, [0, .7, 0], [.07, .8, 0], .035, '#806448');
      this.sphere(group, '#8d6343', [0, .37, .185], [.04, .08, .018]);
    } else if (kind === 'can') {
      this.mesh(group, new THREE.CylinderGeometry(.28, .28, .64, 16), '#a3bab1', [0, .3, 0]).rotation.z = Math.PI / 2;
      this.mesh(group, new THREE.CylinderGeometry(.284, .284, .34, 16), '#ecd39a', [0, .3, 0]).rotation.z = Math.PI / 2;
      this.sphere(group, '#647e75', [.325, .32, 0], [.008, .10, .05]);
    }
    return group;
  }

  effect(event) {
    if (event.type === 'start') {
      for (const particle of this.particles) this.scene.remove(particle.mesh);
      this.particles = [];
      for (const object of this.obstacleMeshes.values()) {
        this.scene.remove(object);
        if (object.children[1]) object.children[1].geometry.dispose();
      }
      this.obstacleMeshes.clear();
    }
    if (this.reducedMotion || !['damage', 'land', 'win'].includes(event.type)) return;
    const count = event.type === 'win' ? 45 : 7;
    if (!this.templates.has('particle')) this.templates.set('particle', new THREE.Mesh(new THREE.OctahedronGeometry(.055), this.material('#ffe799')));
    for (let i = 0; i < count; i++) {
      const mesh = this.templates.get('particle').clone();
      this.scene.add(mesh);
      this.particles.push({ mesh, lane: event.lane ?? 1, birth: event.time, duration: event.type === 'win' ? 3 : .6,
        velocity: new THREE.Vector3(Math.sin(i * 2.4) * 2, event.type === 'win' ? 4 + i % 5 : 1.5, Math.cos(i * 2.4) * 2) });
    }
  }

  render(game) {
    const ocean = game.world === 'ocean';
    if (this.world !== game.world) {
      this.world = game.world;
      this.scene.background = new THREE.Color(ocean ? '#83c6d4' : '#c0e4e4');
      this.scene.fog = new THREE.Fog(ocean ? '#83c6d4' : '#c0e4e4', ocean ? 24 : 38, 100);
      this.floor.material = this.material(ocean ? '#b6d5c7' : '#a6c58e');
      this.track.material = this.material(ocean ? '#ebdeba' : '#c7d7a6');
      this.sun.color.set(ocean ? '#d9f9f7' : '#fff2d0');
    }
    this.grassScenery.visible = !ocean; this.oceanScenery.visible = ocean;
    const scenery = ocean ? this.oceanScenery : this.grassScenery;
    for (const item of scenery.userData.scroll) item.position.z = ((item.userData.baseZ + game.distance * RULES.worldScale + 100) % 106 + 106) % 106 - 100;
    if (scenery.userData.batches && scenery.userData.batchDistance !== game.distance) {
      scenery.updateMatrixWorld(true);
      for (const batch of scenery.userData.batches) {
        batch.sources.forEach((source, i) => {
          this.batchMatrix.copy(source.mesh.matrixWorld);
          if (source.local) this.batchMatrix.multiply(source.local);
          batch.mesh.setMatrixAt(i, this.batchMatrix);
        });
        batch.mesh.instanceMatrix.needsUpdate = true;
      }
      scenery.userData.batchDistance = game.distance;
    }
    this.trackDetails.position.z = (game.distance * RULES.worldScale) % 3;
    if (!ocean) {
      const t = this.reducedMotion ? 0 : game.time;
      this.clouds.forEach((cloud, i) => { cloud.position.x = cloud.userData.baseX + Math.sin(t * .07 + i) * 1.8; });
      this.butterflies.forEach((butterfly, i) => {
        const { origin, wings } = butterfly.userData;
        butterfly.position.set(origin.x + Math.sin(t * .8 + i) * .5, origin.y + Math.sin(t * 1.5 + i) * .2, origin.z + Math.cos(t * .6 + i) * 1.2);
        butterfly.rotation.z = Math.sin(t + i) * .16;
        wings.forEach((wing, j) => { wing.rotation.y = (j ? 1 : -1) * (.35 + Math.sin(t * 9 + i) * .65); });
      });
      this.birds.forEach((bird, i) => {
        const { origin, wings } = bird.userData;
        bird.position.set(origin.x + Math.sin(t * .35 + i) * 2, origin.y + Math.sin(t * 1.3 + i) * .18, origin.z + Math.cos(t * .35 + i) * .8);
        wings.forEach((wing, j) => { wing.rotation.z = (j ? 1 : -1) * (.2 + Math.sin(t * 5 + i) * .5); });
      });
    }
    if (ocean) {
      this.fish.forEach((fish, i) => {
        fish.position.x = fish.userData.baseX + Math.sin(game.oceanTime * .4 + i) * 1.1;
        fish.rotation.y = Math.sin(game.oceanTime * .8 + i) * .3;
      });
      this.bubbles.forEach((bubble, i) => { bubble.position.y = (i * .7 + game.oceanTime * .5) % 8; });
    }
    const preview = [
      { id: 'preview-bone', kind: 'bone', lane: 0, x: 690, width: 47 },
      { id: 'preview-branch', kind: 'branch', lane: 2, x: 1110, width: 64 },
      { id: 'preview-pipe', kind: 'pipe', lane: 1, x: 1540, width: 100 },
    ];
    const obstacles = game.phase === 'ready' ? preview : game.obstacles;
    const active = new Set();
    for (const obstacle of obstacles) {
      const id = `${game.world}/${obstacle.id}`; active.add(id);
      let object = this.obstacleMeshes.get(id);
      if (!object) {
        const key = `${game.world}/${obstacle.kind}`;
        if (!this.templates.has(key)) this.templates.set(key, this.makeObstacle(obstacle.kind, ocean));
        object = new THREE.Group(); object.add(this.templates.get(key).clone(true));
        if (obstacle.kind === 'fallingnet') {
          const ring = this.mesh(object, new THREE.RingGeometry(.77, .85, 32), '#f5dc8b', [0, .012, 0]);
          ring.rotation.x = -Math.PI / 2;
        }
        this.obstacleMeshes.set(id, object); this.scene.add(object);
      }
      object.position.set(laneX(obstacle.lane), 0, depth(obstacle.x + obstacle.width / 2));
      object.children[0].position.y = obstacle.kind === 'fallingnet' ? (RULES.ground - obstacle.bottom) * RULES.worldScale : 0;
      if (object.children[1]) object.children[1].visible = obstacle.stage !== 'landed';
      if (obstacle.kind === 'pipe') {
        const sparkle = object.children[0].children.at(-1);
        sparkle.rotation.y = game.time; sparkle.position.y = 1.95 + Math.sin(game.time * 3) * .08;
      }
      if (obstacle.kind.endsWith('bag')) object.children[0].rotation.z = Math.sin(game.oceanTime * 2 + obstacle.id) * .055;
    }
    for (const [id, mesh] of this.obstacleMeshes) {
      if (!active.has(id)) {
        this.scene.remove(mesh);
        // Only warning rings belong to instances; models share cached geometry.
        if (mesh.children[1]) mesh.children[1].geometry.dispose();
        this.obstacleMeshes.delete(id);
      }
    }
    this.renderRewards(game);
    for (const child of this.chickenBody) child.visible = !game.equippedSkin;
    for (const [id, model] of this.skinModels) model.visible = game.equippedSkin === id;
    const stuck = game.player.stuckRemaining > 0;
    const stride = game.phase === 'running' && game.grounded && !stuck ? Math.sin(game.distance * .10) : 0;
    this.chicken.position.set(laneX(game.player.lanePosition), (RULES.ground - game.player.y) * RULES.worldScale + Math.abs(stride) * .04, 2);
    this.chicken.rotation.z = -(game.player.lane - game.player.lanePosition) * .14;
    this.chicken.rotation.y = -(game.player.lane - game.player.lanePosition) * .12;
    this.chicken.scale.set(1 + game.player.squash * .12, 1 - game.player.squash * .12, 1);
    this.chicken.visible = !game.invincible || stuck || Math.floor(game.time * 12) % 2 === 0;
    this.feet.forEach((foot, i) => { foot.rotation.x = stride * (i ? 1 : -1) * .75; });
    this.wings.forEach((wing, i) => { wing.rotation.z = (i ? 1 : -1) * (game.grounded ? .15 : .7) + stride * .08; });
    this.bubble.visible = ocean; this.caughtMesh.visible = stuck;
    this.particles = this.particles.filter((particle) => {
      const age = game.time - particle.birth;
      if (age > particle.duration) { this.scene.remove(particle.mesh); return false; }
      particle.mesh.position.set(laneX(particle.lane) + particle.velocity.x * age, Math.max(.03, .2 + particle.velocity.y * age - 2 * age * age), 2 + particle.velocity.z * age);
      particle.mesh.rotation.x = age * 3; particle.mesh.scale.setScalar(Math.max(.05, 1 - age / particle.duration));
      return true;
    });
    this.webgl.render(this.scene, this.camera);
  }
}

export class SkinPreview {
  constructor(canvas, builder) {
    this.canvas = canvas;
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight('#fff8df', '#a3b1a0', 3));
    const light = new THREE.DirectionalLight('#ffffff', 3); light.position.set(3, 5, 5); this.scene.add(light);
    this.camera = new THREE.PerspectiveCamera(35, 1, .1, 20);
    this.camera.position.set(0, 1.6, -4.5); this.camera.lookAt(0, .85, 0);
    this.models = new Map(SKINS.map(({ id }) => [id, builder.makeSkin(id)]));
    for (const model of this.models.values()) this.scene.add(model);
  }
  render(id, angle) {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    if (this.width !== width || this.height !== height) {
      this.width = width; this.height = height;
      this.webgl.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    }
    for (const [key, model] of this.models) { model.visible = key === id; model.rotation.y = angle; }
    this.webgl.render(this.scene, this.camera);
  }
}
