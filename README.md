# kosong.id

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
5. Di Settings → Networking, buat domain Railway atau tambahkan custom domain **`kosong.id`**. Ikuti record DNS yang ditampilkan Railway pada pengelola domain. Jika diminta target port, gunakan nilai port aplikasi di service. HTTPS dikelola Railway.
6. Buka `https://kosong.id/login` dan masuk dengan **admin / admin**.

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
