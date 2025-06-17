import { Button } from "../ui/button";
import { Loader2 } from "lucide-react";

interface ActionButtonsProps {
  hasCredentials: boolean;
  isLoading: boolean;
  hasMessage: boolean;
  onSign: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
}

export function ActionButtons({
  hasCredentials,
  isLoading,
  hasMessage,
  onSign,
  onSignIn,
  onSignUp,
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
    // No credentials exist, show both Sign In and Sign Up options
    return (
      <div className="grid w-full grid-cols-2 gap-2">
        <Button
          onClick={onSignIn}
          disabled={isLoading}
          variant="default"
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign In
        </Button>
        <Button
          onClick={onSignUp}
          disabled={isLoading}
          variant="secondary"
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign Up
        </Button>
      </div>
    );
  } else {
    // Credentials exist, show Sign In instead of Connect
    return (
      <div className="grid w-full grid-cols-2 gap-2">
        <Button
          onClick={onSignIn}
          disabled={isLoading}
        >
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Sign In
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
}
