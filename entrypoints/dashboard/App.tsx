import React from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import Review from './routes/review';
import Inbox from './routes/inbox';
import Cards from './routes/cards';
import Sources from './routes/sources';
import Tags from './routes/tags';
import Errors from './routes/errors';
import Practice from './routes/practice';
import Stats from './routes/stats';
import Settings from './routes/settings';

const NAV_ITEMS = [
  { to: '/review', label: 'Today Review' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/cards', label: 'All Cards' },
  { to: '/sources', label: 'Sources' },
  { to: '/tags', label: 'Tags' },
  { to: '/errors', label: 'Errors' },
  { to: '/practice', label: 'Practice' },
  { to: '/stats', label: 'Stats' },
  { to: '/settings', label: 'Settings' },
];

export default function App(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <nav
        style={{
          width: '200px',
          padding: '16px',
          borderRight: '1px solid #eee',
          background: '#fafafa',
        }}
      >
        <h1 style={{ fontSize: '18px', marginBottom: '20px' }}>LexiFlow</h1>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {NAV_ITEMS.map((item) => (
            <li key={item.to} style={{ marginBottom: '4px' }}>
              <NavLink
                to={item.to}
                style={({ isActive }) => ({
                  display: 'block',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  color: isActive ? '#fff' : '#333',
                  background: isActive ? '#4f46e5' : 'transparent',
                  fontSize: '14px',
                })}
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main style={{ flex: 1, padding: '24px', overflow: 'auto' }}>
        <Routes>
          <Route path="/" element={<Review />} />
          <Route path="/review" element={<Review />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/cards" element={<Cards />} />
          <Route path="/sources" element={<Sources />} />
          <Route path="/tags" element={<Tags />} />
          <Route path="/errors" element={<Errors />} />
          <Route path="/practice" element={<Practice />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
