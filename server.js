const { Telegraf } = require('telegraf');
const mongoose = require('mongoose');
const express = require('express');
const User = require('./models/User'); 

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);

// Kết nối Database
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Bot Server đã kết nối MongoDB'))
    .catch(err => console.error('❌ Lỗi kết nối DB:', err));

bot.start(async (ctx) => {
    const { id, first_name, username } = ctx.from;
    const startPayload = ctx.startPayload; 
    const today = new Date().toDateString(); 
    
    try {
        let user = await User.findOne({ telegramId: id.toString() });

        if (!user) {
            user = new User({
                telegramId: id.toString(),   
                username: username || 'n/a',  
                name: first_name,             
                totalCoins: 0,
                diamonds: 0,           // Mới
                level: 1,              // Mới
                isMining: false,       // Mới
                adsWatchedToday: 0,           
                lastActiveDay: today,         
                refs: 0                       
            });

            if (startPayload && startPayload !== id.toString()) {
                const inviter = await User.findOne({ telegramId: startPayload });
                if (inviter) {
                    inviter.totalCoins += 100000; 
                    inviter.refs += 1;
                    await inviter.save();
                    
                    try {
                        await bot.telegram.sendMessage(inviter.telegramId, `🎁 Chúc mừng! Bạn nhận được 100,000 Xu vì đã mời ${first_name} tham gia!`);
                    } catch (e) { console.log("Lỗi gửi tin báo cho người mời"); }
                }
            }
            await user.save();
        } else {
            user.name = first_name;
            user.username = username || 'n/a';
            
            if (user.lastActiveDay !== today) {
                user.adsWatchedToday = 0;
                user.lastActiveDay = today;
            }
            await user.save();
        }

        const welcomeMsg = `🎰 Chào mừng ${first_name}!\n\n` +
                           `👤 ID: ${id}\n` +
                           `📊 Level: ${user.level || 1}\n` +
                           `💎 Kim cương: ${user.diamonds || 0}\n` +
                           `📺 QC đã xem: ${user.adsWatchedToday}/15\n` +
                           `💰 Số dư: ${user.totalCoins.toLocaleString()} Xu\n\n` +
                           `Hãy nhấn nút bên dưới để bắt đầu đào xu! 👇`;

        ctx.reply(welcomeMsg, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎮 MỞ MINI APP', web_app: { url: process.env.WEB_URL } }]
                ]
            }
        });

    } catch (e) { 
        console.error("❌ Lỗi xử lý bot.start:", e);
        ctx.reply("Hệ thống đang bảo trì, vui lòng thử lại sau!");
    }
});

// --- LỆNH BROADCAST ---
bot.command('broadcast', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;
    
    const msg = ctx.message.text.replace('/broadcast', '').trim();
    if (!msg) return ctx.reply("❌ Vui lòng nhập nội dung: /broadcast [Nội dung]");

    const users = await User.find({});
    await ctx.reply(`🚀 Bắt đầu gửi thông báo tới ${users.length} người dùng...`);

    let success = 0, blocked = 0, error = 0;
    for (const u of users) {
        try {
            await bot.telegram.sendMessage(u.telegramId, `📢 **THÔNG BÁO HỆ THỐNG**\n\n${msg}`, { parse_mode: 'Markdown' });
            success++;
            await new Promise(r => setTimeout(r, 50)); 
        } catch (e) {
            if (e.description && e.description.includes('forbidden')) blocked++;
            else error++;
        }
    }
    ctx.reply(`📊 Kết quả: ✅ ${success} | 🚫 ${blocked} | ❌ ${error}`);
});

// --- LỆNH LIST (CẬP NHẬT THÔNG TIN MỚI) ---
bot.command('list', async (ctx) => {
    if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

    try {
        const users = await User.find({}).sort({ totalCoins: -1 }).limit(50);
        if (users.length === 0) return ctx.reply("Chưa có thành viên nào.");

        let text = "👥 **TOP 50 THỢ ĐÀO**\n\n";
        users.forEach((u, i) => {
            text += `${i + 1}. **${u.name}** (Lvl ${u.level || 1})\n` +
                    `   💎 ${u.diamonds || 0} | 📺 ${u.adsWatchedToday}/15\n` +
                    `   💰 ${u.totalCoins.toLocaleString()} Xu | ${u.isMining ? '⛏️ Đang đào' : '💤 Nghỉ'}\n` +
                    `----------------------\n`;
            
            if (text.length > 3000) {
                ctx.reply(text, { parse_mode: 'Markdown' });
                text = "";
            }
        });
        if (text) ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (e) {
        ctx.reply("❌ Lỗi khi lấy danh sách.");
    }
});

app.use(express.json());
app.use(bot.webhookCallback('/api/tg-webhook'));
// --- ĐỊA CHỈ KIỂM TRA TRẠNG THÁI SERVER ---
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        dbState: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
    });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Bot Server đang chạy tại cổng ${PORT}`);
    await bot.telegram.setWebhook(`${process.env.APP_URL}/api/tg-webhook`);
});
