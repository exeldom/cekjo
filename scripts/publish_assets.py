"""Upload public static assets once per content hash; never uploads private application data."""
import argparse,gzip,importlib.util,mimetypes,os,sys
from pathlib import Path

parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=Path(__file__).resolve().parents[1]);args=parser.parse_args();root=args.root
# Local .env is read only by this upload tool. Railway continues using Variables.
settings={}
if (root/'.env').exists():
    for line in (root/'.env').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key,value=line.split('=',1);settings[key.strip()]=value.strip().strip('"\'')
settings.update(os.environ)
required={'endpoint_url':settings.get('ASSET_R2_ENDPOINT') or settings.get('R2_ENDPOINT'),'aws_access_key_id':settings.get('ASSET_R2_ACCESS_KEY_ID') or settings.get('R2_ACCESS_KEY_ID'),'aws_secret_access_key':settings.get('ASSET_R2_SECRET_ACCESS_KEY') or settings.get('R2_SECRET_ACCESS_KEY')}
if not all(required.values()):sys.exit('Isi kredensial bucket aset di .env lokal terlebih dahulu; jangan kirim kunci ke chat.')
bucket=settings.get('ASSET_R2_BUCKET','cekjo-assets')
if bucket==settings.get('R2_BUCKET','berbagi-data'):sys.exit('Bucket aset harus terpisah dari bucket Berbagi Data private.')
spec=importlib.util.spec_from_file_location('asset_delivery',root/'asset_delivery.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
client=boto3.client('s3',**required,region_name='auto',config=Config(signature_version='s3v4',connect_timeout=5,read_timeout=60,retries={'max_attempts':2},request_checksum_calculation='when_required',response_checksum_validation='when_required'))
try:
    uploaded=0;skipped=0
    for name,version in module.asset_versions().items():
        key='static/'+version+'/'+name
        try:client.head_object(Bucket=bucket,Key=key);skipped+=1;continue
        except ClientError as error:
            if error.response['ResponseMetadata']['HTTPStatusCode']!=404:raise
        data=(root/'static'/name).read_bytes();mime=mimetypes.guess_type(name)[0] or 'application/octet-stream';extra={}
        if name.endswith(('.js','.css','.svg')):data=gzip.compress(data,compresslevel=9,mtime=0);extra['ContentEncoding']='gzip'
        client.put_object(Bucket=bucket,Key=key,Body=data,ContentType=mime,CacheControl='public,max-age=31536000,immutable',**extra)
        uploaded+=1;print('Uploaded',name,flush=True)
    print(f'Selesai: {uploaded} upload baru, {skipped} sudah tersedia. Aktifkan ASSET_BASE_URL setelah CORS GET/HEAD siap.')
except Exception as error:
    code=error.response.get('Error',{}).get('Code','') if isinstance(error,ClientError) else type(error).__name__
    sys.exit('Upload berhenti ('+code+'). Periksa bucket/kredensial/koneksi. Kunci tidak ditampilkan.')
