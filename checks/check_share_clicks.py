"""Run manually: .venv/bin/python checks/check_share_clicks.py. No real DB or R2."""
import sqlite3, sys, tempfile, time
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from flask import Flask
from werkzeug.security import generate_password_hash
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import sharing

with tempfile.TemporaryDirectory() as tmp:
    @contextmanager
    def db():
        c = sqlite3.connect(Path(tmp) / 'check.sqlite3')
        c.row_factory = sqlite3.Row
        try:
            with c: yield c
        finally: c.close()
    app = Flask(__name__, template_folder=str(Path(sharing.__file__).parent / 'templates'))
    app.secret_key = 'isolated-check'
    with patch.object(sharing, 'configured', return_value=False):
        sharing.register_sharing(app, db, lambda fn: fn)
    with db() as c:
        for token, password in [('Ab123', generate_password_hash('1234')), ('Cd456', None)]:
            c.execute("INSERT INTO shares(manage_key,share_token,original_filename,storage_key,file_size,mime_type,expiration_type,max_downloads,passcode_hash,status,created_at) VALUES(?,?,?,?,1,'text/plain','download',1,?,'active',?)", (token,token,'file.txt',token,password,int(time.time())))
    def counts(token):
        with db() as c:
            row = c.execute('SELECT id,download_count,status FROM shares WHERE share_token=?', (token,)).fetchone()
            events = [r[0] for r in c.execute('SELECT event_type FROM share_events WHERE share_id=? ORDER BY id', (row['id'],))]
            return row['download_count'], row['status'], events
    client = app.test_client()
    for method, headers in [('HEAD', {}), ('GET', {'User-Agent':'WhatsApp'}), ('GET', {'Purpose':'prefetch'})]:
        assert client.open('/Ab123', method=method, headers=headers).status_code == 204
    assert counts('Ab123') == (0, 'active', [])
    assert client.get('/Ab123').status_code == 200
    assert counts('Ab123') == (0, 'active', ['Klik link'])
    assert client.post('/Ab123', data={'passcode':'wrong'}).status_code == 403
    assert counts('Ab123') == (0, 'active', ['Klik link', 'Passcode salah'])
    fake = SimpleNamespace(generate_presigned_url=lambda *a, **k: 'https://example.invalid/file')
    with patch.object(sharing, 'storage', return_value=fake), patch.dict(sharing.os.environ, {'R2_BUCKET':'check'}):
        assert client.post('/Ab123', data={'passcode':'1234'}).status_code == 303
        assert client.get('/Cd456').status_code == 303
    assert counts('Ab123') == (1, 'expired', ['Klik link', 'Passcode salah', 'Download'])
    assert counts('Cd456') == (1, 'expired', ['Klik link', 'Download'])
    assert client.get('/Cd456').status_code == 410
    assert counts('Cd456') == (1, 'expired', ['Klik link', 'Download', 'Klik link'])
print('PASS: clicks do not change quotas; previews ignored; downloads preserve limits.')
