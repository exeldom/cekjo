"""Shared content-addressed paths for local game media and R2 publishing."""
from pathlib import Path
import hashlib

def media_package(root):
    folder=Path(root)/'static/game/ellery-elric'
    files=sorted(p for sub in ('assets','audio') for p in (folder/sub).glob('*') if p.suffix in ('.png','.wav'))
    digest=hashlib.sha256()
    for p in files:
        digest.update(p.relative_to(folder).as_posix().encode());digest.update(p.read_bytes())
    return digest.hexdigest()[:16],files
