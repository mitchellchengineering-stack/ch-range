import { html, useState, useEffect, useRef, useCallback } from 'htm/preact';
import {
  useApp, useStoreRev, useAsync, Icon, Spinner, ErrorBox, BlobImg, Placeholder, Watermark, Modal, FileDrop, UploadList,
  fmtDate, fmtDateTime, timeAgo, fileSize, downloadBlob, sizeLabel,
} from './ui.js';
import { buildTotals, lineCalc, money, moneyGST, pct, changedSinceReview, reviewDue } from './pricing.js';
import { specRows } from './specs.js';
import { SECTIONS } from './store.js';
import { openPdf, renderPage } from './pdf.js';
import { visibleIn, sortBuilds } from './range.js';

const isPdf = (f) => /pdf/i.test(f.mimeType) || /\.pdf$/i.test(f.name);
const isImage = (f) => /^image\//i.test(f.mimeType) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name);
const isIfc = (f) => /\.ifc$/i.test(f.name);

// ── gallery ─────────────────────────────────────────────────────
function useSwipe(onLeft, onRight) {
  const start = useRef(null);
  return {
    onPointerDown: (e) => { start.current = e.clientX; },
    onPointerUp: (e) => {
      if (start.current == null) return;
      const dx = e.clientX - start.current; start.current = null;
      if (dx > 50) onRight(); else if (dx < -50) onLeft();
    },
  };
}

function Lightbox({ files, index, onClose, onIndex, title }) {
  const f = files[index];
  const prev = () => onIndex((index - 1 + files.length) % files.length);
  const next = () => onIndex((index + 1) % files.length);
  const swipe = useSwipe(next, prev);
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowLeft') prev(); if (e.key === 'ArrowRight') next(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  });
  return html`<div class="lightbox" role="dialog" aria-label=${`${title} images`}>
    <button class="lb-close icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="x" size=${26} /></button>
    <div class="lb-stage" ...${swipe}>
      <${BlobImg} fileId=${f.id} alt=${title} class="lb-img" />
      <${Watermark} size="lg" />
    </div>
    ${files.length > 1 && html`
      <button class="lb-nav lb-prev" onClick=${prev} aria-label="Previous image"><${Icon} name="left" size=${30} /></button>
      <button class="lb-nav lb-next" onClick=${next} aria-label="Next image"><${Icon} name="right" size=${30} /></button>
      <div class="lb-count">${index + 1} of ${files.length}</div>`}
  </div>`;
}

function Gallery({ entry, renders }) {
  const [i, setI] = useState(0);
  const [lb, setLb] = useState(false);
  const files = renders || [];
  const n = files.length;
  const idx = Math.min(i, Math.max(0, n - 1));
  const swipe = useSwipe(() => setI((idx + 1) % n), () => setI((idx - 1 + n) % n));
  if (!n) {
    return html`<div class="gallery"><div class="gal-main">
      ${entry.thumbId ? html`<${BlobImg} fileId=${entry.thumbId} alt=${entry.data.name} class="gal-img" />` : html`<${Placeholder} label="No renders yet" />`}
      ${entry.thumbId && html`<${Watermark} />`}
    </div></div>`;
  }
  return html`<div class="gallery">
    <div class="gal-main" ...${n > 1 ? swipe : {}}>
      <button class="gal-open" onClick=${() => setLb(true)} aria-label="View full screen">
        <${BlobImg} fileId=${files[idx].id} alt=${entry.data.name} class="gal-img" />
      </button>
      <${Watermark} />
      <button class="gal-full icon-btn" onClick=${() => setLb(true)} aria-label="Full screen"><${Icon} name="expand" /></button>
      ${n > 1 && html`
        <button class="gal-nav prev" onClick=${() => setI((idx - 1 + n) % n)} aria-label="Previous image"><${Icon} name="left" size=${24} /></button>
        <button class="gal-nav next" onClick=${() => setI((idx + 1) % n)} aria-label="Next image"><${Icon} name="right" size=${24} /></button>`}
    </div>
    ${n > 1 && html`<div class="gal-thumbs">${files.map((f, k) => html`<button class=${k === idx ? 'on' : ''} onClick=${() => setI(k)} aria-label=${`Image ${k + 1}`}>
      <${BlobImg} fileId=${f.id} alt="" /></button>`)}</div>`}
    ${lb && html`<${Lightbox} files=${files} index=${idx} onIndex=${setI} onClose=${() => setLb(false)} title=${entry.data.name} />`}
  </div>`;
}

// ── PDF viewer ──────────────────────────────────────────────────
export function PdfPanel({ fileId, name }) {
  const { store } = useApp();
  const pagesRef = useRef();
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [full, setFull] = useState(false);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    let d = null, dead = false;
    setDoc(null); setErr(null);
    store.getBlob(fileId).then(openPdf).then((x) => { if (dead) x.destroy(); else { d = x; setDoc(x); } }, (e) => !dead && setErr(e));
    return () => { dead = true; d?.destroy(); };
  }, [fileId]);

  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  useEffect(() => {
    if (!doc || !width) return;
    let cancelled = false;
    setRendering(true);
    const t = setTimeout(async () => {
      const box = pagesRef.current;
      if (!box) return;
      const frag = [];
      for (let p = 1; p <= doc.numPages; p++) {
        if (cancelled) return;
        const c = document.createElement('canvas');
        c.className = 'pdf-page';
        frag.push(c);
        if (p === 1) { box.innerHTML = ''; }
        box.appendChild(c);
        try { await renderPage(doc, p, c, Math.max(200, (width - 24) * zoom)); } catch (e) { if (!cancelled) console.warn(e); }
      }
      if (!cancelled) setRendering(false);
    }, 120);
    return () => { cancelled = true; clearTimeout(t); };
  }, [doc, width, zoom]);

  useEffect(() => {
    if (!full) return;
    const k = (e) => e.key === 'Escape' && setFull(false);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [full]);

  if (err) return html`<${ErrorBox} error=${err} />`;
  return html`<div class=${`viewer pdf-viewer ${full ? 'is-full' : ''}`}>
    <div class="viewer-bar">
      <span class="viewer-title">${name}${doc ? html`<small> ${doc.numPages} ${doc.numPages === 1 ? 'page' : 'pages'}</small>` : ''}</span>
      <div class="viewer-tools">
        <button class="icon-btn" onClick=${() => setZoom((z) => Math.max(0.5, z - 0.25))} aria-label="Zoom out">−</button>
        <button class="btn btn-sm" onClick=${() => setZoom(1)}>${Math.round(zoom * 100)}%</button>
        <button class="icon-btn" onClick=${() => setZoom((z) => Math.min(4, z + 0.25))} aria-label="Zoom in">+</button>
        <button class="icon-btn" onClick=${() => setFull(!full)} aria-label=${full ? 'Exit full screen' : 'Full screen'}><${Icon} name=${full ? 'x' : 'expand'} /></button>
      </div>
    </div>
    <div class="pdf-wrap">
      <div class="pdf-scroll">
        <div class="pdf-pages" ref=${pagesRef}></div>
      </div>
      ${(!doc || rendering) && html`<div class="viewer-loading"><${Spinner} label=${doc ? 'Drawing pages' : 'Opening plans'} /></div>`}
      <${Watermark} size="sm" />
    </div>
  </div>`;
}

// ── IFC viewer ──────────────────────────────────────────────────
function IfcPanel({ fileId, name }) {
  const { store, isClient } = useApp();
  const host = useRef();
  const viewer = useRef(null);
  const [stage, setStage] = useState('Downloading model');
  const [err, setErr] = useState(null);
  const [layers, setLayers] = useState([]);
  const [sel, setSel] = useState(null);
  const [section, setSection] = useState({ axis: null, t: 0.5 });
  const [panel, setPanel] = useState(null);
  const [full, setFull] = useState(false);
  const [hidden, setHidden] = useState(0);

  useEffect(() => {
    let dead = false;
    setErr(null); setStage('Downloading model'); setSel(null); setSection({ axis: null, t: 0.5 });
    (async () => {
      try {
        const blob = await store.getBlob(fileId);
        if (dead) return;
        setStage('Starting 3D engine');
        const { IfcViewer } = await import('./ifc-viewer.js');
        if (dead) return;
        const v = new IfcViewer(host.current, { onSelect: (x) => !dead && setSel(x) });
        viewer.current = v;
        await v.load(await blob.arrayBuffer(), (s) => !dead && s && setStage(s));
        if (dead) return;
        setLayers(v.layers());
        setStage('');
      } catch (e) {
        console.error(e);
        if (!dead) setErr(new Error(/WebGL/i.test(e.message) ? 'This device can’t show 3D graphics (WebGL is turned off).' : `The 3D model couldn’t be opened: ${e.message}`));
      }
    })();
    return () => { dead = true; viewer.current?.dispose(); viewer.current = null; };
  }, [fileId]);

  useEffect(() => { setTimeout(() => viewer.current?.resize(), 50); }, [full]);
  useEffect(() => {
    if (!full) return;
    const k = (e) => e.key === 'Escape' && setFull(false);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [full]);

  const v = () => viewer.current;
  const setSec = (axis, t = section.t) => { setSection({ axis, t }); v()?.setSection(axis, t); };
  const toggleLayer = (l) => { v()?.setLayerVisible(l.label, !l.visible); setLayers(v().layers()); };
  const ready = !stage && !err;

  return html`<div class=${`viewer ifc-viewer ${full ? 'is-full' : ''}`}>
    <div class="viewer-bar">
      <span class="viewer-title">${name}</span>
      <div class="viewer-tools">
        <button class="btn btn-sm" disabled=${!ready} onClick=${() => v()?.fit()} title="Fit the model in view"><${Icon} name="fit" /> <span class="hide-sm">Fit</span></button>
        <button class=${`btn btn-sm ${section.axis ? 'on' : ''}`} disabled=${!ready} onClick=${() => setSec(section.axis ? null : 'x', 0.5)} title="Cut through the model"><${Icon} name="section" /> <span class="hide-sm">Section</span></button>
        <button class=${`btn btn-sm ${panel === 'layers' ? 'on' : ''}`} disabled=${!ready} onClick=${() => setPanel(panel === 'layers' ? null : 'layers')}><${Icon} name="layers" /> <span class="hide-sm">Parts</span></button>
        ${!isClient && html`<button class="icon-btn" disabled=${!ready} title="Save this view as an image" aria-label="Save view as image"
          onClick=${() => fetch(v().screenshot()).then((r) => r.blob()).then((b) => downloadBlob(b, `${name.replace(/\.ifc$/i, '')}-view.png`))}><${Icon} name="image" /></button>`}
        <button class="icon-btn" onClick=${() => setFull(!full)} aria-label=${full ? 'Exit full screen' : 'Full screen'}><${Icon} name=${full ? 'x' : 'expand'} /></button>
      </div>
    </div>
    ${section.axis && html`<div class="section-bar">
      <div class="seg">${[['x', 'Side to side'], ['z', 'Front to back'], ['y', 'Top down']].map(([a, l]) => html`<button class=${section.axis === a ? 'on' : ''} onClick=${() => setSec(a, a === 'y' ? 0.75 : section.t)}>${l}</button>`)}</div>
      <input type="range" min="0" max="1" step="0.005" value=${section.t} onInput=${(e) => setSec(section.axis, Number(e.target.value))} aria-label="Section position" />
    </div>`}
    <div class="ifc-stage">
      <div class="ifc-host" ref=${host}></div>
      <${Watermark} />
      ${stage && !err && html`<div class="viewer-loading"><${Spinner} label=${stage} /></div>`}
      ${err && html`<div class="viewer-loading"><${ErrorBox} error=${err} /></div>`}
      ${ready && !sel && html`<p class="ifc-hint">Drag to rotate. Pinch or scroll to zoom. Two fingers or right-drag to move. Tap a part to see what it is.</p>`}
      ${panel === 'layers' && html`<div class="ifc-panel">
        <div class="ifc-panel-head"><strong>Parts</strong><button class="icon-btn" onClick=${() => setPanel(null)} aria-label="Close"><${Icon} name="x" size=${16} /></button></div>
        ${layers.map((l) => html`<label class="check"><input type="checkbox" checked=${l.visible} onChange=${() => toggleLayer(l)} /> ${l.label} <small>${l.count}</small></label>`)}
        ${hidden > 0 && html`<button class="btn btn-sm" onClick=${() => { v().showAll(); setHidden(0); }}>Show hidden parts</button>`}
      </div>`}
      ${sel && html`<div class="ifc-info">
        <div class="ifc-info-head"><span class="code">${sel.category}</span><button class="icon-btn" onClick=${() => v().select(null)} aria-label="Clear selection"><${Icon} name="x" size=${16} /></button></div>
        <strong>${sel.name || sel.type}</strong>
        ${sel.objectType && sel.objectType !== sel.name && html`<p>${sel.objectType}</p>`}
        ${sel.tag && html`<p class="muted small">Tag ${sel.tag}</p>`}
        <button class="btn btn-sm" onClick=${() => { v().hideSelected(); setHidden((h) => h + 1); }}><${Icon} name="eyeOff" size=${16} /> Hide this part</button>
      </div>`}
    </div>
  </div>`;
}

// ── file lists & uploads ────────────────────────────────────────
function useUploads(entry, sectionKey, after) {
  const { store, toast } = useApp();
  const [items, setItems] = useState([]);
  const upload = useCallback(async (files, filter) => {
    const ok = filter ? files.filter(filter.test) : files;
    if (filter && ok.length < files.length) toast(filter.message, 'error');
    for (const f of ok) {
      const id = Math.random();
      setItems((u) => [...u, { id, name: f.name, progress: 0 }]);
      try {
        await store.uploadToSection(entry, sectionKey, f, (p) => setItems((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))));
        setItems((u) => u.filter((x) => x.id !== id));
      } catch (e) {
        setItems((u) => u.map((x) => (x.id === id ? { ...x, error: e.message } : x)));
        setTimeout(() => setItems((u) => u.filter((x) => x.id !== id)), 8000);
      }
    }
    after?.();
  }, [entry.folderId, sectionKey]);
  return [items, upload];
}

function FileViewerModal({ file, onClose }) {
  return html`<${Modal} title=${file.name} onClose=${onClose} size="modal-xl">
    ${isPdf(file) ? html`<${PdfPanel} fileId=${file.id} name=${file.name} />`
      : isImage(file) ? html`<div class="img-view"><${BlobImg} fileId=${file.id} alt=${file.name} /></div>`
        : html`<p>This file type can’t be previewed here. Download it or open it in Drive.</p>`}
  </${Modal}>`;
}

function FilesPanel({ entry, sectionKey, title, hint, accept, filter, reloadKey = 0, onChanged, emptyText }) {
  const { store, isClient, canEdit, confirm, run, isDemo } = useApp();
  const files = useAsync(() => store.listSection(entry, sectionKey), [entry.folderId, sectionKey, reloadKey]);
  const [viewing, setViewing] = useState(null);
  const [uploads, upload] = useUploads(entry, sectionKey, () => { files.reload(); onChanged?.(); });
  const editable = !isClient && canEdit && !entry.archived;
  const del = async (f) => {
    const ok = await confirm({ title: 'Move file to Drive trash?', message: `${f.name} will go to the Google Drive trash. It can be restored from there for 30 days.`, confirmLabel: 'Move to trash', danger: true });
    if (!ok) return;
    await run(() => store.deleteFile(entry, sectionKey, f.id), 'Moved to trash');
    files.reload(); onChanged?.();
  };
  const list = files.value || [];
  return html`<div class="files-panel">
    ${title && html`<div class="panel-head"><h3>${title}</h3>${hint && html`<p class="muted small">${hint}</p>`}</div>`}
    ${files.loading && !list.length && html`<${Spinner} />`}
    ${files.error && html`<${ErrorBox} error=${files.error} onRetry=${files.reload} />`}
    ${!files.loading && !list.length && html`<p class="muted">${emptyText || 'No files yet.'}</p>`}
    ${list.length > 0 && html`<ul class="file-list">${list.map((f) => html`<li key=${f.id}>
      <span class="file-ic"><${Icon} name=${isPdf(f) ? 'file' : isImage(f) ? 'image' : isIfc(f) ? 'cube' : 'file'} /></span>
      <div class="file-main">
        ${(isPdf(f) || isImage(f)) ? html`<button class="link-btn file-name" onClick=${() => setViewing(f)}>${f.name}</button>` : html`<span class="file-name">${f.name}</span>`}
        <span class="muted small">${fileSize(f.size)}${f.lastModifyingUser?.displayName ? `, added by ${f.lastModifyingUser.displayName}` : ''} ${timeAgo(f.createdTime || f.modifiedTime)}</span>
      </div>
      <div class="file-actions">
        ${(isPdf(f) || isImage(f)) && html`<button class="icon-btn" onClick=${() => setViewing(f)} aria-label=${`View ${f.name}`} title="View"><${Icon} name="eye" /></button>`}
        <button class="icon-btn" title="Download" aria-label=${`Download ${f.name}`} onClick=${() => run(async () => downloadBlob(await store.getBlob(f.id), f.name))}><${Icon} name="download" /></button>
        ${!isClient && !isDemo && f.webViewLink && html`<a class="icon-btn" href=${f.webViewLink} target="_blank" rel="noopener" title="Open in Drive" aria-label=${`Open ${f.name} in Drive`}><${Icon} name="external" /></a>`}
        ${editable && html`<button class="icon-btn danger" title="Move to trash" aria-label=${`Delete ${f.name}`} onClick=${() => del(f)}><${Icon} name="trash" /></button>`}
      </div>
    </li>`)}</ul>`}
    ${editable && html`<${FileDrop} accept=${accept} onFiles=${(fs) => upload(fs, filter)} label="Choose files or drop them here" hint=${hint ? '' : ''} />`}
    <${UploadList} items=${uploads} />
    ${viewing && html`<${FileViewerModal} file=${viewing} onClose=${() => setViewing(null)} />`}
  </div>`;
}

// ── tabs ────────────────────────────────────────────────────────
function OverviewTab({ entry, cat }) {
  const b = entry.data;
  const rows = specRows(b, cat);
  return html`<div class="overview">
    <section class="ov-specs">
      <h3>Specifications</h3>
      ${rows.length ? html`<dl class="spec-table">${rows.map((r) => html`<div><dt>${r.label}</dt><dd>${r.value}</dd></div>`)}</dl>` : html`<p class="muted">No specifications added yet.</p>`}
    </section>
    <section class="ov-incl">
      <h3>What’s included</h3>
      ${b.included?.length ? html`<ul class="incl">${b.included.map((x) => html`<li><${Icon} name="check" size=${18} stroke=${2.4} />${x}</li>`)}</ul>` : html`<p class="muted">Nothing listed yet.</p>`}
      ${b.excluded?.length > 0 && html`<h3 class="mt">Not included</h3><ul class="excl">${b.excluded.map((x) => html`<li>${x}</li>`)}</ul>`}
    </section>
  </div>`;
}

function ModelTab({ entry }) {
  const { store, isClient, canEdit } = useApp();
  const [k, setK] = useState(0);
  const files = useAsync(() => store.listSection(entry, 'model'), [entry.folderId, k]);
  const ifcs = (files.value || []).filter(isIfc);
  const [pick, setPick] = useState(null);
  const current = ifcs.find((f) => f.id === pick) || ifcs[0];
  return html`<div>
    ${files.loading && !files.value && html`<${Spinner} />`}
    ${ifcs.length > 1 && html`<div class="chips">${ifcs.map((f) => html`<button class=${`chip ${f.id === current?.id ? 'on' : ''}`} onClick=${() => setPick(f.id)}>${f.name}</button>`)}</div>`}
    ${current ? html`<${IfcPanel} fileId=${current.id} name=${current.name} key=${current.id} />`
      : !files.loading && html`<div class="empty slim"><${Icon} name="cube" size=${32} /><p>${isClient || !canEdit ? 'No 3D model for this design yet.' : 'Upload the IFC file below to show the 3D model here.'}</p></div>`}
    ${!isClient && html`<${FilesPanel} entry=${entry} sectionKey="model" title="IFC files" accept=".ifc" reloadKey=${k} onChanged=${() => setK(k + 1)}
      filter=${{ test: isIfc, message: 'Only .ifc files can go in the 3D model folder.' }} emptyText="No IFC file uploaded." />`}
  </div>`;
}

function PlansTab({ entry }) {
  const { store, isClient } = useApp();
  const [k, setK] = useState(0);
  const files = useAsync(() => store.listSection(entry, 'plans'), [entry.folderId, k]);
  const plans = (files.value || []).filter((f) => isPdf(f) || isImage(f));
  const [pick, setPick] = useState(null);
  const current = plans.find((f) => f.id === pick) || plans[0];
  return html`<div>
    ${files.loading && !files.value && html`<${Spinner} />`}
    ${plans.length > 1 && html`<div class="chips">${plans.map((f) => html`<button class=${`chip ${f.id === current?.id ? 'on' : ''}`} onClick=${() => setPick(f.id)}>${f.name.replace(/\.(pdf|png|jpe?g)$/i, '')}</button>`)}</div>`}
    ${current ? (isPdf(current) ? html`<${PdfPanel} fileId=${current.id} name=${current.name} key=${current.id} />`
      : html`<div class="viewer"><div class="img-view"><${BlobImg} fileId=${current.id} alt=${current.name} /><${Watermark} /></div></div>`)
      : !files.loading && html`<div class="empty slim"><${Icon} name="file" size=${32} /><p>No plans for this design yet.</p></div>`}
    ${!isClient && html`<${FilesPanel} entry=${entry} sectionKey="plans" title="Plan files" accept=".pdf,image/*" reloadKey=${k} onChanged=${() => setK(k + 1)}
      filter=${{ test: (f) => isPdf(f) || isImage(f), message: 'Plans need to be PDFs or images.' }} emptyText="No plans uploaded." />`}
  </div>`;
}

function RendersTab({ entry, renders, reload }) {
  const { store, canEdit, confirm, run } = useApp();
  const editable = canEdit && !entry.archived;
  const [uploads, upload] = useUploads(entry, 'renders', reload);
  const list = renders || [];
  const move = (i, d) => {
    const order = list.map((f) => f.id);
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    run(async () => { await store.reorderRenders(entry, order); if (j === 0 || i === 0) await store.setCover(entry, order[0]); reload(); });
  };
  return html`<div class="renders-tab">
    <p class="muted">The first image is the cover photo on the range page and the spec sheet. Images get the logo watermark when shown.</p>
    <div class="render-grid">${list.map((f, i) => html`<figure key=${f.id} class=${i === 0 ? 'is-cover' : ''}>
      <div class="rg-img"><${BlobImg} fileId=${f.id} alt=${f.name} /></div>
      <figcaption>
        ${i === 0 ? html`<span class="flag flag-cover"><${Icon} name="star" size=${14} /> Cover</span>`
          : editable && html`<button class="btn btn-sm" onClick=${() => run(async () => { await store.setCover(entry, f.id); reload(); }, 'Cover photo updated')}>Make cover</button>`}
        ${editable && html`<span class="rg-actions">
          <button class="icon-btn" disabled=${i === 0} onClick=${() => move(i, -1)} aria-label="Move earlier"><${Icon} name="left" /></button>
          <button class="icon-btn" disabled=${i === list.length - 1} onClick=${() => move(i, 1)} aria-label="Move later"><${Icon} name="right" /></button>
          <button class="icon-btn danger" aria-label="Delete image" onClick=${async () => {
            if (await confirm({ title: 'Move image to Drive trash?', message: `${f.name} will go to the Google Drive trash.`, confirmLabel: 'Move to trash', danger: true })) {
              await run(() => store.deleteFile(entry, 'renders', f.id), 'Moved to trash'); reload();
            }
          }}><${Icon} name="trash" /></button></span>`}
      </figcaption></figure>`)}</div>
    ${editable && html`<${FileDrop} accept="image/*" onFiles=${(fs) => upload(fs, { test: isImage, message: 'Renders need to be image files (JPG or PNG).' })} label="Add render images" hint="JPG or PNG. Choose several at once if you like." />`}
    <${UploadList} items=${uploads} />
  </div>`;
}

export function CostBreakdown({ build }) {
  const { store } = useApp();
  const pm = store.priceMap;
  const lines = build.costing?.lines || [];
  const t = buildTotals(build, pm, store.settings);
  if (!lines.length) return html`<p class="muted">No costing lines yet.</p>`;
  return html`<div class="table-scroll"><table class="table cost-table ro">
    <thead><tr><th>Item</th><th>Group</th><th class="num">Qty</th><th>Unit</th><th class="num">Unit cost</th><th class="num">Markup</th><th class="num">Cost</th><th class="num">Sell</th></tr></thead>
    <tbody>${lines.map((l) => { const c = lineCalc(l, pm); return html`<tr>
      <td>${c.description}${c.linked ? html` <span class="tag tag-link" title="Follows the price list"><${Icon} name="link" size=${12} /> Price list</span>` : c.missing ? html` <span class="tag tag-warn">Removed from price list</span>` : ''}</td>
      <td>${l.group}</td><td class="num">${c.qty}</td><td>${c.unit}</td><td class="num">${money(c.unitCost, true)}</td>
      <td class="num">${pct(c.markup)}</td><td class="num">${money(c.cost, true)}</td><td class="num">${money(c.sell, true)}</td></tr>`; })}</tbody>
    <tfoot>
      <tr><td colspan="6">Totals</td><td class="num">${money(t.cost, true)}</td><td class="num">${money(t.sell, true)}</td></tr>
      ${t.final !== Math.round(t.sell * 100) / 100 && html`<tr class="muted"><td colspan="7">Rounded up to the nearest ${money(store.settings.rounding)}</td><td class="num">${money(t.final, true)}</td></tr>`}
    </tfoot>
  </table></div>`;
}

function CostingTab({ entry }) {
  const { store, nav, canEdit, run } = useApp();
  const b = entry.data;
  const pm = store.priceMap;
  const t = buildTotals(b, pm, store.settings);
  const changed = changedSinceReview(b, pm);
  const due = reviewDue(b, store.settings);
  return html`<div class="costing-tab">
    <div class="cost-summary">
      <div><span>Total cost</span><strong>${money(t.cost)}</strong></div>
      <div><span>Selling price</span><strong>${moneyGST(t.final)}</strong></div>
      <div><span>Profit</span><strong>${money(t.profit)}</strong></div>
      <div><span>Overall markup</span><strong>${pct(t.effMarkup)}</strong></div>
    </div>
    <div class=${`review-box ${changed.length || due ? 'warn' : ''}`}>
      <div>
        <strong>${b.priceReviewedAt ? `Prices last checked ${fmtDate(b.priceReviewedAt)}${b.priceReviewedBy ? ` by ${b.priceReviewedBy}` : ''}` : 'Prices haven’t been checked yet'}</strong>
        ${changed.length > 0 && html`<p>${changed.length} price list ${changed.length === 1 ? 'item has' : 'items have'} changed since then: ${changed.map((x) => x.name).join(', ')}. The price above already uses the new rates.</p>`}
        ${!changed.length && due && html`<p>It’s been over ${store.settings.priceReviewMonths} months. Worth checking any custom lines are still right.</p>`}
      </div>
      ${canEdit && !entry.archived && html`<div class="row-gap">
        <button class="btn" onClick=${() => run(() => store.markReviewed(entry), 'Marked as checked')}><${Icon} name="check" /> Mark prices checked</button>
        <button class="btn btn-primary" onClick=${() => nav(`#/edit/${entry.folderId}`)}><${Icon} name="edit" /> Edit costing</button></div>`}
    </div>
    <${CostBreakdown} build=${b} />
  </div>`;
}

// ── page ────────────────────────────────────────────────────────
export function DesignView({ id, tab }) {
  const app = useApp();
  const { store, isClient, canEdit, nav, run, confirm, isDemo } = app;
  useStoreRev(store);
  const load = useAsync(() => store.getBuild(id), [id]);
  const entry = store.builds.get(id) || load.value;
  const [rk, setRk] = useState(0);
  const renders = useAsync(() => (entry ? store.listSection(entry, 'renders') : []), [entry?.folderId, entry?.data?.coverFileId, (entry?.data?.renderOrder || []).join(), rk]);
  const [activeTab, setActiveTab] = useState(tab || 'overview');

  useEffect(() => { if (entry?.catId && !entry.archived) store.loadCategory(entry.catId); }, [entry?.catId]);

  if (load.loading && !entry) return html`<div class="page"><${Spinner} label="Loading design" /></div>`;
  if (load.error) return html`<div class="page"><${ErrorBox} error=${load.error} onRetry=${load.reload} /></div>`;
  if (!entry) return html`<div class="page"><div class="empty"><p>This design couldn’t be found. It may have been moved or deleted in Drive.</p><a class="btn" href="#/">Back to the range</a></div></div>`;

  const b = entry.data;
  const cat = store.cat(entry.catId) || store.cat(b.category);
  if (isClient && (b.status !== 'published' || entry.archived)) {
    return html`<div class="page"><div class="empty"><p>This design isn’t available in client mode.</p><a class="btn" href=${`#/c/${cat?.id || ''}`}>Back to the range</a></div></div>`;
  }
  const t = buildTotals(b, store.priceMap, store.settings);
  const siblings = entry.archived ? [] : sortBuilds(visibleIn(store, entry.catId, isClient), localStorage.getItem('chr.sort') || 'name', store);
  const pos = siblings.findIndex((x) => x.folderId === entry.folderId);
  const prev = pos > 0 ? siblings[pos - 1] : null;
  const next = pos >= 0 && pos < siblings.length - 1 ? siblings[pos + 1] : null;
  const editable = !isClient && canEdit;

  const tabs = [['overview', 'Overview'], ['model', '3D model'], ['plans', 'Plans']];
  if (!isClient) tabs.push(['renders', 'Renders'], ['framing', 'Framing detailing'], ['costing', 'Costing']);
  const active = tabs.some(([k]) => k === activeTab) ? activeTab : 'overview';
  const keyFacts = [
    sizeLabel(b.specs) && ['Size', sizeLabel(b.specs)],
    ...specRows(b, cat).filter((r) => ['Floor area', 'Bedrooms', 'Bathrooms', 'Stud height', 'Roof style'].includes(r.label)).map((r) => [r.label, r.value]),
  ].filter(Boolean).slice(0, 4);

  const duplicate = async () => {
    if (!await confirm({ title: 'Duplicate this design?', message: `Makes a draft copy of ${b.name} with all its details, costing and files, so you can create a variation.`, confirmLabel: 'Duplicate' })) return;
    const copy = await run(() => store.duplicateBuild(entry), 'Copy created');
    if (copy) nav(`#/edit/${copy.folderId}`);
  };
  const archive = async () => {
    if (!await confirm({ title: 'Archive this design?', message: `${b.name} moves to the Archive folder and disappears from the range. You can restore it any time.`, confirmLabel: 'Archive', danger: true })) return;
    const ok = await run(async () => { await store.archiveBuild(entry); return true; }, 'Archived');
    if (ok) nav(`#/c/${cat?.id || ''}`);
  };

  return html`<div class="page design">
    <div class="design-nav">
      <a class="back" href=${entry.archived ? '#/archive' : `#/c/${cat?.id}`}><${Icon} name="left" /> ${entry.archived ? 'Archive' : cat?.name}</a>
      ${siblings.length > 1 && html`<div class="pager">
        ${prev ? html`<a class="btn btn-sm" href=${`#/b/${prev.folderId}`} title=${prev.data.name}><${Icon} name="left" /> <span class="hide-sm">Previous</span></a>` : html`<span class="btn btn-sm" aria-disabled="true"><${Icon} name="left" /> <span class="hide-sm">Previous</span></span>`}
        <span class="pager-count">${pos + 1} of ${siblings.length}</span>
        ${next ? html`<a class="btn btn-sm" href=${`#/b/${next.folderId}`} title=${next.data.name}><span class="hide-sm">Next</span> <${Icon} name="right" /></a>` : html`<span class="btn btn-sm" aria-disabled="true"><span class="hide-sm">Next</span> <${Icon} name="right" /></span>`}
      </div>`}
    </div>

    ${entry.archived && html`<div class="banner">This design is archived and hidden from the range.
      ${canEdit && html`<button class="btn btn-sm" onClick=${() => run(() => store.restoreBuild(entry), 'Restored to the range')}>Restore</button>`}</div>`}

    <section class="design-hero">
      <${Gallery} entry=${entry} renders=${renders.value} />
      <div class="design-info">
        <div class="design-meta">
          <span class="code">${b.code}</span>
          ${!isClient && b.status !== 'published' && html`<span class="flag flag-draft">Draft</span>`}
        </div>
        <h1>${b.name}</h1>
        ${b.description && html`<p class="lede">${b.description}</p>`}
        ${keyFacts.length > 0 && html`<dl class="key-facts">${keyFacts.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`}
        <div class="price-block">
          ${t.lineCount ? html`<span class="price">${money(t.final)}</span><span class="gst">+ GST</span>` : html`<span class="muted">Price on request</span>`}
        </div>
        ${!isClient && t.lineCount > 0 && html`<p class="margin-line">Cost ${money(t.cost)}, profit ${money(t.profit)} (${pct(t.effMarkup)} markup)</p>`}
        <div class="design-actions">
          <a class="btn" href=${`#/print/${entry.folderId}`}><${Icon} name="print" /> Spec sheet</a>
          ${editable && !entry.archived && html`
            <a class="btn btn-primary" href=${`#/edit/${entry.folderId}`}><${Icon} name="edit" /> Edit</a>
            <button class="btn" onClick=${() => run(() => store.setStatus(entry, b.status === 'published' ? 'draft' : 'published'), b.status === 'published' ? 'Moved to drafts' : 'Published to the range')}>
              <${Icon} name=${b.status === 'published' ? 'eyeOff' : 'eye'} /> ${b.status === 'published' ? 'Unpublish' : 'Publish'}</button>
            <button class="btn" onClick=${duplicate}><${Icon} name="copy" /> Duplicate</button>
            <button class="btn" onClick=${archive}><${Icon} name="archive" /> Archive</button>`}
          ${!isClient && !isDemo && html`<a class="btn" href=${store.drive.folderLink(entry.folderId)} target="_blank" rel="noopener"><${Icon} name="folder" /> Drive folder</a>`}
        </div>
        ${!isClient && html`<p class="muted small updated">Updated ${timeAgo(b.updatedAt)}${b.updatedBy ? ` by ${b.updatedBy}` : ''}</p>`}
      </div>
    </section>

    <div class="tabs" role="tablist">${tabs.map(([k, l]) => html`<button role="tab" aria-selected=${active === k} class=${active === k ? 'on' : ''} onClick=${() => setActiveTab(k)}>${l}</button>`)}</div>
    <section class="tab-body" role="tabpanel">
      ${active === 'overview' && html`<${OverviewTab} entry=${entry} cat=${cat} />`}
      ${active === 'model' && html`<${ModelTab} entry=${entry} />`}
      ${active === 'plans' && html`<${PlansTab} entry=${entry} />`}
      ${active === 'renders' && html`<${RendersTab} entry=${entry} renders=${renders.value} reload=${() => setRk(rk + 1)} />`}
      ${active === 'framing' && html`<${FilesPanel} entry=${entry} sectionKey="framing" title="Steel framing detailing"
        hint="Any file type: PDFs, DWG, CSV, machine files. Only shown to staff, never in client mode." emptyText="No framing files uploaded." />`}
      ${active === 'costing' && html`<${CostingTab} entry=${entry} />`}
    </section>
    ${b.notes && !isClient && html`<section class="notes-box"><h3>Internal notes</h3><p>${b.notes}</p></section>`}
  </div>`;
}
