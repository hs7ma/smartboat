const OpenAI = require('openai');

class OpenAIService {
    constructor() {
        this.client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
        this.model = process.env.OPENAI_MODEL || 'gpt-4o';
        this.lastAnalysisTime = 0;
        this.minInterval = 8000;
    }

    async analyzeWaterImage(base64Image) {
        const now = Date.now();
        if (now - this.lastAnalysisTime < this.minInterval) {
            console.log('[OpenAI] Skipping - rate limit');
            return {
                water_quality: 'skipped',
                pollution_level: 0,
                water_color: '--',
                turbidity_visual: '--',
                objects_detected: [],
                contaminants: [],
                risk_level: 'none',
                description: 'Analysis skipped - rate limited, awaiting next cycle',
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
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:image/jpeg;base64,${base64Image}`,
                                    detail: 'auto'
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 1000,
                temperature: 0.3
            });

            const content = response.choices[0].message.content.trim();
            console.log('[OpenAI] Raw response length:', content.length);

            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.error('[OpenAI] No JSON found in response:', content.substring(0, 200));
                throw new Error('No JSON found in AI response');
            }

            let analysis;
            try {
                analysis = JSON.parse(jsonMatch[0]);
            } catch (parseErr) {
                console.error('[OpenAI] JSON parse error:', parseErr.message);
                console.error('[OpenAI] JSON string:', jsonMatch[0].substring(0, 200));
                throw new Error('Failed to parse AI response as JSON');
            }

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
            console.error('[OpenAI] Error:', err.message);
            throw err;
        }
    }
}

module.exports = OpenAIService;