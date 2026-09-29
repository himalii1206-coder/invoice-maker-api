import 'dotenv/config';
import { prisma } from '../config/database.js';
import { toPaise, fromPaise, roundOffToRupee, toNumber } from '../utils/money.js';

async function main() {
  console.log('--- Recalculating roundOff and grandTotal on existing quotations ---');

  const quotations = await prisma.quotation.findMany({
    select: {
      id: true,
      quotationNumber: true,
      taxableAmount: true,
      taxAmount: true,
      forwardingPackagingAmount: true,
      secondTotal: true,
      roundOff: true,
      grandTotal: true
    }
  });

  console.log(`Found ${quotations.length} total quotations to check.`);

  let updatedCount = 0;
  for (const q of quotations) {
    const taxablePaise = toPaise(q.taxableAmount);
    const taxPaise = toPaise(q.taxAmount);
    const fwdPaise = toPaise(q.forwardingPackagingAmount);
    const secondTotalPaise = taxablePaise + taxPaise + fwdPaise;
    const secondTotal = fromPaise(secondTotalPaise);

    const roundRes = roundOffToRupee(secondTotalPaise);
    const correctRoundOff = fromPaise(roundRes.adjustment);
    const correctGrandTotal = fromPaise(roundRes.total);

    const currentRoundOff = toNumber(q.roundOff);
    const currentGrandTotal = toNumber(q.grandTotal);

    if (currentRoundOff !== correctRoundOff || currentGrandTotal !== correctGrandTotal) {
      console.log(
        `Fixing ${q.quotationNumber}: roundOff ${currentRoundOff} -> ${correctRoundOff}, grandTotal ${currentGrandTotal} -> ${correctGrandTotal}`
      );
      await prisma.quotation.update({
        where: { id: q.id },
        data: {
          secondTotal,
          roundOff: correctRoundOff,
          grandTotal: correctGrandTotal
        }
      });
      updatedCount++;
    }
  }

  console.log(`✅ Fixed ${updatedCount} quotations successfully.`);
}

main()
  .catch((e) => {
    console.error('Error fixing quotations:', e);
  })
  .finally(() => {
    prisma.$disconnect();
  });
