import { html, useState, useEffect } from 'htm/preact';
import { useApp, useStoreRev, useAsync, Icon, Spinner, ErrorBox, fmtDate } from './ui.js';
import { money, num } from './pricing.js';
import { DesignCard } from './range.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `cat-${Date.now()}`;

export function SettingsView() {
  const { store, canEdit, toast, confirm, setGuard, isDemo } = useApp();
  useStoreRev(store);
  const [s, setS] = useState(() => clone(store.settings));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setGuard(dirty ? () => true : null); return () => setGuard(null); }, [dirty]);
  const up = (k, v) => { setS((x) => ({ ...x, [k]: v })); setDirty(true); };
  const upCat = (i, k, v) => { setS((x) => ({ ...x, categories: x.categories.map((c, j) => (j === i ? { ...c, [k]: v } : c)) })); setDirty(true); };
  const moveCat = (i, d) => {
    const a = [...s.categories]; const j = i + d; if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]]; up('categories', a);
  };
  const removeCat = async (i) => {
    const c = s.categories[i];
    if (c.folderId && await store.categoryHasDesigns(c.id)) {
      return confirm({ title: `${c.name} still has designs`, message: 'Archive or move its designs to another category first, then remove it.', confirmLabel: 'OK', cancelLabel: 'Close' });
    }
    up('categories', s.categories.filter((_, j) => j !== i));
  };
  const addCat = () => up('categories', [...s.categories, { id: '', name: '', singular: '', code: '', residential: false, isNew: true }]);

  const save = async () => {
    setErr('');
    const cats = s.categories.map((c) => ({ ...c, name: c.name.trim(), singular: (c.singular || c.name).trim(), code: c.code.trim().toUpperCase() }));
    if (cats.some((c) => !c.name || !c.code)) return setErr('Every category needs a name and a code.');
    if (new Set(cats.map((c) => c.name.toLowerCase())).size !== cats.length) return setErr('Two categories have the same name.');
    if (new Set(cats.map((c) => c.code)).size !== cats.length) return setErr('Two categories have the same code.');
    if (cats.some((c) => !/^[A-Z0-9]{1,5}$/.test(c.code))) return setErr('Category codes are 1 to 5 letters or numbers, like SH.');
    if (s.clientPin && !/^\d{4,6}$/.test(String(s.clientPin))) return setErr('The client mode PIN needs to be 4 to 6 digits, or blank for no PIN.');
    for (const c of cats) { if (c.isNew) { c.id = slug(c.name); delete c.isNew; } }
    const next = { ...s, categories: cats, defaultMarkup: num(s.defaultMarkup), rounding: num(s.rounding), priceReviewMonths: num(s.priceReviewMonths) };
    setBusy(true);
    try { await store.saveSettings(next); setS(clone(store.settings)); setDirty(false); setGuard(null); toast('Settings saved'); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const dis = !canEdit;
  return html`<div class="page settings">
    <div class="page-head"><div><h1>Settings</h1><p class="muted">These apply to everyone using the app.</p></div></div>
    ${err && html`<p class="form-error">${err}</p>`}
    ${dis && html`<div class="banner">You have view-only access, so settings can’t be changed from this account.</div>`}
    <fieldset disabled=${dis} class="settings-grid">
      <section class="form-section">
        <h2>Business details</h2>
        <p class="muted">Shown on spec sheets.</p>
        <div class="fields">
          <label class="field"><span>Business name</span><input class="input" value=${s.businessName} onInput=${(e) => up('businessName', e.target.value)} /></label>
          <label class="field"><span>Tagline</span><input class="input" value=${s.tagline} onInput=${(e) => up('tagline', e.target.value)} /></label>
          <label class="field"><span>Phone</span><input class="input" value=${s.phone} onInput=${(e) => up('phone', e.target.value)} /></label>
          <label class="field"><span>Email</span><input class="input" type="email" value=${s.email} onInput=${(e) => up('email', e.target.value)} /></label>
          <label class="field"><span>Website</span><input class="input" value=${s.website} onInput=${(e) => up('website', e.target.value)} /></label>
          <label class="field"><span>Address</span><input class="input" value=${s.address} onInput=${(e) => up('address', e.target.value)} /></label>
          <label class="field span-2"><span>Spec sheet small print</span><textarea class="input" rows="2" value=${s.specSheetFooter} onInput=${(e) => up('specSheetFooter', e.target.value)}></textarea></label>
        </div>
      </section>

      <section class="form-section">
        <h2>Pricing</h2>
        <div class="fields">
          <label class="field"><span>Default markup on cost</span><div class="suffix"><input class="input" type="number" step="any" value=${s.defaultMarkup} onInput=${(e) => up('defaultMarkup', e.target.value)} /><span>%</span></div>
            <small class="muted">New costing lines start here. ${money(1000)} cost becomes ${money(1000 * (1 + num(s.defaultMarkup) / 100))}.</small></label>
          <label class="field"><span>Round selling prices up to</span><select class="input" value=${String(s.rounding)} onChange=${(e) => up('rounding', e.target.value)}>
            ${[['0', 'No rounding'], ['1', 'Nearest $1'], ['10', 'Nearest $10'], ['50', 'Nearest $50'], ['100', 'Nearest $100'], ['500', 'Nearest $500']].map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></label>
          <label class="field"><span>Flag designs for a price check after</span><div class="suffix"><input class="input" type="number" min="0" value=${s.priceReviewMonths} onInput=${(e) => up('priceReviewMonths', e.target.value)} /><span>months</span></div>
            <small class="muted">Set to 0 to turn this off.</small></label>
        </div>
      </section>

      <section class="form-section">
        <h2>Client mode</h2>
        <div class="fields">
          <label class="field"><span>PIN to leave client mode</span><input class="input" inputmode="numeric" maxlength="6" value=${s.clientPin} onInput=${(e) => up('clientPin', e.target.value.replace(/\D/g, ''))} />
            <small class="muted">4 to 6 digits. Leave blank to switch back without a PIN.${s.clientPin === '1234' ? ' 1234 is the starting PIN, so change it.' : ''}</small></label>
        </div>
      </section>

      <section class="form-section">
        <h2>Categories</h2>
        <p class="muted">Each category is a folder in the Catalog App folder. The code starts each design number, like SH-001.</p>
        <div class="table-scroll"><table class="table cat-table">
          <thead><tr><th>Name</th><th>One of them is a…</th><th>Code</th><th>Bedrooms and bathrooms</th><th><span class="sr">Actions</span></th></tr></thead>
          <tbody>${s.categories.map((c, i) => html`<tr key=${c.id || i}>
            <td><input class="input" value=${c.name} onInput=${(e) => upCat(i, 'name', e.target.value)} aria-label="Category name" /></td>
            <td><input class="input" value=${c.singular} placeholder=${c.name} onInput=${(e) => upCat(i, 'singular', e.target.value)} aria-label="Singular name" /></td>
            <td><input class="input code-in" value=${c.code} maxlength="5" onInput=${(e) => upCat(i, 'code', e.target.value.toUpperCase())} aria-label="Code" /></td>
            <td><label class="check"><input type="checkbox" checked=${c.residential} onChange=${(e) => upCat(i, 'residential', e.target.checked)} /> Show</label></td>
            <td class="nowrap"><button class="icon-btn" onClick=${() => moveCat(i, -1)} disabled=${i === 0} aria-label="Move up"><${Icon} name="up" /></button>
              <button class="icon-btn" onClick=${() => moveCat(i, 1)} disabled=${i === s.categories.length - 1} aria-label="Move down"><${Icon} name="down" /></button>
              <button class="icon-btn danger" onClick=${() => removeCat(i)} aria-label="Remove category"><${Icon} name="trash" /></button></td>
          </tr>`)}</tbody>
        </table></div>
        <button class="btn" onClick=${addCat}><${Icon} name="plus" /> Add category</button>
      </section>
    </fieldset>

    <section class="form-section">
      <h2>Google Drive</h2>
      <dl class="spec-table">
        <div><dt>Signed in as</dt><dd>${store.user?.name} (${store.user?.email})</dd></div>
        <div><dt>Access</dt><dd>${canEdit ? 'Can edit' : 'View only'}</dd></div>
        <div><dt>Folder</dt><dd>${isDemo ? 'Demo, kept in this browser tab only' : html`<a href=${store.rootLink} target="_blank" rel="noopener">${store.rootName} <${Icon} name="external" size=${14} /></a>`}</dd></div>
      </dl>
      <p class="muted small">To give someone access, share the Catalog App folder with their Gmail in Google Drive. Editors can change things; viewers can present the range but not edit it. Their Gmail also needs adding as a test user in Google Cloud.</p>
    </section>

    ${canEdit && html`<div class="savebar">
      <span></span>
      <div class="row-gap">${dirty && html`<span class="muted small">Unsaved changes</span>`}
        <button class="btn" disabled=${!dirty || busy} onClick=${() => { setS(clone(store.settings)); setDirty(false); }}>Discard</button>
        <button class="btn btn-primary" disabled=${!dirty || busy} onClick=${save}>${busy ? 'Saving…' : 'Save settings'}</button></div>
    </div>`}
  </div>`;
}

export function ArchiveView() {
  const { store, canEdit, run, confirm } = useApp();
  useStoreRev(store);
  const load = useAsync(() => store.loadArchive(true), []);
  const list = store.archivedBuilds().sort((a, b) => String(b.data.archived?.at || '').localeCompare(String(a.data.archived?.at || '')));
  const restore = async (e) => {
    const cat = store.cat(e.data.category) || store.settings.categories[0];
    if (await confirm({ title: `Restore ${e.data.name}?`, message: `It goes back into ${cat.name} with the same status it had before.`, confirmLabel: 'Restore' })) {
      await run(() => store.restoreBuild(e), 'Restored to the range');
    }
  };
  return html`<div class="page archive">
    <div class="page-head"><div><h1>Archive</h1><p class="muted">Retired designs. Nothing in here shows in the range or in client mode.</p></div></div>
    ${load.loading && !list.length && html`<${Spinner} label="Loading archive" />`}
    ${load.error && html`<${ErrorBox} error=${load.error} onRetry=${load.reload} />`}
    ${!load.loading && !list.length && html`<div class="empty"><p>The archive is empty.</p></div>`}
    <div class="grid">${list.map((e) => html`<div class="archived-card" key=${e.folderId}>
      <${DesignCard} entry=${e} />
      <div class="archived-foot">
        <small class="muted">${store.cat(e.data.category)?.name || ''}, archived ${fmtDate(e.data.archived?.at)}${e.data.archived?.by ? ` by ${e.data.archived.by}` : ''}</small>
        ${canEdit && html`<button class="btn btn-sm" onClick=${() => restore(e)}><${Icon} name="refresh" /> Restore</button>`}
      </div>
    </div>`)}</div>
  </div>`;
}
