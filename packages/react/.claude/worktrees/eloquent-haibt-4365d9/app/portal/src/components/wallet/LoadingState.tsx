import { Loader2 } from "lucide-react";
import { Card, CardContent } from "../ui/card";

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "Processing..." }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 space-y-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-lg font-medium text-center">
              {message}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
