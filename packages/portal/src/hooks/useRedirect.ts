interface RedirectParams {
  success: boolean;
  isSignature?: boolean;
  responseData: any;
  messageType: string;
}

export function useRedirect() {
  const handleRedirect = ({
    success,
    isSignature,
    responseData,
    messageType
  }: RedirectParams) => {
    const urlParams = new URLSearchParams(window.location.search);
    const redirectUrl = urlParams.get('redirect_url') || urlParams.get('redirectUrl');
    
    if (!redirectUrl) return null;

    try {
      const resultUrl = new URL(redirectUrl);
      resultUrl.searchParams.set('success', success.toString());
      
      if (isSignature) {
        // For signature, include signature-specific data
        resultUrl.searchParams.set('signature', responseData.data?.normalized || '');
        resultUrl.searchParams.set('msg', responseData.data?.msg || '');
        resultUrl.searchParams.set('message', responseData.originalMessage || '');
        resultUrl.searchParams.set('credentialId', responseData.credentialId || '');
        resultUrl.searchParams.set('clientDataJSONReturn', responseData.data?.clientDataJSONReturn || '');
        resultUrl.searchParams.set('authenticatorDataReturn', responseData.data?.authenticatorDataReturn || '');
      } else {
        // For wallet connection, include wallet data
        resultUrl.searchParams.set('credentialId', responseData.credentialId || '');
        resultUrl.searchParams.set('publicKey', responseData.publickey || '');
      }
      
      resultUrl.searchParams.set('expo', responseData.expo || '');
      resultUrl.searchParams.set('timestamp', responseData.timestamp);
      resultUrl.searchParams.set('environment', responseData?.environment || 'browser');
      resultUrl.searchParams.set('platform', responseData.platform);
      resultUrl.searchParams.set('type', messageType);

      return resultUrl.toString();
    } catch (error) {
      console.error('Error creating redirect URL:', error);
      return null;
    }
  };

  const getAutoCloseDelay = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return parseInt(urlParams.get('auto_close_delay') || '2000');
  };

  return {
    handleRedirect,
    getAutoCloseDelay
  };
}
