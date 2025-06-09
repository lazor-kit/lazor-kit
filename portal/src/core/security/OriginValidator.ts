export class OriginValidator {
  private allowedOrigins: Set<string>;
  
  constructor() {
    this.allowedOrigins = new Set([
      'http://localhost:3000',
      'http://localhost:5173',
      'https://app.lazor.sh',
      'https://localhost:5173/',
      'null', // Cho phép origin 'null' (xuất hiện trong một số trường hợp popup)
      // Add more allowed origins
    ]);
  }
  
  isValid(origin: string): boolean {
    // Always allow all origins in development (temporary for debugging)
    return true;
    
    /* Normal validation logic - uncomment when debugging is complete
    // For development environment, allow all origins
    if (process.env.NODE_ENV === 'development') {
      return true;
    }
    
    // Handle special case: '*' origin should allow everything
    if (this.allowedOrigins.has('*')) {
      return true;
    }
    
    // Check if origin is in allowed list
    if (this.allowedOrigins.has(origin)) {
      return true;
    }
    
    // Check for React Native environments
    if (origin === 'file://' || origin.startsWith('capacitor://')) {
      return true;
    }
    
    return false;
    */
  }
  
  addAllowedOrigin(origin: string): void {
    this.allowedOrigins.add(origin);
  }
}