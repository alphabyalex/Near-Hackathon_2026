#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer, wardlineFromEnv } from "./index.js";

await createMcpServer(wardlineFromEnv()).connect(new StdioServerTransport());
