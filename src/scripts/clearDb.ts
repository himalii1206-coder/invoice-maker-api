import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Starting full database cleanup...');

  // Delete all dependent child records first, then parent entities
  const deletedQuotationActivities = await prisma.quotationActivity.deleteMany();
  console.log(`Deleted ${deletedQuotationActivities.count} quotation activities`);

  const deletedQuotationItems = await prisma.quotationItem.deleteMany();
  console.log(`Deleted ${deletedQuotationItems.count} quotation items`);

  const deletedQuotations = await prisma.quotation.deleteMany();
  console.log(`Deleted ${deletedQuotations.count} quotations`);

  const deletedInvoiceActivities = await prisma.invoiceActivity.deleteMany();
  console.log(`Deleted ${deletedInvoiceActivities.count} invoice activities`);

  const deletedPayments = await prisma.payment.deleteMany();
  console.log(`Deleted ${deletedPayments.count} payments`);

  const deletedNotes = await prisma.creditDebitNote.deleteMany();
  console.log(`Deleted ${deletedNotes.count} credit/debit notes`);

  const deletedInvoiceItems = await prisma.invoiceItem.deleteMany();
  console.log(`Deleted ${deletedInvoiceItems.count} invoice items`);

  const deletedInvoices = await prisma.invoice.deleteMany();
  console.log(`Deleted ${deletedInvoices.count} invoices`);

  const deletedPurchasePayments = await prisma.purchasePayment.deleteMany();
  console.log(`Deleted ${deletedPurchasePayments.count} purchase payments`);

  const deletedPurchaseBillItems = await prisma.purchaseBillItem.deleteMany();
  console.log(`Deleted ${deletedPurchaseBillItems.count} purchase bill items`);

  const deletedPurchaseBills = await prisma.purchaseBill.deleteMany();
  console.log(`Deleted ${deletedPurchaseBills.count} purchase bills`);

  const deletedVendors = await prisma.vendor.deleteMany();
  console.log(`Deleted ${deletedVendors.count} vendors`);

  const deletedProducts = await prisma.product.deleteMany();
  console.log(`Deleted ${deletedProducts.count} products`);

  const deletedCustomers = await prisma.customer.deleteMany();
  console.log(`Deleted ${deletedCustomers.count} customers`);

  const deletedNotifications = await prisma.notification.deleteMany();
  console.log(`Deleted ${deletedNotifications.count} notifications`);

  const deletedSequences = await prisma.documentSequence.deleteMany();
  console.log(`Deleted ${deletedSequences.count} document sequences`);

  // Reset nextInvoiceNumber on companies to default 1001
  await prisma.company.updateMany({
    data: {
      nextInvoiceNumber: 1001
    }
  });

  console.log('✅ Entire database has been cleared successfully! All operational data reset to empty.');
}

main()
  .catch((e) => {
    console.error('❌ Error clearing database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
