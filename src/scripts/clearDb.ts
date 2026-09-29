import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface CleanupOptions {
  keepUsers?: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  const keepUsers = args.includes('--keep-users') || args.includes('--keep-auth');

  console.log('🧹 Starting database cleanup...');
  if (keepUsers) {
    console.log('ℹ️  Mode: Preserving Users, Companies, Sessions, and Settings');
  } else {
    console.log('ℹ️  Mode: Full Database Wipe (All records, users, and companies)');
  }

  const startTime = Date.now();
  let totalDeleted = 0;

  // 1. Quotations child & parent entities
  const deletedQuotationActivities = await prisma.quotationActivity.deleteMany();
  console.log(`  • Deleted ${deletedQuotationActivities.count} quotation activities`);
  totalDeleted += deletedQuotationActivities.count;

  const deletedQuotationItems = await prisma.quotationItem.deleteMany();
  console.log(`  • Deleted ${deletedQuotationItems.count} quotation items`);
  totalDeleted += deletedQuotationItems.count;

  const deletedQuotations = await prisma.quotation.deleteMany();
  console.log(`  • Deleted ${deletedQuotations.count} quotations`);
  totalDeleted += deletedQuotations.count;

  // 2. Invoices child & parent entities
  const deletedInvoiceActivities = await prisma.invoiceActivity.deleteMany();
  console.log(`  • Deleted ${deletedInvoiceActivities.count} invoice activities`);
  totalDeleted += deletedInvoiceActivities.count;

  const deletedPayments = await prisma.payment.deleteMany();
  console.log(`  • Deleted ${deletedPayments.count} payments`);
  totalDeleted += deletedPayments.count;

  const deletedInvoiceItems = await prisma.invoiceItem.deleteMany();
  console.log(`  • Deleted ${deletedInvoiceItems.count} invoice items`);
  totalDeleted += deletedInvoiceItems.count;

  const deletedInvoices = await prisma.invoice.deleteMany();
  console.log(`  • Deleted ${deletedInvoices.count} invoices`);
  totalDeleted += deletedInvoices.count;

  // 3. Purchase Bills child & parent entities
  const deletedPurchasePayments = await prisma.purchasePayment.deleteMany();
  console.log(`  • Deleted ${deletedPurchasePayments.count} purchase payments`);
  totalDeleted += deletedPurchasePayments.count;

  const deletedPurchaseBillItems = await prisma.purchaseBillItem.deleteMany();
  console.log(`  • Deleted ${deletedPurchaseBillItems.count} purchase bill items`);
  totalDeleted += deletedPurchaseBillItems.count;

  const deletedPurchaseBills = await prisma.purchaseBill.deleteMany();
  console.log(`  • Deleted ${deletedPurchaseBills.count} purchase bills`);
  totalDeleted += deletedPurchaseBills.count;

  // 4. Notifications & Team
  const deletedNotifications = await prisma.notification.deleteMany();
  console.log(`  • Deleted ${deletedNotifications.count} notifications`);
  totalDeleted += deletedNotifications.count;

  const deletedCompanyMembers = await prisma.companyMember.deleteMany();
  console.log(`  • Deleted ${deletedCompanyMembers.count} company members`);
  totalDeleted += deletedCompanyMembers.count;

  // 5. Masters (Vendors, Products, Customers)
  const deletedVendors = await prisma.vendor.deleteMany();
  console.log(`  • Deleted ${deletedVendors.count} vendors`);
  totalDeleted += deletedVendors.count;

  const deletedProducts = await prisma.product.deleteMany();
  console.log(`  • Deleted ${deletedProducts.count} products`);
  totalDeleted += deletedProducts.count;

  const deletedCustomers = await prisma.customer.deleteMany();
  console.log(`  • Deleted ${deletedCustomers.count} customers`);
  totalDeleted += deletedCustomers.count;

  // 6. Sequences & Configuration
  const deletedSequences = await prisma.documentSequence.deleteMany();
  console.log(`  • Deleted ${deletedSequences.count} document sequences`);
  totalDeleted += deletedSequences.count;

  if (!keepUsers) {
    const deletedSettings = await prisma.invoiceSettings.deleteMany();
    console.log(`  • Deleted ${deletedSettings.count} invoice settings`);
    totalDeleted += deletedSettings.count;

    const deletedSessions = await prisma.session.deleteMany();
    console.log(`  • Deleted ${deletedSessions.count} sessions`);
    totalDeleted += deletedSessions.count;

    const deletedCompanies = await prisma.company.deleteMany();
    console.log(`  • Deleted ${deletedCompanies.count} companies`);
    totalDeleted += deletedCompanies.count;

    const deletedUsers = await prisma.user.deleteMany();
    console.log(`  • Deleted ${deletedUsers.count} users`);
    totalDeleted += deletedUsers.count;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✅ Database cleanup completed successfully in ${duration}s!`);
  console.log(`📊 Total records removed: ${totalDeleted}`);
}

main()
  .catch((e) => {
    console.error('❌ Error clearing database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
