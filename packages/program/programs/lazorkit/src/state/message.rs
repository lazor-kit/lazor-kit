use anchor_lang::prelude::*;

#[derive(Default, AnchorSerialize, AnchorDeserialize, Debug)]
pub struct Message {
    pub nonce: u64,
    pub current_slot: i64,
    pub instruction_data: Vec<u8>,
}
