const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const BUCKET = 'boat-images';

function cleanEnv(value) {
    if (value == null) return '';
    let v = String(value).trim();
    if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
    ) {
        v = v.slice(1, -1).trim();
    }
    return v;
}

class ImageStore {
    constructor() {
        this.client = null;
        this.enabled = false;

        const url = cleanEnv(process.env.SUPABASE_URL);
        const key = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

        if (!url || !key) {
            const missing = [
                !url ? 'SUPABASE_URL' : null,
                !key ? 'SUPABASE_SERVICE_ROLE_KEY' : null
            ].filter(Boolean).join(', ');
            console.warn(`[ImageStore] Supabase not configured — missing ${missing}`);
            return;
        }

        this.client = createClient(url, key, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
        this.enabled = true;
        console.log('[ImageStore] Ready (bucket:', BUCKET + ')');
    }

    isEnabled() {
        return this.enabled;
    }

    async save(base64Image, analysis = {}, gps = null) {
        if (!this.enabled || !this.client) {
            return null;
        }

        if (!base64Image || typeof base64Image !== 'string') {
            throw new Error('Missing image data');
        }

        const raw = base64Image.includes(',')
            ? base64Image.split(',').pop()
            : base64Image;
        const buffer = Buffer.from(raw, 'base64');
        if (!buffer.length) {
            throw new Error('Empty image buffer');
        }

        const id = crypto.randomUUID();
        const now = new Date();
        const yyyy = now.getUTCFullYear();
        const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(now.getUTCDate()).padStart(2, '0');
        const storagePath = `${yyyy}/${mm}/${dd}/${id}.jpg`;

        const { error: uploadError } = await this.client.storage
            .from(BUCKET)
            .upload(storagePath, buffer, {
                contentType: 'image/jpeg',
                upsert: false
            });

        if (uploadError) {
            throw new Error(`Storage upload failed: ${uploadError.message}`);
        }

        const { data: publicData } = this.client.storage
            .from(BUCKET)
            .getPublicUrl(storagePath);

        const publicUrl = publicData?.publicUrl || '';
        const gpsLat = gps && Number.isFinite(Number(gps.lat)) ? Number(gps.lat) : null;
        const gpsLng = gps && Number.isFinite(Number(gps.lng)) ? Number(gps.lng) : null;

        const row = {
            id,
            storage_path: storagePath,
            public_url: publicUrl,
            water_quality: analysis.water_quality || null,
            pollution_level: typeof analysis.pollution_level === 'number'
                ? analysis.pollution_level
                : null,
            risk_level: analysis.risk_level || null,
            description: analysis.description || null,
            gps_lat: gpsLat,
            gps_lng: gpsLng,
            analyzed_at: now.toISOString()
        };

        const { data, error: insertError } = await this.client
            .from('captured_images')
            .insert(row)
            .select('*')
            .single();

        if (insertError) {
            throw new Error(`Metadata insert failed: ${insertError.message}`);
        }

        console.log('[ImageStore] Saved', storagePath);
        return data;
    }

    async list(limit = 30) {
        if (!this.enabled || !this.client) {
            return [];
        }

        const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
        const { data, error } = await this.client
            .from('captured_images')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(safeLimit);

        if (error) {
            throw new Error(`List failed: ${error.message}`);
        }
        return data || [];
    }

    async getById(id) {
        if (!this.enabled || !this.client) {
            return null;
        }

        const { data, error } = await this.client
            .from('captured_images')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) {
            throw new Error(`Get failed: ${error.message}`);
        }
        return data;
    }
}

module.exports = ImageStore;
