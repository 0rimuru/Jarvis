// ============================================================
// JARVIS — App Logic
// ============================================================

const STORAGE_KEYS = {
  apiKey: 'jarvis_api_key',
  history: 'jarvis_chat_history',
  watchlist: 'jarvis_watchlist',
  voice: 'jarvis_voice_enabled'
};

// ---------- Storage helpers (localStorage works fine, this is a real Safari web app) ----------
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

let chatHistory = loadJSON(STORAGE_KEYS.history, []);
let watchlist = loadJSON(STORAGE_KEYS.watchlist, []);
let apiKey = localStorage.getItem(STORAGE_KEYS.apiKey) || '';
let voiceEnabled = loadJSON(STORAGE_KEYS.voice, false);

// ============================================================
// TAB NAVIGATION
// ============================================================
const tabs = document.querySelectorAll('nav.tabs button');
const views = document.querySelectorAll('.view');
tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.view;
    views.forEach(v => v.classList.remove('active'));
    document.getElementById('view-' + target).classList.add('active');
    if (target === 'markets') {
      renderWatchlist();
      loadSentiment();
    }
  });
});

// ============================================================
// STATUS INDICATOR
// ============================================================
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
function setStatus(state) {
  const orbCoreEl = document.getElementById('orbCore');
  const orbStatusEl = document.getElementById('orbStatusText');
  if (state === 'thinking') {
    statusDot.classList.add('thinking');
    statusText.textContent = 'denkt nach';
    if (orbCoreEl) { orbCoreEl.classList.add('thinking'); orbCoreEl.classList.remove('listening'); }
    if (orbStatusEl) orbStatusEl.textContent = 'Denkt nach…';
  } else if (state === 'listening') {
    statusDot.classList.add('thinking');
    statusText.textContent = 'hört zu';
    if (orbCoreEl) { orbCoreEl.classList.add('listening'); orbCoreEl.classList.remove('thinking'); }
    if (orbStatusEl) orbStatusEl.textContent = 'Hört zu…';
  } else if (state === 'error') {
    statusDot.classList.remove('thinking');
    statusDot.style.background = 'var(--red)';
    statusDot.style.boxShadow = '0 0 8px var(--red)';
    statusText.textContent = 'fehler';
    if (orbCoreEl) { orbCoreEl.classList.remove('thinking'); orbCoreEl.classList.remove('listening'); }
    if (orbStatusEl) orbStatusEl.textContent = 'Fehler';
  } else {
    statusDot.classList.remove('thinking');
    statusDot.style.background = 'var(--cyan)';
    statusDot.style.boxShadow = '0 0 8px var(--cyan)';
    statusText.textContent = 'bereit';
    if (orbCoreEl) { orbCoreEl.classList.remove('thinking'); orbCoreEl.classList.remove('listening'); }
    if (orbStatusEl) orbStatusEl.textContent = 'Bereit';
  }
}

// ============================================================
// CHAT RENDERING — single exchange card (no scroll history)
// ============================================================
const exchangeCard = document.getElementById('exchangeCard');
const exchangeEmpty = document.getElementById('exchangeEmpty');
const exchangeContent = document.getElementById('exchangeContent');
const lastUserText = document.getElementById('lastUserText');
const lastAssistantText = document.getElementById('lastAssistantText');
const orbCore = document.getElementById('orbCore');
const orbStatusText = document.getElementById('orbStatusText');

function renderHistory() {
  // Show only the most recent exchange, if any exists from a previous session.
  const lastUser = [...chatHistory].reverse().find(m => m.role === 'user');
  const lastAssistant = [...chatHistory].reverse().find(m => m.role === 'assistant');
  if (lastUser || lastAssistant) {
    showExchange(lastUser ? lastUser.content : '', lastAssistant ? lastAssistant.content : '', false);
  } else {
    showEmptyExchange();
  }
}

function showEmptyExchange() {
  exchangeEmpty.style.display = 'block';
  exchangeContent.style.display = 'none';
}

function showExchange(userText, assistantText, isError = false) {
  exchangeEmpty.style.display = 'none';
  exchangeContent.style.display = 'flex';
  lastUserText.textContent = userText || '';
  lastAssistantText.textContent = assistantText || '';
  lastAssistantText.classList.toggle('error', isError);
}

function showTypingInExchange(userText) {
  exchangeEmpty.style.display = 'none';
  exchangeContent.style.display = 'flex';
  lastUserText.textContent = userText;
  lastAssistantText.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div>`;
  lastAssistantText.classList.remove('error');
}

// ============================================================
// CLAUDE API CALL (with web search tool)
// ============================================================
async function callJarvis(userText) {
  if (!apiKey) {
    return { error: true, text: "Ich brauche zuerst einen API-Key. Geh zu Einstellungen → Anthropic API-Key und trag ihn dort ein." };
  }

  const systemPrompt = `Du bist Jarvis, ein persönlicher KI-Assistent in einer iPhone-Web-App, gesprochen und geschrieben auf Deutsch (außer der Nutzer wechselt die Sprache). Du bist hilfsbereit, klar, ein wenig trocken-humorvoll, aber nie aufdringlich. Du hast Zugriff auf Websuche für aktuelle Informationen — nutze sie, wenn der Nutzer nach aktuellen Ereignissen, Kursen, News oder Dingen fragt, die sich ändern können. Halte Antworten so kurz wie möglich, da sie auf einem Handy-Bildschirm und teils per Sprachausgabe vorgelesen werden — meist 2-4 Sätze, außer der Nutzer will es ausführlicher. Bei Finanzthemen (Aktien, Crypto) gibst du niemals konkrete Kauf- oder Verkaufsempfehlungen oder Trading-Signale, sondern nur Fakten und Einordnung; du bist kein Finanzberater und sagst das bei Bedarf kurz dazu.`;

  const apiMessages = chatHistory
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }))
    .concat([{ role: 'user', content: userText }]);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: systemPrompt,
        messages: apiMessages,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      let msg = 'Unbekannter API-Fehler.';
      if (response.status === 401) msg = 'Der API-Key scheint ungültig zu sein. Bitte in den Einstellungen prüfen.';
      else if (response.status === 429) msg = 'Zu viele Anfragen oder Rate-Limit erreicht. Kurz warten und nochmal versuchen.';
      else if (response.status === 400) msg = 'Die Anfrage war fehlerhaft: ' + errBody.slice(0, 150);
      return { error: true, text: msg };
    }

    const data = await response.json();
    const textParts = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    return { error: false, text: textParts || '(keine Antwort erhalten)' };
  } catch (e) {
    return { error: true, text: 'Konnte keine Verbindung herstellen. Prüf deine Internetverbindung und den API-Key.' };
  }
}

// ============================================================
// SEND MESSAGE FLOW
// ============================================================
const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');
const keyboardToggle = document.getElementById('keyboardToggle');
const textInputRow = document.getElementById('textInputRow');
const talkBarEl = document.querySelector('.talk-bar');

textInput.addEventListener('input', () => {
  textInput.style.height = 'auto';
  textInput.style.height = Math.min(textInput.scrollHeight, 100) + 'px';
});

// Toggle between the big "talk to jarvis" pill and a text input row
let keyboardMode = false;
keyboardToggle.addEventListener('click', () => {
  keyboardMode = !keyboardMode;
  if (keyboardMode) {
    talkBarEl.querySelector('.talk-pill').style.display = 'none';
    sendBtn.style.display = 'flex';
    textInputRow.style.display = 'block';
    textInput.focus();
  } else {
    talkBarEl.querySelector('.talk-pill').style.display = 'flex';
    sendBtn.style.display = 'none';
    textInputRow.style.display = 'none';
  }
});

async function sendMessage(text) {
  text = text.trim();
  if (!text) return;

  chatHistory.push({ role: 'user', content: text });
  saveJSON(STORAGE_KEYS.history, chatHistory);

  textInput.value = '';
  textInput.style.height = 'auto';
  sendBtn.disabled = true;
  setStatus('thinking');
  showTypingInExchange(text);

  const result = await callJarvis(text);

  sendBtn.disabled = false;

  if (result.error) {
    setStatus('error');
    showExchange(text, result.text, true);
    setTimeout(() => setStatus('idle'), 2500);
  } else {
    setStatus('idle');
    showExchange(text, result.text, false);
    chatHistory.push({ role: 'assistant', content: result.text });
    saveJSON(STORAGE_KEYS.history, chatHistory);
    if (voiceEnabled) speakText(result.text);
  }
}

sendBtn.addEventListener('click', () => sendMessage(textInput.value));
textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(textInput.value);
  }
});

document.querySelectorAll('.quick-chip').forEach(chip => {
  chip.addEventListener('click', () => sendMessage(chip.dataset.q));
});

// ============================================================
// VOICE INPUT (Web Speech API — Safari iOS supports webkitSpeechRecognition)
// Triggered by tapping the orb core OR the "TALK TO JARVIS" pill.
// ============================================================
const micBtn = document.getElementById('micBtn');
const micWave = document.getElementById('micWave');
const talkPillLabel = document.getElementById('talkPillLabel');
let recognition = null;
let isListening = false;

function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;
  const rec = new SpeechRecognition();
  rec.lang = 'de-DE';
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  return rec;
}

function startListening() {
  if (isListening) {
    if (recognition) recognition.stop();
    return;
  }
  recognition = setupRecognition();
  if (!recognition) {
    showExchange('', "Spracherkennung wird auf diesem Gerät/Browser nicht unterstützt. Nutze am besten Safari auf dem iPhone.", true);
    return;
  }

  isListening = true;
  micBtn.classList.add('listening');
  orbCore.classList.add('listening');
  talkPillLabel.textContent = 'HÖRT ZU…';
  setStatus('listening');

  recognition.start();

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    sendMessage(transcript);
  };

  recognition.onerror = () => {
    setStatus('idle');
  };

  recognition.onend = () => {
    isListening = false;
    micBtn.classList.remove('listening');
    orbCore.classList.remove('listening');
    talkPillLabel.textContent = 'TALK TO JARVIS';
    if (statusText.textContent === 'hört zu') setStatus('idle');
  };
}

micBtn.addEventListener('click', startListening);
orbCore.addEventListener('click', startListening);

// ---------- live clock in the chat header ----------
const clockStat = document.getElementById('clockStat');
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  clockStat.textContent = `${h}:${m}`;
}
updateClock();
setInterval(updateClock, 30000);

// ============================================================
// VOICE OUTPUT (SpeechSynthesis)
// ============================================================
function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'de-DE';
  utter.rate = 1.02;
  window.speechSynthesis.speak(utter);
}

// ============================================================
// MARKETS — Crypto via CoinGecko (free, no key), Stocks via Stooq (free, no key)
// ============================================================
const watchlistContainer = document.getElementById('watchlistContainer');
const symbolInput = document.getElementById('symbolInput');
const addSymbolBtn = document.getElementById('addSymbolBtn');

addSymbolBtn.addEventListener('click', () => addToWatchlist(symbolInput.value));
symbolInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addToWatchlist(symbolInput.value);
});

function addToWatchlist(raw) {
  const val = raw.trim();
  if (!val) return;
  const entry = { id: val.toLowerCase(), label: val };
  if (watchlist.find(w => w.id === entry.id)) { symbolInput.value=''; return; }
  watchlist.push(entry);
  saveJSON(STORAGE_KEYS.watchlist, watchlist);
  symbolInput.value = '';
  renderWatchlist();
}

function removeFromWatchlist(id) {
  watchlist = watchlist.filter(w => w.id !== id);
  saveJSON(STORAGE_KEYS.watchlist, watchlist);
  renderWatchlist();
}

async function renderWatchlist() {
  if (watchlist.length === 0) {
    watchlistContainer.innerHTML = `<div class="empty-state">KEINE DATEN\nFüg oben einen Coin (z.B. "bitcoin") oder eine Aktie (z.B. "AAPL") hinzu.</div>`;
    return;
  }
  watchlistContainer.innerHTML = watchlist.map(w => `
    <div class="ticker-card" id="ticker-${cssSafe(w.id)}">
      <div class="ticker-left">
        <div class="ticker-symbol">${escapeHtml(w.label.toUpperCase())}</div>
        <div class="ticker-name">lädt…</div>
      </div>
      <div class="ticker-right">
        <div class="loading-line" style="width:60px; height:16px;"></div>
      </div>
      <button class="ticker-remove" data-id="${escapeHtml(w.id)}">×</button>
    </div>
  `).join('');

  watchlistContainer.querySelectorAll('.ticker-remove').forEach(btn => {
    btn.addEventListener('click', () => removeFromWatchlist(btn.dataset.id));
  });

  for (const w of watchlist) {
    fetchPriceFor(w);
  }
}

function cssSafe(s) { return s.replace(/[^a-z0-9]/gi, '_'); }
function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function fetchPriceFor(entry) {
  // Try CoinGecko first (covers crypto by id, e.g. "bitcoin", "solana", "ethereum")
  try {
    const cgRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(entry.id)}&vs_currencies=eur&include_24hr_change=true`);
    const cgData = await cgRes.json();
    if (cgData && cgData[entry.id]) {
      const price = cgData[entry.id].eur;
      const change = cgData[entry.id].eur_24h_change;
      updateTickerCard(entry, entry.label, price, change, '€', 'Crypto');
      return;
    }
  } catch (e) { /* fall through to stock lookup */ }

  // Fallback: try as a stock ticker via Stooq (free, no key, CSV format)
  try {
    const symbol = entry.id.toLowerCase();
    const stooqRes = await fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}.us&f=sd2t2ohlcv&h&e=csv`);
    const csvText = await stooqRes.text();
    const lines = csvText.trim().split('\n');
    if (lines.length >= 2) {
      const headers = lines[0].split(',');
      const values = lines[1].split(',');
      const closeIdx = headers.indexOf('Close');
      const openIdx = headers.indexOf('Open');
      if (closeIdx !== -1 && values[closeIdx] && values[closeIdx] !== 'N/D') {
        const close = parseFloat(values[closeIdx]);
        const open = parseFloat(values[openIdx]);
        const change = open ? ((close - open) / open) * 100 : 0;
        updateTickerCard(entry, entry.label.toUpperCase(), close, change, '$', 'Aktie');
        return;
      }
    }
  } catch (e) { /* ignore */ }

  // Nothing found
  const card = document.getElementById(`ticker-${cssSafe(entry.id)}`);
  if (card) {
    card.querySelector('.ticker-name').textContent = 'nicht gefunden';
    card.querySelector('.ticker-right').innerHTML = `<div class="ticker-price" style="color:var(--text-faint); font-size:13px;">—</div>`;
  }
}

function updateTickerCard(entry, name, price, changePct, currency, typeLabel) {
  const card = document.getElementById(`ticker-${cssSafe(entry.id)}`);
  if (!card) return;
  const up = changePct >= 0;
  card.querySelector('.ticker-name').textContent = typeLabel;
  card.querySelector('.ticker-right').innerHTML = `
    <div class="ticker-price">${currency}${formatPrice(price)}</div>
    <div class="ticker-change ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(changePct).toFixed(2)}%</div>
  `;
}

function formatPrice(p) {
  if (p === undefined || p === null || isNaN(p)) return '—';
  if (p >= 1000) return p.toLocaleString('de-DE', { maximumFractionDigits: 0 });
  if (p >= 1) return p.toLocaleString('de-DE', { maximumFractionDigits: 2 });
  return p.toLocaleString('de-DE', { maximumFractionDigits: 6 });
}

// ---------- Sentiment (Fear & Greed Index, free public API) ----------
const sentimentContainer = document.getElementById('sentimentContainer');
document.getElementById('refreshSentiment').addEventListener('click', loadSentiment);

async function loadSentiment() {
  sentimentContainer.innerHTML = `<div class="loading-line" style="width:100%; margin-bottom:8px;"></div><div class="loading-line" style="width:70%;"></div>`;
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1');
    const data = await res.json();
    const fng = data.data[0];
    const value = parseInt(fng.value);
    const classification = fng.value_classification;
    let color = 'var(--text-dim)';
    if (value <= 25) color = 'var(--red)';
    else if (value <= 45) color = 'var(--amber)';
    else if (value >= 55) color = 'var(--accent)';

    sentimentContainer.innerHTML = `
      <div class="news-card">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div>
            <div class="ticker-name" style="margin-bottom:4px;">Crypto Fear &amp; Greed Index</div>
            <div style="font-family:'IBM Plex Mono'; font-size:28px; font-weight:600; color:${color};">${value}</div>
          </div>
          <div style="font-family:'Space Grotesk'; font-weight:600; color:${color}; font-size:14px; text-align:right;">${translateClassification(classification)}</div>
        </div>
      </div>
    `;
  } catch (e) {
    sentimentContainer.innerHTML = `<div class="empty-state">Stimmungsdaten konnten nicht geladen werden.</div>`;
  }
}

function translateClassification(c) {
  const map = {
    'Extreme Fear': 'Extreme Angst',
    'Fear': 'Angst',
    'Neutral': 'Neutral',
    'Greed': 'Gier',
    'Extreme Greed': 'Extreme Gier'
  };
  return map[c] || c;
}

// ============================================================
// TRENDS — uses Claude + web_search to summarize current market chatter
// ============================================================
const trendsContainer = document.getElementById('trendsContainer');
document.getElementById('refreshTrends').addEventListener('click', loadTrends);

async function loadTrends() {
  if (!apiKey) {
    trendsContainer.innerHTML = `<div class="empty-state">Trag zuerst deinen API-Key unter Einstellungen ein.</div>`;
    return;
  }
  trendsContainer.innerHTML = `<div class="loading-line" style="width:100%; margin-bottom:8px;"></div><div class="loading-line" style="width:90%; margin-bottom:8px;"></div><div class="loading-line" style="width:60%;"></div>`;

  const systemPrompt = `Du bist ein Markt-Trend-Scanner. Durchsuche aktuelle News zu Krypto und Aktienmärkten und fasse die 4-6 Themen zusammen, über die gerade am meisten gesprochen wird (Trends, Narrative, auffällige Bewegungen). Antworte AUSSCHLIESSLICH als JSON-Array, keine Erklärung, keine Markdown-Backticks. Format: [{"title": "Kurzer Titel", "summary": "1-2 Sätze Einordnung auf Deutsch, neutral und sachlich, ohne Kauf-/Verkaufsempfehlung", "tag": "Crypto" oder "Aktien"}]`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Was sind gerade die größten Trends und Gesprächsthemen an den Krypto- und Aktienmärkten? Suche aktuelle News.' }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }]
      })
    });

    if (!response.ok) {
      trendsContainer.innerHTML = `<div class="empty-state">Trends konnten nicht geladen werden (API-Fehler ${response.status}). Prüf deinen API-Key.</div>`;
      return;
    }

    const data = await response.json();
    const textParts = data.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

    let cleaned = textParts.replace(/```json|```/g, '').trim();
    let trends;
    try {
      trends = JSON.parse(cleaned);
    } catch (e) {
      // fallback: show raw text if JSON parse fails
      trendsContainer.innerHTML = `<div class="news-card"><div class="news-title">${escapeHtml(textParts)}</div></div>`;
      return;
    }

    if (!Array.isArray(trends) || trends.length === 0) {
      trendsContainer.innerHTML = `<div class="empty-state">Keine aktuellen Trends gefunden.</div>`;
      return;
    }

    trendsContainer.innerHTML = trends.map(t => `
      <div class="news-card">
        <div class="news-meta">${escapeHtml(t.tag || 'Markt')}</div>
        <div class="news-title" style="font-weight:600; margin-top:4px;">${escapeHtml(t.title || '')}</div>
        <div class="news-title" style="color:var(--text-dim); font-size:13px;">${escapeHtml(t.summary || '')}</div>
      </div>
    `).join('') + `<div class="disclaimer-box">Das sind Gesprächsthemen, keine Kaufsignale. Trends können bereits vorbei sein, wenn du sie liest — eigene Recherche bleibt nötig.</div>`;

  } catch (e) {
    trendsContainer.innerHTML = `<div class="empty-state">Verbindung fehlgeschlagen. Internet prüfen und nochmal versuchen.</div>`;
  }
}

// ============================================================
// SETTINGS
// ============================================================
const apiKeyInput = document.getElementById('apiKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const voiceToggle = document.getElementById('voiceToggle');
const clearDataBtn = document.getElementById('clearDataBtn');

if (apiKey) apiKeyInput.placeholder = 'Key gespeichert (••••••••)';
voiceToggle.checked = voiceEnabled;

saveKeyBtn.addEventListener('click', () => {
  const val = apiKeyInput.value.trim();
  if (val) {
    apiKey = val;
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    apiKeyInput.value = '';
    apiKeyInput.placeholder = 'Key gespeichert (••••••••)';
    saveKeyBtn.textContent = 'Gespeichert ✓';
    setTimeout(() => { saveKeyBtn.textContent = 'Speichern'; }, 1500);
  }
});

voiceToggle.addEventListener('change', () => {
  voiceEnabled = voiceToggle.checked;
  saveJSON(STORAGE_KEYS.voice, voiceEnabled);
});

clearDataBtn.addEventListener('click', () => {
  if (confirm('Wirklich allen Chatverlauf und die Watchlist löschen? Das kann nicht rückgängig gemacht werden.')) {
    localStorage.removeItem(STORAGE_KEYS.history);
    localStorage.removeItem(STORAGE_KEYS.watchlist);
    chatHistory = [];
    watchlist = [];
    renderHistory();
    renderWatchlist();
  }
});

// ============================================================
// INIT
// ============================================================
renderHistory();
