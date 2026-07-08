'use strict';
/* ══════════════════════════════════════════════════════════════
   Firebase Anonymous Auth Helper
   ใช้ร่วมกับ Realtime Database Rules ที่ตั้งเป็น "auth != null"
   เพื่อกันคนนอกยิง REST ตรงเข้าฐานข้อมูลโดยไม่ผ่านหน้าเว็บนี้เลย

   วิธีตั้งค่า:
   1) เปิด Anonymous Sign-in: Firebase Console > Authentication
      > Sign-in method > เปิด "Anonymous"
   2) หา Web API Key: Firebase Console > Project Settings (รูปเฟือง)
      > General > Web API Key แล้วใส่แทนค่าด้านล่าง
   3) include ไฟล์นี้ "ก่อน" ส่วนที่เรียก fbGet/fbPut ในหน้า HTML
      <script src="fb-auth.js"></script>
   ══════════════════════════════════════════════════════════════ */

var FB_API_KEY = 'AIzaSyB-vvWMRInOgRXv5uJW7RouW317Avd6VOE'; // Web API Key ของโปรเจกต์ platingapp-92e21-c1346

var _fbTokenPromise = null;

function getFbAuthToken(){
  var cached = sessionStorage.getItem('fb_anon_token');
  var cachedExp = sessionStorage.getItem('fb_anon_exp');
  if (cached && cachedExp && Date.now() < Number(cachedExp)){
    return Promise.resolve(cached);
  }
  if (_fbTokenPromise) return _fbTokenPromise; // กันยิงขอ token ซ้ำถ้ามีหลาย request พร้อมกัน

  _fbTokenPromise = fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + FB_API_KEY, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ returnSecureToken: true })
  })
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (!data.idToken){
        console.error('Firebase anonymous auth failed:', data);
        throw new Error('ไม่สามารถยืนยันตัวตนกับ Firebase ได้ กรุณาตรวจสอบ FB_API_KEY ในไฟล์ fb-auth.js');
      }
      var expiresInMs = (Number(data.expiresIn) || 3600) * 1000;
      var expAt = Date.now() + expiresInMs - 5 * 60 * 1000; // ต่อ token ล่วงหน้าก่อนหมดอายุ 5 นาที
      sessionStorage.setItem('fb_anon_token', data.idToken);
      sessionStorage.setItem('fb_anon_exp', String(expAt));
      _fbTokenPromise = null;
      return data.idToken;
    })
    .catch(function(err){
      _fbTokenPromise = null;
      throw err;
    });
  return _fbTokenPromise;
}

/* ══════════════════════════════════════════════════════════════
   Auto-patch fetch(): แนบ ?auth=token ให้อัตโนมัติกับทุก request
   ที่ยิงไปหา Realtime Database ของโปรเจกต์นี้ (platingapp-92e21-c1346)
   โดยไม่ต้องแก้ fetch() เดิมที่กระจายอยู่ทั่วไฟล์ทีละจุด —
   ปลอดภัยกว่าสำหรับไฟล์ใหญ่ๆ ที่มี fetch() หลายสิบจุด (เช่น plating_v4.html)

   หมายเหตุ: ถ้า URL มี "auth=" อยู่แล้ว (เช่นจุดที่แก้ manual ไว้ก่อนหน้า)
   จะข้ามไป ไม่แนบซ้ำ — ใช้ร่วมกับโค้ดเดิมที่แก้ไว้แล้วได้โดยไม่ชนกัน
   ══════════════════════════════════════════════════════════════ */
(function(){
  var FB_HOST_MARKER = 'platingapp-92e21-c1346-default-rtdb';
  var _origFetch = window.fetch.bind(window);

  window.fetch = function(input, init){
    var url = (typeof input === 'string') ? input : (input && input.url);

    if (url && url.indexOf(FB_HOST_MARKER) !== -1 && url.indexOf('auth=') === -1){
      return getFbAuthToken().then(function(token){
        var sep = url.indexOf('?') === -1 ? '?' : '&';
        var newUrl = url + sep + 'auth=' + token;
        return _origFetch(newUrl, init);
      });
    }
    return _origFetch(input, init);
  };
})();
