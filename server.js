/**
 * YJK-tool 后端服务（零依赖，单文件）
 * 启动：node server.js
 * 环境变量：PORT / DATA_FILE / DEV_NAME / DEV_PASS / ALLOW_ORIGIN
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var PORT = process.env.PORT || 3000;
var DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
var DEV_NAME = process.env.DEV_NAME || 'YJK';
var DEV_PASS = process.env.DEV_PASS || 'helichun0206';
var ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
var TOKEN_TTL = 30 * 24 * 3600 * 1000;
var MAX_USERS = 5000;
var MAX_FRIENDS = 300;

var db = { users: [], friends: [], sessions: {} };

/* ================= 存储 ================= */
function load() {
  try {
    var raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (raw && typeof raw === 'object') db = raw;
  } catch (e) { /* 首次运行没有数据文件 */ }
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.friends)) db.friends = [];
  if (!db.sessions || typeof db.sessions !== 'object') db.sessions = {};
  ensureDev();
}

var saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    var tmp = DATA_FILE + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.error('保存失败: ' + e.message); }
  }, 150);
}

/* ================= 工具 ================= */
function hashPwd(pwd, salt) {
  return crypto.pbkdf2Sync(String(pwd), String(salt), 120000, 32, 'sha256').toString('hex');
}
function newSalt() { return crypto.randomBytes(16).toString('hex'); }
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function now() { return Date.now(); }
function esc(s) { return String(s == null ? '' : s); }

function findUser(name) {
  var n = esc(name).toLowerCase();
  if (!n) return null;
  for (var i = 0; i < db.users.length; i++) {
    if (esc(db.users[i].name).toLowerCase() === n) return db.users[i];
  }
  return null;
}
function publicUser(u) {
  if (!u) return null;
  return {
    name: u.name, role: u.role, avatar: u.avatar || '',
    created: u.created || 0, last: u.last || 0, banned: !!u.banned
  };
}
function ensureDev() {
  var dev = findUser(DEV_NAME);
  if (!dev) {
    var salt = newSalt();
    db.users.push({
      name: DEV_NAME, salt: salt, hash: hashPwd(DEV_PASS, salt),
      avatar: '\uD83D\uDC51', role: 'dev', created: now(), last: 0, banned: false
    });
    save();
    console.log('已创建开发者账号: ' + DEV_NAME);
  } else if (dev.role !== 'dev') {
    dev.role = 'dev';
    save();
  }
}
function issueToken(u) {
  var t = newToken();
  db.sessions[t] = { name: u.name, exp: now() + TOKEN_TTL };
  save();
  return t;
}
function authUser(req) {
  var h = req.headers['authorization'] || '';
  var m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  var s = db.sessions[m[1]];
  if (!s) return null;
  if (!s.exp || s.exp < now()) { delete db.sessions[m[1]]; save(); return null; }
  var u = findUser(s.name);
  if (!u || u.banned) return null;
  return u;
}

/* ================= 好友关系 ================= */
function pair(a, b) {
  var x = esc(a).toLowerCase(), y = esc(b).toLowerCase();
  return x < y ? [x, y] : [y, x];
}
function findLink(a, b) {
  var p = pair(a, b);
  for (var i = 0; i < db.friends.length; i++) {
    var f = db.friends[i];
    var q = pair(f.from, f.to);
    if (q[0] === p[0] && q[1] === p[1]) return f;
  }
  return null;
}
function friendNames(name) {
  var n = esc(name).toLowerCase(), out = [];
  for (var i = 0; i < db.friends.length; i++) {
    var f = db.friends[i];
    if (f.status !== 'accepted') continue;
    if (esc(f.from).toLowerCase() === n) out.push(f.to);
    else if (esc(f.to).toLowerCase() === n) out.push(f.from);
  }
  return out;
}

/* ================= HTTP 工具 ================= */
function json(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
function readBody(req, cb) {
  var buf = '', n = 0;
  req.on('data', function (c) {
    n += c.length;
    if (n > 262144) { req.destroy(); return; }
    buf += c;
  });
  req.on('end', function () {
    var o = {};
    try { o = JSON.parse(buf || '{}'); } catch (e) { o = {}; }
    cb(o || {});
  });
}

load();

var server = http.createServer(function (req, res) {
  if (req.method === 'OPTIONS') { json(res, 204, {}); return; }

  var u;
  try { u = decodeURIComponent(String(req.url || '/')); } catch (e) { u = String(req.url || '/'); }
  var qi = u.indexOf('?');
  var query = {};
  if (qi >= 0) {
    var parts = u.slice(qi + 1).split('&');
    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split('=');
      if (kv[0]) query[kv[0]] = kv[1] || '';
    }
    u = u.slice(0, qi);
  }
  var p = u.replace(/\/+$/, '') || '/';
  var me = authUser(req);

  /* ---- 连通性检查 ---- */
  if (p === '/api/ping' || p === '/') {
    json(res, 200, {
      ok: true, app: 'YJK-tool-api', version: 'v1.5',
      users: db.users.length, time: now()
    });
    return;
  }

  /* ---- 注册 ---- */
  if (p === '/api/register' && req.method === 'POST') {
    readBody(req, function (b) {
      var name = esc(b.name).replace(/^\s+|\s+$/g, '');
      var pwd = esc(b.pwd);
      if (name.length < 2 || name.length > 16) return json(res, 400, { error: '用户名需要 2-16 个字符' });
      if (/\s/.test(name)) return json(res, 400, { error: '用户名不能包含空格' });
      if (name.toLowerCase() === DEV_NAME.toLowerCase()) return json(res, 400, { error: '该用户名为开发者保留' });
      if (findUser(name)) return json(res, 400, { error: '该用户名已被注册' });
      if (pwd.length < 4 || pwd.length > 32) return json(res, 400, { error: '密码需要 4-32 位' });
      if (b.pwd2 !== undefined && pwd !== esc(b.pwd2)) return json(res, 400, { error: '两次输入的密码不一致' });
      if (db.users.length >= MAX_USERS) return json(res, 503, { error: '用户数量已达上限' });
      var salt = newSalt();
      var nu = {
        name: name, salt: salt, hash: hashPwd(pwd, salt), avatar: '',
        role: 'user', created: now(), last: now(), banned: false
      };
      db.users.push(nu);
      var token = issueToken(nu);
      save();
      json(res, 200, { ok: true, token: token, user: publicUser(nu), isNew: true });
    });
    return;
  }

  /* ---- 登录 ---- */
  if (p === '/api/login' && req.method === 'POST') {
    readBody(req, function (b) {
      var name = esc(b.name).replace(/^\s+|\s+$/g, '');
      var pwd = esc(b.pwd);
      var tu = findUser(name);
      if (!tu) return json(res, 400, { error: '用户不存在，请先注册' });
      if (tu.hash !== hashPwd(pwd, tu.salt)) return json(res, 400, { error: '密码不正确' });
      if (tu.banned) return json(res, 403, { error: '账号已被封禁' });
      tu.last = now();
      var token = issueToken(tu);
      save();
      json(res, 200, { ok: true, token: token, user: publicUser(tu), isNew: false });
    });
    return;
  }

  /* ---- 登出 ---- */
  if (p === '/api/logout' && req.method === 'POST') {
    var hh = req.headers['authorization'] || '';
    var mm = /^Bearer\s+(.+)$/i.exec(hh);
    if (mm) { delete db.sessions[mm[1]]; save(); }
    json(res, 200, { ok: true });
    return;
  }

  /* ---- 当前用户 ---- */
  if (p === '/api/me') {
    if (!me) return json(res, 401, { error: '未登录' });
    me.last = now();
    save();
    json(res, 200, {
      ok: true,
      user: publicUser(me),
      friendCount: friendNames(me.name).length
    });
    return;
  }

  /* ---- 搜索用户 ---- */
  if (p === '/api/users') {
    if (!me) return json(res, 401, { error: '未登录' });
    var q = esc(query.q).toLowerCase();
    var out = [];
    for (var i = 0; i < db.users.length && out.length < 30; i++) {
      var x = db.users[i];
      if (x.banned) continue;
      if (x.name.toLowerCase() === me.name.toLowerCase()) continue;
      if (q && x.name.toLowerCase().indexOf(q) < 0) continue;
      var link = findLink(me.name, x.name);
      var rel = 'none';
      if (link) {
        if (link.status === 'accepted') rel = 'friend';
        else if (esc(link.from).toLowerCase() === me.name.toLowerCase()) rel = 'sent';
        else rel = 'incoming';
      }
      out.push({ user: publicUser(x), relation: rel });
    }
    json(res, 200, { ok: true, list: out });
    return;
  }

  /* ---- 好友列表 ---- */
  if (p === '/api/friends' && req.method === 'GET') {
    if (!me) return json(res, 401, { error: '未登录' });
    var mine = [], incoming = [], outgoing = [];
    var myL = me.name.toLowerCase();
    for (var j = 0; j < db.friends.length; j++) {
      var f = db.friends[j];
      var fl = esc(f.from).toLowerCase(), tl = esc(f.to).toLowerCase();
      if (fl !== myL && tl !== myL) continue;
      var otherName = fl === myL ? f.to : f.from;
      var other = findUser(otherName);
      if (!other) continue;
      var item = { user: publicUser(other), time: f.time || 0 };
      if (f.status === 'accepted') mine.push(item);
      else if (fl === myL) outgoing.push(item);
      else incoming.push(item);
    }
    json(res, 200, { ok: true, friends: mine, incoming: incoming, outgoing: outgoing });
    return;
  }

  if (p === '/api/friends/request' && req.method === 'POST') {
    if (!me) return json(res, 401, { error: '未登录' });
    readBody(req, function (b) {
      var target = findUser(b.name);
      if (!target) return json(res, 404, { error: '找不到这个用户' });
      if (target.name.toLowerCase() === me.name.toLowerCase()) return json(res, 400, { error: '不能添加自己' });
      if (target.banned) return json(res, 400, { error: '该账号已被封禁' });
      var link = findLink(me.name, target.name);
      if (link) {
        if (link.status === 'accepted') return json(res, 400, { error: '你们已经是好友了' });
        if (esc(link.from).toLowerCase() === me.name.toLowerCase()) return json(res, 400, { error: '已发送过请求，等待对方同意' });
        link.status = 'accepted';
        link.time = now();
        save();
        return json(res, 200, { ok: true, status: 'accepted' });
      }
      if (friendNames(me.name).length >= MAX_FRIENDS) return json(res, 400, { error: '好友数量已达上限' });
      db.friends.push({ from: me.name, to: target.name, status: 'pending', time: now() });
      save();
      json(res, 200, { ok: true, status: 'pending' });
    });
    return;
  }

  if (p === '/api/friends/accept' && req.method === 'POST') {
    if (!me) return json(res, 401, { error: '未登录' });
    readBody(req, function (b) {
      var link = findLink(me.name, b.name);
      if (!link) return json(res, 404, { error: '没有找到该请求' });
      if (esc(link.to).toLowerCase() !== me.name.toLowerCase()) return json(res, 403, { error: '只能同意发给自己的请求' });
      link.status = 'accepted';
      link.time = now();
      save();
      json(res, 200, { ok: true });
    });
    return;
  }

  if (p === '/api/friends/reject' && req.method === 'POST') {
    if (!me) return json(res, 401, { error: '未登录' });
    readBody(req, function (b) {
      var link = findLink(me.name, b.name);
      if (!link) return json(res, 404, { error: '没有找到该请求' });
      if (esc(link.to).toLowerCase() !== me.name.toLowerCase()) return json(res, 403, { error: '只能拒绝发给自己的请求' });
      var idx = db.friends.indexOf(link);
      if (idx >= 0) db.friends.splice(idx, 1);
      save();
      json(res, 200, { ok: true });
    });
    return;
  }

  if (p === '/api/friends' && req.method === 'DELETE') {
    if (!me) return json(res, 401, { error: '未登录' });
    var linkD = findLink(me.name, query.name);
    if (!linkD) return json(res, 404, { error: '你们不是好友' });
    var di = db.friends.indexOf(linkD);
    if (di >= 0) db.friends.splice(di, 1);
    save();
    json(res, 200, { ok: true });
    return;
  }

  /* ---- 修改密码 ---- */
  if (p === '/api/password' && req.method === 'POST') {
    if (!me) return json(res, 401, { error: '未登录' });
    readBody(req, function (b) {
      var oldP = esc(b.oldPwd), np = esc(b.newPwd);
      if (me.hash !== hashPwd(oldP, me.salt)) return json(res, 400, { error: '当前密码不正确' });
      if (np.length < 4 || np.length > 32) return json(res, 400, { error: '新密码需要 4-32 位' });
      if (np === oldP) return json(res, 400, { error: '新密码不能与当前密码相同' });
      me.salt = newSalt();
      me.hash = hashPwd(np, me.salt);
      /* 改密码后其他设备的登录全部失效 */
      for (var t in db.sessions) {
        if (db.sessions[t] && esc(db.sessions[t].name).toLowerCase() === me.name.toLowerCase()) delete db.sessions[t];
      }
      var token = issueToken(me);
      save();
      json(res, 200, { ok: true, token: token });
    });
    return;
  }

  /* ---- 修改头像 ---- */
  if (p === '/api/profile' && req.method === 'POST') {
    if (!me) return json(res, 401, { error: '未登录' });
    readBody(req, function (b) {
      var av = esc(b.avatar);
      if (av.length > 40000) return json(res, 413, { error: '头像太大了' });
      me.avatar = av;
      save();
      json(res, 200, { ok: true, user: publicUser(me) });
    });
    return;
  }

  /* ---- 开发者 / 管理员：全站用户 ---- */
  if (p === '/api/admin/users') {
    if (!me) return json(res, 401, { error: '未登录' });
    if (me.role !== 'dev' && me.role !== 'admin') return json(res, 403, { error: '需要开发者或管理员权限' });
    var list = [];
    for (var k = 0; k < db.users.length; k++) {
      var z = db.users[k];
      list.push({
        user: publicUser(z),
        friends: friendNames(z.name).length,
        online: !!(z.last && now() - z.last < 300000)
      });
    }
    list.sort(function (a, b) { return (b.user.last || 0) - (a.user.last || 0); });
    json(res, 200, { ok: true, list: list, total: db.users.length, links: db.friends.length });
    return;
  }

  if (p === '/api/admin/role' && req.method === 'POST') {
    if (!me || me.role !== 'dev') return json(res, 403, { error: '只有开发者可以分配权限' });
    readBody(req, function (b) {
      var tu = findUser(b.name);
      if (!tu) return json(res, 404, { error: '找不到该用户' });
      if (tu.role === 'dev') return json(res, 400, { error: '开发者账号不可修改' });
      tu.role = b.role === 'admin' ? 'admin' : 'user';
      save();
      json(res, 200, { ok: true, user: publicUser(tu) });
    });
    return;
  }

  if (p === '/api/admin/ban' && req.method === 'POST') {
    if (!me || me.role !== 'dev') return json(res, 403, { error: '只有开发者可以封禁账号' });
    readBody(req, function (b) {
      var tu = findUser(b.name);
      if (!tu) return json(res, 404, { error: '找不到该用户' });
      if (tu.role === 'dev') return json(res, 400, { error: '开发者账号不可封禁' });
      tu.banned = !!b.banned;
      if (tu.banned) {
        for (var t in db.sessions) {
          if (db.sessions[t] && esc(db.sessions[t].name).toLowerCase() === tu.name.toLowerCase()) delete db.sessions[t];
        }
      }
      save();
      json(res, 200, { ok: true, user: publicUser(tu) });
    });
    return;
  }

  if (p === '/api/admin/user' && req.method === 'DELETE') {
    if (!me || me.role !== 'dev') return json(res, 403, { error: '只有开发者可以删除账号' });
    var du = findUser(query.name);
    if (!du) return json(res, 404, { error: '找不到该用户' });
    if (du.role === 'dev') return json(res, 400, { error: '开发者账号不可删除' });
    var ui = db.users.indexOf(du);
    if (ui >= 0) db.users.splice(ui, 1);
    var kept = [];
    for (var m2 = 0; m2 < db.friends.length; m2++) {
      var ff = db.friends[m2];
      if (esc(ff.from).toLowerCase() === du.name.toLowerCase()) continue;
      if (esc(ff.to).toLowerCase() === du.name.toLowerCase()) continue;
      kept.push(ff);
    }
    db.friends = kept;
    save();
    json(res, 200, { ok: true });
    return;
  }

  json(res, 404, { error: '接口不存在', path: p });
});

/* 每小时清理过期会话 */
setInterval(function () {
  var t = now(), n = 0;
  for (var k in db.sessions) {
    if (!db.sessions[k] || !db.sessions[k].exp || db.sessions[k].exp < t) { delete db.sessions[k]; n++; }
  }
  if (n) save();
}, 3600000);

server.listen(PORT, function () {
  console.log('YJK-tool 后端已启动: http://localhost:' + PORT);
  console.log('数据文件: ' + DATA_FILE);
  console.log('已注册用户: ' + db.users.length + ' 个');
});
