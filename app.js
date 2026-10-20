import { html, render, useState, useEffect, useRef, useCallback } from 'htm/preact';
import config from './config.js';
import { GoogleDrive } from './drive.js';
import { MockDrive, seedDemo } from './mockdrive.js';
import { Store } from './store.js';
import { AppCtx, Icon, Spinner, ConfirmModal, PinPad, Toasts, Modal, useStoreRev } from './ui.js';
import { RangeView } from './range.js';
import { DesignView } from './design.js';
import { EditorView } from './editor.js';
import { PricesView } from './prices.js';
import { SettingsView, ArchiveView } from './settings.js';
import { PrintView } from './print.js';

const isDemo = new URLSearchParams(location.search).has('demo');
document.title = config.APP_TITLE || 'Range';

const parseRoute = (hash) => {
  const parts = (hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || '', args: parts.slice(1) };
};
const rootIdFromConfig = () => config.CATALOG_FOLDER_ID || localStorage.getItem('chr.rootId') || '';
const parseFolderId = (s) => {
  const t = String(s || '').trim();
  const m = t.match(/folders\/([\w-]{10,})/) || t.match(/[?&]id=([\w-]{10,})/);
  return m ? m[1] : (/^[\w-]{10,}$/.test(t) ? t : '');
};

// ── screens before the app is ready ─────────────────────────────
function Splash({ children, wide = false }) {
  return html`<div class="splash"><div class=${`splash-card ${wide ? 'wide' : ''}`}>
    <img class="splash-logo" src="logo.png" alt="CH Engineering, Steel Framed Homes" />${children}</div></div>`;
}

function NeedConfig() {
  return html`<${Splash} wide>
    <h1>Almost there</h1>
    <p>This copy of the app doesn’t have a Google client ID yet. Add it to <code>config.js</code> and reload. The README walks through the Google Cloud steps.</p>
    <p><a class="btn btn-primary" href="?demo">Try the demo first</a></p>
    <p class="muted small">The demo runs in your browser only. Nothing is saved.</p>
  </${Splash}>`;
}

function SignIn({ onSignIn, error, busy }) {
  return html`<${Splash}>
    <h1>Sign in to view the range</h1>
    <p>Use the Google account the Catalog App folder is shared with.</p>
    ${error && html`<p class="form-error">${error}</p>`}
    <button class="btn btn-primary btn-lg btn-block" onClick=${onSignIn} disabled=${busy}>
      ${busy ? html`<span class="spinner sm"></span> Signing in` : 'Sign in with Google'}</button>
  </${Splash}>`;
}

function Setup({ drive, onReady }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [created, setCreated] = useState(null);
  const create = async () => {
    setBusy(true); setErr('');
    try {
      const f = await Store.createRootFolder(drive);
      localStorage.setItem('chr.rootId', f.id);
      setCreated(f.id);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const useExisting = () => {
    const id = parseFolderId(link);
    if (!id) return setErr('Paste the folder’s Drive link, or just the ID at the end of it.');
    localStorage.setItem('chr.rootId', id);
    onReady(id);
  };
  if (created) {
    return html`<${Splash} wide>
      <h1>Catalog App folder created</h1>
      <p>It’s in your Google Drive now. So everyone uses the same folder automatically, paste this ID into <code>CATALOG_FOLDER_ID</code> in <code>config.js</code> and push it to GitHub:</p>
      <div class="copy-field"><code>${created}</code><button class="btn" onClick=${() => navigator.clipboard?.writeText(created)}>Copy</button></div>
      <p>Then share the folder with your team as <strong>Editor</strong> (or <strong>Viewer</strong> for people who only present).</p>
      <div class="row-gap"><a class="btn" href=${drive.folderLink(created)} target="_blank" rel="noopener">Open folder in Drive</a>
        <button class="btn btn-primary" onClick=${() => onReady(created)}>Continue to the app</button></div>
    </${Splash}>`;
  }
  return html`<${Splash} wide>
    <h1>Connect the Catalog App folder</h1>
    <p>Everything the app saves lives in one Drive folder. Create a new one, or point the app at the folder someone has shared with you.</p>
    ${err && html`<p class="form-error">${err}</p>`}
    <div class="setup-options">
      <div class="setup-opt"><h3>Start fresh</h3><p>Creates “Catalog App” in your My Drive with all the sub-folders.</p>
        <button class="btn btn-primary" onClick=${create} disabled=${busy}>${busy ? 'Creating…' : 'Create the folder'}</button></div>
      <div class="setup-opt"><h3>Use an existing folder</h3>
        <input class="input" placeholder="Paste the Drive folder link" value=${link} onInput=${(e) => setLink(e.target.value)} />
        <button class="btn" onClick=${useExisting}>Use this folder</button></div>
    </div>
  </${Splash}>`;
}

function BootError({ error, drive, onRetry, onChangeFolder, onSwitchAccount }) {
  const email = drive?.user?.email;
  return html`<${Splash} wide>
    <h1>Can’t open the range</h1>
    <p class="form-error">${error.message}</p>
    ${error.code === 'noaccess' && html`<p>Ask the folder owner to share the Catalog App folder with ${email ? html`<strong>${email}</strong>` : 'your Google account'}, then try again.</p>`}
    <div class="row-gap">
      <button class="btn btn-primary" onClick=${onRetry}>Try again</button>
      ${!config.CATALOG_FOLDER_ID && html`<button class="btn" onClick=${onChangeFolder}>Use a different folder</button>`}
      <button class="btn" onClick=${onSwitchAccount}>Switch Google account</button>
    </div>
  </${Splash}>`;
}

// ── main app ─────────────────────────────────────────────────────
function Root() {
  const [phase, setPhase] = useState('init');
  const [error, setError] = useState(null);
  const [signErr, setSignErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [store, setStore] = useState(null);
  const [reauth, setReauth] = useState(null);
  const driveRef = useRef(null);

  const boot = useCallback(async (rootId) => {
    const d = driveRef.current;
    setPhase('booting'); setError(null);
    const s = new Store(d, rootId);
    try {
      await s.boot();
      if (d.isDemo && !s.priceList.items.length) await seedDemo(s);
      setStore(s); setPhase('ready');
    } catch (e) {
      console.error(e);
      setError(e); setPhase('error');
    }
  }, []);

  const afterSignIn = useCallback(async () => {
    const id = rootIdFromConfig();
    if (!id) { try { await driveRef.current.getUser(); } catch (e) { /* ignore */ } setPhase('setup'); return; }
    await boot(id);
  }, [boot]);

  useEffect(() => {
    (async () => {
      if (isDemo) { const d = new MockDrive(); driveRef.current = d; await boot(d.rootId); return; }
      if (!config.GOOGLE_CLIENT_ID) { setPhase('needConfig'); return; }
      const d = new GoogleDrive(config.GOOGLE_CLIENT_ID);
      driveRef.current = d;
      d.onAuthExpired = () => new Promise((resolve, reject) => setReauth({ resolve, reject }));
      if (d.restoreSession()) await afterSignIn();
      else setPhase('signin');
    })();
  }, []);

  const signIn = async (prompt = '') => {
    setBusy(true); setSignErr('');
    try { await driveRef.current.signIn(prompt); await afterSignIn(); } catch (e) { setSignErr(e.message); } finally { setBusy(false); }
  };

  const reauthModal = reauth && html`<${Modal} title="Your Google session timed out" size="modal-sm"
    footer=${html`<button class="btn" onClick=${() => { reauth.reject(new Error('Sign in again to keep working.')); setReauth(null); }}>Not now</button>
      <button class="btn btn-primary" onClick=${async () => {
        try { await driveRef.current.signIn(''); reauth.resolve(); setReauth(null); } catch (e) { /* keep modal open */ }
      }}>Sign in again</button>`}>
    <p>For security, Google sign-ins last about an hour. Sign in again and the app will carry on from where it was.</p>
  </${Modal}>`;

  let body;
  if (phase === 'init' || phase === 'booting') body = html`<div class="boot"><img src="logo.png" alt="" /><${Spinner} label=${phase === 'booting' ? 'Loading the range' : ''} /></div>`;
  else if (phase === 'needConfig') body = html`<${NeedConfig} />`;
  else if (phase === 'signin') body = html`<${SignIn} onSignIn=${() => signIn('')} error=${signErr} busy=${busy} />`;
  else if (phase === 'setup') body = html`<${Setup} drive=${driveRef.current} onReady=${boot} />`;
  else if (phase === 'error') body = html`<${BootError} error=${error} drive=${driveRef.current}
    onRetry=${() => boot(rootIdFromConfig())}
    onChangeFolder=${() => { localStorage.removeItem('chr.rootId'); setPhase('setup'); }}
    onSwitchAccount=${() => { driveRef.current.signOut(); localStorage.removeItem('chr.lastEmail'); setPhase('signin'); signIn('select_account'); }} />`;
  else body = html`<${App} store=${store} drive=${driveRef.current}
    onSignOut=${() => { driveRef.current.signOut(); setStore(null); setPhase('signin'); }} />`;
  return html`${body}${reauthModal}`;
}

function App({ store, drive, onSignOut }) {
  useStoreRev(store);
  const [hash, setHash] = useState(location.hash || '#/');
  const [mode, setModeState] = useState(() => sessionStorage.getItem('chr.mode') || 'edit');
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [pin, setPin] = useState(false);
  const [menu, setMenu] = useState(false);
  const guard = useRef(null);
  const lastHash = useRef(location.hash || '#/');

  useEffect(() => {
    const onHash = () => {
      const next = location.hash || '#/';
      if (guard.current && next !== lastHash.current) {
        if (!window.confirm('You have unsaved changes. Leave without saving?')) {
          history.replaceState(null, '', lastHash.current);
          return;
        }
        guard.current = null;
      }
      lastHash.current = next;
      setHash(next);
      window.scrollTo(0, 0);
      setMenu(false);
    };
    window.addEventListener('hashchange', onHash);
    const onUnload = (e) => { if (guard.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('beforeunload', onUnload); };
  }, []);

  const toast = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  const confirm = useCallback((opts) => new Promise((resolve) => setConfirmState({ ...opts, resolve })), []);

  const nav = useCallback(async (to, { replace = false } = {}) => {
    if (guard.current) {
      const ok = await confirm({ title: 'Leave without saving?', message: 'You have unsaved changes on this page.', confirmLabel: 'Leave without saving', danger: true });
      if (!ok) return;
      guard.current = null;
    }
    if (replace) { history.replaceState(null, '', to); lastHash.current = to; setHash(to); window.scrollTo(0, 0); }
    else location.hash = to;
  }, [confirm]);

  const run = useCallback(async (fn, okMsg) => {
    try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { console.error(e); toast(e.message || String(e), 'error'); return undefined; }
  }, [toast]);

  const setMode = (m) => { sessionStorage.setItem('chr.mode', m); setModeState(m); };
  const isClient = mode === 'client';
  const settings = store.settings;
  const canEdit = store.canEdit;

  const enterClient = () => { setMode('client'); };
  const exitClient = () => { if (!settings.clientPin) setMode('edit'); else setPin(true); };

  const route = parseRoute(hash);
  const lastCat = localStorage.getItem('chr.lastCat');
  const firstCat = (store.cat(lastCat) || settings.categories[0])?.id;
  const clientAllowed = ['', 'c', 'b', 'print'];

  // Redirects
  useEffect(() => {
    if (!route.name) nav(`#/c/${firstCat}`, { replace: true });
    else if (isClient && !clientAllowed.includes(route.name)) nav(`#/c/${firstCat}`, { replace: true });
    else if (!canEdit && ['edit', 'new'].includes(route.name)) nav(`#/c/${firstCat}`, { replace: true });
  }, [hash, isClient]);

  const ctx = {
    store, drive, settings, mode, isClient, canEdit, isDemo: !!drive.isDemo, nav, toast, confirm, run,
    setGuard: (fn) => { guard.current = fn; },
  };

  let view = null;
  const [a0, a1] = route.args;
  switch (route.name) {
    case 'c': view = html`<${RangeView} catId=${a0} key=${a0} />`; break;
    case 'b': view = html`<${DesignView} id=${a0} tab=${a1} key=${a0} />`; break;
    case 'edit': view = html`<${EditorView} id=${a0} key=${'e' + a0} />`; break;
    case 'new': view = html`<${EditorView} newCat=${a0} key=${'n' + a0} />`; break;
    case 'prices': view = html`<${PricesView} tab=${a0 || 'items'} />`; break;
    case 'settings': view = html`<${SettingsView} />`; break;
    case 'archive': view = html`<${ArchiveView} />`; break;
    case 'print': view = html`<${PrintView} id=${a0} key=${a0} />`; break;
    default: view = null;
  }
  const navLink = (href, label, active) => html`<a href=${href} class=${active ? 'active' : ''} aria-current=${active ? 'page' : undefined}>${label}</a>`;
  const isPrint = route.name === 'print';
  const initials = (store.user?.name || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();

  return html`<${AppCtx.Provider} value=${ctx}>
    <div class=${`app ${isClient ? 'is-client' : 'is-edit'} ${isPrint ? 'is-print' : ''}`}>
      ${!isPrint && html`<header class="topbar">
        <a class="brand" href=${`#/c/${firstCat}`} aria-label="Back to the range"><img src="logo.png" alt=${`${settings.businessName}, ${settings.tagline}`} /></a>
        ${!isClient && html`<nav class="mainnav" aria-label="Main">
          ${navLink(`#/c/${firstCat}`, 'Range', ['c', 'b', 'edit', 'new'].includes(route.name))}
          ${navLink('#/prices', 'Price list', route.name === 'prices')}
          ${navLink('#/archive', 'Archive', route.name === 'archive')}
          ${navLink('#/settings', 'Settings', route.name === 'settings')}
        </nav>`}
        <div class="top-actions">
          ${ctx.isDemo && !isClient && html`<span class="pill pill-demo" title="Demo mode keeps everything in this browser tab only">Demo</span>`}
          ${!canEdit && !isClient && html`<span class="pill" title="Your Google account has view-only access to the folder">View only</span>`}
          ${isClient
            ? html`<button class="icon-btn subtle" onClick=${exitClient} aria-label="Leave client mode" title="Leave client mode"><${Icon} name="lock" /></button>`
            : html`<button class="btn btn-ink" onClick=${enterClient}><${Icon} name="present" /> <span class="hide-sm">Client mode</span></button>
              <div class="usermenu">
                <button class="avatar" onClick=${() => setMenu(!menu)} aria-label="Account" aria-expanded=${menu}>${initials}</button>
                ${menu && html`<div class="menu" onMouseLeave=${() => setMenu(false)}>
                  <div class="menu-head"><strong>${store.user?.name}</strong><span>${store.user?.email}</span></div>
                  ${!ctx.isDemo && html`<a class="menu-item" href=${store.rootLink || '#'} target="_blank" rel="noopener"><${Icon} name="folder" /> Open Catalog App in Drive</a>`}
                  <button class="menu-item" onClick=${() => { setMenu(false); onSignOut(); }}><${Icon} name="logout" /> Sign out</button>
                </div>`}
              </div>`}
        </div>
      </header>`}
      <main class="main">${view}</main>
      <${Toasts} items=${toasts} dismiss=${(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
      ${confirmState && html`<${ConfirmModal} ...${confirmState} onResult=${(r) => { confirmState.resolve(r); setConfirmState(null); }} />`}
      ${pin && html`<${PinPad} pin=${settings.clientPin} onCancel=${() => setPin(false)} onDone=${() => { setPin(false); setMode('edit'); }} />`}
    </div>
  </${AppCtx.Provider}>`;
}

render(html`<${Root} />`, document.getElementById('root'));
