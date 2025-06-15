import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Info, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { StatusMessage } from "../../types/wallet";

interface StatusAlertProps {
  status: StatusMessage;
}

export function StatusAlert({ status }: StatusAlertProps) {
  if (!status.message) return null;

  type AlertType = 'success' | 'error' | 'info' | 'warning';
  type AlertConfig = {
    variant: 'default' | 'destructive';
    icon: typeof CheckCircle2;
    title: string;
  };

  const getAlertConfig = (type: string): AlertConfig => {
    const configs: Record<AlertType, AlertConfig> = {
      success: {
        variant: "default",
        icon: CheckCircle2,
        title: "Success"
      },
      error: {
        variant: "destructive",
        icon: XCircle,
        title: "Error"
      },
      info: {
        variant: "default",
        icon: Info,
        title: "Info"
      },
      warning: {
        variant: "default",
        icon: AlertTriangle,
        title: "Warning"
      }
    };
    
    return configs[type as AlertType] || configs.info;
  };

  const alertConfig = getAlertConfig(status.type);

  const Icon = alertConfig.icon;

  return (
    <Alert variant={alertConfig.variant as any} className="mb-4">
      <Icon className="h-4 w-4" />
      <AlertTitle>{alertConfig.title}</AlertTitle>
      <AlertDescription>{status.message}</AlertDescription>
    </Alert>
  );
}
