#!/usr/bin/env python3
"""Verify a release bundle against the checked-out, reviewed runtime source."""
import argparse
import base64
import hashlib
import json
import re
import struct
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from package_release import verify, extension_id

ASSETS = ('chatgpt-queue.crx', 'chatgpt-queue.zip', 'updates.xml', 'release.json', 'SHA256SUMS')
NS = '{http://www.google.com/update2/response}'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def version(value):
    require(bool(re.fullmatch(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)', value)), 'Expected a three-component release version')
    result = tuple(map(int, value.split('.')))
    require(all(n <= 65535 for n in result), 'Chrome version component out of range')
    return result


def verify_bundle(source, bundle, repository, expected_version):
    source, bundle = Path(source), Path(bundle)
    version(expected_version)
    require({p.name for p in bundle.iterdir()} == set(ASSETS), 'Unexpected or missing release assets')
    require(all((bundle / name).is_file() and not (bundle / name).is_symlink() for name in ASSETS), 'Assets must be regular files')
    manifest = json.loads((source / 'manifest.json').read_text())
    require(manifest['version'] == expected_version, 'Version differs from reviewed source')
    expected_feed = f'https://github.com/{repository}/releases/latest/download/updates.xml'
    require(manifest['update_url'] == expected_feed, 'Unexpected update channel')
    meta = verify(bundle / 'chatgpt-queue.crx')
    require(meta == json.loads((bundle / 'release.json').read_text()), 'Release metadata mismatch')
    require(meta['version'] == expected_version and meta['id'] == extension_id(base64.b64decode(manifest['key'])) and meta['update_url'] == expected_feed, 'Release identity/version/channel mismatch')
    raw = (bundle / 'chatgpt-queue.crx').read_bytes()
    header_len = struct.unpack('<I', raw[8:12])[0]
    require(raw[12+header_len:] == (bundle / 'chatgpt-queue.zip').read_bytes(), 'Signed payload differs from ZIP')
    expected = {n for n in ['background.mjs', 'content.js', 'LICENSE'] if (source / n).is_file()}
    for directory, suffixes in [('core', {'.js', '.mjs'}), ('ui', {'.html', '.css', '.js', '.mjs'}), ('icons', {'.png'})]:
        expected.update(p.relative_to(source).as_posix() for p in (source / directory).rglob('*') if p.is_file() and p.suffix in suffixes)
    with zipfile.ZipFile(bundle / 'chatgpt-queue.zip') as z:
        require(len(z.namelist()) == len(expected)+1 and set(z.namelist()) == expected | {'manifest.json'}, 'Unexpected archive entries')
        require(json.loads(z.read('manifest.json')) == manifest, 'Packaged manifest differs from source')
        for n in expected:
            require(not (source / n).is_symlink() and z.read(n) == (source / n).read_bytes(), f'Packaged file differs: {n}')
    root = ET.parse(bundle / 'updates.xml').getroot()
    app = root.find(NS+'app')
    require(root.tag == NS+'gupdate' and root.attrib == {'protocol':'2.0'} and len(root) == 1 and app is not None and app.attrib == {'appid':meta['id']} and len(app) == 1, 'Unexpected update manifest')
    check = app.find(NS+'updatecheck')
    require(check is not None and check.attrib == {'codebase':f'https://github.com/{repository}/releases/download/v{expected_version}/chatgpt-queue.crx','version':expected_version,'hash_sha256':meta['sha256']}, 'Update manifest does not match CRX')
    sums = ''.join(f'{hashlib.sha256((bundle / n).read_bytes()).hexdigest()}  {n}\n' for n in ASSETS[:-1])
    require((bundle / 'SHA256SUMS').read_text() == sums, 'Asset checksums differ')
    return meta


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', default='.')
    p.add_argument('--bundle', default='dist')
    p.add_argument('--repository', default='alexx-ftw/chatgpt-tab-queue')
    p.add_argument('--version', required=True)
    args = p.parse_args()
    print(json.dumps(verify_bundle(args.source, args.bundle, args.repository, args.version), indent=2))
