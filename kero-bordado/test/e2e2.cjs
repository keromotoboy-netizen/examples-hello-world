const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 700, height: 900 }, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto('http://localhost:8765/');
  const run = async (name, satin, font, peca, letra, shot) => {
    await p.click('[data-mode=nome]'); await p.selectOption('#peca', peca); await p.fill('#texto', name);
    await p.selectOption('#fonte', font); await p.fill('#letra', String(letra));
    await p.evaluate((v) => { const c = document.querySelector('#satin'); c.checked = v; c.dispatchEvent(new Event('change')); }, satin);
    await p.evaluate(() => { document.querySelector('#resultado').hidden = true; document.querySelector('#mensagem').textContent = ''; });
    await p.click('#gerar');
    await p.waitForFunction(() => !document.querySelector('#resultado').hidden || document.querySelector('#mensagem').textContent, null, { timeout: 90000 });
    const msg = await p.textContent('#mensagem'); if (msg) console.log('MSG', msg);
    console.log(name, font, satin ? 'satin' : 'tatami', '|', (await p.textContent('#resumo')).slice(0, 130));
    await (await p.$('#previa')).screenshot({ path: shot });
  };
  await run('Abraão', true, 'Great Vibes', 'toalha_banho', 5, 'test/n1_satin.png');
  await run('Abraão', false, 'Great Vibes', 'toalha_banho', 5, 'test/n1_tatami.png');
  await run('Maria', true, 'Pacifico', 'toalha_mao', 2.5, 'test/n2_satin.png');
  await run('Maria', false, 'Pacifico', 'toalha_mao', 2.5, 'test/n2_tatami.png');
  console.log('ERROS', errs); await b.close();
})();
