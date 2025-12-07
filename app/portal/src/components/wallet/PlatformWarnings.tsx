"use client"

import { Button } from "../ui/button"
import { Alert, AlertDescription } from "../ui/alert"
import { Badge } from "../ui/badge"
import { AlertTriangle, XCircle , Monitor, Smartphone, Globe } from "lucide-react"
import type { PlatformInfo, WebAuthnSupport } from "../../types/wallet"

interface PlatformWarningsProps {
  isCustomTabs: boolean
  webAuthnSupport: WebAuthnSupport 
  platformInfo: PlatformInfo | null
}

export function PlatformWarnings({ 
  isCustomTabs, 
  webAuthnSupport, 
  platformInfo 
}: PlatformWarningsProps) {
  const handleOpenInBrowser = (url: string) => {
    try {
      window.open(url, '_blank')
    } catch (error) {
      // Fallback: copy to clipboard
      navigator.clipboard?.writeText(url).then(() => {
        alert('URL copied to clipboard! Please paste in Chrome browser.')
      }).catch(() => {
        alert(`Please copy this URL and open in Chrome browser:\n\n${url}`)
      })
    }
  }

  const getPlatformIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'mobile':
      case 'android':
      case 'ios':
        return <Smartphone className="h-4 w-4" />
      case 'desktop':
      case 'windows':
      case 'macos':
      case 'linux':
        return <Monitor className="h-4 w-4" />
      default:
        return <Globe className="h-4 w-4" />
    }
  }

  return (
    <div className="space-y-4">
      {/* Platform Information Display */}
      {platformInfo && (
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex items-center gap-1">
            {getPlatformIcon(platformInfo.type)}
            {/* <Badge variant="outline">{platformInfo.type}</Badge> */}
          </div>
          <Badge variant="outline">{platformInfo.browser}</Badge>
          {/* {platformInfo.browser && (
            <Badge variant="secondary" className="text-xs">
              {platformInfo.browser}
            </Badge>
          )} */}
          {isCustomTabs && (
            <Badge variant="destructive" className="text-xs">
              Custom Tabs
            </Badge>
          )}
          {webAuthnSupport.supported && (
            <Badge variant="default" className="text-xs bg-green-500 text-white">
              WebAuthn Ready
            </Badge>
          )}
        </div>
      )}

      {/* Warnings and Alerts */}
      {isCustomTabs && (
        <Alert variant="default">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Chrome Custom Tabs detected. For the best experience, open this page in a full browser.
          </AlertDescription>
          <div className="mt-3 flex gap-2">
            <Button 
              size="sm" 
              variant="secondary" 
              className="text-xs"
              onClick={() => handleOpenInBrowser('https://passkeys-demo.appspot.com/home')}
            >
              Try Passkeys Demo
            </Button>
            <Button 
              size="sm" 
              variant="outline" 
              className="text-xs"
              onClick={() => handleOpenInBrowser(window.location.href + '&open_in_browser=true')}
            >
              Open in Browser
            </Button>
          </div>
        </Alert>
      )}

      {!webAuthnSupport.supported && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{webAuthnSupport.reason}</AlertDescription>
          {platformInfo && platformInfo.optimizations.length > 0 && (
            <div className="mt-3">
              <p className="text-sm font-medium">Recommendations:</p>
              <ul className="mt-1 list-inside list-disc text-sm space-y-1">
                {platformInfo.optimizations.slice(0, 3).map((opt, index) => (
                  <li key={index}>{opt}</li>
                ))}
              </ul>
            </div>
          )}
        </Alert>
      )}

      {/* Platform Capabilities Info */}
      {/* {platformInfo && webAuthnSupport.supported && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-2">
              <div>
                <strong>Platform:</strong> {platformInfo.type} • {platformInfo.browser}
                {platformInfo.browser && ` v${platformInfo.browser}`}
              </div>
              
              {platformInfo.optimizations.length > 0 && (
                <div>
                  <strong>Optimizations:</strong>
                  <ul className="mt-1 list-inside list-disc text-sm">
                    {platformInfo.optimizations.map((opt, index) => (
                      <li key={index}>{opt}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )} */}
    </div>
  )
}
