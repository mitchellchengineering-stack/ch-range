import { html, useState, useMemo } from 'htm/preact';
import { useApp, useStoreRev, useAsync, Icon, Spinner, ErrorBox, Modal, fmtDateTime, timeAgo } from './ui.js';
import { GROUPS, UNITS, money, pct, num } from './pricing.js';

export function PriceItemForm({ item = null, onClose, onSaved }) {
  const { store, toast } = useApp();
  const [f, setF] = useState(() => ({ name: '', group: 'Other', unit: 'each', cost: '', markup: '', supplier: '', sku: '', notes: '', ...(item || {}) }));
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const up = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const costChanged = item && num(f.cost) !== num(item.cost);
  const used = item ? store.usageOf(item.id).length : 0;
  const save = async () => {
    if (!f.name.trim()) return setErr('Give the item a name.');
    if (f.cost === '' || !Number.isFinite(parseFloat(f.cost))) return setErr('Enter a cost (excluding GST).');
    setBusy(true); setErr('');
    try {
      const data = { name: f.name.trim(), group: f.group, unit: f.unit, cost: num(f.cost), markup: f.markup === '' ? '' : num(f.markup), supplier: f.supplier, sku: f.sku, notes: f.notes };
      const saved = item ? await store.editPriceItem(item.id, data, note) : await store.addPriceItem(data);
      toast(item ? 'Price list updated' : 'Added to the price list');
      onSaved?.(saved);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return html`<${Modal} title=${item ? 'Edit price list item' : 'New price list item'} onClose=${onClose}
    footer=${html`<button class="btn" onClick=${onClose}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${busy}>${busy ? 'Saving…' : 'Save item'}</button>`}>
    ${err && html`<p class="form-error">${err}</p>`}
    <div class="fields">
      <label class="field span-2"><span>Item name</span><input class="input" value=${f.name} onInput=${(e) => up('name', e.target.value)} placeholder="e.g. Corrugated roofing iron 0.40 BMT" autofocus /></label>
      <label class="field"><span>Group</span><select class="input" value=${f.group} onChange=${(e) => up('group', e.target.value)}>${[...new Set([...GROUPS, f.group])].map((g) => html`<option value=${g} selected=${g === f.group}>${g}</option>`)}</select></label>
      <label class="field"><span>Unit</span><select class="input" value=${f.unit} onChange=${(e) => up('unit', e.target.value)}>${[...new Set([...UNITS, f.unit])].map((u) => html`<option value=${u} selected=${u === f.unit}>${u}</option>`)}</select></label>
      <label class="field"><span>Cost per ${f.unit} <small>(excl. GST)</small></span><input class="input" type="number" inputmode="decimal" step="any" value=${f.cost} onInput=${(e) => up('cost', e.target.value)} /></label>
      <label class="field"><span>Default markup % <small>(optional)</small></span><input class="input" type="number" step="any" value=${f.markup} placeholder=${`${store.settings.defaultMarkup} (app default)`} onInput=${(e) => up('markup', e.target.value)} /></label>
      <label class="field"><span>Supplier</span><input class="input" value=${f.supplier} onInput=${(e) => up('supplier', e.target.value)} /></label>
      <label class="field"><span>Supplier code</span><input class="input" value=${f.sku} onInput=${(e) => up('sku', e.target.value)} /></label>
      <label class="field span-2"><span>Notes</span><input class="input" value=${f.notes} onInput=${(e) => up('notes', e.target.value)} /></label>
      ${costChanged && html`<label class="field span-2"><span>Reason for the price change <small>(optional, saved in the history)</small></span>
        <input class="input" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="e.g. Supplier increase, October" /></label>
        <p class="span-2 note-inline"><${Icon} name="alert" size=${16} /> ${used ? `${used} ${used === 1 ? 'design uses' : 'designs use'} this item. Their prices update as soon as you save.` : 'No designs use this item yet.'}</p>`}
    </div>
  </${Modal}>`;
}

function BulkModal({ items, selected, onClose }) {
  const { store, run, toast } = useApp();
  const groupsInUse = [...new Set(items.map((i) => i.group))];
  const [scope, setScope] = useState(selected.length ? 'selected' : 'group');
  const [group, setGroup] = useState(groupsInUse[0] || '');
  const [p, setP] = useState('');
  const [note, setNote] = useState('');
  const target = scope === 'selected' ? items.filter((i) => selected.includes(i.id)) : scope === 'group' ? items.filter((i) => i.group === group) : items;
  const valid = Number.isFinite(parseFloat(p)) && num(p) !== 0 && target.length;
  const apply = async () => {
    const n = await run(() => store.bulkAdjust(target.map((i) => i.id), num(p), note));
    if (n !== undefined) { toast(`Updated ${n} ${n === 1 ? 'price' : 'prices'}`); onClose(true); }
  };
  return html`<${Modal} title="Bulk price update" onClose=${() => onClose(false)} wide
    footer=${html`<button class="btn" onClick=${() => onClose(false)}>Cancel</button>
      <button class="btn btn-primary" disabled=${!valid} onClick=${apply}>Update ${target.length} ${target.length === 1 ? 'price' : 'prices'}</button>`}>
    <div class="fields">
      <fieldset class="field span-2"><legend>Which items</legend>
        <div class="seg">
          <button class=${scope === 'selected' ? 'on' : ''} disabled=${!selected.length} onClick=${() => setScope('selected')}>Selected (${selected.length})</button>
          <button class=${scope === 'group' ? 'on' : ''} onClick=${() => setScope('group')}>A group</button>
          <button class=${scope === 'all' ? 'on' : ''} onClick=${() => setScope('all')}>Everything</button>
        </div>
        ${scope === 'group' && html`<select class="input mt-sm" value=${group} onChange=${(e) => setGroup(e.target.value)}>${groupsInUse.map((g) => html`<option value=${g} selected=${g === group}>${g}</option>`)}</select>`}
      </fieldset>
      <label class="field"><span>Change by %</span><input class="input" type="number" step="any" value=${p} placeholder="e.g. 5 or -3" onInput=${(e) => setP(e.target.value)} autofocus /></label>
      <label class="field"><span>Reason <small>(optional)</small></span><input class="input" value=${note} onInput=${(e) => setNote(e.target.value)} placeholder="e.g. Steel price increase" /></label>
    </div>
    ${valid && html`<div class="table-scroll preview"><table class="table">
      <thead><tr><th>Item</th><th class="num">Now</th><th class="num">New</th></tr></thead>
      <tbody>${target.slice(0, 8).map((i) => html`<tr><td>${i.name}</td><td class="num">${money(i.cost, true)}</td><td class="num strong">${money(Math.round(num(i.cost) * (1 + num(p) / 100) * 100) / 100, true)}</td></tr>`)}
      ${target.length > 8 && html`<tr><td colspan="3" class="muted">and ${target.length - 8} more</td></tr>`}</tbody></table></div>`}
  </${Modal}>`;
}

function HistoryTab() {
  const { store } = useApp();
  const h = useAsync(() => store.loadHistory(), []);
  const [q, setQ] = useState('');
  const list = (h.value || []).filter((e) => !q || `${e.itemName} ${e.by} ${e.note || ''}`.toLowerCase().includes(q.toLowerCase()));
  const change = (e) => {
    if (e.type === 'added') return html`Added at ${money(e.to, true)}`;
    if (e.type === 'removed') return html`Removed (was ${money(e.from, true)})`;
    if (e.type === 'details') return 'Details edited';
    const d = e.from ? ((e.to - e.from) / e.from) * 100 : 0;
    return html`${money(e.from, true)} to <strong>${money(e.to, true)}</strong> <span class=${d >= 0 ? 'up' : 'down'}>${d >= 0 ? '+' : ''}${pct(d)}</span>`;
  };
  if (h.loading) return html`<${Spinner} label="Loading history" />`;
  if (h.error) return html`<${ErrorBox} error=${h.error} onRetry=${h.reload} />`;
  return html`<div>
    <div class="toolbar"><label class="search"><${Icon} name="search" /><input type="search" placeholder="Search history" value=${q} onInput=${(e) => setQ(e.target.value)} /></label></div>
    ${!list.length ? html`<p class="muted">No price changes recorded yet.</p>` : html`<div class="table-scroll"><table class="table">
      <thead><tr><th>When</th><th>Who</th><th>Item</th><th>Change</th><th>Reason</th></tr></thead>
      <tbody>${list.slice(0, 500).map((e) => html`<tr><td class="nowrap">${fmtDateTime(e.at)}</td><td>${e.by}</td><td>${e.itemName}</td><td class="nowrap">${change(e)}</td><td class="muted">${e.note || ''}</td></tr>`)}</tbody>
    </table></div>`}
  </div>`;
}

export function PricesView({ tab }) {
  const { store, canEdit, confirm, run } = useApp();
  useStoreRev(store);
  const loadAll = useAsync(() => store.loadAll(), []);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('');
  const [selected, setSelected] = useState([]);
  const [editing, setEditing] = useState(null); // item or 'new'
  const [bulk, setBulk] = useState(false);
  const [usedOpen, setUsedOpen] = useState(null);
  const items = store.priceList.items;
  const shown = useMemo(() => items
    .filter((i) => (!group || i.group === group) && (!q || `${i.name} ${i.supplier || ''} ${i.sku || ''} ${i.group}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.name.localeCompare(b.name)), [items, q, group]);
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const allOn = shown.length > 0 && shown.every((i) => selected.includes(i.id));

  const del = async (it) => {
    const used = store.usageOf(it.id).length;
    const ok = await confirm({ title: `Remove ${it.name}?`, danger: true, confirmLabel: 'Remove item',
      message: used ? `${used} ${used === 1 ? 'design uses' : 'designs use'} this item. Those lines keep the last price (${money(it.cost, true)}) as a custom price.` : 'No designs use this item.' });
    if (ok) await run(() => store.deletePriceItem(it.id), 'Removed from the price list');
  };

  return html`<div class="page prices">
    <div class="page-head">
      <div><h1>Price list</h1><p class="muted">Costs exclude GST. Change a price here and every design that uses it updates.</p></div>
      ${canEdit && tab === 'items' && html`<div class="row-gap">
        <button class="btn" onClick=${() => setBulk(true)} disabled=${!items.length}><${Icon} name="percent" /> Bulk update</button>
        <button class="btn btn-primary" onClick=${() => setEditing('new')}><${Icon} name="plus" /> Add item</button></div>`}
    </div>
    <div class="tabs"><a href="#/prices" class=${tab === 'items' ? 'on' : ''}>Items</a><a href="#/prices/history" class=${tab === 'history' ? 'on' : ''}>Change history</a></div>
    ${tab === 'history' ? html`<${HistoryTab} />` : html`<div>
      <div class="toolbar">
        <label class="search"><${Icon} name="search" /><input type="search" placeholder="Search items" value=${q} onInput=${(e) => setQ(e.target.value)} /></label>
        <label class="select-inline"><span>Group</span><select value=${group} onChange=${(e) => setGroup(e.target.value)}><option value="" selected=${!group}>All groups</option>${GROUPS.map((g) => html`<option value=${g} selected=${g === group}>${g}</option>`)}</select></label>
        ${selected.length > 0 && html`<span class="muted small">${selected.length} selected</span><button class="link-btn" onClick=${() => setSelected([])}>Clear</button>`}
      </div>
      ${!items.length ? html`<div class="empty"><p>The price list is empty. Add your common materials, doors, windows and labour rates so designs can pull from them.</p>
        ${canEdit && html`<button class="btn btn-primary" onClick=${() => setEditing('new')}><${Icon} name="plus" /> Add the first item</button>`}</div>`
      : html`<div class="table-scroll"><table class="table price-table">
        <thead><tr>
          ${canEdit && html`<th class="c-check"><input type="checkbox" checked=${allOn} onChange=${() => setSelected(allOn ? [] : shown.map((i) => i.id))} aria-label="Select all" /></th>`}
          <th>Item</th><th>Group</th><th>Unit</th><th class="num">Cost</th><th class="num">Markup</th><th class="num">Sell</th><th>Last change</th><th class="num">Used in</th>${canEdit && html`<th><span class="sr">Actions</span></th>`}
        </tr></thead>
        <tbody>${shown.map((it) => {
          const m = it.markup === '' || it.markup == null ? num(store.settings.defaultMarkup) : num(it.markup);
          const used = store.usageOf(it.id);
          return html`<tr key=${it.id}>
            ${canEdit && html`<td class="c-check"><input type="checkbox" checked=${selected.includes(it.id)} onChange=${() => toggle(it.id)} aria-label=${`Select ${it.name}`} /></td>`}
            <td><strong>${it.name}</strong>${(it.supplier || it.sku) && html`<br /><small class="muted">${[it.supplier, it.sku].filter(Boolean).join(', ')}</small>`}</td>
            <td>${it.group}</td><td>${it.unit}</td>
            <td class="num strong">${money(it.cost, true)}</td>
            <td class="num">${it.markup === '' || it.markup == null ? html`<span class="muted">${pct(m)}</span>` : pct(m)}</td>
            <td class="num">${money(num(it.cost) * (1 + m / 100), true)}</td>
            <td class="nowrap"><small>${timeAgo(it.priceChangedAt || it.updatedAt)}${it.updatedBy ? html`<br /><span class="muted">${it.updatedBy}</span>` : ''}</small></td>
            <td class="num">${loadAll.loading ? '…' : used.length ? html`<button class="link-btn" onClick=${() => setUsedOpen({ it, used })}>${used.length}</button>` : html`<span class="muted">0</span>`}</td>
            ${canEdit && html`<td class="nowrap"><button class="icon-btn" onClick=${() => setEditing(it)} aria-label=${`Edit ${it.name}`}><${Icon} name="edit" /></button>
              <button class="icon-btn danger" onClick=${() => del(it)} aria-label=${`Remove ${it.name}`}><${Icon} name="trash" /></button></td>`}
          </tr>`;
        })}</tbody>
      </table></div>`}
    </div>`}
    ${editing && html`<${PriceItemForm} item=${editing === 'new' ? null : editing} onClose=${() => setEditing(null)} onSaved=${() => setEditing(null)} />`}
    ${bulk && html`<${BulkModal} items=${items} selected=${selected} onClose=${(done) => { setBulk(false); if (done) setSelected([]); }} />`}
    ${usedOpen && html`<${Modal} title=${`Designs using ${usedOpen.it.name}`} onClose=${() => setUsedOpen(null)}>
      <ul class="plain-list">${usedOpen.used.map((b) => html`<li><a href=${`#/b/${b.folderId}`}>${b.data.code} ${b.data.name}</a> <span class="muted small">${store.cat(b.catId)?.name}</span></li>`)}</ul>
    </${Modal}>`}
  </div>`;
}
