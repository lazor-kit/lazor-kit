import { ShieldCheck } from "lucide-react";
import { Badge } from "../ui/badge";

interface Credential {
  credentialId: string;
  publicKey: string;
}

interface CredentialListProps {
  credentials: Credential[];
}

export function CredentialList({ credentials }: CredentialListProps) {
  if (credentials.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Your Passkeys</h3>
      <div className="space-y-2">
        {credentials.map((cred, index) => (
          <div
            key={cred.credentialId}
            className="p-2 border rounded-lg"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium">
                  Passkey {index + 1}
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
  );
}
