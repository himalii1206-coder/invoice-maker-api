import { PrismaClient } from '@prisma/client';
import { config } from './index.js';

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma =
  globalThis.prismaGlobal ??
  new PrismaClient({
    log: config.isDev ? ['query', 'error', 'warn'] : ['error']
  });

if (config.isDev) {
  globalThis.prismaGlobal = prisma;
}
