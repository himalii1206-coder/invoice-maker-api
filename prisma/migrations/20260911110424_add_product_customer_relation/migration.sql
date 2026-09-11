-- AlterTable
ALTER TABLE "products" ADD COLUMN     "customerId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "products_customerId_idx" ON "products"("customerId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

