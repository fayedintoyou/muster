import { useEffect, useState } from 'react';
import { Home } from './Home';
import { PollPage } from './PollPage';

// Two pages, so no router: '/' makes a poll, '/e/<id>' is one.

export function navigate(path: string): void {
  if (path === location.pathname) return;
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

export function App() {
  const path = usePath();
  const poll = /^\/e\/([a-z0-9]+)\/?$/.exec(path);
  if (poll) return <PollPage key={poll[1]} id={poll[1]} />;
  if (path === '/' || path === '') return <Home />;
  return (
    <main className="page narrow">
      <Wordmark />
      <h1 className="title">Nothing here</h1>
      <p className="lede">This address isn’t a poll. Check the link, or make a new poll.</p>
      <p>
        <a className="button primary" href="/" onClick={(e) => (e.preventDefault(), navigate('/'))}>
          make a poll
        </a>
      </p>
    </main>
  );
}

export function Wordmark() {
  return (
    <a className="wordmark" href="/" onClick={(e) => (e.preventDefault(), navigate('/'))} aria-label="muster home">
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="2" y="2" width="7" height="7" rx="1" className="pane dim" />
        <rect x="11" y="2" width="7" height="7" rx="1" className="pane lit" />
        <rect x="2" y="11" width="7" height="7" rx="1" className="pane lit" />
        <rect x="11" y="11" width="7" height="7" rx="1" className="pane half" />
      </svg>
      muster
    </a>
  );
}
