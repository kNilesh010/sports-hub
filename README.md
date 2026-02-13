# WhaleScope Dashboard

Interactive web dashboard for tracking:

- Major hedge fund managers (via latest SEC 13F filings)
- US congressional trading disclosures (House + Senate public datasets)
- Live market quotes and index context

## Features

- Fast dashboard API (`/api/dashboard`) that aggregates watchlist, market, congress, and hedge fund filing data.
- Interactive chart and tables with filtering.
- Coverage includes Nancy Pelosi, Bill Ackman, and other notable names; easy to extend in `WATCHLIST`.
- Refreshes every 60 seconds in UI for near-real-time market context.

## Data Sources

- Yahoo Finance quote endpoint (`query1.finance.yahoo.com`)
- SEC EDGAR submissions API (`data.sec.gov`)
- House Stock Watcher dataset (S3 public file)
- Senate Stock Watcher aggregate dataset (S3 public file)

> Important: Congressional and 13F data are disclosure-based and delayed by regulation. This app surfaces the *latest available public data*, not private real-time brokerage executions.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000

## Extend coverage

Update the `WATCHLIST` and `SYMBOLS` arrays in `server.js`.
