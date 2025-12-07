import { useState } from "react";
import { Credential, getStoredCredentials, saveCredential } from "../utils/storage";
import { signUp, authenticateWithPasskey, signMessage } from "../utils/webauthn";
import { StatusMessage } from "../types/wallet";
import { useRedirect } from "./useRedirect";
import { useWindowManager } from "./useWindowManager";

export function useWalletActions() {
  const [status, setStatus] = useState<StatusMessage>({ message: "", type: "" });
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const { handleRedirect, getAutoCloseDelay } = useRedirect();
  const { autoClose } = useWindowManager();

  const handleMessage = (message: string, type: string) => {
    displayStatus(message, type);
  };

  const displayStatus = (message: string, type: string) => setStatus({ message, type });

  const handleSuccess = async (responseData: any, successMessage: string) => {
    try {
      if (responseData?.credential) {
        await saveCredential(responseData.credentialId, responseData.publicKey);
        const updatedCreds = await getStoredCredentials();
        setCredentials(updatedCreds);
      }
      
      displayStatus(successMessage, "success");
      
      const redirectUrl = handleRedirect({
        success: true,
        isSignature: responseData.type === "SIGNATURE_CREATED",
        responseData,
        messageType: responseData.type === "SIGNATURE_CREATED" ? "SIGNATURE_CREATED" : "WALLET_CONNECTED"
      });

      if (redirectUrl) {
        setTimeout(() => {
          window.location.href = redirectUrl;
        }, Math.min(getAutoCloseDelay(), 3000));
        return;
      }

      // Send data to parent/opener
      const messageData = {
        type: responseData.type === "SIGNATURE_CREATED" ? "SIGNATURE_CREATED" : "WALLET_CONNECTED",
        data: responseData.type === "SIGNATURE_CREATED" ? responseData.data : responseData
      };

      if (responseData.environment === 'expo' && window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(messageData));
      } else if (window.opener && window.opener !== window) {
        window.opener.postMessage(messageData, "*");
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(messageData, "*");
      }

      autoClose(responseData.environment, getAutoCloseDelay());
      
    } catch (error) {
      console.error("Success handler error:", error);
      displayStatus("Error saving credentials", "error");
    }
  };

  const handleError = (errorMessage: string, error?: any, isSignatureError = false) => {
    console.error("Operation failed:", error);
    displayStatus(errorMessage, "error");

    const errorResponse = {
      type: "error",
      error: errorMessage,
      details: error?.message || ""
    };

    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(errorResponse));
    }

    if (isSignatureError && window.opener) {
      window.opener.postMessage(errorResponse, "*");
      setTimeout(() => window.close(), getAutoCloseDelay());
    }
  };

  const handleCreatePasskey = async () => {
    setIsLoading(true);
    try {
      const response = await signUp(handleMessage);
      await handleSuccess(response, "Passkey created successfully!");
    } catch (error: any) {
      handleError("Failed to create passkey", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSign = async (message: string) => {
    setIsLoading(true);
    try {
      const cred = credentials[0];
      const data = await signMessage(cred.credentialId, message, handleMessage);
      await handleSuccess(data, "Message signed successfully!");
    } catch (error: any) {
      handleError("Failed to sign message", error, true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUniversalConnect = async (environment: string, expoParam?: string) => {
    try {
      setIsLoading(true);
      displayStatus(`Connecting via ${environment}...`, "loading");
      
      const authData = await authenticateWithPasskey(handleMessage);
      
      const responseData = {
        ...authData,
        expo: expoParam || null,
        timestamp: new Date().toISOString(),
        connectionType: 'universal',
        environment,
        platform: environment === 'expo' ? 'mobile' : 'web'
      };

      handleSuccess(responseData, `Connected successfully via ${environment}!`);
      
    } catch (err) {
      handleError(`Failed to authenticate via ${environment}`, err, false);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    status,
    credentials,
    isLoading,
    displayStatus,
    handleCreatePasskey,
    handleSign,
    handleUniversalConnect
  };
}
