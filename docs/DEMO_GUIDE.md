# 🎓 PENCERDASAN DEMO Teduh
## Panduan Utama Presentasi, Alur Arsitektur, Formula Matematis, dan Pemahaman Teknis E2E

Dokumen ini disusun sebagai panduan belajar cepat ("Cheat Sheet") bagi tim untuk menguasai seluruh aspek teoritis, teknis, arsitektur, dan demo sistem **Teduh** saat presentasi di depan dosen/penguji.

---

## 1. Konsep & Latar Belakang Masalah
*   **Masalah Utama:** Kota Surabaya adalah kota metropolitan dengan paparan panas ekstrem (efek *Urban Heat Island* / UHI). Suhu udara rata-rata yang tinggi dikombinasikan dengan kelembapan tinggi membuat pejalan kaki enggan berjalan di trotoar terbuka karena resiko stres panas (*heat stress*).
*   **Solusi Teduh:** Membangun mesin navigasi cerdas yang tidak hanya mencari jalur terpendek (shortest path), tetapi jalur ternyaman secara termal (most comfortable path). Mesin ini memadukan data spasial geospasial (OSM), data fisik real-time (cuaca, kemacetan, polusi udara), proyeksi bayangan bangunan 3D, serta model kecerdasan buatan (MLlib) untuk simulasi tata kota.

---

## 2. Struktur Tech Stack & Alur Data Lakehouse (Medallion)

Sistem ini berjalan dengan arsitektur **Data Lakehouse** berbasis kontainer Docker. Data mengalir dari sensor/API eksternal masuk ke **HDFS (Hadoop Distributed File System)** dan diproses oleh **Apache Spark + Apache Sedona** sebelum disinkronisasikan ke PostgreSQL/PostGIS.

### A. Alur Ingestion ke HDFS (WebHDFS)
Data mentah (Raw Data) dari berbagai REST API tidak diunduh ke disk lokal kontainer, melainkan langsung ditulis ke HDFS secara periodik menggunakan **WebHDFS REST API**:
*   **Open-Meteo API (Cuaca & Radiasi):** Ingest setiap 15 menit $\rightarrow$ `/lakehouse/bronze/weather/`
*   **TomTom API (Kemacetan Jalan):** Ingest setiap 15 menit $\rightarrow$ `/lakehouse/bronze/traffic/`
*   **WAQI API (Indeks Kualitas Udara):** Ingest setiap 30 menit $\rightarrow$ `/lakehouse/bronze/aqi/`
*   **BMKG Feed (Peringatan Cuaca Ekstrem):** Ingest setiap 5 menit $\rightarrow$ `/lakehouse/bronze/alerts/`

### B. Pemrosesan Medallion Architecture di Spark (PySpark)
1.  **Bronze Layer (HDFS):** Data mentah berupa JSON/XML terstruktur dari API disimpan langsung apa adanya.
2.  **Silver Layer (HDFS - Parquet):**
    *   Spark membaca data Bronze, mem-parsing skema JSON, menangani nilai kosong/null, dan melakukan standarisasi tipe data.
    *   Disimpan dalam format **Parquet** terkompresi di `hdfs://.../lakehouse/silver/` untuk performa baca kueri analitik yang cepat.
3.  **Gold Layer (HDFS & PostgreSQL - Parquet):**
    *   Data Silver diintegrasikan secara spasial dengan data jaringan jalan menggunakan **Apache Sedona** (Spasial Join).
    *   Spark melakukan kalkulasi rumus **Thermal Comfort Score (TCS)** per segmen jalan dan menghasilkan bobot navigasi.
    *   Hasilnya disinkronkan ke PostgreSQL serving layer melalui **Spark JDBC Sink** dengan parameter `.mode("overwrite")` dan `.option("truncate", "true")` untuk menjaga keutuhan indeks dan konstrain PostGIS.

---

## 3. Landasan Ilmiah & Rumus Matematika Proyek

### A. Formula Utama Thermal Comfort Score (TCS)
Setiap segmen jalan memiliki skor kenyamanan termal (rentang $0.0$ - $1.0$) yang dihitung setiap jam dengan bobot parameter sebagai berikut:
$$\text{TCS} = 0.35 \times \text{shade\_score} + 0.30 \times \text{temp\_score} + 0.15 \times \text{aqi\_score} + 0.10 \times \text{traffic\_score} + 0.10 \times \text{surface\_score}$$

#### 1. Shade Score (Naungan - Bobot 35%)
*   **Rumus:** $\text{shade\_score} = 0.7 \times \text{shade\_ratio} + 0.3 \times \text{ndvi\_proxy}$
*   **shade_ratio (0.0 - 1.0):** Rasio jalan yang tertutup bayangan fisik gedung/pohon. Dihitung secara dinamis di Spark dengan memroyeksikan matahari (Azimuth & Altitude berdasarkan jam/tanggal di Surabaya) terhadap objek 3D bangunan.
*   **ndvi_proxy (0.1 - 0.72):** Proksi vegetasi berdasarkan jumlah pohon (`natural=tree` di OSM) dalam radius 30m dari jalan.
*   *Justifikasi Akademis:* Penelitian **Teshima et al. (2021)** membuktikan naungan pohon rindang mengurangi suhu terasa (UTCI) sebesar **6°C - 10°C** di iklim tropis basah.

#### 2. Temperature Score (Suhu Terasa & Permukaan - Bobot 30%)
*   **Rumus:**
    $$\text{temp\_score} = 1.0 - \frac{T_{gabungan} - T_{min}}{T_{max} - T_{min}}$$
    *   Di mana:
        *   $T_{gabungan} = 0.6 \times \text{apparent\_temp} + 0.4 \times \text{LST}$
        *   $\text{apparent\_temp}$ (Suhu Terasa tubuh manusia) diperoleh dari Open-Meteo.
        *   $\text{LST}$ (Land Surface Temperature) adalah proxy suhu aspal/permukaan jalan:
            $$\text{LST} = \text{Suhu Udara} + \text{Koreksi Permukaan}$$
            *(Koreksi Permukaan: Asphalt +8°C, Concrete +6°C, Paving +4°C, Grass -2°C).*
        *   $T_{min} = 28^\circ\text{C}$ (Batas bawah kenyamanan maksimal $\rightarrow$ Skor 1.0)
        *   $T_{max} = 45^\circ\text{C}$ (Batas atas suhu panas ekstrem $\rightarrow$ Skor 0.0)

#### 3. AQI Score (Kualitas Udara - Bobot 15%)
*   **Rumus:**
    $$\text{aqi\_score} = 1.0 - \frac{\text{AQI\_value}}{150.0} \quad (\text{dibatasi di rentang } [0.0, 1.0])$$
    *   Jika indeks AQI melampaui 150 (tidak sehat secara medis), skor kontribusinya otomatis menjadi 0.0.

#### 4. Traffic Score (Kepadatan Lalu Lintas - Bobot 10%)
*   **Mekanisme:** Mengurangi kenyamanan psikologis pejalan kaki akibat polusi suara & knalpot lokal di dekat jalan raya utama berdasarkan `congestion_ratio` dari TomTom API.

#### 5. Surface Score (Kualitas Permukaan Jalan - Bobot 10%)
*   **Rumus:** $\text{surface\_score} = 0.5 \times \text{surface\_type} + 0.5 \times \text{smoothness}$
*   Jalur pedestrian ber-paving mulus mendapat nilai $1.0$, sedangkan trotoar tanah atau berlubang mendapat skor rendah ($0.2$).

---

## 4. Logika Routing (pgRouting) & Personal Heat Budget

Sistem navigasi melakukan pencarian rute menggunakan algoritma **Dijkstra (`pgr_dijkstra`)** di atas graf jalan (`segments_noded`).

### A. Bobot Rute Terpendek (Shortest Route)
Menggunakan waktu tempuh murni pejalan kaki (tanpa penalti panas):
$$\text{Cost}_{\text{standard}} = \frac{\text{length\_in\_meters}}{1.33 \text{ m/s}}$$
*(Kecepatan jalan rata-rata diasumsikan 1.33 m/s atau ~4.8 km/jam berdasarkan standar perencanaan transportasi ITDP 2020).*

### B. Bobot Rute Ternyaman (Most Comfortable Route)
Menambahkan penalti waktu (detik buatan) pada jalan yang panas (TCS rendah):
$$\text{Cost}_{\text{comfort}} = \text{Cost}_{\text{standard}} \times (1.0 + (1.0 - \text{TCS}) \times \text{multiplier})$$

Nilai `multiplier` disesuaikan dengan profil **Personal Heat Budget** (toleransi panas) pengguna:
1.  **Rendah (Low):** Multiplier = `1.75` (Sangat sensitif panas. Algoritma akan memutar jauh demi mencari tempat teduh). Batas paparan matahari langsung maks **8 menit**.
2.  **Sedang (Medium):** Multiplier = `1.25` (Toleransi seimbang). Batas paparan matahari langsung maks **15 menit**.
3.  **Tinggi (High):** Multiplier = `0.80` (Lebih memilih jalur cepat walau panas). Batas paparan matahari langsung maks **25 menit**.

---

## 5. Implementasi AI/ML (Regresi Linear)

Fitur **"Prediksi Panas"** pada dashboard berjalan menggunakan model pembelajaran mesin (Machine Learning) yang dieksekusi di cluster Spark.

*   **Pustaka:** `pyspark.ml` (Spark MLlib).
*   **Algoritma:** `LinearRegression` (regresi linear). TCS bersifat linear terhadap masukannya, sehingga model ini mengukur pengaruh tiap masukan dengan tepat (RMSE data uji 0,0004).
*   **Tujuan Model:** Mempelajari pola data lingkungan Surabaya untuk memprediksi nilai TCS jalan berdasarkan NDVI, LST, Kualitas Udara (AQI), Rasio Naungan, Kemacetan, dan Kualitas Permukaan Jalan.
*   **Simulasi Skenario Tata Kota (What-If Analysis):**
    1.  **🌿 Skenario Hijau (+Pohon):** Menghitung nilai TCS baru jika kerapatan pohon (`avg_ndvi`) seluruh kota ditingkatkan sebesar `+0.25` dan naungan (`avg_shade`) sebesar `+0.20`.
    2.  **❄️ Skenario Cool Pavement (+Cooling):** Menghitung nilai TCS baru jika seluruh jalan dilapisi aspal pemantul panas sehingga suhu permukaan (`avg_lst`) turun sebesar `-3.5°C`.
*   **Letak Berkas Kode:**
    *   **Spark ML Job:** `spark_jobs/job_tcs_predictor.py`
    *   **Backend Serving API:** `api/routes/dashboard.py` (endpoint `/api/dashboard/heat-prediction`)
    *   **Frontend UI:** `frontend/components/HeatPredictionTab.tsx`

---

## 6. Skenario Demo Live (Panduan Langkah-demi-Langkah)

Saat presentasi di depan dosen/penguji, ikuti skenario demo ini untuk memukau mereka:

### Skenario A: Navigasi & Personal Heat Budget (Paling Menjual)
1.  **Buka Menu Navigasi:** Tunjukkan peta interaktif 3D Kota Surabaya.
2.  **Pilih Titik Awal & Akhir:** Pilih rute melewati area terbuka lebar (misal dekat jalan protokol yang minim pohon).
3.  **Tunjukkan Perbandingan Rute:**
    *   **Rute Terpendek (Shortest Path - Biru/Abu):** Melintasi jalur langsung yang terpapar sinar matahari penuh (TCS merah/oranye).
    *   **Rute Ternyaman (Comfortable Path - Hijau):** Memutar sedikit melewati koridor jalan yang memiliki banyak pepohonan rindang (TCS kuning/hijau).
4.  **Ubah Batas Toleransi Panas (Heat Budget):**
    *   Ubah opsi toleransi ke **Low (Rendah)** $\rightarrow$ Tunjukkan rute ternyaman memutar lebih jauh demi naungan maksimal.
    *   Ubah opsi ke **High (Tinggi)** $\rightarrow$ Tunjukkan rute ternyaman merapat mendekati rute terpendek karena pejalan kaki rela terpapar panas demi waktu cepat.

### Skenario B: Live CCTV Real-time
1.  **Aktifkan Layer CCTV:** Nyalakan ikon kamera di pojok kanan atas peta.
2.  **Klik Kamera CCTV:** Tunjukkan pop-up live streaming video jalan raya di Surabaya (data real dari HLS Dishub Surabaya).
3.  *Penjelasan Teknis:* Sistem melakukan query spasial (`PostGIS ST_DWithin`) untuk mencari kamera terdekat dalam radius pejalan kaki dan melakukan streaming HLS langsung di client menggunakan `HLS.js`.

### Skenario C: Dashboard Interaktif & Simulasi AI Perencanaan Kota
1.  **Masuk ke Menu Dashboard $\rightarrow$ Pilih Tab "Prediksi Panas".**
2.  **Tunjukkan Jam Simulasi:** Geser slider jam dari jam 06:00 pagi ke 12:00 siang. Tunjukkan bagaimana grafik suhu kota melonjak dan persentase daerah kritis (TCS < 0.5) meningkat.
3.  **Jalankan Simulasi AI/ML:**
    *   Klik tombol **🌿 +Pohon** (Skenario Hijau).
    *   Tunjukkan bagaimana nilai TCS pada grafik meningkat seketika, dan persentase daerah kritis di kota menurun tajam.
    *   Tunjukkan daftar **Top 20 Zona Terpanas** di bagian bawah, perhatikan kolom "TCS + Pohon" dan persentase "Potensi Naik" (peningkatan kenyamanan hasil prediksi model MLlib).

---

## 7. Pertanyaan yang Sering Ditanyakan Penguji (Q&A Cheat Sheet)

**Q: Kenapa tidak memakai database NoSQL (seperti MongoDB) untuk data lakehouse?**
*A: Karena sistem kami sangat bergantung pada relasi jaringan jalan (Graph) dan kueri spasial. PostgreSQL + PostGIS + pgRouting menyediakan fungsi routing spasial tingkat tinggi (`pgr_dijkstra` dan tipe data `GEOMETRY`) yang tidak dimiliki database NoSQL. Data lakehouse tetap disimpan dalam format semi-terstruktur (Parquet di HDFS) untuk analisis data skala besar.*

**Q: Bagaimana model regresi linear dilatih di Spark?**
*A: Model dilatih pada Spark Session menggunakan data gabungan dari HDFS Gold Layer (berisi data historis TCS, kerapatan NDVI, LST, AQI, kemacetan lalu lintas per segmen). Spark MLlib merangkai data ini ke dalam vektor fitur (`VectorAssembler`) untuk melatih model regresi linear. Model kemudian menduga nilai TCS baru ketika nilai NDVI (+0.25) atau LST (-3.5°C) diubah.*

**Q: Kenapa waktu demo persentase zona panas di Top 50 selalu menunjukkan 100% pada kondisi Saat Ini?**
*A: Karena kartu tersebut mengukur persentase kondisi kritis khusus untuk **50 segmen jalan terpanas** di seluruh kota. Karena merupakan 50 jalan terekstrim, nilai TCS mereka sangat rendah sehingga penyesuaian suhu harian saja tidak cukup menaikkan skor di atas ambang nyaman (0.5). Nilai baru akan turun di bawah 100% jika kita menerapkan intervensi mitigasi tata kota (skenario `+Pohon`).*
