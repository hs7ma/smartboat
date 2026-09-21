// OpenAI library is loaded lazily only when needed (not at startup)
// This prevents crashes when OPENAI_API_KEY env var is missing

class OpenAIService {
    constructor() {
        this.apiKey = (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '').trim();
        this.enabled = !!this.apiKey;
        this.client = null;
        this.isGeminiDirect = false;
        this.isOpenRouter = false;

        if (!this.enabled) {
            console.warn('[AI Service] No API key found — set GEMINI_API_KEY in Railway Variables');
            this.model = 'none';
        } else {
            this.isGeminiDirect = this.apiKey.startsWith('AIzaSy') || this.apiKey.startsWith('AQ.') || (!this.apiKey.startsWith('sk-') && this.apiKey.length > 10);
            this.isOpenRouter = this.apiKey.startsWith('sk-or-v1-') || !!process.env.OPENAI_BASE_URL;

            if (this.isGeminiDirect) {
                this.model = process.env.GEMINI_MODEL || process.env.OPENAI_MODEL || 'gemini-3.5-flash-lite';
                console.log(`[AI Service] Using Google Gemini Direct (${this.model}) — Free Tier`);
            } else {
                this.model = process.env.OPENAI_MODEL || (this.isOpenRouter ? 'google/gemini-flash-1.5-8b' : 'gpt-4o');
                console.log(`[AI Service] Using ${this.isOpenRouter ? 'OpenRouter' : 'OpenAI'} (${this.model})`);
            }
        }

        this.lastAnalysisTime = 0;
        this.minInterval = 8000;
    }

    _getOpenAIClient() {
        if (!this.client) {
            const OpenAI = require('openai');
            const options = { apiKey: this.apiKey };
            if (this.isOpenRouter) {
                options.baseURL = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';
                options.defaultHeaders = {
                    'HTTP-Referer': 'https://smartboat-production.up.railway.app',
                    'X-Title': 'Tigris Eye Water Quality Monitor'
                };
            }
            this.client = new OpenAI(options);
        }
        return this.client;
    }

    async analyzeWaterImage(base64Image) {
        if (!this.enabled) {
            return {
                water_quality: 'skipped', pollution_level: 0,
                water_color: '--', turbidity_visual: '--',
                objects_detected: [], contaminants: [],
                risk_level: 'none',
                description: 'AI not configured — add GEMINI_API_KEY in Railway',
                recommendation: ''
            };
        }

        const now = Date.now();
        if (now - this.lastAnalysisTime < this.minInterval) {
            return {
                water_quality: 'skipped', pollution_level: 0,
                water_color: '--', turbidity_visual: '--',
                objects_detected: [], contaminants: [],
                risk_level: 'none',
                description: 'Rate limited — waiting for next cycle',
                recommendation: ''
            };
        }
        this.lastAnalysisTime = now;

        const prompt = `You are an expert water quality analyst. Analyze this river/water image and provide a detailed assessment.

IMPORTANT: Respond ONLY with valid JSON in this exact format, no other text, no markdown:
{
    "water_quality": "clean|slightly_polluted|polluted|heavily_polluted|dangerous",
    "pollution_level": <number 0-100>,
    "water_color": "<observed water color in English>",
    "turbidity_visual": "clear|slightly_turbid|turbid|very_turbid|opaque",
    "objects_detected": [<list of any foreign objects, debris, dead animals, waste>],
    "contaminants": [<list of visible contaminant types>],
    "risk_level": "none|low|medium|high|critical",
    "description": "<detailed description of water conditions in English>",
    "recommendation": "<brief recommendation in English>"
}

Focus on:
1. Water color and clarity
2. Visible pollution, debris, foreign objects
3. Any dead animals or suspicious objects
4. Signs of chemical contamination (unusual colors, foam, etc.)
5. Overall water quality assessment

All text fields MUST be in English only.`;

        try {
            let content = '';

            if (this.isGeminiDirect) {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: prompt },
                                { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
                            ]
                        }],
                        generationConfig: { temperature: 0.3, maxOutputTokens: 1000 }
                    })
                });

                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`Gemini API error (${res.status}): ${errText}`);
                }

                const data = await res.json();
                content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            } else {
                const client = this._getOpenAIClient();
                const response = await client.chat.completions.create({
                    model: this.model,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'auto' } }
                        ]
                    }],
                    max_tokens: 1000,
                    temperature: 0.3
                });
                content = response.choices[0].message.content.trim();
            }

            console.log('[AI Service] Raw response length:', content.length);

            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.error('[AI Service] No JSON in response:', content.substring(0, 200));
                throw new Error('No JSON found in AI response');
            }

            const analysis = JSON.parse(jsonMatch[0]);

            return {
                water_quality: analysis.water_quality || 'unknown',
                pollution_level: typeof analysis.pollution_level === 'number' ? analysis.pollution_level : 0,
                water_color: analysis.water_color || 'unknown',
                turbidity_visual: analysis.turbidity_visual || 'unknown',
                objects_detected: Array.isArray(analysis.objects_detected) ? analysis.objects_detected : [],
                contaminants: Array.isArray(analysis.contaminants) ? analysis.contaminants : [],
                risk_level: analysis.risk_level || 'unknown',
                description: analysis.description || '',
                recommendation: analysis.recommendation || ''
            };

        } catch (err) {
            console.error('[AI Service] Error:', err.message);
            throw err;
        }
    }
}

module.exports = OpenAIService;