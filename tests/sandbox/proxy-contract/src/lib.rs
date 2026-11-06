use near_sdk::json_types::U64;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{ext_contract, near, AccountId, Gas, PanicOnDefault, Promise};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PaymentRequest {
    pub payable_ref: String,
    pub request_digest: String,
    pub expected_policy_revision: u64,
    pub expected_vendor_revision: u64,
    pub expected_binding_revision: u64,
}

#[ext_contract(ext_vault)]
trait ExtVault {
    fn request_payment(&mut self, request: PaymentRequest);
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct TestProxy {
    sequence: u64,
}

#[near]
impl TestProxy {
    #[init]
    pub fn new() -> Self {
        Self { sequence: 0 }
    }

    pub fn forward_request(&mut self, vault_id: AccountId, request: PaymentRequest) -> Promise {
        self.sequence = self.sequence.checked_add(1).expect("sequence overflow");
        ext_vault::ext(vault_id)
            .with_static_gas(Gas::from_tgas(100))
            .request_payment(request)
    }

    pub fn get_sequence(&self) -> U64 {
        U64(self.sequence)
    }
}
