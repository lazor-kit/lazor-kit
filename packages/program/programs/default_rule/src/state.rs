use anchor_lang::prelude::*;

#[account]
#[derive(Debug, InitSpace)]
pub struct Rule {
    pub smart_wallet: Pubkey,
    pub admin: Pubkey,
    pub is_initialized: bool,
}
