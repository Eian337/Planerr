// 구글 드라이브 — 음악 파일을 '학업 플래너 음악' 폴더에 올리고 다른 기기에서 받습니다.
// 권한(drive.file)은 이 앱이 만든 파일·폴더만 다룰 수 있어서, 드라이브의 다른 파일에는 손대지 않습니다.

const D = 'https://www.googleapis.com/drive/v3';
const U = 'https://www.googleapis.com/upload/drive/v3';

export async function ensureFolder(g, folderId, name) {
  if (folderId) {
    try {
      const r = await g.json('GET', `${D}/files/${encodeURIComponent(folderId)}?fields=id,trashed`);
      if (r && !r.trashed) return folderId;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  const r = await g.json('POST', `${D}/files?fields=id`, { name, mimeType: 'application/vnd.google-apps.folder', appProperties: { planner: '1' } });
  return r.id;
}

// 이어 올리기(resumable) 방식: 파일 크기와 상관없이 한 가지 방법으로 올림
export async function uploadFile(g, folderId, blob, name, type) {
  const mime = type || blob.type || 'audio/mpeg';
  const init = await g.raw(`${U}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime },
    body: JSON.stringify({ name, parents: folderId ? [folderId] : undefined, appProperties: { planner: '1' } }),
  });
  const loc = init.headers.get('Location');
  if (!loc) throw Object.assign(new Error('드라이브 업로드 주소를 받지 못했습니다.'), { code: 'upload' });
  const res = await g.raw(loc, { method: 'PUT', headers: { 'Content-Type': mime }, body: blob });
  const j = await res.json();
  if (!j.id) throw Object.assign(new Error('드라이브 업로드에 실패했습니다.'), { code: 'upload' });
  return j.id;
}

export async function downloadFile(g, id) {
  const res = await g.raw(`${D}/files/${encodeURIComponent(id)}?alt=media`);
  return res.blob();
}

export async function deleteFile(g, id) {
  try {
    await g.raw(`${D}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch (e) {
    if (e.status !== 404 && e.status !== 403) throw e; // 이미 지웠거나 이 앱 파일이 아니면 무시
  }
}
