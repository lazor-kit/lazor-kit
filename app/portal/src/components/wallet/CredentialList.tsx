import { Shield } from "lucide-react";
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
    return (
      <div className="text-center text-muted-foreground py-4">
        <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No passkeys found</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Your Passkeys</h4>
      <div className="space-y-2">
        {credentials.map((cred, ) => (
          <div
            key={cred.credentialId}
            className="flex items-center gap-2 p-2 border rounded"
          >
            <Shield className="h-4 w-4" />
            <span className="text-sm font-mono">{cred.credentialId.slice(0, 8)}...</span>
            <Badge variant="outline" className="text-xs ml-auto">
              Active
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
