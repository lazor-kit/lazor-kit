"use client"

import { Alert, AlertDescription } from "../ui/alert"
import { AlertTriangle, CheckCircle, Info } from "lucide-react"
import type { StatusMessage } from "../../types/wallet"

export function StatusAlert({ status }: { status: StatusMessage }) {
  const getIcon = () => {
    switch (status.type) {
      case "success":
        return <CheckCircle className="h-4 w-4" />
      case "error":
        return <AlertTriangle className="h-4 w-4" />
      case "warning":
        return <AlertTriangle className="h-4 w-4" />
      default:
        return <Info className="h-4 w-4" />
    }
  }

  if (!status.message) return null

  return (
    <Alert
      variant={status.type === "error" ? "destructive" : "default"}
      className="mb-4"
    >
      {getIcon()}
      <AlertDescription>{status.message}</AlertDescription>
    </Alert>
  )
}
