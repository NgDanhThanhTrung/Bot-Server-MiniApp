const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const User = require('./models/User'); 

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Tham số cấu hình kinh tế gốc
const EXCHANGE_RATE = 20000;    

// Kết nối cơ sở dữ liệu chung 
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Bot Server đã kết nối Database Kinh Tế 2.0'))
    .catch(err => console.error('❌ Lỗi kết nối DB:', err));

// LOGIC XỬ LÝ LỆNH /START & GHI NHẬN MÃ GIỚI THIỆU KHÔNG CHECK CLONE CỨNG NGAY
bot.start(async (ctx) => {
    const { id, first_name, username } = ctx.from;
    const startPayload = ctx.startPayload; // Lấy ID người mời (Ví dụ: 987654321) từ link ref
    const today = new Date().toDateString();
    
    try {
        let user = await User.findOne({ telegramId: id.toString() });

        if (!user) {
            let referredBy = null;
            if (startPayload && startPayload !== id.toString()) {
                // Kiểm tra xem ID người mời có thực sự tồn tại trong DB không
                const referrerExist = await User.findOne({ telegramId: startPayload.trim() });
                if (referrerExist) {
                    referredBy = startPayload.trim();
                }
            }

            // Tạo người dùng mới hoàn toàn tương thích cấu hình
            user = new User({
                telegramId: id.toString(),
                username: username || 'n/a',
                name: first_name || 'Người dùng',
                referredBy: referredBy,
                lastActiveDay: today,
                isMining: false,
                miningStartedAt: null
            });
            await user.save();
            
            ctx.replyWithMarkdown(`🎉 *Chào mừng bạn đến với Siêu Cấp Máy Đào 2.0!* \nTài khoản nông trại của bạn đã được khởi tạo thành công.`);
        } else {
            // Kiểm tra và reset ads hằng ngày nếu có hoạt động mới
            if (user.lastActiveDay !== today) {
                user.adsWatchedToday = 0;
                user.lastActiveDay = today;
                await user.save();
            }
            ctx.replyWithMarkdown(`👋 *Chào mừng trở lại, ${user.name}!* \nHãy truy cập Mini App để tiếp tục vận hành máy khai thác.`);
        }

        // Trả về nút bấm Mini App tích hợp
        ctx.reply("Bấm nút dưới đây để vào nông trại:", Markup.inlineKeyboard([
            Markup.button.webApp("🌾 Vào Nông Trại 🌾", process.env.MINI_APP_URL)
        ]));

    } catch (e) {
        console.error("Lỗi xử lý /start:", e);
        ctx.reply("Hệ thống đang bận nâng cấp, vui lòng thử lại sau.");
    }
});

// ADMIN COMMAND: Gửi thông báo toàn hệ thống từ file gốc
bot.command('broadcast', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    const msg = ctx.message.text.split('/broadcast ')[1];
    if (!msg) return ctx.reply('⚠️ Định dạng: /broadcast [Nội dung]');

    const users = await User.find();
    ctx.reply(`📢 Bắt đầu gửi tới ${users.length} người dùng...`);

    let success = 0;
    for (const u of users) {
        try {
            await bot.telegram.sendMessage(u.telegramId, `📢 *THÔNG BÁO HỆ THỐNG*\n\n${msg}`, { parse_mode: 'Markdown' });
            success++;
            await new Promise(r => setTimeout(r, 50)); // Tránh spam nghẽn Telegram API
        } catch (e) { continue; }
    }
    ctx.reply(`✅ Đã gửi thành công tới ${success} người dùng.`);
});

// ADMIN COMMAND: Xem danh sách Top thợ đào
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

// CẤU HÌNH WEB SERVER & WEBHOOK CALLBACK
app.use(express.json());

if (process.env.USE_WEBHOOK === 'true') {
    app.use(bot.webhookCallback('/api/tg-webhook'));
    console.log("Bot cấu hình chạy bằng cơ chế Webhopk.");
} else {
    bot.launch();
    console.log("Bot cấu hình chạy bằng cơ chế Long Polling.");
}

app.get('/', (req, res) => res.send('Bot Mining Server 2.0 Live.'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot Express server running on port ${PORT}`));
