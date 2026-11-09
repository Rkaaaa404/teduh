# TEDUH — REVISI IMPLEMENTASI FITUR BARU
## Government-Validated Incident Alert System + AI-Assisted Reporting + Post-Journey Feedback
> - ✅ Diganti: **validasi manual oleh pemerintah** sebelum laporan aktif
> - ✅ Ditambah: **alert icon di peta** untuk semua user & pemerintah
> - ✅ Ditambah: **popup deskripsi** saat ikon diklik
> - ✅ Ditambah: **proximity popup validasi** saat user mendekati lokasi insiden
> - ✅ Ditambah: **auto-removal** saat mayoritas user menyatakan kondisi sudah normal

---

## GAMBARAN BESAR SISTEM (DIPERBARUI)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    ALUR LENGKAP FITUR BARU TEDUH                         │
│                                                                          │
│  ┌───────────────┐   ┌────────────────────┐   ┌──────────────────────┐  │
│  │   PELAPORAN   │   │   VALIDASI         │   │  ALERT DI PETA &    │  │
│  │   USER        │──▶│   PEMERINTAH       │──▶│  AUTO-REMOVAL       │  │
│  │               │   │                    │   │                      │  │
│  │ Foto → CV     │   │ Dashboard gov      │   │ Icon di map          │  │
│  │ → Auto-desc   │   │ Acc / Tolak        │   │ Popup deskripsi      │  │
│  │ → Kirim       │   │                    │   │ Proximity popup      │  │
│  │               │   │                    │   │ Auto-hilang          │  │
│  └───────────────┘   └────────────────────┘   └──────────────────────┘  │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                   POST-JOURNEY FEEDBACK                           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

---

# BAGIAN 1: PELAPORAN USER DENGAN AI VISION ASSISTANCE
## (Tidak berubah dari dokumen sebelumnya)

---

### 1.1 Alur Pelaporan

```
SAAT NAVIGASI BERLANGSUNG
│
▼
User menekan tombol [🚨 Laporkan] di layar navigasi
│
├── MODE FOTO (utama)
│   User buka kamera → ambil foto
│   │
│   ▼
│   CLIENT-SIDE:
│   - Kompres foto (canvas.toBlob, max 800KB, JPEG 80%)
│   - Encode ke base64
│   - POST /api/v1/report/analyze-image
│     { image, lat, lon, timestamp }
│   │
│   ▼
│   SERVER (Celery async task):
│
│   ┌─ STEP 1: YOLOv8n Object Detection ──────────────────────────┐
│   │  Input : gambar 640×640                                      │
│   │  Output: [{class: "construction_barrier", conf: 0.91},       │
│   │           {class: "road_cone", conf: 0.95}, ...]             │
│   └──────────────────────────────────────────────────────────────┘
│          │
│   ┌─ STEP 2: CLIP Scene Classification ─────────────────────────┐
│   │  Input : gambar + candidate labels                           │
│   │  Output: scene_class: "road construction blocking sidewalk"  │
│   │          confidence : 0.88                                   │
│   └──────────────────────────────────────────────────────────────┘
│          │
│   ┌─ STEP 3: Severity Rule Engine ───────────────────────────────┐
│   │  Input : scene_class + detected_objects                      │
│   │  Output: { severity: "HIGH",                                 │
│   │            suggested_category: "Konstruksi Jalan" }          │
│   └──────────────────────────────────────────────────────────────┘
│          │
│   ┌─ STEP 4: Template NLG ───────────────────────────────────────┐
│   │  Output: "Terdapat pekerjaan konstruksi yang memblokir       │
│   │  trotoar. Terdeteksi pagar pembatas dan cone lalu lintas.    │
│   │  Kondisi ini kemungkinan menyempitkan jalur pejalan kaki."   │
│   └──────────────────────────────────────────────────────────────┘
│          │
│   Response ke client:
│   { suggested_category, generated_description,
│     severity, confidence, detected_objects }
│   │
│   ▼
│   UI REVIEW (tampil ke user):
│   ┌─────────────────────────────────────────────────────┐
│   │ 🤖 AI mendeteksi: Konstruksi Jalan (88%)           │
│   │                                                     │
│   │ Kategori: ● Konstruksi Jalan ✓                     │
│   │           ○ Jalan Ditutup  ○ Kecelakaan            │
│   │           ○ Trotoar Rusak  ○ Lainnya               │
│   │                                                     │
│   │ Deskripsi (edit jika perlu):                       │
│   │ ┌─────────────────────────────────────────────┐   │
│   │ │ Terdapat pekerjaan konstruksi yang          │   │
│   │ │ memblokir trotoar...                        │   │
│   │ └─────────────────────────────────────────────┘   │
│   │                                                     │
│   │           [✏️ Edit]   [✅ Kirim Laporan]           │
│   └─────────────────────────────────────────────────────┘
│
└── MODE MANUAL (fallback)
    User ketik langsung tanpa foto
    POST /api/v1/report/submit-manual
    { lat, lon, category, description }
```

### 1.2 Yang Terjadi Setelah User Kirim

```
POST /api/v1/report/submit
{
  lat, lon, timestamp,
  category: "Konstruksi Jalan",
  description: "Terdapat pekerjaan konstruksi...",
  severity: "HIGH",
  image_url: "minio://teduh-reports/uuid.jpg",
  ai_suggested: true,
  ai_confidence: 0.88
}
│
▼
Database: INSERT INTO incident_reports
  (id, lat, lon, segment_id, category, description,
   severity, image_url, status, created_at)
VALUES
  (..., 'PENDING_REVIEW')   ← status awal: menunggu persetujuan pemerintah
│
▼
Notifikasi real-time ke dashboard pemerintah
(WebSocket push: "Laporan baru masuk — Konstruksi Jalan, Jl. Basuki Rahmat")
│
▼
→ Dilanjutkan ke Bagian 2 (Validasi Pemerintah)
```

---

---

# BAGIAN 2: VALIDASI OLEH PEMERINTAH
## Panel Moderasi di Dashboard Pemerintah

---

### 2.1 Mengapa Validasi Manual Pemerintah

Alih-alih sistem otomatis yang bisa salah, laporan yang sudah di-generate AI cukup **dimoderasi sekali oleh petugas pemerintah** sebelum aktif di peta. Ini memberikan:
- **Akurasi tinggi** — laporan yang muncul di peta sudah terverifikasi manusia
- **Akuntabilitas** — ada pihak yang bertanggung jawab atas informasi publik
- **Fleksibilitas** — pemerintah bisa mengedit deskripsi sebelum dipublikasikan
- **Kontrol** — laporan tidak valid tidak pernah sampai ke pengguna

---

### 2.2 Tampilan Panel Moderasi di Dashboard Pemerintah

```
DASHBOARD PEMERINTAH — PANEL LAPORAN MASUK
┌──────────────────────────────────────────────────────────────────┐
│ 📋 LAPORAN INSIDEN MASUK                    [Filter ▼] [Refresh]│
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 🟡 MENUNGGU PERSETUJUAN (3)                                     │
│                                                                  │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ #001  ⚠️ Konstruksi Jalan                    10 menit lalu  │ │
│ │       📍 Jl. Basuki Rahmat, dekat Tunjungan Plaza           │ │
│ │       "Terdapat pekerjaan konstruksi yang memblokir trotoar."│ │
│ │       Severity: HIGH  |  AI: 88%  |  📸 Ada foto            │ │
│ │                                                              │ │
│ │  [🗺️ Lihat di Peta]  [🔍 Lihat Detail & Foto]              │ │
│ │  [✅ Setujui & Publikasikan]  [❌ Tolak]  [✏️ Edit & Pub.]  │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ #002  🚧 Jalan Ditutup                       25 menit lalu  │ │
│ │       📍 Jl. Pemuda, arah Balai Kota                        │ │
│ │       "Jalan ditutup untuk acara Car Free Day."             │ │
│ │       Severity: CRITICAL  |  AI: 72%  |  📸 Ada foto        │ │
│ │                                                              │ │
│ │  [🗺️ Lihat di Peta]  [🔍 Lihat Detail & Foto]              │ │
│ │  [✅ Setujui & Publikasikan]  [❌ Tolak]  [✏️ Edit & Pub.]  │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ 🟢 AKTIF DI PETA (5)  │  🔴 DITOLAK (2)  │  ⚫ KEDALUWARSA (8)│
└──────────────────────────────────────────────────────────────────┘
```

### 2.3 Detail Laporan (Modal saat "Lihat Detail & Foto" diklik)

```
┌──────────────────────────────────────────────────────────────────┐
│ DETAIL LAPORAN #001                                    [✕ Tutup] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [────────── FOTO LAPORAN ──────────]                           │
│  [   (foto yang dikirim user)       ]                           │
│  [                                  ]                           │
│                                                                  │
│  Objek terdeteksi AI:  construction_barrier ✓  road_cone ✓     │
│  Scene classification:  Road Construction (88%)                 │
│                                                                  │
│  Kategori    : Konstruksi Jalan                                 │
│  Severity    : HIGH                                             │
│  Lokasi      : -7.2575, 112.7521                                │
│  Waktu lapor : 14 Juli 2026, 10.23 WIB                         │
│  Dilaporkan  : User #U-4821 (anonim)                           │
│                                                                  │
│  Deskripsi (editable):                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Terdapat pekerjaan konstruksi yang memblokir trotoar.    │  │
│  │ Terdeteksi pagar pembatas dan cone lalu lintas.          │  │
│  │ Kondisi ini kemungkinan menyempitkan jalur pejalan kaki. │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  [✅ Setujui & Publikasikan]  [✏️ Edit lalu Publikasikan]      │
│  [❌ Tolak — tidak relevan]                                     │
└──────────────────────────────────────────────────────────────────┘
```

### 2.4 Alur Backend saat Pemerintah Menekan "Setujui"

```
POST /api/v1/report/{id}/approve
{ approved_by: "gov_user_id", final_description: "...", edited: false }
│
▼
Database:
  UPDATE incident_reports
  SET status = 'ACTIVE',
      approved_by = $gov_user_id,
      final_description = $final_description,
      approved_at = NOW()
  WHERE id = $report_id;
│
▼
Trigger otomatis:
  INSERT INTO map_alerts
    (report_id, lat, lon, category, icon_type, description,
     severity, image_url, status, created_at, auto_remove_threshold)
  VALUES
    ($report_id, $lat, $lon, $category, $icon_type,
     $final_description, $severity, $image_url,
     'ACTIVE', NOW(), 0.70);
     ─────────────────────────────────────────────
     auto_remove_threshold = 0.70 artinya:
     jika 70% user yang melewati menyatakan "tidak ada kejadian",
     alert otomatis dihapus
│
▼
WebSocket broadcast ke semua client aktif:
{ event: "new_alert", alert: { id, lat, lon, category, icon_type } }
│
▼
→ Icon insiden langsung muncul di peta semua user & dashboard pemerintah
```

### 2.5 Alur Backend saat Pemerintah Menekan "Tolak"

```
POST /api/v1/report/{id}/reject
{ rejected_by: "gov_user_id", reason: "tidak relevan" }
│
▼
Database:
  UPDATE incident_reports
  SET status = 'REJECTED',
      rejected_by = $gov_user_id
  WHERE id = $report_id;
│
▼
Laporan tidak pernah muncul di peta.
Tidak ada efek ke user manapun.
```

---

---

# BAGIAN 3: ALERT ICON DI PETA
## Visible untuk Semua User dan Pemerintah

---

### 3.1 Jenis Icon Alert per Kategori

| Kategori | Icon | Warna | Contoh Simbol |
|---|---|---|---|
| Konstruksi Jalan | 🚧 | Oranye | Barrier/cone |
| Jalan Ditutup | 🚫 | Merah | Stop |
| Kecelakaan | ⚠️ | Merah terang | Segitiga bahaya |
| Trotoar Rusak | 🪨 | Abu-abu | Retak |
| Genangan/Banjir | 💧 | Biru | Air |
| Paparan Panas Tinggi | 🌡️ | Oranye kemerahan | Termometer |

---

### 3.2 Tampilan Icon di Peta (MapLibre GL)

```
LAYAR PETA USER (dengan alert aktif):

┌─────────────────────────────────────────────────┐
│  [Peta Surabaya — MapLibre GL]                  │
│                                                 │
│   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·             │
│   ·  ·  ·  ·  🚧  ·  ·  ·  ·  ·  ·            │
│   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·             │
│   ·  ·  ·  ·  ·  ·  ⚠️ ·  ·  ·  ·             │
│   ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·             │
│   ·  ·  [USER]  ·  ·  ·  ·  ·  ·  ·           │
│   ·  ·  ·  ·  ·  ·  ·  ·  🚫 ·  ·             │
│                                                 │
│  Icon legend (sudut kanan bawah):              │
│  🚧 Konstruksi  ⚠️ Kecelakaan  🚫 Ditutup    │
│  🪨 Rusak  💧 Genangan  🌡️ Panas Tinggi      │
│                                                 │
│  [🔍 Cari]  [🗺️ Layer]  [🚨 Laporkan]        │
└─────────────────────────────────────────────────┘

LAYAR PETA DASHBOARD PEMERINTAH (dengan alert aktif):

┌─────────────────────────────────────────────────┐
│  [Peta Surabaya — MapLibre GL]                  │
│                                                 │
│   🚧  ·  ·  ·  ⚠️  ·  ·  🚫  ·              │
│   ·  ·  ·  ·  ·  🌡️  ·  ·  ·              │
│                                                 │
│  [Laporan Masuk: 3 pending ●]                  │
│  [Alert Aktif: 5]                              │
│  [Nonaktifkan Pilihan]                         │
└─────────────────────────────────────────────────┘
```

---

### 3.3 Popup saat Icon Diklik (USER & PEMERINTAH)

```
USER KLIK ICON 🚧 di peta:

┌──────────────────────────────────────────────┐
│  🚧 KONSTRUKSI JALAN                [✕]     │
├──────────────────────────────────────────────┤
│  📍 Jl. Basuki Rahmat               HIGH    │
│  🕐 Dilaporkan 35 menit lalu               │
│  ✅ Diverifikasi oleh Dishub Surabaya       │
│                                              │
│  [── FOTO KEJADIAN ──]                      │
│  [ (foto dari laporan user) ]               │
│                                              │
│  Terdapat pekerjaan konstruksi yang         │
│  memblokir trotoar di lokasi ini.           │
│  Terdeteksi pagar pembatas dan cone         │
│  lalu lintas. Kondisi ini kemungkinan       │
│  menyempitkan jalur pejalan kaki.           │
│                                              │
│  📊 Status validasi komunitas:              │
│  ████████░░  78% masih terjadi (14 user)   │
│                                              │
│  [🗺️ Hindari Rute Ini]  [✕ Tutup]         │
└──────────────────────────────────────────────┘


PEMERINTAH KLIK ICON 🚧 di dashboard:

┌──────────────────────────────────────────────┐
│  🚧 KONSTRUKSI JALAN                [✕]     │
├──────────────────────────────────────────────┤
│  📍 Jl. Basuki Rahmat               HIGH    │
│  🕐 Disetujui: 14 Jul 2026, 10.25 WIB      │
│  👤 Disetujui oleh: Operator A             │
│                                              │
│  [── FOTO KEJADIAN ──]                      │
│                                              │
│  [Deskripsi laporan...]                     │
│                                              │
│  📊 Validasi komunitas:                     │
│  14 user: Masih terjadi                     │
│   3 user: Sudah tidak ada                   │
│  ████████░░  78% masih terjadi              │
│  (Auto-remove jika < 30% dalam 12 jam)      │
│                                              │
│  [✏️ Edit Deskripsi]  [🗑️ Nonaktifkan]     │
│  [✕ Tutup]                                  │
└──────────────────────────────────────────────┘
```

### 3.4 Implementasi Icon di MapLibre GL

```javascript
// Inisialisasi saat peta dimuat
map.on('load', () => {

  // Load semua icon alert
  const alertIcons = {
    'construction': '/icons/alert-construction.png',
    'road_closed':  '/icons/alert-closed.png',
    'accident':     '/icons/alert-accident.png',
    'damaged':      '/icons/alert-damaged.png',
    'flood':        '/icons/alert-flood.png',
    'heat':         '/icons/alert-heat.png',
  };

  Object.entries(alertIcons).forEach(([name, url]) => {
    map.loadImage(url, (err, img) => {
      if (!err) map.addImage(`icon-${name}`, img);
    });
  });

  // Tambahkan GeoJSON source (diisi dari API)
  map.addSource('incident-alerts', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  // Layer icon di atas peta
  map.addLayer({
    id: 'incident-icons',
    type: 'symbol',
    source: 'incident-alerts',
    layout: {
      'icon-image': ['concat', 'icon-', ['get', 'icon_type']],
      'icon-size': 1.2,
      'icon-allow-overlap': true,
      'icon-anchor': 'bottom'
    }
  });

  // Klik pada icon → tampilkan popup
  map.on('click', 'incident-icons', (e) => {
    const props = e.features[0].properties;
    const coords = e.features[0].geometry.coordinates;
    showAlertPopup(props, coords);  // fungsi render popup (lihat 3.3)
  });

  // Cursor pointer saat hover
  map.on('mouseenter', 'incident-icons', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'incident-icons', () => {
    map.getCanvas().style.cursor = '';
  });
});

// Fungsi update icon dari WebSocket
function updateAlertIcons(alerts) {
  const geojson = {
    type: 'FeatureCollection',
    features: alerts.map(a => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
      properties: {
        id: a.id,
        icon_type: a.icon_type,
        category: a.category,
        description: a.description,
        image_url: a.image_url,
        severity: a.severity,
        reported_at: a.created_at,
        community_pct: a.community_still_active_pct
      }
    }))
  };
  map.getSource('incident-alerts').setData(geojson);
}

// WebSocket: update real-time saat ada alert baru / dihapus
const ws = new WebSocket('wss://api.teduh.id/ws/alerts');
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.event === 'new_alert' || msg.event === 'alert_removed') {
    fetchAndUpdateAlerts();  // ambil daftar alert terbaru dari API
  }
};
```

---

---

# BAGIAN 4: PROXIMITY POPUP & AUTO-REMOVAL
## Validasi Komunitas saat User Mendekati Lokasi Insiden

---

### 4.1 Proximity Detection

```
SAAT USER SEDANG NAVIGASI:

Geolocation API memantau posisi user setiap 5 detik
│
▼
Client menghitung jarak ke setiap alert aktif:

  distance = haversine(user.lat, user.lon, alert.lat, alert.lon)

  Jika distance ≤ 80 meter DAN alert belum pernah ditampilkan
  kepada user ini dalam 2 jam terakhir:
  → Tampilkan Proximity Popup
```

### 4.2 Tampilan Proximity Popup

```
PROXIMITY POPUP (muncul otomatis saat user ~80m dari alert):

┌─────────────────────────────────────────────────────────┐
│  ⚠️ Ada insiden di dekat Anda                          │
│                                                         │
│  🚧 Konstruksi Jalan — Jl. Basuki Rahmat              │
│  "Terdapat pekerjaan konstruksi yang memblokir trotoar."│
│                                                         │
│  Apakah kondisi ini masih terjadi?                     │
│                                                         │
│  [✅ Ya, masih terjadi]   [❌ Tidak, sudah normal]     │
│                    [Lewati]                             │
└─────────────────────────────────────────────────────────┘
```

### 4.3 Alur Backend saat User Merespons

```
POST /api/v1/alert/{alert_id}/validate
{ response: "still_active" | "no_longer_active", user_id }
│
▼
Database:
  INSERT INTO alert_validations
    (alert_id, user_id, response, validated_at)
  VALUES
    ($alert_id, $user_id, $response, NOW());
│
▼
Hitung ulang persentase validasi:

  SELECT
    COUNT(*) FILTER (WHERE response = 'no_longer_active') AS no_count,
    COUNT(*) AS total_count
  FROM alert_validations
  WHERE alert_id = $alert_id
    AND validated_at > NOW() - INTERVAL '2 hours';

  pct_no = no_count / total_count

  Minimal responden untuk dianggap valid: 5 responden

▼
Evaluasi auto-removal:

  IF pct_no >= 0.70 AND total_count >= 5:
    UPDATE map_alerts
    SET status = 'AUTO_REMOVED',
        removed_at = NOW(),
        removed_reason = 'community_validation'
    WHERE id = $alert_id;

    DELETE FROM map_alerts WHERE id = $alert_id;

    WebSocket broadcast ke semua client:
    { event: "alert_removed", alert_id: $alert_id }
    → Icon di peta semua user langsung hilang
```

### 4.4 Skenario Lengkap Auto-Removal

```
CONTOH SKENARIO:

14:00 — User A melapor konstruksi di Jl. X via TEDUH-Eye
14.05 — Petugas Dishub menyetujui → icon 🚧 muncul di peta
14.10 — 3 user lewat jalan itu → popup muncul:
         User B: "✅ masih terjadi"
         User C: "✅ masih terjadi"
         User D: "✅ masih terjadi"
         → pct_no = 0% → alert tetap aktif

16.00 — Konstruksi selesai, jalan normal kembali
16.05 — User E lewat → "❌ sudah normal"
16.10 — User F lewat → "❌ sudah normal"
16.15 — User G lewat → "❌ sudah normal"
16.20 — User H lewat → "❌ sudah normal"
         → pct_no = 4/7 = 57% (belum 70% + belum 5 responden "tidak")
16.25 — User I lewat → "❌ sudah normal"
         → pct_no = 5/8 = 62.5% (belum 70%)
16.30 — User J lewat → "❌ sudah normal"
         → pct_no = 6/9 = 66.7% (belum 70%)
16.35 — User K lewat → "❌ sudah normal"
         → pct_no = 7/10 = 70% ✅ DAN total_count ≥ 5 ✅

         TRIGGER AUTO-REMOVAL:
         → status = 'AUTO_REMOVED'
         → WebSocket broadcast
         → Icon 🚧 hilang dari peta semua user dan dashboard pemerintah
         → Pemerintah mendapat notifikasi:
           "Alert #001 di Jl. Basuki Rahmat otomatis dinonaktifkan
            berdasarkan validasi komunitas (7/10 user menyatakan sudah normal)"
```

---

### 4.5 Pemerintah Bisa Nonaktifkan Manual

Selain auto-removal oleh komunitas, pemerintah juga bisa langsung menonaktifkan alert kapan saja dari dashboard (misal: mereka sudah konfirmasi kondisi normal lewat petugas lapangan):

```
DELETE /api/v1/alert/{alert_id}
{ deleted_by: "gov_user_id", reason: "kondisi sudah normal (konfirmasi lapangan)" }
│
▼
UPDATE map_alerts SET status = 'MANUALLY_REMOVED' WHERE id = $alert_id;
WebSocket broadcast { event: "alert_removed", alert_id }
```

---

---

# BAGIAN 5: POST-JOURNEY FEEDBACK
## (Tidak berubah dari dokumen sebelumnya)

```
Setelah navigasi selesai (user tekan "Selesai" atau
proximity detection ke tujuan dalam radius 50m ≥30 detik):

┌──────────────────────────────────────────────────────────┐
│  🎉 Anda tiba di tujuan!                               │
│                                                          │
│  Bagaimana kondisi yang Anda rasakan?                   │
│                                                          │
│  🌡 Kenyamanan termal:                                  │
│     Sangat Panas  1 ─ 2 ─ 3 ─[4]─ 5  Sejuk             │
│                                                          │
│  🌿 Keteduhan jalur:                                    │
│     Tidak Ada    1 ─[2]─ 3 ─ 4 ─ 5  Sangat Teduh       │
│                                                          │
│  🚶 Kelancaran jalur:                                   │
│     Tersumbat    1 ─ 2 ─[3]─ 4 ─ 5  Lancar             │
│                                                          │
│  Ada kondisi yang belum dilaporkan?                     │
│  ○ Tidak ada  ● Ya → [Laporkan sekarang]                │
│                                                          │
│                         [Kirim & Selesai]               │
└──────────────────────────────────────────────────────────┘

Data dikirim ke:
→ Tabel user_feedback (evaluasi akurasi TCS)
→ Dashboard pemerintah: rating per koridor
→ Retraining Decision Tree Regressor (berkala)
```

---

---

# BAGIAN 6: SCHEMA DATABASE LENGKAP

---

```sql
-- ─────────────────────────────────────────────────────────────
-- TABEL 1: Laporan insiden dari user
-- ─────────────────────────────────────────────────────────────
CREATE TABLE incident_reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID,                    -- bisa anonim (nullable)
  lat               DECIMAL(10, 7) NOT NULL,
  lon               DECIMAL(10, 7) NOT NULL,
  segment_id        UUID,                    -- hasil snap PostGIS
  category          VARCHAR(50) NOT NULL,    -- 'construction', 'accident', dll
  description       TEXT NOT NULL,           -- deskripsi final (bisa diedit)
  severity          VARCHAR(20),             -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
  image_url         TEXT,                    -- URL foto di MinIO
  ai_suggested      BOOLEAN DEFAULT FALSE,
  ai_confidence     DECIMAL(4,3),
  status            VARCHAR(30) DEFAULT 'PENDING_REVIEW',
                    -- 'PENDING_REVIEW' | 'ACTIVE' | 'REJECTED' | 'EXPIRED'
  approved_by       UUID,                    -- gov user id (nullable)
  approved_at       TIMESTAMPTZ,
  final_description TEXT,                    -- deskripsi final setelah gov edit
  rejected_by       UUID,
  rejected_reason   TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- TABEL 2: Alert aktif yang tampil di peta
-- ─────────────────────────────────────────────────────────────
CREATE TABLE map_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id         UUID REFERENCES incident_reports(id),
  lat               DECIMAL(10, 7) NOT NULL,
  lon               DECIMAL(10, 7) NOT NULL,
  geom              GEOMETRY(Point, 4326),   -- PostGIS geometry
  category          VARCHAR(50) NOT NULL,
  icon_type         VARCHAR(30) NOT NULL,    -- 'construction', 'accident', dll
  description       TEXT NOT NULL,
  image_url         TEXT,
  severity          VARCHAR(20),
  status            VARCHAR(30) DEFAULT 'ACTIVE',
                    -- 'ACTIVE' | 'AUTO_REMOVED' | 'MANUALLY_REMOVED'
  auto_remove_threshold DECIMAL(4,3) DEFAULT 0.70,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  removed_at        TIMESTAMPTZ,
  removed_reason    TEXT
);

CREATE INDEX idx_map_alerts_geom ON map_alerts USING GIST(geom);
CREATE INDEX idx_map_alerts_status ON map_alerts(status);

-- ─────────────────────────────────────────────────────────────
-- TABEL 3: Respons validasi dari user yang melewati alert
-- ─────────────────────────────────────────────────────────────
CREATE TABLE alert_validations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id      UUID REFERENCES map_alerts(id),
  user_id       UUID,
  response      VARCHAR(20) NOT NULL,     -- 'still_active' | 'no_longer_active'
  validated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(alert_id, user_id)               -- 1 user 1 respons per alert
);

-- ─────────────────────────────────────────────────────────────
-- TABEL 4: Feedback akhir perjalanan
-- ─────────────────────────────────────────────────────────────
CREATE TABLE user_feedback (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID,
  route_id        UUID,
  tcs_predicted   DECIMAL(4,3),
  rating_thermal  SMALLINT CHECK (rating_thermal BETWEEN 1 AND 5),
  rating_shade    SMALLINT CHECK (rating_shade BETWEEN 1 AND 5),
  rating_walkway  SMALLINT CHECK (rating_walkway BETWEEN 1 AND 5),
  has_unreported  BOOLEAN DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

---

# BAGIAN 7: TECH STACK RINGKAS

| Komponen | Teknologi | Peran |
|---|---|---|
| **Object Detection** | YOLOv8n (Ultralytics) | Deteksi objek dari foto laporan |
| **Scene Classification** | CLIP ViT-B/32 (HuggingFace) | Zero-shot klasifikasi jenis insiden |
| **Auto-Description** | Template NLG (Python) | Susun kalimat deskripsi otomatis |
| **Async Task** | Celery + Redis | Proses AI inference tanpa blocking HTTP |
| **File Storage** | MinIO | Simpan foto laporan user |
| **Camera API** | MediaDevices API (browser) | Akses kamera tanpa library tambahan |
| **Image Compression** | browser-image-compression (npm) | Kompres foto sisi klien sebelum upload |
| **Map Icons** | MapLibre GL Symbol Layer | Render icon alert di atas peta |
| **Real-time Update** | WebSocket (FastAPI WebSocket) | Push event baru/hapus alert ke semua client |
| **Proximity Detection** | Geolocation API + Haversine (client-side) | Deteksi user mendekati lokasi alert |
| **Spatial Snap** | PostGIS ST_ClosestPoint | Snap koordinat laporan ke segment jalan |
| **Database** | PostgreSQL | Semua tabel (incident_reports, map_alerts, dll) |
| **API** | FastAPI | Semua endpoint baru |
| **Frontend** | Next.js + MapLibre GL | UI laporan, popup, proximity, feedback |

---

---

# BAGIAN 8: INSTRUKSI REVISI PROPOSAL

> Berikut adalah instruksi lengkap sub-bab apa saja yang perlu ditambah,
> diedit, atau direvisi di proposal TEDUH, beserta posisinya.

---

## 8.1 Revisi Tabel State of the Art (Bab II.2)

**Tambahkan 1 baris baru** di Tabel 2.1 sebelum baris TEDUH:

| No | Penelitian/Solusi | Kontribusi | Keterbatasan |
|---|---|---|---|
| 8 | Waze / Google Maps Crowdsourcing (2022–kini) | Pelaporan insiden lalu lintas berbasis pengguna dengan sistem validasi komunitas | Terbatas pada konteks kendaraan bermotor; tidak mengintegrasikan Computer Vision untuk auto-description; tidak terhubung dengan data kenyamanan termal pejalan kaki |

*(Nomor baris TEDUH yang semula 8 diubah menjadi 9)*

---

## 8.2 Revisi Research Gap (Bab II.3)

**Tambahkan poin ke-6** setelah poin ke-5 yang sudah ada:

> **Keenam:** Kondisi lapangan yang bersifat transien—seperti konstruksi jalan, kecelakaan, atau penutupan trotoar sementara—belum dapat ditangkap oleh pipeline sensor dan API yang berjalan secara berkala. Kejadian semacam ini tidak tercermin dalam nilai Thermal Comfort Score hingga siklus pembaruan data berikutnya, sehingga terdapat jeda antara perubahan kondisi nyata dan respons sistem navigasi. Belum ada sistem yang menggabungkan *Computer Vision* untuk pelaporan cepat, validasi pemerintah sebagai gate-keeper informasi publik, serta mekanisme validasi komunitas untuk penghapusan otomatis, dalam satu platform navigasi termal perkotaan.

---

## 8.3 Revisi Novelty TEDUH (Bab II.4)

**Tambahkan poin ke-7** setelah poin ke-6 yang sudah ada:

> 7. Mengintegrasikan pipeline *Computer Vision* berbasis YOLOv8 dan CLIP untuk menghasilkan deskripsi laporan insiden jalan secara otomatis dari foto pengguna, dengan alur validasi berlapis: AI menyusun laporan secara otomatis, pemerintah melakukan verifikasi sebelum informasi dipublikasikan, dan komunitas pengguna melakukan validasi berkelanjutan. Laporan yang terverifikasi ditampilkan sebagai *alert icon* interaktif di peta yang dapat diakses oleh seluruh pengguna dan pemerintah, dilengkapi mekanisme penghapusan otomatis berbasis konsensus komunitas.

---

## 8.4 Tambah Sub-bab 3.9.2 (Bab III, setelah 3.9)

**Judul: AI-Assisted Incident Reporting dan Government-Validated Alert System (TEDUH-Eye)**

**Teks lengkap:**

> TEDUH mengintegrasikan mekanisme pelaporan insiden berbasis kecerdasan buatan yang memungkinkan pengguna mengirimkan laporan kondisi lapangan secara *real-time* selama navigasi berlangsung, dengan alur validasi yang melibatkan pemerintah dan komunitas pengguna secara berjenjang.
>
> **Pelaporan dengan AI Vision Assistance.** Pengguna yang menemui hambatan di jalur perjalanan—seperti konstruksi jalan, kecelakaan, atau trotoar rusak—cukup mengambil foto kondisi tersebut melalui antarmuka kamera yang terintegrasi dalam aplikasi. Foto kemudian diproses oleh pipeline *Computer Vision* yang terdiri atas tiga tahap: (1) deteksi objek menggunakan YOLOv8 yang telah di-*fine-tune* pada dataset kondisi jalan perkotaan Indonesia untuk mengidentifikasi objek seperti pagar pembatas, *cone* lalu lintas, kerusakan permukaan, dan kehadiran pekerja; (2) klasifikasi skenario menggunakan model CLIP dalam mode *zero-shot* untuk menentukan kategori insiden; dan (3) pembangkitan deskripsi otomatis menggunakan mesin *Natural Language Generation* berbasis template Bahasa Indonesia. Hasil ketiga tahap tersebut disajikan kepada pengguna untuk ditinjau dan dikirimkan, tanpa perlu mengetik satu kata pun.
>
> **Validasi oleh Pemerintah.** Setiap laporan yang masuk berstatus *Pending Review* dan ditampilkan pada panel moderasi di dashboard pemerintah. Petugas yang berwenang dapat meninjau foto, deskripsi, dan metadata laporan, kemudian memilih untuk menyetujui, menolak, atau mengedit deskripsi sebelum mempublikasikan. Pendekatan ini menjamin bahwa informasi yang ditampilkan kepada publik telah diverifikasi oleh pihak yang berwenang, sehingga akuntabilitas informasi dapat terjaga.
>
> **Alert Icon di Peta.** Laporan yang disetujui oleh pemerintah secara otomatis ditampilkan sebagai ikon insiden pada peta interaktif yang dapat diakses oleh seluruh pengguna maupun dashboard pemerintah. Setiap ikon bersifat interaktif—pengguna dan pemerintah dapat mengklik ikon untuk menampilkan *popup* berisi foto kejadian, deskripsi terverifikasi, tingkat keparahan, waktu pelaporan, dan status validasi komunitas.
>
> **Proximity Popup dan Validasi Komunitas.** Ketika pengguna mendekati lokasi insiden dalam radius 80 meter, sistem secara otomatis menampilkan notifikasi yang meminta konfirmasi apakah kondisi tersebut masih berlangsung. Respons pengguna digunakan untuk menghitung persentase validasi secara berkelanjutan. Apabila 70% atau lebih dari responden dalam dua jam terakhir menyatakan bahwa kondisi sudah tidak ada, sistem secara otomatis menonaktifkan ikon dari peta seluruh pengguna (*auto-removal*) dan mengirimkan notifikasi kepada pemerintah. Pemerintah juga dapat menonaktifkan ikon secara manual kapan saja melalui dashboard.

---

## 8.5 Tambah Sub-bab 3.9.3 (Bab III, setelah 3.9.2)

**Judul: Post-Journey Feedback**

**Teks lengkap:**

> TEDUH menyediakan mekanisme umpan balik yang ditampilkan secara otomatis setelah perjalanan selesai. Pengguna memberikan penilaian terhadap tiga dimensi: kenyamanan termal yang dirasakan, tingkat keteduhan jalur, dan kelancaran jalur pejalan kaki, masing-masing dalam skala 1–5. Data umpan balik dimanfaatkan untuk mengevaluasi korelasi antara nilai TCS yang diprediksi dan persepsi nyata pengguna, memperkaya dashboard pemerintah dengan indikator kepuasan pejalan kaki per koridor, serta menjadi bahan pelatihan ulang model *Decision Tree Regressor* secara berkala.

---

## 8.6 Tambah Sub-bab 4.2.6 dan 4.2.7 (Bab IV, setelah 4.2.5)

### 4.2.6 Pelaporan Insiden dengan AI Vision Assistance

> Fitur ini memungkinkan pengguna aktif melaporkan kondisi lapangan yang tidak tertangkap sensor dengan mengambil foto melalui antarmuka yang terintegrasi dalam layar navigasi. Sistem secara otomatis menganalisis foto menggunakan pipeline *Computer Vision* (YOLOv8 + CLIP + Template NLG) untuk menyusun deskripsi laporan yang terstruktur dalam Bahasa Indonesia. Pengguna dapat merevisi deskripsi tersebut sebelum mengirimkan laporan. Laporan masuk ke panel moderasi dashboard pemerintah; jika disetujui, ikon insiden langsung muncul di peta seluruh pengguna. Pengguna yang mendekati lokasi ikon akan mendapat notifikasi *proximity popup* untuk mengonfirmasi apakah kondisi masih berlangsung, sehingga sistem dapat menonaktifkan ikon secara otomatis ketika konsensus komunitas menyatakan kondisi sudah normal.

### 4.2.7 Post-Journey Feedback

> Setelah perjalanan selesai, pengguna mengisi penilaian singkat terhadap kenyamanan termal, keteduhan, dan kelancaran jalur yang baru ditempuh. Data ini ditampilkan pada dashboard pemerintah sebagai indikator kepuasan pejalan kaki per koridor dan digunakan untuk evaluasi akurasi prediksi Thermal Comfort Score secara berkala.

---

## 8.7 Diagram yang Perlu Direvisi

| No | Diagram | Perubahan yang Diperlukan |
|---|---|---|
| 1 | **Arsitektur Sistem (Gambar 3.4.1)** | Tambahkan dua komponen baru di sisi kiri pipeline: `Celery + Redis` (async AI task) dan `MinIO` (file storage). Tambahkan komponen `WebSocket Server` di service layer. Tambahkan alur dari `incident_reports → map_alerts → Frontend Map`. |
| 2 | **Alur Penggunaan / Dokumentasi Penggunaan (Gambar 4.3.1 / 4.3.2)** | Tambahkan dua alur baru setelah alur navigasi utama: (a) alur pelaporan insiden — tombol Laporkan → kamera → AI review → kirim → pending gov; (b) alur post-journey feedback — tiba di tujuan → form feedback → kirim. |
| 3 | **Dashboard Pemerintah (Gambar 4.2.3.x)** | Tambahkan panel baru "Laporan Masuk" di sidebar atau tab terpisah yang menampilkan daftar laporan berstatus Pending Review dengan tombol Setujui/Tolak/Edit. Pastikan peta di dashboard juga menampilkan ikon alert yang sudah aktif. |

---

## 8.8 Ringkasan Perubahan di Proposal

| Bab | Perubahan |
|---|---|
| **II.2 State of the Art** | Tambah 1 baris (Waze/Google Maps crowdsourcing) sebelum baris TEDUH |
| **II.3 Research Gap** | Tambah poin ke-6 (kondisi transien + gap CV + validasi pemerintah) |
| **II.4 Novelty** | Tambah poin ke-7 (pipeline CV + validasi berlapis + alert icon + auto-removal) |
| **III.9 — baru 3.9.2** | Sub-bab baru: AI-Assisted Incident Reporting & Alert System |
| **III.9 — baru 3.9.3** | Sub-bab baru: Post-Journey Feedback |
| **IV.2 — baru 4.2.6** | Sub-bab baru: Pelaporan Insiden dengan AI Vision Assistance |
| **IV.2 — baru 4.2.7** | Sub-bab baru: Post-Journey Feedback |
| **Gambar 3.4.1** | Revisi diagram arsitektur (tambah Celery, MinIO, WebSocket, map_alerts) |
| **Gambar 4.3.x** | Revisi alur penggunaan (tambah alur laporan + feedback) |
| **Gambar 4.2.3.x** | Revisi screenshot dashboard (tambah panel laporan masuk + ikon peta) |

---

*Dokumen selesai. Semua teks di Bagian 8 sudah dalam format siap salin ke proposal TEDUH.*
