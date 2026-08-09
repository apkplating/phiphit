// Service Worker ขั้นต่ำสำหรับ APK Plating PWA
// ตั้งใจ "ไม่แคชอะไรเลย" ทุก request ปล่อยผ่านไปที่เครือข่ายตรงๆ เสมอ (network-first ล้วนๆ)
// เหตุผล: ทุกหน้าในระบบนี้ต้องพึ่งข้อมูลสดจาก Firebase ตลอดเวลา (สต็อก/บิล/รอบชุบ) และระบบเคย
// เจอปัญหา CDN/browser cache ค้างของเก่าอยู่หลายรอบแล้ว มีไฟล์นี้ไว้แค่ให้ครบเงื่อนไข "ติดตั้งเป็นแอปได้"
// (installability) ของ Chrome/Android เท่านั้น ไม่ได้ใช้ทำ offline cache ใดๆ ทั้งสิ้น

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (e) {
  // ปล่อยผ่านไปเครือข่ายตรงๆ เสมอ ไม่แตะ cache API เลย
  e.respondWith(fetch(e.request));
});
