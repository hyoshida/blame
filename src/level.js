// Level map, built with a tiny painter so sections can be placed by coordinates.
// World: 100 x 152 tiles. A horizontal tutorial band runs along the bottom
// (x 0-80), then the tower rises at x 81-98, with a hidden sky ("heaven") on top.
//
// Tiles:  # rock   = ice   g glass (bullets pass)   x crack (shoot to break)
//         m metal (bullets bounce)   c cloud   ^ v < > spikes (touch = miss)
// Things: o crystal (refill; touch it OR shoot it)   * feather (collectible)
//         1-9 sign   F summit flag   H heaven gate   P start
// (x 0-80 is an open field with sky; the tower's outer wall is x 76-80)
(function (root) {
  const W = 100, H = 152;
  const G = [...Array(H)].map(() => Array(W).fill('#'));
  const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) G[y][x] = c; };
  const put = (x, y, c) => { G[y][x] = c; };
  const stamp = (x0, y0, rows) => rows.forEach((r, j) => [...r].forEach((c, i) => { if (c !== ' ') G[y0 + j][x0 + i] = c; }));

  // ---------------------------------------------------------------- tutorial band
  // Open-air field: sky above everything left of the tower's outer wall (x 76-80).
  rect(1, 0, 75, 149, '.');
  rect(76, 140, 79, 149, '.');
  rect(11, 148, 22, 149, '#');   // 2-tile step
  rect(23, 145, 30, 149, '#');   // 3-tile wall
  rect(31, 149, 40, 149, '^');   // gap 1: needs a second shot in the air
  rect(41, 145, 48, 149, '#');
  rect(49, 149, 62, 149, '^');   // gap 2: floating crystal
  rect(63, 145, 67, 149, '#');
  rect(68, 149, 79, 149, '^');   // gap 3: crystals caged in glass below
  stamp(72, 146, ['^^^^^', 'ggggg', 'gooog', 'ggggg']);
  put(55, 143, 'o');
  // floating rock with a feather sealed inside (crack underneath)
  stamp(24, 134, [' ### ', '##*##', ' #x# ']);
  put(2, 149, 'P');
  put(4, 149, '1');
  put(9, 149, '2');
  put(24, 144, '7');
  put(29, 144, '3');
  put(45, 144, '4');
  put(65, 144, '5');
  rect(80, 140, 80, 144, '.');   // doorway into the tower

  // ---------------------------------------------------------------- tower (x 81-98)
  const T = {
    // heaven
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
    34: '######xxxxxx######',
    // summit
    37: '.......F.9........',
    38: '......####........',
    // crystal garden
    42: 'mmmmmm............',
    44: '#x##........8.....',
    45: '#*#.........####..',
    46: '###...............',
    55: '.^^^..............',
    56: '.ggg..............',
    57: '.gog.###..........',
    58: '.ggg..............',
    // spike chimney (zigzag ledges, 3-wide openings)
    64: '######......######',
    65: '######>.....######',
    66: '######>.....######',
    67: '######......######',
    68: '######...#########',
    69: '######.....<######',
    70: '######.....<######',
    71: '######......######',
    72: '#########...######',
    73: '######>.....######',
    74: '######>.....######',
    75: '######......######',
    76: '######...#########',
    77: '######.....<######',
    78: '######.....<######',
    79: '####*x......######',
    80: '#########...######',
    81: '######>.....######',
    82: '######>.....######',
    83: '######......######',
    84: '######...#########',
    85: '######......######',
    86: '######......######',
    87: '######......######',
    88: '######......######',
    // ice
    91: '.......###########',
    97: '......====........',
    99: '...............###',
    100: '...............x*.',
    101: '====...........###',
    105: '............======',
    109: '......=====.......',
    // zigzag
    113: '###...............',
    117: '..........####....',
    121: '.....###..........',
    125: '.............#####',
    129: '.......####.......',
    133: '###...............',
    137: '......####........',
    141: '............######',
    144: '...6..............',
  };
  for (let y = 1; y <= 144; y++) stamp(81, y, [T[y] || '..................']);

  const ROWS = G.map((r) => r.join(''));
  const SIGNS = {
    1: 'ドラッグして離すと、その向きに撃つ。\n反動で、反対側へ飛ぶ。',
    2: '引っぱる長さで、強さが変わる。\n斜め下に撃てば、跳べる。',
    3: '空中でも、もう1発撃てる。\n弾は2発。着地で回復する。',
    4: '緑の結晶に触れると、\n空中でも弾が回復する。',
    5: 'ガラスは、弾だけを通すらしい。',
    6: 'ここから塔を登る。\n落ちても、死にはしない。',
    7: 'ひび割れた岩は、もろい。',
    8: '金属に当たった弾は、跳ね返る。',
    9: '頂上だ。\n…天井のひび割れが、気になる。',
  };
  const API = { ROWS, SIGNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.LEVEL = API;
})(typeof window !== 'undefined' ? window : globalThis);
