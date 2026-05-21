const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const User = require('./models/User');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Kết nối Database chung
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Bot Server đã kết nối Database chung'))
    .catch(err => console.error('❌ Lỗi kết nối DB:', err));

// Logic khi người dùng nhấn /start
bot.start(async (ctx) => {
    const { id, first_name, username } = ctx.from;
    
    try {
        // Cập nhật thông tin người dùng mỗi khi họ start bot
        await User.findOneAndUpdate(
            { telegramId: id.toString() },
            { name: first_name, username: username },
            { upsert: true }
        );
    } catch (e) { console.error("Lỗi cập nhật User:", e); }

    ctx.reply(`🎰 Chào mừng ${first_name}!\n\nHệ thống đã sẵn sàng. Nhấn nút bên dưới để vào Vòng Quay May Mắn và nhận xu mỗi ngày.`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎮 MỞ MINI APP', web_app: { url: process.env.WEB_URL } }]
            ]
        }
    });
});

// Lệnh Admin: /saoluu (Chỉ Admin mới dùng được)
bot.command('saoluu', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    const users = await User.find({});
    const data = JSON.stringify(users, null, 2);
    ctx.replyWithDocument({ source: Buffer.from(data), filename: 'user_backup.json' });
});

// Lệnh Admin: /broadcast (Gửi thông báo toàn hệ thống)
bot.command('broadcast', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    const msg = ctx.message.text.replace('/broadcast', '').trim();
    if (!msg) return ctx.reply("Vui lòng nhập nội dung tin nhắn!");

    const users = await User.find({});
    ctx.reply(`🚀 Đang gửi tin nhắn tới ${users.length} người dùng...`);

    for (const u of users) {
        try {
            await bot.telegram.sendMessage(u.telegramId, `📢 **THÔNG BÁO:**\n\n${msg}`, { parse_mode: 'Markdown' });
            await new Promise(r => setTimeout(r, 50)); // Tránh bị Telegram chặn do gửi quá nhanh
        } catch (e) { console.log(`Không thể gửi tới ${u.telegramId}`); }
    }
    ctx.reply("✅ Đã hoàn thành phát tin!");
});

// Thiết lập Webhook để tối ưu RAM cho Render
app.use(express.json());
app.use(bot.webhookCallback('/api/tg-webhook'));

app.get('/', (req, res) => res.send('Bot is running...'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Bot Server listening on port ${PORT}`);
    // Đăng ký Webhook với Telegram
    await bot.telegram.setWebhook(`${process.env.APP_URL}/api/tg-webhook`);
});
