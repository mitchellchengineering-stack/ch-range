// PDF plans are drawn with pdf.js so they display the same on laptops, iPads and phones.
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let libPromise = null;

export function loadPdfLib() {
  if (!libPromise) {
    libPromise = new Promise((resolve, reject) => {
      if (window.pdfjsLib) return resolve(window.pdfjsLib);
      const s = document.createElement('script');
      s.src = PDFJS;
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER; resolve(window.pdfjsLib); };
      s.onerror = () => { libPromise = null; reject(new Error('Could not load the PDF viewer. Check the internet connection.')); };
      document.head.appendChild(s);
    });
  }
  return libPromise;
}

export async function openPdf(blob) {
  const lib = await loadPdfLib();
  const data = new Uint8Array(await blob.arrayBuffer());
  return lib.getDocument({ data }).promise;
}

export async function renderPage(doc, pageNo, canvas, cssWidth) {
  const page = await doc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = cssWidth / base.width;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const vp = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
  canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
  const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
  await task.promise;
  return task;
}

export async function firstPageImage(blob, width = 1400) {
  const doc = await openPdf(blob);
  const c = document.createElement('canvas');
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: width / base.width });
  c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  doc.destroy();
  return c.toDataURL('image/jpeg', 0.9);
}
