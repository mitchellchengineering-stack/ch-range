// Pricing maths. All prices are excluding GST. Markup is applied on cost: sell = cost × (1 + markup%).

export const UNITS = ['each', 'm²', 'lm', 'm³', 'hr', 'set', 'sheet', 'kg', 'lump sum'];

export const GROUPS = [
  'Framing', 'Roofing', 'Cladding', 'Flashings', 'Doors', 'Windows',
  'Insulation & lining', 'Fixings', 'Labour', 'Delivery', 'Consents & fees',
  'Site work', 'Other',
];

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
