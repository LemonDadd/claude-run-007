// 导出：PDF（jsPDF，每页嵌入整页位图）、PNG（逐页下载 / 仅首页）、打印
import { PAPERS } from './sheet.js';

export function canvasesToPdf(canvases, paper = 'a4') {
  const { jsPDF } = window.jspdf;
  const P = PAPERS[paper] || PAPERS.a4;
  const landscape = P.w > P.h;
  const pdf = new jsPDF({ orientation: landscape ? 'l' : 'p', unit: 'mm', format: paper === 'b5' ? [176, 250] : 'a4' });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();
  canvases.forEach((cv, i) => {
    if (i > 0) pdf.addPage([pw, ph], landscape ? 'l' : 'p');
    pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pw, ph);
  });
  return pdf;
}

export function downloadCanvasPng(cv, name) {
  const a = document.createElement('a');
  a.download = name;
  a.href = cv.toDataURL('image/png');
  a.click();
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
