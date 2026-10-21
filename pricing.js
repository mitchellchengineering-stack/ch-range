// Pricing maths. All prices are excluding GST. Markup is applied on cost: sell = cost × (1 + markup%).

export const UNITS = ['each', 'm²', 'lm', 'm³', 'hr', 'set', 'sheet', 'kg', 'lump sum'];

// The unit each group is usually priced in. Picking a group on a new line or price list item sets this unit.
export const GROUP_UNITS = {
  Framing: 'lm', Flashings: 'lm', Roofing: 'm²', Cladding: 'm²', Doors: 'each', Windows: 'each',
  'Insulation & lining': 'm²', Fixings: 'each', Labour: 'hr', Delivery: 'lump sum', 'Consents & fees': 'lump sum',
  'Site work': 'lump sum', Other: 'each',
};

export const GROUPS = [
  'Framing', 'Roofing', 'Cladding', 'Flashings', 'Doors', 'Windows',
  'Insulation & lining', 'Fixings', 'Labour', 'Delivery', 'Consents & fees',
  'Site work', 'Other',
];

// ── three prices per design ─────────────────────────────────────
// Each costing line says which price it first appears in. The prices stack:
//   Framing only = lines marked "framing"
//   Kitset       = framing lines + lines marked "kitset"
//   Whole package = everything (adds lines marked "built")
// Lines saved before this existed have no tier and count as "built", so old designs keep their single price as the whole package.
export const TIERS = [
  { key: 'framing', label: 'Framing only', short: 'Framing', note: '' },
  { key: 'kitset', label: 'Kitset', short: 'Kitset', note: '' },
  { key: 'built', label: 'Whole package', short: 'Package', note: 'Fully built within 15 km of Hamilton' },
];
export const TIER_IN = { framing: 'All three prices', kitset: 'Kitset and package', built: 'Package only' };
export const GROUP_TIERS = {
  Framing: 'framing', Roofing: 'kitset', Cladding: 'kitset', Flashings: 'kitset', Doors: 'kitset', Windows: 'kitset',
  'Insulation & lining': 'kitset', Fixings: 'kitset', Labour: 'built', Delivery: 'built', 'Consents & fees': 'built',
  'Site work': 'built', Other: 'built',
};
const TIER_RANK = { framing: 0, kitset: 1, built: 2 };
export const lineTier = (l) => (TIER_RANK[l?.tier] === undefined ? 'built' : l.tier);

const nzd0 = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0, minimumFractionDigits: 0 });
const nzd2 = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 2, minimumFractionDigits: 2 });

export const num = (v, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

export function money(v, cents = false) {
  return (cents ? nzd2 : nzd0).format(num(v));
}

export function moneyGST(v, cents = false) {
  return `${money(v, cents)} + GST`;
}

export function pct(v) {
  const n = num(v);
  return `${Math.round(n * 10) / 10}%`;
}

export function roundUp(value, step) {
  const s = num(step);
  if (!s) return Math.round(num(value) * 100) / 100;
  return Math.ceil(num(value) / s - 1e-9) * s;
}

export function priceMapOf(priceList) {
  return new Map((priceList?.items || []).map((it) => [it.id, it]));
}

// A line follows the price list when it has priceListId, isn't marked custom, and the item still exists.
export function lineLink(line, priceMap) {
  if (!line.priceListId || line.custom) return { linked: false, missing: false, item: null };
  const item = priceMap.get(line.priceListId);
  return item ? { linked: true, missing: false, item } : { linked: false, missing: true, item: null };
}

export function lineCalc(line, priceMap) {
  const { linked, item, missing } = lineLink(line, priceMap);
  const unitCost = linked ? num(item.cost) : num(line.unitCost);
  const qty = num(line.qty);
  const markup = num(line.markup);
  const cost = unitCost * qty;
  const sell = cost * (1 + markup / 100);
  return { linked, missing, item, unitCost, qty, markup, cost, sell,
    unit: linked ? item.unit : line.unit, description: line.description || (item && item.name) || '' };
}

export function buildTotals(build, priceMap, settings) {
  const lines = build?.costing?.lines || [];
  let cost = 0, sell = 0;
  for (const l of lines) {
    const c = lineCalc(l, priceMap);
    cost += c.cost;
    sell += c.sell;
  }
  const step = num(settings?.rounding);
  const final = roundUp(sell, step);
  const profit = final - cost;
  const effMarkup = cost > 0 ? (final / cost - 1) * 100 : 0;
  return { cost, sell, final, profit, effMarkup, lineCount: lines.length };
}

// The three prices for a design. `show` is true when at least one line starts at that price, so a design with no
// kitset-only lines doesn't show a kitset price that is just the framing price again.
export function tierTotals(build, priceMap, settings) {
  const lines = build?.costing?.lines || [];
  const step = num(settings?.rounding);
  return TIERS.map((t, ti) => {
    let cost = 0, sell = 0, own = 0, count = 0;
    for (const l of lines) {
      const r = TIER_RANK[lineTier(l)];
      if (r > ti) continue;
      const c = lineCalc(l, priceMap);
      cost += c.cost; sell += c.sell; count++;
      if (r === ti) own++;
    }
    const final = roundUp(sell, step);
    const profit = final - cost;
    const effMarkup = cost > 0 ? (final / cost - 1) * 100 : 0;
    return { ...t, cost, sell, final, profit, effMarkup, lineCount: count, own, show: own > 0 };
  });
}

// Linked price list items that have changed since this design's prices were last reviewed
export function changedSinceReview(build, priceMap) {
  const since = Date.parse(build?.priceReviewedAt || build?.createdAt || 0) || 0;
  const out = [];
  for (const l of build?.costing?.lines || []) {
    const { linked, item } = lineLink(l, priceMap);
    // only real price changes count, not the moment an item was first added
    const changed = item?.priceChangedAt && item.priceChangedAt !== item.createdAt ? item.priceChangedAt : null;
    if (linked && changed && Date.parse(changed) > since && !out.includes(item)) out.push(item);
  }
  return out;
}

export function reviewDue(build, settings) {
  const months = num(settings?.priceReviewMonths, 6);
  if (!months) return false;
  const since = Date.parse(build?.priceReviewedAt || build?.createdAt || 0) || 0;
  return Date.now() - since > months * 30.44 * 24 * 3600 * 1000;
}

export function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}
