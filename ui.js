import { html, createContext, useContext, useEffect, useRef, useState, useCallback } from 'htm/preact';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

// Re-render whenever the store changes
export function useStoreRev(store) {
  const [, set] = useState(0);
  useEffect(() => (store ? store.subscribe((r) => set(r)) : undefined), [store]);
}

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, error: null, value: undefined });
  const live = useRef(true);
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      (value) => live.current && setState({ loading: false, error: null, value }),
      (error) => { console.error(error); live.current && setState({ loading: false, error, value: undefined }); },
    );
  }, deps);
  useEffect(() => { live.current = true; run(); return () => { live.current = false; }; }, [run]);
  return { ...state, reload: run };
}

const P = {
  plus: 'M12 5v14M5 12h14', edit: 'M4 20h4L19 9l-4-4L4 16v4z M13.5 6.5l4 4', copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  print: 'M6 9V3h12v6 M6 18H4v-7h16v7h-2 M6 14h12v7H6z', archive: 'M3 4h18v4H3z M5 8v12h14V8 M10 12h4',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13', upload: 'M12 16V4 M7 9l5-5 5 5 M4 20h16', download: 'M12 4v12 M7 11l5 5 5-5 M4 20h16',
  external: 'M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6', lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3', unlock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 7.5-2',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13z M15.5 15.5L20 20', cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5',
  file: 'M6 3h8l4 4v14H6z M14 3v4h4', image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4', history: 'M4 12a8 8 0 1 0 2.3-5.6 M4 4v4h4 M12 8v4l3 2',
  settings: 'M4 6h9 M17 6h3 M4 12h3 M11 12h9 M4 18h11 M19 18h1 M15 4v4 M9 10v4 M17 16v4', x: 'M6 6l12 12 M18 6L6 18', check: 'M5 12l5 5 9-10',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', down: 'M5 9l7 7 7-7', up: 'M5 15l7-7 7 7',
  expand: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5', layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5', section: 'M3 12h18 M7 7l5-4 5 4 M7 17l5 4 5-4',
  fit: 'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M9 9h6v6H9z', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18 M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8 M6.6 7.6C3.8 9.4 2 12 2 12s4 7 10 7a9 9 0 0 0 4.4-1.1',
  alert: 'M12 4l9 16H3z M12 10v4 M12 17v.5', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  unlink: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1 M4 4l16 16',
  user: 'M12 4a4 4 0 1 0 0 8a4 4 0 0 0 0-8z M4 21c1-4 4-6 8-6s7 2 8 6', logout: 'M15 4h4v16h-4 M10 8l-4 4 4 4 M6 12h10',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7 M20 4v5h-5', star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  present: 'M3 4h18v12H3z M8 20h8 M12 16v4', list: 'M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01',
  folder: 'M3 6h6l2 2h10v11H3z', tagline: 'M4 6h16 M4 12h10 M4 18h7', percent: 'M19 5L5 19 M7 5a2 2 0 1 0 0 4a2 2 0 0 0 0-4z M17 15a2 2 0 1 0 0 4a2 2 0 0 0 0-4z',
};

export function Icon({ name, size = 18, stroke = 1.8, class: cls = '' }) {
  const d = P[name] || P.x;
  return html`<svg class=${`ic ${cls}`} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d.split(' M').map((seg, i) => html`<path d=${(i ? 'M' : '') + seg} />`)}</svg>`;
}

export function Spinner({ label = '' }) {
  return html`<div class="spinner-wrap" role="status"><span class="spinner"></span>${label && html`<span>${label}</span>`}</div>`;
}

export function ErrorBox({ error, onRetry }) {
  return html`<div class="error-box"><${Icon} name="alert" /><div><strong>Something went wrong</strong>
    <p>${error?.message || String(error)}</p>${onRetry && html`<button class="btn" onClick=${onRetry}>Try again</button>`}</div></div>`;
}

export function Modal({ title, onClose, children, footer, wide = false, size = '' }) {
  const ref = useRef();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.activeElement;
    setTimeout(() => ref.current?.querySelector('[autofocus], input, select, textarea, button.btn-primary')?.focus(), 30);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); prev?.focus?.(); };
  }, []);
  return html`<div class="modal-backdrop" onMouseDown=${(e) => e.target === e.currentTarget && onClose?.()}>
    <div class=${`modal ${wide ? 'modal-wide' : ''} ${size}`} role="dialog" aria-modal="true" aria-label=${title} ref=${ref}>
      <div class="modal-head"><h2>${title}</h2>${onClose && html`<button class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="x" /></button>`}</div>
      <div class="modal-body">${children}</div>
      ${footer && html`<div class="modal-foot">${footer}</div>`}
    </div></div>`;
}

export function ConfirmModal({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, extra = null, onResult }) {
  return html`<${Modal} title=${title} onClose=${() => onResult(false)} size="modal-sm"
    footer=${html`${extra}<button class="btn" onClick=${() => onResult(false)}>${cancelLabel}</button>
      <button class=${`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick=${() => onResult(true)}>${confirmLabel}</button>`}>
    <p class="confirm-msg">${message}</p></${Modal}>`;
}

export function PinPad({ title = 'Enter PIN to leave client mode', pin, onDone, onCancel }) {
  const [v, setV] = useState('');
  const [bad, setBad] = useState(false);
  const cur = useRef('');
  const target = String(pin);
  const press = (k) => {
    if (k === 'del') { cur.current = cur.current.slice(0, -1); setV(cur.current); return; }
    if (cur.current.length >= target.length) return;
    cur.current += k;
    setV(cur.current); setBad(false);
    if (cur.current.length === target.length) {
      if (cur.current === target) onDone();
      else { setBad(true); setTimeout(() => { cur.current = ''; setV(''); }, 350); }
    }
  };
  useEffect(() => {
    const onKey = (e) => { if (/^\d$/.test(e.key)) press(e.key); if (e.key === 'Backspace') press('del'); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return html`<${Modal} title=${title} onClose=${onCancel} size="modal-pin">
    <div class=${`pin-dots ${bad ? 'shake' : ''}`}>${Array.from({ length: target.length }, (_, i) => html`<span class=${i < v.length ? 'on' : ''}></span>`)}</div>
    ${bad && html`<p class="pin-bad">That PIN didn’t match</p>`}
    <div class="pin-grid">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) => (k === ''
      ? html`<span></span>`
      : html`<button class="pin-key" onClick=${() => press(k)} aria-label=${k === 'del' ? 'Delete' : k}>${k === 'del' ? html`<${Icon} name="left" />` : k}</button>`))}</div>
  </${Modal}>`;
}

export function Toasts({ items, dismiss }) {
  return html`<div class="toasts" aria-live="polite">${items.map((t) => html`<div class=${`toast toast-${t.kind}`} key=${t.id}>
    <${Icon} name=${t.kind === 'error' ? 'alert' : 'check'} /><span>${t.text}</span>
    <button class="icon-btn" onClick=${() => dismiss(t.id)} aria-label="Dismiss"><${Icon} name="x" size=${16} /></button></div>`)}</div>`;
}

export function BlobImg({ fileId, alt = '', class: cls = '', fallback = null, onLoad }) {
  const { store } = useApp();
  const ver = store.fileVer.get(fileId) || 0;
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    if (!fileId) { setUrl(null); return; }
    store.getUrl(fileId).then((u) => live && setUrl(u), () => live && setFailed(true));
    return () => { live = false; };
  }, [fileId, ver]);
  if (!fileId || failed) return fallback;
  if (!url) return html`<div class=${`img-loading ${cls}`}></div>`;
  return html`<img class=${cls} src=${url} alt=${alt} onLoad=${onLoad} draggable="false" />`;
}

export function Watermark({ size = 'md' }) {
  return html`<img class=${`watermark wm-${size}`} src="logo.png" alt="" aria-hidden="true" draggable="false" />`;
}

export function Placeholder({ label = '' }) {
  return html`<div class="placeholder"><svg viewBox="0 0 120 70" aria-hidden="true"><polyline points="10,34 60,8 110,34" fill="none" stroke="currentColor" stroke-width="4"/><rect x="24" y="34" width="72" height="30" fill="none" stroke="currentColor" stroke-width="3"/></svg>${label && html`<span>${label}</span>`}</div>`;
}

export function FileDrop({ onFiles, accept = '', multiple = true, label = 'Drop files here or choose files', hint = '' }) {
  const [over, setOver] = useState(false);
  const input = useRef();
  return html`<div class=${`drop ${over ? 'over' : ''}`}
    onDragOver=${(e) => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
    onDrop=${(e) => { e.preventDefault(); setOver(false); const f = [...e.dataTransfer.files]; if (f.length) onFiles(multiple ? f : f.slice(0, 1)); }}>
    <${Icon} name="upload" size=${22} />
    <div><button type="button" class="link-btn" onClick=${() => input.current.click()}>${label}</button>${hint && html`<small>${hint}</small>`}</div>
    <input ref=${input} type="file" hidden accept=${accept} multiple=${multiple}
      onChange=${(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onFiles(f); }} />
  </div>`;
}

export function UploadList({ items }) {
  if (!items.length) return null;
  return html`<ul class="upload-list">${items.map((u) => html`<li key=${u.id} class=${u.error ? 'err' : ''}>
    <span class="upl-name">${u.name}</span>
    ${u.error ? html`<span class="upl-err">${u.error}</span>` : html`<span class="bar"><span style=${`width:${Math.round(u.progress * 100)}%`}></span></span>`}
  </li>`)}</ul>`;
}

// ── formatting ─────────────────────────────────────────────────
const dFmt = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' });
const dtFmt = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const fmtDate = (d) => (d ? dFmt.format(new Date(d)) : '');
export const fmtDateTime = (d) => (d ? dtFmt.format(new Date(d)) : '');
export function timeAgo(d) {
  if (!d) return '';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} days ago`;
  return fmtDate(d);
}
export function fileSize(b) {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
export const fmtNum = (v, dp = 2) => {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 10 ** dp) / 10 ** dp);
};

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export const sizeLabel = (specs) => {
  const L = parseFloat(specs?.length), W = parseFloat(specs?.width);
  return Number.isFinite(L) && Number.isFinite(W) ? `${fmtNum(L, 2)} × ${fmtNum(W, 2)} m` : '';
};
export const floorArea = (specs) => {
  const fa = parseFloat(specs?.floorArea);
  if (Number.isFinite(fa)) return fa;
  const L = parseFloat(specs?.length), W = parseFloat(specs?.width);
  return Number.isFinite(L) && Number.isFinite(W) ? Math.round(L * W * 100) / 100 : null;
};
