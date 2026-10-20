"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="app">
      <main className="layout" style={{ gridTemplateColumns: "1fr" }}>
        <div className="panel" style={{ maxWidth: 560, margin: "40px auto", width: "100%" }}>
          <div className="panel-head">
            <h2>Something went wrong</h2>
          </div>
          <div className="panel-body">
            <div className="alert error">{error.message || "An unexpected error occurred."}</div>
            <p className="muted" style={{ marginTop: 0 }}>
              You can try again, or reload the page and start over.
            </p>
            <button className="btn btn-primary" onClick={reset}>
              Try again
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
