use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::borsh::BorshSerialize;
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::{
    AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue, env, log, near, require,
};

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    FungibleToken,
    Metadata,
}

#[derive(PanicOnDefault)]
#[near(contract_state)]
pub struct SpendGymTestDollar {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
}

#[near]
impl SpendGymTestDollar {
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128) -> Self {
        require!(!env::state_exists(), "already initialized");
        require!(total_supply.0 > 0, "total supply must be positive");
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Spend Gym Test Dollar".to_string(),
            symbol: "sgUSD".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        };
        metadata.assert_valid();
        let mut contract = Self {
            token: FungibleToken::new(StorageKey::FungibleToken),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
        };
        contract.token.internal_register_account(&owner_id);
        contract.token.internal_deposit(&owner_id, total_supply.0);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &owner_id,
            amount: total_supply,
            memo: Some("initial mock test supply"),
        }
        .emit();
        contract
    }
}

#[near]
impl FungibleTokenCore for SpendGymTestDollar {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for SpendGymTestDollar {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            log!(
                "Account @{} burned {} mock tokens",
                sender_id,
                burned_amount
            );
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for SpendGymTestDollar {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            log!("Closed @{} with {} mock token balance", account_id, balance);
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for SpendGymTestDollar {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().expect("metadata must exist")
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn account(value: &str) -> AccountId {
        value.parse().expect("valid test account")
    }

    #[test]
    fn fixed_metadata_and_supply() {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(account("sgusd.testnet"))
            .predecessor_account_id(account("owner.testnet"))
            .signer_account_id(account("owner.testnet"));
        testing_env!(builder.build());
        let contract = SpendGymTestDollar::new(account("owner.testnet"), U128(1_000_000));
        let metadata = contract.ft_metadata();
        assert_eq!(metadata.name, "Spend Gym Test Dollar");
        assert_eq!(metadata.symbol, "sgUSD");
        assert_eq!(metadata.decimals, 6);
        assert_eq!(contract.ft_total_supply(), U128(1_000_000));
        assert_eq!(
            contract.ft_balance_of(account("owner.testnet")),
            U128(1_000_000)
        );
    }
}
