# Sexto

Jogo mobile diário com 4 palavras simultâneas de 6 letras, inspirado no modo de 4 jogos do Termo.

## Arquitetura

- GitHub Pages: interface mobile/PWA
- Google Apps Script: API do jogo
- Google Sheets: base de jogadores, palavras do dia, partidas e ranking
- Arquivo `.txt`: lista de palavras no GitHub, em `palavras/palavras_sexto_6_letras_filtradas_curadas.txt`

## Arquivos principais

```text
index.html
style.css
config.js
app.js
manifest.json
service-worker.js
assets/icon-192.png
assets/icon-512.png
palavras/palavras_sexto_6_letras_filtradas_curadas.txt
apps_script/Code.gs
```

## Passos rápidos

1. Suba os arquivos do site no repositório GitHub.
2. Mantenha a lista de palavras em `palavras/palavras_sexto_6_letras_filtradas_curadas.txt`.
3. Na planilha do Sexto, abra `Extensões > Apps Script` e cole o conteúdo de `apps_script/Code.gs`.
4. Implante o Apps Script como Web App:
   - Executar como: Eu
   - Quem tem acesso: Qualquer pessoa
5. Copie a URL `/exec` do Apps Script.
6. No arquivo `config.js`, cole a URL em `API_URL`.
7. Pegue a URL raw da lista de palavras no GitHub e coloque na aba `Config`, na chave `url_lista_palavras_raw`.
8. Ative o GitHub Pages no repositório.

## Importante

- O jogo valida tentativas localmente para não travar a cada palavra digitada.
- O resultado é enviado para a API somente ao vencer ou terminar as 10 tentativas.
- O progresso da partida em andamento é salvo no `localStorage` do celular.
- O login também é salvo no `localStorage` por token.
- A segurança anticheat não é o foco deste projeto.
