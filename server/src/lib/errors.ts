export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ProviderError extends AppError {
  constructor(provider: string, message: string, details?: Record<string, unknown>) {
    super(`[${provider}] ${message}`, 'PROVIDER_ERROR', 502, { provider, ...details });
    this.name = 'ProviderError';
  }
}

export class ThrottleError extends AppError {
  constructor(dataset: string, until: Date) {
    super(
      `Refresh of "${dataset}" is throttled until ${until.toISOString()}`,
      'THROTTLED',
      429,
      { dataset, throttledUntil: until.toISOString() },
    );
    this.name = 'ThrottleError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}
