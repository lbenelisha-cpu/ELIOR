const API_BASE = 'https://binance-wave-agent.onrender.com';

const MODE = API_BASE + '/api/binance-mode';
const AGENT = API_BASE + '/api/binance-agent';
const EVALUATE = API_BASE + '/api/binance-agent/evaluate';

const $ = (selector) =>
  document.querySelector(selector);


/* =========================
   FORMAT
========================= */

const fmt = (value, digits = 2) => {

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '—';
  }

  return number.toLocaleString(
    'he-IL',
    {
      maximumFractionDigits: digits
    }
  );
};


function put(selector, value) {

  const element = $(selector);

  if (element) {
    element.textContent = value;
  }
}


/* =========================
   HTTP
========================= */

async function getJSON(url, options = {}) {

  const response = await fetch(
    url,
    {
      cache: 'no-store',
      ...options
    }
  );

  if (!response.ok) {

    throw new Error(
      `${url}: HTTP ${response.status}`
    );
  }

  return response.json();
}


/* =========================
   MODE
========================= */

function renderMode(state) {

  const demoBtn = $('#demoBtn');
  const liveBtn = $('#liveBtn');

  if (demoBtn) {

    demoBtn.classList.toggle(
      'active',
      state.mode === 'demo'
    );
  }

  if (liveBtn) {

    liveBtn.classList.toggle(
      'active',
      state.mode === 'live'
    );
  }


  const warning =
    $('#liveWarning');

  if (warning) {

    warning.classList.toggle(
      'hidden',
      state.mode !== 'live'
    );
  }


  if (state.mode === 'demo') {

    put(
      '#status',
      'DEMO · TESTNET'
    );

  }
  else {

    put(
      '#status',

      state.liveTradingEnabled
        ? 'LIVE · ARMED'
        : 'LIVE · LOCKED'
    );
  }


  put(
    '#keys',

    state.keysConfigured
      ? 'API מחובר'
      : 'API לא מוגדר'
  );


  if (!state.liveTradingEnabled) {

    put(
      '#liveText',
      'LIVE נעול בצד השרת.'
    );

  }
  else if (state.autoExecution) {

    put(
      '#liveText',
      'LIVE מורשה וגם ביצוע אוטומטי פעיל.'
    );

  }
  else {

    put(
      '#liveText',
      'LIVE מורשה, אך AUTO EXECUTION כבוי.'
    );
  }
}


/* =========================
   AGENT
========================= */

function renderPaper(p) {
  if (!p) return;
  put('#paperCash', fmt(p.cashIls) + ' ₪');
  put('#paperBtc', fmt(p.btc, 8));
  put('#paperEntry', p.entryPrice ? '$' + fmt(p.entryPrice) : '—');
  put('#paperValue', fmt(p.valueIls) + ' ₪');
  const pnl = Number(p.profitIls || 0), pct = Number(p.profitPct || 0);
  put('#paperPnl', `${pnl >= 0 ? '+' : ''}${fmt(pnl)} ₪ (${pct >= 0 ? '+' : ''}${fmt(pct)}%)`);
  put('#paperTradesCount', String((p.trades || []).length));
  const h = $('#paperHistory');
  if (h) h.innerHTML = (p.trades || []).slice(0,10).map(t => `<div><b>SELL</b> · קנייה $${fmt(t.buyPrice)} → מכירה $${fmt(t.sellPrice)} · ${Number(t.pnlPct)>=0?'+':''}${fmt(t.pnlPct)}%</div>`).join('') || '<div class="mini">עדיין אין עסקאות סגורות.</div>';
}

function renderAgent(data) {

  const agent =
    data.agent || {};

  const strategy =
    agent.strategy || {};

  renderPaper(data.paper);


  /* PRICE */

  const price =
    strategy.price ??
    data.stream?.lastPrice;

  put(
    '#price',
    price != null
      ? '$' + fmt(price)
      : '—'
  );


  /* MA200 */

  put(
    '#ma',
    strategy.ma != null
      ? '$' + fmt(strategy.ma)
      : '—'
  );


  /* CURRENT WAVE */

  if (strategy.direction) {

    put(
      '#wave',
      `${strategy.direction} · ${fmt(
        strategy.currentWave
      )}%`
    );

  }
  else {

    put(
      '#wave',
      '—'
    );
  }


  /* PREVIOUS WAVES */

  put(
    '#prevDown',

    strategy.previousDownWave != null
      ? fmt(
          strategy.previousDownWave
        ) + '%'
      : '—'
  );


  put(
    '#prevUp',

    strategy.previousUpWave != null
      ? fmt(
          strategy.previousUpWave
        ) + '%'
      : '—'
  );


  /* POSITION */

  put(
    '#position',
    agent.position || '—'
  );


  /* DECISION */

  put(
    '#decision',
    agent.decision || '—'
  );


  const decision =
    $('#decision');

  if (decision) {

    decision.className =
      'decision ' +
      String(
        agent.decision || ''
      ).toLowerCase();
  }


  /* BUY CHECKS */

  const checks =
    $('#checks');

  if (checks) {

    const minWave =
      Number(
        strategy.minWave ?? 4
      );


    const currentWave =
      Number(
        strategy.currentWave ?? 0
      );


    const aboveMA =
      strategy.aboveMA === true;


    const minimumPassed =
      currentWave >= minWave;


    const reversalConfirmed =

      strategy.direction === 'UP' &&

      strategy.previousDownWave != null &&

      currentWave >
      Number(
        strategy.previousDownWave
      );


    checks.innerHTML = `

      <div>
        ${aboveMA ? '✅' : '❌'}
        מחיר מעל MA200
      </div>

      <div>
        ${minimumPassed ? '✅' : '❌'}
        גל ≥ ${fmt(minWave)}%
      </div>

      <div>
        ${reversalConfirmed ? '✅' : '❌'}
        גל עולה גדול מהגל היורד הקודם
      </div>

    `;
  }


  /* EXECUTION */

  put(
    '#execution',
    agent.execution || '—'
  );


  /* ERROR */

  put(
    '#error',
    agent.lastError || ''
  );
}


/* =========================
   LOAD DASHBOARD
========================= */

async function load() {

  try {

    put(
      '#status',
      'מתחבר…'
    );


    /*
      Load MODE
    */

    const mode =
      await getJSON(MODE);

    renderMode(mode);


    /*
      Load AGENT
    */

    const agent =
      await getJSON(AGENT);

    renderAgent(agent);


  }
  catch (error) {

    console.error(
      'Dashboard load error:',
      error
    );


    put(
      '#status',
      'שרת לא זמין'
    );


    put(
      '#error',
      error.message
    );
  }
}


/* =========================
   CHANGE MODE
========================= */

async function setMode(
  requestedMode
) {

  try {

    /*
      קודם בודקים את המצב
      הנוכחי של השרת
    */

    const current =
      await getJSON(MODE);


    /*
      אם כבר נמצאים במצב
      המבוקש אין צורך POST
    */

    if (
      current.mode ===
      requestedMode
    ) {

      renderMode(current);


      const agent =
        await getJSON(AGENT);

      renderAgent(agent);

      return;
    }


    /*
      LIVE CONFIRMATION
    */

    if (
      requestedMode === 'live'
    ) {

      const approved =
        confirm(
          'לעבור ל-LIVE?\n\n' +
          'מסחר אמיתי יתאפשר רק אם ' +
          'השרת הוגדר לכך במפורש.'
        );


      if (!approved) {
        return;
      }
    }


    /*
      SEND MODE CHANGE
    */

    const response =
      await fetch(
        MODE,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              mode:
                requestedMode
            })
        }
      );


    if (!response.ok) {

      throw new Error(
        `Mode HTTP ${
          response.status
        }`
      );
    }


    /*
      REFRESH
    */

    await load();

  }
  catch (error) {

    console.error(
      'Mode change failed:',
      error
    );


    alert(
      'שגיאה במעבר מצב: ' +
      error.message
    );
  }
}


/* =========================
   MANUAL EVALUATE
========================= */

async function evaluateNow() {

  try {

    put(
      '#error',
      ''
    );


    const response =
      await fetch(
        EVALUATE,
        {
          method: 'POST'
        }
      );


    if (!response.ok) {

      throw new Error(
        `Evaluate HTTP ${
          response.status
        }`
      );
    }


    await load();

  }
  catch (error) {

    console.error(
      'Evaluate error:',
      error
    );


    put(
      '#error',
      error.message
    );
  }
}


/* =========================
   BUTTONS
========================= */

const demoBtn =
  $('#demoBtn');

const liveBtn =
  $('#liveBtn');

const refreshBtn =
  $('#refreshBtn');


if (demoBtn) {

  demoBtn.addEventListener(
    'click',
    () => setMode('demo')
  );
}


if (liveBtn) {

  liveBtn.addEventListener(
    'click',
    () => setMode('live')
  );
}


if (refreshBtn) {

  refreshBtn.addEventListener(
    'click',
    evaluateNow
  );
}


const resetPaperBtn = $('#resetPaperBtn');
if (resetPaperBtn) resetPaperBtn.addEventListener('click', async () => {
  if (!confirm('לאפס את תיק ה-DEMO ל-5,000 ₪?')) return;
  try {
    await getJSON('/api/binance-paper/reset', {method:'POST'});
    await load();
  } catch (error) { put('#error', error.message); }
});

/* =========================
   START
========================= */

load();


/*
  רענון אוטומטי
  כל 30 שניות
*/

setInterval(
  load,
  30000
);
