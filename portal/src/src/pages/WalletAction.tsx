"use client"

import { useState, useEffect } from "react"
import { Button } from "../components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert"
import { Badge } from "../components/ui/badge"
import { Loader2, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, Info } from "lucide-react"
import { Credential, getStoredCredentials, saveCredential } from "../utils/storage"
import { createPasskey, authenticateWithPasskey, signMessage } from "../utils/webauthn"
import { detectPlatform, applyPlatformOptimizations, PlatformInfo } from "../utils/platform-detector"
import { quickPlatformTest } from "../utils/platform-tester"
import { useRedirect } from '../hooks/useRedirect'
import { useWindowManager } from '../hooks/useWindowManager'

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void
    }
    expo?: any
    __expo?: any
    chrome?: {
      runtime?: any
    }
    PublicKeyCredential?: any
  }
}

interface Status {
  message: string
  type: 'error' | 'success' | 'info' | 'warning'
}

export default function WalletAction() {
  const [status, setStatus] = useState<Status>({ message: '', type: 'info' })
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [credentials, setCredentials] = useState<Credential[]>([])
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

  // Load stored credentials on mount
  useEffect(() => {
    const loadCredentials = async () => {
      try {
        const storedCreds = await getStoredCredentials()
        setCredentials(storedCreds)
        console.log('🔑 Loaded stored credentials:', storedCreds.length)
      } catch (error) {
        console.error('❌ Failed to load credentials:', error)
      }
    }
    loadCredentials()
  }, [])

  // Handle URL params on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const messageParam = urlParams.get('message')
    const autoConnect = urlParams.get('auto_connect')
    const autoSign = urlParams.get('auto_sign')
    const action = urlParams.get('action')
    const environment = urlParams.get('environment') || 'browser'
    const expo = urlParams.get('expo')

    if (messageParam) setMessage(messageParam)

    // Handle actions based on URL parameters
    if (action === 'connect' || autoConnect === 'true') {
      handleUniversalConnect(environment, expo || undefined)
    } else if (action === 'sign' && messageParam) {
      handleSign()
    } else if (autoSign === 'true' && messageParam) {
      handleSign()
    }
  }, [])

  // Create a displayStatus function to pass to WebAuthn functions
  const displayStatus = (message: string, type: string) => {
    setStatus({ 
      message, 
      type: type === 'loading' ? 'info' : type as Status['type']
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
      if (window.parent && window.parent !== window) {
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
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4 space-y-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center space-y-4">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <p className="text-lg font-medium text-center">
                {status.message || "Processing..."}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Render credential management UI
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 space-y-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Wallet Actions</span>
            {credentials.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {credentials.length} Passkey{credentials.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Manage your wallet credentials and perform actions
          </CardDescription>
        </CardHeader>

        <CardContent>
          {/* Status Messages */}
          {status.message && (
            <div className="mb-4">
              <Alert
                variant={status.type === 'error' ? 'destructive' : 'default'}
              >
                <div className="flex items-center gap-2">
                  {status.type === 'error' && <XCircle className="h-5 w-5" />}
                  {status.type === 'success' && <CheckCircle2 className="h-5 w-5" />}
                  {status.type === 'info' && <Info className="h-5 w-5" />}
                  {status.type === 'warning' && <AlertTriangle className="h-5 w-5" />}
                  <AlertTitle>{status.type.charAt(0).toUpperCase() + status.type.slice(1)}</AlertTitle>
                </div>
                <AlertDescription>{status.message}</AlertDescription>
              </Alert>
            </div>
          )}

          {/* Platform Warnings */}
          {isCustomTabsOpen() && (
            <div className="mb-4">
              <Alert variant="destructive">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  <AlertTitle>Chrome Custom Tabs Detected</AlertTitle>
                </div>
                <AlertDescription>
                  For the best experience, open this page in a full browser.
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-xs"
                      onClick={() => window.open('https://passkeys-demo.appspot.com/home', '_blank')}
                    >
                      Try Passkeys Demo
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => window.open(window.location.href + '&open_in_browser=true', '_blank')}
                    >
                      Open in Browser
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            </div>
          )}

          {!checkWebAuthnSupport() && (
            <div className="mb-4">
              <Alert variant="destructive">
                <div className="flex items-center gap-2">
                  <XCircle className="h-5 w-5" />
                  <AlertTitle>WebAuthn Not Supported</AlertTitle>
                </div>
                <AlertDescription>
                  Your browser does not support WebAuthn. Please use a modern browser that supports passkeys.
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Credentials List */}
          {credentials.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Your Passkeys</h3>
              <div className="space-y-2">
                {credentials.map((cred) => (
                  <div
                    key={cred.credentialId}
                    className="p-2 border rounded-lg"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <ShieldCheck className="w-4 h-4 text-green-500" />
                        <span className="text-sm font-medium">
                          Passkey {credentials.indexOf(cred) + 1}
                        </span>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        Active
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col space-y-2">
          <div className="grid w-full grid-cols-2 gap-2">
            {credentials.length === 0 ? (
              <Button
                className="w-full col-span-2"
                onClick={handleCreatePasskey}
                disabled={isLoading}
              >
                Create Passkey
              </Button>
            ) : (
              <>
                <Button
                  onClick={() => handleUniversalConnect()}
                  disabled={isLoading}
                >
                  Connect
                </Button>
                <Button
                  onClick={handleSign}
                  disabled={isLoading || !message}
                >
                  Sign Message
                </Button>
              </>
            )}
          </div>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {message && (
            <Button onClick={handleSign} disabled={isLoading} className="w-full">
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Approve & Sign
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}
