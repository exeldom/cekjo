"""Private R2 transfers with short-lived browser grants; SQLite stores metadata only."""
import os, re, time, json, secrets, string, sqlite3, threading, mimetypes, logging
from functools import lru_cache
from urllib.parse import quote, urlparse
from flask import request, session, render_template, redirect, abort, jsonify
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from itsdangerous import URLSafeTimedSerializer, BadSignature

LOG = logging.getLogger(__name__)
GRANT_SECONDS = 60
UPLOAD_SECONDS = 300
MAX_FILE = 500 * 1024 * 1024
MAX_PREVIEW = 10 * 1024 * 1024
PREVIEW_TYPES = {"pdf", "xlsx", "txt", "docx"}

@lru_cache(maxsize=1)
def storage():
    import boto3
    from botocore.config import Config
    return boto3.client('s3', endpoint_url=os.environ['R2_ENDPOINT'], region_name=os.environ.get('R2_REGION','auto'),
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        config=Config(signature_version='s3v4',connect_timeout=5,read_timeout=15,retries={'max_attempts':2},
                      request_checksum_calculation='when_required',response_checksum_validation='when_required'))

def configured():
    return all(os.environ.get(k) for k in ('R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET','R2_ENDPOINT','SHARE_DOMAIN'))

def register_sharing(app, db, admin_only):
    with db() as c:
        c.executescript('''
        CREATE TABLE IF NOT EXISTS shares (
          id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL DEFAULT 1,
          manage_key TEXT NOT NULL UNIQUE, share_token TEXT UNIQUE,
          original_filename TEXT NOT NULL, storage_key TEXT NOT NULL,
          file_size INTEGER NOT NULL, mime_type TEXT NOT NULL,
          expiration_type TEXT NOT NULL, duration INTEGER, expires_at INTEGER,
          max_downloads INTEGER, download_count INTEGER NOT NULL DEFAULT 0,
          passcode_hash TEXT, status TEXT NOT NULL DEFAULT 'uploading',
          created_at INTEGER NOT NULL, expired_at INTEGER, purge_after INTEGER,
          deleted_at INTEGER, last_grant_until INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS share_events (
          id INTEGER PRIMARY KEY, share_id INTEGER NOT NULL, event_type TEXT NOT NULL,
          ip_address TEXT, country TEXT, region TEXT, device TEXT, os TEXT, browser TEXT,
          user_agent TEXT, created_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS share_events_share ON share_events(share_id,created_at);
        CREATE INDEX IF NOT EXISTS shares_cleanup ON shares(status,purge_after,deleted_at);
        CREATE TABLE IF NOT EXISTS share_rates (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_at INTEGER NOT NULL);
        ''')

        columns={r['name'] for r in c.execute('PRAGMA table_info(shares)')}
        for name,definition in [('content_kind',"TEXT NOT NULL DEFAULT 'file'"),('file_mode',"TEXT NOT NULL DEFAULT 'download'"),('text_content','TEXT'),('target_url','TEXT')]:
            if name not in columns:c.execute(f'ALTER TABLE shares ADD COLUMN {name} {definition}')
    tickets=URLSafeTimedSerializer(app.secret_key,salt='share-view')

    def new_token(c):
        for _ in range(50):
            token=''.join(secrets.choice(string.ascii_letters+string.digits) for _ in range(5))
            if not c.execute('SELECT 1 FROM shares WHERE share_token=?',(token,)).fetchone():return token
        raise ValueError('Token tidak tersedia. Coba lagi.')

    def conditions(file_mode):
        mode=request.form.get('mode','')
        if mode not in ('download','time','download-passcode','time-passcode'):raise ValueError('Pilih kondisi berbagi.')
        if file_mode=='preview' and not mode.startswith('time'):raise ValueError('Preview hanya memakai batas waktu.')
        duration=int(request.form.get('minutes','60'))*60 if mode.startswith('time') else None
        maximum=int(request.form.get('downloads','1')) if mode.startswith('download') else None
        if duration is not None and not 60<=duration<=86400:raise ValueError('Waktu harus 1 menit–24 jam.')
        if maximum is not None and not 1<=maximum<=10:raise ValueError('Batas akses harus 1–10.')
        password=request.form.get('passcode','')
        if mode.endswith('passcode') and not 4<=len(password)<=128:raise ValueError('Passcode harus 4–128 karakter.')
        return duration,maximum,generate_password_hash(password) if mode.endswith('passcode') else None

    def ip():
        if os.environ.get('RAILWAY_ENVIRONMENT_ID') and request.access_route:
            return request.access_route[-1][:80]
        return (request.remote_addr or 'unknown')[:80]

    def rate(key, limit, window):
        now=int(time.time())
        with db() as c:
            c.execute('BEGIN IMMEDIATE')
            c.execute('DELETE FROM share_rates WHERE until_at<?',(now,))
            row=c.execute('SELECT * FROM share_rates WHERE key=?',(key,)).fetchone()
            if row and row['count']>=limit:return False
            c.execute('INSERT INTO share_rates VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+1',(key,1,now+window))
        return True

    def expire(c,now):
        c.execute("UPDATE shares SET status='expired',expired_at=COALESCE(expired_at,expires_at,?),purge_after=MAX(COALESCE(expires_at,?),last_grant_until) WHERE status='active' AND ((expires_at IS NOT NULL AND expires_at<=?) OR (max_downloads IS NOT NULL AND download_count>=max_downloads))",(now,now,now))
        c.execute("UPDATE shares SET status='abandoned',purge_after=? WHERE status='uploading' AND created_at<?",(now,now-900))

    def cleanup():
        now=int(time.time())
        with db() as c:
            expire(c,now)
            items=c.execute("SELECT * FROM shares WHERE status IN ('expired','deleting','abandoned') AND deleted_at IS NULL AND purge_after<=? LIMIT 30",(now,)).fetchall()
        for item in items:
            try:
                if item['content_kind']=='file':
                    if not configured():continue
                    storage().delete_object(Bucket=os.environ['R2_BUCKET'],Key=item['storage_key'])
                with db() as c:
                    if item['status'] in ('deleting','abandoned'):
                        c.execute('DELETE FROM share_events WHERE share_id=?',(item['id'],))
                        c.execute('DELETE FROM shares WHERE id=?',(item['id'],))
                    else:c.execute('UPDATE shares SET deleted_at=?,text_content=NULL,target_url=NULL WHERE id=?',(int(time.time()),item['id']))
            except Exception:LOG.warning('Share cleanup delayed; object deletion will be retried.')

    def loop():
        while True:
            try:cleanup()
            except Exception:LOG.warning('Share maintenance delayed; retrying.')
            time.sleep(15)
    if app.config.get('SHARE_CLEANUP_ENABLED',True):threading.Thread(target=loop,daemon=True,name='share-cleanup').start()

    def summary(row):
        t=dict(row);now=int(time.time())
        t['active']=t['status']=='active'
        t['label']='Aktif' if t['active'] else 'Menghapus' if t['status']=='deleting' else 'Expired'
        if t['active'] and t['expiration_type']=='download':t['condition']=f"{t['download_count']} / {t['max_downloads']} akses"
        elif t['active']:t['condition']=f"{max(1,(t['expires_at']-now+59)//60)} menit tersisa"
        else:t['condition']=''
        return t

    def get_share(key):
        with db() as c:
            expire(c,int(time.time()))
            row=c.execute('SELECT * FROM shares WHERE manage_key=? AND owner_id=1',(key,)).fetchone()
        if not row:abort(404)
        return summary(row)

    @app.get('/admin/sharing')
    @admin_only
    def sharing_list():
        with db() as c:
            expire(c,int(time.time()))
            rows=c.execute("SELECT * FROM shares WHERE owner_id=1 AND status NOT IN ('uploading','abandoned') ORDER BY created_at DESC,id DESC").fetchall()
        return render_template('sharing.html',page='settings',shares=[summary(t) for t in rows],ready=configured())

    @app.post('/admin/sharing/upload')
    @admin_only
    def sharing_upload():
        if not rate('upload:'+ip(),20,3600):return {'error':'Terlalu banyak item. Coba lagi nanti.'},429
        try:
            kind=request.form.get('kind','file')
            if kind not in ('file','link','text'):raise ValueError('Pilih File, Link, atau Teks.')
            file_mode=request.form.get('file_mode','download') if kind=='file' else 'download'
            if file_mode not in ('download','preview'):raise ValueError('Mode file tidak valid.')
            duration,maximum,hashed=conditions(file_mode)
            now=int(time.time());manage=secrets.token_urlsafe(24)
            if kind!='file':
                title=request.form.get('title','').strip()
                if not title or len(title)>240:raise ValueError('Isi judul maksimal 240 karakter.')
                text=request.form.get('text','') if kind=='text' else None
                url=request.form.get('url','').strip() if kind=='link' else None
                if kind=='text' and (not text.strip() or len(text)>100000):raise ValueError('Isi teks maksimal 100.000 karakter.')
                if kind=='link':
                    parsed=urlparse(url)
                    if (len(url)>2048 or parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or re.search(r'[\s\\\x00-\x1f\x7f]',url)):
                        raise ValueError('Isi URL HTTP/HTTPS yang valid.')
                    try: parsed.port
                    except ValueError: raise ValueError('Port URL tidak valid.')
                with db() as c:
                    c.execute('BEGIN IMMEDIATE');token=new_token(c)
                    c.execute("INSERT INTO shares(owner_id,manage_key,share_token,original_filename,storage_key,file_size,mime_type,expiration_type,duration,max_downloads,passcode_hash,created_at,expires_at,status,content_kind,text_content,target_url) VALUES(1,?,?,?,'',0,'text/plain',?,?,?,?,?,?,'active',?,?,?)",(manage,token,title,'time' if duration else 'download',duration,maximum,hashed,now,now+duration if duration else None,kind,text,url))
                return {'ok':True,'manage_key':manage,'complete':True}
            if not configured():return {'error':'Konfigurasi R2 belum diisi.'},503
            name=request.form.get('filename','').replace('\\','/').split('/')[-1].strip()
            if not name or len(name)>240 or re.search(r'[\x00-\x1f\x7f]',name):raise ValueError('Nama file tidak valid.')
            size=int(request.form.get('size','0'))
            limit=MAX_PREVIEW if file_mode=='preview' else MAX_FILE
            if size<1 or size>limit:raise ValueError('Maksimal 10 MB untuk preview, 500 MB untuk download.')
            extension=name.rsplit('.',1)[-1].lower()
            if file_mode=='preview' and extension not in PREVIEW_TYPES:raise ValueError('Preview hanya PDF, XLSX, TXT, dan DOCX.')
            mime=mimetypes.guess_type(name)[0] or 'application/octet-stream'
            key='shares/'+secrets.token_hex(24)
            url=storage().generate_presigned_url('put_object',Params={'Bucket':os.environ['R2_BUCKET'],'Key':key,'ContentType':mime,'ContentLength':size},ExpiresIn=UPLOAD_SECONDS)
            with db() as c:
                c.execute('INSERT INTO shares(owner_id,manage_key,original_filename,storage_key,file_size,mime_type,expiration_type,duration,max_downloads,passcode_hash,created_at,file_mode) VALUES(1,?,?,?,?,?,?,?,?,?,?,?)',(manage,name,key,size,mime,'time' if duration else 'download',duration,maximum,hashed,now,file_mode))
            return {'upload_url':url,'manage_key':manage,'content_type':mime}
        except ValueError as e:return {'error':str(e)},400
        except Exception:return {'error':'Belum dapat menyimpan. Periksa konfigurasi R2 dan coba lagi.'},503

    @app.post('/admin/sharing/<key>/complete')
    @admin_only
    def sharing_complete(key):
        t=get_share(key)
        if t['status']=='active':return {'ok':True}
        if t['status']!='uploading':return {'error':'Unggahan sudah berakhir. Unggah kembali.'},410
        try:
            obj=storage().head_object(Bucket=os.environ['R2_BUCKET'],Key=t['storage_key'])
            if obj['ContentLength']!=t['file_size'] or obj.get('ContentType')!=t['mime_type']:return {'error':'Ukuran/jenis file tidak sesuai. Unggah kembali.'},400
            now=int(time.time())
            with db() as c:
                c.execute('BEGIN IMMEDIATE')
                current=c.execute('SELECT status FROM shares WHERE id=?',(t['id'],)).fetchone()
                if not current or current['status']!='uploading':return {'error':'Status unggahan telah berubah.'},409
                token=new_token(c)
                c.execute("UPDATE shares SET share_token=?,status='active',created_at=?,expires_at=? WHERE id=?",(token,now,now+t['duration'] if t['duration'] else None,t['id']))
            return {'ok':True}
        except Exception:return {'error':'File belum terkonfirmasi. Coba lagi.'},503

    @app.get('/admin/sharing/<key>/link')
    @admin_only
    def sharing_link(key):
        t=get_share(key)
        if not t['active']:return {'error':'Link sudah expired.'},410
        return {'url':os.environ.get('SHARE_DOMAIN','https://qoogle.download').rstrip('/')+'/'+t['share_token']},200,{'Cache-Control':'no-store'}

    @app.get('/admin/sharing/<key>/analysis')
    @admin_only
    def sharing_analysis(key):
        t=get_share(key)
        try: event_page=max(1,int(request.args.get('page',1)))
        except ValueError: event_page=1
        with db() as c:
            count=c.execute('SELECT COUNT(*) FROM share_events WHERE share_id=?',(t['id'],)).fetchone()[0]
            clicks=c.execute("SELECT COUNT(*) FROM share_events WHERE share_id=? AND event_type='Klik link'",(t['id'],)).fetchone()[0]
            pages=max(1,(count+49)//50); event_page=min(event_page,pages)
            events=c.execute('SELECT * FROM share_events WHERE share_id=? ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET ?',(t['id'],(event_page-1)*50)).fetchall()
        return render_template('share_analysis.html',page='settings',t=t,events=events,event_page=event_page,pages=pages,clicks=clicks)

    @app.post('/admin/sharing/<key>/delete')
    @admin_only
    def sharing_delete(key):
        t=get_share(key);now=int(time.time())
        # Revoke first, before attempting any storage operation.
        with db() as c:c.execute("UPDATE shares SET status='deleting',purge_after=?,expired_at=COALESCE(expired_at,?) WHERE id=?",(now,now,t['id']))
        try:
            if t['content_kind']=='file' and not t['deleted_at']:storage().delete_object(Bucket=os.environ['R2_BUCKET'],Key=t['storage_key'])
            with db() as c:
                c.execute('DELETE FROM share_events WHERE share_id=?',(t['id'],))
                c.execute('DELETE FROM shares WHERE id=?',(t['id'],))
            return {'ok':True}
        except Exception:return {'error':'Link sudah dicabut. Penghapusan file akan dicoba lagi otomatis.'},503

    def event(c,t,kind):
        ua=request.headers.get('User-Agent','')[:500]
        # Approximate analytics metadata only; never used for access control.
        country=request.headers.get('CF-IPCountry','').upper().strip()
        if not re.fullmatch(r'[A-Z]{2}',country) or country=='XX': country=None
        region=request.headers.get('CF-Region','').strip()[:100] if country else None
        if region:
            try: region=region.encode('latin-1').decode('utf-8')
            except (UnicodeEncodeError,UnicodeDecodeError): pass
            region=''.join(ch for ch in region if ch.isprintable()) or None
        device='Tablet' if re.search(r'iPad|Tablet',ua,re.I) else 'Mobile' if re.search(r'Mobile|iPhone|Android',ua,re.I) else 'Desktop'
        system=next((name for pattern,name in [('iPhone|iPad','iOS'),('Android','Android'),('Windows','Windows'),('Macintosh','macOS'),('Linux','Linux')] if re.search(pattern,ua,re.I)),'Lainnya')
        browser=next((name for pattern,name in [('Edg/','Edge'),('OPR/','Opera'),('Firefox|FxiOS','Firefox'),('Chrome|CriOS','Chrome'),('Safari','Safari')] if re.search(pattern,ua,re.I)),'Lainnya')
        c.execute('INSERT INTO share_events(share_id,event_type,ip_address,country,region,device,os,browser,user_agent,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(t['id'],kind,ip(),country,region,device,system,browser,ua,int(time.time())))

    @app.route('/<token>',methods=['GET','POST','HEAD'])
    def public_share(token):
        if not re.fullmatch(r'[A-Za-z0-9]{5}',token):abort(404)
        if not rate('public:'+ip(),60,60):return render_template('share_public.html',error='Terlalu banyak permintaan. Coba lagi sebentar.'),429,{'Retry-After':'60'}
        ua=request.headers.get('User-Agent','')
        preview=(request.method=='HEAD' or re.search(r'bot|crawler|spider|whatsapp|facebookexternalhit|telegram|slack|discord|preview',ua,re.I) or 'prefetch' in (request.headers.get('Purpose','')+request.headers.get('Sec-Purpose','')).lower())
        if preview:return '',204
        with db() as c:
            expire(c,int(time.time()))
            row=c.execute('SELECT * FROM shares WHERE share_token=?',(token,)).fetchone()
            if row and request.method=='GET' and row['status'] in ('active','expired'):
                event(c,row,'Klik link')
        if not row or row['status']!='active':return render_template('share_public.html',error='Link tidak tersedia atau sudah expired.'),410
        t=dict(row)
        action='Buka Preview' if t['file_mode']=='preview' else 'Buka Link' if t['content_kind']=='link' else 'Lihat Teks' if t['content_kind']=='text' else 'Download'
        if t['passcode_hash']:
            if request.method=='GET':return render_template('share_public.html',passcode=True,action=action)
            if not rate('pass:'+ip(),15,900) or not rate('token:'+token+':'+ip(),8,900):return render_template('share_public.html',error='Terlalu banyak percobaan. Coba lagi nanti.'),429
            password=request.form.get('passcode','')
            if len(password)>128 or not check_password_hash(t['passcode_hash'],password):
                with db() as c:event(c,t,'Passcode salah')
                return render_template('share_public.html',passcode=True,action=action,error='Passcode salah.'),403
        try:
            now=int(time.time())
            # The lock serializes grants; no concurrent request can exceed the limit.
            with db() as c:
                c.execute('BEGIN IMMEDIATE');expire(c,now)
                fresh=c.execute('SELECT * FROM shares WHERE id=?',(t['id'],)).fetchone()
                if not fresh or fresh['status']!='active':return render_template('share_public.html',error='Link sudah expired.'),410
                remaining=max(1,min(GRANT_SECONDS,(fresh['expires_at']-now) if fresh['expires_at'] else GRANT_SECONDS))
                url=None
                if fresh['content_kind']=='file':
                    ascii_name=secure_filename(t['original_filename']) or 'file'
                    disposition=('inline' if fresh['file_mode']=='preview' else 'attachment')+'; filename="'+ascii_name+'"; filename*=UTF-8\'\''+quote(t['original_filename'],safe='')
                    url=storage().generate_presigned_url('get_object',Params={'Bucket':os.environ['R2_BUCKET'],'Key':t['storage_key'],'ResponseContentDisposition':disposition,'ResponseContentType':t['mime_type'] if fresh['file_mode']=='preview' else 'application/octet-stream','ResponseCacheControl':'no-store, private'},ExpiresIn=remaining)
                count=fresh['download_count']+1
                done=fresh['max_downloads'] is not None and count>=fresh['max_downloads']
                c.execute('UPDATE shares SET download_count=?,last_grant_until=?,status=?,expired_at=?,purge_after=? WHERE id=?',(count,now+remaining,'expired' if done else 'active',now if done else None,now+remaining if done else None,t['id']))
                event(c,t,'Akses berhasil')
            if t['content_kind']=='link':return redirect(t['target_url'],code=303)
            if t['content_kind']=='text' or t['file_mode']=='preview':
                ticket=tickets.dumps({'id':t['id'],'grant_until':now+remaining})
                config={'kind':t['content_kind'],'extension':t['original_filename'].rsplit('.',1)[-1].lower(),'url':url,'expires_at':t['expires_at'],'server_now':now,'status_url':'/share-view/'+ticket+'/status','size':t['file_size']}
                return render_template('share_view.html',title=t['original_filename'],text=t['text_content'] if t['content_kind']=='text' else None,viewer=config)
            return redirect(url,code=303)
        except Exception:return render_template('share_public.html',error='Akses belum tersedia. Coba lagi sebentar.'),503

    @app.get('/share-view/<ticket>/status')
    def sharing_view_status(ticket):
        try:data=tickets.loads(ticket,max_age=86400)
        except BadSignature:return {'active':False},410
        now=int(time.time())
        with db() as c:
            expire(c,now)
            row=c.execute('SELECT status,expires_at,content_kind,max_downloads FROM shares WHERE id=?',(data.get('id'),)).fetchone()
        # A quota-limited text grants one viewing; quota exhaustion does not retract it.
        active=bool(row and (row['status']=='active' or (row['status']=='expired' and row['content_kind']=='text' and row['max_downloads'] is not None and now<data.get('grant_until',0))) and (row['expires_at'] is None or row['expires_at']>now))
        return {'active':active,'server_now':now,'expires_at':row['expires_at'] if row else None},200 if active else 410

    @app.after_request
    def share_headers(response):
        if request.endpoint in ('public_share','sharing_view_status') or request.path.startswith('/admin/sharing'):
            response.headers['Cache-Control']='no-store, private'
            response.headers['Referrer-Policy']='no-referrer'
            response.headers['X-Robots-Tag']='noindex, nofollow, noarchive'
            response.headers['X-Content-Type-Options']='nosniff'
        return response
