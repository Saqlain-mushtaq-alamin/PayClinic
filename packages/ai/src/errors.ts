/** Raised when an AI response cannot be parsed as the expected JSON shape. */
export class AIOutputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AIOutputError';
  }
}

/** Raised when no canned or recorded fixture exists for a fixture key. */
export class FixtureMissingError extends Error {
  readonly fixtureKey: string;

  constructor(fixtureKey: string) {
    super(`Missing AI fixture for "${fixtureKey}"`);
    this.name = 'FixtureMissingError';
    this.fixtureKey = fixtureKey;
  }
}

/** Raised when a provider keeps returning 429/5xx after every retry. */
export class AIRateLimitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AIRateLimitError';
  }
}
