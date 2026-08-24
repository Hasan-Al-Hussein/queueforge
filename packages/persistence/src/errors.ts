export class PersistenceConflictError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PersistenceConflictError';
  }
}

export class PersistenceNotFoundError extends Error {
  public constructor(resource: string) {
    super(`${resource} was not found`);
    this.name = 'PersistenceNotFoundError';
  }
}
