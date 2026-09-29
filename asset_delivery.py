"""Immutable public assets. No user uploads, database files or credentials are published."""
import gzip, hashlib, os
from pathlib import Path
from functools import lru_cache
from flask import request

ROOT=Path(__file__).resolve().parent
PUBLIC_TYPES={'.js','.css','.png','.jpg','.jpeg','.webp','.svg','.ico','.woff','.woff2'}

@lru_cache(maxsize=1)
def asset_versions():
    return {p.relative_to(ROOT/'static').as_posix():hashlib.sha256(p.read_bytes()).hexdigest()[:20]
            for p in sorted((ROOT/'static').rglob('*')) if p.is_file() and p.suffix.lower() in PUBLIC_TYPES}

def asset_url(name):
    version=asset_versions().get(name)
    if not version:raise ValueError('Unknown public asset: '+name)
    base=os.environ.get('ASSET_BASE_URL','').rstrip('/')
    return base+'/static/'+version+'/'+name if base else '/static/'+name+'?v='+version

@lru_cache(maxsize=1)
def worker_package():
    versions=asset_versions()
    # Cache essentials only. Receipt fonts and page-specific extras load on demand.
    names=[name for name in versions if not name.startswith('receipt/') and name not in ('sharing.js','sharing.css','share-view.js','share-view.css')]
    shell=['/offline','/offline/kalkulator-pajak']
    digest=hashlib.sha256()
    for p in sorted((ROOT/'templates').glob('*')):
        if p.is_file():digest.update(p.name.encode()+p.read_bytes())
    import json
    digest.update(json.dumps(versions,sort_keys=True).encode())
    digest.update(os.environ.get('ASSET_BASE_URL','').encode())
    return digest.hexdigest()[:20],{name:asset_url(name) for name in names},shell

@lru_cache(maxsize=32)
def compressed_asset(name, version):
    return gzip.compress((ROOT/'static'/name).read_bytes(),compresslevel=6,mtime=0)

def register_assets(app):
    app.jinja_env.globals['asset_url']=asset_url
    @app.context_processor
    def asset_context():
        return {'client_assets':{name:asset_url(name) for name in asset_versions()}}

    @app.after_request
    def asset_headers(response):
        if request.endpoint=='static':
            name=request.view_args.get('filename','')
            version=asset_versions().get(name)
            if version and request.args.get('v')==version:
                response.headers['Cache-Control']='public, max-age=31536000, immutable'
            else:response.headers['Cache-Control']='public, no-cache'
            if name.endswith(('.js','.css','.svg')):
                response.vary.add('Accept-Encoding')
                if response.status_code==200 and request.method=='GET' and request.accept_encodings['gzip']>0:
                    response.close()
                    response.direct_passthrough=False
                    response.set_data(compressed_asset(name,version))
                    response.headers['Content-Encoding']='gzip'
                    tag=response.get_etag()[0]
                    if tag:response.set_etag(tag,weak=True)
            response.headers['Access-Control-Allow-Origin']='*'
            response.headers['X-Content-Type-Options']='nosniff'
        return response
