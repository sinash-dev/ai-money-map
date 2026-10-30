(() => {
'use strict';

const REPO_URL = 'https://github.com/sinash-dev/ai-money-map';

// ---------- vocab ----------
const KIND_OF = { equity: 'invest', venture: 'invest', warrant: 'invest', compute: 'compute', acquisition: 'mna', licensing: 'mna', loan: 'loan' };
const KINDS = [
  { k: 'invest', label: 'Investments' },
  { k: 'compute', label: 'Compute and chips' },
  { k: 'mna', label: 'Acquisitions' },
  { k: 'loan', label: 'Loans and guarantees' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map(k => [k.k, k.label]));
const TYPE_LABEL = { equity: 'Equity stake', venture: 'Funding round', warrant: 'Warrant (stock)', compute: 'Compute purchase', acquisition: 'Acquisition', licensing: 'Licence and hiring deal', loan: 'Loan or guarantee' };
const GROUP_OF = { big_tech: 'big_tech', cloud: 'cloud', neocloud: 'cloud', chips: 'chips', ai_lab: 'ai_lab', ai_app: 'ai_app', investor: 'funds', sovereign: 'funds' };
const GROUPS = [['big_tech', 'Big tech'], ['ai_lab', 'AI labs'], ['ai_app', 'AI apps and data'], ['chips', 'Chips'], ['cloud', 'Cloud and data centres'], ['funds', 'Funds and governments']];
const GROUP_LABEL = Object.fromEntries(GROUPS);
const STATUS_LABEL = { completed: 'Completed', signed: 'Signed', loi: 'Letter of intent', paused: 'Paused', cancelled: 'Cancelled' };
const BASIS_LABEL = { disclosed: 'disclosed', reported: 'reported', estimated: 'estimated split', undisclosed: 'undisclosed' };
const COUNTRY = { US: ['United States', '840'], CN: ['China', '156'], FR: ['France', '250'], JP: ['Japan', '392'], KR: ['South Korea', '410'], GB: ['United Kingdom', '826'], NL: ['Netherlands', '528'], AE: ['UAE', '784'], CA: ['Canada', '124'], AU: ['Australia', '036'], XX: ['Global funds', null] };
const SERIES = ['#38e8ff', '#ffae2b', '#2ee6a8', '#ff7ab6', '#b18cff', '#9be15d', '#ffd166', '#ff5c7a'];

// ---------- helpers ----------
const $ = s => document.querySelector(s);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const kc = k => css('--k-' + k);
const gc = g => css('--c-' + g);
const trimz = s => s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
function fmt(v) {
  if (v == null) return 'undisclosed';
  if (v === 0) return '$0';
  if (v >= 1000) return '$' + trimz((v / 1000).toFixed(2)) + 'T';
  if (v >= 1) return '$' + trimz(v.toFixed(v >= 100 ? 0 : 1)) + 'B';
  return '$' + Math.round(v * 1000) + 'M';
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const monthName = m => { const [y, mo] = m.split('-'); return new Date(+y, +mo - 1, 1).toLocaleString('en', { month: 'short', year: 'numeric' }); };
const tip = $('#tip');
function showTip(html, e) {
  tip.innerHTML = html; tip.style.display = 'block';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 8) x = e.clientX - w - 14;
  if (y + h > innerHeight - 8) y = e.clientY - h - 14;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => { tip.style.display = 'none'; };

// ---------- state ----------
const S = {
  view: 'network', kinds: new Set(KINDS.map(k => k.k)), status: 'all', est: true, cat: '',
  tIdx: 0, selected: null, pair: null, hl: null, hlLabel: '', tsort: { k: 'date', dir: -1 }, tq: '',
  valSel: ['openai', 'anthropic', 'xai', 'databricks', 'mistral', 'deepseek', 'anysphere', 'figure-ai'],
};
let D, C, months = [], playing = null;
const pos = new Map();

// ---------- data shaping ----------
const amt = d => (d.amount_basis === 'estimated' && !S.est) ? null : d.amount_usd_bn;
function pass(d) {
  if (!S.kinds.has(KIND_OF[d.type])) return false;
  if (d.status === 'cancelled') return false;
  if (S.status === 'binding' && !(d.status === 'signed' || d.status === 'completed')) return false;
  if (S.status === 'completed' && d.status !== 'completed') return false;
  if (d.date.slice(0, 7) > months[S.tIdx]) return false;
  if (S.cat && GROUP_OF[C[d.from].category] !== S.cat && GROUP_OF[C[d.to].category] !== S.cat) return false;
  return true;
}
const filtered = () => D.deals.filter(pass);

function aggEdges(ds) {
  const m = new Map();
  for (const d of ds) {
    const kind = KIND_OF[d.type], key = d.from + '>' + d.to + '>' + kind;
    let e = m.get(key);
    if (!e) { e = { key, source: d.from, target: d.to, kind, amt: 0, deals: [], soft: true, undisclosed: true }; m.set(key, e); }
    const a = amt(d);
    e.amt += a || 0; e.deals.push(d);
    if (a) e.undisclosed = false;
    if (d.status === 'completed' || d.status === 'signed') e.soft = false;
  }
  return [...m.values()];
}
function totals(ds) {
  const t = {};
  const get = id => (t[id] ||= { in: 0, out: 0, n: 0, inBy: {}, outBy: {} });
  for (const d of ds) {
    const a = amt(d) || 0, k = KIND_OF[d.type];
    const f = get(d.from), g = get(d.to);
    f.out += a; g.in += a; f.n++; g.n++;
    f.outBy[k] = (f.outBy[k] || 0) + a; g.inBy[k] = (g.inBy[k] || 0) + a;
  }
  return t;
}
function findLoops(ds) {
  const adj = new Map();
  for (const d of ds) {
    if (!adj.has(d.from)) adj.set(d.from, new Map());
    const m = adj.get(d.from);
    m.set(d.to, (m.get(d.to) || 0) + (amt(d) || 0));
  }
  const nodes = [...adj.keys()].sort(), idx = new Map(nodes.map((n, i) => [n, i]));
  const out = [];
  function dfs(start, cur, path) {
    for (const [nx] of adj.get(cur) || []) {
      if (nx === start && path.length >= 2) out.push(path.slice());
      else if (idx.has(nx) && idx.get(nx) > idx.get(start) && !path.includes(nx) && path.length < 4) {
        path.push(nx); dfs(start, nx, path); path.pop();
      }
    }
  }
  for (const n of nodes) dfs(n, n, [n]);
  return out.map(p => {
    const legs = p.map((a, i) => ({ from: a, to: p[(i + 1) % p.length], amt: adj.get(a).get(p[(i + 1) % p.length]) }));
    return { path: p, legs, total: d3.sum(legs, l => l.amt), min: d3.min(legs, l => l.amt) };
  }).sort((a, b) => (b.min - a.min) || (b.total - a.total));
}
function findPaths(ds, a, b, maxLen = 4) {
  const adj = new Map();
  for (const d of ds) { if (!adj.has(d.from)) adj.set(d.from, new Set()); adj.get(d.from).add(d.to); }
  const res = [];
  (function walk(cur, path) {
    if (res.length > 40) return;
    for (const nx of adj.get(cur) || []) {
      if (nx === b) res.push([...path, nx]);
      else if (!path.includes(nx) && path.length < maxLen) walk(nx, [...path, nx]);
    }
  })(a, [a]);
  return res.sort((x, y) => x.length - y.length);
}

// ---------- KPIs ----------
function renderKpis(ds) {
  const sum = (f) => d3.sum(ds.filter(f), d => amt(d) || 0);
  const total = sum(() => true);
  const inv = sum(d => KIND_OF[d.type] === 'invest');
  const comp = sum(d => KIND_OF[d.type] === 'compute');
  const loops = findLoops(ds);
  const loopPairs = new Set(loops.flatMap(l => l.legs.map(g => g.from + '>' + g.to)));
  const circ = sum(d => loopPairs.has(d.from + '>' + d.to));
  const firms = new Set(ds.flatMap(d => [d.from, d.to])); firms.delete('financial-investors');
  const paid = sum(d => d.status === 'completed');
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const kpis = [
    ['Money tracked', total, fmt, `${ds.length} deals, ${firms.size} companies`, '#7c9bff'],
    ['Actually paid so far', paid, fmt, total ? `${pct(paid, total)}% of the total; the rest is promised` : '', '#2ee6a8'],
    ['Investments', inv, fmt, 'Equity, rounds and warrants', kc('invest')],
    ['Compute commitments', comp, fmt, 'Chips, cloud and data-centre deals', kc('compute')],
    ['Money that loops back', pct(circ, total), v => Math.round(v) + '%', `Sits on ${loops.length} loops between companies`, kc('loan')],
  ];
  const box = $('#kpis');
  if (!box.children.length) box.innerHTML = kpis.map(([l, , , , c]) => `<div class="kpi" style="--kc:${c}"><div class="l">${l}</div><div class="v">–</div><div class="s"></div></div>`).join('');
  kpis.forEach(([, v, f, s], i) => {
    const el = box.children[i], vEl = el.querySelector('.v');
    el.querySelector('.s').textContent = s;
    const from = +(vEl.dataset.v || 0);
    vEl.dataset.v = v;
    d3.select(vEl).interrupt().transition().duration(from ? 350 : 1400).ease(d3.easeCubicOut)
      .tween('text', () => { const ip = d3.interpolateNumber(from, v); return t => { vEl.textContent = f(ip(t)); }; });
  });
  return loops;
}

// ---------- side panel ----------
function coLink(id) { return `<span class="who" data-co="${id}">${esc(C[id].name)}</span>`; }
function dealLine(d) {
  const tags = d.status === 'loi' ? '<span class="tag loi">letter of intent</span>' : d.status === 'paused' ? '<span class="tag paused">paused</span>' : '';
  return `<div class="rowline"><span><span class="kdot" style="background:${kc(KIND_OF[d.type])}"></span>${esc(d.date.slice(0, 7))} · ${coLink(d.from)} → ${coLink(d.to)}<br><span class="muted">${esc(d.title)}</span> ${tags}</span><span class="num">${fmt(amt(d))}</span></div>`;
}
function renderPanel(ds, loops) {
  const P = $('#panel');
  const t = totals(ds);
  let html = '';
  if (S.pair) {
    const [a, b] = S.pair;
    const list = ds.filter(d => (d.from === a && d.to === b) || (d.from === b && d.to === a)).sort((x, y) => y.date.localeCompare(x.date));
    html += `<div class="card"><button class="x" data-close="pair" aria-label="Close">×</button><h3>${esc(C[a].name)} ⇄ ${esc(C[b].name)}</h3>
      <div class="mini"><div><div class="l">${esc(C[a].name)} → ${esc(C[b].name)}</div><div class="v num">${fmt(d3.sum(list.filter(d => d.from === a), d => amt(d) || 0))}</div></div>
      <div><div class="l">${esc(C[b].name)} → ${esc(C[a].name)}</div><div class="v num">${fmt(d3.sum(list.filter(d => d.from === b), d => amt(d) || 0))}</div></div></div>
      ${list.map(d => dealLine(d) + sourceLinks(d)).join('')}</div>`;
  }
  if (S.selected) html += profileCard(S.selected, ds, t, loops);
  if (!S.selected && !S.pair) html += insightsCard(t);
  html += loopsCard(loops);
  html += pathCard(ds);
  P.innerHTML = html;
  P.querySelectorAll('[data-co]').forEach(el => el.onclick = () => select(el.dataset.co));
  P.querySelectorAll('[data-close]').forEach(el => el.onclick = () => { if (el.dataset.close === 'pair') S.pair = null; else S.selected = null; S.hl = null; render(); });
  P.querySelectorAll('[data-loop]').forEach(el => el.onclick = () => {
    const l = loops[+el.dataset.loop];
    S.hl = { nodes: new Set(l.path), edges: new Set(l.legs.map(g => g.from + '>' + g.to)) };
    S.hlLabel = 'Loop: ' + l.path.map(p => C[p].name).join(' → ') + ' → ' + C[l.path[0]].name;
    if (!['network', 'matrix'].includes(S.view)) setView('network'); else render();
  });
  const pa = $('#pa'), pb = $('#pb');
  if (pa) {
    $('#pgo').onclick = () => {
      const paths = findPaths(ds, pa.value, pb.value);
      const box = $('#pout');
      if (!paths.length) { box.innerHTML = `<p class="muted">No chain of payments from ${esc(C[pa.value].name)} to ${esc(C[pb.value].name)} with the current filters.</p>`; S.hl = null; drawView(ds); return; }
      S.hl = { nodes: new Set(paths.flat()), edges: new Set(paths.flatMap(p => p.slice(1).map((x, i) => p[i] + '>' + x))) };
      S.hlLabel = `Money paths from ${C[pa.value].name} to ${C[pb.value].name}`;
      box.innerHTML = `<p class="muted">${paths.length} path${paths.length > 1 ? 's' : ''} found, shown on the network.</p>` +
        paths.slice(0, 8).map(p => `<div class="loop">${p.map(coLink).join(' → ')}</div>`).join('');
      box.querySelectorAll('[data-co]').forEach(el => el.onclick = (e) => { e.stopPropagation(); select(el.dataset.co); });
      if (S.view !== 'network') setView('network'); else drawView(ds);
    };
  }
}
function sourceLinks(d) {
  return `<div class="muted" style="margin:-2px 0 6px 13px">${d.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publisher)}</a>`).join(' · ')}</div>`;
}
function insightsCard(t) {
  const ids = Object.keys(t).filter(id => id !== 'financial-investors');
  const topIn = ids.sort((a, b) => t[b].in - t[a].in).slice(0, 6);
  const topOut = Object.keys(t).sort((a, b) => t[b].out - t[a].out).slice(0, 6);
  const row = (id, v) => `<div class="rowline"><span>${coLink(id)}</span><span class="num">${fmt(v)}</span></div>`;
  return `<div class="card"><h3>Who's at the centre</h3>
    <p class="muted" style="margin:0 0 6px">With the current filters. Click any company, on the map or here, to see its full profile.</p>
    <div class="sub-h">Receives the most</div>${topIn.map(id => row(id, t[id].in)).join('')}
    <div class="sub-h">Pays out the most</div>${topOut.map(id => row(id, t[id].out)).join('')}</div>`;
}
function profileCard(id, ds, t, loops) {
  const c = C[id], me = t[id] || { in: 0, out: 0, n: 0 };
  const mine = ds.filter(d => d.from === id || d.to === id);
  const group = (arr, key) => {
    const m = {};
    for (const d of arr) { const k = d[key]; (m[k] ||= { amt: 0, kinds: new Set() }); m[k].amt += amt(d) || 0; m[k].kinds.add(KIND_OF[d.type]); }
    return Object.entries(m).sort((a, b) => b[1].amt - a[1].amt);
  };
  const row = ([cid, v]) => `<div class="rowline"><span>${[...v.kinds].map(k => `<span class="kdot" style="background:${kc(k)}"></span>`).join('')}${coLink(cid)}</span><span class="num">${fmt(v.amt || (v.amt === 0 ? null : v.amt))}</span></div>`;
  const ins = group(mine.filter(d => d.to === id), 'from');
  const outs = group(mine.filter(d => d.from === id), 'to');
  const vals = D.valuations.filter(v => v.company === id).sort((a, b) => a.date.localeCompare(b.date));
  const lastVal = vals[vals.length - 1];
  const myLoops = loops.map((l, i) => [l, i]).filter(([l]) => l.path.includes(id)).slice(0, 4);
  const country = COUNTRY[c.country]?.[0] || c.country;
  return `<div class="card"><button class="x" data-close="sel" aria-label="Close">×</button>
    <h3 style="font-size:18px">${esc(c.name)}</h3>
    <div class="muted"><span class="kdot" style="background:${gc(GROUP_OF[c.category])}"></span>${GROUP_LABEL[GROUP_OF[c.category]]} · ${esc(country)}${c.ticker ? ' · ' + esc(c.ticker) : ''}${c.public ? ' · public' : c.id === 'financial-investors' ? '' : ' · private'}</div>
    ${c.note ? `<p class="muted" style="margin:6px 0 0">${esc(c.note)}</p>` : ''}
    <div class="mini">
      <div><div class="l">Money in</div><div class="v num">${fmt(me.in)}</div></div>
      <div><div class="l">Money out</div><div class="v num">${fmt(me.out)}</div></div>
      <div><div class="l">${lastVal ? (lastVal.kind === 'market_cap' ? 'Market value' : 'Latest valuation') : 'Valuation'}</div><div class="v num">${lastVal ? fmt(lastVal.value_usd_bn) : '–'}</div></div>
      <div><div class="l">Deals tracked</div><div class="v num">${mine.length}</div></div>
    </div>
    ${vals.length > 1 ? `<div id="spark" style="height:60px"></div><div class="muted">Valuation ${vals[0].date.slice(0, 4)} → ${lastVal.date.slice(0, 7)}: ${fmt(vals[0].value_usd_bn)} → ${fmt(lastVal.value_usd_bn)}</div>` : ''}
    ${ins.length ? `<div class="sub-h">Money comes from</div>${ins.slice(0, 8).map(row).join('')}` : ''}
    ${outs.length ? `<div class="sub-h">Money goes to</div>${outs.slice(0, 8).map(row).join('')}` : ''}
    ${myLoops.length ? `<div class="sub-h">Loops it's part of</div>${myLoops.map(([l, i]) => `<div class="loop" data-loop="${i}">${l.path.map(p => esc(C[p].name)).join(' → ')} → ${esc(C[l.path[0]].name)}<br><span class="muted">smallest leg ${fmt(l.min)}</span></div>`).join('')}` : ''}
    <p class="muted" style="margin:10px 0 0">All ${mine.length} deals are in the table below.</p></div>`;
}
function loopsCard(loops) {
  const top = loops.slice(0, 7);
  return `<div class="card"><h3>Money that comes back</h3>
    <p class="muted" style="margin:0 0 4px">Found automatically: chains where money leaves a company and returns to it. Ranked by the smallest leg, so the biggest true round trips come first. Click one to highlight it.</p>
    ${top.length ? top.map((l, i) => `<div class="loop" data-loop="${i}">${l.path.map(p => esc(C[p].name)).join(' → ')} → ${esc(C[l.path[0]].name)}<br><span class="muted">${l.legs.map(g => fmt(g.amt || null)).join(' · ')}</span></div>`).join('') : '<p class="muted">No loops with these filters.</p>'}
    ${loops.length > 7 ? `<p class="muted" style="margin:6px 0 0">${loops.length - 7} more loops with these filters.</p>` : ''}</div>`;
}
function pathCard(ds) {
  const ids = [...new Set(ds.flatMap(d => [d.from, d.to]))].sort((a, b) => C[a].name.localeCompare(C[b].name));
  const opt = (sel) => ids.map(id => `<option value="${id}"${id === sel ? ' selected' : ''}>${esc(C[id].name)}</option>`).join('');
  const a = ids.includes('nvidia') ? 'nvidia' : ids[0], b = ids.includes('oracle') ? 'oracle' : ids[1];
  return `<div class="card"><h3>Follow the money</h3>
    <p class="muted" style="margin:0 0 8px">Find every chain of payments (up to four steps) from one company to another.</p>
    <div class="pathform"><select id="pa" aria-label="From company">${opt(a)}</select><span>→</span><select id="pb" aria-label="To company">${opt(b)}</select></div>
    <button id="pgo" style="margin-top:8px;width:100%">Find paths</button><div id="pout"></div></div>`;
}
function drawSpark(id) {
  const el = $('#spark'); if (!el) return;
  const vals = D.valuations.filter(v => v.company === id).sort((a, b) => a.date.localeCompare(b.date));
  const w = el.clientWidth, h = 60;
  const x = d3.scaleTime().domain(d3.extent(vals, v => new Date(v.date))).range([4, w - 4]);
  const y = d3.scaleLog().domain(d3.extent(vals, v => v.value_usd_bn)).nice().range([h - 6, 6]);
  const svg = d3.select(el).append('svg').attr('width', w).attr('height', h);
  svg.append('path').datum(vals).attr('fill', 'none').attr('stroke', gc(GROUP_OF[C[id].category])).attr('stroke-width', 2)
    .attr('d', d3.line().x(v => x(new Date(v.date))).y(v => y(v.value_usd_bn)));
  svg.selectAll('circle').data(vals).join('circle').attr('cx', v => x(new Date(v.date))).attr('cy', v => y(v.value_usd_bn)).attr('r', 3)
    .attr('fill', gc(GROUP_OF[C[id].category])).on('mousemove', (e, v) => showTip(`<b>${fmt(v.value_usd_bn)}</b> · ${v.date}<br><span class="d">${v.kind.replace('_', ' ')}</span>`, e)).on('mouseleave', hideTip);
}

// ---------- views ----------
function stageSize() {
  const el = $('#viz'), bar = document.querySelector('.bar').offsetHeight + document.querySelector('nav.top').offsetHeight + 14;
  document.documentElement.style.setProperty('--bar-h', bar + 'px');
  return [el.clientWidth || 900, Math.max(560, Math.min(820, innerHeight - bar - 16))];
}
function emptyMsg(msg) { $('#viz').innerHTML = `<div class="empty">${msg}</div>`; }
function dimmed(id) { return S.hl ? !S.hl.nodes.has(id) : (S.selected ? (id !== S.selected && !neighbors().has(id)) : false); }
let _nb = null;
function neighbors() { return _nb || new Set(); }

function drawNetwork(ds) {
  const E = aggEdges(ds);
  if (!E.length) return emptyMsg('No deals match these filters.');
  const t = totals(ds);
  _nb = new Set(); if (S.selected) ds.forEach(d => { if (d.from === S.selected) _nb.add(d.to); if (d.to === S.selected) _nb.add(d.from); });
  const ids = [...new Set(E.flatMap(e => [e.source, e.target]))];
  const [W, H] = stageSize();
  const flow = id => t[id].in + t[id].out;
  const small = W < 640, pad = small ? 18 : 44;
  const r = d3.scaleSqrt().domain([0, d3.max(ids, flow) || 1]).range(small ? [3, 20] : [5, 34]);
  const w = d3.scaleSqrt().domain([0, d3.max(E, e => e.amt) || 1]).range(small ? [0.8, 7] : [1.2, 12]);
  const gi = Object.fromEntries(GROUPS.map(([g], i) => [g, i]));
  const nodes = ids.map(id => {
    const p = pos.get(id), g = gi[GROUP_OF[C[id].category]], ang = (g / GROUPS.length) * Math.PI * 2;
    return { id, r: r(flow(id)), x: p ? p.x : W / 2 + Math.cos(ang) * W * 0.28 + (Math.random() - .5) * 60, y: p ? p.y : H / 2 + Math.sin(ang) * H * 0.3 + (Math.random() - .5) * 60 };
  });
  const byId = new Map(nodes.map(n => [n.id, n]));
  const links = E.map(e => ({ ...e, s: byId.get(e.source), t: byId.get(e.target) }));
  const pairCount = {};
  links.forEach(l => { const k = [l.source, l.target].sort().join('|'); l.idx = (pairCount[k] = (pairCount[k] || 0) + 1) - 1; });

  const viz = d3.select('#viz').html('');
  const svg = viz.append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H).attr('role', 'img').attr('aria-label', 'Network of money flows between AI companies');
  const defs = svg.append('defs');
  const glow = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
  glow.append('feGaussianBlur').attr('stdDeviation', 4).attr('result', 'b');
  const fm = glow.append('feMerge'); fm.append('feMergeNode').attr('in', 'b'); fm.append('feMergeNode').attr('in', 'SourceGraphic');
  KINDS.forEach(({ k }) => defs.append('marker').attr('id', 'arr-' + k).attr('viewBox', '0 -5 10 10').attr('refX', 9).attr('markerUnits', 'userSpaceOnUse').attr('markerWidth', 11).attr('markerHeight', 11).attr('orient', 'auto')
    .append('path').attr('d', 'M0,-4L10,0L0,4').attr('fill', kc(k)));
  const g = svg.append('g');
  svg.call(d3.zoom().scaleExtent([0.4, 4]).on('zoom', e => g.attr('transform', e.transform)));
  svg.on('click', (e) => { if (e.target === svg.node()) { S.selected = null; S.pair = null; S.hl = null; render(); } });

  const isDim = l => S.hl ? !S.hl.edges.has(l.source + '>' + l.target) : (S.selected ? (l.source !== S.selected && l.target !== S.selected) : false);
  const lk = g.append('g').attr('fill', 'none').selectAll('path').data(links).join('path')
    .attr('stroke', l => kc(l.kind)).attr('stroke-width', l => l.undisclosed ? 1 : w(l.amt))
    .attr('stroke-opacity', l => isDim(l) ? 0.05 : (l.undisclosed ? 0.4 : 0.42))
    .attr('stroke-dasharray', l => l.soft ? '6 4' : (l.undisclosed ? '2 3' : null))
    .attr('marker-end', l => isDim(l) ? null : `url(#arr-${l.kind})`).style('cursor', 'pointer')
    .on('mousemove', (e, l) => showTip(`<b>${esc(C[l.source].name)} → ${esc(C[l.target].name)}</b><br>${KIND_LABEL[l.kind]}: <b>${l.undisclosed ? 'undisclosed' : fmt(l.amt)}</b><br><span class="d">${l.deals.map(d => esc(d.title)).slice(0, 4).join('<br>')}${l.deals.length > 4 ? '<br>…' : ''}</span>`, e))
    .on('mouseleave', hideTip)
    .on('click', (e, l) => { e.stopPropagation(); S.pair = [l.source, l.target]; render(); });

  const fl = g.append('g').attr('fill', 'none').selectAll('path').data(links.filter(l => !l.undisclosed && !isDim(l))).join('path')
    .attr('class', 'flow').attr('stroke', l => kc(l.kind)).attr('stroke-width', l => Math.max(2, Math.min(5, w(l.amt) * 0.55)))
    .style('animation-duration', l => (1.1 + Math.random() * 1.2).toFixed(2) + 's').style('filter', 'drop-shadow(0 0 3px ' + 'rgba(255,255,255,0.6))');

  const nd = g.append('g').selectAll('g').data(nodes).join('g').style('cursor', 'pointer')
    .attr('opacity', n => dimmed(n.id) ? 0.15 : 1)
    .on('mousemove', (e, n) => showTip(`<b>${esc(C[n.id].name)}</b><br>${GROUP_LABEL[GROUP_OF[C[n.id].category]]}<br>Money in: <b>${fmt(t[n.id].in)}</b> · out: <b>${fmt(t[n.id].out)}</b><br><span class="d">Click for profile</span>`, e))
    .on('mouseleave', hideTip)
    .on('click', (e, n) => { e.stopPropagation(); select(n.id); })
    .call(d3.drag()
      .on('start', (e, n) => { if (!e.active) sim.alphaTarget(0.2).restart(); n.fx = n.x; n.fy = n.y; })
      .on('drag', (e, n) => { n.fx = e.x; n.fy = e.y; })
      .on('end', (e, n) => { if (!e.active) sim.alphaTarget(0); n.fx = null; n.fy = null; }));
  const col = n => gc(GROUP_OF[C[n.id].category]);
  nd.append('circle').attr('r', n => n.r + 3).attr('fill', col).attr('opacity', n => n.id === S.selected ? 0.45 : 0.16).attr('filter', 'url(#glow)');
  nd.append('circle').attr('r', n => n.r).attr('fill', css('--node')).attr('stroke', col).attr('stroke-width', n => n.id === S.selected ? 3.5 : 2);
  const label = n => C[n.id].name.replace(' (Alphabet)', '').replace('VCs, PE and other funds', 'VCs and funds').replace('Anysphere (Cursor)', 'Cursor');
  const inside = n => n.r >= (small ? 16 : 24);
  const showL = n => n.r >= 7 || n.id === S.selected || (S.hl && S.hl.nodes.has(n.id)) || neighbors().has(n.id);
  nd.append('text').attr('text-anchor', 'middle').attr('dy', n => inside(n) ? '-0.1em' : n.r + 13)
    .style('font-family', 'var(--f-display)').style('font-size', n => inside(n) ? Math.min(14, 8 + n.r / 6) + 'px' : '10.5px')
    .style('font-weight', 600).style('paint-order', 'stroke').style('stroke', n => inside(n) ? 'none' : '#04070f').style('stroke-width', 3)
    .text(n => showL(n) ? label(n) : '');
  nd.filter(inside).append('text').attr('text-anchor', 'middle').attr('dy', '1.25em').attr('class', 'muted')
    .style('font-family', 'var(--f-mono)').style('font-size', '10px').text(n => fmt(t[n.id].in + t[n.id].out));

  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links.map(l => ({ source: l.s, target: l.t }))).distance(l => 110 + l.source.r + l.target.r).strength(0.12))
    .force('charge', d3.forceManyBody().strength(n => (small ? -90 : -320) - n.r * 14))
    .force('x', d3.forceX(W / 2).strength(0.05)).force('y', d3.forceY(H / 2).strength(0.07))
    .force('collide', d3.forceCollide(n => n.r + (small ? 6 : 16)))
    .alpha(pos.size ? 0.35 : 1);
  function arc(l) {
    const sx = l.s.x, sy = l.s.y, tx = l.t.x, ty = l.t.y;
    const dx = tx - sx, dy = ty - sy, dist = Math.hypot(dx, dy) || 1;
    const bend = (0.18 + l.idx * 0.12) * dist;
    const mx = (sx + tx) / 2 - dy / dist * bend, my = (sy + ty) / 2 + dx / dist * bend;
    const hm = Math.hypot(tx - mx, ty - my) || 1;
    const ex = tx - (tx - mx) / hm * (l.t.r + 3), ey = ty - (ty - my) / hm * (l.t.r + 3);
    return `M${sx},${sy}Q${mx},${my} ${ex},${ey}`;
  }
  sim.on('tick', () => {
    nodes.forEach(n => { n.x = Math.max(n.r + pad, Math.min(W - n.r - pad, n.x)); n.y = Math.max(n.r + (small ? 16 : 70), Math.min(H - n.r - 26, n.y)); pos.set(n.id, { x: n.x, y: n.y }); });
    lk.attr('d', arc); fl.attr('d', arc);
    nd.attr('transform', n => `translate(${n.x},${n.y})`);
  });
}

function drawSankey(ds) {
  const isTarget = id => ['ai_lab', 'ai_app'].includes(C[id].category);
  const inflow = ds.filter(d => KIND_OF[d.type] !== 'compute' && isTarget(d.to) && (amt(d) || 0) > 0);
  const middle = new Set(inflow.map(d => d.to));
  const outflow = ds.filter(d => KIND_OF[d.type] === 'compute' && middle.has(d.from) && (amt(d) || 0) > 0);
  if (!inflow.length) return emptyMsg('No investments into AI companies match these filters.');
  const lim = (rows, key, n, other) => {
    const tot = d3.rollup(rows, v => d3.sum(v, d => amt(d)), d => d[key]);
    const keep = new Set([...tot].sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]));
    return id => keep.has(id) ? id : other;
  };
  const lf = lim(inflow, 'from', 16, '_other_in');
  const rf = lim(outflow, 'to', 14, '_other_out');
  const name = id => id === '_other_in' ? 'Other investors' : id === '_other_out' ? 'Other suppliers' : C[id].name.replace(' (Alphabet)', '').replace('VCs, PE and other funds', 'VCs and funds');
  const linkMap = new Map();
  const add = (s, t2, v, kind) => { const k = s + '|' + t2 + '|' + kind; const o = linkMap.get(k) || { source: s, target: t2, value: 0, kind }; o.value += v; linkMap.set(k, o); };
  inflow.forEach(d => add('L:' + lf(d.from), 'M:' + d.to, amt(d), KIND_OF[d.type]));
  outflow.forEach(d => add('M:' + d.from, 'R:' + rf(d.to), amt(d), 'compute'));
  const links = [...linkMap.values()];
  const nodeIds = [...new Set(links.flatMap(l => [l.source, l.target]))];
  const [W, H0] = stageSize(), H = Math.max(H0, nodeIds.length * 14);
  const viz = d3.select('#viz').html('');
  const svg = viz.append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H).attr('role', 'img').attr('aria-label', 'Sankey diagram: money into AI companies and their compute spending');
  const sk = d3.sankey().nodeId(d => d.id).nodeWidth(12).nodePadding(9).nodeAlign(d3.sankeyJustify)
    .extent([[170, 34], [W - 170, H - 12]]);
  const graph = sk({ nodes: nodeIds.map(id => ({ id })), links: links.map(l => ({ ...l })) });
  const raw = id => id.slice(2);
  const ncolor = id => raw(id).startsWith('_') ? gc('funds') : gc(GROUP_OF[C[raw(id)].category]);
  [['Money in', 150, 'start'], ['AI labs and apps', W / 2, 'middle'], ['Spent on compute with', W - 150, 'end']].forEach(([txt, x, a]) =>
    svg.append('text').attr('x', x).attr('y', 18).attr('text-anchor', a).attr('class', 'muted').style('font-weight', 600).text(txt));
  svg.append('g').attr('fill', 'none').selectAll('path').data(graph.links).join('path')
    .attr('d', d3.sankeyLinkHorizontal()).attr('stroke', l => kc(l.kind)).attr('stroke-opacity', 0.32)
    .attr('stroke-width', l => Math.max(1, l.width))
    .on('mousemove', (e, l) => showTip(`<b>${esc(name(raw(l.source.id)))} → ${esc(name(raw(l.target.id)))}</b><br>${KIND_LABEL[l.kind]}: <b>${fmt(l.value)}</b>`, e))
    .on('mouseleave', hideTip);
  const nd = svg.append('g').selectAll('g').data(graph.nodes).join('g').style('cursor', d => raw(d.id).startsWith('_') ? 'default' : 'pointer')
    .on('click', (e, d) => { if (!raw(d.id).startsWith('_')) select(raw(d.id)); });
  nd.append('rect').attr('x', d => d.x0).attr('y', d => d.y0).attr('width', d => d.x1 - d.x0).attr('height', d => Math.max(1, d.y1 - d.y0)).attr('fill', d => ncolor(d.id)).attr('rx', 2);
  nd.append('text').attr('x', d => d.x0 < W / 3 ? d.x0 - 6 : d.x1 + 6).attr('y', d => (d.y0 + d.y1) / 2).attr('dy', '0.35em')
    .attr('text-anchor', d => d.x0 < W / 3 ? 'end' : 'start')
    .text(d => (d.y1 - d.y0 > 7 || d.value > 20) ? `${name(raw(d.id))} ${fmt(d.value)}` : '');
  nd.append('title').text(d => `${name(raw(d.id))}: ${fmt(d.value)}`);
}

function drawMatrix(ds) {
  const t = totals(ds);
  const ids = Object.keys(t).sort((a, b) => (t[b].in + t[b].out) - (t[a].in + t[a].out)).slice(0, 24);
  if (ids.length < 2) return emptyMsg('Not enough deals for a matrix with these filters.');
  const cell = new Map();
  ds.forEach(d => { if (ids.includes(d.from) && ids.includes(d.to)) { const k = d.from + '>' + d.to; const c = cell.get(k) || { v: 0, deals: [] }; c.v += amt(d) || 0; c.deals.push(d); cell.set(k, c); } });
  const [W] = stageSize();
  const left = 150, top = 130, size = Math.max(14, Math.min(30, (W - left - 20) / ids.length));
  const H = top + size * ids.length + 30;
  const viz = d3.select('#viz').html('');
  const svg = viz.append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H).attr('role', 'img').attr('aria-label', 'Matrix of who pays whom');
  const max = d3.max([...cell.values()], c => c.v) || 1;
  const col = d3.scaleSequentialLog(d3.interpolateRgb('#123a6b', '#7ff3ff')).domain([0.05, max]);
  const short = id => C[id].name.replace(' (Alphabet)', '').replace('VCs, PE and other funds', 'VCs and funds');
  svg.append('text').attr('x', left).attr('y', 16).attr('class', 'muted').text('Rows pay, columns receive. Darker = more money.');
  svg.selectAll('.rl').data(ids).join('text').attr('x', left - 8).attr('y', (d, i) => top + i * size + size / 2).attr('dy', '0.35em').attr('text-anchor', 'end').text(short).style('cursor', 'pointer').on('click', (e, id) => select(id));
  svg.selectAll('.cl').data(ids).join('text').attr('transform', (d, i) => `translate(${left + i * size + size / 2},${top - 8}) rotate(-55)`).text(short).style('cursor', 'pointer').on('click', (e, id) => select(id));
  const cells = [];
  ids.forEach((a, i) => ids.forEach((b, j) => cells.push({ a, b, i, j, c: cell.get(a + '>' + b) })));
  svg.append('g').selectAll('rect').data(cells).join('rect')
    .attr('x', d => left + d.j * size + 1).attr('y', d => top + d.i * size + 1).attr('width', size - 2).attr('height', size - 2).attr('rx', 3)
    .attr('fill', d => d.c ? (d.c.v > 0 ? col(Math.max(0.05, d.c.v)) : '#2a3a63') : (d.a === d.b ? 'transparent' : 'rgba(30,50,100,0.25)'))
    .attr('stroke', d => (S.hl && S.hl.edges.has(d.a + '>' + d.b)) ? css('--ink') : 'none').attr('stroke-width', 2)
    .style('cursor', d => d.c ? 'pointer' : 'default')
    .on('mousemove', (e, d) => d.c && showTip(`<b>${esc(C[d.a].name)} → ${esc(C[d.b].name)}</b><br><b>${d.c.v ? fmt(d.c.v) : 'undisclosed'}</b> in ${d.c.deals.length} deal${d.c.deals.length > 1 ? 's' : ''}<br><span class="d">${d.c.deals.slice(0, 4).map(x => esc(x.title)).join('<br>')}</span>`, e))
    .on('mouseleave', hideTip)
    .on('click', (e, d) => { if (d.c) { S.pair = [d.a, d.b]; render(); } });
}

function drawTimeline(ds) {
  if (!ds.length) return emptyMsg('No deals match these filters.');
  const q = d => d.date.slice(0, 4) + ' Q' + (Math.floor((+d.date.slice(5, 7) - 1) / 3) + 1);
  const qs = []; for (let y = 2019; y <= +months[S.tIdx].slice(0, 4); y++) for (let k = 1; k <= 4; k++) { const s = y + ' Q' + k; if (s >= '2019 Q3' && s <= q({ date: months[S.tIdx] + '-01' })) qs.push(s); }
  const kinds = KINDS.map(k => k.k).filter(k => S.kinds.has(k));
  const rows = qs.map(Q => { const o = { Q, deals: ds.filter(d => q(d) === Q) }; kinds.forEach(k => o[k] = d3.sum(o.deals.filter(d => KIND_OF[d.type] === k), d => amt(d) || 0)); return o; });
  const [W, H] = stageSize();
  const m = { l: 60, r: 20, t: 40, b: 70 };
  const x = d3.scaleBand().domain(qs).range([m.l, W - m.r]).padding(0.18);
  const stack = d3.stack().keys(kinds)(rows);
  const y = d3.scaleLinear().domain([0, d3.max(rows, r => d3.sum(kinds, k => r[k])) || 1]).nice().range([H - m.b, m.t]);
  const viz = d3.select('#viz').html('');
  const svg = viz.append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H).attr('role', 'img').attr('aria-label', 'Money committed per quarter by deal kind');
  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(6).tickFormat(v => fmt(v)).tickSize(-(W - m.l - m.r)))
    .call(g => { g.select('.domain').remove(); g.selectAll('line').attr('stroke', css('--grid')); g.selectAll('text').attr('class', 'muted'); });
  svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues(qs.filter(s => s.endsWith('Q1') || qs.length < 14)))
    .call(g => { g.select('.domain').attr('stroke', css('--line-2')); g.selectAll('line').remove(); g.selectAll('text').attr('class', 'muted').attr('transform', 'rotate(-35)').attr('text-anchor', 'end'); });
  svg.append('text').attr('x', m.l).attr('y', 20).attr('class', 'muted').text('Money committed per quarter, by the date each deal was announced. Hover a bar for its biggest deals.');
  svg.append('g').selectAll('g').data(stack).join('g').attr('fill', s => kc(s.key)).selectAll('rect').data(s => s.map(v => ({ v, key: s.key }))).join('rect')
    .attr('x', d => x(d.v.data.Q)).attr('width', x.bandwidth()).attr('y', d => y(d.v[1])).attr('height', d => Math.max(0, y(d.v[0]) - y(d.v[1]))).attr('rx', 2)
    .on('mousemove', (e, d) => {
      const r = d.v.data; const top3 = r.deals.filter(x => KIND_OF[x.type] === d.key).sort((a, b) => (amt(b) || 0) - (amt(a) || 0)).slice(0, 4);
      showTip(`<b>${r.Q}</b> · ${KIND_LABEL[d.key]}: <b>${fmt(r[d.key])}</b><br><span class="d">${top3.map(x => `${esc(C[x.from].name)} → ${esc(C[x.to].name)}: ${fmt(amt(x))}`).join('<br>')}</span>`, e);
    }).on('mouseleave', hideTip);
  svg.append('g').selectAll('text').data(rows.filter(r => r.deals.length)).join('text').attr('x', r => x(r.Q) + x.bandwidth() / 2)
    .attr('y', r => y(d3.sum(kinds, k => r[k])) - 4).attr('text-anchor', 'middle').attr('class', 'muted').style('font-size', '10px').text(r => r.deals.length);
}

function drawValuations() {
  const pts = D.valuations.filter(v => v.date.slice(0, 7) <= months[S.tIdx]);
  const avail = [...d3.group(pts, v => v.company)].filter(([, v]) => v.length > 1).map(([k]) => k);
  S.valSel = S.valSel.filter(id => avail.includes(id));
  const [W, H] = stageSize();
  const viz = d3.select('#viz').html('');
  const chips = viz.append('div').style('padding', '12px 14px 0').style('display', 'flex').style('flex-wrap', 'wrap').style('gap', '6px');
  avail.sort((a, b) => C[a].name.localeCompare(C[b].name)).forEach(id => {
    const i = S.valSel.indexOf(id);
    chips.append('span').attr('class', 'chip' + (i < 0 ? ' off' : '')).html(`<span class="sw" style="background:${i < 0 ? 'var(--ink-3)' : SERIES[i]}"></span>${esc(C[id].name)}`)
      .on('click', () => { if (i >= 0) S.valSel.splice(i, 1); else if (S.valSel.length < 8) S.valSel.push(id); drawValuations(); });
  });
  if (!S.valSel.length) return viz.append('div').attr('class', 'empty').text('Pick up to eight companies above.');
  const sel = S.valSel.map(id => ({ id, v: pts.filter(p => p.company === id).sort((a, b) => a.date.localeCompare(b.date)) }));
  const all = sel.flatMap(s => s.v);
  const m = { l: 64, r: 130, t: 24, b: 40 }, h = H - 70;
  const x = d3.scaleTime().domain([new Date(2023, 0, 1), new Date(months[S.tIdx] + '-28')]).range([m.l, W - m.r]);
  const y = d3.scaleLog().domain([Math.min(1, d3.min(all, v => v.value_usd_bn)), d3.max(all, v => v.value_usd_bn) * 1.2]).range([h - m.b, m.t]);
  const svg = viz.append('svg').attr('viewBox', `0 0 ${W} ${h}`).attr('height', h).attr('role', 'img').attr('aria-label', 'Valuations over time, log scale');
  svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).tickValues([1, 3, 10, 30, 100, 300, 1000, 3000].filter(v => v >= y.domain()[0] && v <= y.domain()[1])).tickFormat(v => fmt(v)).tickSize(-(W - m.l - m.r)))
    .call(g => { g.select('.domain').remove(); g.selectAll('line').attr('stroke', css('--grid')); g.selectAll('text').attr('class', 'muted'); });
  svg.append('g').attr('transform', `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(6))
    .call(g => { g.select('.domain').attr('stroke', css('--line-2')); g.selectAll('line').remove(); g.selectAll('text').attr('class', 'muted'); });
  svg.append('text').attr('x', m.l).attr('y', 14).attr('class', 'muted').text('Log scale: each gridline step is roughly 3x. Private companies use funding-round prices; public ones use market value.');
  sel.forEach((s, i) => {
    const vs = s.v.filter(v => new Date(v.date) >= x.domain()[0] || s.v.length < 3);
    const line = d3.line().x(v => x(Math.max(new Date(v.date), x.domain()[0]))).y(v => y(v.value_usd_bn));
    svg.append('path').datum(vs).attr('fill', 'none').attr('stroke', SERIES[i]).attr('stroke-width', 2.2).attr('stroke-linejoin', 'round').attr('d', line);
    svg.append('g').selectAll('circle').data(vs).join('circle').attr('cx', v => x(Math.max(new Date(v.date), x.domain()[0]))).attr('cy', v => y(v.value_usd_bn)).attr('r', 4)
      .attr('fill', SERIES[i]).attr('stroke', css('--surface')).attr('stroke-width', 2)
      .on('mousemove', (e, v) => showTip(`<b>${esc(C[s.id].name)}</b><br>${fmt(v.value_usd_bn)} · ${v.date}<br><span class="d">${v.kind.replace('_', ' ')}</span>`, e)).on('mouseleave', hideTip);
    const last = vs[vs.length - 1];
    if (last) svg.append('text').attr('x', x(new Date(last.date)) + 8).attr('y', y(last.value_usd_bn)).attr('dy', '0.35em').style('font-weight', 600).text(`${C[s.id].name.replace(' (Alphabet)', '')} ${fmt(last.value_usd_bn)}`);
  });
}

let worldTopo = null;
function drawWorld(ds) {
  const [W, H] = stageSize();
  const viz = d3.select('#viz').html('');
  if (!worldTopo) {
    viz.append('div').attr('class', 'empty').text('Loading map…');
    d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(tp => { worldTopo = tp; if (S.view === 'world') drawWorld(filtered()); })
      .catch(() => emptyMsg('The map could not load. Check your connection.'));
    return;
  }
  const feats = topojson.feature(worldTopo, worldTopo.objects.countries).features.filter(f => f.properties.name !== 'Antarctica');
  const proj = d3.geoNaturalEarth1().fitSize([W - 20, H - 60], { type: 'FeatureCollection', features: feats });
  const path = d3.geoPath(proj);
  const byIso = new Map(feats.map(f => [f.id, f]));
  const cpos = {};
  Object.entries(COUNTRY).forEach(([k, [, iso]]) => { if (iso && byIso.has(iso)) cpos[k] = proj(k === 'US' ? [-98, 39] : k === 'FR' ? [2.5, 46.5] : k === 'NL' ? [5.3, 52.2] : d3.geoCentroid(byIso.get(iso))); });
  const flows = new Map(), cTot = {};
  ds.forEach(d => {
    const a = C[d.from].country, b = C[d.to].country, v = amt(d) || 0;
    (cTot[a] ||= { in: 0, out: 0, dom: 0 }); (cTot[b] ||= { in: 0, out: 0, dom: 0 });
    if (a === b) { cTot[a].dom += v; return; }
    cTot[a].out += v; cTot[b].in += v;
    const k = a + '>' + b; const f = flows.get(k) || { a, b, v: 0, n: 0 }; f.v += v; f.n++; flows.set(k, f);
  });
  const svg = viz.append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('height', H).attr('role', 'img').attr('aria-label', 'World map of AI money flows between countries');
  const g = svg.append('g').attr('transform', 'translate(10,40)');
  g.append('g').selectAll('path').data(feats).join('path').attr('d', path)
    .attr('fill', f => [...Object.values(COUNTRY)].some(([, iso]) => iso === f.id) ? '#1a2d5c' : '#0c1630')
    .attr('stroke', '#24386b').attr('stroke-width', 0.6);
  const fl = [...flows.values()].filter(f => cpos[f.a] && cpos[f.b] && f.v > 0);
  const wv = d3.scaleSqrt().domain([0, d3.max(fl, f => f.v) || 1]).range([1, 14]);
  g.append('g').attr('fill', 'none').selectAll('path').data(fl).join('path')
    .attr('d', f => { const [x1, y1] = cpos[f.a], [x2, y2] = cpos[f.b]; const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.25 - 20; return `M${x1},${y1}Q${mx},${my} ${x2},${y2}`; })
    .attr('stroke', kc('invest')).attr('stroke-opacity', 0.55).attr('stroke-width', f => wv(f.v)).attr('stroke-linecap', 'round').style('filter', 'drop-shadow(0 0 6px rgba(56,232,255,0.6))')
    .on('mousemove', (e, f) => showTip(`<b>${COUNTRY[f.a][0]} → ${COUNTRY[f.b][0]}</b><br><b>${fmt(f.v)}</b> across ${f.n} deals`, e)).on('mouseleave', hideTip);
  const rs = d3.scaleSqrt().domain([0, d3.max(Object.values(cTot), c => c.in + c.out + c.dom) || 1]).range([4, 46]);
  const cs = Object.entries(cTot).filter(([k]) => cpos[k]);
  g.append('g').selectAll('circle').data(cs).join('circle').attr('cx', ([k]) => cpos[k][0]).attr('cy', ([k]) => cpos[k][1]).attr('r', ([, c]) => rs(c.in + c.out + c.dom))
    .attr('fill', kc('compute')).attr('fill-opacity', 0.25).attr('stroke', kc('compute'))
    .on('mousemove', (e, [k, c]) => showTip(`<b>${COUNTRY[k][0]}</b><br>Within the country: <b>${fmt(c.dom)}</b><br>Sent abroad: <b>${fmt(c.out)}</b><br>Received from abroad: <b>${fmt(c.in)}</b>`, e)).on('mouseleave', hideTip);
  g.append('g').selectAll('text').data(cs).join('text').attr('x', ([k]) => cpos[k][0]).attr('y', ([k, c]) => cpos[k][1] - rs(c.in + c.out + c.dom) - 4).attr('text-anchor', 'middle').style('font-weight', 600)
    .style('paint-order', 'stroke').style('stroke', '#04070f').style('stroke-width', 3).text(([k]) => COUNTRY[k][0]);
  const glob = cTot.XX;
  svg.append('text').attr('x', 14).attr('y', 22).attr('class', 'muted').text(`Circles: money within each country. Arcs: money crossing borders.${glob ? ` Funds grouped as global (${fmt(glob.out)}) are left off the map.` : ''}`);
}

// ---------- legend + hints ----------
function renderLegend() {
  const L = $('#legend');
  const kindRow = `<div class="row">${KINDS.filter(k => S.kinds.has(k.k)).map(k => `<span><b style="border-color:${kc(k.k)}"></b>${k.label}</span>`).join('')}</div>`;
  if (S.view === 'network') {
    L.style.display = '';
    L.innerHTML = `<div class="row">${GROUPS.map(([g, l]) => `<span><i style="background:${gc(g)}"></i>${l}</span>`).join('')}</div>${kindRow}<div class="row"><span><b style="border-top-style:dashed;border-color:var(--ink-3)"></b>Not binding yet</span><span><b style="border-top-style:dotted;border-color:var(--ink-3)"></b>Amount undisclosed</span></div>${S.hl ? `<div class="row" style="color:var(--ink);font-weight:600">${esc(S.hlLabel)} <a href="#" id="clearhl" style="pointer-events:auto">clear</a></div>` : ''}`;
    const c = $('#clearhl'); if (c) c.onclick = (e) => { e.preventDefault(); S.hl = null; render(); };
  } else if (S.view === 'sankey' || S.view === 'timeline') {
    L.style.display = ''; L.innerHTML = kindRow;
  } else { L.style.display = 'none'; }
  L.style.top = S.view === 'sankey' ? 'auto' : S.view === 'timeline' ? '30px' : '';
  L.style.bottom = S.view === 'sankey' ? '30px' : '';
  L.style.left = S.view === 'timeline' ? 'auto' : '';
  L.style.right = S.view === 'timeline' ? '14px' : '';
  const hints = {
    network: 'Drag to move, scroll to zoom. Click a company or a line for details. Line thickness = money.',
    sankey: 'Left: who funds AI companies. Right: who those companies pay for chips and cloud. Click a company for its profile.',
    matrix: 'The 24 companies with the most money flowing through them. Click a square for the deals behind it.',
    timeline: 'Numbers above bars = deals announced that quarter.',
    valuations: 'Click names to compare up to eight companies.',
    world: 'Hover circles and arcs for amounts.',
  };
  $('#hint').textContent = hints[S.view];
}

// ---------- table ----------
function renderTable(ds) {
  let rows = ds;
  if (S.selected) rows = rows.filter(d => d.from === S.selected || d.to === S.selected);
  if (S.pair) rows = rows.filter(d => S.pair.includes(d.from) && S.pair.includes(d.to));
  const q = S.tq.toLowerCase();
  if (q) rows = rows.filter(d => (C[d.from].name + ' ' + C[d.to].name + ' ' + d.title + ' ' + (d.description || '') + ' ' + (d.participants || []).join(' ')).toLowerCase().includes(q));
  const key = { date: d => d.date, amt: d => amt(d) ?? -1, from: d => C[d.from].name, kind: d => KIND_OF[d.type] }[S.tsort.k];
  rows = rows.slice().sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * S.tsort.dir);
  $('#tcount').textContent = `${rows.length} deals${S.selected ? ' involving ' + C[S.selected].name : ''}${S.pair ? ' between ' + C[S.pair[0]].name + ' and ' + C[S.pair[1]].name : ''} · ${fmt(d3.sum(rows, d => amt(d) || 0))}`;
  $('#tbody').innerHTML = rows.map(d => `<tr>
    <td class="num">${d.date.slice(0, d.date_precision === 'year' ? 4 : d.date_precision === 'month' ? 7 : 10)}</td>
    <td>${coLink(d.from)} → ${coLink(d.to)}</td>
    <td class="amt">${fmt(amt(d))}<div class="d">${BASIS_LABEL[d.amount_basis]}</div></td>
    <td><span class="kdot" style="background:${kc(KIND_OF[d.type])}"></span>${TYPE_LABEL[d.type]}<div class="d">${STATUS_LABEL[d.status]}</div></td>
    <td><b>${esc(d.title)}</b><div class="d">${esc(d.description || '')}${d.amount_note ? ' ' + esc(d.amount_note) + '.' : ''}${d.participants ? ' Investors: ' + esc(d.participants.join(', ')) + '.' : ''}</div></td>
    <td>${d.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publisher)}</a>`).join('<br>')}</td></tr>`).join('');
  $('#tbody').querySelectorAll('[data-co]').forEach(el => el.onclick = () => { select(el.dataset.co); window.scrollTo({ top: 0, behavior: 'smooth' }); });
}

// ---------- orchestration ----------
function select(id) { S.selected = S.selected === id ? null : id; S.pair = null; S.hl = null; render(); syncHash(); }
function setView(v) { S.view = v; document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); render(); syncHash(); }
function drawView(ds) {
  hideTip();
  $('.stage').classList.toggle('stick', ['network', 'timeline', 'valuations', 'world'].includes(S.view));
  ({ network: drawNetwork, sankey: drawSankey, matrix: drawMatrix, timeline: drawTimeline, valuations: drawValuations, world: drawWorld })[S.view](ds);
  renderLegend();
}
function render() {
  const ds = filtered();
  const loops = renderKpis(ds);
  drawView(ds);
  renderPanel(ds, loops);
  if (S.selected) drawSpark(S.selected);
  renderTable(ds);
  $('#timelbl').textContent = monthName(months[S.tIdx]);
}
function syncHash() {
  const p = new URLSearchParams(); p.set('view', S.view); if (S.selected) p.set('company', S.selected);
  history.replaceState(null, '', '#' + p.toString());
}

function initControls() {
  $('#kinds').innerHTML = KINDS.map(k => `<label class="chip" data-k="${k.k}"><span class="sw" style="background:${kc(k.k)}"></span>${k.label}</label>`).join('');
  document.querySelectorAll('#kinds .chip').forEach(el => el.onclick = () => {
    const k = el.dataset.k; if (S.kinds.has(k)) { if (S.kinds.size > 1) S.kinds.delete(k); } else S.kinds.add(k);
    document.querySelectorAll('#kinds .chip').forEach(c => c.classList.toggle('off', !S.kinds.has(c.dataset.k))); render();
  });
  $('#status').onchange = e => { S.status = e.target.value; render(); };
  $('#est').onchange = e => { S.est = e.target.checked; $('#estchip').classList.toggle('off', !S.est); render(); };
  $('#cat').innerHTML += GROUPS.map(([g, l]) => `<option value="${g}">${l}</option>`).join('');
  $('#cat').onchange = e => { S.cat = e.target.value; render(); };
  $('#companylist').innerHTML = D.companies.map(c => `<option value="${esc(c.name)}">`).join('');
  $('#find').onchange = e => { const c = D.companies.find(x => x.name.toLowerCase() === e.target.value.toLowerCase()); if (c) { S.selected = null; select(c.id); e.target.value = ''; } };
  document.querySelectorAll('#views button').forEach(b => b.onclick = () => setView(b.dataset.v));
  const tr = $('#time'); tr.max = months.length - 1; tr.value = S.tIdx;
  tr.oninput = e => { S.tIdx = +e.target.value; render(); };
  $('#play').onclick = () => {
    if (playing) { clearInterval(playing); playing = null; $('#play').textContent = '▶ Play'; return; }
    if (S.tIdx >= months.length - 1) S.tIdx = months.indexOf('2023-01');
    $('#play').textContent = '❚❚ Pause';
    playing = setInterval(() => {
      if (S.tIdx >= months.length - 1) { clearInterval(playing); playing = null; $('#play').textContent = '▶ Play'; return; }
      S.tIdx++; tr.value = S.tIdx; render();
    }, 450);
  };
  $('#tfind').oninput = e => { S.tq = e.target.value; renderTable(filtered()); };
  document.querySelectorAll('th[data-sort]').forEach(th => th.onclick = () => {
    const k = th.dataset.sort; S.tsort = { k, dir: S.tsort.k === k ? -S.tsort.dir : (k === 'from' ? 1 : -1) }; renderTable(filtered());
  });
  $('#ghlink').href = REPO_URL;
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => drawView(filtered()), 200); });
}

async function main() {
  D = await fetch('data/bundle.json').then(r => r.json());
  C = Object.fromEntries(D.companies.map(c => [c.id, c]));
  const end = D.data_as_of.slice(0, 7);
  for (let d = new Date(2019, 6, 1); ; d.setMonth(d.getMonth() + 1)) {
    const m = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    months.push(m); if (m >= end) break;
  }
  S.tIdx = months.length - 1;
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get('view')) S.view = p.get('view');
  if (p.get('company') && C[p.get('company')]) S.selected = p.get('company');
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view));
  $('#asof').innerHTML = `<i></i>Updated ${monthName(end)} · ${D.deals.length} deals`;
  const latest = D.deals.filter(d => d.amount_usd_bn).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 24);
  const items = latest.map(d => `<span class="item" data-co="${d.from}"><i style="color:${kc(KIND_OF[d.type])};background:${kc(KIND_OF[d.type])}"></i><b>${esc(C[d.from].name.replace(' (Alphabet)', ''))}</b> → <b>${esc(C[d.to].name.replace(' (Alphabet)', ''))}</b> <span class="amt">${fmt(d.amount_usd_bn)}</span> <span>${esc(monthName(d.date.slice(0, 7)))}</span></span>`).join('');
  $('#ticker').innerHTML = items + items;
  $('#ticker').querySelectorAll('[data-co]').forEach(el => el.onclick = () => { select(el.dataset.co); document.getElementById('explore').scrollIntoView({ behavior: 'smooth' }); });
  $('#gen').textContent = ` Last built ${D.generated_at.slice(0, 10)}.`;
  initControls();
  render();
}
main().catch(err => { console.error(err); emptyMsg('Could not load the data. ' + esc(err.message)); });
})();
