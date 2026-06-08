// src/discord.js
export async function postGraphic(webhookUrl, { filename, imageBuffer, content }, { fetchImpl = fetch } = {}) {
  const form = new FormData();
  if (content) form.append('content', content);
  form.append('files[0]', new Blob([imageBuffer], { type: 'image/png' }), filename);

  const res = await fetchImpl(webhookUrl, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${res.status} ${body}`);
  }
  return res;
}
