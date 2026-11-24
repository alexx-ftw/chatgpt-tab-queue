#!/usr/bin/env python3
"""Isolated release verification with disposable test identities only."""
import base64
import json
import shutil
import subprocess
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from package_release import package
from verify_release import verify_bundle, version

ROOT = Path(__file__).resolve().parent.parent
REPO = 'alexx-ftw/chatgpt-tab-queue'

class ReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='cq-release-test-')
        cls.root = Path(cls.temp.name)
        cls.source = cls.root / 'source'
        cls.source.mkdir()
        for name in ('core', 'ui', 'icons'):
            shutil.copytree(ROOT / name, cls.source / name)
        for name in ('manifest.json','background.mjs','content.js','LICENSE'):
            shutil.copy2(ROOT / name, cls.source / name)
        cls.key = cls.root / 'ephemeral-test.pem'
        subprocess.run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',str(cls.key)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pub = subprocess.check_output(['openssl','pkey','-in',str(cls.key),'-pubout','-outform','DER'], stderr=subprocess.DEVNULL)
        manifest = json.loads((cls.source / 'manifest.json').read_text())
        manifest['key'] = base64.b64encode(pub).decode()
        cls.v = manifest['version']
        (cls.source / 'manifest.json').write_text(json.dumps(manifest))
        cls.bundle = cls.root / 'valid'
        cls.meta = package(cls.source, cls.key, cls.bundle, REPO)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_valid(self):
        self.assertEqual(verify_bundle(self.source,self.bundle,REPO,self.v),self.meta)

    def test_modified_release_asset(self):
        for name in ('chatgpt-queue.crx','chatgpt-queue.zip','updates.xml','release.json','SHA256SUMS'):
            with self.subTest(name=name), tempfile.TemporaryDirectory(dir=self.root) as tmp:
                dest=Path(tmp)/'bundle'
                shutil.copytree(self.bundle,dest)
                with (dest/name).open('ab') as f:f.write(b'corruption')
                with self.assertRaises((ValueError,subprocess.CalledProcessError,zipfile.BadZipFile,ET.ParseError)):
                    verify_bundle(self.source,dest,REPO,self.v)

    def test_wrong_version(self):
        with self.assertRaises(ValueError):verify_bundle(self.source,self.bundle,REPO,'65535.0.0')

    def test_source_mismatch(self):
        with tempfile.TemporaryDirectory(dir=self.root) as tmp:
            dest=Path(tmp)/'source';shutil.copytree(self.source,dest)
            with (dest/'content.js').open('ab') as f:f.write(b'\n// changed')
            with self.assertRaisesRegex(ValueError,'Packaged file differs'):
                verify_bundle(dest,self.bundle,REPO,self.v)

    def test_real_public_identity_rejects_disposable_key(self):
        with self.assertRaisesRegex(ValueError,'Wrong signing key'):
            package(ROOT,self.key,self.root/'wrong-identity',REPO)

    def test_version_validation(self):
        for invalid in ('v0.7.1','0.07.1','0.7.1; echo x','0.7','0.7.65536'):
            with self.assertRaises(ValueError):version(invalid)

if __name__ == '__main__':unittest.main()
