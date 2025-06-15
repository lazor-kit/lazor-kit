use anchor_lang::error_code;

/// Custom errors for the Lazor Kit program
#[error_code]
pub enum LazorKitError {
    /// Authentication errors
    #[msg("Invalid passkey provided")]
    InvalidPasskey,
    #[msg("Invalid authenticator for smart wallet")]
    InvalidAuthenticator,
    #[msg("Invalid rule program for operation")]
    InvalidRuleProgram,
    /// Secp256r1 verification errors
    #[msg("Invalid instruction length for signature verification")]
    InvalidLengthForVerification,
    #[msg("Signature header verification failed")]
    VerifyHeaderMismatchError,
    #[msg("Signature data verification failed")]
    VerifyDataMismatchError,
    /// Account validation errors
    #[msg("Invalid bump seed provided")]
    InvalidBump,
    #[msg("Invalid or missing required account")]
    InvalidAccountInput,

    InsufficientFunds,

    #[msg("Invalid rule instruction provided")]
    InvalidRuleInstruction,
}
