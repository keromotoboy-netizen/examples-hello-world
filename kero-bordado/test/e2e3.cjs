const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 1.5 });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('http://localhost:8765/');
  await p.click('[data-mode=nome]'); await p.selectOption('#peca', 'toalha_banho'); await p.fill('#texto', 'Laura');
  const fonts = await p.$$eval('#fonte option', o => o.map(x => x.value));
  let i = 0;
  for (const f of fonts) {
    await p.selectOption('#fonte', f); await p.fill('#letra', '4');
    await p.evaluate(() => { document.querySelector('#resultado').hidden = true; document.querySelector('#mensagem').textContent = ''; });
    await p.click('#gerar');
    await p.waitForFunction(() => !document.querySelector('#resultado').hidden || document.querySelector('#mensagem').textContent, null, { timeout: 90000 });
    const msg = await p.textContent('#mensagem');
    const r = (await p.textContent('#resumo')).replace(/\s+/g, ' ').slice(0, 95);
    console.log(f, '|', msg || r);
    if (!msg) await (await p.$('#previa')).screenshot({ path: `test/f${i++}.png` });
  }
  console.log('ERROS', errs); await b.close();
})();
