use anchor_lang::prelude::*;

/// Account that stores whitelisted rule program addresses
#[account]
#[derive(Debug, InitSpace)]
pub struct WhitelistRulePrograms {
    /// List of whitelisted program addresses
    #[max_len(10)]
    pub list: Vec<Pubkey>,
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl WhitelistRulePrograms {
    pub const PREFIX_SEED: &'static [u8] = b"whitelist_rule_programs";
}
