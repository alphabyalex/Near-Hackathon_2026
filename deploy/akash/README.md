# Deploying the backend on Akash

The API and the demo AI providers it calls run in one container, in the default **simulation** mode: no keys, no
secrets, nothing to configure. The frontend then lives on Vercel and points at it.

## What is deployed

| | |
| --- | --- |
| Image | `tharunekam/wardline-api` on Docker Hub (public, built from this repo by `deploy/akash/Dockerfile`) |
| Manifest | `deploy/akash/deploy.sdl.yaml` (1 CPU, 2 GiB, 5 GiB, port 8787 on 80) |
| Mode | `WARDLINE_CHAIN_MODE=sim`: seeded groups, pool and proofs, in memory. A restart resets them |
| Owner routes | bound to loopback inside the container, so they are not reachable from outside |

## The frontend on Vercel

```sh
deploy/vercel/deploy.sh https://<the backend's ingress host> [project name]
```

It builds the frontend with the backend's address baked in (`VITE_WARDLINE_API_URL`) and uploads only the static output.
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

## Going live on NEAR testnet instead of the simulation

That needs `WARDLINE_CHAIN_MODE=near`, the gateway's function-call key and a NEAR AI key as environment variables on a
machine you do not control. Do it only with keys made for this purpose, and put them in the deployment's sealed secrets,
never in the SDL or this repo.
