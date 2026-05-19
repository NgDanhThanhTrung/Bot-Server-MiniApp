const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const User = require('./models/User');

// Kiểm tra cấu hình hệ thống
const { 
    BOT_TOKEN, MONGODB_URI, ADMIN_ID, 
    WEB_URL, APP_URL, PORT 
} = process.env;

if (!BOT_TOKEN || !MONGODB_URI) {
    console.error("❌ Thiếu biến môi trường quan trọng!");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// 1. Kết nối Database
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ MongoDB đã sẵn sàng'))
    .catch(err => console.error('❌ Lỗi kết nối Database:', err));

// 2. Logic dành cho Người dùng
bot.start(async (ctx) => {
    const { id, first_name, username } = ctx.from;
    
    // Lưu hoặc cập nhật thông tin cơ bản khi người dùng nhấn Start
    try {
        await User.findOneAndUpdate(
            { telegramId: id.toString() },
            { name: first_name, username: username },
            { upsert: true, new: true }
        );
    } catch (e) { console.error("Lỗi cập nhật user:", e); }

    ctx.reply(`🎰 Chào mừng ${first_name} đến với Vòng Quay May Mắn!\n\n💰 Hãy bắt đầu kiếm xu và mời bạn bè để nhận thưởng lớn.`, {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎮 MỞ MINI APP NGAY', web_app: { url: WEB_URL } }],
                [{ text: '👥 Nhóm cộng đồng', url: 'https://t.me/your_group_link' }]
            ]
        }
    });
});

// 3. Logic dành cho Admin (Bảo mật bằng ADMIN_ID)
const isAdmin = (ctx, next) => {
    if (ctx.from.id.toString() === ADMIN_ID) return next();
    return ctx.reply("⚠️ Bạn không có quyền thực hiện lệnh này.");
};

// Lệnh /saoluu - Trích xuất dữ liệu thô
bot.command('saoluu', isAdmin, async (ctx) => {
    try {
        const users = await User.find({});
        const backupData = JSON.stringify(users, null, 2);
        const fileName = `backup_${new Date().toISOString().split('T')[0]}.json`;
        
        await ctx.replyWithDocument({ 
            source: Buffer.from(backupData), 
            filename: fileName 
        }, { caption: `✅ Tổng cộng: ${users.length} người dùng.` });
    } catch (err) {
        ctx.reply("❌ Lỗi trích xuất: " + err.message);
    }
});

// Lệnh /broadcast - Thông báo tới toàn bộ thành viên
bot.command('broadcast', isAdmin, async (ctx) => {
    const text = ctx.message.text.replace('/broadcast', '').trim();
    if (!text) return ctx.reply("⚠️ Nhập nội dung: /broadcast [tin nhắn]");

    const users = await User.find({});
    let success = 0;
    
    ctx.reply(`🚀 Bắt đầu gửi tin tới ${users.length} người...`);

    for (const u of users) {
        try {
            await bot.telegram.sendMessage(u.telegramId, `📢 **THÔNG BÁO TỪ QUẢN TRỊ**\n\n${text}`, { parse_mode: 'Markdown' });
            success++;
            // Tránh Rate Limit của Telegram (30 msg/sec)
            await new Promise(r => setTimeout(r, 60)); 
        } catch (e) {
            if (e.description.includes('bot was blocked')) {
                console.log(`User ${u.telegramId} đã chặn bot.`);
            }
        }
    }
    ctx.reply(`✅ Đã gửi thành công cho ${success}/${users.length} người.`);
});

// 4. Thiết lập Server & Webhook (Tối ưu RAM cho Render)
app.use(express.json());
app.use(bot.webhookCallback('/api/telegram-webhook'));

app.get('/', (req, res) => res.status(200).send('Bot Server is Active!'));

const serverPort = PORT || 3000;
app.listen(serverPort, async () => {
    console.log(`Server listening on port ${serverPort}`);
    try {
        // Tự động set webhook khi khởi động
        await bot.telegram.setWebhook(`${APP_URL}/api/telegram-webhook`);
        console.log('✅ Webhook Set Success');
    } catch (e) {
        console.error('❌ Webhook Set Failed:', e);
    }
});
