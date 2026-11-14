// Opt-in diagnostics: when WARDLINE_DEBUG_LOG_PORT is set, serves the supervisor's log over HTTP so a deployment
// with no log access can be debugged. Off by default. Never enable it with real secrets in the environment: the
// log shows what the processes print, and the info route shows the environment's variable NAMES only.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { arch, cpus, freemem, totalmem, uptime } from "node:os";

const port = Number(process.env.WARDLINE_DEBUG_LOG_PORT);
createServer((req, res) => {
  res.setHeader("content-type", "text/plain; charset=utf-8");
  if (req.url === "/info") {
    res.end(JSON.stringify({ node: process.version, arch: arch(), cpus: cpus().length, model: cpus()[0]?.model, memTotalMB: Math.round(totalmem() / 1e6), memFreeMB: Math.round(freemem() / 1e6), uptimeS: Math.round(uptime()), envNames: Object.keys(process.env).sort() }, null, 1));
    return;
  }
  try {
    res.end(readFileSync("/tmp/boot.log", "utf8").slice(-20000));
  } catch {
    res.end("no log yet");
  }
}).listen(port, "0.0.0.0");
