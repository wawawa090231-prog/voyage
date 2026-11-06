/* 3D 群島：Three.js r128。五座島、拼板舟、飛魚、雲和海浪。 */
(function () {
  const W = { ok: false };
  if (!window.THREE) { window.World = W; return; }

  const POS = [[-17, 0, 5], [-8, 0, -5], [0, 0, 6], [8.5, 0, -6], [17, 0, 3]];
  const RAD = [3.2, 4.1, 3.5, 3.8, 3.6];
  const HOME = { pos: new THREE.Vector3(0, 30, 41), target: new THREE.Vector3(0, 0, 0.5) };
  const MIN_D = 10, MAX_D = 75;

  let renderer, scene, camera, controls, canvas, labelsEl, opts;
  let water, wBase, islands = [], labels = [], curve, boat, sprite, marker, beamPivot;
  let boatT = 0, boatGoal = 0, boatInit = false, fly = null, offsetPx = 0;
  const fishes = [], clouds = [], tmp = new THREE.Vector3(), clock = new THREE.Clock();
  const GRAY = new THREE.Color("#a3aeab");
  let lastImg = "", status = [];

  function mat(c, o) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ color: c, flatShading: true, roughness: 0.85, metalness: 0 }, o || {}));
    m.userData.base = new THREE.Color(c);
    return m;
  }
  function mesh(g, m, x, y, z, shadow) {
    const o = new THREE.Mesh(g, m);
    o.position.set(x || 0, y || 0, z || 0);
    if (shadow !== false) { o.castShadow = true; o.receiveShadow = true; }
    return o;
  }

  /* ---------- 小物件 ---------- */
  function palm(g, M, x, z, h, rot) {
    const p = new THREE.Group();
    const trunk = mesh(new THREE.CylinderGeometry(0.1, 0.17, h, 5), M.wood, 0, h / 2, 0);
    trunk.rotation.z = 0.12;
    p.add(trunk);
    for (let k = 0; k < 5; k++) {
      const leaf = mesh(new THREE.ConeGeometry(0.28, 1.5, 4), M.leaf, 0, h + 0.05, 0);
      leaf.rotation.z = Math.PI / 2 - 0.35;
      const holder = new THREE.Group();
      holder.position.set(Math.sin(0.12) * -h * 0.5, 0, 0);
      leaf.position.set(0.7, h, 0);
      holder.add(leaf);
      holder.rotation.y = (k / 5) * Math.PI * 2 + (rot || 0);
      p.add(holder);
    }
    p.position.set(x, 0, z);
    g.add(p);
  }
  function house(g, M, x, z, roof, ry) {
    const h = new THREE.Group();
    h.add(mesh(new THREE.BoxGeometry(1.1, 0.8, 0.9), M.wall, 0, 0.4, 0));
    const r = mesh(new THREE.ConeGeometry(0.9, 0.6, 4), roof, 0, 1.1, 0);
    r.rotation.y = Math.PI / 4;
    h.add(r);
    h.add(mesh(new THREE.BoxGeometry(0.25, 0.4, 0.05), M.wood, 0, 0.2, 0.46));
    h.position.set(x, 0, z);
    h.rotation.y = ry || 0;
    g.add(h);
  }
  function rock(g, M, x, z, s, y) {
    const r = mesh(new THREE.DodecahedronGeometry(s, 0), M.rock, x, (y || 0) + s * 0.6, z);
    r.rotation.set(s * 1.3, s * 2.1, s * 0.7);
    r.scale.y = 1.4;
    g.add(r);
  }
  function dock(g, M, len, ang) {
    const d = new THREE.Group();
    d.add(mesh(new THREE.BoxGeometry(0.9, 0.12, len), M.wood, 0, 0.42, len / 2));
    for (let k = 0; k < 3; k++) {
      d.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 5), M.wood, -0.4, 0.05, len * (k + 0.5) / 3));
      d.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.9, 5), M.wood, 0.4, 0.05, len * (k + 0.5) / 3));
    }
    d.rotation.y = ang || 0;
    return d;
  }
  function flag(color) {
    const f = new THREE.Group();
    f.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5), mat("#7a5a3a"), 0, 1.1, 0));
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(1.1, -0.32); shape.lineTo(0, -0.64);
    const cloth = mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, flatShading: true }), 0.05, 2.15, 0);
    f.add(cloth);
    f.userData.cloth = cloth;
    return f;
  }
  function cloud(scale, color, opacity) {
    const c = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({ color: color || "#ffffff", flatShading: true, transparent: true, opacity: opacity || 0.95, roughness: 1 });
    [[0, 0, 0, 1.4], [1.3, -0.2, 0.2, 1.05], [-1.3, -0.25, -0.1, 1.0], [0.4, 0.5, -0.3, 0.9]].forEach(([x, y, z, r]) => {
      c.add(mesh(new THREE.IcosahedronGeometry(r, 0), m, x, y, z, false));
    });
    c.scale.setScalar(scale);
    return c;
  }

  /* ---------- 一座島 ---------- */
  function buildIsland(i) {
    const g = new THREE.Group();
    const r = RAD[i];
    const M = {
      sand: mat("#ead9a6"), grass: mat(["#7cc06f", "#6db56a", "#76b86a", "#8a9d78", "#6fb575"][i]),
      hill: mat(["#58a05a", "#4e9a58", "#5aa262", "#7a8a70", "#4f9c5d"][i]), wood: mat("#8a6240"),
      leaf: mat("#3f9a4e"), wall: mat("#f3ede0"), roofR: mat("#b3262a"), roofB: mat("#2f6f8f"),
      rock: mat("#8d918c"), white: mat("#f7f5ee"), gold: mat("#d9a521", { metalness: 0.3, roughness: 0.5 })
    };
    const all = Object.values(M);

    const base = mesh(new THREE.CylinderGeometry(r + 0.35, r + 1.1, 1.1, 10), M.sand, 0, -0.25, 0);
    base.rotation.y = i * 0.7;
    g.add(base);
    const top = mesh(new THREE.CylinderGeometry(r - 0.3, r + 0.1, 0.5, 9), M.grass, 0, 0.45, 0);
    top.rotation.y = i * 1.3;
    g.add(top);
    const shallow = new THREE.Mesh(new THREE.CircleGeometry(r + 2.6, 28), new THREE.MeshBasicMaterial({ color: "#8fdccf", transparent: true, opacity: 0.55, depthWrite: false }));
    shallow.rotation.x = -Math.PI / 2; shallow.position.y = 0.12;
    g.add(shallow);

    const hillA = mesh(new THREE.ConeGeometry(r * 0.55, r * 0.75, 7), M.hill, -r * 0.25, 0.7 + r * 0.37, -r * 0.25);
    hillA.rotation.y = i;
    g.add(hillA);
    let flagSpot = new THREE.Vector3(-r * 0.25, 0.7 + r * 0.75, -r * 0.25);

    if (i === 0) { // 啟航港
      g.add(dock(M, 2.6, 0.25));
      house(g, M, 1.3, 0.6, M.roofR, 0.3);
      house(g, M, 0.4, 1.8, M.roofB, -0.2);
      palm(g, M, -1.6, 1.4, 1.8, 0.2);
      palm(g, M, 1.9, -1.2, 1.5, 1);
    } else if (i === 1) { // 課程成果灣：一疊書與教室
      const cols = ["#c9453f", "#2f6f8f", "#d9a521", "#3f8a5a"];
      cols.forEach((c, k) => {
        const b = mesh(new THREE.BoxGeometry(1.5 - k * 0.12, 0.28, 1.05), mat(c), 1.4, 0.85 + k * 0.29, 0.6);
        b.rotation.y = k * 0.25 - 0.3;
        all.push(b.material); g.add(b);
      });
      house(g, M, -0.4, 1.9, M.roofR, 0);
      house(g, M, -1.8, 0.9, M.roofB, 0.5);
      palm(g, M, 2.6, -1.2, 1.7, 0.5);
      palm(g, M, -2.8, -0.6, 1.5, 2);
      palm(g, M, 0.6, -2.6, 1.6, 1.2);
    } else if (i === 2) { // 主軸燈塔
      const lh = new THREE.Group();
      lh.add(mesh(new THREE.CylinderGeometry(0.45, 0.7, 3.4, 10), M.white, 0, 1.7, 0));
      [0.9, 2.1].forEach(y => lh.add(mesh(new THREE.CylinderGeometry(0.58 - y * 0.05, 0.62 - y * 0.05, 0.4, 10), M.roofR, 0, y, 0)));
      const lamp = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 10), new THREE.MeshStandardMaterial({ color: "#ffe08a", emissive: "#ffcc33", emissiveIntensity: 0.9 }), 0, 3.65, 0);
      lh.add(lamp);
      const cap = mesh(new THREE.ConeGeometry(0.55, 0.6, 10), M.roofR, 0, 4.2, 0);
      lh.add(cap);
      lh.position.set(0.9, 0.7, 0.2);
      g.add(lh);
      beamPivot = new THREE.Group();
      beamPivot.position.set(0.9, 4.35, 0.2);
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 7, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: "#fff1b0", transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      beam.rotation.z = Math.PI / 2; beam.position.x = -3.5;
      beamPivot.add(beam);
      g.add(beamPivot);
      rock(g, M, 2.3, 1.5, 0.45); rock(g, M, -1.9, 1.7, 0.35);
      palm(g, M, -1.2, 1.9, 1.5, 0.7);
      flagSpot = new THREE.Vector3(-r * 0.25, 0.7 + r * 0.75, -r * 0.25);
    } else if (i === 3) { // 自述礁岩
      rock(g, M, 1.3, 0.8, 1.0, 0.5); rock(g, M, 2.2, -0.6, 0.7, 0.5); rock(g, M, 0.2, 2.0, 0.55, 0.5);
      rock(g, M, -2.2, 1.6, 0.45, 0.5);
      rock(g, M, r + 1.2, 1.6, 0.6, -0.4); rock(g, M, r + 1.9, 0.4, 0.4, -0.4);
      palm(g, M, -1.5, -1.9, 1.4, 0.4);
    } else { // 終點碼頭
      g.add(dock(M, 2.8, -0.2));
      const chest = new THREE.Group();
      chest.add(mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), M.wood, 0, 0.25, 0));
      const lid = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 8, 1, false, 0, Math.PI), M.wood, 0, 0.5, 0);
      lid.rotation.z = Math.PI / 2;
      chest.add(lid);
      chest.add(mesh(new THREE.BoxGeometry(0.16, 0.2, 0.05), M.gold, 0, 0.45, 0.31));
      chest.position.set(1.4, 0.7, 0.9);
      chest.rotation.y = -0.4;
      g.add(chest);
      house(g, M, -1.0, 1.5, M.roofR, 0.2);
      palm(g, M, 2.4, -1.0, 1.7, 0.1);
      palm(g, M, -2.4, -0.2, 1.6, 0.9);
    }

    const doneFlag = flag("#d9a521");
    doneFlag.position.copy(flagSpot).add(new THREE.Vector3(0, -0.15, 0));
    doneFlag.visible = false;
    g.add(doneFlag);

    const fog = cloud(0.95, "#dfe6e4", 0.92);
    fog.position.set(0, r * 0.75 + 2.2, 0);
    fog.visible = false;
    g.add(fog);

    const hit = new THREE.Mesh(new THREE.CylinderGeometry(r + 1.2, r + 1.2, 6, 12), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 2;
    hit.userData.island = i;
    g.add(hit);

    g.position.set(POS[i][0], 0, POS[i][2]);
    g.traverse(o => { if (o.isMesh && o.material && o.material.userData && o.material.userData.base && !all.includes(o.material)) all.push(o.material); });
    scene.add(g);
    return { g, mats: all, flag: doneFlag, fog, hit, fogBase: fog.position.y };
  }

  /* ---------- 拼板舟 ---------- */
  function buildBoat() {
    const b = new THREE.Group();
    const s = new THREE.Shape();
    s.moveTo(-1.5, 1.0); s.quadraticCurveTo(-1.25, 0.2, -0.6, 0.0); s.lineTo(0.6, 0.0);
    s.quadraticCurveTo(1.25, 0.2, 1.5, 1.0); s.lineTo(1.2, 0.95); s.quadraticCurveTo(0.9, 0.4, 0.4, 0.4);
    s.lineTo(-0.4, 0.4); s.quadraticCurveTo(-0.9, 0.4, -1.2, 0.95); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.7, bevelEnabled: false });
    geo.translate(0, 0, -0.35);
    const hull = mesh(geo, mat("#f7f2e6"), 0, -0.15, 0);
    b.add(hull);
    const red = mat("#b3262a"), black = mat("#222");
    [-0.36, 0.36].forEach(z => {
      for (let k = -2; k <= 2; k++) {
        const tri = mesh(new THREE.ConeGeometry(0.11, 0.22, 3), k % 2 ? black : red, k * 0.25, 0.12, z * 1.02, false);
        tri.rotation.x = z > 0 ? Math.PI / 2 : -Math.PI / 2;
        b.add(tri);
      }
      [-0.95, 0.95].forEach(x => {
        const eye = mesh(new THREE.TorusGeometry(0.1, 0.03, 6, 12), red, x, 0.35, z * 1.03, false);
        b.add(eye);
      });
    });
    const sm = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
    sprite = new THREE.Sprite(sm);
    sprite.scale.set(2.6, 2.6, 1);
    sprite.position.set(0, 1.45, 0);
    sprite.visible = false;
    b.add(sprite);
    b.scale.setScalar(0.95);
    scene.add(b);
    return b;
  }

  /* ---------- 飛魚 ---------- */
  function buildFish() {
    const f = new THREE.Group();
    const body = mesh(new THREE.ConeGeometry(0.11, 0.6, 5), mat("#3a5f8a", { roughness: 0.4, metalness: 0.3 }), 0, 0, 0, false);
    body.rotation.z = Math.PI / 2;
    f.add(body);
    const wm = new THREE.MeshStandardMaterial({ color: "#a9d2ef", side: THREE.DoubleSide, transparent: true, opacity: 0.85 });
    [-1, 1].forEach(s => {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), wm);
      w.rotation.x = Math.PI / 2;
      w.position.set(0.05, 0.02, s * 0.27);
      f.add(w);
    });
    f.visible = false;
    scene.add(f);
    return { o: f, active: false, wait: 1 + Math.random() * 5, t: 0, dur: 1, from: new THREE.Vector3(), to: new THREE.Vector3(), h: 1 };
  }
  function launchFish(fh, near) {
    const c = near != null ? new THREE.Vector3(POS[near][0], 0, POS[near][2]) : new THREE.Vector3((Math.random() - 0.5) * 50, 0, (Math.random() - 0.5) * 30);
    const a = Math.random() * Math.PI * 2, rr = (near != null ? RAD[near] + 2.5 : 0) + Math.random() * 3;
    fh.from.set(c.x + Math.cos(a) * rr, 0, c.z + Math.sin(a) * rr);
    const d = Math.random() * Math.PI * 2, len = 3 + Math.random() * 3;
    fh.to.set(fh.from.x + Math.cos(d) * len, 0, fh.from.z + Math.sin(d) * len);
    fh.h = 0.9 + Math.random() * 0.9;
    fh.dur = 0.9 + Math.random() * 0.6;
    fh.t = 0; fh.active = true; fh.o.visible = true;
  }

  /* ---------- 初始化 ---------- */
  W.init = function (cv, lab, o) {
    canvas = cv; labelsEl = lab; opts = o || {};
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) { return false; }
    if (!renderer.getContext()) return false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color("#bfe3de");
    scene.fog = new THREE.Fog("#bfe3de", 70, 150);

    camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
    camera.position.copy(HOME.pos);

    scene.add(new THREE.HemisphereLight("#ffffff", "#4f8f88", 0.75));
    const sun = new THREE.DirectionalLight("#fff3dc", 0.95);
    sun.position.set(18, 32, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 22, bottom: -22, near: 1, far: 90 });
    scene.add(sun);

    // 海
    const wg = new THREE.PlaneGeometry(260, 200, 104, 80);
    wg.rotateX(-Math.PI / 2);
    wBase = Float32Array.from(wg.attributes.position.array);
    water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: "#3a9ea0", flatShading: true, roughness: 0.35, metalness: 0.1 }));
    water.receiveShadow = true;
    scene.add(water);

    for (let i = 0; i < POS.length; i++) islands.push(buildIsland(i));

    // 航線（從每座島的碼頭點串起來）
    const docks = POS.map((p, i) => new THREE.Vector3(p[0], 0.18, p[2] + RAD[i] + 1.8));
    curve = new THREE.CatmullRomCurve3(docks, false, "catmullrom", 0.4);
    const lg = new THREE.BufferGeometry().setFromPoints(curve.getPoints(260));
    const line = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: "#ffffff", dashSize: 0.7, gapSize: 0.55, transparent: true, opacity: 0.9 }));
    line.computeLineDistances();
    scene.add(line);

    boat = buildBoat();

    marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color: "#e0474c", emissive: "#7a1013", emissiveIntensity: 0.4, flatShading: true }));
    marker.scale.y = 1.5;
    scene.add(marker);

    for (let k = 0; k < 7; k++) fishes.push(buildFish());
    for (let k = 0; k < 7; k++) {
      const c = cloud(0.9 + Math.random() * 0.9);
      c.position.set(-60 + k * 18 + Math.random() * 6, 13 + Math.random() * 5, -24 + Math.random() * 30);
      c.userData.speed = 0.3 + Math.random() * 0.4;
      clouds.push(c); scene.add(c);
    }

    // 島名標籤
    POS.forEach((p, i) => {
      const d = document.createElement("button");
      d.className = "ilabel";
      d.type = "button";
      d.addEventListener("click", () => opts.onPick && opts.onPick(i));
      labelsEl.appendChild(d);
      labels.push(d);
    });

    controls = new THREE.OrbitControls(camera, canvas);
    controls.target.copy(HOME.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = MIN_D;
    controls.maxDistance = MAX_D;
    controls.maxPolarAngle = 1.32;
    controls.minPolarAngle = 0.25;
    controls.screenSpacePanning = false;
    controls.addEventListener("start", () => { fly = null; opts.onInteract && opts.onInteract(); });
    controls.update();

    // 點島
    let down = null;
    canvas.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener("pointerup", e => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const r = canvas.getBoundingClientRect();
      const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(v, camera);
      const hit = rc.intersectObjects(islands.map(x => x.hit))[0];
      if (hit && opts.onPick) opts.onPick(hit.object.userData.island);
    });

    const ro = new ResizeObserver(size);
    ro.observe(canvas.parentElement);
    window.addEventListener("resize", size);
    size();
    W.ok = true;
    requestAnimationFrame(loop);
    return true;
  };

  function size() {
    const el = canvas.parentElement, w = el.clientWidth, h = el.clientHeight;
    if (!w || !h) return;
    offsetPx = window.innerWidth > 820 ? 392 : 0;
    renderer.setSize(w, h, false);
    camera.aspect = (w + offsetPx) / h;
    if (offsetPx) camera.setViewOffset(w + offsetPx, h, 0, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  /* ---------- 狀態 ---------- */
  W.setStatus = function (st, sel, cur, img) {
    status = st;
    st.forEach((s, i) => {
      const I = islands[i];
      I.mats.forEach(m => { m.color.copy(m.userData.base); if (s.locked) m.color.lerp(GRAY, 0.6); });
      I.flag.visible = s.done;
      I.fog.visible = s.locked;
      const L = labels[i];
      L.className = "ilabel" + (s.locked ? " locked" : "") + (s.done ? " done" : "") + (i === cur ? " cur" : "") + (i === sel ? " sel" : "");
      L.innerHTML = `<b>${s.locked ? "🔒 " : s.done ? "🏁 " : ""}${s.name}</b><small>${s.count}/${s.total} 關${i === cur ? "・下一站" : ""}</small>`;
      L.setAttribute("aria-label", `${s.name}，${s.count}/${s.total} 關${s.locked ? "，尚未開放" : ""}`);
    });
    const target = cur < 0 ? POS.length - 1 : cur;
    boatGoal = target / (POS.length - 1);
    if (!boatInit) { boatT = boatGoal; boatInit = true; }
    marker.visible = cur >= 0;
    marker.userData.island = target;
    if (img && img !== lastImg) {
      lastImg = img;
      new THREE.TextureLoader().load(img, tex => {
        sprite.material.map = tex;
        sprite.material.needsUpdate = true;
        sprite.visible = true;
      }, undefined, () => { sprite.visible = false; });
    }
  };

  /* ---------- 鏡頭 ---------- */
  function flyTo(pos, target, dur) {
    fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, k: 0, dur: dur || 1.1 };
  }
  W.focus = function (i) {
    const c = new THREE.Vector3(POS[i][0], 0.5, POS[i][2]);
    flyTo(c.clone().add(new THREE.Vector3(0, 16, 23)), c.add(new THREE.Vector3(0, 0, 1.5)), 1.1);
  };
  W.overview = function () { flyTo(HOME.pos.clone(), HOME.target.clone(), 1.2); };
  W.zoom = function (f) {
    const d = camera.position.clone().sub(controls.target);
    const len = THREE.MathUtils.clamp(d.length() * f, MIN_D, MAX_D);
    flyTo(controls.target.clone().add(d.setLength(len)), controls.target.clone(), 0.4);
  };
  W.splash = function (i) {
    let n = 0;
    fishes.forEach(fh => { if (n < 5) { launchFish(fh, i); fh.t = -n * 0.18; n++; } });
  };
  function zoomPct() {
    const d = camera.position.distanceTo(controls.target);
    return Math.round((1 - (d - MIN_D) / (MAX_D - MIN_D)) * 100);
  }

  /* ---------- 動畫 ---------- */
  let lastPct = -1;
  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;

    // 海浪
    const p = water.geometry.attributes.position, a = p.array;
    for (let k = 0; k < a.length; k += 3) {
      const x = wBase[k], z = wBase[k + 2];
      a[k + 1] = Math.sin(x * 0.22 + t * 1.1) * 0.16 + Math.cos(z * 0.27 + t * 0.8) * 0.14 + Math.sin((x + z) * 0.5 + t * 1.7) * 0.05;
    }
    p.needsUpdate = true;
    water.geometry.computeVertexNormals();

    if (fly) {
      fly.k = Math.min(1, fly.k + dt / fly.dur);
      const e = fly.k < 0.5 ? 4 * fly.k ** 3 : 1 - Math.pow(-2 * fly.k + 2, 3) / 2;
      camera.position.lerpVectors(fly.p0, fly.p1, e);
      controls.target.lerpVectors(fly.t0, fly.t1, e);
      if (fly.k >= 1) fly = null;
    }
    controls.update();

    // 船沿著航線前進
    boatT += (boatGoal - boatT) * Math.min(1, dt * 0.9);
    const u = THREE.MathUtils.clamp(boatT, 0, 1);
    curve.getPointAt(u, tmp);
    boat.position.set(tmp.x, Math.sin(t * 1.6) * 0.1 + 0.1, tmp.z);
    const tan = curve.getTangentAt(Math.min(u, 0.999));
    const moving = Math.abs(boatGoal - boatT) > 0.002;
    const heading = Math.atan2(-tan.z, tan.x);
    boat.rotation.y = moving ? heading : heading + Math.sin(t * 0.5) * 0.15;
    boat.rotation.z = Math.sin(t * 1.3) * 0.05;
    boat.rotation.x = Math.sin(t * 1.1) * 0.04;

    if (marker.visible) {
      const m = marker.userData.island || 0;
      marker.position.set(POS[m][0], RAD[m] * 0.75 + 3.4 + Math.sin(t * 2.4) * 0.3, POS[m][2]);
      marker.rotation.y = t * 1.5;
    }
    if (beamPivot) beamPivot.rotation.y = t * 0.9;
    islands.forEach((I, i) => {
      if (I.flag.visible) I.flag.userData.cloth.rotation.y = Math.sin(t * 3 + i) * 0.25;
      if (I.fog.visible) I.fog.position.y = I.fogBase + Math.sin(t * 0.8 + i) * 0.2;
    });
    clouds.forEach(c => { c.position.x += c.userData.speed * dt; if (c.position.x > 70) c.position.x = -70; });

    // 飛魚
    fishes.forEach(fh => {
      if (!fh.active) {
        fh.wait -= dt;
        if (fh.wait <= 0) launchFish(fh);
        return;
      }
      fh.t += dt;
      if (fh.t < 0) { fh.o.visible = false; return; }
      fh.o.visible = true;
      const k = fh.t / fh.dur;
      if (k >= 1) { fh.active = false; fh.o.visible = false; fh.wait = 2 + Math.random() * 6; return; }
      fh.o.position.lerpVectors(fh.from, fh.to, k);
      fh.o.position.y = fh.h * 4 * k * (1 - k) - 0.1;
      fh.o.rotation.y = Math.atan2(-(fh.to.z - fh.from.z), fh.to.x - fh.from.x);
      fh.o.rotation.z = fh.h * 4 * (1 - 2 * k) * 0.35;
    });

    renderer.render(scene, camera);

    // 標籤位置
    const w = canvas.clientWidth, h = canvas.clientHeight;
    labels.forEach((L, i) => {
      tmp.set(POS[i][0], RAD[i] * 0.75 + 2.4, POS[i][2]).project(camera);
      if (tmp.z > 1) { L.style.display = "none"; return; }
      L.style.display = "";
      const x = (tmp.x + 1) / 2 * w, y = (1 - tmp.y) / 2 * h;
      L.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-100%)`;
    });
    const pc = zoomPct();
    if (pc !== lastPct) { lastPct = pc; opts.onZoom && opts.onZoom(pc); }
  }

  window.World = W;
})();
