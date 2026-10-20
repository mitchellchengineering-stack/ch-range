import { html, useState, useEffect } from 'htm/preact';
import { useApp, useStoreRev, useAsync, Icon, Spinner, ErrorBox, BlobImg, fmtDate } from './ui.js';
import { buildTotals, money } from './pricing.js';
import { specRows } from './specs.js';
import { firstPageImage } from './pdf.js';
import { SPECVIEW } from './store.js';

const isPdf = (f) => /pdf/i.test(f.mimeType) || /\.pdf$/i.test(f.name);
const isIfc = (f) => /\.ifc$/i.test(f.name);
const isImage = (f) => /^image\//i.test(f.mimeType) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name);

// Draws the IFC model off-screen and returns a PNG data URL. Used when no saved spec-sheet view exists.
async function captureModel(blob) {
  const { IfcViewer } = await import('./ifc-viewer.js');
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1400px;height:800px;pointer-events:none;';
  document.body.appendChild(host);
  const v = new IfcViewer(host, { background: 0xffffff });
  try {
    v.renderer.setPixelRatio(1);
    v.renderer.setSize(1400, 800);
    v.camera.aspect = 1400 / 800;
    v.camera.updateProjectionMatrix();
    await v.load(await blob.arrayBuffer());
    v.fit();
    v.controls.update();
    v.renderer.render(v.scene, v.camera);
    return v.screenshot();
  } finally {
    v.dispose();
    host.remove();
  }
}

export function PrintView({ id }) {
  const { store, isClient } = useApp();
  useStoreRev(store);
  const load = useAsync(async () => {
    const entry = await store.getBuild(id);
    if (!entry) return null;
    const [renders, plans, model] = await Promise.all([store.listSection(entry, 'renders'), store.listSection(entry, 'plans'), store.listSection(entry, 'model')]);
    return { entry, renders, plans, model };
  }, [id]);
  const [withPlan, setWithPlan] = useState(true);
  const [withExtra, setWithExtra] = useState(true);
  const [planImg, setPlanImg] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [withModel, setWithModel] = useState(true);
  const [modelImg, setModelImg] = useState(null);
  const [modelBusy, setModelBusy] = useState(false);

  const plan = load.value?.plans?.find((f) => isPdf(f) || isImage(f));
  useEffect(() => {
    if (!plan || !withPlan || planImg) return;
    let dead = false;
    setPlanBusy(true);
    (async () => {
      try {
        const blob = await store.getBlob(plan.id);
        const url = isPdf(plan) ? await firstPageImage(blob) : URL.createObjectURL(blob);
        if (!dead) setPlanImg(url);
      } catch (e) { console.warn(e); } finally { if (!dead) setPlanBusy(false); }
    })();
    return () => { dead = true; };
  }, [plan?.id, withPlan]);

  const modelFiles = load.value?.model || [];
  const savedView = modelFiles.find((f) => f.name === SPECVIEW);
  const ifc = modelFiles.find(isIfc);
  const hasModel = !!(savedView || ifc);
  useEffect(() => {
    if (!withModel || modelImg || !hasModel) return undefined;
    let dead = false;
    setModelBusy(true);
    (async () => {
      try {
        const url = savedView ? await store.getUrl(savedView.id) : await captureModel(await store.getBlob(ifc.id));
        if (!dead) setModelImg(url);
      } catch (e) { console.warn('3D view for spec sheet failed', e); } finally { setModelBusy(false); }
    })();
    return () => { dead = true; };
  }, [savedView?.id, ifc?.id, withModel]);

  if (load.loading) return html`<div class="page"><${Spinner} label="Preparing spec sheet" /></div>`;
  if (load.error) return html`<div class="page"><${ErrorBox} error=${load.error} onRetry=${load.reload} /></div>`;
  if (!load.value) return html`<div class="page"><p>Design not found.</p></div>`;

  const { entry, renders } = load.value;
  const b = entry.data;
  const s = store.settings;
  const cat = store.cat(entry.catId) || store.cat(b.category);
  const t = buildTotals(b, store.priceMap, s);
  const cover = renders[0]?.id || entry.thumbId;
  const extras = renders.slice(1, 3);
  const rows = specRows(b, cat);
  const contact = [s.phone, s.email, s.website].filter(Boolean);
  const back = `#/b/${entry.folderId}`;

  return html`<div class="print-page">
    <div class="print-toolbar no-print">
      <a class="btn" href=${back}><${Icon} name="left" /> Back</a>
      <label class="check"><input type="checkbox" checked=${withPlan} disabled=${!plan} onChange=${(e) => setWithPlan(e.target.checked)} /> Floor plan${!plan ? ' (none uploaded)' : ''}</label>
      <label class="check"><input type="checkbox" checked=${withModel} disabled=${!hasModel} onChange=${(e) => setWithModel(e.target.checked)} /> 3D model view${!hasModel ? ' (none uploaded)' : ''}</label>
      <label class="check"><input type="checkbox" checked=${withExtra} disabled=${!extras.length} onChange=${(e) => setWithExtra(e.target.checked)} /> Extra renders</label>
      <button class="btn btn-primary" onClick=${() => window.print()} disabled=${planBusy || modelBusy}><${Icon} name="print" /> Print or save as PDF</button>
    </div>

    <article class="sheet">
      <header class="sheet-head">
        <img src="logo.png" alt=${`${s.businessName}, ${s.tagline}`} class="sheet-logo" />
        <div class="sheet-contact">${contact.map((c) => html`<span>${c}</span>`)}${s.address && html`<span>${s.address}</span>`}</div>
      </header>

      <div class="sheet-title">
        <div>
          <span class="code">${b.code}${cat ? ` ${cat.singular || cat.name}` : ''}</span>
          <h1>${b.name}</h1>
          ${b.description && html`<p>${b.description}</p>`}
        </div>
        <div class="sheet-price">
          ${t.lineCount ? html`<strong>${money(t.final)}</strong><span>+ GST</span>` : html`<span>Price on request</span>`}
        </div>
      </div>

      ${cover && html`<figure class="sheet-hero"><${BlobImg} fileId=${cover} alt=${b.name} /></figure>`}
      ${withExtra && extras.length > 0 && html`<div class="sheet-extras">${extras.map((f) => html`<figure><${BlobImg} fileId=${f.id} alt="" /></figure>`)}</div>`}

      <div class="sheet-cols">
        <section>
          <h2>Specifications</h2>
          <dl class="spec-table">${rows.map((r) => html`<div><dt>${r.label}</dt><dd>${r.value}</dd></div>`)}</dl>
        </section>
        <section>
          ${b.included?.length > 0 && html`<h2>What’s included</h2><ul class="incl">${b.included.map((x) => html`<li><${Icon} name="check" size=${14} stroke=${2.6} />${x}</li>`)}</ul>`}
          ${b.excluded?.length > 0 && html`<h2>Not included</h2><ul class="excl">${b.excluded.map((x) => html`<li>${x}</li>`)}</ul>`}
        </section>
      </div>

      ${((withModel && hasModel) || (withPlan && plan)) && html`<div class=${`sheet-page2 ${withModel && hasModel ? 'has-model' : ''}`}>
        ${withModel && hasModel && html`<figure class="sheet-model">
          ${modelImg ? html`<img src=${modelImg} alt=${`3D model of ${b.name}`} />` : html`<${Spinner} label="Preparing 3D view" />`}
          <figcaption>3D model</figcaption>
        </figure>`}
        ${withPlan && plan && html`<section class="sheet-plan">
          <h2>Floor plan</h2>
          ${planImg ? html`<img src=${planImg} alt="Floor plan" />` : html`<${Spinner} label="Preparing plan" />`}
        </section>`}
      </div>`}

      <footer class="sheet-foot">
        <p>${s.specSheetFooter}</p>
        <p>Prepared ${fmtDate(new Date())}</p>
      </footer>
    </article>
  </div>`;
}
