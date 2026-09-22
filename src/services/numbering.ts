import { Prisma, DocumentType, NumberResetMode } from '@prisma/client';
import { prisma } from '../config/database.js';
import { financialYearOf } from '../utils/date.js';
import { InvoiceSettingsService, InvoiceSettingsRecord } from './invoiceSettings.js';
import { AppError } from '../utils/error.js';

/**
 * Document numbering.
 *
 * Invoice numbers have to be gapless, unique per business and never reused -
 * they are the legal identity of the document. Two requests creating invoices
 * at the same instant must not be able to agree on the same number, so the
 * counter lives in its own row and is advanced with a single atomic
 * `increment`. The row is keyed by (business, document type, period) so a
 * yearly or monthly reset is a different counter rather than a reset of the
 * same one.
 */

/** How many times to retry when a concurrent writer wins the race. */
const MAX_ATTEMPTS = 5;

export interface AllocatedNumber {
  number: string;
  sequenceNo: number;
  financialYear: string;
  periodKey: string;
}

const prefixFor = (settings: InvoiceSettingsRecord, documentType: DocumentType): string => {
  switch (documentType) {
    case DocumentType.CREDIT_NOTE:
      return settings.creditNotePrefix;
    case DocumentType.DEBIT_NOTE:
      return settings.debitNotePrefix;
    default:
      return settings.invoicePrefix;
  }
};

/**
 * The counter bucket a date falls into. `NEVER` uses one bucket for all time,
 * which is what keeps a single running series unbroken.
 */
const periodKeyFor = (resetMode: NumberResetMode, date: Date): string => {
  switch (resetMode) {
    case NumberResetMode.FINANCIAL_YEAR:
      return financialYearOf(date);
    case NumberResetMode.YEARLY:
      return String(date.getUTCFullYear());
    case NumberResetMode.MONTHLY:
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    case NumberResetMode.NEVER:
    default:
      return 'ALL';
  }
};

/** The year segment shown inside the number, when enabled. */
const yearTokenFor = (resetMode: NumberResetMode, date: Date): string => {
  switch (resetMode) {
    case NumberResetMode.MONTHLY:
      return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    case NumberResetMode.YEARLY:
      return String(date.getUTCFullYear());
    case NumberResetMode.FINANCIAL_YEAR:
    case NumberResetMode.NEVER:
    default:
      return financialYearOf(date);
  }
};

export class NumberingService {
  /**
   * Renders a number without consuming one - used by the create form so the
   * user sees what they are about to get. Deliberately not authoritative: the
   * real number is allocated when the document is saved.
   */
  static async preview(
    companyId: string,
    documentType: DocumentType = DocumentType.INVOICE,
    date: Date = new Date()
  ): Promise<{ number: string; sequenceNo: number }> {
    const settings = await InvoiceSettingsService.getOrCreate(companyId);
    const periodKey = periodKeyFor(settings.resetMode, date);

    const sequence = await prisma.documentSequence.findUnique({
      where: {
        companyId_documentType_periodKey: { companyId, documentType, periodKey }
      },
      select: { nextNumber: true }
    });

    const sequenceNo = sequence?.nextNumber ?? Math.max(1, settings.startNumber);

    return {
      number: this.format(settings, documentType, sequenceNo, date),
      sequenceNo
    };
  }

  /**
   * Allocates the next number, advancing the counter.
   *
   * Must run inside the same transaction that writes the document, otherwise a
   * failed insert burns a number and leaves a gap in the series.
   */
  static async allocate(
    tx: Prisma.TransactionClient,
    companyId: string,
    documentType: DocumentType,
    date: Date = new Date()
  ): Promise<AllocatedNumber> {
    const settings = await InvoiceSettingsService.getOrCreate(companyId, tx);
    const periodKey = periodKeyFor(settings.resetMode, date);
    const startNumber = Math.max(1, settings.startNumber);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const sequenceNo = await this.claimNext(tx, companyId, documentType, periodKey, startNumber);
      const number = this.format(settings, documentType, sequenceNo, date);

      // A number can already exist if it was typed in by hand on an earlier
      // document. Skip it rather than fail the save.
      const clash = await this.isTaken(tx, companyId, documentType, number);
      if (!clash) {
        return {
          number,
          sequenceNo,
          financialYear: financialYearOf(date),
          periodKey
        };
      }
    }

    throw AppError.conflict(
      'Could not allocate a unique document number. Please review your numbering settings.'
    );
  }

  /**
   * Advances the counter by one and returns the value claimed.
   *
   * `upsert` + `increment` is a single statement, so concurrent callers are
   * serialised by the row lock and can never be handed the same value.
   */
  private static async claimNext(
    tx: Prisma.TransactionClient,
    companyId: string,
    documentType: DocumentType,
    periodKey: string,
    startNumber: number
  ): Promise<number> {
    const sequence = await tx.documentSequence.upsert({
      where: {
        companyId_documentType_periodKey: { companyId, documentType, periodKey }
      },
      // On create we store the *next* value, so the number claimed now is
      // `startNumber` and the row already points past it.
      create: { companyId, documentType, periodKey, nextNumber: startNumber + 1 },
      update: { nextNumber: { increment: 1 } },
      select: { nextNumber: true }
    });

    return sequence.nextNumber - 1;
  }

  private static async isTaken(
    tx: Prisma.TransactionClient,
    companyId: string,
    documentType: DocumentType,
    number: string
  ): Promise<boolean> {
    if (documentType === DocumentType.INVOICE) {
      const existing = await tx.invoice.findUnique({
        where: { companyId_invoiceNumber: { companyId, invoiceNumber: number } },
        select: { id: true }
      });
      return Boolean(existing);
    }

    const existing = await tx.creditDebitNote.findUnique({
      where: { companyId_noteNumber: { companyId, noteNumber: number } },
      select: { id: true }
    });
    return Boolean(existing);
  }

  /** prefix - [year] - padded sequence - [suffix], e.g. "INV-2026-27-0001". */
  static format(
    settings: InvoiceSettingsRecord,
    documentType: DocumentType,
    sequenceNo: number,
    date: Date = new Date()
  ): string {
    const separator = settings.numberSeparator ?? '-';
    const padding = Math.min(Math.max(settings.numberPadding ?? 4, 1), 12);

    const segments: string[] = [prefixFor(settings, documentType)];

    if (settings.includeYearInNumber) {
      segments.push(yearTokenFor(settings.resetMode, date));
    }

    segments.push(String(sequenceNo).padStart(padding, '0'));

    if (settings.invoiceSuffix) {
      segments.push(settings.invoiceSuffix);
    }

    return segments.filter((segment) => segment !== '').join(separator);
  }

  /**
   * Keeps the counter ahead of a manually entered number, so the next
   * auto-generated one does not collide with it.
   */
  static async reserveManualNumber(
    tx: Prisma.TransactionClient,
    companyId: string,
    documentType: DocumentType,
    sequenceNo: number,
    date: Date = new Date()
  ): Promise<void> {
    if (!Number.isFinite(sequenceNo) || sequenceNo <= 0) return;

    const settings = await InvoiceSettingsService.getOrCreate(companyId, tx);
    const periodKey = periodKeyFor(settings.resetMode, date);

    const existing = await tx.documentSequence.findUnique({
      where: { companyId_documentType_periodKey: { companyId, documentType, periodKey } },
      select: { nextNumber: true }
    });

    if (!existing) {
      await tx.documentSequence.create({
        data: { companyId, documentType, periodKey, nextNumber: sequenceNo + 1 }
      });
      return;
    }

    if (existing.nextNumber <= sequenceNo) {
      await tx.documentSequence.update({
        where: { companyId_documentType_periodKey: { companyId, documentType, periodKey } },
        data: { nextNumber: sequenceNo + 1 }
      });
    }
  }

  /**
   * Allocates a directory code such as `CUST-0001` or `PRD-0042`.
   *
   * Customers and products are not legal documents, so these codes need to be
   * unique and readable rather than gapless. They share the sequence table -
   * with a single `ALL` bucket, since a customer code must never restart with
   * the financial year - so the same atomic increment keeps two simultaneous
   * creates from colliding.
   */
  static async allocateEntityCode(
    tx: Prisma.TransactionClient,
    companyId: string,
    documentType: Extract<DocumentType, 'CUSTOMER' | 'PRODUCT'>,
    prefix: string,
    padding = 4
  ): Promise<string> {
    const cleanPrefix = (prefix || '').trim().toUpperCase();
    const sequenceNo = await this.claimNext(tx, companyId, documentType, 'ALL', 1);
    const padded = String(sequenceNo).padStart(Math.min(Math.max(padding, 1), 10), '0');

    return cleanPrefix ? `${cleanPrefix}-${padded}` : padded;
  }

  /** Digits at the tail of a manual number, used to keep the counter aligned. */
  static extractSequenceNo = (number: string): number => {
    const match = number.match(/(\d+)\s*$/);
    return match?.[1] ? Number.parseInt(match[1], 10) : 0;
  };
}
