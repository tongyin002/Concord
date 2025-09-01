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
      <header></header>
      <div className="card" onClick={() => {}}>
        hello
      </div>
    </div>
  );
};

createRoot(document.getElementById('app')!).render(<App />);
