# Website Change Detector

Monitors public web pages in a headless browser (Playwright) and alerts on meaningful changes while ignoring noise.

**Live demo:** _add your deployed URL here after deploying (see Deploy)_

## Run locally
```bash
npm install && npx playwright install chromium
npm start        # http://localhost:3000
```
Optional env: `BASE_URL` (used in alert links), `TELEGRAM_BOT_TOKEN`, `SMTP_URL` + `MAIL_FROM`, `DATA_DIR`, `PORT`.

## Deploy (Docker: Render / Railway / Fly.io)
Create a Web Service from this repo (it uses the included `Dockerfile`), mount a persistent disk at `/app/data`, set `BASE_URL` to the public URL, and paste that URL above.

## Requirement map
| # | Where |
|---|---|
| 1 URL, name, 15 min–24 h interval, Playwright | `POST /api/watches` (interval clamped), `getBrowser` |
| 2 Scheduler, queue, timeouts, retries, public only | `tick` (15 s scheduler, 2 workers, 90 s job timeout), 3 goto retries with backoff, failed checks back off exponentially, `safeUrl` blocks private IPs, no credentials stored |
| 3 Text + screenshot, store only on hash change | `record` |
| 4 Noise filtering + sensitivity | `NOISE` regexes, ad/banner/carousel/iframe removal, low/medium/high thresholds |
| 5 Visual picker, watch/ignore regions | click the page preview; `/api/pick` returns a CSS selector |
| 6 Text diff, screenshot diff, side by side | timeline page (`/api/diff`, `/api/imgdiff`) |
| 7 Email, Discord/Telegram/generic webhook, summary + diff link, no duplicates | `notify` |
| 8 Timeline + dashboard (OK / error / blocked) | `public/index.html` |
| Bonus | per-page RSS: `/api/watches/:id/rss` |

## Design questions
1. **Is an outage or CAPTCHA a change?** No. HTTP 403/429 or a short page matching CAPTCHA/bot-wall text sets the status to *blocked*; 4xx/5xx or navigation failure sets *error*. Neither creates a snapshot or an alert.
2. **200 users, same URL?** Due watches are grouped by URL, so the page is loaded once per cycle and each watch extracts its own regions from that load.
3. **Pages that differ on every load?** Timestamps, relative times, counters and random tokens are stripped before hashing; ads/banners/carousels are ignored; sensitivity sets a minimum share of changed lines; A→B→A flapping (a hash seen before) never alerts.
4. **Avoiding hammering a site?** Minimum 15 min interval, one fetch per URL per cycle, at least 5 s between requests to the same host, 2 concurrent jobs, and exponential backoff after errors/blocks.

## Not included
Keyword-only alerts, number charts, AI summaries, browser extension, daily digest. Add authentication before exposing the app publicly.
