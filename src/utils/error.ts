export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: Boolean;

  constructor(message: string, statusCode: number = 400, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg: string) {
    return new AppError(msg, 400);
  }

  static unauthorized(msg = 'Unauthorized access') {
    return new AppError(msg, 401);
  }

  static forbidden(msg = 'Forbidden resource') {
    return new AppError(msg, 403);
  }

  static notFound(msg = 'Resource not found') {
    return new AppError(msg, 404);
  }

  static conflict(msg: string) {
    return new AppError(msg, 409);
  }

  static internal(msg = 'Internal server error') {
    return new AppError(msg, 500, false);
  }
}
