import { authClient } from 'lib/auth-client';
import { schema, Zero, ZeroProvider } from 'lib/zero-client';
import { useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

const App = () => {
  const { data, isPending, error } = authClient.useSession();

  const zero = useMemo(() => {
    return new Zero<typeof schema>({
      userID: data?.user.id ?? 'anon',
      server: 'http://localhost:4848',
      schema,
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

  const content = useMemo(() => {
    if (isPending && !error) {
      return <div>Loading...</div>;
    }

    if (data) {
      return (
        <div>
          Logged in <button onClick={onSignOut}>Sign out</button>
        </div>
      );
    }

    return <button onClick={onSignIn}>Continue with Github</button>;
  }, [data, error, isPending, onSignIn, onSignOut]);

  return <ZeroProvider zero={zero}>{content}</ZeroProvider>;
};

createRoot(document.getElementById('app')!).render(<App />);
