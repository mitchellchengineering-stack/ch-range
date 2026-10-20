// Data layer. Knows the Catalog App folder structure and keeps an in-memory cache of what's been loaded.
//
//  Catalog App/
//  ├── _App Data/  settings.json · price-list.json · price-history.json
//  ├── Garden Sheds/  GS-001 Name/  details.json · _thumbnail.jpg · Plans/ · Framing Detailing/ · 3D Model/ · Renders/
//  ├── Sheds/ · Granny Flats/ · Homes/
//  └── _Archive/
import { uid, num, priceMapOf } from './pricing.js';

export const SECTIONS = [
  { key: 'plans', folder: 'Plans', label: 'Plans', accept: '.pdf,application/pdf,image/*' },
  { key: 'framing', folder: 'Framing Detailing', label: 'Framing detailing', accept: '' },
  { key: 'model', folder: '3D Model', label: '3D model', accept: '.ifc,.IFC' },
  { key: 'renders', folder: 'Renders', label: 'Renders', accept: 'image/*' },
];

export const DEFAULT_SETTINGS = {
  businessName: 'CH Engineering',
  tagline: 'Steel Framed Homes',
  phone: '', email: '', website: '', address: '',
  defaultMarkup: 20,
  rounding: 0,
  clientPin: '1234',
  priceReviewMonths: 6,
  specSheetFooter: 'All prices exclude GST. Pricing is indicative and subject to site assessment, council requirements and a final written quote.',
  categories: [
    { id: 'garden-sheds', name: 'Garden Sheds', singular: 'Garden Shed', code: 'GS', residential: false },
    { id: 'sheds', name: 'Sheds', singular: 'Shed', code: 'SH', residential: false },
    { id: 'granny-flats', name: 'Granny Flats', singular: 'Granny Flat', code: 'GF', residential: true },
    { id: 'homes', name: 'Homes', singular: 'Home', code: 'HM', residential: true },
  ],
};

const APPDATA = '_App Data', ARCHIVE = '_Archive';
const SETTINGS = 'settings.json', PRICES = 'price-list.json', HISTORY = 'price-history.json';
const DETAILS = 'details.json', THUMB = '_thumbnail.jpg';
// Screenshot of the 3D model that the spec sheet uses. Lives in the 3D Model folder.
export const SPECVIEW = '_spec-view.png';

const clone = (o) => JSON.parse(JSON.stringify(o));
const nowISO = () => new Date().toISOString();
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();

async function pool(items, size, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

async function blobToJSON(blob) {
  const t = await blob.text();
  return t ? JSON.parse(t) : null;
}

export async function makeThumbnail(blob, maxW = 720) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image'));
      i.src = url;
    });
    const w = img.naturalWidth || 1200, h = img.naturalHeight || 800;
    const scale = Math.min(1, maxW / w);
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', 0.82));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export class Store {
  constructor(drive, rootId) {
    this.drive = drive;
    this.rootId = rootId;
    this.listeners = new Set();
    this.rev = 0;
    this.builds = new Map();       // folderId → entry
    this.catLoaded = new Set();
    this.archiveLoaded = false;
    this.blobs = new Map();        // fileId → Promise<Blob>
    this.urls = new Map();         // fileId → Promise<objectURL>
    this.history = null;
    this.fileVer = new Map();     // fileId → bump when content replaced
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.rev++; this.listeners.forEach((fn) => fn(this.rev)); }

  static async createRootFolder(drive) {
    return drive.createFolder(null, 'Catalog App');
  }

  // ── boot ───────────────────────────────────────────────────
  async boot() {
    const d = this.drive;
    let access;
    try {
      access = await d.getFolderAccess(this.rootId);
    } catch (e) {
      if (e.status === 404) throw Object.assign(new Error('The Catalog App folder could not be found, or it hasn’t been shared with this Google account.'), { code: 'noaccess' });
      throw e;
    }
    if (!access.isFolder || access.trashed) throw Object.assign(new Error('The Catalog App folder ID points to something that isn’t an active folder.'), { code: 'noaccess' });
    this.canEdit = access.canEdit;
    this.rootLink = access.link;
    this.rootName = access.name;
    this.user = await d.getUser();

    const rootKids = await d.list(this.rootId, { foldersOnly: true });
    const byName = (list, n) => list.find((f) => f.name === n);

    let app = byName(rootKids, APPDATA);
    if (!app) {
      if (!this.canEdit) throw Object.assign(new Error('The Catalog App folder hasn’t been set up yet. Ask someone with edit access to open the app once first.'), { code: 'notsetup' });
      app = await d.createFolder(this.rootId, APPDATA);
    }
    this.appDataId = app.id;
    let arch = byName(rootKids, ARCHIVE);
    if (!arch && this.canEdit) arch = await d.createFolder(this.rootId, ARCHIVE);
    this.archiveId = arch?.id || null;

    const appFiles = await d.list(app.id, { filesOnly: true });
    const sFile = byName(appFiles, SETTINGS), pFile = byName(appFiles, PRICES), hFile = byName(appFiles, HISTORY);

    // settings
    if (sFile) {
      const saved = (await blobToJSON(await d.download(sFile.id))) || {};
      this.settings = { ...clone(DEFAULT_SETTINGS), ...saved, categories: saved.categories?.length ? saved.categories : clone(DEFAULT_SETTINGS.categories) };
      this.settingsFileId = sFile.id; this.settingsVersion = sFile.version;
    } else {
      this.settings = clone(DEFAULT_SETTINGS);
      if (this.canEdit) { const m = await d.writeJSON(app.id, SETTINGS, this.settings); this.settingsFileId = m.id; this.settingsVersion = m.version; }
    }
    // price list
    if (pFile) {
      this.priceList = (await blobToJSON(await d.download(pFile.id))) || { items: [] };
      this.priceFileId = pFile.id;
    } else {
      this.priceList = { items: [], updatedAt: nowISO() };
      if (this.canEdit) this.priceFileId = (await d.writeJSON(app.id, PRICES, this.priceList)).id;
    }
    if (!this.priceList.items) this.priceList.items = [];
    this.historyFileId = hFile?.id || null;

    // category folders
    let changed = false;
    for (const cat of this.settings.categories) {
      let f = cat.folderId && rootKids.find((k) => k.id === cat.folderId);
      if (!f) f = byName(rootKids, cat.name);
      if (!f && this.canEdit) f = await d.createFolder(this.rootId, cat.name);
      if (f && f.id !== cat.folderId) { cat.folderId = f.id; changed = true; }
    }
    if (changed && this.canEdit) await this._writeSettings();
    this.emit();
  }

  get priceMap() {
    if (this._pmSrc !== this.priceList) { this._pmSrc = this.priceList; this._pm = priceMapOf(this.priceList); }
    return this._pm;
  }

  cat(id) { return this.settings.categories.find((c) => c.id === id) || null; }
  catByFolder(folderId) { return this.settings.categories.find((c) => c.folderId === folderId) || null; }

  // ── designs ────────────────────────────────────────────────
  buildsIn(catId) {
    return [...this.builds.values()].filter((b) => !b.archived && b.catId === catId);
  }
  archivedBuilds() { return [...this.builds.values()].filter((b) => b.archived); }
  allBuilds() { return [...this.builds.values()].filter((b) => !b.archived); }

  async _loadBuildFolders(folders, catId, archived) {
    if (!folders.length) return [];
    const files = await this.drive.findNamedInParents(folders.map((f) => f.id), [DETAILS, THUMB]);
    const found = [];
    await pool(folders, 6, async (f) => {
      const det = files.find((x) => x.name === DETAILS && (x.parents || []).includes(f.id));
      if (!det) return; // a folder someone made by hand, not a design
      const thumb = files.find((x) => x.name === THUMB && (x.parents || []).includes(f.id));
      let data;
      try { data = await blobToJSON(await this.drive.download(det.id)); } catch (e) { console.warn('Could not read', f.name, e); return; }
      if (!data) return;
      const entry = {
        folderId: f.id, folderName: f.name, detailsId: det.id, version: det.version,
        modifiedTime: det.modifiedTime, modifiedBy: det.lastModifyingUser?.displayName || '',
        thumbId: thumb?.id || null, archived, catId: archived ? (data.archived?.from || data.category) : catId, data,
      };
      this.builds.set(f.id, entry);
      found.push(entry);
    });
    return found;
  }

  async loadCategory(catId, force = false) {
    const cat = this.cat(catId);
    if (!cat?.folderId) return [];
    if (!force && this.catLoaded.has(catId)) return this.buildsIn(catId);
    const folders = await this.drive.list(cat.folderId, { foldersOnly: true });
    const ids = new Set(folders.map((f) => f.id));
    for (const [id, b] of this.builds) if (!b.archived && b.catId === catId && !ids.has(id)) this.builds.delete(id);
    await this._loadBuildFolders(folders, catId, false);
    this.catLoaded.add(catId);
    this.emit();
    return this.buildsIn(catId);
  }

  async loadAll(force = false) {
    await Promise.all(this.settings.categories.map((c) => this.loadCategory(c.id, force)));
  }

  async loadArchive(force = false) {
    if (!this.archiveId) return [];
    if (this.archiveLoaded && !force) return this.archivedBuilds();
    const folders = await this.drive.list(this.archiveId, { foldersOnly: true });
    for (const [id, b] of this.builds) if (b.archived) this.builds.delete(id);
    await this._loadBuildFolders(folders, null, true);
    this.archiveLoaded = true;
    this.emit();
    return this.archivedBuilds();
  }

  async getBuild(folderId) {
    if (this.builds.has(folderId)) return this.builds.get(folderId);
    const f = await this.drive.getFile(folderId, 'id,name,parents,trashed');
    if (f.trashed) return null;
    const parent = (f.parents || [])[0];
    const archived = parent === this.archiveId;
    const cat = this.catByFolder(parent);
    const [entry] = await this._loadBuildFolders([f], cat?.id || null, archived);
    if (entry && !entry.catId) entry.catId = entry.data.category;
    return entry || null;
  }

  blankBuild(catId) {
    return {
      schema: 1, id: uid('b'), code: '', name: '', category: catId, status: 'draft', description: '',
      specs: { length: '', width: '', floorArea: '', studHeight: '', roofStyle: 'Gable', roofPitch: '', roofing: '', cladding: '',
        bedrooms: '', bathrooms: '', windZone: '', consent: '', leadTime: '' },
      extraSpecs: [], included: [], excluded: [], notes: '',
      costing: { lines: [] },
      coverFileId: null, renderOrder: [], folders: {},
      createdAt: null, createdBy: null, updatedAt: null, updatedBy: null,
      priceReviewedAt: null, priceReviewedBy: null, archived: null,
    };
  }

  async nextCode(catId) {
    const cat = this.cat(catId);
    const prefix = (cat?.code || 'X').toUpperCase();
    await this.loadCategory(catId);
    await this.loadArchive();
    let max = 0;
    for (const b of this.builds.values()) {
      const m = String(b.data.code || '').match(new RegExp(`^${prefix}-(\\d+)$`));
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
  }

  // True when another design (including archived ones) already uses this code.
  async codeTaken(code, exceptFolderId = null) {
    await this.loadAll();
    await this.loadArchive();
    const c = String(code || '').trim().toLowerCase();
    if (!c) return false;
    return [...this.builds.values()].some((b) => b.folderId !== exceptFolderId && String(b.data.code || '').trim().toLowerCase() === c);
  }

  folderNameFor(data) { return safeName(`${data.code} ${data.name}`); }

  _snapshotPrices(data) {
    const pm = this.priceMap;
    for (const l of data.costing?.lines || []) {
      if (l.priceListId && !l.custom && pm.has(l.priceListId)) {
        const it = pm.get(l.priceListId);
        l.unitCost = num(it.cost); l.unit = it.unit;
      }
    }
  }

  // Save a design. Returns the entry, or { conflict, by, at } if someone else saved since it was loaded.
  async saveBuild(input, { folderId = null, force = false } = {}) {
    const d = this.drive;
    const data = clone(input);
    const now = nowISO(), by = this.user?.name || 'Unknown';
    this._snapshotPrices(data);
    data.code = String(data.code || '').trim().toUpperCase();
    const prevCode = folderId ? this.builds.get(folderId)?.data.code : null;
    if (data.code && data.code !== prevCode && await this.codeTaken(data.code, folderId)) {
      throw new Error(`The code ${data.code} is already used by another design.`);
    }

    if (!folderId) {
      const cat = this.cat(data.category);
      if (!cat?.folderId) throw new Error('That category doesn’t have a Drive folder yet.');
      if (!data.code) data.code = await this.nextCode(cat.id);
      Object.assign(data, { createdAt: now, createdBy: by, updatedAt: now, updatedBy: by });
      if (!data.priceReviewedAt) Object.assign(data, { priceReviewedAt: now, priceReviewedBy: by });
      const folder = await d.createFolder(cat.folderId, this.folderNameFor(data));
      const subs = await Promise.all(SECTIONS.map((s) => d.createFolder(folder.id, s.folder)));
      data.folders = Object.fromEntries(SECTIONS.map((s, i) => [s.key, subs[i].id]));
      const det = await d.writeJSON(folder.id, DETAILS, data);
      const entry = { folderId: folder.id, folderName: folder.name, detailsId: det.id, version: det.version, modifiedTime: det.modifiedTime,
        modifiedBy: by, thumbId: null, archived: false, catId: cat.id, data };
      this.builds.set(folder.id, entry);
      this.emit();
      return entry;
    }

    const entry = this.builds.get(folderId);
    if (!entry) throw new Error('This design is no longer loaded. Refresh and try again.');
    if (!force) {
      const meta = await d.getFile(entry.detailsId, 'id,version,modifiedTime,lastModifyingUser(displayName)');
      if (String(meta.version) !== String(entry.version)) return { conflict: true, by: meta.lastModifyingUser?.displayName || 'Someone', at: meta.modifiedTime };
    }
    if (!entry.archived && data.category !== entry.data.category) {
      const from = this.cat(entry.data.category), to = this.cat(data.category);
      if (from?.folderId && to?.folderId) { await d.move(entry.folderId, to.folderId, from.folderId); entry.catId = to.id; }
    }
    Object.assign(data, { updatedAt: now, updatedBy: by });
    const det = await d.writeJSON(null, DETAILS, data, entry.detailsId);
    const newName = this.folderNameFor(data);
    if (newName !== entry.folderName) { await d.rename(entry.folderId, newName); entry.folderName = newName; }
    Object.assign(entry, { data, version: det.version, modifiedTime: det.modifiedTime, modifiedBy: by });
    this.emit();
    return entry;
  }

  // Apply a small change on top of the latest saved copy (safe when others are editing too)
  async patchBuild(entry, mutate) {
    const d = this.drive;
    const latest = (await blobToJSON(await d.download(entry.detailsId))) || entry.data;
    mutate(latest);
    latest.updatedAt = nowISO(); latest.updatedBy = this.user?.name || 'Unknown';
    const det = await d.writeJSON(null, DETAILS, latest, entry.detailsId);
    Object.assign(entry, { data: latest, version: det.version, modifiedTime: det.modifiedTime, modifiedBy: latest.updatedBy });
    this.emit();
    return entry;
  }

  async reloadBuild(entry) {
    const meta = await this.drive.getFile(entry.detailsId, 'id,version,modifiedTime,lastModifyingUser(displayName)');
    const data = await blobToJSON(await this.drive.download(entry.detailsId));
    Object.assign(entry, { data, version: meta.version, modifiedTime: meta.modifiedTime, modifiedBy: meta.lastModifyingUser?.displayName || '' });
    this.emit();
    return entry;
  }

  markReviewed(entry) {
    return this.patchBuild(entry, (x) => { x.priceReviewedAt = nowISO(); x.priceReviewedBy = this.user?.name; });
  }
  setStatus(entry, status) { return this.patchBuild(entry, (x) => { x.status = status; }); }

  async archiveBuild(entry) {
    if (!this.archiveId) throw new Error('No archive folder available.');
    const cat = this.cat(entry.data.category);
    const parent = cat?.folderId || (await this.drive.getFile(entry.folderId, 'parents')).parents[0];
    await this.drive.move(entry.folderId, this.archiveId, parent);
    entry.archived = true;
    await this.patchBuild(entry, (x) => { x.archived = { from: x.category, at: nowISO(), by: this.user?.name }; });
  }

  async restoreBuild(entry) {
    let cat = this.cat(entry.data.category) || this.settings.categories[0];
    await this.drive.move(entry.folderId, cat.folderId, this.archiveId);
    entry.archived = false; entry.catId = cat.id;
    await this.patchBuild(entry, (x) => { x.archived = null; x.category = cat.id; });
  }

  async duplicateBuild(entry) {
    const src = clone(entry.data);
    const copy = { ...this.blankBuild(src.category), ...src, id: uid('b'), code: '', name: `${src.name} (copy)`, status: 'draft',
      folders: {}, coverFileId: null, renderOrder: [], archived: null, priceReviewedAt: src.priceReviewedAt };
    const saved = await this.saveBuild(copy);
    const idMap = {};
    for (const s of SECTIONS) {
      const files = await this.listSection(entry, s.key);
      await pool(files, 4, async (f) => {
        const c = await this.drive.copy(f.id, saved.data.folders[s.key], f.name);
        idMap[f.id] = c.id;
      });
    }
    if (entry.thumbId) {
      const t = await this.drive.copy(entry.thumbId, saved.folderId, THUMB);
      saved.thumbId = t.id;
    }
    await this.patchBuild(saved, (x) => {
      x.renderOrder = (src.renderOrder || []).map((id) => idMap[id]).filter(Boolean);
      x.coverFileId = idMap[src.coverFileId] || null;
    });
    return saved;
  }

  // ── files ──────────────────────────────────────────────────
  async sectionFolder(entry, key) {
    const s = SECTIONS.find((x) => x.key === key);
    let id = entry.data.folders?.[key];
    if (id) return id;
    const f = await this.drive.ensureFolder(entry.folderId, s.folder);
    if (this.canEdit) await this.patchBuild(entry, (x) => { x.folders = { ...(x.folders || {}), [key]: f.id }; });
    else entry.data.folders = { ...(entry.data.folders || {}), [key]: f.id };
    return f.id;
  }

  async listSection(entry, key) {
    const folderId = entry.data.folders?.[key] || (await this.drive.findChild(entry.folderId, SECTIONS.find((s) => s.key === key).folder, true))?.id;
    if (!folderId) return [];
    const files = await this.drive.list(folderId, { filesOnly: true });
    if (key === 'renders') {
      const order = entry.data.renderOrder || [];
      const pos = (id) => { const i = order.indexOf(id); return i < 0 ? 1e6 : i; };
      files.sort((a, b) => pos(a.id) - pos(b.id) || a.name.localeCompare(b.name));
    }
    return files;
  }

  async uploadToSection(entry, key, file, onProgress) {
    const folderId = await this.sectionFolder(entry, key);
    const meta = await this.drive.upload(folderId, file, onProgress);
    if (key === 'renders') {
      const needCover = !entry.data.coverFileId;
      if (needCover) await this._writeThumb(entry, file);
      await this.patchBuild(entry, (x) => {
        x.renderOrder = [...(x.renderOrder || []), meta.id];
        if (!x.coverFileId) x.coverFileId = meta.id;
      });
    }
    this.emit();
    return meta;
  }

  async _writeThumb(entry, blob) {
    const thumb = await makeThumbnail(blob);
    if (entry.thumbId) {
      await this.drive.replaceContent(entry.thumbId, thumb);
      this.invalidate(entry.thumbId);
    } else {
      const m = await this.drive.upload(entry.folderId, new File([thumb], THUMB, { type: 'image/jpeg' }), null, THUMB);
      entry.thumbId = m.id;
    }
    this.emit();
  }

  // Keep one screenshot of the 3D model for the spec sheet (replaces the old one).
  async saveSpecView(entry, blob) {
    const files = await this.listSection(entry, 'model');
    const old = files.find((f) => f.name === SPECVIEW);
    if (old) {
      await this.drive.replaceContent(old.id, blob);
      this.invalidate(old.id);
      this.emit();
      return old;
    }
    const folderId = await this.sectionFolder(entry, 'model');
    const meta = await this.drive.upload(folderId, new File([blob], SPECVIEW, { type: 'image/png' }), null, SPECVIEW);
    this.emit();
    return meta;
  }

  async setCover(entry, fileId) {
    const blob = await this.getBlob(fileId);
    await this._writeThumb(entry, blob);
    await this.patchBuild(entry, (x) => {
      x.coverFileId = fileId;
      x.renderOrder = [fileId, ...(x.renderOrder || []).filter((id) => id !== fileId)];
    });
  }

  async reorderRenders(entry, order) {
    await this.patchBuild(entry, (x) => { x.renderOrder = order; });
  }

  async deleteFile(entry, key, fileId) {
    await this.drive.trash(fileId);
    this.invalidate(fileId);
    if (key === 'renders') {
      const wasCover = entry.data.coverFileId === fileId;
      const remaining = (await this.listSection(entry, 'renders')).filter((f) => f.id !== fileId);
      if (wasCover) {
        if (remaining[0]) await this._writeThumb(entry, await this.getBlob(remaining[0].id));
        else if (entry.thumbId) { await this.drive.trash(entry.thumbId); this.invalidate(entry.thumbId); entry.thumbId = null; }
      }
      await this.patchBuild(entry, (x) => {
        x.renderOrder = (x.renderOrder || []).filter((id) => id !== fileId);
        if (x.coverFileId === fileId) x.coverFileId = remaining[0]?.id || null;
      });
    }
    this.emit();
  }

  getBlob(fileId) {
    if (!this.blobs.has(fileId)) {
      const p = this.drive.download(fileId);
      p.catch(() => this.blobs.delete(fileId));
      this.blobs.set(fileId, p);
    }
    return this.blobs.get(fileId);
  }
  getUrl(fileId) {
    if (!this.urls.has(fileId)) {
      const p = this.getBlob(fileId).then((b) => URL.createObjectURL(b));
      p.catch(() => this.urls.delete(fileId));
      this.urls.set(fileId, p);
    }
    return this.urls.get(fileId);
  }
  invalidate(fileId) {
    this.fileVer.set(fileId, (this.fileVer.get(fileId) || 0) + 1);
    this.blobs.delete(fileId);
    const u = this.urls.get(fileId);
    if (u) u.then((x) => setTimeout(() => URL.revokeObjectURL(x), 5000)).catch(() => {});
    this.urls.delete(fileId);
  }

  // ── price list ─────────────────────────────────────────────
  async _updatePrices(mutate, historyEntries = []) {
    if (!this.priceFileId) throw new Error('No price list file — you may not have edit access.');
    const latest = (await blobToJSON(await this.drive.download(this.priceFileId))) || { items: [] };
    if (!latest.items) latest.items = [];
    const result = mutate(latest);
    latest.updatedAt = nowISO();
    await this.drive.writeJSON(null, PRICES, latest, this.priceFileId);
    this.priceList = latest;
    const entries = typeof historyEntries === 'function' ? historyEntries(result) : historyEntries;
    if (entries?.length) await this._appendHistory(entries);
    this.emit();
    return result;
  }

  _hist(type, item, extra = {}) {
    return { id: uid('h'), at: nowISO(), by: this.user?.name || 'Unknown', type, itemId: item.id, itemName: item.name, ...extra };
  }

  addPriceItem(input) {
    const now = nowISO();
    const item = { id: uid('p'), name: '', group: 'Other', unit: 'each', cost: 0, markup: '', supplier: '', sku: '', notes: '',
      ...input, cost: num(input.cost), createdAt: now, updatedAt: now, priceChangedAt: now, updatedBy: this.user?.name };
    return this._updatePrices((pl) => { pl.items.push(item); return item; }, [this._hist('added', item, { to: item.cost })]);
  }

  editPriceItem(id, changes, note = '') {
    let hist = [];
    return this._updatePrices((pl) => {
      const it = pl.items.find((x) => x.id === id);
      if (!it) throw new Error('That item has been removed from the price list.');
      const now = nowISO();
      const newCost = changes.cost !== undefined ? num(changes.cost) : it.cost;
      if (num(newCost) !== num(it.cost)) {
        hist.push(this._hist('price', it, { from: num(it.cost), to: num(newCost), note }));
        it.priceChangedAt = now;
      } else if (Object.keys(changes).some((k) => k !== 'cost' && changes[k] !== it[k])) {
        hist.push(this._hist('details', { ...it, ...changes }, { note }));
      }
      Object.assign(it, changes, { cost: num(newCost), updatedAt: now, updatedBy: this.user?.name });
      return it;
    }, () => hist);
  }

  deletePriceItem(id) {
    let gone = null;
    return this._updatePrices((pl) => {
      gone = pl.items.find((x) => x.id === id);
      pl.items = pl.items.filter((x) => x.id !== id);
      return gone;
    }, () => (gone ? [this._hist('removed', gone, { from: gone.cost })] : []));
  }

  bulkAdjust(ids, percent, note = '') {
    const hist = [];
    const p = num(percent);
    return this._updatePrices((pl) => {
      const now = nowISO();
      for (const it of pl.items) {
        if (!ids.includes(it.id)) continue;
        const to = Math.round(num(it.cost) * (1 + p / 100) * 100) / 100;
        hist.push(this._hist('price', it, { from: num(it.cost), to, note: note || `Bulk ${p > 0 ? '+' : ''}${p}%` }));
        Object.assign(it, { cost: to, priceChangedAt: now, updatedAt: now, updatedBy: this.user?.name });
      }
      return hist.length;
    }, () => hist);
  }

  usageOf(itemId) {
    return this.allBuilds().filter((b) => (b.data.costing?.lines || []).some((l) => l.priceListId === itemId && !l.custom));
  }

  async loadHistory() {
    if (!this.historyFileId) { this.history = []; return this.history; }
    this.history = ((await blobToJSON(await this.drive.download(this.historyFileId))) || { entries: [] }).entries || [];
    return this.history;
  }

  async _appendHistory(entries) {
    let current = { entries: [] };
    if (this.historyFileId) current = (await blobToJSON(await this.drive.download(this.historyFileId))) || { entries: [] };
    current.entries = [...entries.slice().reverse(), ...(current.entries || [])].slice(0, 5000);
    const m = await this.drive.writeJSON(this.appDataId, HISTORY, current, this.historyFileId);
    this.historyFileId = m.id;
    this.history = current.entries;
  }

  // ── settings ───────────────────────────────────────────────
  async _writeSettings() {
    const m = await this.drive.writeJSON(this.appDataId, SETTINGS, this.settings, this.settingsFileId);
    this.settingsFileId = m.id; this.settingsVersion = m.version;
  }

  async saveSettings(next) {
    const d = this.drive;
    const prev = this.settings;
    const s = clone(next);
    for (const cat of s.categories) {
      const old = prev.categories.find((c) => c.id === cat.id);
      if (!cat.folderId) {
        cat.folderId = (await d.ensureFolder(this.rootId, safeName(cat.name))).id;
      } else if (old && old.name !== cat.name) {
        await d.rename(cat.folderId, safeName(cat.name));
      }
    }
    for (const old of prev.categories) {
      if (!s.categories.find((c) => c.id === old.id) && old.folderId) {
        const kids = await d.list(old.folderId);
        if (!kids.length) await d.trash(old.folderId);
      }
    }
    this.settings = s;
    await this._writeSettings();
    this.emit();
  }

  async categoryHasDesigns(catId) {
    const cat = this.cat(catId);
    if (!cat?.folderId) return false;
    const kids = await this.drive.list(cat.folderId, { foldersOnly: true });
    return kids.length > 0;
  }
}
