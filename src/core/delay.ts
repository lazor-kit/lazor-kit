// /src/wallet/modules/delay.ts
export const delay = (seconds: number): Promise<void> => {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  };
  