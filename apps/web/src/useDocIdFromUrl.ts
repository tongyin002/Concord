import { useCallback, useEffect, useState } from 'react';

/**
 * Hook to sync the selected doc ID with the URL.
 * - Parses doc ID from URL path like /doc/:id
 * - Updates URL when doc selection changes
 * - Handles browser back/forward navigation
 */
export function useDocIdFromUrl() {
  const [docId, setDocId] = useState<string | null>(() => {
    // Parse initial doc ID from URL like /doc/abc123
    const match = window.location.pathname.match(/^\/doc\/(.+)$/);
    return match ? match[1] : null;
  });

  // Listen for browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const match = window.location.pathname.match(/^\/doc\/(.+)$/);
      setDocId(match ? match[1] : null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Update URL when docId changes
  const setDocIdWithUrl = useCallback((id: string | null) => {
    const newPath = id ? `/doc/${id}` : '/';
    if (window.location.pathname !== newPath) {
      window.history.pushState(null, '', newPath);
    }
    setDocId(id);
  }, []);

  return [docId, setDocIdWithUrl] as const;
}

