use anchor_lang::prelude::*;

#[account]
#[derive(Default, InitSpace)]
pub struct Config {
    pub create_smart_wallet_fee: u64,
    pub default_rule_program: Pubkey,
    pub authority_bump: u8,
}

impl Config {
    pub const PREFIX_SEED: &'static [u8] = b"config";
}
