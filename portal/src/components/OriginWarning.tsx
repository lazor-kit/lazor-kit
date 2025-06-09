interface OriginWarningProps {
  origin?: string;
}

export default function OriginWarning({ origin }: OriginWarningProps) {
  if (!origin) return null;
  
  const url = new URL(origin);
  const isSecure = url.protocol === 'https:';
  const isLocalhost = url.hostname === 'localhost';
  
  if (isSecure || isLocalhost) return null;
  
  return (
    <div className="card alert-card">
      <div className="warning-content">
        <h3 className="warning-title">Insecure Connection</h3>
        <p className="warning-description">This request is from an insecure origin. Your data may not be protected.</p>
        <div className="origin-display">{origin}</div>
      </div>
    </div>
  );
}