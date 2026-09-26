"""Publish immutable game assets: .venv/bin/python scripts/upload_game_assets.py"""
import argparse,os,sys,mimetypes
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);args=parser.parse_args()
root=args.root
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from game_media import media_package
import boto3
from botocore.config import Config
config={}
if (root/'.env').exists():
    for line in (root/'.env').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key,value=line.split('=',1);config[key.strip()]=value.strip().strip('\"\'')
for key in ('R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'):
    config[key]=os.environ.get(key) or config.get(key)
if not all(config.get(k) for k in ('R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY')):
    sys.exit('Isi kredensial R2 di .env lokal terlebih dahulu.')
client=boto3.client('s3',endpoint_url=config['R2_ENDPOINT'],region_name='auto',aws_access_key_id=config['R2_ACCESS_KEY_ID'],aws_secret_access_key=config['R2_SECRET_ACCESS_KEY'],config=Config(signature_version='s3v4',request_checksum_calculation='when_required',response_checksum_validation='when_required',connect_timeout=10,read_timeout=60))
version,files=media_package(root)
for path in files:
    key='games/ellery-elric/'+version+'/'+path.relative_to(root/'static/game/ellery-elric').as_posix()
    try:
        client.put_object(Bucket='cekjo-assets',Key=key,Body=path.read_bytes(),ContentType=mimetypes.guess_type(path.name)[0] or 'application/octet-stream',CacheControl='public,max-age=31536000,immutable')
        assert client.head_object(Bucket='cekjo-assets',Key=key)['ContentLength']==path.stat().st_size
    except Exception:
        sys.exit('Upload/verifikasi gagal untuk '+path.name+'. Periksa koneksi dan izin bucket cekjo-assets.')
    print('OK',path.name)
print('Media version:',version)
print('Railway: GAME_ASSET_BASE_URL=https://assets.cekjo.com')
