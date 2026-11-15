/* docs-panel.js — ปุ่ม "📚 เอกสารที่เกี่ยวข้อง" ใช้ร่วมทุกหน้า (ดึงจาก Doc Control, ดูอย่างเดียว)
 * ใช้งาน:  <script src="docs-panel.js"></script>
 *          DocsPanel.mount('plating-thick', '#เป้าหมาย')   // ใส่ปุ่มในองค์ประกอบ
 *          DocsPanel.open('plating-thick')                  // หรือเรียกเปิดเอง
 * ผูกเอกสารกับจุดใช้งานที่ Doc Control > ตั้งค่า > เอกสารที่เกี่ยวข้อง
 * ข้อมูล: /doc_control/settings/docLinks = { <placeKey>: [docCode, ...] }  */
(function (global) {
  'use strict';
  var DB = 'https://platingapp-92e21-c1346-default-rtdb.asia-southeast1.firebasedatabase.app';
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var DEFAULT_DEPT = 'Production';

  // จุดใช้งาน (ผูกเอกสารที่ Doc Control) — เพิ่มได้ตามต้องการ
  var PLACES = [
    { key: 'plating-entry',  group: 'plating v4/v5/v6', label: 'กรอกรายรอบ' },
    { key: 'plating-chem',   group: 'plating v4/v5/v6', label: 'เคมี' },
    { key: 'plating-thick',  group: 'plating v4/v5/v6', label: 'ความหนา' },
    { key: 'plating-job',    group: 'plating v4/v5/v6', label: 'งาน' },
    { key: 'plating-qa',     group: 'plating v4/v5/v6', label: 'บันทึกผล' },
    { key: 'plating-mcheck', group: 'plating v4/v5/v6', label: 'ตรวจเครื่องจักร' },
    { key: 'jm-intake',      group: 'Job Master', label: 'รับเข้า' },
    { key: 'jm-inv',         group: 'Job Master', label: 'INV / ขายออก' },
    { key: 'temp-delivery',  group: 'Job Master', label: 'บิลส่งของชั่วคราว' },
    { key: 'qc100',          group: 'QC / Tag', label: 'QC 100%' },
    { key: 'tag-card',       group: 'QC / Tag', label: 'Tag Card' },
    { key: 'chem-master',    group: 'อื่น ๆ', label: 'Chem Master' },
    { key: 'part-master',    group: 'อื่น ๆ', label: 'Part Master' }
  ];

  var cache = { t: 0, master: null, links: null };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function getJson(path) { return fetch(DB + path + '.json', { cache: 'no-store' }).then(function (r) { return r.json(); }); }

  function load(force) {
    if (!force && cache.master && Date.now() - cache.t < 60000) return Promise.resolve(cache);
    return Promise.all([getJson('/doc_control/master'), getJson('/doc_control/settings/docLinks')]).then(function (a) {
      cache = { t: Date.now(), master: a[0] || {}, links: a[1] || {} };
      return cache;
    });
  }
  function canView(d, dept) {
    if (!d || d.status === 'cancelled') return false;
    var v = d.viewDepts;
    if (!v || !v.length) return true;
    return v.indexOf(dept || DEFAULT_DEPT) >= 0;
  }
  function revOf(d) { return d && d.revisions && d.revisions.length ? d.revisions[d.revisions.length - 1].rev : ''; }

  // ── modal ──
  var zoom = 100;
  function modal() {
    var m = document.getElementById('dpModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'dpModal';
    m.style.cssText = 'position:fixed;inset:0;background:#0f172a;z-index:100000;display:none;flex-direction:column;font-family:inherit;';
    m.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#1e293b;color:#fff;">' +
        '<button id="dpBack" onclick="DocsPanel._back()" style="display:none;background:#334155;color:#fff;border:0;border-radius:8px;padding:7px 12px;font-size:13px;">← รายการ</button>' +
        '<div id="dpTitle" style="flex:1;font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">📚 เอกสารที่เกี่ยวข้อง</div>' +
        '<span id="dpZoom"><button onclick="DocsPanel._zoom(-50)" style="background:#334155;color:#fff;border:0;border-radius:8px;padding:7px 12px;font-size:15px;">−</button> ' +
        '<button onclick="DocsPanel._zoom(50)" style="background:#334155;color:#fff;border:0;border-radius:8px;padding:7px 12px;font-size:15px;">+</button></span>' +
        '<button onclick="DocsPanel.close()" style="background:#dc2626;color:#fff;border:0;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:700;">✕ ปิด / ပိတ်</button>' +
      '</div>' +
      '<div id="dpBody" style="flex:1;overflow:auto;padding:12px 0;-webkit-overflow-scrolling:touch;"></div>' +
      '<div style="background:#1e293b;color:#cbd5e1;font-size:10px;text-align:center;padding:4px;">เอกสารจาก Doc Control · ดูอย่างเดียว (สำเนาไม่ควบคุม) · ကြည့်ရန်သာ</div>';
    document.body.appendChild(m);
    return m;
  }
  function body() { return document.getElementById('dpBody'); }
  function setTitle(t) { document.getElementById('dpTitle').textContent = t; }
  function msg(h) { body().innerHTML = '<div style="color:#e2e8f0;text-align:center;padding:40px 20px;font-size:14px;line-height:1.7;">' + h + '</div>'; }
  var lastList = null;

  function loadPdfJs(cb) {
    if (global.pdfjsLib) return cb();
    var s = document.createElement('script'); s.src = PDFJS;
    s.onload = function () { try { global.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch (e) {} cb(); };
    s.onerror = function () { cb(new Error('pdfjs')); };
    document.head.appendChild(s);
  }

  function showList(title, docs, extra) {
    lastList = { title: title, docs: docs, extra: extra };
    document.getElementById('dpBack').style.display = 'none';
    document.getElementById('dpZoom').style.display = 'none';
    setTitle(title);
    var h = '<div style="max-width:640px;margin:0 auto;padding:0 12px;">';
    if (!docs.length) h += '<div style="color:#e2e8f0;text-align:center;padding:30px 10px;font-size:14px;">ยังไม่มีเอกสารผูกกับจุดนี้<br><span style="font-size:12px;opacity:.8">Admin ตั้งได้ที่ Doc Control › ตั้งค่า › เอกสารที่เกี่ยวข้อง</span></div>';
    docs.forEach(function (it) {
      h += '<button onclick="DocsPanel._openDoc(\'' + esc(it.code) + '\')" style="display:block;width:100%;text-align:left;background:#fff;border:0;border-radius:12px;padding:12px 14px;margin-bottom:10px;cursor:pointer;">' +
        '<div style="font-size:11px;color:#64748b;font-family:monospace;">' + esc(it.code) + (it.rev ? ' · Rev.' + esc(it.rev) : '') + '</div>' +
        '<div style="font-size:14px;font-weight:700;color:#0f172a;margin-top:2px;">' + esc(it.name) + '</div></button>';
    });
    if (extra) h += '<button onclick="DocsPanel._showAll()" style="display:block;width:100%;background:transparent;color:#93c5fd;border:1px dashed #475569;border-radius:12px;padding:10px;font-size:13px;cursor:pointer;">📂 ดู OPS อื่นทั้งหมด · အခြား OPS များ</button>';
    body().innerHTML = h + '</div>';
  }

  function openDoc(code, fromList) {
    var d = cache.master && cache.master[code];
    if (!d) { msg('ไม่พบเอกสาร'); return; }
    setTitle(code + ' · ' + (d.docName || '') + (revOf(d) ? ' · Rev.' + revOf(d) : ''));
    document.getElementById('dpBack').style.display = lastList ? '' : 'none';
    document.getElementById('dpZoom').style.display = '';
    zoom = 100;
    msg('⏳ กำลังโหลดเอกสาร… / ဖွင့်နေသည်…');
    loadPdfJs(function (err) {
      if (err || !global.pdfjsLib) { msg('❌ โหลดตัวแสดง PDF ไม่ได้ (ต้องมีอินเทอร์เน็ต)'); return; }
      getJson('/doc_control/files/' + d.latestReqId + '_final').then(function (f) {
        if (!f || !f.data) { msg('ไม่พบไฟล์เอกสาร'); return; }
        var bin = atob(f.data), bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return global.pdfjsLib.getDocument({ data: bytes }).promise.then(function (pdf) {
          var sc = body(); sc.innerHTML = '';
          var chain = Promise.resolve();
          for (var n = 1; n <= pdf.numPages; n++) (function (n) {
            chain = chain.then(function () {
              return pdf.getPage(n).then(function (pg) {
                var vp = pg.getViewport({ scale: 2.2 }), cv = document.createElement('canvas');
                cv.width = vp.width; cv.height = vp.height;
                cv.style.cssText = 'display:block;width:' + zoom + '%;background:#fff;margin:0 auto 12px;';
                sc.appendChild(cv);
                return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
              });
            });
          })(n);
          return chain;
        });
      }).catch(function (e) { msg('❌ เปิดเอกสารไม่สำเร็จ: ' + esc(e && e.message || e)); });
    });
  }

  function listFor(place, dept) {
    var codes = (cache.links && cache.links[place]) || [];
    if (!Array.isArray(codes)) codes = Object.keys(codes).map(function (k) { return codes[k]; });
    return codes.filter(function (c) { return canView(cache.master[c], dept); }).map(function (c) {
      var d = cache.master[c]; return { code: c, name: d.docName || '', rev: revOf(d) };
    });
  }
  function allOps(dept) {
    return Object.keys(cache.master || {}).filter(function (c) {
      var d = cache.master[c]; return d && d.docType === 'OPS' && canView(d, dept);
    }).sort().map(function (c) { var d = cache.master[c]; return { code: c, name: d.docName || '', rev: revOf(d) }; });
  }

  var cur = { place: '', dept: DEFAULT_DEPT };
  function open(place, opts) {
    opts = opts || {};
    cur = { place: place, dept: opts.dept || DEFAULT_DEPT };
    modal().style.display = 'flex';
    lastList = null;
    document.getElementById('dpBack').style.display = 'none';
    document.getElementById('dpZoom').style.display = 'none';
    setTitle('📚 เอกสารที่เกี่ยวข้อง');
    msg('⏳ กำลังโหลด… / ဖွင့်နေသည်…');
    load(true).then(function () {
      var docs = listFor(place, cur.dept);
      var pl = PLACES.filter(function (p) { return p.key === place; })[0];
      var title = '📚 เอกสารที่เกี่ยวข้อง' + (pl ? ' · ' + pl.label : '');
      if (docs.length === 1) { lastList = null; openDoc(docs[0].code); }
      else showList(title, docs, true);
    }).catch(function (e) { msg('❌ ติดต่อ Doc Control ไม่ได้: ' + esc(e && e.message || e)); });
  }

  function mount(place, target, opts) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return null;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'dp-btn';
    b.textContent = '📚 เอกสารที่เกี่ยวข้อง · သက်ဆိုင်ရာစာရွက်စာတမ်း';
    b.style.cssText = (opts && opts.style) || 'display:inline-block;margin:6px 0;background:#0f2a4a;color:#fff;border:0;border-radius:10px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer;';
    b.onclick = function () { open(place, opts); };
    el.appendChild(b);
    return b;
  }

  // ใส่ปุ่มไว้บนสุดของ element (เช่น หัวแท็บ/หัวหน้า)
  function mountTop(place, target, opts) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) return null;
    var box = document.createElement('div'); box.style.cssText = 'margin:0 0 8px;';
    el.insertBefore(box, el.firstChild);
    return mount(place, box, opts);
  }

  global.DocsPanel = {
    PLACES: PLACES, mount: mount, mountTop: mountTop, open: open, close: function () { var m = document.getElementById('dpModal'); if (m) m.style.display = 'none'; },
    _zoom: function (d) { zoom = Math.max(100, Math.min(400, zoom + d)); document.querySelectorAll('#dpBody canvas').forEach(function (c) { c.style.width = zoom + '%'; }); },
    _openDoc: function (c) { openDoc(c, true); },
    _back: function () { if (lastList) showList(lastList.title, lastList.docs, lastList.extra); },
    _showAll: function () { showList('📂 OPS ทั้งหมด', allOps(cur.dept), false); }
  };
})(window);
