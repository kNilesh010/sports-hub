const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('en-US');

let marketChart;
let congressRows = [];

function setStatus(text, isError = false) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.style.color = isError ? '#ff6b82' : '#5aa8ff';
}

function renderStats({ market, congress, hedgeFunds }) {
  const gainers = market.filter((q) => (q.changePct || 0) >= 0).length;
  const losers = market.length - gainers;

  const stats = [
    { label: 'Tracked Symbols', value: market.length },
    { label: 'Gainers / Losers', value: `${gainers} / ${losers}` },
    { label: 'Congress Buys / Sells', value: `${congress.buyCount} / ${congress.sellCount}` },
    { label: 'Latest Congress Disclosure', value: congress.latestTradeDate || 'N/A' },
    { label: 'Tracked 13F Managers', value: hedgeFunds.length }
  ];

  document.getElementById('topStats').innerHTML = stats.map((s) => `
    <article class="stat">
      <div class="label">${s.label}</div>
      <div class="value">${s.value}</div>
    </article>`).join('');
}

function renderMarket(market) {
  document.getElementById('marketTable').innerHTML = `
    <table>
      <thead>
        <tr><th>Symbol</th><th>Name</th><th>Price</th><th>Change</th><th>Change %</th><th>Volume</th></tr>
      </thead>
      <tbody>
        ${market.map((q) => {
          const isUp = (q.change || 0) >= 0;
          return `<tr>
            <td>${q.symbol}</td>
            <td>${q.name}</td>
            <td>${q.price !== null ? money.format(q.price) : 'N/A'}</td>
            <td style="color:${isUp ? '#31d18d' : '#ff6b82'}">${q.change?.toFixed?.(2) ?? 'N/A'}</td>
            <td style="color:${isUp ? '#31d18d' : '#ff6b82'}">${q.changePct?.toFixed?.(2) ?? 'N/A'}%</td>
            <td>${q.volume ? intFmt.format(q.volume) : 'N/A'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;

  const ctx = document.getElementById('marketChart').getContext('2d');
  if (marketChart) marketChart.destroy();
  marketChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: market.map((q) => q.symbol),
      datasets: [{
        label: '% change',
        data: market.map((q) => q.changePct ?? 0),
        backgroundColor: market.map((q) => ((q.changePct ?? 0) >= 0 ? 'rgba(49,209,141,0.6)' : 'rgba(255,107,130,0.6)')),
        borderColor: market.map((q) => ((q.changePct ?? 0) >= 0 ? '#31d18d' : '#ff6b82')),
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#d3ddff' } } },
      scales: {
        x: { ticks: { color: '#c1d1ff' }, grid: { color: '#283353' } },
        y: { ticks: { color: '#c1d1ff' }, grid: { color: '#283353' } }
      }
    }
  });
}

function renderCongress(transactions) {
  congressRows = transactions;
  paintCongressRows(transactions);
}

function paintCongressRows(rows) {
  document.getElementById('congressTable').innerHTML = `
    <table>
      <thead>
        <tr><th>Date</th><th>Name</th><th>Ticker/Asset</th><th>Action</th><th>Amount</th><th>Est. Value</th></tr>
      </thead>
      <tbody>
        ${rows.map((t) => {
          const side = /BUY|PURCHASE/.test(t.action) ? 'buy' : (/SELL|SALE/.test(t.action) ? 'sell' : '');
          return `<tr>
            <td>${t.date}</td>
            <td>${t.who}</td>
            <td>${t.ticker}</td>
            <td><span class="pill ${side}">${t.action}</span></td>
            <td>${t.amount}</td>
            <td>${t.estimatedValue ? money.format(t.estimatedValue) : 'N/A'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function renderHedgeFunds(filings) {
  document.getElementById('hedgeFundCards').innerHTML = filings.map((item) => {
    const filing = item.latest13F;
    return `<article class="card">
      <h3>${item.manager}</h3>
      <div class="muted">CIK: ${item.cik}</div>
      ${filing ? `
        <p><strong>Latest Form:</strong> ${filing.form}</p>
        <p><strong>Filed:</strong> ${filing.filingDate}</p>
        <p><a href="${filing.filingUrl}" target="_blank" rel="noreferrer">Open SEC filing</a></p>
      ` : '<p class="muted">Latest 13F not currently reachable from source.</p>'}
    </article>`;
  }).join('');
}

function renderWatchlist(watchlist) {
  document.getElementById('watchlist').innerHTML = watchlist
    .map((w) => `<span class="chip">${w.name} · ${w.type}</span>`)
    .join('');
}

async function loadDashboard() {
  try {
    setStatus('Loading latest market and filing data...');
    const res = await fetch('/api/dashboard');
    if (!res.ok) throw new Error('Dashboard API unavailable');
    const payload = await res.json();

    renderStats(payload);
    renderMarket(payload.market);
    renderCongress(payload.congress.transactions);
    renderHedgeFunds(payload.hedgeFunds);
    renderWatchlist(payload.watchlist);

    document.getElementById('congressFilter').addEventListener('input', (e) => {
      const query = e.target.value.trim().toLowerCase();
      const filtered = !query ? congressRows : congressRows.filter((r) =>
        [r.who, r.ticker, r.action].join(' ').toLowerCase().includes(query)
      );
      paintCongressRows(filtered);
    });

    setStatus(`Last refreshed: ${new Date(payload.updatedAt).toLocaleString()} (auto-refresh every 60s)`);
  } catch (error) {
    console.error(error);
    setStatus('Could not load live data. Check API/network connectivity and try again.', true);
  }
}

loadDashboard();
setInterval(loadDashboard, 60000);
