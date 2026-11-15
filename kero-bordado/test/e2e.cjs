const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:8765/');
  // ---- modo imagem
  await p.setInputFiles('#arquivo', 'test/abraao.jpg');
  await p.waitForSelector('#lista-cores .cor');
  console.log('cores:', await p.$$eval('#lista-cores .cor select', s => s.map(x => x.selectedOptions[0].textContent)));
  await p.click('#gerar');
  await p.waitForSelector('#resultado:not([hidden])', { timeout: 60000 });
  console.log('resumo:', (await p.textContent('#resumo')).slice(0, 200));
  let [d] = await Promise.all([p.waitForEvent('download'), p.click('#arquivos a.btn')]);
  await d.saveAs('test/app_imagem.pes'); console.log('baixado', d.suggestedFilename());
  await p.screenshot({ path: 'test/shot_imagem.png', fullPage: true });
  // ---- modo nome, toalha de banho
  await p.click('[data-mode=nome]');
  await p.selectOption('#peca', 'toalha_banho');
  await p.fill('#texto', 'Abraão');
  await p.fill('#letra', '5');
  await p.click('#gerar');
  await p.waitForFunction(() => document.querySelectorAll('#arquivos .arquivo').length > 1 || document.querySelector('#mensagem').textContent, null, { timeout: 60000 });
  console.log('msg:', await p.textContent('#mensagem'));
  console.log('arquivos:', await p.$$eval('#arquivos .arquivo', a => a.map(x => x.innerText.replace(/\n/g, ' | '))));
  const links = await p.$$('#arquivos a.btn');
  for (const [i, l] of links.entries()) { const [dd] = await Promise.all([p.waitForEvent('download'), l.click()]); await dd.saveAs('test/nome_' + dd.suggestedFilename()); }
  await p.screenshot({ path: 'test/shot_nome.png', fullPage: true });
  await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: 'test/ficha.pdf', format: 'A4' });
  console.log('fontes carregadas:', await p.evaluate(() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family).join(',')));
  console.log('ERROS:', errs);
  await b.close();
})();
