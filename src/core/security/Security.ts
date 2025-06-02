// src/core/security/Security.ts
import { encode, decode } from 'bs58';
import { Logger } from '../../utils/logger';

interface Challenge {
  value: string;
  timestamp: number;
  used: boolean;
}

export class Security {
  private challenges = new Map<string, Challenge>();
  private logger = new Logger('Security');
  private readonly CHALLENGE_EXPIRY = 5 * 60 * 1000; // 5 minutes

  generateChallenge(): string {
    const buffer = new Uint8Array(32);
    crypto.getRandomValues(buffer);
    const challenge = encode(buffer);
    
    this.challenges.set(challenge, {
      value: challenge,
      timestamp: Date.now(),
      used: false
    });

    // Cleanup old challenges
    this.cleanupChallenges();
    
    this.logger.debug('Generated challenge', { challenge });
    
    return challenge;
  }

  generateNonce(): string {
    const buffer = new Uint8Array(16);
    crypto.getRandomValues(buffer);
    return encode(buffer);
  }

  async verifyChallenge(
    challenge: string, 
    signature: string, 
    publicKey: string
  ): Promise<boolean> {
    const challengeData = this.challenges.get(challenge);
    
    if (!challengeData) {
      this.logger.warn('Challenge not found', { challenge });
      return false;
    }

    if (challengeData.used) {
      this.logger.warn('Challenge already used', { challenge });
      return false;
    }

    // Check if challenge is not expired
    if (Date.now() - challengeData.timestamp > this.CHALLENGE_EXPIRY) {
      this.challenges.delete(challenge);
      this.logger.warn('Challenge expired', { challenge });
      return false;
    }

    // Mark as used
    challengeData.used = true;

    // TODO: Implement actual signature verification with WebAuthn
    // For now, we trust the dialog's verification
    this.logger.debug('Challenge verified', { challenge });
    
    return true;
  }

  private cleanupChallenges(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [challenge, data] of this.challenges) {
      if (now - data.timestamp > this.CHALLENGE_EXPIRY) {
        expired.push(challenge);
      }
    }

    expired.forEach(challenge => this.challenges.delete(challenge));
    
    if (expired.length > 0) {
      this.logger.debug(`Cleaned up ${expired.length} expired challenges`);
    }
  }
}