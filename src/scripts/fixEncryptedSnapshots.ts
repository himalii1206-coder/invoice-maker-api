import 'dotenv/config';
import { prisma } from '../config/database.js';
import { decryptField } from '../utils/encryption.js';

async function main() {
  console.log('--- Cleaning up any encrypted snapshot values in database ---');

  // 1. Fix Quotations
  const quotations = await prisma.quotation.findMany({
    where: {
      billingGstin: {
        startsWith: 'enc:v1:'
      }
    },
    select: { id: true, billingGstin: true }
  });

  console.log(`Found ${quotations.length} quotations with encrypted billingGstin`);
  for (const q of quotations) {
    const plain = decryptField(q.billingGstin);
    await prisma.quotation.update({
      where: { id: q.id },
      data: { billingGstin: plain }
    });
  }

  // 2. Fix Invoices
  const invoices = await prisma.invoice.findMany({
    where: {
      billingGstin: {
        startsWith: 'enc:v1:'
      }
    },
    select: { id: true, billingGstin: true }
  });

  console.log(`Found ${invoices.length} invoices with encrypted billingGstin`);
  for (const inv of invoices) {
    const plain = decryptField(inv.billingGstin);
    await prisma.invoice.update({
      where: { id: inv.id },
      data: { billingGstin: plain }
    });
  }

  // 3. Fix CreditDebitNotes
  const notes = await prisma.creditDebitNote.findMany({
    where: {
      billingGstin: {
        startsWith: 'enc:v1:'
      }
    },
    select: { id: true, billingGstin: true }
  });

  console.log(`Found ${notes.length} notes with encrypted billingGstin`);
  for (const note of notes) {
    const plain = decryptField(note.billingGstin);
    await prisma.creditDebitNote.update({
      where: { id: note.id },
      data: { billingGstin: plain }
    });
  }

  console.log('✅ Cleanup completed successfully.');
}

main()
  .catch((e) => {
    console.error('Error during cleanup:', e);
  })
  .finally(() => {
    prisma.$disconnect();
  });
