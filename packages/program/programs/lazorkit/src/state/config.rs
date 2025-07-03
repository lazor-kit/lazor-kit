use anchor_lang::prelude::*;

#[account]
#[derive(Default, InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub create_smart_wallet_fee: u64,
    pub execute_instruction_fee: u64,
}

impl Config {
    pub const PREFIX_SEED: &'static [u8] = b"config";
}
