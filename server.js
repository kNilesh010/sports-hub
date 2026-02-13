const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

const SYMBOLS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'SPY', 'QQQ', 'IWM', 'GLD', 'TLT'
];

const WATCHLIST = [
  { name: 'Nancy Pelosi', type: 'Congress', sourceHint: 'Periodic Transaction Reports (PTR)' },
  { name: 'Dan Crenshaw', type: 'Congress', sourceHint: 'Periodic Transaction Reports (PTR)' },
  { name: 'Bill Ackman (Pershing Square)', type: 'Hedge Fund', cik: '0001336528' },
  { name: 'David Tepper (Appaloosa)', type: 'Hedge Fund', cik: '0001550593' },
  { name: 'Ray Dalio (Bridgewater)', type: 'Hedge Fund', cik: '0001350694' }
];

function parseMoneyRange(amount) {
  if (!amount || typeof amount !== 'string') return null;
  const values = amount.replace(/[$,]/g, '').split('-').map((v) => parseFloat(v.trim()));
  if (values.length === 2 && values.every(Number.isFinite)) return (values[0] + values[1]) / 2;
  return Number.isFinite(values[0]) ? values[0] : null;
}

async function fetchJson(url, fallback = null, headers = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } catch (error) {
    if (fallback !== null) return fallback;
    throw error;
  }
}

async function getMarketData() {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${SYMBOLS.join(',')}`;
  const data = await fetchJson(url, { quoteResponse: { result: [] } });
  return (data.quoteResponse?.result || []).map((item) => ({
    symbol: item.symbol,
    name: item.shortName || item.longName || item.symbol,
    price: item.regularMarketPrice ?? null,
    change: item.regularMarketChange ?? null,
    changePct: item.regularMarketChangePercent ?? null,
    volume: item.regularMarketVolume ?? null,
    timestamp: item.regularMarketTime ? new Date(item.regularMarketTime * 1000).toISOString() : null
  }));
}

async function getCongressTrades(limit = 150) {
  const houseUrl = 'https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json';
  const senateUrl = 'https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json';
  const [house, senate] = await Promise.all([fetchJson(houseUrl, []), fetchJson(senateUrl, [])]);

  const normalized = [...house, ...senate]
    .map((item) => ({
      who: item.representative || item.senator || item.name || 'Unknown',
      ticker: item.ticker || item.asset?.replace(/\s+/g, ' ').slice(0, 12) || 'N/A',
      action: (item.type || item.transaction_type || 'Unknown').toUpperCase(),
      amount: item.amount || item.range || 'Unknown',
      estimatedValue: parseMoneyRange(item.amount || item.range || ''),
      date: item.transaction_date || item.transcation_date || item.disclosure_date || item.disclosed_date || null,
      source: item.source || (item.chamber === 'Senate' ? 'Senate disclosure' : 'House disclosure')
    }))
    .filter((tx) => tx.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);

  const buyCount = normalized.filter((t) => t.action.includes('PURCHASE') || t.action.includes('BUY')).length;
  const sellCount = normalized.filter((t) => t.action.includes('SALE') || t.action.includes('SELL')).length;

  return { latestTradeDate: normalized[0]?.date || null, buyCount, sellCount, transactions: normalized };
}

async function getLatest13FFiling(cik) {
  const padded = cik.padStart(10, '0');
  const subUrl = `https://data.sec.gov/submissions/CIK${padded}.json`;

  const submissions = await fetchJson(subUrl, null, {
    'User-Agent': 'portfolio-tracker/1.0 admin@example.com',
    Accept: 'application/json'
  });

  const forms = submissions?.filings?.recent?.form || [];
  const accessions = submissions?.filings?.recent?.accessionNumber || [];
  const filedDates = submissions?.filings?.recent?.filingDate || [];
  const primaryDocs = submissions?.filings?.recent?.primaryDocument || [];

  const idx = forms.findIndex((f) => f === '13F-HR' || f === '13F-HR/A');
  if (idx === -1) return null;

  const accession = (accessions[idx] || '').replace(/-/g, '');
  return {
    form: forms[idx],
    filingDate: filedDates[idx],
    accession: accessions[idx],
    filingUrl: `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accession}/${primaryDocs[idx] || ''}`
  };
}

async function getHedgeFundSignals() {
  const managers = WATCHLIST.filter((w) => w.type === 'Hedge Fund' && w.cik);
  const filings = await Promise.all(managers.map(async (manager) => {
    try {
      const latest = await getLatest13FFiling(manager.cik);
      return { manager: manager.name, cik: manager.cik, latest13F: latest, status: latest ? 'ok' : 'no-13f-found' };
    } catch {
      return { manager: manager.name, cik: manager.cik, latest13F: null, status: 'source-unavailable' };
    }
  }));
  return filings;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res, pathname) {
  let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsed.pathname;

  try {
    if (pathname === '/api/watchlist') {
      return sendJson(res, 200, { updatedAt: new Date().toISOString(), watchlist: WATCHLIST });
    }
    if (pathname === '/api/market') {
      const quotes = await getMarketData();
      return sendJson(res, 200, { updatedAt: new Date().toISOString(), quotes });
    }
    if (pathname === '/api/congress') {
      const limit = Number(parsed.searchParams.get('limit') || 150);
      const congress = await getCongressTrades(limit);
      return sendJson(res, 200, { updatedAt: new Date().toISOString(), ...congress });
    }
    if (pathname === '/api/hedge-funds') {
      const filings = await getHedgeFundSignals();
      return sendJson(res, 200, { updatedAt: new Date().toISOString(), filings });
    }
    if (pathname === '/api/dashboard') {
      const [market, congress, hedgeFunds] = await Promise.all([
        getMarketData(),
        getCongressTrades(75),
        getHedgeFundSignals()
      ]);
      return sendJson(res, 200, {
        updatedAt: new Date().toISOString(),
        watchlist: WATCHLIST,
        market,
        congress,
        hedgeFunds,
        notes: [
          'Congress trades are disclosure-based and may be delayed relative to execution date.',
          '13F filings are quarterly snapshots, not intraday positions.'
        ]
      });
    }

    serveStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, 502, { error: 'Data source unavailable', details: error.message });
  }
});

server.listen(port, () => {
  console.log(`Dashboard listening on http://localhost:${port}`);
});
