import React, { useCallback, useState } from 'react';

export const Counter: React.FC = () => {
  const [count, setCount] = useState(0);
  const onClick = useCallback(() => setCount((lastCount) => lastCount + 1), []);
  return (
    <button id="counter" type="button" onClick={onClick}>
      {count}
    </button>
  );
};
