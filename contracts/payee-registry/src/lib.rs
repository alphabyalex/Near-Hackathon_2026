use near_sdk::json_types::U64;
use near_sdk::store::IterableMap;
use near_sdk::{env, near, AccountId, BorshStorageKey, PanicOnDefault};

pub mod events;
pub mod types;

#[cfg(test)]
mod tests;

pub use types::*;

pub const DEFAULT_REGISTRY_COOLDOWN_NS: u64 = 72 * 3600 * 1_000_000_000;
const MAX_PAGE: u32 = 100;

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Vendors,
    AccountToDomain,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PayeeRegistryContract {
    owner: AccountId,
    attestor: AccountId,
    cooldown_ns: u64,
    vendors: IterableMap<String, StoredRegistryVendor>,
    account_to_domain: IterableMap<String, String>,
}

#[near]
impl PayeeRegistryContract {
    #[init]
    pub fn new(attestor: AccountId, cooldown_ns: Option<U64>) -> Self {
        Self {
            owner: env::predecessor_account_id(),
            attestor,
            cooldown_ns: cooldown_ns.map(|c| c.0).unwrap_or(DEFAULT_REGISTRY_COOLDOWN_NS),
            vendors: IterableMap::new(StorageKey::Vendors),
            account_to_domain: IterableMap::new(StorageKey::AccountToDomain),
        }
    }

    /// Attestor registers or updates a vendor listing.
    pub fn attest_vendor(&mut self, input: AttestVendorInput) -> RegistryVendorView {
        let caller = env::predecessor_account_id();
        if caller != self.attestor {
            env::panic_str("E_NOT_ATTESTOR");
        }
        check_domain(&input.domain);
        let now = env::block_timestamp();
        let default_tier = input.evidence_tier.clone().unwrap_or_else(|| "T2".to_string());

        let normalized_accounts: Vec<String> = input
            .accounts
            .iter()
            .map(|a| normalize_caip10(a))
            .collect();

        let existing_opt = self.vendors.get(&input.domain).cloned();
        let is_update = existing_opt.is_some();
        let new_stored_accounts: Vec<StoredRegistryAccount>;

        if let Some(existing_vendor) = existing_opt.as_ref() {
            if existing_vendor.revoked {
                env::panic_str("E_VENDOR_REVOKED");
            }
            if input.issued_at <= existing_vendor.issued_at {
                env::panic_str("E_STALE_ISSUED_AT");
            }

            // Remove domains for accounts no longer present
            for old_acc in &existing_vendor.accounts {
                if !normalized_accounts.contains(&old_acc.account) {
                    self.account_to_domain.remove(&old_acc.account);
                }
            }

            // Keep status for unchanged accounts; set new accounts to pending cooldown
            new_stored_accounts = normalized_accounts
                .iter()
                .map(|acc| {
                    if let Some(prev) = existing_vendor.accounts.iter().find(|o| o.account == *acc) {
                        prev.clone()
                    } else {
                        let activates_at = now.saturating_add(self.cooldown_ns);
                        StoredRegistryAccount {
                            account: acc.clone(),
                            status: "pending".to_string(),
                            activates_at_ns: Some(activates_at),
                            evidence_tier: Some(default_tier.clone()),
                        }
                    }
                })
                .collect();
        } else {
            // First attestation: all accounts active immediately
            new_stored_accounts = normalized_accounts
                .iter()
                .map(|acc| StoredRegistryAccount {
                    account: acc.clone(),
                    status: "active".to_string(),
                    activates_at_ns: None,
                    evidence_tier: Some(default_tier.clone()),
                })
                .collect();
        }

        // Map accounts to domain
        for acc in &new_stored_accounts {
            self.account_to_domain.insert(acc.account.clone(), input.domain.clone());
        }

        let legal_name_source = input.legal_name.as_ref().map(|_| "vendor-claimed".to_string());
        let verified_at_ns = existing_opt
            .as_ref()
            .map(|v| v.verified_at_ns)
            .unwrap_or(now);

        let vendor_record = StoredRegistryVendor {
            domain: input.domain.clone(),
            name: input.name,
            verified_at_ns,
            accounts: new_stored_accounts,
            legal_name: input.legal_name,
            legal_name_source,
            evidence_hash: input.evidence_hash.clone(),
            issued_at: input.issued_at,
            revoked: false,
        };

        let view = stored_vendor_to_view(&vendor_record, now);
        self.vendors.insert(input.domain.clone(), vendor_record);

        if is_update {
            events::payee_updated(&input.domain, normalized_accounts.len(), &input.evidence_hash);
        } else {
            events::payee_attested(&input.domain, normalized_accounts.len(), &input.evidence_hash);
        }

        view
    }

    /// Self-service update: caller must be an active NEAR account of this vendor.
    pub fn propose_update(
        &mut self,
        domain: String,
        accounts: Vec<String>,
        evidence_hash: String,
        issued_at: String,
        legal_name: Option<String>,
        evidence_tier: Option<String>,
    ) -> RegistryVendorView {
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp();
        let vendor = match self.vendors.get(&domain) {
            Some(v) if !v.revoked => v,
            _ => env::panic_str("E_UNKNOWN_VENDOR"),
        };

        // Caller must be an active NEAR account of this vendor
        let is_authorized = vendor.accounts.iter().any(|acc| {
            if is_account_active(acc, now) {
                parse_caip10_near_account(&acc.account).as_ref() == Some(&caller)
            } else {
                false
            }
        });

        if !is_authorized {
            env::panic_str("E_NOT_AUTHORIZED");
        }

        if issued_at <= vendor.issued_at {
            env::panic_str("E_STALE_ISSUED_AT");
        }

        let default_tier = evidence_tier.unwrap_or_else(|| "T2".to_string());
        let normalized_accounts: Vec<String> = accounts.iter().map(|a| normalize_caip10(a)).collect();

        for old_acc in &vendor.accounts {
            if !normalized_accounts.contains(&old_acc.account) {
                self.account_to_domain.remove(&old_acc.account);
            }
        }

        let new_stored_accounts: Vec<StoredRegistryAccount> = normalized_accounts
            .iter()
            .map(|acc| {
                if let Some(prev) = vendor.accounts.iter().find(|o| o.account == *acc) {
                    prev.clone()
                } else {
                    let activates_at = now.saturating_add(self.cooldown_ns);
                    StoredRegistryAccount {
                        account: acc.clone(),
                        status: "pending".to_string(),
                        activates_at_ns: Some(activates_at),
                        evidence_tier: Some(default_tier.clone()),
                    }
                }
            })
            .collect();

        for acc in &new_stored_accounts {
            self.account_to_domain.insert(acc.account.clone(), domain.clone());
        }

        let legal_name_source = legal_name.as_ref().map(|_| "vendor-claimed".to_string());

        let vendor_record = StoredRegistryVendor {
            domain: domain.clone(),
            name: vendor.name.clone(),
            verified_at_ns: vendor.verified_at_ns,
            accounts: new_stored_accounts,
            legal_name,
            legal_name_source,
            evidence_hash: evidence_hash.clone(),
            issued_at,
            revoked: false,
        };

        let view = stored_vendor_to_view(&vendor_record, now);
        self.vendors.insert(domain.clone(), vendor_record);
        events::payee_updated(&domain, normalized_accounts.len(), &evidence_hash);
        view
    }

    /// Revoke a vendor listing: callable by attestor or an active NEAR account of the vendor.
    pub fn revoke_vendor(&mut self, domain: String) {
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp();
        let vendor = match self.vendors.get_mut(&domain) {
            Some(v) if !v.revoked => v,
            _ => env::panic_str("E_UNKNOWN_VENDOR"),
        };

        let is_attestor = caller == self.attestor;
        let is_vendor_near = vendor.accounts.iter().any(|acc| {
            if is_account_active(acc, now) {
                parse_caip10_near_account(&acc.account).as_ref() == Some(&caller)
            } else {
                false
            }
        });

        if !is_attestor && !is_vendor_near {
            env::panic_str("E_NOT_AUTHORIZED");
        }

        vendor.revoked = true;
        for acc in &vendor.accounts {
            self.account_to_domain.remove(&acc.account);
        }

        events::payee_revoked(&domain);
    }

    // ---------- Views ----------

    pub fn get_vendor(&self, domain: String) -> Option<RegistryVendorView> {
        let now = env::block_timestamp();
        self.vendors
            .get(&domain)
            .filter(|v| !v.revoked)
            .map(|v| stored_vendor_to_view(v, now))
    }

    pub fn get_vendor_by_account(&self, caip10: String) -> Option<RegistryVendorView> {
        let normalized = normalize_caip10(&caip10);
        let domain = self.account_to_domain.get(&normalized)?;
        self.get_vendor(domain.clone())
    }

    pub fn list_vendors(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<RegistryVendorView> {
        let now = env::block_timestamp();
        self.vendors
            .iter()
            .filter(|(_, v)| !v.revoked)
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize)
            .map(|(_, v)| stored_vendor_to_view(v, now))
            .collect()
    }

    pub fn resolve(&self, domain: String, chain: String) -> Option<String> {
        let now = env::block_timestamp();
        let vendor = self.vendors.get(&domain).filter(|v| !v.revoked)?;

        for acc in &vendor.accounts {
            if is_account_active(acc, now) && account_matches_chain(&acc.account, &chain) {
                return Some(acc.account.clone());
            }
        }
        None
    }

    pub fn is_verified_payee(&self, account: String, domain: String) -> bool {
        let normalized = normalize_caip10(&account);
        let now = env::block_timestamp();
        let Some(vendor) = self.vendors.get(&domain).filter(|v| !v.revoked) else {
            return false;
        };

        vendor.accounts.iter().any(|acc| {
            acc.account == normalized && is_account_active(acc, now)
        })
    }

    pub fn get_config(&self) -> RegistryConfigView {
        RegistryConfigView {
            owner: self.owner.clone(),
            attestor: self.attestor.clone(),
            cooldown_ns: U64(self.cooldown_ns),
        }
    }
}

// ---------- Helper functions ----------

fn is_account_active(acc: &StoredRegistryAccount, now: u64) -> bool {
    if acc.status == "active" {
        true
    } else if acc.status == "pending" {
        acc.activates_at_ns.map_or(false, |act| now >= act)
    } else {
        false
    }
}

fn stored_vendor_to_view(v: &StoredRegistryVendor, now: u64) -> RegistryVendorView {
    let accounts: Vec<RegistryAccount> = v
        .accounts
        .iter()
        .map(|acc| {
            let (status, activates_at) = if is_account_active(acc, now) {
                ("active".to_string(), None)
            } else {
                ("pending".to_string(), acc.activates_at_ns.map(format_iso_timestamp))
            };
            RegistryAccount {
                account: acc.account.clone(),
                status,
                activates_at,
                evidence_tier: acc.evidence_tier.clone(),
            }
        })
        .collect();

    RegistryVendorView {
        domain: v.domain.clone(),
        name: v.name.clone(),
        verified_at: format_iso_timestamp(v.verified_at_ns),
        accounts,
        legal_name: v.legal_name.clone(),
        legal_name_source: v.legal_name_source.clone(),
        evidence_hash: v.evidence_hash.clone(),
        issued_at: v.issued_at.clone(),
    }
}

pub fn account_matches_chain(account: &str, chain: &str) -> bool {
    if chain == "near" || chain.starts_with("near:") {
        account.starts_with("near:") || (!account.contains(':') && chain == "near")
    } else if let Some(prefix) = chain.strip_prefix("eip155:") {
        account.starts_with(&format!("eip155:{}:", prefix))
    } else if let Some(prefix) = chain.strip_prefix("solana:") {
        account.starts_with(&format!("solana:{}:", prefix))
    } else {
        account.starts_with(&format!("{}:", chain))
    }
}

pub fn normalize_caip10(account: &str) -> String {
    if let Some(rest) = account.strip_prefix("eip155:") {
        let parts: Vec<&str> = rest.split(':').collect();
        if parts.len() == 2 {
            format!("eip155:{}:{}", parts[0], parts[1].to_ascii_lowercase())
        } else {
            account.to_ascii_lowercase()
        }
    } else {
        account.to_string()
    }
}

pub fn parse_caip10_near_account(caip10: &str) -> Option<AccountId> {
    if let Some(rest) = caip10.strip_prefix("near:") {
        let parts: Vec<&str> = rest.split(':').collect();
        if parts.len() == 2 {
            parts[1].parse::<AccountId>().ok()
        } else if parts.len() == 1 {
            parts[0].parse::<AccountId>().ok()
        } else {
            None
        }
    } else {
        caip10.parse::<AccountId>().ok()
    }
}

fn check_domain(domain: &str) {
    if domain.is_empty() || domain.len() > 128 || !domain.contains('.') {
        env::panic_str("E_INVALID_DOMAIN");
    }
}

pub fn format_iso_timestamp(ns: u64) -> String {
    let secs = ns / 1_000_000_000;
    let days = (secs / 86400) as i64;
    let rem_secs = (secs % 86400) as u32;
    let hours = rem_secs / 3600;
    let mins = (rem_secs % 3600) / 60;
    let s = rem_secs % 60;

    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, m, d, hours, mins, s)
}
