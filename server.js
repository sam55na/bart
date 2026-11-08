const express = require('express');
const { Pool } = require('pg');
const app = express();
const port = process.env.PORT || 5000;

// ================================================================
//                      إعدادات CORS
// ================================================================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.json());

// ================================================================
//                      الإعدادات الأساسية
// ================================================================
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('❌ FATAL: DATABASE_URL is not set!');
    process.exit(1);
}

console.log('📊 DATABASE_URL:', DATABASE_URL.replace(/:[^:]*@/, ':****@'));

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

const ADMIN_ID = 7011476249;
let dbReady = false;

// ================================================================
//                      ثوابت استثناء الجوائز من الإيداعات
// ================================================================
// ✅ هذه الأنواع لا تُحسب كإيداعات في شرط الإيداع
const PRIZE_METHOD_TYPES = ['card_game', 'wheel_spin'];
const PRIZE_METHOD_PATTERNS = ['%لعبة البطاقات%', '%عجلة الحظ%'];

// ================================================================
//                      إنشاء الجداول
// ================================================================
const TABLE_SCHEMAS = {
    card_prizes: `
        CREATE TABLE IF NOT EXISTS card_prizes (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            amount DECIMAL(20,2) NOT NULL DEFAULT 0,
            icon VARCHAR(50),
            image_url TEXT,
            probability DECIMAL(5,2) NOT NULL DEFAULT 0,
            color VARCHAR(50) DEFAULT '#1a1a2e',
            color2 VARCHAR(50) DEFAULT '#16213e',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    card_games: `
        CREATE TABLE IF NOT EXISTS card_games (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            status VARCHAR(20) DEFAULT 'lost',
            prize_id INTEGER REFERENCES card_prizes(id) ON DELETE SET NULL,
            prize_name VARCHAR(255),
            prize_amount DECIMAL(20,2) DEFAULT 0,
            cards_flipped INTEGER DEFAULT 0,
            matched BOOLEAN DEFAULT FALSE,
            game_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_claimed BOOLEAN DEFAULT FALSE,
            is_rewarded BOOLEAN DEFAULT FALSE,
            claimed_date TIMESTAMP,
            rewarded_date TIMESTAMP
        )
    `,
    card_settings: `
        CREATE TABLE IF NOT EXISTS card_settings (
            id SERIAL PRIMARY KEY,
            setting_key VARCHAR(100) UNIQUE NOT NULL,
            setting_value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    payments_log: `
        CREATE TABLE IF NOT EXISTS payments_log (
            id SERIAL PRIMARY KEY,
            payment_id VARCHAR(100) UNIQUE,
            user_id VARCHAR(50) NOT NULL,
            user_username VARCHAR(100),
            user_full_name VARCHAR(200),
            amount DECIMAL(20,2) NOT NULL DEFAULT 0,
            method VARCHAR(50) NOT NULL,
            method_type VARCHAR(20) DEFAULT 'auto',
            transaction_id VARCHAR(100),
            bonus_amount DECIMAL(20,2) DEFAULT 0,
            bonus_percent DECIMAL(5,2) DEFAULT 0,
            final_amount DECIMAL(20,2) NOT NULL DEFAULT 0,
            old_balance DECIMAL(20,2) DEFAULT 0,
            new_balance DECIMAL(20,2) DEFAULT 0,
            exchange_rate DECIMAL(10,4) DEFAULT 1.0,
            commission_amount DECIMAL(20,2) DEFAULT 0,
            referrer_id VARCHAR(50),
            ichancy_username VARCHAR(100),
            ichancy_player_id VARCHAR(50),
            status VARCHAR(20) DEFAULT 'completed',
            payment_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            log_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    payments_stats: `
        CREATE TABLE IF NOT EXISTS payments_stats (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(50) UNIQUE,
            total_payments INTEGER DEFAULT 0,
            total_amount DECIMAL(20,2) DEFAULT 0,
            last_payment_time TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    card_banner: `
        CREATE TABLE IF NOT EXISTS card_banner (
            id SERIAL PRIMARY KEY,
            text TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `
};

// ================================================================
//                      الفهارس
// ================================================================
const INDEX_SCHEMAS = [
    `CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments_log(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_payment_time ON payments_log(payment_time)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_status ON payments_log(status)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_method_type ON payments_log(method_type)`,
    `CREATE INDEX IF NOT EXISTS idx_card_games_status ON card_games(status)`,
    `CREATE INDEX IF NOT EXISTS idx_card_games_is_rewarded ON card_games(is_rewarded)`,
    `CREATE INDEX IF NOT EXISTS idx_card_games_user_id ON card_games(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_card_games_game_date ON card_games(game_date)`
];

const DEFAULT_PRIZES = [
    { name: '💎 جائزة 1000 SYP', description: 'فوز بـ 1000 ليرة سورية', amount: 1000, icon: '💎', probability: 10, color: '#1a1a2e', color2: '#16213e' },
    { name: '🎁 جائزة 500 SYP',  description: 'فوز بـ 500 ليرة سورية',  amount: 500,  icon: '🎁', probability: 20, color: '#2d1b3d', color2: '#1a0a0a' },
    { name: '⭐ جائزة 200 SYP',  description: 'فوز بـ 200 ليرة سورية',  amount: 200,  icon: '⭐', probability: 30, color: '#0f3460', color2: '#1a1a2e' },
    { name: '🎫 جائزة 100 SYP',  description: 'فوز بـ 100 ليرة سورية',  amount: 100,  icon: '🎫', probability: 40, color: '#1a2a1a', color2: '#0f1a0f' }
];

const DEFAULT_SETTINGS = [
    { key: 'spin_interval_hours', value: '24' },
    { key: 'is_active', value: 'true' },
    { key: 'deposit_required', value: 'false' },
    { key: 'deposit_min_amount', value: '1000' },
    { key: 'deposit_check_hours', value: '24' },
    { key: 'back_image_url', value: '' },
    { key: 'bg_image_url', value: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1920&q=80' },
    { key: 'loading_image_url', value: 'https://via.placeholder.com/200/1a1a2e/FFD700?text=🎴' },
    { key: 'max_flips', value: '5' },
    { key: 'flip_duration', value: '600' },
    { key: 'game_title', value: 'JAK BOT BARTON' }
];

// ================================================================
//                      تحديث هيكل الجداول
// ================================================================
async function updateTableSchema() {
    const client = await pool.connect();
    try {
        console.log('📋 التحقق من هيكل الجداول...');

        // ---- card_prizes ----
        const prizeCols = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'card_prizes' 
            AND column_name IN ('image_url', 'amount', 'color', 'color2')
        `);
        const existingPrize = prizeCols.rows.map(r => r.column_name);

        if (!existingPrize.includes('image_url')) {
            await client.query(`ALTER TABLE card_prizes ADD COLUMN image_url TEXT`);
            console.log('✅ إضافة card_prizes.image_url');
        }
        if (!existingPrize.includes('amount')) {
            await client.query(`ALTER TABLE card_prizes ADD COLUMN amount DECIMAL(20,2) DEFAULT 0`);
            console.log('✅ إضافة card_prizes.amount');
        }
        if (!existingPrize.includes('color')) {
            await client.query(`ALTER TABLE card_prizes ADD COLUMN color VARCHAR(50) DEFAULT '#1a1a2e'`);
            console.log('✅ إضافة card_prizes.color');
        }
        if (!existingPrize.includes('color2')) {
            await client.query(`ALTER TABLE card_prizes ADD COLUMN color2 VARCHAR(50) DEFAULT '#16213e'`);
            console.log('✅ إضافة card_prizes.color2');
        }

        // ---- card_games ----
        const gameCols = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'card_games' 
            AND column_name IN ('is_rewarded', 'rewarded_date', 'is_claimed', 'claimed_date', 'matched', 'cards_flipped')
        `);
        const existingGame = gameCols.rows.map(r => r.column_name);

        if (!existingGame.includes('is_rewarded')) {
            await client.query(`ALTER TABLE card_games ADD COLUMN is_rewarded BOOLEAN DEFAULT FALSE`);
            console.log('✅ إضافة card_games.is_rewarded');
        }
        if (!existingGame.includes('rewarded_date')) {
            await client.query(`ALTER TABLE card_games ADD COLUMN rewarded_date TIMESTAMP`);
            console.log('✅ إضافة card_games.rewarded_date');
        }
        if (!existingGame.includes('is_claimed')) {
            await client.query(`ALTER TABLE card_games ADD COLUMN is_claimed BOOLEAN DEFAULT FALSE`);
            console.log('✅ إضافة card_games.is_claimed');
        }
        if (!existingGame.includes('claimed_date')) {
            await client.query(`ALTER TABLE card_games ADD COLUMN claimed_date TIMESTAMP`);
            console.log('✅ إضافة card_games.claimed_date');
        }
        if (!existingGame.includes('matched')) {
            await client.query(`ALTER TABLE card_games ADD COLUMN matched BOOLEAN DEFAULT FALSE`);
            console.log('✅ إضافة card_games.matched');
        }
        if (!existingGame.includes('cards_flipped')) {
            await client.query(`ALTER TABLE card_games ADD COLUMN cards_flipped INTEGER DEFAULT 0`);
            console.log('✅ إضافة card_games.cards_flipped');
        }

        // ---- payments_log ----
        const paymentCols = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'payments_log' 
            AND column_name IN (
                'payment_id', 'method_type', 'transaction_id', 'bonus_amount', 'bonus_percent',
                'old_balance', 'new_balance', 'exchange_rate', 'commission_amount',
                'referrer_id', 'ichancy_username', 'ichancy_player_id',
                'payment_time', 'log_time', 'created_at'
            )
        `);
        const existingPayment = paymentCols.rows.map(r => r.column_name);

        const paymentAlters = [
            { col: 'payment_id', sql: `ALTER TABLE payments_log ADD COLUMN payment_id VARCHAR(100)` },
            { col: 'method_type', sql: `ALTER TABLE payments_log ADD COLUMN method_type VARCHAR(20) DEFAULT 'auto'` },
            { col: 'transaction_id', sql: `ALTER TABLE payments_log ADD COLUMN transaction_id VARCHAR(100)` },
            { col: 'bonus_amount', sql: `ALTER TABLE payments_log ADD COLUMN bonus_amount DECIMAL(20,2) DEFAULT 0` },
            { col: 'bonus_percent', sql: `ALTER TABLE payments_log ADD COLUMN bonus_percent DECIMAL(5,2) DEFAULT 0` },
            { col: 'old_balance', sql: `ALTER TABLE payments_log ADD COLUMN old_balance DECIMAL(20,2) DEFAULT 0` },
            { col: 'new_balance', sql: `ALTER TABLE payments_log ADD COLUMN new_balance DECIMAL(20,2) DEFAULT 0` },
            { col: 'exchange_rate', sql: `ALTER TABLE payments_log ADD COLUMN exchange_rate DECIMAL(10,4) DEFAULT 1.0` },
            { col: 'commission_amount', sql: `ALTER TABLE payments_log ADD COLUMN commission_amount DECIMAL(20,2) DEFAULT 0` },
            { col: 'referrer_id', sql: `ALTER TABLE payments_log ADD COLUMN referrer_id VARCHAR(50)` },
            { col: 'ichancy_username', sql: `ALTER TABLE payments_log ADD COLUMN ichancy_username VARCHAR(100)` },
            { col: 'ichancy_player_id', sql: `ALTER TABLE payments_log ADD COLUMN ichancy_player_id VARCHAR(50)` },
            { col: 'payment_time', sql: `ALTER TABLE payments_log ADD COLUMN payment_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP` },
            { col: 'log_time', sql: `ALTER TABLE payments_log ADD COLUMN log_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP` },
            { col: 'created_at', sql: `ALTER TABLE payments_log ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP` }
        ];

        for (const alter of paymentAlters) {
            if (!existingPayment.includes(alter.col)) {
                await client.query(alter.sql);
                console.log(`✅ إضافة payments_log.${alter.col}`);
            }
        }

        // ✅ إصلاح payment_time للصفوف القديمة
        try {
            const fixResult = await client.query(`
                UPDATE payments_log 
                SET payment_time = COALESCE(created_at, log_time, NOW())
                WHERE payment_time IS NULL
            `);
            if (fixResult.rowCount > 0) {
                console.log(`✅ تحديث payment_time لـ ${fixResult.rowCount} صف`);
            }
        } catch (e) {
            console.warn(`⚠️ فشل تحديث payment_time: ${e.message}`);
        }

        // ---- فهارس ----
        for (const idxSql of INDEX_SCHEMAS) {
            try {
                await client.query(idxSql);
            } catch (e) {
                console.warn(`⚠️ فشل إنشاء فهرس: ${e.message}`);
            }
        }
        console.log('✅ تم التحقق من الفهارس');

        return true;
    } catch (error) {
        console.error('❌ خطأ في التحديث:', error);
        return false;
    } finally {
        client.release();
    }
}

// ================================================================
//                      تهيئة قاعدة البيانات
// ================================================================
async function ensureTables() {
    console.log('\n📋 فحص قاعدة البيانات...');
    const client = await pool.connect();
    try {
        for (const table of Object.keys(TABLE_SCHEMAS)) {
            try {
                await client.query(TABLE_SCHEMAS[table]);
                console.log(`   ✅ ${table}`);
            } catch (err) {
                console.log(`   ❌ ${table}: ${err.message}`);
                return false;
            }
        }

        await updateTableSchema();

        const prizesCount = await client.query('SELECT COUNT(*) FROM card_prizes');
        if (parseInt(prizesCount.rows[0].count) === 0) {
            console.log('   ⚠️ إضافة جوائز افتراضية...');
            for (const p of DEFAULT_PRIZES) {
                await client.query(`
                    INSERT INTO card_prizes (name, description, amount, icon, probability, color, color2)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)
                `, [p.name, p.description, p.amount, p.icon, p.probability, p.color, p.color2]);
            }
            console.log(`   ✅ ${DEFAULT_PRIZES.length} جائزة`);
        }

        const settingsCount = await client.query('SELECT COUNT(*) FROM card_settings');
        if (parseInt(settingsCount.rows[0].count) === 0) {
            for (const s of DEFAULT_SETTINGS) {
                await client.query(`INSERT INTO card_settings (setting_key, setting_value) VALUES ($1,$2)`,
                    [s.key, s.value]);
            }
            console.log(`   ✅ ${DEFAULT_SETTINGS.length} إعداد`);
        }

        const bannerCount = await client.query('SELECT COUNT(*) FROM card_banner');
        if (parseInt(bannerCount.rows[0].count) === 0) {
            await client.query(`INSERT INTO card_banner (text) VALUES ($1)`, ['JAK BOT BARTON']);
        }

        console.log('\n✅ قاعدة البيانات جاهزة!');
        dbReady = true;
        return true;
    } catch (err) {
        console.error('❌ خطأ:', err);
        return false;
    } finally {
        client.release();
    }
}

// ================================================================
//                      دوال مساعدة
// ================================================================
function checkAdmin(req, res, next) {
    const adminId = req.body.admin_id || req.query.admin_id;
    if (parseInt(adminId) !== ADMIN_ID) {
        return res.status(403).json({ success: false, error: 'Unauthorized - Admin only' });
    }
    next();
}

async function getSetting(key, defaultValue) {
    const r = await pool.query('SELECT setting_value FROM card_settings WHERE setting_key = $1', [key]);
    return r.rows[0]?.setting_value ?? defaultValue;
}

// ================================================================
//   ✅ دالة مركزية: حساب إجمالي الإيداعات الحقيقية (بدون جوائز)
// ================================================================
async function getRealDeposits(userId, checkHours) {
    const result = await pool.query(`
        SELECT COALESCE(SUM(final_amount), 0) as total
        FROM payments_log
        WHERE user_id = $1 
          AND status = 'completed'
          AND method_type NOT IN ('card_game', 'wheel_spin')
          AND method NOT LIKE '%لعبة البطاقات%'
          AND method NOT LIKE '%عجلة الحظ%'
          AND payment_time >= NOW() - ($2::int * INTERVAL '1 hour')
    `, [userId, checkHours]);

    return parseFloat(result.rows[0]?.total || 0);
}

// ================================================================
//                      المسارات الأساسية
// ================================================================

app.get('/api/status', async (req, res) => {
    try {
        let paymentsTableReady = false;
        try {
            const check = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = 'payments_log'
                )
            `);
            paymentsTableReady = check.rows[0].exists;
        } catch (e) {}

        res.json({
            status: 'running',
            service: 'JAK BOT BARTON API',
            database: {
                ready: dbReady,
                payments_log_ready: paymentsTableReady
            },
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ status: 'error', error: e.message });
    }
});

app.get('/', (req, res) => {
    res.json({ status: 'running', service: 'JAK BOT BARTON API', message: '🚀 الخادم يعمل' });
});

// ================================================================
//                      Banner
// ================================================================
app.get('/api/banner', async (req, res) => {
    try {
        const r = await pool.query('SELECT text FROM card_banner ORDER BY id DESC LIMIT 1');
        res.json({ success: true, text: r.rows[0]?.text || 'JAK BOT BARTON' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      الجوائز العامة
// ================================================================
app.get('/api/prizes', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT id, name, description, amount, icon, image_url, probability, color, color2
            FROM card_prizes WHERE is_active = true ORDER BY id ASC
        `);
        res.json({ success: true, prizes: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      إعدادات الأدمن
// ================================================================
app.get('/api/admin/settings', checkAdmin, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM card_settings');
        const settings = {};
        r.rows.forEach(row => { settings[row.setting_key] = row.setting_value; });
        const b = await pool.query('SELECT text FROM card_banner ORDER BY id DESC LIMIT 1');
        settings.banner_text = b.rows[0]?.text || 'JAK BOT BARTON';
        res.json({ success: true, settings });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.put('/api/admin/setting', checkAdmin, async (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ success: false, error: 'Key required' });
    try {
        if (key === 'banner_text') {
            await pool.query(`INSERT INTO card_banner (text, updated_at) VALUES ($1, CURRENT_TIMESTAMP)`, [value]);
        } else {
            await pool.query(`
                INSERT INTO card_settings (setting_key, setting_value, updated_at)
                VALUES ($1, $2, CURRENT_TIMESTAMP)
                ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_at = CURRENT_TIMESTAMP
            `, [key, value]);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      إدارة الجوائز
// ================================================================
app.get('/api/admin/prizes', checkAdmin, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM card_prizes ORDER BY id ASC');
        res.json({ success: true, prizes: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/prizes', checkAdmin, async (req, res) => {
    const { name, description, amount, icon, image_url, probability, color, color2 } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Name required' });
    try {
        const r = await pool.query(`
            INSERT INTO card_prizes (name, description, amount, icon, image_url, probability, color, color2, is_active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *
        `, [
            name, description || '', parseFloat(amount) || 0, icon || '🎴',
            image_url || null, parseFloat(probability) || 0,
            color || '#1a1a2e', color2 || '#16213e'
        ]);
        res.json({ success: true, prize: r.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.put('/api/admin/prizes/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    const fields = req.body;
    const allowed = ['name', 'description', 'amount', 'icon', 'image_url', 'probability', 'color', 'color2', 'is_active'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
        if (fields[key] !== undefined && fields[key] !== null) {
            let val = fields[key];
            if (key === 'amount' || key === 'probability') val = parseFloat(val);
            if (key === 'is_active') val = val === true || val === 'true';
            updates.push(`${key} = $${idx++}`);
            values.push(val);
        }
    }
    if (updates.length === 0) return res.status(400).json({ success: false, error: 'No fields' });

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    try {
        const r = await pool.query(
            `UPDATE card_prizes SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
        );
        if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, prize: r.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/admin/prizes/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('UPDATE card_games SET prize_id = NULL WHERE prize_id = $1', [id]);
        const r = await pool.query('DELETE FROM card_prizes WHERE id = $1 RETURNING id', [id]);
        if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/seed-prizes', checkAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE card_games SET prize_id = NULL');
        await pool.query('DELETE FROM card_prizes');
        for (const p of DEFAULT_PRIZES) {
            await pool.query(`
                INSERT INTO card_prizes (name, description, amount, icon, probability, color, color2, is_active)
                VALUES ($1,$2,$3,$4,$5,$6,$7,true)
            `, [p.name, p.description, p.amount, p.icon, p.probability, p.color, p.color2]);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/admin/reset-games', checkAdmin, async (req, res) => {
    const { user_id } = req.body;
    try {
        let result;
        if (user_id) {
            result = await pool.query('DELETE FROM card_games WHERE user_id = $1 RETURNING id', [user_id]);
        } else {
            result = await pool.query('DELETE FROM card_games RETURNING id');
        }
        await pool.query('ALTER SEQUENCE card_games_id_seq RESTART WITH 1');
        res.json({ success: true, deleted_count: result.rowCount });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      🎴 بدء اللعبة
// ================================================================
app.post('/api/game/start', async (req, res) => {
    const { user_id } = req.body;

    if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
    if (!dbReady) return res.status(503).json({ success: false, error: 'Database not ready' });

    try {
        // 1. تفعيل اللعبة
        const isActive = await getSetting('is_active', 'true');
        if (isActive !== 'true') {
            return res.status(403).json({ success: false, error: 'اللعبة معطلة حالياً' });
        }

        // 2. شرط الإيداع — ✅ يستثني جوائز اللعب
        const depositRequired = await getSetting('deposit_required', 'false');
        if (depositRequired === 'true') {
            const minAmount = parseFloat(await getSetting('deposit_min_amount', '1000'));
            const checkHours = parseInt(await getSetting('deposit_check_hours', '24'));

            // ✅ التحقق من وجود الجدول
            const tableCheck = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = 'payments_log'
                )
            `);

            if (!tableCheck.rows[0].exists) {
                console.warn('⚠️ جدول payments_log غير موجود — سيُنشأ الآن');
                await pool.query(TABLE_SCHEMAS.payments_log);
            }

            // ✅ استخدام الدالة المركزية (تستثني الجوائز)
            const total = await getRealDeposits(user_id, checkHours);

            if (total < minAmount) {
                return res.status(403).json({
                    success: false,
                    error: `مطلوب إيداع ${minAmount} SYP خلال آخر ${checkHours} ساعة`,
                    deposit_required: true,
                    min_deposit: minAmount,
                    check_hours: checkHours,
                    current_deposits: total,
                    remaining: minAmount - total
                });
            }
        }

        // 3. فترة التبريد
        const intervalHours = parseInt(await getSetting('spin_interval_hours', '24'));
        const lastGame = await pool.query(`
            SELECT game_date FROM card_games WHERE user_id = $1
            ORDER BY game_date DESC LIMIT 1
        `, [user_id]);

        if (lastGame.rows.length > 0) {
            const lastDate = new Date(lastGame.rows[0].game_date);
            const hoursDiff = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60);
            if (hoursDiff < intervalHours) {
                const remainingHours = Math.ceil(intervalHours - hoursDiff);
                const remainingMinutes = Math.ceil((intervalHours - hoursDiff) * 60) % 60;
                return res.status(429).json({
                    success: false,
                    error: `يمكنك اللعب مرة أخرى بعد ${remainingHours} ساعة`,
                    remaining_hours: Math.floor(remainingHours),
                    remaining_minutes: remainingMinutes
                });
            }
        }

        // 4. جلب الجوائز النشطة
        const prizes = await pool.query('SELECT * FROM card_prizes WHERE is_active = true');
        if (prizes.rows.length === 0) {
            return res.status(500).json({ success: false, error: 'لا توجد جوائز متاحة' });
        }

        // 5. مجموع الاحتمالات
        const totalProb = prizes.rows.reduce((s, p) => s + parseFloat(p.probability || 0), 0);
        if (totalProb <= 0) {
            return res.status(500).json({ success: false, error: 'كل الجوائز معطلة (احتمال 0%)' });
        }

        // 6. الاختيار: رابح أم خاسر؟
        const loseChance = Math.max(0, 100 - totalProb);
        const roll = Math.random() * Math.max(100, totalProb);

        let winningPrize = null;
        let isLosingRound = false;

        if (roll < loseChance) {
            isLosingRound = true;
            console.log(`🎲 خسارة! (roll=${roll.toFixed(2)} < loseChance=${loseChance.toFixed(2)})`);
        } else {
            let rand = roll - loseChance;
            let cumulative = 0;
            for (const p of prizes.rows) {
                const prob = parseFloat(p.probability || 0);
                if (prob <= 0) continue;
                cumulative += prob;
                if (rand < cumulative) {
                    winningPrize = p;
                    break;
                }
            }
            if (!winningPrize) {
                winningPrize = prizes.rows.filter(p => parseFloat(p.probability || 0) > 0).pop();
            }
            console.log(`🎯 فوز! الجائزة: ${winningPrize?.name} (roll=${roll.toFixed(2)})`);
        }

        // 7. إعدادات
        const maxFlips = parseInt(await getSetting('max_flips', '5'));
        const flipDuration = parseInt(await getSetting('flip_duration', '600'));

        // 8. الرد
        if (isLosingRound) {
            res.json({
                success: true,
                game: {
                    is_losing_round: true,
                    prize_id: null,
                    prize_name: '😅 حظ أوفر',
                    prize_icon: '😅',
                    prize_image_url: null,
                    max_flips: maxFlips,
                    flip_duration: flipDuration
                }
            });
        } else {
            res.json({
                success: true,
                game: {
                    is_losing_round: false,
                    prize_id: winningPrize.id,
                    prize_name: winningPrize.name,
                    prize_icon: winningPrize.icon,
                    prize_image_url: winningPrize.image_url,
                    max_flips: maxFlips,
                    flip_duration: flipDuration
                }
            });
        }
    } catch (e) {
        console.error('❌ start game error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      🎴 إنهاء اللعبة
// ================================================================
app.post('/api/game/finish', async (req, res) => {
    const { user_id, prize_id, matched, cards_flipped } = req.body;

    if (!user_id) return res.status(400).json({ success: false, error: 'Missing user_id' });

    try {
        const isWin = matched === true;
        let prizeData = null;
        let amountWon = 0;
        let prizeName = '😅 حظ أوفر';

        if (isWin && prize_id) {
            const prize = await pool.query('SELECT * FROM card_prizes WHERE id = $1', [prize_id]);
            if (prize.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'Prize not found' });
            }
            prizeData = prize.rows[0];
            amountWon = parseFloat(prizeData.amount);
            prizeName = prizeData.name;
        }

        const r = await pool.query(`
            INSERT INTO card_games (user_id, status, prize_id, prize_name, prize_amount, cards_flipped, matched, is_claimed, is_rewarded)
            VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, FALSE)
            RETURNING id, game_date
        `, [
            user_id,
            isWin ? 'won' : 'lost',
            isWin ? prize_id : null,
            prizeName,
            amountWon,
            parseInt(cards_flipped) || 0,
            isWin
        ]);

        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_games,
                COUNT(CASE WHEN status = 'won' THEN 1 END) as wins,
                COALESCE(SUM(prize_amount), 0) as total_won
            FROM card_games WHERE user_id = $1
        `, [user_id]);

        const intervalHours = parseInt(await getSetting('spin_interval_hours', '24'));

        res.json({
            success: true,
            result: {
                won: isWin,
                prize: isWin && prizeData ? {
                    name: prizeData.name,
                    description: prizeData.description,
                    amount: parseFloat(prizeData.amount),
                    icon: prizeData.icon,
                    image_url: prizeData.image_url,
                    color: prizeData.color,
                    color2: prizeData.color2
                } : null,
                game_id: r.rows[0].id,
                game_date: r.rows[0].game_date
            },
            stats: {
                total_games: parseInt(stats.rows[0].total_games),
                wins: parseInt(stats.rows[0].wins),
                total_won: parseFloat(stats.rows[0].total_won)
            },
            cooldown_hours: intervalHours
        });
    } catch (e) {
        console.error('❌ finish game error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      حالة المستخدم
// ================================================================
app.get('/api/game/status/:user_id', async (req, res) => {
    const { user_id } = req.params;
    if (!dbReady) return res.status(503).json({ success: false, error: 'DB not ready' });

    try {
        const lastGame = await pool.query(`
            SELECT game_date FROM card_games WHERE user_id = $1
            ORDER BY game_date DESC LIMIT 1
        `, [user_id]);

        const intervalHours = parseInt(await getSetting('spin_interval_hours', '24'));

        let can_play = true;
        let remaining_hours = 0;
        let remaining_minutes = 0;

        if (lastGame.rows.length > 0) {
            const hoursDiff = (Date.now() - new Date(lastGame.rows[0].game_date).getTime()) / 3600000;
            if (hoursDiff < intervalHours) {
                can_play = false;
                remaining_hours = Math.floor(intervalHours - hoursDiff);
                remaining_minutes = Math.ceil((intervalHours - hoursDiff) * 60) % 60;
            }
        }

        // ✅ شرط الإيداع — يستثني الجوائز
        const depositRequired = await getSetting('deposit_required', 'false');
        let depositInfo = null;
        if (depositRequired === 'true') {
            const minAmount = parseFloat(await getSetting('deposit_min_amount', '1000'));
            const checkHours = parseInt(await getSetting('deposit_check_hours', '24'));

            const tableCheck = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_name = 'payments_log'
                )
            `);

            if (tableCheck.rows[0].exists) {
                // ✅ استخدام الدالة المركزية
                const total = await getRealDeposits(user_id, checkHours);
                depositInfo = {
                    required: true,
                    min_amount: minAmount,
                    check_hours: checkHours,
                    current_deposits: total,
                    is_met: total >= minAmount
                };
                if (!depositInfo.is_met) can_play = false;
            } else {
                depositInfo = {
                    required: true,
                    min_amount: minAmount,
                    check_hours: checkHours,
                    current_deposits: 0,
                    is_met: false,
                    table_missing: true
                };
                can_play = false;
            }
        }

        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_games,
                COUNT(CASE WHEN status = 'won' THEN 1 END) as wins,
                COALESCE(SUM(prize_amount), 0) as total_won
            FROM card_games WHERE user_id = $1
        `, [user_id]);

        res.json({
            success: true,
            can_play,
            remaining_hours,
            remaining_minutes,
            interval_hours: intervalHours,
            deposit_requirement: depositInfo,
            stats: {
                total_games: parseInt(stats.rows[0].total_games),
                wins: parseInt(stats.rows[0].wins),
                total_won: parseFloat(stats.rows[0].total_won)
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      إحصاءات الإيداعات (للأدمن)
// ================================================================
app.get('/api/admin/payments/stats', checkAdmin, async (req, res) => {
    try {
        // إجمالي كل شيء
        const total = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(final_amount), 0) as amount
            FROM payments_log WHERE status = 'completed'
        `);

        // ✅ الإيداعات الحقيقية فقط (بدون جوائز)
        const realDeposits = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(final_amount), 0) as amount
            FROM payments_log 
            WHERE status = 'completed'
              AND method_type NOT IN ('card_game', 'wheel_spin')
              AND method NOT LIKE '%لعبة البطاقات%'
              AND method NOT LIKE '%عجلة الحظ%'
        `);

        // ✅ الجوائز فقط
        const prizes = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(final_amount), 0) as amount
            FROM payments_log 
            WHERE status = 'completed'
              AND (method_type IN ('card_game', 'wheel_spin')
                   OR method LIKE '%لعبة البطاقات%'
                   OR method LIKE '%عجلة الحظ%')
        `);

        // التوزيع حسب النوع
        const byMethod = await pool.query(`
            SELECT 
                method, 
                method_type,
                COUNT(*) as count, 
                SUM(final_amount) as amount
            FROM payments_log WHERE status = 'completed'
            GROUP BY method, method_type
            ORDER BY count DESC
        `);

        // آخر 20
        const recent = await pool.query(`
            SELECT user_id, amount, method, method_type, payment_time
            FROM payments_log WHERE status = 'completed'
            ORDER BY payment_time DESC LIMIT 20
        `);

        res.json({
            success: true,
            total: {
                count: parseInt(total.rows[0].count),
                amount: parseFloat(total.rows[0].amount)
            },
            real_deposits: {
                count: parseInt(realDeposits.rows[0].count),
                amount: parseFloat(realDeposits.rows[0].amount)
            },
            prizes: {
                count: parseInt(prizes.rows[0].count),
                amount: parseFloat(prizes.rows[0].amount)
            },
            by_method: byMethod.rows,
            recent: recent.rows
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      إحصاءات المدقق
// ================================================================
app.get('/api/admin/auditor/stats', checkAdmin, async (req, res) => {
    try {
        const pending = await pool.query(`
            SELECT COUNT(*) as count FROM card_games
            WHERE status = 'won' AND (is_rewarded IS NULL OR is_rewarded = FALSE)
        `);
        const rewarded = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(prize_amount), 0) as total
            FROM card_games WHERE is_rewarded = TRUE
        `);
        res.json({
            success: true,
            pending_rewards: parseInt(pending.rows[0].count),
            rewarded_count: parseInt(rewarded.rows[0].count),
            rewarded_total: parseFloat(rewarded.rows[0].total)
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      التشغيل
// ================================================================
async function startServer() {
    console.log('\n🚀 بدء JAK BOT BARTON...');
    console.log(`📡 Port: ${port}`);
    console.log(`👑 Admin: ${ADMIN_ID}`);

    const ready = await ensureTables();
    dbReady = ready;

    app.listen(port, () => {
        console.log(`\n✅ يعمل على ${port}`);
        console.log(`🔗 http://localhost:${port}/api/status\n`);
    });
}

startServer().catch(err => { console.error('❌', err); process.exit(1); });
