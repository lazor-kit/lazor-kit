use anchor_lang::error_code;

#[error_code]
pub enum TransferLimitError {
    MemberNotAdmin,

    InvalidNewPasskey,

    InvalidTokenAccount,

    InvalidToken,

    InvalidBalance,

    InvalidTransferAmount,

    RuleNotInitialized,

    InvalidRuleAccount,

    InvalidAccountInput,

    UnAuthorize,

    InvalidBump,

    MemberNotInitialized,

    TransferAmountExceedLimit,
}
