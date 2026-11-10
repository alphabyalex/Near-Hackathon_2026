import { config } from "zod";

// zod probes `new Function` on first parse to compile faster parsers. The site's CSP forbids eval,
// so the probe is blocked (zod falls back) and the browser logs a CSP issue. Skip the probe here.
config({ jitless: true });
