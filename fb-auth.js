/**
 * fb-auth.js (เวอร์ชันเซิร์ฟเวอร์ในโรงงาน)
 * ------------------------------------------------------------------
 * แทนที่ fb-auth.js เดิม (ที่ใช้ Firebase Anonymous Auth) ให้ทุกหน้าที่เรียกฐานข้อมูล B1 ชี้มาที่
 * เซิร์ฟเวอร์ APK DB โดย "ไม่ต้องแก้โค้ดในหน้าอื่นเลย":
 *   1) ดักทุก fetch() ที่ไปยัง URL เดิมของ Firebase B1 (platingapp-92e21-c1346-...) แล้วเปลี่ยนปลายทางเป็นเซิร์ฟเวอร์ใหม่
 *   2) ขอ token จากเซิร์ฟเวอร์และแนบ ?auth=... ให้อัตโนมัติ (หมดอายุแล้วขอใหม่เอง)
 *   3) เปลี่ยน cache:'no-store' เป็น 'no-cache' สำหรับฐานข้อมูล เพื่อให้เบราว์เซอร์ถามเซิร์ฟเวอร์ว่า "เปลี่ยนไหม"
 *      ถ้าไม่เปลี่ยนจะได้ 304 (ไม่กี่ร้อยไบต์) แทนการโหลดข้อมูลทั้งก้อนซ้ำ => ประหยัดทราฟฟิกมหาศาล
 *   - ฐานข้อมูลอื่น (B2, R1, ICS สาธารณะ) ไม่ถูกแตะ ยังไปที่ Firebase ตามเดิม
 *   - ยังมี getFbAuthToken() ให้ไฟล์ที่เรียกใช้อยู่ (auth-central.js, doc_control.html)
 *
 * การตั้งค่า: แก้ PUBLIC_DB_URL ด้านล่างบรรทัดเดียว (ลิงก์ https ของเซิร์ฟเวอร์ เช่นจาก Tailscale)
 *   - เปิดหน้าเว็บจาก GitHub Pages / ไฟล์ในเครื่อง  -> ใช้ PUBLIC_DB_URL
 *   - เปิดหน้าเว็บจากเซิร์ฟเวอร์เอง (http://IP-เครื่อง:8787/) -> ใช้เซิร์ฟเวอร์เดียวกันนั้น (เร็วที่สุดใน LAN)
 *   - ทดสอบ/บังคับ: ในคอนโซลเบราว์เซอร์พิมพ์  localStorage.setItem('apk_db_base','http://192.168.1.50:8787')
 *     ยกเลิก: localStorage.removeItem('apk_db_base')
 */
(function (global) {
  'use strict';

  // ★★★ ตั้งค่าตรงนี้ที่เดียว ★★★
  var PUBLIC_DB_URL = 'https://ds225p.tailec5d08.ts.net';
  var PAGES_HOSTS = ['apkplating.github.io'];

  var OLD_HOSTS = [
    'https://platingapp-92e21-c1346-default-rtdb.asia-southeast1.firebasedatabase.app',
    'https://platingapp-92e21-c1346-default-rtdb.firebaseio.com'
  ];
  // ฐานข้อมูลสายการผลิต B2 / R1 ย้ายมาอยู่ในเซิร์ฟเวอร์เดียวกัน เป็นโหนดย่อย /__b2 และ /__r1
  var SUB_HOSTS = [
    { re: /^https:\/\/platingapp-b2-default-rtdb\.[^\/]+/i, prefix: '/__b2' },
    { re: /^https:\/\/platingapp-r1-default-rtdb\.[^\/]+/i, prefix: '/__r1' }
  ];
  var TOKEN_KEY = 'apk_db_token_v2';
  var origFetch = global.fetch ? global.fetch.bind(global) : null;
  if (!origFetch) { return; }

  function trimSlash(u) { return String(u || '').replace(/\/+$/, ''); }

  function resolveBase() {
    try { var o = global.localStorage.getItem('apk_db_base'); if (o) return trimSlash(o); } catch (e) { /* ignore */ }
    var loc = global.location || {};
    if (loc.protocol === 'file:' || PAGES_HOSTS.indexOf(loc.hostname) >= 0) {
      return /REPLACE-ME/.test(PUBLIC_DB_URL) ? '' : trimSlash(PUBLIC_DB_URL);
    }
    return trimSlash(loc.origin);
  }

  function readToken(base) {
    try {
      var t = JSON.parse(global.localStorage.getItem(TOKEN_KEY));
      if (t && t.token && t.base === base && t.exp - Date.now() > 24 * 3600 * 1000) return t.token;
    } catch (e) { /* ignore */ }
    return null;
  }
  function clearToken() { try { global.localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } }

  var inflight = null;
  function getFbAuthToken() {
    var base = resolveBase();
    if (!base) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า PUBLIC_DB_URL ใน fb-auth.js'));
    var cached = readToken(base);
    if (cached) return Promise.resolve(cached);
    if (inflight) return inflight;
    inflight = origFetch(base + '/__auth/anon', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('ขอ token ไม่สำเร็จ (' + r.status + ')'); return r.json(); })
      .then(function (j) {
        try { global.localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: j.token, exp: j.expiresAt, base: base })); } catch (e) { /* ignore */ }
        inflight = null;
        return j.token;
      }, function (err) { inflight = null; throw err; });
    return inflight;
  }

  function matchOldHost(url) {
    for (var i = 0; i < OLD_HOSTS.length; i++) if (url.indexOf(OLD_HOSTS[i]) === 0) return OLD_HOSTS[i];
    return '';
  }
  function addAuth(url, tok) {
    url = url.replace(/([?&])auth=[^&]*&?/, '$1').replace(/[?&]$/, ''); // ตัด token Firebase เดิมออก
    return url + (url.indexOf('?') < 0 ? '?' : '&') + 'auth=' + encodeURIComponent(tok);
  }

  function dbFetch(url, init, retried) {
    var opts = init ? Object.assign({}, init) : {};
    var method = String(opts.method || 'GET').toUpperCase();
    if (opts.cache === 'no-store' && method === 'GET') opts.cache = 'no-cache'; // ให้ใช้ 304 ได้
    return getFbAuthToken().then(function (tok) {
      return origFetch(addAuth(url, tok), opts).then(function (res) {
        if (res.status === 401 && !retried) {
          clearToken();
          if (opts.body === undefined || typeof opts.body === 'string') return dbFetch(url, init, true);
        }
        return res;
      });
    });
  }

  global.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) ? input.url : String(input);
    var base = resolveBase();
    if (!base) return origFetch(input, init);
    var old = matchOldHost(url);
    if (old) return dbFetch(base + url.slice(old.length), init, false);
    for (var i = 0; i < SUB_HOSTS.length; i++) {
      var m = url.match(SUB_HOSTS[i].re);
      if (m) return dbFetch(base + SUB_HOSTS[i].prefix + url.slice(m[0].length), init, false);
    }
    if (url.indexOf(base + '/') === 0 || url === base) {
      if (/\/__auth\/|\/__health|\.html($|\?)|\.js($|\?)|\.css($|\?)|\.png($|\?)/.test(url)) return origFetch(input, init);
      return dbFetch(url, init, false);
    }
    return origFetch(input, init);
  };

  global.getFbAuthToken = getFbAuthToken;
  global.APK_DB = {
    base: resolveBase,
    health: function () { return origFetch(resolveBase() + '/__health', { cache: 'no-store' }).then(function (r) { return r.json(); }); }
  };
})(typeof window !== 'undefined' ? window : this);

/* อัปเดตหน้าเว็บอัตโนมัติ — เมื่อเลขใน version.json เปลี่ยน หน้าที่เปิดค้างจะโหลดตัวใหม่เอง (เฉพาะตอนว่าง) */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  var LS_KEY = 'apk_seen_version';
  var lastAct = Date.now(), typed = false, busy = false;
  function act() { lastAct = Date.now(); }
  ['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(function (e) { document.addEventListener(e, act, { passive: true, capture: true }); });
  document.addEventListener('input', function () { typed = true; act(); }, true);

  function isSafe() {
    var idleMs = Date.now() - lastAct;
    if (idleMs < (typed ? 15 * 60000 : 60000)) return false;
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
    if (document.querySelector('.modal-bg.open, .modal.open, .modal.show, [role=dialog]:not([hidden])')) return false;
    return true;
  }
  function check() {
    if (busy) return;
    busy = true;
    fetch('version.json?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.version) return;
        var seen = null;
        try { seen = localStorage.getItem(LS_KEY); } catch (e) {}
        if (seen === null) { try { localStorage.setItem(LS_KEY, d.version); } catch (e) {} return; }
        if (seen === d.version) return;
        if (!isSafe()) return;
        try { localStorage.setItem(LS_KEY, d.version); } catch (e) {}
        var u = new URL(location.href); u.searchParams.set('v', Date.now());
        location.replace(u.toString());
      })
      .catch(function () {})
      .then(function () { busy = false; });
  }
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(check, 1500); });
  if (document.readyState === 'complete') setTimeout(check, 5000); else window.addEventListener('load', function () { setTimeout(check, 5000); });
})();
