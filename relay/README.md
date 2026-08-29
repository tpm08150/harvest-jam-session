# The jam relay, hosted

A jam needs somewhere for two browsers to meet. `tools/jam-relay.py` is that place on a
LAN. This is that place on the internet, and it exists because of one hard constraint:

> **An https page cannot open a `ws://` socket.** The browser blocks it as mixed content
> before the socket is constructed, so `join()` fails with nothing on screen to say why.

The studio is served from Netlify over TLS, Netlify serves static files only, and a laptop
running the Python relay has no certificate. So the relay needs a home that terminates TLS
and stays up when the laptop is shut. That is this.

## Deploy it

```bash
cd relay
npx wrangler login          # opens your browser; a Cloudflare account, free plan is fine
npx wrangler deploy
```

The last line it prints is the URL:

```
https://harvest-jam-relay.<your-subdomain>.workers.dev
```

**Then put it in the studio.** Open `src/shell/session.js`, set `HOME_RELAY` to that URL
with `https` changed to **`wss`**, and rebuild:

```bash
python3 tools/build.py
```

Commit the rebuilt HTML and push. That is the whole loop: the build is a pure join of
`src/` with no substitution step, so the relay's address lives in the source like any other
line. Redeploying the relay does not need a studio rebuild — only *changing its address*
does, and the address does not change.

## Check it

```bash
python3 tools/relay-check.py wss://harvest-jam-relay.<your-subdomain>.workers.dev
```

25 assertions, stdlib only, and the same ones `tools/jam-relay.py` has to pass. ⚠️ There
are two relays now and nothing but that script stops them drifting — run it against both
after touching either.

## Run it locally

`wrangler dev` runs the real Worker and a real Durable Object on your machine, in workerd,
with no account and no login:

```bash
cd relay && npx wrangler dev            # ws://localhost:8787
```

That is how this was tested before it was ever deployed, and it is the right way to change
it. `npx wrangler tail` streams logs from the deployed one.

## What it costs

Nothing, at this scale. The free plan gives 100,000 Durable Object requests a day, and the
WebSocket Hibernation API means an idle jam is not billed for duration at all — the object
is evicted from memory while the sockets stay open. See `worker.js` for the constraint that
comes with that: **nothing may live in the class's fields.**

## What it does not do

- **It does not know what music is.** It relays, and it keeps time. Everything it does not
  recognise it forwards untouched. A relay that understood the payload would be a second
  implementation of the model with its own opinions about who is right.
- **It does not make a room private.** Anyone who opens the studio can list the running
  jams and join any of them — which is the point of a link you can hand somebody, and worth
  knowing before you leave one running. A room name is not a password. If rooms ever need
  to be private, that is a `secret` on `join` and a check here, and it is the first thing
  this relay would have to learn about its clients.
- **It does not arbitrate.** Patterns are still last-writer-wins between two people editing
  one grid; the owner label on each plate is the only coordination on offer. A real lock
  needs a server to hand it out, which is now possible for the first time — but it is a new
  feature, not a fix.
