"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "../components/ui/card"
import { Credential, getStoredCredentials, saveCredential } from "../utils/storage"
import { createPasskey, authenticateWithPasskey, signMessage } from "../utils/webauthn"
import { detectPlatform, applyPlatformOptimizations, PlatformInfo } from "../utils/platform-detector"
import { quickPlatformTest } from "../utils/platform-tester"
import { useRedirect } from '../hooks/useRedirect'
import { useWindowManager } from '../hooks/useWindowManager'
import { 
  StatusAlert, 
  PlatformWarnings, 
  CredentialList, 
  ActionButtons, 
  LoadingState 
} from "../components/wallet"
import { StatusMessage } from "../types/wallet"
import { isIframe, requestCredentialsFromParent, setupCredentialSyncHandler } from "../utils/credentialSync"

// Using StatusMessage from types/wallet instead of local Status interface

export default function WalletAction() {
  const [status, setStatus] = useState<StatusMessage>({ message: '', type: 'info' })
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [, setAction] = useState("")
  const [, setExpo] = useState("")
  const [, setReadyToSign] = useState(false)
  const [, setEnvironment] = useState<"browser" | "expo" | "unknown">("unknown")
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null)
  const { handleRedirect, getAutoCloseDelay } = useRedirect()
  const { autoClose } = useWindowManager()

  // Initialize platform detection and optimizations
  useEffect(() => {
    const initializePlatform = async () => {
      try {
        console.log('🔄 Initializing platform detection...')
        
        // Detect and optimize for current platform
        const platform = detectPlatform()
        setPlatformInfo(platform)
        
        // Apply platform-specific optimizations
        applyPlatformOptimizations(platform)
        
        console.log(`✅ Platform initialized: ${platform.type} (${platform.browser})`)
        console.log('🎯 Applied optimizations:', platform.optimizations)
        
        // Run quick platform test in background for debugging
        if (window.location.hostname === 'localhost' || window.location.hostname.includes('dev')) {
          quickPlatformTest().catch(console.error)
        }
        
      } catch (error) {
        console.error('❌ Platform initialization failed:', error)
      }
    }
    
    initializePlatform()
  }, [])
// Legacy environment detection for backward compatibility
const detectEnvironment = (): "browser" | "expo" | "unknown" => {
  if (typeof window !== "undefined") {
    if (window.navigator.userAgent.includes("Expo")) {
      return "expo"
    }
    if (window.ReactNativeWebView) {
      return "expo"
    }
    if (window.expo || window.__expo) {
      return "expo"
    }
    
    // Additional checks for Expo
    if (window.location.protocol === "file:" || 
        window.navigator.userAgent.includes("expo") ||
        window.navigator.userAgent.includes("ExponentJS")) {
      return "expo"
    }
    
    return "browser"
  }
  
  return "unknown"
}
  // Load stored credentials on mount with iframe support
  const loadCredentials = useCallback(async () => {
    try {
      let storedCreds = await getStoredCredentials()
      
      // If in iframe and no local credentials, try to get from parent
      if (isIframe() && storedCreds.length === 0) {
        displayStatus('Requesting credentials from parent window...', 'info')
        const parentCredential = await requestCredentialsFromParent()
        if (parentCredential) {
          storedCreds = [parentCredential]
          await saveCredential(parentCredential.credentialId, parentCredential.publicKey)
          displayStatus('Credentials synchronized from parent', 'success')
        }
      }
      
      setCredentials(storedCreds)
      console.log('🔑 Loaded stored credentials:', storedCreds.length)
    } catch (error) {
      console.error('❌ Failed to load credentials:', error)
      displayStatus('Failed to load credentials', 'error')
    }
  }, [])

  // Set up credential sync handler for parent window
  useEffect(() => {
    if (typeof window === 'undefined') return
    
    // Only set up the handler in the parent window
    if (!isIframe()) {
      return setupCredentialSyncHandler(() => credentials)
    }
  }, [credentials])
  
  // Initial credential load
  useEffect(() => {
    loadCredentials()
  }, [loadCredentials])

  // Handle URL params on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const messageParam = urlParams.get('message') || ''
    const autoConnect = urlParams.get('auto_connect')
    const autoSign = urlParams.get('auto_sign')
    const actionParam = urlParams.get('action') || ''
    const expoParam = urlParams.get('expo') || ''
    const stored = getStoredCredentials()

    // Set state from URL params
    setMessage(messageParam)
    setAction(actionParam)
    setExpo(expoParam)
    
    // Detect environment if not explicitly set
    const detectedEnv = detectEnvironment()
    setEnvironment(detectedEnv)

    // Handle actions based on URL parameters
    const handleAction = async () => {
      try {
        if (actionParam === 'connect' || autoConnect === 'true') {
          setCredentials(stored)
          if (stored.length > 0) {
            displayStatus(`Connecting with existing Passkey...`, 'loading')
            await handleUniversalConnect(detectedEnv, expoParam || undefined)
          } else {
            displayStatus('No Passkey found. Please create one.', 'info')
          }
        } else if ((actionParam === 'sign' || autoSign === 'true') && messageParam) {
          // For sign action: check if iframe or standalone
          if (isIframe()) {
            // Iframe: wait for credentials from parent
            displayStatus('Waiting for wallet credentials from parent...', 'info')
          } else {
            // Standalone/popup/expo: use stored credentials immediately
            setCredentials(stored)
            if (stored.length > 0) {
              setReadyToSign(true)
              displayStatus('Ready to sign. Click approve.', 'info')
            } else {
              handleError('No stored credentials found for signing', undefined, true)
            }
          }
        } else {
          displayStatus('Error: Invalid action or missing message', 'error')
        }
      } catch (error) {
        console.error('Error handling action:', error)
        handleError('Failed to process action', error, false)
      }
    }
    
    handleAction()
  }, [])

  // Create a displayStatus function to pass to WebAuthn functions
  const displayStatus = (message: string, type: string) => {
    setStatus({ 
      message, 
      type: type === 'loading' ? 'info' : type as StatusMessage['type']
    })
  }

  // Handle success response
  const handleSuccess = async (responseData: any, successMessage: string) => {
    try {
      if (responseData?.credential) {
        await saveCredential(responseData.credentialId, responseData.publicKey)
        const updatedCreds = await getStoredCredentials()
        setCredentials(updatedCreds)
      }
      
      setStatus({ message: successMessage, type: 'success' })
      
      const redirectUrl = handleRedirect({
        success: true,
        isSignature: responseData.type === 'SIGNATURE_CREATED',
        responseData,
        messageType: responseData.type === 'SIGNATURE_CREATED' ? 'SIGNATURE_CREATED' : 'WALLET_CONNECTED'
      })

      // Send data to parent/opener
      const messageData = {
        type: responseData.type === 'SIGNATURE_CREATED' ? 'SIGNATURE_CREATED' : 'WALLET_CONNECTED',
        data: responseData.type === 'SIGNATURE_CREATED' ? responseData.data : responseData
      }

      // In iframe, send message to parent
      if (isIframe()) {
        window.parent.postMessage(messageData, '*')
        return
      }

      // In Expo WebView
      if (responseData.environment === 'expo' && window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify(messageData))
        return
      }

      // In popup window
      if (window.opener && window.opener !== window) {
        window.opener.postMessage(messageData, '*')
      }

      // Handle redirect or auto-close
      if (redirectUrl) {
        setTimeout(() => {
          window.location.href = redirectUrl
        }, Math.min(getAutoCloseDelay(), 3000))
      } else {
        autoClose(responseData.environment || 'browser', getAutoCloseDelay())
      }
      
    } catch (error) {
      console.error('Success handler error:', error)
      setStatus({ message: 'Error saving credentials', type: 'error' })
    }
  }

  // Handle error response
  const handleError = (errorMessage: string, error?: any, isSignatureError = false) => {
    console.error('Operation failed:', error)
    setStatus({ message: errorMessage, type: 'error' })

    const errorResponse = {
      type: 'error',
      error: errorMessage,
      details: error?.message || ''
    }

    // In iframe
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(errorResponse, '*')
      return
    }

    // In Expo WebView
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(errorResponse))
      return
    }

    // In popup window
    if (window.opener && window.opener !== window) {
      window.opener.postMessage(errorResponse, '*')
      if (isSignatureError) {
        autoClose('browser', getAutoCloseDelay())
      }
    }
  }

  // Handle universal connect action
  const handleUniversalConnect = async (environment: string = 'browser', expoParam?: string) => {
    try {
      setIsLoading(true)
      setStatus({ message: `Connecting via ${environment}...`, type: 'info' })
      
      const authData = await authenticateWithPasskey(displayStatus)
      
      const responseData = {
        ...authData,
        expo: expoParam || null,
        timestamp: new Date().toISOString(),
        connectionType: 'universal',
        environment,
        platform: environment === 'expo' ? 'mobile' : 'web'
      }

      await handleSuccess(responseData, `Connected successfully via ${environment}!`)
      
    } catch (err) {
      handleError(`Failed to authenticate via ${environment}`, err, false)
    } finally {
      setIsLoading(false)
    }
  }

  // Handle sign message action
  const handleSign = async () => {
    if (!message) return
    if (!credentials.length) {
      setStatus({ message: 'No credentials found. Please create a passkey first.', type: 'error' })
      return
    }

    setIsLoading(true)
    try {
      const cred = credentials[0]
      const signatureData = await signMessage(cred.credentialId, message, displayStatus)
      
      const responseData = {
        data: signatureData,
        credentialId: cred.credentialId,
        originalMessage: message,
        timestamp: new Date().toISOString(),
        type: 'SIGNATURE_CREATED'
      }

      await handleSuccess(responseData, 'Message signed successfully!')
    } catch (error: any) {
      handleError('Failed to sign message', error, true)
    } finally {
      setIsLoading(false)
    }
  }

  // Handle create passkey action
  const handleCreatePasskey = async () => {
    setIsLoading(true)
    setStatus({ message: 'Creating passkey...', type: 'info' })

    try {
      const credential = await createPasskey(displayStatus)
      await saveCredential(credential.credentialId, credential.publickey)
      const updatedCreds = await getStoredCredentials()
      setCredentials(updatedCreds)
      setStatus({ message: 'Passkey created successfully', type: 'success' })

    } catch (error) {
      console.error('❌ Create passkey error:', error)
      setStatus({ 
        message: error instanceof Error ? error.message : 'Failed to create passkey', 
        type: 'error' 
      })
    }

    setIsLoading(false)
  }

  const isCustomTabsOpen = () => {
    return platformInfo?.type === 'android' && platformInfo.browser === 'chrome'
  }

  const checkWebAuthnSupport = () => {
    return typeof window !== 'undefined' && !!window.PublicKeyCredential
  }

  // Render loading state
  if (isLoading) {
    return <LoadingState message={status.message || "Processing..."} />
  }

  // Render credential management UI
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 space-y-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Wallet Actions</span>
            {credentials.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {credentials.length} Passkey{credentials.length !== 1 ? 's' : ''}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            Manage your wallet credentials and perform actions
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <StatusAlert status={status} />
          
          <PlatformWarnings 
            isCustomTabs={isCustomTabsOpen()} 
            webAuthnSupport={{
              supported: checkWebAuthnSupport(),
              reason: "Your browser does not support WebAuthn. Please use a modern browser that supports passkeys."
            }}
            platformInfo={platformInfo}
          />

          <CredentialList credentials={credentials} />
        </CardContent>

        <CardFooter className="flex flex-col space-y-2">
          <ActionButtons 
            hasCredentials={credentials.length > 0}
            isLoading={isLoading}
            hasMessage={!!message}
            onCreatePasskey={handleCreatePasskey}
            onConnect={() => handleUniversalConnect()}
            onSign={handleSign}
          />
        </CardFooter>
      </Card>
    </div>
  )
}
