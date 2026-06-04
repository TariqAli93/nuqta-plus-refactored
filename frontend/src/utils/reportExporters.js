/**
 * Excel (xlsx) and PDF (jsPDF + autotable) exporters.
 *
 * Both consume the SAME structure produced by `buildExportRows`, guaranteeing
 * the two formats stay in sync. Heavy deps (xlsx, jspdf, the embedded Arabic
 * font) are dynamically imported so they only load when the user exports.
 */

import { displayCell, excelCell, formatDate, sectionTotals } from './reportExport.js';
import { reshape, hasArabic } from './arabicText.js';

const NO_DATA = 'لا توجد بيانات لتصديرها';

function formatPdfText(value) {
  if (value === null || value === undefined) return '';

  const str = String(value)
    .replace(/[\u200e\u200f\u061c]/g, '')
    .trim();

  if (!hasArabic(str)) return str;

  return reshape(str);
}

function toLatinDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function cleanPdfPlainText(value) {
  return toLatinDigits(value)
    .replace(/[\u200e\u200f\u061c]/g, '')
    .trim();
}

function formatPdfDate(value, withTime = false) {
  return cleanPdfPlainText(formatDate(value, withTime));
}

function pdfPart(value, options = {}) {
  const raw = value === null || value === undefined ? '' : String(value);
  const text = options.plain ? cleanPdfPlainText(raw) : formatPdfText(raw);

  return {
    text,
    gapAfter: options.gapAfter ?? 5,
  };
}

function drawPdfPartsRight(doc, parts, rightX, y) {
  let cursorX = rightX;

  for (const part of parts) {
    if (!part?.text) continue;

    doc.text(part.text, cursorX, y, { align: 'right' });
    cursorX -= doc.getTextWidth(part.text) + part.gapAfter;
  }
}

function sanitizeSheetName(name, used) {
  let n =
    String(name || 'Sheet')
      .replace(/[\\/?*[\]:]/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet';
  let candidate = n;
  let i = 2;
  while (used.has(candidate)) {
    const suffix = ` ${i}`;
    candidate = `${n.slice(0, 31 - suffix.length)}${suffix}`;
    i += 1;
  }
  used.add(candidate);
  return candidate;
}

/* ------------------------------------------------------------------ Excel */

export async function exportToExcel(built, filename) {
  if (!built?.sections?.length) throw new Error(NO_DATA);

  const XLSX = await import('xlsx-js-style');
  const wb = XLSX.utils.book_new();
  const usedNames = new Set();

  const primary = '1E40AF';
  const dark = '0F172A';
  const soft = 'EFF6FF';
  const light = 'F8FAFC';
  const border = 'CBD5E1';
  const success = 'DCFCE7';

  const baseBorder = {
    top: { style: 'thin', color: { rgb: border } },
    bottom: { style: 'thin', color: { rgb: border } },
    left: { style: 'thin', color: { rgb: border } },
    right: { style: 'thin', color: { rgb: border } },
  };

  const titleStyle = {
    font: { bold: true, sz: 18, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: dark } },
    alignment: { horizontal: 'center', vertical: 'center' },
    border: baseBorder,
  };

  const labelStyle = {
    font: { bold: true, color: { rgb: dark } },
    fill: { fgColor: { rgb: soft } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: baseBorder,
  };

  const valueStyle = {
    font: { color: { rgb: dark } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: baseBorder,
  };

  const headerStyle = {
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: primary } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: baseBorder,
  };

  const cellStyle = {
    alignment: { horizontal: 'right', vertical: 'center', wrapText: true },
    border: baseBorder,
  };

  const numberStyle = {
    ...cellStyle,
    numFmt: '#,##0',
  };

  const moneyStyle = {
    ...cellStyle,
    numFmt: '#,##0',
  };

  const totalStyle = {
    font: { bold: true, color: { rgb: dark } },
    fill: { fgColor: { rgb: success } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: baseBorder,
    numFmt: '#,##0',
  };

  function applyRangeStyle(ws, range, style) {
    const decoded = XLSX.utils.decode_range(range);
    for (let r = decoded.s.r; r <= decoded.e.r; r += 1) {
      for (let c = decoded.s.c; c <= decoded.e.c; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!ws[addr]) ws[addr] = { t: 's', v: '' };
        ws[addr].s = style;
      }
    }
  }

  function isNumericColumn(type) {
    return ['number', 'currency', 'money', 'amount', 'price', 'total'].includes(type);
  }

  const cur = built.meta.currency === 'ALL' ? 'كل العملات' : built.meta.currency;

  const metaAoa = [
    [built.title, ''],
    [],
    ['الفترة', `من ${built.meta.dateFrom || '—'} إلى ${built.meta.dateTo || '—'}`],
    ['الفرع', built.meta.branchLabel || '—'],
    ['العملة', cur || '—'],
    ...(built.meta.userName ? [['المستخدم', built.meta.userName]] : []),
    ['تاريخ الإنشاء', formatDate(built.meta.generatedAt, true)],
  ];

  const metaWs = XLSX.utils.aoa_to_sheet(metaAoa);

  metaWs['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  metaWs['!cols'] = [{ wch: 22 }, { wch: 48 }];
  metaWs['!rows'] = [{ hpt: 32 }, { hpt: 8 }];
  metaWs['!views'] = [{ RTL: true }];

  applyRangeStyle(metaWs, 'A1:B1', titleStyle);

  for (let r = 2; r < metaAoa.length; r += 1) {
    const labelCell = `A${r + 1}`;
    const valueCell = `B${r + 1}`;
    if (metaWs[labelCell]) metaWs[labelCell].s = labelStyle;
    if (metaWs[valueCell]) metaWs[valueCell].s = valueStyle;
  }

  XLSX.utils.book_append_sheet(wb, metaWs, sanitizeSheetName('معلومات التقرير', usedNames));

  for (const section of built.sections) {
    const headers = section.columns.map((c) => c.header);

    const data = section.rows.map((row) => {
      const obj = {};
      for (const col of section.columns) {
        obj[col.header] = excelCell(row[col.key], col.type);
      }
      return obj;
    });

    const ws = XLSX.utils.json_to_sheet(data, {
      header: headers,
      origin: 'A3',
    });

    ws['A1'] = { t: 's', v: section.title };
    ws['!merges'] = [
      {
        s: { r: 0, c: 0 },
        e: { r: 0, c: Math.max(section.columns.length - 1, 0) },
      },
    ];

    const lastCol = XLSX.utils.encode_col(section.columns.length - 1);
    applyRangeStyle(ws, `A1:${lastCol}1`, titleStyle);

    for (let c = 0; c < section.columns.length; c += 1) {
      const cell = XLSX.utils.encode_cell({ r: 2, c });
      if (ws[cell]) ws[cell].s = headerStyle;
    }

    for (let r = 0; r < section.rows.length; r += 1) {
      for (let c = 0; c < section.columns.length; c += 1) {
        const col = section.columns[c];
        const cell = XLSX.utils.encode_cell({ r: r + 3, c });

        if (!ws[cell]) continue;

        const isNumber = isNumericColumn(col.type) || typeof ws[cell].v === 'number';
        ws[cell].s = isNumber ? numberStyle : cellStyle;

        if (r % 2 === 1) {
          ws[cell].s = {
            ...ws[cell].s,
            fill: { fgColor: { rgb: light } },
          };
        }
      }
    }

    const totals = sectionTotals(section);
    if (totals) {
      const totalRow = section.columns.map((col, idx) => {
        if (col.total) return totals[col.key];
        if (idx === 0) return 'الإجمالي';
        return '';
      });

      XLSX.utils.sheet_add_aoa(ws, [totalRow], { origin: -1 });

      const range = XLSX.utils.decode_range(ws['!ref']);
      const totalRowIndex = range.e.r;

      for (let c = 0; c < section.columns.length; c += 1) {
        const cell = XLSX.utils.encode_cell({ r: totalRowIndex, c });
        if (ws[cell]) ws[cell].s = totalStyle;
      }
    }

    ws['!cols'] = section.columns.map((col) => {
      let max = String(col.header).length;

      for (const row of section.rows) {
        const len = String(displayCell(row[col.key], col.type) ?? '').length;
        if (len > max) max = len;
      }

      return {
        wch: Math.min(Math.max(max + 4, 12), 45),
      };
    });

    ws['!rows'] = [{ hpt: 30 }, { hpt: 8 }, { hpt: 24 }, ...section.rows.map(() => ({ hpt: 22 }))];

    ws['!autofilter'] = {
      ref: `A3:${lastCol}${section.rows.length + 3}`,
    };

    ws['!freeze'] = {
      xSplit: 0,
      ySplit: 3,
    };

    ws['!views'] = [{ RTL: true }];

    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(section.title, usedNames));
  }

  XLSX.writeFile(wb, filename);
}

/* -------------------------------------------------------------------- PDF */

export async function exportToPdf(built, filename) {
  if (!built?.sections?.length) throw new Error(NO_DATA);

  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const { AMIRI_REGULAR_BASE64 } = await import('@/assets/fonts/amiri/amiriFont.js');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });

  doc.addFileToVFS('Amiri-Regular.ttf', AMIRI_REGULAR_BASE64);

  doc.addFont('Amiri-Regular.ttf', 'Amiri', 'normal');
  doc.addFont('Amiri-Regular.ttf', 'Amiri', 'bold');
  doc.addFont('Amiri-Regular.ttf', 'Amiri', 'italic');
  doc.addFont('Amiri-Regular.ttf', 'Amiri', 'bolditalic');
  doc.setFont('Amiri', 'normal');

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const rightX = pageW - margin;

  doc.setFontSize(16);
  doc.text(formatPdfText(built.title), rightX, 48, { align: 'right' });

  doc.setFontSize(10);

  const cur = built.meta.currency === 'ALL' ? 'كل العملات' : built.meta.currency;
  const dateFrom = cleanPdfPlainText(built.meta.dateFrom || '—');
  const dateTo = cleanPdfPlainText(built.meta.dateTo || '—');
  const generatedAt = formatPdfDate(built.meta.generatedAt, true);

  let y = 70;

  drawPdfPartsRight(
    doc,
    [
      pdfPart('الفترة:', { gapAfter: 6 }),
      pdfPart('من', { gapAfter: 4 }),
      pdfPart(dateFrom, { plain: true, gapAfter: 6 }),
      pdfPart('إلى', { gapAfter: 4 }),
      pdfPart(dateTo, { plain: true }),
    ],
    rightX,
    y
  );
  y += 15;

  drawPdfPartsRight(
    doc,
    [
      pdfPart('الفرع:', { gapAfter: 6 }),
      pdfPart(built.meta.branchLabel || '—', { gapAfter: 16 }),
      pdfPart('|', { plain: true, gapAfter: 16 }),
      pdfPart('العملة:', { gapAfter: 6 }),
      pdfPart(cur || '—', { plain: !hasArabic(String(cur || '')) }),
    ],
    rightX,
    y
  );
  y += 15;

  if (built.meta.userName) {
    drawPdfPartsRight(
      doc,
      [pdfPart('المستخدم:', { gapAfter: 6 }), pdfPart(built.meta.userName)],
      rightX,
      y
    );
    y += 15;
  }

  drawPdfPartsRight(
    doc,
    [pdfPart('تاريخ الإنشاء:', { gapAfter: 6 }), pdfPart(generatedAt, { plain: true })],
    rightX,
    y
  );
  y += 15;

  let startY = y + 8;

  for (const section of built.sections) {
    const cols = [...section.columns].reverse();
    const firstKey = section.columns[0].key;

    const head = [
      [
        {
          content: formatPdfText(section.title),
          colSpan: cols.length,
          styles: { halign: 'right', fillColor: [30, 41, 59], textColor: 255 },
        },
      ],
      cols.map((c) => formatPdfText(c.header)),
    ];

    const body = section.rows.map((row) =>
      cols.map((c) => formatPdfText(displayCell(row[c.key], c.type)))
    );

    const totals = sectionTotals(section);
    let foot;
    if (totals) {
      foot = [
        cols.map((c) => {
          if (c.total) return formatPdfText(displayCell(totals[c.key], c.type));
          if (c.key === firstKey) return formatPdfText('الإجمالي');
          return '';
        }),
      ];
    }

    autoTable(doc, {
      head,
      body,
      foot,
      startY,
      margin: { left: margin, right: margin, bottom: 36 },
      tableWidth: pageW - margin * 2,
      styles: {
        font: 'Amiri',
        fontStyle: 'normal',
        fontSize: 9,
        halign: 'right',
        cellPadding: 4,
        overflow: 'linebreak',
        lineColor: [226, 232, 240],
        lineWidth: 0.5,
      },
      headStyles: {
        font: 'Amiri',
        fontStyle: 'normal',
        fillColor: [37, 99, 235],
        textColor: 255,
        halign: 'right',
      },
      footStyles: {
        font: 'Amiri',
        fontStyle: 'normal',
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        halign: 'right',
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    startY = doc.lastAutoTable.finalY + 22;
  }

  const pageCount = doc.internal.getNumberOfPages();
  doc.setFontSize(9);

  for (let p = 1; p <= pageCount; p += 1) {
    doc.setPage(p);
    doc.setFont('Amiri', 'normal');

    const pageText = `${formatPdfText('صفحة')} ${cleanPdfPlainText(p)} ${formatPdfText('من')} ${cleanPdfPlainText(pageCount)}`;
    doc.text(pageText, pageW / 2, pageH - 18, { align: 'center' });
  }

  doc.save(filename);
}

export { NO_DATA };
