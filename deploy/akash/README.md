# Deploying the backend on Akash

The API and the demo AI providers it calls run in one container, **read-only against the live NEAR testnet contracts**:
no keys, no secrets, nothing to configure. The frontend then lives on Vercel and points at it.

## What is deployed

| | |
| --- | --- |
| Image | `tharunekam/wardline-api` on Docker Hub (public, built from this repo by `deploy/akash/Dockerfile`) |
| Manifest | `deploy/akash/deploy.sdl.yaml` (1 CPU, 2 GiB, 5 GiB, port 8787 on 80) |
| Mode | `WARDLINE_CHAIN_MODE=near` and `WARDLINE_REGISTRY_MODE=near`: the pool, groups, tiers, proposals and payee registry are read from `*.wardline-labs.testnet`; the activity feed is the audited log in `data/testnet`. No gateway key is set, so the API cannot sign: deposits, votes and redemptions are sent by the user's own wallet. Metered AI calls (`/v1/ai`) and the demo scenes need the simulation or a gateway key. For the seeded simulation, remove the four mode variables from the SDL |
| Owner routes | bound to loopback inside the container, so they are not reachable from outside |

## The frontend on Vercel

```sh
deploy/vercel/deploy.sh https://<the backend's ingress host> [project name] [sim|testnet]
```

It builds the frontend with the backend's address (`VITE_WARDLINE_API_URL`) and data source (`VITE_WARDLINE_DATA`, `testnet` to match this backend) baked in and uploads only the static output.
Do not import the repo into Vercel and point it at the root: Vercel reads this monorepo as two services (the Vite app
and the Hono API) and rejects a repo-root `vercel.json`. If you want Git-based deploys instead, set the project's Root
Directory to `apps/web` and set `VITE_WARDLINE_API_URL`; that route is untested.

The backend answers HTTPS with a valid certificate and sends `Access-Control-Allow-Origin: *`, so the browser calls it
directly, and the docs' code samples show the real API address.

## Rebuild and redeploy

```sh
docker buildx build --platform linux/amd64 -f deploy/akash/Dockerfile -t <user>/wardline-api:<tag> .
docker push <user>/wardline-api:<tag>
# put the tag in deploy/akash/deploy.sdl.yaml, then create the deployment in Akash Console (or the Console API)
```

Build for `linux/amd64`: that is what Akash providers run.

## Things that bit us

- **Service names set environment variables.** Kubernetes injects `<SERVICE>_PORT=tcp://...` for every service, so a
  service named `api` set `API_PORT` to a URL and the API refused to start. The SDL names the service `backend` and sets
  `WARDLINE_API_PORT=8787`, which the app reads first.
- **No logs in the Console API.** To debug a container that will not stay up, set `WARDLINE_DEBUG_LOG_PORT=9999` and
  expose port 9999 (`as: 9999`): `logserver.mjs` serves the supervisor's log and `/info`. Turn it off afterwards.
- **A slow or silent provider.** Close the deployment and bid again with another provider; the choice is per lease.

## Letting the API sign (metered AI calls)

That needs the gateway's function-call key (`WARDLINE_GATEWAY_ACCOUNT`, `WARDLINE_GATEWAY_KEY`) and a NEAR AI key as environment variables on a
machine you do not control. Do it only with keys made for this purpose, and put them in the deployment's sealed secrets,
never in the SDL or this repo.
