# Family hosting

## What is ready

A single Node process serves the game and `/ws` on the same port. A TLS-terminating
host exposes HTTPS/WSS on port 443. The production server refuses to start without
an HTTPS public origin and a family password of at least 16 characters.

The shared password is an access gate for trusted relatives, not individual
accounts. Keep it out of Git, URLs, chat logs, and screenshots. Enter it directly
in the host's secret environment-variable field and share it privately with family.
Login uses an expiring, signed HttpOnly/Secure/SameSite cookie. Cookies expire after
12 hours or a server restart; reconnect tokens still identify individual seats.
Reload to sign in when family access expires.

## Render setup (account needed)

The repository includes `render.yaml` and a production-only Dockerfile. No database
or custom domain is needed. Render provides an HTTPS `onrender.com` address.

1. Create/sign in to your own account at https://dashboard.render.com.
2. Create a Blueprint from `AdminPhil/uno-game`, selecting branch
   `fix/multiplayer-foundation` and `render.yaml`.
3. Review the configuration: one web service, Docker runtime, Virginia region,
   one instance, health check `/healthz`, and automatic deployments off.
4. Set `FAMILY_PASSWORD` to a unique password-manager-generated password or long
   random passphrase (16–256 characters). Do not reuse your Google/GitHub password.
5. The supplied blueprint defaults to **Free** for a trial. Review the dashboard's
   price before switching to paid compute. Free services sleep after 15 minutes
   without incoming traffic and are not the recommendation for regular games.
   A small always-on paid instance is preferable for reliable family use.
6. Deploy. The application reads the canonical HTTPS origin from Render's
   `RENDER_EXTERNAL_URL`; there is no password or origin baked into the client.
7. Open the assigned URL, sign in, and verify the two-device checklist below before
   sharing it. Only send the site URL and lobby code through ordinary invitations;
   communicate the family password privately.

For a custom domain, set `PUBLIC_ORIGIN` to the exact HTTPS origin with no trailing
slash, then use that domain consistently. Other origins cannot open WebSockets.
Changing the password requires a redeploy/restart and invalidates family access.

No service has been created by these files alone. Creating an account, selecting
billing, setting the private password and starting the deployment are still needed.
The Docker build could not be tested locally because Docker is not installed.

## Keep one instance

Game state is in memory. Keep **exactly one instance**, with no horizontal scaling.
Restarts, redeploys and platform maintenance end active games. Automatic deploys
are disabled so routine Git pushes do not end games. Schedule manual deployments
between games. A previous working image/commit can be redeployed to roll back,
but lost game state cannot be recovered. A paid instance does not change this.

## Local use

Development (no family login; use on your own machine only):

```powershell
pnpm start:game
# A separate terminal:
pnpm serve
```

Or run the built HTTP host locally:

```powershell
pnpm build
pnpm start
# Open http://127.0.0.1:8080
```

Local mode binds to loopback and permits only loopback game origins. Production
binds to all interfaces for the hosting proxy, requires secrets and HTTPS origin,
and sets secure cookies. Never expose the standalone development game server
publicly; it intentionally has no family gate. Use `hosting.js` in production.

The container copies the browser-native HTML/CSS/JS directly; these files do not
require bundling. `pnpm build` remains available for an optimized local bundle.
The image installs only the pinned ws runtime dependency from `deploy/package-lock.json`
with `npm ci`. Root pnpm changes are deliberately left untouched. To update the
runtime, update its manifest and lockfile together and rerun its audit.

## Verification before inviting family

- Anonymous visits show sign-in; `/healthz` reveals only `ok`.
- The production URL uses HTTPS and the WebSocket uses WSS on `/ws`.
- A wrong password fails, then the right password allows joining.
- Two separate browsers/devices can join by lobby code and start a game.
- Refresh one during its turn; the same hand and seat return without duplicates.
- Continue play; verify opponents show card counts, never their cards.
- Try a short network interruption within the 60-second reconnect reservation.
- Restart only between games; clients must return cleanly to login/join.

Automated tests cover authentication, cookie flags/expiry/tampering, exact origins,
private file denial, password attempt limits, WebSocket limits and the multiplayer
foundation. A local real-browser smoke test also verified login and two-player
refresh/continued play with the hosting entry point. Remote TLS and container
verification remain pending until there is a hosting account and deployment.

## Boundaries

This is intended for a small trusted family, not a public gaming service. There
are global login/upgrade limits, 64 WebSockets, 100 player sessions, 60 messages
per 10 seconds per connection and a send-buffer limit. Global login limiting can
briefly delay everyone if someone floods the form; an edge firewall would be the
next step if the URL attracts abuse. There is no individual access revocation,
durable state, distributed rate limiter or protection against large network attacks.

Official references:
- https://render.com/docs/websocket
- https://render.com/docs/free
- https://render.com/docs/blueprint-spec
- https://render.com/docs/environment-variables
- https://render.com/pricing
- https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html
