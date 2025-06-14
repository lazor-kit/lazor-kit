import { Button } from "../ui/button";
import { AlertTriangle, XCircle } from "lucide-react";
import { PlatformInfo } from "../../types/wallet";

interface PlatformWarningsProps {
  isCustomTabs: boolean;
  webAuthnSupport: { supported: boolean; reason: string };
  platformInfo: PlatformInfo | null;
}

export function PlatformWarnings({ isCustomTabs, webAuthnSupport, platformInfo }: PlatformWarningsProps) {
  const handleOpenInBrowser = (url: string) => {
    try {
      window.open(url, '_blank');
    } catch (error) {
      // Fallback: copy to clipboard
      navigator.clipboard?.writeText(url).then(() => {
        alert('URL copied to clipboard! Please paste in Chrome browser.');
      }).catch(() => {
        alert(`Please copy this URL and open in Chrome browser:\n\n${url}`);
      });
    }
  };

  return (
    <>
      {isCustomTabs && (
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <span className="font-medium">Chrome Custom Tabs Detected</span>
          </div>
          <p className="mt-1 text-sm">For the best experience, open this page in a full browser.</p>
          <div className="mt-2 flex gap-2">
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
        </div>
      )}

      {!webAuthnSupport.supported && !isCustomTabs && (
        <div className="rounded-lg border border-red-100 bg-red-50 p-3">
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-red-600" />
            <span className="font-medium">WebAuthn Not Supported</span>
          </div>
          <p className="mt-1 text-sm">{webAuthnSupport.reason}</p>
          {platformInfo && platformInfo.optimizations.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-medium">Recommendations:</p>
              <ul className="mt-1 list-inside list-disc text-sm">
                {platformInfo.optimizations.slice(0, 3).map((opt, index) => (
                  <li key={index}>{opt}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
