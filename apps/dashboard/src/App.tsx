import { Route, Routes } from 'react-router-dom';
import { FindingPage } from './pages/FindingPage';
import { RunPage } from './pages/RunPage';
import { RunsPage } from './pages/RunsPage';

export default function App() {
  return (
    <div className="app">
      <main>
        <Routes>
          <Route path="/" element={<RunsPage />} />
          <Route path="/runs/:id" element={<RunPage />} />
          <Route path="/runs/:id/findings/:fid" element={<FindingPage />} />
        </Routes>
      </main>
      <footer>Offline demo: simulated PayPal and recorded AI</footer>
    </div>
  );
}
