// Level map, built with a tiny painter so sections can be placed by coordinates.
// World: 140 x 172 tiles. An open field runs along the bottom (x 1-115), the tower
// rises at x 120-137, and a hidden sky ("heaven") sits above the summit.
//
// Tiles:  # rock   = ice   g glass (bullets pass)   x crack (breaker rounds break it)
//         m metal (bullets bounce)   c cloud   d door   T target (shoot: opens nearby doors)
//         ^ v < > spikes (touch = miss)
// Things: o crystal (refill: touch it OR shoot it)   * feather (collectible)
//         A spare magazine (+1 air shot)   B breaker rounds   K piercing rounds (glass)   M magnum rounds
//         1-9 sign   F summit flag   H heaven gate   P start
//
// Progression: field (0 air shots) -> A -> field gaps -> tower: target door -> B -> crack ceiling
// -> ice -> A -> tall shaft -> K -> target in a glass box -> caged-crystal garden -> M -> summit
// -> (cracked ceiling + crystal chain) -> heaven.
(function (root) {
  const W = 140, H = 172;
  const G = [...Array(H)].map(() => Array(W).fill('#'));
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) G[y][x] = c; };
  const put = (x, y, c) => { G[y][x] = c; };
  const stamp = (x0, y0, rows) => rows.forEach((r, j) => [...r].forEach((c, i) => { if (c !== ' ') G[y0 + j][x0 + i] = c; }));

  // ---------------------------------------------------------------- field
  rect(1, 0, 115, 169, '.');            // open sky over the field
  const ground = (x0, x1, top) => rect(x0, top, x1, 171, '#');
  ground(1, 12, 170);                   // start
  ground(13, 22, 168);                  // small step
  ground(23, 30, 166);                  // another step
  ground(31, 34, 169);                  // shallow dip (4 wide)
  ground(35, 42, 166);
  ground(43, 48, 169);                  // dip (6 wide)
  ground(49, 58, 166);                  // magazine here
  ground(59, 73, 170);                  // 15-wide: needs the air shot
  rect(59, 169, 73, 169, '^');          //   (spikes: a miss just returns you to the ledge)
  ground(74, 78, 166);
  ground(79, 94, 170);                  // 16-wide with a floating crystal (safe pit)
  ground(95, 100, 166);
  ground(101, 113, 170);                // 13-wide: a low crystal to shoot while crossing
  ground(114, 115, 166);
  put(107, 168, 'o');
  put(86, 161, 'o');
  put(54, 165, 'A');
  // feathers: one sealed in a floating rock (needs breaker), one on a high sky ledge
  stamp(40, 154, [' ### ', '##*##', ' #x# ']);
  stamp(7, 151, ['.*.', '###']);
  put(2, 169, 'P');
  put(4, 169, '1');
  put(10, 169, '2');
  put(38, 165, '3');
  put(56, 165, '4');
  put(75, 165, '5');
  put(98, 165, '6');

  // ---------------------------------------------------------------- tower (x 120-137)
  rect(116, 161, 119, 165, '.');        // doorway
  const T = {
    // heaven (above the cracked ceiling)
    3: '........H.........',
    4: '.......ccc........',
    8: '...o..............',
    11: '............o.....',
    12: '.................c',
    14: '.....o............',
    17: '..........o.......',
    19: '..............cc..',
    21: '....o.............',
    24: '..........o.......',
    26: '..cc..........*...',
    28: '.......o..........',
    31: '............o.....',
    35: '######xxxxxx######',
    // summit
    39: '......F.9.........',
    40: '.....#####........',
    // magnum ledge (garden top)
    62: '.............M....',
    63: '...........######.',
    66: '.................m',
    68: '.................m',
    69: '.................m',
    70: '.................m',
    // caged-crystal garden (needs a remote refill)
    67: '.*................',
    72: '.^^^..............',
    73: '.ggg..............',
    74: '.gog..............',
    75: '.ggg..............',
    76: '######dddd########',
    // piercing room: the target sits in a glass box
    78: '.............ggg..',
    79: '.............gTg..',
    80: '.............ggg..',
    82: '.......K..........',
    83: '....##############',
    // tall shaft (needs 3 shots)
    96: '..A...............',
    97: '######............',
    // ice
    102: '....=====.........',
    106: '...........=======',
    110: '###...............',
    111: '.*x...............',
    112: '###...............',
    114: '.......======.....',
    118: '===...............',
    122: '..........======..',
    // cracked ceiling (breaker rounds)
    127: '######xxxxxx######',
    130: '..B...............',
    131: '#####.............',
    133: '......#####.......',
    137: '.............#####',
    // target + door
    142: '######dddd########',
    144: 'T.................',
    145: '...............8..',
    146: '.............#####',
    150: '.......######.....',
    154: '######............',
    158: '.....######.......',
    162: '............######',
    165: '..7...............',
  };
  for (let y = 1; y <= 165; y++) stamp(120, y, [T[y] || '..................']);

  const ROWS = G.map((r) => r.join(''));
  const SIGNS = {
    1: 'ドラッグして離すと、その向きに撃つ。\n反動で、反対側へ飛ぶ。',
    2: '引っぱる長さで、強さが変わる。\n斜め下に撃てば、跳べる。',
    3: 'いまは着地するまで、次の弾が撃てない。\n小さく跳んで進もう。',
    4: 'この先の谷は、空中でもう1発撃って越える。',
    5: '緑の結晶に触れると、空中でも弾が回復する。',
    6: '谷底の結晶…\n降りずに使えないかな。',
    7: 'ここから塔を登る。\n落ちても、死にはしない。',
    8: '赤い的は、何かの仕掛けらしい。',
    9: '頂上だ。\n…天井のひび割れが、気になる。',
  };
  const API = { ROWS, SIGNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.LEVEL = API;
})(typeof window !== 'undefined' ? window : globalThis);
