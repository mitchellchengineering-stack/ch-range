import { html, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'htm/preact';
import { useApp, useStoreRev, useAsync, Icon, Spinner, ErrorBox, Modal, floorArea, fmtNum } from './ui.js';
import { GROUPS, UNITS, GROUP_UNITS, GROUP_TIERS, TIER_IN, tierTotals, lineTier, lineCalc, money, pct, uid, num } from './pricing.js';
import { SPEC_FIELDS } from './specs.js';
import { PriceItemForm } from './prices.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const QUICK = [
  { description: 'Steel framing', group: 'Framing', unit: 'lm' },
  { description: 'Install labour', group: 'Labour', unit: 'hr' },
  { description: 'Delivery', group: 'Delivery', unit: 'lump sum' },
  { description: 'Building consent fees', group: 'Consents & fees', unit: 'lump sum' },
  { description: 'Site preparation', group: 'Site work', unit: 'lump sum' },
];

function ListEditor({ items, onChange, placeholder, addLabel }) {
  const [draft, setDraft] = useState('');
  const set = (i, v) => onChange(items.map((x, k) => (k === i ? v : x)));
  const move = (i, d) => { const a = [...items]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a); };
  const add = () => { if (!draft.trim()) return; onChange([...items, draft.trim()]); setDraft(''); };
  return html`<div class="list-editor">
    ${items.map((x, i) => html`<div class="le-row" key=${i}>
      <input class="input" value=${x} onInput=${(e) => set(i, e.target.value)} aria-label=${`Item ${i + 1}`} />
      <button class="icon-btn" onClick=${() => move(i, -1)} disabled=${i === 0} aria-label="Move up"><${Icon} name="up" /></button>
      <button class="icon-btn" onClick=${() => move(i, 1)} disabled=${i === items.length - 1} aria-label="Move down"><${Icon} name="down" /></button>
      <button class="icon-btn danger" onClick=${() => onChange(items.filter((_, k) => k !== i))} aria-label="Remove"><${Icon} name="x" /></button>
    </div>`)}
    <div class="le-row le-add">
      <input class="input" placeholder=${placeholder} value=${draft} onInput=${(e) => setDraft(e.target.value)}
        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
      <button class="btn" onClick=${add} disabled=${!draft.trim()}><${Icon} name="plus" /> ${addLabel}</button>
    </div>
  </div>`;
}

function PricePicker({ onAdd, onClose, defaultMarkup }) {
  const { store, canEdit } = useApp();
  useStoreRev(store);
  const [q, setQ] = useState('');
  const [added, setAdded] = useState({});
  const [creating, setCreating] = useState(false);
  const items = store.priceList.items.filter((it) => !q || `${it.name} ${it.group} ${it.supplier || ''} ${it.sku || ''}`.toLowerCase().includes(q.toLowerCase()));
  const groups = [...new Set(items.map((i) => i.group))].sort((a, b) => GROUPS.indexOf(a) - GROUPS.indexOf(b));
  const add = (it) => {
    onAdd({ id: uid('l'), priceListId: it.id, description: it.name, group: it.group, tier: GROUP_TIERS[it.group] || 'built', unit: it.unit, qty: 1, unitCost: it.cost,
      markup: it.markup !== '' && it.markup != null ? num(it.markup) : num(defaultMarkup), custom: false });
    setAdded((a) => ({ ...a, [it.id]: (a[it.id] || 0) + 1 }));
  };
  if (creating) {
    return html`<${PriceItemForm} onClose=${() => setCreating(false)} onSaved=${(it) => { setCreating(false); add(it); }} />`;
  }
  return html`<${Modal} title="Add from price list" onClose=${onClose} wide
    footer=${html`${canEdit && html`<button class="btn" onClick=${() => setCreating(true)}><${Icon} name="plus" /> New price list item</button>`}<button class="btn btn-primary" onClick=${onClose}>Done</button>`}>
    <label class="search"><${Icon} name="search" /><input type="search" placeholder="Search items, suppliers or codes" value=${q} onInput=${(e) => setQ(e.target.value)} autofocus /></label>
    ${!store.priceList.items.length && html`<p class="muted">The price list is empty. Add items on the Price list page, or create one here.</p>`}
    <div class="picker">${groups.map((g) => html`<div class="picker-group"><h4>${g}</h4>
      ${items.filter((i) => i.group === g).map((it) => html`<div class="picker-row">
        <div><strong>${it.name}</strong>${it.supplier && html`<small class="muted"> ${it.supplier}</small>`}</div>
        <span class="num">${money(it.cost, true)} / ${it.unit}</span>
        <button class=${`btn btn-sm ${added[it.id] ? 'on' : ''}`} onClick=${() => add(it)}>${added[it.id] ? html`<${Icon} name="check" size=${14} /> Added${added[it.id] > 1 ? ` ×${added[it.id]}` : ''}` : 'Add'}</button>
      </div>`)}</div>`)}</div>
  </${Modal}>`;
}

function CostingEditor({ lines, onChange, defaultMarkup }) {
  const { store } = useApp();
  const pm = store.priceMap;
  const [picker, setPicker] = useState(false);
  const [allMarkup, setAllMarkup] = useState(String(defaultMarkup));
  const set = (i, patch) => onChange(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const move = (i, d) => { const a = [...lines]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; onChange(a); };
  const focusNew = useRef(false);
  const addLine = (patch = {}) => { focusNew.current = true; addLineRaw(patch); };
  const addLineRaw = (patch = {}) => onChange([...lines, { id: uid('l'), priceListId: null, description: '', group: 'Other', tier: GROUP_TIERS[patch.group] || 'built', unit: 'each', qty: 1, unitCost: 0, markup: num(defaultMarkup), custom: true, ...patch }]);
  const lastRef = useRef(lines.length);
  const tableRef = useRef();
  useLayoutEffect(() => {
    if (lines.length > lastRef.current && focusNew.current) {
      focusNew.current = false;
      const rows = tableRef.current?.querySelectorAll('tbody tr');
      const input = rows?.[rows.length - 1]?.querySelector('input');
      if (input) { input.focus(); if (input.value) input.select(); }
    }
    lastRef.current = lines.length;
  }, [lines.length]);

  return html`<div class="costing-editor">
    <div class="table-scroll"><table class="table cost-table" ref=${tableRef}>
      <thead><tr><th class="c-desc">Item</th><th>Group</th><th>In price</th><th class="num">Qty</th><th>Unit</th><th class="num">Rate</th><th class="num">Markup %</th><th class="num">Cost</th><th class="num">Sell</th><th class="c-act"><span class="sr">Actions</span></th></tr></thead>
      <tbody>
        ${lines.map((l, i) => {
          const c = lineCalc(l, pm);
          return html`<tr key=${l.id}>
            <td class="c-desc">
              <input class="input" value=${l.description} placeholder="Describe the item" onInput=${(e) => set(i, { description: e.target.value })} aria-label="Item description" />
              ${c.linked && html`<span class="tag tag-link" title="Rate follows the price list"><${Icon} name="link" size=${12} /> ${c.item.name === l.description ? 'Price list' : c.item.name}</span>`}
              ${c.missing && html`<span class="tag tag-warn" title="Using the last known price">Removed from price list, using last price</span>`}
            </td>
            <td><select class="input" value=${l.group} onChange=${(e) => set(i, c.linked ? { group: e.target.value } : { group: e.target.value, unit: GROUP_UNITS[e.target.value] || l.unit })} aria-label="Group">${[...new Set([...GROUPS, l.group])].map((g) => html`<option value=${g} selected=${g === l.group}>${g}</option>`)}</select></td>
            <td><select class="input" value=${lineTier(l)} onChange=${(e) => set(i, { tier: e.target.value })} aria-label="Which prices this line is in" title="Which of the three prices this line counts toward">${Object.entries(TIER_IN).map(([k, lab]) => html`<option value=${k} selected=${k === lineTier(l)}>${lab}</option>`)}</select></td>
            <td class="num"><input class="input num" type="number" inputmode="decimal" step="any" min="0" value=${l.qty} onInput=${(e) => set(i, { qty: e.target.value })} aria-label="Quantity" /></td>
            <td>${c.linked ? html`<span class="ro-val">${c.unit}</span>`
              : html`<select class="input" value=${l.unit} onChange=${(e) => set(i, { unit: e.target.value })} aria-label="Unit">${[...new Set([...UNITS, l.unit])].map((u) => html`<option value=${u} selected=${u === l.unit}>${u}</option>`)}</select>`}</td>
            <td class="num">${c.linked ? html`<span class="ro-val">${money(c.unitCost, true)}${c.unit === 'lump sum' ? '' : html`<small> / ${c.unit}</small>`}</span>`
              : html`<input class="input num" type="number" inputmode="decimal" step="any" min="0" value=${l.unitCost} onInput=${(e) => set(i, { unitCost: e.target.value })} aria-label="Rate excluding GST" title=${`Price per ${l.unit}, excluding GST`} />`}</td>
            <td class="num"><input class="input num" type="number" inputmode="decimal" step="any" value=${l.markup} onInput=${(e) => set(i, { markup: e.target.value })} aria-label="Markup percent" /></td>
            <td class="num calc">${money(c.cost, true)}</td>
            <td class="num calc strong">${money(c.sell, true)}</td>
            <td class="c-act"><div class="row-actions">
              <button class="icon-btn" onClick=${() => move(i, -1)} disabled=${i === 0} aria-label="Move up" title="Move up"><${Icon} name="up" size=${16} /></button>
              <button class="icon-btn" onClick=${() => move(i, 1)} disabled=${i === lines.length - 1} aria-label="Move down" title="Move down"><${Icon} name="down" size=${16} /></button>
              ${c.linked && html`<button class="icon-btn" title="Set a custom price for this design only" aria-label="Use a custom price" onClick=${() => set(i, { custom: true, unitCost: c.unitCost, unit: c.unit })}><${Icon} name="unlink" size=${16} /></button>`}
              ${l.priceListId && l.custom && pm.has(l.priceListId) && html`<button class="icon-btn" title="Follow the price list again" aria-label="Link to price list" onClick=${() => set(i, { custom: false })}><${Icon} name="link" size=${16} /></button>`}
              <button class="icon-btn danger" onClick=${() => onChange(lines.filter((_, k) => k !== i))} aria-label="Remove line" title="Remove line"><${Icon} name="trash" size=${16} /></button>
            </div></td>
          </tr>`;
        })}
        ${!lines.length && html`<tr><td colspan="10" class="muted empty-row">No lines yet. Add your first line below.</td></tr>`}
      </tbody>
    </table></div>
    <div class="cost-tools">
      <div class="row-gap">
        <button class="btn btn-primary" onClick=${() => addLine()}><${Icon} name="plus" /> Add line</button>
        <button class="btn" onClick=${() => setPicker(true)}><${Icon} name="list" /> Add from price list</button>
      </div>
      <div class="row-gap quick"><span class="muted small">Quick add</span>
        ${QUICK.map((qk) => html`<button class="chip" onClick=${() => addLine(qk)}>${qk.description}</button>`)}
      </div>
      <div class="row-gap set-all">
        <label class="inline-field">Set markup on every line <input class="input num" type="number" step="any" value=${allMarkup} onInput=${(e) => setAllMarkup(e.target.value)} aria-label="Markup for all lines" /> %</label>
        <button class="btn" disabled=${!lines.length} onClick=${() => onChange(lines.map((l) => ({ ...l, markup: num(allMarkup) })))}>Apply</button>
      </div>
    </div>
    ${picker && html`<${PricePicker} defaultMarkup=${defaultMarkup} onClose=${() => setPicker(false)} onAdd=${(line) => onChange((lines = [...lines, line]))} />`}
  </div>`;
}

function TotalsPanel({ build }) {
  const { store } = useApp();
  const tiers = tierTotals(build, store.priceMap, store.settings);
  const rounding = Number(store.settings.rounding) > 0;
  return html`<div class="tier-totals">
    <div class="table-scroll"><table class="table">
      <thead><tr><th>Price</th><th class="num">Total cost</th><th class="num">Profit</th><th class="num">Selling price <small>+ GST</small></th></tr></thead>
      <tbody>${tiers.map((x) => html`<tr key=${x.key} class=${x.show ? '' : 'muted'}>
        <td><strong>${x.label}</strong>${x.note && html`<br /><small class="muted">${x.note}</small>`}${!x.show && html`<br /><small>Not shown. No lines start at this price.</small>`}</td>
        <td class="num">${money(x.cost, true)}</td>
        <td class="num">${money(x.profit, true)} <small>(${pct(x.effMarkup)})</small></td>
        <td class="num strong">${money(x.final, true)}</td></tr>`)}</tbody>
    </table></div>
    <p class="muted small">Prices stack. Framing only is the lines set to “All three prices”. Kitset adds the “Kitset and package” lines. Whole package adds the “Package only” lines.${rounding ? ` Selling prices are rounded up to the nearest ${money(store.settings.rounding)}.` : ''}</p>
  </div>`;
}

export function EditorView({ id, newCat }) {
  const { store, nav, toast, confirm, setGuard, run } = useApp();
  useStoreRev(store);
  const isNew = !id;
  const load = useAsync(() => (isNew ? null : store.getBuild(id)), [id]);
  const [b, setB] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [suggested, setSuggested] = useState('');

  useEffect(() => {
    if (isNew) { setB(store.blankBuild(store.cat(newCat)?.id || store.settings.categories[0].id)); return; }
    if (load.value) setB(clone(load.value.data));
  }, [load.value, newCat]);
  useEffect(() => { setGuard(dirty ? () => true : null); return () => setGuard(null); }, [dirty]);
  useEffect(() => {
    if (!b?.category) return undefined;
    let live = true;
    store.nextCode(b.category).then((c) => live && setSuggested(c), () => {});
    return () => { live = false; };
  }, [b?.category]);

  if (!isNew && load.loading) return html`<div class="page"><${Spinner} label="Loading design" /></div>`;
  if (load.error) return html`<div class="page"><${ErrorBox} error=${load.error} onRetry=${load.reload} /></div>`;
  if (!b) return html`<div class="page"><${Spinner} /></div>`;

  const cat = store.cat(b.category);
  const up = (patch) => { setB((x) => ({ ...x, ...patch })); setDirty(true); };
  const upSpec = (k, v) => { setB((x) => ({ ...x, specs: { ...x.specs, [k]: v } })); setDirty(true); };
  const autoArea = (() => { const L = parseFloat(b.specs.length), W = parseFloat(b.specs.width); return Number.isFinite(L) && Number.isFinite(W) ? fmtNum(L * W, 2) : ''; })();

  const save = async (andView = true) => {
    const errs = {};
    if (!b.name.trim()) errs.name = 'Give it a name';
    const code = String(b.code || '').trim().toUpperCase();
    const origCode = load.value?.data?.code || '';
    setSaving(true);
    try {
      if (code && !/^[A-Z0-9][A-Z0-9 ._-]*$/.test(code)) errs.code = 'Use letters, numbers and dashes, like SH-004.';
      else if (code && (isNew || code !== origCode) && await store.codeTaken(code, isNew ? null : id)) errs.code = `${code} is already used by another design.`;
      setErrors(errs);
      if (Object.keys(errs).length) { document.getElementById(errs.name ? 'f-name' : 'f-code')?.focus(); setSaving(false); return; }
      const payload = { ...b, name: b.name.trim(), code };
      let res = await store.saveBuild(payload, { folderId: isNew ? null : id });
      if (res?.conflict) {
        const ok = await confirm({
          title: 'Someone else saved this design',
          message: `${res.by} saved changes ${res.at ? `at ${new Date(res.at).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })}` : 'while you were editing'}. Saving now will replace their changes with yours.`,
          confirmLabel: 'Save mine anyway', cancelLabel: 'Keep editing', danger: true,
        });
        if (!ok) { setSaving(false); return; }
        res = await store.saveBuild(payload, { folderId: id, force: true });
      }
      setDirty(false); setGuard(null);
      toast(isNew ? `${b.name.trim()} created` : 'Changes saved');
      if (isNew) nav(`#/b/${res.folderId}/renders`, { replace: true });
      else if (andView) nav(`#/b/${id}`);
      else setB(clone(res.data));
    } catch (e) {
      console.error(e); toast(e.message, 'error');
    } finally { setSaving(false); }
  };

  const cancel = () => nav(isNew ? `#/c/${b.category}` : `#/b/${id}`);
  const tiersNow = tierTotals(b, store.priceMap, store.settings).filter((x) => x.show);

  return html`<div class="page editor">
    <div class="editor-head">
      <a class="back" href=${isNew ? `#/c/${b.category}` : `#/b/${id}`}><${Icon} name="left" /> ${isNew ? cat?.name : b.name || 'Back'}</a>
      <h1>${isNew ? `New ${(cat?.singular || 'design').toLowerCase()}` : `Edit ${load.value?.data?.code || b.code}`}</h1>
      ${isNew && html`<p class="muted">Fill in the details and costing, then save. You’ll add plans, the 3D model and renders on the next screen.</p>`}
    </div>

    <div class="editor-grid">
      <nav class="editor-toc" aria-label="Sections">
        ${[['basics', 'Basics'], ['specs', 'Specifications'], ['included', 'What’s included'], ['costing', 'Costing'], ['notes', 'Internal notes']].map(([k, l]) => html`<a href=${`#`} onClick=${(e) => { e.preventDefault(); document.getElementById(`sec-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>${l}</a>`)}
      </nav>
      <div class="editor-body">
        <section class="form-section" id="sec-basics">
          <h2>Basics</h2>
          <div class="fields">
            <label class="field span-2"><span>Name</span>
              <input id="f-name" class=${`input ${errors.name ? 'invalid' : ''}`} value=${b.name} placeholder="e.g. Single Garage 6 × 6" onInput=${(e) => up({ name: e.target.value })} />
              ${errors.name && html`<small class="form-error">${errors.name}</small>`}</label>
            <label class="field"><span>Category</span>
              <select class="input" value=${b.category} onChange=${(e) => up({ category: e.target.value })}>${store.settings.categories.map((c) => html`<option value=${c.id}>${c.name}</option>`)}</select></label>
            <label class="field"><span>Status</span>
              <select class="input" value=${b.status} onChange=${(e) => up({ status: e.target.value })}>
                <option value="draft">Draft, staff only</option><option value="published">Published, shown to clients</option></select></label>
            <label class="field"><span>Code</span>
              <input id="f-code" class=${`input ${errors.code ? 'invalid' : ''}`} value=${b.code || ''} maxlength="16"
                placeholder=${suggested ? `Automatic, ${suggested}` : 'Automatic'} onInput=${(e) => up({ code: e.target.value.toUpperCase() })} />
              ${errors.code ? html`<small class="form-error">${errors.code}</small>`
                : html`<small class="muted">${isNew ? 'Leave blank for the next number.' : 'Changing it renames the Drive folder.'}${suggested && suggested !== b.code ? html` <button type="button" class="link-btn" onClick=${() => up({ code: suggested })}>Use ${suggested}</button>` : ''}</small>`}
            </label>
            <label class="field span-2"><span>Description</span>
              <textarea class="input" rows="3" value=${b.description} placeholder="A sentence or two clients will read" onInput=${(e) => up({ description: e.target.value })}></textarea></label>
          </div>
        </section>

        <section class="form-section" id="sec-specs">
          <h2>Specifications</h2>
          <div class="fields fields-3">
            ${SPEC_FIELDS.filter((f) => !f.residential || cat?.residential || b.specs[f.key]).map((f) => html`<label class="field"><span>${f.label}${f.unit ? html` <small>(${f.unit})</small>` : ''}</span>
              ${f.type === 'select'
                ? html`<select class="input" value=${b.specs[f.key] || ''} onChange=${(e) => upSpec(f.key, e.target.value)}>${f.options.map((o) => html`<option value=${o}>${o || 'Not set'}</option>`)}</select>`
                : html`<input class="input" type=${f.type === 'number' ? 'number' : 'text'} step="any" inputmode=${f.type === 'number' ? 'decimal' : undefined}
                    value=${b.specs[f.key] ?? ''} placeholder=${f.auto && autoArea ? `${autoArea} (auto)` : f.placeholder || ''} onInput=${(e) => upSpec(f.key, e.target.value)} />`}
              ${f.auto && html`<small class="muted">Leave blank to use length × width</small>`}
            </label>`)}
          </div>
          <h3 class="sub">Extra specifications</h3>
          ${(b.extraSpecs || []).map((x, i) => html`<div class="kv-row">
            <input class="input" placeholder="Label, e.g. Insulation" value=${x.label} onInput=${(e) => up({ extraSpecs: b.extraSpecs.map((y, k) => (k === i ? { ...y, label: e.target.value } : y)) })} />
            <input class="input" placeholder="Value, e.g. R2.6 walls" value=${x.value} onInput=${(e) => up({ extraSpecs: b.extraSpecs.map((y, k) => (k === i ? { ...y, value: e.target.value } : y)) })} />
            <button class="icon-btn danger" onClick=${() => up({ extraSpecs: b.extraSpecs.filter((_, k) => k !== i) })} aria-label="Remove"><${Icon} name="x" /></button>
          </div>`)}
          <button class="btn" onClick=${() => up({ extraSpecs: [...(b.extraSpecs || []), { label: '', value: '' }] })}><${Icon} name="plus" /> Add a specification</button>
        </section>

        <section class="form-section" id="sec-included">
          <h2>What’s included</h2>
          <p class="muted">Clients see these lists on the design page and the spec sheet.</p>
          <div class="two-col">
            <div><h3 class="sub">Included</h3><${ListEditor} items=${b.included || []} onChange=${(v) => up({ included: v })} placeholder="e.g. Sectional garage door" addLabel="Add" /></div>
            <div><h3 class="sub">Not included</h3><${ListEditor} items=${b.excluded || []} onChange=${(v) => up({ excluded: v })} placeholder="e.g. Concrete slab" addLabel="Add" /></div>
          </div>
        </section>

        <section class="form-section" id="sec-costing">
          <h2>Costing</h2>
          <p class="muted">All amounts exclude GST. Qty × rate = cost, so framing is lineal metres × your rate per lineal metre. New lines start at ${store.settings.defaultMarkup}% markup on cost. Lines marked “Price list” update automatically when the price list changes.</p>
          <${CostingEditor} lines=${b.costing?.lines || []} defaultMarkup=${store.settings.defaultMarkup}
            onChange=${(lines) => up({ costing: { ...(b.costing || {}), lines } })} />
          <${TotalsPanel} build=${b} />
        </section>

        <section class="form-section" id="sec-notes">
          <h2>Internal notes</h2>
          <p class="muted">Staff only. Never shown in client mode or on spec sheets.</p>
          <textarea class="input" rows="4" value=${b.notes || ''} onInput=${(e) => up({ notes: e.target.value })}></textarea>
        </section>
      </div>
    </div>

    <div class="savebar">
      <div class="savebar-total">${tiersNow.length ? tiersNow.map((x) => html`<span class="st-item" key=${x.key}><span>${x.short}</span><strong>${money(x.final)}</strong></span>`) : html`<span>Selling price</span><strong>${money(0)}</strong>`}<span>+ GST</span></div>
      <div class="row-gap">
        ${dirty && html`<span class="muted small hide-sm">Unsaved changes</span>`}
        <button class="btn" onClick=${cancel} disabled=${saving}>Cancel</button>
        ${!isNew && html`<button class="btn" onClick=${() => save(false)} disabled=${saving || !dirty}>Save and keep editing</button>`}
        <button class="btn btn-primary" onClick=${() => save(true)} disabled=${saving}>${saving ? html`<span class="spinner sm"></span> Saving` : isNew ? 'Create and add files' : 'Save'}</button>
      </div>
    </div>
  </div>`;
}
