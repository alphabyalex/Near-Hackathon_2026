from __future__ import annotations

import json
from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise SystemExit(f"expected {label} source was not found")
    return source.replace(old, new, 1)


vault = Path("contracts/vault/src/lib.rs")
source = vault.read_text()
if "&& payable.operation_id.is_some()" in source:
    source = source.replace(
        "&& payable.operation_id.is_some()",
        "&& let Some(operation_id) = payable.operation_id",
        1,
    )
    source = replace_once(
        source,
        'payable.operation_id.expect("checked operation id").0',
        "operation_id.0",
        "operation id unwrap",
    )
if "#[ext_contract(ext_ft)]\ntrait ExtFungibleToken" in source:
    source = source.replace(
        "#[ext_contract(ext_ft)]\ntrait ExtFungibleToken",
        "#[ext_contract(ext_ft)]\n#[allow(dead_code)]\ntrait ExtFungibleToken",
        1,
    )
if "        _msg: String,\n    ) -> PromiseOrValue<U128> {\n" in source:
    source = source.replace(
        "        _msg: String,\n    ) -> PromiseOrValue<U128> {\n",
        "        msg: String,\n    ) -> PromiseOrValue<U128> {\n        let _ = msg;\n",
        1,
    )
vault.write_text(source)

package_path = Path("tests/sandbox/package.json")
package = json.loads(package_path.read_text())
dependencies = package.setdefault("dependencies", {})
dependencies["near-api-js"] = "5.1.1"
dependencies["near-sandbox"] = "0.3.5"
package["dependencies"] = dict(sorted(dependencies.items()))
package_path.write_text(json.dumps(package, indent=2) + "\n")

helper = Path("tests/sandbox/helpers.mjs")
source = helper.read_text()
workspace_import = 'import { KeyPair, Worker, captureError, parseNEAR } from "near-workspaces";'
if 'from "near-sandbox"' not in source:
    source = replace_once(
        source,
        workspace_import,
        "\n".join(
            [
                'import { keyStores } from "near-api-js";',
                'import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from "near-sandbox";',
                workspace_import,
            ]
        ),
        "sandbox imports",
    )
old_setup = "\n".join(
    [
        "export async function setupSandbox(options = {}) {",
        "  const worker = await Worker.init();",
        "  const root = worker.rootAccount;",
    ]
)
new_setup = "\n".join(
    [
        "export async function setupSandbox(options = {}) {",
        "  const sandbox = await Sandbox.start({});",
        "  let worker;",
        "  try {",
        "    const keyStore = new keyStores.InMemoryKeyStore();",
        '    await keyStore.setKey("custom", DEFAULT_ACCOUNT_ID, KeyPair.fromString(DEFAULT_PRIVATE_KEY));',
        "    worker = await Worker.init({",
        '      network: "custom",',
        "      rpcAddr: sandbox.rpcUrl,",
        "      rootAccountId: DEFAULT_ACCOUNT_ID,",
        "      keyStore,",
        '      initialBalance: BigInt(parseNEAR("200")),',
        "    });",
        "    const root = worker.rootAccount;",
    ]
)
if old_setup in source:
    source = source.replace(old_setup, new_setup, 1)
old_tail = "\n".join(
    [
        "    async tearDown() {",
        "      await worker.tearDown();",
        "    },",
        "  };",
        "  return fixture;",
        "}",
    ]
)
new_tail = "\n".join(
    [
        "    async tearDown() {",
        "      await worker.tearDown();",
        "      await sandbox.tearDown();",
        "    },",
        "  };",
        "    return fixture;",
        "  } catch (error) {",
        "    try { await worker?.tearDown(); } catch {}",
        "    try { await sandbox.tearDown(); } catch {}",
        "    throw error;",
        "  }",
        "}",
    ]
)
if old_tail in source:
    source = source.replace(old_tail, new_tail, 1)
helper.write_text(source)

security = Path("tests/sandbox/vault-security.test.mjs")
source = security.read_text()
if "operationBeforeForged" not in source:
    start_marker = "\n".join(
        [
            "    const forged = await captureFailure(() =>",
            '      outsider.call(vaultA, "on_payment_result", { operation_id: 1 }, { gas: DEFAULT_GAS }));',
        ]
    )
    start = source.index(start_marker)
    end = source.index('\n\n    await root.call(vaultA, "pause", {});', start)
    replacement = "\n".join(
        [
            '    const operationBeforeForged = await vaultA.view("get_operation", { operation_id: 1 });',
            '    const usageBeforeForged = await vaultA.view("get_usage", {});',
            "    const forged = await captureFailure(() =>",
            '      outsider.call(vaultA, "on_payment_result", { operation_id: 1 }, { gas: DEFAULT_GAS }));',
            '    assert.ok(forged.length > 0, "forged private callback must fail");',
            '    const operationAfterForged = await vaultA.view("get_operation", { operation_id: 1 });',
            '    const usageAfterForged = await vaultA.view("get_usage", {});',
            "    assert.deepEqual(operationAfterForged, operationBeforeForged);",
            "    assert.deepEqual(usageAfterForged, usageBeforeForged);",
        ]
    )
    source = source[:start] + replacement + source[end:]
security.write_text(source)

ci = Path(".github/workflows/crypto-ci.yml")
source = ci.read_text()
if "security scenarios in isolated processes" not in source:
    candidate_names = [
        "      - name: Run NEAR sandbox security tests",
        "      - name: Run NEAR sandbox security and parity tests",
    ]
    starts = [source.find(name) for name in candidate_names]
    starts = [position for position in starts if position >= 0]
    if not starts:
        raise SystemExit("security CI step start was not found")
    start = min(starts)
    scan_marker = "\n\n      - name: Scan authored source"
    end = source.index(scan_marker, start)
    new_block = "\n".join(
        [
            "      - name: Run NEAR sandbox security scenarios in isolated processes",
            "        env:",
            '          NEAR_WORKSPACES_DEBUG: "true"',
            "        run: |",
            "          patterns=(",
            '            "authorization, key, proxy, revocation, and tenant boundaries"',
            '            "payable lifecycle, stale revisions, vendor cap, and replay behavior"',
            '            "weekly and lifetime exact boundaries reject the next atomic unit"',
            '            "token failure releases once, owner escalation bypasses caps, callbacks stay private"',
            '            "concurrent requests preserve a single paid lock and last-budget containment"',
            '            "rolling capacity expires after the seven-day window in sandbox time"',
            "          )",
            '          for pattern in "${patterns[@]}"; do',
            '            timeout --signal=TERM --kill-after=30s 10m pnpm --filter @spendgym/sandbox-tests exec node --test --test-concurrency=1 --test-name-pattern="$pattern" vault-security.test.mjs',
            "          done",
        ]
    )
    source = source[:start] + new_block + source[end:]
source = source.replace("timeout-minutes: 45", "timeout-minutes: 90", 1)
source = source.replace("timeout-minutes: 75", "timeout-minutes: 90", 1)
if "cache: pnpm" not in source:
    source = source.replace(
        '          node-version: "22.22.2"\n',
        '          node-version: "22.22.2"\n          cache: pnpm\n',
        1,
    )
source = source.replace(
    "Install TypeScript and sandbox dependencies",
    "Install frozen dependencies",
)
ci.write_text(source)

for diagnostic in [
    Path("scripts/contracts/clippy-diagnostics.txt"),
    Path("scripts/contracts/clippy-fix-report.txt"),
]:
    diagnostic.unlink(missing_ok=True)
