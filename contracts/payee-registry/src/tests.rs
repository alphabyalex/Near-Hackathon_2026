use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use near_sdk::Gas;
use near_sdk::NearToken;

const START: u64 = 1_000_000_000_000_000_000;
const COOLDOWN: u64 = 72 * 3600 * 1_000_000_000;

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn context(caller: &str, now: u64) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(account("registry.test"))
        .predecessor_account_id(account(caller))
        .signer_account_id(account(caller))
        .block_timestamp(now)
        .prepaid_gas(Gas::from_tgas(100))
        .account_balance(NearToken::from_near(10));
    builder
}

fn setup_registry() -> PayeeRegistryContract {
    testing_env!(context("deployer.test", START).build());
    PayeeRegistryContract::new(account("attestor.test"), Some(U64(COOLDOWN)))
}

#[test]
fn test_first_attestation_accounts_active_immediately() {
    let mut registry = setup_registry();
    testing_env!(context("attestor.test", START).build());

    let input = AttestVendorInput {
        domain: "northwind.example".to_string(),
        name: "Northwind Trading".to_string(),
        accounts: vec![
            "near:testnet:northwind.testnet".to_string(),
            "eip155:84532:0x036CbD53842c5426634e7929541eC2318f3dCF7e".to_string(),
        ],
        evidence_hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111".to_string(),
        issued_at: "2026-11-07T00:00:00Z".to_string(),
        legal_name: Some("Northwind Trading Inc.".to_string()),
        evidence_tier: Some("T2".to_string()),
    };

    let vendor = registry.attest_vendor(input);
    assert_eq!(vendor.domain, "northwind.example");
    assert_eq!(vendor.accounts.len(), 2);
    assert_eq!(vendor.accounts[0].status, "active");
    assert_eq!(vendor.accounts[0].activates_at, None);
    assert_eq!(vendor.accounts[1].status, "active");
    // EVM address lowercased
    assert_eq!(
        vendor.accounts[1].account,
        "eip155:84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e"
    );
    assert_eq!(vendor.legal_name_source, Some("vendor-claimed".to_string()));

    // Views
    assert_eq!(
        registry.resolve("northwind.example".to_string(), "near".to_string()),
        Some("near:testnet:northwind.testnet".to_string())
    );
    assert_eq!(
        registry.resolve("northwind.example".to_string(), "eip155:84532".to_string()),
        Some("eip155:84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e".to_string())
    );
    assert!(registry.is_verified_payee("near:testnet:northwind.testnet".to_string(), "northwind.example".to_string()));
}

#[test]
#[should_panic(expected = "E_NOT_ATTESTOR")]
fn test_non_attestor_cannot_attest() {
    let mut registry = setup_registry();
    testing_env!(context("someone.test", START).build());

    let input = AttestVendorInput {
        domain: "northwind.example".to_string(),
        name: "Northwind Trading".to_string(),
        accounts: vec!["near:testnet:northwind.testnet".to_string()],
        evidence_hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111".to_string(),
        issued_at: "2026-11-07T00:00:00Z".to_string(),
        legal_name: None,
        evidence_tier: None,
    };
    registry.attest_vendor(input);
}

#[test]
fn test_subsequent_attestation_cooling_off() {
    let mut registry = setup_registry();
    testing_env!(context("attestor.test", START).build());

    // 1. Initial attestation with northwind.testnet
    registry.attest_vendor(AttestVendorInput {
        domain: "northwind.example".to_string(),
        name: "Northwind Trading".to_string(),
        accounts: vec!["near:testnet:northwind.testnet".to_string()],
        evidence_hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111".to_string(),
        issued_at: "2026-11-07T00:00:00Z".to_string(),
        legal_name: None,
        evidence_tier: None,
    });

    // 2. Subsequent attestation adding a new address and base sepolia
    testing_env!(context("attestor.test", START + 1_000).build());
    let updated = registry.attest_vendor(AttestVendorInput {
        domain: "northwind.example".to_string(),
        name: "Northwind Trading".to_string(),
        accounts: vec![
            "near:testnet:northwind.testnet".to_string(),
            "eip155:84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e".to_string(),
        ],
        evidence_hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222".to_string(),
        issued_at: "2026-11-08T00:00:00Z".to_string(),
        legal_name: None,
        evidence_tier: None,
    });

    // First account remains active
    assert_eq!(updated.accounts[0].status, "active");
    // New account is pending
    assert_eq!(updated.accounts[1].status, "pending");
    assert!(updated.accounts[1].activates_at.is_some());

    // Resolve during cooldown returns None for eip155:84532
    testing_env!(context("anyone.test", START + 1_000).build());
    assert_eq!(
        registry.resolve("northwind.example".to_string(), "eip155:84532".to_string()),
        None
    );

    // After cooldown ends (START + 1000 + COOLDOWN + 1)
    testing_env!(context("anyone.test", START + 1_000 + COOLDOWN + 1).build());
    let vendor_after = registry.get_vendor("northwind.example".to_string()).unwrap();
    assert_eq!(vendor_after.accounts[1].status, "active");
    assert_eq!(
        registry.resolve("northwind.example".to_string(), "eip155:84532".to_string()),
        Some("eip155:84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e".to_string())
    );
}

#[test]
fn test_vendor_near_account_self_service_update() {
    let mut registry = setup_registry();
    testing_env!(context("attestor.test", START).build());

    registry.attest_vendor(AttestVendorInput {
        domain: "northwind.example".to_string(),
        name: "Northwind Trading".to_string(),
        accounts: vec!["near:testnet:northwind.testnet".to_string()],
        evidence_hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111".to_string(),
        issued_at: "2026-11-07T00:00:00Z".to_string(),
        legal_name: None,
        evidence_tier: None,
    });

    // Non-vendor cannot propose update
    testing_env!(context("other.testnet", START + 100).build());
    let fail_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut r = setup_registry();
        testing_env!(context("attestor.test", START).build());
        r.attest_vendor(AttestVendorInput {
            domain: "northwind.example".to_string(),
            name: "Northwind Trading".to_string(),
            accounts: vec!["near:testnet:northwind.testnet".to_string()],
            evidence_hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111".to_string(),
            issued_at: "2026-11-07T00:00:00Z".to_string(),
            legal_name: None,
            evidence_tier: None,
        });
        testing_env!(context("other.testnet", START + 100).build());
        r.propose_update(
            "northwind.example".to_string(),
            vec!["near:testnet:other.testnet".to_string()],
            "sha256:3333333333333333333333333333333333333333333333333333333333333333".to_string(),
            "2026-11-08T00:00:00Z".to_string(),
            None,
            None,
        );
    }));
    assert!(fail_result.is_err());

    // Active NEAR account northwind.testnet CAN propose update
    testing_env!(context("northwind.testnet", START + 100).build());
    let res = registry.propose_update(
        "northwind.example".to_string(),
        vec![
            "near:testnet:northwind.testnet".to_string(),
            "near:testnet:northwind-cold.testnet".to_string(),
        ],
        "sha256:3333333333333333333333333333333333333333333333333333333333333333".to_string(),
        "2026-11-08T00:00:00Z".to_string(),
        None,
        None,
    );
    assert_eq!(res.accounts[1].status, "pending");
}

#[test]
fn test_revoke_vendor() {
    let mut registry = setup_registry();
    testing_env!(context("attestor.test", START).build());

    registry.attest_vendor(AttestVendorInput {
        domain: "northwind.example".to_string(),
        name: "Northwind Trading".to_string(),
        accounts: vec!["near:testnet:northwind.testnet".to_string()],
        evidence_hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111".to_string(),
        issued_at: "2026-11-07T00:00:00Z".to_string(),
        legal_name: None,
        evidence_tier: None,
    });

    // Revoke by vendor
    testing_env!(context("northwind.testnet", START + 100).build());
    registry.revoke_vendor("northwind.example".to_string());

    // Now vendor cannot be resolved or viewed
    assert_eq!(registry.get_vendor("northwind.example".to_string()), None);
    assert_eq!(registry.resolve("northwind.example".to_string(), "near".to_string()), None);
    assert!(!registry.is_verified_payee("near:testnet:northwind.testnet".to_string(), "northwind.example".to_string()));
}
