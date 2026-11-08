use near_sdk::json_types::U128;
use near_sdk::store::IterableMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

pub mod events;

const SCALE: u128 = 1_000_000;
const ONE_DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolView {
    pub tvl: String,
    pub junior: String,
    pub senior: String,
    pub junior_holder: String,
    pub share_price: String,
    pub senior_shares: String,
    pub fees_earned: String,
    pub claims_paid: String,
    pub coverage_capacity: String,
    pub withdraw_delay_days: u32,
    pub large_claim_threshold: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingWithdrawalView {
    pub id: String,
    pub shares: String,
    pub value: String,
    pub requested_at: String,
    pub available_at: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolPositionView {
    pub account: String,
    pub shares: String,
    pub value: String,
    pub pending_withdrawals: Vec<PendingWithdrawalView>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaimView {
    pub claim_id: String,
    pub subject: String,
    pub claimant: String,
    pub amount: String,
    pub reason: String,
    pub status: String,
    pub paid_from_junior: String,
    pub paid_from_senior: String,
    pub filed_at: String,
    pub tx: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct DepositResultView {
    pub tx: String,
    pub shares: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct WithdrawResultView {
    pub tx: String,
    pub id: String,
    pub available_at: String,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
struct StoredWithdrawal {
    id: String,
    account: AccountId,
    shares: u128,
    requested_at_ns: u64,
}

#[near]
#[derive(BorshStorageKey)]
pub enum StorageKey {
    Positions,
    Withdrawals,
    Claims,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct CoverPoolContract {
    pub owner: AccountId,
    pub token_contract: AccountId,
    pub junior_holder: AccountId,
    pub junior: u128,
    pub senior: u128,
    pub senior_shares: u128,
    pub fees_earned: u128,
    pub claims_paid: u128,
    pub withdraw_delay_days: u32,
    pub large_claim_threshold: u128,
    pub max_claim_bps: u64,
    positions: IterableMap<AccountId, u128>,
    withdrawals: IterableMap<String, StoredWithdrawal>,
    claims: Vec<ClaimView>,
}

#[near]
impl CoverPoolContract {
    #[init]
    pub fn new(
        owner: AccountId,
        token_contract: AccountId,
        junior_holder: AccountId,
        junior: U128,
        withdraw_delay_days: Option<u32>,
        large_claim_threshold: Option<U128>,
        max_claim_bps: Option<u64>,
    ) -> Self {
        require!(!env::state_exists(), "Already initialized");
        Self {
            owner,
            token_contract,
            junior_holder,
            junior: junior.0,
            senior: 0,
            senior_shares: 0,
            fees_earned: 0,
            claims_paid: 0,
            withdraw_delay_days: withdraw_delay_days.unwrap_or(7),
            large_claim_threshold: large_claim_threshold.map(|v| v.0).unwrap_or(1_000_000_000),
            max_claim_bps: max_claim_bps.unwrap_or(1_000),
            positions: IterableMap::new(StorageKey::Positions),
            withdrawals: IterableMap::new(StorageKey::Withdrawals),
            claims: Vec::new(),
        }
    }

    fn price(&self) -> u128 {
        if self.senior_shares == 0 {
            SCALE
        } else {
            (self.senior.saturating_mul(SCALE)) / self.senior_shares
        }
    }

    fn mint(&mut self, account: &AccountId, amount: u128) -> u128 {
        let price = self.price();
        let shares = (amount.saturating_mul(SCALE)) / price;
        self.senior = self.senior.saturating_add(amount);
        self.senior_shares = self.senior_shares.saturating_add(shares);
        let existing = self.positions.get(account).copied().unwrap_or(0);
        self.positions.insert(account.clone(), existing.saturating_add(shares));
        shares
    }

    pub fn get_pool(&self) -> PoolView {
        let tvl = self.junior.saturating_add(self.senior);
        let coverage_capacity = (tvl.saturating_mul(self.max_claim_bps as u128)) / 10_000;

        PoolView {
            tvl: tvl.to_string(),
            junior: self.junior.to_string(),
            senior: self.senior.to_string(),
            junior_holder: self.junior_holder.to_string(),
            share_price: self.price().to_string(),
            senior_shares: self.senior_shares.to_string(),
            fees_earned: self.fees_earned.to_string(),
            claims_paid: self.claims_paid.to_string(),
            coverage_capacity: coverage_capacity.to_string(),
            withdraw_delay_days: self.withdraw_delay_days,
            large_claim_threshold: self.large_claim_threshold.to_string(),
        }
    }

    pub fn get_position(&self, account: AccountId) -> PoolPositionView {
        let shares = self.positions.get(&account).copied().unwrap_or(0);
        let price = self.price();
        let value = (shares.saturating_mul(price)) / SCALE;
        let delay_ns = (self.withdraw_delay_days as u64) * ONE_DAY_NS;

        let pending = self
            .withdrawals
            .values()
            .filter(|w| w.account == account)
            .map(|w| {
                let w_val = (w.shares.saturating_mul(price)) / SCALE;
                PendingWithdrawalView {
                    id: w.id.clone(),
                    shares: w.shares.to_string(),
                    value: w_val.to_string(),
                    requested_at: format!("{}ns", w.requested_at_ns),
                    available_at: format!("{}ns", w.requested_at_ns + delay_ns),
                }
            })
            .collect();

        PoolPositionView {
            account: account.to_string(),
            shares: shares.to_string(),
            value: value.to_string(),
            pending_withdrawals: pending,
        }
    }

    pub fn deposit(&mut self, account: AccountId, amount: U128) -> DepositResultView {
        require!(amount.0 > 0, "Deposit must be positive");
        let shares = self.mint(&account, amount.0);
        let tx = format!("{}:dep:{}", env::current_account_id(), env::block_timestamp());
        events::pool_deposited(account.as_str(), &amount.0.to_string(), &shares.to_string());
        DepositResultView {
            tx,
            shares: shares.to_string(),
        }
    }

    pub fn request_withdraw(&mut self, account: AccountId, shares: U128) -> WithdrawResultView {
        require!(shares.0 > 0, "Shares must be positive");
        let held = self.positions.get(&account).copied().unwrap_or(0);
        let queued: u128 = self
            .withdrawals
            .values()
            .filter(|w| w.account == account)
            .map(|w| w.shares)
            .sum();

        require!(
            shares.0 <= held.saturating_sub(queued),
            "Not enough shares to withdraw"
        );

        let now_ns = env::block_timestamp();
        let delay_ns = (self.withdraw_delay_days as u64) * ONE_DAY_NS;
        let id = format!("wd_{}_{}", account, now_ns);

        self.withdrawals.insert(
            id.clone(),
            StoredWithdrawal {
                id: id.clone(),
                account: account.clone(),
                shares: shares.0,
                requested_at_ns: now_ns,
            },
        );

        let avail_str = format!("{}ns", now_ns + delay_ns);
        let tx = format!("{}:wd:{}", env::current_account_id(), now_ns);
        events::pool_withdraw_requested(account.as_str(), &id, &shares.0.to_string(), &avail_str);

        WithdrawResultView {
            tx,
            id,
            available_at: avail_str,
        }
    }

    pub fn list_claims(&self) -> Vec<ClaimView> {
        let mut claims = self.claims.clone();
        claims.reverse();
        claims
    }

    pub fn file_claim(
        &mut self,
        subject: String,
        claimant: AccountId,
        amount: U128,
        reason: String,
    ) -> ClaimView {
        let amt = amount.0;
        let claim_id = format!("clm_{}_{}", subject, self.claims.len() + 1);
        let pool = self.get_pool();
        let capacity: u128 = pool.coverage_capacity.parse().unwrap_or(0);

        let (status, from_junior, from_senior, tx) = if amt <= self.large_claim_threshold
            && amt <= capacity
        {
            let from_j = amt.min(self.junior);
            let from_s = amt - from_j;
            self.junior = self.junior.saturating_sub(from_j);
            self.senior = self.senior.saturating_sub(from_s);
            self.claims_paid = self.claims_paid.saturating_add(amt);
            (
                "paid".to_string(),
                from_j,
                from_s,
                Some(format!("{}:clm:{}", env::current_account_id(), claim_id)),
            )
        } else {
            ("pending_vote".to_string(), 0, 0, None)
        };

        let view = ClaimView {
            claim_id: claim_id.clone(),
            subject,
            claimant: claimant.to_string(),
            amount: amt.to_string(),
            reason,
            status: status.clone(),
            paid_from_junior: from_junior.to_string(),
            paid_from_senior: from_senior.to_string(),
            filed_at: format!("{}ns", env::block_timestamp()),
            tx,
        };

        self.claims.push(view.clone());
        events::claim_filed(&claim_id, claimant.as_str(), &amt.to_string(), &status);
        view
    }

    pub fn approve_claim(&mut self, claim_id: String) {
        require!(
            env::predecessor_account_id() == self.owner,
            "E_NOT_OWNER: only DAO can approve claims"
        );
        let claim = self
            .claims
            .iter_mut()
            .find(|c| c.claim_id == claim_id)
            .expect("Claim not found");
        require!(claim.status == "pending_vote", "Claim is not pending vote");

        let amt: u128 = claim.amount.parse().expect("Invalid amount");
        let from_j = amt.min(self.junior);
        let from_s = amt - from_j;
        self.junior = self.junior.saturating_sub(from_j);
        self.senior = self.senior.saturating_sub(from_s);
        self.claims_paid = self.claims_paid.saturating_add(amt);

        claim.status = "paid".to_string();
        claim.paid_from_junior = from_j.to_string();
        claim.paid_from_senior = from_s.to_string();
        claim.tx = Some(format!("{}:clm:{}", env::current_account_id(), claim_id));

        events::claim_approved(&claim_id, &from_j.to_string(), &from_s.to_string());
    }

    pub fn set_param(&mut self, name: String, value: String) {
        require!(
            env::predecessor_account_id() == self.owner,
            "E_NOT_OWNER: only DAO can update pool parameters"
        );
        match name.as_str() {
            "large_claim_threshold" => {
                self.large_claim_threshold = value.parse().expect("Invalid u128");
            }
            "withdraw_delay_days" => {
                self.withdraw_delay_days = value.parse().expect("Invalid u32");
            }
            "max_claim_bps" => {
                self.max_claim_bps = value.parse().expect("Invalid u64");
            }
            _ => env::panic_str("Unknown parameter"),
        }
        events::param_set(&name, &value);
    }

    pub fn add_fees(&mut self, amount: U128) {
        self.fees_earned = self.fees_earned.saturating_add(amount.0);
        self.senior = self.senior.saturating_add(amount.0);
        events::fees_added(&amount.0.to_string(), &self.fees_earned.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    #[test]
    fn test_pool_deposit_shares_and_junior_first_loss() {
        let owner: AccountId = "dao.testnet".parse().unwrap();
        let junior_holder: AccountId = "wardline.testnet".parse().unwrap();
        let context = VMContextBuilder::new()
            .current_account_id("pool.testnet".parse().unwrap())
            .predecessor_account_id(owner.clone())
            .build();
        testing_env!(context);

        let mut pool = CoverPoolContract::new(
            owner.clone(),
            "token.testnet".parse().unwrap(),
            junior_holder.clone(),
            U128(5_000_000_000), // 5,000 WUSD junior
            Some(7),
            Some(U128(1_000_000_000)), // 1,000 WUSD large threshold
            Some(1_000), // 10%
        );

        let lp1: AccountId = "lp1.testnet".parse().unwrap();
        let dep = pool.deposit(lp1.clone(), U128(10_000_000_000));
        assert_eq!(dep.shares, "10000000000");

        let p = pool.get_pool();
        assert_eq!(p.tvl, "15000000000"); // 15,000 WUSD
        assert_eq!(p.coverage_capacity, "1500000000"); // 10% = 1,500 WUSD

        // Small claim (under threshold) automatically paid junior first!
        let claim = pool.file_claim(
            "call_test".to_string(),
            lp1.clone(),
            U128(500_000_000), // 500 WUSD
            "wrong output".to_string(),
        );
        assert_eq!(claim.status, "paid");
        assert_eq!(claim.paid_from_junior, "500000000");
        assert_eq!(claim.paid_from_senior, "0");

        let p_after = pool.get_pool();
        assert_eq!(p_after.junior, "4500000000"); // junior absorbed 100% of loss
        assert_eq!(p_after.senior, "10000000000"); // senior untouched!
    }
}
