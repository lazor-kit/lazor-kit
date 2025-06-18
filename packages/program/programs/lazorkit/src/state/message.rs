use anchor_lang::prelude::*;

#[derive(Default, AnchorSerialize, AnchorDeserialize, Debug)]
pub struct Message {
    pub nonce: u64,
    pub timestamp: i64,
}
