use anchor_lang::prelude::*;

declare_id!("B98ooLRYBP6m6Zsrd3Hnzn4UAejfVZwyDgMFaBNzVR2W");

mod error;
mod instructions;
mod state;

use instructions::*;

#[program]
pub mod default_rule {

    use super::*;

    pub fn initialize(ctx: Context<Initialize>, lazorkit_author: Pubkey) -> Result<()> {
        instructions::initialize(ctx, lazorkit_author)
    }

    pub fn init_rule(ctx: Context<InitRule>) -> Result<()> {
        instructions::init_rule(ctx)
    }

    pub fn check_rule(_ctx: Context<CheckRule>) -> Result<()> {
        instructions::check_rule(_ctx)
    }

    pub fn destroy(ctx: Context<Destroy>) -> Result<()> {
        instructions::destroy(ctx)
    }
}
