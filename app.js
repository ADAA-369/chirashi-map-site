/* チラシ配布マップ — MVP（端末内保存版） */
'use strict';

const CFG = window.CHIRASHI_CONFIG || {};
const DATA_BASE = location.pathname.includes('/app/') ? '../data/by_city/' : 'data/by_city/';
const DEFAULT_CITIES = ['23425_蟹江町', '23208_津島市', '23232_愛西市', '23237_あま市', '23235_弥富市', '23424_大治町', '23427_飛島村'];
const PALETTE = ['#2f81f7', '#f2a93b', '#3fb950', '#c678dd', '#ff7b72', '#39c5cf', '#e3b341', '#8b949e'];
const DEFAULT_SETTINGS = {
  flyers: [{ id: 'f1', name: '政策ビラ第1号', color: PALETTE[0] }],
  members: ['野口'],
  noticeDate: '',
  cities: DEFAULT_CITIES,
};
// 端末ごとの設定（地図位置など）
const localView = {
  get() { try { return JSON.parse(localStorage.getItem('cm_view') || 'null') || { center: { lat: 35.135, lng: 136.79 }, zoom: 15 }; } catch { return { center: { lat: 35.135, lng: 136.79 }, zoom: 15 }; } },
  set(v) { localStorage.setItem('cm_view', JSON.stringify(v)); },
};

/* ---------------- 保存アダプタ（端末内） ---------------- */
const LocalStore = {
  key: 'cm_records_v1',
  skey: 'cm_settings_v1',
  async loadRecords() { try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch { return []; } },
  async saveRecord(r) {
    const a = await this.loadRecords();
    const i = a.findIndex(x => x.id === r.id);
    if (i >= 0) a[i] = r; else a.push(r);
    localStorage.setItem(this.key, JSON.stringify(a));
  },
  async deleteRecord(id) {
    const a = (await this.loadRecords()).filter(x => x.id !== id);
    localStorage.setItem(this.key, JSON.stringify(a));
  },
  async loadSettings() {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(this.skey) || '{}') }; } catch { return { ...DEFAULT_SETTINGS }; }
  },
  async saveSettings(s) { localStorage.setItem(this.skey, JSON.stringify(s)); },
  subscribe() { /* 端末内保存は他端末からの更新なし */ },
  bkey: 'cm_boards_v1',
  async loadBoards() { try { return JSON.parse(localStorage.getItem(this.bkey) || '[]'); } catch { return []; } },
  async saveBoard(b) { const a = await this.loadBoards(); const i = a.findIndex(x => x.id === b.id); if (i >= 0) a[i] = b; else a.push(b); localStorage.setItem(this.bkey, JSON.stringify(a)); },
  async deleteBoard(id) { localStorage.setItem(this.bkey, JSON.stringify((await this.loadBoards()).filter(x => x.id !== id))); },
  async uploadPhoto() { toast('端末内保存版では写真を保存できません'); return null; },
  async photoUrl() { return null; },
  _l(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } },
  _s(k, a) { localStorage.setItem(k, JSON.stringify(a)); },
  async loadSpots() { return this._l('cm_spots_v1'); },
  async saveSpot(x) { const a = this._l('cm_spots_v1'); const i = a.findIndex(y => y.id === x.id); if (i >= 0) a[i] = x; else a.push(x); this._s('cm_spots_v1', a); },
  async deleteSpot(id) { this._s('cm_spots_v1', this._l('cm_spots_v1').filter(y => y.id !== id)); },
  async loadEvents() { return this._l('cm_events_v1'); },
  async saveEvent(x) { const a = this._l('cm_events_v1'); const i = a.findIndex(y => y.id === x.id); if (i >= 0) a[i] = x; else a.push(x); this._s('cm_events_v1', a); },
  async deleteEvent(id) { this._s('cm_events_v1', this._l('cm_events_v1').filter(y => y.id !== id)); },
};
/* ---------------- 保存アダプタ（Supabase 共有） ---------------- */
const SupabaseStore = {
  client: null, pass: '', _lastJson: '', _timer: null,
  init(pass) {
    this.pass = pass;
    this.client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { global: { headers: { 'x-passphrase': pass } } });
  },
  // 合言葉の検証：正しければ settings が1行返る（RLS）
  async verify(pass) {
    this.init(pass);
    const { data, error } = await this.client.from('settings').select('id').eq('id', 'main');
    return !error && Array.isArray(data) && data.length === 1;
  },
  rowToRec(r) { return { id: r.id, member: r.member, date: r.date, flyer_id: r.flyer_id, count: r.count, memo: r.memo || '', polygon: r.polygon, est_setai: r.est_setai, town: r.town, area_m2: r.area_m2, created_at: r.created_at, updated_at: r.updated_at }; },
  async loadRecords() {
    const { data, error } = await this.client.from('records').select('*').eq('deleted', false).order('date', { ascending: false });
    if (error) { console.error(error); toast('読み込みに失敗しました（通信）'); return S.records || []; }
    return data.map(r => this.rowToRec(r));
  },
  async saveRecord(r) {
    const row = { id: r.id, member: r.member, date: r.date, flyer_id: r.flyer_id, count: r.count, memo: r.memo || '', polygon: r.polygon, est_setai: r.est_setai, town: r.town, area_m2: r.area_m2, updated_at: new Date().toISOString() };
    const { error } = await this.client.from('records').upsert(row);
    if (error) { console.error(error); toast('保存に失敗しました（通信）'); throw error; }
  },
  async deleteRecord(id) {
    const { error } = await this.client.from('records').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { console.error(error); toast('削除に失敗しました（通信）'); throw error; }
  },
  async loadSettings() {
    const { data, error } = await this.client.from('settings').select('data').eq('id', 'main').maybeSingle();
    if (error || !data) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(data.data || {}) };
  },
  async saveSettings(s) {
    const { flyers, members, noticeDate, cities } = s;
    const { error } = await this.client.from('settings').upsert({ id: 'main', data: { flyers, members, noticeDate, cities }, updated_at: new Date().toISOString() });
    if (error) { console.error(error); toast('設定の保存に失敗しました（通信）'); }
  },
  async loadBoards() {
    const { data, error } = await this.client.from('boards').select('*').eq('deleted', false).order('no');
    if (error) { console.error(error); return S.boards || []; }
    return data;
  },
  async saveBoard(b) {
    const row = { id: b.id, kind: b.kind || 'official', no: b.no || '', place: b.place || '', lat: b.lat, lng: b.lng, status: b.status || 'todo', posted_by: b.posted_by || null, posted_at: b.posted_at || null, photo_path: b.photo_path || null, memo: b.memo || '', updated_at: new Date().toISOString() };
    const { error } = await this.client.from('boards').upsert(row);
    if (error) { console.error(error); toast('保存に失敗しました（通信）'); throw error; }
  },
  async deleteBoard(id) {
    const { error } = await this.client.from('boards').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { console.error(error); toast('削除に失敗しました（通信）'); throw error; }
  },
  async uploadPhoto(blob, boardId) {
    const path = `${boardId}/${Date.now()}.jpg`;
    const { error } = await this.client.storage.from('posters').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) { console.error(error); toast('写真の保存に失敗しました'); return null; }
    return path;
  },
  async photoUrl(path) {
    if (!path) return null;
    const { data, error } = await this.client.storage.from('posters').createSignedUrl(path, 3600);
    return error ? null : data.signedUrl;
  },
  async loadSpots() { const { data, error } = await this.client.from('spots').select('*').eq('deleted', false).order('name'); if (error) { console.error(error); return S.spots || []; } return data; },
  async saveSpot(x) { const { error } = await this.client.from('spots').upsert({ id: x.id, kind: x.kind || 'station', name: x.name || '', lat: x.lat, lng: x.lng, memo: x.memo || '', updated_at: new Date().toISOString() }); if (error) { console.error(error); toast('保存に失敗しました（通信）'); throw error; } },
  async deleteSpot(id) { const { error } = await this.client.from('spots').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id); if (error) { console.error(error); toast('削除に失敗しました（通信）'); throw error; } },
  async loadEvents() { const { data, error } = await this.client.from('spot_events').select('*').eq('deleted', false).order('date'); if (error) { console.error(error); return S.events || []; } return data; },
  async saveEvent(x) { const { error } = await this.client.from('spot_events').upsert({ id: x.id, spot_id: x.spot_id, date: x.date, time: x.time || '', member: x.member || null, memo: x.memo || '', done: !!x.done, updated_at: new Date().toISOString() }); if (error) { console.error(error); toast('保存に失敗しました（通信）'); throw error; } },
  async deleteEvent(id) { const { error } = await this.client.from('spot_events').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id); if (error) { console.error(error); toast('削除に失敗しました（通信）'); throw error; } },
  // 15秒ごと＋画面復帰時に他の人の更新を取り込む
  subscribe(cb) {
    const tick = async () => {
      if (document.hidden || S.drawing || S.adjust) return;
      try {
        const [recs, sets, boards, spots, events] = await Promise.all([this.loadRecords(), this.loadSettings(), this.loadBoards(), this.loadSpots(), this.loadEvents()]);
        const j = JSON.stringify([recs, sets, boards, spots, events]);
        if (j !== this._lastJson) { this._lastJson = j; cb(recs, sets, boards, spots, events); }
      } catch { }
    };
    this._timer = setInterval(tick, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  },
};
// 開発用：URLに ?local=1 を付けると共有データに触らず端末内保存で動く
const USE_SUPABASE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase) && !new URLSearchParams(location.search).has('local');
const store = USE_SUPABASE ? SupabaseStore : LocalStore;

/* ---------------- 状態 ---------------- */
const S = window.S = {
  map: null, proj: null,
  settings: null, records: [], user: null,
  filter: { period: '30', flyers: new Set() },
  polys: new Map(),      // record.id -> google.maps.Polygon
  labels: [],
  overlapPolys: [],
  towns: [],             // {feature, id, name, city, setai, area}
  townFeatures: new Map(), // data feature id -> town
  infoWin: null,
  drawing: null,
  boards: [], boardMarkers: new Map(), boardsOn: false, boardAdding: false,
  spots: [], events: [], spotMarkers: new Map(), spotsOn: true, spotBarOn: false, spotAdding: false,
};

const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDate = s => { const [y, m, d] = s.split('-'); return `${m}/${d}`; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const flyerOf = id => S.settings.flyers.find(f => f.id === id) || { name: '(削除済み)', color: '#888' };
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, ms); }

/* ---------------- 起動 ---------------- */
window.addEventListener('DOMContentLoaded', init);
document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
let _lastTouchEnd = 0;
document.addEventListener('touchend', e => { const now = Date.now(); if (now - _lastTouchEnd < 300 && !e.target.closest('#map')) e.preventDefault(); _lastTouchEnd = now; }, { passive: false });
window.addEventListener('error', e => { console.error(e.error || e.message); toast('エラー: ' + (e.message || '不明').slice(0, 80), 5000); });
window.addEventListener('unhandledrejection', e => { console.error(e.reason); toast('エラー: ' + String(e.reason?.message || e.reason).slice(0, 80), 5000); });

async function init() {
  bindUI();
  await login();                       // 合言葉の検証と名前の選択（設定はこの中で読み込む）
  [S.records, S.boards, S.spots, S.events] = await Promise.all([store.loadRecords(), store.loadBoards(), store.loadSpots(), store.loadEvents()]);
  S.filter.flyers = new Set(S.settings.flyers.map(f => f.id));
  await loadGoogleMaps();
  await initMap();
  await loadTowns();
  renderAll();
  store.subscribe((recs, sets, boards, spots, events) => {
    S.records = recs; if (boards) S.boards = boards; if (spots) S.spots = spots; if (events) S.events = events;
    if (sets) { S.settings = { ...S.settings, ...sets }; for (const f of S.settings.flyers) if (!S.filter.flyers.has(f.id) && !S._userToggled) S.filter.flyers.add(f.id); }
    renderAll();
  });
}

/* ---------------- ログイン（合言葉＋名前） ---------------- */
function login() {
  return new Promise(async resolve => {
    const saved = JSON.parse(localStorage.getItem('cm_user') || 'null');
    if (saved?.name) {
      const ok = USE_SUPABASE ? await SupabaseStore.verify(saved.pass || '') : true;
      if (ok) {
        S.settings = await store.loadSettings();
        if (S.settings.members.includes(saved.name)) { S.user = saved.name; $('#menuUser').textContent = `👤 ${saved.name}`; return resolve(); }
      }
    }
    showLogin(resolve);
  });
}
function showLogin(resolve) {
  const box = $('#login'); box.hidden = false;
  const needPass = USE_SUPABASE;
  $('#loginPass').hidden = !needPass;
  $('#loginMsg').textContent = needPass ? '合言葉を入れてください' : 'あなたの名前を選んでください';
  $('#loginSub').hidden = !needPass;
  const sel = $('#selName'); const nameWrap = sel.closest('label');
  let verified = !needPass;
  const fillNames = () => {
    sel.innerHTML = S.settings.members.map(m => `<option>${esc(m)}</option>`).join('') + '<option value="__new">＋ 新しい名前を追加</option>';
    sel.onchange = () => $('#newNameWrap').hidden = sel.value !== '__new';
    nameWrap.hidden = false;
  };
  nameWrap.hidden = needPass; $('#newNameWrap').hidden = true;
  if (!needPass) { (async () => { S.settings = S.settings || await store.loadSettings(); fillNames(); })(); }
  $('#btnLogin').textContent = needPass ? '次へ' : 'はじめる';
  $('#loginErr').textContent = '';
  $('#btnLogin').onclick = async () => {
    const pass = $('#inpPass').value.trim();
    if (!verified) {
      if (!pass) { $('#loginErr').textContent = '合言葉を入れてください'; return; }
      $('#btnLogin').disabled = true; $('#loginErr').textContent = '確認中…';
      const ok = await SupabaseStore.verify(pass);
      $('#btnLogin').disabled = false;
      if (!ok) { $('#loginErr').textContent = '合言葉が違います（または通信できません）'; return; }
      verified = true; $('#loginErr').textContent = '';
      S.settings = await store.loadSettings();
      fillNames(); $('#inpPass').disabled = true; $('#btnLogin').textContent = 'はじめる';
      return;
    }
    let name = sel.value;
    if (name === '__new') {
      name = $('#inpNewName').value.trim();
      if (!name) { $('#loginErr').textContent = '名前を入れてください'; return; }
      if (!S.settings.members.includes(name)) { S.settings.members.push(name); await store.saveSettings(S.settings); }
    }
    S.user = name;
    localStorage.setItem('cm_user', JSON.stringify({ name, pass }));
    box.hidden = true; $('#inpPass').disabled = false;
    $('#menuUser').textContent = `👤 ${name}`;
    resolve && resolve();
  };
}

/* ---------------- Google Maps 読み込み ---------------- */
function loadGoogleMaps() {
  return new Promise((resolve, reject) => {
    if (!CFG.GOOGLE_MAPS_API_KEY || CFG.GOOGLE_MAPS_API_KEY.startsWith('ここに')) {
      reject(new Error('APIキー未設定')); alert('config.local.js にGoogle MapsのAPIキーを設定してください'); return;
    }
    // 公式ブートストラップローダー
    ((g) => { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => { await (a = m.createElement("script")); e.set("libraries", [...r] + ""); for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]); e.set("callback", c + ".maps." + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e; d[q] = f; a.onerror = () => h = n(Error(p + " could not load.")); a.nonce = m.querySelector("script[nonce]")?.nonce || ""; m.head.append(a) })); d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)) })({ key: CFG.GOOGLE_MAPS_API_KEY, v: 'weekly', language: 'ja', region: 'JP' });
    google.maps.importLibrary('maps').then(resolve, reject);
  });
}

async function initMap() {
  const { Map, OverlayView, InfoWindow } = google.maps;
  const view = localView.get();
  S.map = new Map($('#map'), {
    center: view.center, zoom: view.zoom,
    mapTypeId: 'hybrid', tilt: 0,
    disableDefaultUI: true, zoomControl: false, mapTypeControl: true,
    mapTypeControlOptions: { mapTypeIds: ['hybrid', 'roadmap'], position: google.maps.ControlPosition.RIGHT_TOP },
    gestureHandling: 'greedy', clickableIcons: false,
  });
  class Proj extends OverlayView { onAdd() { } draw() { } onRemove() { } }
  S.proj = new Proj(); S.proj.setMap(S.map);
  S.infoWin = new InfoWindow();
  // 現在地ボタン
  const loc = document.createElement('button');
  loc.className = 'ghost'; loc.textContent = '◎'; loc.title = '現在地';
  Object.assign(loc.style, { width: '40px', height: '40px', margin: '10px', borderRadius: '8px', fontSize: '20px', background: '#fff', color: '#333', boxShadow: '0 1px 4px rgba(0,0,0,.3)' });
  loc.onclick = () => navigator.geolocation?.getCurrentPosition(p => { S.map.panTo({ lat: p.coords.latitude, lng: p.coords.longitude }); S.map.setZoom(17); }, () => toast('現在地を取得できませんでした'), { enableHighAccuracy: true, timeout: 8000 });
  S.map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(loc);
  $('#zoomIn').onclick = () => S.map.setZoom(S.map.getZoom() + 1);
  $('#zoomOut').onclick = () => S.map.setZoom(S.map.getZoom() - 1);
  $('#svBtn').onclick = () => { const c = S.map.getCenter(); window.open(svUrl(c.lat(), c.lng()), '_blank', 'noopener'); };
  S.map.addListener('click', ev => { if (S.boardAdding) addBoardAt(ev.latLng); else if (S.spotAdding) addSpotAt(ev.latLng); });
  S.map.addListener('idle', () => {
    const c = S.map.getCenter(); localView.set({ center: { lat: c.lat(), lng: c.lng() }, zoom: S.map.getZoom() });
    styleTowns();
    const z = S.map.getZoom(); if (S._lastZoom !== undefined && (z >= 15) !== (S._lastZoom >= 15)) renderRecords(); S._lastZoom = z;
  });
}

/* ---------------- 町丁目 ---------------- */
async function loadTowns() {
  const files = S.settings.cities || DEFAULT_CITIES;
  const results = await Promise.allSettled(files.map(f => fetch(DATA_BASE + f + '.geojson').then(r => r.json())));
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const f of r.value.features) {
      const p = f.properties;
      if (p.HCODE === 8154) continue; // 水面
      const town = { feature: f, id: p.KEY_CODE, name: p.S_NAME, city: p.CITY_NAME, setai: p.SETAI, jinko: p.JINKO, area: turf.area(f), kigo: p.KIGO_E };
      S.towns.push(town);
      const [df] = S.map.data.addGeoJson(f, { idPropertyName: 'KEY_CODE' });
      S.townFeatures.set(df, town);
    }
  }
  S.map.data.addListener('click', ev => showTownInfo(S.townFeatures.get(ev.feature), ev.latLng));
  styleTowns();
}
function styleTowns() {
  const z = S.map.getZoom();
  const adding = S.boardAdding || S.spotAdding;
  S.map.data.setStyle({ visible: z >= 14, strokeColor: '#ffffff', strokeOpacity: z >= 16 ? 0.55 : 0.35, strokeWeight: 1, fillOpacity: 0, clickable: z >= 14 && !adding, zIndex: 1 });
}
// 追加モード：ポリゴンやピンがタップを横取りしないようにする
function setAddingUI(on) {
  styleTowns();
  for (const p of S.polys.values()) p.setOptions({ clickable: !on });
  for (const p of S.overlapPolys) p.setOptions({ clickable: false });
  for (const m of S.boardMarkers.values()) m.setOptions({ clickable: !on });
  for (const m of S.spotMarkers.values()) m.setOptions({ clickable: !on });
  S.map.setOptions({ draggableCursor: on ? 'crosshair' : null });
  if (on) { S.infoWin.close(); closeSheet(); }
}
function showTownInfo(town, latLng) {
  if (!town || S.drawing) return;
  const recs = filteredRecords();
  const rows = S.settings.flyers.filter(f => S.filter.flyers.has(f.id)).map(f => {
    const cov = coverageOf(town, recs.filter(r => r.flyer_id === f.id));
    return `<div style="margin:4px 0"><span style="display:inline-block;width:10px;height:10px;background:${f.color};border-radius:2px;margin-right:6px"></span>${esc(f.name)}：<b>${Math.round(cov * 100)}%</b>（約${Math.round(cov * town.setai)}世帯）</div>`;
  }).join('');
  const html = `<div style="color:#222;font-size:13px;min-width:180px"><b style="font-size:14px">${esc(town.city)} ${esc(town.name)}</b><div style="color:#666;margin:2px 0 6px">${town.setai.toLocaleString()}世帯 ／ ${town.jinko.toLocaleString()}人${town.kigo && town.kigo !== 'E1' ? '（飛び地・世帯数は本体側に計上）' : ''}</div>${rows || '<div style="color:#666">表示中のチラシがありません</div>'}</div>`;
  S.infoWin.setContent(html); S.infoWin.setPosition(latLng); S.infoWin.open(S.map);
}
// 町丁目に対する配布率（面積ベース）
function coverageOf(town, recs) {
  if (!recs.length) return 0;
  const polys = recs.map(r => recPolygon(r)).filter(p => turf.booleanIntersects(p, town.feature));
  if (!polys.length) return 0;
  let u = polys[0];
  if (polys.length > 1) { try { u = turf.union(turf.featureCollection(polys)) || u; } catch { } }
  try {
    const inter = turf.intersect(turf.featureCollection([u, town.feature]));
    return inter ? Math.min(1, turf.area(inter) / town.area) : 0;
  } catch { return 0; }
}
// 記録1件の推定世帯数と主な町丁目
function estimateRecord(poly) {
  let setai = 0, best = null, bestA = 0;
  for (const t of S.towns) {
    if (!turf.booleanIntersects(poly, t.feature)) continue;
    let inter; try { inter = turf.intersect(turf.featureCollection([poly, t.feature])); } catch { continue; }
    if (!inter) continue;
    const a = turf.area(inter);
    setai += (a / t.area) * t.setai;
    if (a > bestA) { bestA = a; best = t; }
  }
  return { setai: Math.round(setai), town: best ? `${best.city} ${best.name}` : '' };
}

/* ---------------- 記録のラベル（ポリゴン内に常時表示） ---------------- */
let RecLabel = null;
function ensureLabelClass() {
  if (RecLabel) return;
  RecLabel = class extends google.maps.OverlayView {
    constructor(pos, html, color) { super(); this.pos = pos; this.html = html; this.color = color; this.div = null; }
    onAdd() {
      const d = document.createElement('div'); d.className = 'recLabel'; d.style.borderColor = this.color; d.innerHTML = this.html;
      this.div = d; this.getPanes().overlayLayer.appendChild(d);   // クリックはポリゴンへ通す
    }
    draw() {
      if (!this.div) return;
      const p = this.getProjection().fromLatLngToDivPixel(new google.maps.LatLng(this.pos.lat, this.pos.lng));
      this.div.style.left = p.x + 'px'; this.div.style.top = p.y + 'px';
    }
    onRemove() { this.div?.remove(); this.div = null; }
  };
}

/* ---------------- 記録の描画 ---------------- */
const recPolygon = r => turf.polygon([r.polygon]);

function filteredRecords() {
  const p = S.filter.period;
  let since = null;
  if (p !== 'all') { const d = new Date(); d.setDate(d.getDate() - Number(p)); since = d.toISOString().slice(0, 10); }
  return S.records.filter(r => S.filter.flyers.has(r.flyer_id) && (!since || r.date >= since));
}

function renderAll() {
  renderChips(); renderNotice(); renderLegend(); renderRecords(); renderBoards(); renderSpots();
}

function renderRecords() {
  ensureLabelClass();
  for (const p of S.polys.values()) p.setMap(null);
  S.polys.clear();
  for (const l of S.labels) l.setMap(null);
  S.labels = [];
  const showLabels = S.map.getZoom() >= 15;
  for (const p of S.overlapPolys) p.setMap(null);
  S.overlapPolys = [];
  const recs = filteredRecords();
  for (const r of recs) {
    const f = flyerOf(r.flyer_id);
    const poly = new google.maps.Polygon({
      paths: r.polygon.map(([lng, lat]) => ({ lat, lng })),
      strokeColor: f.color, strokeOpacity: 0.95, strokeWeight: 2,
      fillColor: f.color, fillOpacity: 0.32, map: S.map, zIndex: 2,
    });
    poly.addListener('click', ev => { if (!S.drawing) showRecord(r, ev.latLng); });
    S.polys.set(r.id, poly);
    if (showLabels) {
      const c = turf.centerOfMass(recPolygon(r)).geometry.coordinates;
      const html = `<b>${fmtDate(r.date)}</b> ${esc(r.member)}<br>${esc(f.name)} <b>${r.count.toLocaleString()}</b>枚`;
      const lb = new RecLabel({ lat: c[1], lng: c[0] }, html, f.color); lb.setMap(S.map); S.labels.push(lb);
    }
  }
  // 同じチラシ同士の重なりを赤で表示
  const byFlyer = {};
  for (const r of recs) (byFlyer[r.flyer_id] ||= []).push(r);
  for (const list of Object.values(byFlyer)) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = recPolygon(list[i]), b = recPolygon(list[j]);
      if (!turf.booleanIntersects(a, b)) continue;
      let inter; try { inter = turf.intersect(turf.featureCollection([a, b])); } catch { continue; }
      if (!inter) continue;
      const rings = inter.geometry.type === 'Polygon' ? [inter.geometry.coordinates] : inter.geometry.coordinates;
      for (const ring of rings) {
        const p = new google.maps.Polygon({
          paths: ring.map(rr => rr.map(([lng, lat]) => ({ lat, lng }))),
          strokeColor: '#ff1744', strokeWeight: 2, fillColor: '#ff1744', fillOpacity: 0.55, map: S.map, zIndex: 3, clickable: false,
        });
        S.overlapPolys.push(p);
      }
    }
  }
}

function renderChips() {
  const el = $('#flyerChips');
  el.innerHTML = S.settings.flyers.map(f => `<button class="chip ${S.filter.flyers.has(f.id) ? 'on' : ''}" data-id="${f.id}" style="--c:${f.color}" draggable="true" title="ドラッグで並べ替え"><span class="dot"></span>${esc(f.name)}</button>`).join('');
  el.querySelectorAll('.chip').forEach(c => {
    c.onclick = () => {
      const id = c.dataset.id; S._userToggled = true;
      if (S.filter.flyers.has(id)) S.filter.flyers.delete(id); else S.filter.flyers.add(id);
      renderAll();
    };
    c.ondragstart = e => { e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); };
    c.ondragend = () => c.classList.remove('dragging');
    c.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; c.classList.add('dragOver'); };
    c.ondragleave = () => c.classList.remove('dragOver');
    c.ondrop = async e => {
      e.preventDefault(); c.classList.remove('dragOver');
      const from = e.dataTransfer.getData('text/plain'), to = c.dataset.id; if (!from || from === to) return;
      const arr = S.settings.flyers; const fi = arr.findIndex(f => f.id === from), ti = arr.findIndex(f => f.id === to);
      if (fi < 0 || ti < 0) return;
      const [m] = arr.splice(fi, 1); arr.splice(ti, 0, m);
      await store.saveSettings(S.settings); renderAll(); toast('並び順を保存しました');
    };
  });
}
function flyerTotals() {
  // 全期間の配布合計（期間フィルタに関係なく残り枚数を出す）
  const used = {}; for (const r of S.records) used[r.flyer_id] = (used[r.flyer_id] || 0) + (r.count || 0);
  return S.settings.flyers.map(f => ({ ...f, used: used[f.id] || 0, remain: f.total ? f.total - (used[f.id] || 0) : null }));
}
function renderLegend() {
  const n = filteredRecords().length;
  const stock = flyerTotals().filter(f => S.filter.flyers.has(f.id)).map(f => `<div class="lg"><span class="sw" style="background:${f.color};border-color:${f.color}"></span><span>${esc(f.name)} ${f.used.toLocaleString()}${f.total ? ` / ${f.total.toLocaleString()}枚　<b style="color:${f.remain < 0 ? '#ff7b72' : '#e8eef5'}">残り ${f.remain.toLocaleString()}</b>` : '枚'}</span></div>`).join('');
  $('#legend').innerHTML = stock + `<div class="lg"><span class="sw" style="background:rgba(255,23,68,.6)"></span>同じチラシの二重配布</div><div class="lg"><span class="sw" style="border-color:#fff;background:none"></span>町丁目（タップで配布率）</div><div class="small">表示中 ${n}件</div>`;
}
function renderNotice() {
  const b = $('#noticeBanner'); const nd = S.settings.noticeDate;
  const fab = $('#fab');
  if (!nd) { b.hidden = true; fab.disabled = false; return; }
  const diff = Math.ceil((new Date(nd) - new Date(today())) / 86400000);
  b.hidden = false;
  if (diff > 0) { b.className = ''; b.textContent = `告示日（${nd}）まであと ${diff} 日。告示後のポスティングは公職選挙法で禁止です`; fab.disabled = false; }
  else { b.className = 'lock'; b.textContent = `告示日（${nd}）を過ぎています。選挙運動期間中のポスティングは公職選挙法違反のため、新規登録を停止しています`; fab.disabled = true; }
}

/* ---------------- 範囲の描画（なぞる／点で囲む）＋つまみ調整 ---------------- */
function startDrawing() {
  if ($('#fab').disabled) return;
  S.infoWin.close(); closeSheet();
  const layer = $('#drawLayer'), cv = $('#drawCanvas');
  layer.hidden = false;
  const rect = layer.getBoundingClientRect();
  cv.width = Math.round(rect.width * devicePixelRatio); cv.height = Math.round(rect.height * devicePixelRatio);
  const ctx = cv.getContext('2d'); ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  S.drawing = { pts: [], ctx, rect, active: false, mode: S.drawMode || 'tap', down: null, dragIdx: null, dragMoved: false, dragInserted: false };
  setDrawMode(S.drawing.mode);
  $('#fab').hidden = true; setLegend(false); $('#legendBtn').hidden = true; $('#zoomBtns').hidden = true;
  const pos = e => [e.clientX - S.drawing.rect.left, e.clientY - S.drawing.rect.top];
  const near = (pts, x, y, r) => { let best = -1, bd = r; pts.forEach(([px, py], i) => { const d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = i; } }); return best; };
  layer.onpointerdown = e => {
    if (e.target !== cv) return;              // ボタン上の操作は無視
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); layer.setPointerCapture?.(e.pointerId);
    const d = S.drawing; const [x, y] = pos(e); d.down = [x, y];
    if (d.mode === 'free') { d.active = true; d.pts = []; addPt(e); return; }
    // 点で囲む：既存の点をつかむ／辺の中点をつかんで点を追加／空いている所なら後で点を追加
    const hitR = e.pointerType === 'touch' ? 26 : 16;
    const vi = near(d.pts, x, y, hitR);
    if (vi >= 0) { d.dragIdx = vi; d.dragMoved = false; d.dragInserted = false; return; }
    if (d.pts.length >= 2) {
      const mids = midpoints(d.pts);
      const mi = near(mids, x, y, hitR - 4);
      if (mi >= 0) { d.pts.splice(mi + 1, 0, [x, y]); d.dragIdx = mi + 1; d.dragMoved = false; d.dragInserted = true; drawPreview(d.pts.length >= 3); return; }
    }
  };
  layer.onpointermove = e => {
    const d = S.drawing; if (!d) return;
    if (d.mode === 'free') { if (d.active) { e.preventDefault(); addPt(e); } return; }
    if (d.dragIdx != null) { e.preventDefault(); const [x, y] = pos(e); d.pts[d.dragIdx] = [x, y]; d.dragMoved = true; drawPreview(d.pts.length >= 3); }
  };
  layer.onpointerup = layer.onpointercancel = e => {
    const d = S.drawing; if (!d) return;
    if (e.target !== cv && !d.active && !d.down && d.dragIdx == null) return;
    if (d.mode === 'free') { if (!d.active) return; d.active = false; d.down = null; finishStroke(); return; }
    const [x, y] = pos(e);
    if (d.dragIdx != null) {
      // 動かさずに離した既存の点＝削除
      if (!d.dragMoved && !d.dragInserted) d.pts.splice(d.dragIdx, 1);
      d.dragIdx = null; d.down = null; updateTapUI(); return;
    }
    if (d.down && Math.hypot(x - d.down[0], y - d.down[1]) < 8) d.pts.push([x, y]);
    d.down = null; updateTapUI();
  };
  function addPt(e) {
    const [x, y] = pos(e);
    const pts = S.drawing.pts;
    if (pts.length) { const [px, py] = pts[pts.length - 1]; if (Math.hypot(x - px, y - py) < 3) return; }
    pts.push([x, y]); drawPreview(false);
  }
}
function midpoints(pts) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) { if (n < 3 && i === n - 1) break; const a = pts[i], b = pts[(i + 1) % n]; out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }
  return out;
}
function updateTapUI() {
  const d = S.drawing; const n = d.pts.length;
  drawPreview(n >= 3);
  $('#btnDrawDone').disabled = n < 3;
  $('#btnDrawUndo').disabled = n === 0;
  $('#drawHint').textContent = n === 0 ? '範囲の角を順番にタップ（ぐるっと一周する順で）'
    : n < 3 ? `角を順番にタップ（あと${3 - n}点）。点はドラッグで移動`
    : '点＝ドラッグで移動・タップで削除／辺の小さな丸＝点を追加。よければ「これで決定」';
}
function setDrawMode(mode) {
  const d = S.drawing; S.drawMode = mode; if (!d) return;
  d.mode = mode; d.pts = []; d.active = false; d.dragIdx = null; d.down = null; drawPreview(false);
  $('#modeFree').classList.toggle('on', mode === 'free'); $('#modeTap').classList.toggle('on', mode === 'tap');
  $('#btnDrawUndo').hidden = mode !== 'tap'; $('#btnDrawDone').disabled = true;
  if (mode === 'tap') updateTapUI(); else $('#drawHint').textContent = '配った範囲を指でなぞって囲んでください';
}
function drawPreview(closed) {
  const { ctx, rect, pts, mode } = S.drawing;
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!pts.length) return;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (pts.length >= 2) {
    // 実線：たどった順の辺
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
    ctx.lineWidth = 4; ctx.strokeStyle = '#00e5ff'; ctx.stroke();
    if (closed) {
      // 塗り＋最後→最初は点線（閉じる辺）
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y); ctx.closePath();
      ctx.fillStyle = 'rgba(0,229,255,.22)'; ctx.fill();
      if (mode === 'tap') { ctx.beginPath(); ctx.moveTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); ctx.lineTo(pts[0][0], pts[0][1]); ctx.setLineDash([8, 8]); ctx.lineWidth = 3; ctx.strokeStyle = '#00e5ff'; ctx.stroke(); ctx.setLineDash([]); }
    }
  }
  if (mode !== 'tap') return;
  // 辺の中点（点を追加できる小さな丸）
  if (pts.length >= 2) for (const [x, y] of midpoints(pts)) { ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#0097a7'; ctx.stroke(); }
  // 頂点（番号つき）
  pts.forEach(([x, y], i) => {
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#00b8d4'; ctx.stroke();
    ctx.fillStyle = '#0b3a48'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), x, y + 0.5);
  });
}
function finishStroke() {
  const d = S.drawing;
  if (d.pts.length < 8) { d.pts = []; drawPreview(false); $('#drawHint').textContent = '短すぎます。もう少し大きく囲んでください'; return; }
  drawPreview(true);
  $('#btnDrawDone').disabled = false;
  $('#drawHint').textContent = 'よければ「これで決定」（次の画面で角を調整できます）';
}
function cancelDrawing() {
  $('#drawLayer').hidden = true; $('#fab').hidden = false; S.drawing = null;
  $('#legendBtn').hidden = S.boardsOn || S.spotBarOn; $('#zoomBtns').hidden = false;
}
function commitDrawing() {
  const d = S.drawing; if (!d) return;
  if ((d.mode === 'free' && d.pts.length < 8) || (d.mode === 'tap' && d.pts.length < 3)) { toast('先に範囲を描いてください'); return; }
  const projection = S.proj.getProjection();
  let coords = d.pts.map(([x, y]) => { const ll = projection.fromContainerPixelToLatLng(new google.maps.Point(x, y)); return [ll.lng(), ll.lat()]; });
  coords.push(coords[0]);
  let poly = turf.polygon([coords]);
  if (d.mode === 'free') { try { poly = turf.simplify(poly, { tolerance: 0.00004, highQuality: true }); } catch { } }
  try {
    if (turf.kinks(poly).features.length) {
      const parts = turf.unkinkPolygon(poly).features; parts.sort((a, b) => turf.area(b) - turf.area(a)); poly = parts[0];
    }
  } catch { }
  const ring = poly.geometry.coordinates[0].map(([lng, lat]) => [+lng.toFixed(6), +lat.toFixed(6)]);
  if (ring.length < 4) { toast('形がうまく取れませんでした。描き直してください'); return; }
  cancelDrawing();
  startAdjust(ring, null);
}
// つまみで形を調整（Googleマップ標準の編集ハンドル）
function startAdjust(ring, rec) {
  S.infoWin.close(); closeSheet();
  for (const p of S.polys.values()) p.setOptions({ clickable: false });
  const path = ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
  const poly = new google.maps.Polygon({ paths: path, editable: true, draggable: false, strokeColor: '#00e5ff', strokeWeight: 3, fillColor: '#00e5ff', fillOpacity: 0.25, map: S.map, zIndex: 10 });
  S.adjust = { poly, rec };
  $('#adjustBar').hidden = false; $('#fab').hidden = true; setLegend(false); $('#legendBtn').hidden = true;
  const b = turf.bbox(turf.polygon([ring]));
  S.map.fitBounds(new google.maps.LatLngBounds({ lat: b[1], lng: b[0] }, { lat: b[3], lng: b[2] }), 60);
}
function endAdjust(ok) {
  const a = S.adjust; if (!a) return;
  let ring = null;
  if (ok) {
    ring = a.poly.getPath().getArray().map(ll => [+ll.lng().toFixed(6), +ll.lat().toFixed(6)]);
    if (ring.length < 3) { toast('角が少なすぎます'); return; }
    ring.push(ring[0]);
    try { if (turf.kinks(turf.polygon([ring])).features.length) { toast('線が交差しています。交差しない形に直してください'); return; } } catch { }
  }
  a.poly.setMap(null); S.adjust = null;
  $('#adjustBar').hidden = true; $('#fab').hidden = false; $('#legendBtn').hidden = S.boardsOn || S.spotBarOn;
  for (const p of S.polys.values()) p.setOptions({ clickable: true });
  if (ok) openRecordForm(a.rec ? { ...a.rec, polygon: ring } : { polygon: ring });
}

/* ---------------- ボトムシート ---------------- */
function openSheet(html) { $('#sheetBody').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; }

function openRecordForm(rec) {
  const isNew = !rec.id;
  const poly = turf.polygon([rec.polygon]);
  const est = estimateRecord(poly);
  const area = Math.round(turf.area(poly));
  const flyers = S.settings.flyers;
  if (!flyers.length) { toast('先に設定でチラシを登録してください'); return; }
  openSheet(`
    <h3>${isNew ? '配布を記録' : '記録を編集'}</h3>
    <div class="small">範囲 約${area.toLocaleString()}㎡ ／ 推定 <b>${est.setai}</b> 世帯 ／ ${esc(est.town)}</div>
    <label>チラシ<select id="fFlyer">${flyers.map(f => `<option value="${f.id}" ${rec.flyer_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
    <label>配った部数（枚）<input id="fCount" type="number" inputmode="numeric" min="0" value="${rec.count ?? est.setai}"></label>
    <label>配った日<input id="fDate" type="date" value="${rec.date || today()}"></label>
    <label>配った人<select id="fMember">${S.settings.members.map(m => `<option ${((rec.member || S.user) === m) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
    <label>メモ（任意）<input id="fMemo" type="text" value="${esc(rec.memo || '')}" placeholder="例：東側のアパートは投函不可"></label>
    <div class="btnRow"><button class="ghost" id="fCancel">やめる</button><button class="primary" id="fSave">保存する</button></div>
  `);
  $('#fCancel').onclick = closeSheet;
  $('#fSave').onclick = async () => {
    const r = {
      id: rec.id || uid(), polygon: rec.polygon,
      flyer_id: $('#fFlyer').value, count: Number($('#fCount').value || 0), date: $('#fDate').value || today(),
      member: $('#fMember').value, memo: $('#fMemo').value.trim(),
      est_setai: est.setai, town: est.town, area_m2: area,
      created_at: rec.created_at || new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    $('#fSave').disabled = true;
    try { await store.saveRecord(r); } catch { $('#fSave').disabled = false; return; }
    S.records = await store.loadRecords();
    if (!S.filter.flyers.has(r.flyer_id)) S.filter.flyers.add(r.flyer_id);
    closeSheet(); renderAll(); toast('保存しました');
  };
}

function showRecord(r, latLng) {
  const f = flyerOf(r.flyer_id);
  openSheet(`
    <h3><span style="display:inline-block;width:12px;height:12px;background:${f.color};border-radius:3px;margin-right:6px"></span>${esc(f.name)}</h3>
    <dl class="kv">
      <dt>日付</dt><dd>${esc(r.date)}</dd>
      <dt>配った人</dt><dd>${esc(r.member)}</dd>
      <dt>部数</dt><dd>${r.count.toLocaleString()} 枚</dd>
      <dt>推定世帯</dt><dd>${(r.est_setai ?? 0).toLocaleString()} 世帯（${esc(r.town || '')}）</dd>
      <dt>面積</dt><dd>約 ${(r.area_m2 ?? 0).toLocaleString()} ㎡</dd>
      ${r.memo ? `<dt>メモ</dt><dd>${esc(r.memo)}</dd>` : ''}
    </dl>
    <div class="btnRow"><button class="ghost" id="rDel">削除</button><button class="ghost" id="rShape">形を直す</button><button class="ghost" id="rEdit">内容を編集</button><button class="primary" id="rClose">閉じる</button></div>
  `);
  $('#rClose').onclick = closeSheet;
  $('#rEdit').onclick = () => openRecordForm(r);
  $('#rShape').onclick = () => { if ($('#fab').disabled) { toast('告示日を過ぎているため変更できません'); return; } startAdjust(r.polygon, r); };
  $('#rDel').onclick = async () => {
    if (!confirm(`${r.date} ${r.member} ${f.name} ${r.count}枚 の記録を削除しますか？`)) return;
    try { await store.deleteRecord(r.id); } catch { return; }
    S.records = await store.loadRecords(); closeSheet(); renderAll(); toast('削除しました');
  };
}

function showList() {
  const recs = [...filteredRecords()].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  const total = recs.reduce((s, r) => s + r.count, 0);
  const byF = {}; for (const r of recs) byF[r.flyer_id] = (byF[r.flyer_id] || 0) + r.count;
  openSheet(`
    <h3>配布一覧（表示中の条件）</h3>
    <div class="small">${recs.length}件 ／ 合計 ${total.toLocaleString()}枚 ／ ${Object.entries(byF).map(([k, v]) => `${esc(flyerOf(k).name)} ${v.toLocaleString()}枚`).join('・')}</div>
    <div class="small" style="margin-top:4px">残り枚数（全期間）：${flyerTotals().map(f => `${esc(f.name)} ${f.total ? `${f.remain.toLocaleString()} / ${f.total.toLocaleString()}` : `配布 ${f.used.toLocaleString()}（用意枚数は未設定）`}`).join('・')}</div>
    <div class="tableWrap"><table><thead><tr><th>日付</th><th>配った人</th><th>チラシ</th><th>部数</th><th>主な町丁目</th></tr></thead><tbody>
    ${recs.map(r => `<tr data-id="${r.id}"><td>${fmtDate(r.date)}</td><td>${esc(r.member)}</td><td><span style="color:${flyerOf(r.flyer_id).color}">●</span> ${esc(flyerOf(r.flyer_id).name)}</td><td>${r.count}</td><td>${esc(r.town || '')}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="btnRow"><button class="ghost" id="lCsv">CSVを書き出す</button><button class="primary" id="lClose">閉じる</button></div>
  `);
  $('#lClose').onclick = closeSheet;
  $('#lCsv').onclick = () => exportCsv(recs);
  $('#sheetBody').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => {
    const r = S.records.find(x => x.id === tr.dataset.id); if (!r) return;
    const c = turf.centroid(recPolygon(r)).geometry.coordinates;
    S.map.panTo({ lat: c[1], lng: c[0] }); showRecord(r);
  });
}
function exportCsv(recs) {
  const head = ['日付', '配った人', 'チラシ', '部数', '推定世帯', '主な町丁目', '面積m2', 'メモ', '登録日時'];
  const rows = recs.map(r => [r.date, r.member, flyerOf(r.flyer_id).name, r.count, r.est_setai ?? '', r.town ?? '', r.area_m2 ?? '', r.memo ?? '', r.created_at]);
  const csv = '﻿' + [head, ...rows].map(a => a.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `チラシ配布_${today()}.csv`; a.click();
}

function showTownTable() {
  const recs = filteredRecords();
  const fl = S.settings.flyers.filter(f => S.filter.flyers.has(f.id));
  const rows = [];
  for (const t of S.towns) {
    if (t.kigo && t.kigo !== 'E1' && t.setai === 0) continue;
    const covs = fl.map(f => coverageOf(t, recs.filter(r => r.flyer_id === f.id)));
    if (covs.every(c => c === 0)) continue;
    rows.push({ t, covs });
  }
  rows.sort((a, b) => Math.max(...b.covs) - Math.max(...a.covs));
  openSheet(`
    <h3>町丁目ごとの配布率</h3>
    <div class="small">配布記録のある町丁目のみ。国勢調査（2020年）の世帯数に対する面積ベースの推定です</div>
    <div class="tableWrap"><table><thead><tr><th>町丁目</th><th>世帯</th>${fl.map(f => `<th><span style="color:${f.color}">●</span>${esc(f.name)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map(({ t, covs }) => `<tr><td>${esc(t.city)} ${esc(t.name)}</td><td>${t.setai}</td>${covs.map(c => `<td><div>${Math.round(c * 100)}%</div><div class="bar"><i style="width:${Math.round(c * 100)}%"></i></div></td>`).join('')}</tr>`).join('') || '<tr><td colspan="9" class="small">まだ記録がありません</td></tr>'}
    </tbody></table></div>
    <div class="btnRow"><button class="primary" id="tClose">閉じる</button></div>
  `);
  $('#tClose').onclick = closeSheet;
}

function showSettings() {
  const s = S.settings;
  openSheet(`
    <h3>設定</h3>
    <h4 style="margin:12px 0 4px">チラシの種類</h4>
    <div class="small">色／名前／用意した枚数（入れると残り枚数が出ます）</div>
    <div id="flyerRows">${s.flyers.map(f => flyerRow(f)).join('')}</div>
    <button class="ghost" id="addFlyer" style="padding:8px 12px;border-radius:8px;margin-top:6px">＋ チラシを追加</button>
    <h4 style="margin:18px 0 4px">メンバー（配る人）</h4>
    <label>1行に1人<textarea id="sMembers" rows="4">${esc(s.members.join('\n'))}</textarea></label>
    <h4 style="margin:18px 0 4px">告示日</h4>
    <label>この日以降は登録をロックします<input id="sNotice" type="date" value="${esc(s.noticeDate || '')}"></label>
    <div class="btnRow"><button class="ghost" id="sCancel">やめる</button><button class="primary" id="sSave">保存する</button></div>
    <p class="small" style="margin-top:14px">${USE_SUPABASE ? 'この設定と記録は全員で共有されます（15秒ごとに自動で同期）。合言葉の変更は管理者に依頼してください。' : '端末内保存版：この設定と記録はこの端末のブラウザにだけ保存されます。'}</p>
  `);
  $('#addFlyer').onclick = () => {
    const color = PALETTE[$('#flyerRows').children.length % PALETTE.length];
    $('#flyerRows').insertAdjacentHTML('beforeend', flyerRow({ id: uid(), name: '', color }));
    bindFlyerRows();
  };
  bindFlyerRows();
  $('#sCancel').onclick = closeSheet;
  $('#sSave').onclick = async () => {
    const flyers = [...$('#flyerRows').querySelectorAll('.rowItem')].map(r => ({ id: r.dataset.id, name: r.querySelector('input[type=text]').value.trim(), color: r.querySelector('input[type=color]').value, total: Number(r.querySelector('.totalInp').value) || 0 })).filter(f => f.name);
    if (!flyers.length) { toast('チラシを1つ以上登録してください'); return; }
    s.flyers = flyers;
    s.members = $('#sMembers').value.split('\n').map(x => x.trim()).filter(Boolean);
    s.noticeDate = $('#sNotice').value;
    await store.saveSettings(s);
    for (const f of flyers) S.filter.flyers.add(f.id);
    closeSheet(); renderAll(); toast('設定を保存しました');
  };
  function flyerRow(f) { return `<div class="rowItem" data-id="${f.id}"><input type="color" value="${f.color}"><input type="text" value="${esc(f.name)}" placeholder="例：政策ビラ第2号"><input type="number" class="totalInp" inputmode="numeric" min="0" placeholder="用意枚数" value="${f.total ?? ''}" title="用意した枚数（残り枚数の計算用）"><span class="orderBtns"><button class="icon upFlyer" title="上へ">▲</button><button class="icon downFlyer" title="下へ">▼</button></span><button class="icon delFlyer">🗑</button></div>`; }
  function bindFlyerRows() {
    const rows = $('#flyerRows');
    rows.querySelectorAll('.delFlyer').forEach(b => b.onclick = () => { if (confirm('このチラシを削除しますか？（記録は残ります）')) b.closest('.rowItem').remove(); });
    rows.querySelectorAll('.upFlyer').forEach(b => b.onclick = () => { const r = b.closest('.rowItem'); if (r.previousElementSibling) rows.insertBefore(r, r.previousElementSibling); });
    rows.querySelectorAll('.downFlyer').forEach(b => b.onclick = () => { const r = b.closest('.rowItem'); if (r.nextElementSibling) rows.insertBefore(r.nextElementSibling, r); });
  }
}


/* ---------------- ポスター掲示場（看板） ---------------- */
const BOARD_STYLE = { todo: { color: '#9aa7b4', label: '未' }, done: { color: '#3fb950', label: '済' }, check: { color: '#f2a93b', label: '？' } };
const BOARD_KIND = { official: { name: '選挙用ポスター掲示場', short: '掲示場', path: () => google.maps.SymbolPath.CIRCLE, scale: 13 }, general: { name: '一般ポスター（支援者宅・店舗など）', short: '一般', path: () => 'M -9,-9 L 9,-9 L 9,9 L -9,9 Z', scale: 1 } };
S.boardKindFilter = 'all';
function setLegend(open) { S.legendOpen = open; $('#legend').hidden = !open; $('#legendBtn').classList.toggle('on', open); }
function toggleBoards(on) {
  S.boardsOn = on ?? !S.boardsOn;
  if (S.boardsOn && S.spotBarOn) toggleSpotBar(false);
  $('#boardBar').hidden = !S.boardsOn;
  $('#legendBtn').hidden = S.boardsOn || S.spotBarOn; if (S.boardsOn) setLegend(false);
  if (!S.boardsOn) { setBoardAdding(false); S.infoWin.close(); }
  renderBoards();
}
function setBoardAdding(on) {
  S.boardAdding = on; if (on) S.spotAdding = false;
  $('#boardAddHint').hidden = !on;
  setAddingUI(on);
}
function renderBoards() {
  for (const m of S.boardMarkers.values()) m.setMap(null);
  S.boardMarkers.clear();
  const off = S.boards.filter(b => (b.kind || 'official') === 'official'), gen = S.boards.filter(b => b.kind === 'general');
  const cnt = a => `${a.filter(b => b.status === 'done').length}/${a.length}`;
  $('#boardStat').textContent = `掲示場 ${cnt(off)}　一般ポスター ${cnt(gen)}`;
  if (!S.boardsOn) return;
  for (const b of S.boards) {
    const kind = b.kind || 'official';
    if (S.boardKindFilter !== 'all' && kind !== S.boardKindFilter) continue;
    const st = BOARD_STYLE[b.status] || BOARD_STYLE.todo; const k = BOARD_KIND[kind];
    const m = new google.maps.Marker({
      position: { lat: b.lat, lng: b.lng }, map: S.map, zIndex: 20,
      icon: { path: k.path(), scale: k.scale, fillColor: st.color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2.5, anchor: kind === 'general' ? new google.maps.Point(0, 0) : undefined },
      label: { text: b.no ? String(b.no) : st.label, color: '#0b1a24', fontSize: '12px', fontWeight: '700' },
      title: `${b.no ? b.no + ' ' : ''}${b.place || ''}`,
    });
    m.addListener('click', () => { if (!S.boardAdding) showBoard(b); });
    S.boardMarkers.set(b.id, m);
  }
}
async function addBoardAt(latLng) {
  setBoardAdding(false);
  const kind = S.boardKindFilter === 'general' ? 'general' : 'official';
  const sameKind = S.boards.filter(x => (x.kind || 'official') === kind);
  const b = { id: uid(), kind, no: String(sameKind.length + 1), place: '', lat: +latLng.lat().toFixed(6), lng: +latLng.lng().toFixed(6), status: 'todo', memo: '' };
  openSheet(`
    <h3>ポスターの場所を追加</h3>
    <label>種類<select id="bKind"><option value="official" ${kind === 'official' ? 'selected' : ''}>選挙用ポスター掲示場（告示後に貼る公営の看板）</option><option value="general" ${kind === 'general' ? 'selected' : ''}>一般ポスター（支援者宅・店舗などに貼る）</option></select></label>
    <label>番号（掲示場一覧の番号・任意）<input id="bNo" type="text" inputmode="numeric" value="${esc(b.no)}"></label>
    <label>場所（目印）<input id="bPlace" type="text" placeholder="例：蟹江小学校 正門横／○○商店の壁"></label>
    <div class="btnRow"><button class="ghost" id="bCancel">やめる</button><button class="primary" id="bSave">追加する</button></div>
  `);
  $('#bCancel').onclick = closeSheet;
  $('#bSave').onclick = async () => {
    b.no = $('#bNo').value.trim(); b.place = $('#bPlace').value.trim(); b.kind = $('#bKind').value;
    try { await store.saveBoard(b); } catch { return; }
    S.boards = await store.loadBoards(); closeSheet(); renderBoards(); toast('掲示場を追加しました');
  };
}
async function showBoard(b) {
  const st = BOARD_STYLE[b.status] || BOARD_STYLE.todo;
  openSheet(`
    <h3>📌 ${BOARD_KIND[b.kind || 'official'].short} ${esc(b.no)} ${esc(b.place)}</h3>
    <div class="small">${BOARD_KIND[b.kind || 'official'].name}</div>
    <div class="stTabs">
      <button data-st="todo" class="${b.status === 'todo' ? 'on' : ''}" style="color:${BOARD_STYLE.todo.color}">未貼付</button>
      <button data-st="done" class="${b.status === 'done' ? 'on' : ''}" style="color:${BOARD_STYLE.done.color}">貼りました</button>
      <button data-st="check" class="${b.status === 'check' ? 'on' : ''}" style="color:${BOARD_STYLE.check.color}">要確認</button>
    </div>
    <label>貼った人<select id="bBy">${S.settings.members.map(m => `<option ${((b.posted_by || S.user) === m) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
    <label>日付<input id="bDate" type="date" value="${esc(b.posted_at || today())}"></label>
    <label>写真（任意・自動で縮小します）<input id="bPhoto" type="file" accept="image/*" capture="environment"></label>
    <div class="photoBox" id="bPhotoBox">${b.photo_path ? '<div class="small">写真を読み込み中…</div>' : ''}</div>
    <label>メモ（例：破損あり、貼る位置が高い）<input id="bMemo" type="text" value="${esc(b.memo || '')}"></label>
    ${extLinks(b.lat, b.lng)}
    <details style="margin-top:10px"><summary class="small">種類・番号・場所を直す／削除</summary>
      <label>種類<select id="bKind"><option value="official" ${(b.kind || 'official') === 'official' ? 'selected' : ''}>選挙用ポスター掲示場</option><option value="general" ${b.kind === 'general' ? 'selected' : ''}>一般ポスター</option></select></label>
      <label>番号<input id="bNo" type="text" value="${esc(b.no)}"></label>
      <label>場所<input id="bPlace" type="text" value="${esc(b.place)}"></label>
      <button class="ghost" id="bDel" style="margin-top:8px;padding:8px 12px;border-radius:8px;color:var(--danger)">この掲示場を削除</button>
    </details>
    <div class="btnRow"><button class="ghost" id="bCancel">閉じる</button><button class="primary" id="bSave">保存する</button></div>
  `);
  let status = b.status;
  $('#sheetBody').querySelectorAll('.stTabs button').forEach(btn => btn.onclick = () => { status = btn.dataset.st; $('#sheetBody').querySelectorAll('.stTabs button').forEach(x => x.classList.toggle('on', x === btn)); });
  if (b.photo_path) { const url = await store.photoUrl(b.photo_path); $('#bPhotoBox').innerHTML = url ? `<img src="${url}" alt="貼付写真">` : '<div class="small">写真を表示できません</div>'; }
  let newBlob = null;
  $('#bPhoto').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    newBlob = await shrinkImage(f, 1280, 0.8);
    $('#bPhotoBox').innerHTML = `<img src="${URL.createObjectURL(newBlob)}" alt="プレビュー"><div class="small">約${Math.round(newBlob.size / 1024)}KB（保存で確定）</div>`;
    if (status === 'todo') { status = 'done'; $('#sheetBody').querySelectorAll('.stTabs button').forEach(x => x.classList.toggle('on', x.dataset.st === 'done')); }
  };
  $('#bCancel').onclick = closeSheet;
  $('#bDel').onclick = async () => { if (!confirm(`掲示場 ${b.no} を削除しますか？`)) return; try { await store.deleteBoard(b.id); } catch { return; } S.boards = await store.loadBoards(); closeSheet(); renderBoards(); toast('削除しました'); };
  $('#bSave').onclick = async () => {
    $('#bSave').disabled = true;
    const nb = { ...b, status, posted_by: $('#bBy').value, posted_at: $('#bDate').value || today(), memo: $('#bMemo').value.trim(), no: $('#bNo').value.trim(), place: $('#bPlace').value.trim(), kind: $('#bKind').value };
    if (status === 'todo') { nb.posted_by = null; nb.posted_at = null; }
    if (newBlob) { const path = await store.uploadPhoto(newBlob, b.id); if (path) nb.photo_path = path; }
    try { await store.saveBoard(nb); } catch { $('#bSave').disabled = false; return; }
    S.boards = await store.loadBoards(); closeSheet(); renderBoards(); toast('保存しました');
  };
}
function shrinkImage(file, maxSide, quality) {
  return new Promise(resolve => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const r = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => { URL.revokeObjectURL(url); resolve(b || file); }, 'image/jpeg', quality);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}
function showBoardList() {
  const rows = [...S.boards].sort((a, b) => ((a.kind || 'official') === 'official' ? 0 : 1) - ((b.kind || 'official') === 'official' ? 0 : 1) || (parseInt(a.no) || 9999) - (parseInt(b.no) || 9999) || String(a.no).localeCompare(String(b.no)));
  const sum = k => { const a = rows.filter(b => (b.kind || 'official') === k); return `${BOARD_KIND[k].short} ${a.filter(b => b.status === 'done').length}/${a.length}（要確認 ${a.filter(b => b.status === 'check').length}）`; };
  openSheet(`
    <h3>ポスター一覧</h3>
    <div class="small">${sum('official')} ／ ${sum('general')}</div>
    <div class="tableWrap"><table><thead><tr><th>種類</th><th>番号</th><th>場所</th><th>状態</th><th>貼った人</th><th>日付</th><th>写真</th></tr></thead><tbody>
    ${rows.map(b => `<tr data-id="${b.id}"><td>${BOARD_KIND[b.kind || 'official'].short}</td><td>${esc(b.no)}</td><td>${esc(b.place)}</td><td style="color:${BOARD_STYLE[b.status]?.color}">${{ todo: '未貼付', done: '貼付済', check: '要確認' }[b.status] || ''}</td><td>${esc(b.posted_by || '')}</td><td>${b.posted_at ? fmtDate(b.posted_at) : ''}</td><td>${b.photo_path ? '📷' : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="small">まだ登録がありません。「＋ 場所を追加」で地図に置いてください</td></tr>'}
    </tbody></table></div>
    <div class="btnRow"><button class="ghost" id="blCsv">CSV</button><button class="primary" id="blClose">閉じる</button></div>
  `);
  $('#blClose').onclick = closeSheet;
  $('#blCsv').onclick = () => {
    const head = ['種類', '番号', '場所', '状態', '貼った人', '日付', '緯度', '経度', 'メモ'];
    const data = rows.map(b => [BOARD_KIND[b.kind || 'official'].short, b.no, b.place, { todo: '未貼付', done: '貼付済', check: '要確認' }[b.status] || '', b.posted_by || '', b.posted_at || '', b.lat, b.lng, b.memo || '']);
    const csv = '﻿' + [head, ...data].map(a => a.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `ポスター_${today()}.csv`; a.click();
  };
  $('#sheetBody').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { const b = S.boards.find(x => x.id === tr.dataset.id); if (!b) return; S.map.panTo({ lat: b.lat, lng: b.lng }); showBoard(b); });
}

/* ---------------- 拠点・辻立ちスポット ---------------- */
const SPOT_KIND = {
  office_party: { name: '党・県の事務所', emoji: '🏛', color: '#8b5cf6' },
  office_own:   { name: '自分の事務所',   emoji: '🏠', color: '#2f81f7' },
  station:      { name: '辻立ちの場所（駅・交差点）', emoji: '🎤', color: '#ef4444' },
  other:        { name: 'その他の拠点',   emoji: '📍', color: '#64748b' },
};
const spotEvents = id => S.events.filter(e => e.spot_id === id);
const upcoming = evs => evs.filter(e => !e.done && e.date >= today()).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
const history = evs => evs.filter(e => e.done || e.date < today()).sort((a, b) => b.date.localeCompare(a.date));
function toggleSpotBar(on) {
  S.spotBarOn = on ?? !S.spotBarOn;
  if (S.spotBarOn && S.boardsOn) toggleBoards(false);
  $('#spotBar').hidden = !S.spotBarOn;
  $('#legendBtn').hidden = S.boardsOn || S.spotBarOn; if (S.spotBarOn) setLegend(false);
  if (!S.spotBarOn) setSpotAdding(false);
  renderSpots();
}
function setSpotAdding(on) {
  S.spotAdding = on; if (on) S.boardAdding = false;
  $('#spotAddHint').hidden = !on;
  setAddingUI(on);
}
function renderSpots() {
  for (const m of S.spotMarkers.values()) m.setMap(null);
  S.spotMarkers.clear();
  const up = upcoming(S.events).length;
  $('#spotStat').textContent = `拠点 ${S.spots.length}か所　今後の予定 ${up}件`;
  if (!S.spotsOn) return;
  for (const sp of S.spots) {
    const k = SPOT_KIND[sp.kind] || SPOT_KIND.other;
    const next = upcoming(spotEvents(sp.id))[0];
    const m = new google.maps.Marker({
      position: { lat: sp.lat, lng: sp.lng }, map: S.map, zIndex: 30,
      icon: { path: 'M 0,0 C -2,-6 -12,-8 -12,-17 A 12,12 0 1,1 12,-17 C 12,-8 2,-6 0,0 Z', fillColor: k.color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1.25, labelOrigin: new google.maps.Point(0, -17) },
      label: { text: k.emoji, fontSize: '15px' },
      title: `${sp.name}${next ? `　次回 ${fmtDate(next.date)} ${next.time}` : ''}`,
    });
    m.addListener('click', () => { if (!S.spotAdding && !S.boardAdding) showSpot(sp); });
    S.spotMarkers.set(sp.id, m);
  }
}
function addSpotAt(latLng) {
  setSpotAdding(false);
  const sp = { id: uid(), kind: 'station', name: '', lat: +latLng.lat().toFixed(6), lng: +latLng.lng().toFixed(6), memo: '' };
  openSheet(`
    <h3>拠点・辻立ちスポットを追加</h3>
    <label>種類<select id="spKind">${Object.entries(SPOT_KIND).map(([k, v]) => `<option value="${k}" ${k === 'station' ? 'selected' : ''}>${v.emoji} ${v.name}</option>`).join('')}</select></label>
    <label>名前<input id="spName" type="text" placeholder="例：近鉄蟹江駅 南口／○○事務所"></label>
    <label>メモ（任意）<input id="spMemo" type="text" placeholder="例：朝7時〜8時が人通り多い"></label>
    <div class="btnRow"><button class="ghost" id="spCancel">やめる</button><button class="primary" id="spSave">追加する</button></div>
  `);
  $('#spCancel').onclick = closeSheet;
  $('#spSave').onclick = async () => {
    sp.kind = $('#spKind').value; sp.name = $('#spName').value.trim() || SPOT_KIND[sp.kind].name; sp.memo = $('#spMemo').value.trim();
    try { await store.saveSpot(sp); } catch { return; }
    S.spots = await store.loadSpots(); closeSheet(); renderSpots(); toast('追加しました');
  };
}
function showSpot(sp) {
  const k = SPOT_KIND[sp.kind] || SPOT_KIND.other;
  const evs = spotEvents(sp.id), up = upcoming(evs), hist = history(evs);
  const evRow = e => `<div class="evRow" data-id="${e.id}"><span class="d">${fmtDate(e.date)} ${esc(e.time)}</span><span class="m">${esc(e.member || '')} ${esc(e.memo || '')}</span>${e.done ? '<span class="small">済</span>' : `<button class="ghost evDone">実施した</button>`}<button class="ghost evDel">削除</button></div>`;
  openSheet(`
    <h3>${k.emoji} ${esc(sp.name)}</h3>
    <div class="small">${k.name}${sp.memo ? ' ／ ' + esc(sp.memo) : ''}</div>
    <h4 style="margin:14px 0 4px">次の予定</h4>
    ${up.length ? up.map(evRow).join('') : '<div class="small">予定はありません</div>'}
    <h4 style="margin:14px 0 4px">これまでの実施（${hist.length}回）</h4>
    ${hist.slice(0, 10).map(evRow).join('') || '<div class="small">まだ記録がありません</div>'}
    ${hist.length > 10 ? `<div class="small">…ほか${hist.length - 10}回</div>` : ''}
    <div class="btnRow"><button class="ghost" id="spPlan">＋ 予定を追加</button><button class="primary" id="spDidNow">今日ここで実施した</button></div>
    ${extLinks(sp.lat, sp.lng)}
    <details style="margin-top:10px"><summary class="small">名前・種類を直す／削除</summary>
      <label>種類<select id="spKind">${Object.entries(SPOT_KIND).map(([kk, v]) => `<option value="${kk}" ${kk === sp.kind ? 'selected' : ''}>${v.emoji} ${v.name}</option>`).join('')}</select></label>
      <label>名前<input id="spName" type="text" value="${esc(sp.name)}"></label>
      <label>メモ<input id="spMemo" type="text" value="${esc(sp.memo || '')}"></label>
      <div class="btnRow"><button class="ghost" id="spDel" style="color:var(--danger)">この場所を削除</button><button class="ghost" id="spEditSave">名前・種類を保存</button></div>
    </details>
    <div class="btnRow"><button class="primary" id="spClose">閉じる</button></div>
  `);
  $('#spClose').onclick = closeSheet;
  $('#spPlan').onclick = () => openEventForm(sp, { done: false });
  $('#spDidNow').onclick = () => openEventForm(sp, { done: true, date: today() });
  $('#spEditSave').onclick = async () => {
    const nsp = { ...sp, kind: $('#spKind').value, name: $('#spName').value.trim() || sp.name, memo: $('#spMemo').value.trim() };
    try { await store.saveSpot(nsp); } catch { return; }
    S.spots = await store.loadSpots(); renderSpots(); showSpot(S.spots.find(x => x.id === sp.id) || nsp); toast('保存しました');
  };
  $('#spDel').onclick = async () => { if (!confirm(`「${sp.name}」を削除しますか？（予定・実績も見えなくなります）`)) return; try { await store.deleteSpot(sp.id); } catch { return; } S.spots = await store.loadSpots(); closeSheet(); renderSpots(); toast('削除しました'); };
  $('#sheetBody').querySelectorAll('.evDone').forEach(b => b.onclick = async () => { const e = S.events.find(x => x.id === b.closest('.evRow').dataset.id); if (!e) return; try { await store.saveEvent({ ...e, done: true, member: e.member || S.user }); } catch { return; } S.events = await store.loadEvents(); renderSpots(); showSpot(sp); toast('実施済みにしました'); });
  $('#sheetBody').querySelectorAll('.evDel').forEach(b => b.onclick = async () => { const id = b.closest('.evRow').dataset.id; if (!confirm('この予定／記録を削除しますか？')) return; try { await store.deleteEvent(id); } catch { return; } S.events = await store.loadEvents(); renderSpots(); showSpot(sp); });
}
function openEventForm(sp, ev) {
  const isDone = !!ev.done;
  openSheet(`
    <h3>${isDone ? '実施を記録' : '予定を追加'}：${esc(sp.name)}</h3>
    <label>日付<input id="evDate" type="date" value="${esc(ev.date || today())}"></label>
    <label>時間（任意）<input id="evTime" type="text" placeholder="例：7:00〜8:00" value="${esc(ev.time || '')}"></label>
    <label>${isDone ? '実施した人' : '担当（任意）'}<select id="evMember"><option value="">（未定）</option>${S.settings.members.map(m => `<option ${((ev.member || (isDone ? S.user : '')) === m) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
    <label>メモ（任意）<input id="evMemo" type="text" value="${esc(ev.memo || '')}" placeholder="例：新ビラ配布と併せて／反応よかった"></label>
    <div class="btnRow"><button class="ghost" id="evCancel">やめる</button><button class="primary" id="evSave">保存する</button></div>
  `);
  $('#evCancel').onclick = () => showSpot(sp);
  $('#evSave').onclick = async () => {
    const e = { id: ev.id || uid(), spot_id: sp.id, date: $('#evDate').value || today(), time: $('#evTime').value.trim(), member: $('#evMember').value, memo: $('#evMemo').value.trim(), done: isDone };
    try { await store.saveEvent(e); } catch { return; }
    S.events = await store.loadEvents(); renderSpots(); showSpot(sp); toast('保存しました');
  };
}
function showSpotList() {
  const name = id => S.spots.find(s => s.id === id)?.name || '(削除済み)';
  const up = upcoming(S.events), hist = history(S.events);
  const row = e => `<tr data-spot="${e.spot_id}"><td>${fmtDate(e.date)}</td><td>${esc(e.time)}</td><td>${esc(name(e.spot_id))}</td><td>${esc(e.member || '')}</td><td>${esc(e.memo || '')}</td></tr>`;
  openSheet(`
    <h3>辻立ち・活動の予定と実績</h3>
    <h4 style="margin:10px 0 4px">今後の予定（${up.length}件）</h4>
    <div class="tableWrap"><table><thead><tr><th>日付</th><th>時間</th><th>場所</th><th>担当</th><th>メモ</th></tr></thead><tbody>${up.map(row).join('') || '<tr><td colspan="5" class="small">予定はありません。地図のピンをタップ →「＋ 予定を追加」</td></tr>'}</tbody></table></div>
    <h4 style="margin:14px 0 4px">実施済み（${hist.length}件）</h4>
    <div class="tableWrap"><table><thead><tr><th>日付</th><th>時間</th><th>場所</th><th>実施</th><th>メモ</th></tr></thead><tbody>${hist.map(row).join('') || '<tr><td colspan="5" class="small">まだありません</td></tr>'}</tbody></table></div>
    <div class="btnRow"><button class="primary" id="slClose">閉じる</button></div>
  `);
  $('#slClose').onclick = closeSheet;
  $('#sheetBody').querySelectorAll('tr[data-spot]').forEach(tr => tr.onclick = () => { const sp = S.spots.find(x => x.id === tr.dataset.spot); if (!sp) return; S.map.panTo({ lat: sp.lat, lng: sp.lng }); showSpot(sp); });
}

/* ---------------- Googleマップ連携（ストリートビュー・経路） ---------------- */
const svUrl = (lat, lng) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
const gmUrl = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
const extLinks = (lat, lng) => `<div class="btnRow"><a class="ghost linkBtn" target="_blank" rel="noopener" href="${svUrl(lat, lng)}">🧍 ストリートビュー</a><a class="ghost linkBtn" target="_blank" rel="noopener" href="${gmUrl(lat, lng)}">🗺 Googleマップで開く</a></div>`;

/* ---------------- 場所の検索（町名＝ローカル／施設・住所＝国土地理院＋Google） ---------------- */
function openSearch() { $('#searchBox').hidden = false; $('#searchResults').innerHTML = ''; setTimeout(() => $('#searchInp').focus(), 50); }
function closeSearch() { $('#searchBox').hidden = true; $('#searchInp').blur(); }
async function runSearch() {
  const q = $('#searchInp').value.trim(); if (!q) return;
  const box = $('#searchResults'); box.innerHTML = '<div class="small" style="padding:8px">検索中…</div>';
  const items = [];
  // 1) 町丁目（ローカル）
  const qn = q.replace(/\s+/g, '');
  for (const t of S.towns) {
    if (t.kigo && t.kigo !== 'E1') continue;
    if ((t.city + t.name).includes(qn) || t.name.includes(qn)) items.push({ ico: '🏘', name: `${t.city} ${t.name}`, sub: `町丁目 ／ ${t.setai.toLocaleString()}世帯`, lat: t.feature.properties.Y_CODE, lng: t.feature.properties.X_CODE, zoom: 16 });
    if (items.length >= 8) break;
  }
  // 2) Google Places（店名・施設名。Places API (New) が有効な場合だけ）
  if (!S._placesDenied) {
    try {
      const { Place } = await google.maps.importLibrary('places');
      const { places } = await Place.searchByText({ textQuery: q, fields: ['displayName', 'location', 'formattedAddress', 'primaryTypeDisplayName'], language: 'ja', region: 'jp', maxResultCount: 6,
        locationBias: new google.maps.LatLngBounds({ lat: 35.05, lng: 136.65 }, { lat: 35.25, lng: 136.95 }) });
      for (const pl of places || []) {
        if (!pl.location) continue;
        const addr = (pl.formattedAddress || '').replace(/^日本、?/, '').replace(/^〒\d{3}-\d{4}\s*/, '');
        items.push({ ico: '🏪', name: pl.displayName || addr, sub: `${pl.primaryTypeDisplayName || '店舗・施設'}（Google）／ ${addr}`, lat: pl.location.lat(), lng: pl.location.lng(), zoom: 18 });
      }
    } catch (e) { console.warn('Places search unavailable', e); S._placesDenied = true; S._placesError = String(e?.message || e); }
  }
  // 3) 国土地理院の住所・施設検索（無料・キー不要）。愛知県周辺を優先
  const inAichi = (lat, lng) => lat > 34.5 && lat < 35.5 && lng > 136.5 && lng < 138.0;
  try {
    const d = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q)).then(r => r.json());
    const near = [], far = [];
    for (const f of d || []) {
      const [lng, lat] = f.geometry.coordinates; const title = f.properties.title || '';
      if (items.some(it => it.name.replace(/\s/g, '') === title.replace(/[県市町村]/g, m => m).replace(/^愛知県/, '').replace(/\s/g, ''))) continue;
      (inAichi(lat, lng) ? near : far).push({ ico: '📍', name: title, sub: /小学校|中学校|高校|公民館|駅|病院|役場|市役所|センター|公園|神社|寺/.test(title) ? '施設' : '住所・地名', lat, lng, zoom: 17 });
    }
    items.push(...near.slice(0, 6), ...far.slice(0, 2));
  } catch (e) { console.warn('GSI search failed', e); }
  // 4) Google の住所検索（Geocoding API が有効な場合だけ）
  if (!S._geocoderDenied) {
    try {
      const { Geocoder } = await google.maps.importLibrary('geocoding');
      const gc = new Geocoder();
      const bounds = new google.maps.LatLngBounds({ lat: 34.6, lng: 136.6 }, { lat: 35.4, lng: 137.9 });
      const res = await gc.geocode({ address: q, region: 'JP', language: 'ja', bounds, componentRestrictions: { country: 'JP' } });
      for (const r of (res.results || []).slice(0, 5)) {
        const loc = r.geometry.location;
        const name = r.formatted_address.replace(/^日本、?/, '').replace(/^〒\d{3}-\d{4}\s*/, '');
        if (items.some(it => Math.abs(it.lat - loc.lat()) < 0.0005 && Math.abs(it.lng - loc.lng()) < 0.0005)) continue;
        items.push({ ico: '🗺', name, sub: (r.types || []).includes('establishment') ? '施設（Google）' : '住所（Google）', lat: loc.lat(), lng: loc.lng(), zoom: r.geometry.location_type === 'ROOFTOP' ? 18 : 16 });
      }
    } catch (e) { if (e && e.code === 'REQUEST_DENIED') S._geocoderDenied = true; else console.warn(e); }
  }
  if (!items.length) { box.innerHTML = `<div class="small" style="padding:8px">見つかりませんでした。町名だけ、施設名だけ、など言い方を変えてみてください${S._placesDenied ? '<br>※お店の名前で探すには Google Cloud で「Places API (New)」を有効にしてください' : ''}</div>`; return; }
  box.innerHTML = items.map((it, i) => `<div class="sr" data-i="${i}"><span class="ico">${it.ico}</span><span class="nm"><b>${esc(it.name)}</b><span>${esc(it.sub)}</span></span></div>`).join('');
  box.querySelectorAll('.sr').forEach(el => el.onclick = () => goTo(items[+el.dataset.i]));
}
function goTo(it) {
  closeSearch();
  S.map.panTo({ lat: it.lat, lng: it.lng }); S.map.setZoom(it.zoom || 16);
  if (S.searchMarker) S.searchMarker.setMap(null);
  S.searchMarker = new google.maps.Marker({ position: { lat: it.lat, lng: it.lng }, map: S.map, zIndex: 50, animation: google.maps.Animation.DROP, title: it.name,
    icon: { path: 'M 0,0 C -2,-6 -12,-8 -12,-17 A 12,12 0 1,1 12,-17 C 12,-8 2,-6 0,0 Z', fillColor: '#ffd60a', fillOpacity: 1, strokeColor: '#333', strokeWeight: 2, scale: 1.3, labelOrigin: new google.maps.Point(0, -17) }, label: { text: '★', fontSize: '14px' } });
  S.searchMarker.addListener('click', () => showSearchSheet(it));
  showSearchSheet(it);
  // 地図の中心に来るまで待ってから位置合わせ（シートで隠れないよう少し上に）
  setTimeout(() => S.map.panBy(0, Math.round($('#map').clientHeight * 0.18)), 300);
}
function showSearchSheet(it) {
  openSheet(`
    <h3>★ ${esc(it.name)}</h3>
    <div class="small">${esc(it.sub || '')}</div>
    ${extLinks(it.lat, it.lng)}
    <div class="btnRow"><button class="ghost" id="ssSpot">🎤 ここを拠点に追加</button><button class="ghost" id="ssBoard">📌 ここにポスター場所を追加</button></div>
    <div class="btnRow"><button class="primary" id="ssClose">閉じる（★も消える）</button></div>
  `);
  const clearStar = () => { if (S.searchMarker) { S.searchMarker.setMap(null); S.searchMarker = null; } closeSheet(); };
  $('#ssClose').onclick = clearStar;
  $('#ssSpot').onclick = () => { toggleSpotBar(true); addSpotAt(new google.maps.LatLng(it.lat, it.lng)); setTimeout(() => { const n = $('#spName'); if (n && !n.value) n.value = it.name; }, 50); };
  $('#ssBoard').onclick = () => { toggleBoards(true); addBoardAt(new google.maps.LatLng(it.lat, it.lng)); setTimeout(() => { const n = $('#bPlace'); if (n && !n.value) n.value = it.name; }, 50); };
}

/* ---------------- UI バインド ---------------- */
function bindUI() {
  $('#periodSel').value = S.filter.period;
  $('#periodSel').onchange = e => { S.filter.period = e.target.value; renderAll(); };
  $('#fab').onclick = startDrawing;
  $('#btnDrawCancel').onclick = cancelDrawing;
  $('#btnDrawRedo').onclick = () => setDrawMode(S.drawing.mode);
  $('#btnDrawUndo').onclick = () => { const d = S.drawing; d.pts.pop(); updateTapUI(); };
  $('#btnDrawDone').onclick = commitDrawing;
  $('#modeFree').onclick = () => setDrawMode('free');
  $('#modeTap').onclick = () => setDrawMode('tap');
  $('#btnAdjustCancel').onclick = () => endAdjust(false);
  $('#btnAdjustOk').onclick = () => endAdjust(true);
  $('#btnMenu').onclick = () => { $('#menu').hidden = false; $('#menuUser').textContent = `👤 ${S.user || ''}`; };
  $('#btnMenuClose').onclick = () => $('#menu').hidden = true;
  document.querySelectorAll('.menuItem[data-view]').forEach(b => b.onclick = () => {
    $('#menu').hidden = true;
    ({ list: showList, towns: showTownTable, settings: showSettings })[b.dataset.view]();
  });
  $('#btnBoards').onclick = () => { $('#menu').hidden = true; toggleBoards(true); };
  $('#btnBoardClose').onclick = () => toggleBoards(false);
  $('#btnBoardAdd').onclick = () => { closeSheet(); setBoardAdding(true); };
  $('#btnBoardAddCancel').onclick = () => setBoardAdding(false);
  $('#btnBoardList').onclick = showBoardList;
  $('#boardKindSel').onchange = e => { S.boardKindFilter = e.target.value; renderBoards(); };
  $('#btnSpots').onclick = () => { $('#menu').hidden = true; toggleSpotBar(true); };
  $('#btnSpotClose').onclick = () => toggleSpotBar(false);
  $('#btnSpotAdd').onclick = () => { closeSheet(); setSpotAdding(true); };
  $('#btnSpotAddCancel').onclick = () => setSpotAdding(false);
  $('#btnSpotList').onclick = showSpotList;
  $('#btnSwitchUser').onclick = () => { $('#menu').hidden = true; localStorage.removeItem('cm_user'); showLogin(); };
  $('#sheetHandle').onclick = closeSheet;
  $('#legendBtn').onclick = () => setLegend(!S.legendOpen);
  $('#btnSearch').onclick = () => { if ($('#searchBox').hidden) openSearch(); else closeSearch(); };
  $('#searchClose').onclick = closeSearch;
  $('#searchGo').onclick = runSearch;
  $('#searchInp').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } });
  // 凡例を左へスワイプで閉じる
  let lsx = null; $('#legend').addEventListener('touchstart', e => { lsx = e.touches[0].clientX; }, { passive: true });
  $('#legend').addEventListener('touchend', e => { if (lsx != null && lsx - e.changedTouches[0].clientX > 50) setLegend(false); lsx = null; });
  // 地図タップでメニュー・シートを閉じる
  $('#map').addEventListener('pointerdown', () => { $('#menu').hidden = true; }, { capture: true });
}
