// Uploads: the multipart request construction for content.upload, and how the
// returned document threads into task/comment/letter writes. Fetch is mocked —
// no bytes leave the process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, staticToken, uploadFile, MizitoApiError, UPLOAD_URL } from '@mohsp-99/mizito-core';

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

// Capture the upload request; return a canned document.
function mockUpload(doc = { _id: 'doc-1', name: 'f.pdf', size: 3, content: 'tok', content_key: 'k' }) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return { status: 200, ok: true, text: async () => JSON.stringify(doc) };
  };
  return seen;
}

test('content.upload posts multipart to the upload URL with the token header', async () => {
  const seen = mockUpload();
  const c = createClient({ tokens: staticToken('tok-1'), pacingMs: 0 });
  const doc = await c.content.upload(new Uint8Array([1, 2, 3]), { filename: 'f.pdf' });

  assert.equal(doc._id, 'doc-1');
  assert.equal(seen[0].url, UPLOAD_URL);
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers['x-token'], 'tok-1');
  const body = seen[0].init.body;
  assert.ok(body instanceof FormData, 'body is FormData');
  // The file part is named "upload"; sendAsFile defaults true for non-images.
  assert.ok(body.get('upload') != null, 'has upload part');
  assert.equal(body.get('sendAsFile'), 'true');
  assert.equal(body.get('maxWidthHeight'), null); // not passed
});

test('content.upload passes maxWidthHeight and honors sendAsFile:false for images', async () => {
  const seen = mockUpload();
  const c = createClient({ tokens: staticToken('t'), pacingMs: 0 });
  const img = new Blob([new Uint8Array([1])], { type: 'image/png' });
  await c.content.upload(img, { maxWidthHeight: 1200, sendAsFile: false });
  const body = seen[0].init.body;
  assert.equal(body.get('maxWidthHeight'), '1200');
  assert.equal(body.get('sendAsFile'), 'false');
});

test('content.upload surfaces an auth failure as a typed error', async () => {
  globalThis.fetch = async () => ({ status: 401, ok: false, text: async () => 'nope' });
  const c = createClient({ tokens: staticToken('t'), pacingMs: 0 });
  await assert.rejects(
    () => c.content.upload(new Uint8Array([1])),
    (err) => err instanceof MizitoApiError && err.code === 'auth' && err.endpoint === 'content/upload',
  );
});

test('content.upload rejects an { error } response body', async () => {
  globalThis.fetch = async () => ({ status: 200, ok: true, text: async () => JSON.stringify({ error: true, msg: 'too big' }) });
  const c = createClient({ tokens: staticToken('t'), pacingMs: 0 });
  await assert.rejects(
    () => c.content.upload(new Uint8Array([1])),
    (err) => err instanceof MizitoApiError && /too big/.test(err.message),
  );
});

// --- attachment threading through the feed layer ---------------------------

// A fetch mock that routes by endpoint: bootstrap, tasks/add, and upload.
function mockWorkspace({ onAdd } = {}) {
  const uploads = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u === UPLOAD_URL) {
      uploads.push(init);
      return { status: 200, ok: true, text: async () => JSON.stringify({ _id: 'up-' + uploads.length, name: 'x' }) };
    }
    const body = init.body ? JSON.parse(init.body) : {};
    if (u.endsWith('/workspace/userId')) {
      return { status: 200, ok: true, text: async () => JSON.stringify({ status: 1, data: { uid: 'me', workspaces: [{ _id: 'w1', title: 'WS', active: true }] } }) };
    }
    if (u.endsWith('/tasks/add')) {
      onAdd?.(body);
      return { status: 200, ok: true, text: async () => JSON.stringify({ status: 1, data: { _id: 't1', title: body.title, access_token: 'atk' } }) };
    }
    if (u.endsWith('/projects/getList') || u.endsWith('/workspace/getUsers')) {
      return { status: 200, ok: true, text: async () => JSON.stringify({ status: 1, data: {} }) };
    }
    return { status: 200, ok: true, text: async () => JSON.stringify({ status: 1, data: {} }) };
  };
  return { uploads };
}

test('createTask uploads files and threads the documents into attachments', async () => {
  const { createClient: _c } = await import('@mohsp-99/mizito-core');
  const { buildContext, createTask } = await import('@mohsp-99/mizito-core');
  let addPayload;
  mockWorkspace({ onAdd: (b) => { addPayload = b; } });
  const ctx = await buildContext(staticToken('t'));
  const res = await createTask(ctx, {
    title: 'With files',
    attachments: [{ _id: 'pre-1', name: 'existing' }],
    files: [{ data: new Uint8Array([1, 2]), filename: 'a.txt' }],
  });
  assert.equal(res.created, true);
  // pre-uploaded doc first, then the freshly uploaded one — each nested under
  // `media`, which is the shape the API actually stores. Verified live against
  // an existing task's attachments; posting the bare document instead makes
  // tasks/newComment answer `false` and save nothing.
  assert.equal(addPayload.attachments.length, 2);
  assert.equal(addPayload.attachments[0].media._id, 'pre-1');
  assert.equal(addPayload.attachments[1].media._id, 'up-1');
});

test('an already-wrapped attachment entry is not double-wrapped', async () => {
  // Attachments read back off an existing task already carry `media`; re-using
  // one must not produce media.media.
  const { buildContext, createTask } = await import('@mohsp-99/mizito-core');
  let addPayload;
  mockWorkspace({ onAdd: (b) => { addPayload = b; } });
  const ctx = await buildContext(staticToken('t'));
  await createTask(ctx, {
    title: 'Re-used attachment',
    attachments: [{ _id: 'att-1', media: { _id: 'doc-1', name: 'existing' } }],
  });
  assert.equal(addPayload.attachments.length, 1);
  assert.equal(addPayload.attachments[0].media._id, 'doc-1');
  assert.equal(addPayload.attachments[0].media.media, undefined);
});

test('uploadFile returns the created document scoped to the workspace', async () => {
  mockWorkspace();
  const { buildContext } = await import('@mohsp-99/mizito-core');
  const ctx = await buildContext(staticToken('t'));
  const { workspace, document } = await uploadFile(ctx, { data: new Uint8Array([9]), filename: 'z.bin' });
  assert.equal(workspace, 'WS');
  assert.equal(document._id, 'up-1');
});
