import { Link, Route, Routes } from 'react-router-dom';
import { Shell } from './components/ui/Shell';
import { EmptyState } from './components/ui/EmptyState';
import { FindingPage } from './pages/FindingPage';
import { RunPage } from './pages/RunPage';
import { RunsPage } from './pages/RunsPage';

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<RunsPage />} />
        <Route path="/runs/:id" element={<RunPage />} />
        <Route path="/runs/:id/findings/:fid" element={<FindingPage />} />
        <Route
          path="*"
          element={
            <EmptyState message="Page not found" action={<Link to="/">Back to runs</Link>} />
          }
        />
      </Routes>
    </Shell>
  );
}
