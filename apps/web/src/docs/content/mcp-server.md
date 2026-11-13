---
title: MCP server
description: Give an AI assistant Wardline's checks as tools.
---

The MCP server exposes Wardline to any assistant that speaks the Model Context Protocol. It is read-only: it can look things up and never moves money.

## Connect

Paste the server's address into any MCP client that takes a server URL.

::developer-tabs{path=vendors}

For a local client, run it over standard input and output instead:

```sh
node services/mcp/dist/stdio.js
```

## Tools

| Tool | What it does |
| --- | --- |
| `resolve_payee` | Finds the account linked to a vendor's domain |
| `check_payee` | Returns a verdict for a raw account |
| `get_vendor` | Returns what is known about a vendor |
| `how_to_verify` | Explains how a vendor links its accounts to its domain |
| `get_ai_spend` | Shows a budget's spending. Needs `WARDLINE_METER_KEY` |

:::note
The tools return the same verdicts and evidence tiers as the API. If a tool returns an error, there is no verdict: do not pay. See [Payee checks](#/docs/payee-checks).
:::
