use near_sdk::json_types::U64;
use near_sdk::near;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegistryAccount {
    pub account: String,
    pub status: String,
    #[serde(rename = "activatesAt", alias = "activates_at")]
    pub activates_at: Option<String>,
    #[serde(rename = "evidenceTier", alias = "evidence_tier")]
    pub evidence_tier: Option<String>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct StoredRegistryAccount {
    pub account: String,
    pub status: String,
    pub activates_at_ns: Option<u64>,
    pub evidence_tier: Option<String>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct StoredRegistryVendor {
    pub domain: String,
    pub name: String,
    pub verified_at_ns: u64,
    pub accounts: Vec<StoredRegistryAccount>,
    pub legal_name: Option<String>,
    pub legal_name_source: Option<String>,
    pub evidence_hash: String,
    pub issued_at: String,
    pub revoked: bool,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegistryVendorView {
    pub domain: String,
    pub name: String,
    #[serde(rename = "verifiedAt", alias = "verified_at")]
    pub verified_at: String,
    pub accounts: Vec<RegistryAccount>,
    #[serde(rename = "legalName", alias = "legal_name")]
    pub legal_name: Option<String>,
    #[serde(rename = "legalNameSource", alias = "legal_name_source")]
    pub legal_name_source: Option<String>,
    #[serde(rename = "evidenceHash", alias = "evidence_hash")]
    pub evidence_hash: String,
    #[serde(rename = "issuedAt", alias = "issued_at")]
    pub issued_at: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct AttestVendorInput {
    pub domain: String,
    pub name: String,
    pub accounts: Vec<String>,
    #[serde(rename = "evidenceHash", alias = "evidence_hash")]
    pub evidence_hash: String,
    #[serde(rename = "issuedAt", alias = "issued_at")]
    pub issued_at: String,
    #[serde(rename = "legalName", alias = "legal_name")]
    pub legal_name: Option<String>,
    #[serde(rename = "evidenceTier", alias = "evidence_tier")]
    pub evidence_tier: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct RegistryConfigView {
    pub owner: near_sdk::AccountId,
    pub attestor: near_sdk::AccountId,
    pub cooldown_ns: U64,
}
