import { PrismaClient, UserRole, CustomerType, InvoiceStatus, PaymentMethod, NoteType, NoteStatus, ActivityType, PurchaseBillStatus, ItemCategory, ItcEligibility, NotificationEvent } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

async function main() {
  console.log('🌱 Starting comprehensive database seeding...');

  // 1. Check or create demo user and company
  let user = await prisma.user.findFirst({
    include: { company: true }
  });

  if (!user) {
    const passwordHash = await bcrypt.hash('Password123!', 10);
    user = await prisma.user.create({
      data: {
        email: 'admin@invoicemaker.com',
        firstName: 'Admin',
        lastName: 'Demo',
        passwordHash,
        role: UserRole.OWNER,
        isEmailVerified: true,
        company: {
          create: {
            name: 'Acme Enterprise Solutions Pvt. Ltd.',
            email: 'billing@acme-solutions.in',
            phone: '+91 98765 43210',
            address: '101, Corporate Heights, SG Highway',
            city: 'Ahmedabad',
            state: 'Gujarat',
            country: 'India',
            postalCode: '380015',
            gstin: '24AAACC1206D1ZM',
            pan: 'AAACC1206D',
            bankName: 'HDFC Bank',
            accountNumber: '50200012345678',
            ifscCode: 'HDFC0001234',
            branch: 'SG Highway Branch',
            accountHolder: 'Acme Enterprise Solutions Pvt. Ltd.',
            upiId: 'acme@hdfcbank',
            paymentInstructions: 'Please quote invoice number on payment transfer.'
          }
        }
      },
      include: { company: true }
    });
    console.log(`Created default user: ${user.email}`);
  }

  const companies = await prisma.company.findMany();
  console.log(`Found ${companies.length} company/companies to populate.`);

  for (const company of companies) {
    console.log(`\n🏢 Seeding data for company: "${company.name}" (ID: ${company.id})...`);

    // Ensure company has GSTIN and state if missing
    const companyGstin = company.gstin || '24AAACC1206D1ZM';
    const companyState = company.state || 'Gujarat';

    // 2. Create Customers
    const sampleCustomers = [
      {
        customerCode: 'CUST-001',
        name: 'Bluewave Office Solutions Pvt. Ltd.',
        email: 'accounts@bluewave.in',
        phone: '+91 98200 12345',
        type: CustomerType.BUSINESS,
        gstin: '27AABCB1234C1Z6',
        address: 'Unit 405, Skyline Business Park, Andheri East',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400093',
        contactPerson: 'Rajesh Sharma',
        accountGroup: 'Sundry Debtors',
        openingBalance: 15000
      },
      {
        customerCode: 'CUST-002',
        name: 'TechMatrix Global Services',
        email: 'finance@techmatrix.com',
        phone: '+91 98800 54321',
        type: CustomerType.BUSINESS,
        gstin: '29AABCT5678D1Z2',
        address: '7th Floor, Cyber City, Outer Ring Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560103',
        contactPerson: 'Priya Nair',
        accountGroup: 'Sundry Debtors',
        openingBalance: 0
      },
      {
        customerCode: 'CUST-003',
        name: 'Gujarat Apex Industrial Logistics',
        email: 'billing@gujexlog.in',
        phone: '+91 97250 99887',
        type: CustomerType.BUSINESS,
        gstin: '24AABCG9876E1Z9',
        address: 'Plot 42, GIDC Phase II, Vatva',
        city: 'Ahmedabad',
        state: 'Gujarat',
        postalCode: '382445',
        contactPerson: 'Ketan Patel',
        accountGroup: 'Sundry Debtors',
        openingBalance: 5000
      },
      {
        customerCode: 'CUST-004',
        name: 'Zenith Retail & Consumer Brands',
        email: 'procurement@zenithretail.in',
        phone: '+91 98110 77665',
        type: CustomerType.BUSINESS,
        gstin: '07AABCZ3344F1Z8',
        address: 'B-12, Connaught Place',
        city: 'New Delhi',
        state: 'Delhi',
        postalCode: '110001',
        contactPerson: 'Amitabh Verma',
        accountGroup: 'Sundry Debtors',
        openingBalance: 0
      },
      {
        customerCode: 'CUST-005',
        name: 'Sunbeam Renewable Energy Ltd.',
        email: 'invoicing@sunbeamenergy.com',
        phone: '+91 94440 22331',
        type: CustomerType.BUSINESS,
        gstin: '33AABCS4455G1Z3',
        address: '88, Anna Salai, Guindy',
        city: 'Chennai',
        state: 'Tamil Nadu',
        postalCode: '600032',
        contactPerson: 'Suresh Iyer',
        accountGroup: 'Sundry Debtors',
        openingBalance: 25000
      },
      {
        customerCode: 'CUST-006',
        name: 'Dr. Anand Mehta (Consultant)',
        email: 'anand.mehta@medicare.org',
        phone: '+91 98251 11223',
        type: CustomerType.INDIVIDUAL,
        gstin: null,
        address: '14, Shanti Niketan Society, Navrangpura',
        city: 'Ahmedabad',
        state: 'Gujarat',
        postalCode: '380009',
        contactPerson: 'Dr. Anand Mehta',
        accountGroup: 'Direct Clients',
        openingBalance: 0
      }
    ];

    const customerMap = new Map<string, string>();

    for (const custData of sampleCustomers) {
      const existing = await prisma.customer.findFirst({
        where: { companyId: company.id, name: custData.name }
      });

      if (existing) {
        customerMap.set(custData.name, existing.id);
      } else {
        const created = await prisma.customer.create({
          data: {
            companyId: company.id,
            ...custData
          }
        });
        customerMap.set(custData.name, created.id);
      }
    }
    console.log(`✅ Created/verified ${customerMap.size} customers.`);

    // 3. Create Products & Services
    const sampleProducts = [
      {
        productCode: 'PRD-001',
        name: 'Enterprise Cloud ERP License (Annual)',
        description: 'Comprehensive 50-user cloud license with premium SLA support',
        category: 'Software & SaaS',
        price: 45000,
        unit: 'NOS',
        taxRate: 18,
        hsnSacCode: '998313'
      },
      {
        productCode: 'PRD-002',
        name: 'IT Implementation & Integration Services',
        description: 'Onsite consulting, data migration and system configuration per day',
        category: 'Professional Services',
        price: 8500,
        unit: 'DAYS',
        taxRate: 18,
        hsnSacCode: '998314'
      },
      {
        productCode: 'PRD-003',
        name: 'High-Performance Gigabit Network Router',
        description: 'Managed 24-port PoE+ network switch & gateway hardware',
        category: 'Hardware',
        price: 24500,
        unit: 'PCS',
        taxRate: 18,
        hsnSacCode: '851762'
      },
      {
        productCode: 'PRD-004',
        name: 'Wireless Ergonomic Optical Mouse',
        description: '2.4GHz USB wireless mouse with silent clicks',
        category: 'Peripherals',
        price: 1850,
        unit: 'PCS',
        taxRate: 18,
        hsnSacCode: '847160'
      },
      {
        productCode: 'PRD-005',
        name: 'Braided Heavy-Duty USB-C Cable (2m)',
        description: '100W PD fast charging & 4K video data transfer cable',
        category: 'Accessories',
        price: 499,
        unit: 'PCS',
        taxRate: 18,
        hsnSacCode: '854442'
      },
      {
        productCode: 'PRD-006',
        name: 'Annual Hardware Maintenance Contract (AMC)',
        description: 'Quarterly hardware health check & 24/7 breakdown call support',
        category: 'Maintenance',
        price: 32000,
        unit: 'YEAR',
        taxRate: 18,
        hsnSacCode: '998713'
      }
    ];

    const productMap = new Map<string, any>();

    for (const prdData of sampleProducts) {
      const existing = await prisma.product.findFirst({
        where: { companyId: company.id, name: prdData.name }
      });

      if (existing) {
        productMap.set(prdData.name, existing);
      } else {
        const created = await prisma.product.create({
          data: {
            companyId: company.id,
            ...prdData
          }
        });
        productMap.set(prdData.name, created);
      }
    }
    console.log(`✅ Created/verified ${productMap.size} products.`);

    // 4. Create Vendors (Suppliers)
    const sampleVendors = [
      {
        name: 'Microlink Technologies India Pvt. Ltd.',
        tradeName: 'Microlink Hardware',
        contactPerson: 'Manish Joshi',
        email: 'sales@microlinkindia.com',
        phone: '+91 98240 77112',
        gstin: '24AAACM4455H1Z4',
        address: 'B-402, Electronics Zone, GIDC Gandhinagar',
        city: 'Gandhinagar',
        state: 'Gujarat',
        postalCode: '382028',
        paymentTerms: 'Net 30'
      },
      {
        name: 'CloudScale Infrastructure Servers Pte.',
        tradeName: 'CloudScale Hosting',
        contactPerson: 'Vikram Sethi',
        email: 'billing@cloudscale.net',
        phone: '+91 98100 88223',
        gstin: '27AABCC9900J1Z1',
        address: 'Infinity Tower, Sector V, Salt Lake',
        city: 'Kolkata',
        state: 'West Bengal',
        postalCode: '700091',
        paymentTerms: 'Immediate'
      },
      {
        name: 'National Logistics & Express Freight',
        tradeName: 'NatExpress Cargo',
        contactPerson: 'Ramesh Patel',
        email: 'dispatch@natexpress.in',
        phone: '+91 97260 33445',
        gstin: '24AABCN1122K1Z7',
        address: 'Transport Nagar, Narol Highway',
        city: 'Ahmedabad',
        state: 'Gujarat',
        postalCode: '382405',
        paymentTerms: 'Net 15'
      }
    ];

    const vendorMap = new Map<string, string>();

    for (const vData of sampleVendors) {
      const existing = await prisma.vendor.findFirst({
        where: { companyId: company.id, name: vData.name }
      });

      if (existing) {
        vendorMap.set(vData.name, existing.id);
      } else {
        const created = await prisma.vendor.create({
          data: {
            companyId: company.id,
            ...vData
          }
        });
        vendorMap.set(vData.name, created.id);
      }
    }
    console.log(`✅ Created/verified ${vendorMap.size} vendors.`);

    // 5. Generate Rich Historical Invoices (Last 6 Months + Recent)
    const now = new Date();
    const currentFY = `${now.getFullYear()}-${String(now.getFullYear() + 1).slice(2)}`;

    // Define months for last 6 months
    const invoiceDefinitions = [
      // Month -5 (e.g. 5 months ago)
      {
        monthsAgo: 5,
        day: 12,
        customerName: 'Bluewave Office Solutions Pvt. Ltd.',
        status: InvoiceStatus.PAID,
        paymentRatio: 1.0,
        items: [
          { prd: 'Enterprise Cloud ERP License (Annual)', qty: 1, discount: 5 },
          { prd: 'IT Implementation & Integration Services', qty: 3, discount: 0 }
        ]
      },
      {
        monthsAgo: 5,
        day: 24,
        customerName: 'Gujarat Apex Industrial Logistics',
        status: InvoiceStatus.PAID,
        paymentRatio: 1.0,
        items: [
          { prd: 'High-Performance Gigabit Network Router', qty: 2, discount: 0 },
          { prd: 'Braided Heavy-Duty USB-C Cable (2m)', qty: 10, discount: 10 }
        ]
      },

      // Month -4
      {
        monthsAgo: 4,
        day: 8,
        customerName: 'TechMatrix Global Services',
        status: InvoiceStatus.PAID,
        paymentRatio: 1.0,
        items: [
          { prd: 'Enterprise Cloud ERP License (Annual)', qty: 2, discount: 10 },
          { prd: 'Wireless Ergonomic Optical Mouse', qty: 25, discount: 5 }
        ]
      },
      {
        monthsAgo: 4,
        day: 20,
        customerName: 'Sunbeam Renewable Energy Ltd.',
        status: InvoiceStatus.PAID,
        paymentRatio: 1.0,
        items: [
          { prd: 'Annual Hardware Maintenance Contract (AMC)', qty: 1, discount: 0 },
          { prd: 'High-Performance Gigabit Network Router', qty: 1, discount: 5 }
        ]
      },

      // Month -3
      {
        monthsAgo: 3,
        day: 5,
        customerName: 'Zenith Retail & Consumer Brands',
        status: InvoiceStatus.PAID,
        paymentRatio: 1.0,
        items: [
          { prd: 'IT Implementation & Integration Services', qty: 5, discount: 0 },
          { prd: 'Wireless Ergonomic Optical Mouse', qty: 15, discount: 0 }
        ]
      },
      {
        monthsAgo: 3,
        day: 18,
        customerName: 'Bluewave Office Solutions Pvt. Ltd.',
        status: InvoiceStatus.PAID,
        paymentRatio: 1.0,
        items: [
          { prd: 'High-Performance Gigabit Network Router', qty: 3, discount: 8 },
          { prd: 'Braided Heavy-Duty USB-C Cable (2m)', qty: 20, discount: 15 }
        ]
      },

      // Month -2
      {
        monthsAgo: 2,
        day: 10,
        customerName: 'Gujarat Apex Industrial Logistics',
        status: InvoiceStatus.PAID,
        paymentRatio: 1.0,
        items: [
          { prd: 'Enterprise Cloud ERP License (Annual)', qty: 1, discount: 0 },
          { prd: 'Annual Hardware Maintenance Contract (AMC)', qty: 1, discount: 5 }
        ]
      },
      {
        monthsAgo: 2,
        day: 22,
        customerName: 'TechMatrix Global Services',
        status: InvoiceStatus.PARTIALLY_PAID,
        paymentRatio: 0.5,
        items: [
          { prd: 'IT Implementation & Integration Services', qty: 8, discount: 10 },
          { prd: 'High-Performance Gigabit Network Router', qty: 2, discount: 0 }
        ]
      },

      // Month -1
      {
        monthsAgo: 1,
        day: 4,
        customerName: 'Zenith Retail & Consumer Brands',
        status: InvoiceStatus.PAID,
        paymentRatio: 1.0,
        items: [
          { prd: 'High-Performance Gigabit Network Router', qty: 4, discount: 5 },
          { prd: 'Braided Heavy-Duty USB-C Cable (2m)', qty: 30, discount: 10 }
        ]
      },
      {
        monthsAgo: 1,
        day: 15,
        customerName: 'Sunbeam Renewable Energy Ltd.',
        status: InvoiceStatus.OVERDUE,
        paymentRatio: 0.0,
        items: [
          { prd: 'Enterprise Cloud ERP License (Annual)', qty: 1, discount: 0 },
          { prd: 'IT Implementation & Integration Services', qty: 4, discount: 0 }
        ]
      },
      {
        monthsAgo: 1,
        day: 28,
        customerName: 'Dr. Anand Mehta (Consultant)',
        status: InvoiceStatus.PAID,
        paymentRatio: 1.0,
        items: [
          { prd: 'Wireless Ergonomic Optical Mouse', qty: 2, discount: 0 },
          { prd: 'Braided Heavy-Duty USB-C Cable (2m)', qty: 4, discount: 0 }
        ]
      },

      // Current Month (Fresh Active Invoices)
      {
        monthsAgo: 0,
        day: 2,
        customerName: 'Bluewave Office Solutions Pvt. Ltd.',
        status: InvoiceStatus.SENT,
        paymentRatio: 0.0,
        items: [
          { prd: 'High-Performance Gigabit Network Router', qty: 2, discount: 5 },
          { prd: 'IT Implementation & Integration Services', qty: 2, discount: 0 }
        ]
      },
      {
        monthsAgo: 0,
        day: 8,
        customerName: 'TechMatrix Global Services',
        status: InvoiceStatus.PAID,
        paymentRatio: 1.0,
        items: [
          { prd: 'Annual Hardware Maintenance Contract (AMC)', qty: 1, discount: 0 },
          { prd: 'Wireless Ergonomic Optical Mouse', qty: 10, discount: 5 }
        ]
      },
      {
        monthsAgo: 0,
        day: 14,
        customerName: 'Gujarat Apex Industrial Logistics',
        status: InvoiceStatus.DRAFT,
        paymentRatio: 0.0,
        items: [
          { prd: 'Enterprise Cloud ERP License (Annual)', qty: 1, discount: 10 }
        ]
      },
      {
        monthsAgo: 0,
        day: 18,
        customerName: 'Zenith Retail & Consumer Brands',
        status: InvoiceStatus.CANCELLED,
        paymentRatio: 0.0,
        cancelledReason: 'Customer requested order revision and restructured item scope.',
        items: [
          { prd: 'High-Performance Gigabit Network Router', qty: 5, discount: 0 }
        ]
      }
    ];

    let invSeq = 1001;
    const createdInvoices: any[] = [];

    for (let i = 0; i < invoiceDefinitions.length; i++) {
      const def = invoiceDefinitions[i];
      const custId = customerMap.get(def.customerName);
      if (!custId) continue;

      const cust = sampleCustomers.find((c) => c.name === def.customerName)!;
      const invNumber = `INV-${invSeq++}`;

      // Check if invoice already exists
      const existingInv = await prisma.invoice.findFirst({
        where: { companyId: company.id, invoiceNumber: invNumber }
      });
      if (existingInv) {
        createdInvoices.push(existingInv);
        continue;
      }

      // Calculate issueDate and dueDate
      const issueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - def.monthsAgo, def.day, 10, 30));
      const dueDate = new Date(issueDate.getTime() + 15 * 24 * 60 * 60 * 1000);

      const isInterState = cust.state !== companyState;

      // Calculate items
      let subtotal = 0;
      let totalDiscount = 0;
      let taxableAmount = 0;
      let cgstTotal = 0;
      let sgstTotal = 0;
      let igstTotal = 0;

      const itemRecords = def.items.map((it, idx) => {
        const prd = productMap.get(it.prd) || sampleProducts[0];
        const lineGross = round2(prd.price * it.qty);
        const discAmount = round2((lineGross * it.discount) / 100);
        const lineTaxable = round2(lineGross - discAmount);
        const taxRate = Number(prd.taxRate) || 18;

        let cgstRate = 0;
        let cgstAmount = 0;
        let sgstRate = 0;
        let sgstAmount = 0;
        let igstRate = 0;
        let igstAmount = 0;

        if (isInterState) {
          igstRate = taxRate;
          igstAmount = round2((lineTaxable * igstRate) / 100);
        } else {
          cgstRate = taxRate / 2;
          sgstRate = taxRate / 2;
          cgstAmount = round2((lineTaxable * cgstRate) / 100);
          sgstAmount = round2((lineTaxable * sgstRate) / 100);
        }

        const lineTax = round2(cgstAmount + sgstAmount + igstAmount);
        const lineTotal = round2(lineTaxable + lineTax);

        subtotal += lineGross;
        totalDiscount += discAmount;
        taxableAmount += lineTaxable;
        cgstTotal += cgstAmount;
        sgstTotal += sgstAmount;
        igstTotal += igstAmount;

        return {
          productId: prd.id,
          name: prd.name,
          description: prd.description,
          hsnSacCode: prd.hsnSacCode,
          unit: prd.unit,
          sortOrder: idx,
          quantity: it.qty,
          unitPrice: prd.price,
          discountPercent: it.discount,
          discountAmount: discAmount,
          taxRate,
          subtotal: lineGross,
          taxableAmount: lineTaxable,
          cgstRate,
          cgstAmount,
          sgstRate,
          sgstAmount,
          igstRate,
          igstAmount,
          taxAmount: lineTax,
          total: lineTotal
        };
      });

      subtotal = round2(subtotal);
      totalDiscount = round2(totalDiscount);
      taxableAmount = round2(taxableAmount);
      cgstTotal = round2(cgstTotal);
      sgstTotal = round2(sgstTotal);
      igstTotal = round2(igstTotal);
      const taxAmount = round2(cgstTotal + sgstTotal + igstTotal);
      const rawGrand = taxableAmount + taxAmount;
      const grandTotal = round2(rawGrand);
      const roundOff = round2(grandTotal - rawGrand);

      const amountPaid = round2(grandTotal * def.paymentRatio);
      const balanceDue = round2(grandTotal - amountPaid);

      const invoice = await prisma.invoice.create({
        data: {
          companyId: company.id,
          customerId: custId,
          invoiceNumber: invNumber,
          sequenceNo: invSeq - 1000,
          financialYear: currentFY,
          status: def.status,
          billType: 'TAX_INVOICE',
          issueDate,
          dueDate,
          poNumber: `PO-2026-${100 + i}`,
          orderDate: new Date(issueDate.getTime() - 2 * 24 * 60 * 60 * 1000),
          currency: 'INR',
          dcNo: `DC-2026-${100 + i}`,
          dcDate: issueDate,
          modeOfDispatch: 'Courier / Express',
          billingName: cust.name,
          billingEmail: cust.email,
          billingPhone: cust.phone,
          billingGstin: cust.gstin,
          billingAddress: cust.address,
          billingCity: cust.city,
          billingState: cust.state,
          billingCountry: 'India',
          billingPostalCode: cust.postalCode,
          placeOfSupply: cust.state,
          placeOfSupplyCode: cust.gstin ? cust.gstin.slice(0, 2) : '24',
          isIgst: isInterState,
          subtotal,
          discountAmount: totalDiscount,
          taxableAmount,
          taxAmount,
          cgstAmount: cgstTotal,
          sgstAmount: sgstTotal,
          igstAmount: igstTotal,
          roundOff,
          grandTotal,
          amountPaid,
          balanceDue,
          cancelledReason: def.cancelledReason || null,
          items: {
            create: itemRecords
          }
        }
      });

      // Record payments if any
      if (amountPaid > 0) {
        const paymentMethods = [PaymentMethod.BANK_TRANSFER, PaymentMethod.UPI, PaymentMethod.CHEQUE];
        const chosenMethod = paymentMethods[i % paymentMethods.length];

        await prisma.payment.create({
          data: {
            invoiceId: invoice.id,
            companyId: company.id,
            amount: amountPaid,
            paymentDate: new Date(issueDate.getTime() + 3 * 24 * 60 * 60 * 1000),
            paymentMethod: chosenMethod,
            referenceNumber: `TXN${Date.now().toString().slice(-6)}${i}`,
            notes: `Full/Partial settlement via ${chosenMethod}`
          }
        });
      }

      // Add activity entry
      await prisma.invoiceActivity.create({
        data: {
          companyId: company.id,
          invoiceId: invoice.id,
          action: ActivityType.CREATED,
          description: `Invoice ${invNumber} generated for ${cust.name} (Amount: ₹${grandTotal})`
        }
      });

      createdInvoices.push(invoice);
    }
    console.log(`✅ Seeded ${createdInvoices.length} invoices with payment history.`);

    // 6. Create Purchase Bills (Expenses & Inward Materials)
    const purchaseDefinitions = [
      {
        vendorName: 'Microlink Technologies India Pvt. Ltd.',
        billNumber: 'PB-101',
        monthsAgo: 3,
        day: 15,
        status: PurchaseBillStatus.PAID,
        amount: 38500,
        items: [
          { name: 'Hardware Components & Circuit Boards', hsn: '851762', qty: 10, rate: 3262.71, taxRate: 18 }
        ]
      },
      {
        vendorName: 'CloudScale Infrastructure Servers Pte.',
        billNumber: 'PB-102',
        monthsAgo: 2,
        day: 1,
        status: PurchaseBillStatus.PAID,
        amount: 14200,
        items: [
          { name: 'Cloud Server Compute & CDN Bandwidth', hsn: '998315', qty: 1, rate: 12033.90, taxRate: 18 }
        ]
      },
      {
        vendorName: 'National Logistics & Express Freight',
        billNumber: 'PB-103',
        monthsAgo: 1,
        day: 20,
        status: PurchaseBillStatus.RECEIVED,
        amount: 6800,
        items: [
          { name: 'Express Freight & Dispatch Handling', hsn: '996511', qty: 1, rate: 5762.71, taxRate: 18 }
        ]
      }
    ];

    for (const pbDef of purchaseDefinitions) {
      const vId = vendorMap.get(pbDef.vendorName);
      if (!vId) continue;

      const existingBill = await prisma.purchaseBill.findFirst({
        where: { companyId: company.id, billNumber: pbDef.billNumber }
      });
      if (existingBill) continue;

      const billDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - pbDef.monthsAgo, pbDef.day));
      const vendorObj = sampleVendors.find((v) => v.name === pbDef.vendorName)!;

      const line = pbDef.items[0];
      const taxable = round2(line.qty * line.rate);
      const tax = round2((taxable * line.taxRate) / 100);
      const grand = round2(taxable + tax);
      const paid = pbDef.status === PurchaseBillStatus.PAID ? grand : 0;
      const balance = round2(grand - paid);

      await prisma.purchaseBill.create({
        data: {
          companyId: company.id,
          vendorId: vId,
          billNumber: pbDef.billNumber,
          vendorInvoiceNumber: `VINV-${Math.floor(1000 + Math.random() * 9000)}`,
          financialYear: currentFY,
          status: pbDef.status,
          billDate,
          dueDate: new Date(billDate.getTime() + 30 * 24 * 60 * 60 * 1000),
          vendorName: vendorObj.name,
          vendorGstin: vendorObj.gstin,
          vendorAddress: vendorObj.address,
          vendorCity: vendorObj.city,
          vendorState: vendorObj.state,
          vendorPostalCode: vendorObj.postalCode,
          subtotal: taxable,
          taxableAmount: taxable,
          taxAmount: tax,
          cgstAmount: round2(tax / 2),
          sgstAmount: round2(tax / 2),
          grandTotal: grand,
          amountPaid: paid,
          balanceDue: balance,
          items: {
            create: [
              {
                name: line.name,
                hsnSacCode: line.hsn,
                quantity: line.qty,
                unit: 'PCS',
                unitPrice: line.rate,
                taxRate: line.taxRate,
                subtotal: taxable,
                taxableAmount: taxable,
                cgstRate: line.taxRate / 2,
                cgstAmount: round2(tax / 2),
                sgstRate: line.taxRate / 2,
                sgstAmount: round2(tax / 2),
                taxAmount: tax,
                total: grand,
                category: ItemCategory.GOODS
              }
            ]
          }
        }
      });
    }
    console.log(`✅ Seeded purchase bills and vendor logs.`);

    // 7. Create Sample Credit Note
    const firstPaidInv = createdInvoices.find((inv) => inv.status === InvoiceStatus.PAID);
    if (firstPaidInv) {
      const existingNote = await prisma.creditDebitNote.findFirst({
        where: { companyId: company.id, noteNumber: 'CN-1001' }
      });
      if (!existingNote) {
        await prisma.creditDebitNote.create({
          data: {
            companyId: company.id,
            customerId: firstPaidInv.customerId,
            invoiceId: firstPaidInv.id,
            noteType: NoteType.CREDIT,
            noteNumber: 'CN-1001',
            sequenceNo: 1,
            financialYear: currentFY,
            status: NoteStatus.ISSUED,
            noteDate: new Date(),
            reason: 'Volume sales rebate and price correction discount.',
            billingName: firstPaidInv.billingName,
            billingGstin: firstPaidInv.billingGstin,
            billingState: firstPaidInv.billingState,
            placeOfSupply: firstPaidInv.placeOfSupply,
            subtotal: 1000,
            taxableAmount: 1000,
            taxAmount: 180,
            cgstAmount: firstPaidInv.isIgst ? 0 : 90,
            sgstAmount: firstPaidInv.isIgst ? 0 : 90,
            igstAmount: firstPaidInv.isIgst ? 180 : 0,
            grandTotal: 1180,
            items: {
              create: [
                {
                  name: 'Post-Sale Discount Rebate',
                  hsnSacCode: '998313',
                  quantity: 1,
                  unitPrice: 1000,
                  taxRate: 18,
                  subtotal: 1000,
                  taxableAmount: 1000,
                  taxAmount: 180,
                  total: 1180
                }
              ]
            }
          }
        });
        console.log(`✅ Seeded Credit Note CN-1001.`);
      }
    }

    // 8. Create Sample In-App Notifications
    const notifs = [
      {
        event: NotificationEvent.PAYMENT_RECEIVED,
        title: 'Payment Received: ₹52,400.00',
        body: 'Bluewave Office Solutions Pvt. Ltd. settled invoice INV-1001 via Bank Transfer.'
      },
      {
        event: NotificationEvent.INVOICE_CREATED,
        title: 'New Invoice Created: INV-1012',
        body: 'Tax Invoice generated for TechMatrix Global Services.'
      },
      {
        event: NotificationEvent.INVOICE_OVERDUE,
        title: 'Invoice Overdue Alert: INV-1010',
        body: 'Invoice for Sunbeam Renewable Energy Ltd. is past due date.'
      }
    ];

    for (const n of notifs) {
      if (company.userId) {
        await prisma.notification.create({
          data: {
            companyId: company.id,
            userId: company.userId,
            event: n.event,
            title: n.title,
            body: n.body,
            isRead: false
          }
        });
      }
    }
    console.log(`✅ Seeded in-app notifications.`);
  }

  console.log('\n🎉 Comprehensive database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
