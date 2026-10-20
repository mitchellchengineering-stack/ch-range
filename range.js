import { html, useState, useEffect, useMemo } from 'htm/preact';
import { useApp, useStoreRev, useAsync, Icon, Spinner, ErrorBox, BlobImg, Placeholder, Watermark, sizeLabel, floorArea, fmtNum } from './ui.js';
import { buildTotals, money, reviewDue, changedSinceReview } from './pricing.js';

export const SORTS = [
  ['name', 'Name'], ['price-asc', 'Price, low to high'], ['price-desc', 'Price, high to low'],
  ['area-asc', 'Size, small to large'], ['area-desc', 'Size, large to small'], ['updated', 'Recently updated'],
];

export function sortBuilds(list, sort, store) {
  const pm = store.priceMap, s = store.settings;
  const price = (b) => buildTotals(b.data, pm, s).final;
  const area = (b) => floorArea(b.data.specs) || 0;
  const byName = (a, b) => (a.data.name || '').localeCompare(b.data.name || '', undefined, { numeric: true });
  const cmp = {
    name: byName,
    'price-asc': (a, b) => price(a) - price(b) || byName(a, b),
    'price-desc': (a, b) => price(b) - price(a) || byName(a, b),
    'area-asc': (a, b) => area(a) - area(b) || byName(a, b),
    'area-desc': (a, b) => area(b) - area(a) || byName(a, b),
    updated: (a, b) => String(b.data.updatedAt || '').localeCompare(String(a.data.updatedAt || '')),
  }[sort] || byName;
  return [...list].sort(cmp);
}

export function visibleIn(store, catId, isClient) {
  return store.buildsIn(catId).filter((b) => !isClient || b.data.status === 'published');
}

export function RoofCardImage({ fileId, label }) {
  return html`<div class="card-img">
    <${BlobImg} fileId=${fileId} alt=${label} fallback=${html`<${Placeholder} />`} />
    ${fileId && html`<${Watermark} size="sm" />`}
    <svg class="card-roof" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="0,0 50,0 0,10" class="roof-mask" /><polygon points="50,0 100,0 100,10" class="roof-mask" />
      <polyline points="0,10 50,0 100,10" vector-effect="non-scaling-stroke" class="roof-line" />
    </svg>
  </div>`;
}

export function DesignCard({ entry }) {
  const { store, isClient } = useApp();
  const b = entry.data;
  const t = buildTotals(b, store.priceMap, store.settings);
  const area = floorArea(b.specs);
  const flags = [];
  if (!isClient) {
    if (b.status !== 'published') flags.push(html`<span class="flag flag-draft">Draft</span>`);
    if (reviewDue(b, store.settings) || changedSinceReview(b, store.priceMap).length) flags.push(html`<span class="flag flag-review">Check prices</span>`);
  }
  const bits = [sizeLabel(b.specs), area ? `${fmtNum(area, 1)} m²` : '', b.specs?.bedrooms ? `${b.specs.bedrooms} bed` : ''].filter(Boolean);
  return html`<a class="card" href=${`#/b/${entry.folderId}`}>
    <${RoofCardImage} fileId=${entry.thumbId} label=${b.name} />
    ${flags.length > 0 && html`<div class="card-flags">${flags}</div>`}
    <div class="card-body">
      <span class="code">${b.code}</span>
      <h3>${b.name || 'Untitled'}</h3>
      ${bits.length > 0 && html`<p class="card-spec">${bits.map((x, i) => html`<span key=${i}>${x}</span>`)}</p>`}
      <p class="card-price">${t.lineCount ? html`${money(t.final)}<small> + GST</small>` : html`<small class="muted">No pricing yet</small>`}</p>
    </div>
  </a>`;
}

export function RangeView({ catId }) {
  const { store, isClient, canEdit, nav, run } = useApp();
  useStoreRev(store);
  const cats = store.settings.categories;
  const cat = store.cat(catId) || cats[0];
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(() => localStorage.getItem('chr.sort') || 'name');
  const [status, setStatus] = useState('all');
  const load = useAsync(() => store.loadCategory(cat.id), [cat.id]);

  useEffect(() => { localStorage.setItem('chr.lastCat', cat.id); }, [cat.id]);
  useEffect(() => { localStorage.setItem('chr.sort', sort); }, [sort]);

  const all = visibleIn(store, cat.id, isClient);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    let l = all.filter((b) => !q || [b.data.name, b.data.code, b.data.description].join(' ').toLowerCase().includes(q));
    if (!isClient && status !== 'all') l = l.filter((b) => (status === 'published' ? b.data.status === 'published' : b.data.status !== 'published'));
    return sortBuilds(l, sort, store);
  }, [all, query, sort, status, store.rev]);

  const drafts = all.filter((b) => b.data.status !== 'published').length;
  const countText = `${all.length} ${all.length === 1 ? 'design' : 'designs'}${!isClient && drafts ? `, ${drafts} in draft` : ''}`;

  return html`<div class="page range">
    <section class="range-hero">
      <div class="cat-picker">
        <label for="cat-select" class="cat-label">Browse the range</label>
        <div class="cat-select">
          <span class="cat-name">${cat.name}</span><${Icon} name="down" size=${30} stroke=${2.4} />
          <select id="cat-select" value=${cat.id} onChange=${(e) => nav(`#/c/${e.target.value}`)}>
            ${cats.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
          </select>
        </div>
        <p class="cat-count">${load.loading && !all.length ? 'Loading…' : countText}</p>
      </div>
      ${!isClient && canEdit && html`<button class="btn btn-primary btn-lg" onClick=${() => nav(`#/new/${cat.id}`)}><${Icon} name="plus" /> Add ${(cat.singular || cat.name).toLowerCase()}</button>`}
    </section>

    <div class="toolbar">
      <label class="search"><${Icon} name="search" /><input type="search" placeholder=${`Search ${cat.name.toLowerCase()}`} value=${query} onInput=${(e) => setQuery(e.target.value)} aria-label="Search" /></label>
      <label class="select-inline"><span>Sort</span>
        <select value=${sort} onChange=${(e) => setSort(e.target.value)}>${SORTS.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></label>
      ${!isClient && html`<div class="seg" role="group" aria-label="Status">
        ${[['all', 'All'], ['published', 'Published'], ['draft', 'Drafts']].map(([v, l]) => html`<button class=${status === v ? 'on' : ''} onClick=${() => setStatus(v)}>${l}</button>`)}
      </div>`}
      <button class="icon-btn" title="Refresh from Drive" aria-label="Refresh from Drive" onClick=${() => run(() => store.loadCategory(cat.id, true))}><${Icon} name="refresh" /></button>
    </div>

    ${load.error && html`<${ErrorBox} error=${load.error} onRetry=${load.reload} />`}
    ${load.loading && !all.length && html`<${Spinner} label="Loading designs" />`}
    ${!load.loading && !load.error && list.length === 0 && html`<div class="empty">
      <${Placeholder} />
      ${all.length
        ? html`<p>Nothing matches “${query}”.</p>`
        : html`<p>${isClient ? `There are no ${cat.name.toLowerCase()} to show yet.` : `No ${cat.name.toLowerCase()} in the range yet. Add the first one to start building it out.`}</p>
          ${!isClient && canEdit && html`<button class="btn btn-primary" onClick=${() => nav(`#/new/${cat.id}`)}><${Icon} name="plus" /> Add ${(cat.singular || cat.name).toLowerCase()}</button>`}`}
    </div>`}
    <div class="grid">${list.map((b) => html`<${DesignCard} entry=${b} key=${b.folderId} />`)}</div>
  </div>`;
}
