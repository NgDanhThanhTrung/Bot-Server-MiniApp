const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const User = require('./models/User'); // Giữ nguyên file này như bạn yêu cầu

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Kết nối Database
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Bot Server (Tài khoản A) đã kết nối MongoDB'))
    .catch(err => console.error('❌ Lỗi kết nối DB:', err));

bot.start(async (ctx) => {
    const { id, first_name, username } = ctx.from;
    const startPayload = ctx.startPayload; // ID người mời (nếu có)
    const today = new Date().toDateString(); // Định dạng: "Thu May 21 2026"
    
    try {
        // 1. Tìm người dùng dựa trên telegramId (kiểu String trong Model của bạn)
        let user = await User.findOne({ telegramId: id.toString() });

        if (!user) {
            // 2. Nếu chưa có, tạo mới với các trường khớp hoàn toàn với Model
            user = new User({
                telegramId: id.toString(),   // ID
                username: username || 'n/a',  // Username
                name: first_name,             // Tên
                totalCoins: 0,                // Số dư XU
                spinsLeft: 5,                 // Lượt quay mặc định
                adsWatchedToday: 0,           // Số lượt xem quảng cáo (ban đầu là 0)
                lastActiveDay: today,         // Ngày hoạt động
                refs: 0                       // Số người đã mời
            });

            // 3. Logic xử lý Referral (Người mời bạn)
            if (startPayload && startPayload !== id.toString()) {
                const inviter = await User.findOne({ telegramId: startPayload });
                if (inviter) {
                    inviter.totalCoins += 100000; // Thưởng 100k xu
                    inviter.refs += 1;
                    await inviter.save();
                    
                    // Thông báo cho người mời biết có bạn mới tham gia
                    try {
                        await bot.telegram.sendMessage(inviter.telegramId, `🎁 Chúc mừng! Bạn nhận được 100,000 Xu vì đã mời ${first_name} tham gia!`);
                    } catch (e) { console.log("Lỗi gửi tin báo cho người mời"); }
                }
            }
            await user.save();
            console.log(`✨ Đã tạo dữ liệu Mongo thành công cho ID: ${id}`);
        } else {
            // 4. Nếu là người dùng cũ, cập nhật lại thông tin cơ bản
            user.name = first_name;
            user.username = username || 'n/a';
            
            // Tự động reset lượt quay và lượt xem quảng cáo khi sang ngày mới
            if (user.lastActiveDay !== today) {
                user.spinsLeft = 5;
                user.adsWatchedToday = 0;
                user.lastActiveDay = today;
            }
            await user.save();
        }

        // 5. Gửi tin nhắn chào mừng kèm thông tin thực tế từ Database
        const welcomeMsg = `🎰 Chào mừng ${first_name}!\n\n` +
                           `👤 ID: ${id}\n` +
                           `🎁 Lượt quay hôm nay: ${user.spinsLeft}\n` +
                           `📺 QC đã xem: ${user.adsWatchedToday}/5\n` +
                           `💰 Số dư hiện tại: ${user.totalCoins.toLocaleString()} Xu\n\n` +
                           `Hãy nhấn nút bên dưới để bắt đầu kiếm tiền! 👇`;

        ctx.reply(welcomeMsg, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎮 MỞ MINI APP', web_app: { url: process.env.WEB_URL } }]
                ]
            }
        });

    } catch (e) { 
        console.error("❌ Lỗi xử lý tại Tài khoản A:", e);
        ctx.reply("Hệ thống đang bảo trì, vui lòng thử lại sau!");
    }
});

// Các lệnh Admin (Dùng telegramId để khớp với Model)
bot.command('broadcast', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    const msg = ctx.message.text.replace('/broadcast', '').trim();
    if (!msg) return ctx.reply("Nhập nội dung thông báo!");

    const users = await User.find({});
    ctx.reply(`🚀 Đang gửi thông báo tới ${users.length} người...`);

    for (const u of users) {
        try {
            await bot.telegram.sendMessage(u.telegramId, `📢 **THÔNG BÁO:**\n\n${msg}`, { parse_mode: 'Markdown' });
            await new Promise(r => setTimeout(r, 50)); 
        } catch (e) {}
    }
    ctx.reply("✅ Gửi hoàn tất!");
});

app.use(express.json());
app.use(bot.webhookCallback('/api/tg-webhook'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Bot Server (Tài khoản A) đang chạy tại cổng ${PORT}`);
    // Cập nhật webhook
    await bot.telegram.setWebhook(`${process.env.APP_URL}/api/tg-webhook`);
});
