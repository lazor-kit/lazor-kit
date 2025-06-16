use crate::state::Rule;
use anchor_lang::prelude::*;
use lazorkit::program::Lazorkit;

pub fn init_rule(ctx: Context<InitRule>) -> Result<()> {
    let rule = &mut ctx.accounts.rule;

    rule.smart_wallet = ctx.accounts.smart_wallet.key();
    rule.admin = ctx.accounts.smart_wallet_authenticator.key();
    rule.is_initialized = true;

    Ok(())
}

#[derive(Accounts)]
pub struct InitRule<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK:
    pub smart_wallet: UncheckedAccount<'info>,

    /// CHECK
    pub smart_wallet_authenticator: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + Rule::INIT_SPACE,
        seeds = [b"rule".as_ref(), smart_wallet.key().as_ref()],
        bump,
    )]
    pub rule: Account<'info, Rule>,

    pub lazorkit: Program<'info, Lazorkit>,

    pub system_program: Program<'info, System>,
}
