import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Activity, LayoutDashboard, Search, Settings, ShieldCheck } from 'lucide-react';
import type { ApiClient } from '../../api/client';
import { useDashboard } from '../../context/DashboardContext';

export interface ShellProps {
  children: ReactNode;
  client?: Pick<ApiClient, 'health'>;
}

export function Shell({ children, client }: ShellProps) {
  const { searchQuery, setSearchQuery, liveConnection, mode: contextMode } = useDashboard();
  const [localMode, setLocalMode] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    if (client) {
      let active = true;
      client
        .health()
        .then((h) => {
          if (active) setLocalMode(h.mode);
        })
        .catch(() => {
          if (active) setLocalMode('offline');
        });
      return () => {
        active = false;
      };
    }
  }, [client]);

  const activeMode = localMode ?? contextMode;
  const isOffline = activeMode === 'offline';
  const modeText = isOffline ? 'Offline demo' : activeMode === 'online' ? 'Live sandbox' : `Live: ${activeMode}`;

  // Check if we are currently viewing a specific run
  const runMatch = location.pathname.match(/^\/runs\/([^/]+)/);
  const currentRunId = runMatch ? runMatch[1] : null;

  return (
    <div className="shell-wrapper">
      <div className="shell-container" data-testid="shell-container">
        {/* Left icon sidebar */}
        <aside className="shell__sidebar" aria-label="Sidebar">
          <div className="shell__sidebar-top">
            <Link to="/" className="shell__logo" title="PayClinic" aria-label="PayClinic Home">
              <span>PC</span>
            </Link>
            <nav className="shell__nav" aria-label="Main Navigation">
              <NavLink
                to="/"
                end
                className={({ isActive }) => `shell__nav-link ${isActive ? 'active' : ''}`}
                title="Dashboard"
                aria-label="Dashboard"
              >
                <LayoutDashboard size={20} />
              </NavLink>

              <NavLink
                to={currentRunId ? `/runs/${currentRunId}` : '/'}
                className={() =>
                  `shell__nav-link ${location.pathname.startsWith('/runs') ? 'active' : ''}`
                }
                title="Runs & Findings"
                aria-label="Runs & Findings"
              >
                <ShieldCheck size={20} />
              </NavLink>

              <NavLink
                to={currentRunId ? `/runs/${currentRunId}` : '/'}
                className={() =>
                  `shell__nav-link ${liveConnection === 'live' ? 'active' : ''}`
                }
                title="Live Activity"
                aria-label="Live Activity"
              >
                <Activity size={20} />
              </NavLink>
            </nav>
          </div>

          <div className="shell__sidebar-bottom">
            <button
              type="button"
              className="shell__nav-link"
              title="Settings"
              aria-label="Settings"
              onClick={() => {}}
            >
              <Settings size={20} />
            </button>
          </div>
        </aside>

        {/* Main area */}
        <div className="shell__main-wrapper">
          {/* Top bar */}
          <header className="shell__topbar">
            <div className="shell__search">
              <Search size={16} className="shell__search-icon" aria-hidden="true" />
              <input
                type="text"
                data-testid="search-input"
                className="shell__search-input"
                placeholder="Search runs, findings, traces…"
                aria-label="Search runs, findings, traces"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="shell__topbar-right">
              <div className="shell__mode-pill" data-testid="mode-badge" title={`Mode: ${activeMode}`}>
                <span className={`shell__dot ${isOffline ? 'shell__dot--offline' : 'shell__dot--live'}`} />
                <span>{modeText}</span>
              </div>

              <div
                className="shell__live-pill"
                data-testid="live-indicator"
                title={`Connection: ${liveConnection}`}
                aria-label={`Live status: ${liveConnection}`}
              >
                <span className={`pulse-dot pulse-dot--${liveConnection}`} />
                <span className="shell__live-text">
                  {liveConnection === 'live' ? 'Live' : liveConnection === 'reconnecting' ? 'Reconnecting' : 'Offline'}
                </span>
              </div>

              <div className="shell__avatar" title="PayClinic Admin" aria-label="User profile">
                <span>PC</span>
              </div>
            </div>
          </header>

          {/* Inner scrollable area with 24px padding */}
          <main className="shell__main">{children}</main>
        </div>
      </div>
    </div>
  );
}
