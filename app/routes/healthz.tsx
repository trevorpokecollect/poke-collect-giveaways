// Railway's deploy health check (railway.json): traffic only moves to a new deploy once
// this answers, so customers never hit a server that's still starting.
export const loader = () =>
  new Response("ok", {
    headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
  });
