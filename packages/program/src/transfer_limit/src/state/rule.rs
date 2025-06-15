use anchor_lang::prelude::*;

#[account]
#[derive(Default, InitSpace)]
pub struct RuleData {
    pub token: Option<Pubkey>,
    pub limit_amount: u64,
    pub bump: u8,
    pub is_initialized: bool,
}

impl RuleData {
    pub const PREFIX_SEED: &'static [u8] = b"rule_data";
}
