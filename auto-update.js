/* APK PLATING — auto-update.js (ตัวอัปเดตตัวเดียวของทุกหน้า)
   รีเฟรชเองเมื่อ (1) เลขใน version.json เปลี่ยน หรือ (2) ไฟล์หน้านี้บนเซิร์ฟเวอร์ใหม่กว่าฉบับที่โหลดค้างอยู่ในเครื่อง (เช่น แท็บเล็ตเปิดจากแคช)
   รีเฟรชเมื่อ "ปลอดภัย" เท่านั้น: ไม่มีข้อมูลค้างส่ง NAS, ไม่ได้พิมพ์ในช่องกรอก, ไม่กำลังพิมพ์ Tag, และหยุดใช้งาน ≥ 20 วินาที
   (ถ้าไม่มีใครใช้เครื่องเลย ≥ 5 นาที รีเฟรชให้แม้มีช่องกรอกค้าง) — ไม่ทำงานในกรอบซ้อน (iframe) */
(function () {
  'use strict';
  if (window.__apkUpd) return; window.__apkUpd = true;   // กันซ้ำ: fb-auth.js เห็นธงนี้แล้วจะไม่เปิดตัวอัปเดตของตัวเอง
  try { if (window.top !== window.self) return; } catch (e) { return; }
  var base = null, pending = null, lastAct = Date.now(), bar = null, tick = null;
  function url() { return new URL('version.json', location.href).href + '?t=' + Date.now(); }
  function get() { return fetch(url(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) { return d && d.version ? String(d.version) : null; }); }
  // หน้าที่โหลดค้างอยู่เก่ากว่าไฟล์บนเซิร์ฟเวอร์ไหม: เทียบ Last-Modified ของไฟล์จริง (HEAD ไม่ใช้แคช) กับ document.lastModified ของฉบับที่โหลดอยู่
  // เทียบเฉพาะ "เซิร์ฟเวอร์ใหม่กว่า" เท่านั้น (กัน CDN คนละโหนดเวลาไม่ตรงกันแล้วรีเฟรชวน)
  function stale() {
    return fetch(location.pathname + '?_h=' + Date.now(), { method: 'HEAD', cache: 'no-store' }).then(function (r) {
      var lm = r.ok ? r.headers.get('Last-Modified') : null; if (!lm) return null;
      var a = Math.floor(new Date(lm).getTime() / 1000), b = Math.floor(new Date(document.lastModified).getTime() / 1000);
      return (isFinite(a) && isFinite(b) && a > b) ? String(a) : null;
    }).catch(function () { return null; });
  }
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(function (e) { window.addEventListener(e, function () { lastAct = Date.now(); }, { passive: true, capture: true }); });
  function editing() {
    var a = document.activeElement; if (!a) return false;
    var t = (a.tagName || '').toUpperCase();
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || a.isContentEditable;
  }
  function busy() {
    try { if (window.NasSync && NasSync.hasPending && NasSync.hasPending()) return true; } catch (e) {}
    try { if (typeof _printBusy !== 'undefined' && _printBusy) return true; } catch (e) {}
    try { if (document.getElementById('tgPrintOverlay') || document.getElementById('qcTagOv')) return true; } catch (e) {}
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
    try { localStorage.setItem('apk_seen_version', String(pending)); } catch (e) {}
    var u = new URL(location.href); u.searchParams.set('v', Date.now());   // คงพารามิเตอร์เดิม (เช่น ?part=…&ek=…) ไว้
    location.replace(u.toString());
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
  function flag(v) { if (v !== pending) { pending = v; showBar(); if (!tick) tick = setInterval(safeCheck, 5000); } }
  function check() {
    get().then(function (v) {
      if (v) { if (base === null) base = v; else if (v !== base) { flag(v); return; } }
      return stale().then(function (s) { if (s) flag('lm' + s); });
    }).catch(function () {});
  }
  check();
  setInterval(check, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  window.addEventListener('focus', check);
})();
