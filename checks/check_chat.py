"""Run: .venv/bin/python checks/check_chat.py. Uses temporary SQLite and fake R2 only."""
import json,re,sqlite3,sys,tempfile,time,os
from pathlib import Path
from contextlib import contextmanager
from functools import wraps
from unittest.mock import patch
from flask import Flask,session,redirect
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import sharing
from chat import TemporaryChat

class FakeR2:
    def __init__(self):self.objects={};self.last=None
    def generate_presigned_url(self,operation,Params,ExpiresIn):
        self.last=(operation,Params,ExpiresIn)
        return 'https://r2.invalid/file'
    def head_object(self,Bucket,Key):return self.objects[Key]
    def copy_object(self,**kw):self.objects[kw['Key']]=self.objects[kw['CopySource']['Key']].copy()
    def delete_object(self,Bucket,Key):self.objects.pop(Key,None)

with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'R2_BUCKET':'private-check','SHARE_VIEW_DOMAIN':'https://view.invalid'}):
    @contextmanager
    def db():
        c=sqlite3.connect(Path(tmp)/'check.sqlite3');c.row_factory=sqlite3.Row
        try:
            with c:yield c
        finally:c.close()
    def admin_only(fn):
        @wraps(fn)
        def wrapped(*args,**kwargs):
            return fn(*args,**kwargs) if session.get('admin') else redirect('/login')
        return wrapped
    app=Flask(__name__,template_folder=str(Path(sharing.__file__).parent/'templates'));app.secret_key='check-chat';app.config['SHARE_CLEANUP_ENABLED']=False
    app.jinja_env.globals['asset_url']=lambda name:'/static/'+name
    @app.before_request
    def csrf():session.setdefault('csrf','check-csrf')
    @app.context_processor
    def context():return {'csrf':session['csrf']}
    fake=FakeR2()
    with patch.object(sharing,'storage',return_value=fake):
        sharing.register_sharing(app,db,admin_only)
        admin=app.test_client()
        with admin.session_transaction() as s:s['admin']=True
        def create(mode='admin',password=False):
            response=admin.post('/admin/sharing/upload',data={'kind':'chat','chat_mode':mode,'mode':'time-passcode' if password else 'time','minutes':'60','passcode':'1234'})
            assert response.status_code==200,response.data
            key=response.json['manage_key']
            with db() as c:row=dict(c.execute('SELECT * FROM shares WHERE manage_key=?',(key,)).fetchone())
            return key,row
        def config(response):
            assert response.status_code==200,response.data
            return json.loads(re.search(rb'<script id="chat-config" type="application/json">(.*?)</script>',response.data).group(1))
        def api(client,cfg,action,data=None,**params):
            query={'chat':action,**params};headers={'X-Chat-Ticket':cfg['ticket']}
            if data is None:return client.get(cfg['endpoint'],query_string=query,headers=headers)
            return client.post(cfg['endpoint'],query_string=query,headers=headers,data={'csrf':cfg['csrf'],**data})
        key,row=create(password=True);guest=app.test_client()
        dest=guest.get('/'+row['share_token']).location;path=dest.split('view.invalid')[1]
        assert guest.post(path,data={'passcode':'bad'}).status_code==403
        cfg=config(guest.post(path,data={'passcode':'1234'}))
        assert cfg['can_send'] is False
        assert api(guest,cfg,'send',{'body':'forbidden','request_id':'a'*16}).status_code==403
        assert api(guest,cfg,'messages').status_code==204
        acfg=config(admin.get('/admin/sharing/'+key+'/chat'))
        payload={'body':'hello https://example.com <script>','request_id':'b'*16}
        assert api(admin,acfg,'send',payload).status_code==200
        assert api(admin,acfg,'send',payload).status_code==200
        messages=api(guest,cfg,'messages').json['messages'];assert len(messages)==1 and messages[0]['sender']=='Admin'
        assert api(guest,cfg,'messages',after=messages[0]['id']).status_code==204
        with db() as c:assert c.execute('SELECT download_count FROM shares WHERE id=?',(row['id'],)).fetchone()[0]==1
        # Wrong session cannot reuse a participant ticket.
        assert api(app.test_client(),cfg,'messages').status_code==403
        key2,row2=create('all');path2=guest.get('/'+row2['share_token']).location.split('view.invalid')[1]
        cfg2=config(guest.get(path2));assert cfg2['can_send']
        assert api(guest,cfg2,'send',{'body':'Anonymous message','request_id':'c'*16}).status_code==200
        assert api(guest,cfg2,'messages').json['messages'][0]['sender']=='Anonymous'
        assert api(guest,cfg2,'upload',{'filename':'big.png','size':20*1024*1024+1}).status_code==400
        response=api(guest,cfg2,'upload',{'filename':'image.png','size':123});assert response.status_code==200,response.data
        attachment=response.json['id']
        with db() as c:file=dict(c.execute('SELECT * FROM chat_attachments WHERE id=?',(attachment,)).fetchone())
        fake.objects[file['staging_key']]={'ContentLength':123,'ContentType':'image/png','ETag':'etag'}
        assert api(guest,cfg2,'send',{'body':'Image','attachment':attachment,'request_id':'d'*16}).status_code==200
        assert file['storage_key'] in fake.objects
        assert api(guest,cfg2,'attachment',id=attachment,image=1).status_code==200
        assert fake.last[1]['ResponseContentDisposition'].startswith('inline')
        assert api(guest,cfg,'attachment',id=attachment).status_code==404
        assert api(guest,cfg2,'send',{'csrf':'bad','body':'blocked','request_id':'e'*16}).status_code==403
        assert admin.post('/admin/sharing/upload',data={'kind':'chat','mode':'download','downloads':1}).status_code==400
        with db() as c:
            c.execute('UPDATE shares SET expires_at=? WHERE id=?',(int(time.time())-1,row2['id']))
            c.execute('UPDATE chat_attachments SET upload_until=? WHERE share_id=?',(int(time.time())-1,row2['id']))
        assert api(guest,cfg2,'messages').status_code==410
        assert api(guest,cfg2,'send',{'body':'late','request_id':'f'*16}).status_code==410
        TemporaryChat(app,db,lambda:fake,lambda *args:True).cleanup()
        with db() as c:
            assert c.execute('SELECT COUNT(*) FROM chat_messages WHERE share_id=?',(row2['id'],)).fetchone()[0]==0
            assert c.execute('SELECT COUNT(*) FROM chat_attachments WHERE share_id=?',(row2['id'],)).fetchone()[0]==0
        assert not fake.objects
        assert admin.post('/admin/sharing/'+key+'/delete').status_code==200
        assert api(guest,cfg,'messages').status_code==410
        assert app.test_client().get('/admin/sharing/'+key+'/chat').status_code==302
print('PASS: admin/public permissions, passcode, Anonymous, delta reads, idempotency, R2 sealing, 20 MB, CSRF, expiry and cleanup.')
