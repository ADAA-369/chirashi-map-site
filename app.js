/* チラシ配布マップ — MVP（端末内保存版） */
'use strict';

const CFG = window.CHIRASHI_CONFIG || {};
const DATA_BASE = location.pathname.includes('/app/') ? '../data/by_city/' : 'data/by_city/';
const DEFAULT_CITIES = ['23425_蟹江町', '23208_津島市', '23232_愛西市', '23237_あま市', '23235_弥富市', '23424_大治町', '23427_飛島村', '23220_稲沢市'];
// 読み込む市町村＝既定＋設定に保存された分（設定に古い一覧が残っていても、既定に足した市町村が消えないように和集合）
const activeCities = () => [...new Set([...DEFAULT_CITIES, ...((S.settings && Array.isArray(S.settings.cities)) ? S.settings.cities : [])])];
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
    try { return normalizeSettings(JSON.parse(localStorage.getItem(this.skey) || '{}')); } catch { return { ...DEFAULT_SETTINGS }; }
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
  async deletePhoto() { },
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
  client: null, _lastJson: '', _timer: null,
  // 個人アカウント（ID＋パスワード）。IDは架空メール id@m.chirashi.local として Supabase Auth に登録される
  EMAIL_DOMAIN: 'm.chirashi.local',
  init() {
    if (this.client) return;
    this.client = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
    this.client.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT' && S.me) { S.me = null; location.reload(); } });
  },
  emailOf(id) { return `${String(id).trim().toLowerCase()}@${this.EMAIL_DOMAIN}`; },
  // ログイン中の本人（members 表に有効な行がある人だけ）。無ければ null
  async whoami() {
    const { data: { session } } = await this.client.auth.getSession();
    if (!session) return null;
    const { data, error } = await this.client.rpc('me');
    if (error) { console.error(error); throw error; }
    return Array.isArray(data) && data[0] ? data[0] : null;
  },
  async signIn(id, pw) {
    const { error } = await this.client.auth.signInWithPassword({ email: this.emailOf(id), password: pw });
    if (error) { const m = /invalid/i.test(error.message) ? 'IDかパスワードが違います' : '通信できません（' + error.message + '）'; throw new Error(m); }
    const me = await this.whoami();
    if (!me) { await this.client.auth.signOut(); throw new Error('このIDは停止されています。管理者に確認してください'); }
    return me;
  },
  async signOut() { try { await this.client.auth.signOut(); } catch { } },
  async changePassword(pw) { const { error } = await this.client.auth.updateUser({ password: pw }); if (error) throw new Error(error.message); },
  // 管理者用：アカウント一覧・発行・変更
  async listMembers() { const { data, error } = await this.client.from('members').select('login_id,nickname,role,active,auth_uid,created_at').order('created_at'); if (error) throw error; return data; },
  async adminAddMember(id, nick, role) { const { error } = await this.client.rpc('admin_add_member', { p_login_id: id, p_nickname: nick, p_role: role || 'member' }); if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'そのIDは使われています' : error.message); },
  async adminSetMember(id, nick, role, active) { const { error } = await this.client.rpc('admin_set_member', { p_login_id: id, p_nickname: nick, p_role: role, p_active: active }); if (error) throw new Error(error.message); },
  async adminResetPassword(id, pw) { const { error } = await this.client.rpc('admin_reset_password', { p_login_id: id, p_password: pw }); if (error) throw new Error(error.message); },
  async adminDeleteMember(id) { const { error } = await this.client.rpc('admin_delete_member', { p_login_id: id }); if (error) throw new Error(error.message); },
  // アカウント本体の作成（members に行がある ID だけDB側の門番が通す）。管理者のログインを壊さないよう使い捨てクライアントで行う
  async createAuthUser(id, pw) {
    const tmp = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { error } = await tmp.auth.signUp({ email: this.emailOf(id), password: pw });
    if (error) throw new Error(/not allowed|Database error/i.test(error.message) ? 'このIDは発行できません（先にメンバー登録が必要か、すでに作成済みです）' : error.message);
  },
  rowToRec(r) { return { id: r.id, group_id: r.group_id || null, member: r.member, date: r.date, flyer_id: r.flyer_id, count: r.count, memo: r.memo || '', polygon: r.polygon, est_setai: r.est_setai, town: r.town, area_m2: r.area_m2, created_at: r.created_at, updated_at: r.updated_at }; },
  // ---- 送信待ち：電波がない時は端末に貯め、戻ったら自動で送る ----
  outbox() { try { return JSON.parse(localStorage.getItem('cm_outbox') || '[]'); } catch { return []; } },
  setOutbox(a) { localStorage.setItem('cm_outbox', JSON.stringify(a)); renderPending(); },
  enqueue(t, op, row) {
    const a = this.outbox().filter(x => !(x.t === t && x.op === op && x.row.id === row.id));
    a.push({ t, op, row, at: new Date().toISOString() }); this.setOutbox(a);
    toast('電波がないため「送信待ち」にしました。電波が戻ると自動で送ります', 4000);
  },
  async _write(t, op, row, fn) {
    if (!navigator.onLine) { this.enqueue(t, op, row); return; }
    let res; try { res = await fn(); } catch (e) { res = { error: e }; }
    const error = res && res.error; if (!error) return;
    if (isNetErr(error)) { this.enqueue(t, op, row); return; }
    console.error(error); toast(op === 'save' ? '保存に失敗しました（通信）' : '削除に失敗しました（通信）'); throw error;
  },
  // 読み込んだ一覧に、送信待ちの分を重ねる（自分の端末では保存済みに見える）
  overlay(t, list) {
    const q = this.outbox().filter(x => x.t === t); if (!q.length) return list;
    let out = [...list];
    for (const x of q) {
      if (x.op === 'del') { out = out.filter(y => y.id !== x.row.id); continue; }
      const row = t === 'record' ? this.rowToRec(x.row) : x.row; const i = out.findIndex(y => y.id === row.id);
      const v = { ...(i >= 0 ? out[i] : {}), ...row, _pending: true }; if (i >= 0) out[i] = v; else out.unshift(v);
    }
    return out;
  },
  async flushOutbox() {
    if (this._flushing || !navigator.onLine) return false;
    const q = this.outbox(); if (!q.length) return false;
    this._flushing = true; let sent = 0;
    try {
      for (const x of q) {
        const tbl = { record: 'records', board: 'boards', spot: 'spots', event: 'spot_events', assignment: 'assignments' }[x.t];
        let res; try { res = x.op === 'del' ? await this.client.from(tbl).update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', x.row.id) : await this.client.from(tbl).upsert(x.row); } catch (e) { res = { error: e }; }
        if (res.error && isNetErr(res.error)) break;
        if (res.error) { console.error('outbox drop', res.error); toast('送信待ちの1件が保存できませんでした（' + (res.error.message || '') + '）', 5000); }
        this.setOutbox(this.outbox().filter(y => !(y.t === x.t && y.op === x.op && y.row.id === x.row.id && y.at === x.at)));
        sent++;
      }
    } finally { this._flushing = false; }
    if (sent) { toast(`送信待ちの${sent}件を送りました`); this._stamp = null; }
    return sent > 0;
  },
  async loadRecords() {
    const { data, error } = await this.client.from('records').select('*').eq('deleted', false).order('date', { ascending: false });
    if (error) { console.error(error); if (!this._silent && !isNetErr(error)) toast('読み込みに失敗しました（通信）'); return this.overlay('record', S.records || []); }
    return this.overlay('record', data.map(r => this.rowToRec(r)));
  },
  async saveRecord(r) {
    const row = { id: r.id, group_id: r.group_id || null, member: r.member, date: r.date, flyer_id: r.flyer_id, count: r.count, memo: r.memo || '', polygon: r.polygon, est_setai: r.est_setai, town: r.town, area_m2: r.area_m2, updated_at: new Date().toISOString() };
    await this._write('record', 'save', row, () => this.client.from('records').upsert(row));
  },
  async deleteRecord(id) { await this._write('record', 'del', { id }, () => this.client.from('records').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id)); },
  async loadSettings() {
    const { data, error } = await this.client.from('settings').select('data').eq('id', 'main').maybeSingle();
    if (error) { console.error(error); throw error; }            // 既定値に化けさせない（全員の設定を消す事故の防止）
    if (!data) return { ...DEFAULT_SETTINGS };
    const d = data.data || {};
    if (d.flyers && !Array.isArray(d.flyers)) throw new Error('settings broken');
    if (d.members && !Array.isArray(d.members)) throw new Error('settings broken');
    return normalizeSettings(d);
  },
  async saveSettings(s) {
    const flyers = (s.flyers || []).filter(f => !f.orphan); const { members, noticeDate, cities, admins, termEndDate } = s;
    const { error } = await this.client.from('settings').upsert({ id: 'main', data: { flyers, members, noticeDate, cities, admins: admins || [], termEndDate: termEndDate || '' }, updated_at: new Date().toISOString() });
    if (error) { console.error(error); toast('設定の保存に失敗しました（通信）'); throw error; }
  },
  async addMember(name) {
    const { error } = await this.client.rpc('add_member', { p_name: name });
    if (error) { console.error(error); throw error; }
  },
  async loadBoards() {
    const { data, error } = await this.client.from('boards').select('*').eq('deleted', false).order('no');
    if (error) { console.error(error); return this.overlay('board', S.boards || []); }
    return this.overlay('board', data);
  },
  async saveBoard(b) {
    const row = { id: b.id, kind: b.kind || 'official', no: b.no || '', place: b.place || '', lat: b.lat, lng: b.lng, status: b.status || 'todo', posted_by: b.posted_by || null, posted_at: b.posted_at || null, photo_path: b.photo_path || null, memo: b.memo || '', updated_at: new Date().toISOString() };
    await this._write('board', 'save', row, () => this.client.from('boards').upsert(row));
  },
  async deleteBoard(id) { await this._write('board', 'del', { id }, () => this.client.from('boards').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id)); },
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
  async deletePhoto(path) { if (!path) return; try { await this.client.storage.from('posters').remove([path]); } catch (e) { console.warn('photo delete', e); } },
  async loadSpots() { const { data, error } = await this.client.from('spots').select('*').eq('deleted', false).order('name'); if (error) { console.error(error); return this.overlay('spot', S.spots || []); } return this.overlay('spot', data); },
  async saveSpot(x) { const row = { id: x.id, kind: x.kind || 'station', name: x.name || '', lat: x.lat, lng: x.lng, memo: x.memo || '', updated_at: new Date().toISOString() }; await this._write('spot', 'save', row, () => this.client.from('spots').upsert(row)); },
  async deleteSpot(id) { await this._write('spot', 'del', { id }, () => this.client.from('spots').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id)); },
  async loadAssignments() { const { data, error } = await this.client.from('assignments').select('*').eq('deleted', false).order('due', { ascending: true, nullsFirst: false }); if (error) { console.error(error); return this.overlay('assignment', S.assignments || []); } return this.overlay('assignment', data); },
  async saveAssignment(x) { const row = { id: x.id, member: x.member || null, flyer_id: x.flyer_id || null, polygon: x.polygon, due: x.due || null, note: x.note || '', status: x.status || 'planned', est_setai: x.est_setai ?? null, town: x.town || null, created_by: x.created_by || S.user || null, updated_at: new Date().toISOString() }; await this._write('assignment', 'save', row, () => this.client.from('assignments').upsert(row)); },
  async deleteAssignment(id) { await this._write('assignment', 'del', { id }, () => this.client.from('assignments').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id)); },
  async loadEvents() { const { data, error } = await this.client.from('spot_events').select('*').eq('deleted', false).order('date'); if (error) { console.error(error); return this.overlay('event', S.events || []); } return this.overlay('event', data); },
  async saveEvent(x) { const row = { id: x.id, spot_id: x.spot_id, date: x.date, time: x.time || '', member: x.member || null, memo: x.memo || '', done: !!x.done, attendees: Array.isArray(x.attendees) ? x.attendees : [], updated_at: new Date().toISOString() }; await this._write('event', 'save', row, () => this.client.from('spot_events').upsert(row)); },
  async deleteEvent(id) { await this._write('event', 'del', { id }, () => this.client.from('spot_events').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', id)); },
  // 15秒ごと＋画面復帰時：まず軽い「更新スタンプ」だけ取り、変わった時だけ全件取得（通信量を1/100以下に）
  subscribe(cb) {
    const tick = async () => {
      if (document.hidden || S.drawing || S.adjust || S.pin || this._busy) return;
      this._busy = true; this._silent = true;
      let payload = null;
      try {
        await this.flushOutbox();   // 送信待ちがあれば先に送る（送れたらスタンプが変わり全件取り直す）
        const { data: stamp, error } = await this.client.rpc('sync_stamp');
        if (error || stamp === this._stamp) return;
        const all = await Promise.all([this.loadRecords(), this.loadSettings(), this.loadBoards(), this.loadSpots(), this.loadEvents(), this.loadAssignments()]);
        this._stamp = stamp; payload = all;
      } catch { } finally { this._busy = false; this._silent = false; }
      if (payload) { try { cb(...payload); } catch (e) { console.error(e); toast('画面の更新でエラーが出ました（データは保存されています）', 4000); } }
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
  oaza: [], oazaLayer: null, oazaLabels: [],   // 地名（丁目なし）の枠とラベル
  me: null,              // ログイン中の本人 {login_id, nickname, role}（Supabase時）
};

const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDate = s => { const [y, m, d] = s.split('-'); return `${m}/${d}`; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const safeColor = c => /^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '#888888';
// 通信できない種類のエラーか（圏外・タイムアウトなど。権限エラーなどは含めない）
const isNetErr = e => !navigator.onLine || /fetch|network|load failed|timeout|failed to/i.test(String(e?.message || e || ''));
const flyerOf = id => { if (id === '__poster') return { id, name: 'ポスター貼り', color: '#a855f7' }; const f = S.settings.flyers.find(f => f.id === id); return f ? { ...f, color: safeColor(f.color) } : { id, name: '(削除済み)', color: '#888888' }; };
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => t.hidden = true, ms); }

/* ---------------- 起動 ---------------- */
window.addEventListener('DOMContentLoaded', init);
// 圏外対策（Service Worker）とオンライン状態の表示
if ('serviceWorker' in navigator && location.protocol === 'https:') { window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e))); }
window.addEventListener('offline', () => toast('圏外です。閲覧はできますが、保存は電波が戻ってから', 5000));
window.addEventListener('online', () => toast('通信が戻りました', 2000));
document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });

window.addEventListener('error', e => { console.error(e.error || e.message); toast('エラー: ' + (e.message || '不明').slice(0, 80), 5000); });
window.addEventListener('unhandledrejection', e => { console.error(e.reason); toast('エラー: ' + String(e.reason?.message || e.reason).slice(0, 80), 5000); });

async function init() {
  bindUI();
  await login();                       // ID・パスワードの確認（設定はこの中で読み込む）
  const boot = $('#boot'); if (boot) boot.hidden = true;
  [S.records, S.boards, S.spots, S.events, S.assignments] = await Promise.all([store.loadRecords(), store.loadBoards(), store.loadSpots(), store.loadEvents(), store.loadAssignments()]);
  fetch('data/stations.json').then(r => r.json()).then(d => { S.stations = d; renderStations(); }).catch(() => {});
  S.filter.flyers = new Set(S.settings.flyers.map(f => f.id));
  await loadGoogleMaps();
  await initMap();
  await loadTowns();
  loadAdminLayer();
  loadOaza();
  renderAll(); applyRole(); renderPending();
  if (USE_SUPABASE) {
    try { if (await SupabaseStore.flushOutbox()) await refreshAll(); } catch { }
    try { const { data } = await SupabaseStore.client.rpc('sync_stamp'); SupabaseStore._stamp = data; } catch { }
    window.addEventListener('online', async () => { try { if (await SupabaseStore.flushOutbox()) await refreshAll(); } catch { } });
  }
  setTimeout(offerDraftResume, 500);
  // 「してはいけないこと」は、その版につき端末で1回だけ自動表示（閉じ方に関係なく、出した時点で表示済みにする。メニューからいつでも見直せる）
  if (localStorage.getItem('cm_rules_ack') !== String(RULES_VERSION)) {
    const showOnce = () => { localStorage.setItem('cm_rules_ack', String(RULES_VERSION)); showRules(true); };
    setTimeout(() => { if ($('#sheet').hidden) showOnce(); else setTimeout(() => { if ($('#sheet').hidden) showOnce(); else localStorage.setItem('cm_rules_ack', String(RULES_VERSION)); }, 20000); }, 800);
  }
  setInterval(renderNotice, 60000);
  store.subscribe((recs, sets, boards, spots, events, asg) => {
    S.records = recs; if (boards) S.boards = boards; if (spots) S.spots = spots; if (events) S.events = events; if (asg) S.assignments = asg;
    if (sets && Array.isArray(sets.flyers) && Array.isArray(sets.members)) { S.settings = { ...S.settings, ...sets }; for (const f of S.settings.flyers) if (!S.filter.flyers.has(f.id) && !S._userToggled) S.filter.flyers.add(f.id); applyRole(); }
    renderAll();
  });
}

/* ---------------- ログイン（ID＋パスワード） ---------------- */
async function afterSignIn(me) {
  S.me = me; S.user = me.nickname;
  S.settings = await store.loadSettings();
  if (!S.settings.members.includes(me.nickname)) { try { await store.addMember(me.nickname); S.settings = await store.loadSettings(); } catch { } }
  $('#menuUser').textContent = `👤 ${me.nickname}`;
}
function login() {
  return new Promise(async resolve => {
    if (!USE_SUPABASE) {
      // 端末内保存版：名前を選ぶだけ
      let saved = null; try { saved = JSON.parse(localStorage.getItem('cm_user') || 'null'); } catch { }
      S.settings = await store.loadSettings();
      if (saved?.name && S.settings.members.includes(saved.name)) { S.user = saved.name; $('#menuUser').textContent = `👤 ${saved.name}`; return resolve(); }
      return showLogin(resolve);
    }
    SupabaseStore.init();
    localStorage.removeItem('cm_user');   // 旧・合言葉方式の名残を消す
    // 通信が返ってこない時に「ずっと読み込み中」にならないよう、待ち時間に上限を付ける
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
    // 開発プレビュー用：URLの#（サーバーに送られない部分）に id=…&pw=… があれば自動ログイン
    try {
      const h = new URLSearchParams(location.hash.slice(1));
      if (h.get('id') && h.get('pw')) { try { history.replaceState(null, '', location.pathname + location.search); } catch { } const me = await withTimeout(SupabaseStore.signIn(h.get('id'), h.get('pw')), 12000); await afterSignIn(me); return resolve(); }
    } catch (e) { console.error(e); }
    try {
      const me = await withTimeout(SupabaseStore.whoami(), 8000);
      if (me) { await withTimeout(afterSignIn(me), 10000); return resolve(); }
      const { data: { session } } = await withTimeout(SupabaseStore.client.auth.getSession(), 5000);
      if (session) { await SupabaseStore.signOut(); toast('このIDは停止されています', 4000); }
    } catch (e) { console.error(e); toast(e && e.message === 'timeout' ? '通信が遅いため、ログイン画面に戻しました。電波の良い所でもう一度お試しください' : '通信できません。電波の良い所で開き直してください', 6000); }
    showLogin(resolve);
  });
}
function showLogin(resolve) {
  const boot = $('#boot'); if (boot) boot.hidden = true;
  const box = $('#login'); box.hidden = false; $('#loginErr').textContent = '';
  const sel = $('#selName'); const nameWrap = $('#nameWrap');
  $('#loginAuth').hidden = !USE_SUPABASE; $('#loginSub').hidden = !USE_SUPABASE;
  nameWrap.hidden = USE_SUPABASE; $('#newNameWrap').hidden = true;
  $('#loginMsg').textContent = USE_SUPABASE ? 'IDとパスワードを入れてください' : 'あなたの名前を選んでください';
  if (!USE_SUPABASE) {
    sel.innerHTML = S.settings.members.map(m => `<option>${esc(m)}</option>`).join('') + '<option value="__new">＋ 新しい名前を追加</option>';
    sel.onchange = () => $('#newNameWrap').hidden = sel.value !== '__new';
  }
  const submit = async () => {
    if (USE_SUPABASE) {
      const id = $('#inpId').value.trim().toLowerCase(), pw = $('#inpPw').value;
      if (!id || !pw) { $('#loginErr').textContent = 'IDとパスワードを入れてください'; return; }
      $('#btnLogin').disabled = true; $('#loginErr').textContent = '確認中…';
      try { const me = await SupabaseStore.signIn(id, pw); await afterSignIn(me); }
      catch (e) { $('#loginErr').textContent = e.message || 'ログインできません'; $('#btnLogin').disabled = false; return; }
      $('#btnLogin').disabled = false; $('#inpPw').value = '';
    } else {
      let name = sel.value;
      if (name === '__new') {
        name = $('#inpNewName').value.trim();
        if (!name) { $('#loginErr').textContent = '名前を入れてください'; return; }
        const norm = x => x.replace(/[\s　]+/g, '');
        const dup = S.settings.members.find(m => norm(m) === norm(name)); if (dup) name = dup;
        else { await store.addMember(name); S.settings = await store.loadSettings(); }
      }
      S.user = name; localStorage.setItem('cm_user', JSON.stringify({ name }));
      $('#menuUser').textContent = `👤 ${name}`;
    }
    box.hidden = true; if (S.map) { applyRole(); renderAll(); }
    resolve && resolve();
  };
  $('#btnLogin').onclick = submit;
  $('#inpPw').onkeydown = e => { if (e.key === 'Enter') submit(); };
}
// パスワード変更（本人）
function showPasswordChange() {
  openSheet(`<h3>パスワードを変える</h3>
    <label>新しいパスワード（8文字以上）<input id="pw1" type="password" autocomplete="new-password"></label>
    <label>もう一度<input id="pw2" type="password" autocomplete="new-password"></label>
    <div class="btnRow"><button class="ghost" id="pwCancel">やめる</button><button class="primary" id="pwOk">変更する</button></div>
    <p class="small">ID：${esc(S.me?.login_id || '')}　／　忘れた時は管理者に再発行を頼んでください</p>`);
  $('#pwCancel').onclick = closeSheet;
  $('#pwOk').onclick = async () => {
    const a = $('#pw1').value, b = $('#pw2').value;
    if (a.length < 8) { toast('8文字以上にしてください'); return; }
    if (a !== b) { toast('2つのパスワードが違います'); return; }
    $('#pwOk').disabled = true;
    try { await SupabaseStore.changePassword(a); closeSheet(); toast('パスワードを変えました'); } catch (e) { toast('変更できません：' + e.message, 4000); $('#pwOk').disabled = false; }
  };
}
// 発行用の仮パスワード（読み間違えやすい文字を除く）
function tempPassword(n = 10) { const cs = 'abcdefghjkmnpqrstuvwxyz23456789'; const a = new Uint32Array(n); crypto.getRandomValues(a); return [...a].map(x => cs[x % cs.length]).join(''); }
const APP_URL = 'https://adaa-369.github.io/chirashi-map-site/';
function credentialText(id, pw, nick) { return `【チラシ配布MAP ログイン情報】\n${nick ? nick + ' さん\n' : ''}URL：${APP_URL}\nID：${id}\nパスワード：${pw}\n\n開いたらIDとパスワードを入れて「はじめる」。\n入れたら、メニュー（☰）の「パスワードを変える」で自分のパスワードに変えてください。`; }

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
    // 無段階ズームはPCだけ。スマホではピンチ中に境界線・地名・ピンを描き直し続けてメモリが尽き、白画面で固まる原因になるため段階ズームにする
    isFractionalZoomEnabled: !window.matchMedia('(pointer: coarse)').matches,
  });
  class Proj extends OverlayView { onAdd() { } draw() { } onRemove() { } }
  S.proj = new Proj(); S.proj.setMap(S.map);
  S.infoWin = new InfoWindow();
  // 「地図＋写真／地図」の選択を端末に記憶し、次に開いた時も同じにする
  try { const mt = localStorage.getItem('cm_maptype'); if (mt === 'roadmap' || mt === 'hybrid') S.map.setMapTypeId(mt); } catch { }
  S.map.addListener('maptypeid_changed', () => { try { localStorage.setItem('cm_maptype', S.map.getMapTypeId()); } catch { } });
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
  const zStep = window.matchMedia('(pointer: coarse)').matches ? 1 : 0.35;   // スマホは段階ズームなので1段ずつ
  holdZoom($('#zoomIn'), zStep); holdZoom($('#zoomOut'), -zStep);
  // 地図を長押し → ピンを立てて「ここで何をする？」（誤爆防止：1本指・動かさない・0.7秒・描画中などは無効）
  const mapEl = $('#map'); let lp = null, pointers = 0;
  const cancelLp = () => { if (lp) { clearTimeout(lp.timer); lp = null; } };
  mapEl.addEventListener('pointerdown', e => {
    pointers++;
    if (pointers !== 1 || S.drawing || S.adjust || S.pin || S.boardAdding || S.spotAdding || !document.querySelector('#sheet').hidden) { cancelLp(); return; }
    const sx = e.clientX, sy = e.clientY;
    lp = { sx, sy, timer: setTimeout(() => { lp = null; const r = mapEl.getBoundingClientRect(); const ll = S.proj.getProjection().fromContainerPixelToLatLng(new google.maps.Point(sx - r.left, sy - r.top)); if (navigator.vibrate) try { navigator.vibrate(25); } catch { } quickPin(ll); }, 700) };
  }, { capture: true });
  mapEl.addEventListener('pointermove', e => { if (lp && Math.hypot(e.clientX - lp.sx, e.clientY - lp.sy) > 8) cancelLp(); }, { capture: true });
  const up = () => { pointers = Math.max(0, pointers - 1); cancelLp(); };
  mapEl.addEventListener('pointerup', up, { capture: true }); mapEl.addEventListener('pointercancel', up, { capture: true });
  mapEl.addEventListener('wheel', cancelLp, { capture: true, passive: true });
  mapEl.addEventListener('contextmenu', e => e.preventDefault());   // 長押しで「画像を保存」などのメニューを出さない

  S.map.addListener('click', ev => { if (S.boardAdding) addBoardAt(ev.latLng); else if (S.spotAdding) addSpotAt(ev.latLng); else if (S.searchMarker?._quick) { S.searchMarker.setMap(null); S.searchMarker = null; } });
  S.map.addListener('idle', () => {
    const c = S.map.getCenter(); localView.set({ center: { lat: c.lat(), lng: c.lng() }, zoom: S.map.getZoom() });
    const z = S.map.getZoom();   // 町丁目の線の描き直しは拡大率の段が変わった時だけ（毎回やるとスマホが重い）
    const band = z >= 16 ? 4 : z >= 15 ? 3 : z >= 14 ? 2 : z >= 13 ? 1 : 0;
    clearTimeout(S._idleT); S._idleT = setTimeout(() => {
      if (S.drawing || S.adjust) return;
      const vb = viewBbox(0); const prev = S._lastVb;
      const moved = !prev || !vb || vb[0] < prev[0] || vb[1] < prev[1] || vb[2] > prev[2] || vb[3] > prev[3];   // 前回描いた余白の外に出たか
      if (S._band !== band || moved) { renderRecords(); renderAssignments(); renderOazaLabels(); renderBoards(); S._lastVb = viewBbox(0.3); }
      if (S._band !== undefined && S._band !== band) { renderSpots(); styleTowns(); styleAdmin(); styleOaza(); }
      S._band = band;
    }, 250);
  });
}

/* ---------------- 市区町村の境界（愛知県・国土数値情報 N03） ---------------- */
// 表示する市区町村と色（本人指定。ここにない市町村は線を出さない）
// 並び順は本人指定（場所が近い順）：蟹江→あま→津島→稲沢→愛西→弥富→飛島→大治
const ADMIN_COLORS = {
  '蟹江町': '#e65100',  // 濃いオレンジ
  'あま市': '#ad1457',  // ワイン（弥富と入れ替え）
  '津島市': '#283593',  // 濃い紺
  '稲沢市': '#1b5e20',  // 濃い緑
  '愛西市': '#e91e63',  // ピンク（本人指定）
  '弥富市': '#0277bd',  // 濃い水色（あまと入れ替え）
  '飛島村': '#00695c',  // 濃い青緑
  '大治町': '#795548',  // 濃い茶
};
// 「貼った」掲示場の色＝市町村色の反対色（本人指定：稲沢の緑と「完了の緑」が紛れないように）
const POSTED_COLORS = {
  '蟹江町': '#1e40af',  // オレンジ → 紺
  'あま市': '#0f766e',  // ワイン → 深い青緑
  '津島市': '#f59e0b',  // 紺 → 山吹
  '稲沢市': '#d81b60',  // 濃い緑 → 濃いピンク
  '愛西市': '#2e7d32',  // ピンク → 緑
  '弥富市': '#ef6c00',  // 水色 → オレンジ
  '飛島村': '#d84315',  // 青緑 → 朱
  '大治町': '#0288d1',  // 茶 → 水色
};
const postedColor = city => POSTED_COLORS[city] || '#16a34a';
// 稲沢市は元の地図と同じ5班の色分け（番号が班ごとに1から振られているため、番号だけだと重なる）。p＝貼った時の反対色
const INAZAWA_TEAM = { 1: { c: '#a52714', p: '#00acc1' }, 2: { c: '#f9a825', p: '#3949ab' }, 3: { c: '#9c27b0', p: '#7cb342' }, 4: { c: '#0288d1', p: '#fb8c00' }, 5: { c: '#0f9d58', p: '#d81b60' } };
// 「2-14」のような班つき番号を {team:2, num:'14'} に分ける（班なしなら null）
const boardTeam = b => { const m = /^(\d)-(\d+)$/.exec(String(b.no || '')); return m && INAZAWA_TEAM[+m[1]] ? { team: +m[1], num: m[2] } : null; };
// 既定の並びを変えたので、古い端末側の並び順は一度リセット（2026-09-09）
if (localStorage.getItem('cm_admin_order_v') !== '2') { localStorage.removeItem('cm_admin_order'); localStorage.setItem('cm_admin_order_v', '2'); }
// 表示ON/OFF（端末ごとに記憶）
function adminOnSet() { try { const a = JSON.parse(localStorage.getItem('cm_admin_on') || 'null'); return new Set(Array.isArray(a) ? a : Object.keys(ADMIN_COLORS)); } catch { return new Set(Object.keys(ADMIN_COLORS)); } }
// 並び順（端末ごと。他の人には影響しない）
function adminOrder() { const all = Object.keys(ADMIN_COLORS); try { const o = JSON.parse(localStorage.getItem('cm_admin_order') || 'null'); if (Array.isArray(o)) return [...o.filter(n => all.includes(n)), ...all.filter(n => !o.includes(n))]; } catch { } return all; }
function renderAdminChips() {
  const el = $('#adminChips'); if (!el) return; const on = adminOnSet();
  const oz = oazaCitySet();
  el.innerHTML = `<button class="chip ${on.size === Object.keys(ADMIN_COLORS).length ? 'on' : ''}" data-n="__all" style="--c:#555" title="全部の境界線をON/OFF"><span class="dot" style="background:#ddd"></span>境界線</button>` +
    `<button class="chip ${oz.size === Object.keys(ADMIN_COLORS).length ? 'on' : ''}" data-n="__oazaAll" style="--c:#555" title="全部の地名（丁目なし）をON/OFF"><span class="dot" style="background:#ddd"></span>地名</button>` +
    adminOrder().map(n => { const c = ADMIN_COLORS[n]; return `<button class="chip ${on.has(n) ? 'on' : ''}" data-n="${esc(n)}" style="--c:${c}" draggable="true" title="タップで境界線・地名の表示を選ぶ／ドラッグで並べ替え"><span class="dot"></span>${esc(n.replace(/(市|町|村)$/, ''))}${oz.has(n) ? '<span class="sub">地名</span>' : ''}<span class="caret">▾</span></button>`; }).join('');
  el.querySelectorAll('.chip').forEach(b => {
    b.onclick = () => {
      const cur = adminOnSet(); const n = b.dataset.n;
      if (n === '__all') { const all = Object.keys(ADMIN_COLORS); if (cur.size === all.length) cur.clear(); else all.forEach(x => cur.add(x)); localStorage.setItem('cm_admin_on', JSON.stringify([...cur])); renderAdminChips(); styleAdmin(); return; }
      if (n === '__oazaAll') { const all = Object.keys(ADMIN_COLORS); const oc = oazaCitySet(); const next = oc.size === all.length ? [] : all; localStorage.setItem('cm_oaza_cities', JSON.stringify(next)); renderAdminChips(); styleOaza(); renderOazaLabels(); toast(next.length ? '地名を全部表示' : '地名を全部非表示'); return; }
      openChipMenu(n, b);
    };
    if (b.dataset.n === '__all' || b.dataset.n === '__oazaAll') return;
    b.ondragstart = e => { e.dataTransfer.setData('text/plain', b.dataset.n); e.dataTransfer.effectAllowed = 'move'; b.classList.add('dragging'); };
    b.ondragend = () => b.classList.remove('dragging');
    b.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; b.classList.add('dragOver'); };
    b.ondragleave = () => b.classList.remove('dragOver');
    b.ondrop = e => {
      e.preventDefault(); b.classList.remove('dragOver');
      const from = e.dataTransfer.getData('text/plain'), to = b.dataset.n; if (!from || from === to || !ADMIN_COLORS[from] || !ADMIN_COLORS[to]) return;
      const arr = adminOrder(); const fi = arr.indexOf(from), ti = arr.indexOf(to); const [m] = arr.splice(fi, 1); arr.splice(ti, 0, m);
      localStorage.setItem('cm_admin_order', JSON.stringify(arr)); renderAdminChips(); toast('並び順を変えました（この端末だけ）');
    };
  });
}
// 隣接する境界で「どちらの色を上に描くか」（数字が大きいほど上）。津島は愛西に囲まれて見えにくいので最優先
const ADMIN_Z = { '津島市': 6, '蟹江町': 5, '大治町': 4 };
// 市町村チップのメニュー：境界線と地名（丁目なし）を市町村ごとにON/OFF
function openChipMenu(n, chip) {
  closeChipMenu();
  const on = adminOnSet().has(n), oz = oazaCitySet().has(n);
  const m = document.createElement('div'); m.id = 'chipMenu';
  m.innerHTML = `<div class="cmHead"><span class="dot" style="background:${ADMIN_COLORS[n]}"></span><b>${esc(n)}</b></div>
    <label class="cmRow"><span>境界線（市町村の外周）</span><input type="checkbox" class="sw" data-k="admin" ${on ? 'checked' : ''}></label>
    <label class="cmRow"><span>地名（丁目なし）の枠と名前</span><input type="checkbox" class="sw" data-k="oaza" ${oz ? 'checked' : ''}></label>
    <div class="small">この端末だけの設定です</div>`;
  document.getElementById('app').appendChild(m);
  const r = chip.getBoundingClientRect(); const w = 250;
  m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left)) + 'px'; m.style.top = (r.bottom + 6) + 'px';
  m.querySelectorAll('input').forEach(i => i.onchange = () => {
    if (i.dataset.k === 'admin') { const cur = adminOnSet(); if (i.checked) cur.add(n); else cur.delete(n); localStorage.setItem('cm_admin_on', JSON.stringify([...cur])); styleAdmin(); }
    else { const cur = oazaCitySet(); if (i.checked) cur.add(n); else cur.delete(n); localStorage.setItem('cm_oaza_cities', JSON.stringify([...cur])); styleOaza(); renderOazaLabels(); }
    renderAdminChips();
  });
  setTimeout(() => { document.addEventListener('pointerdown', S._cmOut = e => { if (!m.contains(e.target)) closeChipMenu(); }, { capture: true }); }, 0);
}
function closeChipMenu() { document.getElementById('chipMenu')?.remove(); if (S._cmOut) { document.removeEventListener('pointerdown', S._cmOut, { capture: true }); S._cmOut = null; } }
async function loadAdminLayer() {
  try {
    const gj = await fetch('data/admin_aichi.geojson').then(r => r.json());
    gj.features = gj.features.filter(f => ADMIN_COLORS[f.properties.name]);
    const { Data } = await google.maps.importLibrary('maps');
    S.adminLayer = new Data({ map: S.map });
    S.adminLayer.addGeoJson(gj);
    renderAdminChips(); styleAdmin(); renderLegend();
  } catch (e) { console.warn('admin layer', e); }
}
function styleAdmin() {
  if (!S.adminLayer || !S.map) return;
  const z = S.map.getZoom();
  const on = adminOnSet();
  S.adminLayer.setStyle(f => { const n = f.getProperty('name'); const c = ADMIN_COLORS[n] || '#ffd60a';
    return { visible: on.has(n), clickable: false, fillColor: c, fillOpacity: 0.08, strokeColor: c, strokeOpacity: 0.95, strokeWeight: z >= 15 ? 3 : z >= 12 ? 3.5 : 2.5, zIndex: ADMIN_Z[n] || 3 }; });
}

/* ---------------- 地名（丁目なしの大字・町名） ---------------- */
// 町丁目を「学戸一〜七丁目→学戸」のようにまとめた枠。data/oaza/ は tools/build_oaza.mjs で生成
const OAZA_BASE = DATA_BASE.replace('by_city', 'oaza');
const OAZA_COLOR = '#ffe270';   // 色の指定がない市町村用
// 地名を表示する市町村（端末ごと）。初期は全市町村ON（2026-09-08 蟹江町で確認後に全域へ）
function oazaCitySet() { const all = Object.keys(ADMIN_COLORS); try { const a = JSON.parse(localStorage.getItem('cm_oaza_cities') || 'null'); return new Set(Array.isArray(a) ? a : all); } catch { return new Set(all); } }
// 地名の線色＝その市町村の境界線と同じ色（本人指定：濃い版は分かりにくい）
const oazaColor = city => ADMIN_COLORS[city] || OAZA_COLOR;
async function loadOaza() {
  if (!S.map) return;
  try {
    const files = activeCities();
    const results = await Promise.allSettled(files.map(f => fetch(OAZA_BASE + f + '.geojson').then(r => r.json())));
    const { Data } = await google.maps.importLibrary('maps');
    S.oazaLayer = new Data({ map: S.map });
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const f of r.value.features) {
        const p = f.properties; f.id = `oaza_${p.code}_${p.name}`;
        S.oaza.push({ feature: f, name: p.name, city: p.city, setai: p.setai, jinko: p.jinko, n: p.n, towns: new Set(p.towns), bbox: turf.bbox(f), lab: { lat: p.ly, lng: p.lx } });
        S.oazaLayer.addGeoJson(f);
      }
    }
    styleOaza(); renderOazaLabels(); renderAdminChips(); renderLegend();
  } catch (e) { console.warn('oaza layer', e); }
}
function styleOaza() {
  if (!S.oazaLayer || !S.map) return;
  const z = S.map.getZoom(); const on = oazaCitySet();
  S.oazaLayer.setStyle(f => { const city = f.getProperty('city');
    return { visible: on.has(city) && z >= 13, clickable: false, fillOpacity: 0, strokeColor: oazaColor(city), strokeOpacity: 0.95, strokeWeight: z >= 16 ? 2.5 : z >= 14 ? 2 : 1.5, zIndex: 2 }; });
}
// 地名ラベル：表示範囲内だけ描く。タップで地名全体の配布率
function renderOazaLabels() {
  const on = oazaCitySet();
  const clear = () => { for (const l of S.oazaLabels) l.setMap(null); S.oazaLabels = []; S._oazaKey = ''; };
  if (!S.map || !on.size || S.map.getZoom() < 13.5) { clear(); return; }
  ensureLabelClass(); const vb = viewBbox(0.15); if (!vb) { clear(); return; }
  // 小さな地名（稲沢市の農村部など世帯数の少ない大字）は、拡大するまで名前を出さない（枠線は出す）
  const z = S.map.getZoom(); const minSetai = z >= 16 ? 0 : z >= 15 ? 40 : z >= 14 ? 120 : 250;
  const show = S.oaza.filter(o => on.has(o.city) && bboxHit(vb, o.bbox) && (o.setai || 0) >= minSetai);
  const key = show.map(o => o.feature.id).join(',');
  if (key === S._oazaKey && S.oazaLabels.length === show.length) return;   // 同じなら描き直さない
  clear(); S._oazaKey = key;
  for (const o of show) {
    const lb = new RecLabel(o.lab, esc(o.name), null, { cls: 'oazaLabel' });
    lb.onClick = () => showOazaInfo(o);
    lb.setMap(S.map); S.oazaLabels.push(lb);
  }
}
function showOazaInfo(o) {
  if (!o || S.drawing || !overlaysClickable()) return;
  const recs = filteredRecords();
  const members = S.towns.filter(t => o.towns.has(t.id));
  const rows = S.settings.flyers.filter(f => S.filter.flyers.has(f.id)).map(f => {
    const fr = recs.filter(r => r.flyer_id === f.id); let hh = 0;
    for (const t of members) hh += coverageOf(t, fr) * (t.setai || 0);
    const cov = o.setai ? hh / o.setai : 0;
    return `<div style="margin:4px 0"><span style="display:inline-block;width:10px;height:10px;background:${f.color};border-radius:2px;margin-right:6px"></span>${esc(f.name)}：<b>${Math.round(cov * 100)}%</b>（約${Math.round(hh)}世帯）</div>`;
  }).join('');
  const names = [...new Set(members.map(t => t.name))];
  const html = `<div style="color:#222;font-size:13px;min-width:180px;max-width:260px"><b style="font-size:14px">${esc(o.city)} ${esc(o.name)}</b><div style="color:#666;margin:2px 0 6px">${o.setai.toLocaleString()}世帯 ／ ${o.jinko.toLocaleString()}人${o.n > 1 ? `　<span style="font-size:11px">町丁目${o.n}つ分の合計</span>` : ''}</div>${rows || '<div style="color:#666">表示中のチラシがありません</div>'}${o.n > 1 ? `<div style="color:#888;font-size:11px;margin-top:6px;line-height:1.4">${esc(names.join('・'))}</div>` : ''}</div>`;
  S.infoWin.setContent(html); S.infoWin.setPosition(new google.maps.LatLng(o.lab.lat, o.lab.lng)); S.infoWin.open(S.map);
}

/* ---------------- 町丁目 ---------------- */
async function loadTowns() {
  const files = activeCities();
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
  const adding = !overlaysClickable();
  // 町丁目はタップに反応させない（誤タップで情報窓が出るのを防ぐ）。配布率は長押しで見る
  S.map.data.setStyle({ visible: z >= 14, strokeColor: '#ffffff', strokeOpacity: z >= 16 ? 0.55 : 0.35, strokeWeight: 1, fillOpacity: 0, clickable: false, zIndex: 1 });
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
      if (this.onClick) { d.style.pointerEvents = 'auto'; d.style.cursor = 'pointer'; d.addEventListener('click', e => { e.stopPropagation(); this.onClick(e); }); }
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
const modeBusy = () => S.drawing ? '範囲を描いている途中です' : S.adjust ? '形を直している途中です' : S.pin ? 'ピンの位置合わせ中です' : null;
function guardMode() { const m = modeBusy(); if (m) { toast(m + '。先に「決定」か「中止」を押してください'); return false; } return true; }
function setBarsLocked(on) { for (const id of ['#boardBar', '#spotBar', '#assignBar']) { const el = $(id); if (el) el.style.pointerEvents = on ? 'none' : ''; } }
const overlaysClickable = () => !(S.drawing || S.adjust || S.pin || S.boardAdding || S.spotAdding);
const barOn = () => !!(S.boardsOn || S.spotBarOn || S.assignBarOn);

/* ---------------- 記録の描画 ---------------- */
const _polyCache = new Map();
function recPolygon(r) {
  const k = r.id + '|' + (r.updated_at || '') + '|' + (r.polygon?.length || 0);
  let p = _polyCache.get(k);
  if (!p) { let ring = Array.isArray(r.polygon) ? r.polygon : []; if (ring.length >= 3 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring = [...ring, ring[0]]; p = turf.polygon([ring]); p.bbox = turf.bbox(p); if (_polyCache.size > 3000) _polyCache.clear(); _polyCache.set(k, p); }
  return p;
}
const bboxHit = (a, b) => !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);
function viewBbox(pad = 0.3) {
  try { const b = S.map.getBounds(); if (!b) return null; const sw = b.getSouthWest(), ne = b.getNorthEast(); const dx = (ne.lng() - sw.lng()) * pad, dy = (ne.lat() - sw.lat()) * pad; return [sw.lng() - dx, sw.lat() - dy, ne.lng() + dx, ne.lat() + dy]; } catch { return null; }
}

function filteredRecords() {
  const p = S.filter.period;
  let since = null;
  if (p !== 'all') { const d = new Date(); d.setDate(d.getDate() - Number(p)); since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  return S.records.filter(r => S.filter.flyers.has(r.flyer_id) && (!since || r.date >= since));
}

function renderAll() {
  renderChips(); renderNotice(); renderLegend(); renderRecords(); renderBoards(); renderSpots(); renderAssignments(); renderStations(); renderDash();
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
  const vb = viewBbox(0.3);   // 画面に映っている範囲だけ描画
  const groups = new Map();
  for (const r of recs) { if (vb && !bboxHit(recPolygon(r).bbox, vb)) continue; const k = r.group_id || r.id; (groups.get(k) || groups.set(k, []).get(k)).push(r); }
  for (const [k, list] of groups) { try {
    const r = list[0]; const f = flyerOf(r.flyer_id); const f2 = list.length > 1 ? flyerOf(list[1].flyer_id) : null;
    const poly = new google.maps.Polygon({
      paths: r.polygon.map(([lng, lat]) => ({ lat, lng })),
      strokeColor: f2 ? f2.color : f.color, strokeOpacity: 0.95, strokeWeight: f2 ? 4 : 2,
      fillColor: f.color, fillOpacity: 0.32, map: S.map, zIndex: 2, clickable: overlaysClickable(),
    });
    poly.addListener('click', ev => { if (!S.drawing) showRecord(r, ev.latLng); });
    S.polys.set(k, poly);
    if (showIcons) {
      const c = turf.centerOfMass(recPolygon(r)).geometry.coordinates;
      const mk = new google.maps.Marker({ position: { lat: c[1], lng: c[0] }, map: S.map, zIndex: 4, clickable: overlaysClickable(),
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: S.map.getZoom() >= 13 ? 11 : 8, fillColor: f.color, fillOpacity: 0.95, strokeColor: '#fff', strokeWeight: 2 },
        label: S.map.getZoom() >= 13 ? { text: '📄', fontSize: '12px' } : undefined,
        title: `${fmtDate(r.date)} ${r.member} ${list.map(x => flyerOf(x.flyer_id).name + ' ' + x.count + '枚').join('／')}` });
      mk.addListener('click', () => { if (!S.drawing) showRecord(r); });
      S.recIcons.push(mk);
    }
    if (showLabels) {
      const c = turf.centerOfMass(recPolygon(r)).geometry.coordinates;
      const lines = list.map(x => `<span style="color:${flyerOf(x.flyer_id).color}">●</span>${esc(flyerOf(x.flyer_id).name)} <b>${x.count.toLocaleString()}</b>枚`).join('<br>');
      const html = `${list.some(x => x._pending) ? '⏳ ' : ''}<b>${fmtDate(r.date)}</b> ${esc(r.member)}<br>${lines}`;
      const lb = new RecLabel({ lat: c[1], lng: c[0] }, html, f.color); lb.setMap(S.map); S.labels.push(lb);
    }
  } catch (e) { console.warn('bad record', k, e); } }
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

const orphanFlyers = () => { const known = new Set(S.settings.flyers.map(f => f.id)); return [...new Set(S.records.map(r => r.flyer_id))].filter(id => !known.has(id)).map(id => ({ id, name: '(削除済み)', color: '#888888', orphan: true })); };
const chipFlyers = () => [...S.settings.flyers, ...orphanFlyers()];
const ID_OK = /^[\w.\-:]{1,60}$/;
function normalizeSettings(d) {
  const s0 = { ...DEFAULT_SETTINGS, ...(d || {}) };
  s0.flyers = (Array.isArray(s0.flyers) ? s0.flyers : []).filter(f => f && ID_OK.test(String(f.id))).map(f => ({ id: String(f.id), name: String(f.name ?? ''), color: safeColor(f.color), total: Number(f.total) || 0 }));
  s0.members = (Array.isArray(s0.members) ? s0.members : []).map(String); s0.admins = (Array.isArray(s0.admins) ? s0.admins : []).map(String);
  s0.noticeDate = /^\d{4}-\d{2}-\d{2}$/.test(s0.noticeDate || '') ? s0.noticeDate : ''; s0.termEndDate = /^\d{4}-\d{2}-\d{2}$/.test(s0.termEndDate || '') ? s0.termEndDate : '';
  return s0;
}
function renderChips() {
  const el = $('#flyerChips');
  const list = chipFlyers(); const allOn = list.length > 0 && list.every(f => S.filter.flyers.has(f.id));
  // 先頭の「チラシ」は全部まとめてON/OFF（境界線・地名・掲示板の段と同じ作法）
  el.innerHTML = `<button class="chip ${allOn ? 'on' : ''}" data-id="__all" style="--c:#555" title="全部のチラシをON/OFF"><span class="dot" style="background:#ddd"></span>チラシ</button>` +
    list.map(f => `<button class="chip ${S.filter.flyers.has(f.id) ? 'on' : ''}" data-id="${esc(f.id)}" style="--c:${safeColor(f.color)}" draggable="true" title="ドラッグで並べ替え"><span class="dot"></span>${esc(f.name)}</button>`).join('');
  el.querySelectorAll('.chip').forEach(c => {
    c.onclick = () => {
      const id = c.dataset.id; S._userToggled = true;
      if (id === '__all') { if (allOn) S.filter.flyers.clear(); else list.forEach(f => S.filter.flyers.add(f.id)); renderAll(); return; }
      if (S.filter.flyers.has(id)) S.filter.flyers.delete(id); else S.filter.flyers.add(id);
      renderAll();
    };
    if (c.dataset.id === '__all') return;
    c.ondragstart = e => { e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); };
    c.ondragend = () => c.classList.remove('dragging');
    c.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; c.classList.add('dragOver'); };
    c.ondragleave = () => c.classList.remove('dragOver');
    c.ondrop = async e => {
      e.preventDefault(); c.classList.remove('dragOver'); if (!isAdmin()) return;
      const from = e.dataTransfer.getData('text/plain'), to = c.dataset.id; if (!from || from === to || from === '__all' || to === '__all') return;
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
  return chipFlyers().map(f => ({ ...f, used: used[f.id] || 0, remain: f.total ? f.total - (used[f.id] || 0) : null }));
}
function renderLegend() {
  const n = filteredRecords().length;
  const stock = flyerTotals().filter(f => S.filter.flyers.has(f.id)).map(f => `<div class="lg"><span class="sw" style="background:${f.color};border-color:${f.color}"></span><span>${esc(f.name)} ${f.used.toLocaleString()}${f.total ? ` / ${f.total.toLocaleString()}枚　<b style="color:${f.remain < 0 ? '#ff7b72' : '#e8eef5'}">残り ${f.remain.toLocaleString()}</b>` : '枚'}</span></div>`).join('');
  $('#legend').innerHTML = stock + `<div class="lg"><span class="sw" style="background:rgba(255,23,68,.6)"></span>同じチラシの二重配布</div><div class="lg"><span class="sw" style="border-color:#fff;background:none"></span>町丁目（長押しで世帯数・配布率）</div><div class="lg"><span class="sw" style="border-color:${oazaColor('蟹江町')};background:none"></span>地名・丁目なし＝市町村と同じ色の細い線（市町村チップから表示／名前タップで配布率）</div><div class="lg" style="flex-wrap:wrap;gap:4px 8px">${Object.entries(ADMIN_COLORS).map(([n, c]) => `<span style="display:inline-flex;align-items:center;gap:3px"><span class="sw" style="border-color:${c};background:none;width:12px;height:8px"></span>${n}</span>`).join('')}</div><div class="small">表示中 ${n}件</div>`;
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
  if ($('#fab').disabled && S.asgKind !== 'poster') return;   // 告示後もポスター貼りの受け持ち範囲は描ける
  if (!guardMode()) { S.drawPurpose = 'record'; return; }
  setBarsLocked(true);
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
  if (S.drawPurpose === 'record') { if (d.ll.length) saveDraft({ stage: 'tap', ll: d.ll }); else clearDraft(); }
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
  clearTapShapes(); setBarsLocked(false); if (S.drawing?.mapClick) google.maps.event.removeListener(S.drawing.mapClick);
  $('#drawLayer').hidden = true; $('#fab').hidden = false; S.drawing = null; setAddingUI(false);
  $('#legendBtn').hidden = barOn(); $('#zoomBtns').hidden = false; $('#centerMark').hidden = false; renderRecords();
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
  if (S.adjust) endAdjust(false);
  S.infoWin.close(); closeSheet(); setBarsLocked(true);
  for (const p of S.polys.values()) p.setOptions({ clickable: false });
  const path = ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
  const poly = new google.maps.Polygon({ paths: path, editable: true, draggable: false, strokeColor: '#00e5ff', strokeWeight: 3, fillColor: '#00e5ff', fillOpacity: 0.25, map: S.map, zIndex: 10 });
  S.adjust = { poly, rec };
  if (!rec && S.drawPurpose === 'record') saveDraft({ stage: 'adjust', ring });
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
  a.poly.setMap(null); S.adjust = null; setBarsLocked(false);
  $('#adjustBar').hidden = true; $('#fab').hidden = false; $('#legendBtn').hidden = barOn(); renderRecords();
  for (const p of S.polys.values()) p.setOptions({ clickable: true });
  if (!ok) { S.drawPurpose = 'record'; return; }
  if (!a.rec && S.drawPurpose === 'assign') { S.drawPurpose = 'record'; const k = S.asgKind; S.asgKind = null; openAssignForm(k === 'poster' ? { polygon: ring, flyer_id: POSTER_ASG, member: S.user } : { polygon: ring }); return; }
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

/* ---------------- 下書き（書きかけの記録を端末に残し、開き直した時に続きから） ---------------- */
const DRAFT_KEY = 'cm_draft_v1';
function saveDraft(d) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, at: new Date().toISOString() })); } catch { } }
function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; } }
function clearDraft() { localStorage.removeItem(DRAFT_KEY); S.draftForm = null; }
function formDraftValues() {
  const lines = [...document.querySelectorAll('#flyerLines .flyerLine')].map(el => ({ flyer_id: el.querySelector('.fFlyer').value, count: el.querySelector('.fCount').value }));
  return { lines, date: $('#fDate')?.value, member: $('#fMember')?.value, memo: $('#fMemo')?.value };
}
function offerDraftResume() {
  const d = loadDraft(); if (!d || !d.stage || S.drawing || S.adjust) return;
  const when = d.at ? new Date(d.at) : null;
  const label = when ? `${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : '';
  const what = d.stage === 'tap' ? `範囲を描いている途中（${(d.ll || []).length}点）` : d.stage === 'adjust' ? '形を調整している途中' : '枚数などを入力している途中';
  openSheet(`<h3>📝 書きかけの記録があります</h3><div class="small">${esc(label)}　${esc(what)}。アプリが閉じても端末に残しています</div>
    <div class="btnRow"><button class="ghost" id="dfDrop">捨てる</button><button class="primary" id="dfGo">続きから</button></div>`);
  $('#dfDrop').onclick = () => { clearDraft(); closeSheet(); };
  $('#dfGo').onclick = () => { closeSheet(); resumeDraft(d); };
}
function resumeDraft(d) {
  try {
    S.drawPurpose = 'record';
    if (d.stage === 'tap' && Array.isArray(d.ll) && d.ll.length) {
      S.drawMode = 'tap'; S.map.panTo(d.ll[0]); startDrawing(); if (!S.drawing) return;
      S.drawing.ll = d.ll.map(p => ({ lat: +p.lat, lng: +p.lng })); redrawTap();
    } else if (d.stage === 'adjust' && d.ring) {
      startAdjust(d.ring, null);
    } else if (d.stage === 'form' && d.ring) {
      openRecordForm({ polygon: d.ring });
      const v = d.form;
      if (v && $('#flyerLines')) {
        const fl = $('#flyerLines');
        if (v.lines?.length) {
          while (fl.children.length < v.lines.length) $('#addLine').click();
          while (fl.children.length > v.lines.length && fl.children.length > 1) fl.lastElementChild.remove();
          [...fl.children].forEach((el, i) => { el.querySelector('.fFlyer').value = v.lines[i].flyer_id; el.querySelector('.fCount').value = v.lines[i].count; });
        }
        if (v.date) $('#fDate').value = v.date; if (v.member) $('#fMember').value = v.member; if (v.memo != null) $('#fMemo').value = v.memo;
      }
      const b = turf.bbox(turf.polygon([d.ring])); S.map.fitBounds(new google.maps.LatLngBounds({ lat: b[1], lng: b[0] }, { lat: b[3], lng: b[2] }), 60);
    } else clearDraft();
  } catch (e) { console.error(e); toast('下書きを開けませんでした'); clearDraft(); }
}
/* ---------------- 送信待ちの表示 ---------------- */
function renderPending() {
  const el = $('#pendingBar'); if (!el || !USE_SUPABASE) return;
  const n = SupabaseStore.outbox().length; el.hidden = !n; if (!n) return;
  el.innerHTML = `📡 送信待ち ${n}件（電波が戻ると自動で送ります）<button class="ghost small" id="pendSend">今すぐ送る</button>`;
  $('#pendSend').onclick = async () => { const ok = await SupabaseStore.flushOutbox(); if (ok) await refreshAll(); else toast(navigator.onLine ? '送れませんでした。もう一度お試しください' : 'まだ圏外です'); };
}
async function refreshAll() {
  [S.records, S.boards, S.spots, S.events, S.assignments] = await Promise.all([store.loadRecords(), store.loadBoards(), store.loadSpots(), store.loadEvents(), store.loadAssignments()]);
  renderAll();
}

/* ---------------- ボトムシート ---------------- */
function openSheet(html) { S.sheetGuard = null; $('#sheetBody').innerHTML = html; $('#sheet').hidden = false; }
function userCloseSheet() { if (S.sheetGuard && !confirm(S.sheetGuard)) return; if (S.sheetGuard) clearDraft(); S.sheetGuard = null; closeSheet(); }
function closeSheet() {
  $('#sheet').hidden = true;
  // 長押しで立てた赤ピンは、シートをどう閉じても消す（スマホで「閉じる」を押しても残ることがあった対策）
  if (S.searchMarker?._quick) { S.searchMarker.setMap(null); S.searchMarker = null; }
}

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
  const flyerRow = (row) => `<div class="rowItem flyerLine" data-id="${esc(row.id || uid())}"><select class="fFlyer">${flyers.map(f => `<option value="${esc(f.id)}" ${row.flyer_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select><input class="fCount" type="number" inputmode="numeric" min="0" value="${row.count}" placeholder="枚数"><button class="icon delLine" title="このチラシを外す">🗑</button></div>`;
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
  S.sheetGuard = '入力中の内容（描いた範囲）が消えます。閉じますか？';
  if (isNew) { S.draftForm = rec.polygon; saveDraft({ stage: 'form', ring: rec.polygon, form: formDraftValues() }); }
  const locked = isLocked();
  if (locked) { $('#addLine').hidden = true; const d = new Date(S.settings.noticeDate); d.setDate(d.getDate() - 1); $('#fDate').max = d.toISOString().slice(0, 10); }
  $('#fCancel').onclick = () => { if (isNew && !confirm('描いた範囲と入力内容を捨てますか？')) return; clearDraft(); closeSheet(); };
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
    clearDraft(); closeSheet(); renderAll(); toast(navigator.onLine ? '保存しました' : '端末に保存しました（電波が戻ると送ります）');
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
      ${list.some(x => x._pending) ? '<dt>状態</dt><dd>⏳ 送信待ち（電波が戻ると自動で送ります）</dd>' : ''}
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
async function downloadOrShare(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  try { const file = new File([blob], filename, { type: mime }); if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: filename }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
function exportCsv(recs) {
  const head = ['日付', '配った人', 'チラシ', '部数', '推定世帯', '主な町丁目', '面積m2', 'メモ', '登録日時'];
  const rows = recs.map(r => [r.date, r.member, flyerOf(r.flyer_id).name, r.count, r.est_setai ?? '', r.town ?? '', r.area_m2 ?? '', r.memo ?? '', r.created_at]);
  const csv = '﻿' + [head, ...rows].map(a => a.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  downloadOrShare(`チラシ配布_${today()}.csv`, csv, 'text/csv');
}

function showTownTable(mode = 'has') {
  const recs = mode === 'zero' ? S.records.filter(r => S.filter.flyers.has(r.flyer_id)) : filteredRecords();
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
    <div class="small">国勢調査（2020年）の世帯数に対する面積ベースの推定。${mode === 'zero' ? '世帯数が多い未配布の町丁目から並べています（期間に関係なく全記録で判定）' : `（${S.filter.period === 'all' ? '全期間' : '直近' + S.filter.period + '日'}の記録）`}${rows.length > shown.length ? `　※上位${shown.length}件を表示` : ''}</div>
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
  const s = { ...S.settings, flyers: S.settings.flyers.map(f => ({ ...f })) }; const origMembers = [...s.members];
  openSheet(`
    <h3>設定</h3>
    <h4 style="margin:12px 0 4px">チラシの種類</h4>
    <div class="small">色／名前／用意した枚数（入れると残り枚数が出ます）</div>
    <div id="flyerRows">${s.flyers.map(f => flyerRow(f)).join('')}</div>
    <button class="ghost" id="addFlyer" style="padding:8px 12px;border-radius:8px;margin-top:6px">＋ チラシを追加</button>
    ${USE_SUPABASE && isAdmin() ? `
    <h4 style="margin:18px 0 4px">メンバーのアカウント（ID・パスワード）<span class="small" style="font-weight:400">　管理者のみ</span></h4>
    <div class="small">ここで発行したIDとパスワードだけがログインできます。停止すると、その人はすぐ使えなくなります（記録は残ります）</div>
    <div id="acctList" class="small" style="margin:6px 0">読み込み中…</div>
    <div class="rowItem acctNew"><input type="text" id="acctId" placeholder="ID（半角英数字 3〜20）" autocapitalize="off"><input type="text" id="acctNick" placeholder="表示名（例：野口）"><select id="acctRole"><option value="member">配布メンバー</option><option value="admin">管理者</option></select><button class="ghost" id="acctAdd">＋ 発行</button></div>
    <label class="small" style="display:block;margin-top:4px">パスワードを決めて発行する場合（8文字以上。空欄なら自動で作ります）<input type="text" id="acctPw" autocapitalize="off" autocomplete="off" placeholder="例：12345678"></label>
    <h4 style="margin:18px 0 4px">配った人として選べる名前<span class="small" style="font-weight:400">　管理者のみ</span></h4>
    <div class="small">アカウントの表示名は自動で入ります。アカウントを持たない人（過去の記録用など）だけ、ここに足してください</div>` : USE_SUPABASE ? `
    <h4 style="margin:18px 0 4px">メンバーのアカウント<span class="small" style="font-weight:400">　発行・停止・パスワード再発行は管理者だけができます</span></h4>
    <div id="acctList" class="small" style="margin:6px 0">読み込み中…</div>
    <h4 style="margin:18px 0 4px">配った人として選べる名前<span class="small" style="font-weight:400">　変更は管理者に依頼</span></h4>` : `
    <h4 style="margin:18px 0 4px">メンバー（配る人）</h4>`}
    <label>1行に1人<textarea id="sMembers" rows="4" ${USE_SUPABASE && !isAdmin() ? 'readonly style="opacity:.6"' : ''}>${esc(s.members.join('\n'))}</textarea></label>
    ${USE_SUPABASE ? '' : `<h4 style="margin:18px 0 4px">管理者</h4>
    <label>1行に1人。空欄なら全員が設定・削除できます。入れると、その人だけが設定変更・削除・割り当て作成・一覧取り込みをできます<textarea id="sAdmins" rows="2">${esc((s.admins || []).join('\n'))}</textarea></label>`}
    <h4 style="margin:18px 0 4px">任期満了日（二連ポスターの撤去期限の計算用）</h4>
    <label>候補者名入りの政治活動用ポスターは、この日の6か月前の翌日から掲示禁止<input id="sTermEnd" type="date" value="${esc(s.termEndDate || '')}"></label>
    <h4 style="margin:18px 0 4px">告示日</h4>
    <label>この日以降は登録をロックします<input id="sNotice" type="date" value="${esc(s.noticeDate || '')}"></label>
    <div class="btnRow"><button class="ghost" id="sCancel">やめる</button><button class="primary" id="sSave">保存する</button></div>
    <p class="small" style="margin-top:14px">${USE_SUPABASE ? 'この設定と記録は全員で共有されます（15秒ごとに自動で同期）。IDとパスワードの発行・停止は管理者だけができます。' : '端末内保存版：この設定と記録はこの端末のブラウザにだけ保存されます。'}</p>
  `);
  $('#addFlyer').onclick = () => {
    const color = PALETTE[$('#flyerRows').children.length % PALETTE.length];
    $('#flyerRows').insertAdjacentHTML('beforeend', flyerRow({ id: uid(), name: '', color }));
    bindFlyerRows();
  };
  bindFlyerRows();
  if (USE_SUPABASE) renderAccounts();
  $('#sCancel').onclick = closeSheet;
  $('#sSave').onclick = async () => {
    const flyers = [...$('#flyerRows').querySelectorAll('.rowItem')].map(r => ({ id: r.dataset.id, name: r.querySelector('input[type=text]').value.trim(), color: r.querySelector('input[type=color]').value, total: Number(r.querySelector('.totalInp').value) || 0 })).filter(f => f.name);
    if (!flyers.length) { toast('チラシを1つ以上登録してください'); return; }
    s.flyers = flyers;
    // 名前の一覧は管理者だけが変えられる（一般メンバーは元のまま保存）
    const typed = (USE_SUPABASE && !isAdmin()) ? [...origMembers] : $('#sMembers').value.split('\n').map(x => x.trim()).filter(Boolean);
    const admins = USE_SUPABASE ? [] : $('#sAdmins').value.split('\n').map(x => x.trim()).filter(Boolean);
    if (!USE_SUPABASE && admins.length && !admins.includes(S.user) && !confirm('自分（' + S.user + '）が管理者に入っていません。保存すると設定を開けなくなります。よろしいですか？')) return;
    s.admins = admins;
    s.termEndDate = $('#sTermEnd').value || '';
    s.noticeDate = $('#sNotice').value;
    $('#sSave').disabled = true;
    try {
      // 直前にサーバーの最新を取り、他端末で追加された名前が消えないように和集合にする（消したい名前は元の一覧から外した分だけ）
      const fresh = await store.loadSettings();
      const removed = origMembers.filter(m => !typed.includes(m));
      s.members = [...new Set([...typed, ...fresh.members.filter(m => !removed.includes(m))])];
      await store.saveSettings(s);
    } catch { $('#sSave').disabled = false; return; }
    S.settings = normalizeSettings(s);
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


/* ---------------- アカウント管理（管理者・Supabase時） ---------------- */
async function renderAccounts() {
  const el = $('#acctList'); if (!el) return;
  let list; try { list = await SupabaseStore.listMembers(); } catch (e) { el.textContent = '一覧を読み込めません（' + (e.message || '通信') + '）'; return; }
  const me = S.me?.login_id;
  if (!isAdmin()) {   // 一般メンバーには見るだけの一覧（ボタンなし）
    el.innerHTML = `<table class="acctTbl"><tr><th>ID</th><th>表示名</th><th>権限</th><th>状態</th></tr>` + list.map(m => `<tr class="${m.active ? '' : 'off'}"><td><b>${esc(m.login_id)}</b>${m.login_id === me ? '<br><span class="small">（自分）</span>' : ''}</td><td>${esc(m.nickname)}</td><td>${m.role === 'admin' ? '管理者' : '配布'}</td><td>${m.auth_uid ? (m.active ? '有効' : '停止中') : '未作成'}</td></tr>`).join('') + '</table>';
    return;
  }
  el.innerHTML = `<table class="acctTbl"><tr><th>ID</th><th>表示名</th><th>権限</th><th>状態</th><th></th></tr>` + list.map(m => `<tr data-id="${esc(m.login_id)}" class="${m.active ? '' : 'off'}">
      <td><b>${esc(m.login_id)}</b>${m.login_id === me ? '<br><span class="small">（自分）</span>' : ''}</td>
      <td><input type="text" class="aNick" value="${esc(m.nickname)}"></td>
      <td><select class="aRole" ${m.login_id === me ? 'disabled' : ''}><option value="member" ${m.role === 'member' ? 'selected' : ''}>配布</option><option value="admin" ${m.role === 'admin' ? 'selected' : ''}>管理者</option></select></td>
      <td>${m.auth_uid ? (m.active ? '有効' : '停止中') : '<span style="color:#ffb454">未作成</span>'}</td>
      <td class="aBtns">${m.auth_uid ? `<button class="ghost aPw">パスワード再発行</button>` : `<button class="ghost aCreate">パスワード発行</button>`}${m.login_id === me ? '' : `<button class="ghost aToggle">${m.active ? '停止' : '再開'}</button><button class="ghost aDel" style="color:#ff7b72">削除</button>`}</td>
    </tr>`).join('') + '</table>';
  const row = b => b.closest('tr'); const idOf = b => row(b).dataset.id;
  const setMember = async (b, patch) => { const r = row(b); const m = list.find(x => x.login_id === r.dataset.id);
    try { await SupabaseStore.adminSetMember(m.login_id, r.querySelector('.aNick').value.trim() || m.nickname, patch.role ?? r.querySelector('.aRole').value, patch.active ?? m.active); toast('変更しました'); renderAccounts(); }
    catch (e) { toast('変更できません：' + e.message, 4000); } };
  el.querySelectorAll('.aNick').forEach(i => i.onchange = () => setMember(i, {}));
  el.querySelectorAll('.aRole').forEach(i => i.onchange = () => setMember(i, { role: i.value }));
  el.querySelectorAll('.aToggle').forEach(b => b.onclick = () => { const m = list.find(x => x.login_id === idOf(b)); if (confirm(`${m.nickname}（${m.login_id}）を${m.active ? '停止' : '再開'}しますか？`)) setMember(b, { active: !m.active }); });
  el.querySelectorAll('.aDel').forEach(b => b.onclick = async () => { const m = list.find(x => x.login_id === idOf(b)); if (!confirm(`${m.nickname}（${m.login_id}）のアカウントを削除しますか？（記録は残ります。通常は「停止」で十分です）`)) return; try { await SupabaseStore.adminDeleteMember(m.login_id); toast('削除しました'); renderAccounts(); } catch (e) { toast('削除できません：' + e.message, 4000); } });
  el.querySelectorAll('.aCreate').forEach(b => b.onclick = async () => { const m = list.find(x => x.login_id === idOf(b)); const pw = tempPassword(); b.disabled = true;
    try { await SupabaseStore.createAuthUser(m.login_id, pw); showCredentials(m.login_id, pw, m.nickname); renderAccounts(); } catch (e) { toast(e.message, 5000); b.disabled = false; } });
  el.querySelectorAll('.aPw').forEach(b => b.onclick = async () => { const m = list.find(x => x.login_id === idOf(b)); const typed = prompt(`${m.nickname}（${m.login_id}）の新しいパスワード（8文字以上）。空のままOKなら自動で作ります。今のパスワードは使えなくなります`, ''); if (typed === null) return; if (typed && typed.length < 8) { toast('8文字以上にしてください'); return; } const pw = typed || tempPassword();
    try { await SupabaseStore.adminResetPassword(m.login_id, pw); showCredentials(m.login_id, pw, m.nickname); } catch (e) { toast('再発行できません：' + e.message, 4000); } });
  const addBtn = $('#acctAdd'); if (addBtn) addBtn.onclick = async () => {
    const id = $('#acctId').value.trim().toLowerCase(), nick = $('#acctNick').value.trim(), role = $('#acctRole').value;
    if (!/^[a-z0-9_]{3,20}$/.test(id)) { toast('IDは半角の英小文字・数字・_ で3〜20文字にしてください'); return; }
    if (!nick) { toast('表示名を入れてください'); return; }
    const typedPw = ($('#acctPw')?.value || '').trim();
    if (typedPw && typedPw.length < 8) { toast('パスワードは8文字以上にしてください'); return; }
    addBtn.disabled = true; const pw = typedPw || tempPassword();
    try { await SupabaseStore.adminAddMember(id, nick, role); await SupabaseStore.createAuthUser(id, pw); $('#acctId').value = ''; $('#acctNick').value = ''; showCredentials(id, pw, nick); }
    catch (e) { toast(e.message, 5000); }
    addBtn.disabled = false; renderAccounts();
  };
}
// 発行したID・パスワードを表示（この場でしか見られない。LINEに貼れる文面つき）
function showCredentials(id, pw, nick) {
  const text = credentialText(id, pw, nick);
  $('#sheetBody').innerHTML = `<h3>発行しました</h3>
    <div class="small" style="color:#ffb454">パスワードはこの画面を閉じると二度と表示されません。今すぐ本人に渡してください（再発行はいつでもできます）</div>
    <pre class="credBox">${esc(text)}</pre>
    <div class="btnRow"><button class="ghost" id="credBack">設定に戻る</button><button class="primary" id="credCopy">📋 文面をコピー</button></div>`;
  $('#credCopy').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('コピーしました。LINEなどで本人に送ってください'); } catch { toast('コピーできませんでした。長押しで選択してください'); } };
  $('#credBack').onclick = () => { showSettings(); };
}

/* ---------------- ゴミ箱・操作履歴（管理者・Supabase時） ---------------- */
const TRASH_TYPES = [['records', '配布記録'], ['boards', 'ポスター'], ['spots', '拠点・辻立ち'], ['spot_events', '予定・実績'], ['assignments', '割り当て']];
const TBL_NAME = { records: '配布記録', boards: 'ポスター', spots: '拠点', spot_events: '予定', assignments: '割り当て', settings: '設定' };
const FIELD_NAME = { count: '枚数', date: '日付', member: '担当', memo: 'メモ', flyer_id: 'チラシ', status: '状態', no: '番号', place: '場所', name: '名前', lat: '緯度', lng: '経度', posted_by: '貼った人', posted_at: '貼った日', photo_path: '写真', due: '期限', note: 'メモ', time: '時刻', done: '実施', attendees: '参加者', kind: '種類', data: '内容', est_setai: '推定世帯', town: '町名', area_m2: '面積', group_id: 'まとまり', deleted: '削除', spot_id: '場所', created_by: '作成者' };
const fmtDT = s => { if (!s) return ''; const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtVal = v => v == null || v === '' ? '（空）' : typeof v === 'object' ? '…' : String(v).slice(0, 24);
function itemLabel(tbl, r) {
  r = r || {};
  if (tbl === 'records') return `${r.date || ''} ${r.member || ''} ${r.flyer_id ? flyerOf(r.flyer_id).name : ''} ${r.count ?? ''}枚 ${r.town || ''}`;
  if (tbl === 'boards') return `${r.no ? r.no + ' ' : ''}${r.place || ''}（${BOARD_KIND[r.kind]?.short || r.kind || ''}）`;
  if (tbl === 'spots') return r.name || '';
  if (tbl === 'spot_events') return `${r.date || ''} ${r.time || ''} ${S.spots.find(s => s.id === r.spot_id)?.name || ''} ${r.member || ''}`;
  if (tbl === 'assignments') return `${r.town || ''} ${r.member || ''}${r.due ? ' 〜' + r.due : ''}`;
  if (tbl === 'settings') return '設定';
  return r.id || '';
}
async function showTrash(tbl = 'records') {
  if (!USE_SUPABASE) { toast('端末内保存版にはゴミ箱がありません'); return; }
  openSheet(`<h3>🗑 ゴミ箱</h3><div class="small">削除したものは消えずにここに残ります。「元に戻す」で復活します</div>
    <div class="stTabs">${TRASH_TYPES.map(([t, n]) => `<button data-t="${t}" class="${t === tbl ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div id="trashList" class="small" style="margin-top:8px">読み込み中…</div>
    <div class="btnRow"><button class="primary" id="trClose">閉じる</button></div>`);
  $('#trClose').onclick = closeSheet;
  $('#sheetBody').querySelectorAll('.stTabs button').forEach(b => b.onclick = () => showTrash(b.dataset.t));
  const { data, error } = await SupabaseStore.client.from(tbl).select('*').eq('deleted', true).order('updated_at', { ascending: false }).limit(200);
  const el = $('#trashList'); if (!el) return;
  if (error) { el.textContent = '読み込めません（' + error.message + '）'; return; }
  if (!data.length) { el.textContent = '削除されたものはありません'; return; }
  el.innerHTML = data.map(r => `<div class="trItem" data-id="${esc(r.id)}"><span class="t">${esc(itemLabel(tbl, r))}<br><span class="small">削除 ${esc(fmtDT(r.updated_at))}</span></span><button class="ghost small trRestore">元に戻す</button></div>`).join('');
  el.querySelectorAll('.trRestore').forEach(b => b.onclick = async () => {
    const id = b.closest('.trItem').dataset.id; b.disabled = true;
    const { error } = await SupabaseStore.client.from(tbl).update({ deleted: false, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { toast('戻せませんでした：' + error.message, 4000); b.disabled = false; return; }
    toast('元に戻しました'); await refreshAll(); showTrash(tbl);
  });
}
function histSummary(x) {
  const a = x.before || {}, b = x.after || {};
  if (x.op === 'insert') return '追加：' + itemLabel(x.tbl, b);
  if (x.op === 'delete') return '完全削除：' + itemLabel(x.tbl, a);
  if (a.deleted === false && b.deleted === true) return '削除：' + itemLabel(x.tbl, a);
  if (a.deleted === true && b.deleted === false) return '復元：' + itemLabel(x.tbl, b);
  const skip = new Set(['updated_at', 'created_at', 'id']);
  const diffs = Object.keys(b).filter(k => !skip.has(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])).map(k => k === 'polygon' ? '範囲を変更' : `${FIELD_NAME[k] || k} ${fmtVal(a[k])}→${fmtVal(b[k])}`);
  return (itemLabel(x.tbl, b) + '：' + (diffs.join('、') || '変更')).slice(0, 180);
}
async function showHistory(actor = '') {
  if (!USE_SUPABASE) return;
  openSheet(`<h3>🕘 操作履歴</h3><div class="small">誰が・いつ・何を変えたか（新しい順・直近200件）。「戻す」でその変更の前の状態に戻します</div>
    <label>人で絞る<select id="histActor"><option value="">全員</option></select></label>
    <div id="histList" class="small" style="margin-top:8px">読み込み中…</div>
    <div class="btnRow"><button class="primary" id="hClose">閉じる</button></div>`);
  $('#hClose').onclick = closeSheet;
  let q = SupabaseStore.client.from('audit_log').select('*').order('at', { ascending: false }).limit(200); if (actor) q = q.eq('actor', actor);
  const { data, error } = await q; const el = $('#histList'); if (!el) return;
  if (error) { el.textContent = /audit_log|relation|schema cache|does not exist/i.test(error.message) ? '操作履歴はまだ有効になっていません（データベースの更新待ち）' : '読み込めません（' + error.message + '）'; return; }
  const sel = $('#histActor');
  const actors = [...new Set(data.map(x => x.actor).filter(Boolean))]; if (actor && !actors.includes(actor)) actors.push(actor);
  sel.innerHTML = '<option value="">全員</option>' + actors.map(a => `<option ${a === actor ? 'selected' : ''}>${esc(a)}</option>`).join('');
  sel.onchange = () => showHistory(sel.value);
  if (!data.length) { el.textContent = '履歴はまだありません'; return; }
  el.innerHTML = data.map(x => `<div class="trItem" data-id="${x.id}"><span class="t"><span class="small">${esc(fmtDT(x.at))}</span> <b>${esc(x.actor || '?')}</b> ${esc(TBL_NAME[x.tbl] || x.tbl)}<br>${esc(histSummary(x))}</span>${x.tbl === 'settings' && x.op === 'insert' ? '' : `<button class="ghost small hUndo">戻す</button>`}</div>`).join('');
  el.querySelectorAll('.hUndo').forEach(b => b.onclick = async () => {
    const id = b.closest('.trItem').dataset.id; if (!confirm('この変更の前の状態に戻しますか？（戻したこと自体も履歴に残ります）')) return; b.disabled = true;
    const { error } = await SupabaseStore.client.rpc('undo_change', { p_log_id: Number(id) });
    if (error) { toast('戻せませんでした：' + error.message, 4000); b.disabled = false; return; }
    toast('戻しました'); await refreshAll(); if (S.settings) { try { S.settings = await store.loadSettings(); renderAll(); } catch { } } showHistory(actor);
  });
}

/* ---------------- 全データの書き出し・読み込み（バックアップ／別の場所への移植） ---------------- */
const BACKUP_TABLES = ['records', 'boards', 'spots', 'spot_events', 'assignments'];
const TABLE_JA = { records: '配布記録', boards: 'ポスター掲示場', spots: '拠点・辻立ち', spot_events: '予定・実績', assignments: '割り当て' };
async function collectAll() {
  const out = { app: 'chirashi-map', version: 1, exported_at: new Date().toISOString(), exported_by: S.user || '', settings: S.settings };
  if (USE_SUPABASE) {
    for (const t of BACKUP_TABLES) {   // 削除済み（ゴミ箱）も含めて全部（1,000件ずつ）
      const rows = []; for (let from = 0; ; from += 1000) { const { data, error } = await SupabaseStore.client.from(t).select('*').order('id').range(from, from + 999); if (error) throw new Error(t + ': ' + error.message); rows.push(...(data || [])); if (!data || data.length < 1000) break; }
      out[t] = rows;
    }
    try { out.members = (await SupabaseStore.listMembers()).map(m => ({ login_id: m.login_id, nickname: m.nickname, role: m.role, active: m.active })); } catch { }
  } else {
    out.records = await store.loadRecords(); out.boards = await store.loadBoards(); out.spots = await store.loadSpots(); out.spot_events = await store.loadEvents(); out.assignments = await store.loadAssignments();
  }
  return out;
}
const ymd = () => today().replace(/-/g, '');
function toCsv(rows, cols) { return '﻿' + [cols, ...rows.map(r => cols.map(c => r[c] == null ? '' : typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c]))].map(a => a.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n'); }
function boardsKml(boards) {
  const pm = boards.filter(b => typeof b.lat === 'number' && !b.deleted).map(b => `<Placemark><name>${esc(String(b.no || ''))} ${esc(b.place || '')}</name><description>${esc(`${BOARD_KIND[b.kind || 'official']?.name || ''}\n状態：${b.status === 'done' ? '貼った' : 'まだ'}\n${(b.memo || '')}`)}</description><Point><coordinates>${b.lng},${b.lat},0</coordinates></Point></Placemark>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>ポスター掲示場 ${ymd()}</name>${pm}</Document></kml>`;
}
function showBackup() {
  openSheet(`<h3>💾 全データの書き出し・読み込み</h3>
    <div class="small">書き出したファイルは、URLや保存先が変わっても「読み込み」でそのまま移せます。写真は含みません（写真は毎晩のバックアップとは別に、必要なら個別に保存してください）</div>
    <h4 style="margin:12px 0 4px">書き出し（バックアップ）</h4>
    <div class="btnRow"><button class="primary" id="bkJson">📦 全部まとめて（JSON）</button></div>
    <div class="btnRow"><button class="ghost" id="bkCsvRec">配布記録 CSV</button><button class="ghost" id="bkCsvBoard">掲示場 CSV</button><button class="ghost" id="bkKml">掲示場 KML（Googleマップ用）</button></div>
    <h4 style="margin:16px 0 4px">読み込み（移植・復元）</h4>
    <div class="small">上の「全部まとめて（JSON）」で作ったファイルを選びます。同じIDのものは上書き、無いものは追加されます。消えるものはありません</div>
    <label class="ghost fileBtn" style="display:inline-block;margin-top:6px">📂 JSONファイルを選ぶ<input id="bkFile" type="file" accept=".json,application/json" hidden></label>
    <div id="bkResult" class="small" style="margin-top:8px"></div>
    <div class="btnRow"><button class="ghost" id="bkClose">閉じる</button></div>`);
  $('#bkClose').onclick = closeSheet;
  const busy = (b, on) => { b.disabled = on; };
  $('#bkJson').onclick = async () => { const b = $('#bkJson'); busy(b, true); try { const all = await collectAll(); const n = BACKUP_TABLES.map(t => `${TABLE_JA[t]} ${(all[t] || []).length}件`).join('・'); await downloadOrShare(`chirashi-map-backup-${ymd()}.json`, JSON.stringify(all, null, 1), 'application/json'); toast('書き出しました：' + n, 5000); } catch (e) { toast('書き出しに失敗：' + e.message, 5000); } busy(b, false); };
  $('#bkCsvRec').onclick = async () => { const all = await collectAll(); const recs = (all.records || []).filter(r => !r.deleted).map(r => ({ ...r, チラシ名: flyerOf(r.flyer_id).name })); await downloadOrShare(`配布記録-${ymd()}.csv`, toCsv(recs, ['id', 'date', 'member', 'flyer_id', 'チラシ名', 'count', 'est_setai', 'town', 'area_m2', 'memo', 'group_id', 'created_at', 'updated_at', 'polygon']), 'text/csv'); };
  $('#bkCsvBoard').onclick = async () => { const all = await collectAll(); const rows = (all.boards || []).filter(b => !b.deleted); await downloadOrShare(`掲示場-${ymd()}.csv`, toCsv(rows, ['id', 'kind', 'no', 'place', 'lat', 'lng', 'status', 'posted_by', 'posted_at', 'photo_path', 'memo', 'created_at', 'updated_at']), 'text/csv'); };
  $('#bkKml').onclick = async () => { const all = await collectAll(); await downloadOrShare(`掲示場-${ymd()}.kml`, boardsKml(all.boards || []), 'application/vnd.google-earth.kml+xml'); };
  $('#bkFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return; const res = $('#bkResult');
    let d; try { d = JSON.parse(await f.text()); } catch { res.textContent = 'JSONとして読めません'; return; }
    if (d.app !== 'chirashi-map') { res.textContent = 'このアプリの書き出しファイルではありません'; return; }
    const counts = BACKUP_TABLES.map(t => `${TABLE_JA[t]} ${(d[t] || []).length}件`).join('、');
    if (!confirm(`${d.exported_at ? d.exported_at.slice(0, 10) + ' に書き出されたデータ' : 'データ'}を読み込みます。\n${counts}\n設定（チラシの種類・メンバー名など）も上書きします。よろしいですか？`)) { e.target.value = ''; return; }
    res.textContent = '読み込み中…';
    try {
      if (USE_SUPABASE) {
        for (const t of BACKUP_TABLES) { const rows = (d[t] || []).map(r => { const { _pending, ...x } = r; return x; }); for (let i = 0; i < rows.length; i += 200) { const { error } = await SupabaseStore.client.from(t).upsert(rows.slice(i, i + 200)); if (error) throw new Error(t + ': ' + error.message); } }
        if (d.settings) await store.saveSettings(normalizeSettings(d.settings));
      } else {
        localStorage.setItem(LocalStore.key, JSON.stringify(d.records || [])); localStorage.setItem(LocalStore.bkey, JSON.stringify(d.boards || []));
        LocalStore._s('cm_spots_v1', d.spots || []); LocalStore._s('cm_events_v1', d.spot_events || []); LocalStore._s('cm_assign_v1', d.assignments || []);
        if (d.settings) await store.saveSettings(normalizeSettings(d.settings));
      }
      S.settings = await store.loadSettings(); await refreshAll();
      res.textContent = '読み込みました：' + counts + (d.members ? '。メンバーのアカウントは含まれないので、設定画面で発行し直してください' : '');
      toast('読み込みました');
    } catch (err) { res.textContent = '読み込みに失敗：' + err.message; }
    e.target.value = '';
  };
}

/* ---------------- 赤ピンで位置を合わせる（拠点・掲示場の追加／位置修正） ---------------- */
function startPinPlace(latLng, onDone, hint) {
  endPinPlace(false);
  if (S.drawing || S.adjust) { toast('先に「決定」か「中止」を押してください'); return; }
  closeSheet(); S.infoWin.close(); setBarsLocked(true);
  const m = new google.maps.Marker({ position: latLng, map: S.map, draggable: true, zIndex: 60, animation: google.maps.Animation.DROP, crossOnDrag: false,
    icon: { path: 'M 0,0 C -2,-6 -14,-9 -14,-20 A 14,14 0 1,1 14,-20 C 14,-9 2,-6 0,0 Z', fillColor: '#e53935', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1.4, labelOrigin: new google.maps.Point(0, -20) }, label: { text: '●', color: '#fff', fontSize: '10px' } });
  S.pin = { marker: m, onDone };
  $('#pinHint').textContent = hint || '赤いピンをドラッグして位置を合わせ、「ここに決定」';
  $('#pinBar').hidden = false; $('#fab').hidden = true;
  S.map.panTo(latLng);
}
function endPinPlace(ok) {
  const p = S.pin; if (!p) return;
  const pos = p.marker.getPosition(); p.marker.setMap(null); S.pin = null; setBarsLocked(false);
  $('#pinBar').hidden = true; $('#fab').hidden = false; renderRecords();
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
const BOARD_ST_LABEL = k => BOARD_STYLE[k]?.name || '不明';
const BOARD_KIND = { official: { name: '選挙用ポスター掲示場', short: '掲示場' }, general: { name: '一般ポスター（支援者宅・店舗など）', short: '一般' }, political: { name: '政治活動用ポスター（二連・演説会告知）', short: '二連' } };
function politicalColor(b) { if (!b.posted_at) return '#9aa7b4'; const d = (new Date(today()) - new Date(b.posted_at)) / 86400000; return d < 90 ? '#3fb950' : d < 180 ? '#facc15' : '#ef4444'; }
function posterBanDate() { const t = S.settings?.termEndDate; if (!t) return null; const d = new Date(t); d.setMonth(d.getMonth() - 6); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
// 看板の形のアイコン（SVG）。絵が主役：掲示板にポスターが貼られた図。色＝状態、番号は下に小さく
function boardIcon(kind, color, text, status, scale = 1) {
  const t = esc(String(text || '').slice(0, 4));
  const size = new google.maps.Size(Math.round(48 * scale), Math.round(56 * scale)), anchor = new google.maps.Point(Math.round(24 * scale), Math.round(52 * scale));
  const mark = status === 'done' ? '✓' : status === 'damaged' ? '!' : status === 'check' ? '?' : status === 'working' ? '…' : status === 'reserved' ? '予' : '';
  const bc = status === 'done' ? '#16a34a' : status === 'damaged' ? '#dc2626' : status === 'check' ? '#d97706' : '#2563eb';   // 印の色は状態ごと（完了＝緑）
  const badge = mark ? `<circle cx='40' cy='8' r='8' fill='#fff' stroke='${bc}' stroke-width='2'/><text x='40' y='11.5' font-size='10' font-weight='700' text-anchor='middle' fill='${bc}' font-family='sans-serif'>${mark}</text>` : '';
  const board = kind === 'general'
    // 貼り紙：紙1枚に候補者ポスター風の色面
    ? `<rect x='10' y='8' width='28' height='30' rx='2' fill='#fff' stroke='#333' stroke-width='1.5'/><rect x='13' y='11' width='22' height='14' fill='${color}' opacity='.9'/><rect x='13' y='27' width='22' height='3' fill='#333'/><rect x='13' y='32' width='14' height='3' fill='#777'/>`
    // 掲示板：木の支柱＋白い板に4枚のポスター
    : `<rect x='22' y='34' width='4' height='14' fill='#6b4f2a'/><rect x='5' y='6' width='38' height='30' rx='2' fill='#f7f3e8' stroke='#5b4630' stroke-width='2'/><rect x='9' y='10' width='14' height='10' fill='${color}'/><rect x='25' y='10' width='14' height='10' fill='#e11d48' opacity='.75'/><rect x='9' y='22' width='14' height='10' fill='#2563eb' opacity='.75'/><rect x='25' y='22' width='14' height='10' fill='#f59e0b' opacity='.75'/>`;
  const num = t ? `<rect x='12' y='40' width='24' height='13' rx='6.5' fill='#111' opacity='.85'/><text x='24' y='50' font-size='10' font-weight='700' text-anchor='middle' fill='#fff' font-family='sans-serif'>${t}</text>` : '';
  if (kind === 'political') {
    const board2 = `<rect x='6' y='8' width='16' height='26' rx='1.5' fill='#fff' stroke='#333' stroke-width='1.5'/><rect x='26' y='8' width='16' height='26' rx='1.5' fill='#fff' stroke='#333' stroke-width='1.5'/><rect x='8' y='10' width='12' height='9' fill='${color}'/><rect x='28' y='10' width='12' height='9' fill='${color}'/><rect x='8' y='21' width='12' height='2' fill='#333'/><rect x='28' y='21' width='12' height='2' fill='#333'/><rect x='8' y='25' width='9' height='2' fill='#333'/><rect x='28' y='25' width='9' height='2' fill='#333'/>`;
    const svg2 = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='56' viewBox='0 0 48 56'><rect x='1' y='1' width='46' height='54' rx='8' fill='${color}' stroke='#fff' stroke-width='2'/><rect x='4' y='4' width='40' height='48' rx='6' fill='#fff' opacity='.25'/>${board2}${num}${badge}</svg>`;
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg2), scaledSize: size, anchor };
  }
  if (kind === 'official') {
    // 公営掲示場：市町村の色の四角の中に番号（本人指定。状態は右上の小さな印で表す）
    const fs = t.length >= 3 ? 15 : t.length === 2 ? 19 : 22;
    // 貼った掲示場は白地＋緑の縁と数字（稲沢の濃い緑など市町村色と見分けがつくように）
    // 「貼った」は市町村色の反対色（renderBoards で color に渡される）＋右上に✓
    const done = status === 'done';
    const svgO = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='56' viewBox='0 0 48 56'><path d='M17,43 L24,52 L31,43 Z' fill='${color}'/><rect x='4' y='4' width='40' height='40' rx='9' fill='${color}' stroke='#fff' stroke-width='3'/><text x='24' y='${t.length >= 3 ? 29.5 : 31}' font-size='${fs}' font-weight='800' text-anchor='middle' fill='#fff' font-family='sans-serif'>${t}</text>${done ? `<circle cx='40' cy='8' r='8' fill='#fff' stroke='${color}' stroke-width='2'/><text x='40' y='11.5' font-size='10' font-weight='800' text-anchor='middle' fill='${color}' font-family='sans-serif'>✓</text>` : ''}</svg>`;
    return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svgO), scaledSize: size, anchor };
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='56' viewBox='0 0 48 56'><rect x='1' y='1' width='46' height='54' rx='8' fill='${color}' opacity='.25'/>${board}${num}${badge}</svg>`;
  return { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: size, anchor };
}
S.boardKindFilter = 'all';
function setLegend(open) { S.legendOpen = open; $('#legend').hidden = !open; $('#legendBtn').classList.toggle('on', open); }
/* ---------------- 掲示板チップ（公営掲示場を市町村ごとにON/OFF・端末ごと） ---------------- */
// 掲示場がどの市町村かは、座標から町丁目データで判定して記憶する（データベースに市町村の欄は持たない）
function boardCity(b) {
  S._boardCity = S._boardCity || new Map();
  const key = `${b.id}|${b.lat}|${b.lng}`;
  if (S._boardCity.has(key)) return S._boardCity.get(key);
  let city = null;
  if (S.towns.length && typeof b.lat === 'number') {
    try { const pt = turf.point([b.lng, b.lat]); const t = S.towns.find(t => bboxHit([b.lng, b.lat, b.lng, b.lat], t.bbox) && turf.booleanPointInPolygon(pt, t.feature)); city = t ? t.city : null; } catch { }
    S._boardCity.set(key, city);
  }
  return city;
}
function boardCitySet() { const all = Object.keys(ADMIN_COLORS); try { const a = JSON.parse(localStorage.getItem('cm_board_cities') || 'null'); return new Set(Array.isArray(a) ? a : all); } catch { return new Set(all); } }
function renderBoardChips() {
  const el = $('#boardChips'); if (!el) return;
  const off = S.boards.filter(b => (b.kind || 'official') === 'official');
  if (!off.length) { el.hidden = true; return; }
  el.hidden = false;
  const on = boardCitySet(); const all = Object.keys(ADMIN_COLORS);
  const counts = {}; for (const b of off) { const c = boardCity(b) || '__none'; counts[c] = (counts[c] || 0) + 1; }
  const cities = adminOrder().filter(n => counts[n]);
  const html = `<button class="chip ${cities.every(n => on.has(n)) ? 'on' : ''}" data-n="__all" style="--c:#555" title="全部の掲示板をON/OFF"><span class="dot" style="background:#ddd"></span>掲示板</button>` +
    cities.map(n => `<button class="chip ${on.has(n) ? 'on' : ''}" data-n="${esc(n)}" style="--c:${ADMIN_COLORS[n]}" title="${esc(n)}の公営掲示場 ${counts[n]}か所"><span class="dot"></span>${esc(n.replace(/(市|町|村)$/, ''))}<span class="sub">${counts[n]}</span></button>`).join('');
  if (el.dataset.html === html) return;   // 変化がなければ描き直さない
  el.dataset.html = html; el.innerHTML = html;
  el.querySelectorAll('.chip').forEach(b => b.onclick = () => {
    const cur = boardCitySet(); const n = b.dataset.n;
    if (n === '__all') { if (cities.every(x => cur.has(x))) cities.forEach(x => cur.delete(x)); else all.forEach(x => cur.add(x)); }
    else if (cur.has(n)) cur.delete(n); else cur.add(n);
    localStorage.setItem('cm_board_cities', JSON.stringify([...cur])); el.dataset.html = ''; renderBoards();
  });
}
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
  if (on && !guardMode()) return;
  S.boardAdding = on; if (on) S.spotAdding = false;
  $('#boardAddHint').hidden = !on;
  setAddingUI(on);
}
function renderBoards() {
  const off = S.boards.filter(b => (b.kind || 'official') === 'official'), gen = S.boards.filter(b => b.kind === 'general'), pol = S.boards.filter(b => b.kind === 'political');
  const cnt = a => { const d = a.filter(b => b.status === 'done').length; return `${d}/${a.length}${a.length ? `（${Math.round(d / a.length * 100)}%）` : ''}`; };
  const bad = S.boards.filter(b => b.status === 'damaged' || b.status === 'check').length;
  const ban = posterBanDate(); const banSoon = ban && pol.some(b => b.status === 'done') ? Math.ceil((new Date(ban) - new Date(today())) / 86400000) : null;
  $('#boardStat').textContent = `掲示場 ${cnt(off)}　一般 ${cnt(gen)}${pol.length ? `　二連 ${cnt(pol)}` : ''}${bad ? `　⚠${bad}` : ''}${banSoon != null && banSoon <= 60 ? `　🚫二連は${banSoon > 0 ? `あと${banSoon}日で` : ''}撤去期限${banSoon <= 0 ? '超過' : ''}` : ''}`;
  renderBoardChips();
  // 表示するもの：掲示場モード中はモードの絞り込みに従う。モード外でも「掲示板」チップがONの市町村の公営掲示場は常に出す
  const chipOn = boardCitySet();
  const vb = viewBbox(0.3);
  // 掲示場モード外（チップ表示）では、引いた地図で邪魔にならないよう小さく描く
  // 掲示場モード中も拡大率に合わせて小さく（大きすぎて範囲を囲めない、という指摘に対応）
  // 引いた時は小さく（重なり防止）、寄った時は大きく（番号を読みやすく）
  const z = S.map.getZoom(); const iconScale = z >= 16.5 ? 1.15 : z >= 15.5 ? 1 : z >= 14.5 ? 0.75 : z >= 13.5 ? 0.6 : 0.5;
  // まず「今回描くもの」を決め、前回と同じなら描き直さない（ピンチ操作のたびに数百個のピンを作り直してスマホが固まるのを防ぐ）
  const show = [];
  for (const b of S.boards) {
    const kind = b.kind || 'official';
    const inMode = S.boardsOn && (S.boardKindFilter === 'all' || kind === S.boardKindFilter);
    const inChip = kind === 'official' && chipOn.has(boardCity(b) || '__none');
    if (!inMode && !inChip) continue;
    if (vb && !bboxHit([b.lng, b.lat, b.lng, b.lat], vb)) continue;
    show.push(b);
  }
  const key = `${iconScale}|${S.boardsOn}|${overlaysClickable()}|` + show.map(b => `${b.id}:${b.status}:${b.lat}:${b.lng}:${b.no}`).join(',');
  if (key === S._boardKey && S.boardMarkers.size === show.length) return;
  S._boardKey = key;
  for (const m of S.boardMarkers.values()) m.setMap(null);
  S.boardMarkers.clear();
  // スマホのメモリ対策：引いた地図では小さな点だけ（番号なし）。数百個の画像を作らない
  const dotsOnly = z < 12.3;   // 町全体が見える程度（z13前後）までは番号つき、それより引いたら点だけ
  for (const b of show) {
    const kind = b.kind || 'official';
    const st = BOARD_STYLE[b.status] || BOARD_STYLE.todo;
    // 公営掲示場：貼ったら市町村色の反対色、まだなら市町村の色（津島＝紺、蟹江＝オレンジ、愛西＝ピンク…）
    const tm = kind === 'official' ? boardTeam(b) : null;   // 稲沢の班（色分け＋番号は班を外して表示）
    const color = kind === 'political' && b.status === 'done' ? politicalColor(b)
      : kind === 'official' ? (tm ? (b.status === 'done' ? INAZAWA_TEAM[tm.team].p : INAZAWA_TEAM[tm.team].c) : (b.status === 'done' ? postedColor(boardCity(b)) : (ADMIN_COLORS[boardCity(b)] || st.color)))
      : st.color;
    const dispNo = tm ? tm.num : String(b.no || '');
    let opts;
    if (kind === 'official' && dotsOnly) {
      opts = { icon: { path: google.maps.SymbolPath.CIRCLE, scale: 5, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 } };
    } else if (kind === 'official') {
      // 画像は「色×大きさ×貼った」ごとに1枚だけ作って使い回し、番号は文字ラベルで載せる（1件ごとに画像を作るとiPhoneのメモリが尽きて白画面になる）
      opts = { icon: officialIcon(color, iconScale, b.status === 'done'), label: dispNo ? { text: dispNo.slice(0, 5), color: '#fff', fontSize: `${Math.max(9, Math.round((dispNo.length >= 4 ? 11 : dispNo.length === 3 ? 13 : 16) * iconScale))}px`, fontWeight: '800', fontFamily: 'sans-serif' } : undefined };
    } else {
      opts = { icon: boardIcon(kind, color, b.no, b.status, iconScale) };
    }
    const m = new google.maps.Marker({
      position: { lat: b.lat, lng: b.lng }, map: S.map, zIndex: 20, clickable: overlaysClickable(), optimized: true, ...opts,
      title: `${b.no ? b.no + ' ' : ''}${b.place || ''}（${BOARD_ST_LABEL(b.status)}）`,
    });
    m.addListener('click', () => { if (overlaysClickable()) showBoard(b); });
    S.boardMarkers.set(b.id, m);
  }
}
// 公営掲示場の四角い画像（番号なし）。同じ色・大きさなら同じ画像を返す
const _officialIcons = new Map();
function officialIcon(color, scale, done) {
  const k = `${color}|${scale}|${done ? 1 : 0}`;
  if (_officialIcons.has(k)) return _officialIcons.get(k);
  const badge = done ? `<circle cx='40' cy='8' r='8' fill='#fff' stroke='${color}' stroke-width='2'/><text x='40' y='11.5' font-size='10' font-weight='800' text-anchor='middle' fill='${color}' font-family='sans-serif'>✓</text>` : '';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='56' viewBox='0 0 48 56'><path d='M17,43 L24,52 L31,43 Z' fill='${color}'/><rect x='4' y='4' width='40' height='40' rx='9' fill='${color}' stroke='#fff' stroke-width='3'/>${badge}</svg>`;
  const icon = { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg), scaledSize: new google.maps.Size(Math.round(48 * scale), Math.round(56 * scale)), anchor: new google.maps.Point(Math.round(24 * scale), Math.round(52 * scale)), labelOrigin: new google.maps.Point(Math.round(24 * scale), Math.round(24 * scale)) };
  _officialIcons.set(k, icon); return icon;
}
async function addBoardAt(latLng) {
  setBoardAdding(false);
  startPinPlace(latLng, pos => addBoardForm(pos), 'ポスターを貼る場所にピンを合わせて「ここに決定」');
}
async function addBoardForm(latLng) {
  const kind = ['general', 'political'].includes(S.boardKindFilter) ? S.boardKindFilter : 'official';
  const sameKind = S.boards.filter(x => (x.kind || 'official') === kind);
  const b = { id: uid(), kind, no: String(sameKind.length + 1), place: '', lat: +latLng.lat().toFixed(6), lng: +latLng.lng().toFixed(6), status: 'todo', memo: '' };
  openSheet(`
    <h3>ポスターの場所を追加</h3>
    <label>種類<select id="bKind"><option value="official" ${kind === 'official' ? 'selected' : ''}>選挙用ポスター掲示場（告示後に貼る公営の看板）</option><option value="general" ${kind === 'general' ? 'selected' : ''}>一般ポスター（支援者宅・店舗などに貼る）</option><option value="political" ${kind === 'political' ? 'selected' : ''}>政治活動用ポスター（二連・演説会告知）</option></select></label>
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
    <div class="small">${BOARD_KIND[b.kind || 'official'].name}${b.kind === 'political' && b.posted_at ? `　／　設置から ${Math.floor((new Date(today()) - new Date(b.posted_at)) / 86400000)} 日${posterBanDate() ? `　／　撤去期限 ${posterBanDate()}（任期満了6か月前）` : ''}` : ''}</div>
    ${b.kind === 'political' ? '<div class="small">※候補者名入りの政治活動用ポスターは任期満了日の6か月前から投票日まで掲示できません。掲示責任者・印刷者の表示と、掲示場所の所有者の許諾を確認</div>' : ''}
    ${(() => { const pa = (b.kind || 'official') === 'official' ? posterAsgOf(b) : null; return pa ? `<div class="small" style="color:#d8b4fe">📌 受け持ち：<b>${esc(pa.member || '未定')}</b>${pa.due ? `（${esc(pa.due)}）` : ''}${pa.note ? `　${esc(pa.note)}` : ''}</div>` : ''; })()}
    ${(b.kind || 'official') === 'official'
      // 公営掲示場は「まだ／貼った」の2択（本人指定）。古い状態（予約・対応中など）が残っていても「まだ」扱い
      ? `<div class="stTabs"><button data-st="todo" class="${b.status !== 'done' ? 'on' : ''}" style="color:${boardTeam(b) ? INAZAWA_TEAM[boardTeam(b).team].c : (ADMIN_COLORS[boardCity(b)] || '#e8eef5')};font-weight:700">まだ貼っていない</button><button data-st="done" class="${b.status === 'done' ? 'on' : ''}" style="color:${boardTeam(b) ? INAZAWA_TEAM[boardTeam(b).team].p : postedColor(boardCity(b))};font-weight:700">✓ 貼った</button></div>${boardTeam(b) ? `<div class="small">稲沢市 ${['', '①グループ（赤）', '②チーム（黄）', '③チーム（紫）', '④チーム（青）', '⑤チーム（緑）'][boardTeam(b).team]}　地図上の番号は「${esc(boardTeam(b).num)}」</div>` : ''}`
      : `<div class="stTabs stTabs6">
      ${Object.entries(BOARD_STYLE).map(([k, v]) => `<button data-st="${k}" class="${b.status === k ? 'on' : ''}" style="color:${v.color}">${v.label === '未' ? '未着手' : v.label === '予' ? '予約' : v.label === '中' ? '対応中' : v.label === '済' ? '完了' : v.label === '異' ? '異常' : '要確認'}</button>`).join('')}
    </div>`}
    <label>担当・貼った人<select id="bBy">${S.settings.members.map(m => `<option ${((b.posted_by || S.user) === m) ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
    <label>${b.kind === 'political' ? '設置日' : '日付'}<input id="bDate" type="date" value="${esc(b.posted_at || today())}"></label>
    <label>写真（任意・自動で縮小します）</label>
    <div class="btnRow" style="margin-top:0"><label class="ghost fileBtn">📷 カメラで撮る<input id="bPhoto" type="file" accept="image/*" capture="environment" hidden></label><label class="ghost fileBtn">🖼 写真から選ぶ<input id="bPhoto2" type="file" accept="image/*" hidden></label></div>
    <div class="photoBox" id="bPhotoBox">${b.photo_path ? '<div class="small">写真を読み込み中…</div>' : ''}</div>
    <label>メモ（例：破損あり、貼る位置が高い）<input id="bMemo" type="text" value="${esc(b.memo || '')}"></label>
    ${extLinks(b.lat, b.lng)}
    <details style="margin-top:10px"><summary class="small">種類・番号・場所を直す／削除</summary>
      <label>種類<select id="bKind"><option value="official" ${(b.kind || 'official') === 'official' ? 'selected' : ''}>選挙用ポスター掲示場</option><option value="general" ${b.kind === 'general' ? 'selected' : ''}>一般ポスター</option><option value="political" ${b.kind === 'political' ? 'selected' : ''}>政治活動用ポスター（二連）</option></select></label>
      <label>番号<input id="bNo" type="text" value="${esc(b.no)}"></label>
      <label>場所<input id="bPlace" type="text" value="${esc(b.place)}"></label>
      <div class="btnRow"><button class="ghost" id="bMove">📍 位置を直す</button>${isAdmin() ? '<button class="ghost" id="bDel" style="color:var(--danger)">この掲示場を削除</button>' : ''}</div>
    </details>
    <div class="btnRow"><button class="ghost" id="bCancel">閉じる</button><button class="primary" id="bSave">保存する</button></div>
  `);
  let status = b.status;
  $('#sheetBody').querySelectorAll('.stTabs button').forEach(btn => btn.onclick = () => { status = btn.dataset.st; $('#sheetBody').querySelectorAll('.stTabs button').forEach(x => x.classList.toggle('on', x === btn)); });
  let newBlob = null, removePhoto = false;
  if (b.photo_path) {
    const url = await store.photoUrl(b.photo_path);
    $('#bPhotoBox').innerHTML = url ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="タップで大きく表示"><img src="${esc(url)}" alt="貼付写真"></a><div class="btnRow" style="margin-top:6px"><button class="ghost small" id="bPhotoDel" style="color:var(--danger)">🗑 この写真を削除</button><span class="small">差し替えは上の「カメラで撮る／写真から選ぶ」</span></div>` : '<div class="small">写真を表示できません</div>';
    const del = $('#bPhotoDel'); if (del) del.onclick = () => { if (!confirm('この写真を削除しますか？（「保存する」で確定します）')) return; removePhoto = true; newBlob = null; $('#bPhotoBox').innerHTML = '<div class="small">写真を削除します（「保存する」で確定）</div>'; };
  }
  $('#bPhoto2').onchange = e => $('#bPhoto').onchange(e);
  $('#bPhoto').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    newBlob = await shrinkImage(f, 1280, 0.8); removePhoto = false;
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
    const oldPath = b.photo_path || null;
    if (newBlob) { const path = await store.uploadPhoto(newBlob, b.id); if (!path) { $('#bSave').disabled = false; return; } nb.photo_path = path; }
    else if (removePhoto) nb.photo_path = null;
    try { await store.saveBoard(nb); } catch { $('#bSave').disabled = false; return; }
    if (oldPath && oldPath !== nb.photo_path) store.deletePhoto(oldPath);   // 古い写真は保存が通ってから消す（失敗しても支障なし）
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
    <div class="small">${sum('official')} ／ ${sum('general')} ／ ${sum('political')}</div>
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
    downloadOrShare(`ポスター_${today()}.csv`, csv, 'text/csv');
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
  if (on && !guardMode()) return;
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
      position: { lat: sp.lat, lng: sp.lng }, map: S.map, zIndex: 30, clickable: overlaysClickable(),
      icon: { path: 'M 0,0 C -2,-6 -12,-8 -12,-17 A 12,12 0 1,1 12,-17 C 12,-8 2,-6 0,0 Z', fillColor: k.color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1.25, labelOrigin: new google.maps.Point(0, -17) },
      label: { text: k.emoji, fontSize: '15px' },
      title: `${sp.name}${next ? `　次回 ${fmtDate(next.date)} ${next.time}` : ''}`,
    });
    m.addListener('click', () => { if (overlaysClickable()) showSpot(sp); });
    S.spotMarkers.set(sp.id, m);
    if (showLabels) {
      const evs = spotEvents(sp.id); const done = evs.filter(e => e.done).length;
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
  const evRow = e => { const at = Array.isArray(e.attendees) ? e.attendees : []; const me = at.includes(S.user);
    return `<div class="evRow" data-id="${e.id}"><span class="d">${fmtDate(e.date)} ${esc(e.time)}</span><span class="m">${esc(e.member || '')} ${esc(e.memo || '')}${!e.done && at.length ? `<br><span class="small">参加 ${at.length}人：${esc(at.join('・'))}</span>` : ''}</span>${e.done ? '<span class="small">済</span>' : `<button class="ghost evJoin ${me ? 'on' : ''}">${me ? '参加をやめる' : '参加する'}</button><button class="ghost evDone">実施した</button>`}<button class="ghost evDel">削除</button></div>`; };
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
  $('#sheetBody').querySelectorAll('.evJoin').forEach(b => b.onclick = async () => { const e = S.events.find(x => x.id === b.closest('.evRow').dataset.id); if (!e) return; const at = Array.isArray(e.attendees) ? [...e.attendees] : []; const i = at.indexOf(S.user); if (i >= 0) at.splice(i, 1); else at.push(S.user); try { await store.saveEvent({ ...e, attendees: at }); } catch { return; } S.events = await store.loadEvents(); showSpot(sp); toast(i >= 0 ? '参加を取り消しました' : '参加登録しました'); });
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
  const row = e => `<tr data-spot="${e.spot_id}" data-ev="${e.id}"><td>${fmtDate(e.date)}</td><td>${esc(e.time)}</td><td>${esc(name(e.spot_id))}</td><td>${esc(e.member || '')}${!e.done && Array.isArray(e.attendees) && e.attendees.length ? `<br><span class="small">参加${e.attendees.length}：${esc(e.attendees.join('・'))}</span>` : ''}</td><td>${esc(e.memo || '')}</td></tr>`;
  openSheet(`
    <h3>辻立ち・活動の予定と実績</h3>
    <h4 style="margin:10px 0 4px">今後の予定（${up.length}件）</h4>
    <div class="tableWrap"><table><thead><tr><th>日付</th><th>時間</th><th>場所</th><th>担当</th><th>メモ</th></tr></thead><tbody>${up.map(row).join('') || '<tr><td colspan="5" class="small">予定はありません。地図のピンをタップ →「＋ 予定を追加」</td></tr>'}</tbody></table></div>
    <h4 style="margin:14px 0 4px">実施済み（${hist.length}件）</h4>
    <div class="tableWrap"><table><thead><tr><th>日付</th><th>時間</th><th>場所</th><th>実施</th><th>メモ</th></tr></thead><tbody>${hist.map(row).join('') || '<tr><td colspan="5" class="small">まだありません</td></tr>'}</tbody></table></div>
    <div class="btnRow"><button class="ghost" id="slCopy">📋 予定と参加者をLINE用にコピー</button><button class="primary" id="slClose">閉じる</button></div>
  `);
  $('#slClose').onclick = closeSheet;
  $('#slCopy').onclick = () => copyText(['【辻立ち・活動の予定】', ...up.map(e => { const at = Array.isArray(e.attendees) ? e.attendees : []; return `${fmtDate(e.date)} ${e.time || ''}　${name(e.spot_id)}${e.member ? '（担当 ' + e.member + '）' : ''}${at.length ? `　参加${at.length}人：${at.join('・')}` : '　参加者募集中'}${e.memo ? '　' + e.memo : ''}`; }), up.length ? '' : '（予定はありません）', '', 'アプリで「参加する」を押してください'].join('\n'));
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
    const cities = activeCities().map(c => c.split('_')[1]).filter(Boolean);
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
  const vb = viewBbox(0.3);
  for (const a of open) {
    if (vb && !bboxHit(turf.bbox(turf.polygon([a.polygon])), vb)) continue;
    const isMine = a.member === S.user; const poster = isPosterAsg(a);
    // チラシの割り当て＝黄色、ポスター貼りの受け持ち＝紫の破線
    const col = poster ? (isMine ? '#c084fc' : '#a78bfa') : (isMine ? '#ffd60a' : '#cbd5e1');
    const poly = new google.maps.Polygon({ paths: a.polygon.map(([lng, lat]) => ({ lat, lng })), strokeColor: col, strokeOpacity: poster ? 0 : 1, strokeWeight: 3, fillColor: col, fillOpacity: poster ? 0.14 : (isMine ? 0.18 : 0.08), map: S.map, zIndex: 1, clickable: overlaysClickable() });
    poly.addListener('click', ev => { if (!S.drawing && !S.pin) showAssignment(a); });
    S.asgPolys.set(a.id, poly);
    if (poster) {   // 破線の縁
      const ring = a.polygon.map(([lng, lat]) => ({ lat, lng })); ring.push(ring[0]);
      const dash = new google.maps.Polyline({ path: ring, map: S.map, strokeOpacity: 0, zIndex: 2, clickable: false, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: col, scale: 3 }, offset: '0', repeat: '12px' }] });
      S.asgPolys.set(a.id + '_dash', dash);
    }
    if (showLabels) {
      const c = turf.centerOfMass(turf.polygon([a.polygon])).geometry.coordinates;
      let html;
      if (poster) { const inb = boardsInAsg(a); html = `📌 <b>${esc(a.member || '担当未定')}</b> が貼る${a.due ? ` ${fmtDate(a.due)}` : ''}<br>掲示場 ${inb.total}か所（貼った ${inb.done}）`; }
      else { const f = a.flyer_id ? flyerOf(a.flyer_id) : null; html = `📋 <b>${esc(a.member || '担当未定')}</b>${a.due ? ` 〜${fmtDate(a.due)}` : ''}<br>${f ? esc(f.name) : 'チラシ未定'}${a.est_setai ? ` 約${a.est_setai}世帯` : ''}`; }
      const lb = new RecLabel({ lat: c[1], lng: c[0] }, html, null, { cls: 'asgLabel' + (poster ? ' poster' : '') + (isMine ? '' : ' other') }); lb.setMap(S.map);
      S.asgLabels.push(lb);
    }
  }
}
// 割り当ての種類：'flyer'＝チラシ配布の予定エリア／'poster'＝ポスター貼りの受け持ち範囲（範囲内の公営掲示場を受け持つ）
const POSTER_ASG = '__poster';
const isPosterAsg = a => a && a.flyer_id === POSTER_ASG;
// 範囲内の公営掲示場（合計と貼った数）
function boardsInAsg(a) {
  try {
    const poly = turf.polygon([a.polygon]); const bb = turf.bbox(poly);
    const list = S.boards.filter(b => (b.kind || 'official') === 'official' && typeof b.lat === 'number' && bboxHit([b.lng, b.lat, b.lng, b.lat], bb) && turf.booleanPointInPolygon(turf.point([b.lng, b.lat]), poly));
    return { list, total: list.length, done: list.filter(b => b.status === 'done').length };
  } catch { return { list: [], total: 0, done: 0 }; }
}
// この掲示場を受け持っている割り当て（未完了のもの）
function posterAsgOf(b) {
  if (typeof b.lat !== 'number') return null;
  const pt = turf.point([b.lng, b.lat]);
  return S.assignments.find(a => isPosterAsg(a) && a.status !== 'done' && (() => { try { return turf.booleanPointInPolygon(pt, turf.polygon([a.polygon])); } catch { return false; } })()) || null;
}
function startAssignDraw(kind = 'flyer') {
  if (kind !== 'poster' && $('#fab').disabled) { toast('告示日を過ぎているため作成できません'); return; }
  if (!guardMode()) return;
  S.drawPurpose = 'assign'; S.asgKind = kind; startDrawing();
  setTimeout(() => { const h = $('#drawHint'); if (h && S.drawing) h.textContent = (kind === 'poster' ? '自分が貼る掲示場を囲んでください（' : '割り当てる範囲を囲んでください（') + h.textContent + '）'; }, 0);
}
function openAssignForm(a) {
  const isNew = !a.id; const poster = isPosterAsg(a);
  const poly = turf.polygon([a.polygon]); const est = estimateRecord(poly);
  const inb = poster ? boardsInAsg(a) : null;
  openSheet(`
    <h3>${poster ? (isNew ? '📌 ポスター貼りの受け持ち範囲' : '📌 受け持ち範囲を編集') : (isNew ? '配布の割り当てを作る' : '割り当てを編集')}</h3>
    ${poster
      ? `<div class="small">この範囲の公営掲示場 <b>${inb.total}</b> か所（貼った ${inb.done}）／ ${esc(est.town)}${inb.total ? `<br>番号：${esc(inb.list.map(b => b.no).filter(Boolean).slice(0, 40).join('・'))}${inb.total > 40 ? '…' : ''}` : '<br>範囲に掲示場がありません。囲み直してください'}</div>`
      : `<div class="small">推定 <b>${est.setai}</b> 世帯 ／ ${esc(est.town)}</div>`}
    <label>${poster ? '貼る人' : '担当者'}<select id="aMember"><option value="">（未定・誰でも）</option>${S.settings.members.map(m => `<option ${a.member === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
    ${poster ? '' : `<label>配るチラシ<select id="aFlyer"><option value="">（未定）</option>${S.settings.flyers.map(f => `<option value="${f.id}" ${a.flyer_id === f.id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>`}
    <label>${poster ? '貼る予定日（任意）' : '期限（任意）'}<input id="aDue" type="date" value="${esc(a.due || '')}"></label>
    <label>メモ（任意）<input id="aNote" type="text" value="${esc(a.note || '')}" placeholder="${poster ? '例：午前中に回ります／脚立あり' : '例：団地は管理人に一声かけてから'}"></label>
    <div class="btnRow"><button class="ghost" id="aCancel">やめる</button><button class="primary" id="aSave">保存する</button></div>
  `);
  S.sheetGuard = '入力中の内容（描いた範囲）が消えます。閉じますか？';
  $('#aCancel').onclick = closeSheet;
  const aId = a.id || uid();
  $('#aSave').onclick = async () => {
    const na = { ...a, id: aId, member: $('#aMember').value || null, flyer_id: poster ? POSTER_ASG : ($('#aFlyer').value || null), due: $('#aDue').value || null, note: $('#aNote').value.trim(), status: a.status || 'planned', est_setai: poster ? (inb ? inb.total : 0) : est.setai, town: est.town, created_by: a.created_by || S.user };
    $('#aSave').disabled = true;
    try { await store.saveAssignment(na); } catch { $('#aSave').disabled = false; return; }
    S.assignments = await store.loadAssignments(); closeSheet(); renderAssignments(); toast('割り当てを保存しました');
  };
}
function showAssignment(a) {
  const f = a.flyer_id && !isPosterAsg(a) ? flyerOf(a.flyer_id) : null;
  if (isPosterAsg(a)) {
    const inb = boardsInAsg(a); const canEdit = isAdmin() || a.member === S.user || a.created_by === S.user;
    openSheet(`
      <h3>📌 ${esc(a.member || '担当未定')} が貼る範囲${a.due ? `　${esc(a.due)}` : ''}</h3>
      <dl class="kv">
        <dt>掲示場</dt><dd>${inb.total} か所（貼った ${inb.done}／残り ${inb.total - inb.done}）</dd>
        ${a.note ? `<dt>メモ</dt><dd>${esc(a.note)}</dd>` : ''}
        <dt>作成</dt><dd>${esc(a.created_by || '')}</dd>
      </dl>
      <div class="small" style="margin:6px 0 4px">範囲内の掲示場（タップで開く）</div>
      <div class="asgBoards">${inb.list.sort((x, y) => String(x.no).localeCompare(String(y.no), 'ja', { numeric: true })).map(b => `<button class="chip ${b.status === 'done' ? 'on' : ''}" data-bid="${esc(b.id)}" style="--c:${b.status === 'done' ? postedColor(boardCity(b)) : (ADMIN_COLORS[boardCity(b)] || '#888')}"><span class="dot"></span>${esc(b.no || '?')}${b.status === 'done' ? ' ✓' : ''}</button>`).join('') || '<span class="small">なし</span>'}</div>
      <div class="btnRow"><button class="ghost" id="asDone">全部貼り終えた（完了にする）</button>${canEdit ? '<button class="ghost" id="asEdit">編集</button><button class="ghost" id="asDel" style="color:var(--danger)">削除</button>' : ''}<button class="ghost" id="asClose">閉じる</button></div>
    `);
    $('#asClose').onclick = closeSheet;
    $('#sheetBody').querySelectorAll('[data-bid]').forEach(x => x.onclick = () => { const b = S.boards.find(y => y.id === x.dataset.bid); if (b) { S.map.panTo({ lat: b.lat, lng: b.lng }); showBoard(b); } });
    if ($('#asEdit')) $('#asEdit').onclick = () => openAssignForm(a);
    $('#asDone').onclick = async () => { if (inb.done < inb.total && !confirm(`まだ貼っていない掲示場が ${inb.total - inb.done} か所あります。完了にしますか？`)) return; try { await store.saveAssignment({ ...a, status: 'done' }); } catch { return; } S.assignments = await store.loadAssignments(); closeSheet(); renderAssignments(); toast('完了にしました'); };
    if ($('#asDel')) $('#asDel').onclick = async () => { if (!confirm('この受け持ち範囲を削除しますか？')) return; try { await store.deleteAssignment(a.id); } catch { return; } S.assignments = await store.loadAssignments(); closeSheet(); renderAssignments(); toast('削除しました'); };
    return;
  }
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
    <div class="tableWrap"><table><thead><tr><th>状態</th><th>担当</th><th>期限</th><th>チラシ／ポスター</th><th>主な町丁目</th><th>世帯・掲示場</th></tr></thead><tbody>
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
    const m = new google.maps.Marker({ position: { lat: st.lat, lng: st.lng }, map: S.map, zIndex: 25, clickable: overlaysClickable(),
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 12, fillColor: '#fff', fillOpacity: 0.95, strokeColor: '#1d4ed8', strokeWeight: 2 }, label: { text: '🚉', fontSize: '14px' }, title: `${st.name}駅（${st.city}）` });
    m.addListener('click', () => { if (!overlaysClickable()) return; openSheet(`
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
  catch { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '0'; document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, 999999); try { document.execCommand('copy'); toast('コピーしました'); } catch { prompt('長押しでコピーしてください', text); } ta.remove(); }
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
  const cities = activeCities().map(c => c.split('_')[1]).filter(Boolean);
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
      if (!box.isConnected) return;
      res.push({ id: uid(), no, text, hit: hit ? { lat: hit.geometry.coordinates[1], lng: hit.geometry.coordinates[0], title: hit.properties.title } : null });
      await new Promise(r => setTimeout(r, 250));
    }
    const ok = res.filter(r => r.hit).length;
    box.innerHTML = `<div class="small" style="margin:8px 0">${ok} / ${res.length} 件の位置が見つかりました。見つからなかった行は「＋ 場所を追加」で手で置いてください。</div>
      ${res.map(r => `<div class="impRow"><b>${esc(r.no)}</b><span>${esc(r.text)}<br><span class="small">${r.hit ? '→ ' + esc(r.hit.title) : '位置が見つかりません'}</span></span><span class="${r.hit ? 'ok' : 'ng'}">${r.hit ? '✓' : '✗'}</span></div>`).join('')}
      <div class="btnRow"><button class="ghost" id="imCopyNg">見つからない行をコピー</button><button class="primary" id="imSave" ${ok ? '' : 'disabled'}>${ok}件を取り込む</button></div>`;
    $('#imCopyNg').onclick = () => copyText(res.filter(r => !r.hit).map(r => `${r.no}\t${r.text}`).join('\n') || '（すべて見つかりました）');
    $('#imSave').onclick = async () => {
      $('#imSave').disabled = true;
      const dup = new Set(S.boards.filter(b => (b.kind || 'official') === kind).map(b => String(b.no)));
      const targets = res.filter(r => r.hit && !dup.has(String(r.no)));
      try { for (const r of targets) await store.saveBoard({ id: r.id, kind, no: r.no, place: r.text, lat: +r.hit.lat.toFixed(6), lng: +r.hit.lng.toFixed(6), status: 'todo', memo: '一覧から取り込み（位置は要確認）' }); }
      catch { $('#imSave').disabled = false; toast('途中で失敗しました。もう一度「取り込む」を押してください（重複はしません）', 5000); return; }
      S.boards = await store.loadBoards(); closeSheet(); renderBoards(); toast(`${targets.length}件を取り込みました。位置がずれていれば「位置を直す」で調整してください`, 5000);
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
  try { const jm = await weatherForJma(date, timeText); if (jm) return jm; } catch { }
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
const RULES_VERSION = 2;
const RULES_HTML = `
  <h3>⚠ してはいけないこと（公職選挙法）</h3>
  <div class="small">ボランティアの善意が違反にならないための最低限です。迷ったら支部に確認。詳細は選挙管理委員会の案内が優先します。</div>
  <ol class="rules">
    <li><b>戸別訪問はいつでも禁止</b>（138条）。投票のお願いで家を一軒ずつ訪ねない。候補者名や政党名を言い歩く、演説会の案内で戸別に回る、も同じ扱い。ポスティングは「投函するだけ」で、呼び鈴を鳴らして依頼しない</li>
    <li><b>告示前に「投票してください」と言わない・書かない</b>（事前運動）。政治活動のビラ・演説・SNSは政策や活動の紹介まで</li>
    <li><b>告示日以降のチラシのポスティングは禁止</b>。選挙運動用ビラ（証紙付き・町議選は2種類1,600枚まで）は新聞折込・選挙事務所・個人演説会場・街頭演説の場所（8〜20時）でのみ配れる。候補者名入りの政党ビラも告示後は配れない。このアプリも告示日以降は配布記録をロックします</li>
    <li><b>ポスティングや声かけをするボランティア（選挙運動員）への報酬は一切不可</b>。例外は選管に届け出た事務員・車上運動員・単純労務者への法定額だけ。交通費などの実費は可。それ以外のお金や品物のやり取りは買収になりうる</li>
    <li><b>飲食物を出さない・受け取らない</b>（お茶とそれに伴う程度のお菓子は可。支援者からの差し入れも不可）。弁当は選挙事務所で食べる分だけで、1食1,000円・1日3,000円以内、町議選は合計225食（15人分×5日）まで</li>
    <li><b>投票日当日は選挙運動をしない</b>。SNSの新規投稿・投票依頼のメッセージも当日は不可。前日までの投稿は消さなくてよい。候補者名を出さない「投票に行こう」は可</li>
    <li><b>一般の人は選挙運動のメール・SMSを送れない</b>（候補者・政党のみ。届いたメールの転送や印刷配布も不可）。LINEやSNSでの拡散は告示後〜投票日前日まで可。ただし<b>SNSで投票を呼びかける投稿には自分の連絡先（メールアドレス等）の表示が必要</b>（142条の3）</li>
    <li><b>18歳未満は選挙運動ができない</b>（SNSのシェアやリツイートも不可）。頼めるのは政治活動の手伝いと、はがきの宛名書き・荷物運びなどの単純労務まで（137条の2）</li>
    <li><b>署名集めをしない・人気投票の結果を公表しない</b>。「〇〇さんを応援する署名」や「〇〇さんが優勢」アンケートの公表は禁止</li>
    <li><b>写真は掲示板とポスターだけ</b>（これは法律ではなく個人情報への配慮）。通行人の顔・表札・車のナンバーが写らないように</li>
    <li><b>迷ったら止まって聞く</b>。選挙運動の計画や指揮をする人（組織的選挙運動管理者等）や出納責任者が買収などで有罪になると、候補者本人の当選が無効になり、同じ選挙区で5年間立候補できなくなる（連座制）</li>
  </ol>
  <div class="small">参考：公職選挙法（e-Gov）、総務省「選挙運動と政治活動」、群馬県・京都府・茨城県利根町の選管Q&amp;A。町議選の法定枚数はビラ1,600枚（2種類以内・証紙・届出）・はがき800枚。</div>
`;
function showRules(first) {
  openSheet(RULES_HTML + `<div class="btnRow">${first ? '<button class="primary" id="rulesOk">確認しました</button>' : '<button class="primary" id="rulesOk">閉じる</button>'}</div>`);
  $('#rulesOk').onclick = () => { localStorage.setItem('cm_rules_ack', String(RULES_VERSION)); closeSheet(); };
}

/* ---------------- 権限（管理者／現場） ---------------- */
// 設定に admins（名前の配列）があれば、その人だけが管理者。空なら全員が管理者（初期状態）
// Supabase時はアカウントの権限（members.role）、端末内保存版は設定の admins（空なら全員）
const isAdmin = () => { if (USE_SUPABASE) return S.me?.role === 'admin'; const a = S.settings?.admins || []; return !a.length || a.includes(S.user); };
function applyRole() {
  const admin = isAdmin();
  // 設定は全員が開ける（チラシの種類・枚数・告示日・任期満了日）。アカウント発行と名前一覧の変更は画面内で管理者だけに絞る
  document.querySelector('.menuItem[data-view=settings]').hidden = USE_SUPABASE ? false : !admin;
  $('#btnAssignAdd').hidden = !admin;
  $('#btnBoardImport').hidden = !admin;
  const q = id => $(id) || {};   // 古いページが残っていて要素が無くても落ちないように
  q('#btnPassword').hidden = !USE_SUPABASE;
  q('#btnTrash').hidden = !(admin && USE_SUPABASE); q('#btnHistory').hidden = !(admin && USE_SUPABASE);
  q('#btnBackup').hidden = !admin;
  q('#btnSwitchUser').textContent = USE_SUPABASE ? '🚪 ログアウト' : '👤 名前を変える';
  $('#menuUser').textContent = `👤 ${S.user || ''}${admin && (USE_SUPABASE || (S.settings?.admins || []).length) ? '（管理者）' : ''}`;
}

/* ---------------- 学習・資料（参政党の理念・綱領・Q&A） ---------------- */
const STUDY = {
  core: [
    ['理念', ['日本の国益を守り、世界に大調和を生む。']],
    ['綱領', ['一、先人の叡智を活かし、天皇を中心に一つにまとまる平和な国をつくる。', '一、日本国の自立と繁栄を追求し、人類の発展に寄与する。', '一、日本の精神と伝統を活かし、調和社会のモデルをつくる。']],
    ['参政党所属議員理念', ['私たちは、常に向上心を持って学び、国家国民のための仕事をする', '私たちは、いかなる利害にも左右されず、人として正しいことを貫く', '私たちは、大衆迎合せず、国民に正しい情報を提供し世論を喚起する', '私たちは、正しい知識とそれに基づく行動を議会で示す', '私たちは、参政党議員であることに誇りをもって、信頼される活動を続ける']],
    ['キャッチコピー', ['投票したい政党がないから、自分たちでゼロからつくる。']],
  ],
  pillars: [
    ['3つの重点政策', ['① 教育・人づくり（国民の意識改革）— 学力（テストの点数）より学習力（自ら考え自ら学ぶ力）の高い日本人の育成', '② 食と健康・環境保全 — 化学的な物質に依存しない食と医療の実現と、それを支える循環型の環境の追求', '③ 国のまもり — 日本の舵取りに外国勢力が関与できない体制づくり']],
    ['国づくり10の柱（2020年策定）', ['1 人とのきずなと生きがいを安心して追求できる〝社会づくり〟', '2 国民に健康と食の価値、元気な超高齢社会の〝安心できる生活づくり〟', '3 豊かさ上昇曲線の〝経済づくり〟（令和の所得倍増戦略を実現する）', '4 自らの幸福を自ら生み出せる〝人づくり〟', '5 人類社会の課題解決へ世界を先導し続ける〝科学技術づくり〟', '6 自らの国は自ら守る〝国防力と危機管理力づくり〟', '7 日本らしいリーダーシップで〝世界に大調和を生む外交づくり〟', '8 国民自らが選択し参加する〝納得の政治・行政づくり〟', '9 地球と調和的に共存する循環型の〝環境・エネルギー体系と国土づくり〟', '10 自由と文化と日本の国柄を守り育てる〝国家アイデンティティーづくり〟']],
  ],
  qa: [
    ['参政党ってどんな党？', '2020年4月に「投票したい政党がないから、自分たちでゼロからつくる」を合言葉に結党。2022年の参院選で国政政党に。活動も政策づくりも人材育成も自分たちでやる「DIY」が特徴で、地域の支部で意見を集め、仲間から議員を送り出す党です。'],
    ['一番やりたいことは？', '重点政策は3つ。①教育・人づくり（点数より「自ら考え学ぶ力」）、②食と健康・環境保全（化学物質に頼らない食と医療）、③国のまもり（外国勢力が日本の舵取りに関与できない体制）。'],
    ['消費税はどうするの？', '段階的に廃止し、国民負担率（税＋社会保険料）を35％以内に収める方針。あわせてインボイス制度は即時撤回し、小規模事業者・フリーランスの廃業を防ぐ、としています。'],
    ['外国人を排除する党なの？', '公式の政策は「排除」ではなく「ルールと上限」です。外国人政策を一元化する「外国人総合政策庁」を設け、地域の受容力に基づく中長期の比率目標（市区町村単位で日本国民の5％まで）と受入要件の高度化を掲げています。'],
    ['教育は何を変える？', 'テストの点数（学力）より、自ら考え自ら学ぶ「学習力」を重視。いじめに悩まなくてよい学習環境づくりや、スマホの悪影響から子供を守ることも政策に含まれます。'],
    ['学校給食・食の安全は？', '安易な無償化より質の向上に公費を使う考え。地元食材（地産地消）と有機食材を推進し、遺伝子組み換え食品や不必要な食品添加物を避ける給食を目指します。（補足：給食は町政で直接扱えるテーマです）'],
    ['憲法は「改憲」？', '「改憲」ではなく「創憲」。今の憲法は占領期に外国の草案に基づいて作られたとして、国民自らが歴史や文化に基づいて一から創り直す運動です。基本原則は「国の守りの強化」「国民の権利や自由の尊重」「日本の国柄の反映」。「感染症のまん延」を発動要件に含む緊急事態条項には反対（緊急事態法制の検討そのものに反対しているわけではありません）。'],
    ['若い人の政治参加は？', '選挙権を16歳に、被選挙権を18歳に引き下げ。突出して高い供託金は全廃し、一定数の署名収集に変える案です。'],
    ['なぜ町議選に出るの？', '参政党のDIYは「地域に支部を作り、仲間から議員を議会に送り出し、条例も自分たちで変えていく」ことが柱だからです。国政だけでなく、暮らしに一番近い町政から変える、という考えです。'],
    ['「大調和」って何？', '神武天皇の建国の理念から取った言葉で、「人類が一つの家族のように助け合って生きていく社会」。ただし世界がひとつになる意味ではなく、日本の自主独立を確保し、どの国とも対等に勢力均衡を保ちながら共存する考え方です。'],
  ],
  links: [
    ['参政党 公式サイト', 'https://sanseito.jp/'],
    ['理念・綱領・議員理念', 'https://sanseito.jp/about/'],
    ['3つの重点政策', 'https://sanseito.jp/political_measures/'],
    ['参政党の政策 2026（具体政策・全7分野）', 'https://sanseito.jp/political_measures_2026/specific_policies/'],
  ],
};
function showStudy(tab = 'core') {
  const sec = (title, items) => `<h4 style="margin:14px 0 4px">${esc(title)}</h4><ul class="study">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
  let body = '';
  if (tab === 'core') body = STUDY.core.map(([t, i]) => sec(t, i)).join('');
  else if (tab === 'pillars') body = STUDY.pillars.map(([t, i]) => sec(t, i)).join('');
  else if (tab === 'qa') body = `<div class="small">辻立ちや配布中に聞かれやすい質問。答えは公式の政策・理念ページの要約です。</div>` + STUDY.qa.map(([q, a], i) => `<details class="qa"><summary><b>Q${i + 1}.</b> ${esc(q)}</summary><div>${esc(a)}</div></details>`).join('');
  else body = `<ul class="study">${STUDY.links.map(([t, u]) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a></li>`).join('')}</ul><div class="small" style="margin-top:10px">このページの文章は、参政党の公式サイト（理念・綱領、重点政策、政策2026）および党の公式資料（参政党Book・参政党ドリル）に基づいています。</div>`;
  openSheet(`
    <h3>📚 学習・資料</h3>
    <div class="stTabs stTabs6"><button data-t="core" class="${tab === 'core' ? 'on' : ''}">理念・綱領</button><button data-t="pillars" class="${tab === 'pillars' ? 'on' : ''}">重点政策・10の柱</button><button data-t="qa" class="${tab === 'qa' ? 'on' : ''}">Q&amp;A</button><button data-t="links" class="${tab === 'links' ? 'on' : ''}">公式リンク</button></div>
    ${body}
    <div class="btnRow"><button class="primary" id="stClose">閉じる</button></div>
  `);
  $('#stClose').onclick = closeSheet;
  $('#sheetBody').querySelectorAll('.stTabs button').forEach(b => b.onclick = () => showStudy(b.dataset.t));
}

/* ---------------- 長押しピン：ここで何をする？ ---------------- */
function quickPin(latLng) {
  if (S.searchMarker) { S.searchMarker.setMap(null); S.searchMarker = null; }
  S.searchMarker = new google.maps.Marker({ position: latLng, map: S.map, zIndex: 50, animation: google.maps.Animation.DROP,
    icon: { path: 'M 0,0 C -2,-6 -12,-8 -12,-17 A 12,12 0 1,1 12,-17 C 12,-8 2,-6 0,0 Z', fillColor: '#e53935', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1.3 } });
  S.searchMarker._quick = true;   // 長押し由来のピン（シートを閉じたら消す）
  const it = { lat: latLng.lat(), lng: latLng.lng(), name: '選んだ地点', sub: `${latLng.lat().toFixed(5)}, ${latLng.lng().toFixed(5)}` };
  let town = null;
  try { const pt = turf.point([it.lng, it.lat]); town = S.towns.find(t => bboxHit([it.lng, it.lat, it.lng, it.lat], t.bbox) && turf.booleanPointInPolygon(pt, t.feature)) || null; if (town) it.name = `${town.city} ${town.name}`; } catch { }
  // 長押しした町丁目の世帯数と配布率（タップでは出さず、長押しの時だけ）
  let townHtml = '';
  if (town) {
    const recs = filteredRecords();
    const rows = S.settings.flyers.filter(f => S.filter.flyers.has(f.id)).map(f => { const cov = coverageOf(town, recs.filter(r => r.flyer_id === f.id)); return `<div style="margin:3px 0"><span style="display:inline-block;width:10px;height:10px;background:${f.color};border-radius:2px;margin-right:6px"></span>${esc(f.name)}：<b>${Math.round(cov * 100)}%</b>（約${Math.round(cov * town.setai)}世帯）</div>`; }).join('');
    townHtml = `<div class="small" style="margin:4px 0 8px">${town.setai.toLocaleString()}世帯 ／ ${town.jinko.toLocaleString()}人${town.kigo && town.kigo !== 'E1' ? '（飛び地）' : ''}</div><div style="font-size:13px;margin-bottom:6px">${rows || '<span class="small">表示中のチラシがありません</span>'}</div>`;
  }
  S.searchMarker.addListener('click', () => showSearchSheet(it));
  const clearStar = () => { if (S.searchMarker) { S.searchMarker.setMap(null); S.searchMarker = null; } closeSheet(); };
  openSheet(`
    <h3>📍 ${esc(it.name)}</h3>
    ${townHtml}
    <div class="small">長押しした地点。ここで何をしますか？</div>
    <div class="btnRow"><button class="ghost" id="qpRecord">🗺 ここを含む範囲の配布を記録</button></div>
    <div class="btnRow"><button class="ghost" id="qpSpot">🎤 拠点・辻立ちを追加</button><button class="ghost" id="qpBoard">📌 ポスター場所を追加</button></div>
    ${extLinks(it.lat, it.lng)}
    <div class="btnRow"><button class="primary" id="qpClose">閉じる（ピンも消える）</button></div>
  `);
  $('#qpClose').onclick = clearStar;
  $('#qpRecord').onclick = () => { clearStar(); S.map.panTo(latLng); startDrawing(); };
  $('#qpSpot').onclick = () => { if (S.searchMarker) { S.searchMarker.setMap(null); S.searchMarker = null; } toggleSpotBar(true); addSpotForm(latLng); setTimeout(() => { const n = $('#spName'); if (n && !n.value && it.name !== '選んだ地点') n.value = it.name; }, 30); };
  $('#qpBoard').onclick = () => { if (S.searchMarker) { S.searchMarker.setMap(null); S.searchMarker = null; } toggleBoards(true); addBoardForm(latLng); setTimeout(() => { const n = $('#bPlace'); if (n && !n.value && it.name !== '選んだ地点') n.value = it.name; }, 30); };
}

/* ---------------- PC用 左パネル（ダッシュボード） ---------------- */
const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches;
function placeSheet() {
  // PCでは右パネルを地図の枠（ヘッダーの下）に、スマホでは画面全体の下に置く
  const sheet = $('#sheet'), main = $('#main'), app = $('#app');
  if (isDesktop() && sheet.parentElement !== main) main.appendChild(sheet);
  else if (!isDesktop() && sheet.parentElement !== app) app.appendChild(sheet);
}
function renderDash() {
  placeSheet();
  const el = $('#dash'); if (!el) return;
  if (!isDesktop()) { el.hidden = true; return; }
  el.hidden = false;
  const t = today(); const recs30 = filteredRecords(); const recsToday = S.records.filter(r => r.date === t);
  const sumCount = a => a.reduce((x, r) => x + (r.count || 0), 0);
  const totals = flyerTotals().filter(f => S.filter.flyers.has(f.id));
  const up = upcoming(S.events).slice(0, 5);
  const spotName = id => S.spots.find(x => x.id === id)?.name || '';
  const off = S.boards.filter(b => (b.kind || 'official') === 'official'); const offDone = off.filter(b => b.status === 'done').length;
  const gen = S.boards.filter(b => b.kind === 'general'); const genDone = gen.filter(b => b.status === 'done').length;
  const myAsg = S.assignments.filter(a => a.status !== 'done' && (a.member === S.user || !a.member));
  const recent = [...S.records].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 10);
  const period = S.filter.period === 'all' ? '全期間' : `直近${S.filter.period}日`;
  const pol = S.boards.filter(b => b.kind === 'political');
  // 掲示場の進み具合は市町村ごとに（827か所の合計だけでは分からないため）
  const cityStat = {}; for (const b of off) { const c = boardCity(b) || 'その他'; (cityStat[c] ||= [0, 0])[0]++; if (b.status === 'done') cityStat[c][1]++; }
  const byCity = [...adminOrder(), 'その他'].filter(c => cityStat[c]).map(c => [c, cityStat[c][0], cityStat[c][1]]);
  // 各セクションは見出しをクリックで折りたためる（端末ごとに記憶）
  let closed; try { closed = new Set(JSON.parse(localStorage.getItem('cm_dash_closed') || '[]')); } catch { closed = new Set(); }
  const sec = (key, title, body) => `<h4 class="dsec" data-k="${key}">${title}<span class="tg">${closed.has(key) ? '▸' : '▾'}</span></h4><div class="card" ${closed.has(key) ? 'hidden' : ''}>${body}</div>`;
  el.innerHTML = `
    <div class="card"><div class="row2"><div><div class="small">今日の配布</div><div class="big">${sumCount(recsToday).toLocaleString()}<span class="small"> 枚／${recsToday.length}件</span></div></div><div style="text-align:right"><div class="small">${period}</div><div class="big">${sumCount(recs30).toLocaleString()}<span class="small"> 枚／${recs30.length}件</span></div></div></div></div>
    ${sec('flyers', 'チラシ別（残り）', totals.length ? totals.map(f => `<div class="row2" style="margin:4px 0"><span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${safeColor(f.color)};margin-right:6px"></span>${esc(f.name)}</span><b>${f.used.toLocaleString()}${f.total ? ` / ${f.total.toLocaleString()}` : ''}枚</b></div>${f.total ? `<div class="bar"><i style="width:${Math.min(100, Math.round(f.used / f.total * 100))}%"></i></div><div class="small" style="text-align:right">残り ${f.remain.toLocaleString()}</div>` : ''}`).join('') : '<div class="small">表示中のチラシがありません</div>')}
    ${sec('posters', `ポスター掲示場（貼った／全体）`, (byCity.length ? byCity.map(([c, t, d]) => `<div class="row2" style="margin:4px 0"><span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${ADMIN_COLORS[c] || '#888'};margin-right:6px"></span>${esc(c)}</span><b>${d}/${t}${t ? `（${Math.round(d / t * 100)}%）` : ''}</b></div><div class="bar"><i style="width:${t ? Math.round(d / t * 100) : 0}%;background:${postedColor(c)}"></i></div>`).join('') + `<div class="row2" style="margin-top:8px;border-top:1px solid var(--border);padding-top:6px"><span>合計</span><b>${offDone}/${off.length}${off.length ? `（${Math.round(offDone / off.length * 100)}%）` : ''}</b></div>` : '<div class="small">掲示場データがありません</div>') + (gen.length ? `<div class="row2" style="margin-top:6px"><span>一般ポスター</span><b>${genDone}/${gen.length}</b></div>` : '') + (pol.length ? `<div class="row2" style="margin-top:6px"><span>二連ポスター</span><b>${pol.filter(b => b.status === 'done').length}/${pol.length}</b></div>` : ''))}
    ${myAsg.length ? sec('mine', `自分の割り当て（未完了 ${myAsg.length}）`, myAsg.slice(0, 5).map(a => `<div class="recItem" data-asg="${esc(a.id)}"><span class="t">${isPosterAsg(a) ? '📌 ' : ''}${esc(a.town || '')}${a.flyer_id ? ' ／ ' + esc(flyerOf(a.flyer_id).name) : ''}</span><span class="n">${a.due ? '〜' + fmtDate(a.due) : ''}</span></div>`).join('')) : ''}
    ${sec('recent', '最近の記録', recent.length ? recent.map(r => `<div class="recItem" data-rec="${esc(r.id)}"><span class="sw" style="background:${flyerOf(r.flyer_id).color}"></span><span class="t">${fmtDate(r.date)} ${esc(r.member)} ${esc(r.town || '')}</span><span class="n">${(r.count || 0).toLocaleString()}枚</span></div>`).join('') : '<div class="small">まだ記録がありません</div>')}
    ${sec('events', '次の予定（辻立ち・拠点）', up.length ? up.map(e => `<div class="recItem" data-ev="${esc(e.id)}"><span class="t"><b>${fmtDate(e.date)}</b> ${esc(e.time || '')} ${esc(spotName(e.spot_id))}</span><span class="n">${Array.isArray(e.attendees) && e.attendees.length ? `参加${e.attendees.length}` : ''}</span></div>`).join('') : '<div class="small">予定はありません</div>')}
    <h4>画面</h4>
    <div class="navBtns">
      <button data-go="list">📋 配布一覧・CSV</button><button data-go="towns">🏘 町丁目の配布率</button>
      <button data-go="boards">📌 ポスター掲示場</button><button data-go="spots">🎤 拠点・辻立ち</button>
      <button data-go="assign">📋 配布の割り当て</button><button data-go="study">📚 学習・資料</button>
      <button data-go="rules">⚠ してはいけないこと</button>${(USE_SUPABASE || isAdmin()) ? '<button data-go="settings">⚙ 設定</button>' : ''}
    </div>
    <div class="small" style="margin-top:10px;color:var(--muted)">👤 ${esc(S.user || '')}　／　同じチラシの重なりは赤、地図を長押しで町丁目の世帯数・配布率</div>`;
  el.querySelectorAll('.dsec').forEach(h => h.onclick = () => { const k = h.dataset.k; if (closed.has(k)) closed.delete(k); else closed.add(k); localStorage.setItem('cm_dash_closed', JSON.stringify([...closed])); renderDash(); });
  el.querySelectorAll('[data-rec]').forEach(x => x.onclick = () => { const r = S.records.find(y => y.id === x.dataset.rec); if (!r) return; const c = turf.centerOfMass(recPolygon(r)).geometry.coordinates; S.map.panTo({ lat: c[1], lng: c[0] }); if (S.map.getZoom() < 16) S.map.setZoom(16); showRecord(r); });
  el.querySelectorAll('[data-ev]').forEach(x => x.onclick = () => { const e = S.events.find(y => y.id === x.dataset.ev); const sp = e && S.spots.find(y => y.id === e.spot_id); if (!sp) return; S.map.panTo({ lat: sp.lat, lng: sp.lng }); showSpot(sp); });
  el.querySelectorAll('[data-asg]').forEach(x => x.onclick = () => { const a = S.assignments.find(y => y.id === x.dataset.asg); if (!a) return; const c = turf.centerOfMass(turf.polygon([a.polygon])).geometry.coordinates; S.map.panTo({ lat: c[1], lng: c[0] }); showAssignment(a); });
  el.querySelectorAll('[data-go]').forEach(x => x.onclick = () => ({ list: showList, towns: () => showTownTable('has'), boards: () => toggleBoards(true), spots: () => toggleSpotBar(true), assign: () => toggleAssignBar(true), study: () => showStudy('core'), rules: () => showRules(false), settings: showSettings })[x.dataset.go]());
}

/* ---------------- UI バインド ---------------- */
function bindUI() {
  $('#periodSel').value = S.filter.period;
  $('#periodSel').onchange = e => { S.filter.period = e.target.value; renderAll(); };
  $('#fab').onclick = startDrawing;
  // 下の「📌 貼る範囲」：メニューを開かずに、すぐ受け持ち範囲を囲める（掲示板チップが全部OFFなら自動でON）
  if ($('#fab2')) $('#fab2').onclick = () => { if (!boardCitySet().size) { localStorage.setItem('cm_board_cities', JSON.stringify(Object.keys(ADMIN_COLORS))); renderBoards(); } startAssignDraw('poster'); };
  $('#btnDrawCancel').onclick = () => { S.drawPurpose = 'record'; cancelDrawing(); clearDraft(); };
  $('#sheetBody').addEventListener('input', () => { if (S.draftForm) saveDraft({ stage: 'form', ring: S.draftForm, form: formDraftValues() }); });
  $('#btnDrawRedo').onclick = () => setDrawMode(S.drawing.mode);
  $('#btnDrawUndo').onclick = () => { const d = S.drawing; d.ll.pop(); redrawTap(); };
  $('#btnDrawDone').onclick = commitDrawing;
  $('#modeFree').onclick = () => setDrawMode('free');
  $('#modeTap').onclick = () => setDrawMode('tap');
  $('#btnAdjustCancel').onclick = () => { endAdjust(false); clearDraft(); };
  $('#btnAdjustOk').onclick = () => endAdjust(true);
  $('#btnMenu').onclick = () => { $('#menu').hidden = false; applyRole(); };
  // 表示パネル（チラシ・境界線・地名・掲示板のチップ）：ボタンで開閉。開閉状態は端末に記憶
  // （古い index.html がキャッシュから出た場合に備え、新しい要素は無くても落ちないようにする）
  if ($('#layerPanel') && $('#btnLayers')) {
    const setLayers = open => { $('#layerPanel').hidden = !open; $('#btnLayers').classList.toggle('on', open); localStorage.setItem('cm_layers_open', open ? '1' : '0'); if (S.map) setTimeout(() => google.maps.event.trigger(S.map, 'resize'), 50); };
    setLayers(localStorage.getItem('cm_layers_open') === '1');
    $('#btnLayers').onclick = () => setLayers($('#layerPanel').hidden);
  }
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
  $('#btnAssignAdd').onclick = () => startAssignDraw('flyer');
  if ($('#btnBoardAssign')) $('#btnBoardAssign').onclick = () => startAssignDraw('poster');
  $('#btnAssignList').onclick = showAssignList;
  $('#btnStations').onclick = () => { S.stationsOn = !S.stationsOn; $('#btnStations').classList.toggle('on', S.stationsOn); renderStations(); };
  $('#btnBoardImport').onclick = openBoardImport;
  $('#btnPinCancel').onclick = () => endPinPlace(false);
  $('#btnPinOk').onclick = () => endPinPlace(true);
  $('#btnSwitchUser').onclick = async () => { $('#menu').hidden = true; if (USE_SUPABASE) { if (!confirm('ログアウトしますか？（次回はIDとパスワードが必要です）')) return; S.me = null; await SupabaseStore.signOut(); location.reload(); return; } localStorage.removeItem('cm_user'); showLogin(null); };
  if ($('#btnPassword')) $('#btnPassword').onclick = () => { $('#menu').hidden = true; showPasswordChange(); };
  if ($('#btnTrash')) $('#btnTrash').onclick = () => { $('#menu').hidden = true; showTrash('records'); };
  if ($('#btnHistory')) $('#btnHistory').onclick = () => { $('#menu').hidden = true; showHistory(''); };
  if ($('#btnBackup')) $('#btnBackup').onclick = () => { $('#menu').hidden = true; showBackup(); };
  $('#sheetHandle').onclick = userCloseSheet;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) userCloseSheet(); });
  let _rt = null; window.addEventListener('resize', () => { clearTimeout(_rt); _rt = setTimeout(() => { renderDash(); if (S.map) google.maps.event.trigger(S.map, 'resize'); }, 200); });
  (() => {
    const sheet = $('#sheet'), body = $('#sheetBody'); let sy = null, sx = null, dragging = false, moved = 0;
    sheet.addEventListener('touchstart', e => { const t = e.touches[0]; sy = t.clientY; sx = t.clientX; moved = 0; dragging = (body.scrollTop <= 0); }, { passive: true });
    sheet.addEventListener('touchmove', e => {
      if (!dragging || sy == null) return; const t = e.touches[0]; const dy = t.clientY - sy, dx = Math.abs(t.clientX - sx);
      if (dy > 0 && dy > dx) { moved = dy; sheet.style.transform = `translateY(${Math.min(dy, 400)}px)`; sheet.style.transition = 'none'; if (e.cancelable) e.preventDefault(); } else if (dy <= 0) { moved = 0; sheet.style.transform = ''; }
    }, { passive: false });
    const end = () => { if (sy == null) return; sheet.style.transition = ''; const m = moved; sheet.style.transform = ''; sy = null; moved = 0; dragging = false; if (m > 90) userCloseSheet(); };
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
