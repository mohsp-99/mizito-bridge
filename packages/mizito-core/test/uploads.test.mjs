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

// Capture the upload request; return a canned response in the real shape —
// content/upload answers with the messageMediaDocument wrapper, not the bare
// document (verified live 2026-07-20).
function mockUpload(
  doc = {
    _: 'messageMediaDocument',
    document: { _id: 'doc-1', name: 'f.pdf', size: 3, content: 'tok', content_key: 'k' },
  },
) {
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

  assert.equal(doc._, 'messageMediaDocument');
  assert.equal(doc.document._id, 'doc-1');
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

// A fetch mock that routes by endpoint: bootstrap, tasks/add, inbox/send, upload.
// The default `uploadDoc` is the real content/upload response — the
// `messageMediaDocument` wrapper, verified live 2026-07-20. `uploadDoc`
// overrides it so the tolerance test can also feed in the bare-document shape.
function mockWorkspace({ onAdd, onSend, uploadDoc } = {}) {
  const uploads = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u === UPLOAD_URL) {
      uploads.push(init);
      const n = uploads.length;
      const doc = uploadDoc
        ? uploadDoc(n)
        : { _: 'messageMediaDocument', document: { _id: 'up-' + n, name: 'x' } };
      return { status: 200, ok: true, text: async () => JSON.stringify(doc) };
    }
    const body = init.body ? JSON.parse(init.body) : {};
    if (u.endsWith('/workspace/userId')) {
      return { status: 200, ok: true, text: async () => JSON.stringify({ status: 1, data: { uid: 'me', workspaces: [{ _id: 'w1', title: 'WS', active: true }] } }) };
    }
    if (u.endsWith('/tasks/add')) {
      onAdd?.(body);
      return { status: 200, ok: true, text: async () => JSON.stringify({ status: 1, data: { _id: 't1', title: body.title, access_token: 'atk' } }) };
    }
    if (u.endsWith('/inbox/send')) {
      const res = onSend?.(body);
      return { status: 200, ok: true, text: async () => JSON.stringify({ status: 1, data: res === undefined ? { thread: 'th-1' } : res }) };
    }
    if (u.endsWith('/workspace/getUsers')) {
      return { status: 200, ok: true, text: async () => JSON.stringify({ status: 1, data: { users: [{ _id: 'u-1', first_name: 'Ali', last_name: 'R' }] } }) };
    }
    if (u.endsWith('/projects/getList')) {
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
  // Pre-uploaded doc first, then the freshly uploaded one. The live shape (read
  // off tasks/getAll) is { _id, media: { _: 'messageMediaDocument', document } },
  // so the document sits at media.document — NOT at media, which is the
  // half-shape the earlier fix stopped at.
  assert.equal(addPayload.attachments.length, 2);
  assert.equal(addPayload.attachments[0].media._, 'messageMediaDocument');
  assert.equal(addPayload.attachments[0].media.document._id, 'pre-1');
  assert.equal(addPayload.attachments[1].media.document._id, 'up-1');
});

test('task attachments land in the same shape whichever way content/upload answers', async () => {
  // content/upload returns the media wrapper (verified live 2026-07-20), but the
  // normalizer must not depend on that — a bare document has to produce the
  // identical payload, so a server-side change here cannot silently corrupt
  // every attachment write again.
  const { buildContext, createTask } = await import('@mohsp-99/mizito-core');
  const shapes = {
    bare: (n) => ({ _id: 'up-' + n, name: 'x' }),
    wrapper: (n) => ({ _: 'messageMediaDocument', document: { _id: 'up-' + n, name: 'x' } }),
  };
  const payloads = {};
  for (const [label, uploadDoc] of Object.entries(shapes)) {
    mockWorkspace({ uploadDoc, onAdd: (b) => { payloads[label] = b; } });
    const ctx = await buildContext(staticToken('t'));
    await createTask(ctx, { title: 'Shape', files: [{ data: new Uint8Array([1]), filename: 'a.txt' }] });
  }
  assert.deepEqual(payloads.bare.attachments, payloads.wrapper.attachments);
  assert.equal(payloads.bare.attachments[0].media.document._id, 'up-1');
});

test('an already-wrapped attachment entry is not double-wrapped', async () => {
  // Attachments read back off an existing task already carry `media`; re-using
  // one must not produce media.media or media.document.document.
  const { buildContext, createTask } = await import('@mohsp-99/mizito-core');
  let addPayload;
  mockWorkspace({ onAdd: (b) => { addPayload = b; } });
  const ctx = await buildContext(staticToken('t'));
  await createTask(ctx, {
    title: 'Re-used attachment',
    attachments: [
      { _id: 'att-1', media: { _: 'messageMediaDocument', document: { _id: 'doc-1', name: 'existing' } } },
    ],
  });
  assert.equal(addPayload.attachments.length, 1);
  assert.equal(addPayload.attachments[0].media.document._id, 'doc-1');
  assert.equal(addPayload.attachments[0].media.media, undefined);
  assert.equal(addPayload.attachments[0].media.document.document, undefined);
});

// --- letters ---------------------------------------------------------------
// Letters store the BARE media wrapper, with no `media` layer — verified live
// against inbox/getHistory on several letters (thread- and reply-level alike).

test('sendLetter posts attachments as the bare media wrapper, not the task shape', async () => {
  const { buildContext, sendLetter } = await import('@mohsp-99/mizito-core');
  let sendBody;
  mockWorkspace({ onSend: (b) => { sendBody = b; return { thread: 'th-9' }; } });
  const ctx = await buildContext(staticToken('t'));
  const res = await sendLetter(ctx, {
    to: 'Ali',
    subject: 'S',
    content: 'C',
    files: [{ data: new Uint8Array([1]), filename: 'a.pdf' }],
  });
  assert.equal(sendBody.attachments.length, 1);
  assert.equal(sendBody.attachments[0]._, 'messageMediaDocument');
  assert.equal(sendBody.attachments[0].document._id, 'up-1');
  // The `media` layer belongs to tasks only — its presence here is the bug.
  assert.equal(sendBody.attachments[0].media, undefined);
  assert.equal(res.thread, 'th-9');
  assert.equal(res.attachments, 1);
});

test('a task-shaped attachment entry is unwrapped when re-used on a letter', async () => {
  // AttachmentOptions is shared with the task writes and documents that either
  // shape is accepted, so callers do hand over task entries. Spreading one in
  // raw would post { _id, media } into a letter.
  const { buildContext, sendLetter } = await import('@mohsp-99/mizito-core');
  let sendBody;
  mockWorkspace({ onSend: (b) => { sendBody = b; } });
  const ctx = await buildContext(staticToken('t'));
  await sendLetter(ctx, {
    to: 'Ali',
    subject: 'S',
    content: 'C',
    attachments: [
      { _id: 'att-1', media: { _: 'messageMediaDocument', document: { _id: 'doc-1', name: 'existing' } } },
    ],
  });
  assert.deepEqual(sendBody.attachments, [
    { _: 'messageMediaDocument', document: { _id: 'doc-1', name: 'existing' } },
  ]);
});

test('replyLetter carries attachments through', async () => {
  const { buildContext, replyLetter } = await import('@mohsp-99/mizito-core');
  let sendBody;
  mockWorkspace({ onSend: (b) => { sendBody = b; } });
  const ctx = await buildContext(staticToken('t'));
  const res = await replyLetter(ctx, {
    thread: 'th-1',
    content: 'ok',
    files: [{ data: new Uint8Array([1]), filename: 'r.pdf' }],
  });
  assert.equal(sendBody.thread, 'th-1');
  assert.equal(sendBody.attachments[0].document._id, 'up-1');
  assert.equal(res.attachments, 1);
});

test('sendLetter throws rather than reporting a refused send as sent', async () => {
  // The bug class that hid the comment failure: inbox/send can answer outside
  // the {status,data} envelope, and `sent: true` was hardcoded regardless.
  const { buildContext, sendLetter } = await import('@mohsp-99/mizito-core');
  globalThis.fetch = (() => {
    const inner = mockWorkspace({});
    const prev = globalThis.fetch;
    return async (url, init) => {
      if (String(url).endsWith('/inbox/send')) {
        return { status: 200, ok: true, text: async () => 'false' };
      }
      return prev(url, init);
    };
  })();
  const ctx = await buildContext(staticToken('t'));
  await assert.rejects(
    () => sendLetter(ctx, { to: 'Ali', subject: 'S', content: 'C' }),
    /refused by Mizito/,
  );
});

test('uploadFile returns the created media wrapper scoped to the workspace', async () => {
  mockWorkspace();
  const { buildContext } = await import('@mohsp-99/mizito-core');
  const ctx = await buildContext(staticToken('t'));
  const { workspace, document } = await uploadFile(ctx, { data: new Uint8Array([9]), filename: 'z.bin' });
  assert.equal(workspace, 'WS');
  // `document` is the messageMediaDocument wrapper; the document is one deeper.
  assert.equal(document._, 'messageMediaDocument');
  assert.equal(document.document._id, 'up-1');
});
