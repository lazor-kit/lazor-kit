use anchor_lang::prelude::*;

declare_id!("7H16pVKG2stkkhQ6H9LyXvnHLpXjfB7LLShGjXhYmEWs");

mod error;
mod instructions;
mod state;

use instructions::*;

#[program]
pub mod default_rule {

    use super::*;

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
