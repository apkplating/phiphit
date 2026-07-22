// ══════════════════════════════════════════════════════════════
//  unit-convert.js
//  ยูทิลิตี้กลางสำหรับแปลงหน่วย กก. <-> ชิ้น — ใช้ร่วมกันทุกไฟล์
//  (production_order.html, plating_v4/v5_B2/v6_R1.html, bl_stock.html)
//
//  เหตุผลที่ต้องมีไฟล์นี้: เจอบั๊ก "ลืมแปลงหน่วย กก.<->ชิ้น" ซ้ำแล้วซ้ำเล่า
//  (อย่างน้อย 6 จุดในระบบ) เพราะแต่ละไฟล์เขียนโค้ดหาน้ำหนัก/ชิ้นเองแยกกัน
//  แล้วบางจุดก็ลืมใส่การแปลงไปเฉยๆ — ไฟล์นี้รวมเป็นจุดเดียว แก้ที่เดียวจบทุกที่
//
//  วิธีใช้: ใส่ <script src="unit-convert.js"></script> ไว้ก่อน <script> อื่นๆ
//  ที่ต้องใช้ฟังก์ชันพวกนี้ แล้วเรียกใช้ตรงๆ ได้เลย (เป็น global function ทั้งหมด)
// ══════════════════════════════════════════════════════════════

// รายชื่อ field ที่เป็นไปได้ของ "น้ำหนัก/ชิ้น (กรัม)" ใน Part Master
// เผื่อแต่ละไฟล์/แต่ละช่วงเวลาที่เขียน ตั้งชื่อ field ไม่ตรงกัน
var UNIT_CONVERT_WEIGHT_FIELDS = ['weightPerPc', 'weight', 'weightPerPiece', 'unitWeight', 'pieceWeight', 'gPerPc', 'weightG', 'wtPerPc', 'g'];

function ucNorm(s) {
  return String(s || '').trim().toUpperCase();
}

// หาน้ำหนัก/ชิ้น (กรัม) จาก Part Master — ส่ง partNo + array ของ Part Master parts (ตัวแปร pmParts/partList ของแต่ละไฟล์)
// คืนค่า 0 ถ้าไม่มีข้อมูล (แปลงไม่ได้)
function ucGetWeightG(partNo, pmParts) {
  var pno = ucNorm(partNo);
  if (!pno || !Array.isArray(pmParts)) return 0;
  var part = pmParts.find(function(p) { return ucNorm(p.partNo) === pno; });
  if (!part) return 0;
  for (var i = 0; i < UNIT_CONVERT_WEIGHT_FIELDS.length; i++) {
    var v = part[UNIT_CONVERT_WEIGHT_FIELDS[i]];
    var num = parseFloat(v);
    if (v !== undefined && v !== null && v !== '' && !isNaN(num) && num > 0) return num;
  }
  return 0;
}

// แปลง กก. → ชิ้น (ปัดเป็นจำนวนเต็ม เพราะนับชิ้นเป็นเศษไม่ได้)
function ucKgToPcs(kg, weightG) {
  if (!(kg > 0) || !(weightG > 0)) return 0;
  return Math.round((kg * 1000) / weightG);
}

// แปลง ชิ้น → กก.
function ucPcsToKg(pcs, weightG) {
  if (!(pcs > 0) || !(weightG > 0)) return 0;
  return (pcs * weightG) / 1000;
}

// ตัวช่วยหลัก — ใช้แทนโค้ด "if (!pcs && kg>0) { แปลง }" ที่เขียนซ้ำๆ กันทั่วระบบ
// ส่ง rawPcs/rawKg (ตัวเลขดิบที่มีอยู่จริง) + partNo + pmParts array
// คืนค่า { pcs, converted, missingWeight }
//   pcs           = จำนวนชิ้นที่ควรใช้เสมอ (แปลงให้แล้วถ้าจำเป็น)
//   converted     = true ถ้าค่านี้แปลงมาจาก กก. (ไม่ได้เป็นชิ้นจริงตั้งแต่ต้น)
//   missingWeight = true ถ้ามี กก. แต่แปลงเป็นชิ้นไม่ได้ เพราะหาน้ำหนัก/ชิ้นใน Part Master ไม่เจอ
//                   (กรณีนี้ต้องเตือนผู้ใช้ ไม่ใช่ปล่อยให้เงียบแล้วได้ 0 ผิดๆ)
function ucResolvePcs(rawPcs, rawKg, partNo, pmParts) {
  rawPcs = Number(rawPcs) || 0;
  rawKg  = Number(rawKg)  || 0;
  if (rawPcs > 0) return { pcs: rawPcs, converted: false, missingWeight: false };
  if (rawKg > 0) {
    var weightG = ucGetWeightG(partNo, pmParts);
    if (weightG > 0) return { pcs: ucKgToPcs(rawKg, weightG), converted: true, missingWeight: false };
    return { pcs: 0, converted: false, missingWeight: true };
  }
  return { pcs: 0, converted: false, missingWeight: false };
}

// เหมือน ucResolvePcs แต่คืนกลับเป็น กก. แทน (เผื่อหน้าไหนอยากได้หน่วย กก. เป็นหลัก)
function ucResolveKg(rawPcs, rawKg, partNo, pmParts) {
  rawPcs = Number(rawPcs) || 0;
  rawKg  = Number(rawKg)  || 0;
  if (rawKg > 0) return { kg: rawKg, converted: false, missingWeight: false };
  if (rawPcs > 0) {
    var weightG = ucGetWeightG(partNo, pmParts);
    if (weightG > 0) return { kg: ucPcsToKg(rawPcs, weightG), converted: true, missingWeight: false };
    return { kg: 0, converted: false, missingWeight: true };
  }
  return { kg: 0, converted: false, missingWeight: false };
}

// แสดงผลตัวเลข กก. แบบ "ปรับทศนิยมตามขนาดค่า" — กันปัญหาค่าน้อยมาก (เช่น เหลือไม่กี่กรัม)
// ถูกปัดจนเห็นเป็น "0.00" ซึ่งใช้คีย์ตัดบิลจริงไม่ได้ (ไม่รู้ว่าจะกรอกเท่าไหร่)
// >= 1 กก.  → 2 ตำแหน่ง (พอสำหรับงานทั่วไป ไม่รกตา)
// < 1 กก.   → 4 ตำแหน่ง (ละเอียดถึงระดับกรัม เพียงพอให้คีย์ตัดสต็อกได้จริง)
// แสดงผลตัวเลข กก. แบบ "ปรับทศนิยมอัตโนมัติตามขนาดค่า" (ไม่ใช่แค่ตายตัว 4 ตำแหน่ง)
// >= 1 กก.  → 2 ตำแหน่ง (พอสำหรับงานทั่วไป ไม่รกตา)
// < 1 กก.   → ไล่เพิ่มทศนิยมไปเรื่อยๆ ทีละตำแหน่ง (3,4,5,6) จนกว่าจะเจอค่าที่ปัดแล้วไม่เป็น 0.00...0
//             เพื่อให้เห็นตัวเลขที่คีย์ตัดบิลได้จริงเสมอ ไม่ว่าค่าจะเล็กแค่ไหน (สูงสุด 6 ตำแหน่ง กันเลขยาวเกินไป)
function ucFmtKg(kg) {
  kg = Number(kg) || 0;
  if (kg <= 0) return '0.00';
  if (kg >= 1) return kg.toFixed(2);
  for (var dec = 3; dec <= 6; dec++) {
    var s = kg.toFixed(dec);
    if (parseFloat(s) > 0) return s;
  }
  return kg.toFixed(6);
}
