import os, json, sqlite3, secrets, io, zipfile
from datetime import timedelta, datetime
from functools import wraps, lru_cache
from contextlib import contextmanager
from pathlib import Path
from flask import Flask, request, session, redirect, render_template, abort, flash, send_file
from werkzeug.security import generate_password_hash, check_password_hash
from openpyxl import load_workbook, Workbook

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('DATA_DIR', ROOT / 'data'))
DATA.mkdir(parents=True, exist_ok=True)
secret_file = DATA / '.secret'
if not os.environ.get('SECRET_KEY') and not secret_file.exists():
    secret_file.write_text(secrets.token_hex(32))
    secret_file.chmod(0o600)
app = Flask(__name__)
app.config.update(SECRET_KEY=os.environ.get('SECRET_KEY') or secret_file.read_text(), MAX_CONTENT_LENGTH=20*1024*1024, SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax', SESSION_COOKIE_SECURE=os.environ.get('COOKIE_SECURE') == '1', PERMANENT_SESSION_LIFETIME=timedelta(hours=12))

@contextmanager
def db():
    conn = sqlite3.connect(DATA / 'kosong.sqlite3', timeout=20)
    conn.row_factory = sqlite3.Row
    try:
        with conn:
            yield conn
    finally:
        conn.close()

with db() as c:
    c.executescript('''CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tables(id TEXT PRIMARY KEY, name TEXT NOT NULL, columns TEXT NOT NULL, rows TEXT NOT NULL, visible TEXT NOT NULL, filters TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 1, updated TEXT NOT NULL);''')
    if not c.execute('SELECT 1 FROM admin').fetchone():
        c.execute('INSERT INTO admin VALUES(1,?)', (generate_password_hash('admin'),))

def admin_only(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not session.get('admin'): return redirect('/login')
        return fn(*args, **kwargs)
    return wrapped

@app.before_request
def csrf_check():
    if request.path in ('/offline', '/offline/kalkulator-pajak', '/sw.js', '/manifest.webmanifest', '/game/ellery-elric') or request.path.startswith('/static/'):
        return
    if 'csrf' not in session: session['csrf'] = secrets.token_hex(24)
    if request.method == 'POST' and not secrets.compare_digest(str(request.form.get('csrf', '')), session['csrf']): abort(400, 'Sesi formulir berakhir. Muat ulang halaman.')

@app.template_filter('number_id')
def number_id(value, column=''):
    import re
    from decimal import Decimal, InvalidOperation
    if value is None: return '—'
    if isinstance(value, bool): return str(value)
    # Keep years and identifiers readable, including codes with leading zeros.
    if re.search(r'(?i)(tahun|year|kode|code|nomor|(^|\s)no($|\s)|telepon|phone|nik|nip|id($|\s))', column): return str(value)
    raw = str(value).strip()
    if isinstance(value, str):
        if re.match(r'^[+-]?0\d', raw): return value
        if re.fullmatch(r'[+-]?\d+,\d+', raw): raw = raw.replace(',', '.')
        elif re.fullmatch(r'[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?', raw): raw = raw.replace('.', '').replace(',', '.')
        elif re.fullmatch(r'[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?', raw): raw = raw.replace(',', '')
        elif not re.fullmatch(r'[+-]?\d+(?:\.\d+)?', raw): return value
    try:
        number = Decimal(raw)
        if not number.is_finite(): return str(value)
        decimals = max(0, -number.as_tuple().exponent)
        # Decimal values use at least two places; integers stay integers.
        digits = min(12, max(2, decimals)) if decimals else 0
        return format(number, f',.{digits}f').translate(str.maketrans({',': '.', '.': ','}))
    except (InvalidOperation, ValueError): return str(value)

@app.context_processor
def context(): return dict(is_admin=session.get('admin', False), csrf=session.get('csrf', ''))

def fetch_table(tid):
    with db() as c: t = c.execute('SELECT * FROM tables WHERE id=?', (tid,)).fetchone()
    if not t or (t['locked'] and not session.get('admin')): abort(404)
    t = dict(t)
    for key in ('columns', 'rows', 'visible', 'filters'): t[key] = json.loads(t[key])
    return t

def read_upload():
    f = request.files.get('file')
    if not f or not f.filename.lower().endswith('.xlsx'): raise ValueError('Pilih file XLSX.')
    raw = f.read()
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            if sum(x.file_size for x in z.infolist()) > 100*1024*1024: raise ValueError('Isi file terlalu besar (maksimal 100 MB setelah dibuka).')
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        try:
            sheet = wb.worksheets[0]
            iterator = sheet.iter_rows(values_only=True)
            first = list(next(iterator, []))
            while first and first[-1] is None: first.pop()
            cols = [str(x).strip() if x is not None else '' for x in first]
            if not cols or any(not x for x in cols): raise ValueError('Header kolom tidak boleh kosong.')
            if len(set(x.casefold() for x in cols)) != len(cols): raise ValueError('Nama kolom tidak boleh duplikat.')
            if len(cols) > 200: raise ValueError('Maksimal 200 kolom.')
            rows = []
            for row in iterator:
                if not any(x is not None for x in row): continue
                if any(x is not None for x in row[len(cols):]): raise ValueError('Ada data di kolom tanpa header.')
                rows.append([x.isoformat() if hasattr(x, 'isoformat') else x if isinstance(x, (str, int, float, bool)) or x is None else str(x) for x in (list(row[:len(cols)]) + [None]*max(0, len(cols)-len(row)))])
                if len(rows) > 100000: raise ValueError('Maksimal 100.000 baris per tabel.')
            return cols, rows
        finally: wb.close()
    except ValueError: raise
    except Exception: raise ValueError('File XLSX tidak dapat dibaca. Simpan ulang melalui Excel.')

# Offline documents contain no authenticated state or table data.
@app.get('/manifest.webmanifest')
def pwa_manifest():
    response = send_file(ROOT / 'static/manifest.webmanifest', mimetype='application/manifest+json')
    response.headers['Cache-Control'] = 'no-cache'
    return response

@app.get('/offline')
def pwa_offline():
    return render_template('offline.html', page='offline', is_admin=False, csrf='', offline_mode=True)

@app.get('/offline/kalkulator-pajak')
def pwa_offline_tax():
    return render_template('tax.html', page='home', is_admin=False, csrf='', offline_mode=True)

@app.get('/sw.js')
def pwa_worker():
    import hashlib
    files = sorted(p for folder in ('static', 'templates') for p in (ROOT / folder).rglob('*') if p.is_file() and not p.is_relative_to(ROOT / 'static/game'))
    fingerprint = hashlib.sha256()
    for path in files:
        fingerprint.update(str(path.relative_to(ROOT)).encode())
        fingerprint.update(path.read_bytes())
    assets = ['/static/' + str(path.relative_to(ROOT / 'static')) for path in files if path.is_relative_to(ROOT / 'static')]
    assets += ['/offline', '/offline/kalkulator-pajak']
    response = app.make_response(render_template('sw.js', version=fingerprint.hexdigest()[:16], assets=assets))
    response.mimetype = 'application/javascript'
    response.headers['Cache-Control'] = 'no-cache'
    response.headers['Service-Worker-Allowed'] = '/'
    return response

@app.after_request
def private_document_cache(response):
    if response.mimetype == 'text/html':
        response.headers['Cache-Control'] = 'no-store'
    return response

@app.route('/')
def root(): return redirect('/home')

@app.get('/kalkulator-pajak')
def tax_calculator():
    return render_template('tax.html', page='home')

@lru_cache(maxsize=1)
def game_package():
    import hashlib
    folder = ROOT / 'static/game/ellery-elric'
    files = sorted(p for p in folder.rglob('*') if p.is_file() and p.suffix != '.svg')
    digest = hashlib.sha256((ROOT / 'templates/game_ellery_elric.html').read_bytes())
    for path in files:
        digest.update(str(path.relative_to(folder)).encode())
        digest.update(path.read_bytes())
    version = digest.hexdigest()[:16]
    assets = ['/static/' + str(p.relative_to(ROOT / 'static')) + '?v=' + version
              for p in files if p.suffix != '.txt']
    return version, assets

@app.get('/game/ellery-elric')
def ellery_elric_game():
    version, assets = game_package()
    return render_template('game_ellery_elric.html', game_root='/static/game/ellery-elric/',
                           game_version=version, game_config={'version': version, 'assets': assets})

@app.route('/home')
@app.route('/admin')
def home():
    if request.path == '/admin' and not session.get('admin'): return redirect('/login')
    public = request.path == '/home'
    with db() as c:
        tables = c.execute('SELECT id,name,locked,updated,json_array_length(rows) AS count FROM tables ' + ('WHERE locked=0 ' if public else '') + 'ORDER BY updated DESC').fetchall()
    return render_template('home.html', tables=tables, public=public, page='home')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if session.get('admin'): return redirect('/admin')
    if request.method == 'POST':
        with db() as c: password = c.execute('SELECT password FROM admin WHERE id=1').fetchone()[0]
        if request.form.get('username') == 'admin' and check_password_hash(password, request.form.get('password', '')):
            session.clear(); session['admin'] = True; session['csrf'] = secrets.token_hex(24); session.permanent = True
            return redirect('/admin')
        flash('Username atau password salah.', 'error')
    return render_template('login.html', page='login')

@app.post('/logout')
def logout(): session.clear(); return redirect('/home')

@app.get('/admin/settings')
@admin_only
def settings_hub():
    return render_template('settings_hub.html', page='settings')

@app.route('/admin/settings/tables', methods=['GET', 'POST'])
@admin_only
def settings():
    if request.method == 'POST':
        try:
            name = request.form.get('name', '').strip()
            if not name or len(name) > 150: raise ValueError('Nama tabel wajib diisi, maksimal 150 karakter.')
            cols, rows = read_upload()
            tid = secrets.token_hex(8)
            with db() as c: c.execute('INSERT INTO tables VALUES(?,?,?,?,?,?,?,?)', (tid, name, json.dumps(cols), json.dumps(rows), json.dumps(cols), '[]', 1, datetime.now().isoformat(timespec='seconds')))
            flash('Tabel dibuat. Akses publik masih terkunci.')
            return redirect('/admin/settings/' + tid)
        except ValueError as e: flash(str(e), 'error')
    with db() as c: tables = c.execute('SELECT id,name,locked,json_array_length(rows) AS count FROM tables ORDER BY updated DESC').fetchall()
    return render_template('settings.html', tables=tables, page='settings')

@app.route('/admin/settings/<tid>', methods=['GET', 'POST'])
@admin_only
def table_settings(tid):
    t = fetch_table(tid)
    if request.method == 'POST':
        action = request.form.get('action')
        try:
            with db() as c:
                if action == 'delete':
                    c.execute('DELETE FROM tables WHERE id=?', (tid,)); flash('Tabel dihapus.'); return redirect('/admin/settings/tables')
                elif action == 'lock': c.execute('UPDATE tables SET locked=? WHERE id=?', (0 if t['locked'] else 1, tid))
                elif action == 'update':
                    cols, rows = read_upload()
                    visible = [x for x in t['visible'] if x in cols] + [x for x in cols if x not in t['columns']]
                    filters = [x for x in t['filters'] if x in cols]
                    c.execute('UPDATE tables SET columns=?,rows=?,visible=?,filters=?,updated=? WHERE id=?', (json.dumps(cols), json.dumps(rows), json.dumps(visible), json.dumps(filters), datetime.now().isoformat(timespec='seconds'), tid))
                elif action == 'configure':
                    name = request.form.get('name', '').strip()
                    if not name or len(name) > 150: raise ValueError('Nama tabel wajib diisi, maksimal 150 karakter.')
                    visible = request.form.getlist('visible'); filters = request.form.getlist('filters')
                    if any(x not in t['columns'] for x in visible + filters): abort(400)
                    if not visible: raise ValueError('Pilih setidaknya satu kolom tampilan.')
                    order = request.form.getlist('order')
                    if len(order) != len(t['columns']) or set(order) != set(t['columns']): abort(400)
                    c.execute('UPDATE tables SET name=?,visible=?,filters=? WHERE id=?', (name, json.dumps([x for x in order if x in visible]), json.dumps(filters), tid))
                else: abort(400)
            flash('Perubahan disimpan.')
            return redirect('/admin/settings/' + tid)
        except ValueError as e: flash(str(e), 'error')
    ordered = t['visible'] + [x for x in t['columns'] if x not in t['visible']]
    return render_template('table_settings.html', t=t, ordered=ordered, page='settings')

@app.get('/table/<tid>')
def view_table(tid):
    t = fetch_table(tid)
    # Public routes never expose hidden columns in the HTML or search results.
    visible_idx = [t['columns'].index(x) for x in t['visible']]
    q = request.args.get('q', '').strip()
    filtered = t['rows']
    filters = []
    for col in t['filters']:
        idx = t['columns'].index(col); key = 'f' + str(idx)
        values = sorted(set('' if r[idx] is None else str(r[idx]) for r in t['rows']))
        selected = request.args.getlist(key) if key + '_set' in request.args else values
        filtered = [r for r in filtered if ('' if r[idx] is None else str(r[idx])) in selected]
        filters.append(dict(name=col, key=key, values=values, selected=selected))
    if q: filtered = [r for r in filtered if any(q.casefold() in (str(r[i] if r[i] is not None else '') + ' ' + number_id(r[i], t['columns'][i])).casefold() for i in visible_idx)]
    sort = request.args.get('sort', '')
    direction = 'desc' if request.args.get('direction') == 'desc' else 'asc'
    if sort in t['visible']:
        from decimal import Decimal, InvalidOperation
        import re
        idx = t['columns'].index(sort)
        def numeric(value):
            if isinstance(value, bool): raise ValueError()
            raw = str(value).strip()
            if isinstance(value, str):
                if re.fullmatch(r'[+-]?\d{1,3}(?:\.\d{3})+(?:,\d+)?', raw): raw = raw.replace('.', '').replace(',', '.')
                elif re.fullmatch(r'[+-]?\d+,\d+', raw): raw = raw.replace(',', '.')
                elif re.fullmatch(r'[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?', raw): raw = raw.replace(',', '')
            number = Decimal(raw)
            if not number.is_finite(): raise ValueError()
            return number
        filled = [row for row in filtered if row[idx] is not None and str(row[idx]).strip()]
        empty = [row for row in filtered if row[idx] is None or not str(row[idx]).strip()]
        try:
            numbers = [numeric(row[idx]) for row in filled]
            filled = [row for _, row in sorted(zip(numbers, filled), key=lambda pair: pair[0], reverse=direction == 'desc')]
        except (InvalidOperation, ValueError):
            filled = sorted(filled, key=lambda row: str(row[idx]).casefold(), reverse=direction == 'desc')
        filtered = filled + empty
    else:
        sort = ''
    total = len(filtered); pages = max(1, (total+49)//50)
    try: page = max(1, min(pages, int(request.args.get('page', 1))))
    except ValueError: page = 1
    args = request.args.to_dict(flat=False)
    def page_url(n):
        from urllib.parse import urlencode
        return '?' + urlencode(dict(args, page=[n]), doseq=True)
    rows = [[r[i] for i in visible_idx] for r in filtered[(page-1)*50:page*50]]
    return render_template('table.html', t=t, rows=rows, filters=filters, q=q, sort=sort, direction=direction, total=total, current=page, pages=pages, prev=page_url(page-1), next=page_url(page+1), page='home')

@app.get('/admin/download/<tid>')
@admin_only
def download(tid):
    t = fetch_table(tid); wb = Workbook(); ws = wb.active; ws.title = 'Data'
    for row in [t['columns']] + t['rows']:
        ws.append(row)
        for cell in ws[ws.max_row]:
            if isinstance(cell.value, str): cell.data_type = 's'
    ws.freeze_panes = 'A2'; ws.auto_filter.ref = ws.dimensions
    stream = io.BytesIO(); wb.save(stream); stream.seek(0)
    return send_file(stream, as_attachment=True, download_name=t['name']+'.xlsx', mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

@app.errorhandler(413)
def too_large(e): return render_template('error.html', message='File terlalu besar. Batas unggahan 20 MB.'), 413
@app.errorhandler(404)
def not_found(e): return render_template('error.html', message='Tabel atau halaman tidak tersedia untuk akses ini.'), 404
@app.errorhandler(400)
def bad_request(e): return render_template('error.html', message='Permintaan tidak valid. Muat ulang halaman lalu coba lagi.'), 400

from offline_api import register_offline
register_offline(app, db)

from sharing import register_sharing
register_sharing(app, db, admin_only)

if __name__ == '__main__': app.run(host='127.0.0.1', port=int(os.environ.get('PORT', 5050)))
