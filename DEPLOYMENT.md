# Internet deployment

This application is safe to treat as an ephemeral, private-room game, not as a real-money poker service or an identity system. Rooms and sessions live only in one Node process: a restart loses them, and multiple replicas do not share state.

## Network boundary

Expose only:

- TCP 443 to the internet for HTTPS and secure WebSockets.
- TCP 80 optionally, only to redirect to HTTPS.

Do not expose port 4173 publicly. On a VM, bind Node to `127.0.0.1:4173`, put Nginx/Caddy/a managed load balancer in front, and block 4173 in both the cloud firewall and host firewall. In containers, Node may need to bind `0.0.0.0` inside its private container network; publish only the reverse proxy's 80/443 ports.

TLS must terminate at the reverse proxy or load balancer. Use an automatically renewed certificate and redirect all HTTP traffic to HTTPS.

## Required production settings

Set these in the service manager or hosting platform, not in source control:

```text
NODE_ENV=production
HOST=127.0.0.1
PORT=4173
ALLOWED_ORIGINS=https://game.example.com
TRUST_PROXY=true
ENABLE_LAN_DISCOVERY=false
```

`ALLOWED_ORIGINS` is a comma-separated list of exact origins, with no path or trailing slash. The server refuses to start in production without it. `TRUST_PROXY=true` trusts `X-Forwarded-For` for per-client limits, so enable it only when the application port is private and the trusted proxy overwrites that header.

The defaults also enforce a 16 KiB WebSocket message limit, 40 messages per five seconds per connection, 30 room create/join/resume attempts per minute per client IP, 20 connections per client IP, 500 total connections, 500 rooms, a one-hour expiry for rooms with no connected players, and a 24-hour reconnect-session lifetime. Reconnect tokens rotate whenever they are used. The limits can be adjusted with:

```text
MAX_PAYLOAD_BYTES
MAX_MESSAGES_PER_WINDOW
MESSAGE_WINDOW_MS
MAX_ROOM_ATTEMPTS_PER_WINDOW
ROOM_ATTEMPT_WINDOW_MS
MAX_CONNECTIONS_PER_IP
MAX_CONNECTIONS
MAX_ROOMS
ROOM_IDLE_MS
SESSION_TTL_MS
```

Keep limits at the reverse proxy or hosting edge too. Application limits protect the Node process after a connection reaches it; they do not absorb volumetric denial-of-service traffic.

## Nginx example

This is the relevant proxy shape; certificate paths and service management depend on the host:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name game.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name game.example.com;

    ssl_certificate     /etc/letsencrypt/live/game.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/game.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 75s;
    }
}
```

The server sends browser security headers, accepts production WebSockets only from configured origins, disables private-address discovery in production, rejects non-GET HTTP methods and binary WebSocket messages, and removes fully disconnected rooms after the idle deadline.

## Operational checklist

- Run one Node instance under a non-administrator account and a restart supervisor such as systemd or the hosting platform's service manager.
- Keep Node and locked dependencies patched; run `npm audit --omit=dev` during builds.
- Restrict logs and platform access. There are no application secrets today, but deployment credentials and TLS private keys must never enter the repository.
- Monitor process restarts, memory, connection counts, proxy 4xx/5xx rates, and certificate renewal.
- Use `/health` only for liveness checks. It intentionally does not expose room counts.
- If persistent games or horizontal scaling are required, move room/session state to a shared store and add coordinated pub/sub before adding replicas.
- Anyone with a room invite can join the lobby until it is full or the game starts. Add account authentication or room passwords before using this for private events with stronger access-control requirements.
