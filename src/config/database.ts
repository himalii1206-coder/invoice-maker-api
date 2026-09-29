import { PrismaClient } from '@prisma/client';
import { config } from './index.js';

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

export const prisma = new PrismaClient({
  log: config.isDev ? ['query', 'error', 'warn'] : ['error']
});
