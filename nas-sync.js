/* ══════════════════════════════════════════════════════════
   APK PLATING — nas-sync.js  (ไฟล์กลาง: กติกา "ต้องถึง NAS ก่อนทำต่อ")
   ══════════════════════════════════════════════════════════
   แนวคิด: NAS คือความจริงเดียว — เครื่องเก็บเฉพาะของที่ "ยังส่งไม่ถึง NAS" เท่านั้น
     1) markDirty(key, n)  เรียกทันทีหลังเปลี่ยนข้อมูลในเครื่อง (จำข้ามการปิด/เปิดหน้า)
     2) commit({kind})     ส่งขึ้น NAS — ช้าเกิน 4 วิ/ส่งไม่ได้ = บล็อกหน้าจอจนสำเร็จ (ส่งซ้ำทุก 3 วิ)
     3) startup()          ตอนเปิดระบบ ถ้ามีของค้างจากรอบก่อน → บล็อกจนส่งสำเร็จ ก่อนให้คีย์ใหม่
     4) โหมดฉุกเฉิน       NAS ล่มนาน → admin เปิดได้ (ใส่ PIN) ทำได้เฉพาะ "เพิ่มรายการใหม่" เก็บคิว
                           แก้ไข/ลบ/ออก INV ทำไม่ได้ (canEdit() = false) NAS กลับมาส่งเองแล้วปิดโหมดเอง

   วิธีใช้ (ในหน้า):
     NasSync.init({
       name: 'qc100',
       push: async function(key){ ... return true/false },   // ส่งข้อมูลของ key นั้นขึ้น NAS (ต้อง merge เอง ห้ามทับของเครื่องอื่น)
       isAdmin: function(){ return role==='admin'; },
       verifyAdmin: async function(pin){ return true/false }, // (ออปชัน) ตรวจ PIN admin แบบออนไลน์
       base: function(){ return 'https://...'; },            // (ออปชัน) ใช้เขียน log โหมดฉุกเฉิน
       snapshot: function(){ return {...}; }                 // (ออปชัน) ข้อมูลสำรองให้ดาวน์โหลดตอนฉุกเฉิน
     });
     NasSync.startup();   // หลังล็อกอิน
   ══════════════════════════════════════════════════════════ */
(function (g) {
  'use strict';
  var cfg = null, dirty = {}, emergency = null, inflight = null;
  var gateEl = null, gateKind = 'prev', gateStart = 0, gateTimer = null, waiters = [];
  var toastTimer = null, ver = 0;

  function LS(k) { return 'nassync_' + (cfg ? cfg.name : 'x') + '_' + k; }
  function load() {
    try { dirty = JSON.parse(localStorage.getItem(LS('dirty')) || '{}') || {}; } catch (e) { dirty = {}; }
    try { emergency = JSON.parse(localStorage.getItem(LS('emg')) || 'null'); } catch (e) { emergency = null; }
  }
  function persist() {
    try { localStorage.setItem(LS('dirty'), JSON.stringify(dirty)); } catch (e) {}
    try { localStorage.setItem(LS('emg'), JSON.stringify(emergency)); } catch (e) {}
  }
  function hasDirty() { return Object.keys(dirty).length > 0; }
  function pendingCount() { var n = 0; Object.keys(dirty).forEach(function (k) { n += (dirty[k].n || 1); }); return n; }
  function emergencyActive() { return !!emergency; }

  // ── UI ──
  function toast(msg, kind) {
    var el = document.getElementById('nasSyncToast');
    if (!el) {
      el = document.createElement('div'); el.id = 'nasSyncToast';
      el.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:12px;z-index:99999;padding:9px 16px;border-radius:999px;font-size:13px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.3);pointer-events:none;transition:opacity .3s;max-width:92vw;text-align:center;';
      document.body.appendChild(el);
    }
    el.textContent = msg; el.style.background = kind === 'ok' ? '#15803d' : '#b45309'; el.style.color = '#fff'; el.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.style.opacity = '0'; }, kind === 'ok' ? 2500 : 5000);
  }
  function bar() {
    var b = document.getElementById('nasSyncBar');
    if (!b) {
      b = document.createElement('div'); b.id = 'nasSyncBar';
      b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99997;color:#fff;text-align:center;padding:10px 12px;font-size:14px;font-weight:700;box-shadow:0 -3px 12px rgba(0,0,0,.3);';
      document.body.appendChild(b);
    }
    return b;
  }
  var dirtySince = 0;
  function updateBar() {
    if (!cfg) return;
    var b = document.getElementById('nasSyncBar');
    if (hasDirty()) {
      if (!dirtySince) dirtySince = Date.now();
      b = bar();
      var mins = Math.floor((Date.now() - dirtySince) / 60000);
      if (emergency) {
        b.style.background = '#7f1d1d';
        b.innerHTML = '🚨 โหมดฉุกเฉิน — ' + pendingCount() + ' รายการรอส่งขึ้น NAS (เพิ่มรายการใหม่ได้เท่านั้น · แก้ไข/ลบ/ออก INV ไม่ได้) ' +
          '<button onclick="NasSync.exportPending()" style="margin-left:8px;padding:3px 10px;border-radius:8px;border:0;font-weight:700;cursor:pointer;">⬇ สำรองรายการรอส่ง</button>';
      } else {
        b.style.background = '#b91c1c';
        b.textContent = '⚠️ ข้อมูลยังไม่ถูกส่งขึ้น NAS' + (mins >= 1 ? ' (ค้าง ' + mins + ' นาที)' : '') + ' — ห้ามปิดหน้านี้ และอย่าแจ้งว่าบันทึกแล้ว จนกว่าจะขึ้น "บันทึกขึ้น NAS สำเร็จ"';
      }
      b.style.display = '';
    } else {
      dirtySince = 0;
      if (b) b.style.display = 'none';
    }
  }
  function gate() {
    if (gateEl) return gateEl;
    gateEl = document.createElement('div'); gateEl.id = 'nasSyncGate';
    gateEl.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.92);display:none;align-items:center;justify-content:center;padding:20px;';
    gateEl.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:22px;text-align:center;color:#0f172a;">' +
      '<div id="nasGateMsg" style="font-size:15px;font-weight:700;line-height:1.6;"></div>' +
      '<div id="nasGateBtns" style="margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;"></div></div>';
    document.body.appendChild(gateEl);
    return gateEl;
  }
  function gateMsg(t) { document.getElementById('nasGateMsg').textContent = t; }
  function gateBtns(h) { document.getElementById('nasGateBtns').innerHTML = h; }
  function showGate(kind) {
    if (emergency) return;
    var el = gate();
    if (el.style.display !== 'none' && gateTimer) return;
    gateKind = kind || 'now'; gateStart = Date.now(); el.style.display = 'flex';
    gateMsg(gateKind === 'prev' ? '⏳ กำลังส่งข้อมูลที่ค้างจากรอบก่อนขึ้น NAS... กรุณารอสักครู่ก่อนคีย์ข้อมูลใหม่' : '⏳ กำลังบันทึกขึ้น NAS... กรุณารอจนกว่าจะสำเร็จ ห้ามปิดหน้านี้');
    gateBtns('');
    if (gateTimer) clearInterval(gateTimer);
    gateTimer = setInterval(gateTick, 500);
  }
  function gateTick() {
    var sec = Math.floor((Date.now() - gateStart) / 1000);
    if (sec >= 20) {
      gateMsg('⚠️ ยังส่งขึ้น NAS ไม่ได้ (' + sec + ' วินาที) — ตรวจ WiFi/ซิม/เครือข่าย ระบบกำลังลองส่งต่อเอง ห้ามทำงานต่อหรือปิดหน้านี้จนกว่าจะส่งสำเร็จ');
      var btns = '<button onclick="NasSync.retryNow()" style="padding:8px 14px;border-radius:10px;border:0;background:#2563eb;color:#fff;font-weight:700;cursor:pointer;">🔄 ลองใหม่ตอนนี้</button>';
      if (sec >= 60) btns += '<button onclick="NasSync.enableEmergency()" style="padding:8px 14px;border-radius:10px;border:1px solid #b91c1c;background:#fff;color:#b91c1c;font-weight:700;cursor:pointer;">🚨 เปิดโหมดฉุกเฉิน (admin)</button>';
      var nb = document.getElementById('nasGateBtns');
      if (nb && nb.getAttribute('data-sec60') !== (sec >= 60 ? '1' : '0')) { nb.innerHTML = btns; nb.setAttribute('data-sec60', sec >= 60 ? '1' : '0'); }
    }
  }
  function hideGate(afterMsg) {
    if (gateTimer) { clearInterval(gateTimer); gateTimer = null; }
    if (!gateEl || gateEl.style.display === 'none') return;
    if (afterMsg) { gateMsg(afterMsg); gateBtns(''); setTimeout(function () { if (gateEl && !gateTimer) gateEl.style.display = 'none'; }, 1100); }
    else gateEl.style.display = 'none';
  }

  // ── ส่งขึ้น NAS ──
  async function flushOnce() {
    var keys = Object.keys(dirty), allOk = true;
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i], snap = dirty[k]; if (!snap) continue;
      var ok = false;
      try { ok = await cfg.push(k); } catch (e) { ok = false; }
      if (ok === true) {
        var cur = dirty[k];
        if (cur && cur.v === snap.v) delete dirty[k];                       // ไม่มีการเปลี่ยนซ้อนระหว่างส่ง → เคลียร์
        else if (cur) cur.n = Math.max(1, (cur.n || 1) - (snap.n || 1));    // มีของใหม่ซ้อนเข้ามา → เหลือเฉพาะส่วนใหม่
      } else allOk = false;
    }
    persist();
    return allOk;
  }
  function flush() {
    if (inflight) return inflight;
    inflight = flushOnce().then(function (ok) { inflight = null; return ok; }, function () { inflight = null; return false; });
    return inflight;
  }
  function onClean(wasEmergency) {
    if (wasEmergency) {
      var info = emergency; emergency = null; persist();
      toast('✅ NAS กลับมาแล้ว — ส่งรายการที่ค้างสำเร็จ ปิดโหมดฉุกเฉินแล้ว', 'ok');
      try {
        if (cfg.base) fetch(cfg.base().replace(/\/+$/, '') + '/nas-emergency-log/' + Date.now() + '.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ system: cfg.name, openedAt: info && info.at, openedBy: info && info.by, flushedAt: new Date().toISOString() }) }).catch(function () {});
      } catch (e) {}
    }
    var done = waiters; waiters = [];
    done.forEach(function (w) { w(wasEmergency ? 'queued-then-ok' : 'ok'); });
    hideGate(gateKind === 'now' ? '✅ บันทึกขึ้น NAS สำเร็จ — ทำงานต่อได้' : '✅ ส่งข้อมูลที่ค้างจากรอบก่อนขึ้น NAS สำเร็จ — คีย์ข้อมูลใหม่ได้เลย');
    updateBar();
  }
  async function tick() {
    if (!cfg || !hasDirty() || inflight) { updateBar(); return; }
    var ok = await flush();
    if (ok && !hasDirty()) onClean(!!emergency);
    updateBar();
  }

  var NasSync = {
    init: function (c) {
      cfg = c; load();
      setInterval(tick, 3000);
      setInterval(updateBar, 1000);
      window.addEventListener('beforeunload', function (e) {
        if (hasDirty()) { e.preventDefault(); e.returnValue = 'ยังมีข้อมูลที่ไม่ได้ส่งขึ้น NAS — ปิดหน้านี้ข้อมูลอาจหาย'; return e.returnValue; }
      });
    },
    startup: function () {
      if (!cfg) return; load(); updateBar();
      if (hasDirty() && !emergency) showGate('prev');
      if (hasDirty()) tick();
    },
    markDirty: function (key, n) {
      if (!cfg) return;
      var d = dirty[key] || { n: 0 };
      d.v = ++ver + '-' + Date.now(); d.n = (d.n || 0) + (n || 1);
      dirty[key] = d; persist(); updateBar();
    },
    // kind: 'append' (เพิ่มรายการใหม่ — ทำได้ในโหมดฉุกเฉิน) | 'edit' (แก้ไข/ลบ — เรียก canEdit() ก่อนเปลี่ยนข้อมูล)
    commit: async function (opts) {
      if (!cfg) return 'ok';
      var wasDirty = hasDirty();
      var slow = setTimeout(function () { if (hasDirty() && !emergency) showGate('now'); }, 4000);
      var ok = await flush();
      for (var g2 = 0; ok && hasDirty() && g2 < 3; g2++) ok = await flush(); // มีการเปลี่ยนซ้อนระหว่างส่ง → ส่งรอบต่อไปทันที
      clearTimeout(slow);
      if (ok && !hasDirty()) {
        if (emergency) { onClean(true); return 'ok'; }
        if (wasDirty) toast('✅ บันทึกขึ้น NAS สำเร็จ', 'ok');
        hideGate(gateTimer ? (gateKind === 'now' ? '✅ บันทึกขึ้น NAS สำเร็จ — ทำงานต่อได้' : null) : null);
        updateBar();
        return 'ok';
      }
      updateBar();
      if (emergency) return 'queued';
      showGate('now');
      return await new Promise(function (resolve) { waiters.push(resolve); });
    },
    // ใช้ก่อนแก้ไข/ลบ/ออก INV: ในโหมดฉุกเฉินทำไม่ได้
    canEdit: function (msg) {
      if (emergency) { alert(msg || 'ทำไม่ได้ในโหมดฉุกเฉิน (NAS ยังไม่กลับมา) — เพิ่มรายการใหม่ได้เท่านั้น แก้ไข/ลบ/ออก INV ต้องรอ NAS'); return false; }
      return true;
    },
    isEmergency: emergencyActive,
    hasPending: hasDirty,
    retryNow: function () { tick(); },
    enableEmergency: async function () {
      if (!cfg || emergency) return;
      var okAdmin = false, who = '';
      if (cfg.isAdmin && cfg.isAdmin()) { okAdmin = true; who = (cfg.who && cfg.who()) || 'admin(session)'; }
      else {
        var pin = prompt('เปิดโหมดฉุกเฉิน — ใส่ PIN ของ admin');
        if (!pin) return;
        okAdmin = await NasSync.verifyPin(pin);
        if (!okAdmin && cfg.verifyAdmin) { try { okAdmin = await cfg.verifyAdmin(pin); } catch (e) {} }
        who = 'admin(pin)';
        if (!okAdmin) { alert('PIN ไม่ถูกต้อง หรือไม่ใช่ admin'); return; }
      }
      if (!confirm('เปิดโหมดฉุกเฉิน?\nทำได้เฉพาะเพิ่มรายการใหม่ (เก็บคิวในเครื่อง) แก้ไข/ลบ/ออก INV ทำไม่ได้\nNAS กลับมาระบบจะส่งเองแล้วปิดโหมดนี้')) return;
      emergency = { at: new Date().toISOString(), by: who }; persist();
      hideGate(); updateBar();
      var done = waiters; waiters = []; done.forEach(function (w) { w('queued'); });
    },
    exportPending: function () {
      try {
        var data = { system: cfg.name, exportedAt: new Date().toISOString(), pending: dirty, data: (cfg.snapshot ? cfg.snapshot() : null) };
        var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = 'pending_' + cfg.name + '_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
        document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500);
      } catch (e) { alert('สำรองไม่สำเร็จ: ' + e.message); }
    },
    // เก็บแฮช PIN admin (PBKDF2) ในเครื่องตอน admin ล็อกอินสำเร็จ — ใช้ยืนยันตอน NAS ล่ม (ระบบสิทธิ์กลางอยู่บน NAS เช่นกัน)
    rememberAdmin: async function (pin) {
      try {
        var salt = crypto.getRandomValues(new Uint8Array(16));
        var h = await pbkdf2(pin, salt);
        localStorage.setItem('nassync_admin_' + (cfg ? cfg.name : 'x'), JSON.stringify({ s: b64(salt), h: b64(h) }));
      } catch (e) {}
    },
    verifyPin: async function (pin) {
      try {
        var o = JSON.parse(localStorage.getItem('nassync_admin_' + cfg.name) || 'null'); if (!o) return false;
        var h = await pbkdf2(pin, unb64(o.s));
        return b64(h) === o.h;
      } catch (e) { return false; }
    }
  };
  function b64(u8) { var s = ''; u8 = new Uint8Array(u8); for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  async function pbkdf2(pin, salt) {
    var key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    return await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: 120000, hash: 'SHA-256' }, key, 256);
  }
  g.NasSync = NasSync;
})(window);
