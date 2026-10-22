import { Link, Route, Routes } from 'react-router-dom';
import { RunPage } from './pages/RunPage';
import { RunsPage } from './pages/RunsPage';

export default function App() {
  return (
    <div className="app">
      <nav>
        <Link to="/">PayClinic</Link>
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<RunsPage />} />
          <Route path="/runs/:id" element={<RunPage />} />
        </Routes>
      </main>
    </div>
  );
}
