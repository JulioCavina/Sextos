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
    cursorIndex: 0,
    finished: false,
    finalResult: null,
    saving: false,
    keyStatus: {},
    pendingFinalize: false,
    finishedBoardReturnArmed: false
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
    gameScroll: $('gameScroll'),
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
      currentGuess: state.currentGuess,
      cursorIndex: state.cursorIndex,
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

  function showToast(text, type = '', durationMs = 2400) {
    window.clearTimeout(showToast._timer);
    els.toast.textContent = text || '';
    els.toast.className = `toast ${type}`.trim();

    if (text && durationMs > 0) {
      showToast._timer = window.setTimeout(() => {
        els.toast.textContent = '';
        els.toast.className = 'toast';
      }, durationMs);
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
        state.finishedBoardReturnArmed = false;
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
    state.cursorIndex = 0;
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
      state.currentGuess = sanitizeCurrentGuess(local.currentGuess || '');
      state.cursorIndex = clampCursor(Number(local.cursorIndex || 0));
      recomputeSolvedAt();
      recomputeKeyStatus();
    } else {
      state.tentativas = [];
      state.solvedAt = [null, null, null, null];
      state.finished = false;
      state.currentGuess = '';
      state.cursorIndex = 0;
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
        if (!state.keyStatus[l]) state.keyStatus[l] = Array(BOARD_COUNT).fill('');
        const atual = state.keyStatus[l][b] || '';
        if (!atual || rank[status] > rank[atual]) {
          state.keyStatus[l][b] = status;
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

  function sanitizeCurrentGuess(value) {
    const raw = String(value || '').slice(0, WORD_LENGTH);
    const letters = Array(WORD_LENGTH).fill('');

    if (raw.includes(' ')) {
      for (let i = 0; i < WORD_LENGTH; i++) {
        const letter = normalizeWord(raw[i] || '').slice(0, 1);
        letters[i] = letter || '';
      }
    } else {
      const clean = normalizeWord(raw).slice(0, WORD_LENGTH);
      for (let i = 0; i < clean.length; i++) letters[i] = clean[i];
    }

    return letters.map(l => l || ' ').join('');
  }

  function getCurrentLetters() {
    const letters = Array(WORD_LENGTH).fill('');
    const raw = String(state.currentGuess || '').padEnd(WORD_LENGTH, ' ').slice(0, WORD_LENGTH);

    for (let i = 0; i < WORD_LENGTH; i++) {
      const letter = normalizeWord(raw[i] || '').slice(0, 1);
      letters[i] = letter || '';
    }

    return letters;
  }

  function setCurrentLetters(letters) {
    state.currentGuess = Array.from({ length: WORD_LENGTH }, (_, i) => normalizeWord(letters[i] || '').slice(0, 1) || ' ').join('');
  }

  function clampCursor(index) {
    const value = Number.isFinite(index) ? index : 0;
    return Math.max(0, Math.min(WORD_LENGTH - 1, Math.trunc(value)));
  }

  function setCursor(index, shouldRender = true) {
    if (state.finished || state.saving) return;
    state.cursorIndex = clampCursor(index);
    saveGameLocal();
    if (shouldRender) renderAll();
  }

  function nextCursorAfter(index, letters) {
    for (let i = index + 1; i < WORD_LENGTH; i++) {
      if (!letters[i]) return i;
    }
    for (let i = 0; i <= index; i++) {
      if (!letters[i]) return i;
    }
    return clampCursor(index);
  }

  function previousCursorBefore(index, letters) {
    for (let i = index - 1; i >= 0; i--) {
      if (letters[i]) return i;
    }
    for (let i = index - 1; i >= 0; i--) {
      if (!letters[i]) return i;
    }
    return Math.max(0, index - 1);
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
    const currentLetters = getCurrentLetters();

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

        for (let col = 0; col < WORD_LENGTH; col++) {
          const tile = document.createElement('button');
          tile.type = 'button';
          tile.className = 'tile';
          tile.setAttribute('aria-label', `Palavra ${b + 1}, tentativa ${row + 1}, posição ${col + 1}`);

          if (guess) {
            const char = (display[col] || guess[col] || '').toLocaleUpperCase('pt-BR');
            tile.textContent = char;
            tile.classList.add('filled', pattern[col]);
            tile.disabled = true;
          } else if (isCurrentRow) {
            tile.classList.add('selectable');
            if (col === state.cursorIndex) tile.classList.add('cursor');
            if (currentLetters[col]) {
              tile.textContent = currentLetters[col].toLocaleUpperCase('pt-BR');
              tile.classList.add('filled', 'current');
            }
            tile.addEventListener('click', () => setCursor(col));
          } else {
            tile.disabled = true;
          }
          grid.appendChild(tile);
        }
      }

      board.appendChild(grid);
      els.boards.appendChild(board);
    }
  }

  function renderGuessPreview() {
    if (!els.guessPreview) return;
    els.guessPreview.innerHTML = '';
  }

  function getKeyboardStatusesForRender(letter) {
    const statuses = (state.keyStatus[letter] || Array(BOARD_COUNT).fill('')).slice(0, BOARD_COUNT);
    while (statuses.length < BOARD_COUNT) statuses.push('');

    const hasAnyInformation = statuses.some(Boolean);
    if (!hasAnyInformation) return statuses;

    // Quando alguns tabuleiros já foram resolvidos, eles deixam de receber
    // tentativas novas. Se todas as palavras ainda abertas já têm informação
    // para essa letra, os quadrantes sem informação passam a aparecer como
    // ausentes, evitando o visual de "quadrante não feito" no fim da partida.
    const openBoards = [];
    for (let b = 0; b < BOARD_COUNT; b++) {
      if (!state.solvedAt[b]) openBoards.push(b);
    }

    const allOpenBoardsKnown = openBoards.length === 0 || openBoards.every(b => !!statuses[b]);
    if (allOpenBoardsKnown) {
      return statuses.map(status => status || 'absent');
    }

    return statuses;
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

        if (key.length === 1) {
          btn.classList.add('letter-key');
          const statuses = getKeyboardStatusesForRender(key);
          btn.innerHTML = `
            <span class="key-letter">${key.toUpperCase()}</span>
            <span class="key-segments" aria-hidden="true">
              ${statuses.map(status => `<i class="seg ${status || 'unknown'}"></i>`).join('')}
            </span>
          `;
        } else {
          btn.textContent = key === 'enter' ? 'ENTER' : '⌫';
        }

        btn.addEventListener('click', () => handleKey(key));
        rowEl.appendChild(btn);
      }
      els.keyboard.appendChild(rowEl);
    }
  }

  function handleKey(key) {
    if (state.finished || state.saving) return;
    if (key === 'enter') return submitGuess();

    const letters = getCurrentLetters();

    if (key === 'back') {
      if (letters[state.cursorIndex]) {
        letters[state.cursorIndex] = '';
      } else {
        const prev = previousCursorBefore(state.cursorIndex, letters);
        state.cursorIndex = clampCursor(prev);
        letters[state.cursorIndex] = '';
      }
      setCurrentLetters(letters);
    } else if (/^[a-z]$/.test(key)) {
      letters[state.cursorIndex] = key;
      state.cursorIndex = nextCursorAfter(state.cursorIndex, letters);
      setCurrentLetters(letters);
    }

    saveGameLocal();
    renderAll();
  }

  function submitGuess() {
    const letters = getCurrentLetters();
    if (letters.some(l => !l)) {
      showToast(`Preencha as ${WORD_LENGTH} letras antes de enviar.`, 'error');
      return;
    }
    const guessNorm = normalizeWord(letters.join(''));
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
    state.cursorIndex = 0;
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
      showToast('Salvando resultado...', 'success', 0);
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
      state.finishedBoardReturnArmed = false;
      showToast('', '');
      showView('results');
    } catch (err) {
      state.pendingFinalize = true;
      saveGameLocal();
      renderResults({ ok: false, erro: err.message, ficha: state.ficha, ranking: state.ranking });
      els.retrySaveButton.classList.remove('hidden');
      state.finishedBoardReturnArmed = false;
      showToast('', '');
      showView('results');
    } finally {
      state.saving = false;
    }
  }

  function renderResults(result) {
    const ficha = result?.ficha || state.ficha || {};
    const ranking = result?.ranking || state.ranking || {};
    const venceu = result?.venceu;

    els.resultTitle.textContent = 'Progresso';
    els.resultSubtitle.textContent = result?.erro
      ? `Resultado ainda não salvo: ${result.erro}`
      : venceu === true
        ? `Você venceu em ${result.tentativas_usadas || state.tentativas.length} tentativas.`
        : venceu === false
          ? 'Você foi Sextado.'
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
    const firstPossible = BOARD_COUNT;
    const values = [];
    for (let i = firstPossible; i <= MAX_ATTEMPTS; i++) values.push(Number(dist[i] || 0));
    values.push(Number(dist.perdas || 0));
    const max = Math.max(1, ...values);

    for (let i = firstPossible; i <= MAX_ATTEMPTS; i++) {
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

  function emojiForStatus(status) {
    if (status === 'correct') return '🟩';
    if (status === 'present') return '🟨';
    if (status === 'absent') return '⬛';
    return '⬛';
  }

  function buildShareText() {
    const ficha = state.finalResult?.ficha || state.ficha || {};
    const tentativas = state.finalResult?.tentativas_usadas || state.tentativas.length;
    const scoreAtual = Number(ficha.sequencia_vitorias_atual || 0);
    const shareUrl = CONFIG.SHARE_URL || window.location.href.split('#')[0];

    return [
      `Sexto — ${formatDisplayDate(state.dataJogo)} 🔥 ${scoreAtual}`,
      `Tentativas: ${tentativas}/${MAX_ATTEMPTS}`,
      shareUrl
    ].join('\n');
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function createShareImageBlob() {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const scale = 2;
      const width = 720;
      const height = 520;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      const colors = {
        bg: '#6f6068',
        card: '#75666e',
        empty: '#342d32',
        correct: '#45b7a8',
        present: '#e0b765',
        absent: '#342d32',
        text: '#f7f2f6',
        muted: '#d8ced5'
      };

      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, width, height);
      roundRect(ctx, 18, 18, width - 36, height - 36, 14);
      ctx.fillStyle = colors.card;
      ctx.fill();

      ctx.fillStyle = colors.text;
      ctx.textAlign = 'center';
      ctx.font = '700 30px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillText(`Sexto ${formatDisplayDate(state.dataJogo)}`, width / 2, 64);

      const boardW = 148;
      const gap = 18;
      const startX = (width - (boardW * 4 + gap * 3)) / 2;
      const startY = 100;
      const cell = 18;
      const cellGap = 5;
      const solved = state.solvedAt.every(Boolean);

      for (let b = 0; b < BOARD_COUNT; b++) {
        const x0 = startX + b * (boardW + gap);
        ctx.fillStyle = colors.muted;
        ctx.font = '700 14px system-ui, -apple-system, Segoe UI, sans-serif';
        ctx.fillText(String(b + 1), x0 + boardW / 2, startY - 12);

        for (let row = 0; row < MAX_ATTEMPTS; row++) {
          let pattern = null;
          if (state.tentativas[row] && (!state.solvedAt[b] || row + 1 <= state.solvedAt[b])) {
            pattern = evaluateGuess(normalizeWord(state.tentativas[row]), state.respostasNorm[b]);
          }
          for (let col = 0; col < WORD_LENGTH; col++) {
            const status = pattern ? pattern[col] : 'empty';
            ctx.fillStyle = colors[status] || colors.empty;
            roundRect(ctx, x0 + col * (cell + cellGap), startY + row * (cell + cellGap), cell, cell, 4);
            ctx.fill();
          }
        }
      }

      ctx.fillStyle = colors.text;
      ctx.textAlign = 'left';
      ctx.font = '700 25px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillText(solved ? `🔥 ${state.tentativas.length}/${MAX_ATTEMPTS}` : `☠ ${state.tentativas.length}/${MAX_ATTEMPTS}`, 48, 468);
      ctx.textAlign = 'right';
      ctx.font = '700 18px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillText('Sexto', width - 48, 466);
      ctx.font = '500 14px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillStyle = colors.muted;
      ctx.fillText(window.location.host || 'sexto', width - 48, 488);

      canvas.toBlob((blob) => resolve(blob), 'image/png', 0.95);
    });
  }

  async function shareResult() {
    const text = buildShareText();

    try {
      const blob = await createShareImageBlob();
      const file = blob ? new File([blob], `sexto-${state.dataJogo || 'resultado'}.png`, { type: 'image/png' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text, title: 'Sexto' });
      } else if (navigator.share) {
        await navigator.share({ text, title: 'Sexto' });
      } else {
        await navigator.clipboard.writeText(text);
        showToast('Resultado copiado.', 'success');
      }
    } catch (err) {
      // Usuário cancelou compartilhamento ou o navegador não permitiu.
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
    els.backToGameButton.addEventListener('click', () => {
      state.finishedBoardReturnArmed = true;
      showView('game');
      showToast('Toque no tabuleiro para voltar ao placar.', 'success');
    });
    els.shareButton.addEventListener('click', shareResult);
    els.retrySaveButton.addEventListener('click', finalizeGame);
    els.gameView.addEventListener('click', (event) => {
      if (!state.finished || !state.finishedBoardReturnArmed) return;
      if (event.target.closest('button')) return;
      state.finishedBoardReturnArmed = false;
      renderResults(state.finalResult || { ficha: state.ficha, ranking: state.ranking, venceu: state.solvedAt.every(Boolean), tentativas_usadas: state.tentativas.length });
      showView('results');
    });

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
