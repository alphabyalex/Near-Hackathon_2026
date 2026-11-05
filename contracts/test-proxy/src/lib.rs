//! Test only, never deployed with a vault in production. Forwards any call so tests can make
//! the vault see a predecessor that differs from the signer.

use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, Gas, NearToken, Promise};

#[near(contract_state)]
#[derive(Default)]
pub struct TestProxy {}

#[near]
impl TestProxy {
    /// Calls `receiver.method(args_json)` and returns its result. Forwards any attached deposit
    /// unless `deposit_yocto` is given.
    #[payable]
    pub fn forward(
        &mut self,
        receiver: AccountId,
        method: String,
        args_json: String,
        gas_tgas: u64,
        deposit_yocto: Option<U128>,
    ) -> Promise {
        let deposit = deposit_yocto
            .map(|d| NearToken::from_yoctonear(d.0))
            .unwrap_or_else(env::attached_deposit);
        Promise::new(receiver).function_call(
            method,
            args_json.into_bytes(),
            deposit,
            Gas::from_tgas(gas_tgas),
        )
    }
}
