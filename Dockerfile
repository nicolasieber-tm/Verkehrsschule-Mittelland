FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY . /app
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
