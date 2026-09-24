import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { InvoiceStatus } from '@prisma/client';
import { InvoiceService, InvoiceDetail } from './invoice.js';
import { InvoiceSettingsService, InvoiceSettingsRecord } from './invoiceSettings.js';
import { amountInWords, toNumber } from '../utils/money.js';
import { resolveState } from '../constants/gst.js';
import { AppError } from '../utils/error.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FONT_REGULAR = path.resolve(__dirname, '../assets/fonts/Poppins-Regular.ttf');
const FONT_MEDIUM = path.resolve(__dirname, '../assets/fonts/Poppins-Medium.ttf');
const FONT_SEMIBOLD = path.resolve(__dirname, '../assets/fonts/Poppins-SemiBold.ttf');
const FONT_BOLD = path.resolve(__dirname, '../assets/fonts/Poppins-Bold.ttf');

const hasCustomFonts = fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD);

const FONT = {
  regular: hasCustomFonts ? 'Poppins' : 'Helvetica',
  medium: hasCustomFonts ? 'Poppins-Medium' : 'Helvetica',
  semiBold: hasCustomFonts ? 'Poppins-SemiBold' : 'Helvetica-Bold',
  bold: hasCustomFonts ? 'Poppins-Bold' : 'Helvetica-Bold'
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { left: 28, right: 28, bottom: 25 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right; // 539.28 pt
const TOP_LETTERPAD_SPACE = 80; // ~28-30 mm blank space at top for company letterpad
const FOOTER_HEIGHT = 168;
const FOOTER_Y = PAGE.height - MARGIN.bottom - FOOTER_HEIGHT; // 841.89 - 25 - 168 = 648.89 pt

const COLORS = {
  primaryBlue: '#1e40af', // Royal Blue
  skyBlue: '#0284c7', // Sky Blue Accent
  skyBlueLight: '#e0f2fe',
  headerTint: '#f0f7ff',
  textDark: '#111827', // Crisp dark text
  textBody: '#374151',
  textMuted: '#6b7280', // Secondary text
  textLightGrey: '#9ca3af', // Light grey for Authorised Signatory
  border: '#94a3b8', // Thin professional border
  borderLight: '#cbd5e1',
  white: '#ffffff'
};

export interface PdfOptions {
  watermark?: string | null;
  copyLabel?: string | null;
}

const formatDateDDMMYYYY = (value: Date | string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
};

const formatIndianNumber = (num: number): string => {
  const parts = Math.abs(num).toFixed(2).split('.');
  const intPart = parts[0];
  const decPart = parts[1];

  let lastThree = intPart.slice(-3);
  const otherNumbers = intPart.slice(0, -3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const formattedInt = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
  return `${num < 0 ? '-' : ''}${formattedInt}.${decPart}`;
};

const formatPdfMoney = (amount: unknown, showSymbol = false): string => {
  const num = toNumber(amount as string | number | null | undefined);
  const formatted = formatIndianNumber(num);
  return showSymbol ? `₹ ${formatted}` : formatted;
};

const sanitizeFilename = (name: string): string => {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-');
};

export class PdfService {
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

    if (invoice.items.length > 8) {
      throw AppError.badRequest(
        'This invoice contains too many items to fit on one page. Please reduce the number of items or enable multi-page invoices.'
      );
    }

    const watermark =
      options.watermark ??
      (invoice.status === InvoiceStatus.CANCELLED
        ? 'CANCELLED'
        : invoice.status === InvoiceStatus.DRAFT
          ? 'DRAFT'
          : null);

    const buffer = await this.draw(invoice, company, settings, { ...options, watermark });

    const safeCustomer = sanitizeFilename(invoice.billingName || 'Customer');
    const safeInvNum = sanitizeFilename(invoice.invoiceNumber || 'INV');
    const fileName = `${safeInvNum}-${safeCustomer}.pdf`;

    return {
      buffer,
      fileName,
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
        margin: 0,
        bufferPages: true,
        info: {
          Title: `Tax Invoice ${invoice.invoiceNumber}`,
          Author: company.name,
          Subject: `Tax Invoice for ${invoice.billingName}`
        }
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      try {
        if (hasCustomFonts) {
          doc.registerFont('Poppins', FONT_REGULAR);
          doc.registerFont('Poppins-Medium', FONT_MEDIUM);
          doc.registerFont('Poppins-SemiBold', FONT_SEMIBOLD);
          doc.registerFont('Poppins-Bold', FONT_BOLD);
        }

        const resolvedCompanyState = resolveState(company.state);
        const companyGstin = (company.gstin || '').trim();
        const companyStateCode = companyGstin.length >= 2 ? companyGstin.slice(0, 2) : (resolvedCompanyState?.code || '—');
        const companyStateName = (resolvedCompanyState?.name || company.state || 'GUJARAT').toUpperCase();

        const resolvedCustState = resolveState(invoice.billingState);
        const custGstin = (invoice.billingGstin || '').trim();
        const custStateCode = custGstin.length >= 2 
          ? custGstin.slice(0, 2) 
          : (invoice.placeOfSupplyCode || resolvedCustState?.code || '—');

        let y = TOP_LETTERPAD_SPACE; // ~28-30 mm blank space at top for physical letterhead

        // 1. TAX INVOICE Title
        doc
          .font(FONT.bold)
          .fontSize(14)
          .fillColor(COLORS.textDark)
          .text('TAX INVOICE', MARGIN.left, y, {
            width: CONTENT_WIDTH,
            align: 'center'
          });

        y += 20;

        // 2. Company GST Header (Royal Blue banner)
        const headerBarHeight = 18;
        doc
          .rect(MARGIN.left, y, CONTENT_WIDTH, headerBarHeight)
          .fillColor(COLORS.primaryBlue)
          .fill();

        doc
          .font(FONT.bold)
          .fontSize(8)
          .fillColor(COLORS.white);

        // Left: GSTIN
        doc.text(`GSTIN: ${companyGstin || '—'}`, MARGIN.left + 8, y + 4.5, {
          width: 200,
          align: 'left'
        });

        // Center: State Name
        doc.text(companyStateName, MARGIN.left, y + 4.5, {
          width: CONTENT_WIDTH,
          align: 'center'
        });

        // Right: State Code
        doc.text(`STATE CODE: ${companyStateCode}`, MARGIN.left, y + 4.5, {
          width: CONTENT_WIDTH - 8,
          align: 'right'
        });

        y += headerBarHeight;

        // 3. Customer + Invoice Details (Bordered Table Grid)
        const detailsBoxHeight = 90;
        const col1Width = 195; // Bill To
        const col2Width = 172; // Invoice / Document Info
        const col3Width = CONTENT_WIDTH - col1Width - col2Width; // 172.28 pt - Dates / Vehicle

        // Outer Border
        doc
          .rect(MARGIN.left, y, CONTENT_WIDTH, detailsBoxHeight)
          .lineWidth(0.6)
          .strokeColor(COLORS.border)
          .stroke();

        // Vertical Divider after Bill To (Col 1)
        doc
          .moveTo(MARGIN.left + col1Width, y)
          .lineTo(MARGIN.left + col1Width, y + detailsBoxHeight)
          .lineWidth(0.6)
          .strokeColor(COLORS.border)
          .stroke();

        // Vertical Divider after Doc Info (Col 2)
        doc
          .moveTo(MARGIN.left + col1Width + col2Width, y)
          .lineTo(MARGIN.left + col1Width + col2Width, y + detailsBoxHeight)
          .lineWidth(0.6)
          .strokeColor(COLORS.border)
          .stroke();

        // Column 1: Bill To
        const c1X = MARGIN.left + 6;
        let c1Y = y + 5;
        doc.font(FONT.bold).fontSize(7.5).fillColor(COLORS.primaryBlue).text('TO.', c1X, c1Y);
        c1Y += 10;

        doc.font(FONT.bold).fontSize(8).fillColor(COLORS.textDark).text(invoice.billingName || '—', c1X, c1Y, {
          width: col1Width - 12,
          lineBreak: true
        });
        c1Y = doc.y + 1.5;

        const addressParts = [
          invoice.billingAddress,
          [invoice.billingCity, invoice.billingState, invoice.billingPostalCode].filter(Boolean).join(', ')
        ].filter(Boolean);

        doc.font(FONT.regular).fontSize(7).fillColor(COLORS.textBody);
        for (const addr of addressParts) {
          doc.text(addr as string, c1X, c1Y, { width: col1Width - 12, lineBreak: true });
          c1Y = doc.y + 1;
        }

        doc.font(FONT.bold).fontSize(7.5).fillColor(COLORS.textDark);
        doc.text(`GSTIN: ${custGstin || 'URP'}`, c1X, y + detailsBoxHeight - 21);
        doc.text(`State Code: ${custStateCode}`, c1X, y + detailsBoxHeight - 11);

        // Columns 2 & 3: Table Grid with horizontal row dividers
        const numRows = 5;
        const rowHeight = detailsBoxHeight / numRows; // 18 pt per row

        const col2Rows: Array<[string, string]> = [
          ['Bill No.', `${invoice.invoiceNumber}`],
          ['DC Number', `${invoice.dcNo || invoice.challanNo || '—'}`],
          ['Order No.', `${invoice.poNumber || '—'}`],
          ['LR No.', `${invoice.lhNo || '—'}`],
          ['Mode of Dispatch', `${invoice.modeOfDispatch || '—'}`]
        ];

        const col3Rows: Array<[string, string]> = [
          ['Bill Date', `${formatDateDDMMYYYY(invoice.issueDate)}`],
          ['DC Date', `${formatDateDDMMYYYY(invoice.dcDate || invoice.challanDate)}`],
          ['Order Date', `${formatDateDDMMYYYY(invoice.orderDate)}`],
          ['LR Date', `${formatDateDDMMYYYY(invoice.lhDate)}`],
          ['Vehicle No.', `${invoice.reference || '—'}`]
        ];

        // Draw horizontal table grid lines in Col 2 & Col 3
        for (let r = 1; r < numRows; r++) {
          const lineY = y + r * rowHeight;
          doc
            .moveTo(MARGIN.left + col1Width, lineY)
            .lineTo(MARGIN.left + CONTENT_WIDTH, lineY)
            .lineWidth(0.4)
            .strokeColor(COLORS.borderLight)
            .stroke();
        }

        // Render Col 2 Row Cells
        const c2StartX = MARGIN.left + col1Width;
        const c2LabelWidth = 72;
        for (let r = 0; r < numRows; r++) {
          const rowY = y + r * rowHeight;
          const [label, val] = col2Rows[r];

          // Label
          doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.textMuted);
          doc.text(label, c2StartX + 6, rowY + 4.5, { width: c2LabelWidth - 8 });

          // Value
          doc.font(FONT.bold).fontSize(7.5).fillColor(COLORS.textDark);
          doc.text(`: ${val}`, c2StartX + c2LabelWidth, rowY + 4.5, { width: col2Width - c2LabelWidth - 6 });
        }

        // Render Col 3 Row Cells
        const c3StartX = MARGIN.left + col1Width + col2Width;
        const c3LabelWidth = 58;
        for (let r = 0; r < numRows; r++) {
          const rowY = y + r * rowHeight;
          const [label, val] = col3Rows[r];

          // Label
          doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.textMuted);
          doc.text(label, c3StartX + 6, rowY + 4.5, { width: c3LabelWidth - 8 });

          // Value
          doc.font(FONT.bold).fontSize(7.5).fillColor(COLORS.textDark);
          doc.text(`: ${val}`, c3StartX + c3LabelWidth, rowY + 4.5, { width: col3Width - c3LabelWidth - 6 });
        }

        y += detailsBoxHeight;

        // 4. Product Table
        const tableCols = [
          { label: 'Sr.', width: 26, align: 'center' as const },
          { label: 'Description of Goods', width: 206.28, align: 'left' as const },
          { label: 'HSN/SAC', width: 58, align: 'center' as const },
          { label: 'Qty', width: 44, align: 'right' as const },
          { label: 'Units', width: 42, align: 'center' as const },
          { label: 'Rate', width: 68, align: 'right' as const },
          { label: 'Amount', width: 95, align: 'right' as const }
        ];

        const tableHeadHeight = 17;
        doc
          .rect(MARGIN.left, y, CONTENT_WIDTH, tableHeadHeight)
          .fillColor(COLORS.primaryBlue)
          .fill();

        let headX = MARGIN.left;
        doc.font(FONT.bold).fontSize(7.5).fillColor(COLORS.white);
        for (const col of tableCols) {
          doc.text(col.label, headX + 3, y + 4.5, {
            width: col.width - 6,
            align: col.align
          });
          headX += col.width;
        }

        y += tableHeadHeight;
        const tableBodyStartY = y;
        const tableEndY = FOOTER_Y; // Stretches center table all the way down to footer top

        // Draw items
        const itemRows = invoice.items;
        let currentItemY = y;

        for (let i = 0; i < itemRows.length; i++) {
          const item = itemRows[i];
          const qty = toNumber(item.quantity);
          const rate = toNumber(item.unitPrice);
          const lineAmount = qty * rate;

          const descWidth = tableCols[1].width - 8;
          doc.font(FONT.bold).fontSize(7.5);
          const nameHeight = doc.heightOfString(item.name, { width: descWidth });
          const descHeight = item.description
            ? doc.font(FONT.regular).fontSize(6.5).heightOfString(item.description, { width: descWidth })
            : 0;

          const itemRowHeight = Math.max(18, nameHeight + descHeight + 6);

          let cellX = MARGIN.left;

          // 1. Sr
          doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.textDark);
          doc.text(String(i + 1), cellX + 2, currentItemY + 4, {
            width: tableCols[0].width - 4,
            align: 'center'
          });
          cellX += tableCols[0].width;

          // 2. Description
          doc.font(FONT.bold).fontSize(7.5).fillColor(COLORS.textDark);
          doc.text(item.name, cellX + 4, currentItemY + 4, {
            width: descWidth
          });
          if (item.description) {
            doc.font(FONT.regular).fontSize(6.5).fillColor(COLORS.textMuted);
            doc.text(item.description, cellX + 4, doc.y + 1, {
              width: descWidth
            });
          }
          cellX += tableCols[1].width;

          // 3. HSN/SAC
          doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.textDark);
          doc.text(item.hsnSacCode || '—', cellX + 2, currentItemY + 4, {
            width: tableCols[2].width - 4,
            align: 'center'
          });
          cellX += tableCols[2].width;

          // 4. Qty
          doc.text(String(qty), cellX + 2, currentItemY + 4, {
            width: tableCols[3].width - 4,
            align: 'right'
          });
          cellX += tableCols[3].width;

          // 5. Units
          doc.text(item.unit || 'PCS', cellX + 2, currentItemY + 4, {
            width: tableCols[4].width - 4,
            align: 'center'
          });
          cellX += tableCols[4].width;

          // 6. Rate
          doc.text(formatPdfMoney(rate), cellX + 2, currentItemY + 4, {
            width: tableCols[5].width - 4,
            align: 'right'
          });
          cellX += tableCols[5].width;

          // 7. Amount
          doc.font(FONT.bold).fontSize(7.5).fillColor(COLORS.textDark);
          doc.text(formatPdfMoney(lineAmount), cellX + 2, currentItemY + 4, {
            width: tableCols[6].width - 4,
            align: 'right'
          });

          currentItemY += itemRowHeight;

          // Horizontal row divider
          doc
            .moveTo(MARGIN.left, currentItemY)
            .lineTo(MARGIN.left + CONTENT_WIDTH, currentItemY)
            .lineWidth(0.4)
            .strokeColor(COLORS.borderLight)
            .stroke();
        }

        // Draw Table Grid Borders (Outer & Column Dividers stretching to FOOTER_Y)
        doc
          .rect(MARGIN.left, tableBodyStartY, CONTENT_WIDTH, tableEndY - tableBodyStartY)
          .lineWidth(0.6)
          .strokeColor(COLORS.border)
          .stroke();

        let gridColX = MARGIN.left;
        for (let c = 0; c < tableCols.length - 1; c++) {
          gridColX += tableCols[c].width;
          doc
            .moveTo(gridColX, tableBodyStartY - tableHeadHeight)
            .lineTo(gridColX, tableEndY)
            .lineWidth(0.4)
            .strokeColor(COLORS.border)
            .stroke();
        }

        y = tableEndY;

        // 5. Footer (Two Columns: Left = Payment Info Table Grid, Right = Totals Table Grid)
        const footLeftWidth = 318;
        const footRightWidth = CONTENT_WIDTH - footLeftWidth; // 221.28 pt

        // Footer Outer Border
        doc
          .rect(MARGIN.left, y, CONTENT_WIDTH, FOOTER_HEIGHT)
          .lineWidth(0.6)
          .strokeColor(COLORS.border)
          .stroke();

        // Footer Middle Vertical Divider
        doc
          .moveTo(MARGIN.left + footLeftWidth, y)
          .lineTo(MARGIN.left + footLeftWidth, y + FOOTER_HEIGHT)
          .lineWidth(0.6)
          .strokeColor(COLORS.border)
          .stroke();

        // --- Left Column: Structured Table Grid ---
        const flX = MARGIN.left + 6;
        const footLeftInnerWidth = footLeftWidth - 12;

        // Row 1: Header PAYMENT INFO
        const payHeadH = 17;
        doc
          .rect(MARGIN.left, y, footLeftWidth, payHeadH)
          .fillColor(COLORS.headerTint)
          .fill();

        doc
          .moveTo(MARGIN.left, y + payHeadH)
          .lineTo(MARGIN.left + footLeftWidth, y + payHeadH)
          .lineWidth(0.4)
          .strokeColor(COLORS.borderLight)
          .stroke();

        doc.font(FONT.bold).fontSize(7.5).fillColor(COLORS.primaryBlue).text('PAYMENT INFO', flX, y + 4.5);

        // Row 2: Bank Details Box
        const bankBoxY = y + payHeadH;
        const bankBoxH = 46;
        doc.font(FONT.bold).fontSize(7.5).fillColor(COLORS.textDark).text('Bank Details:', flX, bankBoxY + 3.5);

        const bankDetails = [
          `Bank Name: ${company.bankName || '—'}`,
          `A/C No.: ${company.accountNumber || '—'}`,
          `IFSC Code: ${company.ifscCode || '—'}`,
          `Branch Name: ${company.branch || '—'}`
        ];

        doc.font(FONT.regular).fontSize(7).fillColor(COLORS.textBody);
        let bY = bankBoxY + 13.5;
        for (const bd of bankDetails) {
          doc.text(bd, flX, bY, { width: footLeftInnerWidth });
          bY += 8;
        }

        // Divider below Bank Details
        doc
          .moveTo(MARGIN.left, bankBoxY + bankBoxH)
          .lineTo(MARGIN.left + footLeftWidth, bankBoxY + bankBoxH)
          .lineWidth(0.4)
          .strokeColor(COLORS.borderLight)
          .stroke();

        // Row 3: Rupees in Words Box
        const rupeesBoxY = bankBoxY + bankBoxH;
        const rupeesBoxH = 26;
        doc.font(FONT.bold).fontSize(7.5).fillColor(COLORS.textDark).text('Rupees:', flX, rupeesBoxY + 3);

        const inWordsText = amountInWords(invoice.grandTotal, invoice.currency).replace(/^Rupees\s+/i, '');
        doc.font(FONT.regular).fontSize(7).fillColor(COLORS.textBody).text(inWordsText, flX, rupeesBoxY + 12.5, {
          width: footLeftInnerWidth
        });

        // Divider below Rupees
        doc
          .moveTo(MARGIN.left, rupeesBoxY + rupeesBoxH)
          .lineTo(MARGIN.left + footLeftWidth, rupeesBoxY + rupeesBoxH)
          .lineWidth(0.4)
          .strokeColor(COLORS.borderLight)
          .stroke();

        // Row 4: Terms & Conditions Box
        const termsBoxY = rupeesBoxY + rupeesBoxH;
        const termsBoxH = 63;
        doc.font(FONT.bold).fontSize(7.5).fillColor(COLORS.textDark).text('Terms & Conditions:', flX, termsBoxY + 3.5);

        const termsText = invoice.terms || settings.defaultTerms || '1. Goods once sold will not be taken back.\n2. Subject to local jurisdiction.';
        doc.font(FONT.regular).fontSize(6.5).fillColor(COLORS.textMuted).text(termsText, flX, termsBoxY + 13.5, {
          width: footLeftInnerWidth,
          lineBreak: true
        });

        // Divider below Terms
        doc
          .moveTo(MARGIN.left, termsBoxY + termsBoxH)
          .lineTo(MARGIN.left + footLeftWidth, termsBoxY + termsBoxH)
          .lineWidth(0.4)
          .strokeColor(COLORS.borderLight)
          .stroke();

        // Row 5: PAN No. Bottom Cell
        const panBoxY = termsBoxY + termsBoxH;
        doc.font(FONT.bold).fontSize(7.5).fillColor(COLORS.textDark).text(
          `PAN No.: ${company.pan || '—'}`,
          flX,
          panBoxY + 3.5
        );

        // --- Right Column: Totals Table Grid & Signature Block ---
        const frStartX = MARGIN.left + footLeftWidth;
        const frX = frStartX + 6;
        const frWidth = footRightWidth - 12;

        const subtotal = toNumber(invoice.subtotal);
        const discountAmount = toNumber(invoice.discountAmount);
        const extraCharges = toNumber((invoice as any).extraCharges);
        const cgstAmount = toNumber(invoice.cgstAmount);
        const sgstAmount = toNumber(invoice.sgstAmount);
        const igstAmount = toNumber(invoice.igstAmount);
        const roundOff = toNumber(invoice.roundOff);
        const grandTotal = toNumber(invoice.grandTotal);

        const firstItemWithTax = invoice.items.find((it) => toNumber(it.taxRate) > 0);
        const baseTaxRate = firstItemWithTax ? toNumber(firstItemWithTax.taxRate) : (invoice.isIgst ? 18 : 18);
        const halfRate = baseTaxRate / 2;

        const totalRows: Array<{ label: string; value: string }> = [
          { label: 'Total', value: formatPdfMoney(subtotal, true) }
        ];

        if (discountAmount > 0) {
          totalRows.push({
            label: 'Discount:',
            value: `- ${formatPdfMoney(discountAmount, true)}`
          });
        }

        if (invoice.isIgst) {
          totalRows.push({
            label: `IGST (${baseTaxRate}%):`,
            value: formatPdfMoney(igstAmount, true)
          });
        } else {
          totalRows.push({
            label: `CGST (${halfRate}%):`,
            value: formatPdfMoney(cgstAmount, true)
          });
          totalRows.push({
            label: `SGST (${halfRate}%):`,
            value: formatPdfMoney(sgstAmount, true)
          });
        }

        if (extraCharges > 0) {
          totalRows.push({
            label: 'Extra Charges:',
            value: formatPdfMoney(extraCharges, true)
          });
        }

        if (roundOff !== 0) {
          totalRows.push({
            label: 'Round Off:',
            value: formatPdfMoney(roundOff, true)
          });
        }

        const totalsRowH = 17;
        let rightRowY = y;

        for (const row of totalRows) {
          doc.font(FONT.regular).fontSize(7.5).fillColor(COLORS.textBody);
          doc.text(row.label, frX, rightRowY + 4.5, { width: frWidth * 0.5 });
          doc.text(row.value, frX, rightRowY + 4.5, { width: frWidth, align: 'right' });

          rightRowY += totalsRowH;

          // Horizontal row divider
          doc
            .moveTo(frStartX, rightRowY)
            .lineTo(MARGIN.left + CONTENT_WIDTH, rightRowY)
            .lineWidth(0.4)
            .strokeColor(COLORS.borderLight)
            .stroke();
        }

        // Grand Total Box (Royal Blue Banner)
        const grandTotalBoxH = 20;
        doc
          .rect(frStartX, rightRowY, footRightWidth, grandTotalBoxH)
          .fillColor(COLORS.primaryBlue)
          .fill();

        doc.font(FONT.bold).fontSize(8.5).fillColor(COLORS.white);
        doc.text('Grand Total:', frX, rightRowY + 5.5, { width: frWidth * 0.5 });
        doc.text(formatPdfMoney(grandTotal, true), frX, rightRowY + 5.5, {
          width: frWidth,
          align: 'right'
        });

        rightRowY += grandTotalBoxH;

        // Horizontal line below Grand Total
        doc
          .moveTo(frStartX, rightRowY)
          .lineTo(MARGIN.left + CONTENT_WIDTH, rightRowY)
          .lineWidth(0.4)
          .strokeColor(COLORS.borderLight)
          .stroke();

        // Signature Block (Below Grand Total in structured cell)
        const signTopY = rightRowY + 6;
        doc
          .font(FONT.bold)
          .fontSize(7.5)
          .fillColor(COLORS.textDark)
          .text(`For, ${company.name}`, frX, signTopY, {
            width: frWidth,
            align: 'right'
          });

        const signLabelY = y + FOOTER_HEIGHT - 12;
        doc
          .font(FONT.regular)
          .fontSize(7.5)
          .fillColor(COLORS.textLightGrey)
          .text('Authorised Signatory', frX, signLabelY, {
            width: frWidth,
            align: 'right'
          });

        // Watermark if applicable
        if (options.watermark) {
          doc.save();
          doc.rotate(-35, { origin: [PAGE.width / 2, PAGE.height / 2] });
          doc
            .font(FONT.bold)
            .fontSize(70)
            .fillColor(options.watermark === 'CANCELLED' ? '#ef4444' : '#94a3b8')
            .opacity(0.12)
            .text(options.watermark, 0, PAGE.height / 2 - 40, {
              width: PAGE.width,
              align: 'center'
            });
          doc.opacity(1).restore();
        }

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}
