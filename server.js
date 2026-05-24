const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const User = require('./models/User'); 

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// ==========================================
// 1. CẤU HÌNH KINH TẾ (20,000 XU = 1 VNĐ)
// ==========================================
const EXCHANGE_RATE = 20000;    // Tỷ lệ quy đổi
const START_REWARD = 50000;     // Thưởng người mới
const REF_REWARD = 100000;      // Thưởng người mời

// Kết nối MongoDB
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Bot Server đã kết nối Database Kinh Tế 2.0'))
    .catch(err => console.error('❌ Lỗi kết nối DB:', err));

// ==========================================
// 2. LOGIC XỬ LÝ LỆNH /START
// ==========================================
bot.start(async (ctx) => {
    const { id, first_name, username } = ctx.from;
    const startPayload = ctx.startPayload; // Lấy ID người mời từ link ref
    const today = new Date().toDateString();
    
    try {
        let user = await User.findOne({ telegramId: id.toString() });

        if (!user) {
            // TẠO NGƯỜI DÙNG MỚI (KHỚP HOÀN TOÀN VỚI USER.JS)
            user = new User({
                telegramId: id.toString(),
                username: username || 'n/a',
                name: first_name,
                totalCoins: START_REWARD,
                diamonds: 0,
                level: 1,
                isMining: false,
                miningStartedAt: null,
                miningRate: 12.0, // Tốc độ mặc định level 1
                adsWatchedToday: 0,
                lastActiveDay: today,
                refs: 0,
                referredBy: null
            });

            // Xử lý hệ thống giới thiệu
            if (startPayload && startPayload !== id.toString()) {
                const inviter = await User.findOne({ telegramId: startPayload });
                if (inviter) {
                    // Thưởng cho người mời
                    inviter.totalCoins += REF_REWARD;
                    inviter.refs += 1;
                    await inviter.save();

                    // Lưu vết người giới thiệu cho người mới
                    user.referredBy = startPayload;

                    // Thông báo cho người mời
                    try {
                        await bot.telegram.sendMessage(inviter.telegramId, 
                            `🎉 *Mời bạn thành công!*\nBạn nhận được *+${REF_REWARD.toLocaleString()} Xu* vì đã mời ${first_name} tham gia!`,
                            { parse_mode: 'Markdown' }
                        );
                    } catch (e) { console.log("Không thể gửi tin báo cho người mời"); }
                }
            }
            await user.save();
        } else {
            // CẬP NHẬT THÔNG TIN NẾU LÀ NGƯỜI DÙNG CŨ
            user.name = first_name;
            user.username = username || 'n/a';
            
            // Reset lượt xem quảng cáo nếu sang ngày mới
            if (user.lastActiveDay !== today) {
                user.adsWatchedToday = 0;
                user.lastActiveDay = today;
            }
            await user.save();
        }

        // TÍNH TOÁN GIÁ TRỊ VNĐ ĐỂ HIỂN THỊ
        const vndValue = (user.totalCoins / EXCHANGE_RATE).toLocaleString('vi-VN');

        const welcomeMsg = `🚀 *CHÀO MỪNG ĐẾN VỚI MÁY ĐÀO XU 2.0*\n\n` +
                           `👤 Chủ nhân: *${first_name}*\n` +
                           `📊 Cấp độ: *Level ${user.level}*\n` +
                           `⚡ Tốc độ đào: *${user.miningRate} Xu/s*\n` +
                           `💰 Số dư: *${user.totalCoins.toLocaleString()} Xu*\n` +
                           `💸 Quy đổi: *~${vndValue} VNĐ*\n` +
                           `💎 Kim cương: *${user.diamonds}*\n\n` +
                           `👇 Nhấn nút bên dưới để bắt đầu khai thác ngay!`;

        ctx.replyWithMarkdown(welcomeMsg, Markup.inlineKeyboard([
            [Markup.button.webApp('🎮 MỞ MÁY ĐÀO XU', process.env.WEB_URL)]
        ]));

    } catch (e) {
        console.error("❌ Lỗi Start Bot:", e);
        ctx.reply("Hệ thống đang bận, vui lòng thử lại sau!");
    }
});

// ==========================================
// 3. LỆNH ADMIN (DÀNH RIÊNG CHO CHỦ BOT)
// ==========================================

// Gửi thông báo toàn hệ thống
bot.command('broadcast', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    const msg = ctx.message.text.replace('/broadcast', '').trim();
    if (!msg) return ctx.reply("❌ Nhập nội dung: /broadcast [Nội dung]");

    const users = await User.find({});
    ctx.reply(`🚀 Đang gửi thông báo tới ${users.length} người dùng...`);

    let success = 0;
    for (const u of users) {
        try {
            await bot.telegram.sendMessage(u.telegramId, `📢 *THÔNG BÁO HỆ THỐNG*\n\n${msg}`, { parse_mode: 'Markdown' });
            success++;
            await new Promise(r => setTimeout(r, 50)); // Tránh spam
        } catch (e) { continue; }
    }
    ctx.reply(`✅ Đã gửi thành công tới ${success} người dùng.`);
});

// Xem danh sách Top thợ đào
bot.command('list', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    try {
        const topUsers = await User.find().sort({ totalCoins: -1 }).limit(20);
        let text = "🏆 *TOP 20 ĐẠI GIA MÁY ĐÀO*\n\n";
        topUsers.forEach((u, i) => {
            text += `${i + 1}. ${u.name} - ${u.totalCoins.toLocaleString()} Xu\n`;
        });
        ctx.replyWithMarkdown(text);
    } catch (e) { ctx.reply("Lỗi lấy dữ liệu."); }
});

// ==========================================
// 4. CẤU HÌNH WEB SERVER & WEBHOOK
// ==========================================
app.use(express.json());
app.use(bot.webhookCallback('/api/tg-webhook'));

app.get('/', (req, res) => res.send('Bot Mining 2.0 (Rate 20,000:1) is Active'));

// Endpoint kiểm tra sức khỏe server
app.get('/health', (req, res) => {
    res.json({ status: 'running', db: mongoose.connection.readyState === 1 ? 'ok' : 'error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[Server] Đang chạy trên cổng ${PORT}`);
});
