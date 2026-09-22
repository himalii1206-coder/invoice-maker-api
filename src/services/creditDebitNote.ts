import { Prisma, NoteType, NoteStatus, DocumentType, ActivityType } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../utils/error.js';
import { PaginationMeta } from '../types/index.js';
import { Decimalish, round2, toNumber } from '../utils/money.js';
import { startOfDay, endOfDay, financialYearOf, today } from '../utils/date.js';
import { computeDocument, resolveSupply, TaxLineInput, ComputedTaxLine } from './tax.js';
import { NumberingService } from './numbering.js';
import { InvoiceSettingsService } from './invoiceSettings.js';
import { InvoiceService } from './invoice.js';
import { ActivityService } from './activity.js';

/**
 * Credit and debit notes.
 *
 * One service handles both because they are the same document with opposite
 * sign: a credit note reduces what the customer owes (a return, a discount
 * agreed after the fact, an overcharge), a debit note increases it (an
 * undercharge, extra freight). Splitting them into two near-identical services
 * would double the surface area of the GST logic for no benefit - the type is
 * carried as a field, and only numbering and wording branch on it.
 *
 * A note only moves money once it is ISSUED. Drafts are freely editable and are
 * invisible to the linked invoice's balance.
 */

export interface NoteItemInput {
  productId?: string | null;
  name: string;
  description?: string | null;
  hsnSacCode?: string | null;
  unit?: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number;
  taxRate?: number;
}

export interface CreateNoteInput {
  noteType: NoteType;
  customerId: string;
  /** Optional: a note can stand alone or be tied to an invoice. */
  invoiceId?: string | null;
  noteDate?: string | Date;
  reason?: string | null;
  placeOfSupply?: string | null;
  notes?: string | null;
  status?: Extract<NoteStatus, 'DRAFT' | 'ISSUED'>;
  items: NoteItemInput[];
}

export type UpdateNoteInput = Partial<Omit<CreateNoteInput, 'noteType'>>;

export interface ListNotesQuery {
  page: number;
  limit: number;
  search?: string;
  noteType?: NoteType;
  status?: NoteStatus;
  customerId?: string;
  invoiceId?: string;
  financialYear?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy: 'noteDate' | 'noteNumber' | 'grandTotal' | 'createdAt';
  sortOrder: 'asc' | 'desc';
}

interface RawNoteItem {
  productId?: string | null;
  name: string;
  description?: string | null;
  hsnSacCode?: string | null;
  unit?: string | null;
  quantity: Decimalish;
  unitPrice: Decimalish;
  discountPercent?: Decimalish;
  taxRate?: Decimalish;
}

interface NormalisedNoteItem extends TaxLineInput {
  productId: string | null;
  name: string;
  description: string | null;
  hsnSacCode: string | null;
  unit: string;
}

const noteListSelect = {
  id: true,
  noteType: true,
  noteNumber: true,
  status: true,
  noteDate: true,
  financialYear: true,
  reason: true,
  billingName: true,
  billingGstin: true,
  placeOfSupply: true,
  isIgst: true,
  subtotal: true,
  discountAmount: true,
  taxableAmount: true,
  cgstAmount: true,
  sgstAmount: true,
  igstAmount: true,
  taxAmount: true,
  roundOff: true,
  grandTotal: true,
  issuedAt: true,
  createdAt: true,
  updatedAt: true,
  customerId: true,
  invoiceId: true,
  customer: { select: { id: true, name: true, type: true, email: true } },
  invoice: { select: { id: true, invoiceNumber: true, grandTotal: true, status: true } }
} satisfies Prisma.CreditDebitNoteSelect;

const noteDetailSelect = {
  ...noteListSelect,
  sequenceNo: true,
  billingAddress: true,
  billingState: true,
  placeOfSupplyCode: true,
  notes: true,
  items: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      productId: true,
      name: true,
      description: true,
      hsnSacCode: true,
      unit: true,
      sortOrder: true,
      quantity: true,
      unitPrice: true,
      discountPercent: true,
      discountAmount: true,
      taxRate: true,
      subtotal: true,
      taxableAmount: true,
      cgstRate: true,
      cgstAmount: true,
      sgstRate: true,
      sgstAmount: true,
      igstRate: true,
      igstAmount: true,
      taxAmount: true,
      total: true
    }
  }
} satisfies Prisma.CreditDebitNoteSelect;

export type NoteDetail = Prisma.CreditDebitNoteGetPayload<{ select: typeof noteDetailSelect }>;

const documentTypeFor = (noteType: NoteType): DocumentType =>
  noteType === NoteType.CREDIT ? DocumentType.CREDIT_NOTE : DocumentType.DEBIT_NOTE;

const labelFor = (noteType: NoteType): string =>
  noteType === NoteType.CREDIT ? 'Credit note' : 'Debit note';

export class CreditDebitNoteService {
  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  static async list(companyId: string, query: ListNotesQuery) {
    const where: Prisma.CreditDebitNoteWhereInput = {
      companyId,
      ...(query.noteType && { noteType: query.noteType }),
      ...(query.status && { status: query.status }),
      ...(query.customerId && { customerId: query.customerId }),
      ...(query.invoiceId && { invoiceId: query.invoiceId }),
      ...(query.financialYear && { financialYear: query.financialYear }),
      ...((query.dateFrom || query.dateTo) && {
        noteDate: {
          ...(query.dateFrom && { gte: startOfDay(query.dateFrom) }),
          ...(query.dateTo && { lte: endOfDay(query.dateTo) })
        }
      }),
      ...(query.search && {
        OR: [
          { noteNumber: { contains: query.search, mode: 'insensitive' as const } },
          { billingName: { contains: query.search, mode: 'insensitive' as const } },
          { reason: { contains: query.search, mode: 'insensitive' as const } },
          { invoice: { invoiceNumber: { contains: query.search, mode: 'insensitive' as const } } }
        ]
      })
    };

    const skip = (query.page - 1) * query.limit;

    const [notes, total, totals] = await prisma.$transaction([
      prisma.creditDebitNote.findMany({
        where,
        select: noteListSelect,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip,
        take: query.limit
      }),
      prisma.creditDebitNote.count({ where }),
      prisma.creditDebitNote.aggregate({ where, _sum: { grandTotal: true, taxAmount: true } })
    ]);

    const totalPages = Math.ceil(total / query.limit);

    const meta: PaginationMeta = {
      page: query.page,
      limit: query.limit,
      total,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPrevPage: query.page > 1
    };

    return {
      notes,
      meta,
      summary: {
        totalAmount: round2(totals._sum.grandTotal ?? 0),
        totalTax: round2(totals._sum.taxAmount ?? 0)
      }
    };
  }

  static async getById(companyId: string, id: string): Promise<NoteDetail> {
    const note = await prisma.creditDebitNote.findFirst({
      where: { id, companyId },
      select: noteDetailSelect
    });

    if (!note) throw AppError.notFound('Note not found');
    return note;
  }

  /** Totals for the notes dashboard, split by type. */
  static async summary(companyId: string, financialYear?: string) {
    const rows = await prisma.creditDebitNote.groupBy({
      by: ['noteType', 'status'],
      where: { companyId, ...(financialYear && { financialYear }) },
      orderBy: { noteType: 'asc' },
      _count: true,
      _sum: { grandTotal: true, taxAmount: true }
    });

    const pick = (noteType: NoteType, status?: NoteStatus) =>
      rows
        .filter((row) => row.noteType === noteType && (!status || row.status === status))
        .reduce(
          (acc, row) => ({
            count: acc.count + row._count,
            amount: round2(acc.amount + toNumber(row._sum?.grandTotal ?? 0)),
            tax: round2(acc.tax + toNumber(row._sum?.taxAmount ?? 0))
          }),
          { count: 0, amount: 0, tax: 0 }
        );

    return {
      credit: { total: pick(NoteType.CREDIT), issued: pick(NoteType.CREDIT, NoteStatus.ISSUED) },
      debit: { total: pick(NoteType.DEBIT), issued: pick(NoteType.DEBIT, NoteStatus.ISSUED) }
    };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  static async create(
    companyId: string,
    input: CreateNoteInput,
    context: { userId?: string; ipAddress?: string | null } = {}
  ): Promise<NoteDetail> {
    if (!input.items?.length) {
      throw AppError.badRequest(`A ${labelFor(input.noteType).toLowerCase()} needs at least one line item`);
    }

    const [company, customer, settings] = await Promise.all([
      InvoiceService.getCompanyProfile(companyId),
      this.getCustomer(companyId, input.customerId),
      InvoiceSettingsService.getOrCreate(companyId)
    ]);

    const linkedInvoice = input.invoiceId
      ? await this.getLinkableInvoice(companyId, input.invoiceId, input.customerId)
      : null;

    const noteDate = startOfDay(input.noteDate ?? new Date());

    if (noteDate > today()) {
      throw AppError.badRequest('Note date cannot be in the future');
    }

    // A linked note inherits the invoice's tax treatment, so the reversal
    // matches the original document rather than the customer's current address.
    const supply = linkedInvoice
      ? {
          isIgst: linkedInvoice.isIgst,
          placeOfSupply: linkedInvoice.placeOfSupply,
          placeOfSupplyCode: linkedInvoice.placeOfSupplyCode
        }
      : resolveSupply(company.state, customer.state, input.placeOfSupply);

    const computed = computeDocument(this.normaliseItems(input.items), {
      isIgst: supply.isIgst,
      enableRoundOff: settings.enableRoundOff
    });

    if (linkedInvoice && input.noteType === NoteType.CREDIT) {
      this.assertCreditFitsInvoice(linkedInvoice, computed.grandTotal);
    }

    const status = input.status === NoteStatus.ISSUED ? NoteStatus.ISSUED : NoteStatus.DRAFT;

    const created = await prisma.$transaction(
      async (tx) => {
        const numbering = await NumberingService.allocate(
          tx,
          companyId,
          documentTypeFor(input.noteType),
          noteDate
        );

        const note = await tx.creditDebitNote.create({
          data: {
            companyId,
            customerId: customer.id,
            invoiceId: linkedInvoice?.id ?? null,
            noteType: input.noteType,
            noteNumber: numbering.number,
            sequenceNo: numbering.sequenceNo,
            financialYear: numbering.financialYear,
            status,
            noteDate,
            reason: input.reason ?? null,

            billingName: customer.name,
            billingGstin: customer.gstin,
            billingAddress: customer.address,
            billingState: customer.state,
            placeOfSupply: supply.placeOfSupply,
            placeOfSupplyCode: supply.placeOfSupplyCode,
            isIgst: supply.isIgst,

            subtotal: computed.subtotal,
            discountAmount: computed.discountAmount,
            taxableAmount: computed.taxableAmount,
            cgstAmount: computed.cgstAmount,
            sgstAmount: computed.sgstAmount,
            igstAmount: computed.igstAmount,
            taxAmount: computed.taxAmount,
            roundOff: computed.roundOff,
            grandTotal: computed.grandTotal,

            notes: input.notes ?? null,
            issuedAt: status === NoteStatus.ISSUED ? new Date() : null,

            items: { create: this.buildItemRows(computed.lines) }
          },
          select: { id: true, noteNumber: true }
        });

        // Only an issued note moves the invoice's balance.
        if (linkedInvoice && status === NoteStatus.ISSUED) {
          await InvoiceService.syncState(linkedInvoice.id, tx);
        }

        return note;
      },
      { maxWait: 10000, timeout: 30000 }
    );

    if (linkedInvoice && status === NoteStatus.ISSUED) {
      await ActivityService.log({
        companyId,
        invoiceId: linkedInvoice.id,
        userId: context.userId,
        action: ActivityType.NOTE_LINKED,
        description: `${labelFor(input.noteType)} ${created.noteNumber} issued against this invoice`,
        metadata: {
          noteId: created.id,
          noteNumber: created.noteNumber,
          noteType: input.noteType,
          amount: computed.grandTotal
        },
        ipAddress: context.ipAddress
      });
    }

    return this.getById(companyId, created.id);
  }

  static async update(
    companyId: string,
    id: string,
    input: UpdateNoteInput,
    context: { userId?: string; ipAddress?: string | null } = {}
  ): Promise<NoteDetail> {
    const existing = await prisma.creditDebitNote.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        noteType: true,
        noteNumber: true,
        status: true,
        customerId: true,
        invoiceId: true,
        placeOfSupply: true,
        noteDate: true
      }
    });

    if (!existing) throw AppError.notFound('Note not found');

    // Once issued, the document is part of the tax record and is frozen.
    if (existing.status !== NoteStatus.DRAFT) {
      throw AppError.badRequest(
        `${labelFor(existing.noteType)} ${existing.noteNumber} has been issued and can no longer be edited. Cancel it and raise a new one instead.`
      );
    }

    const [company, settings] = await Promise.all([
      InvoiceService.getCompanyProfile(companyId),
      InvoiceSettingsService.getOrCreate(companyId)
    ]);

    const customer = await this.getCustomer(companyId, input.customerId ?? existing.customerId);

    const invoiceId =
      input.invoiceId === undefined ? existing.invoiceId : input.invoiceId || null;

    const linkedInvoice = invoiceId
      ? await this.getLinkableInvoice(companyId, invoiceId, customer.id)
      : null;

    const noteDate = input.noteDate ? startOfDay(input.noteDate) : existing.noteDate;

    const supply = linkedInvoice
      ? {
          isIgst: linkedInvoice.isIgst,
          placeOfSupply: linkedInvoice.placeOfSupply,
          placeOfSupplyCode: linkedInvoice.placeOfSupplyCode
        }
      : resolveSupply(
          company.state,
          customer.state,
          input.placeOfSupply !== undefined ? input.placeOfSupply : existing.placeOfSupply
        );

    const data: Prisma.CreditDebitNoteUpdateInput = {
      noteDate,
      ...('reason' in input && { reason: input.reason ?? null }),
      ...('notes' in input && { notes: input.notes ?? null }),
      customer: { connect: { id: customer.id } },
      invoice: linkedInvoice ? { connect: { id: linkedInvoice.id } } : { disconnect: true },
      billingName: customer.name,
      billingGstin: customer.gstin,
      billingAddress: customer.address,
      billingState: customer.state,
      placeOfSupply: supply.placeOfSupply,
      placeOfSupplyCode: supply.placeOfSupplyCode,
      isIgst: supply.isIgst
    };

    if (input.items) {
      if (!input.items.length) {
        throw AppError.badRequest('A note needs at least one line item');
      }

      const computed = computeDocument(this.normaliseItems(input.items), {
        isIgst: supply.isIgst,
        enableRoundOff: settings.enableRoundOff
      });

      if (linkedInvoice && existing.noteType === NoteType.CREDIT) {
        this.assertCreditFitsInvoice(linkedInvoice, computed.grandTotal, id);
      }

      Object.assign(data, {
        subtotal: computed.subtotal,
        discountAmount: computed.discountAmount,
        taxableAmount: computed.taxableAmount,
        cgstAmount: computed.cgstAmount,
        sgstAmount: computed.sgstAmount,
        igstAmount: computed.igstAmount,
        taxAmount: computed.taxAmount,
        roundOff: computed.roundOff,
        grandTotal: computed.grandTotal
      });

      // Lines carry no client-stable identity, so they are replaced wholesale.
      data.items = { deleteMany: {}, create: this.buildItemRows(computed.lines) };
    }

    await prisma.creditDebitNote.update({ where: { id }, data });

    // Re-link may have moved the note off one invoice and onto another.
    for (const affected of new Set([existing.invoiceId, linkedInvoice?.id].filter(Boolean))) {
      await InvoiceService.syncState(affected as string);
    }

    void context;
    return this.getById(companyId, id);
  }

  /**
   * Issues a draft note. This is the point at which it starts affecting the
   * linked invoice's balance and the GST return.
   */
  static async issue(
    companyId: string,
    id: string,
    context: { userId?: string; ipAddress?: string | null } = {}
  ): Promise<NoteDetail> {
    const note = await prisma.creditDebitNote.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        noteType: true,
        noteNumber: true,
        status: true,
        invoiceId: true,
        grandTotal: true
      }
    });

    if (!note) throw AppError.notFound('Note not found');

    if (note.status === NoteStatus.ISSUED) {
      throw AppError.badRequest('This note has already been issued');
    }

    if (note.status === NoteStatus.CANCELLED) {
      throw AppError.badRequest('A cancelled note cannot be issued');
    }

    if (note.invoiceId && note.noteType === NoteType.CREDIT) {
      const invoice = await this.getLinkableInvoice(companyId, note.invoiceId);
      this.assertCreditFitsInvoice(invoice, toNumber(note.grandTotal), id);
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.creditDebitNote.update({
          where: { id },
          data: { status: NoteStatus.ISSUED, issuedAt: new Date() }
        });

        if (note.invoiceId) {
          await InvoiceService.syncState(note.invoiceId, tx);
        }
      },
      { maxWait: 10000, timeout: 30000 }
    );

    if (note.invoiceId) {
      await ActivityService.log({
        companyId,
        invoiceId: note.invoiceId,
        userId: context.userId,
        action: ActivityType.NOTE_LINKED,
        description: `${labelFor(note.noteType)} ${note.noteNumber} issued against this invoice`,
        metadata: {
          noteId: id,
          noteNumber: note.noteNumber,
          noteType: note.noteType,
          amount: toNumber(note.grandTotal)
        },
        ipAddress: context.ipAddress
      });
    }

    return this.getById(companyId, id);
  }

  static async cancel(
    companyId: string,
    id: string,
    context: { userId?: string; ipAddress?: string | null } = {}
  ): Promise<NoteDetail> {
    const note = await prisma.creditDebitNote.findFirst({
      where: { id, companyId },
      select: { id: true, noteType: true, noteNumber: true, status: true, invoiceId: true }
    });

    if (!note) throw AppError.notFound('Note not found');

    if (note.status === NoteStatus.CANCELLED) {
      throw AppError.badRequest('This note is already cancelled');
    }

    await prisma.$transaction(
      async (tx) => {
        await tx.creditDebitNote.update({
          where: { id },
          data: { status: NoteStatus.CANCELLED }
        });

        // Withdrawing the note gives the invoice its balance back.
        if (note.invoiceId) {
          await InvoiceService.syncState(note.invoiceId, tx);
        }
      },
      { maxWait: 10000, timeout: 30000 }
    );

    if (note.invoiceId) {
      await ActivityService.log({
        companyId,
        invoiceId: note.invoiceId,
        userId: context.userId,
        action: ActivityType.NOTE_LINKED,
        description: `${labelFor(note.noteType)} ${note.noteNumber} cancelled`,
        metadata: { noteId: id, noteNumber: note.noteNumber, cancelled: true },
        ipAddress: context.ipAddress
      });
    }

    return this.getById(companyId, id);
  }

  /** Only a draft can be deleted; an issued note must be cancelled. */
  static async remove(companyId: string, id: string): Promise<{ id: string }> {
    const note = await prisma.creditDebitNote.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, noteNumber: true, noteType: true }
    });

    if (!note) throw AppError.notFound('Note not found');

    if (note.status !== NoteStatus.DRAFT) {
      throw AppError.badRequest(
        `${labelFor(note.noteType)} ${note.noteNumber} has been issued and cannot be deleted. Cancel it instead.`
      );
    }

    await prisma.creditDebitNote.delete({ where: { id } });
    return { id };
  }

  /** Prefills a note from an invoice, so a full reversal is one click. */
  static async prefillFromInvoice(companyId: string, invoiceId: string) {
    const invoice = await InvoiceService.getById(companyId, invoiceId);

    return {
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      placeOfSupply: invoice.placeOfSupply,
      isIgst: invoice.isIgst,
      billingName: invoice.billingName,
      maxCreditAmount: round2(
        toNumber(invoice.grandTotal) - toNumber(invoice.creditNoteTotal)
      ),
      items: invoice.items.map((item) => ({
        productId: item.productId,
        name: item.name,
        description: item.description,
        hsnSacCode: item.hsnSacCode,
        unit: item.unit,
        quantity: toNumber(item.quantity),
        unitPrice: toNumber(item.unitPrice),
        discountPercent: toNumber(item.discountPercent),
        taxRate: toNumber(item.taxRate)
      }))
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * A credit note cannot exceed what is left of the invoice.
   *
   * Without this, crediting more than was ever invoiced would drive the
   * receivable negative and quietly corrupt both the balance and the GST
   * return.
   */
  private static assertCreditFitsInvoice(
    invoice: { grandTotal: Decimalish; creditNoteTotal: Decimalish; invoiceNumber: string },
    amount: number,
    excludeNoteId?: string
  ): void {
    void excludeNoteId;

    const alreadyCredited = toNumber(invoice.creditNoteTotal);
    const available = round2(toNumber(invoice.grandTotal) - alreadyCredited);

    if (amount > available + 0.001) {
      throw AppError.badRequest(
        `A credit note for ${amount.toFixed(2)} exceeds the ${available.toFixed(
          2
        )} still creditable on invoice ${invoice.invoiceNumber}`
      );
    }
  }

  private static async getCustomer(companyId: string, customerId: string) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, companyId },
      select: {
        id: true,
        name: true,
        gstin: true,
        address: true,
        state: true,
        email: true
      }
    });

    if (!customer) {
      throw AppError.badRequest('Selected customer was not found in your business');
    }

    return customer;
  }

  private static async getLinkableInvoice(
    companyId: string,
    invoiceId: string,
    customerId?: string
  ) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      select: {
        id: true,
        invoiceNumber: true,
        customerId: true,
        status: true,
        isIgst: true,
        placeOfSupply: true,
        placeOfSupplyCode: true,
        grandTotal: true,
        creditNoteTotal: true
      }
    });

    if (!invoice) {
      throw AppError.badRequest('The selected invoice was not found in your business');
    }

    if (invoice.status === 'DRAFT') {
      throw AppError.badRequest('A note cannot be raised against a draft invoice');
    }

    if (customerId && invoice.customerId !== customerId) {
      throw AppError.badRequest('The selected invoice belongs to a different customer');
    }

    return invoice;
  }

  private static normaliseItems(items: RawNoteItem[]): NormalisedNoteItem[] {
    return items.map((item) => ({
      productId: item.productId ?? null,
      name: item.name?.trim(),
      description: item.description?.trim() || null,
      hsnSacCode: item.hsnSacCode?.trim() || null,
      unit: item.unit?.trim() || 'PCS',
      quantity: toNumber(item.quantity),
      unitPrice: toNumber(item.unitPrice),
      discountPercent: toNumber(item.discountPercent),
      taxRate: toNumber(item.taxRate)
    }));
  }

  private static buildItemRows(
    lines: Array<NormalisedNoteItem & ComputedTaxLine>
  ): Prisma.CreditDebitNoteItemCreateWithoutNoteInput[] {
    return lines.map((line, index) => ({
      productId: line.productId ?? null,
      name: line.name,
      description: line.description ?? null,
      hsnSacCode: line.hsnSacCode ?? null,
      unit: line.unit ?? 'PCS',
      sortOrder: index,
      quantity: line.quantity as number,
      unitPrice: line.unitPrice as number,
      discountPercent: line.discountPercent as number,
      discountAmount: line.discountAmount as number,
      taxRate: line.taxRate as number,
      subtotal: line.subtotal as number,
      taxableAmount: line.taxableAmount as number,
      cgstRate: line.cgstRate as number,
      cgstAmount: line.cgstAmount as number,
      sgstRate: line.sgstRate as number,
      sgstAmount: line.sgstAmount as number,
      igstRate: line.igstRate as number,
      igstAmount: line.igstAmount as number,
      taxAmount: line.taxAmount as number,
      total: line.total as number
    }));
  }

  /** Exposed for the create form, which shows the next number before saving. */
  static async previewNumber(companyId: string, noteType: NoteType) {
    return NumberingService.preview(companyId, documentTypeFor(noteType));
  }

  static financialYearFor(date: Date | string = new Date()): string {
    return financialYearOf(date);
  }
}
