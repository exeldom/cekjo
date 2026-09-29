"""Private, versioned offline sync. Only changed tables leave the server."""
import gzip, hashlib, json
from flask import request, session, abort, Response

def register_offline(app, db):
    # A separate revision table preserves the existing tables schema and upload code.
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS offline_revisions(id TEXT PRIMARY KEY, revision TEXT NOT NULL);
        INSERT OR IGNORE INTO offline_revisions SELECT id,lower(hex(randomblob(16))) FROM tables;
        CREATE TRIGGER IF NOT EXISTS offline_insert AFTER INSERT ON tables BEGIN
          INSERT OR REPLACE INTO offline_revisions VALUES(NEW.id,lower(hex(randomblob(16))));
        END;
        CREATE TRIGGER IF NOT EXISTS offline_update AFTER UPDATE ON tables BEGIN
          INSERT OR REPLACE INTO offline_revisions VALUES(NEW.id,lower(hex(randomblob(16))));
        END;
        CREATE TRIGGER IF NOT EXISTS offline_delete AFTER DELETE ON tables BEGIN
          DELETE FROM offline_revisions WHERE id=OLD.id;
        END;
        ''')

    def reply(payload, version):
        headers={'Cache-Control':'private, no-cache','Vary':'Cookie, Accept-Encoding','X-Content-Type-Options':'nosniff'}
        if request.if_none_match.contains(version):
            response=Response(status=304,headers=headers)
        else:
            raw=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode()
            if len(raw)>1024 and request.accept_encodings['gzip']>0:
                raw=gzip.compress(raw,compresslevel=5,mtime=0);headers['Content-Encoding']='gzip'
            response=Response(raw,mimetype='application/json',headers=headers)
        response.set_etag(version)
        return response

    @app.get('/api/offline-manifest')
    def offline_manifest():
        admin=bool(session.get('admin'));role='admin' if admin else 'public'
        with db() as c:
            rows=c.execute('SELECT t.id,r.revision FROM tables t JOIN offline_revisions r ON r.id=t.id '+('' if admin else 'WHERE t.locked=0 ')+'ORDER BY t.id').fetchall()
        tables=[dict(row) for row in rows]
        version=hashlib.sha256(json.dumps([role,tables],separators=(',',':')).encode()).hexdigest()
        return reply({'protocol':2,'role':role,'tables':tables},version)

    @app.get('/api/offline-table/<tid>')
    def offline_table(tid):
        admin=bool(session.get('admin'));role='admin' if admin else 'public'
        if request.args.get('role')!=role:return {'error':'Sesi berubah.'},409,{'Cache-Control':'no-store'}
        with db() as c:
            raw=c.execute('SELECT t.*,r.revision FROM tables t JOIN offline_revisions r ON r.id=t.id WHERE t.id=?',(tid,)).fetchone()
        if not raw or (raw['locked'] and not admin):abort(404)
        version=role+'-'+raw['revision']
        if request.args.get('v')!=raw['revision']:
            return {'error':'Data berubah. Sinkronkan ulang.'},409,{'Cache-Control':'no-store'}
        if request.if_none_match.contains(version):return reply(None,version)
        table=dict(raw)
        for key in ('columns','rows','visible','filters'):table[key]=json.loads(table[key])
        if not admin:
            indexes=[i for i,col in enumerate(table['columns']) if col in table['visible'] or col in table['filters']]
            table['columns']=[table['columns'][i] for i in indexes]
            table['rows']=[[row[i] for i in indexes] for row in table['rows']]
        return reply(table,version)

    @app.get('/api/offline-snapshot')
    def offline_snapshot():
        # Old open tabs must not keep downloading every table every two minutes.
        # Their existing offline snapshot remains intact until the PWA is updated.
        return {'upgrade_required':True},410,{'Cache-Control':'no-store'}
