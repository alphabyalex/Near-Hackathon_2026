/** Why a metered call was refused, in plain words. Codes come from the gateway and the meter. */
export const CALL_WORDS: Record<string, string> = {
  SIGNATURE_MISSING: "No signature from the provider.",
  BAD_SIGNATURE_KIND: "Signed by the gateway, not by a model TEE.",
  BAD_SIGNING_ALGO: "Signature algorithm not accepted.",
  MALFORMED_TEXT: "The signed text is not model, request and response.",
  MODEL_MISMATCH: "The signature names a different model.",
  REQUEST_HASH_MISMATCH: "The signature covers a different request.",
  RESPONSE_HASH_MISMATCH: "The response changed after it was signed.",
  BAD_SIGNATURE: "The signature is not valid.",
  SIGNER_MISMATCH: "Signed by a different key than the provider named.",
  SIGNER_NOT_ATTESTED: "The signer is not attested for this model.",
  REPLAYED: "This signed response was already paid for.",
  PROOF_REJECTED: "The meter rejected the proof.",
  UPSTREAM_TIMEOUT: "The provider did not answer in time.",
  UPSTREAM_ERROR: "The provider returned an error.",
  BAD_UPSTREAM_RESPONSE: "The provider's answer was not JSON.",
  ALLOWANCE_EXHAUSTED: "Member allowance reached. Nothing was sent.",
  BUDGET_EXHAUSTED: "Budget deposit reached. Nothing was sent.",
  UNKNOWN_MEMBER: "Not a member of this budget.",
};

export const callWords = (code: string | null): string => (code ? (CALL_WORDS[code] ?? code) : "");

/** Readable model name from an id like deepseek-ai/DeepSeek-V4.1-Flash-1017. */
export const modelName = (id: string | null): string => (id ? (id.split("/").pop() ?? id) : "none");
