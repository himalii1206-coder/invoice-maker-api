import app from './app.js';
import { config } from './config/index.js';
import { prisma } from './config/database.js';

const server = app.listen(config.port, () => {
  console.log(`🚀 Invoice Maker Backend running on port ${config.port} [${config.env}]`);
});

const gracefulShutdown = async (signal: string) => {
  console.log(`\n⚠️ ${signal} received. Starting graceful shutdown...`);
  server.close(async () => {
    console.log('🔒 HTTP server closed.');
    await prisma.$disconnect();
    console.log('💾 Database disconnected.');
    process.exit(0);
  });
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
