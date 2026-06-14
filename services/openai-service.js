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

IMPORTANT: Respond ONLY with valid JSON in this exact format, no other text:
{
    "water_quality": "clean|slightly_polluted|polluted|heavily_polluted|dangerous",
    "pollution_level": <number 0-100>,
    "water_color": "<observed water color>",
    "turbidity_visual": "clear|slightly_turbid|turbid|very_turbid|opaque",
    "objects_detected": [<list of any foreign objects, debris, dead animals, waste, etc.>],
    "contaminants": [<list of visible contaminant types>],
    "risk_level": "none|low|medium|high|critical",
    "description": "<detailed Arabic description of water conditions>",
    "recommendation": "<brief Arabic recommendation>"
}

Focus on:
1. Water color and clarity
2. Visible pollution, debris, foreign objects
3. Any dead animals or suspicious objects
4. Signs of chemical contamination (unusual colors, foam, etc.)
5. Overall water quality assessment`;

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
                                    detail: 'low'
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 500,
                temperature: 0.3
            });

            const content = response.choices[0].message.content.trim();

            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in AI response');
            }

            const analysis = JSON.parse(jsonMatch[0]);

            return {
                water_quality: analysis.water_quality || 'unknown',
                pollution_level: analysis.pollution_level || 0,
                water_color: analysis.water_color || 'unknown',
                turbidity_visual: analysis.turbidity_visual || 'unknown',
                objects_detected: analysis.objects_detected || [],
                contaminants: analysis.contaminants || [],
                risk_level: analysis.risk_level || 'unknown',
                description: analysis.description || '',
                recommendation: analysis.recommendation || ''
            };

        } catch (err) {
            console.error('[OpenAI] Error:', err.message);
            if (err.message.includes('JSON')) {
                throw new Error('AI response parsing failed');
            }
            throw new Error(`OpenAI API error: ${err.message}`);
        }
    }
}

module.exports = OpenAIService;