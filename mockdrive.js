// Demo backend: behaves like the Drive backend but keeps everything in browser memory.
// Open the app with ?demo in the URL to try it without Google setup. Nothing is saved after a refresh.
import { FOLDER_MIME } from './drive.js';
import { GROUP_TIERS } from './pricing.js';

let seq = 1;
const nid = () => 'demo' + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

export class MockDrive {
  constructor() {
    this.isDemo = true;
    this.files = new Map();
    this.user = { name: 'Demo user', email: 'demo@example.com' };
    this.rootId = this._add({ name: 'Catalog App', mimeType: FOLDER_MIME, parents: [] }).id;
  }

  _add(f) {
    const now = new Date().toISOString();
    const file = { id: nid(), version: '1', createdTime: now, modifiedTime: now, trashed: false, size: '0',
      lastModifyingUser: { displayName: this.user?.name || 'Demo user' }, owners: [{ displayName: 'Demo user' }], ...f };
    this.files.set(file.id, file);
    return file;
  }
  _pub(f) {
    const { content, ...rest } = f;
    return { ...rest, webViewLink: '#', fileExtension: (f.name.split('.').pop() || '').toLowerCase() };
  }
  _touch(f) {
    f.version = String(Number(f.version) + 1);
    f.modifiedTime = new Date().toISOString();
    f.lastModifyingUser = { displayName: this.user.name };
  }
  async _delay() { await new Promise((r) => setTimeout(r, 40)); }

  restoreSession() { return true; }
  async signIn() {}
  signOut() {}
  async getUser() { return this.user; }
  async getFile(id) { await this._delay(); const f = this.files.get(id); if (!f) throw Object.assign(new Error('File not found'), { status: 404 }); return this._pub(f); }
  async getFolderAccess(id) { const f = this.files.get(id); if (!f) throw Object.assign(new Error('File not found'), { status: 404 }); return { id, name: f.name, isFolder: true, trashed: f.trashed, link: '#', canEdit: true }; }

  async list(parentId, { foldersOnly = false, filesOnly = false } = {}) {
    await this._delay();
    return [...this.files.values()].filter((f) => !f.trashed && f.parents.includes(parentId)
      && (!foldersOnly || f.mimeType === FOLDER_MIME) && (!filesOnly || f.mimeType !== FOLDER_MIME))
      .sort((a, b) => a.name.localeCompare(b.name)).map((f) => this._pub(f));
  }
  async findNamedInParents(parentIds, names) {
    await this._delay();
    return [...this.files.values()].filter((f) => !f.trashed && names.includes(f.name) && f.parents.some((p) => parentIds.includes(p))).map((f) => this._pub(f));
  }
  async findChild(parentId, name, folder = null) {
    const r = (await this.list(parentId)).filter((f) => f.name === name && (folder !== true || f.mimeType === FOLDER_MIME));
    return r[0] || null;
  }
  async createFolder(parentId, name) { await this._delay(); return this._pub(this._add({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : [] })); }
  async ensureFolder(parentId, name) { return (await this.findChild(parentId, name, true)) || this.createFolder(parentId, name); }

  async readJSON(fileId) {
    await this._delay();
    const f = this.files.get(fileId);
    if (!f) throw Object.assign(new Error('File not found'), { status: 404 });
    return { data: JSON.parse(f.content || 'null'), version: f.version, meta: this._pub(f) };
  }
  async writeJSON(parentId, name, data, fileId = null) {
    await this._delay();
    const content = JSON.stringify(data);
    if (fileId) { const f = this.files.get(fileId); f.content = content; f.size = String(content.length); this._touch(f); return this._pub(f); }
    return this._pub(this._add({ name, parents: [parentId], mimeType: 'application/json', content, size: String(content.length) }));
  }
  async upload(parentId, file, onProgress, name = null) {
    for (let p = 0.2; p <= 1; p += 0.2) { onProgress?.(Math.min(p, 1)); await this._delay(); }
    return this._pub(this._add({ name: name || file.name, parents: [parentId], mimeType: file.type || 'application/octet-stream', content: file, size: String(file.size) }));
  }
  async replaceContent(fileId, blob) { const f = this.files.get(fileId); f.content = blob; f.size = String(blob.size); this._touch(f); return this._pub(f); }
  async download(fileId) {
    await this._delay();
    const f = this.files.get(fileId);
    if (!f) throw Object.assign(new Error('File not found'), { status: 404 });
    return f.content instanceof Blob ? f.content : new Blob([f.content || ''], { type: f.mimeType });
  }
  async rename(fileId, name) { const f = this.files.get(fileId); f.name = name; this._touch(f); return this._pub(f); }
  async move(fileId, toParent, fromParent) { const f = this.files.get(fileId); f.parents = f.parents.filter((p) => p !== fromParent).concat(toParent); return { id: fileId, parents: f.parents }; }
  async trash(fileId) { const f = this.files.get(fileId); if (f) f.trashed = true; }
  async copy(fileId, parentId, name) {
    const { id, version, createdTime, modifiedTime, ...rest } = this.files.get(fileId);
    return this._pub(this._add({ ...rest, name, parents: [parentId] }));
  }
  folderLink() { return '#'; }
  fileLink() { return '#'; }
}

// ── demo content ───────────────────────────────────────────────
function renderSVG({ w = 1200, h = 800, sky = '#dfe8ee', wall = '#5d6468', roof = '#2b2f31', door = '#c9ccce', trim = '#FBE200', width = 0.5, garage = false, deck = false, label = '' }) {
  const bw = w * width, bx = (w - bw) / 2, by = h * 0.42, bh = h * 0.36;
  const peak = h * 0.22;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="#f5f7f8"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#s)"/>
  <rect y="${by + bh}" width="${w}" height="${h - by - bh}" fill="#9fb48a"/>
  <rect y="${by + bh}" width="${w}" height="10" fill="#7f9668"/>
  ${deck ? `<rect x="${bx - 40}" y="${by + bh - 18}" width="${bw * 0.55}" height="24" fill="#a77b52"/>` : ''}
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${wall}"/>
  ${Array.from({ length: Math.floor(bw / 18) }, (_, i) => `<line x1="${bx + i * 18}" y1="${by}" x2="${bx + i * 18}" y2="${by + bh}" stroke="rgba(0,0,0,.12)" stroke-width="2"/>`).join('')}
  <polygon points="${bx - 30},${by + 4} ${w / 2},${peak} ${bx + bw + 30},${by + 4}" fill="${roof}"/>
  <polyline points="${bx - 30},${by + 4} ${w / 2},${peak} ${bx + bw + 30},${by + 4}" fill="none" stroke="${trim}" stroke-width="8"/>
  ${garage ? `<rect x="${bx + bw * 0.12}" y="${by + bh * 0.28}" width="${bw * 0.5}" height="${bh * 0.72}" fill="${door}"/>${Array.from({ length: 6 }, (_, i) => `<line x1="${bx + bw * 0.12}" x2="${bx + bw * 0.62}" y1="${by + bh * 0.28 + i * bh * 0.12}" y2="${by + bh * 0.28 + i * bh * 0.12}" stroke="rgba(0,0,0,.15)" stroke-width="3"/>`).join('')}
    <rect x="${bx + bw * 0.72}" y="${by + bh * 0.38}" width="${bw * 0.14}" height="${bh * 0.62}" fill="${door}"/>`
    : `<rect x="${bx + bw * 0.14}" y="${by + bh * 0.3}" width="${bw * 0.22}" height="${bh * 0.3}" fill="#bcd3e0" stroke="#e8eaeb" stroke-width="6"/>
    <rect x="${bx + bw * 0.58}" y="${by + bh * 0.3}" width="${bw * 0.18}" height="${bh * 0.7}" fill="${door}"/>`}
  <text x="40" y="${h - 36}" font-family="Arial" font-size="26" fill="rgba(0,0,0,.35)">${label}</text>
</svg>`;
}

const svgFile = (name, opts) => new File([renderSVG(opts)], name, { type: 'image/svg+xml' });

export async function seedDemo(store) {
  const now = new Date().toISOString();
  const add = async (item) => store.addPriceItem({ markup: '', supplier: '', notes: '', ...item });
  const P = {};
  P.frame = await add({ name: 'Steel framing 89mm (light gauge)', group: 'Framing', unit: 'lm', cost: 19.5 });
  P.iron = await add({ name: 'Corrugated roofing iron 0.40 BMT', group: 'Roofing', unit: 'm²', cost: 32 });
  P.clad = await add({ name: 'Trimdek wall cladding 0.40 BMT', group: 'Cladding', unit: 'm²', cost: 36 });
  P.flash = await add({ name: 'Flashings set (barge, corner, apron)', group: 'Flashings', unit: 'lm', cost: 18 });
  P.gdoor = await add({ name: 'Sectional garage door 2.4 × 2.1', group: 'Doors', unit: 'each', cost: 2150 });
  P.pa = await add({ name: 'PA door 810 mm', group: 'Doors', unit: 'each', cost: 640 });
  P.win = await add({ name: 'Aluminium window 1200 × 900', group: 'Windows', unit: 'each', cost: 520 });
  P.labour = await add({ name: 'Install labour', group: 'Labour', unit: 'hr', cost: 68 });
  P.delivery = await add({ name: 'Delivery — Waikato', group: 'Delivery', unit: 'lump sum', cost: 450 });

  const L = (item, qty, markup = 20) => ({ id: Math.random().toString(36).slice(2), priceListId: item.id, description: item.name, group: item.group, tier: GROUP_TIERS[item.group] || 'built', unit: item.unit, qty, unitCost: item.cost, markup, custom: false });
  const C = (description, group, unit, qty, unitCost, markup = 20) => ({ id: Math.random().toString(36).slice(2), priceListId: null, description, group, tier: GROUP_TIERS[group] || 'built', unit, qty, unitCost, markup, custom: true });

  const designs = [
    { category: 'sheds', name: 'Single Garage 6 × 6', status: 'published',
      description: 'A tidy single garage with room for a car and a workbench. Steel framed, low maintenance and built to last.',
      specs: { length: 6, width: 6, studHeight: 2.7, roofStyle: 'Gable', roofPitch: 15, roofing: 'Corrugated', cladding: 'Trimdek', windZone: 'High', consent: 'Required', leadTime: '6–8 weeks' },
      included: ['Light gauge steel frame', 'Corrugated roofing and Trimdek cladding', 'Sectional garage door', 'PA door and one window', 'Flashings and spouting', 'Delivery within Waikato'],
      excluded: ['Concrete slab', 'Electrical', 'Building consent fees'],
      lines: [L(P.frame, 215), L(P.iron, 42), L(P.clad, 68), L(P.flash, 38), L(P.gdoor, 1, 15), L(P.pa, 1), L(P.win, 1), L(P.labour, 32), L(P.delivery, 1, 0)],
      renders: [{ garage: true, label: 'Single Garage 6 × 6' }, { garage: true, wall: '#3d4a3f', label: 'Shown in Karaka' }] },
    { category: 'sheds', name: 'Double Garage 6 × 9', status: 'published',
      description: 'Two-car garage with a high stud for storage racking.',
      specs: { length: 9, width: 6, studHeight: 3, roofStyle: 'Gable', roofPitch: 15, roofing: 'Corrugated', cladding: 'Trimdek', windZone: 'High', consent: 'Required', leadTime: '8–10 weeks' },
      included: ['Light gauge steel frame', 'Two sectional garage doors', 'PA door and two windows', 'Flashings and spouting'],
      excluded: ['Concrete slab', 'Electrical'],
      lines: [L(P.frame, 318), L(P.iron, 62), L(P.clad, 96), L(P.flash, 52), L(P.gdoor, 2, 15), L(P.pa, 1), L(P.win, 2), L(P.labour, 44), L(P.delivery, 1, 0)],
      renders: [{ garage: true, width: 0.64, wall: '#6e6a62', label: 'Double Garage 6 × 9' }] },
    { category: 'garden-sheds', name: 'Potting Shed 2.4 × 1.8', status: 'published',
      description: 'Compact garden shed with a window for potting and seed raising.',
      specs: { length: 2.4, width: 1.8, studHeight: 2.1, roofStyle: 'Skillion', roofPitch: 5, roofing: 'Corrugated', cladding: 'Corrugated', windZone: 'Medium', consent: 'Not usually required', leadTime: '2–3 weeks' },
      included: ['Steel frame', 'Corrugated cladding and roof', 'Hinged door', 'Window'],
      excluded: ['Base or pad'],
      lines: [L(P.frame, 46), L(P.iron, 18), C('Hinged shed door', 'Doors', 'each', 1, 380), L(P.win, 1), L(P.labour, 6)],
      renders: [{ width: 0.34, wall: '#4f6b58', label: 'Potting Shed' }] },
    { category: 'granny-flats', name: 'Studio 30', status: 'draft',
      description: 'One-bedroom studio with an open-plan kitchen and living space.',
      specs: { length: 7.5, width: 4, studHeight: 2.4, roofStyle: 'Gable', roofPitch: 20, roofing: 'Corrugated', cladding: 'Weatherboard look steel', bedrooms: 1, bathrooms: 1, windZone: 'High', consent: 'Required', leadTime: '12–14 weeks' },
      included: ['Steel frame and roof structure', 'Exterior cladding and roofing', 'Windows and entry door'],
      excluded: ['Foundations', 'Plumbing and electrical', 'Internal fit-out'],
      lines: [L(P.frame, 265), L(P.iron, 40), L(P.clad, 70), L(P.flash, 46), L(P.win, 4), L(P.pa, 1), L(P.labour, 80)],
      renders: [{ width: 0.6, wall: '#e7e3da', roof: '#3a3f42', deck: true, label: 'Studio 30' }] },
  ];

  for (const d of designs) {
    const build = store.blankBuild(d.category);
    Object.assign(build, { name: d.name, status: d.status, description: d.description, included: d.included, excluded: d.excluded });
    Object.assign(build.specs, d.specs, { floorArea: '' });
    build.costing.lines = d.lines;
    build.priceReviewedAt = now;
    const saved = await store.saveBuild(build, { force: true });
    for (let i = 0; i < d.renders.length; i++) {
      await store.uploadToSection(saved, 'renders', svgFile(`render-${i + 1}.svg`, d.renders[i]));
    }
  }
}
