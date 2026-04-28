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
  return `${reportType}-${branchLabel}-${from}_${to}-${cur}.${ext}`.replace(/\s+/g, '_');
}

function buildExcelXml(report) {
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = Object.entries(report.kpisByCurrency || {}).map(([cur, v]) => `
    <Row><Cell><Data ss:Type="String">${esc(cur)}</Data></Cell><Cell><Data ss:Type="Number">${Number(v.sales || 0)}</Data></Cell><Cell><Data ss:Type="Number">${Number(v.totalPaid || 0)}</Data></Cell><Cell><Data ss:Type="Number">${Number(v.unpaidBalances || 0)}</Data></Cell><Cell><Data ss:Type="Number">${Number(v.netProfit || 0)}</Data></Cell></Row>`).join('');

  return `<?xml version="1.0"?>
  <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    <Worksheet ss:Name="Summary"><Table>
      <Row><Cell><Data ss:Type="String">Currency</Data></Cell><Cell><Data ss:Type="String">Sales</Data></Cell><Cell><Data ss:Type="String">Paid</Data></Cell><Cell><Data ss:Type="String">Unpaid</Data></Cell><Cell><Data ss:Type="String">Net Profit</Data></Cell></Row>
      ${rows}
    </Table></Worksheet>
    <Worksheet ss:Name="Sales"><Table>
      <Row><Cell><Data ss:Type="String">Generated</Data></Cell><Cell><Data ss:Type="String">${esc(report.meta.generatedAt)}</Data></Cell></Row>
    </Table></Worksheet>
    <Worksheet ss:Name="Payments"><Table><Row><Cell><Data ss:Type="String">Method groups are available in dashboard trends payload.</Data></Cell></Row></Table></Worksheet>
    <Worksheet ss:Name="Installments"><Table><Row><Cell><Data ss:Type="String">Overdue, due, paid by currency included in summary.</Data></Cell></Row></Table></Worksheet>
    <Worksheet ss:Name="Expenses"><Table><Row><Cell><Data ss:Type="String">Expenses module not available in schema.</Data></Cell></Row></Table></Worksheet>
    <Worksheet ss:Name="Inventory"><Table><Row><Cell><Data ss:Type="String">Low/out of stock and stock value are in dashboard JSON.</Data></Cell></Row></Table></Worksheet>
    <Worksheet ss:Name="Customers"><Table><Row><Cell><Data ss:Type="String">Debt and top paying customers in dashboard JSON.</Data></Cell></Row></Table></Worksheet>
  </Workbook>`;
}

function buildSimplePdf(report) {
  const lines = [
    'Nuqta Plus Accounting Report',
    `Generated: ${report.meta.generatedAt}`,
    `Filters: ${JSON.stringify(report.meta.filters)}`,
    '',
    'KPI Summary',
    ...Object.entries(report.kpisByCurrency || {}).flatMap(([cur, v]) => [
      `${cur}: sales=${Number(v.sales || 0)} paid=${Number(v.totalPaid || 0)} unpaid=${Number(v.unpaidBalances || 0)} netProfit=${Number(v.netProfit || 0)}`,
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
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
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
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(pdf);
  }
}

export default new ReportController();
