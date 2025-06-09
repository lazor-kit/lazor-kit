import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

export function useQueryParams() {
  const location = useLocation();
  
  const params = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    
    return {
      action: searchParams.get('action'),
      origin: searchParams.get('origin'),
      requestId: searchParams.get('requestId'),
      message: searchParams.get('message'),
      description: searchParams.get('description'),
      autoConnect: searchParams.get('autoConnect'),
      theme: searchParams.get('theme') || 'light',
      lang: searchParams.get('lang') || 'en'
    };
  }, [location.search]);
  
  return params;
}