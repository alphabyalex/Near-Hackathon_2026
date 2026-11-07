import { createGateways } from "./gateways/index.js";
import { seedWorld } from "./mock/seed.js";
import { createPayeeRuntime, type PayeeOverrides } from "./payee/runtime.js";
import type { Deps } from "./service.js";
import { Store } from "./store.js";
import { systemClock, type Clock } from "./time.js";

/** Mock gateways keep vault state in memory, so API state is reseeded to match on every start. */
export function bootstrap(dbPath: string, now: Clock = systemClock, payee: PayeeOverrides = {}): Deps {
  const store = new Store(dbPath);
  store.reset();
  const world = seedWorld(store, now());
  return { store, world, now, gateways: createGateways(world, now), payee: createPayeeRuntime(store, now, payee) };
}
