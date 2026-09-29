# cekjo

Aplikasi web katalog tabel pribadi dengan akses publik per tabel. Flask + SQLite + XLSX. Login: **admin / admin**, tanpa kewajiban mengganti password.

## Jalankan untuk pengembangan

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Buka http://localhost:5050. `/` menuju `/home`; admin masuk melalui `/login` atau `/admin`. Database otomatis dibuat di `data/kosong.sqlite3`. Secret sesi dibuat di `data/.secret`. Tidak perlu data contoh atau migrasi manual.

## Deploy di Railway

1. Push folder proyek ini ke repository GitHub dan pilih **New Project → Deploy from GitHub repo** di Railway. Alternatif: deploy folder ini melalui Railway CLI (`railway up`) setelah login/link proyek.
2. Tambahkan **Volume** ke service aplikasi, mount path **`/data`**. Ini wajib agar database tidak hilang saat redeploy. Gunakan satu replica untuk SQLite.
3. Di Variables set **`DATA_DIR=/data`** dan **`COOKIE_SECURE=1`**. `SECRET_KEY` opsional: bila kosong, aplikasi membuat secret dan menyimpannya di volume. Jangan set `PORT` sendiri; aplikasi membaca port dari Railway.
4. Deploy. Railway memakai Dockerfile dan healthcheck `/home` dari `railway.toml`.
5. Di Settings → Networking, buat domain Railway atau tambahkan custom domain **`cekjo.com`**. Ikuti record DNS yang ditampilkan Railway pada pengelola domain. Jika diminta target port, gunakan nilai port aplikasi di service. HTTPS dikelola Railway.
6. Buka `https://cekjo.com/login` dan masuk dengan **admin / admin**.

Volume, variable, dan DNS harus dikonfigurasi di akun Railway milik pengguna. Repository ini menyiapkan aplikasi dan konfigurasi deployment; belum melakukan deployment atau menghubungkan domain.

## Mengelola data

- Settings → Tambah tabel: isi nama dan unggah XLSX. Worksheet pertama dipakai, baris pertama menjadi header. Semua kolom tampil; belum ada filter. Tabel baru terkunci.
- Menu ☰ membuka pengaturan kolom tampilan, filter, urutan, nama, dan akses publik. Kolom filter dapat disembunyikan dari tabel.
- Filter pilihan berganda: OR untuk pilihan dalam satu filter, AND antarfilter. Select All / Deselect All tersedia. Tekan Terapkan untuk menyaring. Reset mengembalikan semua data.
- Download XLSX → edit di Excel → Timpa isi tabel. Semua baris dan struktur kolom diganti dalam transaksi database. Nama/ID/status akses tetap. Pengaturan kolom yang namanya cocok dipertahankan; kolom baru otomatis tampil, kolom yang dihapus dibuang dari pengaturan.
- Unlock membuka akses baca publik. Lock menghapus tabel dari katalog/pencarian publik dan menutup URL langsung bagi pengunjung tanpa login. Admin tetap bisa membuka tabel terkunci.
- Unduhan data hanya untuk admin dan selalu mencakup semua kolom/baris.

## Batas versi awal

Maksimal file 20 MB, hasil ekstraksi XLSX 100 MB, 100.000 baris, dan 200 kolom. Data tabel disimpan sebagai JSON di SQLite; filter dikerjakan di server dan hasil dipaginasi 50 baris. Cocok untuk katalog pribadi, bukan analitik jutaan baris. Header harus unik dan tidak kosong. Data tanpa header ditolak.

Impor menyimpan nilai sel, bukan format visual Excel, merged cells, grafik, atau formula. Formula diimpor sebagai hasil perhitungan terakhir yang disimpan Excel; buka dan simpan Excel sebelum mengunggah bila diperlukan. Ekspor menghasilkan workbook baru dari nilai. Sel teks tetap ditulis sebagai teks, termasuk teks berawalan `=`. Tanggal menjadi teks ISO. Nilai angka tidak mempertahankan format mata uang/angka tampilan Excel.

Database dan secret berada di direktori `DATA_DIR`; sertakan keduanya dalam backup volume. Jika mengambil salinan database saat aplikasi berjalan, gunakan mekanisme backup SQLite, bukan menyalin file di tengah transaksi.

## Pergantian nama ke cekjo

Nama aplikasi dan judul halaman memakai cekjo. Domain publik menggunakan cekjo.com. File database tetap `data/kosong.sqlite3` untuk mempertahankan data instalasi yang sudah berjalan. Gunakan service dan volume Railway yang sama saat mengganti custom domain; tidak perlu membuat database atau service baru. Tambahkan domain cekjo.com pada service tersebut dan sesuaikan DNS dengan record yang ditampilkan Railway. Perubahan source ini belum mengubah pengaturan domain Railway atau DNS.

## PWA dan akses offline

Buka https://cekjo.com, lalu Pasang. iPhone: Safari → Bagikan → Tambahkan ke Layar Utama. Android: menu Chrome → Instal aplikasi. Logo memakai `static/icons/cekjo-logo.png`.

Setelah sinkron selesai, seluruh tabel yang dapat diakses oleh sesi tersebut disimpan di perangkat, termasuk semua baris untuk pencarian/filter/sort offline. Pengunjung hanya mendapat tabel publik; sesi admin mendapat tabel yang dapat dilihat admin. Kalkulator dan aset aplikasi juga tersedia offline. Semua perubahan (upload, hapus, pengaturan, lock, serta login) memerlukan koneksi. Tidak ada antrean perubahan offline.

Saat online, snapshot diganti otomatis pada pembukaan halaman, kembali ke tab, tersambung kembali, dan setiap dua menit selama tab terlihat. Status di atas navigasi menunjukkan prosesnya. Logout menghapus salinan data lokal. Data yang sudah diunduh tidak bisa ditarik saat perangkat masih offline; perubahan akses/lock diterapkan saat sinkron kembali. Browser dapat menghapus penyimpanan jika perangkat kekurangan ruang.

Tombol Perbarui mengaktifkan versi aplikasi terbaru. Data tabel tidak dimasukkan dalam cache halaman; snapshot terpisah disimpan sesuai hak akses. Jangan membuat ulang service/volume Railway saat deploy.


### Domain penerima Berbagi Data
Tambahkan `01001101010001010100111010110100.men` ke service Railway yang sama, lalu isi DNS sesuai petunjuk Railway. Tambahkan `https://01001101010001010100111010110100.men` pada AllowedOrigins CORS GET/HEAD bucket private, tanpa menghapus origin/izin upload existing. Setelah HTTPS aktif, set `SHARE_VIEW_DOMAIN=https://01001101010001010100111010110100.men`. `SHARE_DOMAIN` tetap `https://qoogle.download`.
Link yang dibagikan tetap memakai domain lama, lalu beralih ke `/view/<kode-acak>` di domain penerima. Alias maksimal 24 jam dan tetap tunduk pada masa berlaku/kuota share. Download menuju R2 dan Link menuju URL tujuan. Kosongkan `SHARE_VIEW_DOMAIN` untuk kembali ke alur lama; alias yang sudah diberikan tetap bekerja sampai kedaluwarsa. Ini menyamarkan link asal, bukan menjamin anonimitas.


### Generate Kwitansi/Invoice OPD
Halaman `/admin/kwitansi` khusus admin: formulir dengan preview otomatis dan download PDF 215 × 330 mm. Identitas awal mengikuti contoh; semua teks dan logo bisa diubah. PDF memakai Arial. Isian terakhir disimpan di localStorage pada browser/perangkat ini; menghapus data situs akan menghapus isian. Tidak ada penyimpanan transaksi di server. Library jsPDF 4.2.1 beserta lisensi berada di static/receipt/vendor dan dimuat dari aplikasi; tidak memerlukan build npm. Isian panjang ditolak sebelum download agar tetap satu halaman. Halaman ini memerlukan sesi admin online.


### Bandwidth / R2 assets
Offline sync v2 checks a small private manifest, downloads only changed tables, and compresses table JSON with gzip. Revisions change on upload, configuration, lock, and deletion. Foreground checks are shared between tabs with Web Locks and limited to once per minute; a visible tab checks every five minutes. The old full-snapshot endpoint returns 410 so old tabs stop transferring all tables. Reopen Cekjo online and activate the PWA update; the first v2 sync downloads accessible tables once. Admin/public caches are separated and revoked tables are pruned on sync. Data already downloaded cannot be revoked while a device remains offline.
Static assets have content hashes and immutable cache headers. PWA updates reuse unchanged assets; large receipt assets load only when that page opens. No private HTML or table response enters public caches/R2.
To enable R2: create public bucket `cekjo-assets`, connect `assets.cekjo.com`, configure CORS GET/HEAD with AllowedOrigins `*` (public assets only). Put scoped asset upload credentials in local `.env` as ASSET_R2_ACCESS_KEY_ID / ASSET_R2_SECRET_ACCESS_KEY; use ASSET_R2_ENDPOINT if different from R2_ENDPOINT. Run `.venv/bin/python scripts/publish_assets.py` before deployment. Then set Railway ASSET_BASE_URL=https://assets.cekjo.com. Keep existing private R2 variables unchanged. On future asset changes publish first, then push/deploy. Old hashed objects support rollback; do not delete them during active deployments. Clear ASSET_BASE_URL to use local versioned assets. Railway does not need asset write credentials.
