import { authClient } from 'lib/auth-client';
import { queries } from 'lib/zero';
import { useQuery, Zero, zeroBaseOptions, ZeroProvider } from 'lib/zero-client';
import { useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

const TestZero = () => {
  const [data, status] = useQuery(queries.doc.all());

  return null;
};

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
        <div>
          Logged in <button onClick={onSignOut}>Sign out</button>
          <TestZero />
        </div>
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
