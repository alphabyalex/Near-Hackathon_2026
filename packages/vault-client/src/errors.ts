/**
 * Thrown when a signed transaction was sent but no final outcome could be read in time.
 * The payment may or may not have happened. `VaultGateway` callers must treat this as
 * "outcome uncertain" and never as "not paid". Retrying with the same request digest is safe.
 */
export class VaultOutcomeUnknownError extends Error {
  constructor(
    message: string,
    readonly tx_hash: string | null,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "VaultOutcomeUnknownError";
  }
}

/**
 * The transaction executed and its final status is a failure with no `RequestResult`, for example
 * a low-gas panic, or a callback that could not run. `tx_hash` lets you inspect the receipts.
 * Read `getPayable` or `getOperation` for what the vault recorded.
 */
export class VaultExecutionError extends Error {
  constructor(
    message: string,
    readonly tx_hash: string,
    /** Stable panic code when the contract panicked with one, such as `E_NOT_OWNER`. */
    readonly code: string | null,
    readonly failure: unknown,
  ) {
    super(message);
    this.name = "VaultExecutionError";
  }
}

/**
 * NEAR refused the transaction before execution, so no contract code ran and no money moved.
 * This is what a restricted key looks like when it tries something the key does not permit.
 */
export class TransactionRefusedError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TransactionRefusedError";
  }
}

/** This process has no key for what was asked. Nothing was sent. */
export class MissingSignerError extends Error {
  constructor(vaultId: string, role: string) {
    super(`No ${role} signer configured for vault ${vaultId}`);
    this.name = "MissingSignerError";
  }
}
