// Level map, built with a tiny painter so sections can be placed by coordinates.
// World: 140 x 330 tiles. An open field runs along the bottom (x 1-115), the tower rises at
// x 120-137, a long detour leaves the tower across the void (x ~20-115, rows ~180-245), and a
// hidden sky ("outside") sits above the summit.
//
// Tiles:  # rock   = wet slick floor   g glass (bullets pass with piercing rounds)
//         x crack (breaker rounds)   X reinforced crack (breaker + magnum together)
//         m metal (bullets bounce)   h hidden walkway (solid; only seen by the light of a shot)
//         c girder fragment   d door   T sensor (shoot: opens nearby doors)   ^ v < > shards (touch = miss)
// Things: o energy cell (refill: touch it OR shoot it)   * record shard (collectible)
//         A spare magazine (+1 air shot)   B breaker rounds   K piercing rounds   M magnum rounds
//         1-9 terminal   F summit flag   H outside gate   P start
//
// Route (item-only): field and foundry with a single shot -> magazine -> wet decks -> shard chimney ->
// breaker rounds -> out across the void, up a pillar, back through a cracked wall -> glass hall ->
// piercing rounds -> glass sensor door -> cell garden -> magazine -> tall shafts -> magnum rounds ->
// summit wall -> reinforced ceiling (breaker + magnum) -> outside.
// Every item sits out in the open on the way. Exactly one pickup is tucked into a gap: a record shard.
(function (root) {
  // The map is painted in two parts: the sky above the tower ("outside", rows 0..OY-1, painted with
  // s* helpers) and everything else (painted with coordinates relative to the tower part, shifted by OY).
  const W = 140, H0 = 330, OY = 250, H = H0 + OY;
  const G = [...Array(H)].map(() => Array(W).fill('#'));
  const srect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) G[y][x] = c; };
  const sput = (x, y, c) => { G[y][x] = c; };
  const rect = (x0, y0, x1, y1, c) => srect(x0, y0 + OY, x1, y1 + OY, c);
  const put = (x, y, c) => sput(x, y + OY, c);
  const stamp = (x0, y0, rows) => rows.forEach((r, j) => [...r].forEach((c, i) => { if (c !== ' ') G[y0 + j + OY][x0 + i] = c; }));

  // ================================================================ field (one shot only)
  rect(1, 0, 115, 327, '.');            // the open void over the field
  const ground = (x0, x1, top) => rect(x0, top, x1, H0 - 1, '#');
  ground(1, 12, 328);                   // start
  ground(13, 22, 326);                  // small step
  ground(23, 30, 324);                  // another step
  ground(31, 34, 327);                  // shallow dip
  ground(35, 42, 324);
  ground(43, 48, 327);                  // dip
  ground(49, 58, 324);
  ground(59, 65, 328);                  // shard pit (a miss only sends you back to the ledge)
  rect(59, 327, 65, 327, '^');
  ground(66, 78, 324);
  ground(79, 92, 328);                  // wide dip with a floating cell: touch it for a second shot
  put(85, 320, 'o');
  ground(93, 100, 324);
  ground(101, 113, 328);                // wide dip with a low cell: shoot it while crossing
  put(107, 326, 'o');
  ground(114, 115, 324);
  put(2, 327, 'P');
  put(4, 327, '1');
  put(10, 327, '2');
  put(38, 323, '3');
  put(56, 323, '4');
  put(76, 323, '5');
  put(97, 323, '6');
  rect(116, 319, 119, 323, '.');        // doorway into the tower

  // ---- knowledge chain in the field (never explained; each record hints at the next step)
  stamp(52, 319, ['###']); put(53, 318, '*');                       // easy lore record
  stamp(107, 310, ['####']); put(108, 309, '*');                    // R2: by the scorched tower wall
  stamp(99, 306, ['hhh']); stamp(91, 302, ['hhh']); stamp(83, 298, ['hhh']); stamp(75, 294, ['hhhh']);
  put(76, 293, '*');                                                // R3: end of the hidden walkway
  stamp(7, 309, ['.*.', '###']);                                    // high by the start wall
  stamp(40, 312, ['  *  ', ' ### ']);                               // floating slab over the dips

  // ================================================================ the void detour (rows ~180-245)
  // out of the tower on the left at the top of the chimney, across, up a pillar, back in lower-right
  rect(116, 236, 119, 239, '.');        // exit from the chimney top room
  rect(100, 240, 115, 241, '#');        // P1: the ledge outside
  rect(85, 238, 90, 239, '#');          // P2
  put(77, 233, 'o');                    // floating cell over the next gap
  rect(64, 236, 69, 237, '#');          // P3
  put(57, 244, 'o');                    // low cell: shoot it while crossing
  rect(44, 238, 50, 239, '#');          // P4, at the foot of the pillar
  rect(36, 190, 43, 240, '#');          // the pillar
  for (const y of [231, 224, 217, 210, 203, 196]) rect(44, y, 47, y, '#');   // footholds up its face
  for (const y of [227, 213, 199]) put(44, y, '>');                         // shards between them
  stamp(24, 193, ['###']); put(25, 192, '*');                       // record off the pillar top
  rect(53, 188, 57, 188, '#');          // P5
  put(64, 184, 'o');
  rect(70, 186, 73, 186, '#');          // P6
  put(81, 182, 'o');
  rect(88, 186, 91, 186, '#');          // P7
  rect(100, 184, 115, 185, '#');        // P8: back at the tower
  rect(116, 179, 119, 183, 'x');        // the way back in is a cracked wall (breaker rounds)

  // ================================================================ tower (x 120-137)
  const T = {
    // ---- exit shaft above the reinforced ceiling (the tower's crown opens into the sky at row 0)
    3: '..................',
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
    // ---- reinforced ceiling: breaker rounds fired with magnum recoil
    35: '######XXXXXX######',
    // ---- summit
    39: '......F.9.........',
    40: '.....#####........',
    // ---- summit wall (open; needs magnum rounds)
    65: '.............M....',
    66: '...........######.',
    // ---- tall shafts (three shots)
    80: '..######..........',
    84: '>.................',
    85: '>.................',
    86: '..........hhh.....',
    88: '>.................',
    89: '>.................',
    93: '.........######...',
    97: '.................<',
    98: '.................<',
    100: '............hhh...',
    101: '.................<',
    102: '.................<',
    107: '..######..........',
    // ---- cell garden (behind the glass-sensor door)
    114: '..........######..',
    121: '....######........',
    127: '.............A....',
    128: '...........######.',
    131: '................*.',
    132: '...............##.',
    136: '.^^^..............',
    137: '.ggg..............',
    138: '.gog..............',
    139: '.ggg..............',
    140: '######dddd########',
    // ---- glass hall (piercing rounds at the top)
    142: '.....K............',
    143: '...######.........',
    144: '.............ggg..',
    145: '.............gTg..',
    146: '.............ggg..',
    150: '..........######..',
    157: '..######..........',
    160: '...............ggg',
    161: '...............gog',
    162: '...............ggg',
    164: '.........######...',
    171: '...######.........',
    174: 'ggg...............',
    175: 'gog...............',
    176: 'ggg...............',
    178: '..........######..',
    // ---- sealed section: the way on is outside, across the void
    // (rows 184-235 are solid; filled below)
    // ---- chimney top room: breaker rounds
    239: '..B...............',
    // ---- shard chimney (two shots; zigzag ledges)
    240: '######......######',
    241: '######......######',
    242: '######......######',
    243: '######......######',
    244: '######......######',
    245: '#########...######',
    246: '######>.....######',
    247: '######>.....######',
    248: '######......######',
    249: '######...#########',
    250: '######.....<######',
    251: '######.....<######',
    252: '######......######',
    253: '#########...######',
    254: '######>.....######',
    255: '######>.....######',
    256: '######......######',
    257: '######...#########',
    258: '######.....<######',
    259: '######.....<######',
    260: '######......######',
    261: '#########...######',
    262: '######>.....######',
    263: '######>.....######',
    264: '######......######',
    265: '######...#########',
    266: '######......######',
    267: '######......######',
    268: '######......######',
    // ---- wet decks (two shots)
    272: '......======......',
    276: '..........======..',
    283: '..======..........',
    285: '...............###',
    286: '...............x*.',
    287: '...............###',
    290: '.........=======..',
    // ---- foundry (one shot): the sensor door, then the first magazine
    297: '*.A...............',
    298: '#####.............',
    300: '######dddd########',
    301: 'T.................',
    303: '.........8........',
    304: '....######........',
    308: '.......######.....',
    312: '######............',
    316: '.....######.......',
    320: '............######',
    323: '..7...............',
  };
  for (let y = 184; y <= 235; y++) T[y] = '##################';
  for (let y = 1; y <= 323; y++) stamp(120, y, [T[y] || '..................']);
  rect(120, 0, 137, 0, '.');            // the crown is open

  // ================================================================ OUTSIDE (sky rows 0..OY-1; a second act)
  // You leave the tower's crown into open air: broken crown ledges and an updraft, a debris field of
  // floating girders, a long bridge of cells across the sky, a wind chute lined with shards, the last light.
  srect(1, 0, 138, OY - 1, '.');
  const g = (x0, x1, y) => srect(x0, y, x1, y, 'c');          // girder fragment (1 tile thick)
  // O1 crown (y 205..249)
  g(114, 118, 244);                     // left rim of the broken crown
  srect(122, 240, 128, 240, 'c');       // L1: first ledge above the crown
  srect(100, 240, 110, 240, 'c');       // L2
  srect(103, 206, 107, 238, 'w');       // updraft W1
  g(96, 102, 204);                      // L3 at the top of the updraft
  g(131, 135, 222); sput(133, 221, '*');   // record off to the right
  // O2 debris field (y 150..204), moving left and up
  g(84, 88, 196);
  g(72, 75, 188);
  sput(66, 180, 'o');
  g(58, 62, 178);
  g(70, 74, 168); srect(70, 169, 74, 169, 'v');   // shards on its underside
  g(84, 88, 160);
  g(97, 102, 152);                      // rest point
  // O3 cell bridge (y 136..152), a long traverse to the left
  g(80, 84, 145);
  sput(70, 150, 'o');                   // low cell: shoot it while crossing
  g(54, 58, 146);
  sput(46, 140, 'o');
  srect(39, 148, 41, 148, '^'); srect(39, 149, 41, 149, 'g'); sput(39, 150, 'g'); sput(40, 150, 'o'); sput(41, 150, 'g'); srect(39, 151, 41, 151, 'g'); // caged cell
  g(28, 32, 142);
  g(14, 20, 138);                       // foot of the wind chute
  // O4 wind chute (y 56..134)
  srect(5, 66, 6, 130, '#'); srect(14, 66, 15, 130, '#');     // chute walls
  srect(7, 60, 13, 138, 'w');                                 // updraft W2 (from ledge level; lets go a little above the walls)
  srect(7, 88, 7, 93, '>'); srect(13, 74, 13, 79, '<'); srect(7, 104, 7, 108, '>'); srect(13, 116, 13, 120, '<');
  g(16, 24, 62);                        // ledge beside the chute top
  // O5 the last light (y 0..55)
  g(34, 39, 48);
  sput(48, 40, 'o');
  g(52, 70, 36);                        // a long girder right under the core
  // the superstructure: a shell across the whole sky. Its core pulses in the middle of the underside;
  // breaker rounds fired with magnum recoil wear it down, and then the whole shell comes apart.
  srect(1, 22, 138, 27, 'Y');
  srect(60, 26, 63, 27, 'Z');
  g(70, 76, 16); sput(73, 15, '*');
  sput(84, 12, 'o');
  g(90, 97, 8);
  sput(94, 7, 'H');                     // the gate to the outside

  const ROWS = G.map((r) => r.join(''));
  const SIGNS = {
    1: '指を引いて、放せ。その向きに撃つ。\n反動が、お前を反対へ運ぶ。',
    2: '深く引くほど、遠くへ。\n足もとを撃てば、身体は浮く。',
    3: '――まだ、宙では撃てない。\n一発で届く距離を、見極めろ。',
    4: '破片に触れても、\n少し前へ戻されるだけだ。',
    5: '青い光に触れれば、\n宙でもう一度撃てる。',
    6: '下で光っている。\n…触れずとも、届くものがある。',
    7: 'ここより上へ。\n落ちても、終わりはしない。\n――終わることは、ない。',
    8: '赤い眼が、こちらを見ている。\n閉ざしたのは、あれだ。',
    9: '最上層――のはずだった。\n天井の亀裂から、何かが漏れている。',
  };
  // soot on wall faces where a wall blast is useful: [tile x, tile y, side the soot faces (-1 left, 1 right)]
  const SCORCH = [];
  for (let y = 310; y <= 322; y += 3) SCORCH.push([116, y, -1]);   // tower outer wall, field side
  for (let y = 312; y <= 326; y += 4) SCORCH.push([0, y, 1]);      // world's left edge, by the start
  for (let y = 200; y <= 230; y += 6) SCORCH.push([43, y, 1]);     // the pillar in the void
  for (let y = 44; y <= 60; y += 4) SCORCH.push([138, y, -1]);     // beside the summit wall
  // sky (outside) records and relays, in map rows
  const SKY_RECORDS = {
    '133,221': '外は、静かだった。\n風だけが、上へ上へと流れていた。',
    '73,15': '殻の向こうに、光があった。\nそれでも、まだ上がある気がした。',
  };
  const SKY_WAYPOINTS = [[124, 239, '王冠'], [99, 151, '残骸の海'], [16, 137, '風の口'], [20, 61, '風の上'], [57, 35, '殻の下'], [92, 7, '外']];
  // record shard logs, keyed by tile "x,y" (tower-part rows)
  const RECORDS = {
    '53,318': 'この構造体に、上限はない。\n…と、最初の登攀者は書いた。',
    '120,297': '塔の外壁に、焦げた跡がある。\n銃口を押し当てて、宙で撃て。反動は、ずっと強くなる。',
    '108,309': '光の届くあいだだけ、見える道がある。\n暗がりに向けて、撃ってみろ。',
    '76,293': '青い光は、撃っても満ちる。\n宙に浮かぶ光を、下へ撃て。撃つたび、昇れる。',
    '42,312': '下を見るな。\n落ちた者は、みな同じ場所に戻される。',
    '8,309': '間を置かずに撃て。\n勢いは、重なる。',
    '136,286': '最上層の天井は、砕岩弾でも崩れない。\nもっと強い反動と一緒なら、あるいは。',
    '25,192': '塔の外に出た者は、少ない。\n戻れた者は、もっと少ない。',
    '136,131': '硝子の向こうで、青い光が眠っている。\n貫く弾なら、届くだろう。',
    '134,26': '外に出た。\nこの記録を読む者が、次の私だ。',
  };
  // extra terminals with their own text: [tile x, tile y, text]
  const EXTRA_SIGNS = [
    [78, 293, '――道は、ここで途切れている。\n光の中にしか、道はない。\n…ほかの闇にも、あるのだろう。'],
    [102, 239, '塔の中は、ここで塞がれている。\n外を回れ。落ちれば、地の底まで。'],
    [129, 3, '天井の上。…塔は、ここで終わっている。\nその先は、空だ。'],
  ];
  // relay terminals: touch to activate, then transfer between them from the pause menu. [tile x, tile y, name]
  const WAYPOINTS = [
    [7, 327, '目覚めの床'], [126, 323, '塔の入口'], [123, 297, '鋳造層'], [124, 239, '煙突の頂'],
    [106, 239, '虚空の縁'], [40, 189, '柱の頂'], [106, 183, '帰還口'], [128, 142, '硝子の間'],
    [135, 127, '庭'], [135, 65, '強装の足場'], [125, 39, '最上層'], [127, 3, '天井の上'],
  ];
  // lists above are written in tower-part coordinates; shift them into map rows
  const SCORCH_M = SCORCH.map(([x, y, sd]) => [x, y + OY, sd]);
  const RECORDS_M = {};
  for (const k in RECORDS) { const [x, y] = k.split(',').map(Number); RECORDS_M[x + ',' + (y + OY)] = RECORDS[k]; }
  Object.assign(RECORDS_M, SKY_RECORDS);
  const EXTRA_M = EXTRA_SIGNS.map(([x, y, t]) => [x, y + OY, t]);
  const WAY_M = WAYPOINTS.map(([x, y, n]) => [x, y + OY, n]).concat(SKY_WAYPOINTS);
  EXTRA_M.push([55, 35, '頭上を塞ぐ、巨大な殻。\n中心だけが、脈打っている。']);
  // record numbering: the order they lie along the route (map rows)
  const RECORD_ORDER = ['53,' + (318 + OY), '42,' + (312 + OY), '8,' + (309 + OY), '120,' + (297 + OY), '108,' + (309 + OY), '76,' + (293 + OY),
    '136,' + (286 + OY), '25,' + (192 + OY), '136,' + (131 + OY), '134,' + (26 + OY), '133,221', '73,15'];
  const API = { ROWS, OY, SIGNS, SCORCH: SCORCH_M, RECORDS: RECORDS_M, RECORD_ORDER, EXTRA_SIGNS: EXTRA_M, WAYPOINTS: WAY_M };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.LEVEL = API;
})(typeof window !== 'undefined' ? window : globalThis);
