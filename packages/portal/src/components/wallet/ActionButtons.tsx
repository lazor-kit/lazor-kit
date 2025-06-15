import { Button } from "../ui/button";
import { Loader2 } from "lucide-react";

interface ActionButtonsProps {
  hasCredentials: boolean;
  isLoading: boolean;
  hasMessage: boolean;
  onCreatePasskey: () => void;
  onConnect: () => void;
  onSign: () => void;
}

export function ActionButtons({
  hasCredentials,
  isLoading,
  hasMessage,
  onCreatePasskey,
  onConnect,
  onSign,
}: ActionButtonsProps) {
  if (hasMessage) {
    return (
      <Button 
        onClick={onSign} 
        disabled={isLoading} 
        className="w-full"
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Approve & Sign
      </Button>
    );
  }

  if (!hasCredentials) {
    return (
      <Button
        className="w-full col-span-2"
        onClick={onCreatePasskey}
        disabled={isLoading}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Create Passkey
      </Button>
    );
  }

  return (
    <div className="grid w-full grid-cols-2 gap-2">
      <Button
        onClick={onConnect}
        disabled={isLoading}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Connect
      </Button>
      <Button
        onClick={onSign}
        disabled={isLoading || !hasMessage}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign Message
      </Button>
    </div>
  );
}
