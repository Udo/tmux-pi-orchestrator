# tmux pi Orchestrator

A mobile-friendly PHP web UI for managing `tmux` sessions on the same host as the web server. It is intended for remote interaction with long-running CLI agents and bash shells when SSH from a phone is inconvenient.

Built from [`Udo/web-app-starter`](https://github.com/Udo/web-app-starter).

## Local dev URL

This checkout is designed to run under the local nginx document root at:

- `http://<server>/tmux-pi-orchestrator/`
- `https://<server>/tmux-pi-orchestrator/`

The local nginx root is `/root/projects`, so no separate build step is required for PHP development.

## Features in the first slice

- List local tmux sessions.
- List panes for the selected session.
- Capture recent pane output.
- Send text/prompts/commands to a pane, with optional Enter.
- Create and kill sessions.
- Mobile-first layout with large touch targets and auto-refresh.
- CSRF protection for mutating API calls.

## Requirements

- PHP 8.4+ through php-fpm/nginx.
- `tmux` installed and executable by the php-fpm user.
- The php-fpm worker and the desired tmux sessions must run as users that can see the same tmux server/socket. For local dev as root, nginx/php-fpm currently serves `/root/projects`.

## Tests

```bash
php tests/smoke.php
```

## Security note

This app can send keystrokes to server-side shells. Do not expose it publicly without adding real authentication and network restrictions. The initial implementation only protects state-changing requests against CSRF.
