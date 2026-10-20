// Google Drive backend. Signs in with Google Identity Services (token flow) and talks to the Drive v3 REST API.
// Everything the app stores is a normal Drive file inside the Catalog App folder.

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER = 'application/vnd.google-apps.folder';
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,createdTime,size,version,webViewLink,parents,fileExtension,lastModifyingUser(displayName,emailAddress),owners(displayName,emailAddress)';
const TOKEN_KEY = 'chr.token';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in. Check the internet connection and try again.'));
    document.head.appendChild(s);
  });
}

const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class GoogleDrive {
  constructor(clientId) {
    this.clientId = clientId;
    this.token = null;
    this.user = null;
    this.onAuthExpired = null; // set by the app: () => Promise that resolves after the user signs in again
    this.isDemo = false;
  }

  restoreSession() {
    try {
      const s = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null');
      if (s && s.exp > Date.now() + 60_000) { this.token = s.token; return true; }
    } catch (e) { /* ignore */ }
    return false;
  }

  async signIn(prompt = '') {
    await loadScript('https://accounts.google.com/gsi/client');
    const hint = localStorage.getItem('chr.lastEmail') || undefined;
    await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: SCOPE,
        login_hint: hint,
        callback: (r) => {
          if (r.error) return reject(new Error(r.error_description || r.error));
          this.token = r.access_token;
          try {
            sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 }));
          } catch (e) { /* ignore */ }
          resolve();
        },
        error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'Sign-in window was closed before finishing.' : (e?.message || 'Sign-in did not complete.'))),
      });
      client.requestAccessToken({ prompt });
    });
  }

  signOut() {
    try { if (this.token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(this.token, () => {}); } catch (e) { /* ignore */ }
    this.token = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }

  async _reauth() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
    if (!this.onAuthExpired) throw new Error('Your Google session has expired. Refresh the page to sign in again.');
    await this.onAuthExpired();
  }

  async req(url, opts = {}, attempt = 0) {
    const headers = { ...(opts.headers || {}), Authorization: `Bearer ${this.token}` };
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401 && attempt < 2) {
      await this._reauth();
      return this.req(url, opts, attempt + 1);
    }
    if ((res.status === 429 || res.status === 403 || res.status >= 500) && attempt < 4) {
      let reason = '';
      if (res.status === 403) {
        try { reason = (await res.clone().json())?.error?.errors?.[0]?.reason || ''; } catch (e) { /* ignore */ }
      }
      if (res.status !== 403 || /rateLimit/i.test(reason)) {
        await new Promise((r) => setTimeout(r, 600 * 2 ** attempt + Math.random() * 300));
        return this.req(url, opts, attempt + 1);
      }
    }
    if (!res.ok) {
      let msg = `Google Drive returned ${res.status}`;
      try { const j = await res.json(); msg = j?.error?.message || msg; } catch (e) { /* ignore */ }
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return res;
  }

  async getJSON(url) { return (await this.req(url)).json(); }

  // ── identity & permissions ─────────────────────────────────
  async getUser() {
    const j = await this.getJSON(`${API}/about?fields=user(displayName,emailAddress,photoLink)`);
    this.user = { name: j.user.displayName, email: j.user.emailAddress, photo: j.user.photoLink };
    try { localStorage.setItem('chr.lastEmail', this.user.email); } catch (e) { /* ignore */ }
    return this.user;
  }

  async getFile(id, fields = FILE_FIELDS) {
    return this.getJSON(`${API}/files/${id}?fields=${encodeURIComponent(fields)}&supportsAllDrives=true`);
  }

  async getFolderAccess(id) {
    const f = await this.getFile(id, 'id,name,mimeType,trashed,webViewLink,capabilities(canEdit,canAddChildren)');
    return { id: f.id, name: f.name, isFolder: f.mimeType === FOLDER, trashed: f.trashed, link: f.webViewLink,
      canEdit: !!(f.capabilities?.canEdit && f.capabilities?.canAddChildren) };
  }

  // ── listing ────────────────────────────────────────────────
  async query(qs, fields = FILE_FIELDS, orderBy = 'name') {
    const out = [];
    let pageToken = '';
    do {
      const url = `${API}/files?q=${encodeURIComponent(qs)}&fields=${encodeURIComponent(`nextPageToken,files(${fields})`)}`
        + `&pageSize=1000&orderBy=${encodeURIComponent(orderBy)}&supportsAllDrives=true&includeItemsFromAllDrives=true`
        + (pageToken ? `&pageToken=${pageToken}` : '');
      const j = await this.getJSON(url);
      out.push(...(j.files || []));
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  list(parentId, { foldersOnly = false, filesOnly = false } = {}) {
    let qs = `'${q(parentId)}' in parents and trashed=false`;
    if (foldersOnly) qs += ` and mimeType='${FOLDER}'`;
    if (filesOnly) qs += ` and mimeType!='${FOLDER}'`;
    return this.query(qs);
  }

  // Find files with given names inside any of the given parents (batched to keep queries short)
  async findNamedInParents(parentIds, names) {
    const out = [];
    const nameQ = names.map((n) => `name='${q(n)}'`).join(' or ');
    for (let i = 0; i < parentIds.length; i += 30) {
      const chunk = parentIds.slice(i, i + 30);
      const parentQ = chunk.map((p) => `'${q(p)}' in parents`).join(' or ');
      out.push(...await this.query(`(${parentQ}) and (${nameQ}) and trashed=false`));
    }
    return out;
  }

  async findChild(parentId, name, folder = null) {
    let qs = `'${q(parentId)}' in parents and name='${q(name)}' and trashed=false`;
    if (folder === true) qs += ` and mimeType='${FOLDER}'`;
    const r = await this.query(qs);
    return r[0] || null;
  }

  // ── writing ────────────────────────────────────────────────
  async createFolder(parentId, name) {
    const res = await this.req(`${API}/files?fields=${encodeURIComponent(FILE_FIELDS)}&supportsAllDrives=true`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: parentId ? [parentId] : undefined }),
    });
    return res.json();
  }

  async ensureFolder(parentId, name) {
    return (await this.findChild(parentId, name, true)) || this.createFolder(parentId, name);
  }

  async readJSON(fileId) {
    const meta = await this.getFile(fileId, 'id,version,modifiedTime,lastModifyingUser(displayName)');
    const res = await this.req(`${API}/files/${fileId}?alt=media&supportsAllDrives=true`);
    const text = await res.text();
    return { data: text ? JSON.parse(text) : null, version: meta.version, meta };
  }

  async writeJSON(parentId, name, data, fileId = null) {
    const body = JSON.stringify(data, null, 2);
    if (fileId) {
      const res = await this.req(`${UPLOAD}/files/${fileId}?uploadType=media&fields=${encodeURIComponent(FILE_FIELDS)}&supportsAllDrives=true`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
      });
      return res.json();
    }
    return this._multipart({ name, parents: [parentId], mimeType: 'application/json' }, new Blob([body], { type: 'application/json' }));
  }

  _xhr(method, url, body, headers, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(method, url);
      x.setRequestHeader('Authorization', `Bearer ${this.token}`);
      Object.entries(headers || {}).forEach(([k, v]) => x.setRequestHeader(k, v));
      if (onProgress && x.upload) x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) {
          try { resolve(JSON.parse(x.responseText || '{}')); } catch (e) { resolve({}); }
        } else {
          let msg = `Upload failed (${x.status})`;
          try { msg = JSON.parse(x.responseText)?.error?.message || msg; } catch (e) { /* ignore */ }
          const err = new Error(msg); err.status = x.status; reject(err);
        }
      };
      x.onerror = () => reject(new Error('Upload failed. Check the internet connection and try again.'));
      x.send(body);
    });
  }

  async _multipart(meta, blob, onProgress, attempt = 0) {
    const boundary = 'chr' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
      blob, `\r\n--${boundary}--`,
    ]);
    try {
      return await this._xhr('POST', `${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`,
        body, { 'Content-Type': `multipart/related; boundary=${boundary}` }, onProgress);
    } catch (e) {
      if (e.status === 401 && attempt < 1) { await this._reauth(); return this._multipart(meta, blob, onProgress, attempt + 1); }
      throw e;
    }
  }

  async upload(parentId, file, onProgress, name = null) {
    const meta = { name: name || file.name, parents: [parentId] };
    if (file.size <= 5 * 1024 * 1024) return this._multipart(meta, file, onProgress);
    // Large files (IFC models, big plan sets): resumable upload
    const init = await this.req(`${UPLOAD}/files?uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': file.type || 'application/octet-stream', 'X-Upload-Content-Length': String(file.size) },
      body: JSON.stringify(meta),
    });
    const location = init.headers.get('Location');
    if (!location) return this._multipart(meta, file, onProgress);
    return this._xhr('PUT', location, file, { 'Content-Type': file.type || 'application/octet-stream' }, onProgress);
  }

  async replaceContent(fileId, blob) {
    const res = await this.req(`${UPLOAD}/files/${fileId}?uploadType=media&supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`, {
      method: 'PATCH', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
    });
    return res.json();
  }

  async download(fileId) {
    const res = await this.req(`${API}/files/${fileId}?alt=media&supportsAllDrives=true`);
    return res.blob();
  }

  async rename(fileId, name) {
    const res = await this.req(`${API}/files/${fileId}?supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    return res.json();
  }

  async move(fileId, toParent, fromParent) {
    const res = await this.req(`${API}/files/${fileId}?addParents=${toParent}&removeParents=${fromParent}&supportsAllDrives=true&fields=id,parents`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    return res.json();
  }

  async trash(fileId) {
    await this.req(`${API}/files/${fileId}?supportsAllDrives=true`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
    });
  }

  async copy(fileId, parentId, name) {
    const res = await this.req(`${API}/files/${fileId}/copy?supportsAllDrives=true&fields=${encodeURIComponent(FILE_FIELDS)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parents: [parentId], name }),
    });
    return res.json();
  }

  folderLink(id) { return `https://drive.google.com/drive/folders/${id}`; }
  fileLink(id) { return `https://drive.google.com/file/d/${id}/view`; }
}

export const FOLDER_MIME = FOLDER;
