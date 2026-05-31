/**********************
 * SEXTO - Apps Script API
 * Backend gratuito para GitHub Pages + Google Sheets.
 *
 * Como usar:
 * 1) Abra a planilha do Sexto > Extensões > Apps Script.
 * 2) Cole este arquivo inteiro no Code.gs.
 * 3) Ajuste o fuso do projeto para America/Sao_Paulo.
 * 4) Implante como App da Web:
 *    - Executar como: Eu
 *    - Quem tem acesso: Qualquer pessoa
 **********************/

const SPREADSHEET_ID = ''; // Opcional. Deixe vazio se o script estiver vinculado à planilha.
const DEFAULT_TZ = 'America/Sao_Paulo';
const WORD_LENGTH = 6;
const BOARD_COUNT = 4;
const MAX_ATTEMPTS = 10;

const SHEETS = {
  CONFIG: 'Config',
  JOGADORES: 'Jogadores',
  PALAVRAS_DIA: 'Palavras_Dia',
  PARTIDAS: 'Partidas',
  TENTATIVAS: 'Tentativas',
  SESSOES: 'Sessoes',
  HISTORICO_ACOES: 'Historico_Acoes',
  LOGS: 'Logs'
};

const HEADERS = {
  Config: ['chave', 'valor', 'observacao'],
  Jogadores: [
    'usuario', 'senha_pin', 'nome_exibicao', 'ativo', 'perfil', 'criado_em', 'ultimo_login_em',
    'ultimo_jogo_data', 'ultimo_jogo_status', 'ultima_vitoria_data', 'sequencia_vitorias_atual',
    'melhor_sequencia', 'total_jogos', 'total_vitorias', 'total_derrotas', 'pct_vitorias',
    'dist_1', 'dist_2', 'dist_3', 'dist_4', 'dist_5', 'dist_6', 'dist_7', 'dist_8', 'dist_9', 'dist_10',
    'dist_perdas', 'media_tentativas_vitorias', 'melhor_tentativa_vitoria', 'ultima_partida_id',
    'device_principal_id', 'observacao'
  ],
  Palavras_Dia: [
    'data_jogo', 'palavra_1', 'palavra_2', 'palavra_3', 'palavra_4',
    'normalizada_1', 'normalizada_2', 'normalizada_3', 'normalizada_4',
    'lista_origem', 'lista_versao', 'gerado_em', 'gerado_por', 'chave_dia', 'ativo', 'observacao'
  ],
  Partidas: [
    'partida_id', 'data_jogo', 'usuario', 'status', 'iniciada_em', 'finalizada_em', 'venceu',
    'tentativas_usadas', 'tabuleiros_acertados', 'palavras_chave_dia', 'respostas_json',
    'tentativas_json', 'solved_at_json', 'resultado_json', 'streak_antes', 'streak_depois',
    'device_id', 'observacao'
  ],
  Tentativas: [
    'tentativa_id', 'partida_id', 'data_jogo', 'usuario', 'num_tentativa', 'palavra', 'normalizada',
    'padrao_1', 'padrao_2', 'padrao_3', 'padrao_4',
    'acertou_apos_1', 'acertou_apos_2', 'acertou_apos_3', 'acertou_apos_4', 'criada_em'
  ],
  Sessoes: [
    'token', 'usuario', 'criado_em', 'ultima_validacao_em', 'expira_em', 'ativo', 'device_id', 'perfil'
  ],
  Historico_Acoes: ['data_hora', 'usuario', 'acao', 'detalhe', 'payload_resumido'],
  Logs: ['data_hora', 'nivel', 'etapa', 'mensagem', 'payload_resumido']
};

function doGet(e) {
  return handleRequest_(e, 'GET');
}

function doPost(e) {
  return handleRequest_(e, 'POST');
}

function handleRequest_(e, method) {
  let payload = {};
  let callback = '';

  try {
    const params = (e && e.parameter) || {};
    callback = params.callback || '';

    if (params.payload) {
      payload = JSON.parse(params.payload);
    } else if (method === 'POST' && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else {
      payload = params || {};
    }

    const result = route_(payload || {});
    return respond_(result, callback);
  } catch (err) {
    try { logError_('handleRequest', err && err.message ? err.message : String(err), payload); } catch (ignored) {}
    return respond_({ ok: false, erro: err && err.message ? err.message : String(err) }, callback);
  }
}

function route_(payload) {
  initWorkbook_();
  const acao = String(payload.acao || '').trim();
  if (!acao) return { ok: false, erro: 'Ação não informada.' };

  switch (acao) {
    case 'criarConta':
      return criarConta_(payload);
    case 'login':
      return login_(payload);
    case 'validarSessao':
      return validarSessaoAction_(payload);
    case 'getEstadoInicial':
      return getEstadoInicial_(payload);
    case 'finalizarPartida':
      return finalizarPartida_(payload);
    case 'getRanking':
      return { ok: true, ranking: getRanking_() };
    default:
      return { ok: false, erro: 'Ação desconhecida: ' + acao };
  }
}

function respond_(data, callback) {
  const json = JSON.stringify(data || {});
  if (callback) {
    return ContentService
      .createTextOutput(String(callback).replace(/[^a-zA-Z0-9_.$]/g, '') + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function getSS_() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Planilha não encontrada. Vincule este Apps Script à planilha ou preencha SPREADSHEET_ID.');
  return ss;
}

function initWorkbook_() {
  Object.keys(HEADERS).forEach(function(sheetName) {
    ensureSheet_(sheetName, HEADERS[sheetName]);
  });
  ensureDefaultConfig_();
}

function ensureSheet_(sheetName, headers) {
  const ss = getSS_();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const existing = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v) { return String(v || '').trim(); });
  const hasAny = existing.some(Boolean);

  if (!hasAny) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleHeader_(sheet, headers.length);
    return sheet;
  }

  let changed = false;
  const current = existing.filter(Boolean);
  headers.forEach(function(h) {
    if (current.indexOf(h) === -1) {
      current.push(h);
      changed = true;
    }
  });

  if (changed) {
    sheet.getRange(1, 1, 1, current.length).setValues([current]);
    styleHeader_(sheet, current.length);
  }
  return sheet;
}

function styleHeader_(sheet, colCount) {
  sheet.getRange(1, 1, 1, colCount)
    .setFontWeight('bold')
    .setBackground('#e8f2e8')
    .setHorizontalAlignment('center');
  sheet.setFrozenRows(1);
}

function ensureDefaultConfig_() {
  const defaults = [
    ['app_nome', 'Sexto', 'Nome exibido no app'],
    ['tamanho_palavra', '6', 'Quantidade de letras por palavra'],
    ['qtd_tabuleiros', '4', 'Quantidade de jogos simultâneos'],
    ['max_tentativas', '10', 'Tentativas máximas por partida'],
    ['timezone', DEFAULT_TZ, 'Fuso usado para a data do jogo'],
    ['url_lista_palavras_raw', '', 'URL raw do arquivo .txt no GitHub'],
    ['arquivo_lista_palavras', 'palavras_sexto_6_letras_filtradas_curadas.txt', 'Nome do arquivo de palavras'],
    ['lista_versao', 'v1', 'Versão lógica da lista'],
    ['pin_tamanho', '3', 'PIN do jogador'],
    ['sessao_dias', '3650', 'Duração da sessão/token em dias']
  ];

  const existing = readRows_(SHEETS.CONFIG).reduce(function(acc, r) {
    acc[String(r.chave || '')] = true;
    return acc;
  }, {});

  defaults.forEach(function(row) {
    if (!existing[row[0]]) appendRow_(SHEETS.CONFIG, { chave: row[0], valor: row[1], observacao: row[2] });
  });
}

function getHeaders_(sheetName) {
  const sheet = ensureSheet_(sheetName, HEADERS[sheetName] || []);
  const lastCol = sheet.getLastColumn();
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(v) { return String(v || '').trim(); });
}

function readRows_(sheetName) {
  const sheet = ensureSheet_(sheetName, HEADERS[sheetName] || []);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) return [];
  const headers = getHeaders_(sheetName);
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return values.map(function(row, idx) {
    const obj = { _row: idx + 2 };
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function appendRow_(sheetName, obj) {
  const sheet = ensureSheet_(sheetName, HEADERS[sheetName] || []);
  const headers = getHeaders_(sheetName);
  const row = headers.map(function(h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
  return sheet.getLastRow();
}

function updateRow_(sheetName, rowNumber, patch) {
  const sheet = ensureSheet_(sheetName, HEADERS[sheetName] || []);
  const headers = getHeaders_(sheetName);
  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  const values = range.getValues()[0];
  headers.forEach(function(h, i) {
    if (patch[h] !== undefined) values[i] = patch[h];
  });
  range.setValues([values]);
}

function getConfig_() {
  const rows = readRows_(SHEETS.CONFIG);
  const cfg = {};
  rows.forEach(function(r) {
    const key = String(r.chave || '').trim();
    if (key) cfg[key] = r.valor;
  });
  return cfg;
}

function tz_() {
  return String(getConfig_().timezone || DEFAULT_TZ);
}

function now_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
}

function today_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function addDays_(dateKey, days) {
  const parts = String(dateKey).split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + days);
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}

function normalizeDateKey_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, tz_(), 'yyyy-MM-dd');
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
  return s.slice(0, 10);
}

function normalizeWord_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/g, 'c')
    .replace(/[^a-z]/g, '');
}

function normalizeUser_(value) {
  return normalizeWord_(value).replace(/[^a-z0-9_]/g, '').slice(0, 24);
}

function toNumber_(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;
  const n = Number(String(value).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function boolText_(value) {
  const s = String(value || '').toUpperCase().trim();
  return !(s === 'NAO' || s === 'NÃO' || s === 'FALSE' || s === '0' || s === 'INATIVO');
}

function criarConta_(payload) {
  const usuario = normalizeUser_(payload.usuario);
  const senha = String(payload.senha || '').trim();
  const nome = String(payload.nome || usuario).trim().slice(0, 40) || usuario;
  const deviceId = String(payload.device_id || '').slice(0, 80);

  if (!usuario || usuario.length < 3) throw new Error('Escolha um usuário com pelo menos 3 caracteres.');
  if (!/^\d{3}$/.test(senha)) throw new Error('O PIN precisa ter exatamente 3 números.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const jogadores = readRows_(SHEETS.JOGADORES);
    const exists = jogadores.some(function(j) { return normalizeUser_(j.usuario) === usuario; });
    if (exists) throw new Error('Esse usuário já foi escolhido.');

    appendRow_(SHEETS.JOGADORES, {
      usuario: usuario,
      senha_pin: senha,
      nome_exibicao: nome,
      ativo: 'SIM',
      perfil: 'jogador',
      criado_em: now_(),
      ultimo_login_em: now_(),
      sequencia_vitorias_atual: 0,
      melhor_sequencia: 0,
      total_jogos: 0,
      total_vitorias: 0,
      total_derrotas: 0,
      pct_vitorias: 0,
      dist_1: 0, dist_2: 0, dist_3: 0, dist_4: 0, dist_5: 0,
      dist_6: 0, dist_7: 0, dist_8: 0, dist_9: 0, dist_10: 0,
      dist_perdas: 0,
      media_tentativas_vitorias: 0,
      melhor_tentativa_vitoria: '',
      device_principal_id: deviceId
    });

    registrarAcao_(usuario, 'criarConta', 'Conta criada', { device_id: deviceId });
    return criarSessaoResponse_(usuario, deviceId);
  } finally {
    lock.releaseLock();
  }
}

function login_(payload) {
  const usuario = normalizeUser_(payload.usuario);
  const senha = String(payload.senha || '').trim();
  const deviceId = String(payload.device_id || '').slice(0, 80);

  if (!usuario) throw new Error('Informe o usuário.');
  if (!/^\d{3}$/.test(senha)) throw new Error('O PIN precisa ter exatamente 3 números.');

  const jogadores = readRows_(SHEETS.JOGADORES);
  const jogador = jogadores.find(function(j) { return normalizeUser_(j.usuario) === usuario; });
  if (!jogador || !boolText_(jogador.ativo)) throw new Error('Usuário não encontrado ou inativo.');
  if (String(jogador.senha_pin || '').trim() !== senha) throw new Error('Usuário ou senha inválidos.');

  updateRow_(SHEETS.JOGADORES, jogador._row, {
    ultimo_login_em: now_(),
    device_principal_id: jogador.device_principal_id || deviceId
  });

  registrarAcao_(usuario, 'login', 'Login realizado', { device_id: deviceId });
  return criarSessaoResponse_(usuario, deviceId);
}

function criarSessaoResponse_(usuario, deviceId) {
  const jogador = getJogador_(usuario);
  const cfg = getConfig_();
  const dias = Math.max(1, toNumber_(cfg.sessao_dias || 3650));
  const token = Utilities.getUuid() + '-' + Utilities.getUuid();
  const criado = new Date();
  const expira = new Date(criado.getTime() + dias * 24 * 60 * 60 * 1000);

  appendRow_(SHEETS.SESSOES, {
    token: token,
    usuario: usuario,
    criado_em: now_(),
    ultima_validacao_em: now_(),
    expira_em: Utilities.formatDate(expira, tz_(), 'yyyy-MM-dd HH:mm:ss'),
    ativo: 'SIM',
    device_id: deviceId,
    perfil: jogador.perfil || 'jogador'
  });

  return {
    ok: true,
    token: token,
    usuario: usuario,
    nome: jogador.nome_exibicao || usuario,
    perfil: jogador.perfil || 'jogador'
  };
}

function validarSessaoAction_(payload) {
  const ctx = validarToken_(payload.token);
  return { ok: true, usuario: ctx.usuario, nome: ctx.jogador.nome_exibicao || ctx.usuario, perfil: ctx.jogador.perfil || 'jogador' };
}

function validarToken_(token) {
  token = String(token || '').trim();
  if (!token) throw new Error('Sessão inválida. Faça login novamente.');

  const sessoes = readRows_(SHEETS.SESSOES);
  const sessao = sessoes.find(function(s) { return String(s.token || '') === token && boolText_(s.ativo); });
  if (!sessao) throw new Error('Sessão expirada. Faça login novamente.');

  const expira = String(sessao.expira_em || '9999-12-31');
  if (expira.slice(0, 10) < today_()) throw new Error('Sessão expirada. Faça login novamente.');

  const usuario = normalizeUser_(sessao.usuario);
  const jogador = getJogador_(usuario);
  if (!jogador || !boolText_(jogador.ativo)) throw new Error('Usuário inativo.');

  updateRow_(SHEETS.SESSOES, sessao._row, { ultima_validacao_em: now_() });
  return { usuario: usuario, jogador: jogador, sessao: sessao };
}

function getJogador_(usuario) {
  const norm = normalizeUser_(usuario);
  return readRows_(SHEETS.JOGADORES).find(function(j) { return normalizeUser_(j.usuario) === norm; });
}

function getEstadoInicial_(payload) {
  const ctx = validarToken_(payload.token);
  const dataJogo = today_();
  const palavrasDia = garantirPalavrasDoDia_(dataJogo);
  const partida = getOuCriarPartida_(ctx.usuario, dataJogo, palavrasDia, payload.device_id || ctx.sessao.device_id || '');
  const ficha = recalcularFichaJogador_(ctx.usuario);
  const ranking = getRanking_();
  const tentativas = partida.status === 'concluido' ? getTentativasPartida_(partida.partida_id) : [];

  return {
    ok: true,
    data_jogo: dataJogo,
    respostas: palavrasDia.palavras,
    respostas_normalizadas: palavrasDia.normalizadas,
    max_tentativas: MAX_ATTEMPTS,
    qtd_tabuleiros: BOARD_COUNT,
    ficha: ficha,
    ranking: ranking,
    partida: {
      partida_id: partida.partida_id,
      status: partida.status,
      tentativas: tentativas,
      iniciou_em: partida.iniciada_em || '',
      finalizada_em: partida.finalizada_em || ''
    },
    resultado: partida.status === 'concluido' ? safeJsonParse_(partida.resultado_json, null) : null
  };
}

function garantirPalavrasDoDia_(dataJogo) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    let existente = findPalavrasDia_(dataJogo);
    if (existente) return existente;

    const cfg = getConfig_();
    const url = String(cfg.url_lista_palavras_raw || '').trim();
    if (!url) {
      throw new Error('Configure a chave url_lista_palavras_raw na aba Config com a URL raw da lista de palavras.');
    }

    const lista = carregarListaPalavras_(url);
    if (lista.length < BOARD_COUNT) throw new Error('Lista de palavras insuficiente.');

    const escolhidas = escolherPalavras_(lista, BOARD_COUNT);
    const normalizadas = escolhidas.map(normalizeWord_);
    const chave = 'sexto_' + dataJogo;

    appendRow_(SHEETS.PALAVRAS_DIA, {
      data_jogo: dataJogo,
      palavra_1: escolhidas[0],
      palavra_2: escolhidas[1],
      palavra_3: escolhidas[2],
      palavra_4: escolhidas[3],
      normalizada_1: normalizadas[0],
      normalizada_2: normalizadas[1],
      normalizada_3: normalizadas[2],
      normalizada_4: normalizadas[3],
      lista_origem: cfg.arquivo_lista_palavras || 'lista_txt',
      lista_versao: cfg.lista_versao || 'v1',
      gerado_em: now_(),
      gerado_por: 'sistema',
      chave_dia: chave,
      ativo: 'SIM',
      observacao: 'Gerado automaticamente no primeiro acesso do dia.'
    });

    registrarAcao_('sistema', 'sortearPalavrasDoDia', dataJogo, { palavras: escolhidas });
    return findPalavrasDia_(dataJogo);
  } finally {
    lock.releaseLock();
  }
}

function findPalavrasDia_(dataJogo) {
  const rows = readRows_(SHEETS.PALAVRAS_DIA);
  const row = rows.find(function(r) {
    return normalizeDateKey_(r.data_jogo) === dataJogo && boolText_(r.ativo);
  });
  if (!row) return null;
  const palavras = [row.palavra_1, row.palavra_2, row.palavra_3, row.palavra_4].map(function(w) { return String(w || '').trim().toLowerCase(); });
  const normalizadas = [row.normalizada_1, row.normalizada_2, row.normalizada_3, row.normalizada_4].map(function(w, i) {
    return String(w || normalizeWord_(palavras[i])).trim();
  });
  return { row: row, palavras: palavras, normalizadas: normalizadas, chave_dia: row.chave_dia || ('sexto_' + dataJogo) };
}

function carregarListaPalavras_(url) {
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error('Não consegui carregar a lista de palavras. Código HTTP: ' + code);

  const text = response.getContentText('UTF-8');
  const linhas = text.split(/\r?\n/);
  const seen = {};
  const lista = [];

  linhas.forEach(function(line) {
    const word = String(line || '').trim().toLowerCase();
    const norm = normalizeWord_(word);
    if (norm.length !== WORD_LENGTH) return;
    if (seen[norm]) return;
    seen[norm] = true;
    lista.push({ palavra: word, normalizada: norm });
  });

  return lista;
}

function escolherPalavras_(lista, qtd) {
  const copy = lista.slice();
  const escolhidas = [];
  while (escolhidas.length < qtd && copy.length) {
    const idx = Math.floor(Math.random() * copy.length);
    const item = copy.splice(idx, 1)[0];
    if (item && item.normalizada && escolhidas.map(normalizeWord_).indexOf(item.normalizada) === -1) {
      escolhidas.push(item.palavra);
    }
  }
  return escolhidas;
}

function getOuCriarPartida_(usuario, dataJogo, palavrasDia, deviceId) {
  const partidaId = dataJogo + '_' + usuario;
  const rows = readRows_(SHEETS.PARTIDAS);
  let partida = rows.find(function(p) { return String(p.partida_id || '') === partidaId; });
  if (partida) return partida;

  appendRow_(SHEETS.PARTIDAS, {
    partida_id: partidaId,
    data_jogo: dataJogo,
    usuario: usuario,
    status: 'em_andamento',
    iniciada_em: now_(),
    palavras_chave_dia: palavrasDia.chave_dia,
    respostas_json: JSON.stringify(palavrasDia.palavras),
    device_id: String(deviceId || '').slice(0, 80),
    observacao: 'Criada ao abrir o jogo.'
  });

  registrarAcao_(usuario, 'iniciarPartida', partidaId, { data_jogo: dataJogo });
  return readRows_(SHEETS.PARTIDAS).find(function(p) { return String(p.partida_id || '') === partidaId; });
}

function finalizarPartida_(payload) {
  const ctx = validarToken_(payload.token);
  const partidaId = String(payload.partida_id || '').trim();
  const dataJogo = normalizeDateKey_(payload.data_jogo || today_());
  const tentativas = Array.isArray(payload.tentativas) ? payload.tentativas.map(String) : [];

  if (!partidaId) throw new Error('Partida não informada.');
  if (!tentativas.length) throw new Error('Nenhuma tentativa recebida.');
  if (tentativas.length > MAX_ATTEMPTS) throw new Error('Tentativas acima do limite.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const partidas = readRows_(SHEETS.PARTIDAS);
    const partida = partidas.find(function(p) { return String(p.partida_id || '') === partidaId; });
    if (!partida) throw new Error('Partida não encontrada.');
    if (normalizeUser_(partida.usuario) !== ctx.usuario) throw new Error('Esta partida pertence a outro usuário.');

    if (String(partida.status || '') === 'concluido') {
      return {
        ok: true,
        ja_finalizada: true,
        venceu: String(partida.venceu).toUpperCase() === 'TRUE' || String(partida.venceu).toUpperCase() === 'SIM',
        tentativas_usadas: toNumber_(partida.tentativas_usadas),
        ficha: recalcularFichaJogador_(ctx.usuario),
        ranking: getRanking_(),
        resultado: safeJsonParse_(partida.resultado_json, {})
      };
    }

    const palavrasDia = garantirPalavrasDoDia_(dataJogo);
    const resultado = calcularResultado_(tentativas, palavrasDia.normalizadas);
    const venceu = resultado.venceu;
    const streakAntes = toNumber_(ctx.jogador.sequencia_vitorias_atual || 0);

    salvarTentativas_(partidaId, dataJogo, ctx.usuario, tentativas, palavrasDia.normalizadas, resultado.solvedAt);

    const resultadoJson = {
      venceu: venceu,
      tentativas_usadas: tentativas.length,
      tabuleiros_acertados: resultado.tabuleiros_acertados,
      solvedAt: resultado.solvedAt,
      respostas: palavrasDia.palavras
    };

    updateRow_(SHEETS.PARTIDAS, partida._row, {
      status: 'concluido',
      finalizada_em: now_(),
      venceu: venceu ? 'TRUE' : 'FALSE',
      tentativas_usadas: tentativas.length,
      tabuleiros_acertados: resultado.tabuleiros_acertados,
      respostas_json: JSON.stringify(palavrasDia.palavras),
      tentativas_json: JSON.stringify(tentativas),
      solved_at_json: JSON.stringify(resultado.solvedAt),
      resultado_json: JSON.stringify(resultadoJson),
      streak_antes: streakAntes,
      observacao: venceu ? 'Vitória' : 'Derrota'
    });

    const ficha = recalcularFichaJogador_(ctx.usuario);
    const partidaAtualizada = readRows_(SHEETS.PARTIDAS).find(function(p) { return String(p.partida_id || '') === partidaId; });
    updateRow_(SHEETS.PARTIDAS, partidaAtualizada._row, { streak_depois: ficha.sequencia_vitorias_atual || 0 });

    registrarAcao_(ctx.usuario, 'finalizarPartida', partidaId, resultadoJson);

    return {
      ok: true,
      venceu: venceu,
      tentativas_usadas: tentativas.length,
      tabuleiros_acertados: resultado.tabuleiros_acertados,
      solvedAt: resultado.solvedAt,
      ficha: ficha,
      ranking: getRanking_(),
      resultado: resultadoJson
    };
  } finally {
    lock.releaseLock();
  }
}

function calcularResultado_(tentativas, respostasNorm) {
  const solvedAt = [null, null, null, null];

  tentativas.forEach(function(tentativa, idx) {
    const guess = normalizeWord_(tentativa);
    for (let b = 0; b < BOARD_COUNT; b++) {
      if (!solvedAt[b] && guess === respostasNorm[b]) solvedAt[b] = idx + 1;
    }
  });

  const acertados = solvedAt.filter(Boolean).length;
  return {
    venceu: acertados === BOARD_COUNT,
    tabuleiros_acertados: acertados,
    solvedAt: solvedAt
  };
}

function salvarTentativas_(partidaId, dataJogo, usuario, tentativas, respostasNorm, solvedAt) {
  tentativas.forEach(function(tentativa, idx) {
    const guess = normalizeWord_(tentativa);
    const patterns = respostasNorm.map(function(answer) { return evaluatePattern_(guess, answer).join(''); });
    appendRow_(SHEETS.TENTATIVAS, {
      tentativa_id: partidaId + '_' + String(idx + 1).padStart(2, '0'),
      partida_id: partidaId,
      data_jogo: dataJogo,
      usuario: usuario,
      num_tentativa: idx + 1,
      palavra: String(tentativa || '').toLowerCase(),
      normalizada: guess,
      padrao_1: patterns[0],
      padrao_2: patterns[1],
      padrao_3: patterns[2],
      padrao_4: patterns[3],
      acertou_apos_1: solvedAt[0] === idx + 1 ? 'SIM' : '',
      acertou_apos_2: solvedAt[1] === idx + 1 ? 'SIM' : '',
      acertou_apos_3: solvedAt[2] === idx + 1 ? 'SIM' : '',
      acertou_apos_4: solvedAt[3] === idx + 1 ? 'SIM' : '',
      criada_em: now_()
    });
  });
}

function evaluatePattern_(guessNorm, answerNorm) {
  const result = new Array(WORD_LENGTH).fill('B'); // B = absent, Y = present, G = correct
  const counts = {};
  const guess = String(guessNorm || '').split('');
  const answer = String(answerNorm || '').split('');

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (guess[i] === answer[i]) {
      result[i] = 'G';
    } else {
      counts[answer[i]] = (counts[answer[i]] || 0) + 1;
    }
  }

  for (let i = 0; i < WORD_LENGTH; i++) {
    if (result[i] === 'G') continue;
    const letter = guess[i];
    if (counts[letter] > 0) {
      result[i] = 'Y';
      counts[letter] -= 1;
    }
  }

  return result;
}

function getTentativasPartida_(partidaId) {
  return readRows_(SHEETS.TENTATIVAS)
    .filter(function(t) { return String(t.partida_id || '') === partidaId; })
    .sort(function(a, b) { return toNumber_(a.num_tentativa) - toNumber_(b.num_tentativa); })
    .map(function(t) { return String(t.palavra || '').trim(); })
    .filter(Boolean);
}

function recalcularFichaJogador_(usuario) {
  const jogador = getJogador_(usuario);
  if (!jogador) throw new Error('Jogador não encontrado.');

  const partidas = readRows_(SHEETS.PARTIDAS)
    .filter(function(p) {
      return normalizeUser_(p.usuario) === usuario && String(p.status || '') === 'concluido';
    })
    .sort(function(a, b) {
      return normalizeDateKey_(a.data_jogo).localeCompare(normalizeDateKey_(b.data_jogo));
    });

  let total = partidas.length;
  let vitorias = 0;
  let derrotas = 0;
  let dist = { perdas: 0 };
  for (let i = 1; i <= MAX_ATTEMPTS; i++) dist[i] = 0;
  let somaTentativasVitorias = 0;
  let melhorTentativa = '';
  let seq = 0;
  let melhorSeq = 0;
  let ultimaVitoria = '';
  let ultimoJogoData = '';
  let ultimoJogoStatus = '';
  let ultimaPartidaId = '';

  partidas.forEach(function(p) {
    const data = normalizeDateKey_(p.data_jogo);
    const venceu = String(p.venceu).toUpperCase() === 'TRUE' || String(p.venceu).toUpperCase() === 'SIM';
    const usadas = Math.max(1, Math.min(MAX_ATTEMPTS, toNumber_(p.tentativas_usadas || 0)));

    ultimoJogoData = data;
    ultimoJogoStatus = venceu ? 'vitoria' : 'derrota';
    ultimaPartidaId = String(p.partida_id || '');

    if (venceu) {
      vitorias++;
      dist[usadas] = (dist[usadas] || 0) + 1;
      somaTentativasVitorias += usadas;
      if (!melhorTentativa || usadas < melhorTentativa) melhorTentativa = usadas;

      if (ultimaVitoria && addDays_(ultimaVitoria, 1) === data) {
        seq += 1;
      } else {
        seq = 1;
      }
      ultimaVitoria = data;
      melhorSeq = Math.max(melhorSeq, seq);
    } else {
      derrotas++;
      dist.perdas += 1;
      seq = 0;
    }
  });

  // Se a última vitória não é hoje nem ontem, a sequência atual já morreu por ausência.
  const hoje = today_();
  if (ultimaVitoria && ultimaVitoria !== hoje && addDays_(ultimaVitoria, 1) !== hoje) {
    seq = 0;
  }
  if (ultimoJogoStatus === 'derrota') seq = 0;

  const pct = total ? Math.round((vitorias / total) * 100) : 0;
  const media = vitorias ? Math.round((somaTentativasVitorias / vitorias) * 100) / 100 : 0;

  const patch = {
    ultimo_jogo_data: ultimoJogoData,
    ultimo_jogo_status: ultimoJogoStatus,
    ultima_vitoria_data: ultimaVitoria,
    sequencia_vitorias_atual: seq,
    melhor_sequencia: melhorSeq,
    total_jogos: total,
    total_vitorias: vitorias,
    total_derrotas: derrotas,
    pct_vitorias: pct,
    dist_1: dist[1], dist_2: dist[2], dist_3: dist[3], dist_4: dist[4], dist_5: dist[5],
    dist_6: dist[6], dist_7: dist[7], dist_8: dist[8], dist_9: dist[9], dist_10: dist[10],
    dist_perdas: dist.perdas,
    media_tentativas_vitorias: media,
    melhor_tentativa_vitoria: melhorTentativa,
    ultima_partida_id: ultimaPartidaId
  };

  updateRow_(SHEETS.JOGADORES, jogador._row, patch);
  return Object.assign({}, jogador, patch);
}

function getRanking_() {
  const jogadores = readRows_(SHEETS.JOGADORES).filter(function(j) { return boolText_(j.ativo); });
  let liderAtual = { nome: '-', usuario: '', valor: 0 };
  let liderMelhor = { nome: '-', usuario: '', valor: 0 };

  jogadores.forEach(function(j) {
    const nome = String(j.nome_exibicao || j.usuario || '-');
    const atual = toNumber_(j.sequencia_vitorias_atual || 0);
    const melhor = toNumber_(j.melhor_sequencia || 0);
    if (atual > liderAtual.valor) liderAtual = { nome: nome, usuario: j.usuario, valor: atual };
    if (melhor > liderMelhor.valor) liderMelhor = { nome: nome, usuario: j.usuario, valor: melhor };
  });

  return {
    total_jogadores: jogadores.length,
    lider_streak_atual_nome: liderAtual.nome,
    lider_streak_atual_usuario: liderAtual.usuario,
    lider_streak_atual_valor: liderAtual.valor,
    lider_melhor_streak_nome: liderMelhor.nome,
    lider_melhor_streak_usuario: liderMelhor.usuario,
    lider_melhor_streak_valor: liderMelhor.valor
  };
}

function safeJsonParse_(value, fallback) {
  try {
    if (!value) return fallback;
    return JSON.parse(String(value));
  } catch (err) {
    return fallback;
  }
}

function registrarAcao_(usuario, acao, detalhe, payload) {
  try {
    appendRow_(SHEETS.HISTORICO_ACOES, {
      data_hora: now_(),
      usuario: usuario || '',
      acao: acao || '',
      detalhe: detalhe || '',
      payload_resumido: payload ? JSON.stringify(payload).slice(0, 1000) : ''
    });
  } catch (err) {}
}

function logError_(etapa, mensagem, payload) {
  try {
    appendRow_(SHEETS.LOGS, {
      data_hora: now_(),
      nivel: 'ERRO',
      etapa: etapa || '',
      mensagem: mensagem || '',
      payload_resumido: payload ? JSON.stringify(payload).slice(0, 1000) : ''
    });
  } catch (err) {}
}
