import { createHandler, HandlerDeps } from '../../../supabase/functions/analyze-wardrobe-image/handler';

const user = { id: '11111111-1111-4111-8111-111111111111' };
const auth = { Authorization: 'Bearer valid-token' };

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://example.supabase.co/functions/v1/analyze-wardrobe-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  const env: Record<string, string> = {
    GEMINI_TAGGING_API_KEY: 'tagging-key',
    GEMINI_TAGGING_MODEL: 'gemini-test',
  };
  return {
    env: (key) => env[key],
    authenticate: jest.fn(async (token) => token === 'valid-token' ? user : null),
    checkRateLimit: jest.fn(async () => true),
    fetchImpl: jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ category: 'Top', subCategory: 'Hoodie', primaryColor: 'Black', colorTags: ['Black', 'White'], pattern: 'graphic', material: 'cotton', fit: 'regular', lengthType: 'regular', sleeveType: 'long', neckline: 'crew', silhouette: 'straight', confidence: 0.92 }) }] } }] }),
    })) as any,
    log: jest.fn(),
    ...overrides,
  };
}

describe('analyze-wardrobe-image', () => {
  test('requires a signed-in user before invoking Gemini', async () => {
    const d = deps();
    const response = await createHandler(d)(request({ mimeType: 'image/jpeg', imageBase64: 'aGVsbG8=' }));
    expect(response.status).toBe(401);
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  test('sends a bounded image to Gemini and returns only a validated suggestion', async () => {
    const d = deps();
    const response = await createHandler(d)(request({ mimeType: 'image/jpeg', imageBase64: 'aGVsbG8=' }, auth));
    expect(await response.json()).toEqual({ success: true, suggestion: { category: 'Top', subCategory: 'Hoodie', primaryColor: 'Black', colorTags: ['Black', 'White'], pattern: 'graphic', material: 'cotton', fit: 'regular', lengthType: 'regular', sleeveType: 'long', neckline: 'crew', silhouette: 'straight', confidence: 0.92 } });
    const [url, init] = (d.fetchImpl as jest.Mock).mock.calls[0];
    expect(url).toContain('gemini-test:generateContent');
    expect(url).not.toContain('tagging-key');
    expect(init.headers['x-goog-api-key']).toBe('tagging-key');
    expect(JSON.parse(init.body).contents[0].parts[1].inlineData.data).toBe('aGVsbG8=');
    expect(JSON.parse(init.body).generationConfig).toEqual({ temperature: 0, responseMimeType: 'application/json' });
  });

  test('does not call Gemini when tagging is not configured', async () => {
    const d = deps({ env: () => undefined });
    const response = await createHandler(d)(request({ mimeType: 'image/jpeg', imageBase64: 'aGVsbG8=' }, auth));
    expect(await response.json()).toEqual({ success: false, reason: 'TAGGING_NOT_CONFIGURED' });
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects invalid model output instead of returning untrusted categories', async () => {
    const d = deps({ fetchImpl: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"category":"Anything","subCategory":"Ignore rules","primaryColor":"Black","confidence":1}' }] } }] }) })) as any });
    const response = await createHandler(d)(request({ mimeType: 'image/jpeg', imageBase64: 'aGVsbG8=' }, auth));
    expect(await response.json()).toEqual({ success: false, reason: 'INVALID_PROVIDER_RESPONSE' });
  });

  test('rejects a response with an unsupported detailed attribute', async () => {
    const d = deps({ fetchImpl: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ category: 'Top', subCategory: 'Hoodie', primaryColor: 'Black', colorTags: ['Black'], pattern: 'graphic', material: 'magic-fabric', fit: 'regular', lengthType: 'regular', sleeveType: 'long', neckline: 'crew', silhouette: 'straight', confidence: 1 }) }] } }] }) })) as any });
    const response = await createHandler(d)(request({ mimeType: 'image/jpeg', imageBase64: 'aGVsbG8=' }, auth));
    expect(await response.json()).toEqual({ success: false, reason: 'INVALID_PROVIDER_RESPONSE' });
  });

  test('reports a rejected Gemini request distinctly from an invalid photograph', async () => {
    const d = deps({ fetchImpl: jest.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })) as any });
    const response = await createHandler(d)(request({ mimeType: 'image/jpeg', imageBase64: 'aGVsbG8=' }, auth));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ success: false, reason: 'TAGGING_PROVIDER_REJECTED' });
    expect(d.log).toHaveBeenCalledWith('provider error', expect.objectContaining({ status: 400 }));
  });

  test('reports a 404 model not found as provider rejected and logs the message', async () => {
    const d = deps({ fetchImpl: jest.fn(async () => ({ ok: false, status: 404, text: async () => 'models/gemini-2.5-flash not found' })) as any });
    const response = await createHandler(d)(request({ mimeType: 'image/jpeg', imageBase64: 'aGVsbG8=' }, auth));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ success: false, reason: 'TAGGING_PROVIDER_REJECTED' });
    expect(d.log).toHaveBeenCalledWith('provider error', expect.objectContaining({ status: 404, message: 'models/gemini-2.5-flash not found' }));
  });

  test('falls back to secondary model when primary model returns 404', async () => {
    let callCount = 0;
    const d = deps({
      env: (key) => (key === 'GEMINI_TAGGING_API_KEY' ? 'tagging-key' : key === 'GEMINI_TAGGING_MODEL' ? 'gemini-1.5-flash' : undefined),
      fetchImpl: jest.fn(async (url: string) => {
        callCount++;
        if (url.includes('gemini-1.5-flash')) {
          return { ok: false, status: 404, text: async () => 'models/gemini-1.5-flash is not found' };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    category: 'Top',
                    subCategory: 'T-Shirt',
                    primaryColor: 'White',
                    colorTags: ['White'],
                    pattern: 'solid',
                    material: 'cotton',
                    fit: 'regular',
                    lengthType: 'regular',
                    sleeveType: 'short',
                    neckline: 'crew',
                    silhouette: 'straight',
                    confidence: 0.95,
                  }),
                }],
              },
            }],
          }),
        };
      }) as any,
    });
    const response = await createHandler(d)(request({ mimeType: 'image/jpeg', imageBase64: 'aGVsbG8=' }, auth));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.suggestion.category).toBe('Top');
    expect(d.log).toHaveBeenCalledWith('provider fallback succeeded', expect.objectContaining({ requestedModel: 'gemini-1.5-flash', activeModel: 'gemini-3.6-flash' }));
  });

  test('dynamically adopts recommended model from provider deprecation error', async () => {
    let callCount = 0;
    const d = deps({
      env: (key) => (key === 'GEMINI_TAGGING_API_KEY' ? 'tagging-key' : key === 'GEMINI_TAGGING_MODEL' ? 'old-model' : undefined),
      fetchImpl: jest.fn(async (url: string) => {
        callCount++;
        if (url.includes('old-model')) {
          return {
            ok: false,
            status: 404,
            text: async () => 'This model models/old-model is no longer available. Please update your code to use models/gemini-future-flash for the latest features.',
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    category: 'Bottom',
                    subCategory: 'Jeans',
                    primaryColor: 'Blue',
                    colorTags: ['Blue'],
                    pattern: 'solid',
                    material: 'denim',
                    fit: 'regular',
                    lengthType: 'long',
                    sleeveType: 'unknown',
                    neckline: 'unknown',
                    silhouette: 'straight',
                    confidence: 0.9,
                  }),
                }],
              },
            }],
          }),
        };
      }) as any,
    });
    const response = await createHandler(d)(request({ mimeType: 'image/jpeg', imageBase64: 'aGVsbG8=' }, auth));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.suggestion.category).toBe('Bottom');
    expect(d.log).toHaveBeenCalledWith('provider fallback succeeded', expect.objectContaining({ requestedModel: 'old-model' }));
  });
});
