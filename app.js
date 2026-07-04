/* =============================================
   ECHO — English Learning App
   app.js — Complete Application Logic
   ============================================= */

'use strict';

// ============ CONSTANTS ============
const DAYS = ['lunes','martes','miercoles','jueves','viernes','sabado','domingo'];
const DAY_LABELS = { lunes:'Monday', martes:'Tuesday', miercoles:'Wednesday', jueves:'Thursday', viernes:'Friday', sabado:'Saturday', domingo:'Sunday' };
const DAY_META = {
  lunes:    { icon: 'auto_stories', subtitle: 'Base grammar review' },
  martes:   { icon: 'work',         subtitle: 'Business vocabulary' },
  miercoles:{ icon: 'flight',       subtitle: 'Essential travel phrases' },
  jueves:   { icon: 'forum',        subtitle: 'Everyday dialogues' },
  viernes:  { icon: 'star',         subtitle: 'Idiomatic expressions' },
  sabado:   { icon: 'theaters',     subtitle: 'Culture & entertainment' },
  domingo:  { icon: 'weekend',      subtitle: 'Free review' },
};
const DECK_TARGET = 10;

const PHRASE_BANK = [
  "These days, I'm pretty busy with my routine.",
  "Right now I'm just here, talking to myself.",
  "Today I want to talk about my daily routine.",
  "I've been trying to improve my English every day.",
  "Let me tell you about something that happened today.",
  "I think the most important thing right now is to practice.",
  "Every morning, I wake up and try to think in English.",
  "I want to describe my room and everything in it.",
  "Something I find challenging about English is the pronunciation.",
  "I'm going to try to speak for one full minute without stopping.",
  "Let me talk about a movie I watched recently.",
  "I have a lot of things on my mind today.",
  "One of my favorite things about learning English is the music.",
  "I want to improve my English so I can travel more.",
  "Let me tell you about my plans for this week.",
];

const AC = {
  "i have": ["I have a dog.", "I have been studying for two hours.", "I have never been to London."],
  "i want": ["I want to improve my English.", "I want to travel someday.", "I want to tell you something."],
  "i think": ["I think English is fascinating.", "I think I need more practice.", "I think the best way to learn is to speak."],
  "i can": ["I can speak a little English.", "I can understand most things.", "I can try to explain."],
  "i would": ["I would like to learn more.", "I would love to travel.", "I would say it's getting easier."],
  "there is": ["There is a big difference.", "There is something I want to say.", "There is a lot to learn."],
  "i need": ["I need to practice more.", "I need to improve my pronunciation.", "I need to listen more carefully."],
};

// ============ INDEXEDDB ============
let db;

function openDB() {
  return new Promise((res, rej) => {
    if (db) return res(db);
    const req = indexedDB.open('EchoDB', 3);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('phrases')) {
        d.createObjectStore('phrases', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('estructuras')) {
        d.createObjectStore('estructuras', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('audio')) {
        const as = d.createObjectStore('audio', { keyPath: 'id', autoIncrement: true });
        as.createIndex('byPhrase', 'phraseId');
        as.createIndex('byPhraseRole', ['phraseId','role']);
      }
      if (!d.objectStoreNames.contains('mazos')) {
        d.createObjectStore('mazos', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('stats')) {
        d.createObjectStore('stats', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('cfg')) {
        d.createObjectStore('cfg', { keyPath: 'id' });
      }
    };
    req.onsuccess = e => { db = e.target.result; res(db); };
    req.onerror = () => rej(req.error);
  });
}

function idbGet(store, key) {
  return openDB().then(d => new Promise((res, rej) => {
    const tx = d.transaction(store, 'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

function idbPut(store, value) {
  return openDB().then(d => new Promise((res, rej) => {
    const tx = d.transaction(store, 'readwrite');
    const r = tx.objectStore(store).put(value);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

function idbDelete(store, key) {
  return openDB().then(d => new Promise((res, rej) => {
    const tx = d.transaction(store, 'readwrite');
    const r = tx.objectStore(store).delete(key);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  }));
}

function idbGetAll(store) {
  return openDB().then(d => new Promise((res, rej) => {
    const tx = d.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

function idbGetByIndex(store, index, value) {
  return openDB().then(d => new Promise((res, rej) => {
    const tx = d.transaction(store, 'readonly');
    const r = tx.objectStore(store).index(index).getAll(value);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

async function saveAudioBlob(phraseId, role, blob, name) {
  const existing = await getAudioRecord(phraseId, role);
  if (existing) await idbDelete('audio', existing.id);
  return idbPut('audio', { phraseId, role, blob, name: name || role, created: Date.now() });
}

async function getAudioRecord(phraseId, role) {
  const results = await idbGetByIndex('audio', 'byPhraseRole', [phraseId, role]);
  return results[0] || null;
}

async function deleteAudioForPhrase(phraseId) {
  const records = await idbGetByIndex('audio', 'byPhrase', phraseId);
  for (const r of records) await idbDelete('audio', r.id);
}

function blobURL(blob) {
  return URL.createObjectURL(blob);
}

// ============ STATE ============
let state = {
  currentTab: 'library',
  currentDay: null,
  phrases: [],
  mazos: {},
  estructuras: [],
  stats: { sessions: 0, minutes: 0, avgPronun: 0, pronunCount: 0, streak: 0, lastDate: null },
  cfg: { notifEnabled: false, notifTime: '09:00', userName: 'Your name', geminiApiKey: '', aiProvider: null },
  repaso: { phraseId: null, step: 0, audio: null },
  pronun: { phraseId: null, recognition: null, listening: false },
  dictado: { recognition: null, active: false, finalText: '', currentPhrase: '' },
  estrColor: '#10b981',
  estrEditId: null,
  phraseEditId: null,
  pfRecorder: null,
  pfRecordingBlob: null,
  efRecorder: null,
  efRecordingBlob: null,
};

// Active audio players registry
const activePlayers = new Map();

// ============ TOAST ============
const TOAST_ICONS = { success: 'check_circle', error: 'error', info: 'info' };

function toast(msg, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon-wrap"><span class="msi">${TOAST_ICONS[type] || TOAST_ICONS.info}</span></span>
    <span class="toast-msg"></span>
    <button class="toast-close" aria-label="Close" type="button">×</button>
    <span class="toast-progress" style="animation-duration:${duration}ms"></span>
  `;
  el.querySelector('.toast-msg').textContent = msg;
  container.appendChild(el);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.classList.add('hide');
    setTimeout(() => el.remove(), 220);
  };

  el.querySelector('.toast-close').addEventListener('click', dismiss);
  setTimeout(dismiss, duration);
}

// ============ AUDIO PLAYER COMPONENT ============
function createAudioPlayer(blob, opts = {}) {
  const { showLoop = true, showSpeed = true, id = Math.random().toString(36).slice(2) } = opts;
  const url = blobURL(blob);
  const audio = new Audio(url);
  audio.preload = 'metadata';

  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  let speedIdx = 2;
  let looping = false;

  const wrap = document.createElement('div');
  wrap.className = 'audio-player';
  wrap.dataset.playerId = id;

  const playBtn = document.createElement('button');
  playBtn.className = 'ap-btn';
  playBtn.textContent = '▶';

  const progressWrap = document.createElement('div');
  progressWrap.className = 'ap-progress-wrap';
  const progressTrack = document.createElement('div');
  progressTrack.className = 'ap-progress-track';
  const progressFill = document.createElement('div');
  progressFill.className = 'ap-progress-fill';
  progressTrack.appendChild(progressFill);
  progressWrap.appendChild(progressTrack);

  const timeEl = document.createElement('div');
  timeEl.className = 'ap-time';
  timeEl.textContent = '0:00 / 0:00';

  const speedBtn = document.createElement('button');
  speedBtn.className = 'ap-speed';
  speedBtn.textContent = '1×';

  const loopBtn = document.createElement('button');
  loopBtn.className = 'ap-btn ap-loop';
  loopBtn.textContent = '↺';
  loopBtn.title = 'Loop';

  function fmtTime(s) {
    if (isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2,'0')}`;
  }

  audio.addEventListener('loadedmetadata', () => {
    timeEl.textContent = `0:00 / ${fmtTime(audio.duration)}`;
  });

  audio.addEventListener('timeupdate', () => {
    const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    progressFill.style.width = pct + '%';
    timeEl.textContent = `${fmtTime(audio.currentTime)} / ${fmtTime(audio.duration)}`;
  });

  audio.addEventListener('play', () => { playBtn.innerHTML = '<span class="msi">pause</span>'; });
  audio.addEventListener('pause', () => { playBtn.textContent = '▶'; });

  audio.addEventListener('ended', () => {
    playBtn.textContent = '▶';
    if (looping) {
      setTimeout(() => audio.play(), 300);
      if (opts.onLoop) opts.onLoop();
    } else {
      if (opts.onEnd) opts.onEnd();
    }
  });

  playBtn.addEventListener('click', () => {
    // Pause any other player
    activePlayers.forEach((ap, pid) => { if (pid !== id) ap.pause(); });
    if (audio.paused) audio.play();
    else audio.pause();
  });

  progressWrap.addEventListener('click', e => {
    const rect = progressTrack.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = audio.duration * ratio;
  });

  if (showSpeed) {
    speedBtn.addEventListener('click', () => {
      speedIdx = (speedIdx + 1) % speeds.length;
      audio.playbackRate = speeds[speedIdx];
      speedBtn.textContent = speeds[speedIdx] + '×';
    });
  }

  if (showLoop) {
    loopBtn.addEventListener('click', () => {
      looping = !looping;
      loopBtn.classList.toggle('active', looping);
    });
  }

  wrap.appendChild(playBtn);
  wrap.appendChild(progressWrap);
  wrap.appendChild(timeEl);
  if (showSpeed) wrap.appendChild(speedBtn);
  if (showLoop) wrap.appendChild(loopBtn);

  const api = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    stop: () => { audio.pause(); audio.currentTime = 0; },
    setLoop: v => { looping = v; loopBtn.classList.toggle('active', v); },
    isLooping: () => looping,
    el: wrap,
    audio,
    id,
  };

  activePlayers.set(id, api);
  return api;
}

async function renderAudioPlayer(containerId, phraseId, role, opts = {}) {
  const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
  if (!container) return null;
  container.innerHTML = '';
  const rec = await getAudioRecord(phraseId, role);
  if (!rec) return null;
  const player = createAudioPlayer(rec.blob, opts);
  container.appendChild(player.el);
  return player;
}

// ============ NAVIGATION ============
function switchTab(tab) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.tab === tab);
  });
  const el = document.getElementById('tab-' + tab);
  if (el) el.classList.add('active');
  state.currentTab = tab;

  const titles = { library:'Decks', repaso:'Review', pronun:'Pronunciation', estructuras:'Structures', dictado:'Dictation', settings:'Settings' };
  document.getElementById('page-title').textContent = titles[tab] || tab;

  // Stop ongoing activities
  stopDictado();
  stopPronun();

  if (tab === 'library') renderDecks();
  if (tab === 'repaso') populateRepasoSelect();
  if (tab === 'pronun') populatePronunSelect();
  if (tab === 'estructuras') renderEstructuras();
  if (tab === 'settings') loadSettings();

  // Mobile: close sidebar
  closeSidebar();
}

// ============ SIDEBAR ============
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('visible');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
}

// ============ LIBRARY ============
async function loadData() {
  state.phrases = await idbGetAll('phrases');
  const mazoRecords = await idbGetAll('mazos');
  state.mazos = {};
  for (const m of mazoRecords) state.mazos[m.id] = m.phraseIds || [];
  state.estructuras = await idbGetAll('estructuras');
  const statsRec = await idbGet('stats', 'main');
  if (statsRec) state.stats = { ...state.stats, ...statsRec };
  const cfgRec = await idbGet('cfg', 'main');
  if (cfgRec) state.cfg = { ...state.cfg, ...cfgRec };
  renderGreeting();
}

function renderGreeting() {
  const el = document.getElementById('home-username');
  if (el) el.textContent = state.cfg.userName || 'Your name';
  renderProgressHero();
}

function renderProgressHero() {
  const streak = state.stats.streak || 0;
  const sessions = state.stats.sessions || 0;
  const minutes = state.stats.minutes || 0;

  const numEl = document.getElementById('progress-hero-streak');
  const labelEl = document.getElementById('progress-hero-streak-label');
  const subEl = document.getElementById('progress-hero-subtitle');
  const weekEl = document.getElementById('progress-hero-week');
  if (!numEl) return;

  numEl.textContent = streak;
  labelEl.textContent = 'day streak';

  if (streak > 0) {
    subEl.textContent = `You've done ${sessions} session${sessions === 1 ? '' : 's'} and practiced ${minutes} min. Keep it up!`;
  } else {
    subEl.textContent = 'Practice today to start your streak.';
  }

  const dayLetters = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const filled = streak > 0 ? (((streak - 1) % 7) + 1) : 0;
  weekEl.innerHTML = dayLetters.map((letter, i) => {
    const cls = i < filled ? 'progress-hero-day filled' : 'progress-hero-day';
    return `<span class="${cls}">${letter}</span>`;
  }).join('');
}

function renderDecks() {
  renderGreeting();
  const grid = document.getElementById('deck-grid');
  grid.innerHTML = '';
  for (const day of DAYS) {
    const phraseIds = state.mazos[day] || [];
    const count = phraseIds.filter(id => state.phrases.find(p => p.id === id)).length;
    const meta = DAY_META[day] || { icon: 'auto_stories', subtitle: '' };
    const pct = Math.min(100, Math.round((count / DECK_TARGET) * 100));
    const card = document.createElement('div');
    card.className = 'deck-card';
    card.innerHTML = `
      <div class="deck-card-top">
        <div class="deck-card-icon"><span class="msi">${meta.icon}</span></div>
        <div class="deck-progress-label">PROGRESO<br><b>${count}/${DECK_TARGET}</b></div>
      </div>
      <div class="deck-title">${DAY_LABELS[day]}</div>
      <div class="deck-subtitle">${meta.subtitle}</div>
      <div class="deck-progress-bar"><div class="deck-progress-fill" style="width:${pct}%"></div></div>
    `;
    card.addEventListener('click', () => openDeckView(day));
    grid.appendChild(card);
  }
}

async function openDeckView(day) {
  state.currentDay = day;
  document.getElementById('library-deck-view').classList.add('hidden');
  document.getElementById('library-card-view').classList.remove('hidden');
  document.getElementById('deck-view-title').textContent = DAY_LABELS[day];
  await renderPhraseCards(day);
}

async function renderPhraseCards(day, filter = '', audioOnly = false) {
  const grid = document.getElementById('phrase-grid');
  grid.innerHTML = '';
  const phraseIds = state.mazos[day] || [];
  let phrases = phraseIds.map(id => state.phrases.find(p => p.id === id)).filter(Boolean);

  if (filter) {
    const f = filter.toLowerCase();
    phrases = phrases.filter(p =>
      (p.title || '').toLowerCase().includes(f) ||
      (p.text || '').toLowerCase().includes(f) ||
      (p.trans || '').toLowerCase().includes(f)
    );
  }

  for (const phrase of phrases) {
    const hasAudio = !!(await getAudioRecord(phrase.id, 'original'));
    if (audioOnly && !hasAudio) continue;
    const card = createPhraseCard(phrase, hasAudio);
    grid.appendChild(card);
  }

  if (grid.children.length === 0) {
    grid.innerHTML = '<div style="color:var(--text3);text-align:center;padding:40px;grid-column:1/-1">No cards yet. Add one!</div>';
  }
}

function createPhraseCard(phrase, hasAudio) {
  const card = document.createElement('div');
  card.className = 'phrase-card';
  card.dataset.id = phrase.id;

  const titleEl = document.createElement('div');
  titleEl.className = 'card-title';
  titleEl.textContent = phrase.title || 'Untitled';

  const textEl = document.createElement('div');
  textEl.className = 'card-phrase-text blurred';
  textEl.textContent = phrase.text || '';

  const showBtn = document.createElement('button');
  showBtn.className = 'card-show-btn';
  showBtn.innerHTML = '<span class="msi">visibility</span> Show phrase';
  let shown = false;
  showBtn.addEventListener('click', () => {
    shown = !shown;
    textEl.classList.toggle('blurred', !shown);
    showBtn.innerHTML = shown ? '<span class="msi">visibility_off</span> Hide' : '<span class="msi">visibility</span> Show phrase';
    if (shown) {
      transEl.style.display = 'block';
    } else {
      transEl.style.display = 'none';
    }
  });

  const transEl = document.createElement('div');
  transEl.className = 'card-trans';
  transEl.textContent = phrase.trans || '';
  transEl.style.display = 'none';

  const audioWrap = document.createElement('div');
  audioWrap.id = `card-audio-${phrase.id}`;

  if (hasAudio) {
    renderAudioPlayer(audioWrap, phrase.id, 'original');
  } else {
    audioWrap.innerHTML = '<span style="color:var(--text3);font-size:12px">No audio</span>';
  }

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-ghost btn-sm';
  editBtn.innerHTML = '<span class="msi">edit</span> Edit';
  editBtn.addEventListener('click', () => openPhraseModal(phrase));

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-ghost btn-sm';
  delBtn.innerHTML = '<span class="msi">delete</span>';
  delBtn.addEventListener('click', () => deletePhrase(phrase.id));

  const pronunBtn = document.createElement('button');
  pronunBtn.className = 'btn btn-ghost btn-sm';
  pronunBtn.innerHTML = '<span class="msi">graphic_eq</span> Pronounce';
  pronunBtn.addEventListener('click', () => {
    state.pronun.phraseId = phrase.id;
    switchTab('pronun');
  });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  actions.appendChild(pronunBtn);

  card.appendChild(titleEl);
  card.appendChild(textEl);
  card.appendChild(showBtn);
  card.appendChild(transEl);
  card.appendChild(audioWrap);
  card.appendChild(actions);

  return card;
}

async function deletePhrase(id) {
  if (!confirm('Delete this card?')) return;
  await idbDelete('phrases', id);
  await deleteAudioForPhrase(id);
  for (const day of DAYS) {
    const phraseIds = state.mazos[day] || [];
    const updated = phraseIds.filter(pid => pid !== id);
    state.mazos[day] = updated;
    await idbPut('mazos', { id: day, phraseIds: updated });
  }
  state.phrases = state.phrases.filter(p => p.id !== id);
  toast('Card deleted', 'info');
  await renderPhraseCards(state.currentDay, document.getElementById('lib-search').value, document.getElementById('lib-filter-audio').checked);
}

// ============ PHRASE MODAL ============
function openPhraseModal(phrase = null) {
  state.phraseEditId = phrase ? phrase.id : null;
  state.pfRecordingBlob = null;
  document.getElementById('phrase-modal-title').textContent = phrase ? 'Edit Card' : 'New Card';
  document.getElementById('pf-title').value = phrase ? (phrase.title || '') : '';
  document.getElementById('pf-text').value = phrase ? (phrase.text || '') : '';
  document.getElementById('pf-trans').value = phrase ? (phrase.trans || '') : '';
  document.getElementById('pf-day').value = state.currentDay || 'lunes';
  document.getElementById('pf-audio-preview').innerHTML = '';
  if (phrase) {
    renderAudioPlayer(document.getElementById('pf-audio-preview'), phrase.id, 'original');
  }
  document.getElementById('phrase-modal').classList.remove('hidden');
}

function closePhraseModal() {
  document.getElementById('phrase-modal').classList.add('hidden');
  if (state.pfRecordingBlob) {
    state.pfRecordingBlob = null;
  }
}

async function savePhrase() {
  const title = document.getElementById('pf-title').value.trim();
  const text = document.getElementById('pf-text').value.trim();
  const trans = document.getElementById('pf-trans').value.trim();
  const day = document.getElementById('pf-day').value;

  if (!title && !text) { toast('Write at least a title or a phrase', 'error'); return; }

  let id = state.phraseEditId;
  const phraseData = { title, text, trans, created: Date.now() };
  if (id) {
    phraseData.id = id;
    await idbPut('phrases', phraseData);
  } else {
    id = await idbPut('phrases', phraseData);
    phraseData.id = id;
  }

  // Save audio blob if recorded
  if (state.pfRecordingBlob) {
    await saveAudioBlob(id, 'original', state.pfRecordingBlob, 'recording');
    state.pfRecordingBlob = null;
  }

  // Update mazo
  const phraseIds = state.mazos[day] || [];
  if (!phraseIds.includes(id)) {
    phraseIds.push(id);
    state.mazos[day] = phraseIds;
    await idbPut('mazos', { id: day, phraseIds });
  }

  // If editing and day changed, remove from old days
  if (state.phraseEditId) {
    for (const d of DAYS) {
      if (d !== day && (state.mazos[d] || []).includes(id)) {
        const updated = (state.mazos[d] || []).filter(pid => pid !== id);
        state.mazos[d] = updated;
        await idbPut('mazos', { id: d, phraseIds: updated });
      }
    }
  }

  await loadData();
  closePhraseModal();
  toast(state.phraseEditId ? 'Card updated' : 'Card saved', 'success');
  if (state.currentDay) await renderPhraseCards(state.currentDay);
  else renderDecks();
}

// Audio upload for phrase form
document.getElementById('pf-audio-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  state.pfRecordingBlob = file;
  const preview = document.getElementById('pf-audio-preview');
  preview.innerHTML = '';
  const player = createAudioPlayer(file, {});
  preview.appendChild(player.el);
});

// Record in phrase form
let pfMediaRecorder = null;
let pfChunks = [];

document.getElementById('pf-record-btn').addEventListener('click', async () => {
  const btn = document.getElementById('pf-record-btn');
  if (pfMediaRecorder && pfMediaRecorder.state === 'recording') {
    pfMediaRecorder.stop();
    btn.innerHTML = '<span class="msi">mic</span> Record';
    btn.classList.remove('recording');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pfChunks = [];
    pfMediaRecorder = new MediaRecorder(stream);
    pfMediaRecorder.ondataavailable = e => pfChunks.push(e.data);
    pfMediaRecorder.onstop = () => {
      const blob = new Blob(pfChunks, { type: 'audio/webm' });
      state.pfRecordingBlob = blob;
      const preview = document.getElementById('pf-audio-preview');
      preview.innerHTML = '';
      const player = createAudioPlayer(blob);
      preview.appendChild(player.el);
      stream.getTracks().forEach(t => t.stop());
    };
    pfMediaRecorder.start();
    btn.innerHTML = '<span class="msi">stop_circle</span> Stop';
    btn.classList.add('recording');
    toast('Recording...', 'info');
  } catch (err) {
    toast("Can't access the microphone", 'error');
  }
});

// ============ REVIEW ============
const REPASO_STEPS = [
  { desc: 'Listen without subtitles', showText: false, showTrans: false, autoPlay: true, hint: 'How many words do you recognize?' },
  { desc: 'Read and understand', showText: true, showTrans: true, autoPlay: false, hint: 'Match the text with its meaning' },
  { desc: 'Listen while reading the text', showText: true, showTrans: false, autoPlay: true, hint: 'Connect the sound with the words' },
  { desc: 'Listen again — text hidden', showText: false, showTrans: false, autoPlay: true, hint: 'How much more do you understand now?' },
];

async function populateRepasoSelect() {
  const sel = document.getElementById('repaso-phrase-select');
  sel.innerHTML = '<option value="">— Select a card —</option>';
  for (const p of state.phrases) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title || p.text?.slice(0, 40) || 'Untitled';
    sel.appendChild(opt);
  }
}

async function startRepaso() {
  const phraseId = parseInt(document.getElementById('repaso-phrase-select').value);
  if (!phraseId) { toast('Select a card', 'error'); return; }
  state.repaso.phraseId = phraseId;
  state.repaso.step = 0;
  const phrase = state.phrases.find(p => p.id === phraseId);
  if (!phrase) return;

  document.getElementById('repaso-select-area').classList.add('hidden');
  document.getElementById('repaso-session').classList.remove('hidden');
  document.getElementById('repaso-phrase-title').textContent = phrase.title || '';

  await renderRepasoStep(phrase);
  updateStreak();
}

async function renderRepasoStep(phrase) {
  const step = REPASO_STEPS[state.repaso.step];
  const stepNum = state.repaso.step;

  document.getElementById('repaso-step-num').textContent = `Step ${stepNum + 1} / 4`;
  document.getElementById('repaso-step-desc').textContent = step.desc;
  document.getElementById('repaso-hint').textContent = step.hint;

  const textEl = document.getElementById('repaso-phrase-text');
  textEl.textContent = phrase.text || '';
  textEl.classList.toggle('blurred', !step.showText);
  textEl.classList.toggle('hidden-blur', !step.showText);

  const transEl = document.getElementById('repaso-phrase-trans');
  transEl.textContent = phrase.trans || '';
  transEl.style.display = step.showTrans ? 'block' : 'none';

  // Progress
  const pct = ((stepNum) / 4) * 100;
  document.getElementById('repaso-progress').style.width = pct + '%';

  // Dots
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === stepNum);
    dot.classList.toggle('done', i < stepNum);
  });

  // Back btn
  document.getElementById('repaso-back-btn').style.display = stepNum > 0 ? 'inline-flex' : 'none';
  document.getElementById('repaso-next-btn').innerHTML = stepNum < 3 ? 'Next step <span class="msi">arrow_forward</span>' : '<span class="msi">check_circle</span> Finish review';

  // Audio
  const audioWrap = document.getElementById('repaso-audio-wrap');
  const player = await renderAudioPlayer(audioWrap, phrase.id, 'original');
  if (player && step.autoPlay) {
    setTimeout(() => player.play(), 500);
  }
}

// ============ PRONUNCIATION ============
let recognition = null;
let pronunNativeBlob = null;
let pronunFinalText = '';

async function populatePronunSelect() {
  const sel = document.getElementById('pronun-phrase-select');
  sel.innerHTML = '<option value="">— Select a card —</option>';
  for (const p of state.phrases) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title || p.text?.slice(0, 40) || 'Untitled';
    sel.appendChild(opt);
  }
  if (state.pronun.phraseId) {
    sel.value = state.pronun.phraseId;
    loadPronunPhrase(state.pronun.phraseId);
  }
}

async function loadPronunPhrase(phraseId) {
  state.pronun.phraseId = phraseId;
  const phrase = state.phrases.find(p => p.id === phraseId);
  if (!phrase) return;

  const textEl = document.getElementById('recog-text-display');
  textEl.textContent = phrase.text || '';
  textEl.classList.add('blurred');
  document.getElementById('pronun-show-btn').innerHTML = '<span class="msi">visibility</span> Show phrase';
  document.getElementById('pronun-show-btn').style.display = '';
  document.getElementById('pronun-start-btn').disabled = false;

  resetPronunResults();

  // Load (or offer to upload) the native reference audio — ONE single place
  pronunNativeBlob = null;
  const audioWrap = document.getElementById('pronun-audio-wrap');
  const uploadRow = document.getElementById('pronun-audio-upload');
  audioWrap.innerHTML = '';
  const rec = await getAudioRecord(phraseId, 'original');
  if (rec) {
    pronunNativeBlob = rec.blob;
    const player = createAudioPlayer(rec.blob, { showLoop: false });
    audioWrap.appendChild(player.el);
    uploadRow.classList.add('hidden');
  } else {
    uploadRow.classList.remove('hidden');
  }
}

function resetPronunResults() {
  document.getElementById('pronun-live-wrap').classList.add('hidden');
  document.getElementById('pronun-analyzing').classList.add('hidden');
  document.getElementById('pronun-results').classList.add('hidden');
  document.getElementById('pronun-start-btn').classList.remove('hidden');
  document.getElementById('pronun-stop-btn').classList.add('hidden');
  document.getElementById('listening-state').classList.add('hidden');
}

document.getElementById('pronun-audio-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  const phraseId = state.pronun.phraseId;
  if (!file || !phraseId) return;
  await saveAudioBlob(phraseId, 'original', file, 'reference');
  pronunNativeBlob = file;
  const audioWrap = document.getElementById('pronun-audio-wrap');
  audioWrap.innerHTML = '';
  const player = createAudioPlayer(file, { showLoop: false });
  audioWrap.appendChild(player.el);
  document.getElementById('pronun-audio-upload').classList.add('hidden');
  toast('Reference audio saved', 'success');
});

async function startPronun() {
  const phraseId = state.pronun.phraseId;
  if (!phraseId) { toast('Select a card', 'error'); return; }

  const phrase = state.phrases.find(p => p.id === phraseId);
  if (!phrase || !phrase.text) { toast('This card has no text', 'error'); return; }

  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    toast("Your browser doesn't support speech recognition. Use Chrome.", 'error');
    return;
  }

  resetPronunResults();
  pronunFinalText = '';

  document.getElementById('listening-state').classList.remove('hidden');
  document.getElementById('pronun-start-btn').classList.add('hidden');
  document.getElementById('pronun-stop-btn').classList.remove('hidden');

  const liveWrap = document.getElementById('pronun-live-wrap');
  const liveFinalEl = document.getElementById('pronun-live-text');
  const liveInterimEl = document.getElementById('pronun-live-interim');
  liveFinalEl.textContent = '';
  liveInterimEl.textContent = '';
  liveWrap.classList.remove('hidden');

  // 1) Live transcription (speech-to-text)
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = e => {
    let finalText = '';
    let interimText = '';
    for (let i = 0; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += transcript + ' ';
      else interimText += transcript;
    }
    pronunFinalText = finalText.trim();
    liveFinalEl.textContent = pronunFinalText;
    liveInterimEl.textContent = interimText;
  };

  recognition.onerror = e => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') {
      toast('Recognition error: ' + e.error, 'error');
    }
  };

  recognition.start();
  state.pronun.listening = true;
}

function stopPronun() {
  state.pronun.listening = false;
  document.getElementById('listening-state').classList.add('hidden');
  document.getElementById('pronun-start-btn').classList.remove('hidden');
  document.getElementById('pronun-stop-btn').classList.add('hidden');

  if (recognition) {
    try { recognition.stop(); } catch (e) {}
    recognition = null;
  }

  document.getElementById('pronun-analyzing').classList.remove('hidden');

  const phrase = state.phrases.find(p => p.id === state.pronun.phraseId);
  analyzeFullPronunciation(phrase?.text || '', pronunFinalText).then(() => {
    document.getElementById('pronun-analyzing').classList.add('hidden');
  });
}

function normalizeWord(w) {
  return w.toLowerCase().replace(/[^a-z']/g, '');
}

async function analyzeFullPronunciation(original, spoken) {
  const origWords = original.split(/\s+/).map(normalizeWord).filter(Boolean);
  const spokWords = spoken.split(/\s+/).map(normalizeWord).filter(Boolean);

  // Highlight incorrect words directly inside "What I heard"
  const liveTextEl = document.getElementById('pronun-live-text');
  document.getElementById('pronun-live-interim').textContent = '';
  liveTextEl.innerHTML = '';

  let correct = 0;
  origWords.forEach(word => {
    const span = document.createElement('span');
    const found = spokWords.includes(word);
    span.className = found ? 'word-correct' : 'word-wrong';
    if (found) correct++;
    span.textContent = word;
    liveTextEl.appendChild(span);
    liveTextEl.appendChild(document.createTextNode(' '));
  });

  const overall = origWords.length > 0 ? Math.round((correct / origWords.length) * 100) : 0;
  renderPronunResults(overall);

  // ---- Stats ----
  state.stats.pronunCount = (state.stats.pronunCount || 0) + 1;
  const prevTotal = (state.stats.avgPronun || 0) * ((state.stats.pronunCount || 1) - 1);
  state.stats.avgPronun = Math.round((prevTotal + overall) / state.stats.pronunCount);
  await idbPut('stats', { id: 'main', ...state.stats });
}

function renderPronunResults(overall) {
  document.getElementById('pronun-results').classList.remove('hidden');

  const arc = document.getElementById('score-circle-arc');
  const circumference = 314;
  arc.style.transition = 'stroke-dashoffset 0.8s ease';
  arc.style.strokeDashoffset = circumference - (overall / 100) * circumference;
  arc.style.stroke = overall >= 80 ? 'var(--accent)' : overall >= 60 ? 'var(--orange)' : 'var(--red)';
  document.getElementById('score-num').textContent = overall + '%';
}

document.getElementById('pronun-start-btn').addEventListener('click', startPronun);
document.getElementById('pronun-stop-btn').addEventListener('click', stopPronun);

// ============ STRUCTURES ============
async function renderEstructuras() {
  const grid = document.getElementById('estr-grid');
  grid.innerHTML = '';

  if (state.estructuras.length === 0) {
    grid.innerHTML = '<div style="color:var(--text3);text-align:center;padding:40px;grid-column:1/-1">No patterns saved yet. Add one!</div>';
    return;
  }

  for (const e of state.estructuras) {
    const card = await createEstrCard(e);
    grid.appendChild(card);
  }
}

async function createEstrCard(estr) {
  const card = document.createElement('div');
  card.className = 'estr-card';

  const accent = document.createElement('div');
  accent.className = 'estr-card-accent';
  accent.style.background = estr.color || 'var(--accent)';
  card.appendChild(accent);

  const pattern = document.createElement('div');
  pattern.className = 'estr-pattern';
  pattern.textContent = estr.pattern || '';
  card.appendChild(pattern);

  if (estr.tags) {
    const tagsWrap = document.createElement('div');
    tagsWrap.className = 'estr-tags';
    estr.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(tag => {
      const span = document.createElement('span');
      span.className = 'estr-tag';
      span.textContent = '#' + tag;
      tagsWrap.appendChild(span);
    });
    card.appendChild(tagsWrap);
  }

  const audioWrap = document.createElement('div');
  audioWrap.id = `estr-audio-${estr.id}`;
  card.appendChild(audioWrap);
  const hasAudio = await getAudioRecord(estr.id, 'estr-original');
  if (hasAudio) {
    renderAudioPlayer(audioWrap, estr.id, 'estr-original');
  }

  const actions = document.createElement('div');
  actions.className = 'estr-card-actions mt-sm';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-ghost btn-sm';
  editBtn.innerHTML = '<span class="msi">edit</span> Edit';
  editBtn.addEventListener('click', () => openEstrModal(estr));

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-ghost btn-sm';
  delBtn.innerHTML = '<span class="msi">delete</span>';
  delBtn.addEventListener('click', () => deleteEstr(estr.id));

  const searchBtn = document.createElement('button');
  searchBtn.className = 'btn btn-ghost btn-sm';
  searchBtn.innerHTML = '<span class="msi">search</span> View in cards';
  searchBtn.addEventListener('click', () => {
    document.getElementById('estr-search').value = estr.pattern;
    buscarEnTarjetas(estr.pattern);
  });

  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  actions.appendChild(searchBtn);
  card.appendChild(actions);

  return card;
}

function openEstrModal(estr = null) {
  state.estrEditId = estr ? estr.id : null;
  state.efRecordingBlob = null;
  document.getElementById('estr-modal-title').textContent = estr ? 'Edit Pattern' : 'New Pattern';
  document.getElementById('ef-pattern').value = estr ? (estr.pattern || '') : '';
  document.getElementById('ef-tags').value = estr ? (estr.tags || '') : '';
  state.estrColor = estr ? (estr.color || '#10b981') : '#10b981';
  document.querySelectorAll('#estr-color-picker .color-dot').forEach(dot => {
    dot.classList.toggle('active', dot.dataset.color === state.estrColor);
  });
  document.getElementById('ef-audio-preview').innerHTML = '';
  if (estr) {
    renderAudioPlayer(document.getElementById('ef-audio-preview'), estr.id, 'estr-original');
  }
  document.getElementById('estr-modal').classList.remove('hidden');
}

function closeEstrModal() {
  document.getElementById('estr-modal').classList.add('hidden');
  state.efRecordingBlob = null;
}

async function saveEstr() {
  const pattern = document.getElementById('ef-pattern').value.trim();
  if (!pattern) { toast('Write the pattern', 'error'); return; }
  const tags = document.getElementById('ef-tags').value.trim();
  const color = state.estrColor;

  let id = state.estrEditId;
  const data = { pattern, tags, color, created: Date.now() };
  if (id) {
    data.id = id;
    await idbPut('estructuras', data);
  } else {
    id = await idbPut('estructuras', data);
  }

  if (state.efRecordingBlob) {
    await saveAudioBlob(id, 'estr-original', state.efRecordingBlob, 'estr-audio');
    state.efRecordingBlob = null;
  }

  state.estructuras = await idbGetAll('estructuras');
  closeEstrModal();
  renderEstructuras();
  toast('Pattern saved', 'success');
}

async function deleteEstr(id) {
  if (!confirm('Delete this pattern?')) return;
  await idbDelete('estructuras', id);
  await deleteAudioForPhrase(id);
  state.estructuras = state.estructuras.filter(e => e.id !== id);
  renderEstructuras();
  toast('Pattern deleted', 'info');
}

function buscarEnTarjetas(term) {
  if (!term.trim()) return;
  const f = term.toLowerCase();
  const matches = [];

  for (const p of state.phrases) {
    const text = (p.text || '').toLowerCase();
    const title = (p.title || '').toLowerCase();
    const trans = (p.trans || '').toLowerCase();
    if (text.includes(f) || title.includes(f) || trans.includes(f)) {
      const day = DAYS.find(d => (state.mazos[d] || []).includes(p.id));
      matches.push({ phrase: p, day });
    }
  }

  const banner = document.getElementById('estr-match-banner');
  if (matches.length === 0) {
    banner.innerHTML = `<div class="estr-match-header">No matches found for "${term}"</div>`;
    banner.classList.remove('hidden');
    return;
  }

  const escape = s => s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const highlightText = (text, term) => {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escape(text).replace(regex, '<span class="estr-highlight">$1</span>');
  };

  let html = `<div class="estr-match-header">Found "${term}" in ${matches.length} card${matches.length !== 1 ? 's' : ''}:</div>`;
  for (const { phrase, day } of matches) {
    html += `
      <div class="estr-match-item">
        <div>
          <div class="estr-match-item-title">${day ? DAY_LABELS[day] : ''} · ${escape(phrase.title || '')}</div>
          <div class="estr-match-item-text">${highlightText(phrase.text || '', term)}</div>
        </div>
      </div>
    `;
  }
  banner.innerHTML = html;
  banner.classList.remove('hidden');
}

// Structure audio
document.getElementById('ef-audio-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  state.efRecordingBlob = file;
  const preview = document.getElementById('ef-audio-preview');
  preview.innerHTML = '';
  const player = createAudioPlayer(file);
  preview.appendChild(player.el);
});

let efMediaRecorder = null;
let efChunks = [];

document.getElementById('ef-record-btn').addEventListener('click', async () => {
  const btn = document.getElementById('ef-record-btn');
  if (efMediaRecorder && efMediaRecorder.state === 'recording') {
    efMediaRecorder.stop();
    btn.innerHTML = '<span class="msi">mic</span> Record';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    efChunks = [];
    efMediaRecorder = new MediaRecorder(stream);
    efMediaRecorder.ondataavailable = e => efChunks.push(e.data);
    efMediaRecorder.onstop = () => {
      const blob = new Blob(efChunks, { type: 'audio/webm' });
      state.efRecordingBlob = blob;
      const preview = document.getElementById('ef-audio-preview');
      preview.innerHTML = '';
      const player = createAudioPlayer(blob);
      preview.appendChild(player.el);
      stream.getTracks().forEach(t => t.stop());
    };
    efMediaRecorder.start();
    btn.innerHTML = '<span class="msi">stop_circle</span> Stop';
    toast('Recording...', 'info');
  } catch (err) {
    toast("Can't access the microphone", 'error');
  }
});

// ============ DICTATION ============
let dictadoRecognition = null;
let dictadoActive = false;
let finalText = '';
let dictadoSessionId = 0;
let dictadoLastFinal = '';

function stopDictado() {
  dictadoActive = false;
  dictadoSessionId++; // invalidate any pending/stale handlers
  if (dictadoRecognition) {
    try { dictadoRecognition.stop(); } catch(e) {}
    dictadoRecognition = null;
  }
  document.getElementById('mic-btn').classList.remove('active');
  document.getElementById('wave-bars').classList.remove('active');
  document.getElementById('mic-status').textContent = 'Tap to speak';
}

function createDictadoRecognition(sessionId) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.continuous = true;
  rec.maxAlternatives = 1;

  rec.onresult = e => {
    // Ignore results from a stale/old recognition session (prevents duplicated text)
    if (sessionId !== dictadoSessionId || !dictadoActive) return;
    let interim = '';
    let latestFinal = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) latestFinal += e.results[i][0].transcript;
      else interim += e.results[i][0].transcript;
    }
    latestFinal = latestFinal.trim();
    // Skip if this exact chunk was already appended (common cause of duplicated words on restart)
    if (latestFinal && latestFinal !== dictadoLastFinal) {
      dictadoLastFinal = latestFinal;
      finalText += (finalText && !finalText.endsWith(' ') ? ' ' : '') + latestFinal + ' ';
      document.getElementById('transcript-final').textContent = finalText;
      updateSuggestions(finalText);
    }
    document.getElementById('transcript-interim').textContent = interim;
  };

  rec.onerror = e => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Error: ' + e.error, 'error');
  };

  rec.onend = () => {
    if (dictadoActive && sessionId === dictadoSessionId) {
      // Start a brand-new recognition instance instead of reusing the ended one —
      // reusing the same instance is what caused triplicated transcriptions.
      dictadoSessionId++;
      const newSession = dictadoSessionId;
      dictadoLastFinal = '';
      dictadoRecognition = createDictadoRecognition(newSession);
      try { dictadoRecognition.start(); } catch(e) { stopDictado(); }
    }
  };

  return rec;
}

function toggleDictado() {
  if (dictadoActive) {
    stopDictado();
    return;
  }

  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    toast('Speech recognition not available. Use Chrome.', 'error');
    return;
  }

  dictadoSessionId++;
  dictadoLastFinal = '';
  const sessionId = dictadoSessionId;
  dictadoRecognition = createDictadoRecognition(sessionId);
  dictadoRecognition.start();
  dictadoActive = true;
  document.getElementById('mic-btn').classList.add('active');
  document.getElementById('wave-bars').classList.add('active');
  document.getElementById('mic-status').textContent = 'Listening... (tap to stop)';
}

function updateSuggestions(text) {
  const chips = document.getElementById('sugg-chips');
  chips.innerHTML = '';
  const lower = text.toLowerCase().trim();
  let suggestions = [];

  for (const [key, vals] of Object.entries(AC)) {
    if (lower.endsWith(key) || lower.includes(key)) {
      suggestions = [...suggestions, ...vals];
    }
  }

  // Show recent matching suggestions
  const shown = suggestions.slice(0, 6);
  shown.forEach(s => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      finalText += s + ' ';
      document.getElementById('transcript-final').textContent = finalText;
    });
    chips.appendChild(chip);
  });
}

function refreshPromptPhrase() {
  const phrase = PHRASE_BANK[Math.floor(Math.random() * PHRASE_BANK.length)];
  document.getElementById('prompt-phrase').textContent = phrase;
  state.dictado.currentPhrase = phrase;
}

async function saveDictadoAsCard() {
  const text = finalText.trim();
  if (!text) { toast('No text to save', 'error'); return; }
  const id = await idbPut('phrases', { text, title: text.slice(0, 40) + '...', trans: '', created: Date.now() });
  state.phrases.push({ id, text, title: text.slice(0,40) + '...', trans: '', created: Date.now() });
  const day = 'lunes';
  const phraseIds = state.mazos[day] || [];
  phraseIds.push(id);
  state.mazos[day] = phraseIds;
  await idbPut('mazos', { id: day, phraseIds });
  toast(`Saved as a card on ${DAY_LABELS['lunes']}`, 'success');
}

// ============ STREAK TRACKING (used by Repaso) ============

async function updateStreak() {
  const today = new Date().toDateString();
  if (state.stats.lastDate !== today) {
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    if (state.stats.lastDate === yesterday) {
      state.stats.streak = (state.stats.streak || 0) + 1;
    } else if (state.stats.lastDate !== today) {
      state.stats.streak = 1;
    }
    state.stats.lastDate = today;
    state.stats.sessions = (state.stats.sessions || 0) + 1;
    await idbPut('stats', { id: 'main', ...state.stats });
  }
}

// ============ SETTINGS ============
async function loadSettings() {
  document.getElementById('notif-toggle').checked = state.cfg.notifEnabled;
  document.getElementById('notif-time').value = state.cfg.notifTime || '09:00';
  document.getElementById('cfg-username').value = state.cfg.userName || 'Your name';
  document.getElementById('cfg-gemini-key').value = state.cfg.geminiApiKey || '';
  document.getElementById('cfg-provider-own').checked = state.cfg.aiProvider === 'own';
  document.getElementById('cfg-provider-dev').checked = state.cfg.aiProvider === 'developer';
  document.getElementById('cfg-gemini-key-row').classList.toggle('hidden', state.cfg.aiProvider !== 'own');

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isStandalone) {
    document.getElementById('install-btn').classList.add('hidden');
    document.getElementById('install-desc').textContent = 'Echo is already installed on your device';
  }

  // Storage estimate
  if (navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate();
    const used = est.usage || 0;
    const quota = est.quota || 1;
    const pct = Math.min(100, Math.round((used / quota) * 100));
    const usedMB = (used / 1024 / 1024).toFixed(1);
    const quotaMB = (quota / 1024 / 1024).toFixed(0);
    document.getElementById('storage-fill').style.width = pct + '%';
    document.getElementById('storage-label').textContent = `${usedMB} MB of ${quotaMB} MB used (${pct}%)`;
  }
}

async function saveSettings() {
  state.cfg.notifEnabled = document.getElementById('notif-toggle').checked;
  state.cfg.notifTime = document.getElementById('notif-time').value;
  const name = document.getElementById('cfg-username').value.trim();
  state.cfg.userName = name || 'Your name';
  state.cfg.geminiApiKey = document.getElementById('cfg-gemini-key').value.trim();
  await idbPut('cfg', { id: 'main', ...state.cfg });
  renderGreeting();
}

async function scheduleNotification() {
  if (!state.cfg.notifEnabled) return;
  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notification permission denied', 'error'); return; }
  }

  if ('serviceWorker' in navigator && 'PushManager' in window) {
    // Use SW for notifications
    const reg = await navigator.serviceWorker.ready;
    const [h, m] = (state.cfg.notifTime || '09:00').split(':').map(Number);
    const now = new Date();
    let target = new Date();
    target.setHours(h, m, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
    const delay = target - now;
    setTimeout(() => {
      reg.showNotification('Echo — English Practice', {
        body: 'Time to practice English.',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
      });
    }, delay);
    toast(`Reminder scheduled for ${state.cfg.notifTime}`, 'success');
  }
}

async function clearAllData() {
  if (!confirm('Delete ALL data? This action cannot be undone.')) return;
  if (!confirm('Are you sure? All cards, audio, and stats will be deleted.')) return;
  const stores = ['phrases','estructuras','audio','mazos','stats','cfg'];
  for (const s of stores) {
    const all = await idbGetAll(s);
    for (const item of all) await idbDelete(s, item.id);
  }
  state.phrases = [];
  state.mazos = {};
  state.estructuras = [];
  state.stats = { sessions:0, minutes:0, avgPronun:0, pronunCount:0, streak:0, lastDate:null };
  toast('Data deleted', 'info');
  renderDecks();
}

// ============ PWA INSTALL ============
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  const btn = document.getElementById('install-btn');
  if (btn) btn.classList.remove('hidden');
});

document.getElementById('install-btn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const result = await deferredPrompt.userChoice;
  if (result.outcome === 'accepted') toast('Echo installed!', 'success');
  deferredPrompt = null;
  document.getElementById('install-btn').classList.add('hidden');
  document.getElementById('install-desc').textContent = 'Echo is already installed or not available in this browser';
});

window.addEventListener('appinstalled', () => {
  const btn = document.getElementById('install-btn');
  if (btn) btn.classList.add('hidden');
  const desc = document.getElementById('install-desc');
  if (desc) desc.textContent = 'Echo is already installed on your device';
});

// ============ AI TUTOR (Gemini Live) ============
const aiTutor = {
  client: null,
  connected: false,
  micLive: false,
  userBubble: null,
  modelBubble: null,
  userText: '',
  modelText: '',
};

function aiTutorSetStatus(text, dotClass) {
  document.getElementById('ai-tutor-status-text').textContent = text;
  const dot = document.getElementById('ai-tutor-status-dot');
  dot.className = 'ai-tutor-status-dot' + (dotClass ? ' ' + dotClass : '');
}

function aiTutorSetMicVisual(mode) {
  // mode: 'idle' | 'connecting' | 'live'
  const micBtn = document.getElementById('ai-tutor-mic-btn');
  const wave = document.getElementById('ai-tutor-wave');
  micBtn.classList.remove('live', 'connecting');
  wave.classList.remove('active');
  if (mode === 'connecting') micBtn.classList.add('connecting');
  if (mode === 'live') { micBtn.classList.add('live'); wave.classList.add('active'); }
  micBtn.querySelector('.msi').textContent = mode === 'live' ? 'stop' : 'mic';
}

function aiTutorClearEmptyState() {
  document.getElementById('ai-tutor-empty').style.display = 'none';
}

function aiTutorAppendBubble(role) {
  aiTutorClearEmptyState();
  const messages = document.getElementById('ai-tutor-messages');
  const bubble = document.createElement('div');
  bubble.className = `ai-tutor-msg ${role} interim`;
  messages.appendChild(bubble);
  messages.parentElement.scrollTop = messages.parentElement.scrollHeight;
  return bubble;
}

function aiTutorScrollToBottom() {
  const body = document.getElementById('ai-tutor-body');
  body.scrollTop = body.scrollHeight;
}

function aiTutorHasApiKey() {
  return !!(state.cfg.geminiApiKey && state.cfg.geminiApiKey.trim());
}

// ---- Panel view switching ----
// Three possible views inside the panel body:
//  1. Provider select — first time ever, no provider chosen yet
//  2. Key setup — provider is "own" but no key saved yet
//  3. Footer (ready) — provider resolved and ready to talk
function aiTutorShowView(view) {
  const providerSelect = document.getElementById('ai-tutor-provider-select');
  const keysetup = document.getElementById('ai-tutor-keysetup');
  const footer = document.getElementById('ai-tutor-footer');
  providerSelect.classList.toggle('hidden', view !== 'provider');
  keysetup.classList.toggle('hidden', view !== 'key');
  footer.classList.toggle('hidden', view !== 'ready');
}

function openAiTutor() {
  document.getElementById('ai-tutor-overlay').classList.remove('hidden');
  document.getElementById('ai-tutor-panel').classList.remove('hidden');

  if (!state.cfg.aiProvider) {
    aiTutorShowView('provider');
  } else if (state.cfg.aiProvider === 'own' && !aiTutorHasApiKey()) {
    document.getElementById('ai-tutor-key-input').value = '';
    aiTutorShowView('key');
  } else {
    aiTutorShowView('ready');
  }
}

function closeAiTutor() {
  document.getElementById('ai-tutor-overlay').classList.add('hidden');
  document.getElementById('ai-tutor-panel').classList.add('hidden');
  if (aiTutor.connected) aiTutorEndSession();
}

async function aiTutorSetProvider(provider) {
  state.cfg.aiProvider = provider;
  await idbPut('cfg', { id: 'main', ...state.cfg });
  const ownRadio = document.getElementById('cfg-provider-own');
  const devRadio = document.getElementById('cfg-provider-dev');
  if (ownRadio && devRadio) {
    ownRadio.checked = provider === 'own';
    devRadio.checked = provider === 'developer';
  }
  aiTutorUpdateKeyRowVisibility();
}

function aiTutorUpdateKeyRowVisibility() {
  const row = document.getElementById('cfg-gemini-key-row');
  if (!row) return;
  row.classList.toggle('hidden', state.cfg.aiProvider !== 'own');
}

async function aiTutorStartSession() {
  if (aiTutor.connected) return;

  const provider = state.cfg.aiProvider;
  if (provider === 'own' && !aiTutorHasApiKey()) {
    toast('Add your Gemini API key first', 'error');
    return;
  }

  aiTutorSetMicVisual('connecting');
  aiTutorSetStatus('Connecting...', 'connecting');
  document.getElementById('ai-tutor-end-btn').classList.remove('hidden');

  const client = new GeminiLiveClient();
  aiTutor.client = client;

  client.onStatus = (status) => {
    if (status === 'connecting') aiTutorSetStatus('Connecting...', 'connecting');
    if (status === 'connected') aiTutorSetStatus('Connected — listening', 'listening');
    if (status === 'listening') aiTutorSetStatus('Listening...', 'listening');
    if (status === 'speaking') aiTutorSetStatus('AI Tutor is speaking...', 'speaking');
    if (status === 'closed') aiTutorSetStatus('Session ended', '');
    if (status === 'error') aiTutorSetStatus('Connection error', 'error');
  };

  client.onError = (msg) => {
    toast(msg, 'error');
  };

  client.onUserText = (text, isFinal) => {
    if (!aiTutor.userBubble) aiTutor.userBubble = aiTutorAppendBubble('user');
    if (isFinal) {
      if (aiTutor.userText.trim()) aiTutor.userBubble.classList.remove('interim');
      aiTutor.userBubble = null;
      aiTutor.userText = '';
      return;
    }
    aiTutor.userText += text;
    aiTutor.userBubble.textContent = aiTutor.userText;
    aiTutorScrollToBottom();
  };

  client.onModelText = (text, isFinal) => {
    if (!aiTutor.modelBubble) aiTutor.modelBubble = aiTutorAppendBubble('model');
    if (isFinal) {
      if (aiTutor.modelText.trim()) aiTutor.modelBubble.classList.remove('interim');
      aiTutor.modelBubble = null;
      aiTutor.modelText = '';
      return;
    }
    aiTutor.modelText += text;
    aiTutor.modelBubble.textContent = aiTutor.modelText;
    aiTutorScrollToBottom();
  };

  client.onClose = () => {
    aiTutor.connected = false;
    aiTutor.micLive = false;
    aiTutorSetMicVisual('idle');
    document.getElementById('ai-tutor-end-btn').classList.add('hidden');
  };

  try {
    if (provider === 'developer') {
      await client.connect({
        mode: 'developer',
        systemInstruction: window.GEMINI_LIVE_DEFAULT_SYSTEM_PROMPT,
      });
    } else {
      await client.connect({
        mode: 'own',
        apiKey: state.cfg.geminiApiKey.trim(),
        systemInstruction: window.GEMINI_LIVE_DEFAULT_SYSTEM_PROMPT,
      });
    }
    await client.startMic();
    aiTutor.connected = true;
    aiTutor.micLive = true;
    aiTutorSetMicVisual('live');
  } catch (err) {
    console.error(err);
    const fallback = provider === 'developer'
      ? 'Could not reach the free AI Tutor service. Try again later, or use your own API key.'
      : 'Could not start the AI Tutor session. Check your API key.';
    toast(err && err.message ? err.message : fallback, 'error');
    aiTutorSetStatus('Connection failed', 'error');
    aiTutorSetMicVisual('idle');
    document.getElementById('ai-tutor-end-btn').classList.add('hidden');
    aiTutor.client = null;
  }
}

function aiTutorEndSession() {
  if (aiTutor.client) {
    aiTutor.client.disconnect();
    aiTutor.client = null;
  }
  aiTutor.connected = false;
  aiTutor.micLive = false;
  aiTutorSetMicVisual('idle');
  aiTutorSetStatus('Tap the mic to start talking', '');
  document.getElementById('ai-tutor-end-btn').classList.add('hidden');
}

document.getElementById('ai-tutor-btn').addEventListener('click', openAiTutor);
document.getElementById('ai-tutor-close').addEventListener('click', closeAiTutor);
document.getElementById('ai-tutor-overlay').addEventListener('click', closeAiTutor);

document.getElementById('ai-tutor-mic-btn').addEventListener('click', () => {
  if (aiTutor.connected) aiTutorEndSession();
  else aiTutorStartSession();
});

document.getElementById('ai-tutor-end-btn').addEventListener('click', aiTutorEndSession);

// ---- Provider selection (first-run picker inside the panel) ----
document.getElementById('ai-tutor-provider-own').addEventListener('click', async () => {
  await aiTutorSetProvider('own');
  if (aiTutorHasApiKey()) {
    aiTutorShowView('ready');
  } else {
    document.getElementById('ai-tutor-key-input').value = '';
    aiTutorShowView('key');
  }
});

document.getElementById('ai-tutor-provider-dev').addEventListener('click', async () => {
  await aiTutorSetProvider('developer');
  aiTutorShowView('ready');
  toast("Connected to Talk To Me AI Free — tap the mic to start", 'success');
});

document.getElementById('ai-tutor-key-save').addEventListener('click', async () => {
  const key = document.getElementById('ai-tutor-key-input').value.trim();
  if (!key) { toast('Paste a valid API key', 'error'); return; }
  state.cfg.geminiApiKey = key;
  state.cfg.aiProvider = 'own';
  await idbPut('cfg', { id: 'main', ...state.cfg });
  toast('API key saved', 'success');
  aiTutorShowView('ready');
});

document.getElementById('cfg-gemini-key-toggle').addEventListener('click', () => {
  const input = document.getElementById('cfg-gemini-key');
  const btn = document.getElementById('cfg-gemini-key-toggle');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.innerHTML = showing ? '<span class="msi">visibility</span>' : '<span class="msi">visibility_off</span>';
});

document.getElementById('cfg-gemini-key').addEventListener('change', saveSettings);

// ---- Provider selection (from Settings — the only place to change it later) ----
document.getElementById('cfg-provider-own').addEventListener('change', async (e) => {
  if (e.target.checked) await aiTutorSetProvider('own');
});
document.getElementById('cfg-provider-dev').addEventListener('change', async (e) => {
  if (e.target.checked) await aiTutorSetProvider('developer');
});

// ============ SERVICE WORKER ============
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => console.log('SW error:', err));
}

// ============ EVENT LISTENERS ============
// Navigation
document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// Sidebar
document.getElementById('hamburger').addEventListener('click', openSidebar);
document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

// Library
document.getElementById('lib-add-btn').addEventListener('click', () => openPhraseModal());
document.getElementById('lib-back-btn').addEventListener('click', () => {
  document.getElementById('library-card-view').classList.add('hidden');
  document.getElementById('library-deck-view').classList.remove('hidden');
  state.currentDay = null;
  renderDecks();
});
document.getElementById('lib-add-here-btn').addEventListener('click', () => openPhraseModal());
document.getElementById('lib-search').addEventListener('input', e => {
  if (state.currentDay) renderPhraseCards(state.currentDay, e.target.value, document.getElementById('lib-filter-audio').checked);
});
document.getElementById('lib-filter-audio').addEventListener('change', e => {
  if (state.currentDay) renderPhraseCards(state.currentDay, document.getElementById('lib-search').value, e.target.checked);
});
document.getElementById('phrase-modal-close').addEventListener('click', closePhraseModal);
document.getElementById('pf-cancel-btn').addEventListener('click', closePhraseModal);
document.getElementById('pf-save-btn').addEventListener('click', savePhrase);
document.getElementById('phrase-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('phrase-modal')) closePhraseModal();
});

// Repaso
document.getElementById('repaso-start-btn').addEventListener('click', startRepaso);
document.getElementById('repaso-next-btn').addEventListener('click', async () => {
  if (state.repaso.step >= 3) {
    document.getElementById('repaso-session').classList.add('hidden');
    document.getElementById('repaso-select-area').classList.remove('hidden');
    toast('Review completed', 'success');
    state.stats.sessions = (state.stats.sessions || 0) + 1;
    state.stats.minutes = (state.stats.minutes || 0) + 2;
    await idbPut('stats', { id: 'main', ...state.stats });
    return;
  }
  state.repaso.step++;
  const phrase = state.phrases.find(p => p.id === state.repaso.phraseId);
  if (phrase) await renderRepasoStep(phrase);
});
document.getElementById('repaso-back-btn').addEventListener('click', async () => {
  if (state.repaso.step <= 0) return;
  state.repaso.step--;
  const phrase = state.phrases.find(p => p.id === state.repaso.phraseId);
  if (phrase) await renderRepasoStep(phrase);
});

// Pronunciation
document.getElementById('pronun-phrase-select').addEventListener('change', e => {
  if (e.target.value) loadPronunPhrase(parseInt(e.target.value));
});
document.getElementById('pronun-show-btn').addEventListener('click', () => {
  const textEl = document.getElementById('recog-text-display');
  const btn = document.getElementById('pronun-show-btn');
  const isBlurred = textEl.classList.contains('blurred');
  if (isBlurred) {
    textEl.classList.remove('blurred');
    btn.innerHTML = '<span class="msi">visibility_off</span> Hide';
  } else {
    textEl.classList.add('blurred');
    btn.innerHTML = '<span class="msi">visibility</span> Show phrase';
  }
});
document.getElementById('pronun-start-btn').addEventListener('click', startPronun);
document.getElementById('pronun-stop-btn').addEventListener('click', stopPronun);

// Estructuras
document.getElementById('estr-add-btn').addEventListener('click', () => openEstrModal());
document.getElementById('estr-modal-close').addEventListener('click', closeEstrModal);
document.getElementById('ef-cancel-btn').addEventListener('click', closeEstrModal);
document.getElementById('ef-save-btn').addEventListener('click', saveEstr);
document.getElementById('estr-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('estr-modal')) closeEstrModal();
});
document.getElementById('estr-search-btn').addEventListener('click', () => {
  buscarEnTarjetas(document.getElementById('estr-search').value);
});
document.getElementById('estr-search').addEventListener('keydown', e => {
  if (e.key === 'Enter') buscarEnTarjetas(e.target.value);
});
document.querySelectorAll('#estr-color-picker .color-dot').forEach(dot => {
  dot.addEventListener('click', () => {
    document.querySelectorAll('#estr-color-picker .color-dot').forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    state.estrColor = dot.dataset.color;
  });
});

// Dictado
document.getElementById('mic-btn').addEventListener('click', toggleDictado);
document.getElementById('btn-delete-last').addEventListener('click', () => {
  finalText = finalText.trimEnd().split(' ').slice(0, -1).join(' ') + (finalText.trim() ? ' ' : '');
  document.getElementById('transcript-final').textContent = finalText;
});
document.getElementById('btn-clear').addEventListener('click', () => {
  finalText = '';
  document.getElementById('transcript-final').textContent = '';
  document.getElementById('transcript-interim').textContent = '';
  document.getElementById('sugg-chips').innerHTML = '';
});
document.getElementById('btn-save-dictado').addEventListener('click', saveDictadoAsCard);
document.getElementById('prompt-refresh').addEventListener('click', refreshPromptPhrase);

// Settings
document.getElementById('notif-toggle').addEventListener('change', async () => {
  await saveSettings();
  if (document.getElementById('notif-toggle').checked) {
    await scheduleNotification();
  }
});
document.getElementById('notif-time').addEventListener('change', saveSettings);
document.getElementById('cfg-username').addEventListener('change', saveSettings);
document.getElementById('clear-data-btn').addEventListener('click', clearAllData);

// Keyboard shortcuts for dictado
document.addEventListener('keydown', e => {
  if (state.currentTab !== 'dictado') return;
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); toggleDictado(); }
  if (e.code === 'Backspace') {
    e.preventDefault();
    finalText = finalText.trimEnd().split(' ').slice(0, -1).join(' ') + ' ';
    document.getElementById('transcript-final').textContent = finalText;
  }
  if (e.ctrlKey && e.code === 'KeyL') {
    e.preventDefault();
    finalText = '';
    document.getElementById('transcript-final').textContent = '';
    document.getElementById('transcript-interim').textContent = '';
  }
});

// ============ ICON GENERATION (SVG → Canvas → PNG) ============
function generateIcons() {
  const sizes = [192, 512];
  sizes.forEach(size => {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#0a0d0c';
    ctx.beginPath();
    const r = size * 0.18;
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fill();

    // Circle icon
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = size * 0.06;
    ctx.beginPath();
    ctx.arc(size/2, size/2, size * 0.3, 0, Math.PI * 2);
    ctx.stroke();

    // Inner dot
    ctx.fillStyle = '#10b981';
    ctx.beginPath();
    ctx.arc(size/2, size/2, size * 0.08, 0, Math.PI * 2);
    ctx.fill();

    canvas.toBlob(blob => {
      if (blob) {
        const a = document.createElement('a');
        a.download = `icon-${size}.png`;
        a.href = URL.createObjectURL(blob);
        // Don't auto-download, just store for SW
      }
    });
  });
}

// ============ INIT ============
async function init() {
  await openDB();
  await loadData();
  renderDecks();
  refreshPromptPhrase();
  generateIcons();

  // Init suggestions
  document.getElementById('sugg-chips').innerHTML = '';
  Object.values(AC).slice(0, 2).flat().slice(0, 5).forEach(s => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.textContent = s;
    chip.addEventListener('click', () => {
      finalText += s + ' ';
      document.getElementById('transcript-final').textContent = finalText;
    });
    document.getElementById('sugg-chips').appendChild(chip);
  });
}

init().catch(console.error);