import { z } from 'zod';
import reportService from '../services/reportService.js';
import { isGlobalAdmin } from '../services/scopeService.js';

const querySchema = z.object({
  branchId: z.coerce.number().int().positive().optional(),
  currency: z.string().optional().default('ALL'),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  reportType: z.string().optional().default('dashboard'),
});

function contentDispositionFilename({ reportType, branchLabel, dateFrom, dateTo, currency, ext }) {
  const from = dateFrom || 'start';
  const to = dateTo || 'end';
  const cur = currency || 'ALL';
  return `${reportType || 'report'}-${branchLabel}-${from}_${to}-${cur}.${ext}`.replace(/\s+/g, '_');
}

function sanitizeAsciiFilename(filename) {
  const cleaned = String(filename || 'report')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'report';
}

function buildContentDisposition(filename) {
  const ascii = sanitizeAsciiFilename(filename);
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function buildExcelXml(report) {
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = Object.entries(report.kpisByCurrency || {})
    .map(
      ([cur, v]) => `
    <Row><Cell><Data ss:Type="String">${esc(cur)}</Data></Cell><Cell><Data ss:Type="Number">${Number(v.sales || 0)}</Data></Cell><Cell><Data ss:Type="Number">${Number(v.totalPaid || 0)}</Data></Cell><Cell><Data ss:Type="Number">${Number(v.unpaidBalances || 0)}</Data></Cell><Cell><Data ss:Type="Number">${Number(v.netProfit || 0)}</Data></Cell></Row>`
    )
    .join('');

  return `<?xml version="1.0"?>
  <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    <Worksheet ss:Name="الملخص"><Table>
      <Row><Cell><Data ss:Type="String">العملة</Data></Cell><Cell><Data ss:Type="String">إجمالي المبيعات</Data></Cell><Cell><Data ss:Type="String">المدفوع</Data></Cell><Cell><Data ss:Type="String">المتبقي</Data></Cell><Cell><Data ss:Type="String">صافي الربح</Data></Cell></Row>
      ${rows}
    </Table></Worksheet>
    <Worksheet ss:Name="المبيعات"><Table>
      <Row><Cell><Data ss:Type="String">تاريخ الإنشاء</Data></Cell><Cell><Data ss:Type="String">${esc(report.meta.generatedAt)}</Data></Cell></Row>
    </Table></Worksheet>
    <Worksheet ss:Name="المدفوعات"><Table><Row><Cell><Data ss:Type="String">تفاصيل طرق الدفع موجودة ضمن بيانات الاتجاهات.</Data></Cell></Row></Table></Worksheet>
    <Worksheet ss:Name="الأقساط"><Table><Row><Cell><Data ss:Type="String">ملخص الأقساط (مستحقة/متأخرة/مسددة) حسب العملة.</Data></Cell></Row></Table></Worksheet>
    <Worksheet ss:Name="المصاريف"><Table><Row><Cell><Data ss:Type="String">وحدة المصاريف غير متوفرة في المخطط الحالي.</Data></Cell></Row></Table></Worksheet>
    <Worksheet ss:Name="المخزون"><Table><Row><Cell><Data ss:Type="String">القيمة المخزنية والحد الأدنى متاحة في التقرير.</Data></Cell></Row></Table></Worksheet>
    <Worksheet ss:Name="العملاء"><Table><Row><Cell><Data ss:Type="String">ديون العملاء وأعلى العملاء سدادًا متاحة في التقرير.</Data></Cell></Row></Table></Worksheet>
  </Workbook>`;
}

function buildSimplePdf(report) {
  const lines = [
    'تقرير محاسبي - نقطة بلس',
    `تاريخ الإنشاء: ${report.meta.generatedAt}`,
    `الفلاتر: ${JSON.stringify(report.meta.filters)}`,
    '',
    'ملخص المؤشرات',
    ...Object.entries(report.kpisByCurrency || {}).flatMap(([cur, v]) => [
      `${cur}: المبيعات=${Number(v.sales || 0)} | المدفوع=${Number(v.totalPaid || 0)} | المتبقي=${Number(v.unpaidBalances || 0)} | صافي الربح=${Number(v.netProfit || 0)}`,
    ]),
  ];

  const stream = ['BT /F1 10 Tf 40 780 Td'];
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i].replace(/[()\\]/g, '');
    stream.push(`(${text}) Tj`);
    if (i < lines.length - 1) stream.push('0 -14 Td');
  }
  stream.push('ET');
  const content = stream.join('\n');
  const objects = [];
  const pushObj = (body) => {
    const id = objects.length + 1;
    objects.push(`${id} 0 obj\n${body}\nendobj\n`);
    return id;
  };

  const fontId = pushObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const contentId = pushObj(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const pageId = pushObj(`<< /Type /Page /Parent 4 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
  const pagesId = pushObj(`<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
  const catalogId = pushObj(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let offset = 9;
  const body = objects.map((obj) => {
    const start = offset;
    offset += Buffer.byteLength(obj, 'utf8');
    return { start, obj };
  });

  const xrefStart = offset;
  let pdf = '%PDF-1.4\n';
  for (const part of body) pdf += part.obj;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const part of body) pdf += `${String(part.start).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

export class ReportController {
  async dashboard(request, reply) {
    const parsed = querySchema.parse(request.query || {});
    if (!isGlobalAdmin(request.user)) {
      delete parsed.branchId;
    }
    const data = await reportService.getDashboard(parsed, request.user);
    return reply.send({ success: true, data });
  }

  async exportExcel(request, reply) {
    const parsed = querySchema.parse(request.query || {});
    if (!isGlobalAdmin(request.user)) {
      delete parsed.branchId;
    }
    const report = await reportService.getDashboard(parsed, request.user);
    const branchLabel = report.meta.filters.effectiveBranchId ? `branch-${report.meta.filters.effectiveBranchId}` : 'all-branches';
    const filename = contentDispositionFilename({ reportType: parsed.reportType, branchLabel, dateFrom: parsed.dateFrom, dateTo: parsed.dateTo, currency: parsed.currency, ext: 'xls' });
    const xml = buildExcelXml(report);
    reply.header('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    reply.header('Content-Disposition', buildContentDisposition(filename));
    return reply.send(xml);
  }

  async exportPdf(request, reply) {
    const parsed = querySchema.parse(request.query || {});
    if (!isGlobalAdmin(request.user)) {
      delete parsed.branchId;
    }
    const report = await reportService.getDashboard(parsed, request.user);
    const branchLabel = report.meta.filters.effectiveBranchId ? `branch-${report.meta.filters.effectiveBranchId}` : 'all-branches';
    const filename = contentDispositionFilename({ reportType: parsed.reportType, branchLabel, dateFrom: parsed.dateFrom, dateTo: parsed.dateTo, currency: parsed.currency, ext: 'pdf' });
    const pdf = buildSimplePdf(report);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', buildContentDisposition(filename));
    return reply.send(pdf);
  }
}

export default new ReportController();
