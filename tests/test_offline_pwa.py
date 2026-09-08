# -*- coding: utf-8 -*-

import os
import re


ROOT = os.path.dirname(os.path.dirname(__file__))
STATIC_ROOT = os.path.join(ROOT, 'saythanks', 'static')


def _read(relative_path):
    path = os.path.join(ROOT, relative_path)
    with open(path, encoding='utf-8') as source_file:
        return source_file.read()


def test_service_worker_is_root_registered_and_has_offline_fallback():
    base_template = _read('saythanks/templates/base.htm.j2')
    service_worker = _read('saythanks/static/service-worker.js')

    assert "navigator.serviceWorker.register('/service-worker.js')" in base_template
    assert "const OFFLINE_URL = '/static/offline.html';" in service_worker
    assert "caches.match(OFFLINE_URL)" in service_worker


def test_service_worker_precaches_public_note_assets():
    service_worker = _read('saythanks/static/service-worker.js')
    expected_assets = (
        '/static/offline.html',
        '/static/manifest.json',
        '/static/css/saythanks.css',
        '/static/js/main.js',
        '/static/images/owly.svg',
    )

    for asset in expected_assets:
        assert asset in service_worker

    assert "cache.addAll(PRECACHE_URLS)" in service_worker
    assert os.path.isfile(os.path.join(STATIC_ROOT, 'offline.html'))


def test_service_worker_does_not_cache_private_routes_or_non_get_requests():
    service_worker = _read('saythanks/static/service-worker.js')

    for private_route in (
        "'/inbox'",
        "'/inbox/search'",
        "'/inbox/archived'",
        "'/logout'",
        "'/callback'",
    ):
        assert private_route in service_worker

    assert "request.method !== 'GET'" in service_worker
    assert "url.origin !== self.location.origin" in service_worker


def test_service_worker_versioned_cache_removes_old_caches():
    service_worker = _read('saythanks/static/service-worker.js')
    compact_worker = re.sub(r'\s+', '', service_worker)

    assert re.search(
        r"const CACHE_NAME = 'saythanks-public-v\d+';", service_worker)
    assert "cacheNames.filter(cacheName=>cacheName!==CACHE_NAME)" in compact_worker
    assert "caches.delete(cacheName)" in service_worker


def test_network_status_is_exposed_as_an_accessible_live_region():
    base_template = _read('saythanks/templates/base.htm.j2')

    assert '<span id="network-status" role="status" aria-live="polite"></span>' in base_template
    assert "window.addEventListener('online', updateNetworkStatus)" in base_template
    assert "window.addEventListener('offline', updateNetworkStatus)" in base_template


def test_note_form_uses_indexeddb_and_keys_drafts_by_form_action():
    submit_template = _read('saythanks/templates/submit_note.htm.j2')

    assert "const draftDatabaseName = 'saythanks-pwa';" in submit_template
    assert "const draftStoreName = 'drafts';" in submit_template
    assert "const draftKey = form.getAttribute('action');" in submit_template
    assert "indexedDB.open(draftDatabaseName, 1)" in submit_template
    assert "createObjectStore(draftStoreName, { keyPath: 'key' })" in submit_template
    assert "objectStore(draftStoreName).put({" in submit_template
    assert "key: draftKey," in submit_template


def test_note_form_restores_and_saves_body_and_byline():
    submit_template = _read('saythanks/templates/submit_note.htm.j2')

    assert "editor.setMarkdown(draft.body)" in submit_template
    assert "document.getElementById('byline').value = draft.byline" in submit_template
    assert "body: editor.getMarkdown()," in submit_template
    assert "byline: document.getElementById('byline').value," in submit_template
    assert "editor.addHook('change', () => {" in submit_template
    assert (
        "document.getElementById('byline').addEventListener("
        "'input', scheduleDraftSave)"
    ) in submit_template


def test_offline_fallback_does_not_claim_to_send_notes():
    offline_page = _read('saythanks/static/offline.html')

    assert 'Your note drafts remain on this device' in offline_page
    assert 'are not sent until you submit them while connected' in offline_page
