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
    app.config['SHARE_CLEANUP_ENABLED']=False
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
    assert counts('Ab123') == (1, 'expired', ['Klik link', 'Passcode salah', 'Akses berhasil'])
    assert counts('Cd456') == (1, 'expired', ['Klik link', 'Akses berhasil'])
    assert client.get('/Cd456').status_code == 410
    assert counts('Cd456') == (1, 'expired', ['Klik link', 'Akses berhasil', 'Klik link'])

    def create(data):
        response=client.post('/admin/sharing/upload',data=data)
        assert response.status_code==200,response.json
        key=response.json['manage_key']
        with db() as c:token=c.execute('SELECT share_token FROM shares WHERE manage_key=?',(key,)).fetchone()[0]
        return key,token
    key,token=create({'kind':'link','title':'Link','url':'https://example.com','mode':'download','downloads':'1'})
    assert client.get('/'+token).location=='https://example.com'
    assert client.get('/'+token).status_code==410
    assert client.post('/admin/sharing/upload',data={'kind':'link','title':'Bad','url':'javascript:alert(1)','mode':'time','minutes':'1'}).status_code==400
    key,token=create({'kind':'text','title':'Teks','text':'<script>alert(1)</script>','mode':'time','minutes':'1'})
    response=client.get('/'+token)
    assert response.status_code==200 and b'&lt;script&gt;' in response.data
    with db() as c:
        c.execute("INSERT INTO shares(manage_key,share_token,original_filename,storage_key,file_size,mime_type,expiration_type,duration,expires_at,status,created_at,file_mode) VALUES('preview','Pr123','file.pdf','private',10,'application/pdf','time',60,?,'active',?,'preview')",(int(time.time())+60,int(time.time())))
    with patch.object(sharing, 'storage', return_value=fake), patch.dict(sharing.os.environ, {'R2_BUCKET':'check'}):
        for _ in range(3): assert client.get('/Pr123').status_code==200
    assert counts('Pr123')[:2]==(3,'active')
    with db() as c:c.execute("UPDATE shares SET expires_at=? WHERE share_token='Pr123'",(int(time.time())-1,))
    assert client.get('/Pr123').status_code==410
print('PASS: existing grants, passcode, link/text, time-only preview and expiration.')
