// ══════════════════════════════════════════════════════════════════════════
//  wip-calc.js — สูตรกลาง "เหลือให้ชุบ" (Remaining To Plate)
//  ใช้ร่วมกันระหว่าง bl_stock.html และ plating_v4.html / plating_v5_B2.html / plating_v6_R1.html
//
//  ทำไมต้องมีไฟล์นี้:
//  ก่อนหน้านี้แต่ละไฟล์คำนวณ "คงเหลือของบิล" คนละสูตร ได้เลขไม่ตรงกัน — bl_stock.html คำนวณถูก
//  (อ่านยอดชุบจริงจาก dayRecords ตรงๆ) แต่ plating_v4.html คำนวณผ่าน jobMasterRecords "out"
//  record ซึ่งมีบั๊กสะสมหลายชั้น: 1) autoJobOut() เคยตัดสต็อกให้แม้กด "ไม่ระบุบิล"
//  2) pullFromLines() ใน job_master.html ก็ตัดซ้ำอีกชั้นแบบไม่เช็ค jobId เลย ทำให้บางบิล
//  (เช่น SO2607008) ยอดถูกตัดจนเหลือ 0 ทั้งที่ bl_stock.html ยืนยันว่ายังเหลือ 5 กก. จริง
//
//  หลักการของสูตรนี้ (พิสูจน์แล้วว่าถูกต้อง — ยกมาจาก bl_stock.html: getWip/getPlatedPcsFromBills/
//  processWipRow ตรงๆ ไม่ได้เขียนใหม่):
//    เหลือให้ชุบ = ยอดรับเข้า (Job Master: job.qty/job.qtyKg)
//                − ยอดที่ชุบไปแล้วจริง (จาก dayRecords ของทั้ง B1+B2+R1 พร้อม live.json ของวันนี้
//                  นับเฉพาะแถวที่ row.jobId ตรงกับบิลนั้นเป๊ะๆ เท่านั้น — แถว "ไม่ระบุบิล"/NOBILL
//                  และแถวประเภท R (งานซ่อม) ไม่นับเป็นการใช้วัตถุดิบจากบิล)
//  ไม่แตะ jobMasterRecords "out"/autoJobOut()/pullFromLines() เลยแม้แต่นิดเดียว
//
//  วิธีใช้:
//    <script src="wip-calc.js"></script>
//    ...
//    await WipCalc.load();                                  // โหลดข้อมูลชุบจากทั้ง 3 สาย (async)
//    var w = WipCalc.getPlatedForJob(jobId, weightG);        // → {pcs, kg} ยอดชุบจริงของบิลนี้ (รวมทุกสาย)
//                                                             //   weightG = น้ำหนักต่อชิ้น หน่วยกรัม (ใช้แปลง กก.→ชิ้น
//                                                             //   เฉพาะแถวที่กรอกแต่ กก. ไม่มี pcs) ถ้าไม่มีส่ง 0 ได้
//    WipCalc.isLoaded();                                     // → true/false เคยโหลดสำเร็จหรือยัง
// ══════════════════════════════════════════════════════════════════════════
(function (global) {
  'use strict';

  var DB_B1 = 'https://platingapp-92e21-c1346-default-rtdb.asia-southeast1.firebasedatabase.app';
  var DB_B2 = 'https://platingapp-b2-default-rtdb.asia-southeast1.firebasedatabase.app';
  var DB_R1 = 'https://platingapp-r1-default-rtdb.asia-southeast1.firebasedatabase.app';

  var LINES = [
    { url: DB_B1 + '/plating-b1.json', liveUrl: DB_B1 + '/live.json', label: 'B1' },
    { url: DB_B2 + '/plating-b2.json', liveUrl: DB_B2 + '/live.json', label: 'B2' },
    { url: DB_R1 + '/plating-r1.json', liveUrl: DB_R1 + '/live.json', label: 'R1' }
  ];

  var wipByJob = {}; // jobId -> [{date, line, pcs, kg}]
  var _loaded = false;
  var _loadingPromise = null;

  // เวลาไทย (UTC+7) — ใช้เทียบวันที่ของ /live.json กันปัญหา toISOString() เป็น UTC ข้ามวันผิดช่วงเที่ยงคืน-ตี 7
  function isoTodayTH() {
    var d = new Date();
    var th = new Date(d.getTime() + 7 * 60 * 60000 - d.getTimezoneOffset() * 60000);
    return th.toISOString().slice(0, 10);
  }

  function processRow(row, date, lineLabel) {
    // ข้าม R (งานซ่อม) — ใช้วัตถุดิบที่ถูกนับไปแล้วตอนรอบ N ไม่ใช่วัตถุดิบใหม่จากบิล (ตรงกับที่ bl_stock.html กรองไว้)
    if ((row.type || '').toUpperCase() === 'R') return;
    // ไม่ระบุบิล (NOBILL/ว่าง) → ไม่นับเป็นยอดชุบของบิลไหนทั้งนั้น ไม่ตัดสต็อกบิลใดๆ
    if (!row.jobId || row.jobId === 'NOBILL') return;
    if (!wipByJob[row.jobId]) wipByJob[row.jobId] = [];
    wipByJob[row.jobId].push({
      date: date || '',
      line: lineLabel,
      pcs: Number(row.pcs || 0),
      kg: Number(row.kg || 0)
    });
  }

  async function load() {
    // กันโหลดซ้ำซ้อนถ้ามีหลายจุดเรียกพร้อมกัน — คืน promise เดิมที่กำลังทำงานอยู่
    if (_loadingPromise) return _loadingPromise;
    _loadingPromise = (async function () {
      // รีเซ็ตแล้วเริ่มนับใหม่ทุกครั้งที่ load() (เหมือน bl_stock.html) — ถ้าบางสายพลาด (ออฟไลน์)
      // ระหว่างทาง ยอดของสายนั้นจะแค่ขาดหายไปชั่วคราว ไม่ทำให้ทั้งก้อนพัง เรียก load() ใหม่ได้เรื่อยๆ
      wipByJob = {};

      await Promise.all(LINES.map(async function (ln) {
        try {
          var res = await fetch(ln.url);
          if (!res.ok) return;
          var data = await res.json();
          var recs = Array.isArray(data) ? data
            : Array.isArray(data && data.dayRecords) ? data.dayRecords : [];
          recs.forEach(function (dr) {
            if (!dr.rows) return;
            dr.rows.forEach(function (row) { processRow(row, dr.date, ln.label); });
          });
        } catch (e) { /* ออฟไลน์/พลาดสายนี้ — ข้ามไป ไม่ทำให้สายอื่นล้มตาม */ }
      }));

      // /live.json ของวันนี้ — ยอดชุบวันนี้แบบ real-time ก่อนกด "บันทึกสรุปวันนี้"
      await Promise.all(LINES.map(async function (ln) {
        try {
          var res = await fetch(ln.liveUrl);
          if (!res.ok) return;
          var live = await res.json();
          if (!live || !Array.isArray(live.rows) || !live.rows.length) return;
          var today = isoTodayTH();
          if ((live.date || '') !== today) return; // live.json ค้างวันอื่นอยู่ — ไม่นับ
          live.rows.forEach(function (row) { processRow(row, today, ln.label); });
        } catch (e) { /* ข้ามสายนี้ */ }
      }));

      _loaded = true;
    })();
    try {
      await _loadingPromise;
    } finally {
      _loadingPromise = null;
    }
    return true;
  }

  // ยอดชุบจริงของบิลหนึ่งๆ (รวมทุกสาย B1+B2+R1) — แปลง กก.→ชิ้น ทีละแถวก่อนรวม ไม่ใช่รวมดิบก่อนค่อยแปลงทั้งก้อน
  // (กันพลาดกรณีบางแถวมี pcs จริงปนกับแถวที่กรอกแต่ กก. ทำให้ยอดรวมไม่เป็น 0 เป๊ะ เลยข้ามการแปลง กก. ของแถวอื่นไปเงียบๆ)
  function getPlatedForJob(jobId, weightG) {
    var wg = Number(weightG || 0);
    var events = wipByJob[jobId] || [];
    var totalPcs = 0, totalKg = 0;
    events.forEach(function (ev) {
      totalKg += ev.kg;
      if (ev.pcs > 0) {
        totalPcs += ev.pcs;
      } else if (ev.kg > 0 && wg > 0) {
        totalPcs += Math.round((ev.kg * 1000) / wg);
      }
    });
    return { pcs: totalPcs, kg: totalKg };
  }

  function isLoaded() { return _loaded; }

  global.WipCalc = {
    load: load,
    getPlatedForJob: getPlatedForJob,
    isLoaded: isLoaded
  };
})(window);
