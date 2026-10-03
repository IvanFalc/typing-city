// «ПЕЧАТНЫЙ ГОРОД» — тренажёр печати + градостроительный симулятор.
// Лес оставляет пень, горы стоят сразу, река ведётся от моря.
// Дорога, мост, дом, сарай и печка тратят свои материалы.
// Управление: клик выбирает ячейку, слово + Enter выполняет команду.

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width = 1280, H = canvas.height = 720;
const input = document.getElementById('cmd');

const LETTERS = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const PANEL_X = 714;
const BURN_TIME = 1.5, BOOM_TIME = 0.9;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ---------- РАСКЛАДКА ПАНЕЛИ ----------
// Каждому элементу — своя зона; координаты текстов — базовая линия (baseline).
// Дефолт совпадает с исторической геометрией; layout.json (верстак layout.html)
// переопределяет значения. Клавиатура — всплывающий элемент: места под неё
// не задаётся жёстко, она занимает освобождённое пространство
// (список команд + журнал + статистика) до строки ввода.
const DEFAULT_LAYOUT = {
  panel: { width: 530 },
  elements: {
    title_level:  { x: 730, y: 46 },                      // «УРОВЕНЬ N: ИМЯ»
    btn_map:      { x: 1150, y: 22, w: 110, h: 32 },      // кнопка «⌂ карта»
    subtitle:     { x: 730, y: 76 },                      // «Поле N×N · цель»
    wallet:       { x: 730, y: 102 },                     // кошелёк ресурсов
    goals:        { x: 730, y: 114, stride: 38, barH: 30 }, // бары целей (до 4)
    stars:        { x: 730, y: 278 },                     // ★-линия; пояснение +20
    commands:     { x: 730, titleY: 318, bottom: 466 },   // заголовок + список до bottom
    journal:      { x: 730, labelY: 486, y: 496, h: 68 }, // «ЖУРНАЛ:» + бокс
    stats:        { x: 730, y: 586 },                     // «Команд · точность · рабочих»
    cell_prompt:  { x: 730, y: 608 },                     // «Ячейка: … Введи команду»
    input_line:   { x: 730, y: 616, w: 496, h: 54 },      // DOM-строка ввода
    demo_banner:  { x: 16, y: 62, w: 540, h: 60 },        // баннер ДЕМО
    demo_controls:{ x: 16, y: 664, h: 44 },               // кнопки ДЕМО
  },
};
let LAYOUT = DEFAULT_LAYOUT;
function applyLayout(over) {
  const merge = (base, o) => {
    for (const k in (o || {})) {
      base[k] = (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]))
        ? merge(Array.isArray(base[k]) ? [] : Object.assign({}, base[k]), o[k])
        : o[k];
    }
    return base;
  };
  LAYOUT = merge(Object.assign({}, DEFAULT_LAYOUT, { elements: Object.assign({}, DEFAULT_LAYOUT.elements) }), over);
  const el = LAYOUT.elements.input_line;
  input.style.left = el.x + 'px'; input.style.top = el.y + 'px';
  input.style.width = el.w + 'px'; input.style.height = el.h + 'px';
}

const SINGULAR = {
  'дрова': 'дрова', 'бревна': 'бревно', 'булыжники': 'булыжник', 'щебень': 'щебень',
  'пшеница': 'пшеница', 'сено': 'сено', 'рыба': 'рыба', 'хлеб': 'хлеб', 'овощи': 'овощ', 'фрукты': 'фрукт',
};
const FORMS = {
  дрова: ['дрова', 'дрова', 'дров'],
  бревна: ['бревно', 'бревна', 'брёвен'],
  булыжники: ['булыжник', 'булыжника', 'булыжников'],
  щебень: ['щебень', 'щебня', 'щебня'],
  пшеница: ['пшеница', 'пшеницы', 'пшеницы'],
  фрукты: ['фрукт', 'фрукта', 'фруктов'],
  монеты: ['монета', 'монеты', 'монет'],
  шоколад: ['шоколад', 'шоколада', 'шоколадов'],
};
const KIND_LABEL = {
  tree: 'ЛЕС', stump: 'ПЕНЬ', mountain: 'ГОРА', field: 'ГРЯДКА',
  sea: 'МОРЕ', water: 'РЕКА', fished: 'ВОДА',
  bridge: 'МОСТ', road: 'ДОРОГА', house: 'ДОМ', shed: 'САРАЙ', oven: 'ПЕЧКА',
  bed: 'ГРЯДКА', weed: 'СОРНЯК', sawmill: 'ЛЕСОПИЛКА', warehouse: 'СКЛАД', apple: 'САД',
  stall: 'ЛАВКА',
};

function ru(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return n + ' ' + one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return n + ' ' + few;
  return n + ' ' + many;
}
function colDown(c, r0, r1) {
  const a = [];
  for (let r = r0; r <= r1; r++) a.push([c, r]);
  return a;
}
// ---------- уровни ----------
// verbs[].match(obj) — можно ли выполнить на этой клетке (obj = null, если пусто).
// run: build | work | burn | clear | refund | road | mail | trade | take | salute
// Доп. флаги уровня: noClick (клетка только печатью), pile (ресурсы кучей),
// words/dictPool (заказы-слова), wordMode (куда печатать слово), caseSensitive,
// dimKb (тусклая подсказка), mode:'rain' (дождь слов), cap/capRaise (склад),
// par (эталон времени для звезды, сек).
const LEVELS = [
  // ===== ГЛАВА 1 «ЛЕС» =====
  {
    name: 'ЛЕСОПИЛКА', size: 5, icon: '🌳', classic: true, objectKind: 'tree', noStumps: true, par: 150,
    tutorial: [
      { text: 'Наведи мышку на клетку а1 и нажми левую кнопку', cell: [0, 0], check: () => selected && selected.col === 0 && selected.row === 0 },
      { text: 'Нажми на карточку «лес» — появится клавиатура-подсказка', chip: 'лес', check: () => kbTarget === 'лес' || input.value.trim().toLowerCase() === 'лес' },
      { text: 'Набери на клавиатуре слово: лес', input: true, check: () => input.value.trim().toLowerCase() === 'лес' },
      { text: 'Нажми Enter — лес посадится!', input: true, check: () => !!objs['а1'] },
    ],
    goal: [ { res: 'дрова', n: 40, gen: 'дров' }, { res: 'бревна', n: 10, gen: 'брёвен' } ],
    verbs: [
      { cmd: 'лес', icon: '🌳', hint: 'лес — посадить лес (20 дров или 5 брёвен)', match: o => !o, run: 'build', kind: 'tree', stock: 20 },
      { cmd: 'рубить дрова', icon: '🪓', hint: 'рубить дрова — топором: 20 дров', match: o => o && o.kind === 'tree' && !o.burning, run: 'work', worker: 'axe', time: 0.8, cost: 1, gain: 1, res: 'дрова' },
      { cmd: 'пилить бревна', icon: '🪚', hint: 'пилить бревна — пилой: 5 брёвен', match: o => o && o.kind === 'tree' && !o.burning, run: 'work', worker: 'saw', time: 2.0, cost: 4, gain: 1, res: 'бревна' },
      { cmd: 'сжечь', icon: '🔥', hint: 'сжечь — сжечь лес (ничего не даст!)', match: o => o && o.kind === 'tree' && !o.burning, run: 'burn' },
      { cmd: 'корчевать', icon: '🪓', hint: 'корчевать — убрать пень', match: o => o && o.kind === 'stump', run: 'clear' },
    ],
  },
  {
    name: 'ПРОСЕКА', size: 5, icon: '🪵', classic: true, objectKind: 'tree', noStumps: true, noClick: true, par: 180,
    tutorial: [
      { text: 'Мышка здесь отдыхает! Печатай адрес клетки: а1', input: true, check: () => input.value.trim().toLowerCase() === 'а1' },
      { text: 'Здорово! Допиши команду через пробел: а1 лес', input: true, check: () => input.value.trim().toLowerCase() === 'а1 лес' },
      { text: 'Нажми Enter', input: true, check: () => !!objs['а1'] },
      { text: 'Теперь сам: посади второй лес — напечатай: а2 лес', input: true, check: () => !!objs['а2'] },
    ],
    goal: [ { res: 'дрова', n: 20, gen: 'дров' }, { res: 'бревна', n: 5, gen: 'брёвен' } ],
    verbs: [
      { cmd: 'лес', icon: '🌳', hint: 'лес — посадить лес', match: o => !o, run: 'build', kind: 'tree', stock: 20 },
      { cmd: 'рубить дрова', icon: '🪓', hint: 'рубить дрова — топором', match: o => o && o.kind === 'tree' && !o.burning, run: 'work', worker: 'axe', time: 0.8, cost: 1, gain: 1, res: 'дрова' },
      { cmd: 'пилить бревна', icon: '🪚', hint: 'пилить бревна — пилой', match: o => o && o.kind === 'tree' && !o.burning, run: 'work', worker: 'saw', time: 2.0, cost: 4, gain: 1, res: 'бревна' },
      { cmd: 'корчевать', icon: '🪓', hint: 'корчевать — убрать пень', match: o => o && o.kind === 'stump', run: 'clear' },
    ],
  },
  {
    name: 'КАМЕННЫЙ КАРЬЕР', size: 9, icon: '⛰️', classic: true, objectKind: 'mountain', par: 160,
    presets: [
      { col: 2, row: 2, kind: 'mountain', stock: 30 },
      { col: 5, row: 1, kind: 'mountain', stock: 30 },
      { col: 7, row: 5, kind: 'mountain', stock: 30 },
      { col: 3, row: 7, kind: 'mountain', stock: 30 },
    ],
    goal: [ { res: 'булыжники', n: 30, gen: 'булыжников' }, { res: 'щебень', n: 6, gen: 'щебня' } ],
    verbs: [
      { cmd: 'колоть булыжник', icon: '⛏️', hint: 'колоть булыжник — киркой: 15 с горы', match: o => o && o.kind === 'mountain' && !o.burning, run: 'work', worker: 'pick', time: 1.0, cost: 2, gain: 1, res: 'булыжники' },
      { cmd: 'дробить щебень', icon: '🔨', hint: 'дробить щебень — кувалдой: 6 с горы', match: o => o && o.kind === 'mountain' && !o.burning, run: 'work', worker: 'hammer', time: 2.5, cost: 5, gain: 1, res: 'щебень' },
      { cmd: 'взорвать', icon: '💣', hint: 'взорвать — взрыв и осыпь: +1 щебень', match: o => o && o.kind === 'mountain' && !o.burning, run: 'burn', boom: true, gain: 1, res: 'щебень' },
    ],
  },
  {
    name: 'САД', size: 7, icon: '🍎', par: 120,
    goal: [ { res: 'фрукты', n: 16, gen: 'фруктов', label: 'фрукты' } ],
    verbs: [
      { cmd: 'сад', icon: '🌳', hint: 'сад — посадить фруктовое дерево (8 фруктов)', match: o => !o, run: 'build', kind: 'apple', stock: 8 },
      { cmd: 'собрать фрукты', icon: '🍎', hint: 'собрать фрукты — пока не испортились', match: o => o && o.kind === 'apple' && gardenStage(o) === 'ripe' && !o.burning, run: 'work', worker: 'basket', time: 1, cost: 1, gain: 1, res: 'фрукты' },
    ],
  },
  {
    name: 'ФЕРМА', size: 9, icon: '🌾', par: 170,
    goal: [ { res: 'пшеница', n: 24, gen: 'пшеницы', label: 'пшеница' }, { res: 'сено', n: 8, gen: 'сена', label: 'сено' } ],
    verbs: [
      { cmd: 'поле', icon: '🌾', hint: 'поле — посадить грядку (12 пшеницы или 4 сена)', match: o => !o, run: 'build', kind: 'field', stock: 12 },
      { cmd: 'жать пшеницу', icon: '🌾', hint: 'серпом с грядки — 12 пшеницы', match: o => o && o.kind === 'field' && fieldStage(o) === 'ripe', run: 'work', worker: 'sickle', time: 0.8, cost: 1, gain: 1, res: 'пшеница' },
      { cmd: 'косить сено', icon: '🌿', hint: 'косой с грядки — 4 сена', match: o => o && o.kind === 'field' && fieldStage(o) === 'ripe', run: 'work', worker: 'scythe', time: 1.5, cost: 3, gain: 1, res: 'сено' },
    ],
  },
  {
    // ЯРМАРКА: товар не выдан — выращиваем на месте (сад/поле — навыки с ур. 4 и 5),
    // торгуем ТОЛЬКО у лавки в центре площади
    name: 'ЯРМАРКА', size: 7, icon: '🎪', par: 140, requireAll: true,
    presets: [ { col: 3, row: 3, kind: 'stall' } ],
    wallet: ['фрукты', 'пшеница', 'монеты', 'шоколад'],
    // цель — именно ПРОДАТЬ (счётчик сделок), а не «накопить монеты»:
    // монеты лишь промежуточный шаг к шоколаду
    goal: [
      { flag: 'sold:фрукты', n: 6, gen: 'фруктов', label: 'продать фрукты' },
      { flag: 'sold:пшеница', n: 6, gen: 'пшеницы', label: 'продать пшеницу' },
      { res: 'шоколад', n: 2, gen: 'шоколада', label: 'шоколад' },
    ],
    verbs: [
      { cmd: 'продать фрукт', icon: '🍎', hint: 'у лавки: 1 фрукт → 2 монеты (можно «продать фрукт 3»)', match: o => o && o.kind === 'stall', run: 'trade', price: { 'фрукты': 1 }, gain: { 'монеты': 2 }, sold: 'фрукты' },
      { cmd: 'продать пшеницу', icon: '🌾', hint: 'у лавки: 1 пшеница → 1 монета', match: o => o && o.kind === 'stall', run: 'trade', price: { 'пшеница': 1 }, gain: { 'монеты': 1 }, sold: 'пшеница' },
      { cmd: 'купить шоколад', icon: '🍫', hint: 'у лавки: 5 монет → 1 шоколад', match: o => o && o.kind === 'stall', run: 'trade', price: { 'монеты': 5 }, gain: { 'шоколад': 1 } },
    ],
  },
  // ===== ГЛАВА 2 «ВОДА И ПУТИ» =====
  {
    name: 'РЕКА', size: 12, icon: '🎣', par: 170,
    sea: colDown(0, 0, 4), fishStock: 8,
    // брёвна не выдаются: два леса на карте — пилим навыком с ур. 1–2
    presets: [ { col: 10, row: 2, kind: 'tree', stock: 20 }, { col: 10, row: 5, kind: 'tree', stock: 20 } ],
    wallet: ['бревна'],
    goal: [ { res: 'рыба', n: 16, gen: 'рыб', label: 'рыба' }, { kind: 'bridge', n: 4, gen: 'моста', label: 'мост' } ],
    verbs: [
      { cmd: 'река', icon: '🌊', hint: 'река — отвести воду от моря', match: (o, st) => !o && st && touchesFlow(st.col, st.row), run: 'build', kind: 'water' },
      { cmd: 'удить', icon: '🎣', hint: 'удить — рыбак в море: 8 рыб', match: o => o && o.kind === 'sea' && o.stock > 0, run: 'work', worker: 'rod', time: 1.2, cost: 1, gain: 1, res: 'рыба' },
      { cmd: 'мост', icon: '🌉', hint: 'мост — 2 бревна, только на реке', match: o => o && o.kind === 'water', run: 'build', kind: 'bridge', price: { 'бревна': 2 } },
      { cmd: 'убрать', icon: '🧹', hint: 'убрать — снять мост и вернуть брёвна', match: o => o && o.kind === 'bridge', run: 'clear' },
    ],
  },
  {
    name: 'РЫБАК', size: 9, icon: '🐟', par: 150,
    sea: colDown(0, 0, 5).concat(colDown(1, 1, 4)), fishStock: 3,
    words: ['окунь', 'карась', 'щука', 'ёрш', 'лещ', 'сом', 'налим', 'судак', 'язь', 'плотва'],
    wordMode: { need: 'sea', res: 'рыба' },
    goal: [ { res: 'рыба', n: 8, gen: 'рыб', label: 'рыба' } ],
    verbs: [],
  },
  {
    name: 'ДОРОГИ', size: 12, icon: '🛤', two: true, par: 170,
    // щебень добываем сами: горы на карте (навык ур. 3); путь до склада — 14 клеток
    presets: [ { col: 1, row: 2, kind: 'sawmill' }, { col: 9, row: 9, kind: 'warehouse' },
      { col: 4, row: 3, kind: 'mountain', stock: 30 }, { col: 4, row: 6, kind: 'mountain', stock: 30 }, { col: 5, row: 1, kind: 'mountain', stock: 30 } ],
    wallet: ['щебень'],
    roadPrice: { 'щебень': 1 },
    goal: [ { flag: 'roads', n: 1, gen: 'связь', label: 'путь', text: 'соединить лесопилку и склад' } ],
    verbs: [
      { cmd: 'дорога', icon: '🛤', hint: 'дорога — отметь старт, кликни конец; 1 щебень за клетку', match: o => !o, run: 'road' },
      { cmd: 'убрать', icon: '🧹', hint: 'убрать — снять клетку и вернуть щебень', match: o => o && o.kind === 'road', run: 'clear' },
    ],
  },
  {
    name: 'РАЗВИЛКА', size: 12, icon: '🔀', two: true, par: 220,
    // два пути — двойная добыча: четыре горы на щебень
    presets: [ { col: 1, row: 2, kind: 'sawmill' }, { col: 9, row: 9, kind: 'warehouse' }, { col: 10, row: 2, kind: 'house' },
      { col: 4, row: 6, kind: 'mountain', stock: 30 }, { col: 4, row: 8, kind: 'mountain', stock: 30 },
      { col: 5, row: 1, kind: 'mountain', stock: 30 }, { col: 5, row: 5, kind: 'mountain', stock: 30 } ],
    wallet: ['щебень'],
    roadPrice: { 'щебень': 1 },
    goal: [
      { flag: 'roads', n: 1, gen: 'связь', label: 'путь к складу', text: 'лесопилка — склад' },
      { flag: 'roads2', n: 1, gen: 'связь', label: 'путь к дому', text: 'лесопилка — дом' },
    ],
    verbs: [
      { cmd: 'дорога', icon: '🛤', hint: 'дорога — отметь старт, кликни конец; 1 щебень за клетку', match: o => !o, run: 'road' },
      { cmd: 'убрать', icon: '🧹', hint: 'убрать — снять клетку и вернуть щебень', match: o => o && o.kind === 'road', run: 'clear' },
    ],
  },
  {
    name: 'МОСТЫ', size: 12, icon: '🌉', par: 200,
    water: colDown(6, 1, 8),
    // брёвна для мостов — из трёх лесов навыком «пилить бревна»
    presets: [ { col: 0, row: 0, kind: 'tree', stock: 20 }, { col: 0, row: 2, kind: 'tree', stock: 20 }, { col: 0, row: 4, kind: 'tree', stock: 20 } ],
    wallet: ['бревна'],
    goal: [ { kind: 'bridge', n: 6, gen: 'мостов', label: 'мост' } ],
    verbs: [
      { cmd: 'мост', icon: '🌉', hint: 'мост — 2 бревна, на реке', match: o => o && o.kind === 'water', run: 'build', kind: 'bridge', price: { 'бревна': 2 } },
      { cmd: 'убрать', icon: '🧹', hint: 'убрать — снять мост и вернуть брёвна', match: o => o && o.kind === 'bridge', run: 'clear' },
    ],
  },
  {
    name: 'ПОЧТА', size: 16, icon: '✉️', noClick: true, par: 200,
    orders: ['в3', 'е7', 'й11', 'м4', 'о12', 'а16', 'к14', 'д2'],
    goal: [ { res: 'письмо', n: 8, gen: 'писем', label: 'письмо' } ],
    verbs: [
      { cmd: 'письмо', icon: '✉️', hint: 'письмо п12 — доставить на адрес', match: () => true, run: 'mail' },
    ],
  },
  // ===== ГЛАВА 3 «СТРОЙКА И ЕДА» =====
  {
    name: 'ДОМ', size: 9, icon: '🏠', par: 150,
    // стройматериалы свои: гора + два леса (навыки ур. 1–3)
    presets: [ { col: 4, row: 1, kind: 'mountain', stock: 30 }, { col: 5, row: 4, kind: 'tree', stock: 20 }, { col: 5, row: 6, kind: 'tree', stock: 20 } ],
    wallet: ['булыжники', 'бревна'],
    goal: [ { kind: 'house', n: 2, gen: 'дома', label: 'дом' }, { kind: 'shed', n: 1, gen: 'сарай', label: 'сарай' } ],
    verbs: [
      { cmd: 'дом', icon: '🏠', hint: 'дом — 6 булыжников, 4 бревна', match: o => !o, run: 'build', kind: 'house', price: { 'булыжники': 6, 'бревна': 4 } },
      { cmd: 'сарай', icon: '🏚️', hint: 'сарай — 3 булыжника, 2 бревна', match: o => !o, run: 'build', kind: 'shed', price: { 'булыжники': 3, 'бревна': 2 } },
      { cmd: 'сносить', icon: '🪓', hint: 'сносить — убрать и вернуть половину', match: o => o && (o.kind === 'house' || o.kind === 'shed'), run: 'refund' },
    ],
  },
  {
    name: 'ПЕКАРНЯ', size: 12, icon: '🍞', par: 240,
    // всё своё: гора (печки), лес (дрова), поля (пшеница) — навыки ур. 1–5
    presets: [ { col: 4, row: 1, kind: 'mountain', stock: 30 }, { col: 5, row: 4, kind: 'tree', stock: 20 } ],
    wallet: ['пшеница', 'дрова', 'булыжники'],
    goal: [ { res: 'хлеб', n: 8, gen: 'хлеба', label: 'хлеб' } ],
    verbs: [
      { cmd: 'печка', icon: '🔥', hint: 'печка — 4 булыжника', match: o => !o, run: 'build', kind: 'oven', price: { 'булыжники': 4 } },
      { cmd: 'испечь', icon: '🍞', hint: 'испечь — 2 пшеницы и 1 дрова → хлеб', match: o => o && o.kind === 'oven', run: 'work', worker: 'baker', time: 2, gain: 1, res: 'хлеб', once: true, pay: { 'пшеница': 2, 'дрова': 1 } },
    ],
  },
  {
    name: 'СКЛАД', size: 9, icon: '📦', par: 200,
    // добыча навыками: гора + два леса; сараи поднимают лимит брёвен
    presets: [ { col: 4, row: 1, kind: 'mountain', stock: 30 }, { col: 5, row: 4, kind: 'tree', stock: 20 }, { col: 5, row: 6, kind: 'tree', stock: 20 } ],
    wallet: ['булыжники', 'бревна'],
    cap: { 'бревна': 20 }, capRaise: 'shed', capAdd: 8,
    goal: [ { kind: 'shed', n: 2, gen: 'сарая', label: 'сарай' }, { kind: 'house', n: 1, gen: 'дом', label: 'дом' } ],
    verbs: [
      { cmd: 'дом', icon: '🏠', hint: 'дом — 6 булыжников, 4 бревна', match: o => !o, run: 'build', kind: 'house', price: { 'булыжники': 6, 'бревна': 4 } },
      { cmd: 'сарай', icon: '🏚️', hint: 'сарай — 3 булыжника, 2 бревна (+8 к складу брёвен)', match: o => !o, run: 'build', kind: 'shed', price: { 'булыжники': 3, 'бревна': 2 } },
      { cmd: 'сносить', icon: '🪓', hint: 'сносить — убрать и вернуть половину', match: o => o && (o.kind === 'house' || o.kind === 'shed'), run: 'refund' },
    ],
  },
  {
    name: 'КУЗНИЦА', size: 9, icon: '⚒️', par: 210,
    // своя гора и лес кормят горны
    presets: [ { col: 4, row: 1, kind: 'mountain', stock: 30 }, { col: 5, row: 4, kind: 'tree', stock: 20 } ],
    wallet: ['булыжники', 'дрова'],
    goal: [ { res: 'деталь', n: 6, gen: 'деталей', label: 'деталь' } ],
    verbs: [
      { cmd: 'горн', icon: '🔥', hint: 'горн — 4 булыжника', match: o => !o, run: 'build', kind: 'oven', price: { 'булыжники': 4 } },
      { cmd: 'сковать', icon: '⚒️', hint: 'сковать — 1 булыжник и 1 дрова → деталь (кузнец работает, пока есть материал)', match: o => o && o.kind === 'oven', run: 'work', worker: 'hammer', time: 1.6, gain: 1, res: 'деталь', pay: { 'булыжники': 1, 'дрова': 1 } },
    ],
  },
  {
    name: 'ОГОРОД', size: 9, icon: '🥕', weedEvery: 8, par: 180,
    goal: [ { res: 'овощи', n: 24, gen: 'овоща', label: 'овощи' } ],
    verbs: [
      { cmd: 'грядка', icon: '🥕', hint: 'грядка — посадить (12 овощей)', match: o => !o, run: 'build', kind: 'bed', stock: 12 },
      { cmd: 'собрать', icon: '🧺', hint: 'собрать — 12 овощей', match: o => o && o.kind === 'bed', run: 'work', worker: 'basket', time: 1, cost: 1, gain: 1, res: 'овощи' },
      { cmd: 'полоть', icon: '🌿', hint: 'полоть — убрать сорняк', match: o => o && o.kind === 'weed', run: 'clear' },
    ],
  },
  {
    name: 'ТЕПЛИЦА', size: 12, icon: '🥬', weedEvery: 5, par: 220,
    goal: [ { res: 'овощи', n: 24, gen: 'овоща', label: 'овощи' } ],
    verbs: [
      { cmd: 'грядка', icon: '🥬', hint: 'грядка — посадить (10 овощей)', match: o => !o, run: 'build', kind: 'bed', stock: 10 },
      { cmd: 'собрать', icon: '🧺', hint: 'собрать — 10 овощей', match: o => o && o.kind === 'bed', run: 'work', worker: 'basket', time: 1, cost: 1, gain: 1, res: 'овощи' },
      { cmd: 'полоть', icon: '🌿', hint: 'полоть — убрать сорняк', match: o => o && o.kind === 'weed', run: 'clear' },
    ],
  },
  // ===== ГЛАВА 4 «ГОРОД И СЛОВА» =====
  {
    name: 'ГОРОДОК', size: 12, icon: '🏘️', two: true, par: 260,
    sea: [[0, 4], [0, 5], [0, 6]], fishStock: 0,
    // камень, щебень и брёвна — добыча навыками перед стройкой
    presets: [ { col: 4, row: 1, kind: 'mountain', stock: 30 }, { col: 4, row: 3, kind: 'mountain', stock: 30 },
      { col: 9, row: 2, kind: 'tree', stock: 20 }, { col: 9, row: 5, kind: 'tree', stock: 20 } ],
    wallet: ['булыжники', 'бревна', 'щебень'],
    roadPrice: { 'щебень': 1 },
    goal: [ { flag: 'town', n: 1, gen: 'город', label: 'город', text: 'дом — дорога — мост' } ],
    verbs: [
      { cmd: 'дом', icon: '🏠', hint: 'дом — 6 булыжников, 4 бревна', match: o => !o, run: 'build', kind: 'house', price: { 'булыжники': 6, 'бревна': 4 } },
      { cmd: 'река', icon: '🌊', hint: 'река — отвести воду от моря', match: (o, st) => !o && st && touchesFlow(st.col, st.row), run: 'build', kind: 'water' },
      { cmd: 'дорога', icon: '🛤', hint: 'дорога — отметь старт, кликни конец; 1 щебень за клетку', match: o => !o, run: 'road' },
      { cmd: 'мост', icon: '🌉', hint: 'мост — 2 бревна, только на реке', match: o => o && o.kind === 'water', run: 'build', kind: 'bridge', price: { 'бревна': 2 } },
      { cmd: 'убрать', icon: '🧹', hint: 'убрать — снять дорогу или мост и вернуть цену', match: o => o && (o.kind === 'road' || o.kind === 'bridge'), run: 'clear' },
    ],
  },
  {
    name: 'ПАРК', size: 9, icon: '🌸', par: 200,
    // щебень для декораций — из трёх гор
    presets: [ { col: 4, row: 1, kind: 'mountain', stock: 30 }, { col: 4, row: 4, kind: 'mountain', stock: 30 }, { col: 4, row: 7, kind: 'mountain', stock: 30 } ],
    wallet: ['щебень'],
    goal: [
      { kind: 'fountain', n: 1, gen: 'фонтан', label: 'фонтан' },
      { kind: 'flowerbed', n: 2, gen: 'клумбы', label: 'клумба' },
      { kind: 'swing', n: 1, gen: 'качели', label: 'качели' },
      { kind: 'tree2', n: 2, gen: 'ёлки', label: 'ёлка' },
    ],
    verbs: [
      { cmd: 'клумба', icon: '🌸', hint: 'клумба — 1 щебень', match: o => !o, run: 'build', kind: 'flowerbed', price: { 'щебень': 1 }, emoji: '🌸' },
      { cmd: 'ёлка', icon: '🌲', hint: 'ёлка — 2 щебня', match: o => !o, run: 'build', kind: 'tree2', price: { 'щебень': 2 }, emoji: '🌲' },
      { cmd: 'качели', icon: '🛝', hint: 'качели — 3 щебня', match: o => !o, run: 'build', kind: 'swing', price: { 'щебень': 3 }, emoji: '🛝' },
      { cmd: 'фонтан', icon: '⛲', hint: 'фонтан — 4 щебня', match: o => !o, run: 'build', kind: 'fountain', price: { 'щебень': 4 }, emoji: '⛲' },
    ],
  },
  {
    name: 'ЗООПАРК', size: 12, icon: '🦉', par: 260,
    // булыжники для клеток — из двух гор
    presets: [ { col: 4, row: 1, kind: 'mountain', stock: 30 }, { col: 4, row: 4, kind: 'mountain', stock: 30 } ],
    wallet: ['булыжники'],
    words: ['ёжик', 'заяц', 'лиса', 'волк', 'сова', 'олень', 'рысь', 'тигр'],
    wordMode: { need: 'cage', res: 'животные' },
    goal: [ { res: 'животные', n: 6, gen: 'животных', label: 'животные' } ],
    verbs: [
      { cmd: 'клетка', icon: '🪵', hint: 'клетка — 3 булыжника, потом посели животное словом', match: o => !o, run: 'build', kind: 'cage', price: { 'булыжники': 3 }, emoji: '🪵' },
    ],
  },
  {
    name: 'ШКОЛА', size: 12, icon: '✏️', caseSensitive: true, par: 220,
    words: ['Мама мыла раму.', 'Рома ел суп.', 'Нина несла мяч.', 'Лора пела песню.', 'Соня сонная.', 'Мы ели мёд.', 'Юра юлит.', 'Кира дороги.'],
    wordMode: { res: 'предложение', kind: 'desk', emoji: '📗' },
    goal: [ { res: 'предложение', n: 5, gen: 'предложений', label: 'предложение' } ],
    verbs: [],
  },
  {
    name: 'ТЕЛЕГРАФ', size: 12, icon: '📡', par: 240,
    words: ['принеси тёплый хлеб', 'ждём тебя домой', 'город спит спокойно', 'птицы летят на юг', 'праздник будет вечером', 'мы скучаем очень'],
    wordMode: { res: 'депеша', kind: 'post', emoji: '📡' },
    goal: [ { res: 'депеша', n: 4, gen: 'депеш', label: 'депеша' } ],
    verbs: [],
  },
  {
    name: 'ПРАЗДНИК', size: 12, icon: '🎆', par: 150,
    goal: [ { res: 'салют', n: 3, gen: 'салютов', label: 'салют' } ],
    verbs: [
      { cmd: 'флаг', icon: '🚩', hint: 'флаг — поднять флаг (шаг для серии)', match: o => !o, run: 'build', kind: 'flag', emoji: '🚩' },
      { cmd: 'салют', icon: '🎆', hint: 'салют — нужно 3 команды подряд без ошибок', match: o => !o, run: 'salute', res: 'салют' },
    ],
  },
  // ===== ГЛАВА 5 «МАСТЕР» =====
  {
    name: 'МАСТЕРСКАЯ СЛОВ', size: 12, icon: '🔨', par: 240,
    dictPool: ['мир', 'дом', 'кот', 'сыр', 'чай', 'мак', 'пар', 'год', 'юла', 'ёжик', 'ива', 'хлеб', 'звук', 'флаг', 'экран', 'цифра', 'мышь', 'ольха', 'ствол', 'берег'],
    wordMode: { need: 'bench', res: 'слово' },
    goal: [ { res: 'слово', n: 10, gen: 'слов', label: 'слово' } ],
    verbs: [
      { cmd: 'верстак', icon: '🪚', hint: 'верстак — 2 бревна', match: o => !o, run: 'build', kind: 'bench', price: { 'бревна': 2 }, emoji: '🪚' },
    ],
    // брёвна — из леса навыком «пилить бревна»
    presets: [ { col: 4, row: 1, kind: 'tree', stock: 20 } ],
    wallet: ['бревна'],
  },
  {
    name: 'ДОЖДЬ СЛОВ', size: 12, icon: '🌧', mode: 'rain', par: 260,
    words: ['мир', 'дом', 'кот', 'сыр', 'чай', 'мак', 'пар', 'год', 'юла', 'ёжик', 'ива', 'хлеб', 'звук', 'флаг', 'экран', 'цифра', 'мышь'],
    goal: [ { res: 'слово', n: 15, gen: 'слов', label: 'слово' } ],
    verbs: [],
  },
  {
    name: 'НОЧНОЙ ГОРОД', size: 9, icon: '🌙', weedEvery: 7, dimKb: true, noClick: true, par: 260,
    goal: [ { res: 'овощи', n: 16, gen: 'овоща', label: 'овощи' } ],
    verbs: [
      { cmd: 'грядка', icon: '🥕', hint: 'грядка — посадить (12 овощей)', match: o => !o, run: 'build', kind: 'bed', stock: 12 },
      { cmd: 'собрать', icon: '🧺', hint: 'собрать — 12 овощей', match: o => o && o.kind === 'bed', run: 'work', worker: 'basket', time: 1, cost: 1, gain: 1, res: 'овощи' },
      { cmd: 'полоть', icon: '🌿', hint: 'полоть — убрать сорняк', match: o => o && o.kind === 'weed', run: 'clear' },
    ],
  },
  {
    name: 'СКОРЫЙ ПОЕЗД', size: 12, icon: '🚂', mode: 'rain', par: 280,
    words: ['вагон', 'рельс', 'станция', 'провод', 'машинист', 'депо', 'стрелка', 'семафор', 'платформа', 'билет', 'путь', 'мост', 'туннель', 'состав', 'колесо', 'паровоз'],
    goal: [ { res: 'слово', n: 12, gen: 'слов', label: 'слово' } ],
    verbs: [],
  },
  {
    name: 'БОЛЬШОЙ МОСТ', size: 12, icon: '🌇', two: true, par: 380,
    sea: colDown(0, 3, 7), fishStock: 0,
    // босс: вся накопленная добыча в деле — горы и леса на карте
    presets: [
      { col: 4, row: 1, kind: 'mountain', stock: 30 }, { col: 4, row: 4, kind: 'mountain', stock: 30 },
      { col: 9, row: 1, kind: 'tree', stock: 20 }, { col: 9, row: 4, kind: 'tree', stock: 20 }, { col: 9, row: 7, kind: 'tree', stock: 20 },
    ],
    wallet: ['булыжники', 'бревна', 'щебень'],
    roadPrice: { 'щебень': 1 },
    goal: [
      { kind: 'house', n: 2, gen: 'дома', label: 'дом' },
      { kind: 'bridge', n: 3, gen: 'моста', label: 'мост' },
      { flag: 'town', n: 1, gen: 'город', label: 'связь', text: 'дом — дорога — мост' },
    ],
    verbs: [
      { cmd: 'дом', icon: '🏠', hint: 'дом — 6 булыжников, 4 бревна', match: o => !o, run: 'build', kind: 'house', price: { 'булыжники': 6, 'бревна': 4 } },
      { cmd: 'река', icon: '🌊', hint: 'река — отвести воду от моря', match: (o, st) => !o && st && touchesFlow(st.col, st.row), run: 'build', kind: 'water' },
      { cmd: 'дорога', icon: '🛤', hint: 'дорога — отметь старт, кликни конец; 1 щебень за клетку', match: o => !o, run: 'road' },
      { cmd: 'мост', icon: '🌉', hint: 'мост — 2 бревна, только на реке', match: o => o && o.kind === 'water', run: 'build', kind: 'bridge', price: { 'бревна': 2 } },
      { cmd: 'убрать', icon: '🧹', hint: 'убрать — снять дорогу или мост', match: o => o && (o.kind === 'road' || o.kind === 'bridge'), run: 'clear' },
    ],
  },
  {
    name: 'СВОЙ ГОРОД', size: 9, icon: '🏙', par: 180,
    // финал: щебень для декораций добываем сами
    presets: [ { col: 4, row: 1, kind: 'mountain', stock: 30 }, { col: 4, row: 4, kind: 'mountain', stock: 30 } ],
    wallet: ['щебень'],
    goal: [
      { kind: 'fountain', n: 1, gen: 'фонтан', label: 'фонтан' },
      { kind: 'flowerbed', n: 2, gen: 'клумбы', label: 'клумба' },
      { kind: 'tree2', n: 1, gen: 'ёлка', label: 'ёлка' },
    ],
    verbs: [
      { cmd: 'клумба', icon: '🌸', hint: 'клумба — 1 щебень', match: o => !o, run: 'build', kind: 'flowerbed', price: { 'щебень': 1 }, emoji: '🌸' },
      { cmd: 'ёлка', icon: '🌲', hint: 'ёлка — 2 щебня', match: o => !o, run: 'build', kind: 'tree2', price: { 'щебень': 2 }, emoji: '🌲' },
      { cmd: 'фонтан', icon: '⛲', hint: 'фонтан — 4 щебня', match: o => !o, run: 'build', kind: 'fountain', price: { 'щебень': 4 }, emoji: '⛲' },
    ],
  },
];

// Эталонные решения для автотестов (test/harness.js, открывается с ?test=1).
// Одновременно документация замысла уровня: минимальный путь к цели.
// Шаг: {cell:'а1', cmd:'слово'} | {cells:['б4','б10'], cmd:'дорога'}
//      | {waitWork:true} | {wait:сек} | {sweep:true} — выполоть все сорняки.
const SOLUTIONS = [
  [ // 1: два леса в топор, два в пилу; пни выкорчевать
    { cell: 'а1', cmd: 'лес' }, { cell: 'а2', cmd: 'лес' }, { cell: 'а3', cmd: 'лес' }, { cell: 'а4', cmd: 'лес' },
    { cell: 'а1', cmd: 'рубить дрова' }, { cell: 'а2', cmd: 'рубить дрова' },
    { cell: 'а3', cmd: 'пилить бревна' }, { cell: 'а4', cmd: 'пилить бревна' },
    { waitWork: true },
    { cell: 'а1', cmd: 'корчевать' }, { cell: 'а2', cmd: 'корчевать' }, { cell: 'а3', cmd: 'корчевать' }, { cell: 'а4', cmd: 'корчевать' },
  ],
  [ // 2: без мышки — адрес печатью: «а1 лес»
    { cmd: 'а1 лес' }, { cmd: 'а2 лес' }, { cmd: 'а3 лес' },
    { cmd: 'а1 рубить дрова' }, { cmd: 'а2 рубить дрова' }, { cmd: 'а3 пилить бревна' },
    { waitWork: true },
    { cmd: 'а1 корчевать' }, { cmd: 'а2 корчевать' }, { cmd: 'а3 корчевать' },
  ],
  [ // 3: две горы под кирку, одна под кувалду; четвёртая лишняя
    { cell: 'в3', cmd: 'колоть булыжник' }, { cell: 'е2', cmd: 'колоть булыжник' }, { cell: 'ж6', cmd: 'дробить щебень' },
    { waitWork: true },
  ],
  [ // 4: два сада; фрукты портятся — успей собрать
    { cell: 'а1', cmd: 'сад' }, { cell: 'а2', cmd: 'сад' },
    { wait: 6.6 }, // GARDEN_GROW_T + запас
    { cell: 'а1', cmd: 'собрать фрукты' }, { waitWork: true },
    { cell: 'а2', cmd: 'собрать фрукты' }, { waitWork: true },
  ],
  [ // 5: шесть грядок (3+3) — урожай тает со временем, спешка сохраняет его
    { cell: 'а1', cmd: 'поле' }, { cell: 'а2', cmd: 'поле' }, { cell: 'а3', cmd: 'поле' },
    { cell: 'а4', cmd: 'поле' }, { cell: 'а5', cmd: 'поле' }, { cell: 'а6', cmd: 'поле' },
    { wait: 6.6 }, // FIELD_GROW_T + запас: все грядки успевают созреть
    { cell: 'а1', cmd: 'жать пшеницу' }, { cell: 'а2', cmd: 'жать пшеницу' }, { cell: 'а3', cmd: 'жать пшеницу' },
    { cell: 'а4', cmd: 'косить сено' }, { cell: 'а5', cmd: 'косить сено' }, { cell: 'а6', cmd: 'косить сено' },
    { waitWork: true },
  ],
  [ // 6: ярмарка — вырасти сам (сад + поле — навыки с ур. 4–5) и продай у лавки (г4)
    { cell: 'а1', cmd: 'сад' }, { cell: 'б1', cmd: 'поле' },
    { wait: 6.6 }, // фрукты и пшеница зреют
    { cell: 'а1', cmd: 'собрать фрукты' }, { cell: 'б1', cmd: 'жать пшеницу' },
    { waitWork: true },
    { cell: 'г4', cmd: 'продать фрукт 6' },   // 6 фруктов → 12 монет
    { cell: 'г4', cmd: 'продать пшеницу 6' }, // 6 пшеницы → 6 монет (итого 18)
    { cell: 'г4', cmd: 'купить шоколад' }, { cell: 'г4', cmd: 'купить шоколад' }, // −10 → 8 монет
  ],
  [ // 7: брёвна из леса (навык) → удочка в море, реки и мосты
    { cell: 'й3', cmd: 'пилить бревна' }, { cell: 'й6', cmd: 'пилить бревна' },
    { waitWork: true },
    { cell: 'а1', cmd: 'удить' }, { cell: 'а2', cmd: 'удить' },
    { cell: 'б1', cmd: 'река' }, { cell: 'б1', cmd: 'мост' },
    { cell: 'б2', cmd: 'река' }, { cell: 'б2', cmd: 'мост' },
    { cell: 'б3', cmd: 'река' }, { cell: 'б3', cmd: 'мост' },
    { cell: 'б4', cmd: 'река' }, { cell: 'б4', cmd: 'мост' },
    { waitWork: true },
  ],
  [ // 8: заказы-слова рыб
    { cell: 'а1', cmd: 'окунь' }, { cell: 'а2', cmd: 'карась' }, { cell: 'а3', cmd: 'щука' }, { cell: 'а4', cmd: 'ёрш' },
    { cell: 'а5', cmd: 'лещ' }, { cell: 'б2', cmd: 'сом' }, { cell: 'б3', cmd: 'налим' }, { cell: 'б4', cmd: 'судак' },
  ],
  [ // 9: щебень из трёх гор (навык) → дороги к складу
    { cell: 'д4', cmd: 'дробить щебень' }, { cell: 'д7', cmd: 'дробить щебень' }, { cell: 'е2', cmd: 'дробить щебень' },
    { waitWork: true },
    { cells: ['б4', 'б10'], cmd: 'дорога' },
    { cells: ['в10', 'з10'], cmd: 'дорога' },
  ],
  [ // 10: четыре горы на щебень → пути к складу и дому
    { cell: 'д7', cmd: 'дробить щебень' }, { cell: 'д9', cmd: 'дробить щебень' },
    { cell: 'е2', cmd: 'дробить щебень' }, { cell: 'е6', cmd: 'дробить щебень' },
    { waitWork: true },
    { cells: ['б4', 'б10'], cmd: 'дорога' },
    { cells: ['в10', 'з10'], cmd: 'дорога' },
    { cells: ['б4', 'и4'], cmd: 'дорога' },
    { cells: ['и4', 'й4'], cmd: 'дорога' },
  ],
  [ // 11: брёвна из трёх лесов → шесть мостов через реку (колонка ё)
    { cell: 'а1', cmd: 'пилить бревна' }, { cell: 'а3', cmd: 'пилить бревна' }, { cell: 'а5', cmd: 'пилить бревна' },
    { waitWork: true },
    { cell: 'ё2', cmd: 'мост' }, { cell: 'ё3', cmd: 'мост' }, { cell: 'ё4', cmd: 'мост' },
    { cell: 'ё5', cmd: 'мост' }, { cell: 'ё6', cmd: 'мост' }, { cell: 'ё7', cmd: 'мост' },
  ],
  [ // 12: почта — полный адрес в команде
    ...['в3', 'е7', 'й11', 'м4', 'о12', 'а16', 'к14', 'д2'].map(a => ({ cell: null, cmd: 'письмо ' + a })),
  ],
  [ // 13: добыть булыжники и брёвна (навыки) → дом ×2 + сарай
    { cell: 'д2', cmd: 'колоть булыжник' }, { waitWork: true },
    { cell: 'е5', cmd: 'пилить бревна' }, { cell: 'е7', cmd: 'пилить бревна' }, { waitWork: true },
    { cell: 'а1', cmd: 'дом' }, { cell: 'а2', cmd: 'дом' }, { cell: 'а3', cmd: 'сарай' },
  ],
  [ // 14: пекарня — всё своё: гора, лес и два поля кормят две печки
    { cell: 'д2', cmd: 'колоть булыжник' }, { waitWork: true },
    { cell: 'е5', cmd: 'рубить дрова' }, { waitWork: true },
    { cell: 'а1', cmd: 'поле' }, { cell: 'а2', cmd: 'поле' },
    { wait: 6.6 },
    { cell: 'а1', cmd: 'жать пшеницу' }, { cell: 'а2', cmd: 'жать пшеницу' }, { waitWork: true },
    { cell: 'б1', cmd: 'печка' }, { cell: 'б2', cmd: 'печка' },
    ...Array.from({ length: 8 }, (_, i) => ({ cell: i % 2 ? 'б2' : 'б1', cmd: 'испечь', waitWork: true })),
  ],
  [ // 15: склад — добыча навыками, 2 сарая поднимают лимит, затем дом
    { cell: 'д2', cmd: 'колоть булыжник' }, { waitWork: true },
    { cell: 'е5', cmd: 'пилить бревна' }, { cell: 'е7', cmd: 'пилить бревна' }, { waitWork: true },
    { cell: 'а1', cmd: 'сарай' }, { cell: 'а2', cmd: 'сарай' }, { cell: 'а3', cmd: 'дом' },
  ],
  [ // 16: кузница — своя гора и лес кормят два горна
    { cell: 'д2', cmd: 'колоть булыжник' }, { waitWork: true },
    { cell: 'е5', cmd: 'рубить дрова' }, { waitWork: true },
    { cell: 'а1', cmd: 'горн' }, { cell: 'а2', cmd: 'горн' },
    { cell: 'а1', cmd: 'сковать' }, { cell: 'а2', cmd: 'сковать' },
    { waitWork: true },
  ],
  [ // 17: три грядки, сорняки выпалываем
    { cell: 'а1', cmd: 'грядка' }, { cell: 'а3', cmd: 'грядка' }, { cell: 'а5', cmd: 'грядка' },
    { cell: 'а1', cmd: 'собрать', sweep: true }, { waitWork: true },
    { cell: 'а3', cmd: 'собрать', sweep: true }, { waitWork: true },
  ],
  [ // 18: теплица — 3 грядки по 10
    { cell: 'а1', cmd: 'грядка' }, { cell: 'а3', cmd: 'грядка' }, { cell: 'а5', cmd: 'грядка' },
    { cell: 'а1', cmd: 'собрать', sweep: true }, { waitWork: true },
    { cell: 'а3', cmd: 'собрать', sweep: true }, { waitWork: true },
    { cell: 'а5', cmd: 'собрать', sweep: true }, { waitWork: true },
  ],
  [ // 19: городок — камень, щебень и брёвна добываем перед стройкой
    { cell: 'д2', cmd: 'колоть булыжник' }, { cell: 'д4', cmd: 'дробить щебень' }, { waitWork: true },
    { cell: 'и3', cmd: 'пилить бревна' }, { cell: 'и6', cmd: 'пилить бревна' }, { waitWork: true },
    { cell: 'б5', cmd: 'река' }, { cell: 'б5', cmd: 'мост' }, { cell: 'г5', cmd: 'дом' },
    { cells: ['в4', 'в5'], cmd: 'дорога' },
  ],
  [ // 20: парк — щебень из трёх гор, потом декорации
    { cell: 'д2', cmd: 'дробить щебень' }, { cell: 'д5', cmd: 'дробить щебень' }, { cell: 'д8', cmd: 'дробить щебень' },
    { waitWork: true },
    { cell: 'а1', cmd: 'клумба' }, { cell: 'а2', cmd: 'клумба' },
    { cell: 'б1', cmd: 'ёлка' }, { cell: 'б2', cmd: 'ёлка' },
    { cell: 'в1', cmd: 'качели' }, { cell: 'в2', cmd: 'фонтан' },
  ],
  [ // 21: зоопарк — булыжники из двух гор, 6 клеток, слова животных
    { cell: 'д2', cmd: 'колоть булыжник' }, { cell: 'д5', cmd: 'колоть булыжник' }, { waitWork: true },
    { cell: 'а1', cmd: 'клетка' }, { cell: 'а2', cmd: 'клетка' }, { cell: 'а3', cmd: 'клетка' },
    { cell: 'а4', cmd: 'клетка' }, { cell: 'а5', cmd: 'клетка' }, { cell: 'а6', cmd: 'клетка' },
    { cell: 'а1', cmd: 'ёжик' }, { cell: 'а2', cmd: 'заяц' }, { cell: 'а3', cmd: 'лиса' },
    { cell: 'а4', cmd: 'волк' }, { cell: 'а5', cmd: 'сова' }, { cell: 'а6', cmd: 'олень' },
  ],
  [ // 22: школа — предложения с заглавной и точкой
    { cell: 'а1', cmd: 'Мама мыла раму.' },
    { cell: 'а2', cmd: 'Рома ел суп.' },
    { cell: 'а3', cmd: 'Нина несла мяч.' },
    { cell: 'а4', cmd: 'Лора пела песню.' },
    { cell: 'а5', cmd: 'Соня сонная.' },
  ],
  [ // 23: телеграф — фразы
    { cell: 'а1', cmd: 'принеси тёплый хлеб' },
    { cell: 'а2', cmd: 'ждём тебя домой' },
    { cell: 'а3', cmd: 'город спит спокойно' },
    { cell: 'а4', cmd: 'птицы летят на юг' },
  ],
  [ // 24: праздник — серия из 3 флагов, потом салют
    { cell: 'а1', cmd: 'флаг' }, { cell: 'а2', cmd: 'флаг' }, { cell: 'а3', cmd: 'флаг' }, { cell: 'а4', cmd: 'салют' },
    { cell: 'б1', cmd: 'флаг' }, { cell: 'б2', cmd: 'флаг' }, { cell: 'б3', cmd: 'флаг' }, { cell: 'б4', cmd: 'салют' },
    { cell: 'в1', cmd: 'флаг' }, { cell: 'в2', cmd: 'флаг' }, { cell: 'в3', cmd: 'флаг' }, { cell: 'в4', cmd: 'салют' },
  ],
  [ // 25: мастерская — брёвна из леса, верстаки и 10 слов
    { cell: 'д2', cmd: 'пилить бревна' }, { waitWork: true },
    { cell: 'а1', cmd: 'верстак' }, { cell: 'а2', cmd: 'верстак' },
    { cell: 'а1', cmd: 'мир' }, { cell: 'а1', cmd: 'дом' }, { cell: 'а1', cmd: 'кот' }, { cell: 'а1', cmd: 'сыр' }, { cell: 'а1', cmd: 'чай' },
    { cell: 'а2', cmd: 'мак' }, { cell: 'а2', cmd: 'пар' }, { cell: 'а2', cmd: 'год' }, { cell: 'а2', cmd: 'юла' }, { cell: 'а2', cmd: 'ёжик' },
  ],
  [ // 26: дождь слов — 15 слов
    { rain: 15 },
  ],
  [ // 27: ночной город без мышки
    { cmd: 'а1 грядка' }, { cmd: 'а3 грядка' },
    { cmd: 'а1 собрать', sweep: true }, { waitWork: true },
    { cmd: 'а3 собрать', sweep: true }, { waitWork: true },
  ],
  [ // 28: скорый поезд — 12 слов
    { rain: 12 },
  ],
  [ // 29: большой мост — босс: вся накопленная добыча в деле
    { cell: 'д2', cmd: 'колоть булыжник' }, { cell: 'д5', cmd: 'дробить щебень' }, { waitWork: true },
    { cell: 'и2', cmd: 'пилить бревна' }, { cell: 'и5', cmd: 'пилить бревна' }, { cell: 'и8', cmd: 'пилить бревна' }, { waitWork: true },
    { cell: 'б4', cmd: 'река' }, { cell: 'б4', cmd: 'мост' },
    { cell: 'б5', cmd: 'река' }, { cell: 'б5', cmd: 'мост' },
    { cell: 'б6', cmd: 'река' }, { cell: 'б6', cmd: 'мост' },
    { cell: 'г4', cmd: 'дом' }, { cell: 'г6', cmd: 'дом' },
    { cells: ['в4', 'в5'], cmd: 'дорога' },
    { cells: ['в5', 'в6'], cmd: 'дорога' },
  ],
  [ // 30: свой город — щебень из гор, потом декорации
    { cell: 'д2', cmd: 'дробить щебень' }, { cell: 'д5', cmd: 'дробить щебень' }, { waitWork: true },
    { cell: 'а1', cmd: 'клумба' }, { cell: 'а2', cmd: 'клумба' },
    { cell: 'б1', cmd: 'ёлка' }, { cell: 'б2', cmd: 'фонтан' },
  ],
];

let levelIdx = 0, LVL = LEVELS[0];
let N = 5, CELL = 120, SF = 6, GS = 600, GRID_OX = 64, GRID_OY = 106, labelFont = 41;
// ДЕМО показывает кампанию линейно: для наследования навыков считает
// все предыдущие уровни пройденными (личный сейв игрока тут ни при чём)
let skillDone = null;
function demoSkillOverride(i) {
  skillDone = {};
  for (let j = 0; j < i; j++) skillDone[j] = true;
}

function applyLevel(i) {
  levelIdx = i;
  const base = LEVELS[i];
  LVL = Object.assign({}, base);
  // Скиллы: команды пройденных уровней остаются у игрока навсегда —
  // «открыл сажать лес» значит можно сажать везде дальше.
  const extra = [];
  // В dev-режиме уровни открывают вразнобой — навыки выдаём так, будто
  // все предыдущие пройдены: иначе на уровне нечем добыть ресурс.
  const doneSet = skillDone || (DEV()
    ? LEVELS.reduce((o, _v, j) => { if (j < i) o[j] = true; return o; }, {})
    : SAVE.done);
  for (const m in doneSet) {
    const src = LEVELS[m];
    if (!src || +m === i) continue;
    for (const v of (src.verbs || [])) {
      if (!['build', 'work', 'clear', 'burn'].includes(v.run)) continue;
      if ((base.verbs || []).some(w => w.cmd === v.cmd)) continue;
      if (extra.some(w => w.cmd === v.cmd)) continue;
      extra.push(Object.assign({}, v, { skill: true }));
    }
  }
  LVL.verbs = (base.verbs || []).concat(extra);
  N = LVL.size;
  CELL = Math.max(12, Math.floor(662 / (N + 0.51)));
  labelFont = Math.max(11, Math.round(CELL * 0.34));
  SF = CELL / 20; GS = CELL * N;
  GRID_OX = 34 + Math.floor((660 - GS) / 2);
  GRID_OY = 44 + Math.round(labelFont * 1.5);
}

// ---------- туториал ----------
let tut = null, tutIdx = 0;
function tutStart() {
  tut = null; tutIdx = 0;
  if (LVL.tutorial && !(SAVE.tutDone || {})[levelIdx]) tut = LVL.tutorial;
}
function tutRect(step) {
  if (step.chip) { // карточка команды: клик открывает клавиатуру-подсказку
    const c = chips.find(ch => ch.cmd === step.chip);
    if (c) return { x: c.x, y: c.y, w: c.w, h: c.h };
  }
  if (step.input) {
    // клавиатура открыта — подсвечиваем её вместе со строкой ввода
    if (kbTarget && kbRect) return { x: 730, y: kbRect.y, w: 530, h: 670 - kbRect.y };
    return { x: 730, y: 616, w: 496, h: 54 };
  }
  if (step.cell) return { x: cellX(step.cell[0]), y: cellY(step.cell[1]), w: CELL, h: CELL };
  return { x: 590, y: 340, w: 100, h: 100 };
}
function tutTick() {
  if (!tut) return;
  const step = tut[tutIdx];
  if (step && step.check()) {
    tutIdx++;
    beep(700, 0.1, 'triangle', 0.1);
    if (tutIdx >= tut.length) {
      tut = null;
      if (demo && demo.on) return; // ДЕМО: обучение только показываем, сейв не трогаем
      SAVE.tutDone = SAVE.tutDone || {};
      SAVE.tutDone[levelIdx] = true;
      persistSave();
      log('🎉 Ты справился! Дальше — сам, журнал подскажет', 'ok');
    }
  }
}
function tutSkip() {
  if (!tut) return false;
  tut = null;
  if (!(demo && demo.on)) { // ДЕМО: не помечаем обучение пройденным
    SAVE.tutDone = SAVE.tutDone || {};
    SAVE.tutDone[levelIdx] = true;
    persistSave();
  }
  return true;
}
function drawTutorial() {
  if (!tut) return;
  const step = tut[tutIdx];
  if (!step) return;
  const r = tutRect(step);
  // затемняем всё, кроме области шага
  ctx.fillStyle = 'rgba(4,12,8,0.62)';
  ctx.fillRect(0, 0, W, r.y);
  ctx.fillRect(0, r.y + r.h, W, H - r.y - r.h);
  ctx.fillRect(0, r.y, r.x, r.h);
  ctx.fillRect(r.x + r.w, r.y, W - r.x - r.w, r.h);
  // пульсирующая рамка области
  ctx.strokeStyle = 'rgba(255,224,102,' + (0.6 + 0.4 * Math.sin(now * 5)) + ')';
  ctx.lineWidth = 4;
  ctx.strokeRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  // пузырь с заданием
  ctx.font = 'bold 21px Segoe UI';
  const tw = ctx.measureText(step.text).width;
  const bw = tw + 36, bh = 56;
  let bx = Math.min(W - bw - 16, Math.max(16, r.x + r.w / 2 - bw / 2));
  let by = r.y - bh - 26 < 10 ? r.y + r.h + 22 : r.y - bh - 22;
  // в демо слева сверху висит баннер — подсказку прячем под клетку, а не под баннер
  if (demo && demo.on && bx < 556 && by < 122) by = r.y + r.h + 22;
  ctx.fillStyle = '#ffe066'; rr(bx, by, bw, bh, 14);
  ctx.fillStyle = '#17382a'; ctx.textAlign = 'center';
  ctx.fillText(step.text, bx + bw / 2, by + 35);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9dbfa5'; ctx.font = '14px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText(demo && demo.on ? '▶ ДЕМО: обучение показано как для игрока · Esc — выход' : 'Esc — пропустить обучение', W / 2, H - 12);
  ctx.textAlign = 'left';
}

// ---------- звук ----------
let AC = null;
function beep(freq, dur = 0.1, type = 'square', vol = 0.12) {
  if (SAVE.settings.mute) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dur);
    o.connect(g); g.connect(AC.destination);
    o.start(); o.stop(AC.currentTime + dur);
  } catch (e) {}
}
const sndPlant = () => beep(520, 0.12, 'triangle');
const sndChop  = () => { beep(170, 0.05, 'square', 0.18); beep(90, 0.07, 'sawtooth', 0.1); };
const sndSaw   = () => { beep(700, 0.08, 'sawtooth', 0.1); setTimeout(() => beep(560, 0.08, 'sawtooth', 0.1), 90); };
const sndPick  = () => { beep(140, 0.06, 'square', 0.2); beep(220, 0.04, 'triangle', 0.08); };
const sndHammer= () => { beep(80, 0.09, 'sine', 0.25); beep(50, 0.1, 'sine', 0.15); };
const sndBoom  = () => { beep(60, 0.4, 'sawtooth', 0.3); beep(120, 0.3, 'square', 0.2); setTimeout(() => beep(45, 0.5, 'sine', 0.25), 60); };
const sndErr   = () => beep(130, 0.25, 'sawtooth', 0.15);
const sndTick  = () => beep(760, 0.05, 'triangle', 0.06);
const sndBurn  = () => { beep(320, 0.3, 'sawtooth', 0.12); beep(240, 0.35, 'sawtooth', 0.08); };
function sndWin() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.25, 'triangle', 0.15), i * 180)); }
function playAct(worker) {
  const fn = { axe: sndChop, saw: sndSaw, pick: sndPick, hammer: sndHammer, sickle: sndChop, scythe: sndSaw, rod: sndPick, baker: sndTick, basket: sndChop }[worker];
  if (fn) fn();
}

// ---------- состояние ----------
let state = 'menu';
let resources = {};
let objs = {};
let workers = [];
let particles = [], floats = [], flashes = [];
let logArr = [];
let stats = { typed: 0, ok: 0, err: 0, built: 0, stumpsMade: 0, stumpsCleared: 0, startT: performance.now() };
const accPct = () => { const tot = stats.ok + stats.err; return tot ? Math.min(100, Math.round(stats.ok / tot * 100)) : 100; };
let now = 0, playT = 0, shake = 0;
let hover = null;
let selected = null;
let selected2 = null;
let roadFrom = null; // точка старта дороги: ждём клик по конечной точке
let kbTarget = null;
let kbClose = null;
let kbRect = null; // зона клавиатуры-подсказки (для подсветки в обучении)
let winTime = 0;
let menuCards = [];
let menuBtn = null;
let orderIdx = 0;
let weedAcc = 0;
let stumpTold = false;
let simHold = false; //true — автотест управляет симуляцией сам
let lastSubmit = { ok: false, msg: '' };
let telemLen = 0;
let streak = 0, hintUses = 0; // серия без ошибок / открытий подсказки-клавиатуры
let bubbles = [], bubAcc = 0; // бонус-пузыри со словами (занятость в паузах)
const BUBBLE_LIFE = 9; // секунд живёт пузырь; шкала внутри показывает остаток
const BUBBLE_WORDS = ['мир', 'дом', 'кот', 'сыр', 'чай', 'мак', 'пар', 'год', 'юла', 'ёжик', 'ива', 'хлеб', 'звук', 'флаг', 'щавель', 'экран', 'юг', 'яма', 'цифра', 'мышь', 'ольха', 'ствол'];
function weakLetters() {
  const arr = Object.keys(SAVE.keys).map(k => [k, SAVE.keys[k]]);
  arr.sort((a, b) => b[1] - a[1]);
  return arr.slice(0, 3).map(a => a[0]);
}
function pickBubble() {
  const weak = weakLetters();
  const good = BUBBLE_WORDS.filter(w => weak.some(l => w.includes(l)));
  const pool = good.length ? good : BUBBLE_WORDS;
  return pool[Math.floor(Math.random() * pool.length)];
}
function spawnBubble() {
  if (bubbles.length >= 2) return;
  const col = Math.floor(Math.random() * N), row = Math.floor(Math.random() * N);
  bubbles.push({ word: pickBubble(), x: cellX(col) + CELL / 2, y: cellY(row), life: BUBBLE_LIFE, max: BUBBLE_LIFE, col: '#80d8ff' });
}

// ---------- сохранение и телеметрия ----------
const SAVE_KEY = 'typing_city_v1';
let SAVE = { done: {}, best: {}, keys: {}, chars: 0, wins: 0, stars: {}, spent: 0, owned: [], city: {}, settings: { mute: false, kb: 'яркая', theme: 'classic' }, history: [] };
const TELEM = { events: [], keyErrors: {}, chars: 0 };

// ---------- темы оформления ----------
const THEMES = {
  classic:  { name: 'Классика', bg: '#17382a', g1: '#1a3f30', g2: '#1c4433', menu: '#15291d', acc: '#ffe066' },
  winter:   { name: 'Зима',     bg: '#274c77', g1: '#2b547f', g2: '#2f5a87', menu: '#1b3554', acc: '#a8e0ff' },
  night:    { name: 'Ночь',     bg: '#0d1330', g1: '#111739', g2: '#151b41', menu: '#0a0f26', acc: '#ffe066' },
  sakura:   { name: 'Сакура',   bg: '#3a2434', g1: '#452b3d', g2: '#4d3045', menu: '#2e1c2b', acc: '#ffd6e7' },
  contrast: { name: 'Контраст', bg: '#000000', g1: '#0a0a0a', g2: '#161616', menu: '#000000', acc: '#ffd700' },
};
const TH = () => THEMES[SAVE.settings.theme] || THEMES.classic;

// ---------- магазин ----------
const ITEMS = [
  { id: 'flower',   name: 'клумба',   icon: '🌸', price: 2 },
  { id: 'tree',     name: 'ёлка',     icon: '🌲', price: 2 },
  { id: 'lamp',     name: 'фонарик',  icon: '🏮', price: 3 },
  { id: 'swing',    name: 'качели',   icon: '🛝', price: 4 },
  { id: 'pond',     name: 'пруд',     icon: '🦆', price: 5 },
  { id: 'fountain', name: 'фонтан',   icon: '⛲', price: 6 },
  { id: 'cat',      name: 'кот',      icon: '🐈', price: 5 },
  { id: 'dog',      name: 'пёс',      icon: '🐕', price: 7 },
  { id: 'hedgehog', name: 'ёжик',     icon: '🦔', price: 9 },
  { id: 'th-winter',   name: 'тема «Зима»',     icon: '❄️', price: 8 },
  { id: 'th-night',    name: 'тема «Ночь»',     icon: '🌙', price: 8 },
  { id: 'th-sakura',   name: 'тема «Сакура»',   icon: '🌸', price: 10 },
  { id: 'th-contrast', name: 'тема «Контраст»', icon: '🌕', price: 6 },
  { id: 'title1', name: 'титул «Тихий»',           icon: '🍃', price: 3 },
  { id: 'title2', name: 'титул «Светлый»',         icon: '✨', price: 6 },
  { id: 'title3', name: 'титул «Печатная столица»', icon: '👑', price: 12 },
];
const ITEM_BY_WORD = {}; // «фонтан» → item (для города)
for (const it of ITEMS) if (!it.id.startsWith('th-') && !it.id.startsWith('title')) ITEM_BY_WORD[it.name] = it;
const starsEarned = () => { let s = 0; for (const k in SAVE.stars) s += SAVE.stars[k]; return s; };
const starsBalance = () => starsEarned() - (SAVE.spent || 0);
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      SAVE = Object.assign({ done: {}, best: {}, keys: {}, chars: 0, wins: 0, stars: {}, spent: 0, owned: [], city: {}, settings: { mute: false, kb: 'яркая', theme: 'classic' }, history: [] }, s);
      SAVE.settings = Object.assign({ mute: false, kb: 'яркая', theme: 'classic' }, s.settings || {});
      SAVE.stars = s.stars || {}; SAVE.owned = s.owned || []; SAVE.city = s.city || {}; SAVE.history = s.history || [];
    }
  } catch (e) { /* приватный режим — играем без сохранения */ }
}
function persistSave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) {}
}
function mergeTelemIntoSave() {
  for (const k in TELEM.keyErrors) SAVE.keys[k] = (SAVE.keys[k] || 0) + TELEM.keyErrors[k];
  SAVE.chars += TELEM.chars;
}
function telem(ev, data) {
  TELEM.events.push(Object.assign({ t: Date.now(), ev: ev }, data || {}));
  if (TELEM.events.length > 400) TELEM.events.splice(0, TELEM.events.length - 400);
}
loadSave();

// режим разработчика: все уровни открыты (?dev=1 или тумблер в настройках)
const DEV = () => /[?&]dev=1/.test(location.search) || !!SAVE.settings.dev;

const cellName = (c, r) => LETTERS[c] + (r + 1);
const cellX = c => GRID_OX + c * CELL;
const cellY = r => GRID_OY + r * CELL;
function goalsOf(L) { return L.goal.map(g => g.text || (g.n + ' ' + g.gen)).join(' + ') + (L.noStumps ? ' + пней: 0' : ''); }
const goalStr = () => goalsOf(LVL);
const WORDS = () => LVL.verbs.map(v => v.cmd).concat(LVL.words ? [currentWord()] : []);
function log(text, kind = 'ok') { logArr.unshift({ text, kind }); if (logArr.length > 6) logArr.pop(); }

// текущее слово заказа (уровни с LVL.words / LVL.dictPool)
let wordIdx = 0;
function currentWord() {
  if (LVL.dictPool) return LVL.dictPool[wordIdx % LVL.dictPool.length];
  if (LVL.words) return LVL.words[wordIdx % LVL.words.length];
  return null;
}
// разбор ввода: «б3» (адрес) | «б3 лес» (адрес+команда) | «письмо п12» | «продать 3»
function parseInput(raw) {
  const m = raw.match(/^([а-яё])(\d{1,2})(?:\s+(.+))?$/);
  if (m) return { addr: m[1] + m[2], rest: (m[3] || '').trim() };
  const m2 = raw.match(/^(.+?)\s+([а-яё]\d{1,2})$/); // «письмо п12»
  if (m2) return { addr: m2[2], rest: m2[1].trim() };
  const m3 = raw.match(/^(.+?)\s+(\d{1,3})$/); // «продать фрукт 3»
  if (m3) return { num: parseInt(m3[2], 10), rest: m3[1].trim() };
  return { addr: null, rest: raw.trim() };
}
function addrCell(addr) {
  if (!/^[а-яё]\d{1,2}$/.test(addr)) return null;
  const col = LETTERS.indexOf(addr[0]);
  const row = parseInt(addr.slice(1), 10) - 1;
  if (col < 0 || col >= N || row < 0 || row >= N) return null;
  return { col, row };
}
// ресурс с учётом лимита склада (LVL.cap / LVL.capRaise)
function addRes(res, n) {
  if (!LVL.cap || !LVL.cap[res]) { resources[res] = (resources[res] || 0) + n; return n; }
  let cap = LVL.cap[res];
  for (const k in objs) if (objs[k].kind === LVL.capRaise) cap += LVL.capAdd || 0;
  const have = resources[res] || 0;
  const take = Math.max(0, Math.min(n, cap - have));
  resources[res] = have + take;
  if (take < n) log('🔒 Некуда складывать ' + res + ' — построй сарай', 'warn');
  return take;
}
// победа: звёзды, сейв, телеметрия — единая точка
// Критерии: 1 — прохождение; 2 — точность≥85; 3 — точность≥95;
// 4 — без подсказки-клавиатуры; 5 — поймано пузырей (1/2/3 по третям игры).
const bubblesNeed = () => (levelIdx < 10 ? 1 : levelIdx < 20 ? 2 : 3);
function starForecast() {
  const acc = accPct();
  return [
    true,
    acc >= 85,
    acc >= 95,
    hintUses === 0,
    poppedBubbles >= bubblesNeed(),
  ];
}
let poppedBubbles = 0;
function winLevel() {
  state = 'win'; winTime = (performance.now() - stats.startT) / 1000;
  sndWin();
  const acc = accPct();
  const stars = starForecast().filter(Boolean).length;
  lastWinStars = stars;
  if (demo && demo.on) return; // ДЕМО: сейв и статистику не трогаем
  const wasDone = Object.assign({}, SAVE.done);
  const prev = SAVE.stars[levelIdx] || 0;
  if (stars > prev) SAVE.stars[levelIdx] = stars;
  SAVE.done[levelIdx] = true;
  // что открылось благодаря этой победе — подсветим на карте
  newlyUnlocked = [];
  for (let i = 0; i < LEVELS.length; i++) {
    if (i === levelIdx || wasDone[i]) continue;
    if (!levelUnlocked(i, wasDone) && levelUnlocked(i, SAVE.done)) newlyUnlocked.push(i);
  }
  const best = SAVE.best[levelIdx] || {};
  best.acc = Math.max(best.acc || 0, acc);
  best.time = Math.min(best.time || Infinity, Math.round(winTime));
  best.stars = Math.max(best.stars || 0, stars);
  SAVE.best[levelIdx] = best;
  SAVE.wins = (SAVE.wins || 0) + 1;
  SAVE.history.push({ level: levelIdx + 1, acc: acc, time: Math.round(winTime), stars: stars, d: Date.now() });
  if (SAVE.history.length > 60) SAVE.history.shift();
  mergeTelemIntoSave();
  persistSave();
  telem('level_win', { level: levelIdx + 1, time: Math.round(winTime), acc: acc, typed: stats.typed, chars: TELEM.chars, stars: stars });
}
let lastWinStars = 0;

function makeObj(kind, col, row, extra) {
  return Object.assign({ kind, col, row, stock: 0, max: 0, born: now, t0: playT, burning: null, boom: false, held: false, price: null }, extra || {});
}
// Жизнь грядки: FIELD_GROW_T растёт → спелая навсегда. Уют без спешки:
// механика порчи перенесена на сады — грядка, созрев, просто ждёт сбора.
const FIELD_GROW_T = 6;
function fieldStage(o) {
  if (!o || o.kind !== 'field') return '';
  if (o.held) return 'ripe';
  return (playT - o.t0) < FIELD_GROW_T ? 'grow' : 'ripe';
}
function fieldLeft(o) { // секунд до спелости — для подсказки ребёнку
  const age = playT - o.t0;
  return fieldStage(o) === 'grow' ? Math.max(0, Math.ceil(FIELD_GROW_T - age)) : 0;
}

// Жизнь сада: GARDEN_GROW_T растёт → фрукты зреют и ПОРТЯТСЯ со временем.
// GARDEN_GRACE — доля окна, пока все фрукты целы; дальше портятся один за другим
// (последний доживает до конца окна). Спешишь — больше соберёшь.
const GARDEN_GROW_T = 6, GARDEN_RIPE_T = 45, GARDEN_GRACE = 0.6;
function gardenStage(o) {
  if (!o || o.kind !== 'apple') return '';
  if (o.held) return 'ripe';
  const age = playT - o.t0;
  if (age < GARDEN_GROW_T) return 'grow';
  if (age < GARDEN_RIPE_T) return 'ripe';
  return 'gone';
}
function gardenLeft(o) { // секунд до порчи — для подсказки ребёнку
  const age = playT - o.t0;
  const s = gardenStage(o);
  if (s === 'grow') return Math.max(0, Math.ceil(GARDEN_GROW_T - age));
  if (s === 'ripe') return Math.max(0, Math.ceil(GARDEN_RIPE_T - age));
  return 0;
}
// доля целых фруктов (1 — все целы); после льготного окна тает линейно до 1/8
function gardenYieldFrac(o) {
  const p = Math.max(0, 1 - ((playT - o.t0) - GARDEN_GROW_T) / (GARDEN_RIPE_T - GARDEN_GROW_T));
  return p >= GARDEN_GRACE ? 1 : Math.max(0.125, p / GARDEN_GRACE);
}
// фрукты портятся со временем (кроме случая, когда их уже собирают)
function clampGardenStock(o) {
  if (o.kind !== 'apple' || o.held) return;
  if (gardenStage(o) !== 'ripe') return;
  o.stock = Math.min(o.stock, Math.max(1, Math.ceil((o.max || 1) * gardenYieldFrac(o))));
}
function touchesFlow(col, row) {
  for (const n of neighbors(col, row)) {
    const o = objs[cellName(n.col, n.row)];
    if (o && (o.kind === 'sea' || o.kind === 'water')) return true;
  }
  return false;
}
function neighbors(c, r) {
  const out = [];
  for (const [dc, dr] of DIRS) {
    const nc = c + dc, nr = r + dr;
    if (nc >= 0 && nc < N && nr >= 0 && nr < N) out.push({ col: nc, row: nr });
  }
  return out;
}
function countKind(kind) {
  let n = 0;
  for (const k in objs) if (objs[k].kind === kind) n++;
  return n;
}
function weedNear(col, row) {
  for (const n of neighbors(col, row)) {
    const o = objs[cellName(n.col, n.row)];
    if (o && o.kind === 'weed') return true;
  }
  return false;
}
function linked(kindA, kindB) {
  const starts = [], goals = [];
  for (const k in objs) {
    const o = objs[k];
    if (o.kind === kindA) starts.push(o);
    if (o.kind === kindB) goals.push(o);
  }
  if (!starts.length || !goals.length) return false;
  const seen = new Set(), q = [];
  for (const b of starts) for (const n of neighbors(b.col, b.row)) {
    const key = cellName(n.col, n.row);
    const o = objs[key];
    if (o && o.kind === 'road' && !seen.has(key)) { seen.add(key); q.push(o); }
  }
  while (q.length) {
    const p = q.pop();
    for (const g of goals) if (Math.abs(g.col - p.col) + Math.abs(g.row - p.row) === 1) return true;
    for (const n of neighbors(p.col, p.row)) {
      const key = cellName(n.col, n.row);
      const o = objs[key];
      if (o && o.kind === 'road' && !seen.has(key)) { seen.add(key); q.push(o); }
    }
  }
  return false;
}
function townOk() {
  const houses = [], bridges = [];
  for (const k in objs) {
    const o = objs[k];
    if (o.kind === 'house') houses.push(o);
    if (o.kind === 'bridge') bridges.push(o);
  }
  if (!houses.length || !bridges.length) return false;
  const touch = list => {
    const keys = new Set();
    for (const b of list) for (const n of neighbors(b.col, b.row)) {
      const key = cellName(n.col, n.row);
      const o = objs[key];
      if (o && o.kind === 'road') keys.add(key);
    }
    return keys;
  };
  const hs = touch(houses), bs = touch(bridges);
  if (!hs.size || !bs.size) return false;
  const seen = new Set(), q = [];
  for (const k of hs) { seen.add(k); q.push(k); }
  while (q.length) {
    const key = q.pop();
    if (bs.has(key)) return true;
    const o = objs[key];
    for (const n of neighbors(o.col, o.row)) {
      const nk = cellName(n.col, n.row);
      const no = objs[nk];
      if (no && no.kind === 'road' && !seen.has(nk)) { seen.add(nk); q.push(nk); }
    }
  }
  return false;
}
function goalName(g) { return g.label || g.res; }
function goalVal(g) {
  if (g.flag === 'roads') return linked('sawmill', 'warehouse') ? 1 : 0;
  if (g.flag === 'roads2') return linked('sawmill', 'house') ? 1 : 0;
  if (g.flag === 'town') return townOk() ? 1 : 0;
  if (g.flag && g.flag.slice(0, 5) === 'sold:') return (stats.sold && stats.sold[g.flag.slice(5)]) || 0;
  if (g.kind) return countKind(g.kind);
  return resources[g.res] || 0;
}
function goalMet() {
  if (!LVL.goal.every(g => goalVal(g) >= g.n)) return false;
  if (LVL.noStumps && countKind('stump') > 0) return false;
  return true;
}

function layLevel() {
  const stock = LVL.fishStock || 0;
  for (const [c, r] of (LVL.sea || [])) objs[cellName(c, r)] = makeObj('sea', c, r, { stock, max: stock });
  for (const [c, r] of (LVL.water || [])) objs[cellName(c, r)] = makeObj('water', c, r, { stock, max: stock });
  for (const p of (LVL.presets || [])) {
    const n = p.stock || 0;
    objs[cellName(p.col, p.row)] = makeObj(p.kind, p.col, p.row, { stock: n, max: p.max || n });
  }
}
function reset() {
  state = 'play'; resources = {}; objs = {}; workers = [];
  particles = []; floats = []; flashes = []; logArr = [];
  stats = { typed: 0, ok: 0, err: 0, built: 0, stumpsMade: 0, stumpsCleared: 0, sold: {}, startT: performance.now() };
  for (const g of LVL.goal) if (g.res) resources[g.res] = 0;
  if (LVL.start) for (const k in LVL.start) resources[k] = LVL.start[k];
  selected = null; selected2 = null; roadFrom = null; kbTarget = null;
  orderIdx = 0; weedAcc = 0; playT = 0; stumpTold = false;
  streak = 0; hintUses = 0; bubbles = []; bubAcc = 0; wordIdx = 0;
  lockedPick = -1; poppedBubbles = 0;
  tutStart(); poppedBubbles = 0;
  tutStart();
  TELEM.chars = 0; TELEM.keyErrors = {};
  telem('level_start', { level: levelIdx + 1, name: LVL.name });
  layLevel();
  if (LVL.mode === 'rain') { rainReset(); return; }
  log('Цель уровня: ' + goalStr(), 'info');
  if (LVL.noStumps) log('Пни надо выкорчевать — иначе уровень не сдан', 'info');
  if (LVL.orders) log('Письмо на ' + LVL.orders[0], 'info');
  else if (LVL.two) log('Дорога: кликни клетку старта → напечатай «дорога» → кликни конец', 'info');
  else if (LVL.words) log('Напечатай слово: ' + currentWord(), 'info');
  else log('Кликни по ячейке, напечатай команду, Enter', 'info');
  if (LVL.noClick) log('Мышка отключена: клетку выбирай печатью, например «б3»', 'info');
}

// ---------- команды ----------
function CMD_INFO(word) {
  const v = LVL.verbs.find(x => x.cmd === word);
  return v ? v.icon + ' ' + v.hint + (v.skill ? ' · навык' : '') : word;
}
function workerAt(key) { return workers.find(w => w.key === key && w.phase !== 'leave'); }
function cellState(c, r) {
  const key = cellName(c, r);
  const at = { key, col: c, row: r };
  if (workerAt(key)) return Object.assign({ type: 'busy' }, at);
  const o = objs[key];
  if (o && o.burning) return Object.assign({ type: 'burning' }, at);
  if (o) return Object.assign({ type: 'object', kind: o.kind }, at);
  return Object.assign({ type: 'empty' }, at);
}
function commandsFor(st) {
  if (st.type === 'busy' || st.type === 'burning') return [];
  const o = objs[st.key];
  // навыки показываем наравне с командами уровня: без этого ребёнок кликает
  // по дереву/горе и не видит, ЧТО можно сделать выученной командой
  return LVL.verbs.filter(v => v.run !== 'mail' && v.match(o, st)).map(v => v.cmd);
}
function workerName(mode) {
  return {
    axe: 'Дровосек', saw: 'Пильщик', pick: 'Шахтёр', hammer: 'Каменотёс',
    sickle: 'Жнец', scythe: 'Косец', rod: 'Рыбак', baker: 'Пекарь', basket: 'Сборщик',
  }[mode] || 'Рабочий';
}
function deficits(price) {
  const out = [];
  for (const k in price) {
    const have = resources[k] || 0;
    if (have < price[k]) {
      const f = FORMS[k] || [k, k, k];
      out.push(ru(price[k] - have, f[0], f[1], f[2]));
    }
  }
  return out;
}
function refundFull(o) {
  const back = [];
  for (const k in (o.price || {})) {
    const n = o.price[k];
    if (!n) continue;
    resources[k] = (resources[k] || 0) + n;
    const f = FORMS[k] || [k, k, k];
    back.push(ru(n, f[0], f[1], f[2]));
  }
  return back;
}
function payProblem(pay) {
  if ((resources['пшеница'] || 0) < (pay['пшеница'] || 0)) return 'тесто кончилось';
  if ((resources['дрова'] || 0) < (pay['дрова'] || 0)) return 'не хватает дров';
  const lack = deficits(pay);
  return lack.length ? 'не хватает: ' + lack.join(', ') : '';
}
function whyNot(word, st, o) {
  if ((word === 'продать фрукт' || word === 'продать пшеницу' || word === 'купить ленту') && (!o || o.kind !== 'stall'))
    return 'Торговать можно только у лавки — она в центре площади';
  if (o && o.kind === 'field') {
    const s = fieldStage(o);
    if (s === 'grow') return 'Грядка ' + st.key + ' ещё растёт — подожди';
    return 'Грядка ' + st.key + ' спелая — жать пшеницу или косить сено';
  }
  if (o && o.kind === 'apple') {
    const s = gardenStage(o);
    if (s === 'grow') return 'Сад ' + st.key + ' ещё растёт — подожди, пока созреют фрукты';
    return 'Сад ' + st.key + ' спелый — собрать фрукты, пока не испортились';
  }
  if (o && o.kind === 'stump') return 'Здесь пень — команда корчевать';
  if (o && o.kind === 'sea') {
    if (word === 'мост') return 'В море мост не поставить — отведи реку';
    if (word === 'удить') return 'Здесь рыба кончилась';
    return 'Это море';
  }
  if (!o && word === 'река') return 'Реку можно вести только от моря или от реки';
  if (!o && (word === 'удить' || word === 'мост')) return 'Это суша. Удить можно в море, мост — на реке';
  if (o && o.kind === 'water' && word === 'удить') return 'Рыбу ловят в море';
  if (o && o.kind === 'fished') return 'Здесь рыба кончилась — можно поставить мост';
  if (o && o.kind === 'water') return 'Это река — можно поставить мост';
  if (o && (o.kind === 'sawmill' || o.kind === 'warehouse')) return 'Здесь стоит здание';
  if (o && o.kind === 'house') return 'Здесь стоит дом';
  if (o && o.kind === 'shed') return 'Здесь стоит сарай';
  if (o && o.kind === 'road') return 'Здесь дорога — команда убрать';
  if (o && o.kind === 'bridge') return 'Здесь уже стоит мост';
  if (o && o.kind === 'weed') return 'Это сорняк — команда полоть';
  if (o && o.kind === 'oven') return 'Здесь печка — команда испечь';
  if (LVL.classic && !o) return 'В ячейке ' + st.key + ' нет ' + (LVL.objectKind === 'tree' ? 'леса' : 'горы');
  if (LVL.classic) return 'В ячейке ' + st.key + ' уже стоит ' + (LVL.objectKind === 'tree' ? 'лес' : 'гора');
  if (!o) return 'В ячейке ' + st.key + ' пусто';
  return 'Команда «' + word + '» здесь не подходит';
}
function putPhrase(kind) {
  const names = {
    tree: 'лес посажен', apple: 'сад посажен',
    mountain: 'гора поставлена', field: 'грядка посажена', bed: 'грядка посажена',
    oven: 'печка поставлена', house: 'дом построен', shed: 'сарай построен',
    bridge: 'мост построен', water: 'река отведена',
  };
  return names[kind] || (kind + ' поставлен');
}
// Дорога от точки старта К конечной: идём по направлению цели (сперва по
// строке, затем по столбцу) и кладём клетки, пока хватает щебня; у здания
// или воды дорога останавливается сама. Быстрый путь (автотесты/демо):
// если конечная точка уже выбрана вторым кликом — строим сразу.
function buildRoad(from, to) {
  if (!from || !to) { failInput('Кликни клетку старта, команду «дорога», затем конечную точку'); return false; }
  if (from.col === to.col && from.row === to.row) { failInput('Кликни конечную точку в другом месте'); return false; }
  const st0 = objs[cellName(from.col, from.row)];
  if (st0 && st0.kind !== 'road') { failInput('Точка старта должна быть пустой клеткой'); return false; }
  const path = [{ col: from.col, row: from.row }];
  let c = from.col, r = from.row;
  while (c !== to.col) { c += Math.sign(to.col - c); path.push({ col: c, row: r }); }
  while (r !== to.row) { r += Math.sign(to.row - r); path.push({ col: c, row: r }); }
  const price = LVL.roadPrice || null;
  let built = 0, outOf = false, blocked = null;
  for (const p of path) {
    const key = cellName(p.col, p.row);
    const o = objs[key];
    if (o && o.kind === 'road') continue; // уже дорога — бесплатно
    if (o) { blocked = o; break; }        // здание или вода — стоп перед ним
    if (price) {
      if (deficits(price).length) { outOf = true; break; } // щебень кончился
      for (const k in price) resources[k] -= price[k];
    }
    objs[key] = makeObj('road', p.col, p.row, { price: price ? Object.assign({}, price) : null });
    flashes.push({ col: p.col, row: p.row, t: 0.35 });
    built++;
  }
  if (!built) {
    failInput(blocked ? 'Здесь стоит здание'
      : outOf ? 'Щебень кончился — не хватило даже на первую клетку'
      : 'Нечего строить — дорога уже здесь');
    return false;
  }
  stats.ok++; stats.built++;
  let spent = '';
  if (price) {
    const parts = [];
    for (const k in price) {
      const need = price[k] * built;
      const f = FORMS[k] || [k, k, k];
      parts.push(ru(need, f[0], f[1], f[2]));
    }
    spent = ' · ' + parts.join(', ');
  }
  let tail = '';
  if (blocked) {
    tail = blocked.kind === 'water' || blocked.kind === 'sea' || blocked.kind === 'fished'
      ? ' · дальше вода — нужен мост'
      : ' · дошла до «' + String(KIND_LABEL[blocked.kind] || 'здания').toLowerCase() + '»';
  } else if (outOf) tail = ' · щебень кончился — дорога не достроена';
  log('🛤 Дорога: ' + ru(built, 'клетка', 'клетки', 'клеток') + spent + tail);
  sndPlant();
  selected2 = null;
  return true;
}
function deliverMail(addr) {
  const target = addr || (selected ? cellName(selected.col, selected.row) : null);
  if (!target) { failInput('Напечатай адрес: письмо ' + LVL.orders[orderIdx]); return false; }
  const need = LVL.orders[orderIdx];
  if (target !== need) {
    stats.typed--;
    log('Это ' + target + '. Письмо ждут на ' + need, 'warn');
    sndTick();
    return false;
  }
  stats.ok++;
  resources['письмо'] = (resources['письмо'] || 0) + 1;
  orderIdx++;
  const cell = addrCell(target);
  if (cell) flashes.push({ col: cell.col, row: cell.row, t: 0.6 });
  log('✉️ Письмо доставлено: ' + target);
  if (orderIdx < LVL.orders.length) log('Дальше: письмо на ' + LVL.orders[orderIdx], 'info');
  sndPlant();
  return true;
}
function runVerb(verb, st, o, arg) {
  const { col, row } = selected;
  if (verb.run === 'build') {
    objs[st.key] = makeObj(verb.kind, col, row, { stock: verb.stock || 0, max: verb.stock || 0, price: verb.price || null, emoji: verb.emoji || null });
    if (verb.kind === 'apple') objs[st.key].fruit = Math.floor(Math.random() * 3); // яблоки / груши / сливы
    stats.ok++; stats.built++;
    flashes.push({ col, row, t: 0.6 });
    log((verb.icon || '') + ' ' + putPhrase(verb.kind) + ': ' + st.key);
    sndPlant();
  } else if (verb.run === 'burn') {
    objs[st.key].burning = playT;
    objs[st.key].boom = !!verb.boom;
    stats.ok++;
    flashes.push({ col, row, t: 0.6 });
    if (verb.boom) {
      shake = 0.5; sndBoom();
      if (verb.gain) { addRes(verb.res, verb.gain); log('💥 Гора ' + st.key + ' взорвана! Осыпь: +' + verb.gain + ' ' + verb.res); }
      else log('💥 Гора ' + st.key + ' взорвана!');
    }
    else { sndBurn(); log('🔥 Лес ' + st.key + ' загорелся'); }
  } else if (verb.run === 'trade') {
    // мгновенная сделка: pay → gain (arg — количество, по умолчанию 1)
    const n = Math.max(1, Math.min(arg || 1, 9));
    const pay = {}, gain = {};
    for (const k in verb.price) pay[k] = verb.price[k] * n;
    for (const k in verb.gain) gain[k] = verb.gain[k] * n;
    const lack = deficits(pay);
    if (lack.length) { failInput('не хватает: ' + lack.join(', ')); return; }
    for (const k in pay) resources[k] -= pay[k];
    for (const k in gain) addRes(k, gain[k]);
    if (verb.sold) stats.sold[verb.sold] = (stats.sold[verb.sold] || 0) + n;
    stats.ok++;
    lastSubmit.ok = true;
    log(verb.icon + ' ' + verb.cmd + (n > 1 ? ' ×' + n : '') + ': +' + Object.keys(gain).map(k => gain[k] + ' ' + k).join(', '));
    sndPlant();
  } else if (verb.run === 'take') {
    // собрать кучу ресурса с клетки (микрокоманда «взять»)
    if (!o || !o.pileN) { failInput('Здесь нечего брать'); return; }
    addRes(o.pileRes, o.pileN);
    log('🧺 Взял ' + o.pileN + ' ' + o.pileRes + ' с ' + st.key);
    stats.ok++;
    delete o.pileN; delete o.pileRes;
    sndTick();
  } else if (verb.run === 'salute') {
    if (streak < 3) { failInput('Нужна серия из 3 команд без ошибок (сейчас ' + streak + ')'); return; }
    addRes(verb.res, 1);
    streak = 0;
    stats.ok++;
    for (let i = 0; i < 40; i++) particles.push({
      x: cellX(col) + CELL / 2, y: cellY(row) + CELL / 2,
      vx: (Math.random() - .5) * 400, vy: -Math.random() * 350,
      life: 1 + Math.random(), col: ['#ff5252', '#ffe066', '#69f0ae', '#40c4ff', '#e040fb'][i % 5], size: 6,
    });
    log('🎆 Салют! Ещё ' + (verb.res) + ': ' + (resources[verb.res] || 0));
    sndWin();
  } else if (verb.run === 'clear') {
    let note = verb.icon + ' Убрано: ' + st.key;
    if (o.kind === 'road' || o.kind === 'bridge') {
      const back = refundFull(o);
      if (o.kind === 'bridge') objs[st.key] = makeObj('water', col, row, { stock: 0, max: 0 });
      else delete objs[st.key];
      if (back.length) note += ' · возврат ' + back.join(', ');
    } else if (o.kind === 'stump') {
      delete objs[st.key];
      stats.stumpsCleared++;
      note = '🪵 Пень выкорчеван: ' + st.key;
    } else delete objs[st.key];
    stats.ok++;
    flashes.push({ col, row, t: 0.4 });
    log(note);
    sndTick();
  } else if (verb.run === 'refund') {
    const back = [];
    for (const k in (o.price || {})) {
      const n = Math.floor(o.price[k] / 2);
      resources[k] = (resources[k] || 0) + n;
      if (n) back.push(ru(n, (FORMS[k] || [k, k, k])[0], (FORMS[k] || [k, k, k])[1], (FORMS[k] || [k, k, k])[2]));
    }
    delete objs[st.key];
    stats.ok++;
    log('🏚 Снесено ' + st.key + (back.length ? ' · возврат ' + back.join(', ') : ''));
    sndTick();
  } else if (verb.run === 'work') {
    if (o && (o.kind === 'field' || o.kind === 'apple')) o.held = true;
    workers.push({ key: st.key, col, row, act: verb, phase: 'enter', t: 0, workT: 0, next: verb.time });
    stats.ok++;
    flashes.push({ col, row, t: 0.6 });
    log(verb.icon + ' ' + workerName(verb.worker) + ' идёт в ' + st.key);
    sndTick();
  }
}

function submit() {
  const raw = input.value;
  input.value = '';
  if (state === 'win') { nextLevel(); return; }
  if (state === 'city') { cityCmd(raw.trim()); return; }
  if (state === 'rain') { rainSubmit(raw.trim()); return; }
  if (!raw.trim()) return;
  stats.typed++;
  lastSubmit = { ok: false, msg: '' };
  roadFrom = null; // любая новая команда отменяет ожидание конечной точки
  const p = parseInput(LVL.caseSensitive ? raw.trim() : raw.trim().toLowerCase().replace(/\s+/g, ' '));
  telemLen = p.rest.length;
  // «б3» без команды — просто выбрать клетку печатью
  if (p.addr && !p.rest) {
    const cell = addrCell(p.addr);
    if (!cell) { failInput('Клетка «' + p.addr + '» за пределами поля (а–' + LETTERS[N - 1] + ', 1–' + N + ')'); return; }
    if (LVL.two) {
      if (!selected || (selected.col === cell.col && selected.row === cell.row)) selected = cell;
      else if (!selected2) selected2 = cell;
      else { selected = cell; selected2 = null; }
    }
    else { selected = cell; selected2 = null; }
    stats.typed--; // выбор клетки — не команда, в точности не участвует
    log('Ячейка ' + p.addr + ' выбрана', 'info');
    beep(500, 0.05, 'triangle', 0.07);
    lastSubmit.ok = true;
    return;
  }
  // адрес перед командой: «б3 лес»
  if (p.addr && p.rest) {
    const cell = addrCell(p.addr);
    if (!cell) { failInput('Клетка «' + p.addr + '» за пределами поля'); return; }
    if (LVL.two) selected2 = null;
    selected = cell;
  }
  const word = p.rest;
  // слово заказа (уровни со LVL.words / LVL.dictPool)
  if ((LVL.words || LVL.dictPool) && word === currentWord()) {
    if (runWordOrder(p.addr)) return;
  }
  if (!WORDS().includes(word)) {
    // может, это пузырь
    const bi = bubbles.findIndex(b => b.word === word);
    if (bi >= 0) { popBubble(bi); stats.typed--; stats.ok++; lastSubmit.ok = true; return; }
    if (LVL.words || LVL.dictPool) { failInput('Ждут слово «' + currentWord() + '» — напечатай его'); return; }
    failInput('Не знаю команду «' + word + '». Доступно: ' + WORDS().join(', '));
    return;
  }
  const verb = LVL.verbs.find(v => v.cmd === word);
  if (!selected && verb.run !== 'trade') { failInput('Сначала выбери ячейку: кликни или напечатай адрес, например «б3»'); return; }
  if (verb.run === 'road') {
    if (!selected) { failInput('Кликни клетку старта дороги'); return; }
    const from = { col: selected.col, row: selected.row };
    if (!selected2) {
      // новый flow: старт отмечен — ждём клик по конечной точке
      roadFrom = from;
      log('🧱 Точка старта дороги — ' + cellName(from.col, from.row) + '. Теперь кликни, где конец', 'info');
      lastSubmit.ok = true; streak++;
      telem('cmd', { ok: true, len: telemLen }); kbTarget = null;
      return;
    }
    if (buildRoad(from, selected2)) { streak++; lastSubmit.ok = true; telem('cmd', { ok: true, len: telemLen }); kbTarget = null; }
    return;
  }
  if (verb.run === 'mail') {
    if (deliverMail(p.addr || cellName(selected.col, selected.row))) { streak++; lastSubmit.ok = true; telem('cmd', { ok: true, len: telemLen }); kbTarget = null; }
    return;
  }
  if (verb.run === 'trade') {
    // торгуем только у лавки: без клетки или мимо лавки — подсказка
    const st = selected ? cellState(selected.col, selected.row) : null;
    const o = st ? objs[st.key] : null;
    if (!verb.match(o, st)) { failInput(whyNot(word, st, o)); return; }
    runVerb(verb, st || { key: 'лавка' }, o, p.num);
    if (lastSubmit.ok) { streak++; telem('cmd', { ok: true, len: telemLen }); }
    kbTarget = null;
    return;
  }
  const st = cellState(selected.col, selected.row);
  const o = objs[st.key];
  if (st.type === 'busy') { failInput('В ячейке ' + st.key + ' уже идёт работа'); return; }
  if (st.type === 'burning') { failInput('В ячейке ' + st.key + ' всё ещё горит — подожди'); return; }
  if (word === 'собрать' && o && o.kind === 'bed' && weedNear(o.col, o.row)) {
    failInput('Рядом сорняк — сначала полоть'); return;
  }
  if (!verb.match(o, st)) { failInput(whyNot(word, st, o)); return; }
  if (verb.price) {
    const lack = deficits(verb.price);
    if (lack.length) { failInput('не хватает: ' + lack.join(', ')); return; }
    for (const k in verb.price) resources[k] -= verb.price[k];
  }
  runVerb(verb, st, o, p.num);
  lastSubmit.ok = true;
  streak++;
  telem('cmd', { ok: true, len: telemLen });
  kbTarget = null;
}
// исполнить слово заказа
function runWordOrder(addr) {
  const need = currentWord();
  let st, o;
  if (addr) {
    const cell = addrCell(addr);
    if (!cell) { failInput('Клетка «' + addr + '» за пределами поля'); return false; }
    selected = cell;
  }
  if (!selected) { failInput('Сначала выбери ячейку'); return false; }
  st = cellState(selected.col, selected.row);
  o = objs[st.key];
  const wm = LVL.wordMode || {};
  if (wm.need === 'sea') {
    if (!o || o.kind !== 'sea' || o.stock <= 0) { failInput('Нужна клетка моря, где есть рыба'); return false; }
    o.stock--;
    addRes(wm.res, 1);
  } else if (wm.need === 'cage') {
    if (!o || o.kind !== 'cage' || o.full) { failInput('Посели животное в пустую клетку'); return false; }
    o.full = true; o.emoji = ANIMAL_EMOJI[need] || '🐾';
    addRes(wm.res, 1);
  } else if (wm.need === 'bench') {
    if (!o || o.kind !== 'bench') { failInput('Нужен верстак'); return false; }
    addRes(wm.res, 1);
  } else {
    if (o) { failInput('Нужна пустая клетка'); return false; }
    objs[st.key] = makeObj(wm.kind || 'post', selected.col, selected.row, { emoji: wm.emoji || '🌿' });
    addRes(wm.res, 1);
  }
  stats.ok++; streak++;
  flashes.push({ col: selected.col, row: selected.row, t: 0.6 });
  log('✨ «' + need + '» — принято!');
  wordIdx++;
  sndPlant();
  lastSubmit.ok = true;
  telem('cmd', { ok: true, len: need.length });
  if (LVL.words || LVL.dictPool) log('Дальше: ' + currentWord(), 'info');
  kbTarget = null;
  return true;
}
function popBubble(i) {
  const b = bubbles[i];
  bubbles.splice(i, 1);
  poppedBubbles++;
  poppedBubbles++;
  for (let j = 0; j < 14; j++) particles.push({
    x: b.x, y: b.y, vx: (Math.random() - .5) * 200, vy: -Math.random() * 200,
    life: 0.7, col: ['#80d8ff', '#b39ddb', '#ffe066'][j % 3], size: 5,
  });
  log('🫧 ' + b.word + ' — поймал!', 'ok');
  sndPlant();
  telem('bubble', { word: b.word });
}
const ANIMAL_EMOJI = { ёжик: '🦔', заяц: '🐇', лиса: '🦊', волк: '🐺', сова: '🦉', олень: '🦌', рысь: '🐈', тигр: '🐯', журавль: '🐦' };

// ---------- «Мой город» ----------
const CITY_COLS = 10, CITY_ROWS = 6;
let cityPets = [], cityBtn = null;
function cityUpdate(dt) {
  for (const p of cityPets) {
    p.t -= dt;
    if (p.t <= 0) {
      p.t = 1 + Math.random() * 2;
      p.tx = 60 + Math.random() * (PANEL_X - 140);
      p.ty = 140 + Math.random() * 420;
    }
    p.x += (p.tx - p.x) * dt * 0.7;
    p.y += (p.ty - p.y) * dt * 0.7;
  }
}
function citySyncPets() {
  const want = [];
  for (const key in SAVE.city) {
    const it = ITEMS.find(i => i.id === SAVE.city[key]);
    if (it && (it.id === 'cat' || it.id === 'dog' || it.id === 'hedgehog')) want.push(it);
  }
  cityPets = want.map(it => {
    const old = cityPets.find(p => p.id === it.id);
    return old || { id: it.id, icon: it.icon, x: 100 + Math.random() * 400, y: 200 + Math.random() * 200, tx: 200, ty: 300, t: 1 };
  });
}
function cityCmd(raw) {
  if (!raw) return;
  const p = parseInput(raw.toLowerCase());
  // «убрать г4»
  if (p.rest === 'убрать' && p.addr) {
    if (!SAVE.city[p.addr]) { log('На «' + p.addr + '» ничего не стоит', 'warn'); return; }
    delete SAVE.city[p.addr];
    persistSave(); citySyncPets();
    log('Убрано с ' + p.addr, 'ok');
    sndTick();
    return;
  }
  // «фонтан г4»
  const item = ITEM_BY_WORD[p.rest];
  if (item && p.addr) {
    if (!SAVE.owned.includes(item.id)) { log('Сначала купи «' + item.name + '» в магазине', 'warn'); return; }
    SAVE.city[p.addr] = item.id;
    persistSave(); citySyncPets();
    log(item.icon + ' ' + item.name + ' поставлен(а) на ' + p.addr, 'ok');
    sndPlant();
    return;
  }
  log('Формат: «фонтан г4» или «убрать г4» (а–' + LETTERS[CITY_COLS - 1] + ', 1–' + CITY_ROWS + ')', 'warn');
}
function drawCity() {
  const th = TH();
  ctx.fillStyle = th.menu; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = th.acc; ctx.font = 'bold 40px Segoe UI';
  ctx.fillText('МОЙ ГОРОД 🏙', W / 2, 52);
  ctx.fillStyle = '#b9e4bd'; ctx.font = '17px Segoe UI';
  const owned = SAVE.owned.map(id => (ITEMS.find(i => i.id === id) || {}).icon).join(' ');
  ctx.fillText('куплено: ' + (owned || 'пока ничего') + ' · ставь печатью: «фонтан г4», убирай: «убрать г4»', W / 2, 82);
  const cell = Math.min(56, Math.floor((PANEL_X - 60) / CITY_COLS));
  const ox = 40, oy = 120;
  ctx.font = '16px Segoe UI';
  for (let c = 0; c < CITY_COLS; c++) {
    ctx.fillStyle = '#c8e6c9'; ctx.textAlign = 'center';
    ctx.fillText(LETTERS[c], ox + c * cell + cell / 2, oy - 8);
  }
  for (let r = 0; r < CITY_ROWS; r++) {
    ctx.fillStyle = '#c8e6c9'; ctx.textAlign = 'right';
    ctx.fillText(r + 1, ox - 8, oy + r * cell + cell / 2);
  }
  for (let r = 0; r < CITY_ROWS; r++) for (let c = 0; c < CITY_COLS; c++) {
    ctx.fillStyle = (r + c) % 2 ? th.g2 : th.g1;
    ctx.fillRect(ox + c * cell, oy + r * cell, cell - 1, cell - 1);
    const key = LETTERS[c] + (r + 1);
    const id = SAVE.city[key];
    if (id) {
      const it = ITEMS.find(i => i.id === id);
      if (it) { ctx.font = Math.floor(cell * 0.6) + 'px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(it.icon, ox + c * cell + cell / 2, oy + r * cell + cell / 2); ctx.textBaseline = 'alphabetic'; }
    }
  }
  for (const p of cityPets) {
    ctx.font = '30px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(p.icon, p.x, p.y + Math.sin(now * 3 + p.x) * 3);
  }
  // река через город для уюта
  ctx.fillStyle = 'rgba(21,101,192,0.35)';
  ctx.fillRect(ox + 6 * cell, oy, cell - 1, CITY_ROWS * cell);
  cityBtn = { x: 40, y: 660, w: 180, h: 40 };
  ctx.fillStyle = '#245c3d'; rr(cityBtn.x, cityBtn.y, cityBtn.w, cityBtn.h, 10);
  ctx.strokeStyle = '#3d8a5f'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#eaffea'; ctx.font = 'bold 17px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText('⌂ в меню', cityBtn.x + cityBtn.w / 2, cityBtn.y + 26);
  ctx.textAlign = 'left';
  // панель справа: инвентарь
  const px = PANEL_X + 16;
  ctx.fillStyle = th.acc; ctx.font = 'bold 20px Segoe UI';
  ctx.fillText('ТВОИ ВЕЩИ:', px, 130);
  let y = 160;
  for (const id of SAVE.owned) {
    const it = ITEMS.find(i => i.id === id);
    if (!it || it.id.startsWith('th-') || it.id.startsWith('title')) continue;
    ctx.font = '24px Segoe UI';
    ctx.fillText(it.icon, px, y);
    ctx.fillStyle = '#eaffea'; ctx.font = '16px Segoe UI';
    ctx.fillText(it.name + ' — «' + it.name + ' б3»', px + 34, y - 4);
    y += 38;
  }
  if (y === 160) { ctx.fillStyle = '#9dbfa5'; ctx.font = '16px Segoe UI'; ctx.fillText('Купи вещи за звёзды в магазине!', px, 160); }
}

// ---------- магазин ----------
let shopCards = [], shopBackBtn = null;
function drawShop() {
  const th = TH();
  ctx.fillStyle = th.menu; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = th.acc; ctx.font = 'bold 40px Segoe UI';
  ctx.fillText('МАГАЗИН 🛒', W / 2, 52);
  ctx.fillStyle = '#ffe066'; ctx.font = 'bold 22px Segoe UI';
  ctx.fillText('⭐ ' + starsBalance() + ' звёзд доступно', W / 2, 86);
  shopBackBtn = { x: 40, y: 660, w: 180, h: 40 };
  ctx.fillStyle = '#245c3d'; rr(shopBackBtn.x, shopBackBtn.y, shopBackBtn.w, shopBackBtn.h, 10);
  ctx.strokeStyle = '#3d8a5f'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#eaffea'; ctx.font = 'bold 17px Segoe UI';
  ctx.fillText('⌂ в меню', shopBackBtn.x + shopBackBtn.w / 2, shopBackBtn.y + 26);
  const cw = 380, ch = 74, gap = 16;
  shopCards = [];
  ITEMS.forEach((it, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 40 + col * (cw + gap), y = 116 + row * (ch + gap);
    shopCards.push({ x, y, w: cw, h: ch, item: it });
    const owned = SAVE.owned.includes(it.id);
    const afford = starsBalance() >= it.price;
    ctx.fillStyle = owned ? '#1f4a33' : afford ? '#245c3d' : '#1a3527';
    rr(x, y, cw, ch, 12);
    ctx.strokeStyle = owned ? '#7ee787' : afford ? '#3d8a5f' : '#2a4a38'; ctx.lineWidth = 2; ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = '30px Segoe UI'; ctx.fillText(it.icon, x + 14, y + 48);
    ctx.fillStyle = '#eaffea'; ctx.font = 'bold 17px Segoe UI';
    ctx.fillText(it.name, x + 62, y + 30);
    ctx.fillStyle = owned ? '#7ee787' : afford ? '#ffe066' : '#9dbfa5'; ctx.font = '15px Segoe UI';
    ctx.fillText(owned ? '✓ куплено' : '⭐ ' + it.price, x + 62, y + 54);
  });
}
function shopClick(p) {
  if (shopBackBtn && p.x >= shopBackBtn.x && p.x <= shopBackBtn.x + shopBackBtn.w && p.y >= shopBackBtn.y && p.y <= shopBackBtn.y + shopBackBtn.h) { state = 'menu'; beep(400, 0.08, 'triangle'); return true; }
  for (const c of shopCards) {
    if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) {
      const it = c.item;
      if (SAVE.owned.includes(it.id)) { log('Уже куплено', 'warn'); return true; }
      if (starsBalance() < it.price) { log('Не хватает звёзд: нужно ⭐' + it.price + ', есть ⭐' + starsBalance(), 'warn'); sndErr(); return true; }
      SAVE.owned.push(it.id);
      SAVE.spent += it.price;
      persistSave();
      sndWin();
      log(it.icon + ' «' + it.name + '» куплено! Поставь в «Мой город»', 'ok');
      return true;
    }
  }
  return false;
}

// ---------- экран родителей ----------
let parBtns = {};
function drawParents() {
  const th = TH();
  ctx.fillStyle = th.menu; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'left';
  ctx.fillStyle = th.acc; ctx.font = 'bold 34px Segoe UI';
  ctx.fillText('РОДИТЕЛЯМ 📊', 40, 54);
  ctx.fillStyle = '#b9e4bd'; ctx.font = '16px Segoe UI';
  ctx.fillText('прогресс печати ребёнка · данные только в этом браузере', 40, 84);

  // тепловая карта ошибок по клавишам
  ctx.fillStyle = th.acc; ctx.font = 'bold 19px Segoe UI';
  ctx.fillText('Клавиши с ошибками:', 40, 128);
  const KS = 44, GAP = 5;
  const maxErr = Math.max(1, ...Object.values(SAVE.keys));
  KEY_ROWS.slice(1).forEach((row, ri) => {
    const off = ri * (KS / 2);
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      const n = SAVE.keys[ch] || 0;
      const heat = n / maxErr;
      ctx.fillStyle = n === 0 ? '#1f4a33' : 'rgb(' + Math.round(40 + 200 * heat) + ',' + Math.round(120 - 70 * heat) + ',60)';
      const x = 40 + off + i * (KS + GAP), y = 140 + ri * (KS + GAP);
      if (ctx.roundRect) ctx.roundRect(x, y, KS, KS, 8); else ctx.rect(x, y, KS, KS);
      ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 18px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText(ch, x + KS / 2, y + KS / 2 + 6);
    }
  });
  ctx.textAlign = 'left';

  // история точности
  const px = 620;
  ctx.fillStyle = th.acc; ctx.font = 'bold 19px Segoe UI';
  ctx.fillText('Точность по уровням:', px, 128);
  const hist = SAVE.history.slice(-14);
  ctx.fillStyle = '#0e2418'; rr(px, 138, 560, 180, 10);
  hist.forEach((h, i) => {
    const bw = 560 / 14 - 4;
    const bh = Math.max(2, (h.acc / 100) * 160);
    ctx.fillStyle = h.acc >= 95 ? '#7ee787' : h.acc >= 85 ? '#ffe066' : '#ff8a80';
    ctx.fillRect(px + 8 + i * (bw + 4), 310 - bh, bw, bh);
  });
  ctx.fillStyle = '#9dbfa5'; ctx.font = '14px Segoe UI';
  ctx.fillText('зелёный ≥95% · жёлтый ≥85% · красный ниже', px + 8, 328);
  ctx.fillStyle = '#eaffea'; ctx.font = '17px Segoe UI';
  const avg = hist.length ? Math.round(hist.reduce((s, h) => s + h.acc, 0) / hist.length) : 0;
  ctx.fillText('Средняя точность: ' + avg + '%', px, 362);
  ctx.fillText('Уровней пройдено: ' + Object.keys(SAVE.done).length + ' из ' + LEVELS.length, px, 390);
  ctx.fillText('Звёзд собрано: ' + starsEarned() + ' (потрачено ' + (SAVE.spent || 0) + ')', px, 418);
  ctx.fillText('Символов напечатано: ' + (SAVE.chars + TELEM.chars), px, 446);
  const avgStars = starsEarned() / Math.max(1, Object.keys(SAVE.stars).length);
  ctx.fillText('Средние звёзды за уровень: ' + avgStars.toFixed(1), px, 474);

  // кнопки
  parBtns = {};
  const mk = (id, label, x, y) => {
    parBtns[id] = { x, y, w: 210, h: 40 };
    ctx.fillStyle = '#245c3d'; rr(x, y, 210, 40, 10);
    ctx.strokeStyle = '#3d8a5f'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#eaffea'; ctx.font = 'bold 16px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(label, x + 105, y + 26);
    ctx.textAlign = 'left';
  };
  mk('back', '⌂ в меню', 40, 660);
  mk('export', '💾 экспорт JSON', 40, 610);
}
function exportSave() {
  try {
    const blob = new Blob([JSON.stringify({ save: SAVE, telem: TELEM.events }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'typing_city_progress.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { log('Экспорт не удался: ' + e.message, 'warn'); }
}

// ---------- настройки ----------
let setBtns = {}, setConfirm = false;
function drawSettings() {
  const th = TH();
  ctx.fillStyle = th.menu; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = th.acc; ctx.font = 'bold 40px Segoe UI';
  ctx.fillText('НАСТРОЙКИ ⚙', W / 2, 60);
  ctx.textAlign = 'left';
  setBtns = {};
  // все строки центрируем по W/2 = 640 (было 520 — смещено влево)
  const mk = (id, label, value, y, hint) => {
    setBtns[id] = { x: W / 2 - 180, y, w: 360, h: 48 };
    ctx.fillStyle = '#245c3d'; rr(W / 2 - 180, y, 360, 48, 10);
    ctx.strokeStyle = '#3d8a5f'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#eaffea'; ctx.font = 'bold 19px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(label + ': ' + value, W / 2, y + 30);
    if (hint) { ctx.fillStyle = '#9dbfa5'; ctx.font = '14px Segoe UI'; ctx.fillText(hint, W / 2, y + 66); }
    ctx.textAlign = 'left';
  };
  mk('mute', '🔊 звук', SAVE.settings.mute ? 'выкл' : 'вкл', 130);
  mk('kb', '⌨ подсказка-клавиатура', SAVE.settings.kb, 210, 'яркая · тусклая · скрытая');
  const themesOwned = ['classic'].concat(SAVE.owned.filter(id => id.startsWith('th-')).map(id => id.slice(3)));
  mk('theme', '🎨 тема', (THEMES[SAVE.settings.theme] || THEMES.classic).name, 290, 'куплено: ' + themesOwned.map(t => THEMES[t].name).join(', '));
  mk('dev', '🛠 все уровни открыты', SAVE.settings.dev ? 'ДА (тест)' : 'нет', 370, 'для проверки любого уровня; прогресс не сбрасывается');
  setBtns['reset'] = { x: W / 2 - 180, y: 455, w: 360, h: 48 };
  ctx.fillStyle = setConfirm ? '#8b2f2f' : '#245c3d'; rr(W / 2 - 180, 455, 360, 48, 10);
  ctx.strokeStyle = '#3d8a5f'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#eaffea'; ctx.font = 'bold 19px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText(setConfirm ? ' ТОЧНО стереть всё? нажми ещё раз' : '🗑 сбросить весь прогресс', W / 2, 485);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#9dbfa5'; ctx.font = '15px Segoe UI';
  ctx.fillText('Esc или кнопка ниже — назад в меню', W / 2, 640);
  setBtns['back'] = { x: 490, y: 660, w: 300, h: 40 };
  ctx.fillStyle = '#245c3d'; rr(490, 660, 300, 40, 10);
  ctx.fillStyle = '#eaffea'; ctx.font = 'bold 17px Segoe UI';
  ctx.fillText('⌂ в меню', 640, 686);
  ctx.textAlign = 'left';
}
function nextLevel() {
  state = 'menu'; mapCenterOn(mapFrontier()); // карта: видно, что открылось дальше
}
function failInput(msg) {
  lastSubmit = { ok: false, msg: msg };
  stats.err++;
  streak = 0;
  telem('cmd', { ok: false, len: telemLen, msg: msg });
  log('⚠️ ' + msg, 'err');
  input.classList.remove('err'); void input.offsetWidth; input.classList.add('err');
  sndErr();
}

// ---------- обновление ----------
function spawnWeed() {
  const spots = [];
  for (const k in objs) {
    const b = objs[k];
    if (b.kind !== 'bed') continue;
    for (const n of neighbors(b.col, b.row)) {
      if (!objs[cellName(n.col, n.row)]) spots.push({ host: b, col: n.col, row: n.row });
    }
  }
  if (!spots.length) return;
  const s = spots[Math.floor(Math.random() * spots.length)];
  objs[cellName(s.col, s.row)] = makeObj('weed', s.col, s.row, {});
  log('🌿 Сорняк у грядки ' + cellName(s.host.col, s.host.row), 'warn');
}
function update(dt) {
  playT += dt;
  // сады: фрукты портятся со временем; совсем испорченные — дерево вянет
  for (const k in objs) {
    const o = objs[k];
    if (o.kind !== 'apple') continue;
    clampGardenStock(o);
    if (gardenStage(o) === 'gone' && !o.held) {
      delete objs[k];
      log('🍂 Сад ' + k + ' вянет — фрукты испортились, посади новый', 'warn');
    }
  }
  for (const k in objs) {
    const o = objs[k];
    if (!o.burning) continue;
    const cx = cellX(o.col) + CELL / 2, cy = cellY(o.row) + CELL * 0.4;
    const dur = o.boom ? BOOM_TIME : BURN_TIME;
    if (o.boom) {
      if (Math.random() < 0.8) particles.push({
        x: cx + (Math.random() - .5) * CELL, y: cy + (Math.random() - .5) * CELL,
        vx: (Math.random() - .5) * 300 * SF, vy: -Math.random() * 250 * SF,
        life: 0.5 + Math.random() * 0.4,
        col: ['#ff9800', '#ffeb3b', '#b0bec5'][Math.floor(Math.random() * 3)], size: Math.min(12, 4 * SF),
      });
    } else if (Math.random() < 0.5) particles.push({
      x: cx + (Math.random() - .5) * CELL * 0.5, y: cy,
      vx: (Math.random() - .5) * 30, vy: -60 - Math.random() * 80,
      life: 0.4 + Math.random() * 0.3,
      col: Math.random() < 0.5 ? '#ff9800' : '#ffeb3b', size: Math.min(10, 4 * SF),
    });
    if (playT - o.burning >= dur) {
      delete objs[k];
      const cols = o.boom ? ['#8d6e63', '#90a4ae', '#ff9800'] : ['#9e9e9e'];
      for (let i = 0; i < 12; i++) particles.push({ x: cx, y: cy, vx: (Math.random() - .5) * 150 * SF, vy: -40 - Math.random() * 120 * SF, life: 0.9, col: cols[i % cols.length], size: Math.min(10, 3.5 * SF) });
      log(o.boom ? '💨 Гора ' + k + ' разлетелась — ничего не получено' : '💨 Лес ' + k + ' сгорел — ничего не получено', 'warn');
    }
  }

  for (const w of workers) {
    w.t += dt;
    if (w.phase === 'enter' && w.t >= 0.6) { w.phase = 'work'; w.t = 0; }
    else if (w.phase === 'work') {
      w.workT += dt;
      if (w.workT >= w.next) {
        w.next += w.act.time;
        const o = objs[w.key];
        const cx = cellX(w.col) + CELL / 2, cy = cellY(w.row) + CELL / 2;
        if (w.act.pay) {
          const problem = payProblem(w.act.pay);
          if (!o || problem) {
            w.phase = 'shrug'; w.t = 0;
            log(problem || 'Печь пропала', 'warn');
            sndErr();
            continue;
          }
          for (const key in w.act.pay) resources[key] -= w.act.pay[key];
          addRes(w.act.res, w.act.gain);
          playAct(w.act.worker);
          floats.push({ x: cx, y: cy - CELL * 0.4, text: '+' + w.act.gain + ' ' + (SINGULAR[w.act.res] || w.act.res), life: 0.9, col: '#ffe066' });
          if (w.act.once) { w.phase = 'leave'; w.t = 0; }
          continue;
        }
        if (!o || o.burning) { w.phase = 'leave'; w.t = 0; continue; }
        o.stock -= w.act.cost;
        if (LVL.pile) {
          // ресурсы падают на клетку кучей — забираем микрокомандой «взять»
          o.pileRes = w.act.res;
          o.pileN = (o.pileN || 0) + w.act.gain;
        } else {
          addRes(w.act.res, w.act.gain);
        }
        playAct(w.act.worker);
        floats.push({ x: cx, y: cy - CELL * 0.4, text: '+' + w.act.gain + ' ' + (SINGULAR[w.act.res] || w.act.res), life: 0.9, col: w.act.worker === 'saw' ? '#80d8ff' : '#ffe066' });
        const chipCol = { axe: '#a1703f', saw: '#d7ccc8', pick: '#b0bec5', hammer: '#90a4ae', sickle: '#c0ca33', scythe: '#a5d6a7', rod: '#81d4fa', basket: '#ffcc80' }[w.act.worker] || '#d7ccc8';
        for (let i = 0; i < 4; i++) particles.push({ x: cx, y: cy, vx: (Math.random() - .5) * 120 * SF, vy: -Math.random() * 120 * SF, life: 0.5, col: chipCol, size: Math.min(10, 3 * SF) });
        if (o.stock <= 0) {
          const goal = LVL.goal.find(g => g.res === w.act.res);
          const have = resources[w.act.res] + '/' + (goal ? goal.n : '?');
          if (o.kind === 'tree') {
            o.kind = 'stump'; o.stock = 0; o.max = 0; o.held = false;
            stats.stumpsMade++;
            log('🪵 Пень остался: ' + w.key + ' — корчевать');
          } else if (o.kind === 'apple') {
            delete objs[w.key];
            log('🧺 Сад ' + w.key + ' собран до последнего фрукта');
          } else if (o.kind === 'sea') {
            o.stock = 0; o.max = 0;
            log('✅ Море ' + w.key + ' выловлено: ' + w.act.res + ' ' + have);
          } else if (o.kind === 'water') {
            o.kind = 'fished'; o.stock = 0; o.max = 0;
            log('✅ Клетка ' + w.key + ' выловлена: ' + w.act.res + ' ' + have);
          } else {
            const title = { mountain: 'Гора', field: 'Грядка', bed: 'Грядка' }[o.kind] || 'Объект';
            delete objs[w.key];
            log('✅ ' + title + ' ' + w.key + ' выработано: ' + w.act.res + ' ' + have);
          }
          w.phase = 'leave'; w.t = 0;
        }
      }
    } else if (w.phase === 'shrug' && w.t >= 1.6) { w.phase = 'leave'; w.t = 0; }
  }
  workers = workers.filter(w => !(w.phase === 'leave' && w.t >= 0.5));

  if (LVL.weedEvery) {
    weedAcc += dt;
    while (weedAcc >= LVL.weedEvery) { weedAcc -= LVL.weedEvery; spawnWeed(); }
  }

  // бонус-пузыри: короткое слово всплывает, можно поймать печатью
  bubAcc += dt;
  if (bubAcc >= 7) { bubAcc = 0; spawnBubble(); }
  for (const b of bubbles) { b.life -= dt; b.y -= 12 * dt; }
  bubbles = bubbles.filter(b => b.life > 0);

  for (const q of particles) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 500 * dt; }
  particles = particles.filter(q => q.life > 0);
  for (const f of floats) { f.life -= dt; f.y -= 30 * dt; }
  floats = floats.filter(f => f.life > 0);
  for (const fl of flashes) fl.t -= dt;
  flashes = flashes.filter(fl => fl.t > 0);
  shake = Math.max(0, shake - dt);

  if (state === 'play') {
    const resourcesDone = LVL.goal.every(g => goalVal(g) >= g.n);
    if (resourcesDone && LVL.noStumps && countKind('stump') > 0) {
      if (!stumpTold) { log('Запас собран, но остались пни — корчевать', 'warn'); stumpTold = true; }
    } else if (goalMet()) {
      winLevel();
    }
  }
}

// ---------- режим «дождь слов» ----------
let rainWords = [], rainScore = 0, rainSpawnAcc = 0, rainSeq = 0;
function rainReset() {
  state = 'rain'; rainWords = []; rainScore = 0; rainSpawnAcc = 0; rainSeq = 0;
  log('Печатай падающие слова — они не исчезнут, спеши спокойно', 'info');
}
function rainSpawn() {
  const pool = LVL.words || BUBBLE_WORDS;
  const word = pool[rainSeq % pool.length]; rainSeq++;
  rainWords.push({
    word, x: 120 + Math.random() * (PANEL_X - 240), y: -30,
    vy: 26 + Math.random() * 14, life: 40,
  });
}
function rainUpdate(dt) {
  playT += dt;
  rainSpawnAcc += dt;
  if (rainSpawnAcc >= 2.2 && rainWords.length < 4) { rainSpawnAcc = 0; rainSpawn(); }
  for (const w of rainWords) w.y += w.vy * dt;
  rainWords = rainWords.filter(w => w.y < 640);
  for (const q of particles) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 500 * dt; }
  particles = particles.filter(q => q.life > 0);
  if (LVL.goal[0] && rainScore >= LVL.goal[0].n) winLevel();
}
function rainSubmit(word) {
  if (!word) return;
  stats.typed++;
  lastSubmit = { ok: false, msg: '' };
  telemLen = word.length;
  let best = -1;
  for (let i = 0; i < rainWords.length; i++) if (rainWords[i].word === word && (best < 0 || rainWords[i].y > rainWords[best].y)) best = i;
  if (best < 0) { failInput('Такого слова сейчас нет на экране'); return; }
  const w = rainWords.splice(best, 1)[0];
  rainScore++; stats.ok++; streak++;
  lastSubmit.ok = true;
  TELEM.chars += word.length;
  for (let j = 0; j < 16; j++) particles.push({
    x: w.x + w.word.length * 9, y: w.y, vx: (Math.random() - .5) * 250, vy: -Math.random() * 220,
    life: 0.8, col: ['#69f0ae', '#ffe066', '#40c4ff', '#e040fb'][j % 4], size: 5,
  });
  log('🌧 ' + word + ' — поймал! (' + rainScore + '/' + LVL.goal[0].n + ')');
  sndPlant();
  telem('cmd', { ok: true, len: word.length });
}
function drawRain() {
  const th = TH();
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, W, H);
  if (SAVE.settings.theme === 'night') for (let i = 0; i < 40; i++) {
    ctx.fillStyle = 'rgba(255,255,255,' + (0.2 + 0.6 * Math.abs(Math.sin(now + i))) + ')';
    ctx.fillRect((i * 97) % W, (i * 61) % 400, 2, 2);
  }
  ctx.fillStyle = th.acc; ctx.font = 'bold 30px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText('ДОЖДЬ СЛОВ', W / 2, 60);
  ctx.fillStyle = '#eaffea'; ctx.font = '20px Segoe UI';
  ctx.fillText('печатай слово целиком и жми Enter · поймано ' + rainScore + ' из ' + LVL.goal[0].n, W / 2, 92);
  for (const w of rainWords) {
    ctx.font = 'bold 28px Segoe UI';
    const tw = ctx.measureText(w.word).width;
    ctx.fillStyle = 'rgba(6,20,12,0.75)';
    ctx.strokeStyle = '#3d8a5f'; ctx.lineWidth = 2;
    if (ctx.roundRect) ctx.roundRect(w.x - tw / 2 - 12, w.y - 26, tw + 24, 40, 12); else ctx.rect(w.x - tw / 2 - 12, w.y - 26, tw + 24, 40);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = input.value && w.word.startsWith(input.value.toLowerCase()) ? '#7ee787' : '#eaffea';
    ctx.fillText(w.word, w.x, w.y);
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9dbfa5'; ctx.font = '15px Segoe UI';
  ctx.fillText('Слово в строке: ' + input.value, PANEL_X + 16, 700);
  for (const q of particles) {
    ctx.globalAlpha = Math.min(1, q.life * 2);
    ctx.fillStyle = q.col; ctx.fillRect(q.x, q.y, q.size, q.size);
  }
  ctx.globalAlpha = 1;
}

// ---------- отрисовка ----------
function rr(x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  ctx.fill();
}
function stockBar(frac) {
  ctx.fillStyle = '#37474f'; ctx.fillRect(-8, 1, 16, 3);
  ctx.fillStyle = frac > 0.3 ? '#8bc34a' : '#ffb300';
  ctx.fillRect(-8, 1, Math.max(0, 16 * Math.max(0, Math.min(1, frac))), 3);
}
function drawAddr(cell, fill) {
  const label = cellName(cell.col, cell.row);
  const bf = Math.min(24, Math.max(14, CELL * 0.45));
  ctx.font = 'bold ' + bf + 'px Segoe UI'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const tw = ctx.measureText(label).width + 14;
  const mx = Math.min(W - tw - 10, cellX(cell.col) + CELL + 6);
  const my = cellY(cell.row) - bf - 10 < GRID_OY + 4 ? cellY(cell.row) + CELL + 4 : cellY(cell.row) - bf - 10;
  ctx.fillStyle = fill; rr(mx, my, tw, bf + 8, 5);
  ctx.fillStyle = '#17382a'; ctx.fillText(label, mx + 7, my + bf + 1);
}
function drawGrid() {
  const markCol = c => (hover && hover.col === c) || (selected && selected.col === c) || (selected2 && selected2.col === c);
  const markRow = r => (hover && hover.row === r) || (selected && selected.row === r) || (selected2 && selected2.row === r);
  ctx.font = labelFont + 'px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let c = 0; c < N; c++) {
    ctx.fillStyle = markCol(c) ? '#ffe066' : '#c8e6c9';
    ctx.fillText(LETTERS[c], cellX(c) + CELL / 2, GRID_OY - Math.round(labelFont * 0.7));
  }
  ctx.textAlign = 'right';
  for (let r = 0; r < N; r++) {
    ctx.fillStyle = markRow(r) ? '#ffe066' : '#c8e6c9';
    ctx.fillText(r + 1, GRID_OX - 6, cellY(r) + CELL / 2);
  }
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const o = objs[cellName(c, r)];
    const th = TH();
    let fill = (r + c) % 2 ? th.g2 : th.g1;
    if (o && o.kind === 'sea') fill = (r + c) % 2 ? '#0a3d6b' : '#0d47a1';
    if (o && (o.kind === 'water' || o.kind === 'bridge')) fill = (r + c) % 2 ? '#1565c0' : '#1976d2';
    if (o && o.kind === 'fished') fill = '#0d47a1';
    if (o && o.kind === 'road') fill = (r + c) % 2 ? '#8d6e63' : '#a1887f';
    ctx.fillStyle = fill;
    ctx.fillRect(cellX(c), cellY(r), CELL - 1, CELL - 1);
  }
  if (selected) {
    const pulse = 0.6 + 0.4 * Math.sin(now * 5);
    ctx.strokeStyle = 'rgba(255,255,255,' + pulse + ')';
    ctx.lineWidth = Math.max(3, SF * 3);
    ctx.strokeRect(cellX(selected.col) + 2, cellY(selected.row) + 2, CELL - 5, CELL - 5);
    ctx.strokeStyle = '#ffe066'; ctx.lineWidth = Math.max(2, SF * 2);
    ctx.strokeRect(cellX(selected.col) + 2, cellY(selected.row) + 2, CELL - 5, CELL - 5);
    drawAddr(selected, '#ffe066');
  }
  if (selected2 && (!selected || selected2.col !== selected.col || selected2.row !== selected.row)) {
    ctx.strokeStyle = '#80d8ff'; ctx.lineWidth = Math.max(2, SF * 2);
    ctx.strokeRect(cellX(selected2.col) + 2, cellY(selected2.row) + 2, CELL - 5, CELL - 5);
    drawAddr(selected2, '#80d8ff');
  }
  if (hover && (!selected || hover.col !== selected.col || hover.row !== selected.row) && (!selected2 || hover.col !== selected2.col || hover.row !== selected2.row)) {
    ctx.strokeStyle = 'rgba(255,224,102,0.6)'; ctx.lineWidth = Math.max(2, SF * 2);
    ctx.strokeRect(cellX(hover.col) + 1, cellY(hover.row) + 1, CELL - 3, CELL - 3);
  }
  for (const fl of flashes) {
    ctx.fillStyle = 'rgba(255,255,255,' + (fl.t * 0.5) + ')';
    ctx.fillRect(cellX(fl.col), cellY(fl.row), CELL - 1, CELL - 1);
  }
}

function drawPileBadge(o) {
  ctx.fillStyle = '#ffe066'; ctx.font = 'bold ' + Math.max(10, Math.floor(CELL * 0.22)) + 'px Segoe UI';
  ctx.textAlign = 'center';
  ctx.fillText('🧺' + o.pileN, cellX(o.col) + CELL / 2, cellY(o.row) + CELL - 6);
}

function drawObject(o) {
  if (o.emoji) {
    ctx.font = Math.floor(CELL * 0.62) + 'px Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(o.emoji, cellX(o.col) + CELL / 2, cellY(o.row) + CELL / 2);
    ctx.textBaseline = 'alphabetic';
    if (o.max) { // полоска запаса (сады не тут: у них фрукты, клетки и т.п.)
      const frac = Math.max(0, Math.min(1, o.stock / o.max));
      const bw = CELL * 0.6;
      ctx.fillStyle = '#37474f'; ctx.fillRect(cellX(o.col) + CELL * 0.2, cellY(o.row) + CELL - 8, bw, 4);
      ctx.fillStyle = frac > 0.3 ? '#8bc34a' : '#ffb300';
      ctx.fillRect(cellX(o.col) + CELL * 0.2, cellY(o.row) + CELL - 8, bw * frac, 4);
    }
    if (o.pileN) drawPileBadge(o);
    return;
  }
  if (o.pileN) drawPileBadge(o);
  if (o.kind === 'road') {
    ctx.fillStyle = '#efebe9';
    ctx.fillRect(cellX(o.col) + CELL * 0.42, cellY(o.row) + CELL * 0.42, CELL * 0.16, CELL * 0.16);
    return;
  }
  const cx = cellX(o.col) + CELL / 2, cy = cellY(o.row) + CELL - 2;
  const grow = Math.min(1, (now - o.born) / 0.5);
  const frac = o.max ? o.stock / o.max : 0;
  const dur = o.boom ? BOOM_TIME : BURN_TIME;
  const burn = o.burning ? Math.min(1, (playT - o.burning) / dur) : 0;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(SF, SF);
  if (o.kind === 'stump') {
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(-3, -5, 6, 5);
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(-5, -6, 10, 2);
  } else if (o.kind === 'tree') {
    const R = 8 * grow * (1 - burn * 0.5);
    ctx.fillStyle = burn ? '#4e342e' : '#6d4c41';
    ctx.fillRect(-2, -8 * grow * (1 - burn), 4, 8 * grow * (1 - burn));
    ctx.fillStyle = burn ? 'hsl(20, 50%, ' + (30 - burn * 15) + '%)' : 'hsl(122, 40%, ' + (28 + 18 * frac) + '%)';
    ctx.beginPath(); ctx.arc(0, -10 * grow, R * (0.55 + 0.45 * frac), 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(-4 * grow, -6 * grow, R * 0.5 * (0.5 + 0.5 * frac), 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(4 * grow, -6 * grow, R * 0.5 * (0.5 + 0.5 * frac), 0, 7); ctx.fill();
    stockBar(frac);
  } else if (o.kind === 'mountain') {
    const s = grow * (1 - burn * 0.3);
    ctx.fillStyle = burn > 0 ? '#5d4037' : '#78909c';
    ctx.beginPath(); ctx.moveTo(-9 * s, 0); ctx.lineTo(-1 * s, -16 * s); ctx.lineTo(7 * s, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = burn > 0 ? '#4e342e' : '#90a4ae';
    ctx.beginPath(); ctx.moveTo(1 * s, 0); ctx.lineTo(7 * s, -11 * s); ctx.lineTo(12 * s, 0); ctx.closePath(); ctx.fill();
    if (!burn) {
      ctx.fillStyle = '#eceff1';
      ctx.beginPath(); ctx.moveTo(-3.4 * s, -11.6 * s); ctx.lineTo(-1 * s, -16 * s); ctx.lineTo(1.4 * s, -11.6 * s); ctx.lineTo(0.4 * s, -12.6 * s); ctx.closePath(); ctx.fill();
    }
    if (frac < 0.66) { ctx.strokeStyle = '#546e7a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-3 * s, -4 * s); ctx.lineTo(-1 * s, -7 * s); ctx.stroke(); }
    if (frac < 0.33) { ctx.beginPath(); ctx.moveTo(3 * s, -2 * s); ctx.lineTo(4.5 * s, -5 * s); ctx.stroke(); }
    stockBar(frac);
  } else if (o.kind === 'apple') {
    // сад: дерево + фрукты. Зрелые фрукты ПОРТЯТСЯ один за другим:
    // следующий на порчу коричневеет и дрожит, испорченные опадают под дерево
    const stage = gardenStage(o);
    const gr = stage === 'grow' ? Math.min(1, (playT - o.t0) / GARDEN_GROW_T) : 1;
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(-2, -9 * gr * grow, 3.5, 9 * gr * grow);
    ctx.fillStyle = 'hsl(122, 42%, 30%)';
    ctx.beginPath(); ctx.arc(0, -11 * gr, 7.5 * gr, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(-4.5 * gr, -7 * gr, 4.5 * gr, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(4.5 * gr, -7 * gr, 4.5 * gr, 0, 7); ctx.fill();
    if (stage === 'ripe') {
      const FRUIT_COL = ['#e53935', '#d4e157', '#8e24aa']; // яблоки / груши / сливы
      const fc = FRUIT_COL[o.fruit || 0];
      const ripeAge = (playT - o.t0) - GARDEN_GROW_T;
      const spoiling = gardenYieldFrac(o) < 1;
      const POS = [[-5, -8], [5, -8], [-7, -11], [7, -11], [-3, -14], [3, -14], [0, -16], [0, -11]];
      for (let i = 0; i < (o.max || 8); i++) {
        const fx = POS[i % POS.length][0], fy = POS[i % POS.length][1];
        if (i < o.stock) {
          const sc = Math.min(1, Math.max(0, (ripeAge - i * 0.35) / 0.35)); // зреют по очереди
          if (sc <= 0) continue;
          const rot = spoiling && i === o.stock - 1; // этот портится прямо сейчас
          ctx.fillStyle = rot ? '#8d6e63' : fc;
          const bob = rot ? Math.sin(now * 6 + i) * 0.3 : 0;
          ctx.beginPath(); ctx.arc(fx, fy + bob, 1.9 * sc, 0, 7); ctx.fill();
        } else {
          const fi = i - o.stock; // испорченные опали под дерево
          if (fi < 4) {
            ctx.fillStyle = 'rgba(93,64,55,0.85)';
            ctx.beginPath(); ctx.arc(-7 + fi * 4.6, -0.8, 1.4, 0, 7); ctx.fill();
          }
        }
      }
    }
  } else if (o.kind === 'field') {
    const stage = fieldStage(o);
    ctx.fillStyle = '#5d4037'; ctx.fillRect(-8, -4, 16, 5);
    let h = 4, col = '#7cb342';
    if (stage === 'grow') h = 3 + 8 * Math.min(1, (playT - o.t0) / FIELD_GROW_T);
    else { h = 12; col = '#fdd835'; }
    ctx.fillStyle = col;
    for (let i = -1; i <= 1; i++) ctx.fillRect(i * 5 - 1, -4 - h, 2, h);
    // таймер грядки: пока растёт — наполняется зелёным; спелая — полная, спешить некуда
    const f = stage === 'grow' ? Math.min(1, (playT - o.t0) / FIELD_GROW_T) : 1;
    ctx.fillStyle = '#0e2418'; ctx.fillRect(-9, 1, 18, 3);
    ctx.fillStyle = stage === 'grow' ? '#7ee787' : '#8bc34a';
    ctx.fillRect(-9, 1, Math.max(0.6, 18 * f), 3);
  } else if (o.kind === 'bed') {
    ctx.fillStyle = '#6d4c41'; ctx.fillRect(-8, -3, 16, 4);
    ctx.fillStyle = '#43a047';
    for (let i = 0; i < 3; i++) ctx.fillRect(-7, -6 - i * 3, 14, 2);
    if (o.max) stockBar(frac);
  } else if (o.kind === 'weed') {
    ctx.strokeStyle = '#7cb342'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-4, -10); ctx.moveTo(0, 0); ctx.lineTo(0, -12); ctx.moveTo(0, 0); ctx.lineTo(5, -9);
    ctx.stroke();
    ctx.fillStyle = '#c0ca33'; ctx.beginPath(); ctx.arc(0, -12, 2.2, 0, 7); ctx.fill();
  } else if (o.kind === 'stall') {
    // базарная лавка: полосатый навес, прилавок, товар
    ctx.fillStyle = '#8d6e63'; ctx.fillRect(-8, -6, 16, 5); // прилавок
    ctx.fillStyle = '#5d4037'; ctx.fillRect(-7, -1, 2, 1.5); ctx.fillRect(5, -1, 2, 1.5); // ножки
    ctx.fillStyle = '#5d4037'; ctx.fillRect(-9, -16, 18, 1.5); // верх навеса
    for (let i = 0; i < 5; i++) { // полоски навеса
      ctx.fillStyle = i % 2 ? '#e53935' : '#f5f5f5';
      ctx.fillRect(-9 + i * 3.7, -14.5, 3.7, 4);
    }
    // товар на прилавке: фрукт / пшеница
    ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.arc(-4, -7, 1.7, 0, 7); ctx.fill();
    ctx.fillStyle = '#d4e157'; ctx.beginPath(); ctx.arc(0, -7, 1.7, 0, 7); ctx.fill();
    ctx.fillStyle = '#fdd835'; ctx.fillRect(2.5, -8.5, 5, 1.6);
  } else if (o.kind === 'water' || o.kind === 'fished' || o.kind === 'sea') {
    ctx.strokeStyle = o.kind === 'sea' ? '#90caf9' : '#bbdefb'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(-4, -8); ctx.lineTo(0, -6); ctx.lineTo(4, -8); ctx.lineTo(8, -6); ctx.stroke();
    if ((o.kind === 'water' || o.kind === 'sea') && o.stock > 0) {
      ctx.fillStyle = '#e1f5fe'; ctx.beginPath(); ctx.arc(-1, -11, 2.4, 0, 7); ctx.fill();
      if (o.max) stockBar(frac);
    }
  } else if (o.kind === 'bridge') {
    ctx.fillStyle = '#6d4c41'; ctx.fillRect(-8, -5, 16, 3); ctx.fillRect(-8, -1, 16, 2);
    ctx.fillStyle = '#8d6e63'; ctx.fillRect(-7, -8, 2, 8); ctx.fillRect(5, -8, 2, 8);
  } else if (o.kind === 'house') {
    ctx.fillStyle = '#8d6e63'; ctx.fillRect(-7, -8, 14, 8);
    ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.moveTo(-9, -8); ctx.lineTo(0, -16); ctx.lineTo(9, -8); ctx.fill();
    ctx.fillStyle = '#ffe082'; ctx.fillRect(-2, -6, 4, 6);
  } else if (o.kind === 'shed') {
    ctx.fillStyle = '#a1887f'; ctx.fillRect(-6, -6, 12, 6);
    ctx.fillStyle = '#78909c'; ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(0, -11); ctx.lineTo(8, -6); ctx.fill();
  } else if (o.kind === 'oven') {
    ctx.fillStyle = '#546e7a'; ctx.fillRect(-7, -10, 14, 10);
    ctx.fillStyle = '#ff8f00'; ctx.fillRect(-3, -6, 6, 4);
  } else if (o.kind === 'sawmill') {
    ctx.fillStyle = '#6d4c41'; ctx.fillRect(-8, -9, 16, 9);
    ctx.fillStyle = '#ffcc80'; ctx.beginPath(); ctx.moveTo(-9, -9); ctx.lineTo(0, -15); ctx.lineTo(9, -9); ctx.fill();
    ctx.strokeStyle = '#efebe9'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(1, -4, 3, 0, 7); ctx.stroke();
  } else if (o.kind === 'warehouse') {
    ctx.fillStyle = '#78909c'; ctx.fillRect(-8, -10, 16, 10);
    ctx.fillStyle = '#455a64'; ctx.fillRect(-3, -6, 6, 6);
    ctx.fillStyle = '#cfd8dc'; ctx.fillRect(-8, -12, 16, 2);
  }
  if (o.burning && !o.boom && (o.kind === 'tree' || o.kind === 'mountain')) {
    for (let i = 0; i < 3; i++) {
      const fx = (i - 1) * 5, fh = (7 + Math.sin(now * 12 + i * 2) * 3) * (1 - burn * 0.4);
      ctx.fillStyle = i === 1 ? '#ffeb3b' : '#ff9800';
      ctx.beginPath();
      ctx.moveTo(fx - 3, -8 * grow); ctx.lineTo(fx, -8 * grow - fh); ctx.lineTo(fx + 3, -8 * grow); ctx.fill();
    }
  }
  if (o.burning && o.boom) {
    ctx.fillStyle = 'rgba(255,152,0,' + (0.7 * (1 - burn)) + ')';
    ctx.beginPath(); ctx.arc(0, -8, 8 + burn * 14, 0, 7); ctx.fill();
  }
  ctx.restore();
}

function drawWorker(w) {
  const cx = cellX(w.col) + CELL / 2, cy = cellY(w.row) + CELL - 2;
  let offX = 0, alpha = 1;
  if (w.phase === 'enter') offX = -(1 - w.t / 0.6) * 18 * SF;
  if (w.phase === 'leave') alpha = 1 - w.t / 0.5;
  const style = {
    axe: { jacket: '#ef6c00', hat: '#e91e63' },
    saw: { jacket: '#1e88e5', hat: '#8e24aa' },
    pick: { jacket: '#f9a825', hat: '#37474f' },
    hammer: { jacket: '#8e24aa', hat: '#f9a825' },
    sickle: { jacket: '#fdd835', hat: '#f9a825' },
    scythe: { jacket: '#7cb342', hat: '#5d4037' },
    rod: { jacket: '#039be5', hat: '#01579b' },
    baker: { jacket: '#f5f5f5', hat: '#efebe9' },
    basket: { jacket: '#8d6e63', hat: '#2e7d32' },
  }[w.act.worker] || { jacket: '#8d6e63', hat: '#37474f' };
  ctx.save();
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.translate(cx + offX, cy);
  ctx.scale(SF, SF);
  const mode = w.act.worker;
  if (mode === 'saw') {
    const off = w.phase === 'work' ? Math.sin(w.workT * 7) * 3 : 0;
    ctx.save(); ctx.translate(2 + off, -6);
    ctx.strokeStyle = '#b0bec5'; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12, 0); ctx.stroke();
    ctx.lineWidth = 1.2;
    for (let i = 0; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(i * 2, 0); ctx.lineTo(i * 2 + 1, 2); ctx.stroke(); }
    ctx.restore();
  } else if (mode !== 'baker') {
    let ang = -0.6;
    if (w.phase === 'work' && w.act.time) {
      const ph = (w.workT % w.act.time) / w.act.time;
      ang = -1.2 + Math.sin(ph * Math.PI) * 1.5;
    }
    ctx.save(); ctx.translate(3, -7); ctx.rotate(ang);
    ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(mode === 'scythe' || mode === 'rod' ? 12 : 9, 0); ctx.stroke();
    if (mode === 'axe') { ctx.fillStyle = '#cfd8dc'; ctx.fillRect(7, -4, 5, 6); }
    if (mode === 'pick') { ctx.strokeStyle = '#cfd8dc'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(9, 0, 5, -Math.PI * 0.75, Math.PI * 0.25); ctx.stroke(); }
    if (mode === 'hammer') { ctx.fillStyle = '#90a4ae'; ctx.fillRect(6, -4, 7, 6); }
    if (mode === 'sickle' || mode === 'scythe') { ctx.strokeStyle = '#cfd8dc'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(mode === 'scythe' ? 12 : 9, 0, 4, -Math.PI * 0.2, Math.PI * 0.8); ctx.stroke(); }
    if (mode === 'rod') { ctx.strokeStyle = '#e1f5fe'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(12, 4); ctx.stroke(); }
    if (mode === 'basket') { ctx.fillStyle = '#ffcc80'; ctx.fillRect(6, -3, 5, 4); }
    ctx.restore();
  }
  ctx.fillStyle = '#37474f';
  ctx.fillRect(-4, -5, 3, 5); ctx.fillRect(1, -5, 3, 5);
  ctx.fillStyle = style.jacket; rr(-5, -12, 10, 8, 2);
  ctx.strokeStyle = style.jacket; ctx.lineWidth = 2.5;
  if (w.phase === 'shrug') {
    ctx.beginPath(); ctx.moveTo(-4, -10); ctx.lineTo(-7, -15); ctx.moveTo(4, -10); ctx.lineTo(7, -15); ctx.stroke();
    ctx.fillStyle = '#fff'; rr(-8, -26, 16, 12, 4);
    ctx.fillStyle = '#37474f'; ctx.font = 'bold 10px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('?', 0, -17.5);
  } else {
    ctx.beginPath(); ctx.moveTo(-4, -10); ctx.lineTo(-6, -5); ctx.stroke();
    if (mode === 'saw' || mode === 'hammer' || mode === 'scythe' || mode === 'basket') { ctx.beginPath(); ctx.moveTo(4, -10); ctx.lineTo(7, -6); ctx.stroke(); }
  }
  ctx.fillStyle = '#f6c89f'; ctx.beginPath(); ctx.arc(0, -16, 3.5, 0, 7); ctx.fill();
  ctx.fillStyle = style.hat;
  ctx.beginPath(); ctx.arc(0, -17.5, 3.5, Math.PI, 0); ctx.fill();
  ctx.restore();
}

// ---------- ДЕМО: наблюдаемое автопрохождение ----------
// Запуск: кнопка «▶ демо» на карте, или index.html?demo=1 / ?demo=N.
// Игра сама проходит эталонные решения (SOLUTIONS): кликает клетки,
// печатает команды по символу, ловит пузыри, ждёт рабочих, идёт дальше.
// Прогресс и сейв НЕ изменяются. Esc — выход.
let demo = null;
let demoBtns = {};
function firstNotDoneLevel() {
  for (let i = 0; i < LEVELS.length; i++) if (!SAVE.done[i]) return i;
  return 0;
}
function demoStart(fromIdx, speed) {
  const i = Math.max(0, Math.min(LEVELS.length - 1, fromIdx || 0));
  demo = {
    on: true, paused: false, i, step: -1, phase: 'between', t: 0, speed: speed || 1,
    buf: '', ci: 0, sel: null, sel2: null, retries: 0, redo: false, after: null,
    chipCmd: null,
    isBubble: false, isWeed: false, isRain: false, rainGot: 0, rainN: 0,
    bubblesCaught: 0, waitSec: 0, msg: 'старт…',
  };
  simHold = true;
  demoSkillOverride(i);
  applyLevel(i); reset();
  demoTutShow();
  log('▶ ДЕМО: игра играет сама — просто наблюдай (Esc — выход)', 'info');
}
// В демо обучение показываем принудительно — даже если этот игрок его уже проходил:
// зритель видит, как игра учит: затемнение, подсветка зоны, пузырь с заданием.
function demoTutShow() {
  tut = LVL.tutorial ? LVL.tutorial.slice() : null;
  tutIdx = 0;
}
function demoStop() {
  if (!demo) return;
  demo = null;
  skillDone = null; // возврат к личному сейву для навыков
  simHold = false;
  input.value = '';
  state = 'menu'; mapCenterOn(mapFrontier());
  beep(400, 0.08, 'triangle');
}
function demoGoto(i) {
  if (i >= LEVELS.length) { log('▶ ДЕМО: вся кампания показана'); demoStop(); return; }
  demo.i = i; demo.step = -1; demo.phase = 'between'; demo.t = 0;
  demo.bubblesCaught = 0; demo.isBubble = demo.isWeed = demo.isRain = false;
  demoSkillOverride(i);
  applyLevel(i); reset();
  demoTutShow();
}
function demoAdvance() { demo.step++; demoSetupStep(); }
function demoSetupStep() {
  const st = SOLUTIONS[demo.i][demo.step];
  demo.retries = 0; demo.redo = false;
  if (!st) { demo.phase = 'finish'; demo.t = 0; demo.msg = 'ждём выполнения цели…'; return; }
  if (st.rain) { demo.phase = 'rain-wait'; demo.t = 0; demo.rainGot = 0; demo.rainN = st.rain; demo.msg = 'жду падающие слова…'; return; }
  if (st.wait) { demo.phase = 'wait'; demo.t = 0; demo.waitSec = st.wait; demo.msg = 'пауза ' + st.wait + ' с'; return; }
  if (st.waitWork) { demo.phase = 'waitwork'; demo.t = 0; demo.msg = 'рабочие трудятся…'; return; }
  if (st.sweep) { demo.phase = 'sweep'; demo.t = 0; demo.after = st.cmd ? st : null; demo.msg = 'пропалываем сорняки'; return; }
  demoSetupCmd(st);
}
function demoSetupCmd(st) {
  const inline = /^[а-яё]\d{1,2}\s/.test(st.cmd);
  demo.sel = null; demo.sel2 = null;
  if (st.cells) { demo.sel = addrCell(st.cells[0]); demo.sel2 = addrCell(st.cells[1]); }
  else if (st.cell && !inline) demo.sel = addrCell(st.cell);
  demo.buf = st.cmd; demo.ci = 0;
  demo.phase = demo.sel ? 'select' : 'type';
  demo.t = 0;
  // демо «кликает» карточку команды перед печатью — зритель видит клавиатуру-подсказку
  const body = inline ? st.cmd.replace(/^[а-яё]\d{1,2}\s+/, '') : st.cmd;
  const verb = (LVL.verbs || []).find(x => body === x.cmd || body.startsWith(x.cmd + ' '));
  demo.chipCmd = demo.sel && verb ? verb.cmd : null;
  const where = demo.sel
    ? cellName(demo.sel.col, demo.sel.row) + (demo.sel2 ? ' → ' + cellName(demo.sel2.col, demo.sel2.row) : '') + ' · '
    : '';
  demo.msg = where + 'печатаю: «' + st.cmd + '»';
}
function demoBusy() {
  const w = workers.filter(x => x.phase !== 'leave').length;
  const b = Object.keys(objs).filter(k => objs[k].burning).length;
  return w + b > 0;
}
function demoTick(dtRaw) {
  const dt = Math.min(0.05, dtRaw) * demo.speed;
  if (state === 'play') update(dt);
  else if (state === 'rain') rainUpdate(dt);
  demo.t += dt;
  // пока идёт обучение — демо притормаживает: зритель должен успеть увидеть
  // каждый шаг (клик по клетке, букву за буквой), как это будет делать ребёнок
  const slow = !!tut;
  switch (demo.phase) {
    case 'between':
      if (demo.t >= (slow ? 1.0 : 0.55)) {
        if (bubbles.length && demo.bubblesCaught < bubblesNeed()) {
          demo.buf = bubbles[0].word; demo.ci = 0; demo.isBubble = true;
          demo.phase = 'type'; demo.t = 0;
          demo.msg = 'ловлю пузырь: «' + bubbles[0].word + '»';
        } else demoAdvance();
      }
      break;
    case 'select':
      if (demo.t >= (slow ? 1.4 : 0.45)) {
        selected = { col: demo.sel.col, row: demo.sel.row }; selected2 = null;
        if (demo.sel2) selected2 = { col: demo.sel2.col, row: demo.sel2.row };
        beep(500, 0.05, 'triangle', 0.07);
        demo.phase = demo.chipCmd ? 'chip' : 'type'; demo.t = 0; demo.ci = 0;
      }
      break;
    case 'chip': // «клик» по карточке команды — как учит туториал
      if (!kbTarget) {
        demo.msg = 'кликаю карточку «' + demo.chipCmd + '» — появится клавиатура';
        if (demo.t >= (slow ? 1.3 : 0.4)) { kbTarget = demo.chipCmd; demo.t = 0; }
      } else {
        demo.msg = 'печатаю по подсветке клавиш: «' + demo.buf + '»';
        if (demo.t >= (slow ? 1.0 : 0.5)) { demo.phase = 'type'; demo.t = 0; demo.ci = 0; }
      }
      break;
    case 'type':
      if (demo.t >= (slow ? 0.32 : 0.13)) {
        demo.t = 0; demo.ci++;
        input.value = demo.buf.slice(0, demo.ci);
        if (demo.ci >= demo.buf.length) { demo.phase = 'enter'; demo.t = 0; }
      }
      break;
    case 'enter':
      if (demo.t >= (slow ? 0.9 : 0.3)) {
        submit();
        if (lastSubmit.ok) {
          if (demo.isWeed) { demo.isWeed = false; demo.phase = 'sweep'; demo.t = 0; break; }
          if (demo.isBubble) { demo.isBubble = false; demo.bubblesCaught++; demo.phase = 'between'; demo.t = 0; break; }
          if (demo.isRain) {
            demo.isRain = false; demo.rainGot++;
            if (demo.rainGot >= demo.rainN) demoAdvance();
            else { demo.phase = 'rain-wait'; demo.t = 0; }
            break;
          }
          demo.phase = 'between'; demo.t = 0;
        } else {
          const m = lastSubmit.msg || '';
          if (demo.isRain) { demo.isRain = false; demo.phase = 'rain-wait'; demo.t = 0; break; }
          if (/сорняк/.test(m)) { demo.phase = 'sweep'; demo.redo = true; demo.t = 0; demo.after = null; break; }
          if (/работа|горит/.test(m)) { demo.phase = 'waitwork'; demo.redo = true; demo.t = 0; break; }
          demo.retries++;
          if (demo.retries <= 4) { demo.phase = 'retpause'; demo.t = 0; }
          else { log('▶ ДЕМО: шаг не прошёл — дальше («' + m + '»)', 'warn'); demoAdvance(); }
        }
      }
      break;
    case 'retpause':
      if (demo.t >= 0.8) demoSetupCmd(SOLUTIONS[demo.i][demo.step]);
      break;
    case 'sweep': {
      const weeds = Object.keys(objs).filter(k => objs[k].kind === 'weed');
      if (!weeds.length) {
        if (demo.redo) demoSetupCmd(SOLUTIONS[demo.i][demo.step]);
        else if (demo.after) { const a = demo.after; demo.after = null; demoSetupCmd(a); }
        else demoAdvance();
        break;
      }
      if (demo.t >= 0.5) {
        const w = objs[weeds[0]];
        selected = { col: w.col, row: w.row }; selected2 = null;
        demo.buf = 'полоть'; demo.ci = 0; demo.isWeed = true;
        demo.phase = 'type'; demo.t = 0;
        demo.msg = 'полю: ' + weeds[0];
      }
      break;
    }
    case 'wait':
      if (demo.t >= demo.waitSec) demoAdvance();
      break;
    case 'waitwork':
      // цель уже закрыта (state win) — рабочие заморожены и не уйдут сами
      if (state === 'win') { demoAdvance(); break; }
      if (!demoBusy() || demo.t > 240) {
        if (demo.redo) demoSetupCmd(SOLUTIONS[demo.i][demo.step]);
        else demoAdvance();
      }
      break;
    case 'rain-wait':
      if (rainWords.length && demo.t >= 0.8) {
        demo.buf = rainWords[0].word; demo.ci = 0; demo.isRain = true;
        demo.phase = 'type'; demo.t = 0;
        demo.msg = 'печатаю: «' + demo.buf + '»';
      }
      break;
    case 'finish':
      if (state === 'win') { demo.phase = 'win'; demo.t = 0; }
      else if (demo.t > 25) { log('▶ ДЕМО: цель не закрылась — следующий уровень', 'warn'); demoGoto(demo.i + 1); }
      break;
    case 'win':
      if (demo.t >= 4) demoGoto(demo.i + 1);
      break;
  }
}
function drawDemoOverlay() {
  if (!demo || !demo.on) return;
  const D = LAYOUT.elements;
  // баннер действия
  ctx.fillStyle = 'rgba(6,20,12,0.88)'; rr(D.demo_banner.x, D.demo_banner.y, D.demo_banner.w, D.demo_banner.h, 12);
  ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2; ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffe066'; ctx.font = 'bold 18px Segoe UI';
  ctx.fillText('▶ ДЕМО · уровень ' + (demo.i + 1) + ': ' + LEVELS[demo.i].name, D.demo_banner.x + 16, D.demo_banner.y + 24);
  ctx.fillStyle = '#b9e4bd'; ctx.font = '14px Segoe UI';
  ctx.fillText(demo.msg + (demo.paused ? '   ⏸ ПАУЗА' : ''), D.demo_banner.x + 16, D.demo_banner.y + 46);
  // панель управления
  const defs = [['sp05', '0.5×', 58], ['sp1', '1×', 46], ['sp2', '2×', 46], ['sp4', '4×', 46], ['skip', '⏭ уровень', 122], ['pause', demo.paused ? '▶' : '⏸', 54], ['stop', '⏹ стоп', 106]];
  demoBtns = {};
  let x = D.demo_controls.x; const y = D.demo_controls.y, h = D.demo_controls.h;
  for (const [id, label, w] of defs) {
    demoBtns[id] = { x, y, w, h };
    const active = (id === 'sp05' && demo.speed === 0.5) || (id === 'sp1' && demo.speed === 1) || (id === 'sp2' && demo.speed === 2) || (id === 'sp4' && demo.speed === 4);
    ctx.fillStyle = active ? '#2e6c46' : 'rgba(14,36,24,0.9)'; rr(x, y, w, h, 10);
    ctx.strokeStyle = active ? '#ffe066' : '#3d8a5f'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#eaffea'; ctx.font = 'bold 15px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + 28);
    ctx.textAlign = 'left';
    x += w + 8;
  }
}

const KEY_ROWS = ['1234567890', 'йцукенгшщзхъ', 'фывапролджэ', 'ячсмитьбюё'];
function drawKeyboard(px, top) {
  if (SAVE.settings.kb === 'скрытая') {
    kbClose = null;
    kbRect = null;
    ctx.fillStyle = '#9dbfa5'; ctx.font = '14px Segoe UI'; ctx.textAlign = 'left';
    ctx.fillText('подсказка скрыта (настройки ⚙)', px, top);
    return false;
  }
  ctx.save();
  if (SAVE.settings.kb === 'тусклая' || LVL.dimKb) ctx.globalAlpha = 0.35;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const t = kbTarget;
  ctx.fillStyle = '#ffe066'; ctx.font = 'bold 15px Segoe UI';
  ctx.fillText('КЛАВИАТУРА — печатай: «' + t + '»', px, top);
  kbClose = { x: px + LAYOUT.panel.width - 62, y: top - 16, w: 62, h: 20 };
  ctx.fillStyle = '#455a64'; rr(kbClose.x, kbClose.y, kbClose.w, kbClose.h, 6);
  ctx.fillStyle = '#eceff1'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText('✕ закрыть', kbClose.x + kbClose.w / 2, top - 2);

  const raw = input.value.toLowerCase();
  let next = null, wrong = null, complete = true;
  for (let i = 0; i < t.length; i++) {
    if (raw[i] === undefined) { next = t[i]; complete = false; break; }
    if (raw[i] !== t[i]) { wrong = raw[i]; next = t[i]; complete = false; break; }
  }
  if (complete && raw.length > t.length) { wrong = raw[t.length]; complete = false; }
  const letters = new Set(t.replace(/ /g, ''));
  // близко к низу панели — клавиатура компактнее, чтобы подсказка под ней влезла
  const KS = top > 310 ? 34 : 38, GAP = top > 310 ? 3 : 4;
  const drawKey = (ch, x, y, w, h, label) => {
    let fill = '#1d3226', txt = '#789b7f', border = null, bw = 0;
    if (ch === ' ' ? t.includes(' ') : letters.has(ch)) { fill = '#2e5c40'; txt = '#eaffea'; }
    if (ch === wrong) { border = '#e57373'; bw = 3; fill = '#4e2323'; }
    if (ch === next && !complete) {
      fill = '#ffe066'; txt = '#17382a';
      border = 'rgba(255,255,255,' + (0.6 + 0.4 * Math.sin(now * 6)) + ')'; bw = 3;
    }
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6); else ctx.rect(x, y, w, h);
    ctx.fillStyle = fill; ctx.fill();
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = bw; ctx.stroke(); }
    ctx.fillStyle = txt; ctx.font = 'bold 16px Segoe UI';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label || ch, x + w / 2, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  };
  KEY_ROWS.forEach((row, ri) => {
    const off = ri * (KS / 2 + GAP / 2);
    for (let i = 0; i < row.length; i++)
      drawKey(row[i], px + off + i * (KS + GAP), top + 12 + ri * (KS + GAP), KS, KS);
  });
  const sw = 240, sx = px + (LAYOUT.panel.width - sw) / 2, sy = top + 12 + 4 * (KS + GAP);
  drawKey(' ', sx, sy, sw, KS - 4, 'пробел');
  const nextLabel = next === ' ' ? 'пробел' : next;
  ctx.textAlign = 'left'; ctx.font = 'bold 15px Segoe UI';
  if (complete) { ctx.fillStyle = '#7ee787'; ctx.fillText('✅ Верно! Нажимай Enter', px, sy + KS + 26); }
  else if (wrong) { ctx.fillStyle = '#ff8a80'; ctx.fillText('Опечатка! Нажми ⌫ и затем «' + nextLabel + '»', px, sy + KS + 26); }
  else { ctx.fillStyle = '#b9e4bd'; ctx.fillText('Нажимай подсвеченную клавишу: «' + nextLabel + '»', px, sy + KS + 26); }
  // журнал не прячется: последняя строка под клавиатурой
  if (logArr.length) {
    ctx.fillStyle = logArr[0].kind === 'err' ? '#ff8a80' : logArr[0].kind === 'warn' ? '#ffe082' : '#a5d6a7';
    ctx.font = '14px Segoe UI';
    ctx.fillText('· ' + logArr[0].text, px, sy + KS + 48);
  }
  // зона клавиатуры: от заголовка до строки ввода — список, журнал и статистика
  // в это время скрыты, место под подсказку освобождается само
  kbRect = { x: px, y: top - 22, w: LAYOUT.panel.width, h: LAYOUT.elements.cell_prompt.y - (top - 22) }; // от метки до строки ввода
  ctx.restore();
  return true;
}

// ---------- дерево уровней ----------
// Родители уровня: открывается, когда пройден хотя бы один родитель.
// Развилки: 3|4 (Переноска/Ферма), 7|8 (Рыбак/Дороги), 12|13 (Дом/Пекарня),
// 19|20|21 (Парк/Зоопарк/Школа — выбор из трёх), 24|25 (Мастерская/Дождь).
const LEVEL_TREE = {
  0: [],           // 1 Лесопилка — открыта всегда
  1: [0],          // 2 Просека
  2: [1],          // 3 Карьер
  3: [2],          // 4 Переноска (ветка А)
  4: [2],          // 5 Ферма (ветка Б)
  5: [3, 4],       // 6 Ярмарка — после любой ветки
  6: [5],          // 7 Река
  7: [6],          // 8 Рыбак (ветка слов)
  8: [6],          // 9 Дороги (ветка путей)
  9: [8],          // 10 Развилка
  10: [6],         // 11 Мосты
  11: [9, 10],     // 12 Почта
  12: [11],        // 13 Дом (ветка стройки)
  13: [11],        // 14 Пекарня (ветка еды)
  14: [12],        // 15 Склад
  15: [13],        // 16 Кузница
  16: [14, 15],    // 17 Огород
  17: [16],        // 18 Теплица
  18: [17],        // 19 Городок
  19: [18],        // 20 Парк
  20: [18],        // 21 Зоопарк
  21: [18],        // 22 Школа
  22: [19, 20],    // 23 Телеграф
  23: [20, 21],    // 24 Праздник
  24: [22, 23],    // 25 Мастерская слов
  25: [22, 23],    // 26 Дождь слов
  26: [24, 25],    // 27 Ночной город
  27: [25],        // 28 Скорый поезд
  28: [26, 27],    // 29 Большой мост — босс
  29: [28],        // 30 Свой город — финал
};
function levelUnlocked(i, doneSet) {
  if (DEV()) return true;
  const par = LEVEL_TREE[i] || [];
  if (!par.length) return true;
  const done = doneSet || SAVE.done;
  // requireAll: уровень-слияние требует ВСЕХ родителей (Ярмарка: Сад и Ферма —
  // навыки «сад»/«поле» берутся именно с них, одного родителя недостаточно)
  return LEVELS[i].requireAll ? par.every(p => done[p]) : par.some(p => done[p]);
}
const unlockedList = () => LEVELS.map((_, i) => i).filter(i => levelUnlocked(i) && !SAVE.done[i]);
const parentNames = i => (LEVEL_TREE[i] || []).map(p => LEVELS[p].name).join(LEVELS[i] && LEVELS[i].requireAll ? ' и ' : ' или ');
const needPhrase = parentNames;

let menuBtns = {}, mapNodes = [], hoverNodeIdx = -1, lockedPick = -1, newlyUnlocked = [];

// Вертикальная карта-дерево: рост СНИЗУ ВВЕРХ — начинаем внизу (уровень 1)
// и поднимаемся; развилки расходятся в стороны. Y перевёрнут: уровень 1 внизу.
// Координаты [x, y]; скролл колесом мыши или перетаскиванием.
const MAP_POS = [
  [700, 2270], [700, 2160], [700, 2050],                  // 1–3 — старт внизу
  [450, 1930], [950, 1930],                                 // 4 САД ← | → 5 ФЕРМА
  [700, 1810], [700, 1700],                                 // 6 Ярмарка, 7 Река
  [450, 1580], [950, 1580], [950, 1470], [200, 1580],       // 8 Рыбак, 9 Дороги, 10 Развилка, 11 Мосты
  [700, 1360],                                              // 12 Почта
  [450, 1240], [950, 1240], [450, 1130], [950, 1130],       // 13–16
  [700, 1010], [700, 900], [700, 790],                      // 17–19
  [450, 670], [700, 670], [950, 670],                       // 20–22 (тройная развилка)
  [450, 550], [950, 550],                                   // 23–24
  [450, 440], [950, 440],                                   // 25–26
  [700, 320], [1150, 320],                                  // 27–28
  [700, 200], [700, 90],                                    // 29–30 — вершина
];
const MAP_BOTTOM = 2270; // максимум Y — уровень 1 (низ карты)
// Окно карты — между инфо-строкой (62–128) и кнопками (660): точки не выходят за его границы.
const MAP_VIEW_TOP = 138, MAP_VIEW_BOT = 648, MAP_VIEW_H = MAP_VIEW_BOT - MAP_VIEW_TOP;
const MAP_OFF_Y = 124; // отступ: первая точка целиком ниже инфо-строки
let mapScrollY = 0, mapDrag = null;
const MAP_MAX_SCROLL = Math.max(0, MAP_BOTTOM + MAP_OFF_Y + 62 - MAP_VIEW_BOT);
mapScrollY = MAP_MAX_SCROLL; // стартовый вид — низ карты, где уровень 1
const mapPos = i => ({ x: MAP_POS[i][0], y: MAP_OFF_Y + MAP_POS[i][1] - mapScrollY });
function mapCenterOn(i) {
  mapScrollY = Math.max(0, Math.min(MAP_MAX_SCROLL, MAP_POS[i][1] + MAP_OFF_Y - MAP_VIEW_TOP - MAP_VIEW_H / 2));
}
// скроллбар карты: общие метрики и пересчёт позиция <-> прокрутка
function mapSb() {
  const trY = MAP_VIEW_TOP + 2, trH = MAP_VIEW_H - 4;
  const th2 = Math.max(30, trH * MAP_VIEW_H / (MAP_MAX_SCROLL + MAP_VIEW_H));
  return { x: 1252, w: 8, trY, trH, th2 };
}
const mapSbThumbY = () => { const s = mapSb(); return s.trY + (s.trH - s.th2) * (mapScrollY / MAP_MAX_SCROLL); };
const mapSbFromY = (y, off) => {
  const s = mapSb();
  const k = Math.max(0, Math.min(1, (y - s.trY - off) / (s.trH - s.th2)));
  return Math.max(0, Math.min(MAP_MAX_SCROLL, k * MAP_MAX_SCROLL));
};
function mapFrontier() {
  for (let i = 0; i < LEVELS.length; i++) if (levelUnlocked(i) && !SAVE.done[i]) return i;
  for (let i = LEVELS.length - 1; i >= 0; i--) if (SAVE.done[i]) return i;
  return 0;
}

function drawMenu() {
  const th = TH();
  ctx.fillStyle = th.menu; ctx.fillRect(0, 0, W, H);
  if (SAVE.settings.theme === 'night') for (let i = 0; i < 50; i++) {
    ctx.fillStyle = 'rgba(255,255,255,' + (0.15 + 0.5 * Math.abs(Math.sin(now + i))) + ')';
    ctx.fillRect((i * 127) % W, (i * 83) % H, 2, 2);
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = th.acc; ctx.font = 'bold 42px Segoe UI';
  ctx.fillText('ПЕЧАТНЫЙ ГОРОД', W / 2, 44);

  // инфо-строка: подсказка или описание точки
  const tgt = hoverNodeIdx >= 0 ? hoverNodeIdx : lockedPick;
  ctx.fillStyle = '#0e2418'; rr(30, 62, 1220, 66, 12);
  ctx.textAlign = 'left';
  if (tgt >= 0 && (levelUnlocked(tgt) || SAVE.done[tgt] || DEV())) {
    const L = LEVELS[tgt];
    ctx.font = '26px Segoe UI'; ctx.fillText(L.icon, 46, 106);
    ctx.fillStyle = th.acc; ctx.font = 'bold 19px Segoe UI';
    ctx.fillText((tgt + 1) + '. ' + L.name, 88, 90);
    ctx.font = '15px Segoe UI';
    if (SAVE.done[tgt]) {
      const b = SAVE.best[tgt] || {};
      ctx.fillStyle = '#a5d6a7';
      ctx.fillText('✓ пройден · ★' + (SAVE.stars[tgt] || 0) + '/5 · лучший: точность ' + (b.acc !== undefined ? b.acc + '%' : '—'), 88, 116);
    } else if (levelUnlocked(tgt)) {
      ctx.fillStyle = '#ffe066';
      ctx.fillText('▶ доступен · цель: ' + goalsOf(L), 88, 116);
    } else {
      ctx.fillStyle = '#ff8a80';
      ctx.fillText('🛠 открыт для тестирования (DEV)', 88, 116);
    }
  } else if (tgt >= 0) {
    ctx.font = '26px Segoe UI'; ctx.fillText('🔒', 46, 106);
    ctx.fillStyle = '#9dbfa5'; ctx.font = 'bold 19px Segoe UI';
    ctx.fillText('Уровень ' + (tgt + 1) + ' — ещё закрыт', 88, 90);
    ctx.font = '15px Segoe UI'; ctx.fillStyle = '#7ba287';
    const pars = LEVEL_TREE[tgt] || [];
    ctx.fillText(pars.length ? 'Сначала пройди: ' + needPhrase(tgt) + ' — и узнаешь, что там!' : 'Открой его, пройдя предыдущие уровни — и узнаешь, что там!', 88, 116);
  } else {
    ctx.fillStyle = '#b9e4bd'; ctx.font = 'bold 18px Segoe UI';
    ctx.fillText('Пройдено ' + Object.keys(SAVE.done).length + ' из ' + LEVELS.length + ' · ⭐ ' + starsBalance(), 46, 88);
    ctx.fillStyle = '#9dbfa5'; ctx.font = '15px Segoe UI';
    if (DEV()) ctx.fillText('🛠 РЕЖИМ ТЕСТИРОВАНИЯ: все уровни открыты · клик по любой точке · адрес вида ?level=25 открывает уровень сразу', 46, 116);
    else ctx.fillText('клик по золотой точке — играть · цифры 1–9 — быстрый выбор доступных · золотая линия открывает путь дальше', 46, 116);
    if (DEV()) {
      ctx.fillStyle = '#ff8a65'; ctx.font = 'bold 15px Segoe UI'; ctx.textAlign = 'right';
      ctx.fillText('🛠 DEV', 1244, 44);
      ctx.textAlign = 'left';
    }
  }

  // связи и точки — только внутри окна карты (clip): не наезжают на инфо-строку и кнопки
  ctx.save();
  ctx.beginPath(); ctx.rect(16, MAP_VIEW_TOP, W - 32, MAP_VIEW_H); ctx.clip();

  // связи дерева
  for (let i = 0; i < LEVELS.length; i++) {
    for (const p of (LEVEL_TREE[i] || [])) {
      const a = mapPos(p), b = mapPos(i);
      const doneEdge = SAVE.done[p] && SAVE.done[i];
      const openEdge = SAVE.done[p] && !SAVE.done[i] && levelUnlocked(i);
      ctx.strokeStyle = doneEdge ? '#7ee787' : openEdge ? '#ffe066' : '#2a4a38';
      ctx.lineWidth = doneEdge || openEdge ? 3 : 2;
      if (openEdge) ctx.setLineDash([7, 7]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // точки
  mapNodes = [];
  for (let i = 0; i < LEVELS.length; i++) {
    const { x, y } = mapPos(i);
    if (y < MAP_VIEW_TOP - 90 || y > MAP_VIEW_BOT + 90) continue; // далеко за окном — не рисуем
    const R = 36;
    // кликабельны только точки, реально видимые в окне (не за обрезкой)
    if (y + R > MAP_VIEW_TOP && y - R < MAP_VIEW_BOT) mapNodes.push({ x, y, r: R, idx: i });
    const un = levelUnlocked(i), dn = !!SAVE.done[i];
    const hl = hoverNodeIdx === i || lockedPick === i;
    ctx.beginPath(); ctx.arc(x, y, R, 0, 7);
    ctx.fillStyle = dn ? '#1f4a33' : un ? '#245c3d' : '#0f1f15'; ctx.fill();
    ctx.lineWidth = 3;
    if (dn) ctx.strokeStyle = '#7ee787';
    else if (un) ctx.strokeStyle = 'rgba(255,224,102,' + (0.55 + 0.45 * Math.sin(now * 4)) + ')';
    else { ctx.strokeStyle = '#233c2e'; ctx.lineWidth = 2; }
    ctx.stroke();
    if (un && !dn) { // пульс доступности
      ctx.beginPath(); ctx.arc(x, y, R + 5 + Math.sin(now * 4) * 2, 0, 7);
      ctx.strokeStyle = 'rgba(255,224,102,0.25)'; ctx.lineWidth = 2; ctx.stroke();
    }
    if (newlyUnlocked.includes(i)) {
      // белое пульсирующее кольцо; сама метка «НОВОЕ!» — под точкой (в статусе),
      // чтобы не перекрывать звёзды уровня выше
      ctx.beginPath(); ctx.arc(x, y, R + 9 + Math.sin(now * 5) * 3, 0, 7);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    }
    if (hl) { ctx.beginPath(); ctx.arc(x, y, R + 3, 0, 7); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke(); }
    // иконка (у закрытых — «?»: суть уровня скрыта до открытия)
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (un || dn) {
      ctx.globalAlpha = dn ? 1 : 1;
      ctx.font = '32px Segoe UI';
      ctx.fillText(LEVELS[i].icon, x, y + 1);
    } else {
      ctx.font = 'bold 34px Segoe UI'; ctx.fillStyle = '#3d5c4a';
      ctx.fillText('?', x, y + 1);
    }
    ctx.textBaseline = 'alphabetic'; ctx.globalAlpha = 1;
    // номер
    ctx.beginPath(); ctx.arc(x - R + 6, y - R + 6, 11, 0, 7);
    ctx.fillStyle = dn ? '#2e6c46' : '#17382a'; ctx.fill();
    ctx.fillStyle = dn ? '#eaffea' : '#9dbfa5'; ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(i + 1, x - R + 6, y - R + 11);
    // имя рядом (только у открытых); у правого края — слева от точки, чтобы не обрезалось
    if (un || dn) {
      ctx.fillStyle = dn ? '#a5d6a7' : '#eaffea'; ctx.font = 'bold 14px Segoe UI';
      const lw = ctx.measureText(LEVELS[i].name).width;
      if (x + R + 10 + lw > W - 24) { ctx.textAlign = 'right'; ctx.fillText(LEVELS[i].name, x - R - 10, y - 2); }
      else { ctx.textAlign = 'left'; ctx.fillText(LEVELS[i].name, x + R + 10, y - 2); }
    }
    // статус под точкой
    if (dn) {
      const st = SAVE.stars[i] || 0;
      ctx.fillStyle = '#ffe066'; ctx.font = '13px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText('★'.repeat(st) + '☆'.repeat(5 - st), x, y + R + 18);
      ctx.beginPath(); ctx.arc(x + R - 6, y - R + 6, 10, 0, 7);
      ctx.fillStyle = '#7ee787'; ctx.fill();
      ctx.fillStyle = '#0e2418'; ctx.font = 'bold 13px Segoe UI';
      ctx.fillText('✓', x + R - 6, y - R + 11);
    } else if (un) {
      ctx.textAlign = 'center';
      if (newlyUnlocked.includes(i)) {
        // метка вместо пустых звёзд: уровень ещё не пройден, звёзд и так нет
        ctx.fillStyle = '#ffe066'; ctx.font = 'bold 13px Segoe UI';
        ctx.fillText('НОВОЕ!', x, y + R + 18);
      } else {
        ctx.fillStyle = '#ffe066'; ctx.font = '13px Segoe UI';
        ctx.fillText('☆☆☆☆☆', x, y + R + 18);
      }
    } else {
      ctx.font = '15px Segoe UI'; ctx.textAlign = 'center';
      ctx.fillText('🔒', x, y + R + 17);
    }
    ctx.textAlign = 'left';
  }
  ctx.restore(); // конец окна карты

  // индикатор прокрутки — в границах окна карты
  if (MAP_MAX_SCROLL > 0) {
    const sb = mapSb();
    ctx.fillStyle = '#0e2418'; rr(sb.x, sb.trY, sb.w, sb.trH, 4);
    ctx.fillStyle = '#3d8a5f'; rr(sb.x, mapSbThumbY(), sb.w, sb.th2, 4);
  }

  // кнопки экранов
  menuBtns = {};
  const labels = [['shop', '🛒 магазин'], ['city', '🏙 мой город'], ['parents', '📊 родителям'], ['settings', '⚙ настройки'], ['demo', '▶ демо']];
  labels.forEach((lb, i) => {
    const x = 30 + i * 236;
    menuBtns[lb[0]] = { x, y: 660, w: 220, h: 44 };
    ctx.fillStyle = '#1f4a33'; rr(x, 660, 220, 44, 10);
    ctx.strokeStyle = '#3d8a5f'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#eaffea'; ctx.font = 'bold 17px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(lb[1], x + 110, 688);
  });
  ctx.textAlign = 'left';
}

let chips = [];
function drawPanel() {
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const E = LAYOUT.elements, px = PANEL_X + 16, pw = LAYOUT.panel.width;
  ctx.fillStyle = '#eaffea'; ctx.font = 'bold 26px Segoe UI';
  ctx.fillText('УРОВЕНЬ ' + (levelIdx + 1) + ': ' + LVL.name, E.title_level.x, E.title_level.y);
  menuBtn = { x: E.btn_map.x, y: E.btn_map.y, w: E.btn_map.w, h: E.btn_map.h };
  ctx.fillStyle = '#245c3d'; rr(menuBtn.x, menuBtn.y, menuBtn.w, menuBtn.h, 8);
  ctx.strokeStyle = '#3d8a5f'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#eaffea'; ctx.font = 'bold 16px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText('⌂ карта', menuBtn.x + menuBtn.w / 2, menuBtn.y + 22);
  ctx.textAlign = 'left';
  ctx.font = '18px Segoe UI'; ctx.fillStyle = '#b9e4bd';
  ctx.fillText('Поле ' + N + '×' + N + ' (а–' + LETTERS[N - 1] + ', 1–' + N + ') · ' + goalStr(), E.subtitle.x, E.subtitle.y);

  const wallet = LVL.wallet && LVL.wallet.length;
  if (wallet) {
    ctx.fillStyle = '#ffe082'; ctx.font = '16px Segoe UI';
    ctx.fillText(LVL.wallet.map(k => k + ' ' + (resources[k] || 0)).join('   ·   '), E.wallet.x, E.wallet.y);
  }
  const goalTop = E.goals.y, goalStride = E.goals.stride, barH = E.goals.barH;
  const cols = ['#8bc34a', '#4db6ac', '#ffb74d'];
  LVL.goal.forEach((g, i) => {
    const y = goalTop + i * goalStride;
    ctx.fillStyle = '#0e2418'; rr(px, y, pw, barH, 10);
    ctx.fillStyle = '#263238'; rr(px + 8, y + 6, pw - 16, barH - 14, 8);
    const frac = Math.min(1, goalVal(g) / g.n);
    ctx.fillStyle = cols[i % 3]; rr(px + 8, y + 6, Math.max(8, (pw - 16) * frac), barH - 14, 8);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(goalName(g) + ': ' + goalVal(g) + ' / ' + g.n, px + pw / 2, y + barH * 0.68);
    ctx.textAlign = 'left';
  });
  if (LVL.noStumps) {
    // цель «выкорчевать все пни» с метрикой: выкорчевано / появилось
    const y = goalTop + LVL.goal.length * goalStride;
    const left = countKind('stump');
    ctx.fillStyle = '#0e2418'; rr(px, y, pw, barH, 10);
    ctx.fillStyle = '#263238'; rr(px + 8, y + 6, pw - 16, barH - 14, 8);
    const frac = stats.stumpsMade ? Math.min(1, stats.stumpsCleared / stats.stumpsMade) : 0;
    ctx.fillStyle = '#ff8a65'; rr(px + 8, y + 6, Math.max(8, (pw - 16) * frac), barH - 14, 8);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText('пни выкорчевать: ' + stats.stumpsCleared + ' / ' + stats.stumpsMade + (left ? ' · на поле: ' + left : ' · чисто!'), px + pw / 2, y + barH * 0.68);
    ctx.textAlign = 'left';
  }

  // ---- живой статус звёзд: видно, что ещё выполнимо и почему ----
  const crit = starForecast();
  const acc = accPct();
  const needB = bubblesNeed();
  const starLine1 = crit.map(ok => (ok ? '★' : '☆')).join('');
  ctx.fillStyle = '#ffe066'; ctx.font = 'bold 18px Segoe UI';
  ctx.fillText(starLine1, E.stars.x, E.stars.y);
  ctx.fillStyle = '#9dbfa5'; ctx.font = 'bold 12px Segoe UI';
  ctx.fillText('ЗВЁЗДЫ', E.stars.x + 118, E.stars.y - 1);
  // пояснения: что не хватает для 5★
  const bits = [];
  bits.push((crit[1] ? '✓' : '✗') + ' точность ' + acc + '% (85)');
  bits.push((crit[2] ? '✓' : '✗') + ' точность ' + acc + '% (95)');
  bits.push((crit[3] ? '✓' : '✗') + ' подсказки ' + hintUses);
  bits.push((crit[4] ? '✓' : '✗') + ' пузыри ' + poppedBubbles + '/' + needB);
  ctx.fillStyle = crit.every(Boolean) ? '#7ee787' : '#b9e4bd'; ctx.font = '13px Segoe UI';
  ctx.fillText(bits.join(' · '), E.stars.x, E.stars.y + 20);
  const cmdTop = E.commands.titleY;

  let title, list = [];
  const order = LVL.orders && orderIdx < LVL.orders.length ? LVL.orders[orderIdx] : null;
  const word = currentWord();
  if (LVL.mode === 'rain') title = 'ПЕЧАТАЙ ПАДАЮЩИЕ СЛОВА';
  else if (word) title = 'НАПЕЧАТАЙ СЛОВО: «' + word.toUpperCase() + '»';
  else if (order && !selected) title = 'КЛИКНИ ИЛИ НАПЕЧАТАЙ АДРЕС ' + order.toUpperCase();
  else if (!selected) title = LVL.noClick ? 'ВЫБЕРИ КЛЕТКУ ПЕЧАТЬЮ: «б3»' : 'КЛИКНИ ПО ЯЧЕЙКЕ ИЛИ НАПЕЧАТАЙ «б3»:';
  else {
    const st = cellState(selected.col, selected.row);
    const o = objs[st.key];
    if (order) title = 'ПИСЬМО НА ' + order.toUpperCase();
    else if (st.type === 'busy') title = 'ЯЧЕЙКА ' + st.key + ': ИДЁТ РАБОТА';
    else if (st.type === 'burning') title = 'ЯЧЕЙКА ' + st.key + ': ГОРИТ…';
    else if (o && o.kind === 'apple') {
      const s = gardenStage(o);
      title = 'ЯЧЕЙКА ' + st.key + ' — САД ' +
        (s === 'grow' ? 'РАСТЁТ (фрукты через ' + gardenLeft(o) + 'с)'
          : 'ФРУКТЫ ЗРЕЮТ — портятся, успей собрать (осталось ' + gardenLeft(o) + 'с)');
    } else if (o && o.kind === 'field') {
      const s = fieldStage(o);
      title = 'ЯЧЕЙКА ' + st.key + ' — ГРЯДКА ' +
        (s === 'grow' ? 'РАСТЁТ (готова через ' + fieldLeft(o) + 'с)' : 'СПЕЛАЯ — собирай не спеша');
    } else if (!o) title = 'ЯЧЕЙКА ' + st.key + ' ПУСТА — ДОСТУПНО:';
    else title = 'ЯЧЕЙКА ' + st.key + ' — ' + (KIND_LABEL[o.kind] || 'ЗАНЯТО');
    list = commandsFor(st).map(w => ({ cmd: w, label: CMD_INFO(w) }));
    if (order) list = [{ cmd: 'письмо', label: CMD_INFO('письмо') }];
  }
  if (LVL.two && selected && selected2) {
    title = 'ОТРЕЗОК ' + cellName(selected.col, selected.row) + ' → ' + cellName(selected2.col, selected2.row);
  }
  if (roadFrom) {
    title = '🧱 ДОРОГА: старт ' + cellName(roadFrom.col, roadFrom.row) + ' — кликни конечную точку';
    list = [];
  }
  ctx.fillStyle = '#9dbfa5'; ctx.font = 'bold 15px Segoe UI';
  ctx.fillText(title + (selected && list.length && !order ? ' (клик — клавиатура)' : ''), E.commands.x, cmdTop);
  // ---- низ панели: зоны жёстко закреплены (layout.json), элементы не наезжают ----
  const CHIPS_BOTTOM = E.commands.bottom;
  let listTop = cmdTop + 8;
  let kbOpen = false;
  if (kbTarget) {
    // клавиатура рисуется ВМЕСТО списка+журнала; заголовок — своей строкой
    // ниже заголовка списка, чтобы не слипались
    kbOpen = drawKeyboard(px, cmdTop + 24);
    if (kbOpen) chips = [];
    else listTop = cmdTop + 32; // заметка «подсказка скрыта» — список ниже неё
  }
  if (!kbOpen) {
    kbRect = null;
    // карточки обязаны уместиться в свою зону (layout): перебираем варианты
    // колонки/плотности по убыванию комфортности, пока не влезут
    const avail = Math.max(46, CHIPS_BOTTOM - listTop);
    const FITS = [
      { cols: 1, stride: 62, chH: 54 },
      { cols: 2, stride: 62, chH: 54 },
      { cols: 3, stride: 62, chH: 54 },
      { cols: 2, stride: 46, chH: 40 },
      { cols: 3, stride: 46, chH: 40 },
      { cols: 3, stride: 34, chH: 30 },
      { cols: 4, stride: 34, chH: 30 },
    ];
    let fit = FITS[FITS.length - 1];
    for (const f of FITS) {
      if (Math.ceil(list.length / f.cols) * f.stride <= avail) { fit = f; break; }
    }
    const cols = fit.cols, stride = fit.stride, chH = fit.chH;
    const cw = (pw - 12 * (cols - 1)) / cols;
    const S = chH >= 54
      ? { ic: cols === 1 ? 22 : 19, cf: cols === 1 ? 20 : 17, hf: cols === 1 ? 13 : 11, cy: 27, hy: 46, tx: cols === 1 ? 50 : 40, iox: cols === 1 ? 14 : 12 }
      : chH >= 40
        ? { ic: 16, cf: 16, hf: 11, cy: 21, hy: 33, tx: 32, iox: 10 }
        : cols >= 4
          ? { ic: 12, cf: 12, hf: 0, cy: 20, hy: 0, tx: 24, iox: 7 }
          : { ic: 14, cf: 15, hf: 0, cy: 20, hy: 0, tx: 28, iox: 10 };
    chips = [];
    if (list.length === 0) {
      ctx.fillStyle = '#26a69a'; rr(E.commands.x, listTop, pw, 46, 10);
      ctx.fillStyle = '#eaffea'; ctx.font = '18px Segoe UI';
      let wait = selected ? 'ждём — команды появятся, когда ячейка освободится' : 'кликни по ячейке → по команде — появится клавиатура';
      if (roadFrom) wait = 'кликни конечную точку дороги на поле — построится, пока хватает щебня';
      if (order && !selected) wait = 'кликни клетку из заказа и напечатай «письмо»';
      if (!selected && LVL.presets && LVL.presets.some(p => p.kind === 'stall')) wait = 'лавка в центре — кликни по ней, чтобы торговать; фрукты и пшеницу вырасти сам';
      if (!selected && LVL.presets && LVL.presets.some(p => p.kind === 'mountain')) wait = 'горы уже стоят на карте — кликни по горе';
      if (!selected && LVL.sea && !LVL.two) wait = 'море на краю карты — отведи реку';
      if (!selected && LVL.sea && LVL.two) wait = 'море на краю — отведи реку, потом мост и дорога к дому';
      const o = selected ? objs[cellName(selected.col, selected.row)] : null;
      if (o && o.kind === 'apple' && gardenStage(o) === 'grow') wait = 'сад растёт — скоро созреют фрукты';
      if (o && o.kind === 'field' && fieldStage(o) === 'grow') wait = 'грядка растёт — скоро можно жать или косить';
      if (o && (o.kind === 'sawmill' || o.kind === 'warehouse')) wait = 'сюда веди дорогу, команда клетке не нужна';
      if (o && o.kind === 'house' && !LVL.verbs.some(v => v.cmd === 'сносить')) wait = 'дом стоит — соедини его дорогой с мостом';
      ctx.fillText(wait, px + 12, listTop + 30);
    }
    list.forEach((c, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const x = E.commands.x + col * (cw + 12), y = listTop + row * stride;
      chips.push({ x, y, w: cw, h: chH, cmd: c.cmd });
      ctx.fillStyle = '#245c3d'; rr(x, y, cw, chH, chH >= 54 ? 10 : 8);
      ctx.strokeStyle = '#3d8a5f'; ctx.lineWidth = 2; ctx.stroke();
      // КОМАНДА — крупно, жёлтым: именно её печатать
      const v = LVL.verbs.find(vx => vx.cmd === c.cmd);
      ctx.textAlign = 'left';
      ctx.font = S.ic + 'px Segoe UI';
      ctx.fillText((v ? v.icon : '') + '', x + S.iox, y + S.cy);
      ctx.fillStyle = '#ffe066'; ctx.font = 'bold ' + S.cf + 'px Segoe UI';
      ctx.fillText(c.cmd, x + S.tx, y + S.cy);
      // описание — мелко, серым: просто доп. информация
      if (S.hf && v) {
        ctx.fillStyle = '#9dbfa5'; ctx.font = S.hf + 'px Segoe UI';
        ctx.fillText(v.hint, x + S.tx, y + S.hy);
      }
    });

    // журнал закреплён над статистикой — не наползает на команды и поле ввода
    ctx.fillStyle = '#9dbfa5'; ctx.font = 'bold 15px Segoe UI';
    ctx.fillText('ЖУРНАЛ:', E.journal.x, E.journal.labelY);
    ctx.fillStyle = '#0e2418'; rr(E.journal.x, E.journal.y, pw, E.journal.h, 10);
    ctx.font = '15px Segoe UI';
    logArr.slice(0, 3).forEach((e, i) => {
      ctx.fillStyle = e.kind === 'err' ? '#ff8a80' : e.kind === 'warn' ? '#ffe082' : '#a5d6a7';
      ctx.fillText(e.text, E.journal.x + 12, E.journal.y + 22 + i * 21);
    });
    ctx.fillStyle = '#9dbfa5'; ctx.font = '14px Segoe UI';
    ctx.fillText('Команд: ' + stats.typed + ' · точность: ' + acc + '% · рабочих: ' + workers.filter(w => w.phase !== 'leave').length, E.stats.x, E.stats.y);
  }
  ctx.fillStyle = '#ffe066'; ctx.font = 'bold 16px Segoe UI';
  let sel = '—';
  if (selected && selected2) sel = cellName(selected.col, selected.row) + ' → ' + cellName(selected2.col, selected2.row);
  else if (selected) sel = cellName(selected.col, selected.row);
  ctx.fillText('Ячейка: ' + sel + ' · Введи команду и нажми Enter:', E.cell_prompt.x, E.cell_prompt.y);
}

function drawWin() {
  const allDone = levelIdx >= LEVELS.length - 1;
  ctx.fillStyle = 'rgba(6,20,12,0.85)'; ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe066'; ctx.font = 'bold 52px Segoe UI';
  ctx.fillText(allDone ? 'ВСЯ ИГРА ПРОЙДЕНА! 🏆' : 'УРОВЕНЬ ПРОЙДЕН! 🎉', W / 2, 170);
  // звёзды
  ctx.font = '56px Segoe UI';
  for (let i = 0; i < 5; i++) {
    const on = i < lastWinStars;
    const t = now * 2 - i * 0.3;
    const sc = on && t > 0 ? 1 + Math.max(0, 0.5 - t) * 1.6 : 1;
    ctx.save();
    ctx.translate(W / 2 + (i - 2) * 76, 240);
    ctx.scale(sc, sc);
    ctx.fillText(on ? '⭐' : '☆', 0, 0);
    ctx.restore();
  }
  ctx.fillStyle = '#eaffea'; ctx.font = '26px Segoe UI';
  const acc2 = accPct();
  let li = 0;
  LVL.goal.forEach(g => {
    ctx.fillText(capitalize(goalName(g)) + ': ' + goalVal(g) + ' / ' + g.n, W / 2, 320 + li * 38); li++;
  });
  if (LVL.noStumps) {
    ctx.fillText('Пни: выкорчевано ' + stats.stumpsCleared + ' · на поле ' + countKind('stump') + ' ✓', W / 2, 320 + li * 38); li++;
  }
  const y2 = 320 + li * 38;
  ctx.font = '22px Segoe UI';
  ctx.fillText('Точность печати: ' + acc2 + '%', W / 2, y2 + 10);
  // за что звёзды — коротко и честно
  ctx.font = '17px Segoe UI'; ctx.fillStyle = '#b9e4bd';
  const critW = starForecast();
  const whyStars = [
    critW[1] && critW[2] ? 'точность ≥95 ✓' : critW[1] ? 'точность ≥85 ✓, до 95 не хватило' : 'точность ниже 85',
    critW[3] ? 'без подсказок ✓' : 'открывал подсказку',
    critW[4] ? 'пузыри ✓' : 'пузырей мало (' + poppedBubbles + '/' + bubblesNeed() + ')',
  ];
  ctx.fillText('★ прохождение · ★ ' + whyStars.join(' · ★ '), W / 2, y2 + 40);
  // открытия: команды этого уровня теперь доступны везде
  const own = (LEVELS[levelIdx].verbs || []).filter(v => ['build', 'work', 'clear', 'burn'].includes(v.run));
  if (own.length) {
    ctx.fillStyle = '#7ee787';
    ctx.fillText('🔓 Открыто навсегда: ' + own.map(v => v.cmd).join(', '), W / 2, y2 + 68);
  }
  ctx.font = '22px Segoe UI';
  ctx.fillText('Команд введено: ' + stats.typed + ' · время: ' + Math.round(winTime) + ' сек (демо не сохраняется)', W / 2, y2 + 94);
  ctx.fillStyle = Math.sin(Date.now() / 300) > 0 ? '#ffe066' : '#ffca28';
  ctx.font = 'bold 26px Segoe UI';
  ctx.fillText('Enter — карта города' + (newlyUnlocked.length ? ' · открылось: ' + newlyUnlocked.length + '!' : ''), W / 2, y2 + 130);
  ctx.fillStyle = '#9dbfa5'; ctx.font = '18px Segoe UI';
  ctx.fillText('Esc — меню уровней', W / 2, y2 + 135);
}
const capitalize = s => s ? s[0].toUpperCase() + s.slice(1) : s;

function draw() {
  if (state === 'menu') { drawMenu(); return; }
  if (state === 'shop') { drawShop(); return; }
  if (state === 'city') { drawCity(); return; }
  if (state === 'parents') { drawParents(); return; }
  if (state === 'settings') { drawSettings(); return; }
  if (state === 'rain') { drawRain(); drawWinOverlay(); if (demo && demo.on) drawDemoOverlay(); return; }
  ctx.fillStyle = TH().bg; ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - .5) * shake * 30, (Math.random() - .5) * shake * 30);
  drawGrid();
  for (const k in objs) drawObject(objs[k]);
  for (const w of workers) drawWorker(w);
  for (const q of particles) {
    ctx.globalAlpha = Math.min(1, q.life * 2);
    ctx.fillStyle = q.col; ctx.fillRect(q.x, q.y, q.size, q.size);
  }
  ctx.globalAlpha = 1;
  for (const f of floats) {
    ctx.globalAlpha = Math.min(1, f.life * 1.5);
    ctx.fillStyle = f.col || '#ffe066';
    ctx.font = 'bold ' + Math.min(22, Math.max(13, CELL * 0.4)) + 'px Segoe UI'; ctx.textAlign = 'center';
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // бонус-пузыри со словами
  for (const b of bubbles) {
    const a = Math.min(1, b.life / 1.5);
    ctx.globalAlpha = a;
    ctx.font = 'bold 20px Segoe UI';
    const tw = ctx.measureText(b.word).width;
    const bw2 = tw + 20, bx2 = b.x - bw2 / 2, by2 = b.y - 24, bh2 = 40;
    ctx.fillStyle = 'rgba(13,40,60,0.85)';
    ctx.strokeStyle = b.col; ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx2, by2, bw2, bh2, 14); else ctx.rect(bx2, by2, bw2, bh2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e1f5fe'; ctx.textAlign = 'center';
    ctx.fillText(b.word, b.x, b.y - 1);
    // шкала времени: слово стоит печатать, пока полоска не истаяла
    const frac = Math.max(0, Math.min(1, b.life / (b.max || BUBBLE_LIFE)));
    const low = frac <= 0.25;
    const pulse = low ? 0.6 + 0.4 * Math.sin(now * 10) : 1; // на исходе — мигает
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(bx2 + 7, by2 + bh2 - 9, bw2 - 14, 4);
    ctx.fillStyle = frac > 0.5 ? b.col : frac > 0.25 ? '#ffe066' : '#ff8a80';
    ctx.globalAlpha = a * pulse;
    ctx.fillRect(bx2 + 7, by2 + bh2 - 9, Math.max(0.5, (bw2 - 14) * frac), 4);
    ctx.globalAlpha = 1;
  }
  drawPanel();
  if (state === 'play') drawTutorial();
  if (state === 'win') drawWin();
  if (demo && demo.on) drawDemoOverlay();
}
function drawWinOverlay() { if (state === 'win') drawWin(); }

let last = performance.now();
function loop(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t; now = t / 1000;
  if (demo && demo.on) { if (!demo.paused) demoTick(dt); }
  else if (state === 'play' && !simHold) update(dt);
  else if (state === 'rain' && !simHold) rainUpdate(dt);
  else if (state === 'city') cityUpdate(dt);
  else { for (const q of particles) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; } particles = particles.filter(q => q.life > 0); }
  input.style.display = (state === 'menu' || state === 'shop' || state === 'parents' || state === 'settings') ? 'none' : '';
  if (state === 'play') tutTick();
  draw();
  requestAnimationFrame(loop);
}

input.addEventListener('keydown', e => {
  if (demo && demo.on) {
    // в демо ввод заблокирован, Esc — выход
    if (e.key === 'Escape') demoStop();
    e.preventDefault();
    return;
  }
  if (e.key === 'Enter') { submit(); e.preventDefault(); }
  if (e.key === 'Escape') {
    if (state === 'win') { state = 'menu'; mapCenterOn(mapFrontier()); }
    else if (state === 'shop' || state === 'parents' || state === 'settings' || state === 'city') state = 'menu';
    else if (kbTarget) kbTarget = null;
    else if (selected2) selected2 = null;
    else if (tutSkip()) { /* туториал пропущен */ }
    else selected = null;
    setConfirm = false;
  }
  if (e.key.length === 1 && (state === 'play' || state === 'rain')) {
    TELEM.chars++;
    if (kbTarget) {
      const raw = input.value.toLowerCase();
      let i = 0;
      while (i < raw.length && i < kbTarget.length && raw[i] === kbTarget[i]) i++;
      if (i < kbTarget.length && e.key.toLowerCase() !== kbTarget[i]) {
        TELEM.keyErrors[kbTarget[i]] = (TELEM.keyErrors[kbTarget[i]] || 0) + 1;
      }
    }
  }
  e.stopPropagation();
});
addEventListener('keydown', e => {
  if (state === 'menu') {
    if (/^[1-9]$/.test(e.key)) {
      const pick = unlockedList()[parseInt(e.key, 10) - 1];
      if (pick !== undefined) { lockedPick = -1; applyLevel(pick); reset(); }
    }
    return;
  }
  if (document.activeElement !== input && !e.ctrlKey && !e.metaKey && !e.altKey) input.focus();
});

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}
canvas.addEventListener('mousemove', e => {
  const p = canvasPos(e);
  if (state === 'menu') {
    hoverNodeIdx = -1;
    for (const n of mapNodes)
      if (Math.hypot(p.x - n.x, p.y - n.y) <= n.r + 4) hoverNodeIdx = n.idx;
    return;
  }
  const c = Math.floor((p.x - GRID_OX) / CELL), r = Math.floor((p.y - GRID_OY) / CELL);
  hover = (c >= 0 && c < N && r >= 0 && r < N) ? { col: c, row: r } : null;
});
canvas.addEventListener('mouseleave', () => { hover = null; hoverNodeIdx = -1; });
canvas.addEventListener('wheel', e => {
  if (state === 'menu' && MAP_MAX_SCROLL > 0) {
    // колесо вниз — вид идёт вниз по карте (к началу, низ), вверх — к вершине
    mapScrollY = Math.max(0, Math.min(MAP_MAX_SCROLL, mapScrollY + (e.deltaY > 0 ? 80 : -80)));
    e.preventDefault();
  }
}, { passive: false });
let wasMapDrag = false; // был отпуск после драга карты — подавить следующий клик
canvas.addEventListener('mousedown', e => {
  if (state !== 'menu') return;
  wasMapDrag = false;
  if (MAP_MAX_SCROLL > 0) {
    const sb = mapSb(), p = canvasPos(e);
    // захват ползунка скроллбара (с небольшим запасом по краям для удобства)
    if (p.x >= sb.x - 6 && p.x <= sb.x + sb.w + 6 && p.y >= sb.trY && p.y <= sb.trY + sb.trH) {
      const ty = mapSbThumbY();
      const onThumb = p.y >= ty && p.y <= ty + sb.th2;
      // off — смещение курсора от верха ползунка; клик по дорожке центрирует ползунок на курсоре
      mapDrag = { thumb: onThumb ? p.y - ty : sb.th2 / 2, moved: true };
      mapScrollY = mapSbFromY(p.y, mapDrag.thumb);
      return;
    }
  }
  mapDrag = { y: e.clientY, scroll: mapScrollY, moved: false };
});
addEventListener('mouseup', () => { wasMapDrag = !!(mapDrag && mapDrag.moved); mapDrag = null; });
canvas.addEventListener('mousemove', e => {
  if (mapDrag && state === 'menu') {
    if (mapDrag.thumb !== undefined) { mapScrollY = mapSbFromY(canvasPos(e).y, mapDrag.thumb); return; }
    const dy = e.clientY - mapDrag.y;
    if (Math.abs(dy) > 5) mapDrag.moved = true;
    if (mapDrag.moved) {
      const rect = canvas.getBoundingClientRect();
      mapScrollY = Math.max(0, Math.min(MAP_MAX_SCROLL, mapDrag.scroll - dy * (720 / rect.height)));
    }
  }
});
canvas.addEventListener('click', e => {
  if (state === 'menu' && wasMapDrag) { wasMapDrag = false; return; } // это был драг, не клик
  const p = canvasPos(e);
  if (demo && demo.on) {
    // управление демо: скорость/пауза/стоп; остальные клики игнорируем
    for (const id in demoBtns) {
      const b = demoBtns[id];
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        if (id === 'stop') demoStop();
        else if (id === 'pause') demo.paused = !demo.paused;
        else if (id === 'skip') demoGoto(demo.i + 1);
        else if (id === 'sp05') demo.speed = 0.5;
        else if (id === 'sp1') demo.speed = 1;
        else if (id === 'sp2') demo.speed = 2;
        else if (id === 'sp4') demo.speed = 4;
        beep(600, 0.06, 'triangle', 0.08);
        return;
      }
    }
    return;
  }
  if (state === 'menu') {
    for (const id in menuBtns) {
      const b = menuBtns[id];
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        if (id === 'shop') { state = 'shop'; beep(700, 0.08, 'triangle'); }
        else if (id === 'city') { state = 'city'; citySyncPets(); log('Ставь вещи: «фонтан г4»', 'info'); beep(700, 0.08, 'triangle'); }
        else if (id === 'parents') { state = 'parents'; beep(700, 0.08, 'triangle'); }
        else if (id === 'settings') { state = 'settings'; beep(700, 0.08, 'triangle'); }
        else if (id === 'demo') { beep(700, 0.08, 'triangle'); demoStart(mapFrontier(), 1); }
        return;
      }
    }
    for (const n of mapNodes) {
      if (Math.hypot(p.x - n.x, p.y - n.y) <= n.r + 4) {
        if (levelUnlocked(n.idx)) { lockedPick = -1; applyLevel(n.idx); reset(); beep(600, 0.1, 'triangle'); }
        else { lockedPick = n.idx; beep(180, 0.15, 'sawtooth', 0.1); }
        return;
      }
    }
    return;
  }
  if (state === 'shop') { shopClick(p); return; }
  if (state === 'parents') {
    for (const id in parBtns) {
      const b = parBtns[id];
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        if (id === 'back') state = 'menu';
        if (id === 'export') exportSave();
        beep(500, 0.06, 'triangle', 0.08);
        return;
      }
    }
    return;
  }
  if (state === 'settings') {
    for (const id in setBtns) {
      const b = setBtns[id];
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        if (id === 'mute') SAVE.settings.mute = !SAVE.settings.mute;
        else if (id === 'kb') SAVE.settings.kb = { 'яркая': 'тусклая', 'тусклая': 'скрытая', 'скрытая': 'яркая' }[SAVE.settings.kb];
        else if (id === 'theme') {
          const themesOwned = ['classic'].concat(SAVE.owned.filter(i => i.startsWith('th-')).map(i => i.slice(3)));
          const cur = themesOwned.indexOf(SAVE.settings.theme);
          SAVE.settings.theme = themesOwned[(cur + 1) % themesOwned.length] || 'classic';
        }
        else if (id === 'dev') SAVE.settings.dev = !SAVE.settings.dev;
        else if (id === 'reset') {
          if (!setConfirm) { setConfirm = true; }
          else { clearAllProgress(); setConfirm = false; }
        }
        else if (id === 'back') state = 'menu';
        persistSave();
        beep(500, 0.06, 'triangle', 0.08);
        return;
      }
    }
    return;
  }
  if (state === 'city') {
    if (cityBtn && p.x >= cityBtn.x && p.x <= cityBtn.x + cityBtn.w && p.y >= cityBtn.y && p.y <= cityBtn.y + cityBtn.h) {
      state = 'menu'; beep(400, 0.08, 'triangle');
      return;
    }
    return;
  }
  if (state === 'rain') return;
  if (menuBtn && p.x >= menuBtn.x && p.x <= menuBtn.x + menuBtn.w && p.y >= menuBtn.y && p.y <= menuBtn.y + menuBtn.h) {
    state = 'menu'; mapCenterOn(mapFrontier()); beep(400, 0.08, 'triangle');
    return;
  }
  if (kbClose && p.x >= kbClose.x && p.x <= kbClose.x + kbClose.w && p.y >= kbClose.y && p.y <= kbClose.y + kbClose.h) {
    kbTarget = null; input.focus(); return;
  }
  for (const c of chips) {
    if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) {
      kbTarget = c.cmd; hintUses++; input.focus(); beep(700, 0.07, 'triangle', 0.08);
      return;
    }
  }
  if (LVL.noClick) { log('Мышка отключена — печатай адрес клетки, например «б3»', 'warn'); return; }
  const c = Math.floor((p.x - GRID_OX) / CELL), r = Math.floor((p.y - GRID_OY) / CELL);
  if (c >= 0 && c < N && r >= 0 && r < N) {
    if (roadFrom) {
      // дорога ждёт конечную точку: этот клик и есть конец
      const from = roadFrom;
      roadFrom = null;
      buildRoad(from, { col: c, row: r });
      input.focus();
      return;
    }
    if (LVL.two) {
      if (!selected || (selected.col === c && selected.row === r)) selected = { col: c, row: r };
      else if (!selected2) selected2 = { col: c, row: r };
      else { selected = { col: c, row: r }; selected2 = null; }
    } else {
      selected = { col: c, row: r };
      selected2 = null;
    }
    beep(500, 0.05, 'triangle', 0.07);
    input.focus();
  }
});
function clearAllProgress() {
  SAVE = { done: {}, best: {}, keys: {}, chars: 0, wins: 0, stars: {}, spent: 0, owned: [], city: {}, settings: SAVE.settings, history: [] };
  persistSave();
  log('Прогресс сброшен', 'warn');
}

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H, 1.2);
  document.getElementById('wrap').style.transform = 'scale(' + s + ')';
}
addEventListener('resize', fit); fit();

// подсказка для планшетов/телефонов: нужна физическая клавиатура
try {
  if (matchMedia('(pointer: coarse) and (not (any-pointer: fine))').matches) {
    const d = document.createElement('div');
    d.textContent = '⌨️ Печатному Городу нужна настоящая клавиатура — открой игру на компьютере или ноутбуке';
    d.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);max-width:90%;text-align:center;' +
      'background:#ffe066;color:#17382a;font:bold 15px "Segoe UI",sans-serif;padding:10px 18px;border-radius:10px;' +
      'z-index:99;box-shadow:0 2px 12px rgba(0,0,0,.4)';
    document.body.appendChild(d);
  }
} catch (e) {}

// ---------- отладочный API для автотестов (test/harness.js) ----------
window.__test = {
  count: () => LEVELS.length,
  levels: () => LEVELS.map(L => ({ name: L.name, verbs: L.verbs.map(v => v.cmd), goal: goalsOf(L), mode: L.mode || 'grid' })),
  solutions: () => SOLUTIONS,
  hold: v => { simHold = !!v; },
  start(i) { simHold = true; applyLevel(i); reset(); },
  phase: () => state,
  playT: () => Math.round(playT * 10) / 10,
  select(c, r) { selected = { col: c, row: r }; selected2 = null; },
  select2(c, r) { selected2 = { col: c, row: r }; },
  type(cmd) { input.value = cmd; submit(); return Object.assign({}, lastSubmit); },
  tick(dt) { if (state === 'rain') rainUpdate(dt); else update(dt); },
  goals: () => LVL.goal.map(g => ({ name: goalName(g), val: goalVal(g), n: g.n })),
  goalMet,
  resources: () => Object.assign({}, resources),
  objs: () => JSON.parse(JSON.stringify(objs)),
  busy: () => ({
    workers: workers.filter(w => w.phase !== 'leave').length,
    burning: Object.keys(objs).filter(k => objs[k].burning).length,
  }),
  log: () => logArr.map(e => e.text),
  save: () => JSON.parse(JSON.stringify(SAVE)),
  telem: () => JSON.parse(JSON.stringify({ events: TELEM.events.slice(-60), keyErrors: TELEM.keyErrors, chars: TELEM.chars })),
  clearSave() { SAVE = { done: {}, best: {}, keys: {}, chars: 0, wins: 0, stars: {}, spent: 0, owned: [], city: {}, settings: SAVE.settings, history: [] }; persistSave(); },
  currentWord: () => currentWord(),
  rainWords: () => rainWords.map(w => w.word),
  rainTick: dt => rainUpdate(dt),
  acc: () => accPct(),
  stats: () => Object.assign({}, stats),
  demoStart: (i, sp) => demoStart(i, sp),
  demoStop: () => demoStop(),
  demoInfo: () => demo ? { on: demo.on, level: demo.i + 1, step: demo.step, phase: demo.phase, speed: demo.speed, msg: demo.msg } : null,
};

// Старт: сначала пробуем подхватить layout.json (раскладка из верстака
// layout.html), затем запускаем игру. Без файла (file://) — дефолтная раскладка.
(async function boot() {
  try {
    const r = await fetch('layout.json', { cache: 'no-store' });
    if (r.ok) applyLayout(await r.json());
  } catch (e) { /* нет файла или file:// — работаем на дефолтах */ }
  // ?level=N применяется своим таймером — не перекрываем его меню
  if (!/[?&]level=\d+/.test(location.search)) {
    applyLevel(0);
    state = 'menu';
  }
  requestAnimationFrame(loop);
})();

// ?level=N — сразу открыть уровень N (1–30), удобно для тестирования
(function () {
  const m = location.search.match(/[?&]level=(\d+)/);
  if (m) {
    const i = Math.min(LEVELS.length, Math.max(1, parseInt(m[1], 10))) - 1;
    setTimeout(() => { applyLevel(i); reset(); }, 0);
  }
})();

// ?demo=N — демо конкретного уровня, ?demo — с первого непройденного
(function () {
  const m = location.search.match(/[?&]demo=(\d+)/);
  if (m) { setTimeout(() => demoStart(parseInt(m[1], 10) - 1, 1), 500); return; }
  if (/[?&]demo\b/.test(location.search)) setTimeout(() => demoStart(firstNotDoneLevel(), 1), 500);
})();

// автозапуск тестов: index.html?test=1
if (/[?&]test=1/.test(location.search)) {
  const s = document.createElement('script');
  s.src = 'test/harness.js';
  s.onerror = () => console.error('Не загрузился test/harness.js');
  document.body.appendChild(s);
}
