// АВТОТЕСТЫ «ПЕЧАТНОГО ГОРОДА»
// Запуск: открыть index.html?test=1 — харнесс прогонит эталонные решения
// всех уровней (SOLUTIONS в game.js), опечатко-тест и проверку сейва/телеметрии.
// Результаты: оверлей на странице, window.__testResults и консоль.
(function () {
  'use strict';
  const T = window.__test;
  const DT = 0.05;
  const AB = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
  const results = [];

  function parseCell(s) {
    const col = AB.indexOf(s[0]);
    const row = parseInt(s.slice(1), 10) - 1;
    if (col < 0 || isNaN(row)) throw new Error('не разобрать клетку: ' + s);
    return [col, row];
  }
  function tick(n) { for (let i = 0; i < n; i++) T.tick(DT); }
  function wait(sec) { tick(Math.max(1, Math.round(sec / DT))); }

  // выполоть все сорняки на поле (для уровня «Огород»)
  function sweepWeeds() {
    let n = 0;
    for (;;) {
      const objs = T.objs();
      let weed = null;
      for (const k in objs) if (objs[k].kind === 'weed') { weed = objs[k]; break; }
      if (!weed) return n;
      T.select(weed.col, weed.row);
      const r = T.type('полоть');
      if (!r.ok) throw new Error('не удалось выполоть сорняк: ' + r.msg);
      n++; tick(1);
    }
  }

  function waitWork(timeout) {
    timeout = timeout || 240;
    let t = 0;
    for (;;) {
      tick(1); t += DT;
      const b = T.busy();
      if (!b.workers && !b.burning) return Math.round(t);
      if (t > timeout) throw new Error('таймаут ожидания рабочих: ' + JSON.stringify(b));
    }
  }

  function tryCmd(step) {
    for (let a = 0; a < 4; a++) {
      if (step.sweep) sweepWeeds();
      // адрес уже внутри команды («а1 дерево» / «письмо п12») — клетка не нужна
      const hasAddrInline = /^([а-яё]\d{1,2}\s+\S+|\S+\s+[а-яё]\d{1,2})$/.test(step.cmd);
      if (step.cell && !hasAddrInline) { const c = parseCell(step.cell); T.select(c[0], c[1]); }
      if (!step.cell && !hasAddrInline) { /* команде клетка не нужна (торговля) */ }
      if (step.cells) {
        const a2 = parseCell(step.cells[0]), b2 = parseCell(step.cells[1]);
        T.select(a2[0], a2[1]); T.select2(b2[0], b2[1]);
      }
      const res = T.type(step.cmd);
      if (res.ok) { if (step.waitWork) waitWork(); return; }
      if (/сорняк/.test(res.msg)) { sweepWeeds(); continue; }
      throw new Error('«' + step.cmd + (step.cell ? ' ' + step.cell : '') + '» отклонена: ' + res.msg);
    }
    throw new Error('«' + step.cmd + '» не прошла после повторов');
  }

  function runRainLevel(n) {
    // дождь слов: ждём спавна, печатаем самое нижнее слово
    for (let k = 0; k < n; k++) {
      let guard = 0;
      for (;;) {
        const ws = T.rainWords();
        if (ws.length) break;
        T.rainTick(2.4); guard++;
        if (guard > 30) throw new Error('слова не спавнятся');
      }
      const w = T.rainWords()[0];
      const res = T.type(w);
      if (!res.ok) throw new Error('слово «' + w + '» не принято: ' + res.msg);
    }
  }

  function runLevel(i) {
    T.start(i);
    const sol = T.solutions()[i];
    let chars = 0;
    for (const step of sol) {
      if (step.rain) { runRainLevel(step.rain); continue; }
      if (step.cmd) { tryCmd(step); chars += step.cmd.length + 1; continue; }
      if (step.wait) { wait(step.wait); continue; }
      if (step.waitWork) { waitWork(); continue; }
      if (step.sweep) { sweepWeeds(); continue; }
    }
    let t = 0;
    while (T.phase() !== 'win') {
      tick(1); t += DT;
      if (t > 90) throw new Error('цели не закрыты: ' + T.goals().map(g => g.name + ' ' + g.val + '/' + g.n).join(', '));
    }
    // уникальные буквы в командах решения — покрытие алфавита
    const letters = new Set();
    for (const s of sol) for (const ch of (s.cmd || '').replace(/[^а-яёА-ЯЁ]/g, '')) letters.add(ch.toLowerCase());
    return { par: T.playT(), chars: chars, uniq: letters.size };
  }

  // инвариант: опечатка безопасна — команда отклонена, мир не изменился
  function typoTest(i) {
    T.start(i);
    const L = T.levels()[i];
    if (L.mode === 'rain') { T.type('ъъъ'); return true; } // дождь: нет команд
    const word = L.verbs[0] || T.currentWord();
    const before = JSON.stringify({ r: T.resources(), o: T.objs() });
    const bad = word[0] + 'ъ' + word.slice(2); // «ъ» не входит ни в одну команду
    T.select(0, 0);
    const res = T.type(bad);
    const after = JSON.stringify({ r: T.resources(), o: T.objs() });
    return res.ok === false && before === after;
  }

  function metaTest(n) {
    const save = T.save();
    return {
      pass: Object.keys(save.done).length === n && (save.wins || 0) === n && Object.keys(save.best).length === n,
      done: Object.keys(save.done).length,
      wins: save.wins || 0,
      bests: Object.keys(save.best).length,
      charsTotal: save.chars,
    };
  }

  // ---------- вывод ----------
  function overlay() {
    let d = document.getElementById('__test_overlay');
    if (!d) {
      d = document.createElement('div');
      d.id = '__test_overlay';
      d.style.cssText = 'position:fixed;top:8px;right:8px;max-width:640px;background:rgba(4,16,10,.92);' +
        'color:#9fe8a8;font:12px/1.45 Consolas,monospace;padding:10px 14px;border-radius:8px;' +
        'z-index:9999;white-space:pre;border:1px solid #2e6c46;pointer-events:none';
      document.body.appendChild(d);
    }
    return d;
  }
  function render(meta) {
    const lines = ['АВТОТЕСТЫ ПЕЧАТНОГО ГОРОДА', ''];
    for (const r of results) {
      const st = r.pass ? 'PASS' : 'FAIL';
      lines.push(
        (r.pass ? '✅' : '❌') + ' Л' + String(r.level).padStart(2, ' ') + ' ' + r.name.padEnd(17, ' ') +
        st + (r.pass ? '  par ' + String(r.par).padStart(4, ' ') + 'с · симв ' + String(r.chars).padStart(4, ' ') + ' · уник.букв ' + r.uniq : '') +
        (r.typo ? ' · опечатка OK' : ' · ОПЕЧАТКА FAIL')
      );
      if (r.err) lines.push('      ' + r.err);
    }
    if (meta) {
      lines.push('');
      lines.push((meta.pass ? '✅' : '❌') + ' МЕТА: сейв done=' + meta.done + ', побед в телеметрии=' + meta.wins +
        ', рекордов=' + meta.bests + ', всего символов=' + meta.charsTotal);
    }
    overlay().textContent = lines.join('\n');
  }

  // ---------- прогон ----------
  function run() {
    T.clearSave();
    T.hold(true);
    const n = T.count();
    for (let i = 0; i < n; i++) {
      const rec = { level: i + 1, name: T.levels()[i].name, pass: false, typo: false, par: 0, chars: 0, uniq: 0, err: '' };
      try {
        const r = runLevel(i);
        rec.pass = true; rec.par = r.par; rec.chars = r.chars; rec.uniq = r.uniq;
      } catch (e) { rec.err = e.message; }
      try { rec.typo = typoTest(i); } catch (e) { rec.err += (rec.err ? ' | ' : '') + 'опечатка: ' + e.message; }
      results.push(rec);
      render();
    }
    const meta = metaTest(n);
    window.__testResults = { results, meta };
    console.log('ТЕСТЫ ЗАВЕРШЕНЫ', window.__testResults);
    render(meta);
    T.hold(false);
    window.__testDone = true;
  }

  if (T) setTimeout(run, 300); // даём странице отрисоваться
  else console.error('window.__test не найден — обнови game.js');
})();
