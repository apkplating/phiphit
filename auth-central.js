/* ══════════════════════════════════════════════════════════
   APK PLATING — ระบบสิทธิ์กลาง (Central Auth)
   ══════════════════════════════════════════════════════════
   วิธีใช้ในแต่ละระบบ:
     1. ใส่ <script src="auth-central.js"></script> ก่อนสคริปต์หลักของหน้า
     2. ตั้งชื่อระบบของไฟล์นี้ด้วย: var SYSTEM_KEY = 'job_master';
        (ค่าที่ใช้ได้: job_master, bl_stock, part_master, chem_master,
                       plating_v4, plating_v5_b2, plating_v6_r1, auth_admin)
     3. ตอน login เรียก:
          CentralAuth.login(pin).then(function(result){
            if (!result.ok) { แสดง error; return; }
            var role = result.role; // 'admin' | 'operator' | 'viewer' | 'none'
            var user = result.user; // {pin, name, permissions:{...}}
            // เก็บไว้ใช้กับ applyRole() ที่มีอยู่เดิมของระบบนั้นๆ
          });
     4. role ที่ได้กลับมาจะตรงกับ role เดิมที่ระบบใช้อยู่แล้ว
        (admin / operator / viewer) — ใส่ลง currentRole ตามปกติ
        ถ้า role === 'none' หรือ login ไม่สำเร็จ ให้ปฏิเสธการเข้าใช้งาน

   หมายเหตุสำคัญ:
     - ถ้าเชื่อมต่อ Firebase ไม่ได้ (ออฟไลน์/error) ระบบจะ "ปฏิเสธ login"
       เสมอ ไม่มี fallback ไปใช้ค่าที่ cache ไว้ — เพื่อความปลอดภัย
     - ข้อมูลผู้ใช้ทั้งหมดเก็บที่ Firebase path เดียว: /auth-central.json
       ใช้ร่วมกันทุกระบบ (รวม plating_v4/v5_b2/v6_r1 ด้วย)
   ══════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  var AUTH_DB_URL = 'https://platingapp-92e21-c1346-default-rtdb.asia-southeast1.firebasedatabase.app';
  var AUTH_PATH   = AUTH_DB_URL + '/auth-central.json';

  // รายการระบบทั้งหมดที่อยู่ใน permission matrix — ใช้แสดงผลในหน้า auth_admin
  // และใช้ตรวจสอบว่า key ที่ใส่มาถูกต้อง
  var SYSTEM_LIST = [
    { key: 'job_master',    label: 'Job Master',    group: 'สำนักงาน & ทะเบียนกลาง' },
    { key: 'bl_stock',      label: 'B/L Stock',     group: 'สำนักงาน & ทะเบียนกลาง' },
    { key: 'part_master',   label: 'Part Master',   group: 'สำนักงาน & ทะเบียนกลาง' },
    { key: 'chem_master',   label: 'Chem Master',   group: 'สำนักงาน & ทะเบียนกลาง' },
    { key: 'plating_v4',    label: 'B1 — Barrel 1', group: 'สายการผลิต' },
    { key: 'plating_v5_b2', label: 'B2 — Barrel 2', group: 'สายการผลิต' },
    { key: 'plating_v6_r1', label: 'R1 — Rack 1',   group: 'สายการผลิต' }
  ];

  var ROLE_LEVELS = ['none', 'viewer', 'operator', 'admin'];

  // ── ดึงข้อมูลผู้ใช้ทั้งหมดจาก Firebase ──
  // คืนค่า { ok:true, users:{...} } หรือ { ok:false, error:'...' }
  function fetchUsers() {
    return fetch(AUTH_PATH, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
        return res.json().then(function (data) {
          var users = (data && data.users && typeof data.users === 'object') ? data.users : {};
          return { ok: true, users: users };
        });
      })
      .catch(function (e) {
        return { ok: false, error: (e && e.message) ? e.message : String(e) };
      });
  }

  // ── บันทึกข้อมูลผู้ใช้ทั้งหมดกลับไป Firebase ──
  function saveUsers(users) {
    return fetch(AUTH_PATH, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: users, savedAt: new Date().toISOString() })
    })
      .then(function (res) {
        if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
        return { ok: true };
      })
      .catch(function (e) {
        return { ok: false, error: (e && e.message) ? e.message : String(e) };
      });
  }

  // ── เข้าสู่ระบบด้วย PIN สำหรับระบบที่กำหนด (SYSTEM_KEY) ──
  // คืนค่า:
  //   { ok:true,  role:'admin'|'operator'|'viewer', user:{pin,name,permissions} }
  //   { ok:false, reason:'invalid_pin'|'no_access'|'connection_error', error?:'...' }
  function login(pin, systemKey) {
    pin = String(pin || '').trim();
    return fetchUsers().then(function (result) {
      if (!result.ok) {
        return { ok: false, reason: 'connection_error', error: result.error };
      }
      var user = result.users[pin];
      if (!user) {
        return { ok: false, reason: 'invalid_pin' };
      }
      var perms = user.permissions || {};
      var role = perms[systemKey] || 'none';
      if (role === 'none') {
        return { ok: false, reason: 'no_access' };
      }
      return {
        ok: true,
        role: role,
        user: { pin: pin, name: user.name || '', permissions: perms }
      };
    });
  }

  // ── ตรวจว่า PIN นี้มีสิทธิ์เข้าหน้าจัดการผู้ใช้ (auth_admin) หรือไม่ ──
  // คืนค่า boolean (ผ่าน Promise)
  function isAuthAdmin(pin) {
    pin = String(pin || '').trim();
    return fetchUsers().then(function (result) {
      if (!result.ok) return false;
      var user = result.users[pin];
      if (!user) return false;
      var perms = user.permissions || {};
      return perms.auth_admin === 'admin';
    });
  }

  global.CentralAuth = {
    SYSTEM_LIST: SYSTEM_LIST,
    ROLE_LEVELS: ROLE_LEVELS,
    fetchUsers: fetchUsers,
    saveUsers: saveUsers,
    login: login,
    isAuthAdmin: isAuthAdmin
  };

})(window);
