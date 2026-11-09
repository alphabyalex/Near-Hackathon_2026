/** The latest metered calls, each above or below the line. */
import { getProofs as fetchProofs } from "../api/ai";

export type { ProofRow } from "../api/ai";

export const getProofs = fetchProofs;
