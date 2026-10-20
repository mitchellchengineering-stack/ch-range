// Interactive IFC viewer: web-ifc parses the model in the browser, three.js draws it.
// Loaded only when someone opens a 3D model, so the rest of the app stays fast.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const WEBIFC_VERSION = '0.0.77';
let ifcApiPromise = null;

async function getIfcApi() {
  if (!ifcApiPromise) {
    ifcApiPromise = (async () => {
      const WebIFC = await import(`https://cdn.jsdelivr.net/npm/web-ifc@${WEBIFC_VERSION}/web-ifc-api.js`);
      const api = new WebIFC.IfcAPI();
      api.SetWasmPath(`https://cdn.jsdelivr.net/npm/web-ifc@${WEBIFC_VERSION}/`, true);
      await api.Init(undefined, true);
      return api;
    })();
    ifcApiPromise.catch(() => { ifcApiPromise = null; });
  }
  return ifcApiPromise;
}

const FRIENDLY = {
  IFCWALL: 'Walls', IFCWALLSTANDARDCASE: 'Walls', IFCSLAB: 'Slabs & floors', IFCROOF: 'Roof', IFCBEAM: 'Beams',
  IFCCOLUMN: 'Columns', IFCMEMBER: 'Framing members', IFCPLATE: 'Plates & sheets', IFCDOOR: 'Doors', IFCWINDOW: 'Windows',
  IFCSTAIR: 'Stairs', IFCSTAIRFLIGHT: 'Stairs', IFCRAILING: 'Railings', IFCCOVERING: 'Coverings', IFCFOOTING: 'Footings',
  IFCFURNISHINGELEMENT: 'Furniture', IFCFURNITURE: 'Furniture', IFCBUILDINGELEMENTPROXY: 'Other elements',
  IFCMECHANICALFASTENER: 'Fasteners', IFCOPENINGELEMENT: 'Openings', IFCSPACE: 'Spaces', IFCFLOWSEGMENT: 'Services',
  IFCFLOWTERMINAL: 'Fixtures', IFCSANITARYTERMINAL: 'Sanitary', IFCCURTAINWALL: 'Curtain walls', IFCPIPESEGMENT: 'Pipes',
};
const HIDDEN_BY_DEFAULT = new Set(['IFCSPACE', 'IFCOPENINGELEMENT']);

export class IfcViewer {
  constructor(container, { background = 0xeef0ef, onSelect = () => {} } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.meshes = [];
    this.byType = new Map(); // type → { label, meshes: [], visible }
    this.selected = null;

    const w = container.clientWidth || 800, h = container.clientHeight || 500;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(background);
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.05, 5000);
    this.camera.position.set(12, 9, 14);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f86, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(30, 50, 20);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-30, 20, -25);
    this.scene.add(fill);

    this.model = new THREE.Group();
    this.scene.add(this.model);
    this.highlight = new THREE.MeshLambertMaterial({ color: 0xfbe200, emissive: 0x4a4300, side: THREE.DoubleSide });

    this.clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    this.raycaster = new THREE.Raycaster();
    this._down = null;

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => { this._down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', (e) => {
      if (!this._down) return;
      const moved = Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y);
      this._down = null;
      if (moved < 5) this.pick(e);
    });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  async load(arrayBuffer, onStage = () => {}) {
    onStage('Starting 3D engine');
    const api = await getIfcApi();
    this.api = api;
    onStage('Reading model');
    const modelID = api.OpenModel(new Uint8Array(arrayBuffer), { COORDINATE_TO_ORIGIN: true });
    this.modelID = modelID;
    const materials = new Map();
    const matFor = (c) => {
      const key = `${c.x.toFixed(3)}-${c.y.toFixed(3)}-${c.z.toFixed(3)}-${c.w.toFixed(3)}`;
      if (!materials.has(key)) {
        materials.set(key, new THREE.MeshLambertMaterial({
          color: new THREE.Color(c.x, c.y, c.z), side: THREE.DoubleSide,
          transparent: c.w < 1, opacity: c.w, depthWrite: c.w >= 1,
        }));
      }
      return materials.get(key);
    };
    onStage('Building geometry');
    api.StreamAllMeshes(modelID, (flatMesh) => {
      const expressID = flatMesh.expressID;
      let typeName = 'IFCELEMENT';
      try { typeName = api.GetNameFromTypeCode(api.GetLineType(modelID, expressID)) || typeName; } catch (e) { /* ignore */ }
      typeName = String(typeName).toUpperCase();
      const pgs = flatMesh.geometries;
      for (let i = 0; i < pgs.size(); i++) {
        const pg = pgs.get(i);
        const g = api.GetGeometry(modelID, pg.geometryExpressID);
        const verts = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
        const idx = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
        const pos = new Float32Array(verts.length / 2), nor = new Float32Array(verts.length / 2);
        for (let k = 0, j = 0; k < verts.length; k += 6, j += 3) {
          pos[j] = verts[k]; pos[j + 1] = verts[k + 1]; pos[j + 2] = verts[k + 2];
          nor[j] = verts[k + 3]; nor[j + 1] = verts[k + 4]; nor[j + 2] = verts[k + 5];
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geom.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
        const mesh = new THREE.Mesh(geom, matFor(pg.color));
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(pg.flatTransformation);
        mesh.userData = { expressID, typeName };
        this.model.add(mesh);
        this.meshes.push(mesh);
        if (!this.byType.has(typeName)) {
          const base = typeName.replace(/TYPE$/, '');
          this.byType.set(typeName, { type: typeName, label: FRIENDLY[base] || prettify(base), meshes: [], visible: !HIDDEN_BY_DEFAULT.has(base) });
        }
        this.byType.get(typeName).meshes.push(mesh);
        g.delete();
      }
    });
    for (const t of this.byType.values()) t.meshes.forEach((m) => { m.visible = t.visible; });
    this.model.updateMatrixWorld(true);
    this.box = new THREE.Box3().setFromObject(this.model);
    this._addGround();
    this.fit();
    onStage('');
    return { elements: this.meshes.length };
  }

  _addGround() {
    if (!this.box || this.box.isEmpty()) return;
    const size = this.box.getSize(new THREE.Vector3());
    const span = Math.ceil(Math.max(size.x, size.z) * 2.2) || 30;
    const grid = new THREE.GridHelper(span, Math.max(10, Math.round(span / 2)), 0xc4c9c6, 0xdadedb);
    grid.position.set((this.box.min.x + this.box.max.x) / 2, this.box.min.y - 0.01, (this.box.min.z + this.box.max.z) / 2);
    this.scene.add(grid);
    this.grid = grid;
  }

  layers() {
    const merged = new Map();
    for (const t of this.byType.values()) {
      const m = merged.get(t.label) || { label: t.label, types: [], count: 0, visible: t.visible };
      m.types.push(t.type); m.count += t.meshes.length; m.visible = m.visible && t.visible;
      merged.set(t.label, m);
    }
    return [...merged.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  setLayerVisible(label, visible) {
    for (const t of this.byType.values()) if (t.label === label) { t.visible = visible; t.meshes.forEach((m) => { m.visible = visible; }); }
  }

  fit() {
    if (!this.box || this.box.isEmpty()) return;
    const center = this.box.getCenter(new THREE.Vector3());
    const size = this.box.getSize(new THREE.Vector3());
    const radius = size.length() / 2 || 5;
    const dist = (radius / Math.sin((this.camera.fov * Math.PI) / 360)) * 0.78;
    const dir = new THREE.Vector3(1, 0.65, 1.15).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(0.01, dist / 500);
    this.camera.far = dist * 50;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  // axis: 'x' | 'y' | 'z' | null; t: 0..1 through the model
  _allMaterials() {
    const set = new Set([this.highlight]);
    this.meshes.forEach((m) => { set.add(m.material); if (m.userData.orig) set.add(m.userData.orig); });
    return set;
  }

  // axis: 'x' | 'y' | 'z' | null; t: 0..1 through the model. Only the model is cut, not the ground grid.
  setSection(axis, t = 0.5) {
    const planes = axis && this.box ? [this.clipPlane] : null;
    if (planes) {
      const normal = { x: new THREE.Vector3(-1, 0, 0), y: new THREE.Vector3(0, -1, 0), z: new THREE.Vector3(0, 0, -1) }[axis];
      const min = this.box.min[axis], max = this.box.max[axis];
      this.clipPlane.normal.copy(normal);
      this.clipPlane.constant = min + (max - min) * t;
    }
    if (!!planes !== !!this.section) this._allMaterials().forEach((m) => { m.clippingPlanes = planes; m.needsUpdate = true; });
    this.section = planes ? { axis, t } : null;
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    const hits = this.raycaster.intersectObjects(this.meshes.filter((m) => m.visible), false)
      .filter((h) => !this.section || this.clipPlane.distanceToPoint(h.point) >= 0);
    this.select(hits[0]?.object || null);
  }

  select(mesh) {
    if (this.selected) this.selected.forEach((m) => { m.material = m.userData.orig; });
    this.selected = null;
    if (!mesh) { this.onSelect(null); return; }
    const id = mesh.userData.expressID;
    const group = this.meshes.filter((m) => m.userData.expressID === id);
    group.forEach((m) => { m.userData.orig = m.material; m.material = this.highlight; });
    this.selected = group;
    this.onSelect(this.info(id, mesh.userData.typeName));
  }

  hideSelected() {
    if (!this.selected) return;
    const s = this.selected;
    this.select(null);
    s.forEach((m) => { m.visible = false; });
    this.hiddenManually = [...(this.hiddenManually || []), ...s];
  }

  showAll() {
    (this.hiddenManually || []).forEach((m) => { m.visible = true; });
    this.hiddenManually = [];
  }

  info(id, typeName) {
    const val = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
    let line = {};
    try { line = this.api.GetLine(this.modelID, id) || {}; } catch (e) { /* ignore */ }
    const base = String(typeName).replace(/TYPE$/, '');
    return {
      id, type: prettify(base), category: FRIENDLY[base] || prettify(base),
      name: decodeIfc(val(line.Name)) || '', objectType: decodeIfc(val(line.ObjectType)) || '', tag: decodeIfc(val(line.Tag)) || '',
      description: decodeIfc(val(line.Description)) || '',
    };
  }

  screenshot() { return this.renderer.domElement.toDataURL('image/png'); }

  dispose() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.meshes.forEach((m) => m.geometry.dispose());
    const mats = new Set(this.meshes.map((m) => m.userData.orig || m.material));
    mats.forEach((m) => m.dispose());
    this.highlight.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    try { if (this.api && this.modelID !== undefined) this.api.CloseModel(this.modelID); } catch (e) { /* ignore */ }
  }
}

function prettify(t) {
  return String(t).replace(/^IFC/, '').toLowerCase().replace(/^./, (c) => c.toUpperCase()) || 'Element';
}

// IFC strings can contain \X2\....\X0\ unicode escapes
function decodeIfc(s) {
  if (!s || typeof s !== 'string') return s;
  return s.replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, hex) => hex.match(/.{4}/g).map((h) => String.fromCharCode(parseInt(h, 16))).join(''));
}
