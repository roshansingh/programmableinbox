// None of these carry the request headers or the API key; status and path only.
export class PibxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** 401 or 403. Retrying cannot fix a bad or under-scoped key. */
export class PibxAuthError extends PibxError {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Any other unexpected response, including a 200 whose body is not the contract shape. */
export class PibxHttpError extends PibxError {
  constructor(readonly status: number, readonly path: string, message: string) {
    super(message)
  }
}

export class PibxTimeoutError extends PibxError {
  constructor(message: string, readonly lastStatus: number | undefined) {
    super(message)
  }
}
