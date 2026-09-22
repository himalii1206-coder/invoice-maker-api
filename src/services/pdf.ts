import PDFDocument from 'pdfkit';
import { InvoiceStatus } from '@prisma/client';
import { InvoiceService, InvoiceDetail } from './invoice.js';
import { InvoiceSettingsService, InvoiceSettingsRecord } from './invoiceSettings.js';
import { buildTaxRateBreakdown, ComputedTaxLine } from './tax.js';
import { amountInWords, formatMoney, toNumber } from '../utils/money.js';
import { formatDocumentDate } from '../utils/date.js';

/**
 * Invoice PDF rendering.
 *
 * Built with PDFKit rather than a headless browser: an invoice is a fixed,
 * highly structured document, and drawing it directly keeps the service free of
 * a Chromium dependency while giving exact control over pagination - the one
 * thing that actually matters here, because a table that splits across pages
 * must repeat its header and never orphan the totals block from its rows.
 */

// A4 at 72dpi, with margins chosen so the content column is a round 515pt.
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { top: 40, bottom: 50, left: 40, right: 40 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;

/**
 * Per-document font aliases.
 *
 * Every draw call asks for these names rather than a concrete family, and
 * `registerFonts` points them at the family chosen in settings. Registration is
 * on the document, so two invoices rendering at once cannot affect each other.
 */
const FONT = { regular: 'Body', bold: 'BodyBold' } as const;

/** The families PDFKit can render without a font file being shipped. */
const FONT_FAMILIES: Record<string, { regular: string; bold: string }> = {
  HELVETICA: { regular: 'Helvetica', bold: 'Helvetica-Bold' },
  TIMES: { regular: 'Times-Roman', bold: 'Times-Bold' },
  COURIER: { regular: 'Courier', bold: 'Courier-Bold' }
};

const INK = {
  text: '#2b180d',
  muted: '#6b5a4e',
  subtle: '#948375',
  border: '#e6dfd5',
  band: '#f3ede4',
  zebra: '#faf8f5',
  danger: '#b91c1c'
};

interface Column {
  key: string;
  label: string;
  width: number;
  align: 'left' | 'right' | 'center';
}

export interface PdfOptions {
  /** Stamps a DRAFT / CANCELLED watermark across the page. */
  watermark?: string | null;
  /** Renders "Duplicate" / "Triplicate" style copy labels. */
  copyLabel?: string | null;
}

export class PdfService {
  /** Renders one invoice and resolves with the finished PDF bytes. */
  static async renderInvoice(
    companyId: string,
    invoiceId: string,
    options: PdfOptions = {}
  ): Promise<{ buffer: Buffer; fileName: string; invoice: InvoiceDetail }> {
    const [invoice, company, settings] = await Promise.all([
      InvoiceService.getById(companyId, invoiceId),
      InvoiceService.getCompanyProfile(companyId),
      InvoiceSettingsService.getOrCreate(companyId)
    ]);

    const watermark =
      options.watermark ??
      (invoice.status === InvoiceStatus.CANCELLED
        ? 'CANCELLED'
        : invoice.status === InvoiceStatus.DRAFT
          ? 'DRAFT'
          : null);

    const buffer = await this.draw(invoice, company, settings, { ...options, watermark });

    return {
      buffer,
      // Slashes are legal in invoice numbers but not in filenames.
      fileName: `${invoice.invoiceNumber.replace(/[^\w.-]+/g, '-')}.pdf`,
      invoice
    };
  }

  private static draw(
    invoice: InvoiceDetail,
    company: Awaited<ReturnType<typeof InvoiceService.getCompanyProfile>>,
    settings: InvoiceSettingsRecord,
    options: PdfOptions
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: MARGIN,
        bufferPages: true,
        info: {
          Title: `Invoice ${invoice.invoiceNumber}`,
          Author: company.name,
          Subject: `Invoice for ${invoice.billingName}`
        }
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        const accent = this.safeColor(settings.themeColor, '#7c4a27');

        this.registerFonts(doc, settings.fontFamily);

        this.drawHeader(doc, invoice, company, accent);
        this.drawPartyBlock(doc, invoice, company, accent);
        const columns = this.buildColumns(settings);
        this.drawItemsTable(doc, invoice, columns, accent, settings);
        this.drawTaxSummary(doc, invoice, accent);
        this.drawTotals(doc, invoice, accent);
        this.drawFooter(doc, invoice, company, settings, accent);

        // Applied last so page furniture is stamped onto every page, including
        // ones the table created while flowing.
        this.decoratePages(doc, invoice, company, options);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /** Points the document's font aliases at the family chosen in settings. */
  private static registerFonts(doc: PDFKit.PDFDocument, fontFamily: string | null): void {
    const family = FONT_FAMILIES[(fontFamily ?? '').toUpperCase()] ?? FONT_FAMILIES.HELVETICA;

    doc.registerFont(FONT.regular, family.regular);
    doc.registerFont(FONT.bold, family.bold);
  }

  // -------------------------------------------------------------------------
  // Sections
  // -------------------------------------------------------------------------

  private static drawHeader(
    doc: PDFKit.PDFDocument,
    invoice: InvoiceDetail,
    company: Awaited<ReturnType<typeof InvoiceService.getCompanyProfile>>,
    accent: string
  ): void {
    const top = MARGIN.top;

    doc
      .fillColor(accent)
      .font(FONT.bold)
      .fontSize(18)
      .text(company.name, MARGIN.left, top, { width: CONTENT_WIDTH * 0.58 });

    const addressLines = [
      company.address,
      [company.city, company.state, company.postalCode].filter(Boolean).join(', '),
      company.country,
      company.phone ? `Phone: ${company.phone}` : null,
      company.email
    ].filter(Boolean) as string[];

    doc.font(FONT.regular).fontSize(8.5).fillColor(INK.muted);
    let y = doc.y + 2;

    for (const line of addressLines) {
      doc.text(line, MARGIN.left, y, { width: CONTENT_WIDTH * 0.58 });
      y = doc.y;
    }

    const taxLines = [
      company.gstin ? `GSTIN: ${company.gstin}` : null,
      company.pan ? `PAN: ${company.pan}` : null
    ].filter(Boolean) as string[];

    if (taxLines.length) {
      doc.font(FONT.bold).fillColor(INK.text).fontSize(8.5);
      doc.text(taxLines.join('   |   '), MARGIN.left, y + 2, { width: CONTENT_WIDTH * 0.58 });
      y = doc.y;
    }

    // Title + meta block, right aligned against the header.
    const boxWidth = 220;
    const boxX = PAGE.width - MARGIN.right - boxWidth;

    const documentTitle = (invoice.billType || 'TAX_INVOICE').replace(/_/g, ' ').toUpperCase();

    doc
      .font(FONT.bold)
      .fontSize(18)
      .fillColor(INK.text)
      .text(documentTitle, boxX, top, { width: boxWidth, align: 'right' });

    const meta: Array<[string, string]> = [
      ['Bill / Inv No', invoice.invoiceNumber],
      ['Bill Date', formatDocumentDate(invoice.issueDate)],
      ['Due Date', formatDocumentDate(invoice.dueDate)]
    ];

    if (invoice.challanNo) {
      meta.push([
        'Challan No',
        invoice.challanDate
          ? `${invoice.challanNo} (${formatDocumentDate(invoice.challanDate)})`
          : invoice.challanNo
      ]);
    } else if (invoice.challanDate) {
      meta.push(['Challan Date', formatDocumentDate(invoice.challanDate)]);
    }

    if (invoice.poNumber) {
      meta.push([
        'Order No',
        invoice.orderDate
          ? `${invoice.poNumber} (${formatDocumentDate(invoice.orderDate)})`
          : invoice.poNumber
      ]);
    } else if (invoice.orderDate) {
      meta.push(['Order Date', formatDocumentDate(invoice.orderDate)]);
    }

    if (invoice.dcNo) {
      meta.push([
        'Your D.C. No',
        invoice.dcDate
          ? `${invoice.dcNo} (${formatDocumentDate(invoice.dcDate)})`
          : invoice.dcNo
      ]);
    } else if (invoice.dcDate) {
      meta.push(['Your D.C. Date', formatDocumentDate(invoice.dcDate)]);
    }

    if (invoice.reference) meta.push(['Reference', invoice.reference]);
    meta.push(['Status', this.statusLabel(invoice.status)]);

    let metaY = top + 26;

    for (const [label, value] of meta) {
      doc.font(FONT.regular).fontSize(8).fillColor(INK.subtle);
      doc.text(`${label}`, boxX, metaY, { width: boxWidth * 0.42, align: 'left' });

      doc.font(FONT.bold).fontSize(8).fillColor(INK.text);
      doc.text(value, boxX + boxWidth * 0.42, metaY, {
        width: boxWidth * 0.58,
        align: 'right'
      });

      metaY += 12;
    }

    const dividerY = Math.max(y, metaY) + 10;

    doc
      .moveTo(MARGIN.left, dividerY)
      .lineTo(PAGE.width - MARGIN.right, dividerY)
      .lineWidth(1.5)
      .strokeColor(accent)
      .stroke();

    doc.y = dividerY + 12;
  }

  private static drawPartyBlock(
    doc: PDFKit.PDFDocument,
    invoice: InvoiceDetail,
    company: Awaited<ReturnType<typeof InvoiceService.getCompanyProfile>>,
    accent: string
  ): void {
    const top = doc.y;
    const gap = 14;
    const colWidth = (CONTENT_WIDTH - gap) / 2;

    const billTo = [
      invoice.billingAddress,
      [invoice.billingCity, invoice.billingState, invoice.billingPostalCode]
        .filter(Boolean)
        .join(', '),
      invoice.billingCountry,
      invoice.billingPhone ? `Phone: ${invoice.billingPhone}` : null,
      invoice.billingEmail,
      invoice.billingGstin ? `GSTIN: ${invoice.billingGstin}` : null
    ].filter(Boolean) as string[];

    const dispatchLines: string[] = [];
    if (invoice.modeOfDispatch) dispatchLines.push(`Dispatch Mode: ${invoice.modeOfDispatch}`);
    if (invoice.lhNo) {
      dispatchLines.push(
        invoice.lhDate
          ? `LH No: ${invoice.lhNo} (Date: ${formatDocumentDate(invoice.lhDate)})`
          : `LH No: ${invoice.lhNo}`
      );
    }
    if (invoice.paymentTerms) dispatchLines.push(`Payment Terms: ${invoice.paymentTerms}`);

    const supplyDetails = [
      `Place of Supply: ${invoice.placeOfSupply ?? '-'}`,
      `Supply Type: ${invoice.isIgst ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}`,
      company.state ? `Supplier State: ${company.state}` : null,
      invoice.isReverseCharge ? 'Reverse Charge: Applicable' : 'Reverse Charge: Not Applicable',
      `Currency: ${invoice.currency}`,
      ...dispatchLines
    ].filter(Boolean) as string[];

    const heightOf = (lines: string[]) => 30 + lines.length * 11;
    const boxHeight = Math.max(heightOf(billTo), heightOf(supplyDetails));

    const drawBox = (x: number, title: string, heading: string | null, lines: string[]) => {
      doc.rect(x, top, colWidth, boxHeight).lineWidth(0.7).strokeColor(INK.border).stroke();
      doc.rect(x, top, colWidth, 16).fillColor(INK.band).fill();

      doc
        .font(FONT.bold)
        .fontSize(7.5)
        .fillColor(accent)
        .text(title.toUpperCase(), x + 8, top + 5, { width: colWidth - 16 });

      let lineY = top + 21;

      if (heading) {
        doc.font(FONT.bold).fontSize(9.5).fillColor(INK.text);
        doc.text(heading, x + 8, lineY, { width: colWidth - 16 });
        lineY = doc.y + 1;
      }

      doc.font(FONT.regular).fontSize(8).fillColor(INK.muted);
      for (const line of lines) {
        doc.text(line, x + 8, lineY, { width: colWidth - 16 });
        lineY = doc.y;
      }
    };

    drawBox(MARGIN.left, 'Bill To', invoice.billingName, billTo);
    drawBox(MARGIN.left + colWidth + gap, 'Dispatch & Supply Details', null, supplyDetails);

    doc.y = top + boxHeight + 14;
  }

  /** Column set depends on the settings toggles, so widths are derived, not fixed. */
  private static buildColumns(settings: InvoiceSettingsRecord): Column[] {
    const columns: Column[] = [
      { key: 'sr', label: '#', width: 22, align: 'left' },
      { key: 'name', label: 'Item & Description', width: 0, align: 'left' }
    ];

    if (settings.showHsnColumn) {
      columns.push({ key: 'hsn', label: 'HSN/SAC', width: 52, align: 'left' });
    }

    columns.push(
      { key: 'qty', label: 'Qty', width: 48, align: 'right' },
      { key: 'rate', label: 'Rate', width: 58, align: 'right' }
    );

    if (settings.showDiscount) {
      columns.push({ key: 'disc', label: 'Disc %', width: 40, align: 'right' });
    }

    columns.push(
      { key: 'taxable', label: 'Taxable', width: 62, align: 'right' },
      { key: 'tax', label: 'GST', width: 62, align: 'right' },
      { key: 'total', label: 'Amount', width: 68, align: 'right' }
    );

    // The description column absorbs whatever space the fixed ones leave.
    const fixed = columns.reduce((acc, column) => acc + column.width, 0);
    const flexible = columns.find((column) => column.key === 'name');
    if (flexible) flexible.width = CONTENT_WIDTH - fixed;

    return columns;
  }

  private static drawItemsTable(
    doc: PDFKit.PDFDocument,
    invoice: InvoiceDetail,
    columns: Column[],
    accent: string,
    settings: InvoiceSettingsRecord
  ): void {
    // "grid" rules every cell, "striped" shades alternate rows, "minimal"
    // leaves only the divider between rows.
    const tableStyle = ['grid', 'minimal', 'striped'].includes(settings.tableStyle)
      ? settings.tableStyle
      : 'grid';
    const drawHead = (y: number): number => {
      doc.rect(MARGIN.left, y, CONTENT_WIDTH, 20).fillColor(accent).fill();

      let x = MARGIN.left;
      doc.font(FONT.bold).fontSize(7.5).fillColor('#ffffff');

      for (const column of columns) {
        doc.text(column.label.toUpperCase(), x + 5, y + 6.5, {
          width: column.width - 10,
          align: column.align
        });
        x += column.width;
      }

      return y + 20;
    };

    let y = drawHead(doc.y);

    doc.font(FONT.regular).fontSize(8);

    invoice.items.forEach((item, index) => {
      const cells: Record<string, string> = {
        sr: String(index + 1),
        name: item.name,
        hsn: item.hsnSacCode || '-',
        qty: `${toNumber(item.quantity)} ${item.unit}`,
        rate: formatMoney(item.unitPrice, invoice.currency),
        disc: toNumber(item.discountPercent) ? `${toNumber(item.discountPercent)}%` : '-',
        taxable: formatMoney(item.taxableAmount, invoice.currency),
        tax: `${formatMoney(item.taxAmount, invoice.currency)}`,
        total: formatMoney(item.total, invoice.currency)
      };

      const nameColumn = columns.find((column) => column.key === 'name');
      const nameWidth = (nameColumn?.width ?? 160) - 10;

      // Measure before drawing so a wrapped description cannot overflow the row.
      const nameHeight = doc.heightOfString(item.name, { width: nameWidth });
      const descHeight = item.description
        ? doc.heightOfString(item.description, { width: nameWidth }) + 1
        : 0;
      const taxNoteHeight = toNumber(item.taxRate) ? 9 : 0;

      const rowHeight = Math.max(20, nameHeight + descHeight + 9, taxNoteHeight + 14);

      // Keep at least the totals band on the page with the last row.
      if (y + rowHeight > PAGE.height - MARGIN.bottom - 30) {
        doc.addPage();
        y = drawHead(MARGIN.top);
        doc.font(FONT.regular).fontSize(8);
      }

      if (tableStyle === 'striped' && index % 2 === 1) {
        doc.rect(MARGIN.left, y, CONTENT_WIDTH, rowHeight).fillColor(INK.zebra).fill();
      }

      if (tableStyle === 'grid') {
        // Vertical rules between the columns, which is what makes each GST
        // figure unambiguous on a printed copy.
        let ruleX = MARGIN.left;
        for (const column of columns) {
          ruleX += column.width;
          if (ruleX < PAGE.width - MARGIN.right) {
            doc
              .moveTo(ruleX, y)
              .lineTo(ruleX, y + rowHeight)
              .lineWidth(0.3)
              .strokeColor(INK.border)
              .stroke();
          }
        }
      }

      let x = MARGIN.left;

      for (const column of columns) {
        const value = cells[column.key] ?? '';

        if (column.key === 'name') {
          doc.font(FONT.bold).fontSize(8).fillColor(INK.text);
          doc.text(value, x + 5, y + 5, { width: column.width - 10 });

          if (item.description) {
            doc.font(FONT.regular).fontSize(7).fillColor(INK.subtle);
            doc.text(item.description, x + 5, doc.y, { width: column.width - 10 });
          }
        } else if (column.key === 'tax') {
          doc.font(FONT.regular).fontSize(8).fillColor(INK.text);
          doc.text(value, x + 5, y + 5, { width: column.width - 10, align: column.align });

          doc.font(FONT.regular).fontSize(6.5).fillColor(INK.subtle);
          doc.text(`@ ${toNumber(item.taxRate)}%`, x + 5, y + 14, {
            width: column.width - 10,
            align: column.align
          });
        } else {
          doc.font(FONT.regular).fontSize(8).fillColor(INK.text);
          doc.text(value, x + 5, y + 5, { width: column.width - 10, align: column.align });
        }

        x += column.width;
      }

      doc
        .moveTo(MARGIN.left, y + rowHeight)
        .lineTo(PAGE.width - MARGIN.right, y + rowHeight)
        .lineWidth(0.4)
        .strokeColor(INK.border)
        .stroke();

      y += rowHeight;
    });

    doc.y = y + 10;
  }

  /** The rate-wise GST table that a compliant invoice has to show. */
  private static drawTaxSummary(
    doc: PDFKit.PDFDocument,
    invoice: InvoiceDetail,
    accent: string
  ): void {
    const rows = buildTaxRateBreakdown(
      invoice.items.map((item) => ({
        quantity: toNumber(item.quantity),
        unitPrice: toNumber(item.unitPrice),
        discountPercent: toNumber(item.discountPercent),
        discountAmount: toNumber(item.discountAmount),
        taxRate: toNumber(item.taxRate),
        subtotal: toNumber(item.subtotal),
        taxableAmount: toNumber(item.taxableAmount),
        cgstRate: toNumber(item.cgstRate),
        cgstAmount: toNumber(item.cgstAmount),
        sgstRate: toNumber(item.sgstRate),
        sgstAmount: toNumber(item.sgstAmount),
        igstRate: toNumber(item.igstRate),
        igstAmount: toNumber(item.igstAmount),
        taxAmount: toNumber(item.taxAmount),
        total: toNumber(item.total)
      })) as ComputedTaxLine[]
    ).filter((row) => row.taxAmount !== 0);

    if (!rows.length) return;

    const tableWidth = CONTENT_WIDTH * 0.55;
    const columns = invoice.isIgst
      ? [
          { label: 'Rate', width: tableWidth * 0.18, align: 'left' as const },
          { label: 'Taxable', width: tableWidth * 0.32, align: 'right' as const },
          { label: 'IGST', width: tableWidth * 0.25, align: 'right' as const },
          { label: 'Total Tax', width: tableWidth * 0.25, align: 'right' as const }
        ]
      : [
          { label: 'Rate', width: tableWidth * 0.16, align: 'left' as const },
          { label: 'Taxable', width: tableWidth * 0.28, align: 'right' as const },
          { label: 'CGST', width: tableWidth * 0.18, align: 'right' as const },
          { label: 'SGST', width: tableWidth * 0.18, align: 'right' as const },
          { label: 'Total Tax', width: tableWidth * 0.2, align: 'right' as const }
        ];

    const needed = 24 + rows.length * 13;
    if (doc.y + needed > PAGE.height - MARGIN.bottom - 120) doc.addPage();

    const top = doc.y;

    doc
      .font(FONT.bold)
      .fontSize(7.5)
      .fillColor(accent)
      .text('GST BREAKDOWN', MARGIN.left, top);

    let y = doc.y + 3;

    doc.rect(MARGIN.left, y, tableWidth, 15).fillColor(INK.band).fill();

    let x = MARGIN.left;
    doc.font(FONT.bold).fontSize(7).fillColor(INK.text);

    for (const column of columns) {
      doc.text(column.label.toUpperCase(), x + 4, y + 4.5, {
        width: column.width - 8,
        align: column.align
      });
      x += column.width;
    }

    y += 15;

    for (const row of rows) {
      const values = invoice.isIgst
        ? [
            `${row.taxRate}%`,
            formatMoney(row.taxableAmount, invoice.currency),
            formatMoney(row.igstAmount, invoice.currency),
            formatMoney(row.taxAmount, invoice.currency)
          ]
        : [
            `${row.taxRate}%`,
            formatMoney(row.taxableAmount, invoice.currency),
            formatMoney(row.cgstAmount, invoice.currency),
            formatMoney(row.sgstAmount, invoice.currency),
            formatMoney(row.taxAmount, invoice.currency)
          ];

      x = MARGIN.left;
      doc.font(FONT.regular).fontSize(7.5).fillColor(INK.muted);

      values.forEach((value, index) => {
        const column = columns[index];
        if (!column) return;
        doc.text(value, x + 4, y + 3.5, { width: column.width - 8, align: column.align });
        x += column.width;
      });

      doc
        .moveTo(MARGIN.left, y + 13)
        .lineTo(MARGIN.left + tableWidth, y + 13)
        .lineWidth(0.3)
        .strokeColor(INK.border)
        .stroke();

      y += 13;
    }

    // Totals are drawn beside this block, so remember where the row started.
    doc.y = top;
    (doc as PDFKit.PDFDocument & { __taxSummaryBottom?: number }).__taxSummaryBottom = y + 6;
  }

  private static drawTotals(
    doc: PDFKit.PDFDocument,
    invoice: InvoiceDetail,
    accent: string
  ): void {
    const boxWidth = CONTENT_WIDTH * 0.42;
    const x = PAGE.width - MARGIN.right - boxWidth;
    const top = doc.y;

    const rows: Array<[string, string, boolean?]> = [
      ['Subtotal', formatMoney(invoice.subtotal, invoice.currency)]
    ];

    if (toNumber(invoice.discountAmount) > 0) {
      rows.push(['Discount', `- ${formatMoney(invoice.discountAmount, invoice.currency)}`]);
    }

    rows.push(['Taxable Value', formatMoney(invoice.taxableAmount, invoice.currency)]);

    if (invoice.isIgst) {
      rows.push(['IGST', formatMoney(invoice.igstAmount, invoice.currency)]);
    } else {
      rows.push(['CGST', formatMoney(invoice.cgstAmount, invoice.currency)]);
      rows.push(['SGST', formatMoney(invoice.sgstAmount, invoice.currency)]);
    }

    if (toNumber(invoice.roundOff) !== 0) {
      rows.push(['Round Off', formatMoney(invoice.roundOff, invoice.currency)]);
    }

    let y = top;
    doc.fontSize(8.5);

    for (const [label, value] of rows) {
      doc.font(FONT.regular).fillColor(INK.muted);
      doc.text(label, x, y, { width: boxWidth * 0.5 });

      doc.font(FONT.regular).fillColor(INK.text);
      doc.text(value, x + boxWidth * 0.5, y, { width: boxWidth * 0.5, align: 'right' });

      y += 13;
    }

    // Grand total band.
    doc.rect(x, y + 2, boxWidth, 22).fillColor(accent).fill();
    doc.font(FONT.bold).fontSize(9.5).fillColor('#ffffff');
    doc.text('Grand Total', x + 8, y + 8.5, { width: boxWidth * 0.5 });
    doc.text(formatMoney(invoice.grandTotal, invoice.currency), x + boxWidth * 0.5 - 8, y + 8.5, {
      width: boxWidth * 0.5,
      align: 'right'
    });

    y += 28;

    const settled: Array<[string, string, string]> = [];

    if (toNumber(invoice.amountPaid) > 0) {
      settled.push(['Amount Paid', formatMoney(invoice.amountPaid, invoice.currency), '#047857']);
    }

    if (toNumber(invoice.creditNoteTotal) > 0) {
      settled.push([
        'Credit Notes',
        `- ${formatMoney(invoice.creditNoteTotal, invoice.currency)}`,
        INK.muted
      ]);
    }

    if (toNumber(invoice.debitNoteTotal) > 0) {
      settled.push([
        'Debit Notes',
        formatMoney(invoice.debitNoteTotal, invoice.currency),
        INK.muted
      ]);
    }

    if (settled.length || toNumber(invoice.balanceDue) > 0) {
      settled.push([
        'Balance Due',
        formatMoney(invoice.balanceDue, invoice.currency),
        toNumber(invoice.balanceDue) > 0 ? INK.danger : '#047857'
      ]);
    }

    for (const [label, value, color] of settled) {
      const isBalance = label === 'Balance Due';
      doc.font(isBalance ? FONT.bold : FONT.regular).fontSize(8.5).fillColor(INK.muted);
      doc.text(label, x, y, { width: boxWidth * 0.5 });

      doc.font(FONT.bold).fillColor(color);
      doc.text(value, x + boxWidth * 0.5, y, { width: boxWidth * 0.5, align: 'right' });

      y += 13;
    }

    const taxBottom =
      (doc as PDFKit.PDFDocument & { __taxSummaryBottom?: number }).__taxSummaryBottom ?? top;

    doc.y = Math.max(y, taxBottom) + 8;

    // Amount in words spans the full width, under both columns.
    doc
      .font(FONT.regular)
      .fontSize(7.5)
      .fillColor(INK.subtle)
      .text('Amount in Words', MARGIN.left, doc.y);

    doc
      .font(FONT.bold)
      .fontSize(8.5)
      .fillColor(INK.text)
      .text(amountInWords(invoice.grandTotal, invoice.currency), MARGIN.left, doc.y + 1, {
        width: CONTENT_WIDTH
      });

    doc.y += 8;
  }

  private static drawFooter(
    doc: PDFKit.PDFDocument,
    invoice: InvoiceDetail,
    company: Awaited<ReturnType<typeof InvoiceService.getCompanyProfile>>,
    settings: InvoiceSettingsRecord,
    accent: string
  ): void {
    // The whole payment block is one setting: a business that does not want
    // its account number on the document gets none of it, UPI included.
    const bankLines = settings.showBankDetails
      ? ([
          company.bankName ? `Bank: ${company.bankName}` : null,
          company.accountHolder ? `A/c Name: ${company.accountHolder}` : null,
          company.accountNumber ? `A/c No: ${company.accountNumber}` : null,
          company.ifscCode ? `IFSC: ${company.ifscCode}` : null,
          company.branch ? `Branch: ${company.branch}` : null,
          company.upiId ? `UPI: ${company.upiId}` : null
        ].filter(Boolean) as string[])
      : [];

    const acceptedMethods =
      settings.showBankDetails && company.acceptedPaymentMethods.length
        ? company.acceptedPaymentMethods
            .map((method) => method.replace(/_/g, ' ').toLowerCase())
            .join(', ')
        : null;

    const blocks: Array<{ title: string; body: string[] }> = [];

    if (bankLines.length) blocks.push({ title: 'Payment Details', body: bankLines });

    const paymentNotes = [
      acceptedMethods ? `We accept: ${acceptedMethods}.` : null,
      settings.showBankDetails ? company.paymentInstructions : null
    ].filter(Boolean) as string[];

    if (paymentNotes.length) blocks.push({ title: 'How To Pay', body: paymentNotes });
    if (invoice.notes) blocks.push({ title: 'Notes', body: [invoice.notes] });
    if (invoice.terms) blocks.push({ title: 'Terms & Conditions', body: [invoice.terms] });

    const estimated = blocks.reduce(
      (acc, block) => acc + 16 + block.body.length * 10,
      settings.showSignature ? 70 : 20
    );

    if (doc.y + estimated > PAGE.height - MARGIN.bottom) doc.addPage();

    doc
      .moveTo(MARGIN.left, doc.y)
      .lineTo(PAGE.width - MARGIN.right, doc.y)
      .lineWidth(0.7)
      .strokeColor(INK.border)
      .stroke();

    doc.y += 8;

    const columnWidth = CONTENT_WIDTH * 0.62;
    const blockTop = doc.y;

    for (const block of blocks) {
      doc
        .font(FONT.bold)
        .fontSize(7.5)
        .fillColor(accent)
        .text(block.title.toUpperCase(), MARGIN.left, doc.y, { width: columnWidth });

      doc.font(FONT.regular).fontSize(7.5).fillColor(INK.muted);
      for (const line of block.body) {
        doc.text(line, MARGIN.left, doc.y + 1, { width: columnWidth });
      }

      doc.y += 6;
    }

    if (settings.showSignature) {
      const signWidth = CONTENT_WIDTH * 0.32;
      const onLeft = settings.signaturePosition === 'left';

      // The text aligns to the same edge the block sits on, so a left-hand
      // signature does not end up floating away from its own rule.
      const signX = onLeft ? MARGIN.left : PAGE.width - MARGIN.right - signWidth;
      const align: 'left' | 'right' = onLeft ? 'left' : 'right';

      doc
        .font(FONT.regular)
        .fontSize(7.5)
        .fillColor(INK.muted)
        .text(`For ${company.name}`, signX, blockTop, { width: signWidth, align });

      const lineY = blockTop + 46;

      doc
        .moveTo(signX, lineY)
        .lineTo(signX + signWidth, lineY)
        .lineWidth(0.5)
        .strokeColor(INK.border)
        .stroke();

      doc
        .font(FONT.bold)
        .fontSize(7.5)
        .fillColor(INK.text)
        .text('Authorised Signatory', signX, lineY + 4, { width: signWidth, align });

      doc.y = Math.max(doc.y, lineY + 16);
    }

    if (settings.footerNote) {
      doc
        .font(FONT.regular)
        .fontSize(7)
        .fillColor(INK.subtle)
        .text(settings.footerNote, MARGIN.left, doc.y + 6, {
          width: CONTENT_WIDTH,
          align: 'center'
        });
    }
  }

  /**
   * Page furniture applied after the content is laid out: watermark, page
   * numbers and the computer-generated note. Done in a second pass because the
   * total page count is only known once everything has flowed.
   */
  private static decoratePages(
    doc: PDFKit.PDFDocument,
    invoice: InvoiceDetail,
    company: Awaited<ReturnType<typeof InvoiceService.getCompanyProfile>>,
    options: PdfOptions
  ): void {
    const range = doc.bufferedPageRange();

    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(range.start + index);

      if (options.watermark) {
        doc.save();
        doc.rotate(-38, { origin: [PAGE.width / 2, PAGE.height / 2] });
        doc
          .font(FONT.bold)
          .fontSize(78)
          .fillColor(options.watermark === 'CANCELLED' ? INK.danger : INK.subtle)
          .opacity(0.1)
          .text(options.watermark, 0, PAGE.height / 2 - 50, {
            width: PAGE.width,
            align: 'center'
          });
        doc.opacity(1).restore();
      }

      const footerY = PAGE.height - MARGIN.bottom + 16;

      doc
        .font(FONT.regular)
        .fontSize(6.5)
        .fillColor(INK.subtle)
        .text(
          `${company.name}  •  Invoice ${invoice.invoiceNumber}  •  This is a computer generated invoice.`,
          MARGIN.left,
          footerY,
          { width: CONTENT_WIDTH * 0.75 }
        );

      doc.text(
        `Page ${index + 1} of ${range.count}`,
        PAGE.width - MARGIN.right - 90,
        footerY,
        { width: 90, align: 'right' }
      );

      if (options.copyLabel) {
        doc
          .font(FONT.bold)
          .fontSize(6.5)
          .fillColor(INK.subtle)
          .text(options.copyLabel.toUpperCase(), MARGIN.left, footerY - 10, {
            width: CONTENT_WIDTH,
            align: 'right'
          });
      }
    }

    // Leaving the cursor on a flushed page would append a stray blank one.
    doc.flushPages();
  }

  private static statusLabel(status: InvoiceStatus): string {
    return status
      .split('_')
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ');
  }

  /** Guards against a stored theme colour that PDFKit would reject. */
  private static safeColor(value: string | null | undefined, fallback: string): string {
    return value && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : fallback;
  }
}
