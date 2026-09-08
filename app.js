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
  async addMember(name) { const s = await this.loadSettings(); if (!s.members.includes(name)) { s.members.push(name); await this.saveSettings(s); } },
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
  async loadAssignments() { return this._l('cm_assign_v1'); },
  async saveAssignment(x) { const a = this._l('cm_assign_v1'); const i = a.findIndex(y => y.id === x.id); if (i >= 0) a[i] = x; else a.push(x); this._s('cm_assign_v1', a); },
  async deleteAssignment(id) { this._s('cm_assign_v1', this._l('cm_assign_v1').filter(y => y.id !== id)); },
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
  rowToRec(r) { return { id: r.id, group_id: r.group_id || null, member: r.member, date: r.date, flyer_id: r.flyer_id, count: r.count, memo: r.memo || '', polygon: r.polygon, est_setai: r.est_setai, town: r.town, area_m2: r.area_m2, created_at: r.created_at, updated_at: r.updated_at }; },
  async loadRecords() {
    const { data, error } = await this.client.from('records').select('*').eq('deleted', false).order('date', { ascending: false });
    if (error) { console.error(error); if (!this._silent) toast('読み込みに失敗しました（通信）'); return S.records || []; }
    return data.map(r => this.rowToRec(r));
  },
  async saveRecord(r) {
    const row = { id: r.id, group_id: r.group_id || null, member: r.member, date: r.date, flyer_id: r.flyer_id, count: r.count, memo: r.memo || '', polygon: r.polygon, est_setai: r.est_setai, town: r.town, area_m2: r.area_m2, updated_at: new Date().toISOString() };
    const { error } = await this.client.from('records').upsert(row);
    if (error) { console.error(error); toast('保存に失敗しました（通信）'); throw error; }
  },
  async deleteRecord(id) {
    const { error } = await this.client.from('records').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { console.error(error); toast('削除に失敗しました（通信）'); throw error; }
  },
  async loadSettings() {
    const { data, error } = await this.client.from('settings').select('data').eq('id', 'main').maybeSingle();
    if (error) { console.error(error); throw error; }            // 既定値に化けさせない（全員の設定を消す事故の防止）
    if (!data) return { ...DEFAULT_SETTINGS };
    const d = data.data || {};
    if (d.flyers && !Array.isArray(d.flyers)) throw new Error('settings broken');
    if (d.members && !Array.isArray(d.members)) throw new Error('settings broken');
    return { ...DEFAULT_SETTINGS, ...d };
  },
  async saveSettings(s) {
    const flyers = (s.flyers || []).filter(f => !f.orphan); const { members, noticeDate, cities, admins } = s;
    const { error } = await this.client.from('settings').upsert({ id: 'main', data: { flyers, members, noticeDate, cities, admins: admins || [] }, updated_at: new Date().toISOString() });
    if (error) { console.error(error); toast('設定の保存に失敗しました（通信）'); throw error; }
  },
  async addMember(name) {
    const { error } = await this.client.rpc('add_member', { p_name: name });
    if (error) { console.error(error); throw error; }
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
  async loadAssignments() { const { data, error } = await this.client.from('assignments').select('*').eq('deleted', false).order('due', { ascending: true, nullsFirst: false }); if (error) { console.error(error); return S.assignments || []; } return data; },
  async saveAssignment(x) { const { error } = await this.client.from('assignments').upsert({ id: x.id, member: x.member || null, flyer_id: x.flyer_id || null, polygon: x.polygon, due: x.due || null, note: x.note || '', status: x.status || 'planned', est_setai: x.est_setai ?? null, town: x.town || null, created_by: x.created_by || S.user || null, updated_at: new Date().toISOString() }); if (error) { console.error(error); toast('保存に失敗しました（通信）'); throw error; } },
  async deleteAssignment(id) { const { error } = await this.client.from('assignments').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id); if (error) { console.error(error); toast('削除に失敗しました（通信）'); throw error; } },
  async loadEvents() { const { data, error } = await this.client.from('spot_events').select('*').eq('deleted', false).order('date'); if (error) { console.error(error); return S.events || []; } return data; },
  async saveEvent(x) { const { error } = await this.client.from('spot_events').upsert({ id: x.id, spot_id: x.spot_id, date: x.date, time: x.time || '', member: x.member || null, memo: x.memo || '', done: !!x.done, updated_at: new Date().toISOString() }); if (error) { console.error(error); toast('保存に失敗しました（通信）'); throw error; } },
  async deleteEvent(id) { const { error } = await this.client.from('spot_events').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id); if (error) { console.error(error); toast('削除に失敗しました（通信）'); throw error; } },
  // 15秒ごと＋画面復帰時：まず軽い「更新スタンプ」だけ取り、変わった時だけ全件取得（通信量を1/100以下に）
  subscribe(cb) {
    const tick = async () => {
      if (document.hidden || S.drawing || S.adjust || S.pin || this._busy) return;
      this._busy = true; this._silent = true;
      try {
        const { data: stamp, error } = await this.client.rpc('sync_stamp');
        if (error || stamp === this._stamp) return;
        const [recs, sets, boards, spots, events, asg] = await Promise.all([this.loadRecords(), this.loadSettings(), this.loadBoards(), this.loadSpots(), this.loadEvents(), this.loadAssignments()]);
        this._stamp = stamp; cb(recs, sets, boards, spots, events, asg);
      } catch { } finally { this._busy = false; this._silent = false; }
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
  labels: [], recIcons: [],
  overlapPolys: [],
  towns: [],             // {feature, id, name, city, setai, area}
  townFeatures: new Map(), // data feature id -> town
  infoWin: null,
  drawing: null,
  boards: [], boardMarkers: new Map(), boardsOn: false, boardAdding: false,
  spots: [], events: [], spotMarkers: new Map(), spotLabels: [], spotsOn: true, spotBarOn: false, spotAdding: false,
  assignments: [], asgPolys: new Map(), asgLabels: [], assignBarOn: false, drawPurpose: 'record',
  stations: [], stationMarkers: [], stationsOn: true,
};

const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDate = s => { const [y, m, d] = s.split('-'); return `${m}/${d}`; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeColor = c => /^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '#888888';
const flyerOf = id => { const f = S.settings.flyers.find(f => f.id === id); return f ? { ...f, color: safeColor(f.color) } : { id, name: '(削除済み)', color: '#888888' }; };
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, ms); }

/* ---------------- 起動 ---------------- */
window.addEventListener('DOMContentLoaded', init);
document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });

window.addEventListener('error', e => { console.error(e.error || e.message); toast('エラー: ' + (e.message || '不明').slice(0, 80), 5000); });
window.addEventListener('unhandledrejection', e => { console.error(e.reason); toast('エラー: ' + String(e.reason?.message || e.reason).slice(0, 80), 5000); });

async function init() {
  bindUI();
  await login();                       // 合言葉の検証と名前の選択（設定はこの中で読み込む）
  [S.records, S.boards, S.spots, S.events, S.assignments] = await Promise.all([store.loadRecords(), store.loadBoards(), store.loadSpots(), store.loadEvents(), store.loadAssignments()]);
  fetch('data/stations.json').then(r => r.json()).then(d => { S.stations = d; renderStations(); }).catch(() => {});
  S.filter.flyers = new Set(S.settings.flyers.map(f => f.id));
  await loadGoogleMaps();
  await initMap();
  await loadTowns();
  renderAll(); applyRole();
  if (localStorage.getItem('cm_rules_ack') !== String(RULES_VERSION)) setTimeout(() => showRules(true), 800);
  setInterval(renderNotice, 60000);
  store.subscribe((recs, sets, boards, spots, events, asg) => {
    S.records = recs; if (boards) S.boards = boards; if (spots) S.spots = spots; if (events) S.events = events; if (asg) S.assignments = asg;
    if (sets && Array.isArray(sets.flyers) && Array.isArray(sets.members)) { S.settings = { ...S.settings, ...sets }; for (const f of S.settings.flyers) if (!S.filter.flyers.has(f.id) && !S._userToggled) S.filter.flyers.add(f.id); applyRole(); }
    renderAll();
  });
}

/* ---------------- ログイン（合言葉＋名前） ---------------- */
function login() {
  return new Promise(async resolve => {
    let saved = null; try { saved = JSON.parse(localStorage.getItem('cm_user') || 'null'); } catch { }
    if (saved?.name) {
      try {
        const ok = USE_SUPABASE ? await SupabaseStore.verify(saved.pass || '') : true;
        if (ok) {
          S.settings = await store.loadSettings();
          if (S.settings.members.includes(saved.name)) { S.user = saved.name; $('#menuUser').textContent = `👤 ${saved.name}`; return resolve(); }
          return showLogin(resolve, { verified: true, pass: saved.pass });
        }
      } catch (e) { console.error(e); toast('通信できません。電波の良い所で開き直してください', 5000); }
    }
    showLogin(resolve);
  });
}
function showLogin(resolve, opt = {}) {
  const box = $('#login'); box.hidden = false;
  const needPass = USE_SUPABASE && !opt.verified;
  $('#loginPass').hidden = !needPass;
  $('#loginMsg').textContent = needPass ? '合言葉を入れてください' : 'あなたの名前を選んでください';
  $('#loginSub').hidden = !needPass;
  const sel = $('#selName'); const nameWrap = sel.closest('label');
  let verified = !needPass; if (opt.pass) $('#inpPass').value = opt.pass;
  const fillNames = () => {
    sel.innerHTML = S.settings.members.map(m => `<option>${esc(m)}</option>`).join('') + '<option value="__new">＋ 新しい名前を追加</option>';
    sel.onchange = () => $('#newNameWrap').hidden = sel.value !== '__new';
    nameWrap.hidden = false;
  };
  nameWrap.hidden = needPass; $('#newNameWrap').hidden = true;
  if (!needPass) { (async () => { try { S.settings = S.settings || await store.loadSettings(); } catch { S.settings = S.settings || { ...DEFAULT_SETTINGS }; } fillNames(); })(); }
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
      try { S.settings = await store.loadSettings(); } catch { $('#loginErr').textContent = '設定を読み込めません（通信）'; verified = false; return; }
      fillNames(); $('#inpPass').disabled = true; $('#btnLogin').textContent = 'はじめる';
      return;
    }
    let name = sel.value;
    if (name === '__new') {
      name = $('#inpNewName').value.trim();
      if (!name) { $('#loginErr').textContent = '名前を入れてください'; return; }
      const norm = x => x.replace(/[\s　]+/g, '');
      const dup = S.settings.members.find(m => norm(m) === norm(name)); if (dup) name = dup;
      else { try { await store.addMember(name); S.settings = await store.loadSettings(); } catch { $('#loginErr').textContent = '名前を登録できませんでした（通信）'; return; } }
    }
    S.user = name;
    localStorage.setItem('cm_user', JSON.stringify({ name, pass }));
    box.hidden = true; $('#inpPass').disabled = false;
    $('#menuUser').textContent = `👤 ${name}`; if (S.map) applyRole();
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
    isFractionalZoomEnabled: true,   // ピンチで無段階に拡大縮小（整数段階に吸着させない）
  });
  class Proj extends OverlayView { onAdd() { } draw() { } onRemove() { } }
  S.proj = new Proj(); S.proj.setMap(S.map);
  S.infoWin = new InfoWindow();
  // 現在地ボタン
  const loc = document.createElement('button');
  loc.className = 'ghost'; loc.textContent = '◎'; loc.title = '現在地';
  Object.assign(loc.style, { width: '40px', height: '40px', margin: '10px', borderRadius: '8px', fontSize: '20px', background: '#fff', color: '#333', boxShadow: '0 1px 4px rgba(0,0,0,.3)' });
  loc.onclick = () => {
    if (!navigator.geolocation) { toast('この端末では位置情報が使えません'); return; }
    toast('現在地を取得中…', 8000);
    const ok = p => { toast('現在地に移動しました', 1500); S.map.panTo({ lat: p.coords.latitude, lng: p.coords.longitude }); S.map.setZoom(17); };
    const fail = e => {
      if (e.code === 1) toast('位置情報が許可されていません。iPhoneは「設定 → プライバシー → 位置情報サービス → Safari」で許可してください', 7000);
      else if (e.code === 2) toast('位置を測れませんでした。屋外か窓際で、Wi-Fiをオンにして再度お試しください', 6000);
      else toast('時間内に位置を測れませんでした。もう一度押してください', 5000);
    };
    // まず高精度で15秒、だめなら低精度でもう一度
    navigator.geolocation.getCurrentPosition(ok, e => { if (e.code === 1) fail(e); else navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  };
  S.map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(loc);
  // ＋−は半段階ずつ（Googleの1段階＝2倍は大きすぎるため）。長押しで連続
  const zoomBy = d => S.map.setZoom(S.map.getZoom() + d);
  const holdZoom = (btn, d) => { let t = null, rep = null; const start = e => { e.preventDefault(); zoomBy(d); t = setTimeout(() => { rep = setInterval(() => zoomBy(d), 220); }, 400); }; const stop = () => { clearTimeout(t); clearInterval(rep); t = rep = null; }; btn.addEventListener('pointerdown', start); btn.addEventListener('pointerup', stop); btn.addEventListener('pointercancel', stop); btn.addEventListener('pointerleave', stop); };
  holdZoom($('#zoomIn'), 0.35); holdZoom($('#zoomOut'), -0.35);

  S.map.addListener('click', ev => { if (S.boardAdding) addBoardAt(ev.latLng); else if (S.spotAdding) addSpotAt(ev.latLng); });
  S.map.addListener('idle', () => {
    const c = S.map.getCenter(); localView.set({ center: { lat: c.lat(), lng: c.lng() }, zoom: S.map.getZoom() });
    styleTowns();
    const z = S.map.getZoom(); if (S._lastZoom !== undefined && z !== S._lastZoom) { renderRecords(); renderAssignments(); renderSpots(); } S._lastZoom = z;
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
      const town = { feature: f, id: p.KEY_CODE, name: p.S_NAME, city: p.CITY_NAME, setai: p.SETAI, jinko: p.JINKO, area: turf.area(f), kigo: p.KIGO_E, bbox: turf.bbox(f) };
      S.towns.push(town);
      f.id = `${p.KEY_CODE}_${p.KIGO_E || 'main'}`;
      const [df] = S.map.data.addGeoJson(f);
      S.townFeatures.set(df, town);
    }
  }
  S.map.data.addListener('click', ev => showTownInfo(S.townFeatures.get(ev.feature), ev.latLng));
  styleTowns();
}
function styleTowns() {
  const z = S.map.getZoom();
  const adding = S.boardAdding || S.spotAdding || !!S.drawing;
  S.map.data.setStyle({ visible: z >= 14, strokeColor: '#ffffff', strokeOpacity: z >= 16 ? 0.55 : 0.35, strokeWeight: 1, fillOpacity: 0, clickable: z >= 14 && !adding, zIndex: 1 });
}
// 追加モード：ポリゴンやピンがタップを横取りしないようにする
function setAddingUI(on) {
  if (!on && (S.boardAdding || S.spotAdding)) on = true;
  styleTowns();
  for (const p of S.polys.values()) p.setOptions({ clickable: !on });
  for (const p of S.overlapPolys) p.setOptions({ clickable: false });
  for (const p of S.asgPolys.values()) p.setOptions({ clickable: !on });
  for (const m of S.stationMarkers) m.setOptions({ clickable: !on });
  for (const m of S.recIcons) m.setOptions({ clickable: !on });
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
  const polys = recs.map(r => recPolygon(r)).filter(p => bboxHit(p.bbox, town.bbox) && turf.booleanIntersects(p, town.feature));
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
  const pb = turf.bbox(poly);
  for (const t of S.towns) {
    if (!bboxHit(pb, t.bbox) || !turf.booleanIntersects(poly, t.feature)) continue;
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
    constructor(pos, html, color, opt = {}) { super(); this.pos = pos; this.html = html; this.color = color; this.div = null; this.dy = opt.dy || 0; this.cls = opt.cls || 'recLabel'; }
    onAdd() {
      const d = document.createElement('div'); d.className = this.cls; if (this.color) d.style.borderColor = this.color; d.innerHTML = this.html;
      this.div = d; this.getPanes().floatPane.appendChild(d);   // 最前面。クリックはCSSでポリゴンへ通す
    }
    draw() {
      if (!this.div) return;
      const p = this.getProjection().fromLatLngToDivPixel(new google.maps.LatLng(this.pos.lat, this.pos.lng));
      this.div.style.left = p.x + 'px'; this.div.style.top = (p.y + this.dy) + 'px';
    }
    onRemove() { this.div?.remove(); this.div = null; }
  };
}

// 同じチラシの既存記録との重なり率（期間フィルタに関係なく全記録で判定）
function overlapRatio(ring, flyerId, excludeIds = []) {
  const me = turf.polygon([ring]); const mb = turf.bbox(me); let a = 0;
  for (const r of S.records) {
    if (r.flyer_id !== flyerId || excludeIds.includes(r.id)) continue;
    const rp = recPolygon(r); const rb = turf.bbox(rp);
    if (rb[0] > mb[2] || rb[2] < mb[0] || rb[1] > mb[3] || rb[3] < mb[1]) continue;
    try { const i = turf.intersect(turf.featureCollection([me, rp])); if (i) a += turf.area(i); } catch { }
  }
  return a / turf.area(me);
}
const isLocked = () => !!S.settings?.noticeDate && today() >= S.settings.noticeDate;

/* ---------------- 記録の描画 ---------------- */
const _polyCache = new Map();
function recPolygon(r) {
  const k = r.id + '|' + (r.updated_at || '') + '|' + (r.polygon?.length || 0);
  let p = _polyCache.get(k);
  if (!p) { p = turf.polygon([r.polygon]); p.bbox = turf.bbox(p); if (_polyCache.size > 3000) _polyCache.clear(); _polyCache.set(k, p); }
  return p;
}
const bboxHit = (a, b) => !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);

function filteredRecords() {
  const p = S.filter.period;
  let since = null;
  if (p !== 'all') { const d = new Date(); d.setDate(d.getDate() - Number(p)); since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  return S.records.filter(r => S.filter.flyers.has(r.flyer_id) && (!since || r.date >= since));
}

function renderAll() {
  renderChips(); renderNotice(); renderLegend(); renderRecords(); renderBoards(); renderSpots(); renderAssignments(); renderStations();
}

function renderRecords() {
  ensureLabelClass();
  for (const p of S.polys.values()) p.setMap(null);
  S.polys.clear();
  for (const l of S.labels) l.setMap(null);
  S.labels = [];
  for (const m of S.recIcons) m.setMap(null); S.recIcons = [];
  const showLabels = S.map.getZoom() >= 15;
  const showIcons = S.map.getZoom() < 15;   // 引いた時は範囲の中心にアイコンを出す
  for (const p of S.overlapPolys) p.setMap(null);
  S.overlapPolys = [];
  const recs = filteredRecords();
  // 同じ範囲（group_id）にまとめる
  const groups = new Map();
  for (const r of recs) { const k = r.group_id || r.id; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
  for (const [k, list] of groups) {
    const r = list[0]; const f = flyerOf(r.flyer_id); const f2 = list.length > 1 ? flyerOf(list[1].flyer_id) : null;
    const poly = new google.maps.Polygon({
      paths: r.polygon.map(([lng, lat]) => ({ lat, lng })),
      strokeColor: f2 ? f2.color : f.color, strokeOpacity: 0.95, strokeWeight: f2 ? 4 : 2,
      fillColor: f.color, fillOpacity: 0.32, map: S.map, zIndex: 2,
    });
    poly.addListener('click', ev => { if (!S.drawing) showRecord(r, ev.latLng); });
    S.polys.set(k, poly);
    if (showIcons) {
      const c = turf.centerOfMass(recPolygon(r)).geometry.coordinates;
      const mk = new google.maps.Marker({ position: { lat: c[1], lng: c[0] }, map: S.map, zIndex: 4,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: S.map.getZoom() >= 13 ? 11 : 8, fillColor: f.color, fillOpacity: 0.95, strokeColor: '#fff', strokeWeight: 2 },
        label: S.map.getZoom() >= 13 ? { text: '📄', fontSize: '12px' } : undefined,
        title: `${fmtDate(r.date)} ${r.member} ${list.map(x => flyerOf(x.flyer_id).name + ' ' + x.count + '枚').join('／')}` });
      mk.addListener('click', () => { if (!S.drawing) showRecord(r); });
      S.recIcons.push(mk);
    }
    if (showLabels) {
      const c = turf.centerOfMass(recPolygon(r)).geometry.coordinates;
      const lines = list.map(x => `<span style="color:${flyerOf(x.flyer_id).color}">●</span>${esc(flyerOf(x.flyer_id).name)} <b>${x.count.toLocaleString()}</b>枚`).join('<br>');
      const html = `<b>${fmtDate(r.date)}</b> ${esc(r.member)}<br>${lines}`;
      const lb = new RecLabel({ lat: c[1], lng: c[0] }, html, f.color); lb.setMap(S.map); S.labels.push(lb);
    }
  }
  // 同じチラシ同士の重なりを赤で表示（相手は期間に関係なく全記録）
  const byFlyer = {};
  for (const r of S.records) if (S.filter.flyers.has(r.flyer_id)) (byFlyer[r.flyer_id] ||= []).push(r);
  const shown = new Set(recs.map(r => r.id));
  for (const list of Object.values(byFlyer)) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      if (!shown.has(list[i].id) && !shown.has(list[j].id)) continue;
      if (list[i].group_id && list[i].group_id === list[j].group_id) continue;
      const a = recPolygon(list[i]), b = recPolygon(list[j]);
      const ab = turf.bbox(a), bb = turf.bbox(b);
      if (ab[0] > bb[2] || ab[2] < bb[0] || ab[1] > bb[3] || ab[3] < bb[1]) continue;
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
  const known = new Set(S.settings.flyers.map(f => f.id));
  for (const id of new Set(S.records.map(r => r.flyer_id))) if (!known.has(id)) { S.settings.flyers.push({ id, name: '(削除済み)', color: '#888888', orphan: true }); }
  el.innerHTML = S.settings.flyers.map(f => `<button class="chip ${S.filter.flyers.has(f.id) ? 'on' : ''}" data-id="${esc(f.id)}" style="--c:${safeColor(f.color)}" draggable="true" title="ドラッグで並べ替え"><span class="dot"></span>${esc(f.name)}</button>`).join('');
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
      e.preventDefault(); c.classList.remove('dragOver'); if (!isAdmin()) return;
      const from = e.dataTransfer.getData('text/plain'), to = c.dataset.id; if (!from || from === to) return;
      const arr = S.settings.flyers; const fi = arr.findIndex(f => f.id === from), ti = arr.findIndex(f => f.id === to);
      if (fi < 0 || ti < 0) return;
      const [m] = arr.splice(fi, 1); arr.splice(ti, 0, m);
      try { await store.saveSettings(S.settings); renderAll(); toast('並び順を保存しました'); } catch { }
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
  S.drawing = { pts: [], ll: [], ctx, rect, active: false, mode: S.drawMode || 'tap', down: null, vMarkers: [], mMarkers: [], line: null, poly: null, closeLine: null };
  setAddingUI(true);   // 町丁目・ポリゴン・ピンがタップを横取りしないように
  setDrawMode(S.drawing.mode);
  $('#fab').hidden = true; setLegend(false); $('#legendBtn').hidden = true; $('#zoomBtns').hidden = true; $('#centerMark').hidden = true;
  const pos = e => [e.clientX - S.drawing.rect.left, e.clientY - S.drawing.rect.top];
  // なぞるモード（キャンバス）
  layer.onpointerdown = e => {
    const d = S.drawing; if (!d || d.mode !== 'free' || e.target !== cv) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); layer.setPointerCapture?.(e.pointerId);
    d.active = true; d.pts = []; addPt(e);
  };
  layer.onpointermove = e => { const d = S.drawing; if (d?.mode === 'free' && d.active) { e.preventDefault(); addPt(e); } };
  layer.onpointerup = layer.onpointercancel = e => { const d = S.drawing; if (d?.mode === 'free' && d.active) { d.active = false; finishStroke(); } };
  function addPt(e) {
    const [x, y] = pos(e); const pts = S.drawing.pts;
    if (pts.length) { const [px, py] = pts[pts.length - 1]; if (Math.hypot(x - px, y - py) < 3) return; }
    pts.push([x, y]); drawPreview(false);
  }
  // 点で囲むモード（地図に直接置く：地図はそのまま動かせる）
  S.drawing.mapClick = S.map.addListener('click', ev => { const d = S.drawing; if (d && d.mode === 'tap') tapAdd(ev.latLng); });
}
function tapAdd(latLng, index) {
  const d = S.drawing; const p = { lat: latLng.lat(), lng: latLng.lng() };
  if (index == null) d.ll.push(p); else d.ll.splice(index, 0, p);
  redrawTap();
}
function clearTapShapes() {
  const d = S.drawing; if (!d) return;
  for (const m of d.vMarkers) m.setMap(null); for (const m of d.mMarkers) m.setMap(null);
  d.vMarkers = []; d.mMarkers = [];
  d.line?.setMap(null); d.poly?.setMap(null); d.closeLine?.setMap(null); d.line = d.poly = d.closeLine = null;
}
function redrawTap() {
  const d = S.drawing; if (!d) return;
  clearTapShapes();
  const n = d.ll.length;
  if (n >= 2) d.line = new google.maps.Polyline({ path: d.ll, map: S.map, strokeColor: '#00e5ff', strokeWeight: 4, zIndex: 40, clickable: false });
  if (n >= 3) {
    d.poly = new google.maps.Polygon({ paths: d.ll, map: S.map, strokeOpacity: 0, fillColor: '#00e5ff', fillOpacity: 0.22, zIndex: 39, clickable: false });
    d.closeLine = new google.maps.Polyline({ path: [d.ll[n - 1], d.ll[0]], map: S.map, strokeOpacity: 0, zIndex: 40, clickable: false,
      icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: '#00e5ff', scale: 3 }, offset: '0', repeat: '14px' }] });
  }
  // 辺の中点（タップで点を追加）
  if (n >= 2) {
    const segs = n >= 3 ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = d.ll[i], b = d.ll[(i + 1) % n];
      const m = new google.maps.Marker({ position: { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }, map: S.map, zIndex: 41,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#fff', fillOpacity: 0.9, strokeColor: '#0097a7', strokeWeight: 2 }, title: '点を追加' });
      m.addListener('click', () => tapAdd(m.getPosition(), i + 1));
      d.mMarkers.push(m);
    }
  }
  // 頂点（ドラッグで移動・タップで削除）
  d.ll.forEach((p, i) => {
    const m = new google.maps.Marker({ position: p, map: S.map, zIndex: 42, draggable: true, crossOnDrag: false,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: '#fff', fillOpacity: 1, strokeColor: '#00b8d4', strokeWeight: 3 },
      label: { text: String(i + 1), color: '#0b3a48', fontSize: '13px', fontWeight: '700' }, title: 'ドラッグで移動／タップで削除' });
    let dragged = false;
    m.addListener('dragstart', () => { dragged = true; });
    m.addListener('drag', () => { d.ll[i] = { lat: m.getPosition().lat(), lng: m.getPosition().lng() }; d.line?.setPath(d.ll); d.poly?.setPath(d.ll); if (d.closeLine) d.closeLine.setPath([d.ll[d.ll.length - 1], d.ll[0]]); });
    m.addListener('dragend', () => { d.ll[i] = { lat: m.getPosition().lat(), lng: m.getPosition().lng() }; redrawTap(); });
    m.addListener('click', () => { if (dragged) { dragged = false; return; } d.ll.splice(i, 1); redrawTap(); });
    d.vMarkers.push(m);
  });
  updateTapUI();
}
function updateTapUI() {
  const d = S.drawing; const n = d.ll.length;
  $('#btnDrawDone').disabled = n < 3;
  $('#btnDrawUndo').disabled = n === 0;
  $('#drawHint').textContent = n === 0 ? '範囲の角を順番にタップ（地図は指で動かせます）'
    : n < 3 ? `角を順番にタップ（あと${3 - n}点）`
    : '白丸：ドラッグで移動／タップで削除　小丸：点を追加';
}
function setDrawMode(mode) {
  const d = S.drawing; S.drawMode = mode; if (!d) return;
  d.mode = mode; d.pts = []; d.active = false; d.ll = []; clearTapShapes(); drawPreview(false);
  $('#modeFree').classList.toggle('on', mode === 'free'); $('#modeTap').classList.toggle('on', mode === 'tap');
  $('#btnDrawUndo').hidden = mode !== 'tap'; $('#btnDrawDone').disabled = true;
  // なぞる時だけキャンバスが指を受け取る。点で囲む時は地図をそのまま操作できる
  const L = $('#drawLayer'); L.classList.toggle('tapMode', mode === 'tap');
  L.style.pointerEvents = mode === 'tap' ? 'none' : ''; L.style.touchAction = mode === 'tap' ? 'auto' : '';
  $('#drawCanvas').style.display = mode === 'tap' ? 'none' : '';
  for (const id of ['#drawModes', '#drawButtons']) $(id).style.pointerEvents = 'auto';
  if (mode === 'tap') updateTapUI(); else $('#drawHint').textContent = '配った範囲を指でなぞって囲んでください';
}
function drawPreview(closed) {
  const { ctx, rect, pts } = S.drawing;
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (pts.length < 2) return;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  ctx.lineWidth = 4; ctx.strokeStyle = '#00e5ff'; ctx.stroke();
  if (closed) { ctx.closePath(); ctx.fillStyle = 'rgba(0,229,255,.22)'; ctx.fill(); }
}
function finishStroke() {
  const d = S.drawing;
  if (d.pts.length < 8) { d.pts = []; drawPreview(false); $('#drawHint').textContent = '短すぎます。もう少し大きく囲んでください'; return; }
  drawPreview(true);
  $('#btnDrawDone').disabled = false;
  $('#drawHint').textContent = 'よければ「これで決定」（次の画面で角を調整できます）';
}
function cancelDrawing() {
  clearTapShapes(); if (S.drawing?.mapClick) google.maps.event.removeListener(S.drawing.mapClick);
  $('#drawLayer').hidden = true; $('#fab').hidden = false; S.drawing = null; setAddingUI(false);
  $('#legendBtn').hidden = S.boardsOn || S.spotBarOn; $('#zoomBtns').hidden = false; $('#centerMark').hidden = false;
}
function commitDrawing() {
  const d = S.drawing; if (!d) return;
  if ((d.mode === 'free' && d.pts.length < 8) || (d.mode === 'tap' && d.ll.length < 3)) { toast('先に範囲を描いてください'); return; }
  const projection = S.proj.getProjection();
  let coords = d.mode === 'tap' ? d.ll.map(p => [p.lng, p.lat]) : d.pts.map(([x, y]) => { const ll = projection.fromContainerPixelToLatLng(new google.maps.Point(x, y)); return [ll.lng(), ll.lat()]; });
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
  if (!ok) { S.drawPurpose = 'record'; return; }
  if (!a.rec && S.drawPurpose === 'assign') { S.drawPurpose = 'record'; openAssignForm({ polygon: ring }); return; }
  if (a.rec) {
    // 既存記録の形の変更：同じ範囲の記録すべてに反映してから内容編集へ
    const list = groupOf(a.rec).length ? groupOf(a.rec) : [a.rec];
    (async () => {
      const est = estimateRecord(turf.polygon([ring])); const area = Math.round(turf.area(turf.polygon([ring])));
      try { for (const x of list) await store.saveRecord({ ...x, polygon: ring, est_setai: est.setai, town: est.town, area_m2: area, updated_at: new Date().toISOString() }); } catch { return; }
      S.records = await store.loadRecords(); renderAll(); toast('形を保存しました');
      showRecord(S.records.find(x => x.id === a.rec.id) || { ...a.rec, polygon: ring });
    })();
  } else openRecordForm({ polygon: ring });
}

/* ---------------- ボトムシート ---------------- */
function openSheet(html) { $('#sheetBody').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; }

function groupOf(rec) { return rec.group_id ? S.records.filter(x => x.group_id === rec.group_id) : (rec.id ? [S.records.find(x => x.id === rec.id) || rec] : []); }
function openRecordForm(rec) {
  const isNew = !rec.id;
  const poly = turf.polygon([rec.polygon]);
  const est = estimateRecord(poly);
  const area = Math.round(turf.area(poly));
  const flyers = S.settings.flyers;
  if (!flyers.length) { toast('先に設定でチラシを登録してください'); return; }
  const existing = isNew ? [] : groupOf(rec);
  const rows = existing.length ? existing.map(x => ({ id: x.id, flyer_id: x.flyer_id, count: x.count })) : [{ id: null, flyer_id: rec.flyer_id || flyers[0].id, count: rec.count ?? est.setai }];
  const base = existing[0] || rec;
  const flyerRow = (row) => `<div class="rowItem flyerLine" data-id="${esc(row.id || uid())}"><select class="fFlyer">${flyers.map(f => `<option value="${f.id}" ${row.flyer_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select><input class="fCount" type="number" inputmode="numeric" min="0" value="${row.count}" placeholder="枚数"><button class="icon delLine" title="このチラシを外す">🗑</button></div>`;
  openSheet(`
    <h3>${isNew ? '配布を記録' : '記録を編集'}</h3>
    <div class="small">範囲 約${area.toLocaleString()}㎡ ／ 推定 <b>${est.setai}</b> 世帯 ／ ${esc(est.town)}</div>
    <label>配ったチラシと枚数（複数可）</label>
    <div id="flyerLines">${rows.map(flyerRow).join('')}</div>
    <button class="ghost" id="addLine" style="padding:8px 12px;border-radius:8px;margin-top:4px">＋ チラシを追加</button>
    <label>配った日<input id="fDate" type="date" value="${base.date || today()}"></label>
    <label>配った人<select id="fMember">${S.settings.members.map(m => `<option ${((base.member || S.user) === m) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
    <label>メモ（任意）<input id="fMemo" type="text" value="${esc(base.memo || '')}" placeholder="例：東側のアパートは投函不可"></label>
    <div class="btnRow"><button class="ghost" id="fCancel">やめる</button><button class="primary" id="fSave">保存する</button></div>
  `);
  const bindLines = () => $('#flyerLines').querySelectorAll('.delLine').forEach(b => b.onclick = () => { if ($('#flyerLines').children.length > 1) b.closest('.flyerLine').remove(); else toast('最低1つは必要です'); });
  bindLines();
  $('#addLine').onclick = () => {
    const used = [...$('#flyerLines').querySelectorAll('.fFlyer')].map(x => x.value);
    const next = flyers.find(f => !used.includes(f.id)) || flyers[0];
    $('#flyerLines').insertAdjacentHTML('beforeend', flyerRow({ id: null, flyer_id: next.id, count: est.setai })); bindLines();
  };
  const locked = isLocked();
  if (locked) { $('#addLine').hidden = true; const d = new Date(S.settings.noticeDate); d.setDate(d.getDate() - 1); $('#fDate').max = d.toISOString().slice(0, 10); }
  $('#fCancel').onclick = closeSheet;
  $('#fSave').onclick = async () => {
    if (locked && ($('#fDate').value >= S.settings.noticeDate || [...$('#flyerLines').querySelectorAll('.flyerLine')].some(el => !existing.some(x => x.id === el.dataset.id)))) { toast('告示日以降の配布は登録できません（公職選挙法）'); return; }
    const lines = [...$('#flyerLines').querySelectorAll('.flyerLine')].map(el => ({ id: el.dataset.id, flyer_id: el.querySelector('.fFlyer').value, count: Number(el.querySelector('.fCount').value || 0) }));
    const seen = new Set(); for (const l of lines) { if (seen.has(l.flyer_id)) { toast('同じチラシが2行あります。1行にまとめてください'); return; } seen.add(l.flyer_id); }
    for (const l of lines) {
      const ratio = overlapRatio(rec.polygon, l.flyer_id, existing.map(x => x.id));
      if (ratio > 0.2 && !confirm(`「${flyerOf(l.flyer_id).name}」は、すでに配った範囲と約${Math.round(ratio * 100)}%重なっています。このまま保存しますか？`)) return;
    }
    const group_id = existing[0]?.group_id || (lines.length > 1 ? uid() : null);
    const common = { polygon: rec.polygon, date: $('#fDate').value || today(), member: $('#fMember').value, memo: $('#fMemo').value.trim(), est_setai: est.setai, town: est.town, area_m2: area, group_id: group_id || (lines.length > 1 ? uid() : null) };
    $('#fSave').disabled = true;
    try {
      for (const l of lines) {
        const prev = existing.find(x => x.id === l.id);
        await store.saveRecord({ id: l.id, ...common, flyer_id: l.flyer_id, count: l.count, created_at: prev?.created_at || new Date().toISOString(), updated_at: new Date().toISOString() });
      }
      for (const x of existing) if (!lines.some(l => l.id === x.id)) await store.deleteRecord(x.id);
    } catch { $('#fSave').disabled = false; return; }
    S.records = await store.loadRecords();
    for (const l of lines) if (!S.filter.flyers.has(l.flyer_id)) S.filter.flyers.add(l.flyer_id);
    if (rec.from_assignment) { const asg = S.assignments.find(x => x.id === rec.from_assignment); if (asg) { try { await store.saveAssignment({ ...asg, status: 'done' }); S.assignments = await store.loadAssignments(); } catch { } } }
    closeSheet(); renderAll(); toast('保存しました');
  };
}

function showRecord(r, latLng) {
  const list = groupOf(r).length ? groupOf(r) : [r];
  const f = flyerOf(r.flyer_id);
  const total = list.reduce((a, x) => a + (x.count || 0), 0);
  openSheet(`
    <h3>${list.map(x => `<span style="display:inline-block;width:12px;height:12px;background:${flyerOf(x.flyer_id).color};border-radius:3px;margin-right:4px"></span>`).join('')}${list.length > 1 ? `${list.length}種類のチラシ` : esc(f.name)}</h3>
    <dl class="kv">
      ${list.map(x => `<dt>${esc(flyerOf(x.flyer_id).name)}</dt><dd>${x.count.toLocaleString()} 枚</dd>`).join('')}
      ${list.length > 1 ? `<dt>合計</dt><dd>${total.toLocaleString()} 枚</dd>` : ''}
      <dt>日付</dt><dd>${esc(r.date)}</dd>
      <dt>配った人</dt><dd>${esc(r.member)}</dd>
      <dt>推定世帯</dt><dd>${(r.est_setai ?? 0).toLocaleString()} 世帯（${esc(r.town || '')}）</dd>
      <dt>面積</dt><dd>約 ${(r.area_m2 ?? 0).toLocaleString()} ㎡</dd>
      ${r.memo ? `<dt>メモ</dt><dd>${esc(r.memo)}</dd>` : ''}
    </dl>
    <div class="btnRow">${isAdmin() || r.member === S.user ? '<button class="ghost" id="rDel">削除</button>' : ''}<button class="ghost" id="rShape">形を直す</button><button class="ghost" id="rEdit">編集</button><button class="primary" id="rClose">閉じる</button></div>
  `);
  $('#rClose').onclick = closeSheet;
  $('#rEdit').onclick = () => openRecordForm(r);
  $('#rShape').onclick = () => { if ($('#fab').disabled) { toast('告示日を過ぎているため変更できません'); return; } startAdjust(r.polygon, r); };
  if ($('#rDel')) $('#rDel').onclick = async () => {
    if (!confirm(`${r.date} ${r.member} の記録（${list.length}件）を削除しますか？`)) return;
    try { for (const x of list) await store.deleteRecord(x.id); } catch { return; }
    S.records = await store.loadRecords(); closeSheet(); renderAll(); toast('削除しました');
  };
}

function showList() {
  const recs = [...filteredRecords()].sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const total = recs.reduce((s, r) => s + r.count, 0);
  const byF = {}; for (const r of recs) byF[r.flyer_id] = (byF[r.flyer_id] || 0) + r.count;
  openSheet(`
    <h3>配布一覧（表示中の条件）</h3>
    <div class="small">${recs.length}件 ／ 合計 ${total.toLocaleString()}枚 ／ ${Object.entries(byF).map(([k, v]) => `${esc(flyerOf(k).name)} ${v.toLocaleString()}枚`).join('・')}</div>
    <div class="small" style="margin-top:4px">残り枚数（全期間）：${flyerTotals().map(f => `${esc(f.name)} ${f.total ? `${f.remain.toLocaleString()} / ${f.total.toLocaleString()}` : `配布 ${f.used.toLocaleString()}（用意枚数は未設定）`}`).join('・')}</div>
    <div class="tableWrap"><table><thead><tr><th>日付</th><th>配った人</th><th>チラシ</th><th>部数</th><th>主な町丁目</th></tr></thead><tbody>
    ${recs.map(r => `<tr data-id="${r.id}"><td>${fmtDate(r.date)}</td><td>${esc(r.member)}</td><td><span style="color:${flyerOf(r.flyer_id).color}">●</span> ${esc(flyerOf(r.flyer_id).name)}</td><td>${r.count}</td><td>${esc(r.town || '')}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="btnRow"><button class="ghost" id="lCopy">📋 LINE用にコピー</button><button class="ghost" id="lCsv">CSV</button><button class="primary" id="lClose">閉じる</button></div>
  `);
  $('#lClose').onclick = closeSheet;
  $('#lCopy').onclick = () => copyText(summaryText(recs));
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

function showTownTable(mode = 'has') {
  const recs = filteredRecords();
  const fl = S.settings.flyers.filter(f => S.filter.flyers.has(f.id));
  const rows = [];
  for (const t of S.towns) {
    if (t.kigo && t.kigo !== 'E1' && t.setai === 0) continue;
    if (t.setai < 5) continue;
    const covs = fl.map(f => coverageOf(t, recs.filter(r => r.flyer_id === f.id)));
    const any = covs.some(c => c > 0);
    if (mode === 'has' && !any) continue;
    if (mode === 'zero' && any) continue;
    rows.push({ t, covs });
  }
  if (mode === 'zero') rows.sort((a, b) => b.t.setai - a.t.setai); else rows.sort((a, b) => Math.max(...b.covs) - Math.max(...a.covs));
  const shown = rows.slice(0, 120);
  openSheet(`
    <h3>町丁目ごとの配布率</h3>
    <div class="stTabs"><button data-m="has" class="${mode === 'has' ? 'on' : ''}">記録あり</button><button data-m="zero" class="${mode === 'zero' ? 'on' : ''}">未配布（世帯数順）</button><button data-m="all" class="${mode === 'all' ? 'on' : ''}">すべて</button></div>
    <div class="small">国勢調査（2020年）の世帯数に対する面積ベースの推定。${mode === 'zero' ? '世帯数が多い未配布の町丁目から並べています（次にどこを配るかの目安）' : ''}${rows.length > shown.length ? `　※上位${shown.length}件を表示` : ''}</div>
    <div class="tableWrap"><table><thead><tr><th>町丁目</th><th>世帯</th>${fl.map(f => `<th><span style="color:${f.color}">●</span>${esc(f.name)}</th>`).join('')}</tr></thead><tbody>
    ${shown.map(({ t, covs }) => `<tr data-id="${t.id}"><td>${esc(t.city)} ${esc(t.name)}</td><td>${t.setai}</td>${covs.map(c => `<td><div>${Math.round(c * 100)}%</div><div class="bar"><i style="width:${Math.round(c * 100)}%"></i></div></td>`).join('')}</tr>`).join('') || '<tr><td colspan="9" class="small">該当なし</td></tr>'}
    </tbody></table></div>
    <div class="btnRow"><button class="primary" id="tClose">閉じる</button></div>
  `);
  $('#tClose').onclick = closeSheet;
  $('#sheetBody').querySelectorAll('.stTabs button').forEach(b => b.onclick = () => showTownTable(b.dataset.m));
  $('#sheetBody').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { const t = S.towns.find(x => x.id === tr.dataset.id); if (!t) return; closeSheet(); S.map.panTo({ lat: t.feature.properties.Y_CODE, lng: t.feature.properties.X_CODE }); S.map.setZoom(16); });
}

function showSettings() {
  const s = S.settings; const origMembers = [...s.members];
  openSheet(`
    <h3>設定</h3>
    <h4 style="margin:12px 0 4px">チラシの種類</h4>
    <div class="small">色／名前／用意した枚数（入れると残り枚数が出ます）</div>
    <div id="flyerRows">${s.flyers.map(f => flyerRow(f)).join('')}</div>
    <button class="ghost" id="addFlyer" style="padding:8px 12px;border-radius:8px;margin-top:6px">＋ チラシを追加</button>
    <h4 style="margin:18px 0 4px">メンバー（配る人）</h4>
    <label>1行に1人<textarea id="sMembers" rows="4">${esc(s.members.join('\n'))}</textarea></label>
    <h4 style="margin:18px 0 4px">管理者</h4>
    <label>1行に1人。空欄なら全員が設定・削除できます。入れると、その人だけが設定変更・削除・割り当て作成・一覧取り込みをできます<textarea id="sAdmins" rows="2">${esc((s.admins || []).join('\n'))}</textarea></label>
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
    const typed = $('#sMembers').value.split('\n').map(x => x.trim()).filter(Boolean);
    const admins = $('#sAdmins').value.split('\n').map(x => x.trim()).filter(Boolean);
    if (admins.length && !admins.includes(S.user) && !confirm('自分（' + S.user + '）が管理者に入っていません。保存すると設定を開けなくなります。よろしいですか？')) return;
    s.admins = admins;
    s.noticeDate = $('#sNotice').value;
    $('#sSave').disabled = true;
    try {
      // 直前にサーバーの最新を取り、他端末で追加された名前が消えないように和集合にする（消したい名前は元の一覧から外した分だけ）
      const fresh = await store.loadSettings();
      const removed = origMembers.filter(m => !typed.includes(m));
      s.members = [...new Set([...typed, ...fresh.members.filter(m => !removed.includes(m))])];
      await store.saveSettings(s);
    } catch { $('#sSave').disabled = false; return; }
    for (const f of flyers) S.filter.flyers.add(f.id);
    closeSheet(); renderAll(); applyRole(); toast('設定を保存しました');
  };
  function flyerRow(f) { return `<div class="rowItem" data-id="${f.id}"><input type="color" value="${f.color}"><input type="text" value="${esc(f.name)}" placeholder="例：政策ビラ第2号"><input type="number" class="totalInp" inputmode="numeric" min="0" placeholder="用意枚数" value="${f.total ?? ''}" title="用意した枚数（残り枚数の計算用）"><span class="orderBtns"><button class="icon upFlyer" title="上へ">▲</button><button class="icon downFlyer" title="下へ">▼</button></span><button class="icon delFlyer">🗑</button></div>`; }
  function bindFlyerRows() {
    const rows = $('#flyerRows');
    rows.querySelectorAll('.delFlyer').forEach(b => b.onclick = () => { if (confirm('このチラシを削除しますか？（記録は残ります）')) b.closest('.rowItem').remove(); });
    rows.querySelectorAll('.upFlyer').forEach(b => b.onclick = () => { const r = b.closest('.rowItem'); if (r.previousElementSibling) rows.insertBefore(r, r.previousElementSibling); });
    rows.querySelectorAll('.downFlyer').forEach(b => b.onclick = () => { const r = b.closest('.rowItem'); if (r.nextElementSibling) rows.insertBefore(r.nextElementSibling, r); });
  }
}


/* ---------------- 赤ピンで位置を合わせる（拠点・掲示場の追加／位置修正） ---------------- */
function startPinPlace(latLng, onDone, hint) {
  endPinPlace(false);
  closeSheet(); S.infoWin.close();
  const m = new google.maps.Marker({ position: latLng, map: S.map, draggable: true, zIndex: 60, animation: google.maps.Animation.DROP, crossOnDrag: false,
    icon: { path: 'M 0,0 C -2,-6 -14,-9 -14,-20 A 14,14 0 1,1 14,-20 C 14,-9 2,-6 0,0 Z', fillColor: '#e53935', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1.4, labelOrigin: new google.maps.Point(0, -20) }, label: { text: '●', color: '#fff', fontSize: '10px' } });
  S.pin = { marker: m, onDone };
  $('#pinHint').textContent = hint || '赤いピンをドラッグして位置を合わせ、「ここに決定」';
  $('#pinBar').hidden = false; $('#fab').hidden = true;
  S.map.panTo(latLng);
}
function endPinPlace(ok) {
  const p = S.pin; if (!p) return;
  const pos = p.marker.getPosition(); p.marker.setMap(null); S.pin = null;
  $('#pinBar').hidden = true; $('#fab').hidden = false;
  if (ok) p.onDone(pos);
}

/* ---------------- ポスター掲示場（看板） ---------------- */
const BOARD_STYLE = {
  todo:     { color: '#9aa7b4', label: '未', name: '未着手' },
  reserved: { color: '#60a5fa', label: '予', name: '予約（担当決め済み）' },
  working:  { color: '#facc15', label: '中', name: '対応中' },
  done:     { color: '#3fb950', label: '済', name: '完了' },
  damaged:  { color: '#ef4444', label: '異', name: '異常（破損・剥がれ）' },
  check:    { color: '#f2a93b', label: '？', name: '要確認' },
};
const BOARD_ST_LABEL = k => BOARD_STYLE[k]?.name || k;
const BOARD_KIND = { official: { name: '選挙用ポスター掲示場', short: '掲示場' }, general: { name: '一般ポスター（支援者宅・店舗など）', short: '一般' } };
// 看板の形のアイコン（SVG）。絵が主役：掲示板にポスターが貼られた図。色＝状態、番号は下に小さく
function boardIcon(kind, color, text, status) {
  const t = String(text || '').slice(0, 4);
  const mark = status === 'done' ? '✓' : status === 'damaged' ? '!' : status === 'check' ? '?' : status === 'working' ? '…' : status === 'reserved' ? '予' : '';
  const badge = mark ? `<circle cx='40' cy='8' r='8' fill='#fff' stroke='${color}' stroke-width='2'/><text x='40' y='11.5' font-size='10' font-weight='700' text-anchor='middle' fill='${color}' font-family='sans-serif'>${mark}</text>` : '';
  const board = kind === 'general'
    // 貼り紙：紙1枚に候補者ポスター風の色面
    ? `<rect x='10' y='8' width='28' height='30' rx='2' fill='#fff' stroke='#333' stroke-width='1.5'/><rect x='13' y='11' width='22' height='14' fill='${color}' opacity='.9'/><rect x='13' y='27' width='22' height='3' fill='#333'/><rect x='13' y='32' width='14' height='3' fill='#777'/>`
    // 掲示板：木の支柱＋白い板に4枚のポスター
    : `<rect x='22' y='34' width='4' height='14' fill='#6b4f2a'/><rect x='5' y='6' width='38' height='30' rx='2' fill='#f7f3e8' stroke='#5b4630' stroke-width='2'/><rect x='9' y='10' width='14' height='10' fill='${color}'/><rect x='25' y='10' width='14' height='10' fill='#e11d48' opacity='.75'/><rect x='9' y='22' width='14' height='10' fill='#2563eb' opacity='.75'/><rect x='25' y='22' width='14' height='10' fill='#f59e0b' opacity='.75'/>`;
  const num = t ? `<rect x='12' y='40' width='24' height='13' rx='6.5' fill='#111' opacity='.85'/><text x='24' y='50' font-size='10' font-weight='700' text-anchor='middle' fill='#fff' font-family='sans-serif'>${t}</text>` : '';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='56' viewBox='0 0 48 56'><rect x='1' y='1' width='46' height='54' rx='8' fill='${color}' opacity='.25'/>${board}${num}${badge}</svg>`;
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new google.maps.Size(48, 56), anchor: new google.maps.Point(24, 52) };
}
S.boardKindFilter = 'all';
function setLegend(open) { S.legendOpen = open; $('#legend').hidden = !open; $('#legendBtn').classList.toggle('on', open); }
function toggleBoards(on) {
  S.boardsOn = on ?? !S.boardsOn;
  if (S.boardsOn && S.spotBarOn) toggleSpotBar(false);
  $('#boardBar').hidden = !S.boardsOn;
  $('#legendBtn').hidden = S.boardsOn || S.spotBarOn || S.assignBarOn; if (S.boardsOn) setLegend(false);
  if (S.boardsOn && S.assignBarOn) toggleAssignBar(false);
  if (!S.boardsOn) { setBoardAdding(false); S.infoWin.close(); }
  renderBoards(); renderSpots();
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
  const cnt = a => { const d = a.filter(b => b.status === 'done').length; return `${d}/${a.length}${a.length ? `（${Math.round(d / a.length * 100)}%）` : ''}`; };
  const bad = S.boards.filter(b => b.status === 'damaged' || b.status === 'check').length;
  $('#boardStat').textContent = `掲示場 ${cnt(off)}　一般 ${cnt(gen)}${bad ? `　⚠${bad}` : ''}`;
  if (!S.boardsOn) return;
  for (const b of S.boards) {
    const kind = b.kind || 'official';
    if (S.boardKindFilter !== 'all' && kind !== S.boardKindFilter) continue;
    const st = BOARD_STYLE[b.status] || BOARD_STYLE.todo;
    const m = new google.maps.Marker({
      position: { lat: b.lat, lng: b.lng }, map: S.map, zIndex: 20,
      icon: boardIcon(kind, st.color, b.no, b.status),
      title: `${b.no ? b.no + ' ' : ''}${b.place || ''}（${BOARD_ST_LABEL(b.status)}）`,
    });
    m.addListener('click', () => { if (!S.boardAdding) showBoard(b); });
    S.boardMarkers.set(b.id, m);
  }
}
async function addBoardAt(latLng) {
  setBoardAdding(false);
  startPinPlace(latLng, pos => addBoardForm(pos), 'ポスターを貼る場所にピンを合わせて「ここに決定」');
}
async function addBoardForm(latLng) {
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
    <div class="stTabs stTabs6">
      ${Object.entries(BOARD_STYLE).map(([k, v]) => `<button data-st="${k}" class="${b.status === k ? 'on' : ''}" style="color:${v.color}">${v.label === '未' ? '未着手' : v.label === '予' ? '予約' : v.label === '中' ? '対応中' : v.label === '済' ? '完了' : v.label === '異' ? '異常' : '要確認'}</button>`).join('')}
    </div>
    <label>担当・貼った人<select id="bBy">${S.settings.members.map(m => `<option ${((b.posted_by || S.user) === m) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
    <label>日付<input id="bDate" type="date" value="${esc(b.posted_at || today())}"></label>
    <label>写真（任意・自動で縮小します）<input id="bPhoto" type="file" accept="image/*" capture="environment"></label>
    <div class="photoBox" id="bPhotoBox">${b.photo_path ? '<div class="small">写真を読み込み中…</div>' : ''}</div>
    <label>メモ（例：破損あり、貼る位置が高い）<input id="bMemo" type="text" value="${esc(b.memo || '')}"></label>
    ${extLinks(b.lat, b.lng)}
    <details style="margin-top:10px"><summary class="small">種類・番号・場所を直す／削除</summary>
      <label>種類<select id="bKind"><option value="official" ${(b.kind || 'official') === 'official' ? 'selected' : ''}>選挙用ポスター掲示場</option><option value="general" ${b.kind === 'general' ? 'selected' : ''}>一般ポスター</option></select></label>
      <label>番号<input id="bNo" type="text" value="${esc(b.no)}"></label>
      <label>場所<input id="bPlace" type="text" value="${esc(b.place)}"></label>
      <div class="btnRow"><button class="ghost" id="bMove">📍 位置を直す</button>${isAdmin() ? '<button class="ghost" id="bDel" style="color:var(--danger)">この掲示場を削除</button>' : ''}</div>
    </details>
    <div class="btnRow"><button class="ghost" id="bCancel">閉じる</button><button class="primary" id="bSave">保存する</button></div>
  `);
  let status = b.status;
  $('#sheetBody').querySelectorAll('.stTabs button').forEach(btn => btn.onclick = () => { status = btn.dataset.st; $('#sheetBody').querySelectorAll('.stTabs button').forEach(x => x.classList.toggle('on', x === btn)); });
  if (b.photo_path) { const url = await store.photoUrl(b.photo_path); $('#bPhotoBox').innerHTML = url ? `<img src="${esc(url)}" alt="貼付写真">` : '<div class="small">写真を表示できません</div>'; }
  let newBlob = null;
  $('#bPhoto').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    newBlob = await shrinkImage(f, 1280, 0.8);
    if (!newBlob) { e.target.value = ''; return; }
    $('#bPhotoBox').innerHTML = `<img src="${URL.createObjectURL(newBlob)}" alt="プレビュー"><div class="small">約${Math.round(newBlob.size / 1024)}KB（保存で確定）</div>`;
    if (status === 'todo') { status = 'done'; $('#sheetBody').querySelectorAll('.stTabs button').forEach(x => x.classList.toggle('on', x.dataset.st === 'done')); }
  };
  $('#bCancel').onclick = closeSheet;
  $('#bMove').onclick = () => startPinPlace(new google.maps.LatLng(b.lat, b.lng), async pos => { const nb = { ...b, lat: +pos.lat().toFixed(6), lng: +pos.lng().toFixed(6) }; try { await store.saveBoard(nb); } catch { return; } S.boards = await store.loadBoards(); renderBoards(); toast('位置を直しました'); showBoard(S.boards.find(x => x.id === b.id) || nb); }, `掲示場 ${b.no} のピンをドラッグして「ここに決定」`);
  if ($('#bDel')) $('#bDel').onclick = async () => { if (!confirm(`掲示場 ${b.no} を削除しますか？`)) return; try { await store.deleteBoard(b.id); } catch { return; } S.boards = await store.loadBoards(); closeSheet(); renderBoards(); toast('削除しました'); };
  $('#bSave').onclick = async () => {
    $('#bSave').disabled = true;
    const nb = { ...b, status, posted_by: $('#bBy').value, posted_at: $('#bDate').value || today(), memo: $('#bMemo').value.trim(), no: $('#bNo').value.trim(), place: $('#bPlace').value.trim(), kind: $('#bKind').value };
    if (status === 'todo') { nb.posted_by = null; nb.posted_at = null; }
    if (status === 'reserved') { nb.posted_at = null; }
    if (newBlob) { const path = await store.uploadPhoto(newBlob, b.id); if (!path) { $('#bSave').disabled = false; return; } nb.photo_path = path; }
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
    img.onerror = async () => { try { const bm = await createImageBitmap(file); const r = Math.min(1, maxSide / Math.max(bm.width, bm.height)); const c = document.createElement('canvas'); c.width = Math.round(bm.width * r); c.height = Math.round(bm.height * r); c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height); c.toBlob(b => resolve(b || file), 'image/jpeg', quality); } catch { toast('この写真形式は使えません。カメラで撮り直すか、別の写真を選んでください', 4000); resolve(null); } };
    img.src = url;
  });
}
function showBoardList() {
  const rows = [...S.boards].sort((a, b) => ((a.kind || 'official') === 'official' ? 0 : 1) - ((b.kind || 'official') === 'official' ? 0 : 1) || (parseInt(a.no) || 9999) - (parseInt(b.no) || 9999) || String(a.no).localeCompare(String(b.no)));
  const sum = k => { const a = rows.filter(b => (b.kind || 'official') === k); const d = a.filter(b => b.status === 'done').length; return `${BOARD_KIND[k].short} ${d}/${a.length}${a.length ? `＝${Math.round(d / a.length * 100)}%` : ''}（異常${a.filter(b => b.status === 'damaged').length}・要確認${a.filter(b => b.status === 'check').length}）`; };
  openSheet(`
    <h3>ポスター一覧</h3>
    <div class="small">${sum('official')} ／ ${sum('general')}</div>
    <div class="stTabs"><button id="blAll" class="${S.boardListOnlyOpen ? '' : 'on'}">すべて</button><button id="blOpen" class="${S.boardListOnlyOpen ? 'on' : ''}">未完了だけ</button></div>
    <div class="tableWrap"><table><thead><tr><th>種類</th><th>番号</th><th>場所</th><th>状態</th><th>担当</th><th>日付</th><th>写真</th></tr></thead><tbody>
    ${rows.filter(b => !S.boardListOnlyOpen || b.status !== 'done').map(b => `<tr data-id="${b.id}"><td>${BOARD_KIND[b.kind || 'official'].short}</td><td>${esc(b.no)}</td><td>${esc(b.place)}</td><td style="color:${BOARD_STYLE[b.status]?.color}">${BOARD_ST_LABEL(b.status)}</td><td>${esc(b.posted_by || '')}</td><td>${b.posted_at ? fmtDate(b.posted_at) : ''}</td><td>${b.photo_path ? '📷' : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="small">まだ登録がありません。「＋ 場所を追加」で地図に置いてください</td></tr>'}
    </tbody></table></div>
    <div class="btnRow"><button class="ghost" id="blCsv">CSV</button><button class="primary" id="blClose">閉じる</button></div>
  `);
  $('#blClose').onclick = closeSheet;
  $('#blAll').onclick = () => { S.boardListOnlyOpen = false; showBoardList(); };
  $('#blOpen').onclick = () => { S.boardListOnlyOpen = true; showBoardList(); };
  $('#blCsv').onclick = () => {
    const head = ['種類', '番号', '場所', '状態', '貼った人', '日付', '緯度', '経度', 'メモ'];
    const data = rows.map(b => [BOARD_KIND[b.kind || 'official'].short, b.no, b.place, BOARD_ST_LABEL(b.status), b.posted_by || '', b.posted_at || '', b.lat, b.lng, b.memo || '']);
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
  $('#legendBtn').hidden = S.boardsOn || S.spotBarOn || S.assignBarOn; if (S.spotBarOn) setLegend(false);
  if (!S.spotBarOn) setSpotAdding(false);
  if (S.spotBarOn && S.assignBarOn) toggleAssignBar(false);
  renderSpots(); renderStations();
}
function setSpotAdding(on) {
  S.spotAdding = on; if (on) S.boardAdding = false;
  $('#spotAddHint').hidden = !on;
  setAddingUI(on);
}
function renderSpots() {
  ensureLabelClass();
  for (const m of S.spotMarkers.values()) m.setMap(null);
  S.spotMarkers.clear();
  for (const l of S.spotLabels) l.setMap(null); S.spotLabels = [];
  const showLabels = S.map.getZoom() >= 13;
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
    if (showLabels) {
      const evs = spotEvents(sp.id); const done = history(evs).length;
      const line2 = next ? `次 <b>${fmtDate(next.date)}</b>${next.time ? ' ' + esc(next.time) : ''}${next.member ? ' ' + esc(next.member) : ''}` : (done ? `予定なし ／ 実施${done}回` : '予定なし');
      const lb = new RecLabel({ lat: sp.lat, lng: sp.lng }, `${k.emoji} <b>${esc(sp.name)}</b><br>${line2}`, k.color, { dy: -48, cls: 'recLabel spotLabel' });
      lb.setMap(S.map); S.spotLabels.push(lb);
      if (next) { const inTen = (new Date(next.date) - new Date(today())) / 86400000; if (inTen >= 0 && inTen <= 7) weatherFor(sp.lat, sp.lng, next.date, next.time).then(w => { if (w && lb.div) lb.div.insertAdjacentHTML('beforeend', `<br><span class="wx">${esc(w.icon)} 降水${w.pop}%</span>`); }); }
    }
  }
}
function addSpotAt(latLng) {
  setSpotAdding(false);
  startPinPlace(latLng, pos => addSpotForm(pos), '辻立ちする場所・事務所にピンを合わせて「ここに決定」');
}
function addSpotForm(latLng) {
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
      <div class="btnRow"><button class="ghost" id="spMove">📍 位置を直す</button>${isAdmin() ? '<button class="ghost" id="spDel" style="color:var(--danger)">この場所を削除</button>' : ''}<button class="ghost" id="spEditSave">名前・種類を保存</button></div>
    </details>
    <div class="btnRow"><button class="primary" id="spClose">閉じる</button></div>
  `);
  $('#spClose').onclick = closeSheet;
  decorateWeather(sp);
  $('#spMove').onclick = () => startPinPlace(new google.maps.LatLng(sp.lat, sp.lng), async pos => { const nsp = { ...sp, lat: +pos.lat().toFixed(6), lng: +pos.lng().toFixed(6) }; try { await store.saveSpot(nsp); } catch { return; } S.spots = await store.loadSpots(); renderSpots(); toast('位置を直しました'); showSpot(S.spots.find(x => x.id === sp.id) || nsp); }, `「${sp.name}」のピンをドラッグして「ここに決定」`);
  $('#spPlan').onclick = () => openEventForm(sp, { done: false });
  $('#spDidNow').onclick = () => openEventForm(sp, { done: true, date: today() });
  $('#spEditSave').onclick = async () => {
    const nsp = { ...sp, kind: $('#spKind').value, name: $('#spName').value.trim() || sp.name, memo: $('#spMemo').value.trim() };
    try { await store.saveSpot(nsp); } catch { return; }
    S.spots = await store.loadSpots(); renderSpots(); showSpot(S.spots.find(x => x.id === sp.id) || nsp); toast('保存しました');
  };
  if ($('#spDel')) $('#spDel').onclick = async () => { if (!confirm(`「${sp.name}」を削除しますか？（予定・実績も見えなくなります）`)) return; try { await store.deleteSpot(sp.id); } catch { return; } S.spots = await store.loadSpots(); closeSheet(); renderSpots(); toast('削除しました'); };
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
  const evId = ev.id || uid();
  $('#evSave').onclick = async () => {
    $('#evSave').disabled = true;
    const e = { id: evId, spot_id: sp.id, date: $('#evDate').value || today(), time: $('#evTime').value.trim(), member: $('#evMember').value, memo: $('#evMemo').value.trim(), done: isDone };
    try { await store.saveEvent(e); } catch { $('#evSave').disabled = false; return; }
    S.events = await store.loadEvents(); renderSpots(); showSpot(sp); toast('保存しました');
  };
}
function showSpotList() {
  const name = id => S.spots.find(s => s.id === id)?.name || '(削除済み)';
  const up = upcoming(S.events), hist = history(S.events);
  const row = e => `<tr data-spot="${e.spot_id}" data-ev="${e.id}"><td>${fmtDate(e.date)}</td><td>${esc(e.time)}</td><td>${esc(name(e.spot_id))}</td><td>${esc(e.member || '')}</td><td>${esc(e.memo || '')}</td></tr>`;
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
  (async () => { for (const tr of [...$('#sheetBody').querySelectorAll('tr[data-ev]')]) { const e = S.events.find(x => x.id === tr.dataset.ev); const sp = e && S.spots.find(x => x.id === e.spot_id); if (!sp) continue; const inTen = (new Date(e.date) - new Date(today())) / 86400000; if (inTen < 0 || inTen > 7) continue; const w = await weatherFor(sp.lat, sp.lng, e.date, e.time); if (w) tr.querySelector('td:last-child').insertAdjacentHTML('beforeend', ` <span class="wx">${esc(w.text)}</span>`); } })();
}

/* ---------------- Googleマップ連携（ストリートビュー・経路） ---------------- */
const svUrl = (lat, lng) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
const gmUrl = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
const extLinks = (lat, lng) => `<div class="btnRow"><a class="ghost linkBtn" target="_blank" rel="noopener" href="${gmUrl(lat, lng)}">🗺 Googleマップで開く（経路・写真）</a></div>`;

/* ---------------- 場所の検索（町名＝ローカル／施設・住所＝国土地理院＋Google） ---------------- */
function openSearch() { $('#searchBox').hidden = false; $('#searchResults').innerHTML = ''; setTimeout(() => $('#searchInp').focus(), 50); }
function closeSearch() { $('#searchBox').hidden = true; $('#searchInp').blur(); }
async function runSearch() {
  const q = $('#searchInp').value.trim(); if (!q) return;
  const box = $('#searchResults'); box.innerHTML = '<div class="small" style="padding:8px">検索中…</div>';
  const items = [];
  // 1) 町丁目（ローカル）。完全一致がなければ「宇治団地」→「宇治」のように語尾を落として近い町名を出す
  const qn = q.replace(/\s+/g, '');
  const townHit = (needle, note) => {
    let c = 0;
    for (const t of S.towns) {
      if (t.kigo && t.kigo !== 'E1') continue;
      if ((t.city + t.name).includes(needle) || t.name.includes(needle)) {
        if (items.some(it => it.name === `${t.city} ${t.name}`)) continue;
        items.push({ ico: '🏘', name: `${t.city} ${t.name}`, sub: `町丁目 ／ ${t.setai.toLocaleString()}世帯${note ? ' ／ ' + note : ''}`, lat: t.feature.properties.Y_CODE, lng: t.feature.properties.X_CODE, zoom: 16 });
        if (++c >= 8) break;
      }
    }
    return c;
  };
  if (!townHit(qn)) {
    const stem = qn.replace(/(町内会|自治会|団地|公民館|集会所|コミュニティセンター|センター|公園|小学校|中学校|高校|保育園|幼稚園|神社|寺|駅|前|付近|周辺|あたり|辺り|の)+$/u, '');
    if (stem && stem !== qn && stem.length >= 2) townHit(stem, `「${qn}」に近い町名`);
    else if (qn.length >= 3) townHit(qn.slice(0, 2), `「${qn}」に近い町名`);
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
  // 3) 国土地理院の住所・施設検索（無料・キー不要）。県内を優先し、なければ市町村名を付けて再検索
  const inAichi = (lat, lng) => lat > 34.5 && lat < 35.5 && lng > 136.5 && lng < 138.0;
  const gsi = async text => { try { return await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(text)).then(r => r.json()); } catch { return []; } };
  const near = [], far = [];
  const addGsi = (d, note) => {
    for (const f of d || []) {
      const [lng, lat] = f.geometry.coordinates; const title = f.properties.title || '';
      if ([...near, ...far, ...items].some(it => Math.abs(it.lat - lat) < 0.0003 && Math.abs(it.lng - lng) < 0.0003)) continue;
      const sub = (/小学校|中学校|高校|公民館|駅|病院|役場|市役所|センター|公園|神社|寺/.test(title) ? '施設' : '住所・地名') + (note ? ' ／ ' + note : '');
      (inAichi(lat, lng) ? near : far).push({ ico: '📍', name: title, sub, lat, lng, zoom: 17 });
    }
  };
  addGsi(await gsi(q));
  if (!near.length) {
    const cities = (S.settings.cities || DEFAULT_CITIES).map(c => c.split('_')[1]).filter(Boolean);
    for (const city of cities) {
      const d = (await gsi(`${city} ${q}`)).filter(f => { const t = f.properties.title || ''; return !t.endsWith(city) && !/^愛知県(海部郡)?[^市町村]*[市町村]$/.test(t); }); // 市町村そのものは除外
      addGsi(d, `${city}で検索`); if (near.length) break;
    }
  }
  items.push(...near.slice(0, 6));
  if (!near.length && !items.length) items.push(...far.slice(0, 3).map(it => ({ ...it, sub: it.sub + '（県外）' })));
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
  $('#ssSpot').onclick = () => { toggleSpotBar(true); if (S.searchMarker) { S.searchMarker.setMap(null); S.searchMarker = null; } addSpotForm(new google.maps.LatLng(it.lat, it.lng)); setTimeout(() => { const n = $('#spName'); if (n && !n.value) n.value = it.name; }, 50); };
  $('#ssBoard').onclick = () => { toggleBoards(true); if (S.searchMarker) { S.searchMarker.setMap(null); S.searchMarker = null; } addBoardForm(new google.maps.LatLng(it.lat, it.lng)); setTimeout(() => { const n = $('#bPlace'); if (n && !n.value) n.value = it.name; }, 50); };
}

/* ---------------- 配布の割り当て（予定エリア） ---------------- */
function toggleAssignBar(on) {
  S.assignBarOn = on ?? !S.assignBarOn;
  if (S.assignBarOn) { if (S.boardsOn) toggleBoards(false); if (S.spotBarOn) toggleSpotBar(false); }
  $('#assignBar').hidden = !S.assignBarOn;
  $('#legendBtn').hidden = S.boardsOn || S.spotBarOn || S.assignBarOn; if (S.assignBarOn) setLegend(false);
  renderAssignments(); renderSpots();
}
function renderAssignments() {
  ensureLabelClass();
  for (const p of S.asgPolys.values()) p.setMap(null); S.asgPolys.clear();
  for (const l of S.asgLabels) l.setMap(null); S.asgLabels = [];
  const open = S.assignments.filter(a => a.status !== 'done');
  const mine = open.filter(a => a.member === S.user).length;
  $('#assignStat').textContent = `割り当て 未完了 ${open.length}件（自分 ${mine}）`;
  const showLabels = S.map.getZoom() >= 14;
  for (const a of open) {
    const isMine = a.member === S.user;
    const col = isMine ? '#ffd60a' : '#cbd5e1';
    const poly = new google.maps.Polygon({ paths: a.polygon.map(([lng, lat]) => ({ lat, lng })), strokeColor: col, strokeOpacity: 1, strokeWeight: 3, fillColor: col, fillOpacity: isMine ? 0.18 : 0.08, map: S.map, zIndex: 1, icons: undefined });
    poly.addListener('click', ev => { if (!S.drawing && !S.pin) showAssignment(a); });
    S.asgPolys.set(a.id, poly);
    if (showLabels) {
      const c = turf.centerOfMass(turf.polygon([a.polygon])).geometry.coordinates;
      const f = a.flyer_id ? flyerOf(a.flyer_id) : null;
      const html = `📋 <b>${esc(a.member || '担当未定')}</b>${a.due ? ` 〜${fmtDate(a.due)}` : ''}<br>${f ? esc(f.name) : 'チラシ未定'}${a.est_setai ? ` 約${a.est_setai}世帯` : ''}`;
      const lb = new RecLabel({ lat: c[1], lng: c[0] }, html, col); lb.setMap(S.map); lb.getDivClass = 'asgLabel';
      S.asgLabels.push(lb);
      setTimeout(() => { if (lb.div) { lb.div.className = 'asgLabel' + (isMine ? '' : ' other'); lb.div.style.borderColor = ''; } }, 0);
    }
  }
}
function startAssignDraw() {
  if ($('#fab').disabled) { toast('告示日を過ぎているため作成できません'); return; }
  S.drawPurpose = 'assign'; startDrawing();
  setTimeout(() => { const h = $('#drawHint'); if (h && S.drawing) h.textContent = '割り当てる範囲を囲んでください（' + h.textContent + '）'; }, 0);
}
function openAssignForm(a) {
  const isNew = !a.id;
  const poly = turf.polygon([a.polygon]); const est = estimateRecord(poly);
  openSheet(`
    <h3>${isNew ? '配布の割り当てを作る' : '割り当てを編集'}</h3>
    <div class="small">推定 <b>${est.setai}</b> 世帯 ／ ${esc(est.town)}</div>
    <label>担当者<select id="aMember"><option value="">（未定・誰でも）</option>${S.settings.members.map(m => `<option ${a.member === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
    <label>配るチラシ<select id="aFlyer"><option value="">（未定）</option>${S.settings.flyers.map(f => `<option value="${f.id}" ${a.flyer_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
    <label>期限（任意）<input id="aDue" type="date" value="${esc(a.due || '')}"></label>
    <label>メモ（任意）<input id="aNote" type="text" value="${esc(a.note || '')}" placeholder="例：団地は管理人に一声かけてから"></label>
    <div class="btnRow"><button class="ghost" id="aCancel">やめる</button><button class="primary" id="aSave">保存する</button></div>
  `);
  $('#aCancel').onclick = closeSheet;
  $('#aSave').onclick = async () => {
    const na = { ...a, id: a.id || uid(), member: $('#aMember').value || null, flyer_id: $('#aFlyer').value || null, due: $('#aDue').value || null, note: $('#aNote').value.trim(), status: a.status || 'planned', est_setai: est.setai, town: est.town, created_by: a.created_by || S.user };
    $('#aSave').disabled = true;
    try { await store.saveAssignment(na); } catch { $('#aSave').disabled = false; return; }
    S.assignments = await store.loadAssignments(); closeSheet(); renderAssignments(); toast('割り当てを保存しました');
  };
}
function showAssignment(a) {
  const f = a.flyer_id ? flyerOf(a.flyer_id) : null;
  openSheet(`
    <h3>📋 ${esc(a.member || '担当未定')}${a.due ? `　〜${esc(a.due)}` : ''}</h3>
    <dl class="kv">
      <dt>チラシ</dt><dd>${f ? esc(f.name) : '未定'}</dd>
      <dt>推定世帯</dt><dd>${(a.est_setai ?? 0).toLocaleString()} 世帯（${esc(a.town || '')}）</dd>
      ${a.note ? `<dt>メモ</dt><dd>${esc(a.note)}</dd>` : ''}
      <dt>作成</dt><dd>${esc(a.created_by || '')}</dd>
    </dl>
    <div class="btnRow"><button class="primary" id="asRecord">✅ この範囲で配布を記録する</button></div>
    <div class="btnRow"><button class="ghost" id="asDone">記録せず完了にする</button>${isAdmin() ? '<button class="ghost" id="asEdit">編集</button><button class="ghost" id="asDel" style="color:var(--danger)">削除</button>' : ''}<button class="ghost" id="asClose">閉じる</button></div>
  `);
  $('#asClose').onclick = closeSheet;
  if ($('#asEdit')) $('#asEdit').onclick = () => openAssignForm(a);
  $('#asRecord').onclick = () => { if ($('#fab').disabled) { toast('告示日を過ぎているため登録できません'); return; } openRecordForm({ polygon: a.polygon, flyer_id: a.flyer_id || undefined, member: a.member || S.user, from_assignment: a.id }); };
  $('#asDone').onclick = async () => { try { await store.saveAssignment({ ...a, status: 'done' }); } catch { return; } S.assignments = await store.loadAssignments(); closeSheet(); renderAssignments(); toast('完了にしました'); };
  if ($('#asDel')) $('#asDel').onclick = async () => { if (!confirm('この割り当てを削除しますか？')) return; try { await store.deleteAssignment(a.id); } catch { return; } S.assignments = await store.loadAssignments(); closeSheet(); renderAssignments(); toast('削除しました'); };
}
function showAssignList() {
  const rows = [...S.assignments].sort((x, y) => (x.status === 'done') - (y.status === 'done') || String(x.due || '9999').localeCompare(String(y.due || '9999')));
  openSheet(`
    <h3>配布の割り当て一覧</h3>
    <div class="small">未完了 ${rows.filter(a => a.status !== 'done').length} ／ 完了 ${rows.filter(a => a.status === 'done').length}</div>
    <div class="tableWrap"><table><thead><tr><th>状態</th><th>担当</th><th>期限</th><th>チラシ</th><th>主な町丁目</th><th>世帯</th></tr></thead><tbody>
    ${rows.map(a => `<tr data-id="${a.id}"><td>${a.status === 'done' ? '✅' : '⬜'}</td><td>${esc(a.member || '未定')}</td><td>${a.due ? fmtDate(a.due) : ''}</td><td>${a.flyer_id ? esc(flyerOf(a.flyer_id).name) : ''}</td><td>${esc(a.town || '')}</td><td>${a.est_setai ?? ''}</td></tr>`).join('') || '<tr><td colspan="6" class="small">まだありません。「＋ 割り当てを作る」で範囲を囲んでください</td></tr>'}
    </tbody></table></div>
    <div class="btnRow"><button class="primary" id="alClose">閉じる</button></div>
  `);
  $('#alClose').onclick = closeSheet;
  $('#sheetBody').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { const a = S.assignments.find(x => x.id === tr.dataset.id); if (!a) return; const c = turf.centerOfMass(turf.polygon([a.polygon])).geometry.coordinates; S.map.panTo({ lat: c[1], lng: c[0] }); showAssignment(a); });
}

/* ---------------- 駅レイヤー（愛知9区の鉄道駅） ---------------- */
function renderStations() {
  for (const m of S.stationMarkers) m.setMap(null); S.stationMarkers = [];
  if (!S.spotBarOn || !S.stationsOn || !S.stations.length) return;
  for (const st of S.stations) {
    // 既に拠点として登録済みの駅（150m以内・名前一致）は出さない
    if (S.spots.some(sp => sp.name.includes(st.name) && Math.hypot((sp.lat - st.lat) * 111000, (sp.lng - st.lng) * 91000) < 150)) continue;
    const m = new google.maps.Marker({ position: { lat: st.lat, lng: st.lng }, map: S.map, zIndex: 25,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 12, fillColor: '#fff', fillOpacity: 0.95, strokeColor: '#1d4ed8', strokeWeight: 2 }, label: { text: '🚉', fontSize: '14px' }, title: `${st.name}駅（${st.city}）` });
    m.addListener('click', () => { if (S.spotAdding || S.pin) return; openSheet(`
      <h3>🚉 ${esc(st.name)}駅</h3><div class="small">${esc(st.city)}${st.operator ? ' ／ ' + esc(st.operator) : ''}</div>
      <div class="btnRow"><button class="primary" id="stAdd">🎤 ここを辻立ち拠点に登録</button><button class="ghost" id="stClose">閉じる</button></div>`);
      $('#stClose').onclick = closeSheet;
      $('#stAdd').onclick = () => { addSpotForm(new google.maps.LatLng(st.lat, st.lng)); setTimeout(() => { const n = $('#spName'); if (n) n.value = `${st.name}駅`; }, 30); };
    });
    S.stationMarkers.push(m);
  }
}

/* ---------------- LINE用まとめ（コピー） ---------------- */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('コピーしました。LINEに貼り付けてください'); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('コピーしました'); } catch { prompt('長押しでコピーしてください', text); } ta.remove(); }
}
function summaryText(recs) {
  const per = S.filter.period; const label = per === 'all' ? '全期間' : `直近${per}日`;
  const tot = flyerTotals();
  const byF = {}; for (const r of recs) byF[r.flyer_id] = (byF[r.flyer_id] || 0) + r.count;
  const lines = [`【配布まとめ】${today().slice(5).replace('-', '/')} 時点（${label}）`];
  for (const [k, v] of Object.entries(byF)) { const t = tot.find(x => x.id === k); lines.push(`・${flyerOf(k).name}：${v.toLocaleString()}枚${t?.total ? `（残り ${t.remain.toLocaleString()}／${t.total.toLocaleString()}）` : ''}`); }
  lines.push('――');
  const sorted = [...recs].sort((a, b) => a.date.localeCompare(b.date));
  for (const r of sorted) lines.push(`${fmtDate(r.date)} ${r.member}　${flyerOf(r.flyer_id).name} ${r.count.toLocaleString()}枚　${r.town || ''}${r.memo ? '（' + r.memo + '）' : ''}`);
  return lines.join('\n');
}

/* ---------------- 掲示場一覧の貼り付け取り込み ---------------- */
function openBoardImport() {
  const cities = (S.settings.cities || DEFAULT_CITIES).map(c => c.split('_')[1]).filter(Boolean);
  openSheet(`
    <h3>掲示場一覧を貼り付けて取り込む</h3>
    <div class="small">選管の一覧（PDFやExcel）から、1行に「番号　住所や目標物」の形でコピーして貼り付けてください。住所から地図の位置を自動で探します（国土地理院の無料検索）。</div>
    <label>種類<select id="imKind"><option value="official">選挙用ポスター掲示場</option><option value="general">一般ポスター</option></select></label>
    <label>市町村（住所の頭に付けて検索します）<select id="imCity">${cities.map(c => `<option>${esc(c)}</option>`).join('')}</select></label>
    <label>一覧（1行1か所）<textarea id="imText" rows="6" placeholder="1　宇治町字○○123　宇治町公民館前&#10;2　青塚町五丁目45　青塚公園南側"></textarea></label>
    <div class="btnRow"><button class="ghost" id="imCancel">やめる</button><button class="primary" id="imRun">位置を探す</button></div>
    <div id="imResult"></div>
  `);
  $('#imCancel').onclick = closeSheet;
  $('#imRun').onclick = async () => {
    const city = $('#imCity').value, kind = $('#imKind').value;
    const lines = $('#imText').value.split(/\n+/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) { toast('一覧を貼り付けてください'); return; }
    $('#imRun').disabled = true;
    const res = []; const box = $('#imResult');
    const inAichi = (lat, lng) => lat > 34.5 && lat < 35.5 && lng > 136.5 && lng < 138.0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\d+)[\s.．:：、,)）-]*(.*)$/); const no = m ? m[1] : String(i + 1); const text = (m ? m[2] : lines[i]).trim();
      box.innerHTML = `<div class="small">探しています… ${i + 1} / ${lines.length}</div>`;
      let hit = null;
      for (const q of [`${city} ${text}`, `${city} ${text.split(/\s+/)[0]}`, text]) {
        try { const d = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q)).then(r => r.json()); hit = (d || []).find(f => inAichi(f.geometry.coordinates[1], f.geometry.coordinates[0]) && !/^愛知県(海部郡)?[^市町村]{1,6}[市町村]$/.test(f.properties.title || '')); } catch { }
        if (hit) break;
      }
      res.push({ no, text, hit: hit ? { lat: hit.geometry.coordinates[1], lng: hit.geometry.coordinates[0], title: hit.properties.title } : null });
      await new Promise(r => setTimeout(r, 250));
    }
    const ok = res.filter(r => r.hit).length;
    box.innerHTML = `<div class="small" style="margin:8px 0">${ok} / ${res.length} 件の位置が見つかりました。見つからなかった行は「＋ 場所を追加」で手で置いてください。</div>
      ${res.map(r => `<div class="impRow"><b>${esc(r.no)}</b><span>${esc(r.text)}<br><span class="small">${r.hit ? '→ ' + esc(r.hit.title) : '位置が見つかりません'}</span></span><span class="${r.hit ? 'ok' : 'ng'}">${r.hit ? '✓' : '✗'}</span></div>`).join('')}
      <div class="btnRow"><button class="ghost" id="imCopyNg">見つからない行をコピー</button><button class="primary" id="imSave" ${ok ? '' : 'disabled'}>${ok}件を取り込む</button></div>`;
    $('#imCopyNg').onclick = () => copyText(res.filter(r => !r.hit).map(r => `${r.no}\t${r.text}`).join('\n') || '（すべて見つかりました）');
    $('#imSave').onclick = async () => {
      $('#imSave').disabled = true;
      try { for (const r of res) if (r.hit) await store.saveBoard({ id: uid(), kind, no: r.no, place: r.text, lat: +r.hit.lat.toFixed(6), lng: +r.hit.lng.toFixed(6), status: 'todo', memo: '一覧から取り込み（位置は要確認）' }); } catch { return; }
      S.boards = await store.loadBoards(); closeSheet(); renderBoards(); toast(`${ok}件を取り込みました。ピンの位置がずれていれば「位置を直す」で調整してください`, 4000);
    };
  };
}

/* ---------------- 天気（Google Weather API・有効時のみ） ---------------- */
const _wx = { cache: new Map(), denied: false };
// 指定地点の今後10日分の時間別予報を取得してキャッシュ（1地点1時間）
async function weatherHours(lat, lng) {
  if (_wx.denied || !CFG.GOOGLE_MAPS_API_KEY) return null;
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const c = _wx.cache.get(key); if (c && Date.now() - c.t < 3600000) return c.hours;
  try {
    let hours = [], token = null, guard = 0;
    do {
      const u = new URL('https://weather.googleapis.com/v1/forecast/hours:lookup');
      u.searchParams.set('key', CFG.GOOGLE_MAPS_API_KEY); u.searchParams.set('location.latitude', lat); u.searchParams.set('location.longitude', lng);
      u.searchParams.set('hours', '240'); u.searchParams.set('pageSize', '240'); u.searchParams.set('languageCode', 'ja'); if (token) u.searchParams.set('pageToken', token);
      const r = await fetch(u); if (!r.ok) { if (r.status === 403 || r.status === 400) _wx.denied = true; return null; }
      const j = await r.json(); hours = hours.concat(j.forecastHours || []); token = j.nextPageToken || null;
    } while (token && ++guard < 3);
    _wx.cache.set(key, { t: Date.now(), hours }); return hours;
  } catch { return null; }
}
// 気象庁：愛知県（230000）の府県予報＋週間予報（キー不要・CORS可）。西部＝尾張（蟹江・津島・稲沢を含む）
async function jmaForecast() {
  if (_wx.jma && Date.now() - _wx.jma.t < 1800000) return _wx.jma.data;
  try { const d = await fetch('https://www.jma.go.jp/bosai/forecast/data/forecast/230000.json').then(r => r.json()); _wx.jma = { t: Date.now(), data: d }; return d; } catch { return null; }
}
const JMA_ICON = code => { const c = String(code || ''); return c.startsWith('1') ? '☀️' : c.startsWith('2') ? '☁️' : c.startsWith('3') ? '☔' : c.startsWith('4') ? '❄️' : '🌤'; };
async function weatherForJma(date, timeText) {
  const j = await jmaForecast(); if (!j) return null;
  const m = String(timeText || '').match(/(\d{1,2})(?::(\d{2}))?/); const startH = m ? +m[1] : 9;
  const m2 = String(timeText || '').match(/[〜~\-ー](\d{1,2})/); const endH = m2 ? Math.max(startH + 1, +m2[1]) : startH + 1;
  const day = j[0]; const west = ts => ts.areas.find(a => a.area.name === '西部') || ts.areas[0];
  // 短期（今日〜明後日）：6時間ごとの降水確率
  const popTs = day.timeSeries.find(ts => west(ts).pops);
  if (popTs) {
    const a = west(popTs); const pops = [];
    popTs.timeDefines.forEach((t, i) => { const d = new Date(t); const dd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; const h0 = d.getHours(), h1 = h0 + 6; if (dd === date && h0 < endH && h1 > startH && a.pops[i] !== '') pops.push(+a.pops[i]); });
    if (pops.length) {
      const wTs = day.timeSeries.find(ts => west(ts).weathers); let desc = '', code = '';
      if (wTs) { const idx = wTs.timeDefines.findIndex(t => t.slice(0, 10) === date); if (idx >= 0) { desc = (west(wTs).weathers[idx] || '').replace(/\s+/g, '').split(/所により|時々|のち|後|を伴う/)[0].slice(0, 6); code = west(wTs).weatherCodes[idx]; } }
      const pop = Math.max(...pops); const icon = pop >= 50 ? '☔' : pop >= 30 ? '🌂' : JMA_ICON(code);
      return { pop, desc, icon, text: `${icon} 降水${pop}%${desc ? ' ' + desc : ''}（気象庁）` };
    }
  }
  // 週間（7日先まで）：日ごとの降水確率
  const wk = j[1]; if (!wk) return null;
  const wts = wk.timeSeries[0]; const idx = wts.timeDefines.findIndex(t => t.slice(0, 10) === date);
  if (idx < 0) return null;
  const a = wts.areas[0]; const pop = a.pops[idx] === '' ? null : +a.pops[idx]; const code = a.weatherCodes?.[idx];
  if (pop == null) return null;
  const icon = pop >= 50 ? '☔' : pop >= 30 ? '🌂' : JMA_ICON(code);
  return { pop, desc: '', icon, text: `${icon} 降水${pop}%（週間・気象庁）` };
}
// 日付＋時間帯（例 "7:00〜8:00"）に対応する予報を1行にまとめる。日本は気象庁を優先、なければGoogle
async function weatherFor(lat, lng, date, timeText) {
  const jm = await weatherForJma(date, timeText); if (jm) return jm;
  const hours = await weatherHours(lat, lng); if (!hours || !hours.length) return null;
  const m = String(timeText || '').match(/(\d{1,2})(?::(\d{2}))?/); const startH = m ? +m[1] : 9;
  const m2 = String(timeText || '').match(/[〜~\-ー](\d{1,2})/); const endH = m2 ? Math.max(startH + 1, +m2[1]) : startH + 1;
  const pick = hours.filter(h => { const t = new Date(h.interval.startTime); const d = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; return d === date && t.getHours() >= startH && t.getHours() < endH; });
  if (!pick.length) return null;
  const pop = Math.max(...pick.map(h => h.precipitation?.probability?.percent ?? 0));
  const temp = Math.round(pick[0].temperature?.degrees ?? NaN);
  const desc = pick[0].weatherCondition?.description?.text || '';
  const icon = pop >= 50 ? '☔' : pop >= 30 ? '🌂' : /晴/.test(desc) ? '☀️' : /曇/.test(desc) ? '☁️' : '🌤';
  return { pop, temp, desc, icon, text: `${icon} 降水${pop}%${isFinite(temp) ? ` ${temp}℃` : ''}${desc ? ' ' + desc : ''}` };
}
// 予定行に天気を後から差し込む
async function decorateWeather(sp) {
  const rows = [...document.querySelectorAll('.evRow[data-id]')];
  for (const row of rows) {
    const e = S.events.find(x => x.id === row.dataset.id); if (!e || e.done) continue;
    const inTen = (new Date(e.date) - new Date(today())) / 86400000; if (inTen < 0 || inTen > 7) continue;
    const w = await weatherFor(sp.lat, sp.lng, e.date, e.time); if (!w) continue;
    const tag = document.createElement('span'); tag.className = 'wx'; tag.textContent = w.text; row.querySelector('.d')?.after(tag);
  }
}

/* ---------------- してはいけないことカード（公職選挙法） ---------------- */
const RULES_VERSION = 1;
const RULES_HTML = `
  <h3>⚠ してはいけないこと（公職選挙法）</h3>
  <div class="small">ボランティアの善意が違反にならないための最低限です。迷ったら支部に確認。詳細は選挙管理委員会の案内が優先します。</div>
  <ol class="rules">
    <li><b>戸別訪問はいつでも禁止</b>。投票のお願いで家を一軒ずつ訪ねない。ポスティングは「投函するだけ」で、呼び鈴を鳴らして依頼しない</li>
    <li><b>告示前に「投票してください」と言わない・書かない</b>（事前運動）。政治活動のビラ・演説・SNSは政策や活動の紹介まで</li>
    <li><b>告示日以降のチラシのポスティングは禁止</b>。選挙運動用ビラ（証紙付き）は新聞折込・選挙事務所・演説会場・街頭演説の場所でのみ配れる。このアプリも告示日以降は配布記録をロックします</li>
    <li><b>ボランティアに報酬を払わない・受け取らない</b>。交通費などの実費を除き、お金や品物のやり取りは買収になりうる</li>
    <li><b>飲食物を出さない</b>（お茶・お菓子程度は可）。弁当は法律で決められた範囲だけ</li>
    <li><b>投票日当日は選挙運動をしない</b>。SNSの新規投稿・投票依頼のメッセージも当日は不可</li>
    <li><b>一般の人は選挙運動のメール・SMSを送れない</b>（候補者・政党のみ）。LINEやSNSでの拡散は告示後〜投票日前日まで可</li>
    <li><b>18歳未満は選挙運動ができない</b>。手伝ってもらうのは政治活動の範囲まで</li>
    <li><b>署名集めや人気投票をしない</b>。「〇〇さんを応援する署名」は禁止</li>
    <li><b>写真は掲示板とポスターだけ</b>。通行人の顔・表札・車のナンバーが写らないように</li>
    <li><b>迷ったら止まって聞く</b>。責任者の違反は候補者本人の当選無効につながる（連座制）</li>
  </ol>
  <div class="small">参考：総務省「選挙運動と政治活動」、各都道府県選管Q&amp;A。町議選の法定枚数（ビラ1,600枚・はがき800枚）などは選管資料で確認。</div>
`;
function showRules(first) {
  openSheet(RULES_HTML + `<div class="btnRow">${first ? '<button class="primary" id="rulesOk">確認しました</button>' : '<button class="primary" id="rulesOk">閉じる</button>'}</div>`);
  $('#rulesOk').onclick = () => { localStorage.setItem('cm_rules_ack', String(RULES_VERSION)); closeSheet(); };
}

/* ---------------- 権限（管理者／現場） ---------------- */
// 設定に admins（名前の配列）があれば、その人だけが管理者。空なら全員が管理者（初期状態）
const isAdmin = () => { const a = S.settings?.admins || []; return !a.length || a.includes(S.user); };
function applyRole() {
  const admin = isAdmin();
  document.querySelector('.menuItem[data-view=settings]').hidden = !admin;
  $('#btnAssignAdd').hidden = !admin;
  $('#btnBoardImport').hidden = !admin;
  $('#menuUser').textContent = `👤 ${S.user || ''}${admin && (S.settings?.admins || []).length ? '（管理者）' : ''}`;
}

/* ---------------- 学習・資料（参政党の理念・綱領・Q&A） ---------------- */
const STUDY = {
  core: [
    ['理念', ['日本の国益を守り、世界に大調和を生む']],
    ['綱領', ['一、先人の叡智を活かし、天皇を中心に一つにまとまる平和な国をつくる。', '一、日本国の自立と繁栄を追求し、人類の発展に寄与する。', '一、日本の精神と伝統を活かし、調和社会のモデルをつくる。']],
    ['参政党所属議員理念', ['私たちは、常に向上心を持って学び、国家国民のための仕事をする', '私たちは、いかなる利害にも左右されず、人として正しいことを貫く', '私たちは、大衆迎合せず、国民に正しい情報を提供し世論を喚起する', '私たちは、正しい知識とそれに基づく行動を議会で示す', '私たちは、参政党議員であることに誇りをもって、信頼される活動を続ける']],
    ['キャッチコピー', ['投票したい政党がないから、自分たちでゼロからつくる。']],
  ],
  pillars: [
    ['3つの重点政策', ['① 教育・人づくり — 国民の意識改革。学力（テストの点数）より学習力（自ら考え自ら学ぶ力）の高い日本人の育成', '② 食と健康・環境保全 — 化学的な物質に依存しない食と医療の実現と、それを支える循環型の環境の追求', '③ 国のまもり — 日本の舵取りに外国勢力が関与できない体制づくり']],
    ['国づくり10の柱', ['1 人とのきずなと生きがいを安心して追求できる〝社会づくり〟', '2 国民に健康と食の価値、元気な超高齢社会の〝安心できる生活づくり〟', '3 豊かさ上昇曲線の〝経済づくり〟（令和の所得倍増戦略を実現する）', '4 自らの幸福を自ら生み出せる〝人づくり〟', '5 人類社会の課題解決へ世界を先導し続ける〝科学技術づくり〟', '6 自らの国は自ら守る〝国防力と危機管理力づくり〟', '7 日本らしいリーダーシップで〝世界に大調和を生む外交づくり〟', '8 国民自らが選択し参加する〝納得の政治・行政づくり〟', '9 地球と調和的に共存する循環型の〝環境・エネルギー体系と国土づくり〟', '10 自由と文化と日本の国柄を守り育てる〝国家アイデンティティーづくり〟']],
  ],
  qa: [
    ['参政党ってどんな党？', '2020年4月に「投票したい政党がないから、自分たちでゼロからつくる」を合言葉に結党。2022年の参院選で国政政党に。活動も政策づくりも人材育成も自分たちでやる「DIY」が特徴で、地域の支部で意見を集め、仲間から議員を送り出す党です。'],
    ['一番やりたいことは？', '重点政策は3つ。①教育・人づくり（点数より「自ら考え学ぶ力」）、②食と健康・環境保全（化学物質に頼らない食と医療）、③国のまもり（外国勢力が日本の舵取りに関与できない体制）。'],
    ['消費税はどうするの？', '段階的に廃止し、国民負担率（税＋社会保険料）を35％以内に収める方針。あわせてインボイス制度は撤回し、小規模事業者・フリーランスの廃業を防ぐ、としています。'],
    ['外国人を排除する党なの？', '排除ではなく「ルールと上限」の主張です。外国人政策を一元化する「外国人総合政策庁」を設け、地域の受容力に基づく中長期の比率目標（市区町村単位で日本国民の5％まで）と受入要件の高度化を掲げています。'],
    ['教育は何を変える？', 'テストの点数（学力）より、自ら考え自ら学ぶ「学習力」を重視。いじめに悩まなくてよい学習環境づくりや、スマホの悪影響から子供を守ることも政策に含まれます。'],
    ['学校給食・食の安全は？', '安易な無償化より質の向上に公費を使う考え。地元食材（地産地消）と有機食材を推進し、遺伝子組み換え食品や不必要な食品添加物を避ける給食を目指します。町政で直接扱えるテーマです。'],
    ['憲法は「改憲」？', '「改憲」ではなく「創憲」。今の憲法は占領期に外国の草案に基づいて作られたとして、国民自らが歴史や文化に基づいて一から創り直す運動です。基本原則は「国の守りの強化」「国民の権利や自由の尊重」「日本の国柄の反映」。政府の行動制限につながる緊急事態条項には反対しています。'],
    ['若い人の政治参加は？', '選挙権を16歳に、被選挙権を18歳に引き下げ。突出して高い供託金は全廃し、一定数の署名収集に変える案です。'],
    ['なぜ町議選に出るの？', '参政党のDIYは「地域に支部を作り、仲間から議員を議会に送り出し、条例も自分たちで変えていく」ことが柱だからです。国政だけでなく、暮らしに一番近い町政から変える、という考えです。'],
    ['「大調和」って何？', '神武天皇の建国の理念から取った言葉で、「人類が一つの家族のように助け合って生きていく社会」。ただし世界がひとつになる意味ではなく、日本の自主独立を確保し、どの国とも対等に共存する考え方です。'],
  ],
  links: [
    ['参政党 公式サイト', 'https://sanseito.jp/'],
    ['参政党の政策 2026（具体政策・全7分野）', 'https://sanseito.jp/political_measures_2026/specific_policies/'],
  ],
};
function showStudy(tab = 'core') {
  const sec = (title, items) => `<h4 style="margin:14px 0 4px">${esc(title)}</h4><ul class="study">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
  let body = '';
  if (tab === 'core') body = STUDY.core.map(([t, i]) => sec(t, i)).join('');
  else if (tab === 'pillars') body = STUDY.pillars.map(([t, i]) => sec(t, i)).join('');
  else if (tab === 'qa') body = `<div class="small">辻立ちや配布中に聞かれやすい質問。答えは公式の政策・理念ページの要約です。</div>` + STUDY.qa.map(([q, a], i) => `<details class="qa"><summary><b>Q${i + 1}.</b> ${esc(q)}</summary><div>${esc(a)}</div></details>`).join('');
  else body = `<ul class="study">${STUDY.links.map(([t, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join('')}</ul><div class="small" style="margin-top:10px">このページの文章はすべて参政党の公式サイト（理念・綱領、政策2026）に基づいています。</div>`;
  openSheet(`
    <h3>📚 学習・資料</h3>
    <div class="stTabs stTabs6"><button data-t="core" class="${tab === 'core' ? 'on' : ''}">理念・綱領</button><button data-t="pillars" class="${tab === 'pillars' ? 'on' : ''}">重点政策・10の柱</button><button data-t="qa" class="${tab === 'qa' ? 'on' : ''}">Q&amp;A</button><button data-t="links" class="${tab === 'links' ? 'on' : ''}">公式リンク</button></div>
    ${body}
    <div class="btnRow"><button class="primary" id="stClose">閉じる</button></div>
  `);
  $('#stClose').onclick = closeSheet;
  $('#sheetBody').querySelectorAll('.stTabs button').forEach(b => b.onclick = () => showStudy(b.dataset.t));
}

/* ---------------- UI バインド ---------------- */
function bindUI() {
  $('#periodSel').value = S.filter.period;
  $('#periodSel').onchange = e => { S.filter.period = e.target.value; renderAll(); };
  $('#fab').onclick = startDrawing;
  $('#btnDrawCancel').onclick = () => { S.drawPurpose = 'record'; cancelDrawing(); };
  $('#btnDrawRedo').onclick = () => setDrawMode(S.drawing.mode);
  $('#btnDrawUndo').onclick = () => { const d = S.drawing; d.ll.pop(); redrawTap(); };
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
  $('#btnAssign').onclick = () => { $('#menu').hidden = true; toggleAssignBar(true); };
  $('#btnRules').onclick = () => { $('#menu').hidden = true; showRules(false); };
  $('#btnStudy').onclick = () => { $('#menu').hidden = true; showStudy('core'); };
  $('#btnAssignClose').onclick = () => toggleAssignBar(false);
  $('#btnAssignAdd').onclick = startAssignDraw;
  $('#btnAssignList').onclick = showAssignList;
  $('#btnStations').onclick = () => { S.stationsOn = !S.stationsOn; $('#btnStations').classList.toggle('on', S.stationsOn); renderStations(); };
  $('#btnBoardImport').onclick = openBoardImport;
  $('#btnPinCancel').onclick = () => endPinPlace(false);
  $('#btnPinOk').onclick = () => endPinPlace(true);
  $('#btnSwitchUser').onclick = () => { $('#menu').hidden = true; let saved = null; try { saved = JSON.parse(localStorage.getItem('cm_user') || 'null'); } catch { } localStorage.removeItem('cm_user'); showLogin(null, USE_SUPABASE && saved?.pass ? { verified: true, pass: saved.pass } : {}); };
  $('#sheetHandle').onclick = closeSheet;
  (() => {
    const sheet = $('#sheet'), body = $('#sheetBody'); let sy = null, sx = null, dragging = false, moved = 0;
    sheet.addEventListener('touchstart', e => { const t = e.touches[0]; sy = t.clientY; sx = t.clientX; moved = 0; dragging = (body.scrollTop <= 0); }, { passive: true });
    sheet.addEventListener('touchmove', e => {
      if (!dragging || sy == null) return; const t = e.touches[0]; const dy = t.clientY - sy, dx = Math.abs(t.clientX - sx);
      if (dy > 0 && dy > dx) { moved = dy; sheet.style.transform = `translateY(${Math.min(dy, 400)}px)`; sheet.style.transition = 'none'; if (e.cancelable) e.preventDefault(); }
    }, { passive: false });
    const end = () => { if (sy == null) return; sheet.style.transition = ''; if (moved > 90) closeSheet(); sheet.style.transform = ''; sy = null; moved = 0; dragging = false; };
    sheet.addEventListener('touchend', end); sheet.addEventListener('touchcancel', end);
  })();
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
