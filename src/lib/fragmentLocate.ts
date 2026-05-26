// Експеримент: відновлення hi-res фрагментів справ зі старих експортів, де збережено
// лише низькоякісну картинку (fragmentImage), але немає координат (boundingBox).
//
// Ідея: знайти, де саме на сторінці був фрагмент, методом template-matching
// (нормалізована крос-кореляція, NCC) на зменшеній копії сторінки, потім вирізати
// цю ділянку з hi-res рендеру оригінального PDF.
//
// Обмеження: працює добре, коли фрагмент справді з цієї сторінки і контент чіткий.
// score (NCC, [-1..1]) — оцінка впевненості; низький score = ненадійний збіг.
import * as pdfjs from 'pdfjs-dist';

export interface LocateResult {
  dataUrl: string; // hi-res перекроп (JPEG)
  score: number; // найкраща NCC у [-1..1]
  norm: { x: number; y: number; w: number; h: number }; // нормалізований bbox 0..1
}

export interface PageRender {
  searchGray: Float32Array;
  sw: number;
  sh: number;
  hiCanvas: HTMLCanvasElement;
  hiW: number;
  hiH: number;
  vp15W: number;
  vp15H: number;
}

async function renderToCanvas(page: pdfjs.PDFPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport: vp } as any).promise;
  return canvas;
}

function grayOf(canvas: HTMLCanvasElement): Float32Array {
  const ctx = canvas.getContext('2d')!;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const n = canvas.width * canvas.height;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return g;
}

// Готуємо рендери сторінки один раз (перевикористовуємо для всіх фрагментів сторінки).
export async function preparePage(
  page: pdfjs.PDFPageProxy,
  searchH = 380,
  hiScale = 3.0
): Promise<PageRender> {
  const vp1 = page.getViewport({ scale: 1 });
  const vp15 = page.getViewport({ scale: 1.5 });
  const searchScale = searchH / vp1.height;
  const [searchCanvas, hiCanvas] = await Promise.all([
    renderToCanvas(page, searchScale),
    renderToCanvas(page, hiScale),
  ]);
  return {
    searchGray: grayOf(searchCanvas),
    sw: searchCanvas.width,
    sh: searchCanvas.height,
    hiCanvas,
    hiW: hiCanvas.width,
    hiH: hiCanvas.height,
    vp15W: vp15.width,
    vp15H: vp15.height,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Шаблон: фрагмент, зменшений до очікуваного розміру на search-сторінці, у grayscale.
function templateGray(img: HTMLImageElement, tw: number, th: number): Float32Array {
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, tw, th);
  return grayOf(c);
}

export async function locate(pr: PageRender, fragDataUrl: string): Promise<LocateResult> {
  const img = await loadImage(fragDataUrl);
  // Розмір фрагмента відносно сторінки (фрагмент збережено в scale 1.5).
  const relW = Math.min(1, img.naturalWidth / pr.vp15W);
  const relH = Math.min(1, img.naturalHeight / pr.vp15H);

  const { searchGray: I, sw: W, sh: H } = pr;
  let tw = Math.max(4, Math.round(relW * W));
  let th = Math.max(4, Math.round(relH * H));
  tw = Math.min(tw, W);
  th = Math.min(th, H);

  const T = templateGray(img, tw, th);
  // Центруємо шаблон (Tc = T - meanT), рахуємо нормування.
  let meanT = 0;
  for (let i = 0; i < T.length; i++) meanT += T[i];
  meanT /= T.length;
  const Tc = new Float32Array(T.length);
  let normT = 0;
  for (let i = 0; i < T.length; i++) {
    Tc[i] = T[i] - meanT;
    normT += Tc[i] * Tc[i];
  }
  normT = Math.sqrt(normT) || 1e-6;

  // Інтегральні зображення для швидкого середнього/дисперсії вікна.
  const ii = new Float64Array((W + 1) * (H + 1));
  const ii2 = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let rs = 0;
    let rs2 = 0;
    for (let x = 0; x < W; x++) {
      const v = I[y * W + x];
      rs += v;
      rs2 += v * v;
      ii[(y + 1) * (W + 1) + (x + 1)] = ii[y * (W + 1) + (x + 1)] + rs;
      ii2[(y + 1) * (W + 1) + (x + 1)] = ii2[y * (W + 1) + (x + 1)] + rs2;
    }
  }
  const rect = (S: Float64Array, x: number, y: number, w: number, h: number) =>
    S[(y + h) * (W + 1) + (x + w)] - S[y * (W + 1) + (x + w)] - S[(y + h) * (W + 1) + x] + S[y * (W + 1) + x];

  const area = tw * th;
  const maxX = W - tw;
  const maxY = H - th;

  // Адаптивний крок: грубий пошук, потім уточнення біля найкращого.
  const coarse = Math.max(1, Math.round(Math.sqrt(((maxX + 1) * (maxY + 1)) / 2500)));

  let best = -Infinity;
  let bx = 0;
  let by = 0;

  const evalAt = (x: number, y: number) => {
    // dot(I_window, Tc)
    let dot = 0;
    for (let j = 0; j < th; j++) {
      const rowI = (y + j) * W + x;
      const rowT = j * tw;
      for (let i = 0; i < tw; i++) dot += I[rowI + i] * Tc[rowT + i];
    }
    const sum = rect(ii, x, y, tw, th);
    const sum2 = rect(ii2, x, y, tw, th);
    const varI = Math.max(1e-6, sum2 - (sum * sum) / area);
    const score = dot / (Math.sqrt(varI) * normT);
    if (score > best) {
      best = score;
      bx = x;
      by = y;
    }
  };

  for (let y = 0; y <= maxY; y += coarse) for (let x = 0; x <= maxX; x += coarse) evalAt(x, y);
  // Уточнення (stride 1) у вікні ±coarse навколо найкращого.
  const fx0 = Math.max(0, bx - coarse);
  const fx1 = Math.min(maxX, bx + coarse);
  const fy0 = Math.max(0, by - coarse);
  const fy1 = Math.min(maxY, by + coarse);
  for (let y = fy0; y <= fy1; y++) for (let x = fx0; x <= fx1; x++) evalAt(x, y);

  const nx = bx / W;
  const ny = by / H;
  const norm = { x: nx, y: ny, w: relW, h: relH };

  // Hi-res перекроп із невеликим запасом (на похибку позиціонування).
  const marginX = relW * pr.hiW * 0.015;
  const marginY = relH * pr.hiH * 0.015;
  let cx = Math.max(0, Math.round(nx * pr.hiW - marginX));
  let cy = Math.max(0, Math.round(ny * pr.hiH - marginY));
  let cw = Math.min(pr.hiW - cx, Math.round(relW * pr.hiW + 2 * marginX));
  let ch = Math.min(pr.hiH - cy, Math.round(relH * pr.hiH + 2 * marginY));

  const out = document.createElement('canvas');
  out.width = Math.max(1, cw);
  out.height = Math.max(1, ch);
  out.getContext('2d')!.drawImage(pr.hiCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
  const dataUrl = out.toDataURL('image/jpeg', 0.92);

  return { dataUrl, score: best, norm };
}

// Завантаження PDF із ArrayBuffer (для модалки експерименту).
export async function openPdf(buffer: ArrayBuffer): Promise<pdfjs.PDFDocumentProxy> {
  return pdfjs.getDocument({ data: buffer }).promise;
}
