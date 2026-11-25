import { useState } from 'react';
import { api } from './api';
import { Wordmark, navigate } from './App';
import { Panes } from './Panes';
import { DEFAULT_SETTINGS, PollForm } from './PollForm';
import { store } from './store';

export function Home() {
  const [recent, setRecent] = useState(() => store.recent());

  return (
    <div className="home">
      <header className="topbar">
        <Wordmark />
        <a className="corner-link" href="https://fayelore.com">
          fayelore.com
        </a>
      </header>

      <main className="page">
        <section className="hero">
          <Panes />
          <div className="hero-text">
            <h1 className="display">Find the night everyone can raid.</h1>
            <p className="lede">
              Make a poll below and drop its link in Discord. Everyone paints the hours they’re free, each in their
              own time zone, and muster finds the windows most of you can make.
            </p>
          </div>
        </section>

        <div className="home-body">
        <section className="make" aria-labelledby="make-title">
          <h2 id="make-title" className="section-title">
            Make a poll
          </h2>
          <PollForm
            initial={DEFAULT_SETTINGS}
            submitLabel="make the poll"
            busyLabel="making it…"
            onSubmit={async (settings) => {
              const { id, admin } = await api.create(settings);
              store.setMembership(id, { admin });
              store.remember({ id, title: settings.title }, true);
              sessionStorage.setItem('muster:made', id);
              navigate(`/e/${id}`);
            }}
          />
        </section>

        {recent.length > 0 && (
          <section className="recent" aria-labelledby="recent-title">
            <h2 id="recent-title" className="section-title">
              Your polls
            </h2>
            <ul className="recent-list">
              {recent.map((p) => (
                <li key={p.id}>
                  <a
                    href={`/e/${p.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/e/${p.id}`);
                    }}
                  >
                    {p.title}
                  </a>
                  <span className="muted">{p.admin ? 'yours' : 'answered'}</span>
                  <button
                    type="button"
                    className="text-button"
                    aria-label={`Forget ${p.title}`}
                    onClick={() => {
                      store.forget(p.id);
                      setRecent(store.recent());
                    }}
                  >
                    forget
                  </button>
                </li>
              ))}
            </ul>
            <p className="hint">Only this browser remembers these.</p>
          </section>
        )}
        </div>
      </main>

      <footer className="footer">
        <span>
          muster is a small thing made at <a href="https://fayelore.com">fayelore.com</a>.
        </span>
      </footer>
    </div>
  );
}
