#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer, redlineFromEnv } from "./index.js";

await createMcpServer(redlineFromEnv()).connect(new StdioServerTransport());
