// Configuração do Sexto
// 1) Cole aqui a URL /exec do Apps Script depois de implantar o Web App.
// 2) Mantenha a lista de palavras neste caminho no GitHub Pages.
window.SEXTO_CONFIG = {
  API_URL: 'https://sexto-api.juliocavina.workers.dev',
  WORD_LIST_URL: 'palavras/palavras_sexto_6_letras_ampla_extra.txt',
  SECRET_WORD_LIST_URL: 'palavras/palavras_sexto_respostas_ultra_refinadas_v3.txt',
  ACCEPTED_WORD_LIST_URL: 'palavras/palavras_sexto_6_letras_ampla_extra.txt',
  APP_VERSION: '1.0.10',
  MAX_ATTEMPTS: 9,
  SHARE_URL: 'https://juliocavina.github.io/Sextos/',
  API_TIMEOUT_DEFAULT_MS: 60000,
  API_TIMEOUT_FINALIZE_MS: 120000
};
