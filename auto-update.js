/* APK PLATING — auto-update.js
   เครื่องลูกข่ายที่เปิดหน้าค้างไว้ จะรีเฟรชเองเมื่อมีการอัปโหลดเวอร์ชันใหม่ (เทียบ version.json)
   รีเฟรชเมื่อ "ปลอดภัย" เท่านั้น: ไม่มีข้อมูลค้างส่ง NAS, ไม่ได้พิมพ์ในช่องกรอก, ไม่กำลังพิมพ์ Tag, และหยุดใช้งาน ≥ 20 วินาที
   (ถ้าไม่มีใครใช้เครื่องเลย ≥ 5 นาที รีเฟรชให้แม้มีช่องกรอกค้าง) */
(function () {
  'use strict';
  var base = null, pending = null, lastAct = Date.now(), bar = null, tick = null;
  function url() { return new URL('version.json', location.href).href + '?t=' + Date.now(); }
  function get() { return fetch(url(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { return d && d.version ? String(d.version) : null; }); }
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(function (e) { window.addEventListener(e, function () { lastAct = Date.now(); }, { passive: true, capture: true }); });
  function editing() {
    var a = document.activeElement; if (!a) return false;
    var t = (a.tagName || '').toUpperCase();
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || a.isContentEditable;
  }
  function busy() {
    try { if (window.NasSync && NasSync.hasPending && NasSync.hasPending()) return true; } catch (e) {}
    try { if (typeof _printBusy !== 'undefined' && _printBusy) return true; } catch (e) {}
    return false;
  }
  function loopGuard() {
    try {
      var n = JSON.parse(sessionStorage.getItem('apk_au_n') || '[]').filter(function (t) { return Date.now() - t < 120000; });
      if (n.length >= 3) return false; n.push(Date.now()); sessionStorage.setItem('apk_au_n', JSON.stringify(n));
    } catch (e) {}
    return true;
  }
  function reload() {
    if (!loopGuard()) return;
    try { localStorage.setItem('apk_seen_version', pending); } catch (e) {}
    location.replace(location.pathname + '?v=' + Date.now() + location.hash);
  }
  function showBar() {
    var old = document.getElementById('versionUpdateBanner'); if (old) old.remove();   // แถบเก่า (แตะเพื่อรีเฟรช) ไม่ต้องแสดงซ้ำ
    if (bar || !document.body) return;
    bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2147483646;background:#f59e0b;color:#000;text-align:center;padding:8px 12px;font:700 13px sans-serif;';
    bar.innerHTML = '🔄 มีเวอร์ชันใหม่ — จะรีเฟรชอัตโนมัติเมื่อหยุดใช้งานสักครู่ &nbsp;<button style="font:700 12px sans-serif;padding:3px 10px;cursor:pointer;" id="apkAuNow">รีเฟรชเลย</button>';
    document.body.appendChild(bar);
    document.getElementById('apkAuNow').onclick = function () { if (busy() && !confirm('มีข้อมูลที่ยังส่งไม่ถึง NAS หรือกำลังพิมพ์ — รีเฟรชตอนนี้อาจทำให้ข้อมูลค้าง ต้องการรีเฟรชเลยหรือไม่?')) return; reload(); };
  }
  function safeCheck() {
    if (!pending) return;
    var idle = Date.now() - lastAct;
    if (busy()) return;
    if ((idle >= 20000 && !editing()) || idle >= 300000) reload();
  }
  function check() {
    get().then(function (v) {
      if (!v) return;
      if (base === null) { base = v; return; }
      if (v !== base && v !== pending) { pending = v; showBar(); if (!tick) tick = setInterval(safeCheck, 5000); }
    }).catch(function () {});
  }
  check();
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  window.addEventListener('focus', check);
})();
