class AppError extends Error {
  constructor({ status = 500, code = 'internal_error', message = 'Internal Server Error', expose = false, details = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.expose = expose;
    this.details = details || undefined;
  }
}

class ValidationError extends AppError {
  constructor(details) {
    super({
      status: 400,
      code: 'validation_error',
      message: 'Request validation failed',
      expose: true,
      details
    });
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super({ status: 401, code: 'unauthorized', message, expose: true });
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super({ status: 403, code: 'forbidden', message, expose: true });
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super({ status: 404, code: 'not_found', message, expose: true });
  }
}

class ConfigError extends AppError {
  constructor(message = 'Configuration error') {
    super({ status: 500, code: 'config_error', message });
  }
}

module.exports = {
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConfigError
};
