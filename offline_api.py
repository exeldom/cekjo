import json
from datetime import datetime, timezone
from flask import session

def register_offline(app, db):
    @app.get('/api/offline-snapshot')
    def offline_snapshot():
        admin=bool(session.get('admin'))
        with db() as c:
            records=c.execute('SELECT * FROM tables '+('' if admin else 'WHERE locked=0 ')+'ORDER BY updated DESC').fetchall()
        tables=[]
        for raw in records:
            t=dict(raw)
            for key in ('columns','rows','visible','filters'):t[key]=json.loads(t[key])
            if not admin:
                indexes=[i for i,col in enumerate(t['columns']) if col in t['visible'] or col in t['filters']]
                t['columns']=[t['columns'][i] for i in indexes]
                t['rows']=[[row[i] for i in indexes] for row in t['rows']]
            tables.append(t)
        return dict(role='admin' if admin else 'public',tables=tables,saved=datetime.now(timezone.utc).isoformat()),200,{'Cache-Control':'no-store'}
