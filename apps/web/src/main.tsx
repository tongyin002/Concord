import { Counter, Header } from '@repo/ui';
import { createRoot } from 'react-dom/client';
import './style.css';
import typescriptLogo from '/typescript.svg';

const App = () => {
  return (
    <div>
      <a href="https://vitejs.dev">
        <img src="/vite.svg" className="logo" alt="Vite logo" />
      </a>
      <button>text</button>
      <a href="https://www.typescriptlang.org/">
        <img
          src={typescriptLogo}
          className="logo vanilla"
          alt="TypeScript logo"
        />
      </a>
      <Header title="Web" />
      <div className="card">
        <Counter />
      </div>
    </div>
  );
};

createRoot(document.getElementById('app')!).render(<App />);
