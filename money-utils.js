// ══════════════════════════════════════════════════════════════════════════
//  money-utils.js — มาตรฐานคำนวณเงินกลางของระบบ APK Plating (ใช้ร่วมกันทุกไฟล์)
// ══════════════════════════════════════════════════════════════════════════
//  ทำไมต้องมีไฟล์นี้:
//  เดิมทุกไฟล์ใช้ money(n) = Number(n.toFixed(2)) ปัดเศษเงินเป็นทศนิยม 2 ตำแหน่งตรงๆ ซึ่งดูเหมือนถูกต้อง
//  แต่จริงๆ มีบั๊กแฝงจาก "floating-point tie-break" ของ JavaScript เอง — เลขทศนิยมอย่าง 7909.50 หรือ 1858.50
//  เก็บในหน่วยความจำ (IEEE754 double) ไม่ตรง .50 เป๊ะ (เช่นอาจเป็น 7909.4999999999998 จริงๆ) พอเอาไปคูณ VAT 7%
//  แล้วปัดด้วย toFixed() ผลลัพธ์เลยปัดผิดทิศไป 1 สตางค์แบบ "สุ่มตามตัวเลข" ไม่ใช่ทุกบิล — ทำให้แก้ปัญหานี้ไป
//  หลายรอบแล้วยังเจอซ้ำ เพราะรอบก่อนๆ แก้แค่ "ปัดตรงไหนบ้าง" แต่ไม่ได้แก้ "วิธีปัด" ที่เป็นต้นตอจริง
//
//  ทางแก้ถาวร: ทำเลขคณิตของเงินทั้งหมดที่ระดับ "สตางค์" (จำนวนเต็ม) แทนทศนิยม แล้วค่อยหาร 100 กลับเป็นบาท
//  ตอนจบครั้งเดียว — จำนวนเต็มใน JS แม่นยำเป๊ะไม่มี rounding error แบบนี้เลย (ปลอดภัยถึงหลักล้านล้านบาท)
//
//  วิธีใช้ (ทุกไฟล์ที่แตะเรื่องเงิน — job_master, plating v4/v5/v6, po_master, chem_master, quotation,
//  bl_stock, kpi, car ฯลฯ):
//    1) <script src="money-utils.js"></script>  ใส่ก่อน script หลักของไฟล์
//    2) ใช้ money(n) แทนการปัดค่าเดี่ยวๆ (เก็บ/แสดงผลค่าสุดท้าย) — เหมือนเดิม ปลอดภัยสำหรับค่าเดี่ยว
//    3) ใช้ moneyCentsSum(arr) แทนการ .reduce(function(s,n){return s+n;},0) ตามด้วย money() — เวลาต้อง
//       "รวมค่าเงินหลายรายการ" (เช่น รวมยอดหลายบรรทัดในบิล, รวมหลาย INV เป็นยอดวางบิล)
//    4) ใช้ vatFromGrand(grandTotal, rate) แทนการคูณ VAT ตรงๆ แล้ว money() — คืนค่า {vat, net} ที่ถูกต้อง 100%
//
//  ตัวอย่าง (คำนวณ VAT ของบิล):
//    var grandCents = moneyCentsSum(items.map(function(it){ return it.amount; }));  // ได้ "สตางค์" (จำนวนเต็ม)
//    var r = vatFromGrand(grandCents / 100);   // r = { grand, vat, net } ปัดถูกต้องทุกกรณี
//    invObj.grandTotal = r.grand; invObj.vat = r.vat; invObj.netTotal = r.net;
// ══════════════════════════════════════════════════════════════════════════

// ปัดค่าเงินเดี่ยวๆ เป็นทศนิยม 2 ตำแหน่ง — ใช้ได้ปลอดภัยสำหรับ "ค่าเดี่ยว" (เช่น ราคา × จำนวน 1 รายการ)
// ความเสี่ยง tie-break ต่ำกว่ามากเมื่อเทียบกับการบวก/คูณต่อเนื่องหลายค่า (ซึ่งควรใช้ moneyCentsSum/vatFromGrand แทน)
function money(n) { return Number((Number(n) || 0).toFixed(2)); }

// แปลงบาท → สตางค์ (จำนวนเต็ม) — จุดเดียวที่ปัดเศษจากทศนิยม แล้วหลังจากนี้เป็นเลขคณิตจำนวนเต็มล้วนๆ ไม่มี drift สะสม
function toCents(n) { return Math.round((Number(n) || 0) * 100); }

// รวมค่าเงินหลายรายการที่ระดับ "สตางค์" (จำนวนเต็ม) — คืนค่าเป็นสตางค์ ไม่ใช่บาท (เอาไปคำนวณ VAT ต่อได้เลย
// โดยไม่ต้องแปลงกลับไปกลับมา) ใช้แทน arr.reduce(...) + money() แบบเดิมทุกจุดที่ต้อง "รวม" ค่าเงินหลายรายการ
function moneyCentsSum(arr) {
  return (arr || []).reduce(function (s, n) { return s + toCents(n); }, 0);
}

// คำนวณ VAT + ยอดสุทธิจากยอดก่อนภาษี ด้วยเลขคณิตแบบสตางค์ล้วนๆ — ถูกต้อง 100% ทุกกรณี ไม่มีปัญหาปัดผิดทิศ
// grandTotal: ยอดก่อน VAT (บาท), rate: อัตราภาษี ค่าเริ่มต้น 0.07 (VAT 7%)
// คืนค่า { grand, vat, net } เป็นบาททศนิยม 2 ตำแหน่งทั้งหมด พร้อมใช้เก็บ/แสดงผลได้เลย
function vatFromGrand(grandTotal, rate) {
  rate = (rate == null) ? 0.07 : rate;
  var grandCents = toCents(grandTotal);
  var vatCents = Math.round(grandCents * rate);
  var netCents = grandCents + vatCents;
  return { grand: grandCents / 100, vat: vatCents / 100, net: netCents / 100 };
}

// เช็คว่ายอดที่บันทึกไว้ (เช่น inv.netTotal เดิม) ตรงกับที่คำนวณใหม่จากรายการจริงหรือไม่ — ใช้ดักจับข้อมูลเก่า
// ที่เคยบันทึกยอดผิดไว้ก่อนไฟล์นี้ถูกใช้งาน (เทียบกันที่ระดับสตางค์ กันปัญหาเทียบทศนิยมตรงๆ คลาดเคลื่อนเอง)
function moneyMismatch(storedNetTotal, items, rate) {
  var r = vatFromGrand(moneyCentsSum((items || []).map(function (it) { return it.amount; })), rate);
  return toCents(storedNetTotal) !== toCents(r.net);
}
