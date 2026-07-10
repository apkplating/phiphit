// ══════════════════════════════════════════════
//  auto-schedule.js
//  รันโดย GitHub Actions (cron) ทุกเช้า — ไม่ต้องมีคนเปิดหน้าเว็บเลย
//  ทำหน้าที่เดียวกับ runAutoScheduler() ใน production_order.html
//  ดึงคิว backlog (FIFO) มาออกใบสั่งผลิตอัตโนมัติ ต่อสาย (B1/B2/R1)
//  โดยรวมแล้วต้องไม่เกิน "กำลังการผลิตสูงสุดที่เคยทำได้" (best-case) ของสายนั้น
//
//  ใช้ Node 18+ (มี fetch ในตัว ไม่ต้องลง dependency เพิ่ม)
//
//  ⚠️ หมายเหตุความปลอดภัย: ตอนนี้ยิง REST API ตรงๆ ไม่มี auth token
//     เพราะ Firebase rules ของทั้ง 3 โปรเจกต์ยังเปิดอยู่ (ตามที่คุยกันไว้)
//     ถ้าวันไหนล็อก rules เป็น auth != null แล้ว สคริปต์นี้จะต้องเพิ่ม
//     ขั้นตอน anonymous sign-in (เหมือน fb-auth.js) แล้วแนบ ?auth=<idToken>
//     ต่อท้าย URL ทุกตัวก่อน ไม่งั้นจะโดน 401 ทันที
// ══════════════════════════════════════════════

var FB_BASE = 'https://platingapp-92e21-c1346-default-rtdb.asia-southeast1.firebasedatabase.app';
var FB_LINES = {
  B1: 'https://platingapp-92e21-c1346-default-rtdb.asia-southeast1.firebasedatabase.app',
  B2: 'https://platingapp-b2-default-rtdb.asia-southeast1.firebasedatabase.app',
  R1: 'https://platingapp-r1-default-rtdb.asia-southeast1.firebasedatabase.app',
};
var PO_PATH         = FB_BASE + '/production-orders.json';
var BACKLOG_PATH    = FB_BASE + '/production-backlog.json';
var AUTO_META_PATH  = FB_BASE + '/production-order-meta.json';
var PART_MASTER_PATH = FB_BASE + '/part-master.json';
var PATH_MAP = { B1: '/plating-b1.json', B2: '/plating-b2.json', R1: '/plating-r1.json' };

var WEIGHT_FIELD_CANDIDATES = ['weight', 'weightPerPc', 'weightPerPiece', 'unitWeight', 'pieceWeight', 'gPerPc', 'weightG', 'wtPerPc', 'g'];

// ── เวลา/วันที่ตามโซนไทย (Asia/Bangkok) — สำคัญมาก เพราะ GitHub Actions runner ใช้ UTC ──
function isoDateBangkok(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function hmBangkok(d) {
  var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  var h = parts.find(function(p){ return p.type === 'hour'; }).value;
  var m = parts.find(function(p){ return p.type === 'minute'; }).value;
  return h + ':' + m;
}

async function getJSON(url) {
  var r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('GET ' + url + ' → HTTP ' + r.status);
  var d = await r.json();
  return d;
}
async function putJSON(url, body) {
  var r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('PUT ' + url + ' → HTTP ' + r.status);
  return r.json();
}

function extractPartNo(partName) {
  return (partName || '').trim().split(' ')[0].toUpperCase();
}

function getPartWeight(pmParts, partNo) {
  var pno = (partNo || '').toUpperCase().trim();
  if (!pno) return 0;
  var part = pmParts.find(function(p) { return (p.partNo || '').toUpperCase().trim() === pno; });
  if (!part) return 0;
  for (var i = 0; i < WEIGHT_FIELD_CANDIDATES.length; i++) {
    var v = part[WEIGHT_FIELD_CANDIDATES[i]];
    var num = parseFloat(v);
    if (v !== undefined && v !== null && v !== '' && !isNaN(num) && num > 0) return num;
  }
  return 0;
}

function recordKgEquivalent(pmParts, b) {
  if (b.kg) return b.kg;
  if (b.pcs) {
    var w = getPartWeight(pmParts, b.partNo);
    if (w > 0) return (b.pcs * w) / 1000;
  }
  return 0;
}

function computeBestCapacityKg(pmParts, allBarrelData, line) {
  var byDate = {};
  (allBarrelData[line] || []).forEach(function(b) {
    var kgEq = recordKgEquivalent(pmParts, b);
    if (!byDate[b.date]) byDate[b.date] = 0;
    byDate[b.date] += kgEq;
  });
  var max = 0;
  Object.keys(byDate).forEach(function(dt) { if (byDate[dt] > max) max = byDate[dt]; });
  return Math.round(max * 100) / 100;
}

// ── โหลดข้อมูลการชุบทั้งหมด (dayRecords ทุกวัน + live ของวันนี้ถ้ามี) เหมือนฝั่งเว็บ ──
async function loadAllBarrelData(todayStr) {
  var allBarrelData = {};
  for (var line in FB_LINES) {
    allBarrelData[line] = [];
    try {
      var hasLiveToday = false;
      var live = await getJSON(FB_LINES[line] + '/live.json').catch(function(){ return null; });
      if (live) {
        var liveDate = (live.date || '').slice(0, 10);
        var liveRows = Array.isArray(live.rows) ? live.rows :
                       (live.rows && typeof live.rows === 'object' ? Object.values(live.rows) : []);
        if (liveDate === todayStr && liveRows.length) {
          hasLiveToday = true;
          liveRows.forEach(function(barrel) {
            var pno = extractPartNo(barrel.partName);
            if (!pno) return;
            allBarrelData[line].push({
              date: liveDate, time: barrel.time || '00:00', shiftId: 'live_' + liveDate,
              partNo: pno, pcs: Number(barrel.pcs || 0), kg: Number(barrel.kg || barrel.kgC || 0)
            });
          });
        }
      }
      var data = await getJSON(FB_LINES[line] + (PATH_MAP[line] || '/plating-b1.json')).catch(function(){ return null; });
      if (data) {
        var dayRecords = Array.isArray(data.dayRecords) ? data.dayRecords : [];
        dayRecords.forEach(function(day, dayIdx) {
          if (!day || !day.date) return;
          if (day.date === todayStr && hasLiveToday) return; // กันนับซ้ำ
          var shiftId = String(day.id || (day.date + '_' + dayIdx));
          (day.rows || day.barrels || []).forEach(function(barrel) {
            var pno = extractPartNo(barrel.partName);
            if (!pno) return;
            allBarrelData[line].push({
              date: day.date, time: barrel.time || '00:00', shiftId: shiftId,
              partNo: pno, pcs: Number(barrel.pcs || 0), kg: Number(barrel.kg || barrel.kgC || 0)
            });
          });
        });
      }
    } catch (e) {
      console.warn('⚠️ โหลดข้อมูลสาย ' + line + ' ไม่สำเร็จ:', e.message);
    }
  }
  return allBarrelData;
}

async function main() {
  var now = new Date();
  var today = isoDateBangkok(now);
  var nowHM = hmBangkok(now);
  console.log('══════════════════════════════════════');
  console.log('Auto Scheduler รันเมื่อ: ' + today + ' ' + nowHM + ' (เวลาไทย)');
  console.log('══════════════════════════════════════');

  // โหลดข้อมูลทั้งหมดที่ต้องใช้
  var pmData = await getJSON(PART_MASTER_PATH).catch(function(){ return null; });
  var pmParts = pmData && Array.isArray(pmData.parts) ? pmData.parts :
                (pmData && pmData.parts ? Object.values(pmData.parts) : []);

  var poData = await getJSON(PO_PATH).catch(function(){ return null; });
  var poOrders = Array.isArray(poData) ? poData : (poData ? Object.values(poData) : []);

  var backlogData = await getJSON(BACKLOG_PATH).catch(function(){ return null; });
  var backlogItems = Array.isArray(backlogData) ? backlogData : (backlogData ? Object.values(backlogData) : []);

  var metaData = await getJSON(AUTO_META_PATH).catch(function(){ return null; });
  var autoMeta = (metaData && typeof metaData === 'object') ? metaData : {};
  if (!autoMeta.lastAutoRun) autoMeta.lastAutoRun = {};

  var allBarrelData = await loadAllBarrelData(today);

  var summaryLines = [];
  var changedPO = false;
  var changedBacklog = false;

  ['B1', 'B2', 'R1'].forEach(function(line) {
    if (autoMeta.lastAutoRun[line] === today) {
      summaryLines.push(line + ': รันไปแล้ววันนี้ (' + today + ') — ข้าม');
      return;
    }
    var capacityKg = computeBestCapacityKg(pmParts, allBarrelData, line);
    if (capacityKg <= 0) {
      summaryLines.push(line + ': ยังไม่มีข้อมูลกำลังการผลิตในอดีต — ข้าม');
      autoMeta.lastAutoRun[line] = today;
      return;
    }

    var pending = backlogItems.filter(function(b) { return b.line === line && b.status !== 'scheduled'; })
      .sort(function(a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });

    var selected = [];
    var totalKg = 0;
    var skippedNoWeight = 0;
    for (var i = 0; i < pending.length; i++) {
      var item = pending[i];
      var itemKg;
      if (item.unit === 'kg') {
        itemKg = Number(item.qty) || 0;
      } else {
        var w = getPartWeight(pmParts, item.partNo);
        if (w > 0) { itemKg = (Number(item.qty) || 0) * w / 1000; }
        else { skippedNoWeight++; continue; }
      }
      if (totalKg + itemKg > capacityKg) break; // เกินกำลังการผลิต → หยุดตาม FIFO
      selected.push(item);
      totalKg += itemKg;
    }

    if (selected.length) {
      var poItems = selected.map(function(b) {
        return { customer: b.customer, partNo: b.partNo, partName: b.partName, line: b.line, qty: b.qty, unit: b.unit };
      });
      poOrders.unshift({
        id: Date.now() + Math.floor(Math.random() * 10000),
        date: today,
        timestamp: today + ' ' + nowHM,
        planner: 'ระบบ (Auto - GitHub Actions)',
        items: poItems
      });
      var selectedIds = {};
      selected.forEach(function(s) { selectedIds[s.id] = true; });
      backlogItems.forEach(function(b) { if (selectedIds[b.id]) b.status = 'scheduled'; });
      changedPO = true;
      changedBacklog = true;
      summaryLines.push(line + ': ออกใบสั่งผลิตอัตโนมัติ ' + selected.length + ' รายการ (รวม ' +
        totalKg.toFixed(1) + '/' + capacityKg.toFixed(1) + ' กก.)' +
        (skippedNoWeight ? ' — ข้าม ' + skippedNoWeight + ' รายการ (ไม่มีน้ำหนัก/ชิ้น)' : ''));
    } else {
      summaryLines.push(line + ': ไม่มีรายการในคิว หรือรายการแรกสุดเกินกำลังการผลิต (' + capacityKg.toFixed(1) + ' กก./วัน)' +
        (skippedNoWeight ? ' — ข้าม ' + skippedNoWeight + ' รายการ (ไม่มีน้ำหนัก/ชิ้น)' : ''));
    }
    autoMeta.lastAutoRun[line] = today;
  });

  if (changedPO) await putJSON(PO_PATH, poOrders);
  if (changedBacklog) await putJSON(BACKLOG_PATH, backlogItems);
  await putJSON(AUTO_META_PATH, autoMeta);

  console.log(summaryLines.join('\n'));
  console.log('══════════════════════════════════════');
  console.log('เสร็จสิ้น');
}

main().catch(function(e) {
  console.error('❌ Auto Scheduler ล้มเหลว:', e);
  process.exit(1);
});
