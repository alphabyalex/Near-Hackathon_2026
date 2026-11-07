# services/mcp

Owner: Alexander

Redline as MCP tools. It calls the API at `REDLINE_API_URL` (default `http://127.0.0.1:8787`).

| Tool | Use |
| --- | --- |
| `resolve_payee` | You know the vendor's website: get its verified account |
| `check_payee` | You have a raw address: check it before paying |
| `get_vendor` | Read a vendor's record |
| `how_to_verify` | Steps for a vendor to get verified |

Pay only on PAY. Send HOLD to a human. Never pay on BLOCK. If a tool returns an error, there is no verdict, so do not pay.

## Run

```sh
pnpm --filter @redline/mcp start          # Streamable HTTP at http://127.0.0.1:8790/mcp
node services/mcp/dist/stdio.js           # stdio
```

`MCP_PORT` changes the port. `MCP_ALLOWED_HOSTS` is a comma-separated list of extra Host names to accept.

`server.json` is ready for the official MCP registry. It is not published.
