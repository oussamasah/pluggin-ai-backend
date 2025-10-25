// src/core/errors.ts
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
  
    constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
      super(message);
      this.statusCode = statusCode;
      this.isOperational = isOperational;
  
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  export class ValidationError extends AppError {
    constructor(message: string) {
      super(message, 400);
      this.name = 'ValidationError';
    }
  }
  
  export class AuthenticationError extends AppError {
    constructor(message: string = 'Authentication required') {
      super(message, 401);
      this.name = 'AuthenticationError';
    }
  }
  
  export class AuthorizationError extends AppError {
    constructor(message: string = 'Insufficient permissions') {
      super(message, 403);
      this.name = 'AuthorizationError';
    }
  }
  
  export class NotFoundError extends AppError {
    constructor(message: string = 'Resource not found') {
      super(message, 404);
      this.name = 'NotFoundError';
    }
  }
  
  export class ExternalServiceError extends AppError {
    constructor(service: string, message: string = 'External service error') {
      super(`${service}: ${message}`, 502);
      this.name = 'ExternalServiceError';
    }
  }
  
  export class RateLimitError extends AppError {
    constructor(message: string = 'Rate limit exceeded') {
      super(message, 429);
      this.name = 'RateLimitError';
    }
  }