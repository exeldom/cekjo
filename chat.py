"""Temporary chat; messages stay in SQLite, attachments travel directly through private R2."""
import os, re, secrets, time
from urllib.parse import quote
from flask import request, session, render_template, abort
from itsdangerous import URLSafeTimedSerializer, BadSignature
from werkzeug.utils import secure_filename

MAX_ATTACHMENT=20*1024*1024
IMAGE_TYPES={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'}

class TemporaryChat:
    def __init__(self, app, db, storage, rate):
        self.db,self.storage,self.rate=db,storage,rate
        self.signer=URLSafeTimedSerializer(app.secret_key,salt='temporary-chat')
        with db() as c:
            if 'chat_mode' not in {r['name'] for r in c.execute('PRAGMA table_info(shares)')}:
                c.execute("ALTER TABLE shares ADD COLUMN chat_mode TEXT NOT NULL DEFAULT 'admin'")
            c.executescript('''
                CREATE TABLE IF NOT EXISTS chat_messages(
                    id INTEGER PRIMARY KEY AUTOINCREMENT, share_id INTEGER NOT NULL,
                    actor TEXT NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL,
                    attachment TEXT, request_id TEXT NOT NULL, created_at INTEGER NOT NULL,
                    UNIQUE(share_id,actor,request_id));
                CREATE INDEX IF NOT EXISTS chat_messages_room ON chat_messages(share_id,id);
                CREATE TABLE IF NOT EXISTS chat_attachments(
                    id TEXT PRIMARY KEY,share_id INTEGER NOT NULL,actor TEXT NOT NULL,
                    name TEXT NOT NULL,size INTEGER NOT NULL,mime TEXT NOT NULL,
                    staging_key TEXT NOT NULL,storage_key TEXT NOT NULL,created_at INTEGER NOT NULL,
                    upload_until INTEGER NOT NULL,attached INTEGER NOT NULL DEFAULT 0);
                CREATE INDEX IF NOT EXISTS chat_attachments_room ON chat_attachments(share_id);
            ''')

    def active(self, row):
        return row and row['content_kind']=='chat' and row['status']=='active' and row['expires_at']>int(time.time())

    def page(self, row, admin=False):
        if not self.active(row):return render_template('share_public.html',error='Chat sudah expired.'),410
        session.setdefault('chat_actor',secrets.token_urlsafe(24))
        actor=session['chat_actor']
        ticket=self.signer.dumps({'id':row['id'],'actor':actor,'admin':admin,'until':row['expires_at']})
        return render_template('share_chat.html',chat={
            'ticket':ticket,'expires_at':row['expires_at'],'server_now':int(time.time()),
            'can_send':admin or row['chat_mode']=='all','admin':admin,
            'csrf':session.get('csrf',''),'endpoint':request.path})

    def api(self, row):
        try:
            auth=self.signer.loads(request.headers.get('X-Chat-Ticket',''),max_age=86400)
        except BadSignature:return {'error':'Buka kembali link chat.'},403
        if auth.get('id')!=row['id'] or auth.get('actor')!=session.get('chat_actor'):
            return {'error':'Sesi chat tidak valid.'},403
        if not self.active(row) or auth['until']<=int(time.time()):return {'error':'Chat sudah expired.'},410
        admin=auth.get('admin') is True
        if admin and not session.get('admin'):return {'error':'Sesi admin berakhir.'},403
        action=request.args.get('chat','')
        if request.method=='GET' and action=='messages':
            try:after=max(0,int(request.args.get('after','0')))
            except ValueError:return {'error':'Posisi pesan tidak valid.'},400
            with self.db() as c:
                rows=c.execute('SELECT m.*,a.name,a.size,a.mime FROM chat_messages m LEFT JOIN chat_attachments a ON a.id=m.attachment WHERE m.share_id=? AND m.id>? ORDER BY m.id LIMIT 100',(row['id'],after)).fetchall()
            if not rows:return '',204
            return {'messages':[{'id':m['id'],'sender':m['sender'],'body':m['body'],'mine':m['actor']==auth['actor'],'created_at':m['created_at'],
                'attachment':{'id':m['attachment'],'name':m['name'],'size':m['size'],'image':m['mime'] in IMAGE_TYPES.values()} if m['attachment'] else None} for m in rows]}
        if request.method=='GET' and action=='attachment':
            with self.db() as c:
                file=c.execute('SELECT * FROM chat_attachments WHERE id=? AND share_id=? AND attached=1',(request.args.get('id',''),row['id'])).fetchone()
            if not file:return {'error':'Lampiran tidak tersedia.'},404
            inline=request.args.get('image')=='1' and file['mime'] in IMAGE_TYPES.values()
            disposition=('inline' if inline else 'attachment')+'; filename="'+(secure_filename(file['name']) or 'file')+'"; filename*=UTF-8\'\''+quote(file['name'],safe='')
            try:
                url=self.storage().generate_presigned_url('get_object',Params={'Bucket':os.environ['R2_BUCKET'],'Key':file['storage_key'],
                    'ResponseContentDisposition':disposition,'ResponseContentType':file['mime'] if inline else 'application/octet-stream',
                    'ResponseCacheControl':'no-store, private'},ExpiresIn=max(1,min(60,row['expires_at']-int(time.time()))))
                return {'url':url}
            except Exception:return {'error':'Lampiran belum tersedia. Coba lagi.'},503
        if request.method!='POST' or action not in ('send','upload'):return {'error':'Permintaan tidak valid.'},400
        if not admin and row['chat_mode']!='all':return {'error':'Hanya admin yang dapat mengirim pesan.'},403
        # Also enforce CSRF here for isolated callers; the main Flask app checks it globally.
        if not session.get('csrf') or not secrets.compare_digest(request.form.get('csrf',''),session['csrf']):
            return {'error':'Sesi berakhir. Buka kembali chat.'},403
        if not self.rate('chat:'+str(row['id'])+':'+(request.remote_addr or ''),60,60):return {'error':'Tunggu sebentar sebelum mengirim lagi.'},429
        try:
            if action=='upload':return self.upload(row,auth)
            return self.send(row,auth,admin)
        except ValueError as error:return {'error':str(error)},400
        except Exception:return {'error':'Belum berhasil. Coba lagi.'},503

    def upload(self,row,auth):
        name=request.form.get('filename','').replace('\\','/').split('/')[-1].strip()
        size=int(request.form.get('size','0'))
        if not name or len(name)>240 or re.search(r'[\x00-\x1f\x7f]',name):raise ValueError('Nama file tidak valid.')
        if not 1<=size<=MAX_ATTACHMENT:raise ValueError('Lampiran maksimal 20 MB.')
        if not self.rate('chat-upload:'+str(row['id'])+':'+(request.remote_addr or ''),30,3600):return {'error':'Batas unggah sementara tercapai. Coba lagi nanti.'},429
        now=int(time.time());file_id=secrets.token_urlsafe(24)
        staging='chat/pending/'+file_id;key='chat/files/'+file_id
        mime=IMAGE_TYPES.get(os.path.splitext(name)[1].lower(),'application/octet-stream')
        seconds=max(1,min(300,row['expires_at']-now))
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            fresh=c.execute('SELECT * FROM shares WHERE id=?',(row['id'],)).fetchone()
            if not self.active(fresh):return {'error':'Chat sudah expired.'},410
            c.execute('INSERT INTO chat_attachments(id,share_id,actor,name,size,mime,staging_key,storage_key,created_at,upload_until) VALUES(?,?,?,?,?,?,?,?,?,?)',
                (file_id,row['id'],auth['actor'],name,size,mime,staging,key,now,now+seconds))
        url=self.storage().generate_presigned_url('put_object',Params={'Bucket':os.environ['R2_BUCKET'],'Key':staging,'ContentType':mime,'ContentLength':size},ExpiresIn=seconds)
        return {'id':file_id,'url':url,'mime':mime}

    def send(self,row,auth,admin):
        body=request.form.get('body','').strip();file_id=request.form.get('attachment','');request_id=request.form.get('request_id','')
        if len(body)>4000 or not (body or file_id):raise ValueError('Isi pesan maksimal 4.000 karakter atau pilih lampiran.')
        if not re.fullmatch(r'[A-Za-z0-9_-]{16,80}',request_id):raise ValueError('ID pesan tidak valid.')
        with self.db() as c:
            existing=c.execute('SELECT id FROM chat_messages WHERE share_id=? AND actor=? AND request_id=?',(row['id'],auth['actor'],request_id)).fetchone()
            if existing:return {'ok':True,'id':existing['id']}
            file=c.execute('SELECT * FROM chat_attachments WHERE id=? AND share_id=? AND actor=? AND attached=0',(file_id,row['id'],auth['actor'])).fetchone() if file_id else None
        if file_id:
            if not file:raise ValueError('Lampiran tidak tersedia. Pilih ulang file.')
            with self.db() as c:
                if not c.execute('UPDATE chat_attachments SET attached=2 WHERE id=? AND attached=0 AND created_at>?',(file_id,int(time.time())-900)).rowcount:
                    raise ValueError('Lampiran sedang dikirim atau sudah berakhir. Pilih ulang file.')
            try:
                obj=self.storage().head_object(Bucket=os.environ['R2_BUCKET'],Key=file['staging_key'])
                if obj['ContentLength']!=file['size'] or obj.get('ContentType')!=file['mime']:raise ValueError('Ukuran atau jenis lampiran tidak sesuai.')
                # Seal the upload under a different key so the PUT grant cannot replace a sent file.
                self.storage().copy_object(Bucket=os.environ['R2_BUCKET'],Key=file['storage_key'],CopySource={'Bucket':os.environ['R2_BUCKET'],'Key':file['staging_key']},CopySourceIfMatch=obj['ETag'],MetadataDirective='REPLACE',ContentType=file['mime'],CacheControl='no-store, private')
            except Exception:
                with self.db() as c:c.execute('UPDATE chat_attachments SET attached=0 WHERE id=? AND attached=2',(file_id,))
                raise
        with self.db() as c:
            c.execute('BEGIN IMMEDIATE')
            fresh=c.execute('SELECT * FROM shares WHERE id=?',(row['id'],)).fetchone()
            if not self.active(fresh):return {'error':'Chat sudah expired.'},410
            existing=c.execute('SELECT id FROM chat_messages WHERE share_id=? AND actor=? AND request_id=?',(row['id'],auth['actor'],request_id)).fetchone()
            if existing:return {'ok':True,'id':existing['id']}
            if file_id and not c.execute('UPDATE chat_attachments SET attached=1 WHERE id=? AND attached=2',(file_id,)).rowcount:
                raise ValueError('Lampiran sudah dikirim.')
            cursor=c.execute('INSERT INTO chat_messages(share_id,actor,sender,body,attachment,request_id,created_at) VALUES(?,?,?,?,?,?,?)',
                (row['id'],auth['actor'],'Admin' if admin else 'Anonymous',body,file_id or None,request_id,int(time.time())))
            return {'ok':True,'id':cursor.lastrowid}

    def cleanup(self):
        now=int(time.time())
        with self.db() as c:
            c.execute("DELETE FROM chat_messages WHERE share_id NOT IN (SELECT id FROM shares WHERE status='active' AND expires_at>?)",(now,))
            files=c.execute("SELECT a.*,s.status,s.expires_at FROM chat_attachments a LEFT JOIN shares s ON a.share_id=s.id WHERE (s.id IS NULL OR s.status!='active' OR s.expires_at<=? OR a.attached!=1 AND a.created_at<=? OR a.attached=1 AND a.staging_key!='') AND a.upload_until<=? LIMIT 50",(now,now-900,now)).fetchall()
        for candidate in files:
            with self.db() as c:
                c.execute('BEGIN IMMEDIATE')
                file=c.execute('SELECT a.*,s.status,s.expires_at FROM chat_attachments a LEFT JOIN shares s ON a.share_id=s.id WHERE a.id=?',(candidate['id'],)).fetchone()
                if not file:continue
                remove=not file['status'] or file['status']!='active' or file['expires_at']<=now or (file['attached']!=1 and file['created_at']<=now-900)
                if not remove and file['attached']!=1:continue
                if remove:c.execute('UPDATE chat_attachments SET attached=-1 WHERE id=?',(file['id'],))
            if file['staging_key']:self.storage().delete_object(Bucket=os.environ['R2_BUCKET'],Key=file['staging_key'])
            if remove:self.storage().delete_object(Bucket=os.environ['R2_BUCKET'],Key=file['storage_key'])
            with self.db() as c:
                if remove:c.execute('DELETE FROM chat_attachments WHERE id=?',(file['id'],))
                else:c.execute("UPDATE chat_attachments SET staging_key='' WHERE id=?",(file['id'],))
