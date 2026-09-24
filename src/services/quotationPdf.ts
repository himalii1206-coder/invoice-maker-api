import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { QuotationStatus } from '@prisma/client';
import { QuotationService } from './quotation.js';
import { InvoiceService } from './invoice.js';
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
const TOP_LETTERPAD_SPACE = 60;
const FOOTER_HEIGHT = 160;
const FOOTER_Y = PAGE.height - MARGIN.bottom - FOOTER_HEIGHT;

const COLORS = {
  primary: '#111827',
  primaryDark: '#000000',
  headerTint: '#f8fafc',
  textDark: '#111827',
  textBody: '#374151',
  textMuted: '#64748b',
  border: '#94a3b8',
  borderLight: '#cbd5e1',
  white: '#ffffff'
};

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

export class QuotationPdfService {
  static async render(
    companyId: string,
    quotationId: string
  ): Promise<{ buffer: Buffer; fileName: string; quotation: any }> {
    const [quotation, company, settings] = await Promise.all([
      QuotationService.getById(companyId, quotationId),
      InvoiceService.getCompanyProfile(companyId),
      InvoiceSettingsService.getOrCreate(companyId)
    ]);

    const watermark =
      quotation.status === QuotationStatus.CANCELLED
        ? 'CANCELLED'
        : quotation.status === QuotationStatus.REJECTED
        ? 'REJECTED'
        : quotation.status === QuotationStatus.EXPIRED
        ? 'EXPIRED'
        : quotation.status === QuotationStatus.DRAFT
        ? 'DRAFT'
        : null;

    const buffer = await this.draw(quotation, company, settings, watermark);

    const safeCustomer = sanitizeFilename(quotation.billingName || 'Customer');
    const safeQNum = sanitizeFilename(quotation.quotationNumber || 'QT');
    const fileName = `${safeQNum}-${safeCustomer}.pdf`;

    return {
      buffer,
      fileName,
      quotation
    };
  }

  private static draw(
    quotation: any,
    company: any,
    settings: InvoiceSettingsRecord,
    watermark: string | null
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 0,
        bufferPages: true,
        info: {
          Title: `Quotation ${quotation.quotationNumber}`,
          Author: company.name,
          Subject: `Quotation for ${quotation.billingName}`
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

        let y = TOP_LETTERPAD_SPACE;

        // 1. Company Header (if name present)
        if (company.name) {
          doc
            .font(FONT.bold)
            .fontSize(16)
            .fillColor(COLORS.primary)
            .text(company.name.toUpperCase(), MARGIN.left, y, {
              width: CONTENT_WIDTH,
              align: 'center'
            });
          y += 20;

          if (company.address || company.city) {
            const compAddr = [company.address, company.city, company.state, company.postalCode]
              .filter(Boolean)
              .join(', ');
            doc
              .font(FONT.regular)
              .fontSize(8.5)
              .fillColor(COLORS.textMuted)
              .text(compAddr, MARGIN.left, y, { width: CONTENT_WIDTH, align: 'center' });
            y += 12;
          }

          if (company.gstin || company.phone || company.email) {
            const contactLine = [
              company.gstin ? `GSTIN: ${company.gstin}` : null,
              company.phone ? `Phone: ${company.phone}` : null,
              company.email ? `Email: ${company.email}` : null
            ]
              .filter(Boolean)
              .join(' | ');
            doc
              .font(FONT.regular)
              .fontSize(8)
              .fillColor(COLORS.textMuted)
              .text(contactLine, MARGIN.left, y, { width: CONTENT_WIDTH, align: 'center' });
            y += 15;
          }
        }

        // 2. Document Title
        doc
          .font(FONT.bold)
          .fontSize(13)
          .fillColor(COLORS.textDark)
          .text('QUOTATION / ESTIMATE', MARGIN.left, y, {
            width: CONTENT_WIDTH,
            align: 'center'
          });
        y += 18;

        // 3. Header Grid Details (Two Column Border Box)
        const boxX = MARGIN.left;
        const boxY = y;
        const boxWidth = CONTENT_WIDTH;
        const colWidth = boxWidth / 2;
        const boxHeight = 110;

        doc.rect(boxX, boxY, boxWidth, boxHeight).strokeColor(COLORS.border).lineWidth(0.8).stroke();
        doc.moveTo(boxX + colWidth, boxY).lineTo(boxX + colWidth, boxY + boxHeight).stroke();

        // Left Side: Customer / M/S
        let leftY = boxY + 6;
        doc
          .font(FONT.bold)
          .fontSize(8.5)
          .fillColor(COLORS.textMuted)
          .text('M/S (CUSTOMER DETAILS):', boxX + 8, leftY);
        leftY += 12;

        doc
          .font(FONT.bold)
          .fontSize(9.5)
          .fillColor(COLORS.textDark)
          .text(quotation.billingName, boxX + 8, leftY, { width: colWidth - 16 });
        leftY += 14;

        if (quotation.billingAddress) {
          doc
            .font(FONT.regular)
            .fontSize(8.5)
            .fillColor(COLORS.textBody)
            .text(quotation.billingAddress, boxX + 8, leftY, { width: colWidth - 16, height: 35 });
          leftY += 36;
        }

        if (quotation.billingGstin) {
          doc
            .font(FONT.medium)
            .fontSize(8.5)
            .fillColor(COLORS.textDark)
            .text(`GSTIN: ${quotation.billingGstin}`, boxX + 8, leftY);
        }

        // Right Side: Quotation Metadata
        let rightY = boxY + 6;
        const rLabelX = boxX + colWidth + 8;
        const rValX = boxX + colWidth + 90;
        const rValWidth = colWidth - 98;

        const drawMetaRow = (label: string, value: string | null | undefined, isBold = false) => {
          if (!value) return;
          doc.font(FONT.medium).fontSize(8.5).fillColor(COLORS.textMuted).text(label, rLabelX, rightY);
          doc
            .font(isBold ? FONT.bold : FONT.regular)
            .fontSize(8.5)
            .fillColor(COLORS.textDark)
            .text(value, rValX, rightY, { width: rValWidth });
          rightY += 13;
        };

        drawMetaRow('Quotation No:', quotation.quotationNumber, true);
        drawMetaRow('Quotation Date:', formatDateDDMMYYYY(quotation.quotationDate));
        if (quotation.validUntil) {
          drawMetaRow('Valid Until:', formatDateDDMMYYYY(quotation.validUntil));
        }
        if (quotation.inquiryNumber) {
          drawMetaRow('Inquiry No:', quotation.inquiryNumber);
        }
        if (quotation.inquiryDate) {
          drawMetaRow('Inquiry Date:', formatDateDDMMYYYY(quotation.inquiryDate));
        }
        if (quotation.referenceNumber) {
          drawMetaRow('Ref. No:', quotation.referenceNumber);
        }
        if (quotation.paymentTerms) {
          drawMetaRow('Payment Terms:', quotation.paymentTerms, true);
        }

        y = boxY + boxHeight + 8;

        // Subject line (if present)
        if (quotation.subject) {
          doc
            .font(FONT.bold)
            .fontSize(9)
            .fillColor(COLORS.textDark)
            .text(`Subject: `, MARGIN.left, y, { continued: true })
            .font(FONT.medium)
            .text(quotation.subject);
          y += 16;
        }

        // 4. Line Items Table
        const tableY = y;
        const COL = {
          sr: { x: MARGIN.left, width: 26 },
          desc: { x: MARGIN.left + 26, width: 225 },
          hsn: { x: MARGIN.left + 251, width: 55 },
          qty: { x: MARGIN.left + 306, width: 45 },
          unit: { x: MARGIN.left + 351, width: 38 },
          rate: { x: MARGIN.left + 389, width: 65 },
          amount: { x: MARGIN.left + 454, width: 85 }
        };

        const tableHeaderHeight = 20;

        // Header Background
        doc
          .rect(MARGIN.left, tableY, CONTENT_WIDTH, tableHeaderHeight)
          .fillColor(COLORS.headerTint)
          .fill();

        doc
          .rect(MARGIN.left, tableY, CONTENT_WIDTH, tableHeaderHeight)
          .strokeColor(COLORS.border)
          .lineWidth(0.8)
          .stroke();

        // Header Text
        doc.font(FONT.bold).fontSize(8).fillColor(COLORS.textDark);
        doc.text('SR', COL.sr.x, tableY + 5, { width: COL.sr.width, align: 'center' });
        doc.text('ITEM DESCRIPTION', COL.desc.x + 5, tableY + 5, { width: COL.desc.width - 5 });
        doc.text('HSN/SAC', COL.hsn.x, tableY + 5, { width: COL.hsn.width, align: 'center' });
        doc.text('QTY', COL.qty.x, tableY + 5, { width: COL.qty.width, align: 'right' });
        doc.text('UNIT', COL.unit.x, tableY + 5, { width: COL.unit.width, align: 'center' });
        doc.text('RATE (₹)', COL.rate.x, tableY + 5, { width: COL.rate.width, align: 'right' });
        doc.text('AMOUNT (₹)', COL.amount.x, tableY + 5, { width: COL.amount.width - 5, align: 'right' });

        let currentY = tableY + tableHeaderHeight;
        const rowHeight = 22;

        quotation.items.forEach((item: any, idx: number) => {
          doc
            .rect(MARGIN.left, currentY, CONTENT_WIDTH, rowHeight)
            .strokeColor(COLORS.borderLight)
            .lineWidth(0.5)
            .stroke();

          doc.font(FONT.regular).fontSize(8.5).fillColor(COLORS.textDark);
          doc.text(String(idx + 1), COL.sr.x, currentY + 5, { width: COL.sr.width, align: 'center' });
          doc.text(item.name, COL.desc.x + 5, currentY + 5, { width: COL.desc.width - 10, ellipsis: true });
          doc.text(item.hsnSacCode || '—', COL.hsn.x, currentY + 5, { width: COL.hsn.width, align: 'center' });
          doc.text(formatIndianNumber(toNumber(item.quantity)), COL.qty.x, currentY + 5, {
            width: COL.qty.width,
            align: 'right'
          });
          doc.text(item.unit || 'PCS', COL.unit.x, currentY + 5, { width: COL.unit.width, align: 'center' });
          doc.text(formatPdfMoney(item.rate), COL.rate.x, currentY + 5, {
            width: COL.rate.width,
            align: 'right'
          });
          doc.font(FONT.medium).text(formatPdfMoney(item.subtotal || item.amount), COL.amount.x, currentY + 5, {
            width: COL.amount.width - 5,
            align: 'right'
          });

          currentY += rowHeight;
        });

        // 5. Totals & Tax Breakdown Block
        const totalsY = Math.max(currentY + 10, FOOTER_Y - 40);
        const totalsBoxX = MARGIN.left + CONTENT_WIDTH - 240;
        const totalsWidth = 240;

        let tY = totalsY;

        const drawTotalRow = (label: string, value: string, isBold = false, isHighlight = false) => {
          if (isHighlight) {
            doc.rect(totalsBoxX, tY - 2, totalsWidth, 18).fillColor(COLORS.headerTint).fill();
            doc.rect(totalsBoxX, tY - 2, totalsWidth, 18).strokeColor(COLORS.primary).lineWidth(0.8).stroke();
          }
          doc
            .font(isBold ? FONT.bold : FONT.regular)
            .fontSize(isBold ? 9.5 : 8.5)
            .fillColor(isHighlight ? COLORS.primary : COLORS.textDark)
            .text(label, totalsBoxX + 6, tY, { width: 130 });

          doc
            .font(isBold ? FONT.bold : FONT.medium)
            .fontSize(isBold ? 9.5 : 8.5)
            .fillColor(isHighlight ? COLORS.primary : COLORS.textDark)
            .text(value, totalsBoxX + 130, tY, { width: totalsWidth - 136, align: 'right' });
          tY += 15;
        };

        drawTotalRow('Subtotal / Total:', `₹ ${formatPdfMoney(quotation.subtotal)}`);
        if (toNumber(quotation.discountAmount) > 0) {
          drawTotalRow('Discount:', `- ₹ ${formatPdfMoney(quotation.discountAmount)}`);
        }
        if (quotation.isIgst) {
          drawTotalRow('IGST:', `₹ ${formatPdfMoney(quotation.igstAmount)}`);
        } else {
          drawTotalRow('CGST:', `₹ ${formatPdfMoney(quotation.cgstAmount)}`);
          drawTotalRow('SGST:', `₹ ${formatPdfMoney(quotation.sgstAmount)}`);
        }

        if (toNumber(quotation.forwardingPackagingAmount) > 0) {
          drawTotalRow('Forwarding & Pkg:', `₹ ${formatPdfMoney(quotation.forwardingPackagingAmount)}`);
        }

        if (toNumber(quotation.secondTotal) > 0 && toNumber(quotation.secondTotal) !== toNumber(quotation.grandTotal)) {
          drawTotalRow('Second Total:', `₹ ${formatPdfMoney(quotation.secondTotal)}`);
        }

        if (toNumber(quotation.roundOff) !== 0) {
          drawTotalRow('Round Off:', `₹ ${formatPdfMoney(quotation.roundOff)}`);
        }

        drawTotalRow('GRAND TOTAL:', `₹ ${formatPdfMoney(quotation.grandTotal)}`, true, true);

        // Left Side of Summary: Amount in words & Notes / Terms
        let notesY = totalsY;
        const notesWidth = CONTENT_WIDTH - totalsWidth - 20;

        const grandTotalWords = amountInWords(toNumber(quotation.grandTotal));
        doc
          .font(FONT.bold)
          .fontSize(8.5)
          .fillColor(COLORS.textDark)
          .text('Amount in Words: ', MARGIN.left, notesY, { continued: true })
          .font(FONT.regular)
          .fillColor(COLORS.textBody)
          .text(grandTotalWords, { width: notesWidth });
        notesY += 28;

        if (quotation.terms) {
          doc
            .font(FONT.bold)
            .fontSize(8.5)
            .fillColor(COLORS.textDark)
            .text('Terms & Conditions:', MARGIN.left, notesY);
          notesY += 12;

          doc
            .font(FONT.regular)
            .fontSize(8)
            .fillColor(COLORS.textMuted)
            .text(quotation.terms, MARGIN.left, notesY, { width: notesWidth, height: 45 });
        }

        // 6. Signatory / Footer Block
        const signY = PAGE.height - MARGIN.bottom - 45;
        doc
          .font(FONT.bold)
          .fontSize(8.5)
          .fillColor(COLORS.textDark)
          .text(`For, ${company.name || 'Company'}`, MARGIN.left + CONTENT_WIDTH - 180, signY, {
            width: 180,
            align: 'center'
          });

        doc
          .font(FONT.regular)
          .fontSize(8)
          .fillColor(COLORS.textMuted)
          .text('Authorised Signatory', MARGIN.left + CONTENT_WIDTH - 180, signY + 30, {
            width: 180,
            align: 'center'
          });

        // 7. Watermark if present
        if (watermark) {
          doc.save();
          doc.opacity(0.12);
          doc.rotate(-30, { origin: [PAGE.width / 2, PAGE.height / 2] });
          doc
            .font(FONT.bold)
            .fontSize(72)
            .fillColor(COLORS.textMuted)
            .text(watermark, 0, PAGE.height / 2 - 36, {
              width: PAGE.width,
              align: 'center'
            });
          doc.restore();
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}
