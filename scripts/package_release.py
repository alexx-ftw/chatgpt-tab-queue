#!/usr/bin/env python3
"""Build and verify a CRX3 package using Python's stdlib and OpenSSL.

This is a maintainer's release tool, not an installed/local updater. No runtime
code is downloaded or evaluated. Keep the signing key outside the repository.
CRX3 layout follows Chromium components/crx_file/crx3.proto.
"""
import argparse, base64, hashlib, io, json, struct, subprocess, tempfile, zipfile
from pathlib import Path
from xml.sax.saxutils import escape


def varint(n):
    out=bytearray()
    while n>127: out.append((n&127)|128);n>>=7
    out.append(n);return bytes(out)


def field(number,data):
    return varint((number<<3)|2)+varint(len(data))+data


def fields(data):
    at=0;out={}
    def integer():
        nonlocal at
        value=shift=0
        while at<len(data) and shift<64:
            n=data[at];at+=1;value|=(n&127)<<shift
            if n<128:return value
            shift+=7
        raise ValueError('Malformed protobuf varint')
    while at<len(data):
        tag=integer()
        if tag&7!=2:raise ValueError('Unexpected protobuf wire type')
        size=integer();end=at+size
        if end>len(data):raise ValueError('Truncated protobuf field')
        out.setdefault(tag>>3,[]).append(data[at:end]);at=end
    return out


def extension_id(pub):
    return ''.join(chr(97+int(c,16)) for c in hashlib.sha256(pub).hexdigest()[:32])


def verify(path):
    raw=Path(path).read_bytes()
    if len(raw)<12 or raw[:4]!=b'Cr24':raise ValueError('Not CRX3')
    version,size=struct.unpack('<II',raw[4:12])
    if version!=3 or size>len(raw)-12 or size>1048576:raise ValueError('Invalid CRX3 header')
    header=fields(raw[12:12+size]);proof=fields(header[2][0]);pub=proof[1][0];sig=proof[2][0];signed=header[10000][0];archive=raw[12+size:]
    if fields(signed)[1][0]!=hashlib.sha256(pub).digest()[:16]:raise ValueError('Mismatched identity')
    payload=b'CRX3 SignedData\0'+struct.pack('<I',len(signed))+signed+archive
    with tempfile.TemporaryDirectory(prefix='cq-verify-') as tmp:
        p=Path(tmp);(p/'pub.der').write_bytes(pub);(p/'sig').write_bytes(sig);(p/'data').write_bytes(payload)
        subprocess.run(['openssl','pkey','-pubin','-inform','DER','-in',str(p/'pub.der'),'-out',str(p/'pub.pem')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        subprocess.run(['openssl','dgst','-sha256','-verify',str(p/'pub.pem'),'-signature',str(p/'sig'),str(p/'data')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        if z.testzip():raise ValueError('Corrupt zip')
        manifest=json.loads(z.read('manifest.json'))
        if base64.b64decode(manifest['key'])!=pub:raise ValueError('Manifest key differs from signature')
        if any(n.startswith('/') or '..' in Path(n).parts or n.endswith(('.pem','.key')) for n in z.namelist()):raise ValueError('Unsafe package paths')
    return {'id':extension_id(pub),'version':manifest['version'],'sha256':hashlib.sha256(raw).hexdigest(),'update_url':manifest.get('update_url')}


def package(source,key,out,repository):
    source=Path(source).resolve();out=Path(out).resolve();out.mkdir(parents=True,exist_ok=True)
    pub=subprocess.check_output(['openssl','pkey','-in',str(key),'-pubout','-outform','DER'],stderr=subprocess.PIPE)
    manifest=json.loads((source/'manifest.json').read_text())
    if manifest.get('key') and base64.b64decode(manifest['key'])!=pub:raise ValueError('Wrong signing key for this extension')
    manifest['key']=base64.b64encode(pub).decode()
    if not manifest.get('update_url','').startswith('https://'):raise ValueError('Native updates require a fixed HTTPS update URL')
    paths=[source/n for n in ['background.mjs','content.js','LICENSE'] if (source/n).is_file()]
    for directory,suffixes in [('core',{'.js','.mjs'}),('ui',{'.html','.css','.js','.mjs'}),('icons',{'.png'})]:
        paths.extend(p for p in (source/directory).rglob('*') if p.is_file() and p.suffix in suffixes)
    archive=io.BytesIO()
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        entries={'manifest.json':(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()}
        for p in paths:
            if p.is_symlink() or not p.resolve().is_relative_to(source):raise ValueError('Symlinks may not enter releases')
            entries[p.relative_to(source).as_posix()]=p.read_bytes()
        for name,data in sorted(entries.items()):
            info=zipfile.ZipInfo(name,(2020,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,data)
    zipbytes=archive.getvalue();signed=field(1,hashlib.sha256(pub).digest()[:16])
    payload=b'CRX3 SignedData\0'+struct.pack('<I',len(signed))+signed+zipbytes
    sig=subprocess.check_output(['openssl','dgst','-sha256','-sign',str(key)],input=payload,stderr=subprocess.PIPE)
    header=field(2,field(1,pub)+field(2,sig))+field(10000,signed)
    crx=b'Cr24'+struct.pack('<II',3,len(header))+header+zipbytes
    (out/'chatgpt-queue.crx').write_bytes(crx);(out/'chatgpt-queue.zip').write_bytes(zipbytes)
    meta=verify(out/'chatgpt-queue.crx');(out/'release.json').write_text(json.dumps(meta,indent=2)+'\n')
    url=f'https://github.com/{repository}/releases/download/v{meta["version"]}/chatgpt-queue.crx'
    xml=f'''<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="{meta['id']}">
    <updatecheck codebase="{escape(url)}" version="{meta['version']}" hash_sha256="{meta['sha256']}" />
  </app>
</gupdate>
'''
    (out/'updates.xml').write_text(xml)
    (out/'SHA256SUMS').write_text(''.join(f'{hashlib.sha256((out/n).read_bytes()).hexdigest()}  {n}\n' for n in ['chatgpt-queue.crx','chatgpt-queue.zip','updates.xml','release.json']))
    return meta


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source',default='.');p.add_argument('--key');p.add_argument('--out',default='dist');p.add_argument('--repository',default='alexx-ftw/chatgpt-tab-queue');p.add_argument('--verify')
    args=p.parse_args()
    if args.verify:result=verify(args.verify)
    else:
        if not args.key:p.error('--key is required to sign a release')
        result=package(args.source,args.key,args.out,args.repository)
    print(json.dumps(result,indent=2))
