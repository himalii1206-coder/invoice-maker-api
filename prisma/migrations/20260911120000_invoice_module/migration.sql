-- CreateEnum
CREATE TYPE "NoteType" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "RecurringStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('BEFORE_DUE', 'ON_DUE_DATE', 'AFTER_DUE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('SCHEDULED', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'SENT', 'VIEWED', 'PAYMENT_RECORDED', 'PAYMENT_DELETED', 'CANCELLED', 'DUPLICATED', 'PDF_DOWNLOADED', 'EMAIL_SENT', 'REMINDER_SENT', 'NOTE_LINKED', 'DELETED');

-- CreateEnum
CREATE TYPE "NumberResetMode" AS ENUM ('NEVER', 'YEARLY', 'MONTHLY', 'FINANCIAL_YEAR');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- DropIndex
DROP INDEX "invoices_invoiceNumber_key";

-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "cgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "cgstRate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "igstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "igstRate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "sgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "sgstRate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxableAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "unit" TEXT NOT NULL DEFAULT 'PCS',
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,3),
ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "taxAmount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "total" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "billingAddress" TEXT,
ADD COLUMN     "billingCity" TEXT,
ADD COLUMN     "billingCountry" TEXT NOT NULL DEFAULT 'India',
ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "billingGstin" TEXT,
ADD COLUMN     "billingName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "billingPhone" TEXT,
ADD COLUMN     "billingPostalCode" TEXT,
ADD COLUMN     "billingState" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledReason" TEXT,
ADD COLUMN     "creditNoteTotal" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "debitNoteTotal" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "financialYear" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "internalNotes" TEXT,
ADD COLUMN     "isIgst" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isReverseCharge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "placeOfSupply" TEXT,
ADD COLUMN     "placeOfSupplyCode" TEXT,
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "recurringInvoiceId" TEXT,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "roundOff" DECIMAL(8,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sequenceNo" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxableAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
ADD COLUMN     "viewedAt" TIMESTAMP(3),
ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "discountAmount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "taxAmount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "cgstAmount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "sgstAmount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "igstAmount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "grandTotal" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "amountPaid" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "balanceDue" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- CreateTable
CREATE TABLE "credit_debit_notes" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "noteType" "NoteType" NOT NULL,
    "noteNumber" TEXT NOT NULL,
    "sequenceNo" INTEGER NOT NULL DEFAULT 0,
    "financialYear" TEXT NOT NULL DEFAULT '',
    "status" "NoteStatus" NOT NULL DEFAULT 'DRAFT',
    "noteDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "billingName" TEXT NOT NULL DEFAULT '',
    "billingGstin" TEXT,
    "billingAddress" TEXT,
    "billingState" TEXT,
    "placeOfSupply" TEXT,
    "placeOfSupplyCode" TEXT,
    "isIgst" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "taxableAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "cgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "sgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "igstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "roundOff" DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "issuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_debit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_debit_note_items" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hsnSacCode" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "taxableAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "cgstRate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "cgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "sgstRate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "sgstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "igstRate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "igstAmount" DECIMAL(14,2) NOT NULL DEFAULT 0.00,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "credit_debit_note_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "frequency" "RecurringFrequency" NOT NULL DEFAULT 'MONTHLY',
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "nextRunDate" TIMESTAMP(3) NOT NULL,
    "lastRunDate" TIMESTAMP(3),
    "maxOccurrences" INTEGER,
    "occurrences" INTEGER NOT NULL DEFAULT 0,
    "dueInDays" INTEGER NOT NULL DEFAULT 15,
    "autoSend" BOOLEAN NOT NULL DEFAULT false,
    "status" "RecurringStatus" NOT NULL DEFAULT 'ACTIVE',
    "placeOfSupply" TEXT,
    "placeOfSupplyCode" TEXT,
    "notes" TEXT,
    "terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoice_items" (
    "id" TEXT NOT NULL,
    "recurringId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hsnSacCode" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'PCS',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0.00,

    CONSTRAINT "recurring_invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reminders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "reminderType" "ReminderType" NOT NULL DEFAULT 'MANUAL',
    "offsetDays" INTEGER NOT NULL DEFAULT 0,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "status" "ReminderStatus" NOT NULL DEFAULT 'SCHEDULED',
    "recipientEmail" TEXT,
    "subject" TEXT,
    "message" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_activities" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "ActivityType" NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "invoiceSuffix" TEXT,
    "creditNotePrefix" TEXT NOT NULL DEFAULT 'CN',
    "debitNotePrefix" TEXT NOT NULL DEFAULT 'DN',
    "numberSeparator" TEXT NOT NULL DEFAULT '-',
    "numberPadding" INTEGER NOT NULL DEFAULT 4,
    "startNumber" INTEGER NOT NULL DEFAULT 1,
    "resetMode" "NumberResetMode" NOT NULL DEFAULT 'FINANCIAL_YEAR',
    "includeYearInNumber" BOOLEAN NOT NULL DEFAULT true,
    "defaultDueDays" INTEGER NOT NULL DEFAULT 15,
    "defaultTaxRate" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'INR',
    "defaultTerms" TEXT,
    "defaultNotes" TEXT,
    "themeColor" TEXT NOT NULL DEFAULT '#7c4a27',
    "template" TEXT NOT NULL DEFAULT 'classic',
    "showHsnColumn" BOOLEAN NOT NULL DEFAULT true,
    "showDiscount" BOOLEAN NOT NULL DEFAULT true,
    "showBankDetails" BOOLEAN NOT NULL DEFAULT true,
    "showSignature" BOOLEAN NOT NULL DEFAULT true,
    "signatureUrl" TEXT,
    "footerNote" TEXT,
    "enableRoundOff" BOOLEAN NOT NULL DEFAULT true,
    "autoMarkOverdue" BOOLEAN NOT NULL DEFAULT true,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT false,
    "remindBeforeDays" INTEGER[] DEFAULT ARRAY[3]::INTEGER[],
    "remindOnDueDate" BOOLEAN NOT NULL DEFAULT true,
    "remindAfterDays" INTEGER[] DEFAULT ARRAY[3, 7]::INTEGER[],
    "reminderCcEmails" TEXT,
    "reminderSubject" TEXT,
    "reminderBody" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "periodKey" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_debit_notes_companyId_noteType_idx" ON "credit_debit_notes"("companyId", "noteType");

-- CreateIndex
CREATE INDEX "credit_debit_notes_customerId_idx" ON "credit_debit_notes"("customerId");

-- CreateIndex
CREATE INDEX "credit_debit_notes_invoiceId_idx" ON "credit_debit_notes"("invoiceId");

-- CreateIndex
CREATE INDEX "credit_debit_notes_companyId_noteDate_idx" ON "credit_debit_notes"("companyId", "noteDate");

-- CreateIndex
CREATE UNIQUE INDEX "credit_debit_notes_companyId_noteNumber_key" ON "credit_debit_notes"("companyId", "noteNumber");

-- CreateIndex
CREATE INDEX "credit_debit_note_items_noteId_idx" ON "credit_debit_note_items"("noteId");

-- CreateIndex
CREATE INDEX "recurring_invoices_companyId_idx" ON "recurring_invoices"("companyId");

-- CreateIndex
CREATE INDEX "recurring_invoices_customerId_idx" ON "recurring_invoices"("customerId");

-- CreateIndex
CREATE INDEX "recurring_invoices_status_nextRunDate_idx" ON "recurring_invoices"("status", "nextRunDate");

-- CreateIndex
CREATE INDEX "recurring_invoice_items_recurringId_idx" ON "recurring_invoice_items"("recurringId");

-- CreateIndex
CREATE INDEX "payment_reminders_invoiceId_idx" ON "payment_reminders"("invoiceId");

-- CreateIndex
CREATE INDEX "payment_reminders_companyId_status_scheduledFor_idx" ON "payment_reminders"("companyId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "invoice_activities_invoiceId_createdAt_idx" ON "invoice_activities"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "invoice_activities_companyId_createdAt_idx" ON "invoice_activities"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_settings_companyId_key" ON "invoice_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "document_sequences_companyId_documentType_periodKey_key" ON "document_sequences"("companyId", "documentType", "periodKey");

-- CreateIndex
CREATE INDEX "invoice_items_productId_idx" ON "invoice_items"("productId");

-- CreateIndex
CREATE INDEX "invoices_companyId_issueDate_idx" ON "invoices"("companyId", "issueDate");

-- CreateIndex
CREATE INDEX "invoices_companyId_financialYear_idx" ON "invoices"("companyId", "financialYear");

-- CreateIndex
CREATE INDEX "invoices_companyId_status_dueDate_idx" ON "invoices"("companyId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_companyId_invoiceNumber_key" ON "invoices"("companyId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "payments_companyId_paymentDate_idx" ON "payments"("companyId", "paymentDate");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_recurringInvoiceId_fkey" FOREIGN KEY ("recurringInvoiceId") REFERENCES "recurring_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_notes" ADD CONSTRAINT "credit_debit_notes_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_debit_note_items" ADD CONSTRAINT "credit_debit_note_items_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "credit_debit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_items" ADD CONSTRAINT "recurring_invoice_items_recurringId_fkey" FOREIGN KEY ("recurringId") REFERENCES "recurring_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_activities" ADD CONSTRAINT "invoice_activities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_activities" ADD CONSTRAINT "invoice_activities_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_activities" ADD CONSTRAINT "invoice_activities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_settings" ADD CONSTRAINT "invoice_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

