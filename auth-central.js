/* ══════════════════════════════════════════════════════════
   APK PLATING — ระบบสิทธิ์กลาง (Central Auth)
   ══════════════════════════════════════════════════════════
   วิธีใช้ในแต่ละระบบ:
     1. ใส่ <script src="auth-central.js"></script> ก่อนสคริปต์หลักของหน้า
     2. ตั้งชื่อระบบของไฟล์นี้ด้วย: var SYSTEM_KEY = 'job_master';
        (ค่าที่ใช้ได้: job_master, bl_stock, part_master, chem_master, po_master,
                       plating_v4, plating_v5_b2, plating_v6_r1, apk_hr, auth_admin)
     3. ตอน login เรียก:
          CentralAuth.login(pin, SYSTEM_KEY).then(function(result){
            if (!result.ok) { แสดง error; return; }
            var role = result.role; // 'admin' | 'operator' | 'viewer' | 'none'
            var tabs = result.tabs; // null = เห็นทุกแท็บ, หรือ array ของ tab id ที่อนุญาต
            var user = result.user; // {pin, name, permissions:{...}}
            // เก็บไว้ใช้กับ applyRole() ที่มีอยู่เดิมของระบบนั้นๆ
          });
     4. role ที่ได้กลับมาจะตรงกับ role เดิมที่ระบบใช้อยู่แล้ว
        (admin / operator / viewer) — ใส่ลง currentRole ตามปกติ
        ถ้า role === 'none' หรือ login ไม่สำเร็จ ให้ปฏิเสธการเข้าใช้งาน

     5. (ใหม่) สิทธิ์ระดับแท็บ — result.tabs:
        - ถ้า result.tabs === null  → ผู้ใช้เห็นทุกแท็บของระบบนี้ตามปกติ
          (ไม่มีการจำกัดเพิ่มเติม นี่คือค่า default สำหรับผู้ใช้เดิมทุกคน
          ทำให้ผู้ใช้ที่มีอยู่แล้วไม่ได้รับผลกระทบ — backward compatible)
        - ถ้า result.tabs เป็น array เช่น ['board','in','history']
          → ผู้ใช้เห็น "เฉพาะ" แท็บที่อยู่ใน array นี้เท่านั้น
          (admin จะได้ tabs === null เสมอ ไม่ว่าจะตั้งค่าอะไรไว้)
        ใช้ใน applyRole() ของแต่ละไฟล์ เพื่อซ่อนปุ่มแท็บ/หน้าที่ไม่อนุญาต เช่น:
          document.querySelectorAll('.tab-btn').forEach(function(btn, i){
            var tabId = TAB_IDS[i]; // เรียงตามลำดับปุ่มในหน้า
            if (tabs && tabs.indexOf(tabId) === -1) btn.style.display = 'none';
          });

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
  //
  // tabs: รายการแท็บ/หน้าย่อยของระบบนั้น { id, label } — id ต้องตรงกับ
  // ตัวที่ใช้เรียก tab('...') หรือ switchTab('...') ในไฟล์จริงของระบบนั้น
  // ใช้สำหรับ auth_admin (ติ๊กเลือกแท็บที่อนุญาต) และ login() (คืนค่า tabs ที่อนุญาต)
  var SYSTEM_LIST = [
    {
      key: 'po_master', label: 'PO จัดซื้อ', group: 'สำนักงาน & ทะเบียนกลาง',
      tabs: [
        { id: 'list',    label: 'รายการ PO' },
        { id: 'new',     label: 'สร้าง PO ใหม่' },
        { id: 'vendors', label: 'ผู้ขาย/Vendor' },
        { id: 'summary', label: 'สรุปยอดซื้อ' }
      ]
    },
    {
      key: 'job_master', label: 'Job Master', group: 'สำนักงาน & ทะเบียนกลาง',
      tabs: [
        { id: 'board',     label: 'ภาพรวม' },
        { id: 'in',        label: 'รับงานเข้า' },
        { id: 'out',       label: 'ออก INV ขาย' },
        { id: 'history',   label: 'ประวัติ' },
        { id: 'sales',     label: 'ยอดขาย' },
        { id: 'pricelist', label: 'ทะเบียนราคา' }
      ]
    },
    {
      key: 'bl_stock', label: 'B/L Stock', group: 'สำนักงาน & ทะเบียนกลาง',
      tabs: [
        { id: 'stock',    label: 'Stock Board' },
        { id: 'delivery', label: 'Delivery' },
        { id: 'history',  label: 'ประวัติ' }
      ]
    },
    {
      key: 'part_master', label: 'Part Master', group: 'สำนักงาน & ทะเบียนกลาง',
      tabs: [
        { id: 'list', label: 'รายการชิ้นงาน' },
        { id: 'add',  label: 'เพิ่มชิ้นงาน' },
        { id: 'calc', label: 'คำนวณน้ำหนัก' }
      ]
    },
    {
      key: 'chem_master', label: 'Chem Master', group: 'สำนักงาน & ทะเบียนกลาง',
      tabs: [
        { id: 'stock', label: 'Stock Card' },
        { id: 'in',    label: 'รับเข้า' },
        { id: 'items', label: 'รายการเคมี' }
      ]
    },
    {
      key: 'plating_v4', label: 'B1 — Barrel 1', group: 'สายการผลิต',
      tabs: [
        { id: 'entry',    label: 'กรอกรายรอบ' },
        { id: 'summary',  label: 'สรุปวันนี้' },
        { id: 'history',  label: 'ประวัติ' },
        { id: 'chart',    label: 'กราฟ' },
        { id: 'chem',     label: 'เคมี' },
        { id: 'thick',    label: 'ความหนา' },
        { id: 'job',      label: 'งาน' },
        { id: 'qa',       label: 'บันทึกผล' },
        { id: 'qc100',    label: 'QC 100%' },
        { id: 'settings', label: 'ตั้งค่า' }
      ]
    },
    {
      key: 'plating_v5_b2', label: 'B2 — Barrel 2', group: 'สายการผลิต',
      tabs: [
        { id: 'entry',    label: 'กรอกรายรอบ' },
        { id: 'summary',  label: 'สรุปวันนี้' },
        { id: 'history',  label: 'ประวัติ' },
        { id: 'chart',    label: 'กราฟ' },
        { id: 'chem',     label: 'เคมี' },
        { id: 'thick',    label: 'ความหนา' },
        { id: 'qa',       label: 'บันทึกผล' },
        { id: 'job',      label: 'งาน' },
        { id: 'qc100',    label: 'QC 100%' },
        { id: 'settings', label: 'ตั้งค่า' }
      ]
    },
    {
      key: 'plating_v6_r1', label: 'R1 — Rack 1', group: 'สายการผลิต',
      tabs: [
        { id: 'entry',    label: 'กรอกรายรอบ' },
        { id: 'summary',  label: 'สรุปวันนี้' },
        { id: 'history',  label: 'ประวัติ' },
        { id: 'chart',    label: 'กราฟ' },
        { id: 'chem',     label: 'เคมี' },
        { id: 'thick',    label: 'ความหนา' },
        { id: 'qa',       label: 'บันทึกผล' },
        { id: 'job',      label: 'งาน' },
        { id: 'qc100',    label: 'QC 100%' },
        { id: 'settings', label: 'ตั้งค่า' }
      ]
    },
    {
      key: 'apk_hr', label: 'APK HR', group: 'บุคคล',
      tabs: [
        { id: 'dashboard',  label: 'แดชบอร์ด' },
        { id: 'scan',       label: 'สแกนบัตร' },
        { id: 'schedule',   label: 'ตารางกะ' },
        { id: 'attendance', label: 'บันทึกเวลา' },
        { id: 'salary',     label: 'เงินเดือน' },
        { id: 'import',     label: 'นำเข้า ZKTeco' },
        { id: 'settings',   label: 'การตั้งค่า' }
      ]
    }
  ];

  var ROLE_LEVELS = ['none', 'viewer', 'operator', 'admin'];

  // คีย์ที่เก็บรายการแท็บที่อนุญาต ต่อระบบ — เก็บเป็น permissions[key + TABS_SUFFIX]
  // ถ้าไม่มีคีย์นี้ (undefined) = เห็นทุกแท็บ (ไม่จำกัด, ค่า default เดิม)
  var TABS_SUFFIX = '_tabs';

  function systemDef(systemKey) {
    for (var i = 0; i < SYSTEM_LIST.length; i++) {
      if (SYSTEM_LIST[i].key === systemKey) return SYSTEM_LIST[i];
    }
    return null;
  }

  // คืนค่า tabs ที่อนุญาตจริงสำหรับ role/permissions ที่กำหนด
  //   - admin                          → null (เห็นทุกแท็บ เสมอ)
  //   - ไม่มีคีย์ {systemKey}_tabs      → null (เห็นทุกแท็บ — ค่า default)
  //   - มีคีย์ {systemKey}_tabs เป็น array → คืน array นั้น (กรองให้เหลือ id ที่มีจริงในระบบ)
  function resolveTabs(systemKey, role, perms) {
    if (role === 'admin') return null;
    var def = systemDef(systemKey);
    var allowed = perms && perms[systemKey + TABS_SUFFIX];
    if (!Array.isArray(allowed)) return null; // ไม่ได้ตั้งค่า = เห็นหมด
    if (!def) return allowed;
    var validIds = def.tabs.map(function (t) { return t.id; });
    var filtered = allowed.filter(function (id) { return validIds.indexOf(id) !== -1; });
    return filtered;
  }

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
  //   { ok:true,  role:'admin'|'operator'|'viewer', tabs: null|string[], user:{pin,name,permissions} }
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
        tabs: resolveTabs(systemKey, role, perms),
        user: { pin: pin, name: user.name || '', permissions: perms, signature: user.signature || null }
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
    TABS_SUFFIX: TABS_SUFFIX,
    fetchUsers: fetchUsers,
    saveUsers: saveUsers,
    login: login,
    isAuthAdmin: isAuthAdmin,
    resolveTabs: resolveTabs
  };

})(window);
