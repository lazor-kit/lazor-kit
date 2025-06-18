use anchor_lang::prelude::*;
use anchor_lang::system_program::ID as SYSTEM_ID;
use anchor_spl::token::ID as SPL_TOKEN;
use lazorkit::{
    constants::SOL_TRANSFER_DISCRIMINATOR, program::Lazorkit, state::SmartWalletAuthenticator,
};

use crate::{
    errors::TransferLimitError,
    state::{Member, MemberType, RuleData},
    ID,
};

pub fn check_rule(
    ctx: Context<CheckRule>,
    _token: Option<Pubkey>,
    cpi_data: Vec<u8>,
    program_id: Pubkey,
) -> Result<()> {
    let member = &ctx.accounts.member;
    let rule_data = &ctx.accounts.rule_data;

    // Admins can bypass the transfer limit check
    if member.member_type == MemberType::Admin {
        return Ok(());
    }

    require!(
        member.is_initialized,
        TransferLimitError::MemberNotInitialized
    );
    require!(rule_data.is_initialized, TransferLimitError::UnAuthorize);

    let amount = if program_id == SYSTEM_ID {
        if let Some(discriminator) = cpi_data.get(0..4) {
            if discriminator == SOL_TRANSFER_DISCRIMINATOR {
                u64::from_le_bytes(cpi_data[4..12].try_into().unwrap())
            } else {
                return Err(TransferLimitError::UnAuthorize.into());
            }
        } else {
            return Err(TransferLimitError::UnAuthorize.into());
        }
    } else if program_id == SPL_TOKEN {
        // Handle SPL token transfer instruction (transfer: instruction 3)
        if let Some(&instruction_index) = cpi_data.get(0) {
            if instruction_index == 3 {
                // This is a Transfer instruction
                if cpi_data.len() >= 9 {
                    u64::from_le_bytes(cpi_data[1..9].try_into().unwrap())
                } else {
                    return Err(TransferLimitError::UnAuthorize.into());
                }
            } else {
                return Err(TransferLimitError::UnAuthorize.into());
            }
        } else {
            return Err(TransferLimitError::UnAuthorize.into());
        }
    } else {
        return Err(TransferLimitError::UnAuthorize.into());
    };

    if amount > rule_data.limit_amount {
        return Err(TransferLimitError::TransferAmountExceedLimit.into());
    }

    Ok(())
}

#[derive(Accounts)]
#[instruction(token: Option<Pubkey>)]
pub struct CheckRule<'info> {
    #[account(
        owner = lazorkit.key(),
        signer,
    )]
    pub smart_wallet_authenticator: Account<'info, SmartWalletAuthenticator>,

    #[account(
        seeds = [Member::PREFIX_SEED, smart_wallet_authenticator.smart_wallet.key().as_ref(), smart_wallet_authenticator.key().as_ref()],
        bump,
        owner = ID,
    )]
    pub member: Account<'info, Member>,

    #[account(
        seeds = [RuleData::PREFIX_SEED, smart_wallet_authenticator.smart_wallet.key().as_ref(), token.as_ref().unwrap_or(&Pubkey::default()).as_ref()],
        bump,
        owner = ID,
    )]
    pub rule_data: Box<Account<'info, RuleData>>,

    pub lazorkit: Program<'info, Lazorkit>,
}
