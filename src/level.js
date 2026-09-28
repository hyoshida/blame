// Level map, built with a tiny painter so sections can be placed by coordinates.
// World: 140 x 172 tiles. An open field runs along the bottom (x 1-115), the tower
// rises at x 120-137, and a hidden sky ("heaven") sits above the summit.
//
// Tiles:  # rock   = ice   g glass (bullets pass)   x crack (breaker rounds break it)
//         m metal (bullets bounce)   h hidden walkway (solid; only seen by the light of a shot)   c cloud   d door   T target (shoot: opens nearby doors)
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
  // ---- knowledge chain (never explained; the records hint at the next step)
  // R1: easy ledge right after the first magazine -> tells about wall blasts
  stamp(52, 160, ['###']); put(53, 159, '*');
  // R2: high ledge near the tower's outer wall; reachable early only by a wall blast off the scorched wall
  stamp(107, 152, ['####']); put(108, 151, '*');
  // hidden walkway from R2 up and left to R3 (tells about shooting cells below you)
  stamp(99, 148, ['hhh']); stamp(91, 144, ['hhh']); stamp(83, 140, ['hhh']); stamp(75, 136, ['hhhh']); put(76, 135, '*');
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
    // hidden step: lets someone who knows skip the second magazine
    90: '.......hhh........',
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
  // soot on wall faces where a wall blast is useful: [tile x, tile y, side the soot faces (-1 left, 1 right)]
  const SCORCH = [];
  for (let y = 152; y <= 164; y += 3) SCORCH.push([116, y, -1]);   // tower outer wall, field side
  for (let y = 154; y <= 168; y += 4) SCORCH.push([0, y, 1]);      // world's left edge, by the start
  for (let y = 44; y <= 60; y += 4) SCORCH.push([138, y, -1]);     // beside the summit climb
  // record shard logs, keyed by tile "x,y"
  const RECORDS = {
    '53,159': '焦げた壁を見たら、銃口を押し当てて撃て。\n反動は、ずっと強くなる。',
    '108,151': '光の届くあいだだけ、見える道がある。\n暗がりに向けて、撃ってみろ。',
    '76,135': '青い光は、撃っても満ちる。\n宙に浮かぶ光を、下へ撃て。撃つたび、昇れる。',
    '42,155': 'この構造体に、上限はない。\n…と、最初の登攀者は書いた。',
    '8,151': '間を置かずに撃て。\n勢いは、重なる。',
    '121,111': '最上層で、脆い天井を見た。\n隙間から、光が漏れていた。',
    '121,67': '金属は、弾を返す。\n正面から撃てないものも、ある。',
    '134,26': '外に出た。\nこの記録を読む者が、次の私だ。',
  };
  const SIGNS = {
    1: '指を引いて、放せ。その向きに撃つ。\n反動が、お前を反対へ運ぶ。',
    2: '深く引くほど、遠くへ。\n足もとを撃てば、身体は浮く。',
    3: '――まだ、宙では撃てない。\n地に足をつけて、次を待て。',
    4: 'この先は、宙で二度目を撃て。\n落ちても、少し戻されるだけだ。',
    5: '青い光に触れれば、弾は満ちる。\n宙にいても。',
    6: '下で光っている。\n…触れずとも、届くものがある。',
    7: 'ここより上へ。\n落ちても、終わりはしない。\n――終わることは、ない。',
    8: '赤い眼が、こちらを見ている。\n閉ざしたのは、あれだ。',
    9: '最上層――のはずだった。\n天井の亀裂から、何かが漏れている。',
  };
  // extra terminals with their own text: [tile x, tile y, text]
  const EXTRA_SIGNS = [
    [78, 135, '――道は、ここで途切れている。\n光の中にしか、道はない。\n…ほかの闇にも、あるのだろう。'],
  ];
  const API = { ROWS, SIGNS, SCORCH, RECORDS, EXTRA_SIGNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.LEVEL = API;
})(typeof window !== 'undefined' ? window : globalThis);
