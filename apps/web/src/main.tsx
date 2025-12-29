import { authClient } from 'lib/auth-client';
import { Zero, zeroBaseOptions, ZeroProvider } from 'lib/zero-client';
import { useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import HomePage from './Home';

const App = () => {
  const { data, isPending, error } = authClient.useSession();

  const zero = useMemo(() => {
    if (!data) return null;

    const userID = data.session.userId;
    return new Zero({
      ...zeroBaseOptions,
      userID,
      context: {
        userID,
      },
    });
  }, [data?.user]);

  const onSignIn = useCallback(() => {
    authClient.signIn.social({
      provider: 'github',
      callbackURL: 'http://localhost:5173',
    });
  }, []);

  const onSignOut = useCallback(() => {
    authClient.signOut();
  }, []);

  if (zero) {
    return (
      <ZeroProvider zero={zero}>
        <HomePage />
      </ZeroProvider>
    );
  }

  if (isPending) {
    return <div>Authenticating...</div>;
  }

  return error ? (
    <div>Error: {error.message}</div>
  ) : (
    <button onClick={onSignIn}>Continue with Github</button>
  );
};

createRoot(document.getElementById('app')!).render(<App />);
