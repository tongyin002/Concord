import { authClient } from 'lib/auth-client';
import {
  accountsQuery,
  schema,
  useQuery,
  Zero,
  ZeroProvider,
} from 'lib/zero-client';
import { useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const ZeroComponent = ({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) => {
  const [accounts] = useQuery(accountsQuery(userId));
  return (
    <div>
      {`this User ${userName} has ${accounts.length} accounts `}
      {accounts.map((account) => (
        <span key={account.id}>{account.scope}</span>
      ))}
    </div>
  );
};

const { useSession, token } = authClient;

const App = () => {
  const { data, isPending, error } = useSession();
  const zero = useMemo(() => {
    if (!data?.user) return undefined;

    return new Zero({
      userID: data.user.id,
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

  if (isPending) {
    return <div>Loading...</div>;
  }

  if (data) {
    if (!zero) return null;
    return (
      <ZeroProvider zero={zero}>
        <div>
          <span>{data.user.email}</span>
          <button onClick={onSignOut}>Sign out</button>
        </div>
        <ZeroComponent userId={data.user.id} userName={data.user.name} />
      </ZeroProvider>
    );
  }

  return (
    <div>
      <button onClick={onSignIn}>Continue with Github</button>
      {error ? <span>error...</span> : null}
    </div>
  );
};

createRoot(document.getElementById('app')!).render(<App />);
