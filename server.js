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
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

const ADMIN_ID = 7011476249;
let dbReady = false;

// ================================================================
//   أنواع الإيداعات التي تُستثنى من شرط الإيداع (جوائز اللعب)
// ================================================================
const PRIZE_METHOD_TYPES = ['card_game', 'wheel_spin'];
const PRIZE_METHOD_PATTERNS = ['%لعبة البطاقات%', '%عجلة الحظ%'];

// ================================================================
//                      إنشاء الجداول
// ================================================================
const TABLE_SCHEMAS = {
    // ============================================================
    //  🎡 جداول العجلة
    // ============================================================
    wheel_prizes: `
        CREATE TABLE IF NOT EXISTS wheel_prizes (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            amount DECIMAL(20,2) NOT NULL DEFAULT 0,
            probability DECIMAL(5,2) NOT NULL DEFAULT 0,
            icon VARCHAR(50),
            image_url TEXT,
            color VARCHAR(50) DEFAULT '#1a1a2e',
            color2 VARCHAR(50) DEFAULT '#16213e',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    wheel_spins: `
        CREATE TABLE IF NOT EXISTS wheel_spins (
            id SERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL,
            prize_id INTEGER REFERENCES wheel_prizes(id) ON DELETE SET NULL,
            prize_name VARCHAR(255),
            prize_amount DECIMAL(20,2) DEFAULT 0,
            spin_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_claimed BOOLEAN DEFAULT FALSE,
            is_rewarded BOOLEAN DEFAULT FALSE,
            claimed_date TIMESTAMP,
            rewarded_date TIMESTAMP
        )
    `,
    wheel_settings: `
        CREATE TABLE IF NOT EXISTS wheel_settings (
            id SERIAL PRIMARY KEY,
            setting_key VARCHAR(100) UNIQUE NOT NULL,
            setting_value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,
    wheel_banner: `
        CREATE TABLE IF NOT EXISTS wheel_banner (
            id SERIAL PRIMARY KEY,
            text TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,

    // ============================================================
    //  🎴 جداول البطاقات
    // ============================================================
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
    card_banner: `
        CREATE TABLE IF NOT EXISTS card_banner (
            id SERIAL PRIMARY KEY,
            text TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `,

    // ============================================================
    //  💰 جداول الإيداعات المشتركة
    // ============================================================
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
    `
};

// ================================================================
//                      الفهارس
// ================================================================
const INDEX_SCHEMAS = [
    // العجلة
    `CREATE INDEX IF NOT EXISTS idx_wheel_spins_user_id ON wheel_spins(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wheel_spins_is_rewarded ON wheel_spins(is_rewarded)`,
    `CREATE INDEX IF NOT EXISTS idx_wheel_spins_spin_date ON wheel_spins(spin_date)`,
    // البطاقات
    `CREATE INDEX IF NOT EXISTS idx_card_games_user_id ON card_games(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_card_games_status ON card_games(status)`,
    `CREATE INDEX IF NOT EXISTS idx_card_games_is_rewarded ON card_games(is_rewarded)`,
    `CREATE INDEX IF NOT EXISTS idx_card_games_game_date ON card_games(game_date)`,
    // الإيداعات
    `CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments_log(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_payment_time ON payments_log(payment_time)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_status ON payments_log(status)`,
    `CREATE INDEX IF NOT EXISTS idx_payments_method_type ON payments_log(method_type)`
];

// ================================================================
//                      البيانات الافتراضية
// ================================================================
const DEFAULT_WHEEL_PRIZES = [
    { name: '💎 جائزة 1000 SYP', description: 'فوز بـ 1000 ليرة سورية', amount: 1000, probability: 10, icon: '💎', color: '#1a1a2e', color2: '#16213e' },
    { name: '🎁 جائزة 500 SYP',  description: 'فوز بـ 500 ليرة سورية',  amount: 500,  probability: 20, icon: '🎁', color: '#2d1b3d', color2: '#1a0a0a' },
    { name: '⭐ جائزة 200 SYP',  description: 'فوز بـ 200 ليرة سورية',  amount: 200,  probability: 30, icon: '⭐', color: '#0f3460', color2: '#1a1a2e' },
    { name: '🎫 جائزة 100 SYP',  description: 'فوز بـ 100 ليرة سورية',  amount: 100,  probability: 40, icon: '🎫', color: '#1a2a1a', color2: '#0f1a0f' }
];

const DEFAULT_CARD_PRIZES = [
    { name: '💎 جائزة 1000 SYP', description: 'فوز بـ 1000 ليرة سورية', amount: 1000, probability: 10, icon: '💎', color: '#1a1a2e', color2: '#16213e' },
    { name: '🎁 جائزة 500 SYP',  description: 'فوز بـ 500 ليرة سورية',  amount: 500,  probability: 20, icon: '🎁', color: '#2d1b3d', color2: '#1a0a0a' },
    { name: '⭐ جائزة 200 SYP',  description: 'فوز بـ 200 ليرة سورية',  amount: 200,  probability: 30, icon: '⭐', color: '#0f3460', color2: '#1a1a2e' },
    { name: '🎫 جائزة 100 SYP',  description: 'فوز بـ 100 ليرة سورية',  amount: 100,  probability: 40, icon: '🎫', color: '#1a2a1a', color2: '#0f1a0f' }
];

const DEFAULT_WHEEL_SETTINGS = [
    { key: 'spin_interval_hours', value: '24' },
    { key: 'is_active', value: 'true' },
    { key: 'deposit_required', value: 'false' },
    { key: 'deposit_min_amount', value: '1000' },
    { key: 'deposit_check_hours', value: '24' },
    { key: 'center_icon', value: '⭐' },
    { key: 'bg_image_url', value: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1920&q=80' },
    { key: 'loading_image_url', value: 'https://via.placeholder.com/200/1a1a2e/FFD700?text=🎡' },
    { key: 'spin_duration', value: '3500' }
];

const DEFAULT_CARD_SETTINGS = [
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
    { key: 'ambience_enabled', value: 'true' },
    { key: 'game_title', value: 'JAK BOT BARTON' }
];

// ================================================================
//                      تحديث هيكل الجداول
// ================================================================
async function updateTableSchema() {
    const client = await pool.connect();
    try {
        console.log('📋 التحقق من هيكل الجداول...');

        // ---- wheel_prizes ----
        const wPrizeCols = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'wheel_prizes' 
            AND column_name IN ('image_url', 'amount', 'color', 'color2', 'updated_at')
        `);
        const existingWPrize = wPrizeCols.rows.map(r => r.column_name);

        const wheelPrizeAlters = [
            { col: 'image_url', sql: `ALTER TABLE wheel_prizes ADD COLUMN image_url TEXT` },
            { col: 'amount', sql: `ALTER TABLE wheel_prizes ADD COLUMN amount DECIMAL(20,2) DEFAULT 0` },
            { col: 'color', sql: `ALTER TABLE wheel_prizes ADD COLUMN color VARCHAR(50) DEFAULT '#1a1a2e'` },
            { col: 'color2', sql: `ALTER TABLE wheel_prizes ADD COLUMN color2 VARCHAR(50) DEFAULT '#16213e'` },
            { col: 'updated_at', sql: `ALTER TABLE wheel_prizes ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP` }
        ];
        for (const a of wheelPrizeAlters) {
            if (!existingWPrize.includes(a.col)) {
                await client.query(a.sql);
                console.log(`✅ إضافة wheel_prizes.${a.col}`);
            }
        }

        // ---- wheel_spins ----
        const wSpinCols = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'wheel_spins' 
            AND column_name IN ('is_rewarded', 'rewarded_date', 'is_claimed', 'claimed_date', 'prize_amount')
        `);
        const existingWSpin = wSpinCols.rows.map(r => r.column_name);

        const wheelSpinAlters = [
            { col: 'is_rewarded', sql: `ALTER TABLE wheel_spins ADD COLUMN is_rewarded BOOLEAN DEFAULT FALSE` },
            { col: 'rewarded_date', sql: `ALTER TABLE wheel_spins ADD COLUMN rewarded_date TIMESTAMP` },
            { col: 'is_claimed', sql: `ALTER TABLE wheel_spins ADD COLUMN is_claimed BOOLEAN DEFAULT FALSE` },
            { col: 'claimed_date', sql: `ALTER TABLE wheel_spins ADD COLUMN claimed_date TIMESTAMP` },
            { col: 'prize_amount', sql: `ALTER TABLE wheel_spins ADD COLUMN prize_amount DECIMAL(20,2) DEFAULT 0` }
        ];
        for (const a of wheelSpinAlters) {
            if (!existingWSpin.includes(a.col)) {
                await client.query(a.sql);
                console.log(`✅ إضافة wheel_spins.${a.col}`);
            }
        }

        // ---- card_prizes ----
        const cPrizeCols = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'card_prizes' 
            AND column_name IN ('image_url', 'amount', 'color', 'color2')
        `);
        const existingCPrize = cPrizeCols.rows.map(r => r.column_name);

        const cardPrizeAlters = [
            { col: 'image_url', sql: `ALTER TABLE card_prizes ADD COLUMN image_url TEXT` },
            { col: 'amount', sql: `ALTER TABLE card_prizes ADD COLUMN amount DECIMAL(20,2) DEFAULT 0` },
            { col: 'color', sql: `ALTER TABLE card_prizes ADD COLUMN color VARCHAR(50) DEFAULT '#1a1a2e'` },
            { col: 'color2', sql: `ALTER TABLE card_prizes ADD COLUMN color2 VARCHAR(50) DEFAULT '#16213e'` }
        ];
        for (const a of cardPrizeAlters) {
            if (!existingCPrize.includes(a.col)) {
                await client.query(a.sql);
                console.log(`✅ إضافة card_prizes.${a.col}`);
            }
        }

        // ---- card_games ----
        const cGameCols = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'card_games' 
            AND column_name IN ('is_rewarded', 'rewarded_date', 'is_claimed', 'claimed_date', 'matched', 'cards_flipped')
        `);
        const existingCGame = cGameCols.rows.map(r => r.column_name);

        const cardGameAlters = [
            { col: 'is_rewarded', sql: `ALTER TABLE card_games ADD COLUMN is_rewarded BOOLEAN DEFAULT FALSE` },
            { col: 'rewarded_date', sql: `ALTER TABLE card_games ADD COLUMN rewarded_date TIMESTAMP` },
            { col: 'is_claimed', sql: `ALTER TABLE card_games ADD COLUMN is_claimed BOOLEAN DEFAULT FALSE` },
            { col: 'claimed_date', sql: `ALTER TABLE card_games ADD COLUMN claimed_date TIMESTAMP` },
            { col: 'matched', sql: `ALTER TABLE card_games ADD COLUMN matched BOOLEAN DEFAULT FALSE` },
            { col: 'cards_flipped', sql: `ALTER TABLE card_games ADD COLUMN cards_flipped INTEGER DEFAULT 0` }
        ];
        for (const a of cardGameAlters) {
            if (!existingCGame.includes(a.col)) {
                await client.query(a.sql);
                console.log(`✅ إضافة card_games.${a.col}`);
            }
        }

        // ---- payments_log ----
        const payCols = await client.query(`
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'payments_log' 
            AND column_name IN (
                'payment_id', 'method_type', 'transaction_id', 'bonus_amount', 'bonus_percent',
                'old_balance', 'new_balance', 'exchange_rate', 'commission_amount',
                'referrer_id', 'ichancy_username', 'ichancy_player_id',
                'payment_time', 'log_time', 'created_at'
            )
        `);
        const existingPay = payCols.rows.map(r => r.column_name);

        const payAlters = [
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
        for (const a of payAlters) {
            if (!existingPay.includes(a.col)) {
                await client.query(a.sql);
                console.log(`✅ إضافة payments_log.${a.col}`);
            }
        }

        // إصلاح payment_time للصفوف القديمة
        try {
            const fix = await client.query(`
                UPDATE payments_log 
                SET payment_time = COALESCE(created_at, log_time, NOW())
                WHERE payment_time IS NULL
            `);
            if (fix.rowCount > 0) console.log(`✅ تحديث payment_time لـ ${fix.rowCount} صف`);
        } catch (e) {}

        // ---- فهارس ----
        for (const idxSql of INDEX_SCHEMAS) {
            try { await client.query(idxSql); } catch (e) {}
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

        // ---- Wheel Prizes ----
        const wPrizes = await client.query('SELECT COUNT(*) FROM wheel_prizes');
        if (parseInt(wPrizes.rows[0].count) === 0) {
            for (const p of DEFAULT_WHEEL_PRIZES) {
                await client.query(`
                    INSERT INTO wheel_prizes (name, description, amount, probability, icon, color, color2)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)
                `, [p.name, p.description, p.amount, p.probability, p.icon, p.color, p.color2]);
            }
            console.log(`   ✅ ${DEFAULT_WHEEL_PRIZES.length} جائزة عجلة`);
        }

        // ---- Wheel Settings ----
        const wSettings = await client.query('SELECT COUNT(*) FROM wheel_settings');
        if (parseInt(wSettings.rows[0].count) === 0) {
            for (const s of DEFAULT_WHEEL_SETTINGS) {
                await client.query(`INSERT INTO wheel_settings (setting_key, setting_value) VALUES ($1,$2)`, [s.key, s.value]);
            }
            console.log(`   ✅ ${DEFAULT_WHEEL_SETTINGS.length} إعداد عجلة`);
        }

        // ---- Wheel Banner ----
        const wBanner = await client.query('SELECT COUNT(*) FROM wheel_banner');
        if (parseInt(wBanner.rows[0].count) === 0) {
            await client.query(`INSERT INTO wheel_banner (text) VALUES ($1)`, ['🎡 IChancy · عجلة الحظ']);
        }

        // ---- Card Prizes ----
        const cPrizes = await client.query('SELECT COUNT(*) FROM card_prizes');
        if (parseInt(cPrizes.rows[0].count) === 0) {
            for (const p of DEFAULT_CARD_PRIZES) {
                await client.query(`
                    INSERT INTO card_prizes (name, description, amount, icon, probability, color, color2)
                    VALUES ($1,$2,$3,$4,$5,$6,$7)
                `, [p.name, p.description, p.amount, p.icon, p.probability, p.color, p.color2]);
            }
            console.log(`   ✅ ${DEFAULT_CARD_PRIZES.length} جائزة بطاقات`);
        }

        // ---- Card Settings ----
        const cSettings = await client.query('SELECT COUNT(*) FROM card_settings');
        if (parseInt(cSettings.rows[0].count) === 0) {
            for (const s of DEFAULT_CARD_SETTINGS) {
                await client.query(`INSERT INTO card_settings (setting_key, setting_value) VALUES ($1,$2)`, [s.key, s.value]);
            }
            console.log(`   ✅ ${DEFAULT_CARD_SETTINGS.length} إعداد بطاقات`);
        }

        // ---- Card Banner ----
        const cBanner = await client.query('SELECT COUNT(*) FROM card_banner');
        if (parseInt(cBanner.rows[0].count) === 0) {
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

async function getWheelSetting(key, defaultValue) {
    const r = await pool.query('SELECT setting_value FROM wheel_settings WHERE setting_key = $1', [key]);
    return r.rows[0]?.setting_value ?? defaultValue;
}

async function getCardSetting(key, defaultValue) {
    const r = await pool.query('SELECT setting_value FROM card_settings WHERE setting_key = $1', [key]);
    return r.rows[0]?.setting_value ?? defaultValue;
}

// ✅ حساب الإيداعات الحقيقية فقط (بدون جوائز)
async function getRealDeposits(userId, checkHours) {
    const r = await pool.query(`
        SELECT COALESCE(SUM(final_amount), 0) as total
        FROM payments_log
        WHERE user_id = $1 
          AND status = 'completed'
          AND method_type NOT IN ('card_game', 'wheel_spin')
          AND method NOT LIKE '%لعبة البطاقات%'
          AND method NOT LIKE '%عجلة الحظ%'
          AND payment_time >= NOW() - ($2::int * INTERVAL '1 hour')
    `, [userId, checkHours]);
    return parseFloat(r.rows[0]?.total || 0);
}

// ================================================================
//                      المسارات الأساسية
// ================================================================
app.get('/api/status', async (req, res) => {
    try {
        const wheelReady = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'wheel_spins')`);
        const cardReady = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'card_games')`);
        const payReady = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'payments_log')`);

        res.json({
            status: 'running',
            service: 'JAK BOT BARTON + IChancy API',
            database: {
                ready: dbReady,
                wheel_ready: wheelReady.rows[0].exists,
                card_ready: cardReady.rows[0].exists,
                payments_log_ready: payReady.rows[0].exists
            },
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ status: 'error', error: e.message });
    }
});

app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'JAK BOT BARTON + IChancy API',
        message: '🚀 الخادم يعمل',
        games: {
            wheel: '/api/wheel/',
            card: '/api/card/'
        }
    });
});

// ================================================================
//                      🎡 العجلة — Banner
// ================================================================
app.get('/api/wheel/banner', async (req, res) => {
    try {
        const r = await pool.query('SELECT text FROM wheel_banner ORDER BY id DESC LIMIT 1');
        res.json({ success: true, text: r.rows[0]?.text || '🎡 IChancy · عجلة الحظ' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.put('/api/wheel/admin/banner', checkAdmin, async (req, res) => {
    const { text } = req.body;
    try {
        await pool.query(`INSERT INTO wheel_banner (text, updated_at) VALUES ($1, CURRENT_TIMESTAMP)`, [text]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      🎡 العجلة — الجوائز العامة
// ================================================================
app.get('/api/wheel/prizes', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT id, name, description, amount, icon, image_url, probability, color, color2
            FROM wheel_prizes WHERE is_active = true ORDER BY id ASC
        `);
        res.json({ success: true, prizes: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      🎡 العجلة — إعدادات الأدمن
// ================================================================
app.get('/api/wheel/admin/settings', checkAdmin, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM wheel_settings');
        const settings = {};
        r.rows.forEach(row => { settings[row.setting_key] = row.setting_value; });
        const b = await pool.query('SELECT text FROM wheel_banner ORDER BY id DESC LIMIT 1');
        settings.banner_text = b.rows[0]?.text || '🎡 IChancy · عجلة الحظ';
        res.json({ success: true, settings });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.put('/api/wheel/admin/setting', checkAdmin, async (req, res) => {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ success: false, error: 'Key required' });
    try {
        if (key === 'banner_text') {
            await pool.query(`INSERT INTO wheel_banner (text, updated_at) VALUES ($1, CURRENT_TIMESTAMP)`, [value]);
        } else {
            await pool.query(`
                INSERT INTO wheel_settings (setting_key, setting_value, updated_at)
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
//                      🎡 العجلة — إدارة الجوائز
// ================================================================
app.get('/api/wheel/admin/prizes', checkAdmin, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM wheel_prizes ORDER BY id ASC');
        res.json({ success: true, prizes: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/wheel/admin/prizes', checkAdmin, async (req, res) => {
    const { name, description, amount, probability, icon, image_url, color, color2 } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Name required' });
    try {
        const r = await pool.query(`
            INSERT INTO wheel_prizes (name, description, amount, probability, icon, image_url, color, color2, is_active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *
        `, [
            name, description || '', parseFloat(amount) || 0, parseFloat(probability) || 0,
            icon || '🎁', image_url || null, color || '#1a1a2e', color2 || '#16213e'
        ]);
        res.json({ success: true, prize: r.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.put('/api/wheel/admin/prizes/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    const fields = req.body;
    const allowed = ['name', 'description', 'amount', 'probability', 'icon', 'image_url', 'color', 'color2', 'is_active'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
        if (fields[key] !== undefined && fields[key] !== null) {
            let val = fields[key];
            if (['amount', 'probability'].includes(key)) val = parseFloat(val);
            if (key === 'is_active') val = val === true || val === 'true';
            updates.push(`${key} = $${idx++}`);
            values.push(val);
        }
    }
    if (updates.length === 0) return res.status(400).json({ success: false, error: 'No fields' });
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    try {
        const r = await pool.query(`UPDATE wheel_prizes SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
        if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, prize: r.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/wheel/admin/prizes/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('UPDATE wheel_spins SET prize_id = NULL WHERE prize_id = $1', [id]);
        const r = await pool.query('DELETE FROM wheel_prizes WHERE id = $1 RETURNING id', [id]);
        if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/wheel/admin/seed-prizes', checkAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE wheel_spins SET prize_id = NULL');
        await pool.query('DELETE FROM wheel_prizes');
        for (const p of DEFAULT_WHEEL_PRIZES) {
            await pool.query(`
                INSERT INTO wheel_prizes (name, description, amount, probability, icon, color, color2, is_active)
                VALUES ($1,$2,$3,$4,$5,$6,$7,true)
            `, [p.name, p.description, p.amount, p.probability, p.icon, p.color, p.color2]);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/wheel/admin/reset-spins', checkAdmin, async (req, res) => {
    const { user_id } = req.body;
    try {
        let result;
        if (user_id) {
            result = await pool.query('DELETE FROM wheel_spins WHERE user_id = $1 RETURNING id', [user_id]);
        } else {
            result = await pool.query('DELETE FROM wheel_spins RETURNING id');
        }
        await pool.query('ALTER SEQUENCE wheel_spins_id_seq RESTART WITH 1');
        res.json({ success: true, deleted_count: result.rowCount });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      🎡 العجلة — التدوير
// ================================================================
app.post('/api/wheel/spin', async (req, res) => {
    const { user_id } = req.body;

    if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
    if (!dbReady) return res.status(503).json({ success: false, error: 'Database not ready' });

    try {
        // 1. تفعيل
        const isActive = await getWheelSetting('is_active', 'true');
        if (isActive !== 'true') return res.status(403).json({ success: false, error: 'العجلة معطلة حالياً' });

        // 2. شرط الإيداع (بدون جوائز)
        const depositRequired = await getWheelSetting('deposit_required', 'false');
        if (depositRequired === 'true') {
            const minAmount = parseFloat(await getWheelSetting('deposit_min_amount', '1000'));
            const checkHours = parseInt(await getWheelSetting('deposit_check_hours', '24'));

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
        const intervalHours = parseInt(await getWheelSetting('spin_interval_hours', '24'));
        const lastSpin = await pool.query(`
            SELECT spin_date FROM wheel_spins WHERE user_id = $1
            ORDER BY spin_date DESC LIMIT 1
        `, [user_id]);

        if (lastSpin.rows.length > 0) {
            const hoursDiff = (Date.now() - new Date(lastSpin.rows[0].spin_date).getTime()) / 3600000;
            if (hoursDiff < intervalHours) {
                const remainingHours = Math.ceil(intervalHours - hoursDiff);
                const remainingMinutes = Math.ceil((intervalHours - hoursDiff) * 60) % 60;
                return res.status(429).json({
                    success: false,
                    error: `يمكنك التدوير مرة أخرى بعد ${remainingHours} ساعة`,
                    remaining_hours: Math.floor(remainingHours),
                    remaining_minutes: remainingMinutes
                });
            }
        }

        // 4. الجوائز
        const prizes = await pool.query('SELECT * FROM wheel_prizes WHERE is_active = true');
        if (prizes.rows.length === 0) return res.status(500).json({ success: false, error: 'لا توجد جوائز' });

        const totalProb = prizes.rows.reduce((s, p) => s + parseFloat(p.probability || 0), 0);
        if (totalProb <= 0) return res.status(500).json({ success: false, error: 'كل الجوائز معطلة' });

        // 5. اختيار الجائزة (Weighted Random)
        let rand = Math.random() * totalProb;
        let selectedPrize = prizes.rows.filter(p => parseFloat(p.probability) > 0)[0];
        for (const p of prizes.rows) {
            const prob = parseFloat(p.probability || 0);
            if (prob <= 0) continue;
            if (rand <= prob) { selectedPrize = p; break; }
            rand -= prob;
        }

        // 6. تسجيل
        const result = await pool.query(`
            INSERT INTO wheel_spins (user_id, prize_id, prize_name, prize_amount, is_claimed, is_rewarded)
            VALUES ($1, $2, $3, $4, FALSE, FALSE)
            RETURNING id, spin_date
        `, [user_id, selectedPrize.id, selectedPrize.name, parseFloat(selectedPrize.amount) || 0]);

        // 7. إحصائيات
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_spins,
                COUNT(CASE WHEN prize_amount > 0 THEN 1 END) as wins,
                COALESCE(SUM(prize_amount), 0) as total_won
            FROM wheel_spins WHERE user_id = $1
        `, [user_id]);

        res.json({
            success: true,
            spin: {
                id: result.rows[0].id,
                prize: {
                    id: selectedPrize.id,
                    name: selectedPrize.name,
                    description: selectedPrize.description,
                    amount: parseFloat(selectedPrize.amount),
                    icon: selectedPrize.icon,
                    image_url: selectedPrize.image_url,
                    color: selectedPrize.color,
                    color2: selectedPrize.color2
                },
                spin_date: result.rows[0].spin_date
            },
            stats: {
                total_spins: parseInt(stats.rows[0].total_spins),
                wins: parseInt(stats.rows[0].wins),
                total_won: parseFloat(stats.rows[0].total_won)
            }
        });
    } catch (e) {
        console.error('❌ wheel spin error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      🎡 العجلة — حالة المستخدم
// ================================================================
app.get('/api/wheel/history/:user_id', async (req, res) => {
    const { user_id } = req.params;
    if (!dbReady) return res.status(503).json({ success: false, error: 'DB not ready' });

    try {
        const lastSpin = await pool.query(`
            SELECT spin_date FROM wheel_spins WHERE user_id = $1
            ORDER BY spin_date DESC LIMIT 1
        `, [user_id]);

        const intervalHours = parseInt(await getWheelSetting('spin_interval_hours', '24'));

        let can_spin = true;
        let remaining_hours = 0;
        let remaining_minutes = 0;

        if (lastSpin.rows.length > 0) {
            const hoursDiff = (Date.now() - new Date(lastSpin.rows[0].spin_date).getTime()) / 3600000;
            if (hoursDiff < intervalHours) {
                can_spin = false;
                remaining_hours = Math.floor(intervalHours - hoursDiff);
                remaining_minutes = Math.ceil((intervalHours - hoursDiff) * 60) % 60;
            }
        }

        // شرط الإيداع
        const depositRequired = await getWheelSetting('deposit_required', 'false');
        let depositInfo = null;
        if (depositRequired === 'true') {
            const minAmount = parseFloat(await getWheelSetting('deposit_min_amount', '1000'));
            const checkHours = parseInt(await getWheelSetting('deposit_check_hours', '24'));
            const total = await getRealDeposits(user_id, checkHours);
            depositInfo = {
                required: true,
                min_amount: minAmount,
                check_hours: checkHours,
                current_deposits: total,
                is_met: total >= minAmount
            };
            if (!depositInfo.is_met) can_spin = false;
        }

        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_spins,
                COUNT(CASE WHEN prize_amount > 0 THEN 1 END) as wins,
                COALESCE(SUM(prize_amount), 0) as total_won
            FROM wheel_spins WHERE user_id = $1
        `, [user_id]);

        res.json({
            success: true,
            can_spin,
            spin_status: {
                can_spin,
                remaining_hours,
                remaining_minutes,
                interval_hours: intervalHours
            },
            deposit_requirement: depositInfo,
            stats: {
                total_spins: parseInt(stats.rows[0].total_spins),
                wins: parseInt(stats.rows[0].wins),
                total_won: parseFloat(stats.rows[0].total_won)
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      🎴 البطاقات — Banner
// ================================================================
app.get('/api/card/banner', async (req, res) => {
    try {
        const r = await pool.query('SELECT text FROM card_banner ORDER BY id DESC LIMIT 1');
        res.json({ success: true, text: r.rows[0]?.text || 'JAK BOT BARTON' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.put('/api/card/admin/banner', checkAdmin, async (req, res) => {
    const { text } = req.body;
    try {
        await pool.query(`INSERT INTO card_banner (text, updated_at) VALUES ($1, CURRENT_TIMESTAMP)`, [text]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      🎴 البطاقات — الجوائز العامة
// ================================================================
app.get('/api/card/prizes', async (req, res) => {
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
//                      🎴 البطاقات — إعدادات الأدمن
// ================================================================
app.get('/api/card/admin/settings', checkAdmin, async (req, res) => {
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

app.put('/api/card/admin/setting', checkAdmin, async (req, res) => {
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
//                      🎴 البطاقات — إدارة الجوائز
// ================================================================
app.get('/api/card/admin/prizes', checkAdmin, async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM card_prizes ORDER BY id ASC');
        res.json({ success: true, prizes: r.rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/card/admin/prizes', checkAdmin, async (req, res) => {
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

app.put('/api/card/admin/prizes/:id', checkAdmin, async (req, res) => {
    const { id } = req.params;
    const fields = req.body;
    const allowed = ['name', 'description', 'amount', 'icon', 'image_url', 'probability', 'color', 'color2', 'is_active'];
    const updates = [];
    const values = [];
    let idx = 1;

    for (const key of allowed) {
        if (fields[key] !== undefined && fields[key] !== null) {
            let val = fields[key];
            if (['amount', 'probability'].includes(key)) val = parseFloat(val);
            if (key === 'is_active') val = val === true || val === 'true';
            updates.push(`${key} = $${idx++}`);
            values.push(val);
        }
    }
    if (updates.length === 0) return res.status(400).json({ success: false, error: 'No fields' });
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    try {
        const r = await pool.query(`UPDATE card_prizes SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
        if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, prize: r.rows[0] });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/card/admin/prizes/:id', checkAdmin, async (req, res) => {
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

app.post('/api/card/admin/seed-prizes', checkAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE card_games SET prize_id = NULL');
        await pool.query('DELETE FROM card_prizes');
        for (const p of DEFAULT_CARD_PRIZES) {
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

app.post('/api/card/admin/reset-games', checkAdmin, async (req, res) => {
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
//                      🎴 البطاقات — بدء اللعبة
// ================================================================
app.post('/api/card/game/start', async (req, res) => {
    const { user_id } = req.body;

    if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
    if (!dbReady) return res.status(503).json({ success: false, error: 'Database not ready' });

    try {
        // 1. تفعيل
        const isActive = await getCardSetting('is_active', 'true');
        if (isActive !== 'true') return res.status(403).json({ success: false, error: 'اللعبة معطلة حالياً' });

        // 2. شرط الإيداع (بدون جوائز)
        const depositRequired = await getCardSetting('deposit_required', 'false');
        if (depositRequired === 'true') {
            const minAmount = parseFloat(await getCardSetting('deposit_min_amount', '1000'));
            const checkHours = parseInt(await getCardSetting('deposit_check_hours', '24'));

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
        const intervalHours = parseInt(await getCardSetting('spin_interval_hours', '24'));
        const lastGame = await pool.query(`
            SELECT game_date FROM card_games WHERE user_id = $1
            ORDER BY game_date DESC LIMIT 1
        `, [user_id]);

        if (lastGame.rows.length > 0) {
            const hoursDiff = (Date.now() - new Date(lastGame.rows[0].game_date).getTime()) / 3600000;
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

        // 4. الجوائز
        const prizes = await pool.query('SELECT * FROM card_prizes WHERE is_active = true');
        if (prizes.rows.length === 0) return res.status(500).json({ success: false, error: 'لا توجد جوائز' });

        const totalProb = prizes.rows.reduce((s, p) => s + parseFloat(p.probability || 0), 0);
        if (totalProb <= 0) return res.status(500).json({ success: false, error: 'كل الجوائز معطلة' });

        // 5. رابح أم خاسر؟
        const loseChance = Math.max(0, 100 - totalProb);
        const roll = Math.random() * Math.max(100, totalProb);

        let winningPrize = null;
        let isLosingRound = false;

        if (roll < loseChance) {
            isLosingRound = true;
        } else {
            let rand = roll - loseChance;
            let cumulative = 0;
            for (const p of prizes.rows) {
                const prob = parseFloat(p.probability || 0);
                if (prob <= 0) continue;
                cumulative += prob;
                if (rand < cumulative) { winningPrize = p; break; }
            }
            if (!winningPrize) {
                winningPrize = prizes.rows.filter(p => parseFloat(p.probability || 0) > 0).pop();
            }
        }

        const maxFlips = parseInt(await getCardSetting('max_flips', '5'));
        const flipDuration = parseInt(await getCardSetting('flip_duration', '600'));

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
        console.error('❌ card start error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      🎴 البطاقات — إنهاء اللعبة
// ================================================================
app.post('/api/card/game/finish', async (req, res) => {
    const { user_id, prize_id, matched, cards_flipped } = req.body;

    if (!user_id) return res.status(400).json({ success: false, error: 'Missing user_id' });

    try {
        const isWin = matched === true;
        let prizeData = null;
        let amountWon = 0;
        let prizeName = '😅 حظ أوفر';

        if (isWin && prize_id) {
            const prize = await pool.query('SELECT * FROM card_prizes WHERE id = $1', [prize_id]);
            if (prize.rows.length === 0) return res.status(404).json({ success: false, error: 'Prize not found' });
            prizeData = prize.rows[0];
            amountWon = parseFloat(prizeData.amount);
            prizeName = prizeData.name;
        }

        const r = await pool.query(`
            INSERT INTO card_games (user_id, status, prize_id, prize_name, prize_amount, cards_flipped, matched, is_claimed, is_rewarded)
            VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, FALSE)
            RETURNING id, game_date
        `, [user_id, isWin ? 'won' : 'lost', isWin ? prize_id : null, prizeName, amountWon, parseInt(cards_flipped) || 0, isWin]);

        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_games,
                COUNT(CASE WHEN status = 'won' THEN 1 END) as wins,
                COALESCE(SUM(prize_amount), 0) as total_won
            FROM card_games WHERE user_id = $1
        `, [user_id]);

        const intervalHours = parseInt(await getCardSetting('spin_interval_hours', '24'));

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
        console.error('❌ card finish error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      🎴 البطاقات — حالة المستخدم
// ================================================================
app.get('/api/card/game/status/:user_id', async (req, res) => {
    const { user_id } = req.params;
    if (!dbReady) return res.status(503).json({ success: false, error: 'DB not ready' });

    try {
        const lastGame = await pool.query(`
            SELECT game_date FROM card_games WHERE user_id = $1
            ORDER BY game_date DESC LIMIT 1
        `, [user_id]);

        const intervalHours = parseInt(await getCardSetting('spin_interval_hours', '24'));

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

        const depositRequired = await getCardSetting('deposit_required', 'false');
        let depositInfo = null;
        if (depositRequired === 'true') {
            const minAmount = parseFloat(await getCardSetting('deposit_min_amount', '1000'));
            const checkHours = parseInt(await getCardSetting('deposit_check_hours', '24'));
            const total = await getRealDeposits(user_id, checkHours);
            depositInfo = {
                required: true,
                min_amount: minAmount,
                check_hours: checkHours,
                current_deposits: total,
                is_met: total >= minAmount
            };
            if (!depositInfo.is_met) can_play = false;
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
//                      💰 إحصاءات الإيداعات المشتركة
// ================================================================
app.get('/api/admin/payments/stats', checkAdmin, async (req, res) => {
    try {
        const total = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(final_amount), 0) as amount
            FROM payments_log WHERE status = 'completed'
        `);

        const realDeposits = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(final_amount), 0) as amount
            FROM payments_log 
            WHERE status = 'completed'
              AND method_type NOT IN ('card_game', 'wheel_spin')
              AND method NOT LIKE '%لعبة البطاقات%'
              AND method NOT LIKE '%عجلة الحظ%'
        `);

        const prizes = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(final_amount), 0) as amount
            FROM payments_log 
            WHERE status = 'completed'
              AND (method_type IN ('card_game', 'wheel_spin')
                   OR method LIKE '%لعبة البطاقات%'
                   OR method LIKE '%عجلة الحظ%')
        `);

        const byMethod = await pool.query(`
            SELECT method, method_type, COUNT(*) as count, SUM(final_amount) as amount
            FROM payments_log WHERE status = 'completed'
            GROUP BY method, method_type ORDER BY count DESC
        `);

        const recent = await pool.query(`
            SELECT user_id, amount, method, method_type, payment_time
            FROM payments_log WHERE status = 'completed'
            ORDER BY payment_time DESC LIMIT 20
        `);

        res.json({
            success: true,
            total: { count: parseInt(total.rows[0].count), amount: parseFloat(total.rows[0].amount) },
            real_deposits: { count: parseInt(realDeposits.rows[0].count), amount: parseFloat(realDeposits.rows[0].amount) },
            prizes: { count: parseInt(prizes.rows[0].count), amount: parseFloat(prizes.rows[0].amount) },
            by_method: byMethod.rows,
            recent: recent.rows
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      🔍 إحصاءات المدقق (لكلا اللعبتين)
// ================================================================
app.get('/api/admin/auditor/stats', checkAdmin, async (req, res) => {
    try {
        // العجلة
        const wheelPending = await pool.query(`
            SELECT COUNT(*) as count FROM wheel_spins
            WHERE is_claimed = FALSE OR is_claimed IS NULL
        `);
        const wheelRewarded = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(prize_amount), 0) as total
            FROM wheel_spins WHERE is_claimed = TRUE
        `);

        // البطاقات
        const cardPending = await pool.query(`
            SELECT COUNT(*) as count FROM card_games
            WHERE status = 'won' AND (is_rewarded IS NULL OR is_rewarded = FALSE)
        `);
        const cardRewarded = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(prize_amount), 0) as total
            FROM card_games WHERE is_rewarded = TRUE
        `);

        res.json({
            success: true,
            wheel: {
                pending: parseInt(wheelPending.rows[0].count),
                rewarded_count: parseInt(wheelRewarded.rows[0].count),
                rewarded_total: parseFloat(wheelRewarded.rows[0].total)
            },
            card: {
                pending: parseInt(cardPending.rows[0].count),
                rewarded_count: parseInt(cardRewarded.rows[0].count),
                rewarded_total: parseFloat(cardRewarded.rows[0].total)
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ================================================================
//                      التشغيل
// ================================================================
async function startServer() {
    console.log('\n🚀 بدء الخادم الموحد (عجلة + بطاقات)...');
    console.log(`📡 Port: ${port}`);
    console.log(`👑 Admin: ${ADMIN_ID}`);

    const ready = await ensureTables();
    dbReady = ready;

    app.listen(port, () => {
        console.log(`\n✅ الخادم يعمل على ${port}`);
        console.log(`\n📋 نقاط النهاية:`);
        console.log(`   🎡 العجلة:`);
        console.log(`      GET  /api/wheel/prizes`);
        console.log(`      POST /api/wheel/spin`);
        console.log(`      GET  /api/wheel/history/:user_id`);
        console.log(`      GET  /api/wheel/banner`);
        console.log(`   🎴 البطاقات:`);
        console.log(`      GET  /api/card/prizes`);
        console.log(`      POST /api/card/game/start`);
        console.log(`      POST /api/card/game/finish`);
        console.log(`      GET  /api/card/game/status/:user_id`);
        console.log(`      GET  /api/card/banner`);
        console.log(`   💰 الإيداعات:`);
        console.log(`      GET  /api/admin/payments/stats`);
        console.log(`   🔍 المدقق:`);
        console.log(`      GET  /api/admin/auditor/stats`);
        console.log(`\n`);
    });
}

startServer().catch(err => { console.error('❌', err); process.exit(1); });
