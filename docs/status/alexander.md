# Status: alexander

## Team split from 2026-11-11: Tharun on backend, Alexander on UI

From tonight Tharun owns the backend: contracts, `packages/vault-client`, `services/api`, the testnet scripts and the scheduled task. Alexander owns the UI: `apps/web`, the wallet picker and connect flow, and the pages. A change that crosses the line goes to the other owner for review.

## A19: NEAR AI key 2 checked, alexander merged into main (2026-11-11)

- **NEAR AI keys:** one models-list request each, no completion.
  - `NEAR_AI_API_KEY` and `NEAR_AI_API_KEY_2` both answer HTTP 200 with 63 models, DeepSeek V4.1 Flash among them. The two keys differ.
  - NEAR AI's models response carries no credit or balance, so remaining credit isn't shown.
  - The scripts' own ledger (main's `data/testnet/nearai-spend.json`): key 1 has 134 calls for $0.0241; key 2 has 0. The hard cap is 450 calls.
- **Where the key comes from:**
  - `pnpm testnet:batch` and `pnpm testnet:scheduled` read the repo `.env` (`loadDotEnv`).
  - The scheduled task's clone reads this same `.env` in place (`WARDLINE_DOTENV` in `scheduled-run.cmd`), so key 2 is available to it, and nothing is copied.
- **When it switches** (`scripts/testnet/simulate.ts`, `activeKey`):
  - from key 1 to key 2 when key 1's remaining credit drops under 1 USD, where remaining credit is `NEAR_AI_KEY_1_CREDIT_USD` minus the ledger's key 1 spend;
  - or when NEAR AI refuses key 1 with HTTP 402 or 401.

  The switch is saved in the ledger (`current_key`).
- **What isn't set:** `NEAR_AI_KEY_1_CREDIT_USD` isn't set, so the under-1-USD rule can't be computed. Today only a refusal from NEAR AI would switch. A 401 (an invalid or revoked key) also switches, which is broader than the credit rule.
- **Next scheduled batch:** key 1 (`current_key: key_1`).
- **Merge:** `alexander` was main plus A18, a fast-forward with no conflicts.
  - Checks first, with one worker and doubled timeouts: the pool's cargo tests, then `pnpm test` (brand, build, every package).
  - Main is now this commit; `alexander` matches it.

## A18: WARD emits NEP-141 events and carries the Horizon icon (2026-11-11)

### Part 1: already merged, skipped
A16 was already on main. Tharun merged it as `5a8a5c6`, and A17 re-ran every check on this machine. Main was `d91bca6` when this started, and `alexander` matched it. Part 2 is on `alexander` only and is not merged into main.

### Part 2: events and logo, deployed to pool.wardline-labs.testnet

**Contract** (`contracts/cover-pool`, commit `d048a22`):
- **Events:** NEP-297 `EVENT_JSON` logs with standard `nep141`, version `1.0.0`, using the spec's field names:
  - `ft_mint` (`owner_id`, `amount`) when a deposit mints WARD;
  - `ft_burn` (`owner_id`, `amount`) when a redemption pays out (locking WARD for redemption is not a burn);
  - `ft_transfer` (`old_owner_id`, `new_owner_id`, `amount`) on `ft_transfer`, `ft_transfer_call` and the `ft_resolve_transfer` refund (memo `refund`).

  `memo` appears only when there is one. Fees and the first-loss stake mint no WARD, so they log no `ft_mint`.
- **Icon:** owner-only `set_icon(icon: Option<String>)`. It accepts only a `data:image/` URL of 16 KB or less, and None clears it. `ft_metadata.icon` reads it from its own storage key (`ward_icon`), outside the contract state, so it can change later with no migration.
- **Tests:** 8 new unit tests, 25 of 25 passing for the pool. They cover each event's exact JSON (`ft_mint`; `ft_transfer` with and without memo; `ft_transfer` from `ft_transfer_call`; `ft_burn` only at payout), no `ft_mint` for fees, `ft_metadata` returning the icon (and None after clearing), a non-owner refused, and a non-data icon refused.

**Icon:** the favicon's Horizon mark (same `horizonDots` generator and parameters: R 98, step 16, light [-0.45, -0.5], on the `#0E0912` rounded square).
- 96 dots, grouped by color, coordinates rounded, no metadata.
- **3,418 bytes as SVG, 3,855 bytes as the data URL.**
- Checked at 32, 48 and 200 px.

**Deploy** (pool key, deploy only; no migrate was needed because the state layout didn't change):
- **Saved first** to `%USERPROFILE%\.wardline\testnet\`:
  - `a18-pre-upgrade.json`: `get_pool`, `ft_metadata`, `ft_total_supply`, `governance_params`, the 4 proposals, the 2 claims, and the WARD balances and positions of hyperios.testnet, lp-north, lp-harbor, lp-solano and dana.
  - `a18-pool-before.wasm`: the on-chain wasm from `view_code` (315,535 bytes, code hash `Cu1apNGBvA6vqWfYSnnFqeLTwZVrCe4H8ve2TagoG7Rg`), ready for a rollback.
- **Deploy tx:** [`2dbpowKhwUtq7khK3EyGNGAWaFsVHGLas7Pma6xYKu6r`](https://testnet.nearblocks.io/txns/2dbpowKhwUtq7khK3EyGNGAWaFsVHGLas7Pma6xYKu6r). The wasm is 318,509 bytes, and the new code hash `2qY1gC2u6PessLcZPNK3mqJYNNDRzQZ2ohCdJcdHPtwD` equals the local build's.
- **set_icon tx:** [`GdAKbDnwPGbwzLACq5ue1Pwt6nRRj5TfX9K414PhrBJZ`](https://testnet.nearblocks.io/txns/GdAKbDnwPGbwzLACq5ue1Pwt6nRRj5TfX9K414PhrBJZ), signed by the owner, wardline-labs.testnet. `ft_metadata.icon` now returns the mark, **3,855 bytes**.
- **Before and after:** identical after the deploy and again after `set_icon`, comparing `ft_metadata` without the icon. That covers:
  - the pool: TVL 12.150305 USDC, WARD supply 11.715742;
  - governance params, all proposals and claims;
  - every saved balance and position: hyperios 9.996121, lp-north 0.269936, lp-harbor 0.249949, lp-solano 0.100000, dana 0.999736 WARD.

  Storage went from 329,017 to 335,895 bytes (+2,974 for code, +3,904 for the icon), paid from the pool's own 3.5 NEAR.
- `pnpm testnet:audit` passes: 202 of 202 rows, 0 misses.

**Windows toolchain notes:**
- **Rust:** 1.95.0 with the GNU host (`x86_64-pc-windows-gnu`, since this machine has no MSVC build tools), plus the `wasm32-unknown-unknown` target.
- **cargo-near 0.22.0:** the prebuilt release, SHA-256 checked.
- **Binutils:** GNU builds need a working `dlltool` and assembler. Rust's bundled `dlltool` can't run without `as.exe`, so WinLibs GCC 16.2 (portable, in `%USERPROFILE%\.wardline-mingw`) supplies `as` and `dlltool`. For `cargo test` it also supplies `gcc`, `cmake` and `nasm` (`aws-lc-sys` comes in through near-sdk's unit-testing feature).
- **No ABI embedded:** `cargo near build` can't generate the ABI on the GNU host (it fails to link near-sdk's host functions), so the wasm is built with `--no-abi`. The previous wasm may have had one; nothing calls it.
- **Build output** goes to `%USERPROFILE%\.wardline-target`, outside OneDrive.

**What a wallet will show:** the contract now announces every WARD move. But balances minted before this deploy were never announced, so a wallet or indexer that discovers tokens from events may not list WARD for hyperios.testnet until an event involves that account (its next deposit, a redemption, or a WARD transfer). Adding the token by contract (`pool.wardline-labs.testnet`) in Meteor works now, with the icon.

### Part 3: Tharun had done it too; mine is deployed
- **What Tharun had:** `origin/tharun` has `276b5ab`, "emit standard NEP-141 event logs and upgrade cover pool on testnet", which isn't on main. It was what was deployed: the old on-chain wasm contains his `ft_mint`, `ft_burn` and `refund` strings, and no `set_icon`.
- **Kept:** his `migrate` fix, which returns state already in the current shape unchanged. It doesn't overlap with this task.
  - **Caveat:** near-sdk's `state_read` panics, rather than returning None, when stored state is an older shape. So with this line, migrating from an older shape would fail instead of falling through. Nothing on chain is an older shape, and this deploy didn't call `migrate`.
- **Replaced with mine:**
  - the NEP-141 event helpers in `events.rs`;
  - `ft_mint` in `mint`;
  - `ft_burn` on both redeem paths;
  - the refund `ft_transfer` in `ft_resolve_transfer`;
  - his event test (`test_nep141_event_logs_exact_json`), replaced by the tests above.

  His event JSON had the same field names, so indexers see the same shapes either way. The icon is new in mine.
- **Not taken, outside this task's files:** `scripts/contracts/src/upgrade-nep141.ts` and his `docs/status/tharun.md` notes.
- **On chain:** mine replaced his build (code hash `Cu1apNGB…` became `2qY1gC2u…`), with the state saved and compared first.

## A17: checks re-run on this machine, alexander and main in sync (2026-11-11)

- **Re-run** with one worker and doubled timeouts, because OneDrive sync was taking about two cores. Everything passed on `29e7dfc` (A16):
  - `node --test tests/brand.test.mjs`: 7 of 7.
  - Unit tests in every package: API 251, web 119, agent 117, payee-check 89, sdk 59, x402-guard 53, vault-sim 50, schemas 31, evaluator 26, redteam 34, vault-client 14, dao-adapter 13, mcp 13, demo-provider 5. The demo scene that timed out under load before passed.
  - Chromium e2e: 53 of 53. iPhone WebKit: 12 of 12.
  - Nothing failed because of A16, so there was nothing to fix.
- **Merge:** a no-op. Tharun had already merged alexander into main (`5a8a5c6`) and added `f1b1cb2`, which also reads NEP-141 events and counts `ft_transfer_call` on the pool as Sent or Received WARD. I reviewed it: it doesn't change how deposits, redeems or votes are read. `alexander` is fast-forwarded to main, and the API suite passes there: 252 of 252.

## A16: Your transactions from the chain (2026-11-10)

On `alexander`, fast-forwarded from main (`37edd42`). No transactions sent.

- **New route, `GET /v1/people/:account/transactions`** (`services/api/src/activity/transactions.ts`). It reads the account's Wardline transactions from the chain, so it works the same on the hosted site:
  - **Lists** them with NearBlocks testnet API v3 (`/v3/accounts/:id/txns` and `/ft-txns`, no key). FastNEAR wasn't needed.
  - **Keeps only our contracts:**
    - `ft_transfer_call` on USDC, and only when its `receiver_id` is the pool;
    - `request_redeem`, `request_withdraw`, `redeem`, `vote`, `propose`, `execute` and `ft_transfer` (WARD) on the pool.
  - **Confirms each one with the RPC `tx` method:** same hash, signer, receiver and method. Amounts come from the confirmed transaction:
    - USDC from its arguments;
    - WARD from the pool's own `pool_deposited` event;
    - price is USDC divided by WARD;
    - the unlock date from `request_redeem`'s result.

    A hash the RPC can't confirm is dropped. A failed transaction, or a deposit the pool refunded, is kept and shown as Failed.
  - **Merges** with the account's audited rows from `activity.jsonl`, de-duplicated by hash (the chain's reading wins), newest first. `totals` (deposited, redeemed) come from confirmed rows only.
  - **Caching:** 30 s per account. Each hash is confirmed once. NearBlocks calls are spaced at least 1.1 s apart. `?pending=<hash>` re-reads early, at most every 4 s, when a page is waiting for a new hash.
  - **When NearBlocks is down,** it returns the rows already confirmed plus `complete: false`. The page then says "Some history may be missing. Check the explorer." with a link to the account on testnet.nearblocks.io.
- **Your transactions on #/me** is now a Horizon table:
  - **Columns:** Date (local time; full timestamp on hover), Type, USDC, WARD, WARD price, Status, and a short hash linking to testnet.nearblocks.io.
  - **Types:** Bought WARD, Sell requested (with its unlock date), Sold WARD, Voted for or against #N, Proposed #N, Executed #N, Sent WARD, Received WARD.
  - **Paging:** newest first, 10 at a time with Show more.
  - **Telling them apart without red:** buys carry a solid violet dot and +WARD, sells an open violet ring and minus WARD, governance a small grey square. Failed rows are muted and struck through.
  - **Phones:** each row is a two-line card, with no sideways scroll.
- **Pending, then Confirmed:** right after Join, a redeem request, a redeem or a vote, the new row appears at the top as Pending with its hash. It asks the route again every 5 s and flips to Confirmed when the chain returns it. No reload needed.
- **Totals:** Your share's deposited, redeemed and earned now come from the confirmed rows plus the pool's position. Earned shows for wallet members now, and matches the table.
- **Live check** against the testnet API: `hyperios.testnet` shows Bought WARD on Nov 10, 10.00 USDC, +9.996121 WARD (shown as 9.99), WARD price 1.0004 (1.000388), Confirmed. The link opens `7UAt5yhw2b4nFb6L1tjWZwRXpbWZEEXPuiSk6Gax3mJp` on testnet.nearblocks.io, and Earned since joining reads 0.00 USDC. Screenshots, looked at and fixed once (column spacing, the USDC line on phone cards): `apps/web/screenshots/me-transactions-1440.png`, `me-transactions-iphone-se.png`, `me-share-1440.png`, `me-share-iphone-se.png`.
- **Tests:**
  - `services/api/test/transactions.test.ts` (10): the filter, including USDC sent anywhere but the pool; confirmation, where a fake hash and a wrong signer are dropped; a failed transaction kept; de-dup and order; totals; the 30 s cache; the indexer-down flag.
  - `apps/web/test/transactions.test.tsx` (6): words, amounts, marks and links; Show more; the explorer line; no red; the Pending-to-Confirmed flip; totals.
- **Full checks completed (re-run by Tharun on clean environment):**
  - **`pnpm testnet:audit`:** passed, 202 of 202 rows.
  - **`pnpm test`:** 100% passed across all 11 packages and services. 252 of 252 API tests passed.
  - **Chromium e2e:** 53 of 53 passed (51.2s).
  - **iPhone WebKit:** 12 of 12 passed (15.8s).
- **Received and sent WARD coverage:** expanded to parse standard `nep141` events in addition to `wardline` custom events, and added `ft_transfer_call` to the allowed pool methods in `confirmTx`.
- **Files touched:**
  - **New:** `services/api/src/activity/transactions.ts`, `services/api/test/transactions.test.ts`, `apps/web/src/data/transactions.ts`, `apps/web/src/views/site/Transactions.tsx`, `apps/web/src/views/site/transactions.css`, `apps/web/test/transactions.test.tsx`.
  - **Changed:**
    - `services/api/src/activity/routes.ts`: the route.
    - `apps/web/src/views/site/Me.tsx`: the transactions section and the totals.
    - `apps/web/src/views/site/Member.tsx`: the Join and redeem success states add a Pending row.
    - `apps/web/src/views/site/Governance.tsx`: the vote success state adds a Pending row.
    - `apps/web/src/brand.ts`: the `ME.tx` copy.
    - `docs/status/alexander.md`.

## A15: tharun and alexander merged into main (2026-11-10)

**main:** `723cec6`, the merged code (alexander on top of tharun), then the scheduled task's 21:00 UTC data as `2f2a72d`. This report fast-forwards main once more. `alexander` is fast-forwarded to main.

- **origin/tharun first:** already in main (`13afeea`, his page transitions, the meter fee and coverage views, the price history filter). Nothing to merge.
- **alexander second:** a fast-forward, since alexander already held main from the A14 merge (`4a902e6`, no conflicts). No code conflicts.
- **One data conflict, resolved for the scheduled task.**
  - **Cause:** Tharun's `13afeea` also changed `data/testnet/audit.json` (an audit stamp from his machine). So the scheduled run at 21:00 UTC passed its audit (202 of 202 rows) but its `git pull --rebase` conflicted. As designed, it skipped the push and kept the commit in its clone.
  - **Fix:** following the rule that data/testnet/ belongs to the scheduled task on main, I moved the task's clone to the new main and took that run's `data/testnet/` (14 new rows), with the original commit kept as branch `backup-scheduled-2100` in the clone. I rebuilt the clone, re-ran the audit there (PASS 202 of 202, 0 misses) and pushed `2f2a72d`. The clone is clean and in sync for its next run (03:00 UTC).
  - **To avoid a repeat:** commit `data/testnet/` only from the scheduled task. An audit run on any other machine rewrites `audit.json`'s stamp; restore it (`git checkout -- data/testnet`) instead of committing it.
- **Price history on Your share:** checked for `hyperios.testnet`, which has joined (9.996 WARD, 10.00 USDC).
  - The chart still draws a line: "WARD price since launch: 1.0000 to 1.0004 USDC over 156 changes".
  - Tharun's `<=` join filter only trims the "Where your share came from" list. The chart uses the history since launch.
  - No fallback was needed, so none was added.
- **Checks on `723cec6`:** `pnpm test` passes (API 241, web 113, brand 7, every other package). The Chromium e2e passes 53 of 53 and iPhone WebKit 12 of 12. `pnpm testnet:audit` passes 188 of 188, and 202 of 202 after the 21:00 data on main.

## A14: one Horizon wallet panel (2026-11-10)

`alexander` couldn't be fast-forwarded: it had the A13 commits and main had new ones. I merged main into it instead (`4a902e6`, no conflicts). Main is untouched, and no transactions were sent.

### The panel

- **Our panel is the picker.** A click on a logo calls NEAR Connect's `connect({ walletId })`, which skips NEAR Connect's selection modal and opens that wallet. When a wallet shows its own window (NEAR Connect's iframe), our panel hides until it closes, so two panels never stack. No typed account, no confirm step.
- **Grid:** Meteor, Intear, Nightly. **More wallets** (collapsed): Ledger.
  - Installed extensions move to the front: Meteor via `window.meteorCom`, Nightly via `window.nightly.near`.
  - On phones, wallets with a phone app move up (Meteor).
- **Left out, with the reason:**
  - **HOT:** tried on testnet. The executor answers "HOT Wallet not supported on testnet".
  - **MyNearWallet:** tried on testnet. NEAR Connect answers "Permission denied": on testnet the executor opens `testnet.mynearwallet.com`, but its manifest only allows `app.mynearwallet.com`.
  - **Unity and WalletConnect:** NEAR Connect removes every wallet with the `walletConnect` permission unless it's given a WalletConnect client, which needs a Reown project id. None is set. With an id they can be added to `wallets/catalog.ts`.
  - **Never shown:** NEAR Mobile, NEAR CLI, OKX, Hana, Trezu, Ethereum wallets, Phantom, MetaMask.
- **Logos:** each wallet's NEAR Connect manifest icon, bundled in `apps/web/public/wallets/`. Nightly's was WebP and was converted to PNG pixel for pixel. Nothing recolored. Alt text is the wallet name.
- **First connect sticks:** NEAR Connect's `wallet:signIn` event now saves the account wherever it lands. A slow wallet window, a page that lost focus, a closed panel, or a wallet promise that never settles all still connect.
  - Reading the account right after sign-in retries briefly if the wallet hasn't saved it yet.
  - Nothing times out: after 90 s the panel says it's still waiting and offers Try again.
  - This covers the likely causes of the Meteor Web miss, but I couldn't reproduce it here (no Meteor in this browser), so your test is the real check.
- **Connected, in the same panel:**
  - The member's own halftone sphere (`horizonDots`, light from `seededLight(account)`), the account, and "Connected with Meteor".
  - USDC and NEAR side by side in tabular figures, and a line when NEAR is under 0.05.
  - Go to my share (primary), Switch wallet (secondary), Disconnect as a quiet muted link. No red anywhere in the panel.
- **Errors under the grid,** each with Try again on the same wallet: blocked window, rejected, not installed, and a new "That wallet didn't answer." for a wallet that can't be reached.
- **Developer:** the local test signer and the e2e test wallet sit in a Developer disclosure at the bottom. It appears only in local dev and e2e builds, never in the grid.
- **Shape and motion:**
  - Kept: anchored under the header on desktop, focus trap, Escape, outside click, Cancel. On phones it's always a bottom sheet with a grab handle and safe-area padding, whichever button opened it.
  - Motion: the panel rises 8px in 180ms and the tiles fade in with a 30ms stagger. The only loop is the spinner while a wallet opens. Under reduced motion, the entrance and hover lift are off and the spinner slows.

### Security headers

The production CSP is back to exact hosts. I found them by building the site, serving it with its headers, clicking each wallet, and reading every CSP violation until there were none:
- **connect-src:** `raw.githubusercontent.com`, `cdn.jsdelivr.net` (NEAR Connect's manifest and wallet code), `wallet.meteorwallet.app`, `mc.meteorwallet.app` (https and wss), `wallet.intear.tech`, `wss://logout-bridge-service.intear.tech`, the testnet RPCs (`test.rpc.fastnear.com`, `rpc.testnet.near.org`, `api.testnet.fastnear.com`, `helper.testnet.near.org`), plus the API and any `VITE_NEAR_RPC_URL` hosts.
- **frame-src:** `wallet.intear.tech`.
- **img-src:** `meteorwallet.app` and `storage.herewallet.app` (the wallets' own panels).
- **style-src and font-src:** `rsms.me` and `fonts.cdnfonts.com` (Meteor's panel fonts); font-src also allows `data:`.
- **`'unsafe-inline'` stays in script-src.** NEAR Connect runs each wallet's code as an inline script in a sandboxed `srcdoc` iframe, which inherits our policy. The code is fetched at run time, so no hash can name it, and a static host can't send a fresh nonce. Checked: with it removed, every wallet stops at "Opening" with "Executing inline script violates ... script-src 'self'".

### Checks

- **Unit tests** (`apps/web/test/wallet-panel.test.tsx`, 13): the list, its order and installed detection; one-click connect; first connect sticking from the event and after the panel closed; refusing another network's account; the connected state (balances, low NEAR, buttons, quiet Disconnect); errors and Try again; no red in the panel CSS; axe on the picker, error and connected states.
- **Suites:** `pnpm test` passes (API 241, web 113, brand 7, every other package). The Chromium e2e passes 53 of 53, iPhone WebKit 12 of 12.
- **Screenshots** (`node --import tsx e2e/wallet-shots.ts`, against the local testnet dev site, saved in `apps/web/screenshots/`): `wallet-picker-1440.png`, `wallet-hover-1440.png`, `wallet-opening-1440.png`, `wallet-error-1440.png`, `wallet-connected-1440.png`, `wallet-picker-iphone-se.png`, `wallet-opening-iphone-se.png`, `wallet-error-iphone-se.png`, `wallet-connected-iphone-se.png`.
  - Phones have no hover, so there's no hover shot at iPhone SE.
  - The iPhone SE shots use the 375 x 667 SE. Playwright's plain "iPhone SE" preset is 320px wide, where the grid correctly drops to two columns.
  - After review I fixed: a faint title mark, "Opening Meteor" overflowing narrow tiles, a wrong error message ("didn't sign") for a wallet that can't be reached, a centred dialog instead of a bottom sheet on phones, a stranded Cancel, and wrapping action buttons.

### Files touched

- **New:**
  - `apps/web/src/wallets/WalletPanel.tsx`, `apps/web/src/wallets/catalog.ts`, `apps/web/src/wallets/wallet-panel.css`
  - `apps/web/public/wallets/meteor.svg`, `intear.svg`, `nightly.png`, `ledger.svg`
  - `apps/web/test/wallet-panel.test.tsx`, `apps/web/e2e/wallet-shots.ts`
- **Changed:**
  - `apps/web/src/wallets/near.ts`: one-click connect and the sign-in listener.
  - `apps/web/src/wallets/connected.ts`: the wallet id types moved here, plus `via`.
  - `apps/web/src/components/Dialog.tsx`: title mark, grab handle and panel class.
  - `apps/web/src/views/site/Member.tsx`: only `ConnectDialog`, and Join's connect step, which now opens the same panel.
  - `apps/web/src/brand.ts`: the `WALLET` copy and `ERRORS.walletUnreachable`.
  - `apps/web/src/data/errors.ts`: the `walletUnreachable` kind.
  - `apps/web/vite.config.ts`: security headers only.
  - `apps/web/e2e/testnet.spec.ts`: opens the Developer disclosure.
  - `apps/web/package.json` and `pnpm-lock.yaml`: `axe-core` as a dev dependency.
  - `docs/status/alexander.md`.

## A13: real wallets on testnet with NEAR Connect (2026-11-10)

On `alexander`, fast-forwarded from main (`c11959d`). Not merged to main.

- **Sign-in:** `@hot-labs/near-connect` 0.12.0 replaces `@near-wallet-selector`.
  - The Horizon connect panel (bottom sheet on phones) has one button, Connect a NEAR wallet, which opens NEAR Connect's wallet list.
  - Only wallets that support testnet and `signAndSendTransaction(s)` are listed: against today's live manifest, Meteor, Intear, Ledger, Nightly and NEAR CLI. `ethereum-wallets` is excluded.
  - The account comes from the wallet. A typed account remains only for the local test signer and the e2e test wallet.
  - NEAR Connect loads when the panel opens, so the click opens the wallet list at once. A blocked wallet window shows the existing pop-up message.
- **Verify and the owner sign-in:** both use NEAR Connect for NEP-413 message signing and take the account from the wallet.
- **Join on testnet:** real transactions from the wallet.
  - **Before the click,** the dialog reads USDC, spendable NEAR, WARD and `storage_balance_of` on the pool.
  - **On the click,** the wallet goes straight to `signAndSendTransactions`:
    - `storage_deposit` on the pool (0.00125 NEAR), only if not yet registered;
    - then `ft_transfer_call` on USDC to the pool, with 1 yocto and `msg: ""` (the same msg as the local signer).
  - **Afterwards,** it reads WARD again and shows the difference with a View transaction link.
- **Vote, redeem and execute:** `vote`, `request_redeem`, `redeem` and `execute` on the pool, signed by the wallet, each with a transaction link.
- **No fake path:**
  - In near mode, `/v1/pool/challenge` and `/v1/pool/submit` answer 409 `WALLET_TRANSACTION` before touching any pool. Sim mode keeps them for the offline README steps.
  - This also closes a worse hole: near mode would have called the pool's unauthenticated `deposit(account, amount)`, which mints WARD without USDC.
- **Errors before signing:**
  - "Not enough USDC in this wallet for that deposit." Next step: lower the amount, or use Circle's faucet.
  - "You need about 0.05 NEAR for network fees." Next step: send testnet NEAR to the account.
  - The dialog also shows the wallet's USDC and NEAR balances, and says when the first deposit registers storage.
- **CSP (production headers):** NEAR Connect runs wallet code in sandboxed `srcdoc` iframes that inherit the page's policy. So `script-src` adds `'unsafe-inline'`, and `connect-src`, `frame-src` and `img-src` allow `https:` (plus `wss:` for connect-src). Without this, no wallet works on a static host. This is looser than before; decide whether to keep it.
- **Phantom and MetaMask: not shipped, never in the UI.**
  - The `ethereum-wallets` entry (evm-on-near.dev) claims testnet support, but connect, deposit and vote could not be verified here: this machine's browsers have no MetaMask or Phantom extension, and the test browser can't sign as one.
  - Per the rule (no half-working option), it is excluded in `EXCLUDED_WALLETS`, and an e2e test checks it doesn't appear. Phantom stays on the Verify page (Solana message signing), as before.
- **Tests:**
  - **Mocked connector** (`apps/web/test/wallet.test.ts`, 7 tests): connect, refusing a mainnet account, deposit with and without storage registration, short USDC, short NEAR, vote, redeem request and redeem, and refusing to sign as another account. Every test also asserts that no call reaches `/v1/pool/challenge` or `/submit`.
  - **API test:** near mode refuses all five actions and never calls the pool or governance.
  - **E2e test:** NEAR Connect lists only testnet transaction wallets.
  - **Results:** `pnpm test` passes (API 241, web 100, brand 7, every other package). The Chromium e2e passes 53 of 53, iPhone WebKit 12 of 12, and `pnpm testnet:audit` 188 of 188.
- **Manual test:** sent 0.5 NEAR from `wardline-labs.testnet` to `hyperios.testnet` ([Ar7iVi3t…](https://testnet.nearblocks.io/txns/Ar7iVi3tvkQmodLyEu18madda1QdA2jG7L4scpeuXcmw)). hyperios.testnet now has 0.5 NEAR and 20 USDC, and is not yet registered on the pool, so its first Join is two transactions.
- **Local stack for the Meteor test:** the near-mode API on 127.0.0.1:8787 was rebuilt and restarted with this code. The testnet web dev server on 127.0.0.1:5173 already serves it.
- **Not done:** wallet transactions are not written to `data/testnet/activity.jsonl`. They're on chain and in the pool's numbers, but the activity feed lists only batch and local-signer rows. Recording them would need an API route that builds the row from RPC.

## A12: small fixes, scheduled data commits, merge to main (2026-11-10)

**main:** merge commit `76bf6b5` (alexander into main). Since then the scheduled task has pushed `d9ad255` and `613c285` to main (data only), and this report goes to main as a fast-forward on top of them.

1. **Data committed:** `data/testnet/` as of the passing audit (161 of 161 rows), `452237b`. No batch had run since, so only `audit.json`'s stamp changed.
2. **Small fixes:**
   - **Old test budgets:** Groups and Safest groups no longer show `bgt_engineering` and `bgt_leaked_*`. In near mode the reputation lists keep only the budgets listed in `scripts/testnet/cast.json` (communities and individuals), not a name pattern. Stats count the same set. Tests: `services/api/test/cast-filter.test.ts`.
   - **Snippet URLs:**
     - Configured, else hosted; else the local API when the page is served from a host in `repo.config.json`'s `local.hosts`; else the placeholder `https://your-wardline-api.example` (`PLACEHOLDER_API_URL`), with a line saying to replace it. Never a tunnel link.
     - The direct SDK snippet now names the deployed registry, `payee-registry.wardline-labs.testnet`, not the old `payees.redline-labs.testnet`.
   - **Sim names:** they match cast.json: Nightshade DAO, Kelp Collective, plus Hayes Valley house and Aurora Lab, which were also off. A test checks every sim budget against cast.json.
   - **Dialogs:** an open dialog marks every other child of `<body>` with `inert` and `aria-hidden`, and restores only what it changed on close. A dialog opened from a dialog works the same way. Two tests in `apps/web/test/ui.test.tsx`.
3. **The scheduled task commits its own data:**
   - **Where it runs:** `scripts/testnet/scheduled-run.ps1`, in its own clone on main at `%USERPROFILE%\.wardline\testnet\wardline-main`. The OneDrive checkout on `alexander` is never touched, so a commit can only carry `data/testnet/`.
   - **Keys:** it reads the OneDrive checkout's `.env` in place (`WARDLINE_DOTENV`); no key is copied.
   - **Each run:**
     - Rebuilds when the clone's code changed.
     - Runs the batch and the audit.
     - Only on a pass, commits `data/testnet/` as `chore(testnet): scheduled batch <UTC time>`, runs `git pull --rebase origin main`, and pushes main.
     - It commits before the pull, so a conflicting rebase can be aborted cleanly. Then the push is skipped, the commit stays in the clone, and the log says why.
   - **Tested:**
     - The first trigger by hand was cut off seconds in (exit 0xC000013A, a closed console); nothing was written.
     - The wrapper run directly pushed `d9ad255` (8 calls, audit 174 of 174).
     - A second trigger through Task Scheduler finished with result 0 and pushed `613c285` (audit 188 of 188).
   - **Task settings:** it now runs on battery and is no longer stopped by a switch to battery, with a 2-hour limit. NEAR AI calls: 125 of 450.
4. **Checks before the merge:** `pnpm test` passes (API 240, web 93, every other package). The Chromium e2e passes 53 of 53, and `pnpm testnet:audit` passes 161 of 161.

- **From now on, `data/testnet/` belongs to main:** the scheduled clone writes it. Don't commit it on `alexander`; fast-forward `alexander` from main to get fresh data.
- **Log:** `%USERPROFILE%\.wardline\testnet\scheduled.log`. The previous wrapper is kept as `scheduled-run.cmd.bak`.

## A11 overnight: every function on real NEAR testnet (2026-11-10)

Started 10:04 UTC, finished 15:36 UTC. Work is on `alexander` (pushed in small commits); main is untouched.

### Part by part

| Part | Status | Notes |
| --- | --- | --- |
| 0. Keep the machine awake | Done | Sleep on AC set to never; hibernate on AC was already never. Restore below |
| 1. Credentials | Done | The handoff was at `Downloads\wardline-handoff\`. Keys are installed outside the repo; the root key matches `ed25519:FGUWrt4Y` and the gateway key matches |
| 2. Testnet communities | Done, with cuts | Cast scaled down (only one real DAO fits the NEAR budget). Three batches, all audited, and a scheduled task. Claims and tiers in their own section |
| 3. UI on testnet data | Done | Behind `WARDLINE_DATA=testnet`; sim stays the default |
| 4. Every function | 9 done, 1 partial | Function 7: the redemption request is real, but the pool's delay is 0 days on testnet, so there is no countdown to show (needs your OK to change; see below) |
| 5. Hosting | Done | Hosted values are empty; docs point at a local run. Notes for Tharun below |
| 6. Docs and checks | Done | README sections written. `pnpm test`, the Chromium e2e, the iPhone WebKit test and the audit all pass |

### Preflight (public keys only)

| Account                                     | Key type                                | Public key          | Status  | NEAR  |
|---------------------------------------------|-----------------------------------------|---------------------|---------|-------|
| wardline-labs.testnet                       | FullAccess                              | ed25519:FGUWrt4Y... | MATCHES | 5.536 |
| payee-registry.wardline-labs.testnet        | FullAccess                              | ed25519:BwwoYr7b... | MATCHES | 2.497 |
| vault.wardline-labs.testnet                 | FullAccess                              | ed25519:ParX7ZnJ... | MATCHES | 3.497 |
| model-registry.wardline-labs.testnet        | FullAccess                              | ed25519:CdHybkgp... | MATCHES | 2.498 |
| pool.wardline-labs.testnet                  | FullAccess                              | ed25519:CUpdj5Ng... | MATCHES | 3.506 |
| meter.wardline-labs.testnet                 | FullAccess                              | ed25519:CMP1SQDo... | MATCHES | 3.355 |
| dao.wardline-labs.testnet                   | FullAccess                              | ed25519:F5ACCDbP... | MATCHES | 6.495 |
| provider.wardline-labs.testnet              | FullAccess                              | ed25519:3ZC5H3kj... | MATCHES | 0.500 |
| investor1.wardline-labs.testnet             | FullAccess                              | ed25519:32YW8Rf2... | MATCHES | 0.496 |
| investor2.wardline-labs.testnet             | FullAccess                              | ed25519:FuGaj5V1... | MATCHES | 0.500 |
| agent.wardline-labs.testnet                 | FullAccess                              | ed25519:DuYkNBJP... | MATCHES | 0.500 |
| token.wardline-labs.testnet                 | FullAccess                              | ed25519:5qxkQpxz... | MATCHES | 2.502 |
| dana.wardline-labs.testnet                  | FullAccess                              | ed25519:8s2B6whn... | MATCHES | 0.308 |
| eli.wardline-labs.testnet                   | FullAccess                              | ed25519:6Xi5qmXP... | MATCHES | 0.298 |
| tariq.wardline-labs.testnet                 | FullAccess                              | ed25519:AtzZhRCP... | MATCHES | 0.050 |
| ruth.wardline-labs.testnet                  | FullAccess                              | ed25519:3AdJ1yLK... | MATCHES | 0.100 |
| priya.wardline-labs.testnet                 | FullAccess                              | ed25519:BkjGwhue... | MATCHES | 0.050 |
| sam.wardline-labs.testnet                   | FullAccess                              | ed25519:8t8AgEMu... | MATCHES | 0.100 |
| owen.wardline-labs.testnet                  | FullAccess                              | ed25519:3o1iNDyK... | MATCHES | 0.050 |
| alice.wardline-labs.testnet                 | FullAccess                              | ed25519:8aWwDNtU... | MATCHES | 0.100 |
| ci-agent.wardline-labs.testnet              | FullAccess                              | ed25519:4ewwEekD... | MATCHES | 0.050 |
| ana.wardline-labs.testnet                   | FullAccess                              | ed25519:8kvm8moF... | MATCHES | 0.100 |
| kelp-agent.wardline-labs.testnet            | FullAccess                              | ed25519:EN2ieRZx... | MATCHES | 0.050 |
| ivan.wardline-labs.testnet                  | FullAccess                              | ed25519:7FBPqQKd... | MATCHES | 0.099 |
| yuki.wardline-labs.testnet                  | FullAccess                              | ed25519:uo8mTcLi... | MATCHES | 0.099 |
| hassan.wardline-labs.testnet                | FullAccess                              | ed25519:9CZAF1Ud... | MATCHES | 0.099 |
| olivia.wardline-labs.testnet                | FullAccess                              | ed25519:AqdYiwmn... | MATCHES | 0.099 |
| lucas.wardline-labs.testnet                 | FullAccess                              | ed25519:BtdkWvkU... | MATCHES | 0.099 |
| lp-north.wardline-labs.testnet              | FullAccess                              | ed25519:B4VnS6av... | MATCHES | 0.146 |
| lp-harbor.wardline-labs.testnet             | FullAccess                              | ed25519:5mjqrSz9... | MATCHES | 0.146 |
| lp-solano.wardline-labs.testnet             | FullAccess                              | ed25519:Bm3SBpEN... | MATCHES | 0.148 |
| mission-dao.wardline-labs.testnet           | FullAccess                              | ed25519:6t7TkDfA... | MATCHES | 5.696 |
| nightshade-dao.wardline-labs.testnet        | FullAccess                              | ed25519:2wtKMibp... | MATCHES | 0.099 |
| hayes-dao.wardline-labs.testnet             | FullAccess                              | ed25519:EVDMEYDa... | MATCHES | 0.099 |
| aurora-dao.wardline-labs.testnet            | FullAccess                              | ed25519:7bVKjWt1... | MATCHES | 0.099 |
| kelp-dao.wardline-labs.testnet              | FullAccess                              | ed25519:Bb6id6dm... | MATCHES | 0.099 |
| meter.wardline-labs.testnet (gateway, .env) | FunctionCall [reserve, settle, release] | ed25519:8GCuoS7j... | MATCHES | -     |

63 keys in the store; 27 belong to cast accounts that were cut and never created (hidden).

- The 51 cast keys in the handoff were for accounts that did not exist yet; 24 of them are created now.
- `NEAR_AI_API_KEY` works: a models-list request returned 64 models, including DeepSeek V4.1 Flash and GLM-5.3 Flash. `NEAR_AI_API_KEY_2` is not set, so everything ran on key 1.
- From `gateway.env` I merged the gateway account and key and the two RPC URLs into `.env`. I left out `WARDLINE_AI_PROVIDER_URL`: it pointed at the local replay provider, which would have made the near-mode API replay recorded answers instead of calling NEAR AI. I also left out `WARDLINE_DEMO_METER_KEY`, which near mode refuses.

### The cast: accounts, NEAR and USDC

- **Created (24):**
  - Mission Street hacker house: `mission-dao` (a real Sputnik DAO, same code as `dao.wardline-labs.testnet`, council Dana and Eli), with members dana, eli and tariq (tariq is the leaked key).
  - Nightshade DAO: `nightshade-dao`, with ruth and priya.
  - Hayes Valley house: `hayes-dao`, with sam and owen.
  - Aurora Lab: `aurora-dao`, with alice and ci-agent.
  - Kelp Collective: `kelp-dao`, with ana and kelp-agent.
  - Individuals: ivan, yuki, hassan, olivia, lucas. LPs: lp-north, lp-harbor, lp-solano.
- **Cut, and why:**
  - A Sputnik DAO stores about 541 KB of code, roughly 5.4 NEAR each. Five would need about 27 NEAR; the root had 14.06 and had to keep 3. So only Mission Street funds its budget by DAO proposal and vote. The other four communities hold their treasury in a plain account that signs `ft_transfer_call` to the meter.
  - From cast.json I also left out a third or later member in each community, five individuals, three LPs and cheapai. The swapped-model provider is the recorded GLM answer (no account needed); the look-alike vendor is a payee-check scenario with no transaction.
- **Funding:**
  - USDC came from Ref pool 1845: 3 wNEAR the root already held, swapped for 0.76 USDC.
  - Budgets: Mission Street 0.25 USDC by DAO vote; the other communities 0.12 each; individuals 0.04 each.
  - First-loss stake +0.20. LP deposits 0.10 each, plus small ones later. Dana got 1.05 for the browser Join.
- **Root:**
  - NEAR: 14.058 at the start, 5.536 now (8.522 spent; the DAO was about 5.5 of it). At least 3 NEAR stays, as asked.
  - USDC: 2.235 at the start, 0.070 now.
- **The pool's USDC is nearly all placed:** the pool held 1.9 USDC after Join. More USDC means swapping more NEAR on a thin Ref pool (0.29 USDC per NEAR).

### Batches, NEAR AI calls and cost

| Batch | When (UTC) | Paid calls proven | Swapped model refused | Leaked-key reserves capped | Other | Audit |
|---|---|---|---|---|---|---|
| 1 | 10:21 to 10:57 (with setup) | 36, plus the plug-in check | 2 | 4 | 15 deposits (setup and LPs), proposal 1 opened, voted, executed | PASS, 63 rows |
| (browser checks) | 11:19 to 11:36 | - | - | - | Join, vote and execute on proposal 2, a redeem request, an LP deposit | PASS, 71 rows |
| 2 | 13:00 to 13:14 | 36 | 1 | 3 | 2 LP deposits; proposal 3 opened, 3 LP votes for | PASS, 118 rows |
| 3 | 15:15 to 15:28 | 36 | 1 | 3 | 2 LP deposits | PASS, 160 rows |
| Claim | 15:30 | - | - | - | Aurora Lab's 0.02 USDC claim, paid and recorded | PASS, 161 rows |

Proposal 3 ("Raise coverage to 1.25x for every tier") is still open: the three LPs voted for it, but their WARD is under half the supply, so it has not passed. That is the real state; nothing was forced.

- **NEAR AI:** 109 (108 batch calls and the plug-in check) live calls in total. Key 1: 109 calls, 4,854 prompt and 15,147 completion tokens, $0.0196. Key 2: not set, 0 calls. The hard cap is 450.
- **Cost:** priced from the tokens NEAR AI reported, at $0.30 and $1.20 per million. One extra live call, the plug-in check, counts toward the cap but not the token totals.
- **Fees reach the pool:** in near mode the gateway now passes `pay_to`. Without it the meter only updates its books and no USDC moves. Fees earned on chain: 0.000258 USDC, and WARD is at 1.000368.

### Claims and tiers

Read from the meter's `get_reputation` after the claim:

| Group | Tier | Proven calls | Refused | Claims | Clean calls toward next tier |
|---|---|---|---|---|---|
| Mission Street hacker house | Gold | 46 | 1 | 0 | 11 (Gold is the top tier) |
| Nightshade DAO | Silver | 16 | 2 | 0 | 6 of 25 |
| Hayes Valley house | Silver | 16 | 0 | 0 | 6 of 25 |
| Aurora Lab | Bronze (was Silver) | 15 | 0 | 1 | 0 of 10 |
| Kelp Collective | Bronze | 8 | 0 | 0 | 8 of 10 |

- Mission Street reached Gold (not just on track), Nightshade and Hayes Valley reached Silver.
- The claim: 0.02 USDC against `bgt_aurora`, paid entirely from Wardline's first-loss stake (0.00 from WARD holders), so WARD's price stayed at 1.000368. The pool's TVL went from 2.050258 to 2.030258 USDC.
  - `file_claim`: [FpEkFzuv...](https://testnet.nearblocks.io/txns/FpEkFzuvpjfCto76xAcirYjNieNhYqdxbNRRoeEdF9e6)
  - `record_claim`: [GbPj2DnD...](https://testnet.nearblocks.io/txns/GbPj2DnDnND8x35iH5XwZNFtwJG14rLgWzcPt5eQCZhv). Aurora dropped from Silver to Bronze and its clean streak restarted at 0.
- Both are owner calls signed by `wardline-labs.testnet`.

### The final audit

```
Totals against chain views
  get_pool: tvl 2.030258 USDC, fees earned 0.000258, WARD price 1.000368
  bgt_aurora         proven 15/15  refused 0/0  capped 0 (reserve results checked; the meter keeps no counter)  spent 0.002653/0.002653 (log/chain)
  bgt_hayes          proven 16/16  refused 0/0  capped 0 (reserve results checked; the meter keeps no counter)  spent 0.002840/0.002840 (log/chain)
  bgt_ind_hassan     proven 2/2  refused 0/0  capped 0 (reserve results checked; the meter keeps no counter)  spent 0.000388/0.000388 (log/chain)
  bgt_ind_ivan       proven 2/2  refused 1/1  capped 0 (reserve results checked; the meter keeps no counter)  spent 0.000387/0.000387 (log/chain)
  bgt_ind_olivia     proven 2/2  refused 0/0  capped 0 (reserve results checked; the meter keeps no counter)  spent 0.000350/0.000350 (log/chain)
  bgt_ind_yuki       proven 2/2  refused 0/0  capped 0 (reserve results checked; the meter keeps no counter)  spent 0.000388/0.000388 (log/chain)
  bgt_kelp           proven 8/8  refused 0/0  capped 0 (reserve results checked; the meter keeps no counter)  spent 0.001495/0.001495 (log/chain)
  bgt_mission        proven 46/46  refused 1/1  capped 10 (reserve results checked; the meter keeps no counter)  spent 0.008195/0.008195 (log/chain)
  bgt_nightshade     proven 16/16  refused 2/2  capped 0 (reserve results checked; the meter keeps no counter)  spent 0.003092/0.003092 (log/chain)
  Mutual deposits logged 1.700000 USDC, pool tvl 2.030258 USDC

PASS: 161 of 161 rows are chain rows, 0 miss(es).
Wrote data/testnet/audit.json: the API now serves these 161 row(s).
```

### The 10 functions, with their transactions

| # | Function | Transaction |
| --- | --- | --- |
| 1 | One-line plug-in (`pnpm demo:plugin` against the near-mode API): one live DeepSeek call, proven, settled, in Latest proofs | [CVYSkE9b…](https://testnet.nearblocks.io/txns/CVYSkE9bmiRfKYSYaxHEGCJHdGQHNg17S9wDfk4b5EWR) |
| 2 | Swapped model through a near-mode API routed to the cheapai provider: refused `MODEL_MISMATCH`, hold released, below the line | [HyVfAEd9…](https://testnet.nearblocks.io/txns/HyVfAEd9aHSzx7Jj5v2vRkqNXFkqS18AMDpZPPR1jcZF) |
| 3 | Leaked key through the near-mode API: refused `ALLOWANCE_EXHAUSTED` before any model call, below the line | [JD92KSsX…](https://testnet.nearblocks.io/txns/JD92KSsXM6ia1PDvi5tzm8YmkzZKzXzp7aDu9kMnuuYb) |
| 4 | Payee check: `/v1/check` blocks `northw1nd` (`LOOKALIKE_ACCOUNT`) against the payee registry contract. The check is a read; the transaction is Northwind's attestation | [Gqk8hvax…](https://testnet.nearblocks.io/txns/Gqk8hvaxpDvHJpdRHcwmBdJeLWMiaNGDCSw5PPWjApMV) |
| 5 | Join in the browser with the local test signer: Dana deposits 1.00 USDC, 0.999736 WARD minted | [BVrdD27d…](https://testnet.nearblocks.io/txns/BVrdD27dSKfndvXpXo2rg8zZzEsApfgy1yTWebK2KH2b) |
| 6 | Vote in the browser on an open proposal, then execute it once it passed | vote [H9dwHXM3…](https://testnet.nearblocks.io/txns/H9dwHXM3FvP33vm2aPy8zGgMZ8Vx7sPN7if176p9ucHM), execute [BZHFyWmG…](https://testnet.nearblocks.io/txns/BZHFyWmGaV3m5u2YGMKY6LELuHTCYBaW89SMuzRe5nEi) |
| 7 | Redemption request in the browser: a real `request_redeem`. Partial: the delay is 0 days on testnet, so #/me shows "Ready to redeem", not a countdown | [7dupiywm…](https://testnet.nearblocks.io/txns/7dupiywmt1WeU3LyzrMo5BxAAojcvNsS28f2rjFh9CAC) |
| 8 | Groups: each community's real tier, proven calls and fee, with a link to its latest transaction | [JD92KSsX…](https://testnet.nearblocks.io/txns/JD92KSsXM6ia1PDvi5tzm8YmkzZKzXzp7aDu9kMnuuYb) (Mission Street's latest) |
| 9 | #/me for a member (Dana) and an LP (lp-north): position, earnings, transactions | lp-north [4QLwikx7…](https://testnet.nearblocks.io/txns/4QLwikx7aYzLzQQ1MSiQ1eYNDhMWAyHdWtzHCKSKBJtf) |
| 10 | Demo: the seven sim scenes still run, and a line under them links to the live proofs | none (offline by design) |

- **Screenshots:** `apps/web/screenshots/testnet-*.png` (gitignored). Each was looked at, and these were fixed once:
  - Join said "You received 0.00 WARD", because `ft_transfer_call` returns USDC kept; it now reads WARD before and after.
  - Rows said "paid 0.00 USDC", because tiny amounts were rounded.
  - #/me listed 37 fee rows one by one; fee runs are now collapsed.
  - Unlabelled first-loss events.
  - A false "You haven't voted yet".
  - The proposal id `pool…:proposal:2` shown as a simulated transaction.
  - A stale "tiers and voting are simulated" note.
  - Quorum figures overflowing their column.
  - Skeleton screenshots.
- **Join screenshot:** `testnet-join.png` still shows the old 0.00. Dana has no USDC left for a second 1.00 Join. I verified the fix with a 0.01 USDC deposit through the signer, which reported 0.009997 WARD ([7bptcuCv…](https://testnet.nearblocks.io/txns/7bptcuCvqxiLbWE1Xb74nph4NmKVcGpw1YVVKDPeK11a)).

### What changed in the code tonight (beyond the scripts)

- **Gateway (`pay_to`):** in near mode, settle passes `pay_to` (`WARDLINE_PROVIDER_PAY_TO`), so the provider's share and the pool's fee move as USDC. A call refused at the spend limit now shows its reserve transaction.
- **Local test signer:** the API side (`services/api/src/local-signer.ts`) and the web side (`apps/web/vite/local-signer.ts`) are guarded three ways, with tests.
  - It needs 127.0.0.1, `WARDLINE_LOCAL_SIGNER=1` and testnet in near mode; otherwise it refuses to start.
  - It also requires a custom header and a loopback origin.
  - A production build refuses the flag and never contains the code.
- **Payee registry:** `WARDLINE_REGISTRY_MODE=near` is wired to the registry contract, and `pnpm payee:seed` attests as the attestor. The 10 seeded vendors are now on chain.
- **Reading testnet:**
  - Comma-separated RPC URLs fail over.
  - Near-mode views are cached for 3 s.
  - Reputation RPC errors throw instead of reading as empty lists. That bug made the Groups page show nothing under load.
  - Community detail reads one community.
- **Free tier:** the payee free tier (200 calls a day per IP) priced every `/v1` route, so a few page loads of the Mutual locked a visitor out with a 402. It now covers only the payee API.
- **Hosting:** hosted values are empty, a `local` block was added, and the drift test accepts "not hosted".

### Decisions for you

- **Redemption delay:** the pool's `withdraw_delay_days` is 0 on testnet (the contract default is 7, and the UI promises 7). Setting it is an owner call I didn't make, because the classifier refused it as a shared-config change. To set it: `set_param("withdraw_delay_days", "7")` on `pool.wardline-labs.testnet`, signed by the pool owner.
- **Contract findings (not changed tonight):**
  - `file_claim`, `deposit(account, amount)` and `request_withdraw(account, …)` on the pool, and `fund` on the meter, don't check their caller. `deposit` mints WARD without USDC.
  - `weight_of` uses the voter's current WARD, not a snapshot, though the UI copy promises a snapshot.
  - `execute` only emits a parameter event; the meter's fees don't change, though the UI copy says "the change is in effect".
  - The scripts and the site use only the checked paths, and the README's Honest limits now lists these.
- **Test data on the meter:** `bgt_engineering` and `bgt_leaked_*` are older test budgets and show on Groups (sorted last). `wardline/sim-echo-1` is attested on the testnet model registry.

### The scheduled task

- **Task:** `Wardline testnet batch`. It runs `%USERPROFILE%\.wardline\testnet\scheduled-run.cmd` every 6 hours from 13:00 local (21:00 UTC), ending 11/13. Each run is `pnpm testnet:scheduled`: one batch sized by the time of day (2 to 12 paid calls), then the audit.
- **After the freeze:** from Nov 13 20:00 UTC it audits only.
- **Log:** `%USERPROFILE%\.wardline\testnet\scheduled.log`.
- **Committing:** the task writes `data/testnet/` but doesn't commit. Commit those files when you want the timeline in git.
- **Sleep:** a sleeping PC skips runs. Keep it awake, or tick "Wake the computer to run this task" in Task Scheduler.

```powershell
schtasks /Query /TN "Wardline testnet batch" /V /FO LIST
schtasks /Delete /TN "Wardline testnet batch" /F
```

### For Tharun: hosting

- **API in near mode:** set `WARDLINE_CHAIN_MODE=near`, `WARDLINE_REGISTRY_MODE=near` and a failover `WARDLINE_NEAR_RPC_URL` list. Set `WARDLINE_PROVIDER_PAY_TO`.
- **Secrets on the host:** `WARDLINE_GATEWAY_ACCOUNT` and `WARDLINE_GATEWAY_KEY` (the function-call key, never in the repo), `NEAR_AI_API_KEY` and `WARDLINE_ATTESTOR_KEY`.
- **Must stay off:** `WARDLINE_LOCAL_SIGNER` must be unset (the API refuses it on a public bind anyway), and `WARDLINE_AI_PROVIDER_URL` and `WARDLINE_DEMO_METER_KEY` must be unset. Owner auth stays on (`WARDLINE_OWNER_ACCOUNTS`), not `WARDLINE_OWNER_AUTH=off`.
- **Data the API serves:** commit `data/testnet/activity.jsonl` and `audit.json` with it; it serves only audited rows.
- **Web build:** `WARDLINE_DATA=testnet`, `VITE_WARDLINE_API_URL` set to the API, and never `VITE_WARDLINE_LOCAL_SIGNER`. The build refuses it.
- **Once hosted:** set all three `hosted` values in `repo.config.json`. `pnpm test` then names the files that must follow.

### Restore power settings

```powershell
powercfg /change standby-timeout-ac 30
powercfg /change hibernate-timeout-ac 0
```

(Sleep on AC was 30 minutes; hibernate on AC was already never.)

### Run everything locally on testnet (PowerShell)

```powershell
cd "C:\Users\alexs\OneDrive\Desktop\Homework USC\Personal Coding\Near_Hackathon2026"
pnpm install; pnpm --filter "@wardline/api..." build
pnpm testnet:preflight

# Window 1: the API in near mode with the local test signer
$env:WARDLINE_CHAIN_MODE="near"; $env:WARDLINE_REGISTRY_MODE="near"; $env:WARDLINE_LOCAL_SIGNER="1"; $env:WARDLINE_OWNER_AUTH="off"
$env:WARDLINE_NEAR_RPC_URL="https://near-testnet.drpc.org,https://rpc.testnet.fastnear.com,https://test.rpc.fastnear.com"
pnpm --filter @wardline/api start

# Window 2: the web app on testnet data with the local test signer
$env:WARDLINE_DATA="testnet"; $env:VITE_WARDLINE_LOCAL_SIGNER="1"; $env:WARDLINE_DEV_API="http://127.0.0.1:8787"
pnpm --filter @wardline/web dev
# open http://127.0.0.1:5173, Connect wallet, then "Local test signer", then e.g. dana.wardline-labs.testnet

# Window 3: activity and checks
pnpm testnet:batch --dry-run; pnpm testnet:audit
pnpm --filter @wardline/web test:e2e:testnet
```

### Tests

- `pnpm test` passes: API 236, web 88, brand 7, and every other package.
- Chromium e2e: 53 of 53. iPhone WebKit: 12 of 12.
- Testnet e2e (`test:e2e:testnet`, against the running stack): all 10 pass.
- `pnpm testnet:audit`: passes; output above.

### How long it took

From 10:04 to 15:36 UTC, including the waits between batches.

## A10, part 2: second merge from Tharun (2026-11-10)

Merged `origin/tharun` up to 4200a1c. These are the commits newer than d1c6b67:
- f6cd74a docs(status): update E2E test results in tharun status
- b0a9f43 feat(web,data): wire getGroups, getProofs and TxLink into frontend views
- 4200a1c fix(testnet): strictly restrict execution to Alexander's official key

**Kept**
- The web wiring from b0a9f43: Groups and Proofs read the testnet routes when `WARDLINE_DATA=testnet`.
- One file outside `apps/web/src/data`, as a new feature: `views/site/Proof.tsx` adds a View transaction link to each latest proof. It shows only for a real NEAR hash.
- `/v1/proofs` now returns each call's settle or release transaction, so that link has something to show. The security test now allows that field; the transaction is public, and its arguments name no member.

**Not kept**
- 4200a1c's 12 new rows: `tx_` hashes again, plus a look-alike payout with no transaction. Also its spend ledger and its edits to the old `simulate.ts`. The log stays empty, the ledger stays at zero, and the step 2 batch stays.
- The padding in b0a9f43's testnet branches:
  - `fee_bps ?? 200` and a default coverage cap;
  - silent fallbacks to simulated groups and proofs when a testnet route fails or is empty;
  - `MODEL_NOT_ATTESTED` as the reason for any refusal without one;
  - a DeepSeek default model, and "now" for a missing time.

  In testnet mode a failure now shows as an error and an empty feed stays empty.

**Open question:** 4200a1c restricts the old batch to `NEAR_AI_API_KEY` only. The step 2 batch uses key 2 only if `NEAR_AI_API_KEY_2` is set, and it isn't, so today it runs on key 1 alone.

**Tests:** `pnpm test` passes (API 230, web 83). Chromium e2e: 53 of 53 passed.

**Keys:** `%USERPROFILE%\.wardline\testnet\credentials.json` still doesn't exist, so step 3 hasn't started.

## A10: real testnet communities, steps 0 to 2 (2026-11-09)

Stopped before step 3, as asked: the two testnet keys aren't on this machine yet. Nothing has been sent to the chain and no NEAR AI call has been made.

### Merged from Tharun (step 0)

- Merged `origin/tharun` (b91311d) into alexander.
- **Kept:**
  - `scripts/testnet/`;
  - `services/api/src/activity/` and its test;
  - the `apps/web/src/data/` layer and `apps/web/test/data.test.ts`;
  - the vault-client re-export his scripts use.
- **Restored to main:** every other `apps/web` file from his old UI commit 1c7f52e, so A9 stays intact.
- **Reset:**
  - `activity.jsonl` emptied;
  - `nearai-spend.json` zeroed;
  - `setup.json` deleted. It came from a dry run that listed 46 accounts as created.
- **Held back:** his README section. It describes activity that never happened ("actively transacting", "1 claim covered"). Step 6 rewrites it from the audit.

### Preflight (step 1)

| Item | Status |
| --- | --- |
| Full-access key for `wardline-labs.testnet` (`ed25519:FGUWrt4Y…` on chain) | Missing. Goes in `%USERPROFILE%\.wardline\testnet\credentials.json` |
| Meter gateway key (FunctionCall `ed25519:8GCuoS7j…` on `meter.wardline-labs.testnet`, for reserve, settle and release) | Missing. Goes in `.env` as `WARDLINE_GATEWAY_ACCOUNT` and `WARDLINE_GATEWAY_KEY` |
| `NEAR_AI_API_KEY` | Set |
| `NEAR_AI_API_KEY_2` | Not set |
| Root balances | 14.058 NEAR, 2.235352 USDC |

### Why fake rows got in, and what stops them now (step 2)

**The causes**
- The old batch wrote `tx_` plus sha256 hashes, with block heights counting up from 277000000. It did this whenever it was a dry run, had no key, or hit any error.
- Its refusal, leaked-key, look-alike and LP rows never sent a transaction at all.
- Setup's dry run wrote `setup.json` anyway.

**Two more sources, found on the way**
1. **The meter's synthetic tx ids.**
   - `settle` and `release` return `tx: "meter.wardline-labs.testnet:<call_id>"`, and the vault client reported that instead of the transaction's hash.
   - So in near mode, the API's `X-Wardline-Settlement` and `settlement_tx` were never real hashes. Every explorer link built from them would 404.
   - The vault client now returns the real `tx_hash` for settle, release, deposit, withdraw, redeem and filed claims. It still sends the same transactions; only the reported id changed.
2. **Near mode still simulated tiers and WARD voting** ("until T4.6"), though T4.6 has deployed them.
   - Near mode now reads `get_reputation`, `list_reputations`, `list_proposals`, `weight_of` and `governance_params` from the contracts.
   - In near mode the API no longer casts votes or proposals for anyone. The holder's wallet signs them against the pool.
   - The meter keeps no counter for capped calls. A refused reserve changes no state, so `capped_calls` counts audited capped rows; each is a verified reserve transaction that returned ALLOWANCE_EXHAUSTED.

**What makes a fake row impossible**
- **One writer** (`scripts/testnet/chain-log.ts`, rules in `services/api/src/activity/log.ts`).
  - A row's hash, signer, receiver, block height and time are copied from the RPC `tx` result and its receipt's block.
  - It throws for a non-base58 hash, an unknown hash, a failed transaction or a signer mismatch.
- **`--dry-run`** prints the plan and stops. It sends nothing, calls nothing, and every write under `data/testnet/` throws. The same holds for setup's dry run.
- **The batch takes the real paths.**

  | Event | How it runs |
  | --- | --- |
  | Paid calls | The Wardline gateway, run in-process in near mode |
  | Swapped model | A real reserve, then the SDK verifier on the recorded GLM-5.3 Flash answer, then a real release |
  | Leaked-key burst | Real reserves refused at the allowance |
  | LP deposits | `ft_transfer_call` from the LP's own key, checked that the pool kept the full amount |
  | WARD vote | `vote` signed by the holder |

  The look-alike invoice is gone: it has no transaction to point to. NEAR AI spend is priced from the tokens NEAR AI reported, at $0.30 and $1.20 per million.
- **`pnpm testnet:audit`** exits 1 on any miss. It checks:
  - every row with the RPC `tx` method: hash, signer, receiver, success, block height;
  - the contract method behind each row (`settle`, `release`, `reserve` with the refusal reason, `ft_transfer_call` with the amount kept, `vote`, `propose`);
  - every cast account with `view_account`;
  - per budget, that the log never claims more than `get_reputation` and `get_budget`, and that deposits never exceed the pool's `tvl`.

  On a pass it writes `data/testnet/audit.json`, pinning the rows it checked by their sha256.
- **The API serves only the audited prefix.**
  - In near mode, `/v1/activity`, `/v1/communities/:id` and `/v1/people/:account` answer 503 `ACTIVITY_NOT_AUDITED` until an audit has passed.
  - Rows appended later wait for the next audit, and an edited log serves nothing.
  - All counts come from chain views. Removed: the `|| 5` group count, `Math.max(log, chain)`, the made-up tier history, default caps and fees, and logged deposits added onto pool positions.
- **The web.** The testnet source is still off unless `WARDLINE_DATA=testnet`. In that mode, #/me reads `/v1/mutual` for the Mutual summary and `/v1/people` for the account.

**Checks today**
- Batch dry run: 0 of 34 members and 0 of 6 LPs exist, so only the paid-call plan prints. `data/testnet/` is byte-identical afterwards.
- `pnpm testnet:audit` on the empty log: FAIL with 45 misses, one for each cast account that doesn't exist yet. No stamp written.

### Tests

- `pnpm test` passes. API 230 (8 new: rows only from RPC, old hashes refused, the 503 gate, audited prefix), web 81, and every other package.
- Chromium e2e: 53 of 53 passed.

### Next, once the keys are in

Step 3 (create and fund the cast, scaled to the root's 14 NEAR and 2.2 USDC), then the first batch and audit.

## A9: phones, the wallet panel and leftover content (2026-11-09)

Took about one hour, 23:00 to 23:55 UTC. That's under the two-to-three-hour budget, so P3 is done too. I didn't run Lighthouse, a fresh clone, or the Firefox and desktop WebKit suites, as asked.

### Read first: OneDrive was hiding files from Playwright and tsc

OneDrive had turned 916 source files into cloud placeholders (reparse points), including `a11y.spec.ts`, `member.spec.ts` and `packages/dao-adapter/src`.
- Imports still read them, but Playwright's directory scan skips them. So the accessibility and #/me specs (16 tests) silently stopped running in every browser, with no error.
- Later, `tsc` found no input files in `packages/dao-adapter`, so `pnpm test` failed in its build step.
- I re-created all 916 files outside node_modules, .git and dist with identical bytes (each one hash-checked). Git shows no change, and everything is found again.
- OneDrive can turn them back into placeholders.
- **Fix it for good:** right-click the repo folder in Explorer and choose "Always keep on this device", or move the repo out of OneDrive.

### Done

**P1**
1. **No sideways sliding on iPhone.**
   - The cause was the header, not the hero. On a 320px iPhone SE, the logo, Connect wallet and Menu added up to 345px, so the whole page could be dragged sideways. Below 375px the header now shows the mark alone; the link keeps its accessible name.
   - Safety net:
     - `html, body { overflow-x: clip; overscroll-behavior-x: none }` (clip, not hidden, so the sticky header still works);
     - the hero clips its line explicitly;
     - long ids and `code` wrap; tables and code blocks scroll in their own box;
     - every field is at least 16px.
   - Viewport: `width=device-width, initial-scale=1, viewport-fit=cover`, with pinch zoom left on.
   - Test: a new `iphone` project runs WebKit with Playwright's iPhone SE preset (320 x 568, touch). It covers every route and both dialogs: `scrollWidth` equals `innerWidth`, and pushing the page sideways leaves `scrollX` at 0.
   - Playwright can't synthesize a native touch swipe or a wheel in mobile WebKit, so the test pushes the page's scroller with `scrollBy`, `scrollTo` and `scrollLeft`. A swipe moves that same scroller.
2. **Connect wallet.**
   - Root cause: the dialog rendered inside the sticky header, and the header's `backdrop-filter` makes it the containing block for `position: fixed` children. The backdrop was sized to the 72px header, so the panel opened with its top and close button cut off. Every dialog now renders on `<body>`.
   - Wide screens: a panel anchored under the header button, fully on screen. Phones: a bottom sheet. Both have a title, a close button and Cancel, and close on Escape and on an outside click.
   - Join uses the same account-and-wallet fields. Once connected, it shows "From <account>" with Change instead of asking again.
   - "Couldn't open popup window to complete wallet action" now reads: "Your browser blocked the wallet window. Allow pop-ups for this site, then try again."
   - Never frozen: while a wallet signs, Stop waiting brings the form back, and a late wallet answer is ignored. Escape still closes the dialog.
3. **Wrong or leftover content.**
   - The executed seed proposal is now "Set the Gold fee to 1.00%" (see the judgement calls below).
   - Removed: the "Simulated Mutual" note, the stub-engine note on the Proof page, and the `VITE_WARDLINE_API_URL` and `VITE_WARDLINE_MCP_URL` notes on Developers.
   - Snippets show a real URL: the configured one, or the hosted one from `repo.config.json`. Never `process.env.WARDLINE_API_URL`.
   - **One source for the headline numbers:**
     - Home's pooled figure is now `total_pooled` (members' USDC plus our stake), the same number the demo shows: 141.24.
     - Our stake reads 20.00 in Join, the demo and the README.
4. **max_tokens.** A non-integer, infinite, out-of-range or non-number `max_tokens` now gets 400 `invalid_request_error`, code `INVALID_MAX_TOKENS`: "max_tokens must be a whole number from 1 to 131072." This happens before anything is reserved, and `null` still means not set. The skipped test is now a real one (1.5, 1e999, 0, -5, 131073, a string, a boolean, plus 256 and null passing).

**P2**

5. **About** opens with the credit union:
   - members pool USDC and get WARD;
   - the pool backs agents' payments and earns a fee on every payment that proves itself;
   - members vote on the risks.

   Then "How the money moves", the payee example and the trust-levels table (both kept), and the three layers.
6. **Developers** replaces Connect in the nav, at `#/developers`. `#/connect` still lands there and rewrites the address bar.
7. **Home:**
   - The hero is shorter, so the stats sit closer to the buttons.
   - The cut line starts just left of the sphere, clear of the text.
   - The Not a member yet card quotes 25.00 USDC, the WARD it buys at today's price, the price and our stake.
   - One Become a member button in that section.
8. **Governance:**
   - A fixed action column, so the bars line up.
   - No numbering, and a subtitle only when it adds something.
   - "View transaction" links for real hashes.
   - The reason the vote buttons are off sits beside them.
9. **Demo:**
   - On wide screens the stage is sticky at one height for every scene, so nothing jumps.
   - Run scene brings the result into view: inside the stage on desktop, in the page on phones.
   - `sim-...` ids are a short label; "WARD holders" is capitalized; model names read "DeepSeek V4.1 Flash" and "GLM-5.3 Flash" everywhere.
   - Scene 6 has no red.
10. **Proof page:** in sim mode, latest proofs follow any real calls with recent calls from the live seed's groups. They have the same public fields and no members or keys, so the feed is never empty. **Safest groups** leaves out groups with fewer than 10 proven calls.

**P3**

11. Group spheres are 64px (56px on phones). Start a group leads with the one-line plug-in, with the owner app as the secondary button.
12. The footer has three columns (The Mutual, Build, Wardline) and no active underline.
13. The small labels above headings are gone (Developers, Check a payee, Verify, the vault, scoring, About). Small descriptions are 15px, up from 13 and 14.

### Judgement calls

- **Seed proposal.** There is no "raise the leaked-key cap" governance action. Adding one means changing the action types the contracts mirror, and contracts were off limits.
  - A "cover" proposal for any recorded model would claim a change that never happened, since every recorded model is covered at launch.
  - So the executed proposal is "Set the Gold fee to 1.00%", which is true and already the state.
- **Stake and pooled.** The live pool's stake really was 18.50, because it paid Kelp's 1.50 claim, while the demo and README start fresh at 20.00.
  - Moving the demo onto 18.50 would have rewritten the payout scene, the README's step 7 and API tests.
  - Instead the live seed's stake starts at 21.50, so it stands at 20.00 after the claim. Pooled is 141.24 in both places; the README and one API test are updated.
- **Simulated transaction ids** have no explorer, so they're a short "Simulated transaction" label plus the last 8 characters, with the full id on hover, not a link. Real NEAR hashes get "View transaction".
- **The Connect wallet dialog** opened from page buttons (Governance, #/me) stays centered. Only the header button anchors it.

### Tests

- `pnpm test`: passes (brand guard 7 of 7, API 217 with none skipped, web 77, every package).
- One Chromium e2e run plus the iPhone WebKit project: 65 of 65 (53 Chromium, including the 4 new Connect wallet tests, and 12 iPhone).
- Not run, as asked: Firefox, desktop WebKit, Lighthouse, a fresh clone.

### Screenshots

In `apps/web/screenshots/` (gitignored), at 1440 and iPhone SE (375 x 667, the current model), named `a9-<page>-<size>.png`:
- home, about, developers, groups, proof;
- demo-payout;
- connect-wallet (the panel and the sheet);
- join-connected.

Looking at them caught two things, each fixed once:
- a red row left in the payout scene;
- the screenshot script shooting before lazy pages had loaded.

### Run it (PowerShell)

```powershell
cd "C:\Users\alexs\OneDrive\Desktop\Homework USC\Personal Coding\Near_Hackathon2026"
git checkout alexander; git pull
pnpm install
pnpm test
pnpm --filter @wardline/web test:e2e:chromium
pnpm --filter @wardline/web test:e2e:iphone
pnpm --filter @wardline/web exec playwright test --project=screenshots -g "a9 "
```

## Morning report: overnight polish and hardening (2026-11-09)

### Read first: one bug found in metering, left for you

A `max_tokens` that is not a positive integer (`1.5`, `1e999`) reaches `BigInt()` in `reservationFor` (`services/api/src/meter/models.ts`) and throws, so `/v1/ai/chat/completions` answers 500 instead of 400. Nothing is reserved or paid, because it fails before `reserve()`, so no money is at risk. The fix is one check in the gateway: refuse `max_tokens` unless it is a positive safe integer, with 400 `invalid_request_error`, before computing the reservation. I left it alone because metering was out of scope. A failing test is written and skipped in `services/api/test/security.test.ts` ("known bug, left for Alexander"); unskip it with the fix.

### What's done, part by part

1. **#/me, a real member view.**
   - For any connected wallet:
     - value, WARD held and earned since joining, with rounding under one cent shown as 0.00;
     - the WARD chart against the 1.0000 line;
     - open votes with the member's snapshot weight, and past votes;
     - any redemption in progress with its unlock countdown;
     - where the share came from: their deposit, then every price change since they joined.
   - Empty states: no wallet ("Connect a wallet to see your share."), and a wallet with no WARD ("This wallet holds no WARD yet." with Join the Mutual).
   - The header account button and Join's "Go to my share" open #/me.
   - API additions:
     - positions report `deposited`, `redeemed` and `joined_at`;
     - `GET /v1/mutual/votes/:account` lists how an account voted (votes are public on chain).
2. **The A8 seam.**
   - `apps/web/src/data/` has one module per area: mutual, groups, proofs, activity, people. Every page reads through it.
   - `WARDLINE_DATA=sim|testnet` picks the source (sim by default). Mutual, groups and proofs read the API's routes in both modes, since the API's chain mode decides where those numbers come from.
   - T4.7 is not documented in `docs/status/tharun.md` on origin/tharun (43ed86d), and `services/api/src/activity/` does not exist yet. So `getActivityStats`, `getCommunities` and testnet-mode `getActivity` and `getPerson` throw a typed `NotWiredYet` naming the route, and the page says so. No shapes were invented.
   - Explorer links: `TxLink` links real NEAR hashes (base58, 43 or 44 characters) to `testnet.nearblocks.io/txns/<hash>` as a small underlined link; simulated `sim-...` ids stay plain text. Used in the Join confirmation, demo results, executed proposals and payouts in #/me.
3. **The undesigned states**, each with a test.
   - Each says what happened and what to do next, in Horizon's voice, with Try again where it may help:
     - API unreachable;
     - chain RPC failing (the API now answers 503 `CHAIN_UNAVAILABLE`);
     - wallet signature rejected;
     - wallet not installed;
     - a deposit below the 1 USDC minimum (stopped before signing; the API also refuses it with `BELOW_MINIMUM`);
     - a vote after the window closed (`VOTING_CLOSED`);
     - redeem before the cooldown ends (`COOLDOWN`).
   - Failures are never red: red stays below the line only.
   - Loading skeletons are built from the real markup, and a test checks the stats strip doesn't move when the numbers arrive.
4. **Accessibility and browsers.**
   - Firefox and WebKit are Playwright projects; `pnpm test:e2e` runs all three.
   - **The e2e stub now rebuilds its world before every test**, in every browser (`POST /__e2e/reset`, an automatic fixture). Before this, tests leaked votes and deposits into each other.
   - **Fixes for other browsers:**
     - WebKit doesn't focus a clicked button, so the dialog now remembers the last pressed control to return focus to;
     - clipboard reads are checked in Chromium only;
     - WebKit on Windows could reuse a keep-alive connection just as Node closed it after 5 idle seconds, then fail the deposit POST. The site correctly reported "can't reach its API", but it was a flake. The dev and preview servers now hold idle connections for 65 seconds.
     - Firefox on Windows crashes its own content process inside the axe scan ("Page crashed"). Axe is skipped in Firefox on Windows only; the same pages are scanned in Chromium and WebKit. Every other Firefox test runs.
   - **Accessibility checks:**
     - axe on every public page, #/me and both dialogs at desktop and 390px;
     - a keyboard-only test walks Join the Mutual, a vote on #/me and a demo scene with no mouse;
     - tests check the focus trap and focus return, visible focus on every control type, and text alternatives for the hero, the fingerprints ("Call 1a2b3c4d, below the line") and the price chart.
5. **Performance.** Scores and details below.
   - Routes are lazy-loaded, so the main bundle dropped from 521 KB to about 250 KB. It's mostly react-dom now.
   - Added robots.txt and source maps.
   - **I changed how the hero is drawn.** With motion on, the dots are drawn on a canvas from the same generator, with the same timings, easing and drift formula, and the cut line stays an SVG hairline. Updating 915 SVG `r` attributes per frame made the browser re-lay out the whole sphere every frame: about 5 seconds of blocking time in Lighthouse mobile. With batched fills, a 20fps assembly and a drift that slows itself on a struggling device, the animated hero now costs about what the static one does. Under reduced motion it's the static SVG. docs/BRAND.md says this.
   - A test checks the drift stops off screen and resumes on return.
   - Layout shift is 0 on every measured page. The footer used to jump when a lazy page or its data arrived, so the content area is now at least one screen tall.
   - The receipt-verification code in the demo (ed25519, about 30 KB gzipped) loads only when the look-alike invoice scene shows its result.
   - The site's CSP blocks eval, and zod 4 probes `new Function` on first parse, so the browser logged a CSP issue on every page. The web app now sets zod's `jitless` option; the API keeps its fast parsers.
6. **Security pass.** Findings below. All public routes are reviewed, inputs are validated with zod, lists are capped, routes are rate-limited per IP, and security headers are set on the API and the site. `pnpm audit` is fixed, and the gateway parsing is fuzz-tested.
7. **Fresh clone.**
   - I cloned alexander into a temp folder outside OneDrive with no `.env`, then followed every Try-it step in Git Bash, as the README says to on Windows.
   - Steps 1 to 10 printed what the README shows:
     - install and build;
     - the providers and the API;
     - the plug-in call;
     - the swapped model;
     - the leaked keys;
     - the look-alike block;
     - the Mutual and the payouts;
     - the vote;
     - the tier move;
     - the scam-test numbers.
   - Step 11: `pnpm test` passed (brand guard 7 of 7), and `pnpm test:e2e` passed 147 of 147 (49 in each browser) in 9.4 minutes.
   - Fixed where the README and the code disagreed:
     - The second plug-in run threw a 26-line stack trace. It now prints one line: `Refused: HTTP 502, REPLAYED. ... You were not charged.`
     - The README now quotes the API's real first-start line about the attestor key.
     - The README says to open the URL Vite prints, since Vite moves off 5173 when that port is taken.
     - The README gives the e2e count: 49 per browser.
   - The README's web-app paragraph already describes the Horizon design and #/me.

### Lighthouse

The production build was served with `vite preview` against a local API. Throttling is Lighthouse's default (simulated 4x CPU, slow 4G on mobile).

Scores are performance / accessibility / best practices / SEO. Targets: 90+ / 100 / 95+ / 95+.

| Page | Before | After |
| --- | --- | --- |
| Home, mobile | 55 / 100 / 96 / 91 | **95 / 100 / 100 / 100** |
| Home, desktop | 69 / 100 / 96 / 91 | **100 / 100 / 100 / 100** |
| Demo, mobile | 87 / 100 / 96 / 91 | **94 / 100 / 100 / 100** |
| Demo, desktop | 98 / 100 / 96 / 91 | **100 / 100 / 100 / 100** |
| #/me, mobile | not captured cleanly | **94 / 100 / 100 / 100** |
| #/me, desktop | not captured cleanly | **100 / 100 / 100 / 100** |

- "After" is the median of three runs; home on mobile is the median of five (94 to 96).
- After the fixes, layout shift is 0 everywhere and total blocking time is about 100 ms on mobile. LCP is 2.6 to 2.7 s on mobile and 0.6 s on desktop.
- #/me didn't exist before tonight, and I rebuilt the site partway through its first measurement, so it has no clean "before".
- Home's mobile blocking time was 10 seconds before, almost all of it the SVG hero.
- SEO went from 91 to 100 with robots.txt.
- Best practices went to 100 once the zod CSP issue was gone.

**Measurement noise.** OneDrive syncs this repository folder and uses up to four CPU cores while builds and tests write into it. Single Lighthouse runs swing by 20 or more points while it syncs: home on mobile scored 70 to 96 within one pass right after a restart. The numbers above were taken with sync quiet. Moving the repo out of OneDrive, or pausing sync while measuring, gives steadier numbers. The e2e suite also runs twice as fast outside OneDrive: 9.4 minutes against about 20.

### Security findings

- **Fixed:**
  - No body size limits; the gateway would read and forward any size. Now 1 MB for `/v1/ai/*` and 64 KB elsewhere, counted while streaming, answering 413.
  - No rate limits on public routes outside the payee check's daily free tier. Now per IP per minute:
    - 12 for `/v1/demo/*`, which is CPU-heavy;
    - 30 for signed Mutual writes and proposal execution;
    - 240 for reads;
    - each answers 429 with Retry-After.
  - Path and query parameters were unvalidated: accounts, budget ids, proposal ids and `/v1/proofs?limit`. Now zod-validated with 400s. `/v1/vendors` is capped at 500.
  - The payee routes' own error handler replaced the app's. There is now one handler: `CHAIN_UNAVAILABLE` 503, payee input 400, and anything else a 500 that reveals nothing.
  - The owner session cookie was `Secure` only on a public bind. A hosted API behind a tunnel binds 127.0.0.1 over HTTPS, so its cookie wasn't Secure. It now is when `WARDLINE_HSTS=true` or `WARDLINE_SECURE_COOKIE=true`.
  - API security headers: nosniff, `X-Frame-Options: DENY`, `default-src 'none'; frame-ancestors 'none'`, a referrer policy, COOP, a permissions policy, and HSTS when `WARDLINE_HSTS=true`.
  - The site has a CSP allowing only what it uses: self, inline style attributes, the API, the NEAR RPCs and the two wallets. `vite preview` serves it, and the build writes it to `dist/_headers` for static hosts.
  - `pnpm audit` found 6 high and 1 critical issue, all transitive: `tar` via near-sandbox (tests only), and `nanoid` and `decode-uri-component` via the Meteor wallet SDK. Scoped overrides in `pnpm-workspace.yaml` bring it down to 1 low.
- **Checked, no change needed:**
  - `/v1/proofs` returns exactly these fields: call id, budget id, group, side, status, reason, models claimed and proven, amount, refund, time. No member, key id, request hash, signature or content. A test pins the field list and greps for leaks.
  - `/v1/mutual` and `/v1/groups` name DAOs and counts, never members (tested).
  - CORS is `*` on public routes, which use no cookies. Owner routes have no CORS and a SameSite=Strict httpOnly cookie.
  - Fuzz tests on the gateway's request parsing:
    - malformed JSON, arrays, null and strings get 400;
    - `stream: true` gets 400 `STREAMING_NOT_SUPPORTED`;
    - unknown and object-typed models get 404;
    - a bad key gets 401;
    - 120 random bodies never return 500.
- **Left for you:** the `max_tokens` 500 at the top.

### Blocked, and why

- **T4.7 shapes are not documented yet**, so testnet data is a seam, not wired (see Part 2).
- **Lighthouse noise from OneDrive sync** (see above). Not blocking, but measure with sync paused.
- **The machine slept once during an e2e run**, which made four tests time out with `ERR_NETWORK_IO_SUSPENDED`. The rerun passed 147 of 147.

### What I need from Tharun for A8

Response shapes for these four routes, with the types and the meaning of each field:
- `/v1/activity`: one row per event, newest first, with:
  - `kind`;
  - `at`;
  - `side` ("above" or "below");
  - `amount` in atomic USDC;
  - `group` or `budget_id`;
  - `tx_hash` when a transaction exists;
  - pagination (`limit`, `cursor`).
- `/v1/activity/stats`: totals for proven, swapped, look-alike and capped, pooled, yield and payouts. Then `/v1/mutual`'s stats can come from chain data.
- `/v1/communities`: a group's DAO, treasury balance and budget ids, so `GroupSummary` can map onto it.
- `/v1/people/:account`: WARD held and locked, deposited, redeemed, joined_at, votes as `{proposal_id, support, weight}`, and pending redemptions. That's everything #/me reads today; see `apps/web/src/data/people.ts`.

Also helpful:
- whether T4.6's on-chain `get_reputation` and governance views are final, so `/v1/groups` and the vote panel can read them in near mode;
- that every row coming from a transaction carries the real NEAR tx hash, so the explorer links light up.

### Run it locally (Windows PowerShell)

```powershell
cd "C:\Users\alexs\OneDrive\Desktop\Homework USC\Personal Coding\Near_Hackathon2026"
git checkout alexander; git pull
pnpm install
pnpm build

# Terminal 1: offline stand-ins for NEAR AI
pnpm demo:providers

# Terminal 2: the API (any free port; 8787 is often taken on this machine)
$env:WARDLINE_API_PORT = "8787"
$env:WARDLINE_AI_PROVIDER_URL = "http://127.0.0.1:8791/replay/v1"
$env:WARDLINE_DEMO_METER_KEY = "wk_demo_alice_key"
pnpm --filter @wardline/api start

# Terminal 3: the site, pointed at that API
$env:WARDLINE_DEV_API = "http://127.0.0.1:8787"
pnpm --filter @wardline/web dev
# open the Local URL Vite prints, usually http://127.0.0.1:5173

# Tests
pnpm test
pnpm --filter @wardline/web exec playwright install chromium firefox webkit
pnpm test:e2e

# The production build with its security headers
pnpm --filter @wardline/web build
$env:WARDLINE_DEV_API = "http://127.0.0.1:8787"
pnpm --filter @wardline/web exec vite preview --port 4180
```

### Screenshots

Looking at them led to three fixes:
- "Where your share came from" repeated "Deposit, price unchanged". It now lists only real price changes, or says WARD's price hasn't changed since you joined.
- At 390px, a wallet error in the Join dialog landed below the fold. Errors inside a dialog now scroll into view.
- On a phone, the page intro sat about 140px above its first section. It's now about 80px.

In `apps/web/screenshots/` (gitignored), desktop and 390px:
- `me-member-desktop.png`, `me-member-390.png`
- `me-empty-desktop.png`, `me-empty-390.png`
- `state-api-down-desktop.png`, `state-api-down-390.png`
- `state-wallet-rejected-desktop.png`, `state-wallet-rejected-390.png`

## Horizon: the web app redesign (2026-11-09)

Before starting, main had Tharun's T4.6 (43ed86d), and alexander was fast-forwarded to it. The redesign changes the look, not the behavior: every route, API call, wallet flow and test stays. contracts/, services/attestor and the API's verification and settlement logic are untouched.

### What changed

- **One mark, one generator.**
  - `apps/web/src/brand/horizon.ts` holds `horizonDots` exactly as specified. It also has the seeded group light and the FNV-1a/xorshift fingerprint.
  - It feeds `<HorizonMark>`, the lockup, the animated hero, the group horizons and `scripts/brand/generate-assets.ts`.
- **Assets** (`pnpm brand:assets`, committed) all go into `apps/web/public`:
  - `favicon.svg`, `favicon.ico` (16, 32, 48) and `favicon-32.png`;
  - `apple-touch-icon.png`, `icon-192.png` and `icon-512.png`;
  - `site.webmanifest` and `og-image.png`;
  - `brand/wardline-mark{,-ink}.svg` and `brand/wardline-lockup{,-ink}.svg`.

  `index.html` links the icons, touch icon and manifest, sets `theme-color` and carries `og:image` (absolute, from `repo.config.json` `hosted.web`) and `twitter:card`. I looked at each PNG. The 16px favicon still shows a sphere cut by a dark line; for it I used a coarser step (16) and a slightly larger sphere.
- **Tokens.**
  - `tokens.css` is replaced with the Horizon palette.
  - The four theme files are rewritten on it, and every class the components use is restyled.
  - Red is used only below the line. There are no pills, gradients or emoji.
- **Type.**
  - Geist is self-hosted as one variable woff2 (300 to 800), vendored from the official `geist` package (OFL in `public/fonts/OFL-Geist.txt`).
  - **Geist Mono is not shipped.** Its zero is slashed: I rendered it and checked its OpenType features, and it has no plain-zero feature. Account ids, hashes and code all contain digits, so they use Geist with tabular figures.
  - The old Spline Sans Mono ("Wardline Mono") files and the Google Fonts link are gone.
- **The hero** (`components/HeroHorizon.tsx`) follows the spec:
  - the line draws first and crosses the whole hero;
  - then the dots assemble outward from the line;
  - then the light drifts, updating `r` through refs in a requestAnimationFrame loop throttled to about 20fps;
  - the drift pauses while the tab is hidden or the hero is off screen;
  - under reduced motion the sphere is static;
  - there is no mouse listener.
- **Pages.**
  - **Mutual home:** the hero, the stats strip, "Every payment lands on one side of the line." as two joined panels with real counts, the light "Hold a share" section with the dark member card, governance as vote rows, the safest groups, and the footer call to action.
  - **Groups:** "One shared AI budget for your crew.", tier cards, group cards with their own horizon, and four steps to start a group.
  - **Proof engine:** "Nothing crosses the line without proof.", the snippet, Reserve, Forward, Prove, Settle, the latest proofs table with fingerprints and the side of the line, and the red-team results.
  - **Demo:** "Seven scenes, real code paths", with a scene list and a stage card. The stage runs the real `/v1/demo` endpoint, shows a spinner with what it is doing, then the verdict (white, red or violet) and the rows one by one, then "Next scene".
  - **Join the Mutual:** a modal dialog (focus trapped, Escape closes, focus returns to the opener) with quick picks, "You receive X WARD", "Our stake in front of yours", a wallet approval state, "You received X WARD" and "Go to my share". The same wallet-signed challenge runs underneath.
  - **Connect wallet** in the header: the account and wallet are chosen once, for the tab. Joining, the member card and voting all use it.
  - **Owner app:** the same header and tokens, plus a new My share tab (`#/app/share`) with a value card, the WARD price chart (dashed 1.0000 launch line, light above and red below via clip paths, violet dot on the latest price), where the share came from, and the vote panel. Every other tab still works.
  - Connect, Verify, About and Try it are restyled.
- **API, read-only additions only.**
  - `/v1/mutual` `stats.below`: swapped (refused proofs), look-alike (blocked payees plus flagged payouts awaiting a vote) and capped (reservations stopped at an allowance or deposit, now counted per group).
  - `GET /v1/proofs`: the latest calls with group, outcome, amount and side of the line. It returns no members, keys or content.
- **Cleanup.**
  - The old sphere, its dot data, `TextLink`, `Button`, `design/wardline-reference.html`, the paper mark and the old fonts are deleted.
  - `docs/BRAND.md` is rewritten: mark, tokens, type, the red rule and the animation spec.
  - Geist, `@resvg/resvg-js` (MPL-2.0, dev only) and `png-to-ico` are added to `docs/DISCLOSURES.md` and the README's library list.
  - The brand guard now also fails on any old palette hex or pre-Horizon font name in `apps/web/src`.

### Tests

- `pnpm test`: the brand guard passes 7 checks, including the new palette and font check, and 777 package tests pass:
  - 202 in `services/api`, covering the below-the-line counts, capped calls and `/v1/proofs`;
  - 73 in `apps/web`, covering the Horizon generator, fingerprints, seeded lights and the Geist-only rule.
- `pnpm test:e2e`: 32 of 32 pass. Coverage:
  - favicon, manifest and social links in index.html;
  - the home page with real counts;
  - a static hero under reduced motion, plus the cut, assembly and drift otherwise;
  - no mousemove listeners;
  - Try it;
  - all seven demo scenes against the real endpoints, and Next scene;
  - Join the Mutual: quick picks, Escape and focus return, the wallet deposit, the member card and the 7-day redemption;
  - the governance vote and execute-once;
  - Groups and the Proof engine;
  - Connect, Verify and About;
  - axe and no horizontal scroll at 390px on every public page;
  - the owner app, including My share and the owner Group tier.

### Screenshots

In `apps/web/screenshots/` (gitignored, regenerate with `pnpm --filter @wardline/web screenshots`), each at desktop 1440 and 390px:

| Shot | Files |
| --- | --- |
| Home, after the animation settles | `home-desktop.png`, `home-390.png` |
| Groups | `groups-desktop.png`, `groups-390.png` |
| Proof engine | `proof-desktop.png`, `proof-390.png` |
| Demo after running scene 3 | `demo-desktop.png`, `demo-390.png` |
| Join dialog | `join-desktop.png`, `join-390.png` |
| My share | `my-share-desktop.png`, `my-share-390.png` |

I looked at each one and fixed what was off, then shot them again:
- the headline running into the sphere at 1440;
- governance numbers wrapping into stacks;
- the header wrapping at 390;
- the leaderboard squeezing at 390;
- the "Verify your business" link misaligned;
- the footer links on mobile;
- the demo stage stuck on "busy" (a StrictMode ref bug).

## A credit union for the AI economy (2026-11-09)

### Step 0: Tharun's T4.5 merged into main

- `origin/tharun` contained `origin/alexander` (89b7004), and main had nothing tharun lacked.
- A clean checkout of `origin/tharun` (34459c4) passed install, build, `cargo test --workspace` in WSL (66 unit tests), `pnpm test` (754 package tests plus the brand guard) and `pnpm test:e2e` (25 of 25).
- main was fast-forwarded to 34459c4 and pushed. alexander was fast-forwarded to main and pushed. This was the only push to main.

### What changed

- **Positioning.** "Wardline is a credit union for the AI economy." The three layers are the Mutual, Groups and the proof engine. Social Money leads the track list.
- **The home page is the Mutual.** It shows:
  - the hero, with the headline and pitch line;
  - live stats: pooled, WARD price and change since launch, yield, groups covered, proven payments, payouts;
  - "How it works" for the three layers;
  - the "Safest groups" leaderboard;
  - Join the Mutual (any wallet, no group needed);
  - Governance and Payouts.

  The old home page is now **Proof engine** (`#/proof`). `#/mutual` still opens the home page. The nav is Mutual, Groups, Proof engine, Demo, Connect, About. Check a payee and Verify moved to the footer.
- **WARD-holder governance (sim).**
  - Proposals can:
    - set a tier's `fee_bps`;
    - set the coverage multiplier;
    - cover or uncover a model;
    - approve a large payout.
  - Rules:
    - Votes are weighted by WARD at the snapshot. Free WARD counts; WARD locked for redemption does not.
    - Quorum is 20% of the snapshot, and the window is 3 days.
    - A proposal passes early once votes for exceed half the snapshot.
    - Anyone can execute a passed proposal, once.
    - Only WARD holders can propose.
    - A claim above a group's coverage cap opens an `approve_payout` proposal automatically.
  - Votes and proposals are wallet-signed (NEP-413) through `/v1/pool/challenge` and `/v1/pool/submit`. Execution uses `POST /v1/mutual/proposals/:id/execute`.
  - The group-treasury proposals in `packages/dao-adapter` are unchanged.
- **Reputation tiers (sim).**
  - `get_reputation(budget_id)` returns `{tier, proven_calls, refused_calls, claims, clean_calls, next_tier_at, fee_bps, coverage_cap, spent, fees_paid}`.
  - | Tier | Fee | Coverage | How to earn it |
    | --- | --- | --- | --- |
    | Bronze | 200 bps | 25 USDC | every new group |
    | Silver | 150 bps | 50 USDC | 10 clean proven calls at Bronze |
    | Gold | 100 bps | 100 USDC | 25 more clean proven calls at Silver |
  - A paid claim moves a group down one tier and restarts its streak. Refused calls are counted but never demote.
  - The meter charges each group its tier's fee.
  - The Groups page (`#/groups`) and the owner Group view show the tier badge, the next tier, the fee, the coverage cap and the history.
- **Demo, seven scenes**, each running the real code path:
  1. **Mutual:** stats, then a deposit that mints WARD.
  2. **Group:** a hacker house funds its budget by DAO vote; two recorded NEAR AI calls and six sim-TEE calls are paid on proof; WARD goes from 1.000000 to 1.000500.
  3. **Swap:** the swapped model is refused.
  4. **Leak:** the leaked key stops at the cap.
  5. **Look-alike:** the payout proposal is flagged before the vote.
  6. **Payout:** 8 USDC from our stake (WARD stays 1.0000), then 12.5 USDC (WARD 0.9958), then 78 proven calls of fees refill it to 1.0000.
  7. **Tier:** Bronze to Silver, with the per-call fee falling from 0.0100 to 0.0075 USDC.

  The page closes on the scam-test numbers.
- **Live sim seed.** Besides Aurora Lab, three groups have a history:
  - Mission Street hacker house: Gold, 412 calls;
  - Nightshade research DAO: Silver, 186 calls;
  - Kelp Robotics club: Bronze after one 1.50 USDC claim.

  The fees they paid lift WARD to about 1.01. There are four proposals: one executed, one rejected, one passed and awaiting execution, one open. The demo scenes and unit tests use the launch seed, so their numbers are exact.
- **API routes:**
  - `GET /v1/mutual`
  - `GET /v1/groups`
  - `GET /v1/reputation/:budget`
  - `GET /v1/mutual/proposals`
  - `GET /v1/mutual/proposals/:id/weight/:account`
  - `POST /v1/mutual/proposals/:id/execute`
- **Scripts:** `pnpm demo:vote`, `pnpm demo:tier`, and `pnpm testnet:check` (view calls only). `pnpm demo:mutual` now shows a deposit, both payouts and the refill.
- **Docs.** README:
  - opens with the new headline, the three layers and the hosted links;
  - Try it gains a WARD vote and a tier change, 11 steps in all;
  - live variants name the real env vars;
  - honest limits say tiers and voting are simulated.

  `llms.txt` and SKILL.md match.
- **Hosted links** live in `repo.config.json` under `hosted` `{web, api, mcp}`. The brand test fails if README, `llms.txt`, SKILL.md or `services/mcp/server.json` lack those values or carry any other tunnel URL. **Tharun:** to switch to permanent hosting, change those three values; `pnpm test` names every file that must follow.

### Security fix: demo meter key

- **The problem.** T4.5 turned `wk_demo_alice_key` on by default in sim mode. A hosted API behind a tunnel binds 127.0.0.1, so the public-bind guard never tripped, and anyone could spend alice.testnet's allowance.
- **The fix.** The key now needs `WARDLINE_DEMO_METER_KEY` set explicitly; the README step 2 sets it. It is refused in near mode, with `WARDLINE_BIND_PUBLIC=true` and with `NODE_ENV=production`. `WARDLINE_SEED_METER_KEYS` follows the same rules.
- **Tests.** Both are in `services/api/test/mutual.test.ts`.

### Step 6: chain

- **Wiring.** Near mode reads the contract ids from `repo.config.json`:
  - `meter.wardline-labs.testnet`
  - `pool.wardline-labs.testnet`
  - `model-registry.wardline-labs.testnet`

  The old placeholder ids `meter.wardline.testnet` and `mutual.wardline.testnet` are gone, in both `createChain` and `contractsFromEnv`. The default RPC is FastNear. Reputation and voting report mode `sim` in near mode until T4.6 lands: voting weights come from a shadow WARD ledger, and tiers from the meter's budgets.
- **View calls** (`pnpm testnet:check`):

  | Account | Reads |
  | --- | --- |
  | pool | TVL 0.35 USDC, junior 0.25, senior 0.10, 0.10 WARD at 1.000000, claims paid 0.05 |
  | meter | 2 budgets (`bgt_engineering`, `bgt_leaked_1794187233942`) |
  | registry | 2 attested models (DeepSeek V4.1 Flash `0xfe00...337e`, sim-echo) |
  | investor1 | 0.10 WARD |

- **No testnet run.** `.env` has no gateway key (`WARDLINE_GATEWAY_ACCOUNT` / `WARDLINE_GATEWAY_KEY`), so scenes 1 to 6 were not run on testnet and there are no new tx hashes. Tharun's T4.5 hashes stand.
- **Tharun, the pool reports `fees_earned` 0.** That is despite a settle that sent a 1,250-unit cover fee to the pool. Either the meter's fee transfer does not call `add_fees`, or `ft_on_transfer` from the meter does not count it as fees. On chain, WARD would then not rise with fees.

### Tests

- `pnpm test`: the brand guard (6 checks, including the new hosted-links check) and 773 package tests pass, among them 200 in `services/api` (governance, tiers, demo-key guard, near wiring, the seven scenes) and 71 in `apps/web`.
- `pnpm test:e2e`: 29 of 29 pass, covering:
  - the Mutual home;
  - Join the Mutual with a wallet;
  - governance: vote, snapshot refusal, execute once;
  - Groups and tiers, and the owner Group tier;
  - all seven scenes;
  - axe at 390px and desktop on every public page.
- Against a real API process (port 19123, with the old providers on 8791):
  - with `WARDLINE_DEMO_METER_KEY` set, `pnpm demo:plugin` verified and settled, and `/v1/mutual` and `/v1/reputation/bgt_aurora` answered as documented;
  - without the key, `wk_demo_alice_key` gets 401;
  - with `NODE_ENV=production`, the API refuses to start: "WARDLINE_DEMO_METER_KEY is refused when NODE_ENV=production."
- Found and fixed while checking: seeded claims were applied a tick late, so the Mutual scene showed 0 payouts. They now apply synchronously, and a test pins it.
- No contract changes this round, so there is no new `cargo test` run. The Step 0 run on tharun passed 66 tests.

### Screenshots

Desktop and 390px screenshots of the Mutual home, Groups, Proof engine and every demo scene are in `apps/web/screenshots/` (gitignored). I looked at them and fixed:
- the leaderboard rows at 390px;
- the tier table's cramped USDC column;
- an unstyled `.h3`.

### For Tharun (T4.6)

- Please put the on-chain interfaces in `docs/DAO.md` and `docs/status/tharun.md` with these names, and I will wire them:
  - `get_reputation(budget_id)` with the shape above;
  - propose, vote and execute with a snapshot, quorum, window and execute-once.
- Once they are deployed, the sim stand-ins go in `MeterBackedReputation` and the `governance` field of `createChain` in `services/api/src/chain/index.ts`.
- Please also look at `fees_earned`, above.

## Ready to make public (2026-11-08)

### Secret scan: clean, nothing to rotate

- **Tools.** gitleaks 8.18.4 over all 124 commits on every local and remote branch (`main`, `alexander`, `alexander-redteam`, `kristian`, `lucy`, `tharun`), plus the working tree including untracked and ignored files. A second regex pass covered every patch on every branch, looking for:
  - NEAR private keys (`ed25519:` or `secp256k1:` followed by 80+ base58 characters);
  - `sk-` keys, QuickNode token URLs, EVM private keys assigned to key names;
  - seed or mnemonic phrases, and assignments of `NEAR_AI_API_KEY` or attestor, root or gateway keys;
  - any committed `.env`, credentials, `.pem` or key files, or `~/.wardline` and `~/.redline` paths.
- **History: 377 gitleaks hits, all false positives.**
  - 310 are red-team cache keys (sha256 content hashes, `fixtures/redteam/agent/*.json`, first 6 e.g. `004ab7`).
  - 64 are the public testnet USDC contract id (`3e2210`).
  - 2 are wasm SHA-256 hashes in `scripts/contracts/deployments/testnet.json` (`0479c2` in `a11e341`, `f8e1b3` in `9214b51`).
  - 1 is the USDC id in a test.
- **Regex pass:** 78 long `ed25519:` values, all in `packages/payee-check/fixtures/testnet-recording.json` (commit `40103ef`, on `main`, `alexander`, `lucy` and `tharun`). They're NEAR testnet block and chunk signatures and validator approvals from recorded public RPC responses: public chain data, not keys. Nothing else matched.
- **Working tree only:** the real NEAR AI key (`sk-681`) and the dev attestor key (`902f50`) are in the local `.env`, which is gitignored and in no commit.
- **Gitignored and confirmed:** `.env` and `.env.*`, `fixtures/private/`, `evidence/local/`, `evidence/local-ai-proofs/`, `apps/web/screenshots/`, `dist/`, agent logs, and Playwright output (`test-results/` is now ignored everywhere).
- **Deliberate test keys** (they protect nothing): the e2e keys derived from labels in `apps/web/e2e/keys.ts` and the sim TEE key in `services/demo-provider`. SECURITY.md says so.

### Done

- **README rewritten for the screener and judges.**
  - It opens with what Wardline is, then the problem.
  - "Try it in 5 minutes" has 9 do X, see Y steps: install, start the API, one paid AI call through the official OpenAI client (one base URL), the swapped-model refusal, the leaked-key cap, the look-alike block, the Mutual payout with WARD, the red-team numbers, and the tests.
  - Then live variants with their env vars, a Mermaid diagram, on-chain vs off-chain, honest limits, tracks (`privacy`, `social`, `business`, `realworld`, `security`), a repository map, docs links and disclosures. It follows HACKATHON.md: libraries and AI-generated code are listed in the README, and steps are reproducible.
- **New one-step commands:**
  - `pnpm demo:plugin` makes the paid call with the official OpenAI client and re-checks the proof with the SDK.
  - `pnpm demo:mutual` runs the two payouts.
  - `pnpm redteam:numbers` reads the committed report.
  - `WARDLINE_DEMO_METER_KEY` (sim mode only, refused in near mode) lets the API accept a fixed dev key, so no key is copied between terminals.
- **`docs/DISCLOSURES.md`:**
  - no pre-hackathon code (first commit 2026-11-03, `efc795d`);
  - most code written with Claude Code;
  - other chains (EVM and Solana are checked, nothing moves there);
  - external services (NEAR AI Cloud, Circle USDC, NEAR RPC with FastNear and optional QuickNode, Sputnik DAO, wallets);
  - every direct library and crate with its license, generated by `node scripts/disclosures/generate.mjs`: 36 npm packages and 3 crates, all MIT, Apache-2.0 or both, except `@axe-core/playwright` (MPL-2.0, test-only); plus fonts under OFL.
- **LICENSE** (MIT) was already at the root, and every `package.json` already had a license field.
- **`SECURITY.md`:** private reporting through GitHub, a 3-day acknowledgement, scope, and the test keys explained.
- **No disclaimers:** the UI and README never say "hackathon"; the only testnet wording is in the honest-limits section.

### Fresh-clone check: passes

- I cloned `alexander` at `ca2daaf` into a temp folder outside OneDrive, with no `.env`, and ran the README exactly as written.
- Install took 35 s, then the build; both exited 0.
- Steps 2 to 8 all printed what the README says, including the verified plug-in call (paid 0.000098 USDC, refunded 0.000641, local re-check signed by `0xfe0071...`) and its repeat refused as already paid.
- `pnpm test` passed: 754 package tests and 5 brand-guard tests.
- `playwright install chromium` then `test:e2e` passed 25 of 25.
- The clone's tracked files were unchanged afterwards; the API only creates the gitignored `.env`.
- The one snag was ports on this machine:
  - 8787 is held by an API from 2026-11-07 (PID 12620);
  - 8797 by one from 11:45 today (PID 42860);
  - 18787 by one I left from the last round (PID 43160), which the auto-mode permission check would not let me stop.
  - With `export WARDLINE_API_PORT=18999` every step ran. The README says any free port works.
- You can stop those three with `Stop-Process -Id 12620,42860,43160` if you want 8787 back.

### Make it public and rename it to wardline: your steps in GitHub

1. Open https://github.com/alphabyalex/Near-Hackathon_2026, **Settings**, **General**. Under **Repository name** type `wardline`, then **Rename**. GitHub redirects the old URL.
2. Same page, bottom, **Danger Zone**, **Change repository visibility**, **Change to public**, and confirm. All branches become public; all six were in the secret scan.
3. **Settings**, **Security** (Code security and analysis): turn on **Private vulnerability reporting** (SECURITY.md points to it), **Secret scanning** and **Push protection**.
4. In the repo, change one line in `repo.config.json`: `"url": "https://github.com/alphabyalex/wardline"`. Run `pnpm test`; the brand test then names the two other copies to update, `services/mcp/server.json` and `contracts/Cargo.toml` (the latter is Tharun's folder).
5. On each machine: `git remote set-url origin https://github.com/alphabyalex/wardline.git`, for Tharun, Lucy and Kristian too.
6. Optional: tag the final commit `hackathon-submission` (`git tag hackathon-submission && git push origin hackathon-submission`). There's no pre-hackathon code, so no `pre-hackathon` tag is needed.
7. Still needed for submission, from HACKATHON.md: a public X post saying it was built at NEAR HACKATHON, tagging @NEARProtocol and #NEARHackathon, with a video (screenshots alone are not enough for a local-only demo). The repo must be public by 2026-11-14 23:59 UTC and stay public through judging.

## USDC everywhere, WARD for the Mutual (2026-11-08)

Two team decisions applied: all money is Circle's USDC on NEAR, and Wardline Mutual mints WARD. 0 live NEAR AI calls this round (9 of 30 used in total, all earlier). Testnet run (step 3) skipped: nothing is deployed yet. Details below.

### Done

- **USDC is one config value.** `packages/schemas/src/token.ts` holds:
  - `USDC_TESTNET` (`3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`) and `USDC_MAINNET` (`17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`);
  - `USDC` (symbol and 6 decimals), and `usdcAccount()`, which reads `WARDLINE_USDC_ACCOUNT` and defaults to testnet. Switching to mainnet is that one env line.
  - The API's mock payables and token info, the DAO adapter's token, the red-team agent inputs and the agent's token symbol all read from it. I checked the testnet contract's `ft_metadata`: USDC, 6 decimals.
- **The retired test token is gone** from code, config, sims, dev fixtures, UI copy, docs, llms.txt, SKILL.md and tests (68 files).
  - The agent prompt now says "Dollar amounts count as USDC", so manifests A and B were regenerated (A `sha256:075dec44...`, B `sha256:5f201d02...`).
  - `evidence/example-run` regenerated from stub agents (28 match, 0 mismatch). `evidence/redteam/report.json` regenerated offline; numbers unchanged (AI alone 5 of 20 scams through, 0 with Wardline).
- **Brand guard extended.** A new test fails on the old token's name anywhere outside `RETIRED_TOKEN_ALLOW` in `scripts/rebrand-wardline.mjs`. The codemod's token constants are now USDC, so teammates' reruns land on USDC directly.
- **Left as is, and why** (all on the allowlist):
  - `contracts/`: off-limits to me. The mock-token contract's own name and symbol, plus comments in the vault, meter and cover-pool sources.
  - `tests/sandbox/`: asserts that mock-token contract's metadata.
  - `scripts/contracts/`: deploys that mock-token contract.
  - `docs/status/`: history.
  - No recorded NEAR AI or red-team fixture contained the old name, so nothing recorded was relabelled or left behind.
- **Demo amounts at faucet size:**
  - Pool: Wardline's first-loss stake is 20 USDC; LPs hold 120 WARD bought at 1 USDC.
  - Large claims (over 30 USDC) need a vote; coverage per claim is 25% of TVL.
  - The group budget stays at 25 USDC with 5, 5 and 10 allowances.
  - DAO payouts are now 12.00 and 9.50 USDC.
  - The sim model costs 0.50 USDC a call. The leaked-key demo prints `spent 15.00 of 15.00 USDC, 50 requests refused`.
- **WARD in the sim pool** (`services/api/src/chain/sim.ts`):
  - WARD is minted at the current price (senior assets / supply, starting at 1 USDC), so deposits don't move the price. Fees raise it; payouts go to Wardline's junior stake first and only dip WARD once that stake is gone.
  - Redemption locks WARD for 7 days, then burns it for USDC at the price on that day.
  - Tracks `ward_supply`, `ward_price`, `launch_price` and `price_history`. Each claim records the WARD price before and after.
  - `GET /v1/pool` and the wallet-signed pool actions now cover deposit (USDC for WARD), withdraw (lock) and redeem.
- **Pool page:**
  - A WARD panel: price, change since launch, supply, fees earned.
  - The two-line pitch, "Earn a share of Wardline's fees by backing its proofs." / "If Wardline is wrong, WARD holders cover it after Wardline's own stake.", plus "Yield-bearing, loss-sharing."
  - "Trade WARD", only when `WARDLINE_WARD_TRADE_URL` is set; otherwise hidden.
  - "We lose first." stays prominent, with a red rule beside the deposit form.
  - "Your WARD": balance, USDC value, locked WARD, each redemption's countdown, and "Redeem now" once the wait is over. Claims show the WARD price before and after.
  - A unit test keeps "stable", "principal", "guaranteed", "insurance" and "risk-free" out of the pool and home copy.
- **Mutual demo scene** has two payouts:
  - 8 USDC, all from Wardline's stake; WARD stays at 1.0000.
  - 18 USDC: 12 from the remaining stake and 6 from WARD holders; WARD goes from 1.0000 to 0.9500.
- **Port:** `WARDLINE_API_PORT` (default 8787, `API_PORT` still works) sets the API port, and the web dev proxy follows it. The README exports it once per terminal and uses it in every command.
- Unproven answers are still blocked with 502 by default, and streaming is still refused.

### Step 3 (testnet): skipped, not deployed

Tharun pushed the meter, model-registry and cover-pool contracts, typed clients, sandbox tests, a deploy script, `docs/DAO.md`, and a `createChain` near-mode wiring (merged; `alexander` fast-forwarded to main at `aff1c06`). But:
- **Nothing is deployed.** `scripts/contracts/deployments/testnet-wardline.json` names `ai-meter`, `model-reg`, `cover-pool` and `payee-reg` under `wardline-labs.testnet`, but RPC views return `UNKNOWN_ACCOUNT` for all of them and for the root. It's the deploy script's manifest, not a live deployment.
- **No gateway function-call key** has been sent yet, and none is in `.env`.
- **No token movement in the contracts.** They don't move USDC: the meter's `fund` and the pool's `deposit` are plain methods, with no `ft_on_transfer`. There's no WARD either: the pool has no NEP-141 methods and no redeem. Even deployed, the demo couldn't move real Circle USDC or mint WARD.
- `docs/DAO.md` uses exactly the method names the DAO adapter already has, so nothing to replace. His `cover_fee_bps` is 200, the same as the sim's `COVER_FEE_BPS`.
- `createChain` now wraps his `NearCoverPoolClient` in an adapter that maps `share_price` and `senior_shares` onto WARD, until the contract has WARD itself.
- No testnet tx hashes this round.

### For Tharun

- Deploy, then send the gateway account and function-call key privately (they go in `.env` as `WARDLINE_GATEWAY_ACCOUNT` and `WARDLINE_GATEWAY_KEY`), plus the real account ids for `WARDLINE_METER_CONTRACT`, `WARDLINE_MODEL_REGISTRY_CONTRACT` and `WARDLINE_COVER_POOL_CONTRACT`. Your `createChain` reads all of these.
- Meter: take USDC through `ft_on_transfer` (msg `{"action":"fund","budget_id"}`) and pay settlements in USDC to the provider's `pay_to`. The token is `WARDLINE_USDC_ACCOUNT`.
- Cover pool, to match `CoverPoolClient` in `services/api/src/chain/types.ts`:
  - WARD as NEP-141 ("Wardline Mutual share", symbol WARD, 6 decimals) on the pool or a token contract it controls.
  - `ft_on_transfer` for USDC deposits, minting at senior / supply.
  - `request_withdraw` locks WARD; `redeem(id)` after 7 days burns it and pays USDC at the day's price.
  - Fees go to senior; claims are paid junior first.
  - Views `ward_supply`, `ward_price`, and `ward_price_before/after` on claims.
  - Once those exist, the adapter in `createChain` can go.
- Contract comments and the mock-token contract still use the old token name. Your call whether the mock token stays for sandbox tests; the guard allows `contracts/`, `tests/sandbox/` and `scripts/contracts/`.
- If you create a Rhea pool for WARD, send the URL; it goes in `WARDLINE_WARD_TRADE_URL`.

### Not done

- **The vault-and-invoice mock still uses its old amounts** (a 48,750 USDC vault, invoices in the hundreds to thousands). They come from shared schema examples that the agent, evaluator and vault-sim tests pin, and the Gym's dev scenarios use the same magnitudes. Scaling them is a cross-team change. Everything in the five scenes, the group and the pool is at faucet size.

### Env vars added

`WARDLINE_USDC_ACCOUNT` (testnet default; the mainnet id is in .env.example), `WARDLINE_WARD_TRADE_URL`, `WARDLINE_API_PORT`. `WARDLINE_TOKEN_CONTRACT` is gone; `WARDLINE_USDC_ACCOUNT` replaces it.

### Tests and checks

- `pnpm test`: 754 package tests and 5 brand-guard tests pass.
- New tests:
  - WARD redeem across the 7-day wait;
  - WARD price mechanics: deposits, fees, junior-only payout, bigger payout, recovery;
  - both Mutual payouts and the faucet-sized leak;
  - the port setting;
  - the WARD copy guard;
  - the retired-token guard.
- Playwright: 25 e2e tests and 38 screenshots pass. Every 390px shot is 390 wide. I looked at Pool, Group and the Demo scenes at both sizes.
- README "Try it", rerun: with 8787 held by an old API from 2026-11-07 (PID 12620) and 8797 held by something Windows doesn't show, `export WARDLINE_API_PORT=18787` ran every step as written. The one-line plug-in call verified and settled, the repeat was refused as `REPLAYED`, the swapped model was refused and refunded, and the leaked keys capped at `spent 15.00 of 15.00 USDC`.

## AI that only pays on proof (2026-11-08)

The meter gateway, demo adversaries, DAO adapter, new pages, copy, SDK and MCP are built, against simulated contracts. Switching to chain (step 7) is blocked on Tharun's contracts and clients. Everything runs offline from recorded NEAR AI traffic.

### Live NEAR AI calls: 9 of 30

All went through `scripts/nearai/live.ts`, which logs each call to `fixtures/nearai/ledger.json` and refuses call 31. Automated tests make zero live calls.

| # | Call | Result |
| --- | --- | --- |
| 1 | GET /models | Saved as `models.json`, used to pick models |
| 2, 3 | z-ai/glm-5.3 completion and signature | `gateway` signature only, not `provider_tee`. Kept as the "gateway-only" fixture, which the gateway refuses |
| 4, 5 | z-ai/glm-5.3-flash completion and signature | `provider_tee`, verifies. The cheap model cheapai passes off |
| 6, 7 | deepseek-ai/DeepSeek-V4.1-Flash-1017 completion and signature | `provider_tee`, verifies. The model the demo pays for |
| 8, 9 | Model attestation reports for both | Each names exactly the signer that signed its response |

Finding: models listed as `attested 3p` (GLM-5.3, DeepSeek V3.2, Qwen 3.5, Kimi) answered with gateway signatures. Only the models NEAR AI serves itself (`owned_by: nearai`) gave `provider_tee` signatures. Default routes only use those.

### Done

- **Meter gateway** (`services/api/src/meter`). `POST /v1/ai/chat/completions` and `GET /v1/ai/models` are OpenAI-compatible; the official `openai` npm client works unchanged (tested). Each call:
  1. Resolves the key's budget, member and model.
  2. `meter.reserve(max)`, where max is the prompt bytes plus `max_tokens`, at NEAR AI list prices.
  3. Serializes the body once and sends those exact bytes, with `x-no-aliasing: true` and `accept-encoding: identity`.
  4. Hashes the exact response bytes.
  5. Fetches the signature, retrying while it is 404 (0, 400, 800, 1600, 3200 ms).
  6. Verifies: `provider_tee`, `ecdsa`, the signed text equals `<model>:<req>:<res>`, the EIP-191 signer (viem) matches `signing_address`, and that signer is attested for that model.
  7. `meter.settle(proof)`, or `meter.release` on any failure.
  - Settlement uses the provider-reported usage, capped at the reservation. We do not claim to prove token counts.
  - Headers: `X-Wardline-Proof`, `-Call`, `-Settlement`, `-Model-Proven`, `-Amount`, `-Refund`.
  - Errors: 402 `spend_limit_reached` (ALLOWANCE_EXHAUSTED or BUDGET_EXHAUSTED), sent before anything reaches the model. 502 `proof_refused` with the reason. 504 on timeout, refunded.
  - Per-key token-bucket rate limit (120 a minute). Every call is logged to sqlite with its hashes, signature, signer and settlement or release id.
  - Unproven responses are blocked by default. Setting `unproven: "deliver"` returns them unpaid instead.
  - Streaming is refused with 400 for now. To add it, hash the exact SSE bytes including framing, as NEAR AI's docs describe.
- **Replay protection.** A signed response (by chat id) settles at most once. The sim meter re-verifies the proof itself before paying, as the contract should.
- **Meter keys.** Owner routes create, scope (all models or a list) and revoke keys per (budget, member). Keys are stored as sha256 and shown once.
- **Chain interfaces** (`services/api/src/chain/types.ts`): `MeterClient`, `ModelRegistryClient` and `CoverPoolClient`, with simulations behind `WARDLINE_CHAIN_MODE=sim`. The sim registry holds only the two signers from the recorded attestation reports, plus a published test key for `wardline/sim-echo-1`, labelled simulated. `near` refuses to start until the clients exist.
- **Demo adversaries** (`services/demo-provider`, offline):
  - `replay` serves recorded NEAR AI traffic for its exact request bytes.
  - `cheapai` claims DeepSeek and returns GLM-5.3 Flash's real answer and signature. Variants send no signature, or canned text.
  - `simtee` is a local test TEE.
  - `hang` never answers, for the timeout test.
  - `demoFetch` refuses every other host.
  - Scripts: `pnpm demo:swapped-model` (refused, 0 paid, 0.000739 refunded), `pnpm demo:leaked-key` ("spent 0.030000 of 0.030000 WUSD, 65 requests refused": the first key stops at its allowance, the second at the budget's deposit). Run the providers locally with `pnpm demo:providers`.
- **DAO adapter** (`packages/dao-adapter`): the six decisions (fund budget, set allowance, add provider, approve payout change, change pool parameter, approve claim) as Sputnik v2 proposals, and back.
  - Funding is a Transfer with `msg`, which Sputnik runs as `ft_transfer_call` to the meter.
  - Reads go through near-api-js view calls. Writes return the `add_proposal` (with the policy's bond) and `act_proposal` transactions for a wallet to sign.
  - Includes an in-memory Sputnik for sim mode. Tested against mocked RPC. No new multisig.
- **Pages:**
  - Group (`#/app/group`): shared budget, members, every call with model claimed and proven, DAO proposals, and payouts awaiting a vote, each run through the payee check. The look-alike payout is flagged BLOCK.
  - Wardline Mutual (`#/mutual`): TVL, first-loss and senior, share price, fees, claims, coverage per claim, a wallet-signed deposit and withdrawal (NEP-413, recipient `wardline-mutual`) with the 7-day wait, the claims history, and "We lose first."
  - Overview: an AI spend panel (verified calls, refunds, spend per day).
  - API keys: a meter keys section.
  - Demo: the five scenes on the real code paths, then the red-team numbers.
  - Connect: the OpenAI base URL in JS and Python.
- **Copy** (`brand.ts` only): "AI that only pays on proof." and "The right party, for the model you actually got, up to what you allowed. And if we're wrong, the Mutual pays you back." The pool is called protocol-backed coverage everywhere.
- **SDK:**
  - `createWardline({ mode: "hosted", baseUrl, meterKey }).openai(OpenAI)` returns a configured official client; `.openai()` with no argument returns a small built-in one.
  - Also `openaiConfig()`, `getCall(id)`, `verifyProof(call, { responseBytes, isAttested })` and `getAiSpend(budgetId)`.
  - `verifyProviderProof` is exported for anyone checking proofs.
- **MCP:** `get_ai_spend(budget_id)`, read-only, alongside the existing tools.
- **Docs:** llms.txt, SKILL.md and the README "Try it", which now covers the plug-in call, the swapped model and the leaked key, run as written.
- **Fix:** absolutely positioned screen-reader labels inside scrolling tables widened owner pages at 390px.

### Routes added

| Route | Who |
| --- | --- |
| `POST /v1/ai/chat/completions`, `GET /v1/ai/models`, `GET /v1/ai/calls/:id`, `GET /v1/ai/budgets/:id` | Meter key |
| `GET /v1/ai-registry`, `GET /v1/pool`, `GET /v1/pool/positions/:account` | Public |
| `POST /v1/pool/challenge`, `POST /v1/pool/submit` | Public, NEP-413 signed |
| `POST /v1/demo/:scene` (plugin, swap, leak, invoice, mutual) | Public, sim only |
| `GET /owner/group`, `GET /owner/ai/overview`, `GET/POST /owner/meter-keys`, `POST /owner/meter-keys/:id/revoke` | Owner session |

### Env vars added

`WARDLINE_CHAIN_MODE` (sim or near), `WARDLINE_AI_PROVIDER_URL`, `WARDLINE_SIMTEE_URL`, `WARDLINE_MODEL_ROUTES`, `WARDLINE_SEED_METER_KEYS`, `WARDLINE_METER_CONTRACT`, `WARDLINE_MODEL_REGISTRY_CONTRACT`, `WARDLINE_COVER_POOL_CONTRACT`, `WARDLINE_TOKEN_CONTRACT`, `WARDLINE_GROUP_VAULT`, `WARDLINE_DAO_ACCOUNT`, `WARDLINE_METER_KEY` (MCP), `WARDLINE_NEARAI_FIXTURES`, `DEMO_PROVIDER_PORT`, `CHEAPAI_MODE`. All are documented in .env.example. The gateway reads `NEAR_AI_API_KEY` from .env for live upstream calls.

### Tests

- `pnpm test`: 684 package tests and the brand guard. New tests:
  - gateway: 18, covering verified, wrong model, missing signature, tampered response, replay, gateway-only signature, signature retry, re-check by call id, over allowance, over budget, timeout release, unattested signer, key, scope and streaming checks, rate limit, the official OpenAI client, a 402 through the OpenAI client, and the SDK.
  - routes and scenes: 9
  - DAO adapter: 13
  - demo providers: 5
  - SDK proof: 3
  - MCP: 1
- Playwright: 25 e2e tests, adding the five scenes, Mutual deposit and withdrawal, Group with no sideways scroll at 390px, and meter keys with the AI panel. 38 screenshots.

### Screenshots

`pnpm --filter @wardline/web screenshots` writes desktop (1440) and 390px versions of each to `apps/web/screenshots/` (gitignored). New this round: `demo-*`, `demo-swap-*`, `demo-leak-*`, `demo-mutual-*`, `mutual-*`, `owner-overview-*` (with the AI panel) and `owner-group-*`. Every 390px shot is exactly 390 wide. Fixed after looking at them:
- Group overflowed sideways at 390px.
- The chart's tick labels were stretched.
- The pool stats were cramped.
- The pool's TVL shares showed as 19.99%.
- Proposals showed atomic amounts.
- The AI panel sat flush against the vault strip.

### Blocked

- **Step 7, switch to chain:** Tharun's meter, model registry and cover pool clients, his deploy and docs/DAO.md have not landed (origin/tharun was last pushed with Vault v2 and the payee registry). No `WARDLINE_CHAIN_MODE=near` run, so no testnet tx hashes yet. Settlement ids are `sim-...`.
- **Real wallet deposit** into the cover pool (`ft_transfer_call` from the wallet) needs the pool contract. Sim mode takes a NEP-413 signed request instead.
- The README's API port 8787 was held on this machine by a listener Windows does not show (probably forwarded from WSL), so I ran the walkthrough with `API_PORT=8797`. Every step matched.

### For Tharun

- **Interfaces.** Please implement or confirm these in `packages/vault-client`, then swap them in at `createChain` in `services/api/src/chain/index.ts`:
  - `MeterClient`: `listBudgets`, `getBudget`, `reserve({budget_id, member, call_id, model_id, max_amount})`, `settle({call_id, amount, proof})`, `release({call_id, reason})`, `fund`, `setAllowance`.
  - `ModelRegistryClient`: `isAttested(model, signer)`, `listModels`.
  - `CoverPoolClient`: `getPool`, `getPosition`, `deposit`, `requestWithdraw`, `listClaims`, `fileClaim`, `addFees`.
  - Shapes are in `services/api/src/chain/types.ts`. Amounts are atomic WUSD strings.
- **Settle must re-verify the proof on chain.** Recover the EIP-191 signer of `text` with `env::ecrecover` over keccak256("\x19Ethereum Signed Message:\n" + len + text). Check that text is `<model_id>:<request_hash>:<response_hash>` for the reserved model, that the signer is in the registry for that model, and that `chat_id` was never settled. The proof object carries all of these. Reject `amount` above the reservation.
- **Model registry seeds.** From the recorded attestation reports:
  - deepseek-ai/DeepSeek-V4.1-Flash-1017 → `0xfe0071895500a9755c18044948ab4f4e1a7f337e`
  - z-ai/glm-5.3-flash → `0x3b753b4406613c5e70ae640508632b600424fa0c`
  - The attestor should verify the TDX and GPU quotes in `fixtures/nearai/attestation-*.json` before registering them. I did not verify quotes.
- **DAO method names**, used until docs/DAO.md lands. All live in `CONTRACT_METHODS` in `packages/dao-adapter/src/actions.ts`:
  - `meter.set_allowance({budget_id, member, allowance})`
  - `registry.add_provider({provider_id, pay_to, model_ids})`
  - `vault.approve_endpoint({vendor_id, revision, account})`
  - `pool.set_param({name, value})`
  - `pool.approve_claim({claim_id})`
  - Funding is `ft_transfer_call` to the meter with `msg {"action":"fund","budget_id"}`.
- **Coverage fee.** The sim meter sends 2% of each settlement to the pool (`COVER_FEE_BPS`). Tell me your number.
- **Gateway key.** Send the function-call key and account ids privately. They go in .env only.

### Merging

Five commits on `alexander`, not merged to main: sdk proof and fixtures, demo providers and DAO adapter, the API gateway, the web pages, and docs. `fixtures/nearai/attestation-*.json` are about 400 KB each.

## Renamed to Wardline (2026-11-08)

The product is now **Wardline** ("the line between your agent and your money"). The test token is **Wardline Test Dollar (WUSD)**, still 6 decimals. Logo, colors, fonts and layout are unchanged. No NEAR AI calls in this round, nothing deployed, nothing published.

### What changed

- `scripts/rebrand-wardline.mjs`: an idempotent codemod (Node, no dependencies, `--dry-run`, `--list`). It rewrites contents and file names of every file git knows about, in a fixed order, so it gives the same result on any branch. Its first run here changed 257 files and renamed 9; a second run changes nothing.
  - Redline / redline / REDLINE to Wardline / wardline / WARDLINE, which covers `@wardline/*`, `WARDLINE_*` env vars, `createWardline`, `WardlineBlockedError`, `withWardline`, `/.well-known/wardline-payee.json`, `/.well-known/wardline-attestor.json`, the proof message `wardline-payee:v2:`, NEP-413 recipients (`wardline-payee-registry`, `wardline-owner-login`, `wardline-payment-record`, `wardline-review-approval`), schema ids, the MCP server name, the `wardline` NEP-297 standard and the Rust crate names.
  - REDL to WUSD and "Redline Test Dollar" to "Wardline Test Dollar". Spend Gym and sgUSD map to Wardline and WUSD, so older teammate branches clean up too.
  - Renamed files: `wardline-mark*.svg`, `wardline-mono-*.woff2` (same font bytes; the family is now "Wardline Mono"), `design/wardline-reference.html`, `docs/skills/wardline-payee-check/`, `packages/schemas/src/wardline-event.ts` and its example.
  - The design reference's pun "Every agent has a redline" became "Every agent has a limit".
- `tests/brand.test.mjs` (first step of `pnpm test`): fails on any old name outside the codemod's allowlist, on old names in file names, on a codemod example that maps wrongly or changes on a second pass, and on a GitHub URL that differs from `repo.config.json`.
- Env fallback: `readEnv` and `applyLegacyEnv` in `@wardline/schemas` (re-exported by the SDK and vault-client). Every entry point reads `WARDLINE_X` first, then `REDLINE_X`, with one warning per process that names the old variables and never their values. Wired into `loadRepoEnv` (API, evaluator, agent CLI), the MCP server, the contract scripts, the sandbox harness, the root scripts and `vite.config.ts` (which also maps `VITE_REDLINE_*` from .env files).
- Repo URL: one constant in `repo.config.json` (`url`, with a TODO for the planned name `wardline`), read by `brand.ts` as `BRAND.repoUrl`. `services/mcp/server.json` and `contracts/Cargo.toml` keep a copy, and the brand test fails until they match the config. The GitHub repo itself is not renamed.
- Regenerated: `pnpm-lock.yaml` (clean install), `evidence/example-run` (stub agents only; verify: 28 match, 0 mismatch), agent manifests A and B (the prompt names the product and the token), `evidence/redteam/report.json` and `docs/REDTEAM.md` (offline `bench`).
- `bench` now reads recorded AI decisions for the most recorded agent manifest when the current agent has none, and the report says so. Without this, an offline rerun after the rename silently dropped the first-payment comparison. The numbers are unchanged: AI alone 5 of 20 scams through at first contact, 0 with Wardline.
- index.html gained `og:title`, `og:description`, `og:site_name` and `og:type`, filled from brand.ts. The owner sign-in screenshot now waits for the form instead of catching the loading line.
- docs/BRAND.md has the name line. docs/CONTEXT.md has a "Legacy deployments" section.

### Remaining old names, all allowed

| Where | Why |
| --- | --- |
| `*.redline-labs.testnet` in .env.example, Connect.tsx, the SDK README, vault-client, vault-sim and their tests | The live testnet deployment. NEAR accounts cannot be renamed. |
| `scripts/contracts/deployments/testnet*` | Records of that deployment, including the on-chain token metadata (name and symbol REDL). |
| `redline-redteam-v1` in services/redteam/src/cli.ts, fixtures/redteam/cases.json and the report | Seed of the committed red-team cases. The recorded model outputs are keyed to cases built from it. |
| `fixtures/redteam/**` | Recorded model outputs, keyed by content hash and by the old agent manifest digest. |
| `packages/schemas/src/legacy-env.ts` and its test | The env var fallback, which must name the old prefix. |
| `scripts/rebrand-wardline.mjs` | The codemod and its allowlist. |
| `docs/status/*.md` | History, left as written. The lockfile is clean, and the guard ignores only base64 integrity hashes in it. |

### Env var migration

- Every `REDLINE_*` is now `WARDLINE_*`, and `VITE_REDLINE_*` is now `VITE_WARDLINE_*`. Old names still work, with a one-time deprecation warning. Rename them when convenient.
- The codemod renamed the keys in my local `.env` in place, one key (`WARDLINE_ATTESTOR_KEY`), without printing values. If both names are already set, it comments the old line out instead of deleting it.
- The default secrets folder for the contract scripts is now `~/.wardline/<network>`. Move `~/.redline/testnet` there, or set `WARDLINE_SECRETS_DIR=~/.redline/testnet`.

### For Tharun

1. `git pull` on each branch you will merge, with a clean working tree.
2. `node scripts/rebrand-wardline.mjs --dry-run`, check the counts, then `node scripts/rebrand-wardline.mjs`. If your branch does not have the script yet, merge `alexander` (or main once it lands) first, or copy the file.
3. `pnpm install` to regenerate `pnpm-lock.yaml`.
4. `pnpm test`. The brand test names any line the codemod could not handle. If you touched `evidence/example-run`, regenerate it with the command the codemod prints; otherwise take mine on merge.
5. In WSL, rebuild the contracts (`scripts/contracts/build.sh`): the wasm files are now named `wardline_*`, and sandbox tests read them from `WARDLINE_WASM_DIR` or `contracts/out`.
6. Redeploy the token and vaults under a new Wardline root, so on-chain names match: the token symbol and name, the `wardline` event standard and the `wardline-payee-registry` NEP-413 recipient. Set `WARDLINE_ROOT_ACCOUNT` before running `deploy-and-seed`; the token account is now `wusd.<root>`. Until then the live contracts under `redline-labs.testnet` still emit the `redline` standard, report REDL, and expect proofs signed for the old recipient and prefix, so payees must be re-proved and reseeded after the redeploy.
7. After the redeploy, update the defaults that point at `redline-labs.testnet` (vault-client evidence contract, vault-sim token id, Connect page, SDK README, .env.example) and remove them from the codemod's allowlist.

### Not done

- The GitHub repo name and the npm org: yours to change. Nothing was published to npm or the MCP registry.
- Teammates' status files: not edited, since each person edits only their own. Their history still uses the old names.
- The agent's manifest digest changed (A is now `sha256:be48e5ff...`, B `sha256:f0b7739e...`). Kristian: please note it in kristian.md. The first-payment comparison was recorded against the old A (`sha256:3263c237...`). Rerunning `pnpm --filter @wardline/redteam agent` records the current agent, which costs NEAR AI calls (about $0.05).
- My three old local runs in the gitignored `evidence/local/` predate the rename, so `pnpm verify:evidence` fails on them locally. Delete them or rerun; the committed evidence verifies.

### Tests

- `pnpm test`: the 4 brand tests, plus 607 package tests (3 new for the env fallback, 1 for the recorded-digest fallback).
- Playwright: 21 e2e tests and 28 screenshots pass. I looked at every page at both sizes: the wordmark, titles and copy say Wardline, and amounts are in WUSD.
- README "Try it", run as written: steps 1 and 3 to 6 pass. Step 2 also passed, but on port 8797 (`API_PORT=8797`), because an older API (PID 12620, running since 2026-11-07 18:32) already holds 8787. I left it running.
- Contracts: `cargo test --workspace` in WSL (build output in /tmp, not the repo) compiles the renamed crates and passes 40 unit tests, including the event standard test. No wasm build and no sandbox run in this round.

## Site, owner sign-in and Review Desk (2026-11-08)

Public site and owner app rebuilt around Payee Shield. No NEAR AI calls in this round. Verdicts on the site come from the stub engine and memory registry, behind the same interfaces the real clients will use.

### Done

| Piece | Where | State |
| --- | --- | --- |
| One copy module | `apps/web/src/brand.ts` | Product name, tagline, hero, feature rows, page copy, trust levels, owner copy. The page title and meta description are injected from it at build time. A rebrand is a change to this file |
| Home | `views/site/Home.tsx` | Hero line, sub-line on paying by website name, six feature rows, results strip |
| Results strip | `vite/redteam.ts`, `src/redteam.ts` | A Vite plugin reads `evidence/redteam/report.json` at build time and exposes only the summary. Labels the engine (stub today). Nothing hardcoded; a unit test compares it with the report |
| Try it | `views/site/TryIt.tsx`, `payee/ResultCard.tsx` | Resolve (domain + chain) and Check (address + optional domain). The card shows the verdict with an icon, each reason in plain words with its code, a trust badge with what it verifies and does not, and the receipt. "Verify signature" runs the SDK's `verifyReceipt` in the browser against `/.well-known/redline-attestor.json` and the exact request sent |
| Demo | `views/site/Demo.tsx` | Four scenes: a look-alike NEAR account in a bank-change email (BLOCK), a swapped x402 payTo stopped by the real `withRedline` guard running in the page (BLOCK), a near-identical EVM address (BLOCK), pay northwind.example (PAY with receipt). Each ends in the live API result. Below, the first-payment comparison from the report: 5 of 20 through alone, 0 with Redline. Under reduced motion the steps show at once |
| Connect | `views/site/Connect.tsx` | MCP URL and client config, curl resolve and check, SDK hosted and direct, x402 guard, llms.txt link, copy buttons. URLs come from `VITE_` vars. Unset: a "Set your API URL" notice and `$REDLINE_API_URL` in the snippets, never a local address |
| Verify your business | `views/site/Verify.tsx`, `wallets/` | Stepper: domain and name; sign with NEAR (wallet selector, Meteor and MyNearWallet, NEP-413), EVM (injected EIP-1193, personal_sign) and Solana (Phantom signMessage); download `redline-payee.json` with hosting rules; "Check my domain" calls `/v1/vendors/verify` and shows the level reached and what it does not establish |
| About | `views/site/About.tsx` | Kept, with a payee-check step in the flow, a BLOCK example and the trust-levels table |
| Nav | `views/site/SiteChrome.tsx` | Try it, Demo, Connect, Verify, About rightmost; the logo goes home; a Menu button under 760px. The footer adds The vault, llms.txt and Owner sign-in |
| Owner sign-in | `views/owner/SignIn.tsx`, `api/owner.ts` | Account, then wallet, then the existing NEP-413 challenge, then the session cookie. Sign out sits in the page head. Any 401 returns to sign-in. `REDLINE_OWNER_AUTH=off` is no longer needed locally and stays a localhost-only escape hatch |
| Dashboard | `views/Dashboard.tsx` | The existing views, now through the `/owner` routes, plus Review Desk and API keys tabs. The owner app is lazy-loaded, so public pages never download it |
| Review Desk | `views/owner/ReviewDesk.tsx`, `services/api/src/review-desk.ts` | HOLD verdicts and vendor endpoint changes. Each shows the old and new account with the differing part marked, trust level, reasons, a live cooldown countdown, the amount at stake and the payables it affects. Approve signs a canonical payload with the approver's wallet; Reject needs only the session. No bulk route. A Decided table shows who, what, when and the signature |
| API keys | `views/owner/ApiKeys.tsx` | Create (payer, label, check-only or check and record), the key shown once with a copy button, revoke |
| Endpoint changes | `services/api/src/gateways/endpoint-gateway.ts` | `EndpointGateway` interface with a memory implementation seeded with two changes on vault A, one in cooldown and one past it. The requester cannot approve. An approved change applies once its cooldown ends |
| HOLD capture | `services/api/src/payee/routes.ts` | A HOLD on a payer's API key goes to the Review Desk, refreshed rather than duplicated. Anonymous calls never reach it |

### Approval signing

`POST /owner/review-desk/:id/challenge` returns the payload `{ action: "approve", item, vault, vendor, revision, account, expiresAt }` (5 minutes), the message `redline-review:v1:` plus the canonical JSON, recipient `redline-review-approval` and a single-use 32-byte nonce. The wallet signs it with NEP-413. `POST .../approve` spends the nonce first, rebuilds the payload from the item's current state and refuses if anything changed, then checks the signature and that the key is a full-access key on the signed-in account. It records the decision with the signed message, key and signature. For an endpoint change it calls `approveEndpoint` on the gateway. For a HOLD on an active domain-linked account it records the payee approval, which raises that payer to T3; otherwise it records a one-time release. Approvals are refused while owner sign-in is off.

### Routes added

All under `/owner`, session required: `GET /review-desk`, `POST /review-desk/:id/challenge`, `POST /review-desk/:id/approve`, `POST /review-desk/:id/reject`. `GET /api-keys` now returns each key's scopes.

### Env vars added

In `.env.example`: `VITE_REDLINE_API_URL`, `VITE_REDLINE_MCP_URL`, `VITE_REDLINE_OWNER_URL`, `VITE_NEAR_NETWORK`, and `REDLINE_DEV_API` for the dev proxy. Vite now reads the repo root `.env`; only `VITE_` names reach the browser. `VITE_REDLINE_TEST_WALLET` is for the end-to-end build only and is not in `.env.example`.

### Tests

- `pnpm test`: 603 passing. API 153 (9 new Review Desk tests), web 70 (11 new).
- `pnpm --filter @redline/web test:e2e`: 21 Playwright tests against a stub API (`apps/web/e2e/stub-api.ts`: real routes and auth, with NEAR key lookups and vendor website fetches answered locally). Wallet signing is mocked: a scripted NEAR wallet listed only in builds with `VITE_REDLINE_TEST_WALLET=1`, an injected EIP-1193 provider and a Phantom-shaped provider. Covers every public page, the Verify flow end to end, the Review Desk approve flow, API keys, a refused sign-in, axe WCAG A and AA checks, no sideways scroll at 390px, and focus rings for the keyboard only.
- One test drives the real wallet selector: clicking MyNearWallet loads it and opens a `sign-message` request with recipient `redline-owner-login`, the challenge message and a 32-byte nonce (the wallet site itself is blocked). It caught that the wallet SDKs need `global` and `process`, which are now shimmed when the wallet code loads.
- Lighthouse accessibility on a production build, mobile and desktop: 100 on Home, Try it, Demo, Connect, Verify and sign-in. About scored 98 for heading order; that was fixed after the run and not re-measured.

### Screenshots

`pnpm --filter @redline/web screenshots` writes them to `apps/web/screenshots/` (gitignored), each at `-desktop` (1440 wide) and `-390`: `home`, `try-it`, `try-it-block`, `demo`, `connect` (URLs set), `connect-unset`, `verify`, `verify-wallets`, `verify-host`, `about`, `owner-sign-in`, `owner-overview`, `owner-review-desk`, `owner-api-keys`. Fixed after looking at them: the limit line crossing the hero heading, a cramped dashboard header (the account moved to the page head), an orphan dot in the comparison at 390px, the About example overflowing by 2px at 390px, and low contrast on upcoming demo steps.

### Blocked

- Real wallets were only exercised up to the hand-off. Signing with real Meteor, MyNearWallet, EVM and Phantom keys needs a person with those wallets.
- Headless Chromium on this machine never completes blob downloads, even on a bare test page, so the e2e test checks the exact file the Download button hands to the browser instead of a saved file.
- Vault v2 (Tharun): the Review Desk runs on the memory `EndpointGateway`. His client needs to provide `listChanges`, `approveEndpoint` (maps to `approve_endpoint`; the signed message, key, signature and nonce are passed through) and `rejectEndpoint`. Swap point: `services/api/src/gateways/index.ts`. Vault vendors have no domain yet, so the desk matches them to the registry by name until vault v2 stores it.
- Release Guard appears as a feature row. It is Tharun's vault v2 work and is not wired into anything here.
- Hosting (Tharun): the owner routes must be served on the same site as the dashboard so the HttpOnly, SameSite=Strict cookie is sent. Set `VITE_REDLINE_OWNER_URL` if they are not at `<API URL>/owner`.
- The main bundle is about 500 KB minified, mostly the SDK and zod for Try it and Demo. The wallet SDKs and the owner app are separate lazy chunks.

## Hardening round (2026-11-08)

Adopts Tharun's review: control and linkage are not legal ownership, approvals happen where the agent cannot reach, an email on the same domain is not independent, and sensitive data stays off chain.

### Done

| Piece | Where | State |
| --- | --- | --- |
| Owner routes split from `/v1` | `services/api/src/owner-app.ts`, mounted at `/owner` or on `REDLINE_OWNER_PORT` | Done. Covers intake, review actions, vault pause and unpause, agent simulation, API keys, payee approvals and the private dashboard reads. `/overview` and `/evaluations` stay public for the site |
| Owner sign-in | `services/api/src/auth.ts` | NEP-413 challenge, 5 minute expiry, single use even on a failed attempt, recipient `redline-owner-login`. Listed owner or approver accounts only, with a current full-access key. HttpOnly, SameSite=Strict cookie or bearer token, 30 minute session, logout. Only token hashes are stored |
| Roles | `owner-app.ts` | Approvers can pause, review and approve payees. Unpause, simulation and API keys need an owner |
| Payer API keys | `POST /owner/api-keys` | Stored hashed, one payer each, own daily limit (default 10,000) next to the per-IP free tier. Scopes: `check` by default, `record` only when asked for, so an agent's key cannot record payments to clear `PAYEE_CHANGED` |
| Authenticated payment records | `/v1/payments/record` | A record-scoped key for that payer, or the payer's NEP-413 signature over timestamp and canonical body (5 minutes, single use). Passing `payer` to check or resolve also needs that payer's key, so nobody reads another payer's relationships |
| Binding | `services/api/src/server-config.ts` | Localhost unless `REDLINE_BIND_PUBLIC=true` or `REDLINE_OWNER_BIND_PUBLIC=true`. Refuses to start with owner routes public and auth off, or with nobody listed |
| Evidence tiers | Schema on main; engine, receipts, SDK, MCP, guard | T2 for a domain-linked account, T3 after an owner approval or past payment by that payer, T0 otherwise. Signed into receipts. `assertPayable(result, { minTier })`. T1 and T4 are never issued today |
| Wording | `docs/PAYEE_SHIELD.md`, `llms.txt`, `SKILL.md`, READMEs, tool descriptions, reason details | We verify account control and the domain link at a stated tier. Trust-levels table says what each tier does not establish. AP2 wording as given, with the Aviv et al. citation, checked against the paper's scenario AM1 |
| Merchant legal name | `legalNameSource: "vendor-claimed"` | Not verified. A self-issued signature only shows the domain made the claim, and draft -01 leaves third-party issuance open |
| Billing email | | No such path existed. The brief now says same-domain email is never extra evidence |
| Seed and test domains | everywhere | Reserved `.example` names. `REDLINE_DEMO_VERIFY_DOMAIN` added, empty |
| Agent truncation | `services/agent/src/agent-config.ts` | `thinking_token_budget: 1024`, `max_tokens: 4000`. NEAR AI documents the reasoning budget for this model as 8,192 by default, which used up the old 2,000 limit. Manifests regenerated |
| Gym timeout | `services/evaluator/src/rubric.ts` | Already 150 s from Kristian's merge, above 2 attempts of 60 s. A test now pins it |
| `eval:dev` | `services/evaluator/src/llm-preflight.ts` | Loads `.env`. Stops when an LLM agent is configured or named but did not load, or NEAR AI Cloud cannot be reached (checked by listing models, no inference). Without a key it warns and runs the rest |
| `lastUsage` in gym-export | | Already done in Kristian's branch, merged here |
| Latency | report JSON and markdown | p50 and p95 per run are reported. `within_latency_budget` (30 s) stays a count, not a threshold |
| Kristian's branch | merged into `alexander` | His `/agent/simulation` route now sits behind owner auth |

Tests: 548 passing. The README "Try it" steps were rerun against a live API and match.

### Live NEAR AI calls used

3 completion calls on 3 dev cases, all correct on the first attempt, no fallback, none cut off. About $0.0023 in total, computed from token counts. Each call also made 2 reads from NEAR AI's signature and attestation endpoints through Kristian's proof collection, which run no inference.

| Case | Expected | Got | Latency | Completion tokens |
| --- | --- | --- | --- | --- |
| `scn_gj2naksauv`, over vendor cap | REVIEW | REVIEW | 23.6 s | 1,212 |
| `scn_z3494rz5dx`, look-alike vendor | FLAG | FLAG | 49.3 s | 1,192 |
| `scn_vx3nu49juj`, ordinary | PAY | PAY | 20.8 s | 684 |

The look-alike answer cited evidence not in the records, which the guard removed. The decision itself was right. The automated tests make no live calls.

Candidate digests after this change, not frozen: A `sha256:3263c237d3152bfd36cabd6c7087feafab964fcc36336219df9a5016d3e511da`, B `sha256:ae32339465c439322ae9d5e221468da169a99e3dbfa3571366052689c2d057e1`. A full LLM Gym run has not been redone, to save credits.

### Blocked

- ~~The dashboard has no sign-in screen.~~ Resolved in the round above: wallet sign-in, so `REDLINE_OWNER_AUTH=off` is no longer needed locally.
- Approvals are per deployment: any listed owner or approver can approve for any payer. Tying payers to their own owners needs a tenant model.
- Everything from the round below still runs on the stub engine and memory registry.

### Env vars added

In `.env.example` only: `REDLINE_BIND_PUBLIC`, `REDLINE_OWNER_PORT`, `REDLINE_OWNER_BIND_PUBLIC`, `REDLINE_OWNER_ACCOUNTS`, `REDLINE_APPROVER_ACCOUNTS`, `REDLINE_OWNER_AUTH`, `REDLINE_SESSION_TTL_MINUTES`, `REDLINE_API_KEY_CALLS_PER_DAY`, `REDLINE_DEMO_VERIFY_DOMAIN`, `REDLINE_API_KEY`. From Kristian's merge: `REDLINE_ENABLE_COMPROMISED_DEMO`, `REDLINE_AGENT_PROMPT`, `REDLINE_PROOF_DIR`.

### Interface notes for Tharun: hosting the owner routes

- Serve `createOwnerApp(deps)` from `services/api/src/owner-app.ts` on its own port (`REDLINE_OWNER_PORT`), behind HTTPS. Set `REDLINE_OWNER_BIND_PUBLIC=true` only behind your proxy. Cookies are marked Secure when either public flag is on.
- List the signers: `REDLINE_OWNER_ACCOUNTS=owner-a.redline-labs.testnet` and approvers in `REDLINE_APPROVER_ACCOUNTS`. Sign-in needs a full-access key on that account, checked over RPC (`NEAR_RPC_URL`).
- Sign-in from a wallet: `POST /auth/challenge { account }`, then `signMessage({ message, recipient: "redline-owner-login", nonce })` with the returned nonce bytes, then `POST /auth/login { account, publicKey, signature, nonce }`. Send the cookie, or `Authorization: Bearer rs_...` from scripts.
- Use one SQLite file (`API_DB_PATH`) for both apps if they run in separate processes, since sessions, keys and approvals live there.
- Recipients are separate on purpose: `redline-owner-login`, `redline-payment-record` and `redline-payee-registry`. A signature for one is refused by the others. Please keep that if the contract adds its own NEP-413 messages.
- Owner keys never go to the agent. The agent's NEAR key stays limited to `request_payment`, and its Redline API key should be check-only.

## Payee Shield (2026-11-07)

Brief: [docs/PAYEE_SHIELD.md](../PAYEE_SHIELD.md). Everything below runs on the stub engine and memory registry. Nothing reads a registry contract yet.

### Done

| Piece | Where | State |
| --- | --- | --- |
| Schemas | `packages/schemas/src/payee-check.ts` | On main |
| `/v1/check`, `/v1/resolve`, `/v1/vendors`, `/v1/payments/record`, free tier and 402 | `services/api/src/payee` | Done on stub and memory |
| Signed receipts, `/.well-known/redline-attestor.json` | `services/api/src/payee/attestor.ts` | Done. Signed by the API's key, no TEE claim |
| `/v1/vendors/verify`: nep413, eip191, solana-ed25519, merchant identity | `services/api/src/payee/proofs.ts`, `verify-vendor.ts` | Done. NEP-413 checked against a real `near-api-js` signature |
| Proof and seed scripts | `scripts/make-payee-proof.ts`, `scripts/seed-payees.ts` | Done |
| SDK, hosted and direct | `packages/sdk` | Hosted done. Direct runs on the sample registry |
| x402 guard, fake server, swap walkthrough | `packages/x402-guard`, `scripts/demo-x402-swap.ts` | Done. Tested with the real `@x402/fetch` wrapper and `x402Client` hook, using a stand-in payment scheme. Not run against a real facilitator |
| MCP server, HTTP and stdio | `services/mcp` | Done. `server.json` written, not published |
| Agent onboarding | `apps/web/public/llms.txt`, `docs/skills/redline-payee-check/SKILL.md`, root README | Done |

Root `pnpm test` now builds every package first. Root `pnpm dev` builds the API's dependencies first.

### Blocked

- `REDLINE_PAYEE_ENGINE=live` needs `@redline/payee-check` (Lucy). Until then the API refuses to start in this mode.
- `REDLINE_REGISTRY_MODE=near` and direct mode reading NEAR both need `PayeeRegistryClient` (Tharun). Until then near mode refuses to start, and direct mode without a `registry` option reads a built-in sample registry and logs one warning.
- A public API or MCP URL. `llms.txt`, the skill file and `server.json` have no hosted URL to point at, so they use localhost or leave it out.

### Decisions needed from Alexander

- AP2 wording, seed domains and authentication: resolved in the hardening round above.
- **npm scope.** `server.json` names `@redline/mcp`. All packages are `private: true`, and I did not check that the `@redline` scope is available.
- **Repo name.** `server.json` links to the repo, and the URL contains "Hackathon". Consider renaming the repo before publishing.

### Env vars added

In `.env.example` only: `REDLINE_PAYEE_ENGINE`, `REDLINE_REGISTRY_MODE`, `REDLINE_SEED_PAYEES`, `REDLINE_ATTESTOR_KEY`, `REDLINE_FREE_CALLS_PER_DAY`, `REDLINE_TRUST_PROXY`, `REDLINE_X402`, `REDLINE_X402_PAY_TO`, `REDLINE_X402_NETWORK`, `REDLINE_X402_ASSET`, `REDLINE_API_URL`, `MCP_PORT`, `MCP_ALLOWED_HOSTS`.

The API now loads the repo root `.env` at startup. Values already in the shell win.

### Interface notes

**Tharun.** Export `PayeeRegistryClient` from `packages/vault-client`. It gets wrapped as `PayeeRegistry` from `packages/sdk/src/interfaces.ts`, at the marked TODO in `services/api/src/payee/runtime.ts`. What it needs:

- Views: `get_vendor(domain)`, `find_by_account(caip10)` and a way to list every vendor. The engine compares accounts against the whole registry to catch look-alikes when no domain is claimed.
- `attest_vendor({ domain, name, accounts, evidence_hash, issued_at, legal_name })`. Accounts are normalized CAIP-10 strings: lowercase for EVM, as-is for Solana.
- Records shaped like `RegistryVendor`: `verifiedAt` and `issuedAt` as ISO strings, and per account `status` (`active` or `pending`) with `activatesAt`.
- Cooling off belongs in the contract. The memory registry's rules are the reference: first attestation active at once, later accounts pending for 72 hours, unchanged accounts keep their status, accounts missing from a new file are removed at once, an older `issued_at` is refused.
- Reads must work in a browser with no `fs`, because direct mode reads the views from the SDK. If the client imports `fs` at the top level, please split the read path out.

**Lucy.** `@redline/payee-check` gets wrapped as `PayeeEngine` from `packages/sdk/src/interfaces.ts`, at the other TODO in `runtime.ts`, and direct mode runs the same functions.

- Rules and expected results: `packages/sdk/src/stub-engine.ts` and `packages/sdk/test/sdk.test.ts`. Please run those verdict tests against your engine. If we disagree, the brief decides.
- The stub's look-alike rule is simple on purpose: same first and last 4 characters on EVM and Solana; on NEAR, confusable characters, edit distance 2 or less, or containing the vendor's label. Yours should replace it.
- The stub's signals are a fixed table. Real NEAR signals need a `SignalsProvider`: throw, or return nulls with `supported: true`, when they cannot be read, and that becomes `SIGNALS_UNAVAILABLE`.
- `verifyReceipt` signs over `reasons` in order, so keep your reason order deterministic.
- `caseFile` is always null until the investigator agent lands.

**Kristian.** Attack surfaces for the benchmark:

- `POST /v1/check` and `/v1/resolve`, with `pnpm --filter @redline/api start`.
- `withRedline` in `packages/x402-guard`. `createFakeX402Server` from `@redline/x402-guard/fake-server` has honest and malicious modes, and can sign offers with the site's key. Please add attacks in your own folder rather than changing it.
- Known gaps, to save you time: stub look-alike rules miss Unicode and anything beyond the patterns above; the merchant identity signature is not checked; EVM contract wallets (EIP-1271) cannot prove an account; a hijacked website can still start a new account's cooling-off period.

## Done

- Repo scaffold: pnpm workspace, folder READMEs, LICENSE, .gitignore, .env.example.
- docs/CONTEXT.md and docs/OWNERSHIP.md.
- packages/schemas: all shared zod schemas and types, one example per concept, and a test that validates every example.
- services/api: Hono + better-sqlite3 skeleton with all endpoints, mock gateways, and the full POST /intake flow.
- apps/web: rebuilt as Redline, matching apps/web/design/redline-reference.html. Site pages #/, #/vault, #/scoring, #/about, and the dashboard at #/app/overview, invoices, evaluation, controls. Rules in docs/BRAND.md. Still on mock data.
- Product renamed to Redline everywhere in the repo, including package names (`@redline/*`), schema ids (`redline-*-v1`), and the event standard (`redline`). The test token is now Redline Test Dollar (REDL).

## Interfaces I expose

- `@wardline/schemas`: every schema as `XSchema` with type `X`, plus the `AgentRunner`, `DecisionAdapter`, `VaultGateway`, and `EvidenceGateway` interfaces, and `readEnv` / `applyLegacyEnv` for the env var rename.
- API on http://127.0.0.1:8787. See services/api/README.md for the routes.
- Real gateways plug in at one place: `services/api/src/gateways/index.ts`.

## Blockers

## Requests

Older requests below use the names from before the Wardline rename. Current names: see the top section.

- Everyone: main is renamed to Redline. After merging main, run `pnpm install`, and move your imports to `@redline/schemas` and your schema ids to `redline-*-v1`.
- Everyone: the test token is now Redline Test Dollar (REDL), deployed at `redl.redline-labs.testnet` under the new root `redline-labs.testnet`. After merging main, run `pnpm install` and use REDL anywhere you wrote the old symbol.
- Lucy: write the hidden cases in REDL. fixtures/dev and evidence/example-run are already updated and regenerated, so the example suite commitment changed.
- Kristian: the prompt text changed with the symbol, so manifest digests A and B changed. They are updated in docs/status/kristian.md.
- Tharun: the deployment is now under `redline-labs.testnet`. Records are in scripts/contracts/deployments, and the keys are in WSL at `~/.redline/testnet/`.
- Tharun: contract events should use the standard `redline`, matching `RedlineEventSchema`.
- Tharun: please confirm these additions to the vault contract surface, which came out of building the API:
  - `VaultGateway.getBinding`, needed for `expected_binding_revision` and the active agent version.
  - Every `VaultGateway` method takes `vaultId` first, since there is one vault per business.
  - `OperationStatus` values (REQUESTED, RESERVED, SETTLED, FAILED_KNOWN, OUTCOME_UNCERTAIN) and the new `VaultUsage` shape.
  - Is there an unpause? The agreed interface only has `pause`, and the mock clears it on restart.
  - Should a paused vault also block `owner_pay`? The mock allows it. Owner payments also do not count against agent caps in the mock.
  - The API needs a way to list a vault's payables, vendors, POs, and receipts to build `AgentContext`. Today that comes from the mock seed.
  - The dashboard shows account ids, so please deploy under `*.redline.testnet` if you can. Examples and the mock seed already use those names.
  - The attack log on #/vault is scripted copy in apps/web/src/components/Terminal.tsx. Please send the real malicious-signer output when it runs so the page can match it. `KEY NOT PERMITTED` there is not a `VaultRejection`; it stands for the key failing at the NEAR level. Tell me if the real wording differs.
- Kristian: `DecisionAdapter.toPaymentRequest` takes a third argument with the current policy and binding revisions, because `AgentContext` does not carry them.
- Lucy: `EvaluationCase` scores `ai_result` and `vault_result` separately, and `assessment_outcome` is MET_THRESHOLDS, BELOW_THRESHOLDS, or NOT_ASSESSED. Please confirm these fit the Gym.
- Lucy: #/scoring reads metric ids `useful_payments`, `unsafe_proposals`, `vault_containment`, and a new `exceptions_to_human`. It only counts runs that are COMPLETED and assessed, and only shows the suite fingerprint when the on-chain record matches. Until then it shows placeholders of `[ ] of 20`, `[ ] of 20`, `[ ] of 8`. Please use those ids and confirm the real denominators.

## Next

- Connect the API to `NearVaultGateway` on the Wardline root once Tharun redeploys (today's live deployment is `redline-labs.testnet`). The mock seed uses `*.wardline.testnet` names.
- Merge teammates' gateways as they land.
- Add authentication before a real owner key is connected. The API has none today and binds to localhost only.
- Add a UI for submitting a test invoice (POST /intake works, but no view calls it yet).
- Add a vault switcher so the UI can show business B. The API already takes `vault_id`.
- Add unpause to the dashboard if the contract gets one. Today the button locks after pausing and a mock restart clears it.
- Decide how the dashboard labels mock data before submission. The old mock banner is gone, and `data_source` is still in GET /overview.
