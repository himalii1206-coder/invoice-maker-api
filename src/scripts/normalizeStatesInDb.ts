import 'dotenv/config';
import { prisma } from '../config/database.js';
import { normaliseStateName } from '../constants/gst.js';

async function main() {
  console.log('--- Normalizing state names across the database ---');

  // 1. Customers
  const customers = await prisma.customer.findMany({
    select: { id: true, state: true }
  });
  let custCount = 0;
  for (const c of customers) {
    if (c.state) {
      const clean = normaliseStateName(c.state);
      if (clean && clean !== c.state) {
        await prisma.customer.update({
          where: { id: c.id },
          data: { state: clean }
        });
        custCount++;
      }
    }
  }
  console.log(`Updated ${custCount} customer state values to clean state names.`);

  // 2. Vendors
  const vendors = await prisma.vendor.findMany({
    select: { id: true, state: true }
  });
  let vendorCount = 0;
  for (const v of vendors) {
    if (v.state) {
      const clean = normaliseStateName(v.state);
      if (clean && clean !== v.state) {
        await prisma.vendor.update({
          where: { id: v.id },
          data: { state: clean }
        });
        vendorCount++;
      }
    }
  }
  console.log(`Updated ${vendorCount} vendor state values to clean state names.`);

  // 3. Companies
  const companies = await prisma.company.findMany({
    select: { id: true, state: true }
  });
  let companyCount = 0;
  for (const co of companies) {
    if (co.state) {
      const clean = normaliseStateName(co.state);
      if (clean && clean !== co.state) {
        await prisma.company.update({
          where: { id: co.id },
          data: { state: clean }
        });
        companyCount++;
      }
    }
  }
  console.log(`Updated ${companyCount} company state values to clean state names.`);

  // 4. Quotations
  const quotations = await prisma.quotation.findMany({
    select: { id: true, billingState: true, placeOfSupply: true }
  });
  let quoteCount = 0;
  for (const q of quotations) {
    const cleanBilling = q.billingState ? normaliseStateName(q.billingState) : null;
    const cleanSupply = q.placeOfSupply ? normaliseStateName(q.placeOfSupply) : null;
    if ((cleanBilling && cleanBilling !== q.billingState) || (cleanSupply && cleanSupply !== q.placeOfSupply)) {
      await prisma.quotation.update({
        where: { id: q.id },
        data: {
          ...(cleanBilling ? { billingState: cleanBilling } : {}),
          ...(cleanSupply ? { placeOfSupply: cleanSupply } : {})
        }
      });
      quoteCount++;
    }
  }
  console.log(`Updated ${quoteCount} quotation state values to clean state names.`);

  // 5. Invoices
  const invoices = await prisma.invoice.findMany({
    select: { id: true, billingState: true, shippingState: true, placeOfSupply: true }
  });
  let invCount = 0;
  for (const inv of invoices) {
    const cleanBilling = inv.billingState ? normaliseStateName(inv.billingState) : null;
    const cleanShipping = inv.shippingState ? normaliseStateName(inv.shippingState) : null;
    const cleanSupply = inv.placeOfSupply ? normaliseStateName(inv.placeOfSupply) : null;
    if (
      (cleanBilling && cleanBilling !== inv.billingState) ||
      (cleanShipping && cleanShipping !== inv.shippingState) ||
      (cleanSupply && cleanSupply !== inv.placeOfSupply)
    ) {
      await prisma.invoice.update({
        where: { id: inv.id },
        data: {
          ...(cleanBilling ? { billingState: cleanBilling } : {}),
          ...(cleanShipping ? { shippingState: cleanShipping } : {}),
          ...(cleanSupply ? { placeOfSupply: cleanSupply } : {})
        }
      });
      invCount++;
    }
  }
  console.log(`Updated ${invCount} invoice state values to clean state names.`);

  // 6. Purchase Bills
  const purchaseBills = await prisma.purchaseBill.findMany({
    select: { id: true, vendorState: true }
  });
  let pbCount = 0;
  for (const pb of purchaseBills) {
    if (pb.vendorState) {
      const clean = normaliseStateName(pb.vendorState);
      if (clean && clean !== pb.vendorState) {
        await prisma.purchaseBill.update({
          where: { id: pb.id },
          data: { vendorState: clean }
        });
        pbCount++;
      }
    }
  }
  console.log(`Updated ${pbCount} purchase bill vendorState values to clean state names.`);

  console.log('✅ State normalization completed successfully.');
}

main()
  .catch((e) => {
    console.error('Error during normalization:', e);
  })
  .finally(() => {
    prisma.$disconnect();
  });
