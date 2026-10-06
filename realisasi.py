"""One private, versioned budget and realization snapshot."""
import gzip,json,re,time
from decimal import Decimal,InvalidOperation
from flask import request,render_template
PAGU=['KODE BIDANG URUSAN','NAMA BIDANG URUSAN','KODE PROGRAM','NAMA PROGRAM','KODE KEGIATAN','NAMA KEGIATAN','KODE SUB KEGIATAN','NAMA SUB KEGIATAN','KODE AKUN','NAMA AKUN','NILAI']
REAL=['Kode Bidang Urusan','Kode Program','Kode Kegiatan','Kode Sub Kegiatan','Kode Rekening','Nilai Realisasi']

def key(row,kind):return tuple(row[i] for i in ((0,2,4,6,8) if kind=='pagu' else range(5)))
def normalize(value):return ' '.join(str(value).split()).upper()
def cents(value):
    if isinstance(value,bool) or value is None:raise ValueError('Nominal kosong atau tidak valid.')
    raw=str(value).strip()
    if ',' in raw:
        if not re.fullmatch(r'-?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}',raw):raise ValueError('Gunakan nominal angka atau format Indonesia.')
        raw=raw.replace('.','').replace(',','.')
    try:n=Decimal(raw)
    except InvalidOperation:raise ValueError('Nominal tidak valid.')
    if not n.is_finite() or abs(n)>Decimal('90071992547409.91') or n*100!=(n*100).to_integral_value():raise ValueError('Nominal maksimal dua desimal dan di luar batas angka tidak diterima.')
    return str(int(n*100))

def validate(payload,kind,pagu):
    headers=PAGU if kind=='pagu' else REAL
    if not isinstance(payload,dict) or not isinstance(payload.get('headers'),list) or [normalize(v) for v in payload['headers']]!=[normalize(v) for v in headers]:raise ValueError('Header tidak sesuai template '+kind+'.')
    rows=payload.get('rows')
    if not isinstance(rows,list) or len(rows)>100000:raise ValueError('Maksimal 100.000 baris per upload.')
    result=[];seen=set();allowed={key(r,'pagu') for r in pagu};absolute=0
    for number,source in enumerate(rows,2):
        try:
            if not isinstance(source,list) or len(source)>len(headers):raise ValueError('Jumlah kolom tidak sesuai.')
            row=source+[None]*(len(headers)-len(source))
            if all(v is None or str(v).strip()=='' for v in row):continue
            if kind=='pagu' and normalize(row[0])=='GRAND TOTAL' and all(v is None or str(v).strip()=='' for v in row[1:-1]):continue
            values=[str(v).replace('\r\n','\n').replace('\r','\n').strip() if v is not None else '' for v in row[:-1]]
            codes=key(values,kind)
            if any(not re.fullmatch(r'\d+(?:\.\d+)*',v) for v in codes):raise ValueError('Kode wajib diisi dan harus berupa kode angka bertitik.')
            if codes in seen:raise ValueError('Kombinasi kode duplikat.')
            if kind=='realisasi' and codes not in allowed:raise ValueError('Kombinasi kode tidak ditemukan dalam pagu.')
            if kind=='pagu':
                for i in range(5):
                    if len(values[2*i+1])>2000:raise ValueError('Nama maksimal 2.000 karakter.')
                    values[2*i+1]=values[2*i+1] or codes[i]
            amount=cents(row[-1]);absolute+=abs(int(amount))
            if absolute>9007199254740991:raise ValueError('Jumlah nominal melebihi batas presisi ekspor Excel.')
            result.append(values+[amount]);seen.add(codes)
        except ValueError as error:raise ValueError(f'Baris {number}: {error}')
    if kind=='pagu' and not result:raise ValueError('Pagu harus memiliki data rekening.')
    return result

def register_realisasi(app,db,admin_only):
    with db() as c:
        c.execute('CREATE TABLE IF NOT EXISTS realisasi_dashboard(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,payload TEXT NOT NULL)')
        initial={'name':'Dinas Pendidikan dan Kebudayaan','code':'1.01.2.22.0.00.01.0000','pagu':[],'realisasi':[],'pagu_updated':None,'realisasi_updated':None}
        c.execute('INSERT OR IGNORE INTO realisasi_dashboard VALUES(1,1,?)',(json.dumps(initial),))
    @app.get('/admin/dashboard-realisasi')
    @admin_only
    def realisasi_dashboard():return render_template('realisasi.html',page='home',headers={'pagu':PAGU,'realisasi':REAL})
    @app.route('/admin/dashboard-realisasi/data',methods=['GET','POST'])
    @admin_only
    def realisasi_data():
        if request.method=='POST':
            try:
                kind=request.form.get('kind')
                if kind not in ('pagu','realisasi','identity'):raise ValueError('Jenis perubahan tidak valid.')
                payload=json.loads(request.form.get('data',''))
                version=int(request.form.get('version','0'))
                with db() as c:
                    c.execute('BEGIN IMMEDIATE');row=c.execute('SELECT * FROM realisasi_dashboard WHERE id=1').fetchone()
                    if row['version']!=version:return {'error':'Data telah berubah. Muat ulang halaman sebelum mengunggah kembali.'},409
                    data=json.loads(row['payload'])
                    if kind=='identity':
                        if not isinstance(payload,dict):raise ValueError('Identitas tidak valid.')
                        name=str(payload.get('name','')).strip();code=str(payload.get('code','')).strip()
                        if not name or len(name)>240 or not re.fullmatch(r'\d+(?:\.\d+)*',code) or len(code)>100:raise ValueError('Isi nama dan kode dinas yang valid.')
                        data.update(name=name,code=code)
                    else:
                        data[kind]=validate(payload,kind,data['pagu']);data[kind+'_updated']=int(time.time())
                        if kind=='pagu':data['realisasi']=[];data['realisasi_updated']=None
                    c.execute('UPDATE realisasi_dashboard SET version=version+1,payload=? WHERE id=1',(json.dumps(data,ensure_ascii=False,separators=(',',':')),))
                return {'ok':True}
            except (ValueError,TypeError,OverflowError) as error:return {'error':str(error)},400
        with db() as c:row=c.execute('SELECT * FROM realisasi_dashboard WHERE id=1').fetchone()
        tag='realisasi-'+str(row['version']);response=app.response_class(mimetype='application/json')
        response.set_etag(tag);response.headers['Cache-Control']='private, no-cache';response.vary.add('Cookie');response.vary.add('Accept-Encoding')
        if request.if_none_match.contains(tag):response.status_code=304;return response
        data=json.loads(row['payload']);data['version']=row['version']
        body=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode()
        if len(body)>1024 and request.accept_encodings['gzip']>0:body=gzip.compress(body,mtime=0);response.headers['Content-Encoding']='gzip'
        response.set_data(body);return response
    @app.after_request
    def realisasi_headers(response):
        if request.path.startswith('/admin/dashboard-realisasi'):
            if request.method=='POST' or response.status_code not in (200,304):response.headers['Cache-Control']='no-store, private'
            response.headers['X-Content-Type-Options']='nosniff'
        return response
