import { floorArea, fmtNum } from './ui.js';

export const SPEC_FIELDS = [
  { key: 'length', label: 'Length', unit: 'm', type: 'number' },
  { key: 'width', label: 'Width', unit: 'm', type: 'number' },
  { key: 'floorArea', label: 'Floor area', unit: 'm²', type: 'number', auto: true },
  { key: 'studHeight', label: 'Stud height', unit: 'm', type: 'number' },
  { key: 'roofStyle', label: 'Roof style', type: 'select', options: ['', 'Gable', 'Skillion', 'Hip', 'Dutch gable', 'Monopitch', 'Flat'] },
  { key: 'roofPitch', label: 'Roof pitch', unit: '°', type: 'number' },
  { key: 'roofing', label: 'Roofing', type: 'text', placeholder: 'e.g. Corrugated 0.40 BMT' },
  { key: 'cladding', label: 'Cladding', type: 'text', placeholder: 'e.g. Trimdek' },
  { key: 'bedrooms', label: 'Bedrooms', type: 'number', residential: true },
  { key: 'bathrooms', label: 'Bathrooms', type: 'number', residential: true },
  { key: 'windZone', label: 'Wind zone', type: 'select', options: ['', 'Low', 'Medium', 'High', 'Very high', 'Extra high', 'Specific design'] },
  { key: 'consent', label: 'Building consent', type: 'select', options: ['', 'Not usually required', 'Required', 'Check with council'] },
  { key: 'leadTime', label: 'Lead time', type: 'text', placeholder: 'e.g. 6–8 weeks' },
];

export function specValue(field, specs) {
  if (field.key === 'floorArea') {
    const a = floorArea(specs);
    return a == null ? '' : `${fmtNum(a, 2)} m²`;
  }
  const v = specs?.[field.key];
  if (v === '' || v == null) return '';
  if (field.type === 'number') {
    const n = fmtNum(v, 2);
    if (n === '') return '';
    if (field.unit === '°') return `${n}°`;
    return field.unit ? `${n} ${field.unit}` : n;
  }
  return String(v);
}

export function specRows(build, cat) {
  const rows = [];
  for (const f of SPEC_FIELDS) {
    if (f.residential && !cat?.residential && !build?.specs?.[f.key]) continue;
    const value = specValue(f, build?.specs);
    if (value) rows.push({ label: f.label, value });
  }
  for (const x of build?.extraSpecs || []) if (x.label && x.value) rows.push({ label: x.label, value: x.value });
  return rows;
}
