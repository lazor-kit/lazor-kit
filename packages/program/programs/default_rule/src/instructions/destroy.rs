use crate::error::RuleError;
use crate::state::Rule;
use crate::ID;
use anchor_lang::prelude::*;

pub fn destroy(_ctx: Context<Destroy>) -> Result<()> {
    Ok(())
}

#[derive(Accounts)]
pub struct Destroy<'info> {
    /// CHECK
    pub smart_wallet: UncheckedAccount<'info>,
    /// CHECK
    pub smart_wallet_authenticator: Signer<'info>,
    #[account(
        mut,
        owner = ID,
        constraint = smart_wallet_authenticator.key() == rule.admin @ RuleError::UnAuthorize,
        constraint = rule.smart_wallet == smart_wallet.key() @ RuleError::UnAuthorize,
        close = smart_wallet
    )]
    pub rule: Account<'info, Rule>,
}
