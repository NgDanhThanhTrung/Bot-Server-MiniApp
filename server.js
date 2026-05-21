const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const User = require('./models/User');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Kết nối Database chung với Web App
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Tài khoản A (Bot) đã kết nối Database chung'))
    .catch(err => console.error('❌ Lỗi kết nối DB:', err));

bot.start(async (ctx) => {
    const { id, first_name, username } = ctx.from;
    const startPayload = ctx.startPayload; // Lấy ID người mời từ link t.me/bot?start=ID
    const today = new Date().toISOString().split('T')[0];
    
    try {
        // Tìm người dùng trong DB bằng ID số (đồng bộ với Web)
        let user = await User.findOne({ id: id });

        if (!user) {
            // TẠO MỚI NẾU CHƯA CÓ TRÊN DATABASE
            user = new User({
                id: id,
                first_name: first_name,
                username: username || 'n/a',
                spinsLeft: 5,
                coins: 0,
                lastActiveDate: today
            });

            // Xử lý Referral (Người giới thiệu)
            if (startPayload && startPayload !== id.toString()) {
                const inviter = await User.findOne({ id: parseInt(startPayload) });
                if (inviter) {
                    inviter.coins += 100000; // Thưởng 100k xu giống như logic trên Web
                    inviter.refs += 1;
                    await inviter.save();
                    
                    // Gửi tin nhắn báo tin vui cho người mời
                    try {
                        await bot.telegram.sendMessage(inviter.id, `🎁 Chúc mừng! Bạn nhận được 100,000 Xu vì đã mời ${first_name} tham gia!`);
                    } catch (e) { console.log("Không thể báo tin cho người mời"); }
                }
            }
            await user.save();
            console.log(`✨ Đã khởi tạo dữ liệu Mongo cho: ${id}`);
        } else {
            // Nếu người dùng cũ quay lại, kiểm tra để reset lượt quay mỗi ngày
            if (user.lastActiveDate !== today) {
                user.spinsLeft = 5;
                user.lastActiveDate = today;
                await user.save();
            }
        }

        // Phản hồi người dùng với nút mở Web App
        ctx.reply(`🎰 Chào mừng ${first_name} đến với Siêu Cấp Kiếm Xu!\n\n` +
                  `🎁 Lượt quay hôm nay: ${user.spinsLeft}\n` +
                  `💰 Số dư hiện tại: ${user.coins.toLocaleString()} Xu\n\n` +
                  `Nhấn nút dưới đây để bắt đầu kiếm tiền ngay! 👇`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎮 MỞ MINI APP', web_app: { url: process.env.WEB_URL } }]
                ]
            }
        });

    } catch (e) { 
        console.error("Lỗi Mongo Tài khoản A:", e);
        ctx.reply("Hệ thống gặp sự cố nhỏ, vui lòng thử lại sau!");
    }
});

// Giữ các lệnh Admin cũ của bạn
bot.command('saoluu', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    const users = await User.find({});
    ctx.replyWithDocument({ source: Buffer.from(JSON.stringify(users, null, 2)), filename: 'user_backup.json' });
});

bot.command('broadcast', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    const msg = ctx.message.text.replace('/broadcast', '').trim();
    if (!msg) return ctx.reply("Vui lòng nhập nội dung!");

    const users = await User.find({});
    for (const u of users) {
        try {
            await bot.telegram.sendMessage(u.id, `📢 **THÔNG BÁO:**\n\n${msg}`, { parse_mode: 'Markdown' });
            await new Promise(r => setTimeout(r, 50));
        } catch (e) {}
    }
    ctx.reply("✅ Đã gửi xong!");
});

// Webhook và Server
app.use(express.json());
app.use(bot.webhookCallback('/api/tg-webhook'));
app.get('/', (req, res) => res.send('Bot Tài khoản A đang chạy...'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Bot Server listening on port ${PORT}`);
    await bot.telegram.setWebhook(`${process.env.APP_URL}/api/tg-webhook`);
});
