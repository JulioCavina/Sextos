(() => {
  'use strict';

  const CONFIG = window.SEXTO_CONFIG || {};
  const API_URL = CONFIG.API_URL || '';
  const WORD_LIST_URL = CONFIG.WORD_LIST_URL || 'palavras/palavras_sexto_6_letras_filtradas_curadas.txt';
  const WORD_LENGTH = 6;
  const BOARD_COUNT = 4;
  const MAX_ATTEMPTS = 10;

  const STORAGE_SESSION = 'sexto_session_v1';
  const STORAGE_DEVICE = 'sexto_device_id_v1';

  const state = {
    session: null,
    wordSet: new Set(),
    wordMap: new Map(),
    ready: false,
    dataJogo: null,
    partidaId: null,
    respostas: [],
    respostasNorm: [],
    ficha: null,
    ranking: null,
    partidaServidor: null,
    tentativas: [],
    solvedAt: [null, null, null, null],
    currentGuess: '',
    finished: false,
    finalResult: null,
    saving: false,
    keyStatus: {},
    pendingFinalize: false
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    loadingView: $('loadingView'),
    authView: $('authView'),
    gameView: $('gameView'),
    resultView: $('resultView'),
    tabLogin: $('tabLogin'),
    tabCreate: $('tabCreate'),
    loginForm: $('loginForm'),
    createForm: $('createForm'),
    authMessage: $('authMessage'),
    boards: $('boards'),
    keyboard: $('keyboard'),
    guessPreview: $('guessPreview'),
    toast: $('toast'),
    logoutButton: $('logoutButton'),
    gameDate: $('gameDate'),
    playerCurrentStreak: $('playerCurrentStreak'),
    playerBestStreak: $('playerBestStreak'),
    leaderCurrentStreak: $('leaderCurrentStreak'),
    leaderBestStreak: $('leaderBestStreak'),
    resultTitle: $('resultTitle'),
    resultSubtitle: $('resultSubtitle'),
    statGames: $('statGames'),
    statWinPct: $('statWinPct'),
    statCurrentStreak: $('statCurrentStreak'),
    statBestStreak: $('statBestStreak'),
    attemptDistribution: $('attemptDistribution'),
    modalLeaderCurrent: $('modalLeaderCurrent'),
    modalLeaderBest: $('modalLeaderBest'),
    shareButton: $('shareButton'),
    backToGameButton: $('backToGameButton'),
    retrySaveButton: $('retrySaveButton')
  };

  function showView(name) {
    [els.loadingView, els.authView, els.gameView, els.resultView].forEach(v => v.classList.remove('is-active'));
    if (name === 'loading') els.loadingView.classList.add('is-active');
    if (name === 'auth') els.authView.classList.add('is-active');
    if (name === 'game') els.gameView.classList.add('is-active');
    if (name === 'results') els.resultView.classList.add('is-active');
  }

  function normalizeWord(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ç/g, 'c')
      .replace(/[^a-z]/g, '');
  }

  function normalizeUser(value) {
    return normalizeWord(value).replace(/[^a-z0-9_]/g, '').slice(0, 24);
  }

  function todayFallback() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function formatDisplayDate(dateKey) {
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey || '--';
    const [y, m, d] = dateKey.split('-');
    return `${d}/${m}/${y}`;
  }

  function makeDeviceId() {
    let id = localStorage.getItem(STORAGE_DEVICE);
    if (!id) {
      id = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(STORAGE_DEVICE, id);
    }
    return id;
  }

  function saveSession(session) {
    state.session = session;
    localStorage.setItem(STORAGE_SESSION, JSON.stringify(session));
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_SESSION);
      state.session = raw ? JSON.parse(raw) : null;
    } catch (err) {
      state.session = null;
    }
    return state.session;
  }

  function clearSession() {
    state.session = null;
    localStorage.removeItem(STORAGE_SESSION);
  }

  function gameStorageKey() {
    const usuario = state.session?.usuario || 'anon';
    const data = state.dataJogo || todayFallback();
    return `sexto_game_v1_${usuario}_${data}`;
  }

  function saveGameLocal() {
    if (!state.session || !state.dataJogo || !state.partidaId) return;
    const payload = {
      usuario: state.session.usuario,
      data_jogo: state.dataJogo,
      partida_id: state.partidaId,
      tentativas: state.tentativas,
      solvedAt: state.solvedAt,
      finished: state.finished,
      finalResult: state.finalResult,
      pendingFinalize: state.pendingFinalize,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(gameStorageKey(), JSON.stringify(payload));
  }

  function loadGameLocal() {
    try {
      const raw = localStorage.getItem(gameStorageKey());
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (payload.partida_id !== state.partidaId) return null;
      return payload;
    } catch (err) {
      return null;
    }
  }

  function setAuthMessage(text, type = '') {
    els.authMessage.textContent = text || '';
    els.authMessage.className = `message ${type}`.trim();
  }

  function showToast(text, type = '') {
    els.toast.textContent = text || '';
    els.toast.className = `toast ${type}`.trim();
    if (text) {
      window.clearTimeout(showToast._timer);
      showToast._timer = window.setTimeout(() => {
        els.toast.textContent = '';
        els.toast.className = 'toast';
      }, 2400);
    }
  }

  function ensureConfigReady() {
    if (!API_URL || API_URL.includes('COLE_AQUI')) {
      showView('auth');
      setAuthMessage('Configure a API_URL no arquivo config.js antes de usar.', 'error');
      return false;
    }
    return true;
  }

  function apiCall(payload, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      if (!ensureConfigReady()) {
        reject(new Error('API_URL não configurada.'));
        return;
      }

      const callbackName = `sexto_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      const cleanup = () => {
        window.clearTimeout(timer);
        if (script.parentNode) script.parentNode.removeChild(script);
        try { delete window[callbackName]; } catch (err) { window[callbackName] = undefined; }
      };

      window[callbackName] = (response) => {
        cleanup();
        if (!response || response.ok === false) {
          reject(new Error(response?.erro || 'Erro na API.'));
        } else {
          resolve(response);
        }
      };

      const sep = API_URL.includes('?') ? '&' : '?';
      script.src = `${API_URL}${sep}callback=${encodeURIComponent(callbackName)}&payload=${encodeURIComponent(JSON.stringify(payload))}&_=${Date.now()}`;
      script.onerror = () => {
        cleanup();
        reject(new Error('Falha ao chamar API.'));
      };

      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('A API demorou demais para responder.'));
      }, timeoutMs);

      document.body.appendChild(script);
    });
  }

  async function loadWordList() {
    const response = await fetch(`${WORD_LIST_URL}?v=${encodeURIComponent(CONFIG.APP_VERSION || '1')}`, { cache: 'force-cache' });
    if (!response.ok) throw new Error('Não consegui carregar a lista de palavras.');
    const text = await response.text();
    const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const set = new Set();
    const map = new Map();

    for (const word of lines) {
      const norm = normalizeWord(word);
      if (norm.length !== WORD_LENGTH) continue;
      set.add(norm);
      if (!map.has(norm)) map.set(norm, word.toLowerCase());
    }

    state.wordSet = set;
    state.wordMap = map;

    if (set.size < 100) {
      throw new Error('Lista de palavras parece vazia ou incompleta.');
    }
  }

  function switchAuthMode(mode) {
    const login = mode === 'login';
    els.tabLogin.classList.toggle('is-active', login);
    els.tabCreate.classList.toggle('is-active', !login);
    els.loginForm.classList.toggle('is-active', login);
    els.createForm.classList.toggle('is-active', !login);
    setAuthMessage('');
  }

  async function handleLogin(event) {
    event.preventDefault();
    const usuario = normalizeUser($('loginUser').value);
    const senha = $('loginPin').value.trim();
    if (!usuario) return setAuthMessage('Informe o usuário.', 'error');
    if (!/^\d{3}$/.test(senha)) return setAuthMessage('A senha precisa ter 3 números.', 'error');

    try {
      setAuthMessage('Entrando...');
      const res = await apiCall({ acao: 'login', usuario, senha, device_id: makeDeviceId() });
      saveSession({ token: res.token, usuario: res.usuario, nome: res.nome, perfil: res.perfil });
      await startGame();
    } catch (err) {
      setAuthMessage(err.message, 'error');
    }
  }

  async function handleCreateAccount(event) {
    event.preventDefault();
    const usuario = normalizeUser($('createUser').value);
    const nome = $('createName').value.trim() || usuario;
    const senha = $('createPin').value.trim();

    if (!usuario || usuario.length < 3) return setAuthMessage('Escolha um usuário com pelo menos 3 caracteres.', 'error');
    if (!/^\d{3}$/.test(senha)) return setAuthMessage('O PIN precisa ter exatamente 3 números.', 'error');

    try {
      setAuthMessage('Criando conta...');
      const res = await apiCall({ acao: 'criarConta', usuario, senha, nome, device_id: makeDeviceId() });
      saveSession({ token: res.token, usuario: res.usuario, nome: res.nome, perfil: res.perfil });
      await startGame();
    } catch (err) {
      setAuthMessage(err.message, 'error');
    }
  }

  async function startGame() {
    if (!state.session?.token) {
      showView('auth');
      return;
    }

    showView('loading');

    try {
      if (!state.wordSet.size) await loadWordList();

      const res = await apiCall({ acao: 'getEstadoInicial', token: state.session.token, device_id: makeDeviceId() });
      applyInitialState(res);
      showView('game');
      renderAll();

      if (state.finished) {
        renderResults(state.finalResult || res.resultado || null);
        showView('results');
      } else if (state.pendingFinalize) {
        showToast('Resultado pendente de envio. Tentando salvar...', 'error');
        finalizeGame();
      }
    } catch (err) {
      clearSession();
      showView('auth');
      setAuthMessage(err.message || 'Não consegui carregar o jogo.', 'error');
    }
  }

  function applyInitialState(res) {
    state.dataJogo = res.data_jogo;
    state.partidaId = res.partida?.partida_id;
    state.respostas = res.respostas || [];
    state.respostasNorm = (res.respostas_normalizadas || state.respostas.map(normalizeWord)).slice(0, BOARD_COUNT);
    state.ficha = res.ficha || {};
    state.ranking = res.ranking || {};
    state.partidaServidor = res.partida || {};
    state.currentGuess = '';
    state.keyStatus = {};

    const serverAttempts = Array.isArray(res.partida?.tentativas) ? res.partida.tentativas : [];
    const local = loadGameLocal();
    const isConcluded = res.partida?.status === 'concluido';

    if (isConcluded) {
      state.tentativas = serverAttempts.length ? serverAttempts : (local?.tentativas || []);
      state.finished = true;
      state.pendingFinalize = false;
      recomputeSolvedAt();
      recomputeKeyStatus();
      state.finalResult = res.resultado || local?.finalResult || null;
      saveGameLocal();
      return;
    }

    if (local && Array.isArray(local.tentativas)) {
      state.tentativas = local.tentativas;
      state.finished = !!local.finished;
      state.pendingFinalize = !!local.pendingFinalize;
      state.finalResult = local.finalResult || null;
      recomputeSolvedAt();
      recomputeKeyStatus();
    } else {
      state.tentativas = [];
      state.solvedAt = [null, null, null, null];
      state.finished = false;
      state.pendingFinalize = false;
      state.finalResult = null;
      saveGameLocal();
    }
  }

  function recomputeSolvedAt() {
    state.solvedAt = [null, null, null, null];
    for (let i = 0; i < state.tentativas.length; i++) {
      const guessNorm = normalizeWord(state.tentativas[i]);
      for (let b = 0; b < BOARD_COUNT; b++) {
        if (state.solvedAt[b]) continue;
        if (guessNorm === state.respostasNorm[b]) state.solvedAt[b] = i + 1;
      }
    }
    state.finished = state.solvedAt.every(Boolean) || state.tentativas.length >= MAX_ATTEMPTS || state.finished;
  }

  function evaluateGuess(guessNorm, answerNorm) {
    const result = Array(WORD_LENGTH).fill('absent');
    const counts = {};
    const guess = guessNorm.split('');
    const answer = answerNorm.split('');

    for (let i = 0; i < WORD_LENGTH; i++) {
      if (guess[i] === answer[i]) {
        result[i] = 'correct';
      } else {
        counts[answer[i]] = (counts[answer[i]] || 0) + 1;
      }
    }

    for (let i = 0; i < WORD_LENGTH; i++) {
      if (result[i] === 'correct') continue;
      const letter = guess[i];
      if (counts[letter] > 0) {
        result[i] = 'present';
        counts[letter] -= 1;
      }
    }

    return result;
  }

  function updateKeyStatus(guessNorm, attemptNumber) {
    const rank = { absent: 1, present: 2, correct: 3 };
    for (let b = 0; b < BOARD_COUNT; b++) {
      // Depois que um tabuleiro já foi resolvido, as próximas tentativas não
      // contam mais visualmente para ele. O teclado deve seguir a mesma regra.
      if (state.solvedAt[b] && attemptNumber > state.solvedAt[b]) continue;

      const pattern = evaluateGuess(guessNorm, state.respostasNorm[b]);
      for (let i = 0; i < WORD_LENGTH; i++) {
        const l = guessNorm[i];
        const status = pattern[i];
        if (!state.keyStatus[l] || rank[status] > rank[state.keyStatus[l]]) {
          state.keyStatus[l] = status;
        }
      }
    }
  }

  function recomputeKeyStatus() {
    state.keyStatus = {};
    for (let i = 0; i < state.tentativas.length; i++) {
      updateKeyStatus(normalizeWord(state.tentativas[i]), i + 1);
    }
  }

  function renderAll() {
    renderHeaderStats();
    renderBoards();
    renderGuessPreview();
    renderKeyboard();
  }

  function renderHeaderStats() {
    els.gameDate.textContent = state.dataJogo ? `jogo de ${formatDisplayDate(state.dataJogo)}` : '--';
    els.playerCurrentStreak.textContent = Number(state.ficha?.sequencia_vitorias_atual || 0);
    els.playerBestStreak.textContent = Number(state.ficha?.melhor_sequencia || 0);
    els.leaderCurrentStreak.textContent = formatLeader(state.ranking?.lider_streak_atual_nome, state.ranking?.lider_streak_atual_valor);
    els.leaderBestStreak.textContent = formatLeader(state.ranking?.lider_melhor_streak_nome, state.ranking?.lider_melhor_streak_valor);
  }

  function formatLeader(nome, valor) {
    const n = nome || '-';
    const v = Number(valor || 0);
    if (!v) return '-';
    return `${n} ${v}`;
  }

  function renderBoards() {
    els.boards.innerHTML = '';

    for (let b = 0; b < BOARD_COUNT; b++) {
      const board = document.createElement('section');
      board.className = `board ${state.solvedAt[b] ? 'solved' : ''}`;

      const title = document.createElement('div');
      title.className = 'board-title';
      title.innerHTML = `<span>palavra ${b + 1}</span><span class="board-status">${state.solvedAt[b] ? `✓ ${state.solvedAt[b]}` : ''}</span>`;
      board.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'board-grid';

      for (let row = 0; row < MAX_ATTEMPTS; row++) {
        const boardSolvedAt = state.solvedAt[b];
        const shouldShowPastGuess = !!state.tentativas[row] && (!boardSolvedAt || row < boardSolvedAt);
        const guess = shouldShowPastGuess ? normalizeWord(state.tentativas[row]) : '';
        const display = shouldShowPastGuess ? (state.tentativas[row] || '') : '';
        const pattern = guess ? evaluateGuess(guess, state.respostasNorm[b]) : null;
        const isCurrentRow = row === state.tentativas.length && !state.finished && !boardSolvedAt;
        const current = isCurrentRow ? state.currentGuess : '';
        const currentDisplay = current.padEnd(WORD_LENGTH, ' ');

        for (let col = 0; col < WORD_LENGTH; col++) {
          const tile = document.createElement('div');
          tile.className = 'tile';
          if (guess) {
            const char = (display[col] || guess[col] || '').toLocaleUpperCase('pt-BR');
            tile.textContent = char;
            tile.classList.add('filled', pattern[col]);
          } else if (isCurrentRow && currentDisplay[col] && currentDisplay[col] !== ' ') {
            tile.textContent = currentDisplay[col].toLocaleUpperCase('pt-BR');
            tile.classList.add('filled', 'current');
          }
          grid.appendChild(tile);
        }
      }

      board.appendChild(grid);
      els.boards.appendChild(board);
    }
  }

  function renderGuessPreview() {
    els.guessPreview.innerHTML = '';
    const padded = state.currentGuess.padEnd(WORD_LENGTH, ' ');
    for (let i = 0; i < WORD_LENGTH; i++) {
      const cell = document.createElement('div');
      cell.className = 'preview-cell';
      cell.textContent = padded[i] !== ' ' ? padded[i].toLocaleUpperCase('pt-BR') : '';
      els.guessPreview.appendChild(cell);
    }
  }

  function renderKeyboard() {
    const rows = [
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
      ['enter', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'back']
    ];
    els.keyboard.innerHTML = '';

    for (const row of rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'key-row';
      for (const key of row) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'key';
        if (key === 'enter' || key === 'back') btn.classList.add('big');
        if (key.length === 1 && state.keyStatus[key]) btn.classList.add(state.keyStatus[key]);
        btn.textContent = key === 'enter' ? 'ENTER' : key === 'back' ? '⌫' : key.toUpperCase();
        btn.addEventListener('click', () => handleKey(key));
        rowEl.appendChild(btn);
      }
      els.keyboard.appendChild(rowEl);
    }
  }

  function handleKey(key) {
    if (state.finished || state.saving) return;
    if (key === 'enter') return submitGuess();
    if (key === 'back') {
      state.currentGuess = state.currentGuess.slice(0, -1);
    } else if (/^[a-z]$/.test(key) && state.currentGuess.length < WORD_LENGTH) {
      state.currentGuess += key;
    }
    renderBoards();
    renderGuessPreview();
  }

  function submitGuess() {
    const guessNorm = normalizeWord(state.currentGuess);
    if (guessNorm.length !== WORD_LENGTH) {
      showToast(`Digite uma palavra com ${WORD_LENGTH} letras.`, 'error');
      return;
    }
    if (!state.wordSet.has(guessNorm)) {
      showToast('Palavra não encontrada na lista.', 'error');
      return;
    }
    if (state.tentativas.length >= MAX_ATTEMPTS) return;

    const canonical = state.wordMap.get(guessNorm) || guessNorm;
    state.tentativas.push(canonical);
    state.currentGuess = '';
    recomputeSolvedAt();
    recomputeKeyStatus();
    saveGameLocal();
    renderAll();

    if (state.solvedAt.every(Boolean)) {
      state.finished = true;
      showToast('Você acertou as 4 palavras!', 'success');
      saveGameLocal();
      finalizeGame();
    } else if (state.tentativas.length >= MAX_ATTEMPTS) {
      state.finished = true;
      showToast('Fim das tentativas.', 'error');
      saveGameLocal();
      finalizeGame();
    }
  }

  async function finalizeGame() {
    if (state.saving || !state.session?.token || !state.partidaId) return;
    state.saving = true;
    state.pendingFinalize = true;
    saveGameLocal();
    renderAll();

    try {
      showToast('Salvando resultado...');
      const res = await apiCall({
        acao: 'finalizarPartida',
        token: state.session.token,
        partida_id: state.partidaId,
        data_jogo: state.dataJogo,
        tentativas: state.tentativas
      }, 45000);

      state.pendingFinalize = false;
      state.finalResult = res;
      state.ficha = res.ficha || state.ficha;
      state.ranking = res.ranking || state.ranking;
      saveGameLocal();
      renderHeaderStats();
      renderResults(res);
      showView('results');
    } catch (err) {
      state.pendingFinalize = true;
      saveGameLocal();
      renderResults({ ok: false, erro: err.message, ficha: state.ficha, ranking: state.ranking });
      els.retrySaveButton.classList.remove('hidden');
      showView('results');
    } finally {
      state.saving = false;
    }
  }

  function renderResults(result) {
    const ficha = result?.ficha || state.ficha || {};
    const ranking = result?.ranking || state.ranking || {};
    const venceu = result?.venceu;

    els.resultTitle.textContent = 'progresso';
    els.resultSubtitle.textContent = result?.erro
      ? `Resultado ainda não salvo: ${result.erro}`
      : venceu === true
        ? `Você venceu em ${result.tentativas_usadas || state.tentativas.length} tentativa(s).`
        : venceu === false
          ? 'Você não acertou todas hoje.'
          : 'Resultado do jogador.';

    els.statGames.textContent = Number(ficha.total_jogos || 0);
    els.statWinPct.textContent = `${Number(ficha.pct_vitorias || 0)}%`;
    els.statCurrentStreak.textContent = Number(ficha.sequencia_vitorias_atual || 0);
    els.statBestStreak.textContent = Number(ficha.melhor_sequencia || 0);
    els.modalLeaderCurrent.textContent = formatLeader(ranking.lider_streak_atual_nome, ranking.lider_streak_atual_valor);
    els.modalLeaderBest.textContent = formatLeader(ranking.lider_melhor_streak_nome, ranking.lider_melhor_streak_valor);

    const dist = {};
    for (let i = 1; i <= MAX_ATTEMPTS; i++) dist[i] = Number(ficha[`dist_${i}`] || 0);
    dist.perdas = Number(ficha.dist_perdas || 0);
    renderDistribution(dist);
    els.retrySaveButton.classList.toggle('hidden', !state.pendingFinalize);
  }

  function renderDistribution(dist) {
    els.attemptDistribution.innerHTML = '';
    const values = [];
    for (let i = 1; i <= MAX_ATTEMPTS; i++) values.push(Number(dist[i] || 0));
    values.push(Number(dist.perdas || 0));
    const max = Math.max(1, ...values);

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      addDistRow(String(i), Number(dist[i] || 0), max);
    }
    addDistRow('☠', Number(dist.perdas || 0), max);
  }

  function addDistRow(label, value, max) {
    const row = document.createElement('div');
    row.className = 'dist-row';
    const width = value ? Math.max(8, Math.round((value / max) * 100)) : 0;
    row.innerHTML = `
      <div class="dist-label">${label}</div>
      <div class="dist-bar-wrap"><div class="dist-bar" style="width:${width}%">${value || ''}</div></div>
      <div class="dist-value">${value || '0'}</div>
    `;
    els.attemptDistribution.appendChild(row);
  }

  async function shareResult() {
    const linhas = [];
    const venceu = state.solvedAt.every(Boolean);
    linhas.push(`Sexto ${formatDisplayDate(state.dataJogo)}`);
    linhas.push(venceu ? `Venci em ${state.tentativas.length}/${MAX_ATTEMPTS}` : `Não completei em ${MAX_ATTEMPTS}`);
    linhas.push(`Sequência: ${state.ficha?.sequencia_vitorias_atual || 0}`);
    const text = linhas.join('\n');

    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        showToast('Resultado copiado.', 'success');
      }
    } catch (err) {
      // Usuário cancelou compartilhamento.
    }
  }

  function attachEvents() {
    els.tabLogin.addEventListener('click', () => switchAuthMode('login'));
    els.tabCreate.addEventListener('click', () => switchAuthMode('create'));
    els.loginForm.addEventListener('submit', handleLogin);
    els.createForm.addEventListener('submit', handleCreateAccount);
    els.logoutButton.addEventListener('click', () => {
      clearSession();
      showView('auth');
      setAuthMessage('Sessão encerrada.');
    });
    els.backToGameButton.addEventListener('click', () => showView('game'));
    els.shareButton.addEventListener('click', shareResult);
    els.retrySaveButton.addEventListener('click', finalizeGame);

    window.addEventListener('keydown', (event) => {
      if (!els.gameView.classList.contains('is-active')) return;
      if (event.key === 'Enter') return handleKey('enter');
      if (event.key === 'Backspace') return handleKey('back');
      const k = normalizeWord(event.key);
      if (/^[a-z]$/.test(k)) handleKey(k);
    });
  }

  async function boot() {
    attachEvents();
    showView('loading');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    }

    if (!ensureConfigReady()) return;

    try {
      await loadWordList();
      const session = loadSession();
      if (session?.token) {
        await startGame();
      } else {
        showView('auth');
      }
    } catch (err) {
      showView('auth');
      setAuthMessage(err.message, 'error');
    }
  }

  boot();
})();
