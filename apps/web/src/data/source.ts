/**
 * Where page data comes from. Every page reads through apps/web/src/data, one module per area, so
 * moving a page from the simulation to Tharun's testnet routes is a change in that module only.
 *
 *   WARDLINE_DATA=sim       the API's own routes (default). The API's chain mode decides whether
 *                           those numbers come from the simulation or from NEAR testnet contracts.
 *   WARDLINE_DATA=testnet   also the T4.7 read-only routes (/v1/activity, /v1/activity/stats,
 *                           /v1/communities, /v1/people/:account). Off unless set. Run the API with
 *                           WARDLINE_CHAIN_MODE=near; it answers 503 for activity no audit has checked.
 */

export type DataSource = "sim" | "testnet";

export const DATA_SOURCE: DataSource = import.meta.env.VITE_WARDLINE_DATA === "testnet" ? "testnet" : "sim";

/** A route the testnet data source will read, whose response shape is not documented yet. */
export class NotWiredYet extends Error {
  readonly code = "NOT_WIRED_YET";
  constructor(readonly route: string) {
    super(`${route} is not wired yet. Its response shape is still to come from T4.7.`);
  }
}
