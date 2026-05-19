const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const User = require('./models/User');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

mongoose.connect(process.env.MONGODB_URI);

// Chào mừng & Mở Mini App
bot.start(async (ctx) => {
    ctx.reply(`🎰 Chào mừng ${ctx.from.first_name}!\nNhấn nút bên dưới để tham gia quay số nhận xu.`, {
        reply_markup: {
            inline_keyboard: [[{ text: '🎮 MỞ MINI APP', web_app: { url: process.env.WEB_URL } }]]
        }
    });
});

// Admin: Sao lưu
bot.command('saoluu', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    const users = await User.find({});
    ctx.replyWithDocument({ source: Buffer.from(JSON.stringify(users, null, 2)), filename: 'backup.json' });
});

// Admin: Thông báo
bot.command('broadcast', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    const msg = ctx.message.text.replace('/broadcast', '').trim();
    const users = await User.find({});
    for (const u of users) {
        try { await bot.telegram.sendMessage(u.telegramId, msg); } catch (e) {}
    }
    ctx.reply("✅ Đã gửi xong!");
});

app.use(express.json());
app.use(bot.webhookCallback('/tg-webhook'));
app.listen(process.env.PORT || 3000, async () => {
    await bot.telegram.setWebhook(`${process.env.APP_URL}/tg-webhook`);
});
