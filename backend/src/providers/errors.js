export class ProviderError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'ProviderError';
    this.statusCode = statusCode;
  }
}
