use near_sdk::store::IterableMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

pub mod events;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttestedModelView {
    pub model_id: String,
    pub signing_address: String,
    pub signing_algo: String,
    pub source: String,
    pub attested_at: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderView {
    pub provider_id: String,
    pub pay_to: AccountId,
    pub model_ids: Vec<String>,
}

#[near]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Models,
    Providers,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct ModelRegistryContract {
    pub owner: AccountId,
    pub models: IterableMap<String, AttestedModelView>,
    pub providers: IterableMap<String, ProviderView>,
}

#[near]
impl ModelRegistryContract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        require!(!env::state_exists(), "Already initialized");
        let mut contract = Self {
            owner,
            models: IterableMap::new(StorageKey::Models),
            providers: IterableMap::new(StorageKey::Providers),
        };

        // Seed recorded attestation models
        contract.insert_model(
            "deepseek-ai/DeepSeek-V4.1-Flash-1017",
            "0xfe0071895500a9755c18044948ab4f4e1a7f337e",
            "ecdsa",
            "NEAR AI model attestation report, recorded 2026-11-08",
            "2026-11-08T11:08:11.113Z",
        );
        contract.insert_model(
            "wardline/sim-echo-1",
            "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
            "ecdsa",
            "Local test TEE (simulated, sim mode only)",
            "2026-11-08T00:00:00.000Z",
        );

        contract
    }

    pub fn remove_model(&mut self, model_id: String) {
        self.assert_owner();
        self.models.remove(&model_id);
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "E_NOT_OWNER: only contract owner or DAO can call this"
        );
    }

    fn insert_model(
        &mut self,
        model_id: &str,
        signing_address: &str,
        signing_algo: &str,
        source: &str,
        attested_at: &str,
    ) {
        let view = AttestedModelView {
            model_id: model_id.to_string(),
            signing_address: signing_address.to_lowercase(),
            signing_algo: signing_algo.to_string(),
            source: source.to_string(),
            attested_at: attested_at.to_string(),
        };
        self.models.insert(model_id.to_string(), view);
        events::model_added(model_id, signing_address);
    }

    pub fn is_attested(&self, model_id: String, signer: String) -> bool {
        if let Some(model) = self.models.get(&model_id) {
            model.signing_address.to_lowercase() == signer.to_lowercase()
        } else {
            false
        }
    }

    pub fn list_models(&self) -> Vec<AttestedModelView> {
        self.models.values().cloned().collect()
    }

    pub fn add_model(
        &mut self,
        model_id: String,
        signing_address: String,
        signing_algo: Option<String>,
        source: Option<String>,
    ) {
        self.assert_owner();
        let algo = signing_algo.unwrap_or_else(|| "ecdsa".to_string());
        let src = source.unwrap_or_else(|| "Attestation report".to_string());
        let now_iso = format!("{}ns", env::block_timestamp());
        self.insert_model(&model_id, &signing_address, &algo, &src, &now_iso);
    }

    pub fn add_provider(
        &mut self,
        provider_id: String,
        pay_to: AccountId,
        model_ids: Vec<String>,
    ) {
        self.assert_owner();
        let provider = ProviderView {
            provider_id: provider_id.clone(),
            pay_to: pay_to.clone(),
            model_ids: model_ids.clone(),
        };
        self.providers.insert(provider_id.clone(), provider);
        events::provider_added(&provider_id, pay_to.as_str(), &model_ids);
    }

    pub fn get_provider(&self, provider_id: String) -> Option<ProviderView> {
        self.providers.get(&provider_id).cloned()
    }

    pub fn list_providers(&self) -> Vec<ProviderView> {
        self.providers.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    #[test]
    fn test_seeds_and_is_attested() {
        let owner: AccountId = "owner.testnet".parse().unwrap();
        let context = VMContextBuilder::new().current_account_id("registry.testnet".parse().unwrap()).build();
        testing_env!(context);

        let registry = ModelRegistryContract::new(owner);
        assert!(registry.is_attested(
            "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
            "0xfe0071895500a9755c18044948ab4f4e1a7f337e".to_string(),
        ));
        assert!(registry.is_attested(
            "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
            "0xFE0071895500A9755C18044948AB4F4E1A7F337E".to_string(),
        ));
        assert!(!registry.is_attested(
            "deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string(),
            "0x1111111111111111111111111111111111111111".to_string(),
        ));
        assert_eq!(registry.list_models().len(), 2);
    }

    #[test]
    fn test_add_provider_and_owner_check() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let context = VMContextBuilder::new().current_account_id("registry.testnet".parse().unwrap()).predecessor_account_id(owner.clone()).build();
        testing_env!(context);

        let mut registry = ModelRegistryContract::new(owner.clone());
        registry.add_provider(
            "nearai".to_string(),
            "nearai.testnet".parse().unwrap(),
            vec!["deepseek-ai/DeepSeek-V4.1-Flash-1017".to_string()],
        );

        let provider = registry.get_provider("nearai".to_string()).unwrap();
        assert_eq!(provider.pay_to.as_str(), "nearai.testnet");
        assert_eq!(provider.model_ids, vec!["deepseek-ai/DeepSeek-V4.1-Flash-1017"]);
    }
}
