"""Run .venv/bin/python checks/check_realisasi.py [pagu.xlsx realisasi.xlsx]. Isolated database."""
import os,sys,tempfile,json,subprocess,gzip
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
with tempfile.TemporaryDirectory() as tmp:
    os.environ['DATA_DIR']=tmp
    from app import app
    app.config['TESTING']=True
    from realisasi import PAGU,REAL,validate,cents
    assert cents('800000.255')=='80000026'
    assert cents('800.000,255')=='80000026'
    assert cents(27769428.000000004)=='2776942800'
    assert cents('-1.235')=='-124'
    admin=app.test_client();guest=app.test_client()
    assert guest.get('/admin/dashboard-realisasi').status_code==302
    assert guest.get('/admin/dashboard-realisasi/data').status_code==302
    with admin.session_transaction() as s:s['admin']=True;s['csrf']='check'
    def get():return admin.get('/admin/dashboard-realisasi/data').json
    def upload(kind,headers,rows,version=None):return admin.post('/admin/dashboard-realisasi/data',data={'csrf':'check','kind':kind,'version':version if version is not None else get()['version'],'data':json.dumps({'headers':headers,'rows':rows})})
    if len(sys.argv)==3:
        reader="const X=require('./static/merge-excel/vendor/xlsx.js');console.log(JSON.stringify(process.argv.slice(1).map(p=>{const w=X.read(require('fs').readFileSync(p),{type:'buffer'});return X.utils.sheet_to_json(w.Sheets[w.SheetNames[0]],{header:1,defval:null,raw:true});})));"
        source=json.loads(subprocess.check_output(['node','-e',reader,*sys.argv[1:]],cwd=root,text=True))
        ph,pr=source[0][0],source[0][1:];rh,rr=source[1][0],source[1][1:]
    else:
        ph,pr=PAGU,[['1.01','Bidang','1.01.01','Program','1.01.01.1.01','Kegiatan','1.01.01.1.01.0001','Sub','5.1.01','Rekening',100.25]]
        rh,rr=REAL,[['1.01','1.01.01','1.01.01.1.01','1.01.01.1.01.0001','5.1.01',25.05]]
    name_rows=[['1.01','Nama A','1.01.01','Program A','1.01.01.1.01','Kegiatan A','1.01.01.1.01.0001','Sub A','5.1.01','Akun A',10],['1.01','Nama berbeda','1.01.01','Program beda','1.01.01.1.01','Kegiatan beda','1.01.01.1.01.0001','Sub beda','5.1.02','',20]]
    assert len(validate({'headers':PAGU,'rows':name_rows},'pagu',[]))==2
    assert upload('pagu',ph,pr).status_code==200
    assert upload('realisasi',rh,rr).status_code==200
    saved=get()
    if len(sys.argv)==3:
        assert len(saved['pagu'])==324 and len(saved['realisasi'])==49
        assert sum(int(r[-1]) for r in saved['pagu'])==64912740269050
        assert sum(int(r[-1]) for r in saved['realisasi'])==1540084053150
    response=admin.get('/admin/dashboard-realisasi/data',headers={'Accept-Encoding':'gzip'})
    assert 'private' in response.headers['Cache-Control']
    if response.headers.get('Content-Encoding'):assert json.loads(gzip.decompress(response.data))==saved
    assert admin.get('/admin/dashboard-realisasi/data',headers={'If-None-Match':response.headers['ETag']}).status_code==304
    bad=[list(rr[0])];bad[0][4]='9.99'
    assert upload('realisasi',rh,bad).status_code==400 and get()==saved
    assert upload('realisasi',rh,[rr[0],rr[0]]).status_code==400 and get()==saved
    assert upload('pagu',ph,pr,version=1).status_code==409 and get()==saved
    fixture=Path(tmp)/'data.json';fixture.write_text(json.dumps(saved))
    script=r'''
const fs=require('fs'),assert=require('assert/strict'),XLSX=require('./static/merge-excel/vendor/xlsx.js'),core=require('./static/realisasi/core.js');
const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const tree=core.hierarchy(data);
assert.equal(tree.pagu,data.pagu.reduce((s,r)=>s+BigInt(r[10]),0n));assert.equal(tree.real,data.realisasi.reduce((s,r)=>s+BigInt(r[5]),0n));
function walk(node){if(node.children.size){let pagu=0n,real=0n;for(const child of node.children.values()){pagu+=child.pagu;real+=child.real;walk(child);}assert.equal(node.pagu,pagu);assert.equal(node.real,real);}}walk(tree);
assert.equal(core.percent(1n,0n),null);assert.equal(core.percent(150n,100n),150);assert.equal(core.money(10025n),'Rp100,25');
const exported={};for(const kind of ['pagu','realisasi']){
const rows=data[kind].map(r=>[...r.slice(0,-1),Number(r.at(-1))/100]);const sheet=XLSX.utils.aoa_to_sheet(rows);const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Sheet1');
const again=XLSX.read(XLSX.write(book,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});exported[kind]=XLSX.utils.sheet_to_json(again.Sheets.Sheet1,{header:1,raw:true});}
console.log(JSON.stringify(exported));'''
    exported=json.loads(subprocess.check_output(['node','-e',script,str(fixture)],cwd=root,text=True))
    assert upload('pagu',ph,exported['pagu']).status_code==200 and get()['realisasi']==[]
    assert upload('realisasi',rh,exported['realisasi']).status_code==200
    assert get()['pagu']==saved['pagu'] and get()['realisasi']==saved['realisasi']
    assert upload('realisasi',rh,rr[:1]).status_code==200 and len(get()['realisasi'])==1
    assert upload('pagu',ph,pr).status_code==200 and get()['realisasi']==[]
    assert admin.get('/admin/dashboard-realisasi').status_code==200
    assert b'Dashboard Realisasi' in admin.get('/admin').data
    assert admin.post('/admin/dashboard-realisasi/data',data={'kind':'pagu'}).status_code==400
print('PASS: totals, hierarchy, export/reimport, replacement/reset, validation rollback, versions, gzip/ETag and admin/CSRF.')
