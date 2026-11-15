# Kero Bordado

App web que converte **imagens/logos** e **nomes** em arquivos **.PES** para a máquina
**Brother PE-560L** (bastidor 10 × 10 cm). Tudo roda no navegador (nada é enviado a servidor).

## O que faz
- Imagem → separa as cores, limpa a textura, gera preenchimento (tatami) com base, compensação e contorno.
- Nome → escolhe fonte (Google Fonts), altura da letra e cor da linha.
- Peça e tecido → ajustam densidade, base, compensação e dão as dicas de entretela/agulha.
- Desenho maior que 9,5 cm → divide em partes proporcionais, com gabarito para imprimir em tamanho real.
- Deslocamento por dentro das formas para reduzir saltos (a PE-560L não corta linha sozinha).
- Gera .PES (formato v1, validado contra a biblioteca pyembroidery), .zip das partes e ficha para imprimir.

## Desenvolvimento
```
npm install
node build.mjs          # gera dist/index.html (arquivo único) e dist/worker.js
node test/e2e.cjs       # teste no navegador (precisa de servidor em :8765 servindo dist/ e de test/abraao.jpg)
```

## Publicação
O Worker `kero-bordado` (Cloudflare) entrega `dist/index.html` deste repositório.
Para atualizar o app: rode `node build.mjs`, faça commit de `dist/index.html` e envie para a branch publicada.
