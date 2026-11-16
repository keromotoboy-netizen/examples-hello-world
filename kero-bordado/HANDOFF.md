# Handoff — Kero Bordado (conversor de imagem/nome → .PES para Brother PE-560L)

Leia este arquivo inteiro antes de mexer em qualquer coisa. Idioma com o usuário: **português do Brasil**.

## 1. O projeto em uma frase
App web de arquivo único que converte imagens/logos e nomes digitados em arquivos **.PES** para uma
**Brother PE-560L** (bastidor 10 × 10 cm), dividindo desenhos grandes em partes proporcionais.
Tudo roda no navegador; o Cloudflare Worker só entrega o HTML.

## 2. Estado atual (funcionando e publicado)
- **App no ar:** https://kero-bordado.keromotoboy.workers.dev (Worker `kero-bordado` na conta Cloudflare do usuário).
  O Worker busca `kero-bordado/dist/index.html` na branch `claude/image-to-pes-brother-embroidery-x1mw9z`
  do repositório `keromotoboy-netizen/examples-hello-world` (via raw.githubusercontent.com) e guarda 5 min em cache.
  Abrir com `?atualizar` no final força a busca nova.
- **Código:** este diretório (`kero-bordado/`) nessa mesma branch.
- Testado em navegador real (Playwright/Chromium): modo imagem, modo nome, divisão em partes, .zip, ficha/gabarito
  em tamanho real, 10 fontes. Sem erros de console.
- O gravador PES (`src/pes.js`) foi portado da pyembroidery e validado **byte a byte** contra ela (PES v1).
  Os arquivos gerados são lidos de volta sem erro pela pyembroidery.

## 3. O que o app faz
1. Escolha: imagem (upload) ou nome/texto (10 fontes do Google Fonts) + cor da linha (paleta Brother).
2. Peça e tecido (toalha de rosto/mão/banho, roupão, camiseta, body, pano de prato, jeans, outra) → ajusta
   densidade, base (underlay), compensação de puxada e mostra dicas de entretela/agulha.
3. Tamanho (largura em cm para imagem; altura da letra para nome). Área útil usada: **95 mm** (bastidor 100 mm).
4. Cores (imagem): k-means em Lab, junta tons parecidos, usuário escolhe linha, ordem e liga/desliga cada cor.
5. Gera: prévia dos pontos, nº de pontos, tempo estimado, nº de saltos de linha, .PES por parte, .zip,
   botão Compartilhar (Artspira), ficha + gabarito 1:1 para imprimir (parte N de M, cruz de alinhamento).
6. Desenho mais largo que 9,5 cm → `chooseCuts` escolhe cortes verticais nas colunas com menos tinta, com
   sobreposição de 1,5 mm quando o corte cai dentro de tinta. Altura > 9,5 cm → recusa com mensagem.
7. Satin automático (caixinha no passo 3, ligada por padrão) — ver seção 7.

## 4. Estrutura
```
kero-bordado/
  src/index.html   página + CSS (tema claro/escuro), guia USB/Wi-Fi/nomes em partes
  src/app.js       interface, fluxo, prévia, ficha/gabarito
  src/engine.js    motor: cores, máscaras, polígonos, tatami, satin, roteamento, divisão em partes
  src/pes.js       gravador PES v1 (+ paleta Brother de 64 cores)
  src/presets.js   HOOP, FABRICS (parâmetros por tecido), PIECES, FONTS
  src/zip.js       ZIP sem compressão
  build.mjs        esbuild → dist/index.html (arquivo único) e dist/worker.js
  dist/index.html  versão publicada (COMMITADA — é o que o Worker serve)
  test/e2e*.cjs    testes de navegador (precisam de servidor em :8765 servindo dist/)
```
Dependências: `d3-contour`, `clipper-lib`, `esbuild` (npm). Nada de CDN em tempo de execução, exceto as fontes do
Google Fonts (precisam de internet para o modo nome).

## 5. Como desenvolver e publicar
```
cd kero-bordado && npm install
node build.mjs                                   # gera dist/
(python3 -m http.server 8765 --directory dist &) # servidor local
node test/e2e.cjs                                # precisa de test/abraao.jpg (não versionado; peça ao usuário)
```
Publicar = commit de `dist/index.html` + `src/` e `git push` para a branch acima. Em ~5 min o Worker serve a nova versão.
O Worker em si só precisa ser re-enviado se mudar a URL de origem (feito pela API do Cloudflare via ferramenta
`mcp__Cloudflare_mcp__execute`, PUT em `/workers/scripts/kero-bordado`).

## 6. Fatos da máquina (Brother PE-560L)
- Bastidor 10 × 10 cm (campo máx. ~99,9 mm; o app usa 95 mm). Tem **USB e Wi-Fi**.
- USB: pendrive ≤ 8 GB, **FAT32**, .PES solto na **raiz** (fora de pastas).
- Wi-Fi: app **Artspira** (Minhas criações → Importar → Enviar para a máquina); rede **2,4 GHz**; plano grátis tem limite de desenhos.
  Não existe API aberta da Brother para enviar direto à máquina — por isso o app só gera o arquivo.
- **A máquina NÃO corta a linha sozinha** entre formas (visto na foto do primeiro bordado: fios de salto atravessando o desenho).
  Por isso o motor minimiza saltos (rota interna) e a UI avisa quantos fios cortar à mão.
- Não foi possível abrir o manual oficial (download.brother.com bloqueado na rede da sessão). Dados vêm de sites de
  terceiros e modelos irmãos (PE545/PE570). Tratar como "provável", não confirmado.

## 7. Lições importantes (não repetir os erros)
- **Primeiro bordado real (Abraão, toalha de rosto):** deu certo em tamanho/posição/cores. Defeitos: fios de salto
  (corrigido: 127 → 15 saltos), detalhes finos sumindo, e o usuário usou linha cinza no lugar do dourado (falta de linha, não bug).
  Pedir sempre **foto do resultado real** — é o melhor sinal de qualidade.
- **Satin (ponto cheio) automático:** a 1ª versão (esqueleto + régua de rungs) ficou **pior** que o tatami: rabiscos nos
  cruzamentos, pingo do "i" virou zigue-zague, saltos subiram (16 → 97). Versão final é **conservadora**: separa
  grosso/fino por abertura em disco (EDT); cruzamentos e formas curtas viram preenchimento; satin só em traços
  simples e alongados (comprimento ≥ ~3,5× largura). Resultado: quase não muda nada nos testes (1 trecho no "A").
  Se for evoluir o satin, **sempre comparar com tatami lado a lado** (`test/e2e2.cjs`) antes de ligar por padrão.
- A prévia é desenhada de pontos reais, mas não simula brilho/volume da linha.
- Sandbox: sem acesso a `download.brother.com`, `support.brother.com`, `cdn.jsdelivr.net`, GitHub releases, `workers.dev`
  nem `raw.githubusercontent.com` (a sessão). O **Worker consegue** buscar o raw do GitHub. Para conferir a página no ar
  use a Browser Rendering API do Cloudflare (`POST /accounts/{id}/browser-rendering/content`).
- `git push` só funcionou em `examples-hello-world` (o app do Claude foi instalado lá pelo usuário). Em `kero-cloud-slots-public`
  deu 403 na época. Não usar outras branches sem permissão.

## 8. Pendências / próximos passos sugeridos (em ordem)
1. Pedir ao usuário a **foto do próximo bordado** e o desenho original; ajustar densidade/underlay/saltos com base nisso.
2. Medir tamanho real de uma toalha de banho e a área bordável (pergunta ainda em aberto).
3. Perguntas em aberto do plano: app só para uso próprio ou para atender clientes (login/histórico)? Fontes preferidas?
   Marca de linha usada (para paleta de cores)?
4. Melhorias técnicas: prévia "realista"; satin melhor só se comprovadamente superior; histórico de projetos;
   PWA instalável; opção de exportar também .DST; menos fios de salto (ordenar formas por proximidade entre cores).
5. Confirmar os fatos da máquina no manual oficial se o usuário liberar `download.brother.com` na rede do ambiente.

## 9. Privacidade
O repositório é **público**. Não commitar fotos/imagens do usuário, nomes de clientes, e-mails ou IDs de conta.
Os arquivos de teste (imagem do Abraão, .PES de exemplo) ficam fora do Git.
