export type ReportCellTone = 'default' | 'good' | 'bad' | 'warn' | 'muted' | 'info';

export interface StyledReportCell {
  value: string | number | null | undefined;
  tone?: ReportCellTone;
  bold?: boolean;
}

export type ReportCell = string | number | null | undefined | StyledReportCell;

export interface ExcelWorksheetSpec {
  sheetName: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: ReportCell[][];
  totalsRow?: ReportCell[];
  note?: string;
}

export interface ExcelExportOptions {
  fileName: string;
  sheetName: string;
  title: string;
  subtitle?: string;
  headers: string[];
  rows: ReportCell[][];
  totalsRow?: ReportCell[];
  note?: string;
}

export interface ExcelWorkbookOptions {
  fileName: string;
  sheets: ExcelWorksheetSpec[];
}

export interface PdfKpiItem {
  label: string;
  value: string;
  sub?: string;
  tone?: 'navy' | 'red' | 'green' | 'slate';
}

export interface PdfSectionTable {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: ReportCell[][];
  totalsRow?: ReportCell[];
}

export interface PdfExportOptions {
  title: string;
  subtitle?: string;
  kpis?: PdfKpiItem[];
  chartTitle?: string;
  chartSvgHtml?: string;
  secondaryChartTitle?: string;
  secondaryChartSvgHtml?: string;
  executiveNotes?: string[];
  headers: string[];
  rows: ReportCell[][];
  totalsRow?: ReportCell[];
  extraTables?: PdfSectionTable[];
  note?: string;
}

function escapeXml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unwrapCell(cell: ReportCell): {
  value: string | number | null | undefined;
  tone: ReportCellTone;
  bold: boolean;
} {
  if (cell !== null && typeof cell === 'object' && 'value' in cell) {
    return {
      value: cell.value,
      tone: cell.tone ?? 'default',
      bold: Boolean(cell.bold),
    };
  }
  return { value: cell, tone: 'default', bold: false };
}

function resolveXmlStyleId(isNumeric: boolean, isTotal: boolean, tone: ReportCellTone): string {
  if (isTotal) return isNumeric ? 'sTotalNum' : 'sTotalText';
  if (tone === 'good') return isNumeric ? 'sGoodNum' : 'sGoodText';
  if (tone === 'bad') return isNumeric ? 'sBadNum' : 'sBadText';
  if (tone === 'warn') return isNumeric ? 'sWarnNum' : 'sWarnText';
  if (tone === 'info') return isNumeric ? 'sInfoNum' : 'sInfoText';
  if (tone === 'muted') return isNumeric ? 'sMutedNum' : 'sMutedText';
  return isNumeric ? 'sNum' : 'sText';
}

function buildSpreadsheetCell(cell: ReportCell, isTotal = false): string {
  const { value, tone } = unwrapCell(cell);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const style = resolveXmlStyleId(true, isTotal, tone);
    return `<Cell ss:StyleID="${style}"><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  const style = resolveXmlStyleId(false, isTotal, tone);
  return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${escapeXml(value ?? '')}</Data></Cell>`;
}

function buildWorksheetXml(spec: ExcelWorksheetSpec, usedNames: Set<string>): string {
  const { sheetName, title, subtitle, headers, rows, totalsRow, note } = spec;
  const colCount = Math.max(1, headers.length);
  let cleanName = (sheetName || 'Rapor').replace(/[\\/*?[\]:]/g, '_').trim();
  if (!cleanName) cleanName = 'Rapor';
  if (cleanName.length > 28) cleanName = cleanName.slice(0, 28);
  let uniqueName = cleanName;
  let counter = 2;
  while (usedNames.has(uniqueName.toLowerCase())) {
    uniqueName = `${cleanName.slice(0, 25)}_${counter}`;
    counter++;
  }
  usedNames.add(uniqueName.toLowerCase());
  const safeSheet = escapeXml(uniqueName);

  const colWidths = headers.map((h, colIdx) => {
    let maxLen = h.length;
    for (const r of rows) {
      const len = String(unwrapCell(r[colIdx]).value ?? '').length;
      if (len > maxLen) maxLen = len;
    }
    if (totalsRow) {
      const len = String(unwrapCell(totalsRow[colIdx]).value ?? '').length;
      if (len > maxLen) maxLen = len;
    }
    return Math.min(44, Math.max(13, maxLen + 4));
  });

  const columnsXml = colWidths
    .map((w) => `<Column ss:AutoFitWidth="1" ss:Width="${w * 6.8}"/>`)
    .join('');

  const headerRowXml = `<Row ss:Height="24">${headers
    .map((h) => `<Cell ss:StyleID="sHeader"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`)
    .join('')}</Row>`;

  const bodyRowsXml = rows
    .map(
      (r) =>
        `<Row ss:Height="20">${headers
          .map((_, idx) => buildSpreadsheetCell(r[idx], false))
          .join('')}</Row>`
    )
    .join('\n      ');

  const totalsXml = totalsRow
    ? `<Row ss:Height="22">${headers
        .map((_, idx) => buildSpreadsheetCell(totalsRow[idx], true))
        .join('')}</Row>`
    : '';

  const subtitleRowXml = subtitle
    ? `<Row ss:Height="18"><Cell ss:MergeAcross="${colCount - 1}" ss:StyleID="sSub"><Data ss:Type="String">${escapeXml(
        subtitle
      )}</Data></Cell></Row>`
    : '';

  const noteRowXml = note
    ? `<Row ss:Height="8"/><Row ss:Height="18"><Cell ss:MergeAcross="${colCount - 1}" ss:StyleID="sSub"><Data ss:Type="String">${escapeXml(
        note
      )}</Data></Cell></Row>`
    : '';

  return `<Worksheet ss:Name="${safeSheet}">
  <Table>
   ${columnsXml}
   <Row ss:Height="24">
    <Cell ss:MergeAcross="${colCount - 1}" ss:StyleID="sTitle"><Data ss:Type="String">${escapeXml(
    title
  )}</Data></Cell>
   </Row>
   ${subtitleRowXml}
   <Row ss:Height="8"/>
   ${headerRowXml}
   ${bodyRowsXml}
   ${totalsXml}
   ${noteRowXml}
  </Table>
 </Worksheet>`;
}

/**
 * Generates and downloads a multi-sheet Excel SpreadsheetML (.xls) workbook with corporate conditional colors.
 */
export function exportExcelWorkbook(options: ExcelWorkbookOptions): void {
  const { fileName, sheets } = options;
  if (!sheets || sheets.length === 0) return;
  const usedNames = new Set<string>();
  const worksheetsXml = sheets.map((s) => buildWorksheetXml(s, usedNames)).join('\n ');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#0F172A"/>
  </Style>
  <Style ss:ID="sTitle">
   <Font ss:FontName="Calibri" ss:Size="14" ss:Bold="1" ss:Color="#17365D"/>
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="sSub">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#64748B"/>
   <Alignment ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="sHeader">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#17365D" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#0F2643"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#2B4E7C"/>
   </Borders>
  </Style>
  <Style ss:ID="sText">
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F1F5F9"/>
   </Borders>
  </Style>
  <Style ss:ID="sNum">
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.##"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F1F5F9"/>
   </Borders>
  </Style>
  <Style ss:ID="sGoodText">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#166534"/>
   <Interior ss:Color="#DCFCE7" ss:Pattern="Solid"/>
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BBF7D0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BBF7D0"/>
   </Borders>
  </Style>
  <Style ss:ID="sGoodNum">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#166534"/>
   <Interior ss:Color="#DCFCE7" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.##"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BBF7D0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#BBF7D0"/>
   </Borders>
  </Style>
  <Style ss:ID="sBadText">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#991B1B"/>
   <Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/>
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FECACA"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FECACA"/>
   </Borders>
  </Style>
  <Style ss:ID="sBadNum">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#991B1B"/>
   <Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.##"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FECACA"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FECACA"/>
   </Borders>
  </Style>
  <Style ss:ID="sWarnText">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#92400E"/>
   <Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/>
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FDE68A"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FDE68A"/>
   </Borders>
  </Style>
  <Style ss:ID="sWarnNum">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#92400E"/>
   <Interior ss:Color="#FEF3C7" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.##"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FDE68A"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#FDE68A"/>
   </Borders>
  </Style>
  <Style ss:ID="sInfoText">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#0E7490"/>
   <Interior ss:Color="#ECFEFF" ss:Pattern="Solid"/>
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFFAFE"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFFAFE"/>
   </Borders>
  </Style>
  <Style ss:ID="sInfoNum">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#0E7490"/>
   <Interior ss:Color="#ECFEFF" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.##"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFFAFE"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#CFFAFE"/>
   </Borders>
  </Style>
  <Style ss:ID="sMutedText">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#64748B"/>
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F1F5F9"/>
   </Borders>
  </Style>
  <Style ss:ID="sMutedNum">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#64748B"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.##"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/>
    <Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#F1F5F9"/>
   </Borders>
  </Style>
  <Style ss:ID="sTotalText">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#17365D"/>
   <Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/>
   <Alignment ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#17365D"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
   </Borders>
  </Style>
  <Style ss:ID="sTotalNum">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#17365D"/>
   <Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>
   <NumberFormat ss:Format="#,##0.##"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#17365D"/>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#94A3B8"/>
   </Borders>
  </Style>
 </Styles>
 ${worksheetsXml}
</Workbook>`;

  const blob = new Blob(['\ufeff' + xml], {
    type: 'application/vnd.ms-excel;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.xls') ? fileName : `${fileName}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generates and downloads a single-sheet Excel SpreadsheetML (.xls) workbook.
 */
export function exportExcelXml(options: ExcelExportOptions): void {
  const { fileName, ...sheet } = options;
  exportExcelWorkbook({
    fileName,
    sheets: [sheet],
  });
}

function formatPdfCell(cell: ReportCell): { text: string; isNum: boolean; toneClass: string } {
  const { value, tone, bold } = unwrapCell(cell);
  const toneClass = [
    tone === 'good'
      ? 'cell-good'
      : tone === 'bad'
      ? 'cell-bad'
      : tone === 'warn'
      ? 'cell-warn'
      : tone === 'info'
      ? 'cell-info'
      : tone === 'muted'
      ? 'cell-muted'
      : '',
    bold ? 'cell-bold' : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (value === null || value === undefined) {
    return { text: '-', isNum: false, toneClass };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return {
      text: new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(value),
      isNum: true,
      toneClass,
    };
  }
  return { text: escapeHtml(value), isNum: false, toneClass };
}

function renderPdfTableHtml(
  headers: string[],
  rows: ReportCell[][],
  totalsRow?: ReportCell[],
  title?: string,
  subtitle?: string
): string {
  if (!headers || headers.length === 0) return '';
  const theadHtml = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  const tbodyHtml = rows
    .map(
      (r) =>
        `<tr>${headers
          .map((_, idx) => {
            const { text, isNum, toneClass } = formatPdfCell(r[idx]);
            const cls = [isNum ? 'num' : '', toneClass].filter(Boolean).join(' ');
            return `<td class="${cls}">${text}</td>`;
          })
          .join('')}</tr>`
    )
    .join('');

  const tfootHtml = totalsRow
    ? `<tfoot><tr>${headers
        .map((_, idx) => {
          const { text, isNum, toneClass } = formatPdfCell(totalsRow[idx]);
          const cls = [isNum ? 'num' : '', toneClass].filter(Boolean).join(' ');
          return `<td class="${cls}">${text}</td>`;
        })
        .join('')}</tr></tfoot>`
    : '';

  const sectionHeader = title
    ? `<div class="section-head">
        <h2>${escapeHtml(title)}</h2>
        ${subtitle ? `<div class="section-sub">${escapeHtml(subtitle)}</div>` : ''}
       </div>`
    : '';

  return `<div class="table-section">
    ${sectionHeader}
    <table>
      <thead>${theadHtml}</thead>
      <tbody>${tbodyHtml}</tbody>
      ${tfootHtml}
    </table>
  </div>`;
}

/**
 * Opens an A4 landscape formatted corporate print view and triggers PDF save/print dialog.
 */
export function exportPrintablePdf(options: PdfExportOptions): void {
  const {
    title,
    subtitle,
    kpis,
    chartTitle,
    chartSvgHtml,
    secondaryChartTitle,
    secondaryChartSvgHtml,
    executiveNotes,
    headers,
    rows,
    totalsRow,
    extraTables,
    note,
  } = options;
  const generatedAt = new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date());

  const kpiHtml =
    kpis && kpis.length > 0
      ? `<div class="kpis">${kpis
          .map((k) => {
            const valClass =
              k.tone === 'red'
                ? 'tone-red'
                : k.tone === 'green'
                ? 'tone-green'
                : k.tone === 'slate'
                ? 'tone-slate'
                : 'tone-navy';
            return `<div class="kpi">
              <div class="kpi-label">${escapeHtml(k.label)}</div>
              <div class="kpi-val ${valClass}">${escapeHtml(k.value)}</div>
              ${k.sub ? `<div class="kpi-sub">${escapeHtml(k.sub)}</div>` : ''}
            </div>`;
          })
          .join('')}</div>`
      : '';

  const notesHtml =
    executiveNotes && executiveNotes.length > 0
      ? `<div class="exec-notes">
          <div class="exec-notes-title">YÖNETİCİ ÖZETİ &amp; OTOMATİK ANALİZ BULGULARI</div>
          <ul>${executiveNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
        </div>`
      : '';

  const hasBothCharts = Boolean(chartSvgHtml && secondaryChartSvgHtml);
  const chartsHtml =
    chartSvgHtml || secondaryChartSvgHtml
      ? `<div class="${hasBothCharts ? 'charts-grid' : ''}">
          ${
            chartSvgHtml
              ? `<div class="chart-card">
                  ${chartTitle ? `<div class="chart-title">${escapeHtml(chartTitle)}</div>` : ''}
                  <div class="chart-wrap">${chartSvgHtml}</div>
                </div>`
              : ''
          }
          ${
            secondaryChartSvgHtml
              ? `<div class="chart-card">
                  ${
                    secondaryChartTitle
                      ? `<div class="chart-title">${escapeHtml(secondaryChartTitle)}</div>`
                      : ''
                  }
                  <div class="chart-wrap">${secondaryChartSvgHtml}</div>
                </div>`
              : ''
          }
        </div>`
      : '';

  const primaryTableHtml = renderPdfTableHtml(headers, rows, totalsRow);
  const extraTablesHtml =
    extraTables && extraTables.length > 0
      ? extraTables
          .map((t) => renderPdfTableHtml(t.headers, t.rows, t.totalsRow, t.title, t.subtitle))
          .join('')
      : '';

  const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 11mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    color: #0F172A;
    background: #FFFFFF;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 3px solid #17365D;
    padding-bottom: 10px;
    margin-bottom: 12px;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .brand-logo {
    height: 38px;
    width: auto;
    object-fit: contain;
  }
  .brand {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #0E7490;
    text-transform: uppercase;
  }
  h1 {
    margin: 2px 0 0 0;
    font-size: 17px;
    font-weight: 800;
    color: #17365D;
  }
  .sub {
    margin-top: 3px;
    font-size: 10.5px;
    color: #475569;
  }
  .meta {
    text-align: right;
    font-size: 10px;
    color: #64748B;
  }
  .kpis {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 9px;
    margin-bottom: 12px;
  }
  .kpi {
    border: 1px solid #CBD5E1;
    border-radius: 10px;
    padding: 8px 11px;
    background: #F8FAFC;
  }
  .kpi-label {
    font-size: 8.5px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748B;
  }
  .kpi-val {
    margin-top: 3px;
    font-size: 14.5px;
    font-weight: 800;
  }
  .tone-navy { color: #17365D; }
  .tone-red { color: #DC2626; }
  .tone-green { color: #059669; }
  .tone-slate { color: #334155; }
  .kpi-sub {
    margin-top: 2px;
    font-size: 8.5px;
    color: #64748B;
  }
  .exec-notes {
    border: 1px solid #BAE6FD;
    background: #F0F9FF;
    border-radius: 10px;
    padding: 8px 12px;
    margin-bottom: 12px;
  }
  .exec-notes-title {
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #0E7490;
    margin-bottom: 4px;
  }
  .exec-notes ul {
    margin: 0;
    padding-left: 16px;
    font-size: 9.5px;
    color: #1E293B;
  }
  .exec-notes li {
    margin-bottom: 2px;
  }
  .charts-grid {
    display: grid;
    grid-template-columns: 1.55fr 1fr;
    gap: 10px;
    margin-bottom: 12px;
  }
  .chart-card {
    border: 1px solid #CBD5E1;
    border-radius: 10px;
    padding: 9px 11px;
    margin-bottom: 12px;
    page-break-inside: avoid;
  }
  .charts-grid .chart-card {
    margin-bottom: 0;
  }
  .chart-title {
    font-size: 10.5px;
    font-weight: 800;
    color: #17365D;
    margin-bottom: 5px;
  }
  .chart-wrap svg {
    width: 100%;
    height: auto;
    max-height: 175px;
    display: block;
  }
  .table-section {
    margin-bottom: 14px;
  }
  .section-head {
    margin: 10px 0 6px 0;
  }
  .section-head h2 {
    margin: 0;
    font-size: 12.5px;
    font-weight: 800;
    color: #17365D;
  }
  .section-sub {
    font-size: 9.5px;
    color: #64748B;
    margin-top: 1px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5px;
  }
  thead th {
    background: #17365D;
    color: #FFFFFF;
    font-weight: 700;
    text-align: left;
    padding: 5px 6px;
    border: 1px solid #17365D;
  }
  tbody td {
    padding: 4.5px 6px;
    border: 1px solid #E2E8F0;
    color: #1E293B;
  }
  tbody tr:nth-child(even) {
    background: #F8FAFC;
  }
  tfoot td {
    padding: 5.5px 6px;
    border: 1px solid #94A3B8;
    background: #E2E8F0;
    font-weight: 800;
    color: #17365D;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .cell-good {
    background: #DCFCE7 !important;
    color: #166534 !important;
    font-weight: 700;
  }
  .cell-bad {
    background: #FEE2E2 !important;
    color: #991B1B !important;
    font-weight: 700;
  }
  .cell-warn {
    background: #FEF3C7 !important;
    color: #92400E !important;
    font-weight: 700;
  }
  .cell-info {
    background: #ECFEFF !important;
    color: #0E7490 !important;
    font-weight: 700;
  }
  .cell-muted {
    color: #64748B !important;
  }
  .cell-bold {
    font-weight: 800;
  }
  .note {
    margin-top: 8px;
    font-size: 9px;
    color: #64748B;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <img src="/downtown-teknik-icon.png" alt="Downtown Teknik" class="brand-logo" onerror="this.style.display='none'" />
      <div>
        <div class="brand">DOWNTOWN TEKNİK · TEKNİK OPERASYON RAPORU</div>
        <h1>${escapeHtml(title)}</h1>
        ${subtitle ? `<div class="sub">${escapeHtml(subtitle)}</div>` : ''}
      </div>
    </div>
    <div class="meta">Oluşturulma: ${escapeHtml(generatedAt)}</div>
  </div>
  ${kpiHtml}
  ${notesHtml}
  ${chartsHtml}
  ${primaryTableHtml}
  ${extraTablesHtml}
  ${note ? `<div class="note">${escapeHtml(note)}</div>` : ''}
</body>
</html>`;

  const win = window.open('', '_blank', 'width=1240,height=880');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
    }, 280);
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1000);
  }, 280);
}
