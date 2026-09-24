import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import routes from './routes/index.js';
import { errorHandler } from './middleware/error.js';
import { AppError } from './utils/error.js';

const app = express();

// Security headers
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

// Rate limiting. Configurable so an automated test run, dev workflow, or a busy office behind
// one NAT address is not mistaken for abuse.
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.isDev ? 10000 : config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.isDev,
  message: {
    success: false,
    message: `Too many requests from this IP, please try again after ${Math.round(
      config.rateLimit.windowMs / 60000
    )} minutes`
  }
});

app.use('/api', limiter);

// Request Parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Base Route
app.use('/api/v1', routes);

// Handle 404 Routes
app.use('*', (_req, _res, next) => {
  next(AppError.notFound('Requested API endpoint does not exist'));
});

// Central Error Handler
app.use(errorHandler);

export default app;
